import { Request, Response } from "express";
import { Course } from "../../models/Course";
import { Assignment } from "../../models/Assignment";
import { AssignmentUpdatePayload } from ".";

export const updateAssignment = async (req: Request, res: Response) => {
  try {
    const { courseId, assignmentId } = req.params;
    const updates: AssignmentUpdatePayload = req.body;

    if (!assignmentId) {
      return res.status(400).json({ message: "Assignment ID is required" });
    }

    // Validate that at least one field is being updated
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "No updates provided" });
    }

    // Find the course by courseCode
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const assignment = await Assignment.findOne({
      _id: assignmentId,
      course: courseId,
    });

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    // Update only the provided fields
    if (updates?.question) {
      assignment.question = updates.question;
    }
    if (updates?.config_rubric) {
      assignment.config_rubric = updates.config_rubric;
    }
    if (updates?.config_prompt) {
      assignment.config_prompt = updates.config_prompt;
    }

    await assignment.save();

    return res.status(200).json(assignment);
  } catch (error) {
    console.error("Error updating assignment:", error);
    return res.status(500).json({ message: "Error updating assignment" });
  }
};
