const Profile = require("../models/Profile");
const ProfileMedia = require("../models/ProfileMedia");
const MediaUpload = require("../models/MediaUpload");
const User = require("../models/User");
const sequelize = require("../config/db");
const storageService = require("../services/storageService");
const biometricVerificationService = require("../services/biometricVerificationService");
const { validateImageFile } = require("../validators/imageValidator");
const {
  validateProfilePatch,
  calculateAge,
  isValidDate,
} = require("../validators/profileValidator");

// Helper to format preferences for response
function formatPreferencesResponse(prefs) {
  const p = prefs || {};
  let interestedIn = p.interested_in;
  if (!interestedIn && p.interested_in_gender) {
    interestedIn = [p.interested_in_gender];
  }
  if (typeof interestedIn === "string") {
    interestedIn = [interestedIn];
  }
  return {
    interested_in: interestedIn || [],
    age_min:
      p.age_min !== undefined
        ? p.age_min
        : p.min_age !== undefined
          ? p.min_age
          : 18,
    age_max:
      p.age_max !== undefined
        ? p.age_max
        : p.max_age !== undefined
          ? p.max_age
          : 100,
    distance_km:
      p.distance_km !== undefined
        ? p.distance_km
        : p.max_distance_km !== undefined
          ? p.max_distance_km
          : 50,
  };
}

// Helper to format safe location (never expose lat/lng in public responses)
function formatSafeLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  return {
    city: loc.city || null,
    state: loc.state || null,
    country: loc.country || null,
  };
}

// Helper to format private location for authenticated user
function formatAuthLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const res = {
    city: loc.city || null,
    state: loc.state || null,
    country: loc.country || null,
  };
  if (loc.latitude !== undefined && loc.latitude !== null)
    res.latitude = loc.latitude;
  if (loc.longitude !== undefined && loc.longitude !== null)
    res.longitude = loc.longitude;
  if (loc.source) res.source = loc.source;
  return res;
}

// Helper to format media lists
function formatPhotoItem(m) {
  return {
    id: m.id,
    media_type: m.mediaType || "photo",
    url: storageService.getPublicUrl(m.storageRef),
    is_primary: Boolean(m.isPrimary),
    display_order: m.displayOrder !== undefined ? m.displayOrder : 0,
    status: m.moderationStatus,
    face_review_status: m.faceReviewStatus || "not_applicable",
  };
}

// GET /api/v1/me/profile
exports.getProfile = async (req, res, next) => {
  try {
    const userId = req.auth.userId;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const profile = await Profile.findOne({ where: { userId } });

    if (!profile) {
      return res.status(200).json({
        success: true,
        message: "No profile found. You can begin onboarding.",
        data: null,
        onboarding_status: "not_started",
        age_eligible: user.ageEligible,
      });
    }

    // Fetch user media
    const allMedia = await ProfileMedia.findAll({
      where: { userId },
      order: [
        ["display_order", "ASC"],
        ["created_at", "ASC"],
      ],
    });

    const photos = allMedia
      .filter((m) => m.mediaType === "photo")
      .map(formatPhotoItem);

    const voiceMedia = allMedia.find((m) => m.mediaType === "voice_intro");
    const voiceIntro = voiceMedia
      ? {
          id: voiceMedia.id,
          url: storageService.getPublicUrl(voiceMedia.storageRef),
          status: voiceMedia.moderationStatus,
        }
      : null;

    const calculatedAge = calculateAge(user.dateOfBirth);

    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully.",
      data: {
        id: profile.id,
        display_name: profile.displayName || null,
        date_of_birth: user.dateOfBirth || null,
        age: calculatedAge,
        gender: profile.gender || null,
        show_gender_on_profile:
          profile.showGenderOnProfile !== undefined
            ? profile.showGenderOnProfile
            : true,
        preferences: formatPreferencesResponse(profile.preferences),
        dating_intention: profile.datingIntention || null,
        dating_speed: profile.datingSpeed || null,
        interests: profile.interests || [],
        bio: profile.bio || null,
        prompts: profile.prompts || [],
        boundaries: Array.isArray(profile.boundaries) ? profile.boundaries : [],
        boundary_preferences: profile.boundaryPreferences || {},
        location: formatAuthLocation(profile.location),
        photos,
        voice_intro: voiceIntro,
        is_verified: Boolean(profile.isVerified),
        verification_status: profile.verificationStatus || "pending",
        verification:
          biometricVerificationService.buildVerificationState(profile)
            .verification,
      },
      onboarding_status: profile.onboardingStatus,
      age_eligible: user.ageEligible,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/me/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const body = req.body;

    // Validate request body
    const validation = validateProfilePatch(body);
    if (!validation.isValid) {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Please correct the invalid fields.",
        details: validation.errors,
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Handle date_of_birth if present
    if (body.date_of_birth !== undefined) {
      const age = calculateAge(body.date_of_birth);
      user.dateOfBirth = body.date_of_birth;
      user.ageEligible = age >= 18;
      await user.save();
    }

    let profile = await Profile.findOne({ where: { userId } });
    if (!profile) {
      profile = await Profile.create({
        userId,
        onboardingStatus: "in_progress",
      });
    } else if (profile.onboardingStatus === "not_started") {
      profile.onboardingStatus = "in_progress";
    }

    // Apply partial updates
    if (body.display_name !== undefined) {
      profile.displayName = body.display_name.trim();
    }

    if (body.gender !== undefined) {
      profile.gender = body.gender ? body.gender.toLowerCase() : null;
    }

    if (body.show_gender_on_profile !== undefined) {
      profile.showGenderOnProfile = body.show_gender_on_profile;
    }

    const intentionVal =
      body.dating_intention !== undefined
        ? body.dating_intention
        : body.intention;
    if (intentionVal !== undefined) {
      profile.datingIntention = intentionVal
        ? intentionVal.toLowerCase()
        : null;
    }

    if (body.dating_speed !== undefined) {
      profile.datingSpeed = body.dating_speed
        ? body.dating_speed.toLowerCase()
        : null;
    }

    if (body.interests !== undefined) {
      profile.interests = body.interests === null ? [] : body.interests;
    }

    if (body.bio !== undefined) {
      profile.bio = body.bio === null ? null : body.bio.trim();
    }

    if (body.prompts !== undefined) {
      profile.prompts = body.prompts === null ? [] : body.prompts;
    }

    if (body.boundaries !== undefined) {
      profile.boundaries = body.boundaries === null ? [] : body.boundaries;
    }

    if (body.boundary_preferences !== undefined) {
      if (body.boundary_preferences === null) {
        profile.boundaryPreferences = {};
      } else {
        profile.boundaryPreferences = {
          ...(profile.boundaryPreferences || {}),
          ...body.boundary_preferences,
        };
      }
    }

    if (body.preferences !== undefined) {
      if (body.preferences === null) {
        profile.preferences = {};
      } else {
        const currentPrefs = profile.preferences || {};
        const incoming = body.preferences;
        const merged = { ...currentPrefs };

        const interestedInVal =
          incoming.interested_in !== undefined
            ? incoming.interested_in
            : incoming.interested_in_gender;
        if (interestedInVal !== undefined) {
          const list = Array.isArray(interestedInVal)
            ? interestedInVal.map((g) => g.toLowerCase())
            : [interestedInVal.toLowerCase()];
          merged.interested_in = list;
          merged.interested_in_gender =
            list.length === 1
              ? list[0]
              : list.includes("everyone")
                ? "everyone"
                : list[0];
        }

        const minAgeVal =
          incoming.age_min !== undefined ? incoming.age_min : incoming.min_age;
        if (minAgeVal !== undefined) {
          merged.age_min = minAgeVal;
          merged.min_age = minAgeVal;
        }

        const maxAgeVal =
          incoming.age_max !== undefined ? incoming.age_max : incoming.max_age;
        if (maxAgeVal !== undefined) {
          merged.age_max = maxAgeVal;
          merged.max_age = maxAgeVal;
        }

        const distVal =
          incoming.distance_km !== undefined
            ? incoming.distance_km
            : incoming.max_distance_km;
        if (distVal !== undefined) {
          merged.distance_km = distVal;
          merged.max_distance_km = distVal;
        }

        profile.preferences = merged;
      }
    }

    if (body.location !== undefined) {
      if (body.location === null) {
        profile.location = {};
      } else {
        profile.location = {
          ...(profile.location || {}),
          ...body.location,
        };
      }
    }

    await profile.save();

    // Check if initial verification selfie is provided in this update
    if (body.verification_selfie_upload_id) {
      const enrollmentResult =
        await biometricVerificationService.enrollInitialVerification(
          userId,
          body.verification_selfie_upload_id,
          { biometricConsent: body.biometric_consent !== false },
        );

      if (!enrollmentResult.success) {
        const errStatus =
          enrollmentResult.error && enrollmentResult.error.status
            ? enrollmentResult.error.status
            : 422;
        return res.status(errStatus).json({
          success: false,
          error: {
            code: enrollmentResult.error
              ? enrollmentResult.error.code
              : "VERIFICATION_FAILED",
            message: enrollmentResult.error
              ? enrollmentResult.error.message
              : "Face verification failed.",
          },
          data: enrollmentResult.data || {
            is_verified: false,
            verification_status: "rejected",
          },
        });
      }

      return res.status(200).json({
        success: true,
        message:
          enrollmentResult.message ||
          "Face verification successful. Your profile is now verified!",
        onboarding_status: profile.onboardingStatus,
        age_eligible: user.ageEligible,
        data: {
          is_verified: enrollmentResult.data.is_verified,
          verification_status: enrollmentResult.data.verification_status,
          verified_at: enrollmentResult.data.verified_at,
          verification: enrollmentResult.data.verification,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated.",
      onboarding_status: profile.onboardingStatus,
      age_eligible: user.ageEligible,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/profile/intention (backward compatible endpoint reusing validation)
exports.updateIntention = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const rawIntention = req.body.intention || req.body.dating_intention;

    if (!rawIntention || typeof rawIntention !== "string") {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid dating intention.",
      });
    }

    const normalized = rawIntention.trim().toLowerCase();
    const allowed = ["vibe", "explore", "intent"];
    if (!allowed.includes(normalized)) {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid dating intention.",
      });
    }

    let profile = await Profile.findOne({ where: { userId } });
    if (!profile) {
      profile = await Profile.create({
        userId,
        onboardingStatus: "in_progress",
      });
    }

    profile.datingIntention = normalized;
    await profile.save();

    return res.status(200).json({
      success: true,
      message: "Dating intention updated.",
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/me/photos
exports.getPhotos = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const photos = await ProfileMedia.findAll({
      where: { userId, mediaType: "photo" },
      order: [
        ["display_order", "ASC"],
        ["created_at", "ASC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Photos fetched successfully.",
      data: photos.map(formatPhotoItem),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/me/photos
// Supports both:
// 1. Two-step registration: { upload_id, is_primary, display_order }
// 2. Backward-compatible direct multipart upload: req.file
exports.addPhoto = async (req, res, next) => {
  try {
    const userId = req.auth ? req.auth.userId : null;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required to register photos.",
        },
      });
    }

    // Check account eligibility
    const user = await User.findByPk(userId);
    if (!user || user.accountStatus !== "active") {
      return res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_INELIGIBLE",
          message: "Account is not eligible to register profile media.",
        },
      });
    }

    // 1. Check for raw Base64 data URLs in request body
    const bodyStr = JSON.stringify(req.body || {});
    if (/data:image\/[a-zA-Z0-9.+]+;base64,/i.test(bodyStr)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "RAW_BASE64_NOT_ALLOWED",
          message:
            "Raw Base64 data URLs are not allowed in photo registration requests. Use POST /api/v1/upload/single first.",
        },
      });
    }

    const MAX_PROFILE_PHOTOS = 9;

    // --- Branch A: Two-Step Registration via upload_id ---
    if (req.body && req.body.upload_id) {
      const uploadId = String(req.body.upload_id).trim();

      // Check for idempotent retry: if already registered by the same user, return existing record
      const existingMedia = await ProfileMedia.findOne({
        where: { userId, mediaType: "photo" },
      });
      // Find upload record
      const mediaUpload = await MediaUpload.findByPk(uploadId);

      if (!mediaUpload) {
        return res.status(404).json({
          success: false,
          error: {
            code: "UPLOAD_NOT_FOUND",
            message: "The requested upload_id was not found.",
          },
        });
      }

      // Check ownership
      if (mediaUpload.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: "UPLOAD_NOT_OWNED",
            message: "This upload cannot be registered to your profile.",
          },
        });
      }

      // Check if already registered
      if (mediaUpload.status === "registered") {
        // If already registered, find if it's currently registered to this user's profile
        const alreadyRegisteredPhoto = await ProfileMedia.findOne({
          where: {
            userId,
            storageRef: mediaUpload.storageKey,
            mediaType: "photo",
          },
        });
        if (alreadyRegisteredPhoto) {
          // Idempotent retry: return existing profile media record
          return res.status(200).json({
            success: true,
            message: "Profile photo already registered.",
            data: {
              id: alreadyRegisteredPhoto.id,
              media_type: alreadyRegisteredPhoto.mediaType,
              url: `/api/v1/media/${alreadyRegisteredPhoto.id}`,
              is_primary: Boolean(alreadyRegisteredPhoto.isPrimary),
              display_order: alreadyRegisteredPhoto.displayOrder,
            },
          });
        }
        return res.status(409).json({
          success: false,
          error: {
            code: "UPLOAD_ALREADY_REGISTERED",
            message:
              "This upload has already been registered to another media record.",
          },
        });
      }

      // Check expiration
      if (
        mediaUpload.status === "expired" ||
        new Date(mediaUpload.expiresAt) < new Date()
      ) {
        if (mediaUpload.status !== "expired") {
          mediaUpload.status = "expired";
          await mediaUpload.save();
        }
        return res.status(410).json({
          success: false,
          error: {
            code: "UPLOAD_EXPIRED",
            message:
              "This temporary upload has expired. Please upload the photo again.",
          },
        });
      }

      // Verify the storage object actually exists
      try {
        const fileMeta = await storageService.getFileMetadata(
          mediaUpload.storageKey,
        );
        if (!fileMeta) {
          return res.status(404).json({
            success: false,
            error: {
              code: "UPLOAD_NOT_FOUND",
              message: "Storage object for this upload could not be verified.",
            },
          });
        }
      } catch (err) {
        console.error("Storage verification error:", err.message);
        return res.status(503).json({
          success: false,
          error: {
            code: "STORAGE_UNAVAILABLE",
            message: "Storage service temporarily unavailable to verify file.",
          },
        });
      }

      // Perform transaction to lock, register and create photo
      const transaction = await sequelize.transaction();
      try {
        // Double check count inside transaction
        const existingCount = await ProfileMedia.count({
          where: { userId, mediaType: "photo" },
          transaction,
        });

        if (existingCount >= MAX_PROFILE_PHOTOS) {
          await transaction.rollback();
          return res.status(422).json({
            success: false,
            error: {
              code: "PHOTO_LIMIT_EXCEEDED",
              message: `You cannot upload more than ${MAX_PROFILE_PHOTOS} profile photos.`,
            },
          });
        }

        // Determine primary and display order
        const wantPrimary =
          req.body.is_primary === true ||
          req.body.is_primary === "true" ||
          existingCount === 0;

        let displayOrder =
          typeof req.body.display_order === "number"
            ? req.body.display_order
            : existingCount;

        if (wantPrimary) {
          // If this photo will be primary, reset previous primary photos
          await ProfileMedia.update(
            { isPrimary: false },
            { where: { userId, mediaType: "photo" }, transaction },
          );
        }

        const photo = await ProfileMedia.create(
          {
            userId,
            mediaType: "photo",
            storageRef: mediaUpload.storageKey,
            moderationStatus: "pending",
            isPrimary: wantPrimary,
            displayOrder,
          },
          { transaction },
        );

        // Mark upload as registered
        mediaUpload.status = "registered";
        mediaUpload.registeredAt = new Date();
        await mediaUpload.save({ transaction });

        await transaction.commit();

        // Automatic Face Verification matching against existing verified reference
        const matchPromise =
          biometricVerificationService.matchPhotoAgainstReference(
            photo.id,
            userId,
          );
        if (process.env.NODE_ENV === "test") {
          await matchPromise;
          if (photo && typeof photo.reload === "function") {
            await photo.reload();
          }
        }

        // Fetch refreshed profile to return verification status
        const currentProfile = await Profile.findOne({ where: { userId } });
        const verificationState =
          biometricVerificationService.buildVerificationState(currentProfile);

        return res.status(201).json({
          success: true,
          message: "Profile photo added successfully.",
          data: {
            id: photo.id,
            media_type: photo.mediaType,
            url: `/api/v1/media/${photo.id}`,
            is_primary: Boolean(photo.isPrimary),
            display_order: photo.displayOrder,
            face_review_status: photo.faceReviewStatus || "pending",
            is_verified: currentProfile ? Boolean(currentProfile.isVerified) : false,
            verification_status: currentProfile ? currentProfile.verificationStatus : "pending",
            verification: verificationState.verification,
          },
        });
      } catch (txnErr) {
        await transaction.rollback();
        throw txnErr;
      }
    }

    // --- Branch B: Backward-Compatible Direct Multipart Upload ---
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_IMAGE",
          message:
            "No photo provided. Supply an 'upload_id' or attach an image file.",
        },
      });
    }

    // Binary file validation
    const validation = validateImageFile(req.file);
    if (!validation.isValid) {
      const statusCode =
        validation.error.code === "IMAGE_TOO_LARGE" ? 413 : 400;
      return res.status(statusCode).json({
        success: false,
        error: validation.error,
      });
    }

    // Check photo count
    const existingPhotosCount = await ProfileMedia.count({
      where: { userId, mediaType: "photo" },
    });
    if (existingPhotosCount >= MAX_PROFILE_PHOTOS) {
      return res.status(422).json({
        success: false,
        error: {
          code: "PHOTO_LIMIT_EXCEEDED",
          message: `You cannot upload more than ${MAX_PROFILE_PHOTOS} profile photos.`,
        },
      });
    }

    let storageRef;
    try {
      storageRef = await storageService.uploadFile(req.file, {
        folder: "profile-photos",
      });
    } catch (err) {
      console.error("Storage upload failed:", err.message);
      return res.status(503).json({
        success: false,
        error: {
          code: "STORAGE_UNAVAILABLE",
          message: "Storage provider is temporarily unavailable.",
        },
      });
    }

    const isPrimary =
      req.body.is_primary === true ||
      req.body.is_primary === "true" ||
      existingPhotosCount === 0;
    const displayOrder =
      typeof req.body.display_order === "number"
        ? req.body.display_order
        : existingPhotosCount;

    if (isPrimary) {
      await ProfileMedia.update(
        { isPrimary: false },
        { where: { userId, mediaType: "photo" } },
      );
    }

    const photo = await ProfileMedia.create({
      userId,
      mediaType: "photo",
      storageRef,
      moderationStatus: "pending",
      isPrimary,
      displayOrder,
    });

    // Automatic Face Verification matching against existing verified reference
    const matchPromise =
      biometricVerificationService.matchPhotoAgainstReference(photo.id, userId);
    if (process.env.NODE_ENV === "test") {
      await matchPromise;
      if (photo && typeof photo.reload === "function") {
        await photo.reload();
      }
    }

    return res.status(201).json({
      success: true,
      message: "Photo uploaded successfully.",
      data: {
        id: photo.id,
        media_type: photo.mediaType,
        url: `/api/v1/media/${photo.id}`,
        is_primary: Boolean(photo.isPrimary),
        display_order: photo.displayOrder,
        status: photo.moderationStatus,
        face_review_status: photo.faceReviewStatus || "pending",
      },
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/v1/me/photos/order
exports.reorderPhotos = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { photo_ids, primary_photo_id } = req.body;

    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "photo_ids must be a non-empty array of photo IDs.",
      });
    }

    const userPhotos = await ProfileMedia.findAll({
      where: { userId, mediaType: "photo" },
    });

    const userPhotoMap = new Map(userPhotos.map((p) => [p.id, p]));

    // Verify all photo_ids belong to the authenticated user
    for (const id of photo_ids) {
      if (!userPhotoMap.has(id)) {
        return res.status(404).json({
          success: false,
          message: `Photo with ID '${id}' not found or does not belong to user.`,
        });
      }
    }

    const resolvedPrimaryId = primary_photo_id || photo_ids[0];
    if (primary_photo_id && !userPhotoMap.has(primary_photo_id)) {
      return res.status(404).json({
        success: false,
        message: `Primary photo with ID '${primary_photo_id}' not found or does not belong to user.`,
      });
    }

    // Update display_order and is_primary
    for (let index = 0; index < photo_ids.length; index++) {
      const pid = photo_ids[index];
      const photo = userPhotoMap.get(pid);
      photo.displayOrder = index;
      photo.isPrimary = pid === resolvedPrimaryId;
      await photo.save();
    }

    // If user has a verified reference, automatically trigger matching for the designated primary photo
    const profile = await Profile.findOne({ where: { userId } });
    if (profile && profile.verificationSelfieMediaId) {
      const matchPromise =
        biometricVerificationService.matchPhotoAgainstReference(
          resolvedPrimaryId,
          userId,
        );
      if (process.env.NODE_ENV === "test") {
        await matchPromise;
      }
    }

    const updatedPhotos = await ProfileMedia.findAll({
      where: { userId, mediaType: "photo" },
      order: [["display_order", "ASC"]],
    });

    return res.status(200).json({
      success: true,
      message: "Photos reordered successfully.",
      data: updatedPhotos.map(formatPhotoItem),
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/me/photos/:photo_id
exports.deletePhoto = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { photo_id } = req.params;

    const photo = await ProfileMedia.findOne({
      where: { id: photo_id, userId, mediaType: "photo" },
    });

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: "Photo not found or does not belong to user.",
      });
    }

    const wasPrimary = Boolean(photo.isPrimary);

    // Check if other profile media records reference the same storageRef before deleting the physical file
    const otherReferences = await ProfileMedia.count({
      where: {
        storageRef: photo.storageRef,
        id: { [require("sequelize").Op.ne]: photo.id },
      },
    });

    if (otherReferences === 0) {
      try {
        await storageService.deleteFile(photo.storageRef);
      } catch (err) {
        console.error("Storage deletion failed:", err.message);
      }
    }

    // Clean up or update associated MediaUpload record if exists
    try {
      await MediaUpload.destroy({
        where: { storageKey: photo.storageRef, userId },
      });
    } catch (uploadCleanupErr) {
      console.error(
        "MediaUpload record cleanup error:",
        uploadCleanupErr.message,
      );
    }

    await photo.destroy();

    // If was primary, promote remaining first photo if any
    if (wasPrimary) {
      const nextPhoto = await ProfileMedia.findOne({
        where: { userId, mediaType: "photo" },
        order: [
          ["display_order", "ASC"],
          ["created_at", "ASC"],
        ],
      });
      if (nextPhoto) {
        nextPhoto.isPrimary = true;
        await nextPhoto.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: "Photo deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/me/voice-intro
exports.addVoiceIntro = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No audio provided." });
    }

    const allowedMimeTypes = [
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "audio/aac",
      "audio/wav",
      "audio/webm",
    ];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res
        .status(422)
        .json({ success: false, message: "Invalid audio format." });
    }

    let storageRef;
    try {
      storageRef = await storageService.uploadFile(req.file);
    } catch (err) {
      return res.status(501).json({ success: false, message: err.message });
    }

    // Replace previous voice intro if exists
    const existing = await ProfileMedia.findOne({
      where: { userId, mediaType: "voice_intro" },
    });

    if (existing) {
      try {
        await storageService.deleteFile(existing.storageRef);
      } catch (err) {
        console.error("Storage deletion failed:", err.message);
      }
      await existing.destroy();
    }
 
    const audio = await ProfileMedia.create({
      userId,
      mediaType: "voice_intro",
      storageRef,
      moderationStatus: "pending",
    });

    return res.status(201).json({
      success: true,
      message: "Voice intro uploaded successfully.",
      data: {
        id: audio.id,
        url: storageService.getPublicUrl(audio.storageRef),
        status: audio.moderationStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/v1/me/voice-intro
exports.deleteVoiceIntro = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const audio = await ProfileMedia.findOne({
      where: { userId, mediaType: "voice_intro" },
    });

    if (!audio) {
      return res.status(404).json({
        success: false,
        message: "Voice intro not found.",
      });
    }

    try {
      await storageService.deleteFile(audio.storageRef);
    } catch (err) {
      console.error("Storage deletion failed:", err.message);
    }

    await audio.destroy();

    return res.status(200).json({
      success: true,
      message: "Voice intro deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/me/onboarding/complete
exports.completeOnboarding = async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const user = await User.findByPk(userId);
    const profile = await Profile.findOne({ where: { userId } });

    if (!profile) {
      return res.status(400).json({
        success: false,
        message: "Profile does not exist. Cannot complete onboarding.",
      });
    }

    if (!user.dateOfBirth || !user.ageEligible) {
      return res.status(403).json({
        success: false,
        message: "You must be at least 18 years old to complete onboarding.",
      });
    }

    const missingFields = [];
    if (!profile.displayName) missingFields.push("display_name");
    if (!user.dateOfBirth) missingFields.push("date_of_birth");
    if (!profile.gender) missingFields.push("gender");
    if (!profile.datingIntention) missingFields.push("dating_intention");
    if (!profile.datingSpeed) missingFields.push("dating_speed");

    // Location check: city or latitude/longitude
    const loc = profile.location || {};
    if (
      !loc.city &&
      (loc.latitude === undefined || loc.longitude === undefined)
    ) {
      missingFields.push("location");
    }

    // Photo check: at least 1 photo uploaded
    const photoCount = await ProfileMedia.count({
      where: { userId, mediaType: "photo" },
    });
    if (photoCount === 0) {
      missingFields.push("photos");
    }

    if (missingFields.length > 0) {
      return res.status(422).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Missing required onboarding fields.",
        details: missingFields,
      });
    }

    profile.onboardingStatus = "completed";
    await profile.save();

    return res.status(200).json({
      success: true,
      message: "Onboarding completed successfully.",
      onboarding_status: profile.onboardingStatus,
    });
  } catch (error) {
    next(error);
  }
};
