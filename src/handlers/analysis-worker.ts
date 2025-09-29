import type { SQSHandler } from 'aws-lambda';
import {
  RekognitionClient,
  DetectLabelsCommand,
} from '@aws-sdk/client-rekognition';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import * as AWSXRay from 'aws-xray-sdk';
import { Readable } from 'stream';
import pino from 'pino';

const logger = pino();
const rekognitionClient = new RekognitionClient({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'ca-central-1' });
const dynamoClient = new DynamoDBClient({ region: 'ca-central-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudWatchClient = new CloudWatchClient({ region: 'ca-central-1' });

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export const handler: SQSHandler = async (event) => {
  return AWSXRay.captureAsyncFunc(
    'analysis-worker-handler',
    async (segment) => {
      try {
        logger.info(
          { recordCount: event.Records?.length || 0 },
          'Analysis worker received SQS event'
        );

        if (!event.Records || !Array.isArray(event.Records)) {
          logger.error('No Records found in event or Records is not an array');
          return;
        }

        segment?.addAnnotation('recordCount', event.Records.length);

        for (const record of event.Records) {
          await AWSXRay.captureAsyncFunc(
            'process-record',
            async (recordSegment) => {
              try {
                const messageBody = JSON.parse(record.body);
                const snsMessage = JSON.parse(messageBody.Message);

                logger.info({ snsMessage }, 'Extracted SNS message');

                const { bucket, key } = snsMessage;
                logger.info({ bucket, key }, 'Analyzing image');

                recordSegment?.addAnnotation('imageKey', key);
                recordSegment?.addAnnotation('sourceBucket', bucket);

                const imageBuffer = await AWSXRay.captureAsyncFunc(
                  's3-download',
                  async (downloadSegment) => {
                    try {
                      logger.info({ bucket, key }, 'Downloading image from S3');

                      downloadSegment?.addAnnotation('operation', 'GetObject');
                      downloadSegment?.addAnnotation('bucket', bucket);
                      downloadSegment?.addAnnotation('key', key);

                      const getObjectCommand = new GetObjectCommand({
                        Bucket: bucket,
                        Key: key,
                      });

                      const s3Response = await s3Client.send(getObjectCommand);
                      if (!s3Response.Body) {
                        const error = new Error(
                          `No body returned for object ${key}`
                        );
                        downloadSegment?.addError(error);
                        logger.error({ key }, 'No body returned for S3 object');
                        throw error;
                      }

                      const buffer = await streamToBuffer(
                        s3Response.Body as Readable
                      );
                      logger.info(
                        { key, imageSize: buffer.length },
                        'Successfully downloaded image'
                      );

                      downloadSegment?.addMetadata('imageSize', buffer.length);
                      return buffer;
                    } catch (error) {
                      downloadSegment?.addError(error as Error);
                      throw error;
                    }
                  }
                );

                const labels = await AWSXRay.captureAsyncFunc(
                  'rekognition-analysis',
                  async (rekognitionSegment) => {
                    try {
                      rekognitionSegment?.addAnnotation(
                        'operation',
                        'DetectLabels'
                      );
                      rekognitionSegment?.addAnnotation('maxLabels', 10);
                      rekognitionSegment?.addAnnotation('minConfidence', 75);

                      const detectLabelsCommand = new DetectLabelsCommand({
                        Image: {
                          Bytes: imageBuffer,
                        },
                        MaxLabels: 10,
                        MinConfidence: 75,
                      });

                      logger.info({ key }, 'Calling Rekognition DetectLabels');
                      const rekognitionResponse = await rekognitionClient.send(
                        detectLabelsCommand
                      );

                      const detectedLabels =
                        rekognitionResponse.Labels?.map((label) => ({
                          name: label.Name,
                          confidence: label.Confidence,
                        })) || [];

                      logger.info(
                        {
                          key,
                          labelCount: detectedLabels.length,
                          labels: detectedLabels,
                        },
                        'Detected labels from Rekognition'
                      );

                      rekognitionSegment?.addMetadata(
                        'labelCount',
                        detectedLabels.length
                      );
                      rekognitionSegment?.addMetadata('labels', detectedLabels);

                      return detectedLabels;
                    } catch (error) {
                      rekognitionSegment?.addError(error as Error);
                      throw error;
                    }
                  }
                );

                await AWSXRay.captureAsyncFunc(
                  'dynamodb-update',
                  async (dbSegment) => {
                    try {
                      dbSegment?.addAnnotation('operation', 'UpdateItem');
                      dbSegment?.addAnnotation(
                        'tableName',
                        process.env.DYNAMODB_TABLE_NAME || 'unknown'
                      );
                      dbSegment?.addAnnotation('imageId', key);

                      const updateCommand = new UpdateCommand({
                        TableName: process.env.DYNAMODB_TABLE_NAME,
                        Key: { imageId: key },
                        UpdateExpression:
                          'SET labels = :labels, analysisStatus = :analysisStatus, #status = :status, updatedAt = :updatedAt',
                        ExpressionAttributeNames: {
                          '#status': 'status',
                        },
                        ExpressionAttributeValues: {
                          ':labels': labels,
                          ':analysisStatus': 'completed',
                          ':status': 'COMPLETED',
                          ':updatedAt': new Date().toISOString(),
                        },
                      });

                      logger.info(
                        { imageId: key },
                        'Updating analysis results in DynamoDB'
                      );
                      await docClient.send(updateCommand);

                      logger.info(
                        {
                          imageId: key,
                          status: 'COMPLETED',
                          analysisStatus: 'completed',
                        },
                        'Successfully updated job'
                      );

                      dbSegment?.addMetadata('status', 'COMPLETED');
                      dbSegment?.addMetadata('analysisStatus', 'completed');
                      dbSegment?.addMetadata('labelCount', labels.length);
                    } catch (error) {
                      dbSegment?.addError(error as Error);
                      throw error;
                    }
                  }
                );

                await AWSXRay.captureAsyncFunc(
                  'cloudwatch-success-metric',
                  async (metricSegment) => {
                    try {
                      metricSegment?.addAnnotation(
                        'operation',
                        'PutMetricData'
                      );
                      metricSegment?.addAnnotation(
                        'metricName',
                        'ImagesProcessed'
                      );

                      const successMetricCommand = new PutMetricDataCommand({
                        Namespace: 'PixelPipe',
                        MetricData: [
                          {
                            MetricName: 'ImagesProcessed',
                            Value: 1,
                            Unit: 'Count',
                            Dimensions: [
                              {
                                Name: 'WorkerName',
                                Value: 'analysis-worker',
                              },
                            ],
                            Timestamp: new Date(),
                          },
                        ],
                      });

                      await cloudWatchClient.send(successMetricCommand);
                      logger.info(
                        { imageId: key },
                        'Emitted success metric to CloudWatch'
                      );
                    } catch (error) {
                      metricSegment?.addError(error as Error);
                      throw error;
                    }
                  }
                );
              } catch (error) {
                recordSegment?.addError(error as Error);
                logger.error({ error }, 'Error processing analysis record');

                await AWSXRay.captureAsyncFunc(
                  'cloudwatch-failure-metric',
                  async (failureMetricSegment) => {
                    try {
                      failureMetricSegment?.addAnnotation(
                        'operation',
                        'PutMetricData'
                      );
                      failureMetricSegment?.addAnnotation(
                        'metricName',
                        'ProcessingFailures'
                      );

                      const failureMetricCommand = new PutMetricDataCommand({
                        Namespace: 'PixelPipe',
                        MetricData: [
                          {
                            MetricName: 'ProcessingFailures',
                            Value: 1,
                            Unit: 'Count',
                            Dimensions: [
                              {
                                Name: 'WorkerName',
                                Value: 'analysis-worker',
                              },
                            ],
                            Timestamp: new Date(),
                          },
                        ],
                      });

                      await cloudWatchClient.send(failureMetricCommand);
                      logger.info('Emitted failure metric to CloudWatch');
                    } catch (metricError) {
                      failureMetricSegment?.addError(metricError as Error);
                      logger.error(
                        { metricError },
                        'Failed to emit failure metric'
                      );
                    }
                  }
                );

                throw error;
              }
            }
          );
        }
      } catch (error) {
        segment?.addError(error as Error);
        throw error;
      }
    }
  );
};
