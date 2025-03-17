import express from "express";
import { loginUser } from "../controllers/auth/login";
import { registerUser } from "../controllers/auth/register";
import { logoutUser } from "../controllers/auth/logout";

const router = express.Router();

// Define authentication routes
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);

export default router;
