import type { SQSHandler } from 'aws-lambda';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import sharp from 'sharp';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export const handler: SQSHandler = async (event) => {
  console.log(
    'Resize worker received SQS event:',
    JSON.stringify(event, null, 2)
  );

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(messageBody.Message);

      console.log('Extracted SNS message:', snsMessage);

      const { bucket, key } = snsMessage;
      console.log(`Processing image: ${bucket}/${key}`);

      console.log(`Downloading image from S3: s3://${bucket}/${key}`);

      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await s3Client.send(getObjectCommand);

      if (!response.Body) {
        throw new Error(`No body returned for object ${key}`);
      }

      const imageBuffer = await streamToBuffer(response.Body as Readable);

      console.log(`Successfully downloaded image: ${key}`);
      console.log(`Image size: ${imageBuffer.length} bytes`);
      console.log(`Content type: ${response.ContentType}`);

      const thumbnailBuffer = await sharp(imageBuffer)
        .resize(200, 200)
        .jpeg()
        .toBuffer();

      console.log(`Created thumbnail: ${thumbnailBuffer.length} bytes`);

      const thumbnailKey = `thumbnails/${key}`;

      const putObjectCommand = new PutObjectCommand({
        Bucket: process.env.PROCESSED_BUCKET_NAME,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
      });

      await s3Client.send(putObjectCommand);

      console.log(
        `Uploaded thumbnail to s3://${process.env.PROCESSED_BUCKET_NAME}/${thumbnailKey}`
      );
    } catch (error) {
      console.error(`Error processing record:`, error);
      throw error;
    }
  }
};
