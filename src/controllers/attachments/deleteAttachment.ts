import { Request, Response } from "express";
import AWS from "aws-sdk";
import { Attachment } from "../../models/Attachment";

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

export const deleteAttachment = async (req: Request, res: Response) => {
  const { attachmentId } = req.params;

  try {
    const attachment = await Attachment.findById(attachmentId);

    if (!attachment) {
      return res.status(404).json({ message: "Attachment not found" });
    }

    const fileUrl = attachment.fileUrl;
    const fileKey = fileUrl.split("/").pop();

    await s3
      .deleteObject({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: fileKey!,
      })
      .promise();

    await Attachment.findByIdAndDelete(attachmentId);

    res.status(200).json({ message: "Attachment deleted successfully" });
  } catch (error) {
    console.error("Error deleting attachment:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
