import { S3Event, S3Handler } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import * as AWSXRay from 'aws-xray-sdk';
import pino from 'pino';

const logger = pino();
const snsClient = new SNSClient({ region: 'ca-central-1' });
const dynamoClient = new DynamoDBClient({ region: 'ca-central-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler: S3Handler = async (event: S3Event) => {
  return AWSXRay.captureAsyncFunc('dispatch-tasks-handler', async (segment) => {
    try {
      logger.info({ recordCount: event.Records.length }, 'Received S3 event');

      const snsTopicArn = process.env.SNS_TOPIC_ARN;
      if (!snsTopicArn) {
        const error = new Error(
          'SNS_TOPIC_ARN environment variable is not set'
        );
        segment?.addError(error);
        logger.error('SNS_TOPIC_ARN environment variable is not set');
        throw error;
      }

      segment?.addAnnotation('recordCount', event.Records.length);
      segment?.addAnnotation('snsTopicArn', snsTopicArn);

      for (const record of event.Records) {
        await AWSXRay.captureAsyncFunc(
          'process-s3-record',
          async (recordSegment) => {
            try {
              const bucketName = record.s3.bucket.name;
              const objectKey = decodeURIComponent(
                record.s3.object.key.replace(/\+/g, ' ')
              );

              logger.info(
                { objectKey, bucketName, eventName: record.eventName },
                'Processing S3 object'
              );

              recordSegment?.addAnnotation('objectKey', objectKey);
              recordSegment?.addAnnotation('bucketName', bucketName);
              recordSegment?.addAnnotation('eventName', record.eventName);

              const message = {
                bucket: bucketName,
                key: objectKey,
                eventName: record.eventName,
                eventTime: record.eventTime,
              };

              const messageId = await AWSXRay.captureAsyncFunc(
                'sns-publish',
                async (snsSegment) => {
                  try {
                    snsSegment?.addAnnotation('operation', 'Publish');
                    snsSegment?.addAnnotation('topicArn', snsTopicArn);
                    snsSegment?.addAnnotation('subject', 'Image Upload Event');

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

                    snsSegment?.addMetadata('messageId', result.MessageId);
                    snsSegment?.addMetadata('message', message);

                    return result.MessageId;
                  } catch (error) {
                    snsSegment?.addError(error as Error);
                    throw error;
                  }
                }
              );

              await AWSXRay.captureAsyncFunc(
                'dynamodb-create-job',
                async (dbSegment) => {
                  try {
                    dbSegment?.addAnnotation('operation', 'PutItem');
                    dbSegment?.addAnnotation(
                      'tableName',
                      process.env.DYNAMODB_TABLE_NAME || 'unknown'
                    );
                    dbSegment?.addAnnotation('imageId', objectKey);

                    const putCommand = new PutCommand({
                      TableName: process.env.DYNAMODB_TABLE_NAME,
                      Item: {
                        imageId: objectKey,
                        status: 'PENDING',
                        createdAt: new Date().toISOString(),
                      },
                    });

                    await docClient.send(putCommand);
                    logger.info(
                      { imageId: objectKey },
                      'Created job record in DynamoDB'
                    );

                    dbSegment?.addMetadata('status', 'PENDING');
                    dbSegment?.addMetadata('snsMessageId', messageId);
                  } catch (error) {
                    dbSegment?.addError(error as Error);
                    throw error;
                  }
                }
              );
            } catch (error) {
              recordSegment?.addError(error as Error);
              logger.error(
                {
                  error,
                  objectKey: record.s3.object.key,
                  bucketName: record.s3.bucket.name,
                },
                'Error processing S3 event'
              );
              throw error;
            }
          }
        );
      }
    } catch (error) {
      segment?.addError(error as Error);
      throw error;
    }
  });
};
