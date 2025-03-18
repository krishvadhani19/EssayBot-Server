import { Request, Response } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { Course, ICreateCourse } from "../models/Course";
import mongoose from "mongoose";

// Define interfaces for request parameters
type CourseParams = {
  courseId?: string;
} & ParamsDictionary;

// Define interface for authenticated request
interface AuthenticatedRequest extends Request<CourseParams> {
  user: {
    id: string;
    username: string;
  };
}

export class CourseController {
  // Create a new course
  async createCourse(req: AuthenticatedRequest, res: Response) {
    try {
      const { title, description } = req.body;

      if (!req.user?.id) {
        return res
          .status(401)
          .json({ message: "Unauthorized: User not found" });
      }

      const courseData = {
        title,
        description,
        createdBy: new mongoose.Types.ObjectId(req.user.id),
      };

      const course = new Course(courseData);
      await course.save();

      return res.status(201).json(course);
    } catch (error) {
      console.error("Error creating course:", error);
      return res.status(500).json({ message: "Error creating course" });
    }
  }

  // Get all courses for a professor
  async getCourses(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ message: "Unauthorized: User not found" });
      }

      const courses = await Course.find({
        createdBy: new mongoose.Types.ObjectId(req.user.id),
      });
      return res.status(200).json(courses);
    } catch (error) {
      console.error("Error fetching courses:", error);
      return res.status(500).json({ message: "Error fetching courses" });
    }
  }

  // Get a single course by ID
  async getCourse(req: AuthenticatedRequest, res: Response) {
    try {
      const { courseId } = req.params;

      if (!courseId) {
        return res.status(400).json({ message: "Course ID is required" });
      }

      const course = await Course.findOne({
        _id: new mongoose.Types.ObjectId(courseId),
        createdBy: new mongoose.Types.ObjectId(req.user.id),
      });

      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      return res.status(200).json(course);
    } catch (error) {
      if (error instanceof Error && error.name === "BSONError") {
        return res.status(400).json({ message: "Invalid course ID format" });
      }
      console.error("Error fetching course:", error);
      return res.status(500).json({ message: "Error fetching course" });
    }
  }

  // Update a course
  async updateCourse(req: AuthenticatedRequest, res: Response) {
    try {
      const { courseId } = req.params;

      if (!courseId) {
        return res.status(400).json({ message: "Course ID is required" });
      }

      const updates = req.body;

      const course = await Course.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(courseId),
          createdBy: new mongoose.Types.ObjectId(req.user.id),
        },
        { ...updates, updatedAt: new Date() },
        { new: true }
      );

      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      return res.status(200).json(course);
    } catch (error) {
      if (error instanceof Error && error.name === "BSONError") {
        return res.status(400).json({ message: "Invalid course ID format" });
      }
      console.error("Error updating course:", error);
      return res.status(500).json({ message: "Error updating course" });
    }
  }

  // Delete a course
  async deleteCourse(req: AuthenticatedRequest, res: Response) {
    try {
      const { courseId } = req.params;

      if (!courseId) {
        return res.status(400).json({ message: "Course ID is required" });
      }

      const course = await Course.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(courseId),
        createdBy: new mongoose.Types.ObjectId(req.user.id),
      });

      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      return res.status(200).json({ message: "Course deleted successfully" });
    } catch (error) {
      if (error instanceof Error && error.name === "BSONError") {
        return res.status(400).json({ message: "Invalid course ID format" });
      }
      console.error("Error deleting course:", error);
      return res.status(500).json({ message: "Error deleting course" });
    }
  }
}

export const courseController = new CourseController();
