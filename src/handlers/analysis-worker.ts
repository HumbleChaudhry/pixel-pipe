import type { SQSHandler } from 'aws-lambda';
import {
  RekognitionClient,
  DetectLabelsCommand,
} from '@aws-sdk/client-rekognition';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Readable } from 'stream';

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
  console.log(
    'Analysis worker received SQS event:',
    JSON.stringify(event, null, 2)
  );

  if (!event.Records || !Array.isArray(event.Records)) {
    console.error('No Records found in event or Records is not an array');
    return;
  }

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(messageBody.Message);

      console.log('Extracted SNS message:', snsMessage);

      const { bucket, key } = snsMessage;
      console.log(`Analyzing image: ${bucket}/${key}`);

      console.log(`Downloading image from S3: s3://${bucket}/${key}`);
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const s3Response = await s3Client.send(getObjectCommand);
      if (!s3Response.Body) {
        throw new Error(`No body returned for object ${key}`);
      }

      const imageBuffer = await streamToBuffer(s3Response.Body as Readable);
      console.log(
        `Successfully downloaded image: ${key}, size: ${imageBuffer.length} bytes`
      );

      const detectLabelsCommand = new DetectLabelsCommand({
        Image: {
          Bytes: imageBuffer,
        },
        MaxLabels: 10,
        MinConfidence: 75,
      });

      console.log('Calling Rekognition DetectLabels...');
      const rekognitionResponse = await rekognitionClient.send(
        detectLabelsCommand
      );

      const labels =
        rekognitionResponse.Labels?.map((label) => ({
          name: label.Name,
          confidence: label.Confidence,
        })) || [];

      console.log(`Detected ${labels.length} labels:`, labels);

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

      console.log('Saving analysis results to DynamoDB...');
      await docClient.send(putCommand);

      console.log(`Successfully updated job for image: ${key}`);
    } catch (error) {
      console.error('Error processing record:', error);
      throw error;
    }
  }
};
