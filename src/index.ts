import express from "express";
import { connectDB } from "./config/db";
import routes from "./routes/routes";
import dotenv from "dotenv";

dotenv.config(); // Load env variables at the very top

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

// API Routes
app.use("/api", routes);

connectDB();

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
