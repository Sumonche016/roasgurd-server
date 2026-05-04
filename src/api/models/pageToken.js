import mongoose from "mongoose";

const pageTokenSchema = new mongoose.Schema({
  pageId: {
    type: String,
    required: true,
    unique: true,
  },
  pageName: {
    type: String,
    required: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("PageToken", pageTokenSchema);
