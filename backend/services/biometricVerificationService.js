const Profile = require("../models/Profile");
const ProfileMedia = require("../models/ProfileMedia");
const MediaUpload = require("../models/MediaUpload");
const storageService = require("./storageService");
const faceVerificationService = require("./faceVerificationService");
const sequelize = require("../config/db");

// In-memory mutex map to prevent concurrent verification tasks for the same user
const activeVerifications = new Set();

class BiometricVerificationService {
  /**
   * Check if user is currently running a verification job
   */
  isVerificationActive(userId) {
    return activeVerifications.has(userId);
  }

  /**
   * Acquire mutex lock for user
   */
  acquireLock(userId) {
    if (activeVerifications.has(userId)) {
      return false;
    }
    activeVerifications.add(userId);
    return true;
  }

  /**
   * Release mutex lock for user
   */
  releaseLock(userId) {
    activeVerifications.delete(userId);
  }

  /**
   * Resolves the primary profile photo for a user.
   * Priority:
   * 1. Media with isPrimary: true
   * 2. First photo sorted by displayOrder ASC, createdAt ASC
   */
  async getPrimaryProfilePhoto(userId, options = {}) {
    const transaction = options.transaction;
    let photo = await ProfileMedia.findOne({
      where: {
        userId,
        mediaType: "photo",
        isPrimary: true,
      },
      transaction,
    });

    if (!photo) {
      photo = await ProfileMedia.findOne({
        where: {
          userId,
          mediaType: "photo",
        },
        order: [
          ["display_order", "ASC"],
          ["created_at", "ASC"],
        ],
        transaction,
      });
    }

    return photo;
  }

  /**
   * Validates a verification selfie upload record.
   * Checks existence, ownership, folder, and expiration.
   */
  async validateSelfieUpload(uploadId, userId) {
    const selfieUpload = await MediaUpload.findByPk(uploadId);
    if (!selfieUpload) {
      return {
        valid: false,
        error: {
          code: "SELFIE_NOT_FOUND",
          status: 404,
          message: "The specified verification selfie upload was not found.",
        },
      };
    }

    if (selfieUpload.userId !== userId) {
      return {
        valid: false,
        error: {
          code: "SELFIE_NOT_OWNED",
          status: 403,
          message: "You do not have permission to use this media reference for verification.",
        },
      };
    }

    // Must be in verification-selfies folder
    const storageKey = selfieUpload.storageKey || "";
    if (
      !storageKey.startsWith("verification-selfies/") &&
      !storageKey.startsWith("selfies/")
    ) {
      return {
        valid: false,
        error: {
          code: "INVALID_SELFIE_FOLDER",
          status: 400,
          message: "Verification selfie must be uploaded to the 'verification-selfies' folder.",
        },
      };
    }

    if (
      selfieUpload.status === "expired" ||
      new Date(selfieUpload.expiresAt) < new Date()
    ) {
      return {
        valid: false,
        error: {
          code: "SELFIE_EXPIRED",
          status: 410,
          message: "Verification selfie has expired. Please capture and upload a fresh selfie.",
        },
      };
    }

    return { valid: true, selfieUpload };
  }

  /**
   * Execute face comparison between selfie buffer and photo buffer.
   */
  async compareBuffers(selfieBuffer, photoBuffer) {
    if (!selfieBuffer || !photoBuffer) {
      return {
        success: false,
        error: "MEDIA_FILE_MISSING",
        message: "One or both of the media files could not be located in storage.",
      };
    }

    return await faceVerificationService.compareFaces(selfieBuffer, photoBuffer);
  }

  /**
   * Enroll first-time verification selfie.
   * Compares the selfie with user's primary profile photo.
   * If matched:
   *  - Sets profile.isVerified = true, profile.verificationStatus = "verified"
   *  - Sets profile.verificationSelfieMediaId = selfieUpload.id (reusable reference)
   *  - Marks primary photo as matched
   * If not matched or no face:
   *  - Sets profile.verificationStatus = "rejected"
   *  - Returns structured failure
   */
  async enrollInitialVerification(userId, selfieUploadId, options = {}) {
    if (!this.acquireLock(userId)) {
      return {
        success: false,
        error: {
          code: "VERIFICATION_IN_PROGRESS",
          status: 429,
          message: "A verification request is already in progress for your account. Please wait.",
        },
      };
    }

    try {
      // 1. Fetch user profile
      const profile = await Profile.findOne({ where: { userId } });
      if (!profile) {
        return {
          success: false,
          error: {
            code: "PROFILE_NOT_FOUND",
            status: 404,
            message: "Profile not found. Complete profile setup before verification.",
          },
        };
      }

      // 2. Validate selfie upload
      const uploadValidation = await this.validateSelfieUpload(selfieUploadId, userId);
      if (!uploadValidation.valid) {
        return { success: false, error: uploadValidation.error };
      }
      const selfieUpload = uploadValidation.selfieUpload;

      // 3. Find primary and candidate profile photos
      const primaryPhoto = await this.getPrimaryProfilePhoto(userId);
      if (!primaryPhoto) {
        return {
          success: false,
          error: {
            code: "PRIMARY_PHOTO_REQUIRED",
            status: 400,
            message: "Add a primary profile photo before face verification.",
          },
        };
      }

      // Fetch all candidate user photos, prioritizing primary first, then by displayOrder ASC
      const allUserPhotos = await ProfileMedia.findAll({
        where: { userId, mediaType: "photo" },
        order: [
          ["is_primary", "DESC"],
          ["display_order", "ASC"],
          ["created_at", "ASC"],
        ],
      });

      // 4. Retrieve selfie buffer
      let selfieBuffer;
      try {
        selfieBuffer = await storageService.getFileBuffer(selfieUpload.storageKey);
      } catch (storageErr) {
        console.error("Storage fetch error during face verification (selfie):", storageErr.message);
        return {
          success: false,
          error: {
            code: "STORAGE_UNAVAILABLE",
            status: 503,
            message: "Storage service is temporarily unavailable to retrieve media.",
          },
        };
      }

      if (!selfieBuffer) {
        return {
          success: false,
          error: {
            code: "MEDIA_FILE_MISSING",
            status: 404,
            message: "Verification selfie could not be located in storage.",
          },
        };
      }

      // 5. Try comparing selfie against candidate profile photos
      let matchedPhoto = null;
      let lastInferenceResult = null;
      let foundFaceInAnyPhoto = false;

      for (const candidatePhoto of allUserPhotos) {
        let photoBuffer;
        try {
          photoBuffer = await storageService.getFileBuffer(candidatePhoto.storageRef);
        } catch (fetchErr) {
          console.warn(`Could not fetch photo buffer for media ${candidatePhoto.id}:`, fetchErr.message);
          continue;
        }

        if (!photoBuffer) continue;

        let inferenceResult;
        try {
          inferenceResult = await faceVerificationService.compareFaces(selfieBuffer, photoBuffer);
        } catch (modelErr) {
          console.error("Face verification model failure:", modelErr.message);
          return {
            success: false,
            error: {
              code: "VERIFICATION_SERVICE_UNAVAILABLE",
              status: 503,
              message: "Face verification inference engine is temporarily unavailable. Please retry shortly.",
            },
          };
        }

        lastInferenceResult = inferenceResult;

        // Check if selfie itself has error (e.g. no face in selfie, multiple faces)
        if (
          !inferenceResult.success &&
          (inferenceResult.error === "NO_FACE_IN_SELFIE" ||
            inferenceResult.error === "MULTIPLE_FACES_IN_SELFIE")
        ) {
          profile.verificationStatus = "rejected";
          await profile.save();

          return {
            success: false,
            error: {
              code: inferenceResult.error,
              status: 422,
              message: inferenceResult.message || "Face verification failed.",
            },
            data: {
              is_verified: false,
              verification_status: "rejected",
            },
          };
        }

        // If no face in this photo, mark candidate status and continue searching other photos
        if (
          !inferenceResult.success &&
          inferenceResult.error === "NO_FACE_IN_PROFILE_PHOTO"
        ) {
          candidatePhoto.faceReviewStatus = "review_required";
          await candidatePhoto.save();
          continue;
        }

        // Face detected in candidate photo
        foundFaceInAnyPhoto = true;

        if (inferenceResult.success && inferenceResult.match) {
          matchedPhoto = candidatePhoto;
          break;
        } else if (!inferenceResult.match) {
          candidatePhoto.faceReviewStatus = "mismatched";
          candidatePhoto.faceSimilarity = inferenceResult.similarity || 0.0;
          candidatePhoto.faceReviewedAt = new Date();
          await candidatePhoto.save();
        }
      }

      // If no face was detected in any registered profile photo:
      // Treat this as a recoverable prerequisite state (NO_FACE_IN_PROFILE_PHOTO).
      // Preserve the pending selfie reference on profile!
      if (!foundFaceInAnyPhoto) {
        profile.verificationSelfieMediaId = selfieUpload.id;
        profile.verificationStatus = "pending";
        profile.isVerified = false;
        await profile.save();

        return {
          success: false,
          error: {
            code: "NO_FACE_IN_PROFILE_PHOTO",
            status: 422,
            message: "Add a clear profile photo showing your face to continue verification.",
          },
          data: {
            is_verified: false,
            verification_status: "pending",
            verification: {
              requires_profile_photo: true,
              requires_selfie: false,
              can_resume: true,
              can_retry: false,
              has_reference: true,
              last_verified_at: null,
            },
          },
        };
      }

      // If face was found in photo(s), but no photos matched the selfie:
      // The selfie is still validly captured and enrolled! Do NOT discard the selfie reference.
      // Treat this as awaiting an eligible profile photo replacement.
      if (!matchedPhoto) {
        profile.verificationSelfieMediaId = selfieUpload.id;
        profile.verificationStatus = "pending";
        profile.isVerified = false;
        await profile.save();

        return {
          success: false,
          error: {
            code: "FACE_MISMATCH",
            status: 422,
            message: "The selfie does not match the chosen profile photo. Please try again with a clearer photo.",
          },
          data: {
            is_verified: false,
            verification_status: "pending",
            verification: {
              has_reference: true,
              requires_selfie: false,
              requires_profile_photo: true,
              can_resume: true,
              can_retry: false,
              last_verified_at: null,
            },
          },
        };
      }

      // 8. Verification successful: persist in transaction
      const transaction = await sequelize.transaction();
      try {
        selfieUpload.status = "registered";
        selfieUpload.registeredAt = new Date();
        await selfieUpload.save({ transaction });

        profile.isVerified = true;
        profile.verificationStatus = "verified";
        profile.verificationSelfieMediaId = selfieUpload.id;
        profile.verifiedAt = new Date();
        profile.verificationMethod = lastInferenceResult?.model || "insightface_buffalo_sc";
        if (options.biometricConsent !== undefined) {
          profile.biometricConsent = options.biometricConsent;
          profile.biometricConsentAt = new Date();
        }
        await profile.save({ transaction });

        matchedPhoto.faceReviewStatus = "matched";
        matchedPhoto.faceSimilarity = lastInferenceResult?.similarity || 1.0;
        matchedPhoto.faceReviewedAt = new Date();
        await matchedPhoto.save({ transaction });

        await transaction.commit();

        return {
          success: true,
          message: "Face verification successful. Your profile is now verified!",
          data: {
            is_verified: true,
            verification_status: "verified",
            verified_at: profile.verifiedAt,
            verification: {
              requires_selfie: false,
              can_retry: false,
              has_reference: true,
              last_verified_at: profile.verifiedAt,
            },
          },
        };
      } catch (dbErr) {
        await transaction.rollback();
        throw dbErr;
      }
    } finally {
      this.releaseLock(userId);
    }
  }

  /**
   * Automatically verify a new or updated profile photo against user's existing verified reference.
   * If user has a verified reference:
   *  - Compares the photo to verificationSelfieMediaId
   *  - Updates photo.faceReviewStatus ("matched", "mismatched", "review_required")
   *  - If primary photo is mismatched:
   *      policy: update account verification status to "review_required" / remove verified badge
   *  - If not verified yet:
   *      sets photo.faceReviewStatus = "not_applicable"
   */
  async matchPhotoAgainstReference(photoId, userId) {
    const photo = await ProfileMedia.findByPk(photoId);
    if (!photo || photo.userId !== userId || photo.mediaType !== "photo") {
      return { success: false, reason: "PHOTO_NOT_FOUND" };
    }

    const profile = await Profile.findOne({ where: { userId } });
    if (!profile || !profile.verificationSelfieMediaId) {
      photo.faceReviewStatus = "not_applicable";
      await photo.save();
      return { success: true, status: "not_applicable" };
    }

    const referenceUpload = await MediaUpload.findByPk(profile.verificationSelfieMediaId);
    if (!referenceUpload) {
      console.warn(`Verification reference ${profile.verificationSelfieMediaId} not found for user ${userId}`);
      photo.faceReviewStatus = "review_required";
      await photo.save();
      return { success: false, reason: "REFERENCE_NOT_FOUND" };
    }

    // Check expiration of pending selfie
    const isPendingEnrollment = !profile.isVerified && profile.verificationStatus === "pending";
    if (
      isPendingEnrollment &&
      (referenceUpload.status === "expired" || new Date(referenceUpload.expiresAt) < new Date())
    ) {
      referenceUpload.status = "expired";
      await referenceUpload.save();
      profile.verificationSelfieMediaId = null;
      profile.verificationStatus = "not_started";
      await profile.save();

      photo.faceReviewStatus = "not_applicable";
      await photo.save();
      return { success: false, reason: "REFERENCE_EXPIRED" };
    }

    try {
      const [refBuffer, photoBuffer] = await Promise.all([
        storageService.getFileBuffer(referenceUpload.storageKey),
        storageService.getFileBuffer(photo.storageRef),
      ]);

      if (!refBuffer || !photoBuffer) {
        photo.faceReviewStatus = "review_required";
        await photo.save();
        return { success: false, reason: "BUFFER_FETCH_FAILED" };
      }

      const inference = await faceVerificationService.compareFaces(refBuffer, photoBuffer);

      if (!inference.success) {
        // e.g. no face detected in newly uploaded photo, or multiple faces
        photo.faceReviewStatus = "review_required";
        photo.faceReviewedAt = new Date();
        await photo.save();
        return { success: true, status: "review_required", error: inference.error };
      }

      if (inference.match) {
        photo.faceReviewStatus = "matched";
        photo.faceSimilarity = inference.similarity;
        photo.faceReviewedAt = new Date();

        // If the user was pending verification awaiting a face-visible photo, automatically finalize verification!
        if (isPendingEnrollment) {
          const transaction = await sequelize.transaction();
          try {
            referenceUpload.status = "registered";
            referenceUpload.registeredAt = new Date();
            await referenceUpload.save({ transaction });

            profile.isVerified = true;
            profile.verificationStatus = "verified";
            profile.verifiedAt = new Date();
            profile.verificationMethod = inference.model || "insightface_buffalo_sc";
            await profile.save({ transaction });

            // If the photo was added, ensure it is designated as primary if user has no other primary photo
            const existingPrimary = await ProfileMedia.findOne({
              where: { userId, mediaType: "photo", isPrimary: true },
              transaction,
            });
            if (!existingPrimary) {
              photo.isPrimary = true;
            }

            await photo.save({ transaction });
            await transaction.commit();
          } catch (autoErr) {
            await transaction.rollback();
            throw autoErr;
          }
        } else {
          await photo.save();
        }

        return { success: true, status: "matched", similarity: inference.similarity };
      } else {
        photo.faceReviewStatus = "mismatched";
        photo.faceSimilarity = inference.similarity;
        photo.faceReviewedAt = new Date();
        await photo.save();

        // Policy: If a newly designated primary photo is mismatched on an already verified profile, revoke public verified badge
        if (photo.isPrimary && profile.isVerified) {
          profile.isVerified = false;
          profile.verificationStatus = "review_required";
          await profile.save();
        }

        return { success: true, status: "mismatched", similarity: inference.similarity };
      }
    } catch (err) {
      console.error("Automatic face match against reference failed:", err.message);
      photo.faceReviewStatus = "review_required";
      await photo.save();
      return { success: false, reason: err.message };
    }
  }

  /**
   * Build verification state metadata block for GET /api/v1/me/profile
   */
  buildVerificationState(profile) {
    if (!profile) {
      return {
        is_verified: false,
        verification_status: "not_started",
        verification: {
          requires_selfie: true,
          can_retry: true,
          has_reference: false,
          last_verified_at: null,
        },
      };
    }

    const hasRef = Boolean(profile.verificationSelfieMediaId);
    const status = profile.verificationStatus || (profile.isVerified ? "verified" : "not_started");
    const isVerified = Boolean(profile.isVerified);

    // If pending verification awaiting suitable profile photo
    if (!isVerified && status === "pending" && hasRef) {
      return {
        is_verified: false,
        verification_status: "pending",
        verification: {
          requires_profile_photo: true,
          requires_selfie: false,
          can_resume: true,
          can_retry: false,
          has_reference: true,
          last_verified_at: null,
        },
      };
    }

    let requiresSelfie = !hasRef && !isVerified;
    let canRetry = status === "rejected" || status === "not_started" || !hasRef;

    return {
      is_verified: isVerified,
      verification_status: status,
      verification: {
        requires_selfie: requiresSelfie,
        can_retry: canRetry,
        has_reference: hasRef,
        last_verified_at: profile.verifiedAt || null,
      },
    };
  }
}

module.exports = new BiometricVerificationService();
