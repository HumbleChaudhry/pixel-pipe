import { S3Event, S3Handler } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import * as AWSXRay from 'aws-xray-sdk';
import pino from 'pino';

const logger = pino();
// Wrap the clients with the X-Ray SDK
const snsClient = AWSXRay.captureAWSv3Client(
  new SNSClient({ region: 'ca-central-1' })
);
const dynamoClient = AWSXRay.captureAWSv3Client(
  new DynamoDBClient({ region: 'ca-central-1' })
);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler: S3Handler = async (event: S3Event) => {
  logger.info({ recordCount: event.Records.length }, 'Received S3 event');

  const snsTopicArn = process.env.SNS_TOPIC_ARN;
  if (!snsTopicArn) {
    logger.error('SNS_TOPIC_ARN environment variable is not set');
    throw new Error('SNS_TOPIC_ARN environment variable is not set');
  }

  for (const record of event.Records) {
    const bucketName = record.s3.bucket.name;
    const objectKey = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, ' ')
    );

    logger.info(
      { objectKey, bucketName, eventName: record.eventName },
      'Processing S3 object'
    );

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
      logger.info(
        { messageId: result.MessageId, objectKey },
        'Published message to SNS'
      );

      const putCommand = new PutCommand({
        TableName: process.env.DYNAMODB_TABLE_NAME,
        Item: {
          imageId: objectKey,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      });

      await docClient.send(putCommand);
      logger.info({ imageId: objectKey }, 'Created job record in DynamoDB');
    } catch (error) {
      logger.error(
        { error, objectKey, bucketName },
        'Error processing S3 event'
      );
      throw error;
    }
  }
};
