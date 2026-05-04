import cron from "node-cron";
import User from "../api/models/userModels.js";
import fetch from "node-fetch";
import Comment from "../api/models/commentModel.js";
import { pipeline } from "@huggingface/transformers";

// Store active cron jobs by user ID
const activeJobs = new Map();

// Initialize the sentiment analysis pipeline
let sentimentPipe;
const initializeSentimentPipeline = async () => {
  if (!sentimentPipe) {
    sentimentPipe = await pipeline("sentiment-analysis");
  }
  return sentimentPipe;
};

const monitorUserComments = async (userId) => {
  console.log(
    `[${new Date().toISOString()}] Starting monitoring for user ${userId}`
  );

  try {
    const user = await User.findById(userId);
    if (!user || !user.commentMonitoring?.isEnabled) {
      console.log(
        `[${new Date().toISOString()}] Monitoring disabled or user not found for ${userId}`
      );
      return;
    }

    const pageAccessToken = user.addedPage?.accessToken;
    if (!pageAccessToken) {
      console.log(
        `[${new Date().toISOString()}] No page access token found for ${userId}`
      );
      return;
    }

    // Replace API call with stored adAccountId
    const adAccountId = user.commentMonitoring?.adAccountId;
    console.log(adAccountId, "add account");
    if (!adAccountId) {
      console.log(
        `[${new Date().toISOString()}] No ad account ID found for ${userId}`
      );
      return;
    }

    // Process single ad account instead of fetching all
    const allComments = [];
    console.log(`Processing ad account: ${adAccountId}`);

    try {
      const engagementsResponse = await fetch(
        `https://graph.facebook.com/v16.0/act_${adAccountId}/ads?fields=id,name,adcreatives{object_story_id}&access_token=${user.accessToken}`
      );
      const engagementsData = await engagementsResponse.json();

      if (engagementsData.error) {
        console.error(
          `Error fetching engagements for account ${adAccountId}:`,
          engagementsData.error
        );
        return;
      }

      // Process each ad's comments
      for (const engagement of engagementsData.data || []) {
        if (!engagement.adcreatives?.data?.[0]?.id) {
          console.log(
            `Skipping engagement ${engagement.id} - no creative ID found`
          );
          continue;
        }

        const creativeId = engagement.adcreatives.data[0].id;

        // Get effective story ID
        const storyData = await getEffectiveStoryId(
          creativeId,
          pageAccessToken
        );
        if (!storyData.effective_object_story_id) continue;

        // Get comments
        const commentsData = await getComments(
          storyData.effective_object_story_id,
          pageAccessToken
        );
        if (commentsData.error) continue;

        // Add valid comments to our collection
        if (commentsData.data?.length > 0) {
          allComments.push(
            ...commentsData.data.map((comment) => ({
              ...comment,
              adAccountId: adAccountId,
              adId: engagement.id,
            }))
          );
        }
      }
    } catch (error) {
      console.error(`Error processing account ${adAccountId}:`, error);
    }

    // Initialize sentiment pipeline if needed
    const pipe = await initializeSentimentPipeline();

    // Process all collected comments in batch
    if (allComments.length > 0) {
      console.log(`Processing ${allComments.length} total comments`);

      // Modified sync logic to preserve replies
      const syncPromises = allComments.map(async (comment) => {
        // First find existing comment to preserve replies
        const existingComment = await Comment.findOne({
          userId: userId,
          commentId: comment.id,
        }).lean();

        return Comment.findOneAndUpdate(
          { userId: userId, commentId: comment.id },
          {
            userId: userId,
            commentId: comment.id,
            message: comment.message,
            createdAt: new Date(comment.created_time),
            isHidden: comment.is_hidden,
            author: {
              id: comment.from?.id,
              name: comment.from?.name,
            },
            adAccountId: comment.adAccountId,
            adId: comment.adId,
            // Preserve existing replies if they exist
            replies: existingComment?.replies || [],
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          }
        );
      });

      await Promise.all(syncPromises);

      // Now process all comments for auto-reply and hiding
      const dbComments = await Comment.find({
        userId: userId,
        commentId: { $in: allComments.map((c) => c.id) },
      });

      // Process comments for auto-reply and hiding
      for (const comment of dbComments) {
        if (comment.isHidden) continue;

        // Check if comment has any replies matching the default reply text exactly
        const hasDefaultReply = comment.replies.some(
          (reply) => reply.message === user.commentMonitoring.defaultReplytext
        );

        // Check if the comment's creation time is after the lastChecked time
        const isAfterToggle =
          new Date(comment.createdAt) >
          new Date(user.commentMonitoring.lastChecked);

        // Handle auto-reply if enabled, no matching reply exists, and comment is after toggle
        if (
          user.commentMonitoring.settings.autoReply &&
          !hasDefaultReply &&
          isAfterToggle
        ) {
          try {
            console.log(
              `[${new Date().toISOString()}] Auto-replying to comment ${
                comment.commentId
              }`
            );

            // Post reply to Facebook
            const replyResponse = await fetch(
              `https://graph.facebook.com/v16.0/${comment.commentId}/comments?access_token=${pageAccessToken}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: user.commentMonitoring.defaultReplytext,
                }),
              }
            );
            const replyData = await replyResponse.json();

            if (replyData.id) {
              // Update comment in database with the reply
              await Comment.findOneAndUpdate(
                { userId: userId, commentId: comment.commentId },
                {
                  $push: {
                    replies: {
                      replyId: replyData.id,
                      message: user.commentMonitoring.defaultReplytext,
                      createdAt: new Date(),
                      author: { id: user.addedPage.id },
                    },
                  },
                }
              );
            }
          } catch (replyError) {
            console.error(
              `[${new Date().toISOString()}] Error auto-replying to comment ${
                comment.commentId
              }:`,
              replyError
            );
          }
        }

        const shouldHideByKeywordOrAll =
          user.commentMonitoring.settings.hideAll ||
          (user.commentMonitoring.settings.hideByKeyword &&
            user.addedKeyword?.some((keyword) =>
              comment.message.toLowerCase().includes(keyword.toLowerCase())
            ));

        // New AI-based sentiment analysis
        let shouldHideByAI = false;
        if (user.commentMonitoring.settings.hideByAI) {
          try {
            const sentiment = await pipe(comment.message);
            const negativeThreshold = 0.93; // Set a threshold for negative sentiment
            // Hide comment if sentiment score is above the threshold
            shouldHideByAI = sentiment[0].score > negativeThreshold;

            console.log(
              `[${new Date().toISOString()}] AI Analysis for comment ${
                comment.commentId
              }: ${JSON.stringify(sentiment)}`
            );
          } catch (aiError) {
            console.error(
              `[${new Date().toISOString()}] Error in AI analysis for comment ${
                comment.commentId
              }:`,
              aiError
            );
          }
        }

        if (shouldHideByKeywordOrAll || shouldHideByAI) {
          try {
            // Hide the comment
            const hideResponse = await fetch(
              `https://graph.facebook.com/v16.0/${comment.commentId}`,
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
            const hideResult = await hideResponse.json();

            if (hideResult.success) {
              // Update comment status in database
              await Comment.findOneAndUpdate(
                { userId: userId, commentId: comment.commentId },
                {
                  isHidden: true,
                  hideReason: shouldHideByAI
                    ? "ai_sentiment"
                    : "keyword_or_all",
                }
              );
            }
          } catch (hideError) {
            console.error(
              `[${new Date().toISOString()}] Error hiding comment ${
                comment.commentId
              }:`,
              hideError
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error in monitorUserComments for ${userId}:`, error);
  }
};

// Helper function to get effective story ID
const getEffectiveStoryId = async (creativeId, pageAccessToken) => {
  const storyResponse = await fetch(
    `https://graph.facebook.com/v16.0/${creativeId}?fields=effective_object_story_id&access_token=${pageAccessToken}`
  );
  return await storyResponse.json();
};

// Helper function to get comments
const getComments = async (storyId, pageAccessToken) => {
  let allComments = [];
  let url = `https://graph.facebook.com/v16.0/${storyId}/comments?fields=id,message,is_hidden,created_time,from&limit=100&access_token=${pageAccessToken}`;

  while (url) {
    const commentsResponse = await fetch(url);
    const responseData = await commentsResponse.json();

    if (responseData.error) {
      return responseData;
    }

    if (responseData.data) {
      allComments = [...allComments, ...responseData.data];
    }

    // Check if there are more pages
    url = responseData.paging?.next || null;
  }

  return { data: allComments };
};

// Start monitoring for a specific user
export const startUserMonitoring = async (userId) => {
  try {
    console.log(
      `[${new Date().toISOString()}] Starting monitoring service for user ${userId}`
    );

    if (activeJobs.has(userId)) {
      console.log(
        `[${new Date().toISOString()}] Monitoring already active for user ${userId}`
      );
      return;
    }

    // Run initial check
    await monitorUserComments(userId);

    // Schedule recurring checks
    activeJobs.set(
      userId,
      cron.schedule("*/2 * * * *", async () => {
        console.log(
          `[${new Date().toISOString()}] Running scheduled check for user ${userId}`
        );
        await monitorUserComments(userId);
      })
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error starting monitoring service for user ${userId}:`,
      error
    );
    throw error;
  }
};

// Stop monitoring for a specific user
export const stopUserMonitoring = (userId) => {
  try {
    console.log(
      `[${new Date().toISOString()}] Stopping monitoring service for user ${userId}`
    );
    if (activeJobs.has(userId)) {
      activeJobs.get(userId).stop();
      activeJobs.delete(userId);
      console.log(
        `[${new Date().toISOString()}] Monitoring stopped for user ${userId}`
      );
    } else {
      console.log(
        `[${new Date().toISOString()}] No monitoring service found for user ${userId}`
      );
    }
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error stopping monitoring service for user ${userId}:`,
      error
    );
    throw error;
  }
};
