import { Request, Response } from "express";
import multer from "multer";
import { Course } from "../../models/Course";
import { uploadFileToS3 } from "../../utils/awsS3";
import { Attachment } from "../../models/Attachment";

const upload = multer({ storage: multer.memoryStorage() }).array("files", 10);

export const addAttachments = [
  upload, // Use the multer middleware for multiple file uploads
  async (req: Request, res: Response) => {
    const { courseId } = req.body; // Course ID from the request body
    const files = req.files as Express.Multer.File[]; // Array of uploaded files from multer

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
        // Upload the file to S3
        const fileUrl = await uploadFileToS3(file, process.env.AWS_S3_BUCKET!);

        // Create a new attachment with metadata
        const newAttachment = new Attachment({
          fileName: file.originalname,
          fileUrl,
          fileType: file.mimetype,
          fileSize: file.size,
          courseId,
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
