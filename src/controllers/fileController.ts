import { Request, Response } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { fileUploadService } from "../services/fileUploadService";
import { Course } from "../models/Course";
import { FileAttachment } from "../models/Course";

export interface FileUploadParams extends ParamsDictionary {
  courseCode: string;
}

export interface FileDeleteParams extends ParamsDictionary {
  courseCode: string;
  fileUrl: string;
}

// Extend the Request type to include user
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    username: string;
  };
}

export class FileController {
  async uploadFiles(req: AuthenticatedRequest, res: Response) {
    try {
      const { courseCode } = req.params;

      console.log(req.user);
      if (!req.user?.username) {
        return res
          .status(401)
          .json({ message: "Unauthorized: User not found" });
      }

      const professorUsername = req.user.username;
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const uploadedFiles = await fileUploadService.uploadFiles(
        files,
        courseCode,
        professorUsername
      );
      return res.status(200).json(uploadedFiles);
    } catch (error) {
      console.error("Error uploading files:", error);
      return res.status(500).json({ message: "Error uploading files" });
    }
  }

  async deleteFile(req: AuthenticatedRequest, res: Response) {
    try {
      const { courseCode, fileUrl } = req.params;

      // Find the course
      const course = await Course.findOne({ courseCode: courseCode });
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      // Delete file from S3
      await fileUploadService.deleteFile(fileUrl);

      // Remove file attachment from course
      course.attachments = course.attachments.filter(
        (attachment) => attachment.fileUrl !== fileUrl
      );
      await course.save();

      res.status(200).json({ message: "File deleted successfully" });
    } catch (error) {
      console.error("Error in deleteFile:", error);
      res.status(500).json({ message: "Error deleting file" });
    }
  }
}

export const fileController = new FileController();
