import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/test-subscribe/:pageId", async (req, res) => {
  const pageId = req.params.pageId;
  const accessToken =
    "EAAPjdmIgobwBOw2KQZCUvVekV73NYvVDuTgauYFwrxZACBiVtTyMMAAnVURZBSbOGzQWH03HqWHZCK5u6Yy3SDCtgrdyAH7VdIZAUl04b4ZBz7iTAX7EqshA4fNRMTyUWzztBRz6DCqZA2dn8qgjZAIQ8IQO4fIntNcx82OmxNDoLpTwSVEsnucBDHglEjjxjYZAL";

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${pageId}/subscribed_apps`,
      {
        subscribed_fields: ["feed"],
        access_token: accessToken,
      }
    );

    console.log("Subscription response:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("Subscription error:", error.response?.data || error);
    res.status(500).json(error.response?.data || error);
  }
});

router.get("/check-subscribe/:pageId", async (req, res) => {
  const pageId = req.params.pageId;
  const accessToken =
    "EAAPjdmIgobwBOw2KQZCUvVekV73NYvVDuTgauYFwrxZACBiVtTyMMAAnVURZBSbOGzQWH03HqWHZCK5u6Yy3SDCtgrdyAH7VdIZAUl04b4ZBz7iTAX7EqshA4fNRMTyUWzztBRz6DCqZA2dn8qgjZAIQ8IQO4fIntNcx82OmxNDoLpTwSVEsnucBDHglEjjxjYZAL";

  try {
    const response = await axios.get(
      `https://graph.facebook.com/${pageId}/subscribed_apps`,
      {
        params: {
          access_token: accessToken,
        },
      }
    );

    console.log("Subscription status:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("Status check error:", error.response?.data || error);
    res.status(500).json(error.response?.data || error);
  }
});

export default router;
