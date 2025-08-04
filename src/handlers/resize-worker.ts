import type { SQSHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

/**
 * Converts a ReadableStream to a Buffer
 * This is crucial because S3 returns a stream, but we need a buffer for image processing
 */
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
      // Step 1: Parse the nested message structure (SQS -> SNS -> our data)
      const messageBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(messageBody.Message);

      console.log('Extracted SNS message:', snsMessage);

      const { bucket, key } = snsMessage;
      console.log(`Processing image: ${bucket}/${key}`);

      // Step 2: Download the image from S3
      console.log(`Downloading image from S3: s3://${bucket}/${key}`);

      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await s3Client.send(getObjectCommand);

      // Step 3: Convert the S3 stream to a Buffer
      if (!response.Body) {
        throw new Error(`No body returned for object ${key}`);
      }

      // The Body can be a ReadableStream, so we need to handle it properly
      const imageBuffer = await streamToBuffer(response.Body as Readable);

      console.log(`Successfully downloaded image: ${key}`);
      console.log(`Image size: ${imageBuffer.length} bytes`);
      console.log(`Content type: ${response.ContentType}`);

      // TODO: Add image processing logic here
      // For now, we're just successfully downloading and logging
    } catch (error) {
      console.error(`Error processing record:`, error);
      throw error; // Re-throw to trigger SQS retry
    }
  }
};
