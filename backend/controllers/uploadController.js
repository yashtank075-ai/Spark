const MediaUpload = require("../models/MediaUpload");
const storageService = require("../services/storageService");
const { validateImageFile } = require("../validators/imageValidator");

/**
 * POST /api/v1/upload/single
 * Step 1: Upload image binary to Cloudflare R2 / storage provider.
 * Validates magic bytes, file size <= 5MB, stores file in storage,
 * and creates a pending MediaUpload record expiring in 24 hours.
 */
exports.uploadSingle = async (req, res, next) => {
  try {
    const userId = req.auth ? req.auth.userId : null;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required to upload media.",
        },
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_IMAGE",
          message:
            "No image file provided in multipart request ('file' field required).",
        },
      });
    }

    // Binary file validation (magic bytes & size check)
    const validation = validateImageFile(req.file);
    if (!validation.isValid) {
      const statusCode =
        validation.error.code === "IMAGE_TOO_LARGE" ? 413 : 400;
      return res.status(statusCode).json({
        success: false,
        error: validation.error,
      });
    }

    // Validate folder category: for SPARK profile photos, defaults to profile-photos
    const ALLOWED_FOLDERS = ["profile-photos", "photos", "media", "verification-selfies", "selfies"];
    const rawFolder =
      typeof req.body.folder === "string"
        ? req.body.folder.trim().toLowerCase()
        : "";
    const folder = ALLOWED_FOLDERS.includes(rawFolder)
      ? rawFolder
      : "profile-photos";

    // Upload to configured storage provider (R2 / local fallback)
    let storageKey;
    try {
      storageKey = await storageService.uploadFile(req.file, { folder });
    } catch (storageErr) {
      console.error("Storage upload failure:", storageErr.message);
      return res.status(503).json({
        success: false,
        error: {
          code: "STORAGE_UNAVAILABLE",
          message:
            "Storage provider is temporarily unavailable. Please retry later.",
        },
      });
    }

    // 24 hour expiry for pending uploads
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const mediaUpload = await MediaUpload.create({
      userId,
      storageKey,
      mimeType: validation.detectedMime || req.file.mimetype || "image/jpeg",
      fileSize: req.file.size || req.file.buffer.length,
      originalFilename: req.file.originalname || "image.jpg",
      status: "pending",
      expiresAt,
    });

    const publicUrl = storageService.getPublicUrl(storageKey);

    return res.status(201).json({
      success: true,
      message: "Image uploaded successfully.",
      data: {
        upload_id: mediaUpload.id,
        url: publicUrl,
        key: storageKey,
        filename: mediaUpload.originalFilename,
        size: mediaUpload.fileSize,
        mimeType: mediaUpload.mimeType,
        expires_at: mediaUpload.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
