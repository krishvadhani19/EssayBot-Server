import express, { RequestHandler } from "express";
import { authenticateToken } from "../middleware/authenticateToken";
import { getUser } from "../controllers/users/getUser";

const router = express.Router();

// Get assignment details
router.get(
  "/getUser/:userId",
  authenticateToken as RequestHandler,
  getUser as RequestHandler
);

export default router;
