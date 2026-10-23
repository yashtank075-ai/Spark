const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const sequelize = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const profileRoutes = require("./routes/profileRoutes");
const discoverRoutes = require("./routes/discoverRoutes");
const rushRoutes = require("./routes/rushRoutes");
const matchRoutes = require("./routes/matchRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const gameRoutes = require("./routes/gameRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const adminRoutes = require("./routes/adminRoutes");
const verificationRoutes = require("./routes/verificationRoutes");
const storageService = require("./services/storageService");

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/api/v1/health", async (req, res) => {
  try {
    await sequelize.authenticate();

    res.status(200).json({
      success: true,
      message: "SPARK API is running",
      database: "connected",
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// Media proxy/streaming route by Media UUID or object key
// Supports:
// 1. /api/v1/media/:media_id (UUID lookup in database)
// 2. /api/v1/media/*path (direct stream of storageRef e.g. photos/2026-10/file.jpg or uploads/file.png)
app.get("/api/v1/media/*path", async (req, res, next) => {
  try {
    let rawPath = req.params.path || req.params[0] || "";
    if (Array.isArray(rawPath)) {
      rawPath = rawPath.join("/");
    }
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    let storageRef = rawPath;
    if (UUID_REGEX.test(rawPath)) {
      const { ProfileMedia } = require("./models");
      const mediaRecord = await ProfileMedia.findByPk(rawPath);
      if (!mediaRecord) {
        return res.status(404).json({ success: false, message: "Media not found." });
      }
      storageRef = mediaRecord.storageRef;
    }

    const fileData = await storageService.getFileStream(storageRef);
    if (!fileData) {
      return res.status(404).json({ success: false, message: "Media not found." });
    }
    if (fileData.contentType) {
      res.setHeader("Content-Type", fileData.contentType);
    }
    if (fileData.contentLength) {
      res.setHeader("Content-Length", fileData.contentLength);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    fileData.stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/me", sessionRoutes);
app.use("/api/v1", profileRoutes);
app.use("/api/v1", discoverRoutes);
app.use("/api/v1/rush", rushRoutes);
app.use("/api/v1", matchRoutes);
app.use("/api/v1", conversationRoutes);
app.use("/api/v1/games", gameRoutes);
app.use("/api/v1", uploadRoutes);
app.use("/api/v1/verification", verificationRoutes);

app.use((err, req, res, next) => {
  console.error("API error:", err.message);

  res.status(500).json({
    success: false,
    message: err.message,
    stack: err.stack,
  });
});

module.exports = app;
