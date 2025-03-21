import { Schema, model, Document } from "mongoose";
import { Course } from "./Course"; // Import the Course model

export interface IAttachment extends Document {
  fileName: string;
  fileUrl: string; // URL to the file in cloud storage
  fileType: string;
  fileSize: number;
  courseId: Schema.Types.ObjectId; // Reference to the Course
  uploadedAt: Date;
}

const attachmentSchema = new Schema<IAttachment>({
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String, required: true },
  fileSize: { type: Number, required: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  uploadedAt: { type: Date, default: Date.now },
});

attachmentSchema.post("save", async function (doc) {
  const courseId = doc.courseId;
  const attachmentId = doc._id;

  await Course.findByIdAndUpdate(courseId, {
    $push: { attachments: attachmentId },
  });
});

attachmentSchema.post("findOneAndDelete", async function (doc) {
  if (doc) {
    const courseId = doc.courseId;
    const attachmentId = doc._id;

    await Course.findByIdAndUpdate(courseId, {
      $pull: { attachments: attachmentId },
    });
  }
});

export const Attachment = model<IAttachment>("Attachment", attachmentSchema);
