import express, { RequestHandler } from "express";
import { authenticateToken } from "../middleware/authenticateToken";
import { gradeSingleEssay } from "../controllers/grading/gradeSingleEssay";
import { uploadExcelGrades } from "../controllers/grading/uploadExcelGrades";
import { getExcelFile } from "../controllers/grading/getExcelFile";
import { gradeBulkEssays } from "../controllers/grading/bulkGrading";

const router = express.Router();

router.use(authenticateToken as RequestHandler);

router.post(
  "/grade-single-essay",
  gradeSingleEssay as unknown as RequestHandler
);

router.post("/bulk-grade", gradeBulkEssays as unknown as RequestHandler);

router.post(
  "/upload-excel-grades",
  uploadExcelGrades as unknown as RequestHandler[]
);

router.get(
  "/excel-files/:courseId/:assignmentId",
  getExcelFile as unknown as RequestHandler
);

export default router;
