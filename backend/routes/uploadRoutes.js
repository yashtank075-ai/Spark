const express = require("express");
const rateLimit = require("express-rate-limit");
const authenticate = require("../middleware/authenticate");
const { handleUploadSingle } = require("../middleware/uploadMiddleware");
const { uploadSingle } = require("../controllers/uploadController");

const router = express.Router();

// Rate limiting for uploads: 30 uploads per 15 minutes per IP/user
const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "UPLOAD_RATE_LIMITED",
        message: "Too many upload requests. Please wait a few minutes before trying again.",
      },
    });
  },
});

router.post(
  "/upload/single",
  authenticate,
  uploadRateLimiter,
  handleUploadSingle,
  uploadSingle
);

module.exports = router;
