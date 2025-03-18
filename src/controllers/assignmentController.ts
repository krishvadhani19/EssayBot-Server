import { Request, Response } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { Course } from "../models/Course";
import {
  Assignment,
  IAssignment,
  ICreateAssignment,
} from "../models/Assignment";
import { Schema } from "mongoose";

// Define interfaces for request parameters
interface AssignmentRouteParams {
  courseCode: string;
  assignmentId?: string;
}

export type AssignmentParams = AssignmentRouteParams & ParamsDictionary;

interface ScoringLevels {
  full: string;
  partial: string;
  minimal: string;
}

interface Criterion {
  name: string;
  description: string;
  weight: number;
  scoringLevels: ScoringLevels;
  subCriteria: Criterion[];
}

// Type for the update payload
export interface AssignmentUpdatePayload {
  question?: string;
  config_rubric?: {
    criteria: Criterion[];
  };
  config_prompt?: Record<string, any>;
}

export class AssignmentController {
  // Create a new assignment
  async createAssignment(req: Request<AssignmentParams>, res: Response) {
    try {
      const { courseCode } = req.params;
      const { title, question, config_rubric, config_prompt } = req.body;

      // Find the course by courseCode
      const course = await Course.findOne({ courseCode });
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      // Create assignment data
      const assignmentData: ICreateAssignment = {
        title,
        question,
        course: course._id as Schema.Types.ObjectId,
        config_rubric,
        config_prompt,
      };

      // Create and save the assignment
      const assignment = new Assignment(assignmentData);
      await assignment.save();

      // Add assignment to course's assignments array
      course.assignments.push(assignment._id as Schema.Types.ObjectId);
      await course.save();

      return res.status(201).json(assignment);
    } catch (error) {
      console.error("Error creating assignment:", error);
      return res.status(500).json({ message: "Error creating assignment" });
    }
  }

  async getAssignment(req: Request<AssignmentParams>, res: Response) {
    try {
      const { courseCode, assignmentId } = req.params;

      if (!assignmentId) {
        return res.status(400).json({ message: "Assignment ID is required" });
      }

      // Find the course by courseCode
      const course = await Course.findOne({ courseCode });
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      const assignment = await Assignment.findOne({
        _id: assignmentId,
        course: course._id,
      });

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      return res.status(200).json(assignment);
    } catch (error) {
      console.error("Error fetching assignment:", error);
      return res.status(500).json({ message: "Error fetching assignment" });
    }
  }

  async updateAssignment(req: Request<AssignmentParams>, res: Response) {
    try {
      const { courseCode, assignmentId } = req.params;
      const updates: AssignmentUpdatePayload = req.body;

      if (!assignmentId) {
        return res.status(400).json({ message: "Assignment ID is required" });
      }

      // Validate that at least one field is being updated
      if (!Object.keys(updates).length) {
        return res.status(400).json({ message: "No updates provided" });
      }

      // Find the course by courseCode
      const course = await Course.findOne({ courseCode });
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      const assignment = await Assignment.findOne({
        _id: assignmentId,
        course: course._id,
      });

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Update only the provided fields
      if (updates.question !== undefined) {
        assignment.question = updates.question;
      }
      if (updates.config_rubric !== undefined) {
        assignment.config_rubric = updates.config_rubric;
      }
      if (updates.config_prompt !== undefined) {
        assignment.config_prompt = updates.config_prompt;
      }

      await assignment.save();

      return res.status(200).json(assignment);
    } catch (error) {
      console.error("Error updating assignment:", error);
      return res.status(500).json({ message: "Error updating assignment" });
    }
  }
}

export const assignmentController = new AssignmentController();
