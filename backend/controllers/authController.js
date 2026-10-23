const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Op, where } = require("sequelize");

const sequelize = require("../config/db");
const User = require("../models/User");
const AuthSession = require("../models/AuthSession");
const OtpChallenge = require("../models/OtpChallenge");
const {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  sendOtp,
} = require("../services/otpService");
const { access } = require("fs");

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 45);
const OTP_MAX_ATTEMPS = Number(process.env.OTP_MAX_ATTEMPS || 5);
const ACCESS_TOKEN_MINUTES = Number(process.env.ACCESS_TOKEN_MINUTES || 15);

// Keep refresh sessions short-lived initially; configure policy before release.
const REFRESH_TOKEN_DAYS = 30;

function createAccessToken(user, sessionId) {
  return jwt.sign({ sessionId }, process.env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: `${ACCESS_TOKEN_MINUTES}m`,
    issuer: "spark-api",
    audience: "spark-mobile",
  });
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validPhone(phone) {
  return typeof phone === "string" && /^\+[1-9]\d{7,14}$/.test(phone);
}

function publicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    date_of_birth: user.dateOfBirth,
    age_eligible: user.ageEligible,
    verification_status: user.verificationStatus,
  };
}

// POST /api/v1/auth/phone/otp/request
exports.requestOtp = async (req, res, next) => {
  try {
    const phone = req.body.phone;
    if (!validPhone(phone)) {
      return res.status(422).json({
        success: false,
        message: "Provide a valid phone number in E.164 format",
      });
    }

    const now = new Date();
    const previous = await OtpChallenge.findOne({
      where: { phone },
      order: [["createdAt", "DESC"]],
    });

    if (previous && previous.resendAfter > now) {
      return res.status(429).json({
        success: false,
        message: "Please wait before requesting another OTP.",
        retry_after_seconds: Math.ceil((previous.resendAfter - now) / 1000),
      });
    }

    const code = generateOtp();
    const challenge = await OtpChallenge.create({
      phone,
      codeHash: hashOtp(phone, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
      resendAfter: new Date(now.getTime() + OTP_RESEND_SECONDS * 1000),
      attempts: 0,
    });

    try {
      await sendOtp(phone, code);
    } catch (error) {
      await challenge.destroy();
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "OTP has been send to Registered Number",
      request_id: challenge.id,
      resend_after_seconds: OTP_RESEND_SECONDS,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/auth/phone/otp/verify
exports.verifyOtp = async (req, res, next) => {
  try {
    const { request_id, otp_code } = req.body;
    if (
      typeof request_id !== "string" ||
      typeof otp_code !== "string" ||
      !/^\d{6}$/.test(otp_code)
    ) {
      return res.status(422).json({
        success: false,
        message: "A request ID and six-digit OTP are required.",
      });
    }

    const transaction = await sequelize.transaction();
    try {
      const challenge = await OtpChallenge.findByPk(request_id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      const now = new Date();

      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt <= now ||
        challenge.attempts >= OTP_MAX_ATTEMPS
      ) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "OTP is invalid or expired. Request a new code.",
        });
      }

      if (!verifyOtpHash(challenge.phone, otp_code, challenge.codeHash)) {
        challenge.attempts += 1;
        await challenge.save({ transaction });
        await transaction.commit();

        return res.status(400).json({
          success: false,
          message: "OTP is invalid or expired",
        });
      }

      challenge.consumedAt = now;
      await challenge.save({ transaction });

      const [user] = await User.findOrCreate({
        where: { phone: challenge.phone },
        defaults: { phone: challenge.phone },
        transaction,
      });

      if (user.accountStatus !== "active") {
        await transaction.rollback();

        return res.status(403).json({
          success: false,
          message: "This account cannot sign in.",
        });
      }

      const refreshToken = createRefreshToken();
      const session = await AuthSession.create(
        {
          userId: user.id,
          refreshTokenHash: hashRefreshToken(refreshToken),
          expiresAt: new Date(
            now.getTime() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
        { transaction },
      );

      await transaction.commit();
      return res.status(200).json({
        success: true,
        access_token: createAccessToken(user, session.id),
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_MINUTES * 60,
        is_new_user: user.createdAt.getTime() === user.updatedAt.getTime(),
        user: publicUser(user),
        next_step: user.dateOfBirth ? "verification" : "age_gate",
      });
    } catch (error) {
      if (!transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/auth/refresh
exports.refreshSession = async (req, res, next) => {
  const { refresh_token } = req.body;

  if (typeof refresh_token !== "string" || refresh_token.length < 40) {
    return res.status(401).json({
      success: false,
      message: "Invalid refresh token.",
    });
  }

  const transaction = await sequelize.transaction();

  try {
    const session = await AuthSession.findOne({
      where: {
        refreshTokenHash: hashRefreshToken(refresh_token),
        revokedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!session) {
      await transaction.rollback();

      return res.status(401).json({
        success: false,
        message: "Session expired or revoked. Please sign in again.",
      });
    }

    const user = await User.findByPk(session.userId, { transaction });

    if (!user || user.accountStatus !== "active") {
      session.revokedAt = new Date();
      await session.save({ transaction });
      await transaction.commit();

      return res.status(401).json({
        success: false,
        message: "Account session is no longer valid.",
      });
    }

    // Rotate refresh token on every successful refresh.
    const newRefreshToken = createRefreshToken();

    session.refreshTokenHash = hashRefreshToken(newRefreshToken);
    await session.save({ transaction });
    await transaction.commit();

    return res.status(200).json({
      success: true,
      access_token: createAccessToken(user, session.id),
      refresh_token: newRefreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_MINUTES * 60,
    });
  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const session = await AuthSession.findOne({
      where: {
        id: req.auth.sessionId,
        userId: req.auth.userId,
        revokedAt: null,
      },
    });

    if (session) {
      session.revokedAt = new Date();
      await session.save();
    }

    return res.status(200).json({
      success: true,
      message: "Session logged out.",
    });
  } catch (error) {
    next(error);
  }
};
