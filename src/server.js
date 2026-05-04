import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { createServer } from "http";
import properties from "./config/properties.js";
import userRoute from "./api/routes/userRoute.js";
import facebookRoute from "./api/routes/facebookRoute.js";
import webhookRoute from "./api/routes/webhookRoute.js";
import commentRoutes from "./api/routes/commentRoutes.js";
import loggerRoute from "./api/routes/loggerRoute.js";
import affiliateRoute from "./api/routes/affiliateRoute.js";
// Port from properties
const port = properties.PORT || 5000;

// Enhanced database connection with retry mechanism
const connectWithRetry = async () => {
  const maxRetries = 5;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mongoose.connect(properties.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
        keepAlive: true,
        keepAliveInitialDelay: 300000,
      });
      console.log("MongoDB connected successfully");
      return true;
    } catch (err) {
      console.error(`Attempt ${attempt} failed: ${err.message}`);

      if (attempt === maxRetries) {
        console.error("Max retries reached. Exiting...");
        return false;
      }

      console.log(`Retrying in ${retryDelay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
};

// Comprehensive list of allowed origins
const allowed_origins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:5000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "https://localhost:3001",
  "https://localhost:3002",
  "https://localhost:5173",
  "https://localhost:5174",
  "https://app.socialmediamanagement.app",
  "https://affiliate.socialmediamanagement.app",
  "https://www.app.socialmediamanagement.app",
  "https://api.socialmediamanagement.app",
  "https://app.socialmediamanagement.app"
  // Add your development and production domains here
];

// Express app setup with enhanced error handling
const app = express();

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message || "Internal Server Error",
      status: err.status || 500,
    },
  });
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
};

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (allowed_origins.includes(origin) || !origin) {
      callback(null, origin);
    } else if (origin && origin.includes("localhost")) {
      // Allow dynamic localhost ports but return the main frontend URL
      callback(null, "https://localhost:5173");
    } else {
      console.log("Blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Methods",
  ],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// Middleware setup
app.use(requestLogger);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options("*", cors(corsOptions));

// Security headers middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Vary", "Origin");
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("X-XSS-Protection", "1; mode=block");
  next();
});

// Static files
app.use("/static", express.static("static"));

// Routes
app.use("/user", userRoute);
app.use("/facebook", facebookRoute);
app.use("/webhook", webhookRoute);
app.use("/api/comments", commentRoutes);
app.use("/api/logs", loggerRoute);
app.use("/affiliate", affiliateRoute);
// Health check endpoint
app.get("/health", (req, res) => {
  const health = {
    uptime: process.uptime(),
    message: "OK",
    timestamp: Date.now(),
    database:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  };
  res.status(200).json(health);
});

// Root route
app.get("/", (req, res) => {
  const dbStatus =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  res.send(`
    <h1>Server is running on port ${port}</h1>
    <h2>Database Status: ${dbStatus}</h2>
  `);
});

// Error handling
app.use(errorHandler);

// Socket.IO setup with enhanced configuration
let io;

const setupSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: allowed_origins,
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Access-Control-Allow-Headers",
        "Access-Control-Allow-Origin",
      ],
      transports: ["websocket", "polling"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    cookie: {
      name: "io",
      path: "/",
      httpOnly: true,
      sameSite: "strict",
    },
    allowEIO3: true,
    maxHttpBufferSize: 1e8,
  });

  // Socket.IO error handling
  io.engine.on("connection_error", (err) => {
    console.log("Connection error:", err);
  });

  // Socket.IO connection handling
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join-page", (pageId) => {
      socket.join(pageId);
      console.log(`Socket ${socket.id} joined room: ${pageId}`);
    });

    socket.on("error", (error) => {
      console.error("Socket error:", error);
    });

    socket.on("disconnect", (reason) => {
      console.log("Client disconnected:", socket.id, "Reason:", reason);
    });
  });

  return io;
};

// Server startup sequence
const startServer = async () => {
  try {
    const connected = await connectWithRetry();
    if (!connected) {
      process.exit(1);
    }

    const httpServer = createServer(app);
    io = setupSocket(httpServer);

    httpServer.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });

    // Graceful shutdown handling
    process.on("SIGTERM", () => {
      console.log("SIGTERM signal received: closing HTTP server");
      httpServer.close(() => {
        console.log("HTTP server closed");
        mongoose.connection.close(false, () => {
          console.log("MongoDB connection closed");
          process.exit(0);
        });
      });
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();

export { io };
