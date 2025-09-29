import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import * as AWSXRay from 'aws-xray-sdk';
import pino from 'pino';

const logger = pino();
const s3Client = new S3Client({ region: 'ca-central-1' });

const UPLOADS_BUCKET_NAME = process.env.UPLOADS_BUCKET_NAME!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return AWSXRay.captureAsyncFunc('get-upload-url-handler', async (segment) => {
    try {
      const requestId = event.requestContext?.requestId || 'unknown';
      const httpMethod = event.requestContext?.http?.method || 'unknown';
      logger.info({ requestId, httpMethod }, 'Processing upload URL request');

      segment?.addAnnotation('requestId', requestId);
      segment?.addAnnotation('httpMethod', httpMethod);
      segment?.addAnnotation('bucket', UPLOADS_BUCKET_NAME);

      const key = `${randomUUID()}.jpeg`;
      segment?.addAnnotation('generatedKey', key);

      const url = await AWSXRay.captureAsyncFunc(
        's3-presigned-url',
        async (s3Segment) => {
          try {
            s3Segment?.addAnnotation('operation', 'getSignedUrl');
            s3Segment?.addAnnotation('bucket', UPLOADS_BUCKET_NAME);
            s3Segment?.addAnnotation('key', key);
            s3Segment?.addAnnotation('expiresIn', 3600);

            const command = new PutObjectCommand({
              Bucket: UPLOADS_BUCKET_NAME,
              Key: key,
              ContentType: 'image/jpeg',
            });

            logger.info(
              { key, bucket: UPLOADS_BUCKET_NAME },
              'Generating presigned URL'
            );

            const signedUrl = await getSignedUrl(s3Client, command, {
              expiresIn: 3600,
            });

            logger.info(
              { key, requestId },
              'Successfully generated presigned URL'
            );

            s3Segment?.addMetadata('signedUrl', signedUrl);
            s3Segment?.addMetadata('contentType', 'image/jpeg');

            return signedUrl;
          } catch (error) {
            s3Segment?.addError(error as Error);
            throw error;
          }
        }
      );

      const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin':
            'https://d14jet1tdw9j3h.cloudfront.net',
          'Access-Control-Allow-Headers':
            'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          uploadURL: url,
          key: key,
        }),
      };

      segment?.addMetadata('response', {
        statusCode: response.statusCode,
        key: key,
        urlGenerated: true,
      });

      return response;
    } catch (error) {
      segment?.addError(error as Error);
      logger.error({ error }, 'Error generating upload URL');

      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin':
            'https://d14jet1tdw9j3h.cloudfront.net',
          'Access-Control-Allow-Headers':
            'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
        },
        body: JSON.stringify({
          error: 'Failed to generate upload URL',
        }),
      };
    }
  });
};
