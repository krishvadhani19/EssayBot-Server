import express, { RequestHandler } from "express";
import { authenticateToken } from "../middleware/authenticateToken";
import { updateAssignment } from "../controllers/assignments/updateAssignment";
import { createAssignment } from "../controllers/assignments/createAssignment";
import { AssignmentParams } from "../controllers/assignments";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken as RequestHandler);

// Create a new assignment
router.post(
  "/:courseId/assignments",
  createAssignment as unknown as RequestHandler<AssignmentParams>
);

// Update assignment (handles question, config_rubric, and config_prompt updates)
router.patch(
  "/:courseId/assignments/:assignmentId",
  updateAssignment as unknown as RequestHandler<AssignmentParams>
);

export default router;
