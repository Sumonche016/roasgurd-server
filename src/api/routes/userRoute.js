import express from "express";
import {
  signup,
  login,
  allUser,
  userById,
  updateUser,
  deleteUser,
  resetPassword,
  saveFacebookToken,
  getUserPages,
  getPageComments,
  getPageAdAccounts,
  getBusinessAdAccounts,
  getAdAccountEngagements,
  getEngagementComments,
  addPageToDashboard,
  getAddedPage,
  hideCommentsByKeywords,
  hideAllComments,
  toggleCommentMonitoring,
  updateMonitoringSettings,
  getDefaultReplyText,
  updateDefaultReplyText,
  updateSelectedPage,
  getSelectedPage,
  getKeywords,
  updateKeywords,
  deductBalance,
  checkBalance,
  requestCancelSubscription,
} from "../controllers/userController.js";
import verifyToken from "../../middleware/authMiddleware.js";
import {
  updatePageSettings,
  getKeywordReplies,
  updateKeywordReplies,
  addKeywordReply,
  deleteKeywordReply,
  updateNoMatchAction,
} from "../controllers/pageSettingsController.js";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/all-user", allUser);
router.get("/:userId", userById);
router.patch("/:id", verifyToken, updateUser);
router.delete("/:id", verifyToken, deleteUser);
router.post("/reset-password", resetPassword);
router.post("/save-facebook-token", saveFacebookToken);
router.get("/:userId/pages", getUserPages);
router.get("/page-comments/:pageId", verifyToken, getPageComments);
router.get("/page-ad-accounts/:pageId", verifyToken, getPageAdAccounts);
router.get(
  "/business-ad-accounts/:businessId",
  verifyToken,
  getBusinessAdAccounts
);
router.get(
  "/ad-account-engagements/:accountId",
  verifyToken,
  getAdAccountEngagements
);
router.get(
  "/engagement-comments/:creativeId",
  verifyToken,
  getEngagementComments
);
router.post("/:userId/add-page", verifyToken, addPageToDashboard);
router.get("/:userId/added-page", verifyToken, getAddedPage);
router.post(
  "/hide-comments-by-keywords/:userId",
  verifyToken,
  hideCommentsByKeywords
);
router.post("/hide-all-comments", verifyToken, hideAllComments);
router.post("/:userId/toggle-monitoring", verifyToken, toggleCommentMonitoring);
router.post(
  "/:userId/monitoring-settings",
  verifyToken,
  updateMonitoringSettings
);
// router.post("/hide-comment/:commentId", verifyToken, hideComment);
// router.post("/reply-comment/:commentId", verifyToken, replyToComment);
// router.post("/unhide-comment/:commentId", verifyToken, unhideComment);

router.get("/default-reply/:userId", verifyToken, getDefaultReplyText);
router.put("/default-reply", verifyToken, updateDefaultReplyText);

//new code
router.patch("/:userId/page-settings/:pageId", updatePageSettings);
router.patch("/:userId/selected-page", updateSelectedPage);
router.get("/:userId/selected-page", getSelectedPage);

router.get("/keywords/:userId", verifyToken, getKeywords);
router.put("/keywords", verifyToken, updateKeywords);

// Keyword Reply Routes
router.get(
  "/:userId/page-settings/:pageId/keyword-replies",
  verifyToken,
  getKeywordReplies
);
router.put(
  "/:userId/page-settings/:pageId/keyword-replies",
  verifyToken,
  updateKeywordReplies
);
router.post(
  "/:userId/page-settings/:pageId/keyword-reply",
  verifyToken,
  addKeywordReply
);
router.delete(
  "/:userId/page-settings/:pageId/keyword-reply/:keyword",
  verifyToken,
  deleteKeywordReply
);

router.patch(
  "/:userId/page-settings/:pageId/no-match-action",
  updateNoMatchAction
);

// Balance management routes
router.get("/:userId/check-balance", verifyToken, checkBalance);
router.post("/:userId/deduct-balance", verifyToken, deductBalance);

// Cancel subscription request
router.post("/:id/cancel-subscription-request", verifyToken, requestCancelSubscription);

export default router;
