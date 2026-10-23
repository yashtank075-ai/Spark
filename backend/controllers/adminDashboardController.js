const { Op } = require("sequelize");
const sequelize = require("../config/db");
const {
  User,
  Profile,
  Match,
  Conversation,
  Message,
  ProfileMedia,
} = require("../models");

/**
 * GET /api/v1/admin/dashboard
 * Aggregates dashboard metrics using fast COUNT queries.
 * Time window for 'new_users_last_7_days' and 'new_users_last_24_hours' is clearly defined and documented.
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const now = new Date();
    const past7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const past24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. User counters (total, active, suspended, new last 24h, new last 7d)
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      newUsers24h,
      newUsers7d,
      completedProfiles,
      inProgressProfiles,
      activeMatches,
      totalConversations,
      pendingPhotos,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { accountStatus: "active" } }),
      User.count({ where: { accountStatus: "suspended" } }),
      User.count({ where: { createdAt: { [Op.gte]: past24Hours } } }),
      User.count({ where: { createdAt: { [Op.gte]: past7Days } } }),
      Profile.count({ where: { onboardingStatus: "completed" } }),
      Profile.count({ where: { onboardingStatus: "in_progress" } }),
      Match.count({ where: { status: "active" } }),
      Conversation.count(),
      ProfileMedia.count({ where: { moderationStatus: "pending" } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          suspended: suspendedUsers,
          new_last_24_hours: newUsers24h,
          new_last_7_days: newUsers7d,
        },
        profiles: {
          completed: completedProfiles,
          in_progress: inProgressProfiles,
        },
        activity: {
          active_matches: activeMatches,
          conversations: totalConversations,
        },
        moderation: {
          pending_media_reviews: pendingPhotos,
          pending_reports: 0, // Reports module is not yet modeled in database; reported safely as 0
        },
        definitions: {
          new_users_time_window: "Past 7 days (168 hours) and past 24 hours relative to current server time",
          active_users_definition: "Users with account_status = 'active'",
          completed_profiles_definition: "Profiles with onboarding_status = 'completed'",
          active_matches_definition: "Matches with status = 'active'",
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
