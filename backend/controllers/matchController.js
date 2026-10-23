const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { Match, User, Profile, ProfileMedia } = require("../models");
const storageService = require("../services/storageService");

// UUID v4 format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Calculate age utility
function calculateAge(birthDateString) {
  if (!birthDateString) return null;
  const today = new Date();
  const birthDate = new Date(birthDateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// Map profile media to safe public schema
function formatPublicMedia(mediaList = []) {
  return mediaList
    .filter((m) => m.moderationStatus === "approved")
    .map((m) => ({
      id: m.id,
      media_type: m.mediaType,
      url: storageService.getPublicUrl(m.storageRef),
      is_primary: Boolean(m.isPrimary),
    }));
}

// Map profile to safe public profile representation (never expose DOB, phone, credentials, coordinates)
function formatPublicProfile(profile, user) {
  if (!profile) return null;
  const age = calculateAge(user ? user.dateOfBirth : null);
  const media = formatPublicMedia(profile.media || []);
  const loc = profile.location || {};
  const safeLocation = loc.city
    ? {
        city: loc.city,
        state: loc.state || null,
        country: loc.country || null,
      }
    : null;

  return {
    id: profile.id,
    user_id: profile.userId,
    display_name: profile.displayName || null,
    age,
    gender: profile.showGenderOnProfile !== false ? profile.gender : null,
    dating_intention: profile.datingIntention || null,
    dating_speed: profile.datingSpeed || null,
    interests: profile.interests || [],
    bio: profile.bio || null,
    prompts: profile.prompts || [],
    boundaries: profile.boundaries || [],
    location: safeLocation,
    media,
    is_verified: Boolean(profile.isVerified),
  };
}

// GET /api/v1/matches
exports.getMatches = async (req, res, next) => {
  try {
    const currentUserId = req.auth.userId;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    if (cursor && !UUID_REGEX.test(cursor)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cursor format.",
      });
    }

    const matchWhere = {
      status: "active",
      [Op.or]: [
        { userAId: currentUserId },
        { userBId: currentUserId },
      ],
    };

    if (cursor) {
      matchWhere.id = {
        [Op.lt]: cursor,
      };
    }

    // Fetch matches with limit + 1 to check pagination has_more
    const matches = await Match.findAll({
      where: matchWhere,
      order: [["created_at", "DESC"], ["id", "DESC"]],
      limit: limit + 1,
    });

    const hasMore = matches.length > limit;
    const activeMatches = hasMore ? matches.slice(0, limit) : matches;

    // Identify other participant user IDs
    const otherUserIds = activeMatches.map((m) =>
      m.userAId === currentUserId ? m.userBId : m.userAId
    );

    // Fetch users and profiles for other participants
    const otherUsers = await User.findAll({
      where: {
        id: { [Op.in]: otherUserIds },
        accountStatus: "active",
      },
      include: [
        {
          model: Profile,
          as: "profile",
          include: [
            {
              model: ProfileMedia,
              as: "media",
              required: false,
              where: { moderationStatus: "approved" },
            },
          ],
        },
      ],
    });

    const userProfileMap = new Map();
    for (const u of otherUsers) {
      userProfileMap.set(u.id, { user: u, profile: u.profile });
    }

    const formattedList = [];
    for (const m of activeMatches) {
      const otherId = m.userAId === currentUserId ? m.userBId : m.userAId;
      const target = userProfileMap.get(otherId);

      // Only present active profiles
      if (target && target.profile) {
        formattedList.push({
          id: m.id,
          matched_at: m.createdAt,
          status: m.status,
          user: formatPublicProfile(target.profile, target.user),
        });
      }
    }

    const nextCursor = activeMatches.length > 0 && hasMore
      ? activeMatches[activeMatches.length - 1].id
      : null;

    return res.status(200).json({
      success: true,
      message: "Matches fetched successfully.",
      data: formattedList,
      pagination: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
        count: formattedList.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/matches/:match_id
exports.unmatch = async (req, res, next) => {
  const { match_id } = req.params;

  if (!match_id || !UUID_REGEX.test(match_id)) {
    return res.status(400).json({
      success: false,
      message: "Valid Match ID is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    const match = await Match.findByPk(match_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!match) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Match not found.",
      });
    }

    // Ensure the match involves the authenticated user
    if (match.userAId !== currentUserId && match.userBId !== currentUserId) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to unmatch this user.",
      });
    }

    if (match.status === "unmatched") {
      await t.rollback();
      return res.status(200).json({
        success: true,
        message: "Match is already unmatched.",
        data: {
          id: match.id,
          status: "unmatched",
        },
      });
    }

    // Set status to unmatched
    match.status = "unmatched";
    await match.save({ transaction: t });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Unmatched successfully.",
      data: {
        id: match.id,
        status: "unmatched",
      },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};
