import express from "express";
import { connectDB } from "./config/db";
import routes from "./routes/routes";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import fileRoutes from "./routes/fileRoutes";
import assignmentRoutes from "./routes/assignmentRoutes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

app.use(cookieParser());

// Allow frontend to send cookies
app.use(
  cors({
    origin: process.env.FRONTEND_BASE_URL,
    credentials: true,
  })
);

app.use("/api", routes);
app.use("/api", fileRoutes);
app.use("/api", assignmentRoutes);

connectDB();

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
