import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    commentId: {
      type: String,
      required: true,
    },
    postId: {
      type: String,
      required: true,
    },
    pageId: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    from: {
      id: String,
      name: String,
    },
    createdAt: {
      type: Date,
      required: true,
    },
    isHidden: {
      type: Boolean,
      default: false,
    },
    autoReply: {
      message: String,
      createdAt: Date,
    },
    permalinkUrl: {
      type: String,
      // required: true,
    },
    expireAt: { type: Date, default: Date.now, expires: 172800 }, // Auto-delete after 2 days (48 hours)
  },
  {
    timestamps: true,
  }
);

// Explicit TTL index: expireAfterSeconds:0 means "delete at the expireAt date"
commentSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
const Comment = mongoose.model("Comment", commentSchema);

export default Comment;
