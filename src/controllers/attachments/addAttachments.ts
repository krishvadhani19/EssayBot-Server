import { Request, Response, NextFunction } from "express";
import multer from "multer";
import axios from "axios";
import { Course } from "../../models/Course";
import { Assignment } from "../../models/Assignment";
import { Attachment } from "../../models/Attachment";
import { fileUploadService } from "../../utils/awsS3";

// Extend the Request type to include user
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    username: string;
  };
}

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log(`Uploading file: ${file.originalname}, type: ${file.mimetype}`);
    const allowedMimeTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, false);
    }
    cb(null, true);
  },
}).array("files", 10);

// Retry function for RAG indexing
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

export const addAttachments = [
  (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("Multer error:", err);
        return res
          .status(400)
          .json({ message: "File upload error", error: err.message });
      } else if (err) {
        console.error("Unknown file upload error:", err);
        return res
          .status(400)
          .json({ message: "Invalid file upload", error: err.message });
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    console.log("Received Request Body:", req.body);
    console.log("Received Files:", req.files);

    const { courseId, assignmentId } = req.body;
    const username = req.user.username;
    const files = req.files as Express.Multer.File[];

    if (!courseId || !assignmentId) {
      return res
        .status(400)
        .json({ message: "Missing required fields: courseId, assignmentId" });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    try {
      // Check if the course exists
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      // Check if the assignment exists and belongs to the course
      const assignment = await Assignment.findById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }
      if (!course.assignments.includes(assignmentId)) {
        return res
          .status(400)
          .json({ message: "Assignment does not belong to this course" });
      }

      // Array to store the saved attachments
      const savedAttachments = [];
      const errors = [];

      // Process each file
      for (const file of files) {
        console.log(`Processing file: ${file.originalname}`);

        try {
          // Upload the file to S3 (do not overwrite by default)
          const fileUrl = await fileUploadService.uploadFile(
            file,
            courseId,
            assignmentId,
            req.user.username,
            false
          );

          console.log(`File uploaded to S3: ${fileUrl}`);

          // Extract the S3 key from the file URL
          const s3FileKey = fileUrl.split(".com/")[1];
          if (!s3FileKey) {
            throw new Error("Failed to extract S3 key from file URL");
          }

          // Call the Python RAG service to index the uploaded file with retry logic
          let faissIndexUrl = "";
          let chunksFileUrl = "";
          try {
            const response = await retry(async () => {
              const res: any = await axios.post("http://localhost:6000/index", {
                username,
                s3_file_key: s3FileKey,
                courseId,
                assignmentTitle: assignment.title,
              });

              // Validate response data
              if (
                !res.data ||
                !res.data.faiss_index_url ||
                !res.data.chunks_key
              ) {
                throw new Error("Invalid response from RAG service");
              }

              return res;
            });
            faissIndexUrl = response.data.faiss_index_url;
            chunksFileUrl = response.data.chunks_key;
            console.log(`Indexed file successfully: ${faissIndexUrl}`);
          } catch (indexError: any) {
            console.error("Error indexing file after retries:", indexError);
            // Delete the uploaded file from S3 if indexing fails
            await fileUploadService.deleteFile(fileUrl);
            throw new Error(
              `Failed to index file in RAG service: ${indexError.message}`
            );
          }

          // Create a new attachment with metadata, including the index URL
          const newAttachment = new Attachment({
            fileName: file.originalname,
            fileUrl,
            fileType: file.mimetype,
            fileSize: file.size,
            courseId,
            assignmentId,
            faissIndexUrl,
            chunksFileUrl,
          });

          // Save the attachment to the database
          const savedAttachment = await newAttachment.save();
          savedAttachments.push(savedAttachment);
        } catch (error: any) {
          console.error(`Error processing file ${file.originalname}:`, error);
          errors.push({
            fileName: file.originalname,
            error: error.message,
          });
        }
      }

      // If there were errors, return them along with any successful uploads
      if (errors.length > 0) {
        return res.status(207).json({
          message: "Some files failed to upload",
          success: savedAttachments,
          errors,
        });
      }

      // Respond with the created attachments
      res.status(201).json(savedAttachments);
    } catch (error: any) {
      console.error("Error adding attachments:", error);
      res.status(500).json({
        message: "Internal server error",
        error: error.message,
      });
    }
  },
];
