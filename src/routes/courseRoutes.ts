import express, { RequestHandler } from "express";
import { courseController } from "../controllers/courseController";
import { authenticateToken } from "../middleware/authenticateToken";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken as RequestHandler);

// Course routes
router.post("/", courseController.createCourse as unknown as RequestHandler);
router.get("/", courseController.getCourses as unknown as RequestHandler);
router.get(
  "/:courseId",
  courseController.getCourse as unknown as RequestHandler
);
router.patch(
  "/:courseId",
  courseController.updateCourse as unknown as RequestHandler
);
router.delete(
  "/:courseId",
  courseController.deleteCourse as unknown as RequestHandler
);

export default router;
