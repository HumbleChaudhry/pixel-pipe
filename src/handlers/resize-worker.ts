import type { SQSHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

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
    } catch (error) {
      console.error(`Error processing record:`, error);
      throw error;
    }
  }
};
