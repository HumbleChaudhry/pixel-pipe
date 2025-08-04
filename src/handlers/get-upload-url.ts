import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const s3Client = new S3Client({ region: 'ca-central-1' });

const UPLOADS_BUCKET_NAME = process.env.UPLOADS_BUCKET_NAME!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log('Event: ', event);

  const key = `${randomUUID()}.jpeg`;

  const command = new PutObjectCommand({
    Bucket: UPLOADS_BUCKET_NAME,
    Key: key,
    ContentType: 'image/jpeg',
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      uploadURL: url,
      key: key,
    }),
  };
};
