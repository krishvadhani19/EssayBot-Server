import express, { RequestHandler } from "express";
import { authenticateToken } from "../middleware/authenticateToken";
import { gradeSingleEssay } from "../controllers/grading/gradeSingleEssay";

const router = express.Router();

router.use(authenticateToken as RequestHandler);


router.post(
  "/grade-single-essay",
  gradeSingleEssay as unknown as RequestHandler
);

export default router;
