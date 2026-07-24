import express from "express";
import {
  loginHandler,
  callbackHandler,
  getPagesHandler,
  testSubscribeHandler,
  checkSubscribeHandler,
  listAccountsHandler,
  deleteAccountHandler,
  setPrimaryAccountHandler,
} from "../controllers/facebookController.js";

const router = express.Router();

router.get("/login", loginHandler);
router.get("/callback", callbackHandler);
router.get("/pages", getPagesHandler);
router.get("/accounts", listAccountsHandler);
router.delete("/:userId/accounts/:fbUserId", deleteAccountHandler);
router.patch("/:userId/accounts/:fbUserId/primary", setPrimaryAccountHandler);
router.get("/test-subscribe/:pageId", testSubscribeHandler);
router.get("/check-subscribe/:pageId", checkSubscribeHandler);

export default router;
