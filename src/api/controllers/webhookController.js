import { FACEBOOK_CONFIG } from "../../config/facebook.js";

import { io } from "../../server.js";
import axios from "axios";
import User from "../models/userModels.js";
import { getPages } from "../services/facebookService.js";
import { pipeline } from "@huggingface/transformers";
import Comment from "../models/commentModel.js";
import Logger from "../models/loggerModel.js";

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

            // Log initial webhook processing
            await Logger.create({
              userId: user?._id,
              userEmail: user?.email,
              pageId: pageId,
              action: "webhook_processing_start",
              details: {
                eventType: value?.item || change?.item,
                verb: value?.verb,
                commentId: change.value.comment_id,
                message: change.value.message,
                from: change.value.from,
              },
              status: "info",
            });

            // Skip automation logic for reactions
            if (value?.item === "reaction") {
              console.log("Skipping automation for reaction event");
              await Logger.create({
                userId: user._id,
                userEmail: user.email,
                pageId: pageId,
                action: "webhook_reaction-received",
                details: {
                  eventType: value?.item || change?.item,
                  verb: value?.verb,
                  commentId: change.value.comment_id,
                  message: `${change.value.reaction_type} reaction received`,
                },
                status: "info",
              });
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
                await Logger.create({
                  userId: user?._id,
                  userEmail: user?.email,
                  pageId: pageId,
                  action: "webhook_page_comment_skipped",
                  details: {
                    commentId: change.value.comment_id,
                    reason: "Comment from page itself",
                  },
                  status: "info",
                });
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
                  await Logger.create({
                    userId: user._id,
                    userEmail: user.email,
                    pageId: pageId,
                    action: "webhook_error",
                    details: {
                      error: "No page access token found",
                      pageId: pageId,
                    },
                    status: "error",
                  });
                  throw new Error(
                    `No page access token found for page ${pageId}`
                  );
                }

                // Log page settings for debugging
                await Logger.create({
                  userId: user._id,
                  userEmail: user.email,
                  pageId: pageId,
                  action: "webhook_page_settings",
                  details: {
                    hideAll: pageSettings?.settings?.hideAll,
                    hideByAI: pageSettings?.settings?.hideByAI,
                    noMatchAction: pageSettings?.settings?.noMatchAction,
                    hasKeywords: !!pageSettings?.settings?.keywords?.length,
                    hasKeywordReplies:
                      !!pageSettings?.settings?.keywordReplies?.length,
                  },
                  status: "info",
                });

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

                    // Log successful keyword reply
                    await Logger.create({
                      userId: user._id,
                      userEmail: user.email,
                      pageId: pageId,
                      action: "keyword_reply_sent",
                      details: {
                        commentId: change.value.comment_id,
                        replyText: replyText,
                        matchedKeyword: keywordReply.keywords,
                      },
                      status: "success",
                    });

                    // // Update the existing comment instead of creating a new one
                    // await Comment.findOneAndUpdate(
                    //   { commentId: change.value.comment_id },
                    //   {
                    //     $set: {
                    //       autoReply: {
                    //         message: replyText,
                    //         createdAt: new Date(),
                    //       },
                    //     },
                    //   },
                    //   { upsert: true }
                    // );

                    commentData.autoReply = {
                      message: replyText,
                      createdAt: new Date(),
                      replyId: response.data.id, // Store Facebook's reply ID
                    };

                    console.log("Comment updated with reply");
                  } catch (error) {
                    // Log error in keyword reply
                    await Logger.create({
                      userId: user._id,
                      userEmail: user.email,
                      pageId: pageId,
                      action: "keyword_reply_error",
                      details: {
                        commentId: change.value.comment_id,
                        error: error.message,
                      },
                      status: "error",
                    });
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

                      // Log successful hide
                      await Logger.create({
                        userId: user._id,
                        userEmail: user.email,
                        pageId: pageId,
                        action: "comment_hidden",
                        details: {
                          commentId: change.value.comment_id,
                          reason: "no_keyword_match",
                        },
                        status: "success",
                      });
                    } catch (error) {
                      // Log hide error
                      await Logger.create({
                        userId: user._id,
                        userEmail: user.email,
                        pageId: pageId,
                        action: "hide_error",
                        details: {
                          commentId: change.value.comment_id,
                          error: error.message,
                        },
                        status: "error",
                      });
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
                        replyId: response.data.id, // Store Facebook's reply ID
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
                      const hideResponse = await axios.post(
                        `https://graph.facebook.com/v18.0/${change.value.comment_id}`,
                        {
                          is_hidden: true,
                          access_token: page.access_token,
                        }
                      );
                      commentData.isHidden = true;
                      hideSuccess = true;

                      await Logger.create({
                        userId: user._id,
                        userEmail: user.email,
                        pageId: pageId,
                        action: "comment_hide_success",
                        details: {
                          commentId: change.value.comment_id,
                          reason: shouldHideByAI
                            ? "AI sentiment"
                            : "hideAll setting",
                          response: hideResponse.data,
                          attempt: retryCount + 1,
                        },
                        status: "success",
                      });
                    } catch (error) {
                      // Check for duplicate spam marking error
                      const isDuplicateSpamError =
                        error.response?.data?.error?.error_subcode === 1446036;

                      if (isDuplicateSpamError) {
                        // If it's already marked as spam, we'll consider this a success
                        commentData.isHidden = true;
                        hideSuccess = true;
                        await Logger.create({
                          userId: user._id,
                          userEmail: user.email,
                          pageId: pageId,
                          action: "comment_already_hidden",
                          details: {
                            commentId: change.value.comment_id,
                            reason: "Comment was already marked as spam",
                            originalError: error.response?.data?.error,
                            attempt: retryCount + 1,
                          },
                          status: "info",
                        });
                      } else {
                        retryCount++;

                        // Log the retry attempt
                        await Logger.create({
                          userId: user._id,
                          userEmail: user.email,
                          pageId: pageId,
                          action: "comment_hide_retry",
                          details: {
                            commentId: change.value.comment_id,
                            attempt: retryCount,
                            maxRetries: maxRetries,
                            error: error.response?.data || error.message,
                            errorCode: error.response?.status,
                            errorSubcode:
                              error.response?.data?.error?.error_subcode,
                            errorType: error.response?.data?.error?.type,
                            errorMessage: error.response?.data?.error?.message,
                          },
                          status: retryCount < maxRetries ? "warning" : "error",
                        });

                        if (retryCount < maxRetries) {
                          // Wait for a short time before retrying (exponential backoff)
                          await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, retryCount) * 1000)
                          );
                        } else {
                          // Final failure after all retries
                          await Logger.create({
                            userId: user._id,
                            userEmail: user.email,
                            pageId: pageId,
                            action: "comment_hide_failed",
                            details: {
                              commentId: change.value.comment_id,
                              reason: shouldHideByAI
                                ? "AI sentiment"
                                : "hideAll setting",
                              error: error.response?.data || error.message,
                              errorCode: error.response?.status,
                              errorSubcode:
                                error.response?.data?.error?.error_subcode,
                              errorType: error.response?.data?.error?.type,
                              errorMessage:
                                error.response?.data?.error?.message,
                              attempts: retryCount,
                            },
                            status: "error",
                          });
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
                      const spamResponse = await axios.post(
                        `https://graph.facebook.com/v18.0/${change.value.comment_id}`,
                        {
                          is_spam: true,
                          access_token: page.access_token,
                        }
                      );
                      commentData.isHidden = true;

                      await Logger.create({
                        userId: user._id,
                        userEmail: user.email,
                        pageId: pageId,
                        action: "comment_marked_spam",
                        details: {
                          commentId: change.value.comment_id,
                          reason: "Fallback method after hide failed",
                          response: spamResponse.data,
                        },
                        status: "success",
                      });
                    } catch (spamError) {
                      await Logger.create({
                        userId: user._id,
                        userEmail: user.email,
                        pageId: pageId,
                        action: "comment_spam_failed",
                        details: {
                          commentId: change.value.comment_id,
                          error: spamError.response?.data || spamError.message,
                        },
                        status: "error",
                      });
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

                // Log successful comment save
                await Logger.create({
                  userId: user._id,
                  userEmail: user.email,
                  pageId: pageId,
                  action: "comment_saved",
                  details: {
                    commentId: commentData.commentId,
                    isHidden: commentData.isHidden,
                    hasAutoReply: !!commentData.autoReply,
                  },
                  status: "success",
                });

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
              await Logger.create({
                userId: user?._id,
                userEmail: user?.email,
                pageId: pageId,
                action: "webhook_processing_error",
                details: {
                  error: error.message,
                  stack: error.stack,
                  commentId: change.value.comment_id,
                },
                status: "error",
              });
              console.error("Error processing comment:", error);
            }
          } else {
            await Logger.create({
              pageId: pageId,
              action: "webhook_skipped",
              details: {
                reason: "Non-comment or non-add event",
                eventType: value?.item,
                verb: value?.verb,
              },
              status: "info",
            });
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
