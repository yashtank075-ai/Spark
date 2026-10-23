const jwt = require("jsonwebtoken");
const StaffUser = require("../models/StaffUser");

/**
 * Dedicated Admin Authentication Middleware.
 * Rejects standard user tokens (which use audience: 'spark-mobile' and lack staff claims).
 * Verifies admin JWT secret, issuer, audience, and ensures the staff user is active.
 */
async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required.",
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication token is missing.",
      });
    }

    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET;
    let payload;

    try {
      payload = jwt.verify(token, secret, {
        issuer: "spark-admin",
        audience: "spark-admin-portal",
      });
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Admin access token is invalid or expired.",
      });
    }

    // Verify token claims
    if (!payload.sub || !payload.role || !payload.email) {
      return res.status(401).json({
        success: false,
        message: "Malformed admin access token.",
      });
    }

    // Fetch staff user from database to ensure current state and permissions
    const staff = await StaffUser.findByPk(payload.sub);
    if (!staff) {
      return res.status(401).json({
        success: false,
        message: "Staff identity no longer exists.",
      });
    }

    if (staff.status === "disabled") {
      return res.status(403).json({
        success: false,
        message: "Staff account is disabled.",
      });
    }

    if (staff.status === "locked") {
      if (staff.lockedUntil && staff.lockedUntil > new Date()) {
        return res.status(403).json({
          success: false,
          message: "Staff account is temporarily locked.",
        });
      }
    }

    req.admin = {
      id: staff.id,
      email: staff.email,
      role: staff.role,
      firstName: staff.firstName,
      lastName: staff.lastName,
    };
    req.staffUser = staff;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Role-based authorization middleware generator.
 * @param  {...string} allowedRoles 
 */
function requireAdminRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin || !req.admin.role) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required.",
      });
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions to access this resource.",
      });
    }

    next();
  };
}

module.exports = {
  authenticateAdmin,
  requireAdminRole,
};
