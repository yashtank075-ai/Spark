const { RushSession } = require("../models");

// Startup validation function for RUSH_TIMEZONE
function validateRushTimezone(tz) {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch (err) {
    throw new Error(`Invalid RUSH_TIMEZONE configuration: "${tz}". Timezone must be a valid IANA time zone identifier (e.g., "UTC", "Asia/Kolkata").`);
  }
}

// Validate configured timezone immediately at module load time
const CONFIGURED_TIMEZONE = validateRushTimezone(process.env.RUSH_TIMEZONE);

// Get eligibility day in configured timezone
function getEligibilityDay(date = new Date()) {
  const tz = process.env.RUSH_TIMEZONE ? validateRushTimezone(process.env.RUSH_TIMEZONE) : CONFIGURED_TIMEZONE;
  if (tz === "UTC") {
    return date.toISOString().slice(0, 10);
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

// Next eligibility timestamp: midnight of the next calendar day in configured timezone
function getNextEligibilityTimestamp(date = new Date()) {
  const tz = process.env.RUSH_TIMEZONE ? validateRushTimezone(process.env.RUSH_TIMEZONE) : CONFIGURED_TIMEZONE;
  if (tz === "UTC") {
    const d = new Date(date);
    d.setUTCHours(24, 0, 0, 0);
    return d.toISOString();
  }
  // For non-UTC timezone, compute midnight of the next day in that timezone
  const todayStr = getEligibilityDay(date);
  const [year, month, day] = todayStr.split("-").map(Number);
  // Next day midnight in UTC representation
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  return nextDay.toISOString();
}


const sequelize = require("../config/db");

// POST /api/v1/rush/activate
exports.activateRush = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.auth.userId;
    const now = new Date();
    const today = getEligibilityDay(now);

    // 1. Check if user already has an active session
    const activeSession = await RushSession.findOne({
      where: {
        userId,
        expiresAt: {
          [require("sequelize").Op.gt]: now,
        },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (activeSession) {
      await t.rollback();
      const remainingSeconds = Math.max(
        0,
        Math.floor((new Date(activeSession.expiresAt).getTime() - now.getTime()) / 1000)
      );
      return res.status(409).json({
        success: false,
        code: "RUSH_ALREADY_ACTIVE",
        message: "You already have an active SPARK Rush session.",
        data: {
          session_id: activeSession.id,
          expires_at: activeSession.expiresAt.toISOString(),
          remaining_seconds: remainingSeconds,
        },
      });
    }

    // 2. Check if user already used their 1 activation today
    const usedToday = await RushSession.findOne({
      where: {
        userId,
        eligibilityDay: today,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (usedToday) {
      await t.rollback();
      return res.status(409).json({
        success: false,
        code: "RUSH_DAILY_LIMIT_REACHED",
        message: "You have already used your SPARK Rush activation for today.",
        data: {
          next_activation_available_at: getNextEligibilityTimestamp(now),
        },
      });
    }

    // 3. Create new 600-second session atomically
    const durationSeconds = 600;
    const startedAt = now;
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);

    const newSession = await RushSession.create(
      {
        userId,
        startedAt,
        expiresAt,
        eligibilityDay: today,
      },
      { transaction: t }
    );

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "SPARK Rush activated successfully! Enjoy 10 minutes of unlimited swipes.",
      data: {
        session_id: newSession.id,
        started_at: newSession.startedAt.toISOString(),
        expires_at: newSession.expiresAt.toISOString(),
        duration_seconds: durationSeconds,
      },
    });
  } catch (error) {
    await t.rollback();
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(409).json({
        success: false,
        code: "RUSH_DAILY_LIMIT_REACHED",
        message: "You have already activated SPARK Rush for today.",
      });
    }
    next(error);
  }
};

exports.validateRushTimezone = validateRushTimezone;
exports.getEligibilityDay = getEligibilityDay;
exports.getNextEligibilityTimestamp = getNextEligibilityTimestamp;
