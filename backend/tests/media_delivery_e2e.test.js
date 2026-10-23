const request = require("supertest");
const express = require("express");
const app = require("../app");
const storageService = require("../services/storageService");
const { User, Profile, ProfileMedia, MediaUpload } = require("../models");

// 1x1 Transparent PNG fixture
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Simulated Audio MP3 fixture (magic bytes 0xFF 0xFB)
const SAMPLE_MP3 = Buffer.concat([
  Buffer.from([0xff, 0xfb, 0x90, 0x44]),
  Buffer.from("Simulated MP3 voice introduction audio data frame"),
]);

describe("End-to-End Media Delivery & Resolution Integration Suite", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.STORAGE_PROVIDER = "local";
    process.env.PUBLIC_API_BASE_URL = "https://test-spark-api.example.com";
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  describe("1. Storage Service URL Resolution Matrix", () => {
    it("should resolve R2 custom domain URL when R2_PUBLIC_BASE_URL is set", () => {
      process.env.STORAGE_PROVIDER = "cloudflare_r2";
      process.env.R2_PUBLIC_BASE_URL = "https://cdn.sparkdating.com";

      const photoUrl = storageService.getPublicUrl("photos/2026-10/test_user.jpg");
      expect(photoUrl).toBe("https://cdn.sparkdating.com/photos/2026-10/test_user.jpg");

      const voiceUrl = storageService.getPublicUrl("audio/2026-10/test_intro.mp3");
      expect(voiceUrl).toBe("https://cdn.sparkdating.com/audio/2026-10/test_intro.mp3");
    });

    it("should resolve PUBLIC_API_BASE_URL when R2 custom domain is not set", () => {
      process.env.STORAGE_PROVIDER = "cloudflare_r2";
      delete process.env.R2_PUBLIC_BASE_URL;
      delete process.env.CLOUDFLARE_R2_PUBLIC_URL;
      process.env.PUBLIC_API_BASE_URL = "https://spark-app-tunnel.ngrok-free.app";

      const photoUrl = storageService.getPublicUrl("photos/2026-10/test_user.jpg");
      expect(photoUrl).toBe(
        "https://spark-app-tunnel.ngrok-free.app/api/v1/media/photos/2026-10/test_user.jpg"
      );
      expect(photoUrl).not.toContain("localhost");
    });

    it("should resolve dynamically from request headers when neither custom domain nor PUBLIC_API_BASE_URL are set", () => {
      process.env.STORAGE_PROVIDER = "cloudflare_r2";
      delete process.env.R2_PUBLIC_BASE_URL;
      delete process.env.CLOUDFLARE_R2_PUBLIC_URL;
      delete process.env.PUBLIC_API_BASE_URL;
      delete process.env.APP_URL;

      const mockReq = {
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "spark-tunnel.ngrok-free.app",
        },
      };

      const photoUrl = storageService.getPublicUrl("photos/2026-10/test_user.jpg", mockReq);
      expect(photoUrl).toBe(
        "https://spark-tunnel.ngrok-free.app/api/v1/media/photos/2026-10/test_user.jpg"
      );
    });
  });

  describe("2. HTTP Media Streaming Endpoint (/api/v1/media/*)", () => {
    let uploadedPhotoKey;
    let uploadedAudioKey;

    beforeAll(async () => {
      process.env.STORAGE_PROVIDER = "local";
      const photoFile = {
        originalname: "test_pixel.png",
        mimetype: "image/png",
        buffer: SAMPLE_PNG,
      };
      uploadedPhotoKey = await storageService.uploadFile(photoFile, { folder: "photos" });

      const audioFile = {
        originalname: "test_voice.mp3",
        mimetype: "audio/mpeg",
        buffer: SAMPLE_MP3,
      };
      uploadedAudioKey = await storageService.uploadFile(audioFile, { folder: "audio" });
    });

    afterAll(async () => {
      if (uploadedPhotoKey) await storageService.deleteFile(uploadedPhotoKey);
      if (uploadedAudioKey) await storageService.deleteFile(uploadedAudioKey);
    });

    it("should stream image with 200 OK, image/png Content-Type, and correct bytes", async () => {
      const res = await request(app).get(`/api/v1/media/${uploadedPhotoKey}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.headers["cache-control"]).toBe("public, max-age=86400");
      expect(res.body).toEqual(SAMPLE_PNG);
    });

    it("should stream voice intro with 200 OK, audio/mpeg Content-Type, and correct bytes", async () => {
      const res = await request(app).get(`/api/v1/media/${uploadedAudioKey}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["cache-control"]).toBe("public, max-age=86400");
      expect(res.body).toEqual(SAMPLE_MP3);
    });

    it("should return 404 for nonexistent media key", async () => {
      const res = await request(app).get("/api/v1/media/photos/2099-01/nonexistent.png");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("3. Discover and Profile Media Delivery Integration", () => {
    it("should return absolute canonical media URLs in public discover media format", () => {
      process.env.PUBLIC_API_BASE_URL = "https://public-api.sparkapp.com";
      const { ProfileMedia } = require("../models");

      const mockMediaList = [
        {
          id: "33333333-3333-4333-8333-333333333333",
          storageRef: "photos/2026-10/approved_photo.jpg",
          mediaType: "photo",
          moderationStatus: "approved",
          isPrimary: true,
          displayOrder: 0,
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          storageRef: "photos/2026-10/pending_photo.jpg",
          mediaType: "photo",
          moderationStatus: "pending",
          isPrimary: false,
          displayOrder: 1,
        },
      ];

      // Discover only includes approved media
      const approvedOnly = mockMediaList.filter((m) => m.moderationStatus === "approved");
      const discoverMedia = approvedOnly.map((m) => ({
        id: m.id,
        media_type: m.mediaType,
        url: storageService.getPublicUrl(m.storageRef, m.id),
        is_primary: Boolean(m.isPrimary),
      }));

      expect(discoverMedia).toHaveLength(1);
      expect(discoverMedia[0].url).toBe(
        "https://public-api.sparkapp.com/api/v1/media/photos/2026-10/approved_photo.jpg"
      );
      expect(discoverMedia[0].url).not.toContain("localhost");
      expect(discoverMedia[0].url).toMatch(/^https:\/\//);
    });
  });
});
