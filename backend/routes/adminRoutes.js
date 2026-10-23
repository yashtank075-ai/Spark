const express = require("express");
const rateLimit = require("express-rate-limit");
const adminAuthController = require("../controllers/adminAuthController");
const adminDashboardController = require("../controllers/adminDashboardController");
const adminUserController = require("../controllers/adminUserController");
const { authenticateAdmin, requireAdminRole } = require("../middleware/adminAuthMiddleware");

const router = express.Router();

// Rate limiter for admin login: 10 attempts per 15 minutes window
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many admin login attempts. Please try again later.",
  },
});

// Rate limiter for admin MFA verification: 15 attempts per 15 minutes window
const adminMfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many MFA verification attempts. Please try again later.",
  },
});

// 1. Admin Authentication Routes (public with rate limiting)
router.post("/auth/login", adminLoginLimiter, adminAuthController.login);
router.post("/auth/mfa/verify", adminMfaLimiter, adminAuthController.verifyMfa);

// 2. Protected Admin Dashboard Endpoint
router.get(
  "/dashboard",
  authenticateAdmin,
  requireAdminRole("super_admin", "admin"),
  adminDashboardController.getDashboardStats
);

// 3. Protected Paginated Admin User Search Endpoint
router.get(
  "/users",
  authenticateAdmin,
  requireAdminRole("super_admin", "admin", "moderator"),
  adminUserController.getUsers
);

module.exports = router;
