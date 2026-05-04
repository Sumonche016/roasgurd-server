import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    accessToken: String,
    // User roles
    isCommentEnabled: { type: Boolean, default: false },
    customUsd: { type: Number, default: 0 },
    isAdmin: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: true },
    paused: { type: Boolean, default: false },
    referralCode: { type: String, default: "" },
    referralWebsite: { type: String, default: "" },
    // Payment information
    paid: { type: Boolean, default: false },
    paymentDate: { type: Date },
    paidPlan: {
      type: Number,
      enum: [0, 29, 49, 99],
      default: 0,
    },

    // Subscription details
    isSubscribed: { type: Boolean, default: false },
    subscriptionStartDate: { type: Date },
    subscriptionEndDate: { type: Date },
    cancelSubscriptionRequest: { type: Boolean, default: false },
    cancelSubscriptionRequestDate: { type: Date },

    selectedPage: {
      pageId: String,
      pageName: String,
      accessToken: String,
    },

    pageSettings: [
      {
        pageId: { type: String, required: true },
        pageName: { type: String, required: true },
        settings: {
          hideByKeyword: { type: Boolean, default: false },
          hideAll: { type: Boolean, default: false },
          hideByAI: { type: Boolean, default: false },
          autoReply: { type: Boolean, default: false },
          keywords: [String],
          defaultReplyText: { type: String, default: "Thanks for comment" },
          keywordReplies: [
            {
              keywords: [{ type: String, required: true }],
              replyText: { type: String, required: true },
            },
          ],
          noMatchAction: {
            type: String,
            enum: ["hide", "defaultComment", "none"],
            default: "none",
          },
        },
      },
    ],

    // Balance history for tracking deductions
  },
  {
    timestamps: true,
  }
);

// Add this method to the schema
userSchema.methods.canSaveDomain = function () {
  return this.isApproved || this.isAdmin;
};

const User = mongoose.model("User", userSchema);

// Ensure indexes are created/updated
User.syncIndexes();

export default User;
