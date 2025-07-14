import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'; // Import types!

const s3Client = new S3Client({ region: 'ca-central-1' });
// This will throw an error if the ENV VAR is not set, which is good!
const UPLOADS_BUCKET_NAME = process.env.UPLOADS_BUCKET_NAME!;

// Use the official AWS Lambda type for our handler
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log('Event: ', event);

  // Generate a unique key for the image
  const key = `${randomUUID()}.jpeg`;

  const command = new PutObjectCommand({
    Bucket: UPLOADS_BUCKET_NAME,
    Key: key,
    ContentType: 'image/jpeg', // We can get this from the client later
  });

  // Generate the presigned URL
  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL expires in 1 hour

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*', // Be more specific in production!
    },
    body: JSON.stringify({
      uploadURL: url,
      key: key,
    }),
  };
};
