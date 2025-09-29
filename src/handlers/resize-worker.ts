import type { SQSHandler } from 'aws-lambda';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import * as AWSXRay from 'aws-xray-sdk';
import { Readable } from 'stream';
import sharp from 'sharp';
import pino from 'pino';

const logger = pino();
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
  return AWSXRay.captureAsyncFunc('resize-worker-handler', async (segment) => {
    try {
      logger.info(
        { recordCount: event.Records.length },
        'Resize worker received SQS event'
      );

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
              logger.info({ bucket, key }, 'Processing image resize');

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

                    const response = await s3Client.send(getObjectCommand);

                    if (!response.Body) {
                      const error = new Error(
                        `No body returned for object ${key}`
                      );
                      downloadSegment?.addError(error);
                      logger.error({ key }, 'No body returned for S3 object');
                      throw error;
                    }

                    const buffer = await streamToBuffer(
                      response.Body as Readable
                    );

                    logger.info(
                      {
                        key,
                        imageSize: buffer.length,
                        contentType: response.ContentType,
                      },
                      'Successfully downloaded image'
                    );

                    downloadSegment?.addMetadata('imageSize', buffer.length);
                    downloadSegment?.addMetadata(
                      'contentType',
                      response.ContentType
                    );

                    return buffer;
                  } catch (error) {
                    downloadSegment?.addError(error as Error);
                    throw error;
                  }
                }
              );

              const thumbnailBuffer = await AWSXRay.captureAsyncFunc(
                'image-resize',
                async (resizeSegment) => {
                  try {
                    resizeSegment?.addAnnotation('operation', 'sharp-resize');
                    resizeSegment?.addAnnotation('targetWidth', 200);
                    resizeSegment?.addAnnotation('targetHeight', 200);

                    const buffer = await sharp(imageBuffer)
                      .resize(200, 200)
                      .jpeg()
                      .toBuffer();

                    logger.info(
                      { key, thumbnailSize: buffer.length },
                      'Created thumbnail'
                    );

                    resizeSegment?.addMetadata('thumbnailSize', buffer.length);
                    resizeSegment?.addMetadata(
                      'originalSize',
                      imageBuffer.length
                    );

                    return buffer;
                  } catch (error) {
                    resizeSegment?.addError(error as Error);
                    throw error;
                  }
                }
              );

              const thumbnailUrl = await AWSXRay.captureAsyncFunc(
                's3-upload',
                async (uploadSegment) => {
                  try {
                    const thumbnailKey = `thumbnails/${key}`;

                    uploadSegment?.addAnnotation('operation', 'PutObject');
                    uploadSegment?.addAnnotation(
                      'bucket',
                      process.env.PROCESSED_BUCKET_NAME || 'unknown'
                    );
                    uploadSegment?.addAnnotation('key', thumbnailKey);

                    const putObjectCommand = new PutObjectCommand({
                      Bucket: process.env.PROCESSED_BUCKET_NAME,
                      Key: thumbnailKey,
                      Body: thumbnailBuffer,
                      ContentType: 'image/jpeg',
                    });

                    await s3Client.send(putObjectCommand);

                    logger.info(
                      {
                        bucket: process.env.PROCESSED_BUCKET_NAME,
                        thumbnailKey,
                      },
                      'Uploaded thumbnail to S3'
                    );

                    const url = `s3://${process.env.PROCESSED_BUCKET_NAME}/${thumbnailKey}`;
                    uploadSegment?.addMetadata('thumbnailUrl', url);

                    return url;
                  } catch (error) {
                    uploadSegment?.addError(error as Error);
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
                      Key: {
                        imageId: key,
                      },
                      UpdateExpression:
                        'SET #status = :status, thumbnailUrl = :thumbnailUrl, updatedAt = :updatedAt',
                      ExpressionAttributeNames: {
                        '#status': 'status',
                      },
                      ExpressionAttributeValues: {
                        ':status': 'RESIZED',
                        ':thumbnailUrl': thumbnailUrl,
                        ':updatedAt': new Date().toISOString(),
                      },
                    });

                    await docClient.send(updateCommand);
                    logger.info(
                      { imageId: key, status: 'RESIZED' },
                      'Updated job status in DynamoDB'
                    );

                    dbSegment?.addMetadata('status', 'RESIZED');
                    dbSegment?.addMetadata('thumbnailUrl', thumbnailUrl);
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
                    metricSegment?.addAnnotation('operation', 'PutMetricData');
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
                              Value: 'resize-worker',
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
              logger.error({ error }, 'Error processing resize record');

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
                              Value: 'resize-worker',
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
  });
};
