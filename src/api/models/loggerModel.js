import mongoose from "mongoose";



const logSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userEmail: {
      type: String,
      required: true,
    },
    pageId: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ["success", "error", "info"],
      default: "info",
    },
    
    expireAt: { type: Date, default: Date.now, expires: 172800 },
  },
  {
    timestamps: true,
  }
);

const Logger = mongoose.model("Logger", logSchema);

export default Logger;
