import {
  getFacebookAuthUrl,
  exchangeCodeForToken,
  getLongLivedUserToken,
  getPages,
} from "../services/facebookService.js";
import properties from "../../config/properties.js";
import User from "../models/userModels.js";
import axios from "axios";

export const loginHandler = async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }
  const authUrl = getFacebookAuthUrl(userId);
  res.redirect(authUrl);
};

export const callbackHandler = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      throw new Error("No authorization code received");
    }
    if (!state) {
      throw new Error("No state parameter provided");
    }

    const userId = decodeURIComponent(state);

    const shortLivedToken = await exchangeCodeForToken(code);

    // Exchange for long-lived token
    const longLivedToken = await getLongLivedUserToken(shortLivedToken);

    // Fetch and store pages
    const pages = await getPages(longLivedToken);

    // Subscribe each page to webhooks before saving
    for (const page of pages) {
      try {
        await axios.post(
          `https://graph.facebook.com/${page.id}/subscribed_apps`,
          {
            subscribed_fields: ["feed"],
            access_token: page.access_token, // Use page access token
          }
        );
        console.log(
          `Successfully subscribed to webhooks for page: ${page.name}`
        );
      } catch (error) {
        console.error(
          `Failed to subscribe webhooks for page ${page.name}:`,
          error.response?.data || error
        );
        // Continue with other pages even if one fails
      }
    }

    // Get existing user data to preserve settings
    const existingUser = await User.findById(userId);
    const existingPageSettings = existingUser?.pageSettings || [];

    // Create a map of existing page settings for easy lookup
    const existingSettingsMap = new Map(
      existingPageSettings.map((page) => [page.pageId, page])
    );

    // Merge new pages with existing settings
    const mergedPageSettings = pages.map((page) => {
      const existingPage = existingSettingsMap.get(page.id);
      return {
        pageId: page.id,
        pageName: page.name,
        settings: existingPage?.settings || {
          hideByKeyword: false,
          hideAll: false,
          hideByAI: false,
          autoReply: false,
        },
      };
    });

    await User.findByIdAndUpdate(userId, {
      accessToken: longLivedToken,
      pageSettings: mergedPageSettings,
    });

    res.redirect(`${properties.FRONTEND_URL}?success=true`);
  } catch (error) {
    console.error("Facebook authentication failed:", error);
    res.redirect(
      `${properties.FRONTEND_URL}?error=${encodeURIComponent(error.message)}`
    );
  }
};

export const getPagesHandler = async (req, res) => {
  try {
    const userId = req.query.userId; // Add userId parameter to the request
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user || !user.pageSettings) {
      return res.json([]);
    }

    res.json(user.pageSettings);
  } catch (error) {
    console.error("Failed to fetch pages:", error);
    res.status(500).json({ error: "Failed to fetch pages" });
  }
};

export const testSubscribeHandler = async (req, res) => {
  const { pageId } = req.params;
  const { access_token } = req.query;

  if (!access_token) {
    return res.status(400).json({ error: "Access token is required" });
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${pageId}/subscribed_apps`,
      {
        subscribed_fields: ["feed"],
        access_token,
      }
    );

    console.log("Subscription response:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("Subscription error:", error.response?.data || error);
    res.status(500).json(error.response?.data || error);
  }
};

export const checkSubscribeHandler = async (req, res) => {
  const { pageId } = req.params;
  const { access_token } = req.query;

  if (!access_token) {
    return res.status(400).json({ error: "Access token is required" });
  }

  try {
    const response = await axios.get(
      `https://graph.facebook.com/${pageId}/subscribed_apps`,
      {
        params: { access_token },
      }
    );

    console.log("Subscription status:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("Status check error:", error.response?.data || error);
    res.status(500).json(error.response?.data || error);
  }
};
