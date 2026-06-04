import { FACEBOOK_CONFIG } from "../../config/facebook.js";

import { io } from "../../server.js";
import axios from "axios";
import User from "../models/userModels.js";
import { getPages } from "../services/facebookService.js";
import { pipeline } from "@huggingface/transformers";
import Comment from "../models/commentModel.js";

// In-memory cache to store processed event IDs with expiration
const processedEvents = new Map();
const CACHE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

// Utility to clean up expired events from the cache
const cleanupCache = () => {
  const now = Date.now();
  for (const [eventId, timestamp] of processedEvents.entries()) {
    if (now - timestamp > CACHE_EXPIRATION_MS) {
      processedEvents.delete(eventId);
    }
  }
};

// Initialize the sentiment analysis pipeline
let pipe;
const initializeSentimentPipeline = async () => {
  if (!pipe) {
    pipe = await pipeline("sentiment-analysis");
  }
  return pipe;
};

export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === FACEBOOK_CONFIG.VERIFY_TOKEN) {
    console.log("Webhook Verified");
    res.status(200).send(challenge);
  } else {
    console.log("Webhook verification failed", { mode, token });
    res.sendStatus(403);
  }
};

export const handleWebhook = async (req, res) => {
  console.log("webhook triggered");
  console.log(
    "Webhook event received: line 49",
    JSON.stringify(req.body, null, 2)
  );

  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const pageId = entry.id;

      if (entry.changes) {
        for (const change of entry.changes) {
          const value = change?.value;
          if (
            value?.item === "comment" ||
            value?.item === "photo" ||
            value?.item === "video"
          ) {
            // Find user with settings for this page
            const user = await User.findOne({
              pageSettings: {
                $elemMatch: {
                  pageId: pageId,
                },
              },
            });

            if (!user) {
              console.log(`No user found for pageId: ${pageId} — skipping`);
              continue;
            }

            // Skip automation logic for reactions
            if (value?.item === "reaction") {
              console.log("Skipping automation for reaction event");
              continue;
            }

            const eventId = `${pageId}_${change.value.comment_id}`;
            console.log("enter edited block");
            // Clean up expired events in the cache
            cleanupCache();

            try {
              const createdAt = new Date(change.value.created_time * 1000);

              // Skip if the comment is from the page itself
              if (change.value.from.id === pageId) {
                console.log(
                  `Skipping auto-reply for comment from page: ${change.value.comment_id}`
                );
                continue;
              }

              if (user) {
                const pageSettings = user.pageSettings.find(
                  (p) => p.pageId === pageId
                );
                console.log("page setting", pageSettings);
                const pages = await getPages(user.accessToken);
                const page = pages.find((p) => p.id === pageId);

                if (!page) {
                  throw new Error(
                    `No page access token found for page ${pageId}`
                  );
                }

                // Add more detailed logging to debug the values
                console.log("Settings object:", {
                  hideByKeyword: pageSettings?.settings?.hideByKeyword,
                  keywords: pageSettings?.settings?.keywords,
                  message: change.value.message,
                });

                // Handle media comments by setting a default message
                const commentText = change?.value?.message
                  ? change?.value?.message.toLowerCase()
                  : "[Media Comment]";

                // Add regex patterns for email and phone
                const emailRegex =
                  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
                const phoneRegex =
                  /(?:\+\d{1,3}[-. ]?)?\d{3}[-. ]?\d{3}[-. ]?\d{4}/;

                // Find keyword reply with variable pattern matching
                const keywordReply =
                  pageSettings?.settings?.keywordReplies?.find((kr) => {
                    return kr.keywords.some((keyword) => {
                      if (keyword.includes("{{email}}")) {
                        return emailRegex.test(commentText);
                      } else if (keyword.includes("{{phone_number}}")) {
                        return phoneRegex.test(commentText);
                      } else {
                        return commentText.includes(keyword.toLowerCase());
                      }
                    });
                  });

                // Create the comment data object first
                const commentData = {
                  commentId:
                    change.value.comment_id ||
                    change?.value?.photo_id ||
                    change?.value?.video_id,
                  postId: change.value.post_id,
                  pageId: pageId,
                  message: change.value.message || "[Media Comment]",
                  from: change.value.from,
                  createdAt: new Date(change.value.created_time * 1000),
                  isHidden: false,
                  permalinkUrl: change?.value?.post?.permalink_url || null,
                };

                // Log the comment data in a cleaner format
                console.log(
                  "Processing comment:",
                  JSON.stringify(commentData, null, 2)
                );

                // Deduplication and update logic for media/text comments
                const existingComment = await Comment.findOne({
                  commentId: commentData.commentId,
                });

                console.log(existingComment, "existing comment");

                if (existingComment) {
                  // If the existing comment is a media comment and the new event has a real message, update it
                  if (
                    existingComment.message === "[Media Comment]" &&
                    change.value.message
                  ) {
                    existingComment.message = change.value.message;
                    existingComment.permalinkUrl = commentData.permalinkUrl;
                    existingComment.createdAt = commentData.createdAt;
                    await existingComment.save();
                    console.log(
                      `Updated media comment to text comment for commentId: ${commentData.commentId}`
                    );
                    // Emit the updated comment event
                    const cleanCommentData = {
                      ...existingComment.toObject(),
                      _id: existingComment._id.toString(),
                      createdAt: existingComment.createdAt.toISOString(),
                      updatedAt: existingComment.updatedAt.toISOString(),
                    };
                    io.emit("new-comment", {
                      type: "new-comment",
                      data: cleanCommentData,
                    });
                  } else {
                    // If already exists and not a media comment, skip saving
                    console.log(
                      `Duplicate comment detected for commentId: ${commentData.commentId}, skipping save.`
                    );
                  }
                  continue;
                }

                if (keywordReply) {
                  console.log("find");
                  try {
                    let replyText = keywordReply.replyText;

                    // Extract and replace variables in reply text
                    const emailMatch = commentText.match(emailRegex);
                    const phoneMatch = commentText.match(phoneRegex);

                    if (emailMatch) {
                      replyText = replyText.replace("{{email}}", emailMatch[0]);
                    }
                    if (phoneMatch) {
                      replyText = replyText.replace(
                        "{{phone_number}}",
                        phoneMatch[0]
                      );
                    }

                    const response = await axios.post(
                      `https://graph.facebook.com/v18.0/${change.value.comment_id}/comments`,
                      {
                        message: replyText,
                        access_token: page.access_token,
                      }
                    );
                    console.log(
                      `Keyword-based reply sent to comment ${change.value.comment_id}`
                    );

                    commentData.autoReply = {
                      message: replyText,
                      createdAt: new Date(),
                      replyId: response.data.id,
                    };

                    console.log("Comment updated with reply");
                  } catch (error) {
                    console.error(
                      "Error sending keyword-based reply:",
                      error.response?.data
                    );
                  }
                } else {
                  // Handle no match action
                  const noMatchAction =
                    pageSettings?.settings?.noMatchAction || "none";

                  if (noMatchAction === "hide") {
                    // Hide the comment
                    try {
                      await axios.post(
                        `https://graph.facebook.com/v18.0/${
                          change.value.comment_id ||
                          change.value.photo_id ||
                          change.value.video_id
                        }`,
                        {
                          is_hidden: true,
                          access_token: page.access_token,
                        }
                      );
                      commentData.isHidden = true;
                      commentData.hideReason = "no_keyword_match";
                      console.log(
                        `Comment ${change.value.comment_id} hidden due to no keyword match`
                      );
                    } catch (error) {
                      console.error(
                        "Error hiding comment:",
                        error.response?.data
                      );
                    }
                  } else if (noMatchAction === "defaultComment") {
                    // Reply with default text
                    try {
                      const defaultReplyText =
                        pageSettings?.settings?.defaultReplyText ||
                        "Thanks for comment";
                      const response = await axios.post(
                        `https://graph.facebook.com/v18.0/${change.value.comment_id}/comments`,
                        {
                          message: defaultReplyText,
                          access_token: page.access_token,
                        }
                      );

                      // Add the auto-reply data to the comment
                      commentData.autoReply = {
                        message: defaultReplyText,
                        createdAt: new Date(),
                        replyId: response.data.id,
                      };

                      console.log(
                        `Default reply sent to comment ${change.value.comment_id} due to no keyword match`
                      );
                    } catch (error) {
                      console.error(
                        "Error sending default reply:",
                        error.response?.data
                      );
                    }
                  }
                  // If noMatchAction is 'none', do nothing
                }

                // Add AI sentiment analysis
                let shouldHideByAI = false;
                if (pageSettings?.settings?.hideByAI) {
                  console.log(pageSettings?.settings?.hideByAI, "ai");
                  try {
                    const sentimentPipe = await initializeSentimentPipeline();
                    const sentiment = await sentimentPipe(
                      change?.value?.message || "null"
                    );
                    const negativeThreshold = 0.93;
                    shouldHideByAI = sentiment[0].score > negativeThreshold;
                    console.log("AI Sentiment Analysis:", {
                      message: change?.value?.message,
                      sentiment: sentiment[0],
                      shouldHide: shouldHideByAI,
                    });
                  } catch (error) {
                    console.error("Error in sentiment analysis:", error);
                  }
                }

                // Update the hide logic to include AI-based hiding
                if (pageSettings?.settings?.hideAll || shouldHideByAI) {
                  const maxRetries = 3;
                  let retryCount = 0;
                  let hideSuccess = false;

                  while (retryCount < maxRetries && !hideSuccess) {
                    try {
                      await axios.post(
                        `https://graph.facebook.com/v18.0/${change.value.comment_id}`,
                        {
                          is_hidden: true,
                          access_token: page.access_token,
                        }
                      );
                      commentData.isHidden = true;
                      hideSuccess = true;
                    } catch (error) {
                      // Check for duplicate spam marking error
                      const isDuplicateSpamError =
                        error.response?.data?.error?.error_subcode === 1446036;

                      if (isDuplicateSpamError) {
                        commentData.isHidden = true;
                        hideSuccess = true;
                      } else {
                        retryCount++;

                        if (retryCount < maxRetries) {
                          // Exponential backoff
                          await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, retryCount) * 1000)
                          );
                        } else {
                          console.error(
                            "Error hiding comment after all retries:",
                            error.response?.data
                          );
                        }
                      }
                    }
                  }

                  // If we couldn't hide the comment after all retries, try an alternative method
                  if (!hideSuccess) {
                    try {
                      // Try to mark as spam instead of hiding
                      await axios.post(
                        `https://graph.facebook.com/v18.0/${change.value.comment_id}`,
                        {
                          is_spam: true,
                          access_token: page.access_token,
                        }
                      );
                      commentData.isHidden = true;
                    } catch (spamError) {
                      console.error(
                        "Error marking comment as spam:",
                        spamError.response?.data
                      );
                    }
                  }
                }

                // Process auto-reply logic
                if (pageSettings?.settings?.autoReply) {
                  try {
                    const replyMessage =
                      pageSettings.settings.defaultReplyText ||
                      "Thanks for your comment!";
                    const response = await axios.post(
                      `https://graph.facebook.com/v18.0/${change.value.comment_id}/comments`,
                      {
                        message: replyMessage,
                        access_token: page.access_token,
                      }
                    );
                    commentData.autoReply = {
                      message: replyMessage,
                      createdAt: new Date(),
                    };
                    console.log(
                      `Auto-reply sent to comment ${change.value.comment_id}`
                    );
                  } catch (error) {
                    console.error(
                      "Error sending auto-reply:",
                      error.response?.data
                    );
                  }
                }

                // Save the comment to our database regardless of the action taken
                const comment = new Comment(commentData);
                await comment.save();

                // Emit the new comment event with clean data
                const cleanCommentData = {
                  ...comment.toObject(),
                  _id: comment._id.toString(),
                  createdAt: comment.createdAt.toISOString(),
                  updatedAt: comment.updatedAt.toISOString(),
                };

                console.log(
                  "Emitting new-comment event:",
                  JSON.stringify(cleanCommentData, null, 2)
                );
                io.emit("new-comment", {
                  type: "new-comment",
                  data: cleanCommentData,
                });
              }
            } catch (error) {
              console.error("Error processing comment:", error);
            }
          } else {
            console.log(
              `Skipping non-comment or non-add event: ${value?.item} - ${value?.verb}`
            );
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
};
