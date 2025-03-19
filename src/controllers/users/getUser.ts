import { Request, Response } from "express";
import { User } from "../../models/User";

// Define the getUser controller
export const getUser = async (req: Request, res: Response) => {
  try {
    // Extract the user ID from the request parameters
    const userId = req.params.userId;

    // Find the user by ID and select only the id, name, and username fields
    const user = await User.findById(userId).select("-password");

    // If user is not found, return a 404 error
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return the user data
    res.status(200).json(user);
  } catch (error) {
    // Handle any errors that occur during the process
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
