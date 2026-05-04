import express from "express";
import Logger from "../models/loggerModel.js";

const router = express.Router();

// Get all logs with optional email filter
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      email,
      status,
    } = req.query;

    const query = {};

    // Add email filter if provided
    if (email) {
      query.userEmail = email;
    }

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    // Add date range filter if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const logs = await Logger.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Logger.countDocuments(query);

    res.json({
      logs,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalLogs: count,
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    res
      .status(500)
      .json({ message: "Error fetching logs", error: error.message });
  }
});

export default router;
