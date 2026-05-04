import express from "express";
import {
  loginHandler,
  callbackHandler,
  getPagesHandler,
  testSubscribeHandler,
  checkSubscribeHandler,
} from "../controllers/facebookController.js";

const router = express.Router();

router.get("/login", loginHandler);
router.get("/callback", callbackHandler);
router.get("/pages", getPagesHandler);
router.get("/test-subscribe/:pageId", testSubscribeHandler);
router.get("/check-subscribe/:pageId", checkSubscribeHandler);

export default router;
