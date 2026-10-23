const { Op } = require("sequelize");
const MediaUpload = require("../models/MediaUpload");
const storageService = require("../services/storageService");

/**
 * Service to clean up expired and orphaned temporary media uploads.
 * Finds pending uploads past expiresAt, deletes them from storage, and marks them expired.
 */
async function cleanupExpiredUploads(batchSize = 100) {
  try {
    const expiredUploads = await MediaUpload.findAll({
      where: {
        status: "pending",
        expiresAt: {
          [Op.lt]: new Date(),
        },
      },
      limit: batchSize,
    });

    let cleanedCount = 0;
    for (const upload of expiredUploads) {
      try {
        await storageService.deleteFile(upload.storageKey);
      } catch (err) {
        console.error(`Failed to delete expired R2 file ${upload.storageKey}:`, err.message);
      }
      upload.status = "expired";
      await upload.save();
      cleanedCount++;
    }

    return { cleanedCount };
  } catch (err) {
    console.error("Cleanup expired uploads error:", err.message);
    throw err;
  }
}

module.exports = {
  cleanupExpiredUploads,
};
