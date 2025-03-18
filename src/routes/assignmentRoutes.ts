import express, { RequestHandler } from "express";
import { assignmentController } from "../controllers/assignmentController";
import { AssignmentParams } from "../controllers/assignmentController";
import { authenticateToken } from "../middleware/authenticateToken";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken as RequestHandler);

// Create a new assignment
router.post(
  "/courses/:courseCode/assignment",
  assignmentController.createAssignment as unknown as RequestHandler<AssignmentParams>
);

// Get assignment details
router.get(
  "/courses/:courseCode/assignments/:assignmentId",
  assignmentController.getAssignment as unknown as RequestHandler<AssignmentParams>
);

// Update assignment (handles question, config_rubric, and config_prompt updates)
router.patch(
  "/courses/:courseCode/assignments/:assignmentId",
  assignmentController.updateAssignment as unknown as RequestHandler<AssignmentParams>
);

export default router;
