import express from "express";
import { loginUser } from "../controllers/auth/login";
import { registerUser } from "../controllers/auth/register";

const router = express.Router();

// Define authentication routes
router.post("/register", registerUser);
router.post("/login", loginUser);

export default router;
