import { Schema, model, Document } from "mongoose";

// Interface for file attachments
export interface FileAttachment {
  fileName: string;
  fileUrl: string; // URL to the file in cloud storage
  fileType: string;
  fileSize: number;
  uploadedAt: Date;
}

// Interface for the Course document
export interface ICourse extends Document {
  title: string;
  courseCode: string; // e.g., "MKTG2201"
  description?: string;
  createdBy: Schema.Types.ObjectId;
  assignments: Schema.Types.ObjectId[];
  attachments: FileAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

// Interface for creating a new course
export interface ICreateCourse {
  title: string;
  description?: string;
  createdBy: Schema.Types.ObjectId;
}

const courseSchema = new Schema<ICourse>({
  title: { type: String, required: true },
  courseCode: { type: String, required: false, unique: true },
  description: { type: String },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }, // Reference to the User
  assignments: [{ type: Schema.Types.ObjectId, ref: "Assignment" }], // Array of Assignments
  attachments: [
    {
      fileName: { type: String, required: true },
      fileUrl: { type: String, required: true },
      fileType: { type: String, required: true },
      fileSize: { type: Number, required: true },
      uploadedAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Generate courseCode from title before saving
courseSchema.pre("save", function (next) {
  if (this.isModified("title")) {
    // Extract course code from title (e.g., "MKTG 2201" from "MKTG 2201: Introduction to Marketing")
    const match = this.title.match(/^([A-Z]+)\s*(\d+)/);
    if (match) {
      this.courseCode = match[1] + match[2]; // e.g., "MKTG2201"
    } else {
      // If no course code format found, create a slug from the title
      this.courseCode = this.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }
  }
  next();
});

export const Course = model<ICourse>("Course", courseSchema);
