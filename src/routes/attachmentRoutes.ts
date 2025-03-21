import express, { RequestHandler } from "express";
import { authenticateToken } from "../middleware/authenticateToken";
import { addAttachments } from "../controllers/attachments/addAttachments";
import { deleteAttachment } from "../controllers/attachments/deleteAttachment";
import { getAllCourseAttachments } from "../controllers/attachments/getAllCourseAttachments";

const router = express.Router();

router.use(authenticateToken as RequestHandler);

router.post("/addAttachments", addAttachments as unknown as RequestHandler);
router.get(
  "/getAllCourseAttachments/:courseId",
  getAllCourseAttachments as unknown as RequestHandler
);
router.delete(
  "/deleteAttachment/:attachmentId",
  deleteAttachment as RequestHandler
);

export default router;
