import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import pino from 'pino';

const logger = pino();
const s3Client = new S3Client({ region: 'ca-central-1' });

const UPLOADS_BUCKET_NAME = process.env.UPLOADS_BUCKET_NAME!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = event.requestContext?.requestId || 'unknown';
  const httpMethod = event.requestContext?.http?.method || 'unknown';
  logger.info(
    { requestId, httpMethod },
    'Processing upload URL request'
  );

  const key = `${randomUUID()}.jpeg`;

  const command = new PutObjectCommand({
    Bucket: UPLOADS_BUCKET_NAME,
    Key: key,
    ContentType: 'image/jpeg',
  });

  logger.info({ key, bucket: UPLOADS_BUCKET_NAME }, 'Generating presigned URL');

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  logger.info({ key, requestId }, 'Successfully generated presigned URL');

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': 'https://d14jet1tdw9j3h.cloudfront.net',
      'Access-Control-Allow-Headers':
        'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
    },
    body: JSON.stringify({
      uploadURL: url,
      key: key,
    }),
  };
};
