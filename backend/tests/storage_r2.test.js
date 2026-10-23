const storageService = require("../services/storageService");

describe("Cloudflare R2 and Storage Provider Integration Suite", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("1. Configuration and Validation", () => {
    it("should validate successfully when Cloudflare R2 environment variables are present", () => {
      process.env.STORAGE_PROVIDER = "cloudflare_r2";
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test_key";
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test_secret";
      process.env.CLOUDFLARE_R2_BUCKET_NAME = "test_bucket";
      process.env.CLOUDFLARE_R2_ENDPOINT = "https://test.r2.cloudflarestorage.com";

      expect(() => storageService.validateConfig()).not.toThrow();
    });

    it("should fail validation fast if required R2 credentials are missing", () => {
      process.env.STORAGE_PROVIDER = "cloudflare_r2";
      delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
      delete process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
      delete process.env.CLOUDFLARE_R2_BUCKET_NAME;
      delete process.env.CLOUDFLARE_R2_ENDPOINT;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;

      expect(() => storageService.validateConfig()).toThrow(/Missing environment variables/);
    });

    it("should validate successfully when STORAGE_PROVIDER=local", () => {
      process.env.STORAGE_PROVIDER = "local";
      expect(() => storageService.validateConfig()).not.toThrow();
    });
  });

  describe("2. Local Storage Operations", () => {
    beforeEach(() => {
      process.env.STORAGE_PROVIDER = "local";
    });

    it("should upload, retrieve, and delete a file locally", async () => {
      const dummyFile = {
        originalname: "test_local.png",
        mimetype: "image/png",
        buffer: Buffer.from("dummy local image data"),
      };

      const storageRef = await storageService.uploadFile(dummyFile);
      expect(storageRef).toMatch(/^uploads\//);

      const metadata = await storageService.getFileMetadata(storageRef);
      expect(metadata).not.toBeNull();
      expect(metadata.contentLength).toBe(dummyFile.buffer.length);

      const publicUrl = storageService.getPublicUrl(storageRef);
      expect(publicUrl).toContain(storageRef);

      await storageService.deleteFile(storageRef);
      const postDeleteMeta = await storageService.getFileMetadata(storageRef);
      expect(postDeleteMeta).toBeNull();
    });
  });

  describe("3. Cloudflare R2 Mocked Operations", () => {
    beforeEach(() => {
      process.env.STORAGE_PROVIDER = "cloudflare_r2";
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "mock_key";
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "mock_secret";
      process.env.CLOUDFLARE_R2_BUCKET_NAME = "mock_bucket";
      process.env.CLOUDFLARE_R2_ENDPOINT = "https://mock.r2.cloudflarestorage.com";
      storageService.validateConfig();
    });

    it("should generate structured R2 keys with appropriate folders and timestamps", async () => {
      const sendSpy = jest.spyOn(storageService.r2Client, "send").mockResolvedValue({});

      const photoFile = {
        originalname: "avatar.jpg",
        mimetype: "image/jpeg",
        buffer: Buffer.from("fake photo bytes"),
      };

      const key = await storageService.uploadFile(photoFile, { folder: "photos" });
      expect(key).toMatch(/^photos\/\d{4}-\d{2}\/\d+_[a-z0-9]+\.jpg$/);

      const audioFile = {
        originalname: "voice.mp3",
        mimetype: "audio/mpeg",
        buffer: Buffer.from("fake audio bytes"),
      };

      const audioKey = await storageService.uploadFile(audioFile, { folder: "audio" });
      expect(audioKey).toMatch(/^audio\/\d{4}-\d{2}\/\d+_[a-z0-9]+\.mp3$/);

      sendSpy.mockRestore();
    });

    it("should generate a presigned download URL for private assets", async () => {
      const presigned = await storageService.getPresignedDownloadUrl("audio/2026-10/test.mp3", 900);
      expect(presigned).toBeTruthy();
      expect(typeof presigned).toBe("string");
      expect(presigned).toContain("X-Amz-Signature");
    });

    it("should return R2 custom domain URL when R2_PUBLIC_BASE_URL is configured", () => {
      process.env.R2_PUBLIC_BASE_URL = "https://cdn.sparkdating.com";
      const url = storageService.getPublicUrl("photos/2026-10/sample.jpg");
      expect(url).toBe("https://cdn.sparkdating.com/photos/2026-10/sample.jpg");
    });

    it("should return PUBLIC_API_BASE_URL media streaming URL when R2 custom domain is not set", () => {
      delete process.env.R2_PUBLIC_BASE_URL;
      delete process.env.CLOUDFLARE_R2_PUBLIC_URL;
      process.env.PUBLIC_API_BASE_URL = "https://spark-api.ngrok-free.app";

      const url = storageService.getPublicUrl("photos/2026-10/sample.jpg");
      expect(url).toBe("https://spark-api.ngrok-free.app/api/v1/media/photos/2026-10/sample.jpg");
    });
  });
});
