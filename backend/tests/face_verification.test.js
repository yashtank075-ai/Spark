const request = require("supertest");
const express = require("express");
const verificationRoutes = require("../routes/verificationRoutes");
const User = require("../models/User");
const Profile = require("../models/Profile");
const ProfileMedia = require("../models/ProfileMedia");
const MediaUpload = require("../models/MediaUpload");
const storageService = require("../services/storageService");
const faceVerificationService = require("../services/faceVerificationService");

// Mock authenticate middleware for predictable unit/integration testing
jest.mock("../middleware/authenticate", () => (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  const token = authHeader.replace("Bearer ", "");
  if (token === "invalid-token") {
    return res.status(401).json({ success: false, message: "Access token is invalid or expired." });
  }
  // User ID passed via custom header or default user-100
  const userId = req.headers["x-test-user-id"] || "user-100";
  req.auth = { userId, sessionId: "sess-100" };
  req.user = { id: userId, accountStatus: "active" };
  next();
});

jest.mock("../models/User");
jest.mock("../models/Profile");
jest.mock("../models/ProfileMedia");
jest.mock("../models/MediaUpload");

const sequelize = require("../config/db");

const app = express();
app.use(express.json());
app.use("/api/v1/verification", verificationRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: err.message });
});

describe("POST /api/v1/verification/face — Face Verification Integration Suite", () => {
  const userId = "user-100";
  const otherUserId = "user-200";

  const mockProfile = {
    id: "prof-100",
    userId,
    isVerified: false,
    verificationStatus: "pending",
    verificationSelfieMediaId: null,
    verifiedAt: null,
    verificationMethod: null,
    save: jest.fn().mockResolvedValue(true),
  };

  const mockSelfieUpload = {
    id: "selfie-upload-1",
    userId,
    storageKey: "verification-selfies/2026-10/selfie.jpg",
    mimeType: "image/jpeg",
    fileSize: 50000,
    status: "pending",
    expiresAt: new Date(Date.now() + 86400000),
    save: jest.fn().mockResolvedValue(true),
  };

  const mockProfilePhoto = {
    id: "photo-media-1",
    userId,
    mediaType: "photo",
    storageRef: "photos/2026-10/profile_photo.jpg",
    moderationStatus: "approved",
    isPrimary: true,
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(sequelize, "transaction").mockImplementation(async () => ({
      commit: jest.fn().mockResolvedValue(true),
      rollback: jest.fn().mockResolvedValue(true),
    }));
    Profile.findOne.mockResolvedValue(mockProfile);
    MediaUpload.findByPk.mockResolvedValue(mockSelfieUpload);
    ProfileMedia.findByPk.mockResolvedValue(mockProfilePhoto);

    // Mock storageService.getFileBuffer to return dummy image buffers
    jest.spyOn(storageService, "getFileBuffer").mockResolvedValue(Buffer.from("dummy-image-bytes"));
  });

  describe("1. Input & Ownership Validation", () => {
    it("should return 400 if upload_id or photo_id is missing", async () => {
      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-1" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("MISSING_REQUIRED_FIELDS");
    });

    it("should return 404 if selfie upload record is not found", async () => {
      MediaUpload.findByPk.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "nonexistent-selfie", photo_id: "photo-media-1" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("SELFIE_NOT_FOUND");
    });

    it("should reject another user's selfie with 403 SELFIE_NOT_OWNED", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        ...mockSelfieUpload,
        userId: otherUserId,
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("SELFIE_NOT_OWNED");
    });

    it("should reject expired selfie with 410 SELFIE_EXPIRED", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        ...mockSelfieUpload,
        expiresAt: new Date(Date.now() - 10000), // expired
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("SELFIE_EXPIRED");
    });

    it("should reject photo belonging to another user with 403 PHOTO_NOT_OWNED", async () => {
      ProfileMedia.findByPk.mockResolvedValue({
        ...mockProfilePhoto,
        userId: otherUserId,
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PHOTO_NOT_OWNED");
    });
  });

  describe("2. Face Detection & Model Comparison Checks", () => {
    it("should reject with 422 if model detects no face in the selfie", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: false,
        error: "NO_FACE_IN_SELFIE",
        message: "No face detected in the verification selfie.",
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NO_FACE_IN_SELFIE");
      expect(res.body.data.is_verified).toBe(false);
      expect(res.body.data.verification_status).toBe("rejected");
    });

    it("should reject with 422 if model detects multiple faces in the selfie", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: false,
        error: "MULTIPLE_FACES_IN_SELFIE",
        message: "Multiple faces detected in the verification selfie.",
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("MULTIPLE_FACES_IN_SELFIE");
      expect(res.body.data.is_verified).toBe(false);
    });

    it("should reject with 422 if face similarity is below threshold (different people)", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: false,
        similarity: 0.18,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("FACE_MISMATCH");
      expect(res.body.data.is_verified).toBe(false);
      expect(res.body.data.verification_status).toBe("rejected");
    });

    it("should return 503 if verification service encounters model failure", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockRejectedValue(
        new Error("FACE_VERIFICATION_TIMEOUT")
      );

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VERIFICATION_SERVICE_UNAVAILABLE");
    });
  });

  describe("3. Successful Face Verification Flow", () => {
    it("should succeed with 200 OK and mark profile verified when similarity >= threshold", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: true,
        similarity: 0.76,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({ upload_id: "selfie-upload-1", photo_id: "photo-media-1" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Face verification successful");
      expect(res.body.data.is_verified).toBe(true);
      expect(res.body.data.verification_status).toBe("verified");
      expect(res.body.data.verified_at).toBeDefined();

      // Ensure profile was updated
      expect(mockProfile.isVerified).toBe(true);
      expect(mockProfile.verificationStatus).toBe("verified");
      expect(mockProfile.verificationSelfieMediaId).toBe("selfie-upload-1");
      expect(mockProfile.verificationMethod).toBe("insightface_buffalo_sc");
      expect(mockProfile.save).toHaveBeenCalled();

      // Ensure selfie upload was marked registered
      expect(mockSelfieUpload.status).toBe("registered");
      expect(mockSelfieUpload.save).toHaveBeenCalled();
    });
  });

  describe("4. Real FaceVerificationService Integration (Child Process)", () => {
    it("should execute faceVerificationService and return NO_FACE_IN_SELFIE for blank images", async () => {
      // Restore any previous mock on compareFaces so real child process runs
      if (faceVerificationService.compareFaces.mockRestore) {
        faceVerificationService.compareFaces.mockRestore();
      }

      // Valid 100x100 blank PNG image (valid image decoding, 0 faces)
      const validBlankPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAxUlEQVR4Ae3BAQEAAACCIP1/ugsOCOQyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8vkMrlMLpPL5DK5TC6Ty+QyuUwuk8sGqJ8AZeonWEsAAAAASUVORK5CYII=",
        "base64"
      );

      const result = await faceVerificationService.compareFaces(validBlankPng, validBlankPng);
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBe("NO_FACE_IN_SELFIE");
    }, 25000);
  });
});
