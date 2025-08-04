import { S3Event, S3Handler } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({ region: process.env.AWS_REGION });

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
    } catch (error) {
      console.error('Error publishing to SNS:', error);
      throw error;
    }
  }
};
