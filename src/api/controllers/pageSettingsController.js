import User from "../models/userModels.js";

export const updatePageSettings = async (req, res) => {
  try {
    const { userId, pageId } = req.params;
    const { settings } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find the page settings entry
    const pageSettingsIndex = user.pageSettings.findIndex(
      (p) => p.pageId === pageId
    );

    if (pageSettingsIndex === -1) {
      // If page settings don't exist, create new
      user.pageSettings.push({
        pageId,
        pageName: "Facebook Page", // You might want to get this from somewhere
        settings: {
          ...settings,
        },
      });
    } else {
      // Update existing settings
      user.pageSettings[pageSettingsIndex].settings = {
        ...user.pageSettings[pageSettingsIndex].settings,
        ...settings,
      };
    }

    await user.save();
    res.json(user);
  } catch (error) {
    console.error("Error updating page settings:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getKeywordReplies = async (req, res) => {
  try {
    const { userId, pageId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pageSettings = user.pageSettings.find((p) => p.pageId === pageId);
    if (!pageSettings) {
      return res.status(404).json({ message: "Page settings not found" });
    }

    res.json(pageSettings.settings.keywordReplies || []);
  } catch (error) {
    console.error("Error getting keyword replies:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const updateKeywordReplies = async (req, res) => {
  try {
    const { userId, pageId } = req.params;
    const { keywordReplies } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pageSettingsIndex = user.pageSettings.findIndex(
      (p) => p.pageId === pageId
    );
    if (pageSettingsIndex === -1) {
      // If page settings don't exist, create new
      user.pageSettings.push({
        pageId,
        pageName: "Facebook Page",
        settings: {
          keywordReplies,
        },
      });
    } else {
      // Update existing keyword replies
      user.pageSettings[pageSettingsIndex].settings.keywordReplies =
        keywordReplies;
    }

    await user.save();
    res.json(user.pageSettings[pageSettingsIndex].settings.keywordReplies);
  } catch (error) {
    console.error("Error updating keyword replies:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const addKeywordReply = async (req, res) => {
  try {
    const { userId, pageId } = req.params;
    const { keywords, replyText } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pageSettingsIndex = user.pageSettings.findIndex(
      (p) => p.pageId === pageId
    );
    if (pageSettingsIndex === -1) {
      return res.status(404).json({ message: "Page settings not found" });
    }

    const newKeywordReply = { keywords, replyText };
    user.pageSettings[pageSettingsIndex].settings.keywordReplies =
      user.pageSettings[pageSettingsIndex].settings.keywordReplies || [];
    user.pageSettings[pageSettingsIndex].settings.keywordReplies.push(
      newKeywordReply
    );

    await user.save();
    res.json(newKeywordReply);
  } catch (error) {
    console.error("Error adding keyword reply:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteKeywordReply = async (req, res) => {
  try {
    const { userId, pageId } = req.params;
    const { keywords } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pageSettingsIndex = user.pageSettings.findIndex(
      (p) => p.pageId === pageId
    );
    if (pageSettingsIndex === -1) {
      return res.status(404).json({ message: "Page settings not found" });
    }

    const keywordReplies =
      user.pageSettings[pageSettingsIndex].settings.keywordReplies || [];
    user.pageSettings[pageSettingsIndex].settings.keywordReplies =
      keywordReplies.filter(
        (kr) => !keywords.every((keyword) => kr.keywords.includes(keyword))
      );

    await user.save();
    res.json({ message: "Keyword reply deleted successfully" });
  } catch (error) {
    console.error("Error deleting keyword reply:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const updateNoMatchAction = async (req, res) => {
  try {
    const { userId, pageId } = req.params;
    const { noMatchAction } = req.body;

    // Validate noMatchAction value
    const validActions = ["hide", "defaultComment", "none"];
    if (!validActions.includes(noMatchAction)) {
      return res.status(400).json({
        message:
          "Invalid noMatchAction value. Must be 'hide', 'defaultComment', or 'none'",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pageSettingsIndex = user.pageSettings.findIndex(
      (p) => p.pageId === pageId
    );

    if (pageSettingsIndex === -1) {
      // If page settings don't exist, create new
      return res.status(500).json({ message: "page not found" });
    } else {
      // Update existing settings
      user.pageSettings[pageSettingsIndex].settings.noMatchAction =
        noMatchAction;
    }

    await user.save();
    res.json({
      message: "No match action updated successfully",
      noMatchAction:
        user.pageSettings[pageSettingsIndex].settings.noMatchAction,
    });
  } catch (error) {
    console.error("Error updating no match action:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
