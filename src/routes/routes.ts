import express from "express";
import authRoutes from "./authRoutes";
import courseRoutes from "./courseRoutes";

const router = express.Router();

// Group all API routes
router.use("/auth", authRoutes);
router.use("/", courseRoutes); // Course routes will be under /api/courses

export default router;
