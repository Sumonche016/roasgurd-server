import express from "express";
import {
  getComments,
  hideComment,
  unhideComment,
  replyToComment,
} from "../controllers/commentController.js";
import verifyToken from "../../middleware/authMiddleware.js";

const router = express.Router();

router.get("/:pageId", getComments);

router.post("/hide/:commentId", verifyToken, hideComment);
router.post("/unhide/:commentId", verifyToken, unhideComment);
router.post("/reply/:commentId", verifyToken, replyToComment);

export default router;
