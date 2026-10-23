const request = require("supertest");
const express = require("express");
const profileRoutes = require("../routes/profileRoutes");
const verificationRoutes = require("../routes/verificationRoutes");
const User = require("../models/User");
const Profile = require("../models/Profile");
const ProfileMedia = require("../models/ProfileMedia");
const MediaUpload = require("../models/MediaUpload");
const storageService = require("../services/storageService");
const faceVerificationService = require("../services/faceVerificationService");
const biometricVerificationService = require("../services/biometricVerificationService");

// Mock authenticate middleware
jest.mock("../middleware/authenticate", () => (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  const token = authHeader.replace("Bearer ", "");
  if (token === "invalid-token") {
    return res.status(401).json({ success: false, message: "Access token is invalid or expired." });
  }
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
app.use("/api/v1", profileRoutes);
app.use("/api/v1/verification", verificationRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: err.message });
});

describe("One-Time Selfie Verification & Automatic Profile Photo Face Matching", () => {
  const userId = "user-100";
  const otherUserId = "user-200";

  let mockProfile;
  let mockSelfieUpload;
  let mockPrimaryPhoto;

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(sequelize, "transaction").mockImplementation(async () => ({
      commit: jest.fn().mockResolvedValue(true),
      rollback: jest.fn().mockResolvedValue(true),
    }));

    mockProfile = {
      id: "prof-100",
      userId,
      displayName: "Alex",
      gender: "non-binary",
      isVerified: false,
      verificationStatus: "not_started",
      verificationSelfieMediaId: null,
      verifiedAt: null,
      verificationMethod: null,
      biometricConsent: true,
      biometricConsentAt: null,
      save: jest.fn().mockResolvedValue(true),
      reload: jest.fn().mockResolvedValue(true),
    };

    mockSelfieUpload = {
      id: "selfie-upload-uuid-1",
      userId,
      storageKey: "verification-selfies/2026-10/selfie.jpg",
      mimeType: "image/jpeg",
      fileSize: 50000,
      status: "pending",
      expiresAt: new Date(Date.now() + 86400000),
      save: jest.fn().mockResolvedValue(true),
    };

    mockPrimaryPhoto = {
      id: "photo-media-primary-1",
      userId,
      mediaType: "photo",
      storageRef: "profile-photos/2026-10/primary.jpg",
      moderationStatus: "approved",
      isPrimary: true,
      displayOrder: 0,
      faceReviewStatus: "not_applicable",
      faceSimilarity: null,
      save: jest.fn().mockResolvedValue(true),
      reload: jest.fn().mockResolvedValue(true),
    };

    User.findByPk.mockResolvedValue({ id: userId, accountStatus: "active" });
    Profile.findOne.mockResolvedValue(mockProfile);
    MediaUpload.findByPk.mockResolvedValue(mockSelfieUpload);
    ProfileMedia.findOne.mockResolvedValue(mockPrimaryPhoto);
    ProfileMedia.findByPk.mockResolvedValue(mockPrimaryPhoto);
    ProfileMedia.findAll.mockResolvedValue([mockPrimaryPhoto]);

    jest.spyOn(storageService, "getFileBuffer").mockResolvedValue(Buffer.from("dummy-image-buffer"));
    jest.spyOn(storageService, "getPublicUrl").mockImplementation((key) => `https://cdn.example.com/${key}`);
    jest.spyOn(storageService, "getFileMetadata").mockResolvedValue({
      contentType: "image/jpeg",
      contentLength: 50000,
    });
  });

  describe("1. First-time Selfie Enrollment via PATCH /api/v1/me/profile", () => {
    it("should reject enrollment if selfie upload record is not found (404)", async () => {
      MediaUpload.findByPk.mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "nonexistent-upload-id",
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("SELFIE_NOT_FOUND");
    });

    it("should reject enrollment if selfie belongs to another user (403)", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        ...mockSelfieUpload,
        userId: otherUserId,
      });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("SELFIE_NOT_OWNED");
    });

    it("should reject enrollment if selfie is expired (410)", async () => {
      MediaUpload.findByPk.mockResolvedValue({
        ...mockSelfieUpload,
        status: "expired",
        expiresAt: new Date(Date.now() - 10000),
      });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
        });

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("SELFIE_EXPIRED");
    });

    it("should reject enrollment if user does not have a primary profile photo (400 PRIMARY_PHOTO_REQUIRED)", async () => {
      ProfileMedia.findOne.mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PRIMARY_PHOTO_REQUIRED");
    });

    it("should reject with 422 if model detects no face in the selfie", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: false,
        error: "NO_FACE_IN_SELFIE",
        message: "No face detected in the verification selfie.",
      });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NO_FACE_IN_SELFIE");
      expect(mockProfile.verificationStatus).toBe("rejected");
    });

    it("should reject with 422 FACE_MISMATCH if similarity is below threshold but preserve valid selfie reference", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: false,
        similarity: 0.22,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("FACE_MISMATCH");
      expect(mockProfile.verificationStatus).toBe("pending");
      expect(mockProfile.verificationSelfieMediaId).toBe("selfie-upload-uuid-1");
      expect(mockPrimaryPhoto.faceReviewStatus).toBe("mismatched");
      expect(res.body.data.verification.has_reference).toBe(true);
      expect(res.body.data.verification.requires_selfie).toBe(false);
      expect(res.body.data.verification.requires_profile_photo).toBe(true);
      expect(res.body.data.verification.can_resume).toBe(true);
    });

    it("should return recoverable 422 NO_FACE_IN_PROFILE_PHOTO with pending reference when no profile photos contain a detectable face", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: false,
        error: "NO_FACE_IN_PROFILE_PHOTO",
        message: "No face detected in the selected profile photo. Please select a clearer profile photo.",
      });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NO_FACE_IN_PROFILE_PHOTO");
      expect(res.body.error.message).toBe("Add a clear profile photo showing your face to continue verification.");
      expect(res.body.data.is_verified).toBe(false);
      expect(res.body.data.verification_status).toBe("pending");
      expect(res.body.data.verification).toEqual({
        requires_profile_photo: true,
        requires_selfie: false,
        can_resume: true,
        can_retry: false,
        has_reference: true,
        last_verified_at: null,
      });

      // Crucial: Pending selfie reference must be retained on profile
      expect(mockProfile.verificationSelfieMediaId).toBe("selfie-upload-uuid-1");
      expect(mockProfile.verificationStatus).toBe("pending");
      expect(mockProfile.isVerified).toBe(false);
      expect(mockSelfieUpload.status).toBe("pending"); // Not yet permanently registered
    });

    it("should automatically check secondary photo if primary photo has no face", async () => {
      const primaryPhotoNoFace = {
        id: "photo-no-face-1",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/landscape.jpg",
        isPrimary: true,
        displayOrder: 0,
        save: jest.fn().mockResolvedValue(true),
      };

      const secondaryPhotoWithFace = {
        id: "photo-face-2",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/portrait.jpg",
        isPrimary: false,
        displayOrder: 1,
        save: jest.fn().mockResolvedValue(true),
      };

      ProfileMedia.findAll.mockResolvedValue([primaryPhotoNoFace, secondaryPhotoWithFace]);

      jest.spyOn(faceVerificationService, "compareFaces")
        .mockResolvedValueOnce({
          success: false,
          error: "NO_FACE_IN_PROFILE_PHOTO",
          message: "No face detected in profile photo.",
        })
        .mockResolvedValueOnce({
          success: true,
          match: true,
          similarity: 0.84,
          threshold: 0.40,
          model: "insightface_buffalo_sc",
        });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.is_verified).toBe(true);
      expect(res.body.data.verification_status).toBe("verified");
      expect(secondaryPhotoWithFace.faceReviewStatus).toBe("matched");
    });

    it("should successfully verify user on first match and establish reusable biometric reference", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: true,
        similarity: 0.81,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token")
        .send({
          verification_selfie_upload_id: "selfie-upload-uuid-1",
          biometric_consent: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.is_verified).toBe(true);
      expect(res.body.data.verification_status).toBe("verified");
      expect(res.body.data.verification.has_reference).toBe(true);
      expect(res.body.data.verification.requires_selfie).toBe(false);

      expect(mockProfile.isVerified).toBe(true);
      expect(mockProfile.verificationStatus).toBe("verified");
      expect(mockProfile.verificationSelfieMediaId).toBe("selfie-upload-uuid-1");
      expect(mockSelfieUpload.status).toBe("registered");
      expect(mockPrimaryPhoto.faceReviewStatus).toBe("matched");
    });
  });

  describe("2. GET /api/v1/me/profile — Verification State Contract", () => {
    it("should return requires_selfie=true and has_reference=false for unverified user", async () => {
      mockProfile.isVerified = false;
      mockProfile.verificationStatus = "not_started";
      mockProfile.verificationSelfieMediaId = null;

      const res = await request(app)
        .get("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.data.is_verified).toBe(false);
      expect(res.body.data.verification.requires_selfie).toBe(true);
      expect(res.body.data.verification.has_reference).toBe(false);
      expect(res.body.data.verification.can_retry).toBe(true);
    });

    it("should return requires_selfie=false and has_reference=true for verified user", async () => {
      mockProfile.isVerified = true;
      mockProfile.verificationStatus = "verified";
      mockProfile.verificationSelfieMediaId = "selfie-upload-uuid-1";
      mockProfile.verifiedAt = new Date();

      const res = await request(app)
        .get("/api/v1/me/profile")
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.data.is_verified).toBe(true);
      expect(res.body.data.verification.requires_selfie).toBe(false);
      expect(res.body.data.verification.has_reference).toBe(true);
      expect(res.body.data.verification.last_verified_at).toBeDefined();
    });
  });

  describe("3. Future Profile Photo Uploads — Automatic Face Matching", () => {
    it("should automatically match new profile photo against stored selfie reference without asking for new selfie", async () => {
      // User is already verified with reference
      mockProfile.isVerified = true;
      mockProfile.verificationStatus = "verified";
      mockProfile.verificationSelfieMediaId = "selfie-upload-uuid-1";

      const newUpload = {
        id: "upload-uuid-photo-2",
        userId,
        storageKey: "profile-photos/2026-10/photo2.jpg",
        mimeType: "image/jpeg",
        fileSize: 45000,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn().mockResolvedValue(true),
      };

      const newPhotoMedia = {
        id: "photo-media-2",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/photo2.jpg",
        isPrimary: false,
        displayOrder: 1,
        moderationStatus: "pending",
        faceReviewStatus: "pending",
        faceSimilarity: null,
        save: jest.fn().mockResolvedValue(true),
        reload: jest.fn().mockImplementation(async function () {
          this.faceReviewStatus = "matched";
          this.faceSimilarity = 0.85;
          return this;
        }),
      };

      MediaUpload.findByPk.mockImplementation(async (id) => {
        if (id === "upload-uuid-photo-2") return newUpload;
        if (id === "selfie-upload-uuid-1") return mockSelfieUpload;
        return null;
      });

      ProfileMedia.count.mockResolvedValue(1);
      ProfileMedia.create.mockResolvedValue(newPhotoMedia);
      ProfileMedia.findByPk.mockResolvedValue(newPhotoMedia);

      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: true,
        similarity: 0.85,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .set("Authorization", "Bearer valid-token")
        .send({
          upload_id: "upload-uuid-photo-2",
          is_primary: false,
          display_order: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("photo-media-2");
      expect(res.body.data.face_review_status).toBe("matched");
    });

    it("should automatically resume verification when user uploads a face-visible photo after NO_FACE_IN_PROFILE_PHOTO prerequisite", async () => {
      // User is in recoverable pending state with a valid pending selfie reference
      mockProfile.isVerified = false;
      mockProfile.verificationStatus = "pending";
      mockProfile.verificationSelfieMediaId = "selfie-upload-uuid-1";

      const suitableUpload = {
        id: "upload-uuid-suitable-photo",
        userId,
        storageKey: "profile-photos/2026-10/suitable-face.jpg",
        mimeType: "image/jpeg",
        fileSize: 45000,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn().mockResolvedValue(true),
      };

      const suitablePhotoMedia = {
        id: "photo-media-suitable",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/suitable-face.jpg",
        isPrimary: false,
        displayOrder: 2,
        moderationStatus: "pending",
        faceReviewStatus: "pending",
        faceSimilarity: null,
        save: jest.fn().mockResolvedValue(true),
        reload: jest.fn().mockImplementation(async function () {
          this.faceReviewStatus = "matched";
          this.faceSimilarity = 0.88;
          return this;
        }),
      };

      MediaUpload.findByPk.mockImplementation(async (id) => {
        if (id === "upload-uuid-suitable-photo") return suitableUpload;
        if (id === "selfie-upload-uuid-1") return mockSelfieUpload;
        return null;
      });

      ProfileMedia.count.mockResolvedValue(2);
      ProfileMedia.create.mockResolvedValue(suitablePhotoMedia);
      ProfileMedia.findByPk.mockResolvedValue(suitablePhotoMedia);
      ProfileMedia.findOne.mockResolvedValue(null); // No primary photo yet

      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: true,
        similarity: 0.88,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .set("Authorization", "Bearer valid-token")
        .send({
          upload_id: "upload-uuid-suitable-photo",
          is_primary: true,
          display_order: 0,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("photo-media-suitable");
      expect(res.body.data.face_review_status).toBe("matched");

      // Automatic resumption verified the user!
      expect(mockProfile.isVerified).toBe(true);
      expect(mockProfile.verificationStatus).toBe("verified");
      expect(mockSelfieUpload.status).toBe("registered");
    });

    it("should set face_review_status to mismatched if subsequent photo does not match user reference", async () => {
      mockProfile.isVerified = true;
      mockProfile.verificationStatus = "verified";
      mockProfile.verificationSelfieMediaId = "selfie-upload-uuid-1";

      const newUpload = {
        id: "upload-uuid-mismatch",
        userId,
        storageKey: "profile-photos/2026-10/mismatch.jpg",
        mimeType: "image/jpeg",
        fileSize: 45000,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn().mockResolvedValue(true),
      };

      const newPhotoMedia = {
        id: "photo-media-mismatch",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/mismatch.jpg",
        isPrimary: false,
        displayOrder: 1,
        moderationStatus: "pending",
        faceReviewStatus: "pending",
        save: jest.fn().mockResolvedValue(true),
        reload: jest.fn().mockImplementation(async function () {
          this.faceReviewStatus = "mismatched";
          this.faceSimilarity = 0.15;
          return this;
        }),
      };

      MediaUpload.findByPk.mockImplementation(async (id) => {
        if (id === "upload-uuid-mismatch") return newUpload;
        if (id === "selfie-upload-uuid-1") return mockSelfieUpload;
        return null;
      });

      ProfileMedia.count.mockResolvedValue(1);
      ProfileMedia.create.mockResolvedValue(newPhotoMedia);
      ProfileMedia.findByPk.mockResolvedValue(newPhotoMedia);

      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: false,
        similarity: 0.15,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .set("Authorization", "Bearer valid-token")
        .send({
          upload_id: "upload-uuid-mismatch",
          is_primary: false,
          display_order: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.face_review_status).toBe("mismatched");

      // Critical: Saved selfie reference MUST NOT be invalidated or deleted by photo rejection!
      expect(mockProfile.verificationSelfieMediaId).toBe("selfie-upload-uuid-1");
      expect(mockSelfieUpload.status).not.toBe("expired");
    });

    it("should never invalidate or reset pending selfie reference when replacement photo has no face or fails match", async () => {
      // User is pending verification awaiting a matching photo
      mockProfile.isVerified = false;
      mockProfile.verificationStatus = "pending";
      mockProfile.verificationSelfieMediaId = "selfie-upload-uuid-1";

      const badUpload = {
        id: "upload-uuid-bad",
        userId,
        storageKey: "profile-photos/2026-10/landscape.jpg",
        mimeType: "image/jpeg",
        fileSize: 45000,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
        save: jest.fn().mockResolvedValue(true),
      };

      const badPhotoMedia = {
        id: "photo-media-bad",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/landscape.jpg",
        isPrimary: false,
        displayOrder: 1,
        moderationStatus: "pending",
        faceReviewStatus: "pending",
        save: jest.fn().mockResolvedValue(true),
        reload: jest.fn().mockImplementation(async function () {
          this.faceReviewStatus = "review_required";
          return this;
        }),
      };

      MediaUpload.findByPk.mockImplementation(async (id) => {
        if (id === "upload-uuid-bad") return badUpload;
        if (id === "selfie-upload-uuid-1") return mockSelfieUpload;
        return null;
      });

      ProfileMedia.count.mockResolvedValue(1);
      ProfileMedia.create.mockResolvedValue(badPhotoMedia);
      ProfileMedia.findByPk.mockResolvedValue(badPhotoMedia);

      // Model reports no face in this photo
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: false,
        error: "NO_FACE_IN_PROFILE_PHOTO",
        message: "No face detected in the selected profile photo.",
      });

      const res = await request(app)
        .post("/api/v1/me/photos")
        .set("Authorization", "Bearer valid-token")
        .send({
          upload_id: "upload-uuid-bad",
          is_primary: false,
          display_order: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.face_review_status).toBe("review_required");
      expect(res.body.data.is_verified).toBe(false);
      expect(res.body.data.verification_status).toBe("pending");
      expect(res.body.data.verification.has_reference).toBe(true);
      expect(res.body.data.verification.requires_selfie).toBe(false);
      expect(res.body.data.verification.requires_profile_photo).toBe(true);

      // Core rule verified: selfie reference remains preserved
      expect(mockProfile.verificationSelfieMediaId).toBe("selfie-upload-uuid-1");
    });
  });

  describe("4. Primary Photo Replacement & Reordering Policy", () => {
    it("should trigger matching on new primary photo and flag review_required if mismatched", async () => {
      mockProfile.isVerified = true;
      mockProfile.verificationStatus = "verified";
      mockProfile.verificationSelfieMediaId = "selfie-upload-uuid-1";

      const photoA = {
        id: "photo-a",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/a.jpg",
        isPrimary: true,
        displayOrder: 0,
        save: jest.fn().mockResolvedValue(true),
      };

      const photoB = {
        id: "photo-b",
        userId,
        mediaType: "photo",
        storageRef: "profile-photos/2026-10/b.jpg",
        isPrimary: false,
        displayOrder: 1,
        save: jest.fn().mockResolvedValue(true),
      };

      ProfileMedia.findAll.mockResolvedValue([photoA, photoB]);
      ProfileMedia.findByPk.mockImplementation(async (id) => {
        if (id === "photo-a") return photoA;
        if (id === "photo-b") return photoB;
        return null;
      });

      // Photo B does not match reference
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: false,
        similarity: 0.12,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .patch("/api/v1/me/photos/order")
        .set("Authorization", "Bearer valid-token")
        .send({
          photo_ids: ["photo-b", "photo-a"],
          primary_photo_id: "photo-b",
        });

      expect(res.status).toBe(200);
      expect(photoB.isPrimary).toBe(true);
      expect(photoB.faceReviewStatus).toBe("mismatched");
      expect(mockProfile.isVerified).toBe(false);
      expect(mockProfile.verificationStatus).toBe("review_required");
    });
  });

  describe("5. Legacy Endpoint Backward Compatibility & Deprecation", () => {
    it("POST /api/v1/verification/face returns Deprecation header and still verifies old clients", async () => {
      jest.spyOn(faceVerificationService, "compareFaces").mockResolvedValue({
        success: true,
        match: true,
        similarity: 0.79,
        threshold: 0.40,
        model: "insightface_buffalo_sc",
      });

      const res = await request(app)
        .post("/api/v1/verification/face")
        .set("Authorization", "Bearer valid-token")
        .send({
          upload_id: "selfie-upload-uuid-1",
          photo_id: "photo-media-primary-1",
        });

      expect(res.status).toBe(200);
      expect(res.headers.deprecation).toBe("true");
      expect(res.headers.sunset).toBeDefined();
      expect(res.body.success).toBe(true);
      expect(res.body.data.is_verified).toBe(true);
    });
  });
});
