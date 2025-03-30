import { Request, Response } from "express";
import { Course } from "../../models/Course";
import { Assignment, IAssignment } from "../../models/Assignment";
import axios from "axios";

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    username: string;
  };
}

interface BulkGradingRequest {
  courseId: string;
  assignmentId: string;
  s3_excel_link: string;
  model?: string;
}

export const gradeBulkEssays = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { courseId, assignmentId, s3_excel_link, model }: BulkGradingRequest =
      req.body;
    const username = req?.user?.username;

    // Validate required fields
    if (!courseId || !assignmentId || !s3_excel_link) {
      return res.status(400).json({
        message:
          "Missing required fields: courseId, assignmentId, s3_excel_link",
      });
    }

    // Find the assignment
    const assignment: IAssignment | null = await Assignment.findOne({
      _id: assignmentId,
      course: courseId,
    });

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    // Prepare request data for Flask API
    const requestData = {
      courseId,
      assignmentTitle: assignment.title,
      config_prompt: assignment.config_prompt,
      question: assignment.question,
      username,
      s3_excel_link,
      model: model || "llama3.1:8b", // Use default model if not specified
    };

    // Call Flask API for bulk grading
    const response: any = await axios.post(
      "http://localhost:6000/grade_bulk_essays",
      requestData
    );

    if (response.data.s3_graded_link) {
      await Assignment.findByIdAndUpdate(
        assignmentId,
        {
          $push: {
            gradedFiles: {
              url: response.data.s3_graded_link,
              originalName: `graded_${
                assignment.title
              }_${new Date().toISOString()}.xlsx`,
              gradedAt: new Date(),
            },
          },
        },
        { new: true }
      );
    }

    console.log(response.data);
    // Return the response from Flask API
    return res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error in bulk grading:", error);

    // Handle specific error cases
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      return res.status(error.response.status).json({
        message: error.response.data.error || "Error in bulk grading",
        details: error.response.data,
      });
    } else if (error.request) {
      // The request was made but no response was received
      return res.status(503).json({
        message: "No response received from grading service",
        details: error.message,
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      return res.status(500).json({
        message: "Error setting up bulk grading request",
        details: error.message,
      });
    }
  }
};
