import mongoose from "mongoose";

const pageTokenSchema = new mongoose.Schema({
  fbUserId: {
    type: String,
    required: true,
  },
  pageId: {
    type: String,
    required: true,
  },
  pageName: {
    type: String,
    required: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

pageTokenSchema.index({ fbUserId: 1, pageId: 1 }, { unique: true });

const PageToken = mongoose.model("PageToken", pageTokenSchema);

// Drop the old single-field unique index on pageId (from before pages were
// scoped per Facebook account) and create the new compound index above.
PageToken.syncIndexes();

export default PageToken;
