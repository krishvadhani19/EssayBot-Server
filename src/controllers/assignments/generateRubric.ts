import { Request, Response } from "express";
import axios from "axios";

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    username: string;
  };
}

export const createRubric = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { courseId, question } = req.body;
    const username = req.user.username;

    if (!courseId || !question) {
      return res.status(400).json({
        message: "courseId and question are required",
      });
    }

    // Prepare request payload for Flask
    const payload = {
      courseId,
      question,
      username,
    };

    // Call Flask /generate_rubric endpoint
    const flaskResponse = await axios.post(
      "http://localhost:6000/generate_rubric",
      payload
    );

    const { data } = flaskResponse;
    console.log(data);
    if (data.success) {
      return res.status(200).json({
        message: "Rubric generated successfully",
        rubric: data.rubric,
      });
    } else {
      return res.status(500).json({
        message: "Failed to generate rubric",
        error: data.error || "Unknown error",
      });
    }
  } catch (error: any) {
    console.error("Error creating rubric:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error?.response?.data?.error || error.message,
    });
  }
};
