import express, { RequestHandler } from "express";
import { courseController } from "../controllers/courseController";
import { authenticateToken } from "../middleware/authenticateToken";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken as RequestHandler);

// Course routes
router.post(
  "/courses",
  courseController.createCourse as unknown as RequestHandler
);
router.get(
  "/courses",
  courseController.getCourses as unknown as RequestHandler
);
router.get(
  "/courses/:courseId",
  courseController.getCourse as unknown as RequestHandler
);
router.patch(
  "/courses/:courseId",
  courseController.updateCourse as unknown as RequestHandler
);
router.delete(
  "/courses/:courseId",
  courseController.deleteCourse as unknown as RequestHandler
);

export default router;
