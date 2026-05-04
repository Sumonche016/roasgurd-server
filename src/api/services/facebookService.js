import axios from "axios";
import properties from "../../config/properties.js";
import { FACEBOOK_CONFIG } from "../../config/facebook.js";
import pageToken from "../models/pageToken.js";

export const getFacebookAuthUrl = (userId) => {
  const redirectUri = encodeURIComponent(
    `${properties.BASE_URL}/facebook/callback`
  );
  const state = encodeURIComponent(userId);

  return `https://www.facebook.com/${FACEBOOK_CONFIG.API_VERSION}/dialog/oauth?client_id=${FACEBOOK_CONFIG.APP_ID}&redirect_uri=${redirectUri}&scope=${FACEBOOK_CONFIG.SCOPE}&state=${state}`;
};

export const exchangeCodeForToken = async (code) => {
  const tokenUrl = `https://graph.facebook.com/${FACEBOOK_CONFIG.API_VERSION}/oauth/access_token`;
  const response = await axios.get(tokenUrl, {
    params: {
      client_id: FACEBOOK_CONFIG.APP_ID,
      client_secret: FACEBOOK_CONFIG.APP_SECRET,
      redirect_uri: `${properties.BASE_URL}/facebook/callback`,
      code,
    },
  });
  return response.data.access_token;
};

export const getPages = async (userAccessToken) => {
  const response = await axios.get(
    `https://graph.facebook.com/${FACEBOOK_CONFIG.API_VERSION}/me/accounts`,
    {
      params: { access_token: userAccessToken },
    }
  );

  // Store pages in database
  const pages = response.data.data;
  for (const page of pages) {
    await pageToken.findOneAndUpdate(
      { pageId: page.id },
      {
        pageId: page.id,
        pageName: page.name,
        accessToken: page.access_token,
      },
      { upsert: true }
    );
  }

  return pages;
};

export const subscribePageToWebhook = async (pageId, pageAccessToken) => {
  await axios.post(
    `https://graph.facebook.com/${FACEBOOK_CONFIG.API_VERSION}/${pageId}/subscribed_apps`,
    {
      access_token: pageAccessToken,
      subscribed_fields: "feed",
    }
  );
};

export const getLongLivedUserToken = async (shortLivedToken) => {
  const response = await axios.get(
    `https://graph.facebook.com/${FACEBOOK_CONFIG.API_VERSION}/oauth/access_token`,
    {
      params: {
        grant_type: "fb_exchange_token",
        client_id: FACEBOOK_CONFIG.APP_ID,
        client_secret: FACEBOOK_CONFIG.APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    }
  );
  return response.data.access_token;
};
