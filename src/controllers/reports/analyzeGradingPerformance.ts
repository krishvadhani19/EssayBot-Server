import { Request, Response } from "express";
import axios from "axios";
import { Schema } from "mongoose";
import { Course } from "../../models/Course";
import { Assignment } from "../../models/Assignment";
import { Criterion } from "../assignments";

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    username: string;
  };
}

interface AnalyzeGradingRequest {
  courseId: string;
  assignmentId: string;
  config_rubric: {
    criteria: Criterion[];
  };
}

export const analyzeGradingPerformance = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const { courseId, assignmentId } = req.body as AnalyzeGradingRequest;
    const username = req.user.username;

    // Validate required fields
    if (!courseId || !assignmentId) {
      return res.status(400).json({
        message:
          "Missing required fields: courseId, assignmentId, config_rubric",
      });
    }

    // Check if the course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Check if the assignment exists and belongs to the course
    const assignment = await Assignment.findOne({
      _id: assignmentId,
      course: courseId,
    });
    if (!assignment) {
      return res.status(404).json({
        message: "Assignment not found or does not belong to this course",
      });
    }

    // Check if graded files exist
    if (!assignment.gradedFiles || assignment.gradedFiles.length === 0) {
      return res.status(400).json({
        message: "No graded files found for this assignment",
      });
    }
    console.log(assignment.gradedFiles[0].url);

    // Call the Python backend service
    const pythonServiceUrl =
      process.env.PYTHON_SERVICE_URL || "http://localhost:6000";
    const response = await axios.post(`${pythonServiceUrl}/analyze_grading`, {
      s3_file_path: assignment.gradedFiles[0].url,
      config_rubric: assignment.config_rubric,
    });

    // Return the analysis results
    res.status(200).json(response.data);
  } catch (error: any) {
    console.error("Error analyzing grading performance:", error);
    res.status(500).json({
      message: "Failed to analyze grading performance",
      error: error.message,
    });
  }
};
