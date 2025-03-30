import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Attachment, IAttachment } from "../models/Attachment";
import { Assignment } from "../models/Assignment";
import { MulterFile } from "../types/multer";

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

// Allowed file types and their MIME types
const ALLOWED_FILE_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv",
};

// Maximum file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export class FileUploadService {
  private bucket: string;

  constructor() {
    this.bucket = process.env.AWS_S3_BUCKET || "essaybotbucket";
  }

  private validateFileType(mimetype: string): void {
    if (!Object.keys(ALLOWED_FILE_TYPES).includes(mimetype)) {
      throw new Error(
        `Invalid file type. Only ${Object.values(ALLOWED_FILE_TYPES).join(
          ", "
        )} files are allowed.`
      );
    }
  }

  private validateFileSize(size: number): void {
    if (size > MAX_FILE_SIZE) {
      throw new Error(
        `File size exceeds limit. Maximum file size allowed is ${
          MAX_FILE_SIZE / (1024 * 1024)
        }MB`
      );
    }
  }

  private sanitizeFileName(fileName: string): string {
    // Remove special characters and spaces, keep extension
    const extension = fileName.slice(fileName.lastIndexOf("."));
    const name = fileName.slice(0, fileName.lastIndexOf("."));
    const sanitized = name.replace(/[^a-zA-Z0-9]/g, "-");
    return `${sanitized}${extension}`;
  }

  // Check if a file with the same key already exists in S3
  private async checkFileExistsInS3(fileKey: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
      });
      await s3Client.send(command);
      return true; // File exists
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        return false; // File does not exist
      }
      throw new Error("Error checking file existence in S3");
    }
  }

  // Check if an attachment with the same fileName, courseId, and assignmentId already exists in MongoDB
  private async checkAttachmentExists(
    fileName: string,
    courseId: string,
    assignmentId: string
  ): Promise<IAttachment | null> {
    return await Attachment.findOne({
      fileName,
      courseId,
      assignmentId,
    });
  }

  async uploadFile(
    file: MulterFile,
    courseId: string,
    assignmentId: string,
    professorUsername: string,
    overwrite: boolean = false
  ): Promise<string> {
    // Validate file type and size
    this.validateFileType(file.mimetype);
    this.validateFileSize(file.size);

    // Fetch the assignment to get the assignmentTitle for the S3 key
    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      throw new Error("Assignment not found");
    }
    const assignmentTitle = assignment.title;

    // Sanitize file name and create key
    const sanitizedFileName = this.sanitizeFileName(file.originalname);
    const fileKey = `${professorUsername}/${courseId}/${assignmentTitle}/${sanitizedFileName}`;

    // Check if an attachment already exists in MongoDB
    const existingAttachment = await this.checkAttachmentExists(
      file.originalname,
      courseId,
      assignmentId
    );

    if (existingAttachment && !overwrite) {
      throw new Error(
        `File '${file.originalname}' already exists for this course and assignment.`
      );
    }

    // Double-check S3 for consistency
    const fileExistsInS3 = await this.checkFileExistsInS3(fileKey);
    if (fileExistsInS3 && !overwrite) {
      throw new Error(
        `File '${file.originalname}' already exists in S3 for this course and assignment.`
      );
    }

    const uploadParams = {
      Bucket: this.bucket,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: "max-age=31536000",
    };

    try {
      const command = new PutObjectCommand(uploadParams);
      const uploadResult = await s3Client.send(command);
      // Construct the file URL manually since PutObjectCommand doesn't return it
      const fileUrl = `https://${this.bucket}.s3.amazonaws.com/${fileKey}`;
      return fileUrl;
    } catch (error) {
      console.error("Error uploading file to S3:", error);
      throw new Error("Failed to upload file");
    }
  }

  async deleteFile(fileUrl: string): Promise<void> {
    // Extract key from public URL
    const key = fileUrl.split(".com/")[1];

    const deleteParams = {
      Bucket: this.bucket,
      Key: key,
    };

    try {
      const command = new DeleteObjectCommand(deleteParams);
      await s3Client.send(command);
    } catch (error) {
      console.error("Error deleting file from S3:", error);
      throw new Error("Failed to delete file");
    }
  }
}

// Export a singleton instance
export const fileUploadService = new FileUploadService();
