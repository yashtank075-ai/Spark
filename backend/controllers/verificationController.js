const Profile = require("../models/Profile");
const ProfileMedia = require("../models/ProfileMedia");
const MediaUpload = require("../models/MediaUpload");
const User = require("../models/User");
const storageService = require("../services/storageService");
const faceVerificationService = require("../services/faceVerificationService");
const sequelize = require("../config/db");

// In-memory mutex map to prevent concurrent verification requests for the same user
const activeVerifications = new Set();

/**
 * POST /api/v1/verification/face
 * @deprecated Legacy endpoint. Please use PATCH /api/v1/me/profile with verification_selfie_upload_id.
 * Kept for backward compatibility with older Flutter client builds.
 */
exports.verifyFace = async (req, res, next) => {
  res.set("Deprecation", "true");
  res.set("Sunset", "2027-01-01");
  const userId = req.auth ? req.auth.userId : null;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required to initiate face verification.",
      },
    });
  }

  // Prevent concurrent requests for the same user
  if (activeVerifications.has(userId)) {
    return res.status(429).json({
      success: false,
      error: {
        code: "VERIFICATION_IN_PROGRESS",
        message:
          "A verification request is already in progress for your account. Please wait.",
      },
    });
  }

  const { upload_id, photo_id } = req.body || {};

  if (!upload_id || !photo_id) {
    return res.status(400).json({
      success: false,
      error: {
        code: "MISSING_REQUIRED_FIELDS",
        message:
          "Both 'upload_id' (verification selfie) and 'photo_id' (profile photo) are required.",
      },
    });
  }

  activeVerifications.add(userId);

  try {
    // 1. Fetch user profile
    const profile = await Profile.findOne({ where: { userId } });
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PROFILE_NOT_FOUND",
          message:
            "Profile not found. Complete profile setup before verification.",
        },
      });
    }

    // 2. Fetch and validate selfie MediaUpload
    const selfieUpload = await MediaUpload.findByPk(upload_id);
    if (!selfieUpload) {
      return res.status(404).json({
        success: false,
        error: {
          code: "SELFIE_NOT_FOUND",
          message: "The specified verification selfie upload was not found.",
        },
      });
    }

    if (selfieUpload.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: {
          code: "SELFIE_NOT_OWNED",
          message:
            "You do not have permission to use this media reference for verification.",
        },
      });
    }

    if (
      selfieUpload.status === "expired" ||
      new Date(selfieUpload.expiresAt) < new Date()
    ) {
      return res.status(410).json({
        success: false,
        error: {
          code: "SELFIE_EXPIRED",
          message:
            "Verification selfie has expired. Please capture and upload a fresh selfie.",
        },
      });
    }

    // 3. Fetch and validate target ProfileMedia photo
    const profilePhoto = await ProfileMedia.findByPk(photo_id);
    if (!profilePhoto || profilePhoto.mediaType !== "photo") {
      return res.status(404).json({
        success: false,
        error: {
          code: "PHOTO_NOT_FOUND",
          message: "The specified profile photo was not found.",
        },
      });
    }

    if (profilePhoto.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: {
          code: "PHOTO_NOT_OWNED",
          message: "The specified photo does not belong to your profile.",
        },
      });
    }

    // 4. Retrieve both image buffers securely from Cloudflare R2 / Storage
    let selfieBuffer;
    let photoBuffer;
    try {
      [selfieBuffer, photoBuffer] = await Promise.all([
        storageService.getFileBuffer(selfieUpload.storageKey),
        storageService.getFileBuffer(profilePhoto.storageRef),
      ]);
    } catch (storageErr) {
      console.error(
        "Storage fetch error during face verification:",
        storageErr.message,
      );
      return res.status(503).json({
        success: false,
        error: {
          code: "STORAGE_UNAVAILABLE",
          message:
            "Storage service is temporarily unavailable to retrieve media.",
        },
      });
    }

    if (!selfieBuffer || !photoBuffer) {
      return res.status(404).json({
        success: false,
        error: {
          code: "MEDIA_FILE_MISSING",
          message:
            "One or both of the media files could not be located in storage.",
        },
      });
    }

    // 5. Execute model comparison via FaceVerificationService
    let inferenceResult;
    try {
      inferenceResult = await faceVerificationService.compareFaces(
        selfieBuffer,
        photoBuffer,
      );
    } catch (modelErr) {
      console.error("Face verification model failure:", modelErr.message);
      return res.status(503).json({
        success: false,
        error: {
          code: "VERIFICATION_SERVICE_UNAVAILABLE",
          message:
            "Face verification inference engine is temporarily unavailable. Please retry shortly.",
        },
      });
    }

    // 6. Handle face detection errors (no face, multiple faces, decode issues)
    if (!inferenceResult.success) {
      profile.verificationStatus = "rejected";
      await profile.save();

      return res.status(422).json({
        success: false,
        error: {
          code: inferenceResult.error || "VERIFICATION_FAILED",
          message: inferenceResult.message || "Face verification failed.",
        },
        data: {
          is_verified: false,
          verification_status: "rejected",
        },
      });
    }

    // 7. Check match outcome based on model threshold
    if (!inferenceResult.match) {
      profile.verificationStatus = "rejected";
      await profile.save();

      return res.status(422).json({
        success: false,
        error: {
          code: "FACE_MISMATCH",
          message:
            "The selfie does not match the chosen profile photo. Please try again with a clearer photo.",
        },
        data: {
          is_verified: false,
          verification_status: "rejected",
        },
      });
    }

    // 8. Verification successful: persist in transaction
    const transaction = await sequelize.transaction();
    try {
      // Mark selfie upload as registered for audit retention
      selfieUpload.status = "registered";
      selfieUpload.registeredAt = new Date();
      await selfieUpload.save({ transaction });

      // Update profile
      profile.isVerified = true;
      profile.verificationStatus = "verified";
      profile.verificationSelfieMediaId = selfieUpload.id;
      profile.verifiedAt = new Date();
      profile.verificationMethod =
        inferenceResult.model || "insightface_buffalo_sc";
      await profile.save({ transaction });

      // Update profilePhoto face review status
      profilePhoto.faceReviewStatus = "matched";
      profilePhoto.faceSimilarity = inferenceResult.similarity || 1.0;
      profilePhoto.faceReviewedAt = new Date();
      await profilePhoto.save({ transaction });

      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: "Face verification successful. Your profile is now verified!",
        data: {
          is_verified: true,
          verification_status: "verified",
          verified_at: profile.verifiedAt,
        },
      });
    } catch (dbErr) {
      await transaction.rollback();
      throw dbErr;
    }
  } catch (error) {
    next(error);
  } finally {
    activeVerifications.delete(userId);
  }
};
