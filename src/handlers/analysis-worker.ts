import type { SQSHandler } from 'aws-lambda';

export const handler: SQSHandler = async (event) => {
  console.log(
    'Analysis worker received SQS event:',
    JSON.stringify(event, null, 2)
  );

  for (const record of event.Records) {
    console.log('Processing record:', record.body);
  }
};
