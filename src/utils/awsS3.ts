import AWS from "aws-sdk";

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

// Function to upload a file to S3
export const uploadFileToS3 = async (
  file: Express.Multer.File,
  bucketName: string
): Promise<string> => {
  const params = {
    Bucket: bucketName,
    Key: `${Date.now()}_${file.originalname}`,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  const uploadResult = await s3.upload(params).promise();
  return uploadResult.Location;
};
