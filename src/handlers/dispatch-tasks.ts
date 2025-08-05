import { S3Event, S3Handler } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const snsClient = new SNSClient({ region: 'ca-central-1' });
const dynamoClient = new DynamoDBClient({ region: 'ca-central-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler: S3Handler = async (event: S3Event) => {
  console.log('Received S3 event:', JSON.stringify(event, null, 2));

  const snsTopicArn = process.env.SNS_TOPIC_ARN;
  if (!snsTopicArn) {
    throw new Error('SNS_TOPIC_ARN environment variable is not set');
  }

  for (const record of event.Records) {
    const bucketName = record.s3.bucket.name;
    const objectKey = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, ' ')
    );

    console.log(`Processing object: ${objectKey} from bucket: ${bucketName}`);

    const message = {
      bucket: bucketName,
      key: objectKey,
      eventName: record.eventName,
      eventTime: record.eventTime,
    };

    try {
      const command = new PublishCommand({
        TopicArn: snsTopicArn,
        Message: JSON.stringify(message),
        Subject: 'Image Upload Event',
      });

      const result = await snsClient.send(command);
      console.log(`Message published to SNS: ${result.MessageId}`);

      const putCommand = new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Item: {
          imageId: objectKey,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      });

      await docClient.send(putCommand);
      console.log(`Created job record for image: ${objectKey}`);
    } catch (error) {
      console.error('Error processing S3 event:', error);
      throw error;
    }
  }
};
