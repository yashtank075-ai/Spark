const express = require("express");
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");

const authController = require("../controllers/authController");
const authenticate = require("../middleware/authenticate");

const router = express.Router();

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests. Try again later.",
  },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts. Try later.",
  },
});

router.post(
  "/phone/otp/request",
  otpRequestLimiter,
  body("phone")
    .isString()
    .matches(/^\+[1-9]\d{7,14}$/),
  (req, res, next) => {
    const { validationResult } = require("express-validator");
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: "Invalid request.",
        errors: errors.array(),
      });
    }

    next();
  },
  authController.requestOtp,
);

router.post(
  "/phone/otp/verify",
  otpVerifyLimiter,
  body("request_id").isUUID(),
  body("otp_code")
    .isString()
    .matches(/^\d{6}$/),
  (req, res, next) => {
    const { validationResult } = require("express-validator");
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: "Invalid request.",
        errors: errors.array(),
      });
    }

    next();
  },
  authController.verifyOtp,
);

router.post("/refresh", authController.refreshSession);

router.post("/logout", authenticate, authController.logout);

module.exports = router;
