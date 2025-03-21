import AWS from "aws-sdk";
import { IAttachment } from "../models/Attachment";
import { MulterFile } from "../types/multer";
import { Course } from "../models/Course";

// Configure AWS
AWS.config.update({
  region: process.env.AWS_REGION || "us-east-1",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const s3 = new AWS.S3();

// Allowed file types and their MIME types
const ALLOWED_FILE_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
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

  async uploadFile(
    file: MulterFile,
    courseCode: string,
    professorUsername: string
  ): Promise<any> {
    // Validate file type and size
    this.validateFileType(file.mimetype);
    this.validateFileSize(file.size);

    // Sanitize file name and create key
    const sanitizedFileName = this.sanitizeFileName(file.originalname);
    // Structure: professor/courseCode/filename
    const fileKey = `${professorUsername}/${courseCode}/${sanitizedFileName}`;
    // const fileKey = `${professorUsername}/${courseCode}/${Date.now()}-${sanitizedFileName}`;

    const uploadParams = {
      Bucket: this.bucket,
      Key: fileKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: "max-age=31536000",
    };

    try {
      const uploadResult = await s3.upload(uploadParams).promise();

      return uploadResult.Location;
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
      await s3.deleteObject(deleteParams).promise();
    } catch (error) {
      console.error("Error deleting file from S3:", error);
      throw new Error("Failed to delete file");
    }
  }

  // async uploadFiles(
  //   files: Express.Multer.File[],
  //   courseCode: string,
  //   professorUsername: string
  // ): Promise<any[]> {
  //   const uploadedFiles: FileAttachment[] = [];
  //   const errors: { fileName: string; error: string }[] = [];

  //   // Find the course by courseCode
  //   const course = await Course.findOne({ courseCode });
  //   if (!course) {
  //     throw new Error("Course not found");
  //   }

  //   // Upload each file
  //   for (const file of files) {
  //     try {
  //       const fileAttachment = await this.uploadFile(
  //         file,
  //         courseCode,
  //         professorUsername
  //       );
  //       uploadedFiles.push(fileAttachment);
  //       course.attachments.push(fileAttachment);
  //     } catch (error: any) {
  //       errors.push({
  //         fileName: file.originalname,
  //         error: error.message,
  //       });
  //     }
  //   }

  //   // Save course if any files were uploaded successfully
  //   if (uploadedFiles.length > 0) {
  //     await course.save();
  //   }

  //   if (errors.length > 0) {
  //     // If there were any errors, throw them along with successful uploads
  //     throw {
  //       success: {
  //         count: uploadedFiles.length,
  //         files: uploadedFiles,
  //       },
  //       errors,
  //     };
  //   }

  //   return uploadedFiles;
  // }
}

// Export a singleton instance
export const fileUploadService = new FileUploadService();
