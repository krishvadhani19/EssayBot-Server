import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User, IUser } from "../../models/User";

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user: IUser | null = await User.findOne({ email });

    if (!user || !(await user.matchPassword(password))) {
      res.status(400).json({ message: "Invalid credentials" });
      return;
    }

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET as string, {
      expiresIn: "1d",
    });

    res.json({ message: "Login successful", token });
  } catch (error) {
    console.log({ error });
    res.status(500).json({ message: "Error logging in", error });
  }
};
