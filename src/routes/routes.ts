import express from "express";
import authRoutes from "./authRoutes";

const router = express.Router();

// Group all API routes
router.use("/auth", authRoutes);

export default router;
