import type { SQSHandler } from 'aws-lambda';
import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const rekognitionClient = new RekognitionClient({ region: 'ca-central-1' });
const dynamoClient = new DynamoDBClient({ region: 'ca-central-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler: SQSHandler = async (event) => {
  console.log('Analysis worker received SQS event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(messageBody.Message);

      console.log('Extracted SNS message:', snsMessage);

      const { bucket, key } = snsMessage;
      console.log(`Analyzing image: ${bucket}/${key}`);

      const detectLabelsCommand = new DetectLabelsCommand({
        Image: {
          S3Object: {
            Bucket: bucket,
            Name: key
          }
        },
        MaxLabels: 10,
        MinConfidence: 75
      });

      console.log('Calling Rekognition DetectLabels...');
      const rekognitionResponse = await rekognitionClient.send(detectLabelsCommand);

      const labels = rekognitionResponse.Labels?.map(label => ({
        name: label.Name,
        confidence: label.Confidence
      })) || [];

      console.log(`Detected ${labels.length} labels:`, labels);

      const updateCommand = new UpdateCommand({
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Key: {
          imageId: key
        },
        UpdateExpression: 'SET labels = :labels, analysisStatus = :status, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':labels': labels,
          ':status': 'completed',
          ':updatedAt': new Date().toISOString()
        }
      });

      console.log('Updating DynamoDB with analysis results...');
      await docClient.send(updateCommand);

      console.log(`Successfully updated job for image: ${key}`);
    } catch (error) {
      console.error('Error processing record:', error);
      throw error;
    }
  }
};
