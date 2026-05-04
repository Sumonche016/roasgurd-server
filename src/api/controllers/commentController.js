import axios from "axios";
import Comment from "../models/commentModel.js";
import PageToken from "../models/pageToken.js";

export const getComments = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { timeFilter, statusFilter, page = 1, limit = 10 } = req.query;

    const query = { pageId };

    if (timeFilter) {
      const now = new Date();
      if (timeFilter === "last7days") {
        query.createdAt = { $gte: new Date(now.setDate(now.getDate() - 7)) };
      } else if (timeFilter === "last1month") {
        query.createdAt = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
      }
    }

    if (statusFilter) {
      if (statusFilter === "hidden") {
        query.isHidden = true;
      } else if (statusFilter === "replied") {
        query["autoReply.message"] = { $exists: true };
      }
    }

    const comments = await Comment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalComments = await Comment.countDocuments(query);

    res.json({
      comments,
      totalPages: Math.ceil(totalComments / limit),
      currentPage: parseInt(page),
    });
  } catch (error) {
    console.error("Error in getComments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};

export const hideComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { pageId } = req.body;

    // Get the access token from the database
    const pageTokenDoc = await PageToken.findOne({ pageId });
    if (!pageTokenDoc) {
      return res.status(404).json({ error: "Page access token not found" });
    }

    const response = await fetch(
      `https://graph.facebook.com/v16.0/${commentId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_hidden: true,
          access_token: pageTokenDoc.accessToken,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }

    // Update comment status in database
    await Comment.findOneAndUpdate(
      { commentId },
      { isHidden: true },
      { new: true }
    );

    res.json({ success: true, message: "Comment hidden successfully" });
  } catch (error) {
    console.error("Error hiding comment:", error);
    res.status(500).json({ error: "Failed to hide comment" });
  }
};

export const unhideComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { pageId } = req.body;
    console.log({
      commentId,
      pageId,
    });
    // Get the access token from the database
    const pageTokenDoc = await PageToken.findOne({ pageId });
    if (!pageTokenDoc) {
      return res.status(404).json({ error: "Page access token not found" });
    }

    const response = await fetch(
      `https://graph.facebook.com/v16.0/${commentId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_hidden: false,
          access_token: pageTokenDoc.accessToken,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }

    // Update comment status in database
    await Comment.findOneAndUpdate(
      { commentId },
      { isHidden: false },
      { new: true }
    );

    res.json({ success: true, message: "Comment unhidden successfully" });
  } catch (error) {
    console.error("Error unhiding comment:", error);
    res.status(500).json({ error: "Failed to unhide comment" });
  }
};

export const replyToComment = async (req, res) => {
  console.log("called");
  try {
    const { commentId } = req.params;
    const { pageId, replyMessage } = req.body;
    console.log({
      pageId,
      replyMessage,
      commentId,
    });

    // Get the access token from the database
    const pageTokenDoc = await PageToken.findOne({ pageId });

    if (!pageTokenDoc) {
      return res.status(404).json({ error: "Page access token not found" });
    }

    // Send the reply to the Facebook comment
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${commentId}/comments`,
      {
        message: replyMessage,
      },
      {
        headers: {
          Authorization: `Bearer ${pageTokenDoc.accessToken}`,
        },
      }
    );

    // Access the reply data from response.data
    const replyData = response.data;

    // Update the original comment in the database with auto-reply information
    await Comment.findOneAndUpdate(
      { commentId },
      {
        autoReply: {
          message: replyMessage,
          createdAt: new Date(),
        },
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "Reply sent successfully",
      replyId: replyData.id,
    });
  } catch (error) {
    console.error("Error replying to comment:", error);
    res.status(500).json({ error: "Failed to reply to comment" });
  }
};
