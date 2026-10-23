const { Op } = require("sequelize");
const { Profile, ProfileMedia, User, Interaction, Block, RushSession } = require("../models");
const storageService = require("../services/storageService");

// UUID v4 format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Utility to calculate age from date of birth string
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
      url: storageService.getPublicUrl(m.storageRef, m.id),
      is_primary: Boolean(m.isPrimary),
    }));
}

// Map profile to public card schema (never expose DOB, phone, private moderation, exact coordinates)
function formatPublicProfile(profile, user, isSparkRush = false) {
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
    display_name: profile.displayName,
    age,
    gender: profile.showGenderOnProfile !== false ? profile.gender : null,
    dating_intention: profile.datingIntention,
    dating_speed: profile.datingSpeed,
    interests: profile.interests || [],
    bio: profile.bio || null,
    prompts: profile.prompts || [],
    boundaries: profile.boundaries || [],
    location: safeLocation,
    media,
    is_verified: Boolean(profile.isVerified),
    spark_boost: {
      is_spark_rush: Boolean(isSparkRush),
      rush_multiplier: isSparkRush ? 2 : 1,
    },
  };
}

// Canonical mapping for dating speed
const DATING_SPEED_CANONICAL_MAP = {
  slow: "slow",
  steady: "slow",
  moderate: "moderate",
  fast: "fast",
};

// Allowed values
const VALID_INTENTIONS = new Set(["vibe", "explore", "intent"]);
const VALID_SPEEDS = new Set(["slow", "steady", "moderate", "fast"]);
const VALID_GENDERS = new Set(["female", "male", "non-binary", "other", "everyone", "all"]);

// Haversine distance in kilometers
function calculateHaversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (
    lat1 === undefined || lat1 === null ||
    lon1 === undefined || lon1 === null ||
    lat2 === undefined || lat2 === null ||
    lon2 === undefined || lon2 === null
  ) {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth's mean radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const { generateCursor, verifyAndDecodeCursor } = require("../services/cursorService");

// Compute a deterministic hash of the effective filters
function computeFilterSignature(filters) {
  const normalized = {
    min_age: filters.min_age,
    max_age: filters.max_age,
    max_distance_km: filters.max_distance_km,
    interested_in_gender: filters.interested_in_gender,
    dating_intention: filters.dating_intention,
    dating_speed: filters.dating_speed,
  };
  return Buffer.from(JSON.stringify(normalized)).toString("base64url");
}

// GET /api/v1/discover
exports.getDiscoverDeck = async (req, res, next) => {
  try {
    const currentUserId = req.auth.userId;
    const currentProfile = req.profile;
    const currentUser = req.user;

    const query = req.query || {};
    const validationErrors = {};

    // 1. Validate & Parse Limit
    let limit = 10;
    if (query.limit !== undefined) {
      const parsedLimit = parseInt(query.limit, 10);
      if (isNaN(parsedLimit) || !Number.isInteger(Number(query.limit)) || parsedLimit < 1 || parsedLimit > 50) {
        validationErrors.limit = "limit must be an integer between 1 and 50.";
      } else {
        limit = parsedLimit;
      }
    }

    // 2. Validate & Parse min_age
    let minAgeParam;
    if (query.min_age !== undefined) {
      const parsed = parseInt(query.min_age, 10);
      if (isNaN(parsed) || !Number.isInteger(Number(query.min_age)) || parsed < 18 || parsed > 100) {
        validationErrors.min_age = "min_age must be an integer between 18 and 100.";
      } else {
        minAgeParam = parsed;
      }
    }

    // 3. Validate & Parse max_age
    let maxAgeParam;
    if (query.max_age !== undefined) {
      const parsed = parseInt(query.max_age, 10);
      if (isNaN(parsed) || !Number.isInteger(Number(query.max_age)) || parsed < 18 || parsed > 100) {
        validationErrors.max_age = "max_age must be an integer between 18 and 100.";
      } else {
        maxAgeParam = parsed;
      }
    }

    // Validate min_age <= max_age if both supplied in query
    if (minAgeParam !== undefined && maxAgeParam !== undefined && minAgeParam > maxAgeParam) {
      validationErrors.age_range = "min_age cannot be greater than max_age.";
    }

    // 4. Validate & Parse max_distance_km
    let maxDistanceParam;
    if (query.max_distance_km !== undefined) {
      const parsed = parseFloat(query.max_distance_km);
      if (isNaN(parsed) || parsed <= 0 || parsed > 500) {
        validationErrors.max_distance_km = "max_distance_km must be a number between 1 and 500.";
      } else {
        maxDistanceParam = parsed;
      }
    }

    // 5. Validate interested_in_gender
    let interestedGenderParam;
    if (query.interested_in_gender !== undefined) {
      const g = String(query.interested_in_gender).trim().toLowerCase();
      if (!VALID_GENDERS.has(g)) {
        validationErrors.interested_in_gender = `interested_in_gender must be one of: ${Array.from(VALID_GENDERS).join(", ")}.`;
      } else {
        interestedGenderParam = g;
      }
    }

    // 6. Validate dating_intention
    let datingIntentionParam;
    if (query.dating_intention !== undefined) {
      const intention = String(query.dating_intention).trim().toLowerCase();
      if (!VALID_INTENTIONS.has(intention)) {
        validationErrors.dating_intention = `dating_intention must be one of: ${Array.from(VALID_INTENTIONS).join(", ")}.`;
      } else {
        datingIntentionParam = intention;
      }
    }

    // 7. Validate dating_speed
    let datingSpeedParam;
    if (query.dating_speed !== undefined) {
      const speed = String(query.dating_speed).trim().toLowerCase();
      if (!VALID_SPEEDS.has(speed)) {
        validationErrors.dating_speed = `dating_speed must be one of: slow, moderate, fast (or legacy 'steady').`;
      } else {
        datingSpeedParam = speed;
      }
    }

    // Return structured 422 if validation fails
    if (Object.keys(validationErrors).length > 0) {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid discovery filter parameters.",
        details: validationErrors,
      });
    }

    // 8. Resolve Effective Filters (Query overrides saved preferences)
    const myPrefs = currentProfile.preferences || {};
    const effectiveMinAge = minAgeParam !== undefined
      ? minAgeParam
      : (typeof myPrefs.min_age === "number" ? myPrefs.min_age : 18);

    const effectiveMaxAge = maxAgeParam !== undefined
      ? maxAgeParam
      : (typeof myPrefs.max_age === "number" ? myPrefs.max_age : 100);

    // Cross-check resolved min and max age (e.g. if one came from query and other from saved prefs)
    if (effectiveMinAge > effectiveMaxAge) {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid discovery filter parameters.",
        details: { age_range: "min_age cannot be greater than max_age." },
      });
    }

    const effectiveMaxDistanceKm = maxDistanceParam !== undefined
      ? maxDistanceParam
      : (typeof myPrefs.max_distance_km === "number" ? myPrefs.max_distance_km : null);

    const effectiveInterestedGender = interestedGenderParam !== undefined
      ? interestedGenderParam
      : (myPrefs.interested_in_gender ? String(myPrefs.interested_in_gender).toLowerCase() : null);

    const effectiveDatingIntention = datingIntentionParam !== undefined
      ? datingIntentionParam
      : null;

    const effectiveDatingSpeed = datingSpeedParam !== undefined
      ? datingSpeedParam
      : null;

    const currentFilterSignature = computeFilterSignature({
      min_age: effectiveMinAge,
      max_age: effectiveMaxAge,
      max_distance_km: effectiveMaxDistanceKm,
      interested_in_gender: effectiveInterestedGender,
      dating_intention: effectiveDatingIntention,
      dating_speed: effectiveDatingSpeed,
    });

    // 9. Validate Cursor
    let cursorProfileId = null;
    if (query.cursor) {
      const cursorResult = verifyAndDecodeCursor(String(query.cursor), {
        expectedUserId: currentUserId,
        currentFilterSignature,
      });

      if (!cursorResult.isValid) {
        const statusCode = 400;
        let errorMessage = "Invalid cursor format.";
        if (cursorResult.isExpired) {
          errorMessage = cursorResult.message || "The pagination cursor has expired. Please restart discovery.";
        } else if (cursorResult.isFilterMismatch) {
          errorMessage = "The provided cursor is incompatible with the current filter parameters.";
        }

        return res.status(statusCode).json({
          success: false,
          code: cursorResult.code || "INVALID_CURSOR",
          message: errorMessage,
        });
      }

      cursorProfileId = cursorResult.profileId;
    }

    // 10. Fetch Excluded User IDs:
    // a) Self
    const excludedUserIds = new Set([currentUserId]);

    // b) Users who blocked current user or whom current user blocked
    const blocks = await Block.findAll({
      where: {
        [Op.or]: [
          { blockerId: currentUserId },
          { blockedId: currentUserId },
        ],
      },
      attributes: ["blockerId", "blockedId"],
    });

    for (const b of blocks) {
      if (b.blockerId === currentUserId) excludedUserIds.add(b.blockedId);
      if (b.blockedId === currentUserId) excludedUserIds.add(b.blockerId);
    }

    // c) Users already liked or passed by current user
    const pastInteractions = await Interaction.findAll({
      where: { actorId: currentUserId },
      attributes: ["targetId"],
    });

    for (const inter of pastInteractions) {
      excludedUserIds.add(inter.targetId);
    }

    // 11. Build Database Query Where Clauses
    const profileWhere = {
      userId: {
        [Op.notIn]: Array.from(excludedUserIds),
      },
      onboardingStatus: "completed",
    };

    // Gender filter applied at database level
    if (
      effectiveInterestedGender &&
      effectiveInterestedGender !== "everyone" &&
      effectiveInterestedGender !== "all"
    ) {
      profileWhere.gender = {
        [Op.iLike]: effectiveInterestedGender,
      };
    }

    // Dating intention filter applied at database level
    if (effectiveDatingIntention) {
      profileWhere.datingIntention = {
        [Op.iLike]: effectiveDatingIntention,
      };
    }

    // Dating speed filter applied at database level (supports slow / steady / moderate / fast)
    if (effectiveDatingSpeed) {
      const canonicalSpeed = DATING_SPEED_CANONICAL_MAP[effectiveDatingSpeed] || effectiveDatingSpeed;
      if (canonicalSpeed === "slow") {
        profileWhere.datingSpeed = {
          [Op.in]: ["slow", "steady"],
        };
      } else {
        profileWhere.datingSpeed = {
          [Op.iLike]: canonicalSpeed,
        };
      }
    }

    // Cursor pagination (by profile.id descending)
    if (cursorProfileId) {
      profileWhere.id = {
        [Op.lt]: cursorProfileId,
      };
    }

    // Age bounds converted to DOB range in SQL:
    // candidateAge in [minAge, maxAge] means:
    // candidateDob <= today - minAge years
    // candidateDob >= today - (maxAge + 1) years
    const today = new Date();
    const latestDob = new Date(today.getFullYear() - effectiveMinAge, today.getMonth(), today.getDate());
    const earliestDob = new Date(today.getFullYear() - (effectiveMaxAge + 1), today.getMonth(), today.getDate());

    const userWhere = {
      accountStatus: "active",
      ageEligible: true,
      dateOfBirth: {
        [Op.ne]: null,
        [Op.lte]: latestDob.toISOString().slice(0, 10),
        [Op.gte]: earliestDob.toISOString().slice(0, 10),
      },
    };

    // Current user's location origin for distance calculation
    const myLoc = currentProfile.location || {};
    const hasMyCoords =
      typeof myLoc.latitude === "number" &&
      typeof myLoc.longitude === "number";

    // 12. Candidate Query with Batch Size
    const batchSize = Math.min(limit * 3, 100);
    const candidates = await Profile.findAll({
      where: profileWhere,
      attributes: [
        "id",
        "userId",
        "displayName",
        "gender",
        "showGenderOnProfile",
        "bio",
        "interests",
        "prompts",
        "boundaries",
        "location",
        "datingSpeed",
        "datingIntention",
        "preferences",
      ],
      include: [
        {
          model: User,
          as: "user",
          required: true,
          where: userWhere,
          attributes: ["id", "dateOfBirth", "ageEligible", "accountStatus"],
        },
        {
          model: ProfileMedia,
          as: "media",
          required: false,
          where: { moderationStatus: "approved" },
          attributes: ["id", "mediaType", "storageRef", "moderationStatus"],
        },
      ],
      order: [["id", "DESC"]],
      limit: batchSize + 1,
    });

    // 13. In-Memory Post-Filtering (Mutual compatibility, Photo requirement, Distance)
    const currentUserAge = calculateAge(currentUser.dateOfBirth);
    const eligibleDeck = [];
    let lastEvaluatedCandidateId = null;

    for (const cand of candidates) {
      lastEvaluatedCandidateId = cand.id;

      // Double-check precise candidate age with calculateAge
      const candAge = calculateAge(cand.user ? cand.user.dateOfBirth : null);
      if (candAge === null || candAge < effectiveMinAge || candAge > effectiveMaxAge) {
        continue;
      }

      // Check candidate's preferences regarding current user
      const candPrefs = cand.preferences || {};
      const candMinAge = typeof candPrefs.min_age === "number" ? candPrefs.min_age : 18;
      const candMaxAge = typeof candPrefs.max_age === "number" ? candPrefs.max_age : 100;
      if (currentUserAge < candMinAge || currentUserAge > candMaxAge) {
        continue;
      }

      const candInterestedGender = candPrefs.interested_in_gender;
      if (
        candInterestedGender &&
        candInterestedGender !== "everyone" &&
        candInterestedGender !== "all" &&
        currentProfile.gender &&
        candInterestedGender.toLowerCase() !== currentProfile.gender.toLowerCase()
      ) {
        continue;
      }

      // Require at least one approved photo for discovery visibility
      const approvedPhotos = (cand.media || []).filter(
        (m) => m.mediaType === "photo" && m.moderationStatus === "approved"
      );
      if (approvedPhotos.length === 0) {
        continue;
      }

      // Distance filtering if max_distance_km specified or saved
      if (effectiveMaxDistanceKm !== null && effectiveMaxDistanceKm !== undefined) {
        const candLoc = cand.location || {};
        const hasCandCoords =
          typeof candLoc.latitude === "number" &&
          typeof candLoc.longitude === "number";

        if (hasMyCoords && hasCandCoords) {
          const distKm = calculateHaversineDistanceKm(
            myLoc.latitude,
            myLoc.longitude,
            candLoc.latitude,
            candLoc.longitude
          );
          if (distKm !== null && distKm > effectiveMaxDistanceKm) {
            continue;
          }
        }
        // If either party does not have coordinates, preserve existing behavior:
        // do not silently drop unless both have valid coordinates exceeding the distance.
      }

      eligibleDeck.push(cand);
      if (eligibleDeck.length === limit) {
        break;
      }
    }

    const hasMore = candidates.length > eligibleDeck.length || candidates.length > batchSize;
    let nextCursor = null;

    if (eligibleDeck.length > 0 && hasMore) {
      const cursorTargetId = eligibleDeck[eligibleDeck.length - 1].id;
      nextCursor = generateCursor({
        userId: currentUserId,
        profileId: cursorTargetId,
        filterSignature: currentFilterSignature,
      });
    }

    const now = new Date();
    const activeRush = await RushSession.findOne({
      where: {
        userId: currentUserId,
        startedAt: { [Op.lte]: now },
        expiresAt: { [Op.gt]: now },
      },
    });
    const isSparkRush = Boolean(activeRush);

    const formattedProfiles = eligibleDeck.map((p) =>
      formatPublicProfile(p, p.user, isSparkRush)
    );

    return res.status(200).json({
      success: true,
      data: formattedProfiles,
      pagination: {
        limit,
        has_more: Boolean(hasMore && nextCursor),
        next_cursor: nextCursor,
        count: formattedProfiles.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/profiles/:profile_id
exports.getProfileDetails = async (req, res, next) => {
  try {
    const currentUserId = req.auth.userId;
    const { profile_id } = req.params;

    if (!profile_id || !UUID_REGEX.test(profile_id)) {
      return res.status(400).json({
        success: false,
        message: "Valid Profile ID is required.",
      });
    }

    const targetProfile = await Profile.findByPk(profile_id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "dateOfBirth", "ageEligible", "accountStatus"],
        },
        {
          model: ProfileMedia,
          as: "media",
          where: { moderationStatus: "approved" },
          required: false,
          attributes: ["id", "mediaType", "storageRef", "moderationStatus"],
        },
      ],
    });

    if (!targetProfile || !targetProfile.user) {
      return res.status(404).json({
        success: false,
        message: "Profile not found.",
      });
    }

    // Do not permit viewing self via this discover-detail endpoint
    if (targetProfile.userId === currentUserId) {
      return res.status(403).json({
        success: false,
        message: "You cannot view your own profile through this discovery endpoint.",
      });
    }

    // Check account status and onboarding
    if (
      targetProfile.user.accountStatus !== "active" ||
      !targetProfile.user.ageEligible ||
      targetProfile.onboardingStatus !== "completed"
    ) {
      return res.status(404).json({
        success: false,
        message: "Profile is not available for discovery.",
      });
    }

    // Check blocks in both directions
    const block = await Block.findOne({
      where: {
        [Op.or]: [
          { blockerId: currentUserId, blockedId: targetProfile.userId },
          { blockerId: targetProfile.userId, blockedId: currentUserId },
        ],
      },
    });

    if (block) {
      return res.status(404).json({
        success: false,
        message: "Profile not found.",
      });
    }

    const now = new Date();
    const activeRush = await RushSession.findOne({
      where: {
        userId: currentUserId,
        startedAt: { [Op.lte]: now },
        expiresAt: { [Op.gt]: now },
      },
    });
    const isSparkRush = Boolean(activeRush);

    const formatted = formatPublicProfile(targetProfile, targetProfile.user, isSparkRush);

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/v1/discover/preferences
exports.updatePreferences = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { min_age, max_age, max_distance_km, interested_in_gender } = req.body;

    const errors = {};
    
    // Validate min_age
    if (min_age !== undefined) {
      if (typeof min_age !== "number" || !Number.isInteger(min_age) || min_age < 18 || min_age > 100) {
        errors.min_age = "Minimum age must be an integer between 18 and 100.";
      }
    }

    // Validate max_age
    if (max_age !== undefined) {
      if (typeof max_age !== "number" || !Number.isInteger(max_age) || max_age < 18 || max_age > 100) {
        errors.max_age = "Maximum age must be an integer between 18 and 100.";
      }
    }

    const resolvedMinAge = min_age !== undefined ? min_age : 18;
    const resolvedMaxAge = max_age !== undefined ? max_age : 100;

    if (min_age !== undefined && max_age !== undefined && min_age > max_age) {
      errors.age_range = "Minimum age cannot be greater than maximum age.";
    }

    // Validate max_distance_km
    if (max_distance_km !== undefined) {
      if (
        typeof max_distance_km !== "number" ||
        max_distance_km <= 0 ||
        max_distance_km > 500
      ) {
        errors.max_distance_km = "Maximum distance must be a number between 1 and 500 km.";
      }
    }

    // Validate interested_in_gender
    const allowedGenders = ["male", "female", "non-binary", "everyone", "all"];
    if (interested_in_gender !== undefined) {
      if (
        typeof interested_in_gender !== "string" ||
        !allowedGenders.includes(interested_in_gender.toLowerCase())
      ) {
        errors.interested_in_gender = `Interested in gender must be one of: ${allowedGenders.join(", ")}`;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid discovery preferences.",
        details: errors,
      });
    }

    // Fetch and update profile
    const profile = await Profile.findOne({ where: { userId } });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found.",
      });
    }

    // PUT replaces the discovery preferences cleanly
    const updatedPreferences = {
      ...(profile.preferences || {}),
      min_age: resolvedMinAge,
      max_age: resolvedMaxAge,
      max_distance_km: max_distance_km !== undefined ? max_distance_km : (profile.preferences && profile.preferences.max_distance_km) || 50,
      interested_in_gender: interested_in_gender ? interested_in_gender.toLowerCase() : (profile.preferences && profile.preferences.interested_in_gender) || "everyone",
    };

    profile.preferences = updatedPreferences;
    await profile.save();

    return res.status(200).json({
      success: true,
      message: "Discovery preferences updated successfully.",
      data: {
        preferences: updatedPreferences,
      },
    });
  } catch (error) {
    next(error);
  }
};
