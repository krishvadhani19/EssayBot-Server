import express from "express";
import authRoutes from "./authRoutes";
import courseRoutes from "./courseRoutes";
import fileRoutes from "./fileRoutes";
import assignmentRoutes from "./assignmentRoutes";

const router = express.Router();

// Group all API routes
router.use("/auth", authRoutes);
router.use("/courses", courseRoutes);
router.use("/", fileRoutes);
router.use("/courses/:courseCode/assignments", assignmentRoutes);

export default router;
