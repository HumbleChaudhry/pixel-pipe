import type { SQSHandler } from 'aws-lambda';

export const handler: SQSHandler = async (event) => {
  console.log(
    'Resize worker received SQS event:',
    JSON.stringify(event, null, 2)
  );

  for (const record of event.Records) {
    // In the SQS message, the real message from SNS is a string inside the 'body'
    const messageBody = JSON.parse(record.body);
    const snsMessage = JSON.parse(messageBody.Message);

    console.log('Extracted SNS message:', snsMessage);

    const { bucket, key } = snsMessage;
    console.log(`Ready to process image: ${bucket}/${key}`);
  }
};
