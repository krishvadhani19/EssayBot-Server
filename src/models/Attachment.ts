import { Schema, model, Document } from "mongoose";

// Interface for the Attachment document
export interface IAttachment extends Document {
  fileName: string;
  fileUrl: string; // URL to the file in cloud storage
  fileType: string;
  fileSize: number;
  uploadedAt: Date;
}

const attachmentSchema = new Schema<IAttachment>({
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String, required: true },
  fileSize: { type: Number, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

export const Attachment = model<IAttachment>("Attachment", attachmentSchema);
