import {
  getFacebookAuthUrl,
  exchangeCodeForToken,
  getLongLivedUserToken,
  getFacebookProfile,
  getPages,
} from "../services/facebookService.js";
import properties from "../../config/properties.js";
import User from "../models/userModels.js";
import axios from "axios";

export const loginHandler = async (req, res) => {
  const { userId, mode } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }
  // mode=add forces Facebook to prompt for login/account choice instead of
  // silently reusing whatever FB account is already active in the browser.
  const state = encodeURIComponent(JSON.stringify({ userId, mode }));
  const authUrl = getFacebookAuthUrl(state, mode);
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

    const { userId } = JSON.parse(decodeURIComponent(state));

    const shortLivedToken = await exchangeCodeForToken(code);

    // Exchange for long-lived token
    const longLivedToken = await getLongLivedUserToken(shortLivedToken);

    // Identify which Facebook account just logged in
    const fbProfile = await getFacebookProfile(longLivedToken);
    const fbUserId = fbProfile.id;
    const fbName = fbProfile.name;

    const existingUser = await User.findById(userId);
    if (!existingUser) {
      throw new Error("User not found");
    }

    const isNewAccount = !existingUser.facebookAccounts.some(
      (a) => a.fbUserId === fbUserId
    );

    if (
      isNewAccount &&
      existingUser.facebookAccounts.length >=
        (existingUser.maxFacebookAccounts || 1)
    ) {
      return res.redirect(
        `${properties.FRONTEND_URL}?error=${encodeURIComponent(
          "Facebook account limit reached. Ask your admin to increase your limit."
        )}`
      );
    }

    // Fetch and store pages for this Facebook account only
    const pages = await getPages(longLivedToken, fbUserId);

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

    // A page can only belong to one connected Facebook account. If a page
    // returned by this login already belongs to a different account on this
    // user, leave it there and skip re-assigning it here.
    const pagesOwnedElsewhere = new Set(
      existingUser.pageSettings
        .filter((p) => p.fbUserId && p.fbUserId !== fbUserId)
        .map((p) => p.pageId)
    );

    const existingSettingsMap = new Map(
      existingUser.pageSettings.map((page) => [page.pageId, page])
    );

    const thisAccountPageSettings = pages
      .filter((page) => !pagesOwnedElsewhere.has(page.id))
      .map((page) => {
        const existingPage = existingSettingsMap.get(page.id);
        return {
          pageId: page.id,
          pageName: page.name,
          fbUserId,
          settings: existingPage?.settings || {
            hideByKeyword: false,
            hideAll: false,
            hideByAI: false,
            autoReply: false,
          },
        };
      });

    // Keep pages belonging to other accounts untouched, replace only this
    // account's pages with the freshly fetched set.
    const otherAccountsPageSettings = existingUser.pageSettings.filter(
      (p) => p.fbUserId && p.fbUserId !== fbUserId
    );

    const mergedPageSettings = [
      ...otherAccountsPageSettings,
      ...thisAccountPageSettings,
    ];

    const accountIndex = existingUser.facebookAccounts.findIndex(
      (a) => a.fbUserId === fbUserId
    );

    if (accountIndex === -1) {
      existingUser.facebookAccounts.push({
        fbUserId,
        fbName,
        accessToken: longLivedToken,
        isPrimary: existingUser.facebookAccounts.length === 0,
      });
    } else {
      existingUser.facebookAccounts[accountIndex].accessToken = longLivedToken;
      existingUser.facebookAccounts[accountIndex].fbName = fbName;
    }

    existingUser.pageSettings = mergedPageSettings;
    await existingUser.save();

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
    const { userId, accountId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user || !user.pageSettings) {
      return res.json([]);
    }

    const pages = accountId
      ? user.pageSettings.filter((p) => p.fbUserId === accountId)
      : user.pageSettings;

    res.json(pages);
  } catch (error) {
    console.error("Failed to fetch pages:", error);
    res.status(500).json({ error: "Failed to fetch pages" });
  }
};

export const listAccountsHandler = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const accounts = user.facebookAccounts.map((a) => ({
      fbUserId: a.fbUserId,
      fbName: a.fbName,
      isPrimary: a.isPrimary,
    }));

    res.json(accounts);
  } catch (error) {
    console.error("Failed to list facebook accounts:", error);
    res.status(500).json({ error: "Failed to list facebook accounts" });
  }
};

export const deleteAccountHandler = async (req, res) => {
  try {
    const { userId, fbUserId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.facebookAccounts = user.facebookAccounts.filter(
      (a) => a.fbUserId !== fbUserId
    );
    user.pageSettings = user.pageSettings.filter(
      (p) => p.fbUserId !== fbUserId
    );

    await user.save();
    res.json({ message: "Facebook account removed" });
  } catch (error) {
    console.error("Failed to delete facebook account:", error);
    res.status(500).json({ error: "Failed to delete facebook account" });
  }
};

export const setPrimaryAccountHandler = async (req, res) => {
  try {
    const { userId, fbUserId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const targetExists = user.facebookAccounts.some(
      (a) => a.fbUserId === fbUserId
    );
    if (!targetExists) {
      return res.status(404).json({ error: "Facebook account not found" });
    }

    user.facebookAccounts.forEach((a) => {
      a.isPrimary = a.fbUserId === fbUserId;
    });

    await user.save();
    res.json({ message: "Primary facebook account updated" });
  } catch (error) {
    console.error("Failed to set primary facebook account:", error);
    res.status(500).json({ error: "Failed to set primary facebook account" });
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
