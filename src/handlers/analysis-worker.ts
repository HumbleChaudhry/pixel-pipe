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
  logger.info(
    { recordCount: event.Records?.length || 0 },
    'Analysis worker received SQS event'
  );

  if (!event.Records || !Array.isArray(event.Records)) {
    logger.error('No Records found in event or Records is not an array');
    return;
  }

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(messageBody.Message);

      logger.info({ snsMessage }, 'Extracted SNS message');

      const { bucket, key } = snsMessage;
      logger.info({ bucket, key }, 'Analyzing image');

      logger.info({ bucket, key }, 'Downloading image from S3');
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const s3Response = await s3Client.send(getObjectCommand);
      if (!s3Response.Body) {
        logger.error({ key }, 'No body returned for S3 object');
        throw new Error(`No body returned for object ${key}`);
      }

      const imageBuffer = await streamToBuffer(s3Response.Body as Readable);
      logger.info(
        { key, imageSize: imageBuffer.length },
        'Successfully downloaded image'
      );

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

      const labels =
        rekognitionResponse.Labels?.map((label) => ({
          name: label.Name,
          confidence: label.Confidence,
        })) || [];

      logger.info(
        { key, labelCount: labels.length, labels },
        'Detected labels from Rekognition'
      );

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

      logger.info({ imageId: key }, 'Updating analysis results in DynamoDB');
      await docClient.send(updateCommand);

      logger.info(
        { imageId: key, status: 'COMPLETED', analysisStatus: 'completed' },
        'Successfully updated job'
      );

      // Emit success metric to CloudWatch
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
      logger.info({ imageId: key }, 'Emitted success metric to CloudWatch');
    } catch (error) {
      logger.error({ error }, 'Error processing analysis record');

      // Emit failure metric to CloudWatch
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

      try {
        await cloudWatchClient.send(failureMetricCommand);
        logger.info('Emitted failure metric to CloudWatch');
      } catch (metricError) {
        logger.error({ metricError }, 'Failed to emit failure metric');
      }

      throw error;
    }
  }
};
