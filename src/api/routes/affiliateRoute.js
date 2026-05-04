import express from "express";
import {
  affiliateSignup,
  affiliateLogin,
  getAffiliateProfile,
  getAllReferredUsers,
  getSpecificReferredUser,
} from "../controllers/affiliateController.js";
import verifyToken from "../../middleware/authMiddleware.js";

const router = express.Router();

router.post("/signup", affiliateSignup);
router.post("/login", affiliateLogin);
router.get("/profile", verifyToken, getAffiliateProfile);
router.get("/referred-users", verifyToken, getAllReferredUsers);
router.get("/referred-users/:userId", verifyToken, getSpecificReferredUser);

export default router;
