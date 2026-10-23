const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const StaffUser = require("../models/StaffUser");
const adminMfaService = require("../services/adminMfaService");

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const ADMIN_TOKEN_MINUTES = Number(process.env.ADMIN_TOKEN_MINUTES || 60);
const MFA_TEMP_TOKEN_MINUTES = 5;

function getAdminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET;
}

function issueAdminAccessToken(staff) {
  return jwt.sign(
    {
      role: staff.role,
      email: staff.email,
    },
    getAdminJwtSecret(),
    {
      subject: staff.id,
      expiresIn: `${ADMIN_TOKEN_MINUTES}m`,
      issuer: "spark-admin",
      audience: "spark-admin-portal",
    }
  );
}

function issueMfaTempToken(staff) {
  return jwt.sign(
    {
      purpose: "mfa_pending",
      role: staff.role,
      email: staff.email,
    },
    getAdminJwtSecret(),
    {
      subject: staff.id,
      expiresIn: `${MFA_TEMP_TOKEN_MINUTES}m`,
      issuer: "spark-admin",
      audience: "spark-admin-portal",
    }
  );
}

function publicStaffUser(staff) {
  return {
    id: staff.id,
    email: staff.email,
    first_name: staff.firstName,
    last_name: staff.lastName,
    role: staff.role,
    status: staff.status,
    mfa_enabled: staff.mfaEnabled,
    last_login_at: staff.lastLoginAt,
  };
}

/**
 * POST /api/v1/admin/auth/login
 * Step 1: Staff login with email & password.
 * If MFA is enabled on the account, issues a restricted short-lived mfa_token and returns mfa_required: true.
 * If MFA is not required, issues the full admin access token.
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return res.status(422).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const staff = await StaffUser.findOne({ where: { email: normalizedEmail } });

    if (!staff) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    // Check account status: disabled
    if (staff.status === "disabled") {
      return res.status(403).json({
        success: false,
        message: "Staff account is disabled. Please contact the system administrator.",
      });
    }

    const now = new Date();

    // Check account status: locked
    if (staff.status === "locked") {
      if (staff.lockedUntil && staff.lockedUntil > now) {
        const remainingSeconds = Math.ceil((staff.lockedUntil - now) / 1000);
        return res.status(423).json({
          success: false,
          message: "Account is temporarily locked due to excessive failed attempts.",
          retry_after_seconds: remainingSeconds,
        });
      } else if (staff.lockedUntil && staff.lockedUntil <= now) {
        // Unlock expired lock
        staff.status = "active";
        staff.failedAttempts = 0;
        staff.lockedUntil = null;
        await staff.save();
      }
    }

    // Verify password using bcryptjs
    const isMatch = await bcrypt.compare(password, staff.passwordHash);

    if (!isMatch) {
      staff.failedAttempts += 1;
      if (staff.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        staff.status = "locked";
        staff.lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000);
      }
      await staff.save();

      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    // Reset failed attempts on valid password
    staff.failedAttempts = 0;
    staff.lockedUntil = null;

    // Check MFA requirement
    const isMfaRequired = Boolean(staff.mfaEnabled);

    if (isMfaRequired) {
      // Successful password validation alone MUST NOT issue a fully privileged admin access token
      await staff.save();
      const mfaTempToken = issueMfaTempToken(staff);

      return res.status(200).json({
        success: true,
        message: "Password verified. Multi-factor authentication is required.",
        mfa_required: true,
        mfa_token: mfaTempToken,
        expires_in_seconds: MFA_TEMP_TOKEN_MINUTES * 60,
      });
    }

    // MFA not required: update last login and issue full admin access token
    staff.lastLoginAt = now;
    await staff.save();

    const accessToken = issueAdminAccessToken(staff);

    return res.status(200).json({
      success: true,
      message: "Admin authentication successful.",
      mfa_required: false,
      access_token: accessToken,
      token_type: "Bearer",
      expires_in_seconds: ADMIN_TOKEN_MINUTES * 60,
      user: publicStaffUser(staff),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/auth/mfa/verify
 * Step 2: Verifies MFA OTP code using the temporary mfa_token from step 1.
 * Issues the full privileged admin access token only upon successful code verification.
 */
exports.verifyMfa = async (req, res, next) => {
  try {
    const { mfa_token, mfa_code } = req.body;

    if (!mfa_token || !mfa_code || typeof mfa_code !== "string" || !/^\d{6}$/.test(mfa_code)) {
      return res.status(422).json({
        success: false,
        message: "A valid mfa_token and 6-digit mfa_code are required.",
      });
    }

    let payload;
    try {
      payload = jwt.verify(mfa_token, getAdminJwtSecret(), {
        issuer: "spark-admin",
        audience: "spark-admin-portal",
      });
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "MFA session token is invalid or expired. Please login again.",
      });
    }

    if (payload.purpose !== "mfa_pending") {
      return res.status(401).json({
        success: false,
        message: "Invalid token purpose for MFA verification.",
      });
    }

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

    const now = new Date();
    if (staff.status === "locked") {
      if (staff.lockedUntil && staff.lockedUntil > now) {
        return res.status(423).json({
          success: false,
          message: "Staff account is temporarily locked.",
        });
      }
    }

    // Verify TOTP code against staff.mfaSecret or default/fallback policy
    const isValidCode = adminMfaService.verifyTOTP(staff.mfaSecret, mfa_code);

    if (!isValidCode) {
      staff.failedAttempts += 1;
      if (staff.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        staff.status = "locked";
        staff.lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000);
      }
      await staff.save();

      return res.status(401).json({
        success: false,
        message: "Invalid or expired MFA code.",
      });
    }

    // Successful MFA verification: reset failed attempts, update last login, issue admin access token
    staff.failedAttempts = 0;
    staff.lockedUntil = null;
    staff.lastLoginAt = now;
    await staff.save();

    const accessToken = issueAdminAccessToken(staff);

    return res.status(200).json({
      success: true,
      message: "MFA verification successful.",
      access_token: accessToken,
      token_type: "Bearer",
      expires_in_seconds: ADMIN_TOKEN_MINUTES * 60,
      user: publicStaffUser(staff),
    });
  } catch (error) {
    next(error);
  }
};
