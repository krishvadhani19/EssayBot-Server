import express, { RequestHandler } from "express";
import multer from "multer";
import { fileController } from "../controllers/fileController";
import {
  FileUploadParams,
  FileDeleteParams,
} from "../controllers/fileController";
import { authenticateToken } from "../middleware/authenticateToken";

const router = express.Router();

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // File type validation will be handled by the service
    cb(null, true);
  },
});

// Apply authentication middleware to all routes
router.use(authenticateToken as RequestHandler);

// Upload files to a course (handles both single and multiple files)
router.post(
  "/courses/:courseCode/files",
  upload.array("files", 10), // Allow up to 10 files
  fileController.uploadFiles as unknown as RequestHandler<FileUploadParams>
);

// Delete file from a course
router.delete(
  "/courses/:courseCode/files/:fileUrl",
  fileController.deleteFile as unknown as RequestHandler<FileDeleteParams>
);

export default router;
