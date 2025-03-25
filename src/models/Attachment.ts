import { Schema, model, Document, CallbackError } from "mongoose";
import { Course } from "./Course";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Configure S3 client
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  throw new Error("AWS credentials are not provided in environment variables");
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Allowed MIME types (should match FileUploadService)
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export interface IAttachment extends Document {
  fileName: string;
  fileUrl: string; // URL to the file in S3
  fileType: string;
  fileSize: number;
  courseId: Schema.Types.ObjectId; // Reference to the Course
  assignmentId: Schema.Types.ObjectId; // Reference to the Assignment
  faissIndexUrl: string; // URL to the FAISS index file in S3
  chunksFileUrl: string; // URL to the JSON chunks file in S3
  uploadedAt: Date;
}

const attachmentSchema = new Schema<IAttachment>(
  {
    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: {
      type: String,
      required: true,
      enum: ALLOWED_MIME_TYPES,
    },
    fileSize: { type: Number, required: true, min: 0 },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    assignmentId: {
      type: Schema.Types.ObjectId,
      ref: "Assignment",
      required: true,
    },
    faissIndexUrl: { type: String, default: "" },
    chunksFileUrl: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// Add indexes after schema creation
attachmentSchema.index({ courseId: 1 });
attachmentSchema.index({ assignmentId: 1 });
attachmentSchema.index(
  { fileName: 1, courseId: 1, assignmentId: 1 },
  { unique: true }
);

// Retry function for S3 operations
const retry = async (
  fn: () => Promise<any>,
  retries: number = 3,
  delay: number = 1000
) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Retry ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

// Pre middleware to handle S3 cleanup before deletion
attachmentSchema.pre("findOneAndDelete", async function (next) {
  try {
    const doc = await this.model.findOne(this.getQuery());
    if (doc) {
      const bucket = process.env.AWS_S3_BUCKET;
      if (!bucket) {
        throw new Error("AWS_S3_BUCKET environment variable is not set");
      }

      // Validate S3 URLs
      const isValidS3Url = (url: string) =>
        url && url.startsWith(`https://${bucket}.s3.amazonaws.com/`);

      // Delete the main file from S3
      if (!isValidS3Url(doc.fileUrl)) {
        throw new Error(`Invalid S3 URL for file: ${doc.fileUrl}`);
      }
      const fileKey = doc.fileUrl.split(".com/")[1];
      const deleteFileParams = {
        Bucket: bucket,
        Key: fileKey,
      };
      await retry(async () => {
        const deleteFileCommand = new DeleteObjectCommand(deleteFileParams);
        await s3Client.send(deleteFileCommand);
      });
      console.log(`Deleted file from S3: ${doc.fileUrl}`);

      // Delete the JSON chunks file from S3 (if it exists)
      if (doc.chunksFileUrl) {
        if (!isValidS3Url(doc.chunksFileUrl)) {
          throw new Error(
            `Invalid S3 URL for chunks file: ${doc.chunksFileUrl}`
          );
        }
        const chunksFileKey = doc.chunksFileUrl.split(".com/")[1];
        const deleteChunksParams = {
          Bucket: bucket,
          Key: chunksFileKey,
        };
        await retry(async () => {
          const deleteChunksCommand = new DeleteObjectCommand(
            deleteChunksParams
          );
          await s3Client.send(deleteChunksCommand);
        });
        console.log(`Deleted chunks file from S3: ${doc.chunksFileUrl}`);
      }

      // Delete the FAISS index file from S3 (if it exists)
      if (doc.faissIndexUrl) {
        if (!isValidS3Url(doc.faissIndexUrl)) {
          throw new Error(
            `Invalid S3 URL for FAISS index: ${doc.faissIndexUrl}`
          );
        }
        const faissFileKey = doc.faissIndexUrl.split(".com/")[1];
        const deleteFaissParams = {
          Bucket: bucket,
          Key: faissFileKey,
        };
        await retry(async () => {
          const deleteFaissCommand = new DeleteObjectCommand(deleteFaissParams);
          await s3Client.send(deleteFaissCommand);
        });
        console.log(`Deleted FAISS index file from S3: ${doc.faissIndexUrl}`);
      }
    }
    next();
  } catch (error) {
    console.error(
      "Error in pre-findOneAndDelete middleware for Attachment:",
      error
    );
    next(error as CallbackError);
  }
});

// Post middleware to add attachmentId to Course on save
attachmentSchema.post("save", async function (doc: IAttachment) {
  try {
    const courseId = doc.courseId;
    const attachmentId = doc._id;

    const updatedCourse = await Course.findByIdAndUpdate(
      courseId,
      {
        $push: { attachments: attachmentId },
      },
      { new: true }
    );

    if (!updatedCourse) {
      throw new Error(`Course with ID ${courseId} not found`);
    }
  } catch (error) {
    console.error("Error in post-save middleware for Attachment:", error);
    throw error;
  }
});

// Post middleware to remove attachmentId from Course on delete
attachmentSchema.post(
  "findOneAndDelete",
  async function (doc: IAttachment | null) {
    if (doc) {
      try {
        const courseId = doc.courseId;
        const attachmentId = doc._id;

        const updatedCourse = await Course.findByIdAndUpdate(
          courseId,
          {
            $pull: { attachments: attachmentId },
          },
          { new: true }
        );

        if (!updatedCourse) {
          throw new Error(`Course with ID ${courseId} not found`);
        }
      } catch (error) {
        console.error(
          "Error in post-findOneAndDelete middleware for Attachment:",
          error
        );
        throw error;
      }
    }
  }
);

export const Attachment = model<IAttachment>("Attachment", attachmentSchema);
