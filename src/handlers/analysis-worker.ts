import type { SQSHandler } from 'aws-lambda';
import {
  RekognitionClient,
  DetectLabelsCommand,
} from '@aws-sdk/client-rekognition';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Readable } from 'stream';
import pino from 'pino';

const logger = pino();
const rekognitionClient = new RekognitionClient({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'ca-central-1' });
const dynamoClient = new DynamoDBClient({ region: 'ca-central-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

      const putCommand = new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Item: {
          imageId: key,
          labels: labels,
          analysisStatus: 'completed',
          status: 'PROCESSING',
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      });

      logger.info({ imageId: key }, 'Saving analysis results to DynamoDB');
      await docClient.send(putCommand);

      logger.info(
        { imageId: key, status: 'PROCESSING', analysisStatus: 'completed' },
        'Successfully updated job'
      );
    } catch (error) {
      logger.error({ error }, 'Error processing analysis record');
      throw error;
    }
  }
};
