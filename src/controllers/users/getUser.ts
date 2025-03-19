import { Request, Response } from "express";
import { User } from "../../models/User";

// Define the getUser controller
export const getUser = async (req: Request, res: Response) => {
  try {
    // Extract the user ID from the request parameters
    const userId = req.params.userId;

    // Find the user by ID, exclude the password, and populate courses and assignments
    const user = await User.findById(userId)
      .select("-password") // Exclude the password field
      .populate({
        path: "courses", // Populate the courses field
        populate: {
          path: "assignments", // Populate the assignments field inside each course
        },
      })
      .exec();

    // If user is not found, return a 404 error
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return the user data with populated courses and assignments
    res.status(200).json(user);
  } catch (error) {
    // Handle any errors that occur during the process
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
