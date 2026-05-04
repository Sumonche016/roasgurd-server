import dotenv from "dotenv";

dotenv.config();

const properties = {
  PORT: process.env.PORT || 5001,
  BASE_URL: "https://server.roasguard.com",
  FACEBOOK_APP_ID: "1494419285522933",
  FACEBOOK_APP_SECRET: "ddcafc14420096fa9073dad831e6b0b4",
  MONGO_URI:
    process.env.MONGO_URI ||
    `mongodb+srv://sumonche016_db_user:qmzFHqew58xg6VwQ@cluster0.smuznny.mongodb.net/?appName=Cluster0`,
  SERVER_URL: process.env.SERVER_URL || `https://server.roasguard.com`,
  FRONTEND_URL: "https://app.roasguard.com",
};
export default properties;
