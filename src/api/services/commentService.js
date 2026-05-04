import Comment from "../models/commentModel.js";

export const getCommentsByPageId = async (pageId) => {
  try {
    const comments = await Comment.find({ pageId })
      .sort({ createdAt: -1 }) // Sort by newest first
      .exec();
    return comments;
  } catch (error) {
    throw new Error("Error fetching comments: " + error.message);
  }
};
