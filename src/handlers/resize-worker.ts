import type { SQSHandler } from 'aws-lambda';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Readable } from 'stream';
import sharp from 'sharp';
import pino from 'pino';

const logger = pino();
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
  logger.info({ recordCount: event.Records.length }, 'Resize worker received SQS event');

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(messageBody.Message);

      logger.info({ snsMessage }, 'Extracted SNS message');

      const { bucket, key } = snsMessage;
      logger.info({ bucket, key }, 'Processing image resize');

      logger.info({ bucket, key }, 'Downloading image from S3');

      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await s3Client.send(getObjectCommand);

      if (!response.Body) {
        logger.error({ key }, 'No body returned for S3 object');
        throw new Error(`No body returned for object ${key}`);
      }

      const imageBuffer = await streamToBuffer(response.Body as Readable);

      logger.info({ 
        key, 
        imageSize: imageBuffer.length, 
        contentType: response.ContentType 
      }, 'Successfully downloaded image');

      const thumbnailBuffer = await sharp(imageBuffer)
        .resize(200, 200)
        .jpeg()
        .toBuffer();

      logger.info({ key, thumbnailSize: thumbnailBuffer.length }, 'Created thumbnail');

      const thumbnailKey = `thumbnails/${key}`;

      const putObjectCommand = new PutObjectCommand({
        Bucket: process.env.PROCESSED_BUCKET_NAME,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
      });

      await s3Client.send(putObjectCommand);

      logger.info({ 
        bucket: process.env.PROCESSED_BUCKET_NAME, 
        thumbnailKey 
      }, 'Uploaded thumbnail to S3');

      const thumbnailUrl = `s3://${process.env.PROCESSED_BUCKET_NAME}/${thumbnailKey}`;

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
      logger.info({ imageId: key, status: 'RESIZED' }, 'Updated job status in DynamoDB');
    } catch (error) {
      logger.error({ error }, 'Error processing resize record');
      throw error;
    }
  }
};
