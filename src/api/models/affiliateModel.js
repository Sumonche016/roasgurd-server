import mongoose from "mongoose";
import crypto from "crypto";

const affiliateSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    referralCode: { type: String, unique: true, sparse: true },

    userType: { type: String, default: "affiliator", required: true },
  },
  {
    timestamps: true,
  }
);

const Affiliate = mongoose.model("Affiliate", affiliateSchema);

export default Affiliate;
