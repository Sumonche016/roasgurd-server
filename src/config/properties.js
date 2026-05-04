import dotenv from "dotenv";

dotenv.config();

const properties = {
  PORT: process.env.PORT || 5000,
  BASE_URL: "https://1b3c-103-131-101-73.ngrok-free.app",
  FACEBOOK_APP_ID: "1494419285522933",
  FACEBOOK_APP_SECRET: "ddcafc14420096fa9073dad831e6b0b4",
  MONGO_URI:
    process.env.MONGO_URI ||
    `mongodb+srv://sumonche016_db_user:qmzFHqew58xg6VwQ@cluster0.smuznny.mongodb.net/?appName=Cluster0`,
  SERVER_URL: process.env.SERVER_URL || ``,
  FRONTEND_URL: "https://localhost:5173",
};
export default properties;
