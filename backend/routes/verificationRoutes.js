const express = require("express");
const router = express.Router();
const verificationController = require("../controllers/verificationController");
const authenticate = require("../middleware/authenticate");

// Rate limiter for verification attempts (e.g. 5 attempts per 15 minutes)
const rateLimit = require("express-rate-limit");
const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many face verification attempts. Please wait 15 minutes before trying again.",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/v1/verification/face
router.post(
  "/face",
  authenticate,
  verificationLimiter,
  verificationController.verifyFace
);

module.exports = router;
