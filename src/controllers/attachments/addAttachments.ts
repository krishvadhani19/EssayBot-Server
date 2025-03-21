import { Request, Response } from "express";
import multer from "multer";
import axios from "axios";
import { Course } from "../../models/Course";
import { fileUploadService } from "../../utils/awsS3";
import { Attachment } from "../../models/Attachment";

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
    cb(null, true); // Accept all files (server validation can be handled separately)
  },
}).array("files", 10);

export const addAttachments = [
  (req: Request, res: Response, next: Function) => {
    upload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("Multer error:", err);
        return res
          .status(400)
          .json({ message: "File upload error", error: err.message });
      } else if (err) {
        console.error("Unknown file upload error:", err);
        return res
          .status(500)
          .json({ message: "Unknown upload error", error: err.message });
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res: Response) => {
    console.log("Received Request Body:", req.body);
    console.log("Received Files:", req.files);

    const { courseId } = req.body;
    const username = req.user.username;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    try {
      // Check if the course exists
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      // Array to store the saved attachments
      const savedAttachments = [];

      // Process each file
      for (const file of files) {
        console.log(`Processing file: ${file.originalname}`);

        // Upload the file to S3
        const fileUrl = await fileUploadService.uploadFile(
          file,
          courseId,
          req.user.username
        );

        console.log(`File uploaded to S3: ${fileUrl}`);

        // Extract the S3 key from the file URL
        const s3FileKey = fileUrl.split(".com/")[1];

        // Call the Python RAG service to index the uploaded file
        let faissIndexUrl = "";
        try {
          const response = await axios.post("http://localhost:6000/index", {
            username,
            s3_file_key: s3FileKey,
            courseId,
          });
          faissIndexUrl = response.data.faiss_index_url;
          console.log(`Indexed file successfully: ${faissIndexUrl}`);
        } catch (indexError) {
          console.error("Error indexing file:", indexError);
        }

        // Create a new attachment with metadata, including the index URL
        const newAttachment = new Attachment({
          fileName: file.originalname,
          fileUrl,
          fileType: file.mimetype,
          fileSize: file.size,
          courseId,
          faissIndexUrl, // Save the index URL if available
        });

        // Save the attachment to the database
        const savedAttachment = await newAttachment.save();
        savedAttachments.push(savedAttachment);
      }

      // Respond with the created attachments
      res.status(201).json(savedAttachments);
    } catch (error) {
      console.error("Error adding attachments:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
];
