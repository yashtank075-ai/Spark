const request = require("supertest");
const express = require("express");
const uploadRoutes = require("../routes/uploadRoutes");
const profileRoutes = require("../routes/profileRoutes");
const User = require("../models/User");
const Profile = require("../models/Profile");
const ProfileMedia = require("../models/ProfileMedia");
const MediaUpload = require("../models/MediaUpload");
const storageService = require("../services/storageService");
const { cleanupExpiredUploads } = require("../services/uploadCleanupService");

// Mock authentication middleware
jest.mock("../middleware/authenticate", () => (req, res, next) => {
  if (req.headers.authorization === "Bearer invalid_token") {
    return res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid token" },
    });
  }
  const userId = req.headers["x-test-user-id"] || "user-123";
  req.auth = { userId, sessionId: "sess-123" };
  req.user = { id: userId, accountStatus: "active", dateOfBirth: "1995-05-15", ageEligible: true };
  next();
});

jest.mock("../models/User");
jest.mock("../models/Profile");
jest.mock("../models/ProfileMedia");
jest.mock("../models/MediaUpload");

const sequelize = require("../config/db");

const app = express();
app.use(express.json());
app.use("/api/v1", uploadRoutes);
app.use("/api/v1", profileRoutes);
app.use((err, req, res, next) => {
  console.error("Test app error:", err);
  res.status(500).json({ success: false, error: err.message, stack: err.stack });
});

// Helper fixtures
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP_HEADER = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe("Two-Step Profile Photo Upload Architecture Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(sequelize, "transaction").mockImplementation(async () => ({
      commit: jest.fn().mockResolvedValue(true),
      rollback: jest.fn().mockResolvedValue(true),
    }));
    User.findByPk.mockResolvedValue({ id: "user-123", accountStatus: "active" });
  });

  describe("Step 1: POST /api/v1/upload/single", () => {
    it("should successfully upload a valid JPEG image and return upload_id and metadata", async () => {
      jest.spyOn(storageService, "uploadFile").mockResolvedValue("profile-photos/2026-10/test_1.jpg");
      MediaUpload.create.mockResolvedValue({
        id: "upload-uuid-1",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/test_1.jpg",
        mimeType: "image/jpeg",
        fileSize: JPEG_HEADER.length,
        originalFilename: "avatar.jpg",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", JPEG_HEADER, "avatar.jpg")
        .field("folder", "profile-photos");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.upload_id).toBe("upload-uuid-1");
      expect(res.body.data.key).toBe("profile-photos/2026-10/test_1.jpg");
      expect(res.body.data.mimeType).toBe("image/jpeg");
      expect(res.body.data.url).toBeDefined();
    });

    it("should successfully upload a valid PNG image", async () => {
      jest.spyOn(storageService, "uploadFile").mockResolvedValue("profile-photos/2026-10/test_2.png");
      MediaUpload.create.mockResolvedValue({
        id: "upload-uuid-2",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/test_2.png",
        mimeType: "image/png",
        fileSize: PNG_HEADER.length,
        originalFilename: "avatar.png",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", PNG_HEADER, "avatar.png");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mimeType).toBe("image/png");
    });

    it("should successfully upload a valid WebP image", async () => {
      jest.spyOn(storageService, "uploadFile").mockResolvedValue("profile-photos/2026-10/test_3.webp");
      MediaUpload.create.mockResolvedValue({
        id: "upload-uuid-3",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/test_3.webp",
        mimeType: "image/webp",
        fileSize: WEBP_HEADER.length,
        originalFilename: "avatar.webp",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", WEBP_HEADER, "avatar.webp");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mimeType).toBe("image/webp");
    });

    it("should reject unsupported MIME types (e.g. text/plain or fake PDF)", async () => {
      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", Buffer.from("%PDF-1.4 fake pdf data"), "document.pdf");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_IMAGE_TYPE");
    });

    it("should reject corrupt image buffer that doesn't match magic bytes", async () => {
      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", Buffer.from("random invalid bytes"), {
          filename: "corrupt.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_IMAGE_TYPE");
    });

    it("should reject empty file with 400", async () => {
      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", Buffer.alloc(0), "empty.jpg");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_IMAGE");
    });

    it("should reject oversized file (> 5MB) with 413", async () => {
      const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);
      JPEG_HEADER.copy(oversizedBuffer, 0);

      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", oversizedBuffer, "large.jpg");

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("IMAGE_TOO_LARGE");
    });

    it("should reject request when no file is attached", async () => {
      const res = await request(app)
        .post("/api/v1/upload/single")
        .field("folder", "profile-photos");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_IMAGE");
    });

    it("should handle storage provider failure with 503 STORAGE_UNAVAILABLE", async () => {
      jest.spyOn(storageService, "uploadFile").mockRejectedValue(new Error("Connection refused"));

      const res = await request(app)
        .post("/api/v1/upload/single")
        .attach("file", JPEG_HEADER, "avatar.jpg");

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("STORAGE_UNAVAILABLE");
    });
  });

  describe("Step 2: POST /api/v1/me/photos — Two-Step Photo Registration", () => {
    it("should successfully register an uploaded image via upload_id", async () => {
      const mockUpload = {
        id: "upload-uuid-1",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/test_1.jpg",
        mimeType: "image/jpeg",
        fileSize: 2048,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn().mockResolvedValue(true),
      };

      MediaUpload.findByPk.mockResolvedValue(mockUpload);
      jest.spyOn(storageService, "getFileMetadata").mockResolvedValue({
        contentType: "image/jpeg",
        contentLength: 2048,
      });

      ProfileMedia.count.mockResolvedValue(0);
      ProfileMedia.update.mockResolvedValue([1]);
      ProfileMedia.create.mockResolvedValue({
        id: "photo-uuid-1",
        userId: "user-123",
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/test_1.jpg",
        isPrimary: true,
        displayOrder: 0,
        moderationStatus: "pending",
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({
          upload_id: "upload-uuid-1",
          is_primary: true,
          display_order: 0,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Profile photo added successfully.");
      expect(res.body.data.id).toBe("photo-uuid-1");
      expect(res.body.data.media_type).toBe("photo");
      expect(res.body.data.url).toBe("/api/v1/media/photo-uuid-1");
      expect(res.body.data.is_primary).toBe(true);
      expect(res.body.data.display_order).toBe(0);
      expect(mockUpload.status).toBe("registered");
      expect(mockUpload.save).toHaveBeenCalled();
    });

    it("should reject non-existent upload_id with 404 UPLOAD_NOT_FOUND", async () => {
      MediaUpload.findByPk.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({ upload_id: "non-existent-uuid" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UPLOAD_NOT_FOUND");
    });

    it("should reject another user's upload with 403 UPLOAD_NOT_OWNED", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        id: "upload-uuid-diff",
        userId: "other-user-999",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({ upload_id: "upload-uuid-diff" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UPLOAD_NOT_OWNED");
    });

    it("should return idempotent response if upload is already registered to user's profile", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        id: "upload-uuid-1",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/test_1.jpg",
        status: "registered",
      });

      ProfileMedia.findOne.mockResolvedValue({
        id: "photo-uuid-1",
        userId: "user-123",
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/test_1.jpg",
        isPrimary: true,
        displayOrder: 0,
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({ upload_id: "upload-uuid-1" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("photo-uuid-1");
      expect(res.body.data.url).toBe("/api/v1/media/photo-uuid-1");
    });

    it("should reject already registered upload with 409 if claimed elsewhere", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        id: "upload-uuid-1",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/test_1.jpg",
        status: "registered",
      });

      ProfileMedia.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({ upload_id: "upload-uuid-1" });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UPLOAD_ALREADY_REGISTERED");
    });

    it("should reject expired upload with 410 UPLOAD_EXPIRED", async () => {
      const expiredUpload = {
        id: "upload-uuid-expired",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/expired.jpg",
        status: "pending",
        expiresAt: new Date(Date.now() - 3600000), // 1 hr ago
        save: jest.fn().mockResolvedValue(true),
      };
      MediaUpload.findByPk.mockResolvedValue(expiredUpload);

      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({ upload_id: "upload-uuid-expired" });

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UPLOAD_EXPIRED");
    });

    it("should reject registration if user exceeds maximum photo limit (9)", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        id: "upload-uuid-10",
        userId: "user-123",
        storageKey: "profile-photos/2026-10/test_10.jpg",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
      });

      jest.spyOn(storageService, "getFileMetadata").mockResolvedValue({ contentLength: 1000 });
      ProfileMedia.count.mockResolvedValue(9);

      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({ upload_id: "upload-uuid-10" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PHOTO_LIMIT_EXCEEDED");
    });

    it("should reject raw Base64 data URLs in photo registration requests", async () => {
      const res = await request(app)
        .post("/api/v1/me/photos")
        .send({
          photo_base64: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("RAW_BASE64_NOT_ALLOWED");
    });

    it("should support backward compatibility: direct multipart upload to POST /api/v1/me/photos", async () => {
      jest.spyOn(storageService, "uploadFile").mockResolvedValue("profile-photos/2026-10/legacy.jpg");
      ProfileMedia.count.mockResolvedValue(0);
      ProfileMedia.create.mockResolvedValue({
        id: "photo-legacy-1",
        userId: "user-123",
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/legacy.jpg",
        isPrimary: true,
        displayOrder: 0,
        moderationStatus: "pending",
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .attach("photo", JPEG_HEADER, "legacy.jpg");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("photo-legacy-1");
      expect(res.body.data.url).toBe("/api/v1/media/photo-legacy-1");
    });
  });

  describe("Photo Deletion & Storage Cleanup", () => {
    it("should delete photo, promote next photo to primary, and clean up physical file", async () => {
      const mockPhoto = {
        id: "photo-del-1",
        userId: "user-123",
        storageRef: "profile-photos/2026-10/del.jpg",
        isPrimary: true,
        destroy: jest.fn().mockResolvedValue(true),
      };

      ProfileMedia.findOne
        .mockResolvedValueOnce(mockPhoto) // for deletion lookup
        .mockResolvedValueOnce({
          id: "photo-del-2",
          userId: "user-123",
          isPrimary: false,
          save: jest.fn().mockResolvedValue(true),
        }); // for next primary promotion

      ProfileMedia.count.mockResolvedValue(0); // 0 other references to storageRef
      const deleteFileSpy = jest.spyOn(storageService, "deleteFile").mockResolvedValue();
      MediaUpload.destroy.mockResolvedValue(1);

      const res = await request(app).delete("/api/v1/me/photos/photo-del-1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockPhoto.destroy).toHaveBeenCalled();
      expect(deleteFileSpy).toHaveBeenCalledWith("profile-photos/2026-10/del.jpg");
      expect(MediaUpload.destroy).toHaveBeenCalled();
    });

    it("should not delete physical storage file if another media record shares the storageRef", async () => {
      const mockPhoto = {
        id: "photo-del-shared",
        userId: "user-123",
        storageRef: "profile-photos/2026-10/shared.jpg",
        isPrimary: false,
        destroy: jest.fn().mockResolvedValue(true),
      };

      ProfileMedia.findOne.mockResolvedValue(mockPhoto);
      ProfileMedia.count.mockResolvedValue(1); // 1 other reference exists!
      const deleteFileSpy = jest.spyOn(storageService, "deleteFile").mockResolvedValue();

      const res = await request(app).delete("/api/v1/me/photos/photo-del-shared");

      expect(res.status).toBe(200);
      expect(mockPhoto.destroy).toHaveBeenCalled();
      expect(deleteFileSpy).not.toHaveBeenCalled();
    });
  });

  describe("Expired Temporary Upload Purge Service", () => {
    it("should find and delete expired pending uploads from storage", async () => {
      const expiredList = [
        {
          id: "up-exp-1",
          storageKey: "profile-photos/2026-10/exp1.jpg",
          status: "pending",
          save: jest.fn().mockResolvedValue(true),
        },
      ];

      MediaUpload.findAll.mockResolvedValue(expiredList);
      const deleteFileSpy = jest.spyOn(storageService, "deleteFile").mockResolvedValue();

      const result = await cleanupExpiredUploads(50);
      expect(result.cleanedCount).toBe(1);
      expect(deleteFileSpy).toHaveBeenCalledWith("profile-photos/2026-10/exp1.jpg");
      expect(expiredList[0].status).toBe("expired");
      expect(expiredList[0].save).toHaveBeenCalled();
    });
  });
});
