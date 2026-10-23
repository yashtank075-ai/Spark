const fs = require("fs");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

class StorageService {
  constructor() {
    this.uploadDir = path.join(__dirname, "..", "uploads");
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    this.r2Client = null;
  }

  get provider() {
    return process.env.STORAGE_PROVIDER || "local";
  }

  /**
   * Initialize Cloudflare R2 S3 client with credentials.
   * Validates required environment variables strictly.
   */
  _initCloudflareR2() {
    const accountId = (
      process.env.R2_ACCOUNT_ID ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      ""
    ).trim();
    const accessKeyId = (
      process.env.R2_ACCESS_KEY_ID ||
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
      ""
    ).trim();
    const secretAccessKey = (
      process.env.R2_SECRET_ACCESS_KEY ||
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
      ""
    ).trim();
    const bucketName = (
      process.env.R2_BUCKET_NAME ||
      process.env.CLOUDFLARE_R2_BUCKET_NAME ||
      ""
    ).trim();
    const endpoint =
      (process.env.R2_ENDPOINT || process.env.CLOUDFLARE_R2_ENDPOINT || "").trim() ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

    const missing = [];
    if (!accessKeyId) missing.push("CLOUDFLARE_R2_ACCESS_KEY_ID or R2_ACCESS_KEY_ID");
    if (!secretAccessKey)
      missing.push("CLOUDFLARE_R2_SECRET_ACCESS_KEY or R2_SECRET_ACCESS_KEY");
    if (!bucketName) missing.push("CLOUDFLARE_R2_BUCKET_NAME or R2_BUCKET_NAME");
    if (!endpoint)
      missing.push("CLOUDFLARE_R2_ENDPOINT, R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID");

    if (missing.length > 0) {
      throw new Error(
        `Cloudflare R2 storage provider is misconfigured. Missing environment variables: ${missing.join(", ")}`,
      );
    }

    this.r2Bucket = bucketName;
    this.r2Endpoint = endpoint;
    this.r2Client = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  /**
   * Validate storage configuration at startup or environment change.
   */
  validateConfig() {
    if (this.provider === "cloudflare_r2") {
      this._initCloudflareR2();
    }
    return true;
  }

  /**
   * Determine safe file extension from original name or MIME type.
   */
  _getFileExtension(file) {
    if (file.originalname) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext && ext.length <= 10) return ext;
    }
    const mimeToExt = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/heic": ".heic",
      "image/heif": ".heif",
      "audio/mpeg": ".mp3",
      "audio/mp3": ".mp3",
      "audio/m4a": ".m4a",
      "audio/mp4": ".m4a",
      "audio/aac": ".aac",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
      "audio/webm": ".webm",
    };
    return mimeToExt[file.mimetype] || "";
  }

  /**
   * Generate an isolated, collision-resistant object key.
   * e.g., profile-photos/2026-10/1728812345_a1b2c3d4e5f6.jpg
   */
  _generateObjectKey(file, prefix = "media") {
    const ext = this._getFileExtension(file);
    const datePrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
    const randomHex = Math.random().toString(36).substring(2, 10);
    const timestamp = Date.now();

    // Determine subfolder based on explicitly requested prefix or MIME type fallback
    let subfolder = prefix;
    if (prefix === "media") {
      if (file.mimetype) {
        if (file.mimetype.startsWith("image/")) subfolder = "photos";
        else if (file.mimetype.startsWith("audio/")) subfolder = "audio";
      }
    }

    return `${subfolder}/${datePrefix}/${timestamp}_${randomHex}${ext}`;
  }

  /**
   * Upload a file buffer to the configured storage provider.
   * Returns storage reference string (e.g., "uploads/123.jpg" or "photos/2026-10/123.jpg").
   */
  async uploadFile(file, options = {}) {
    if (!file) {
      throw new Error("No file provided.");
    }
    if (!file.buffer) {
      throw new Error("File buffer is required for upload.");
    }

    if (this.provider === "cloudflare_r2") {
      if (!this.r2Client) {
        this._initCloudflareR2();
      }

      const objectKey = this._generateObjectKey(
        file,
        options.folder || "media",
      );
      const contentType = file.mimetype || "application/octet-stream";

      const command = new PutObjectCommand({
        Bucket: this.r2Bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: contentType,
        Metadata: {
          originalName: encodeURIComponent(file.originalname || "unnamed"),
          uploadedAt: new Date().toISOString(),
        },
      });

      try {
        await this.r2Client.send(command);
        return objectKey;
      } catch (err) {
        console.error("Cloudflare R2 upload error:", err.message);
        throw new Error(
          `Failed to upload file to Cloudflare R2: ${err.message}`,
        );
      }
    } else if (this.provider === "aws_s3" || this.provider === "cloudinary") {
      // Stubbed implementation for other Cloud providers
      if (!process.env.STORAGE_CREDENTIALS) {
        throw new Error(
          "Storage provider not configured. Media upload is currently unavailable.",
        );
      }
      return `cloud_uri_path_${Date.now()}`;
    } else {
      // Local storage fallback for development / testing
      const ext = this._getFileExtension(file);
      const folder = options.folder ? options.folder.replace(/[^a-zA-Z0-9_-]/g, "") : "";
      const targetDir = folder ? path.join(this.uploadDir, folder) : this.uploadDir;
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const fileName = `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
      const filePath = path.join(targetDir, fileName);
      fs.writeFileSync(filePath, file.buffer);
      return folder ? `uploads/${folder}/${fileName}` : `uploads/${fileName}`;
    }
  }

  /**
   * Delete a file from the configured storage provider.
   */
  async deleteFile(storageRef) {
    if (!storageRef) return;

    if (this.provider === "cloudflare_r2") {
      if (!this.r2Client) {
        this._initCloudflareR2();
      }

      const key = storageRef.startsWith("/") ? storageRef.slice(1) : storageRef;
      const command = new DeleteObjectCommand({
        Bucket: this.r2Bucket,
        Key: key,
      });

      try {
        await this.r2Client.send(command);
      } catch (err) {
        console.error("Cloudflare R2 delete error:", err.message);
        throw new Error(
          `Failed to delete file from Cloudflare R2: ${err.message}`,
        );
      }
    } else if (this.provider === "aws_s3" || this.provider === "cloudinary") {
      if (!process.env.STORAGE_CREDENTIALS) {
        return;
      }
    } else {
      const filePath = path.join(__dirname, "..", storageRef);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  /**
   * Get file metadata from storage provider.
   */
  async getFileMetadata(storageRef) {
    if (!storageRef) return null;

    if (this.provider === "cloudflare_r2") {
      if (!this.r2Client) {
        this._initCloudflareR2();
      }
      const key = storageRef.startsWith("/") ? storageRef.slice(1) : storageRef;
      const command = new HeadObjectCommand({
        Bucket: this.r2Bucket,
        Key: key,
      });
      try {
        const response = await this.r2Client.send(command);
        return {
          contentType: response.ContentType,
          contentLength: response.ContentLength,
          lastModified: response.LastModified,
          metadata: response.Metadata,
        };
      } catch (err) {
        if (
          err.name === "NotFound" ||
          err.name === "NoSuchKey" ||
          err.$metadata?.httpStatusCode === 404
        ) {
          // Backward-compatible fallback: check local disk in case this was a pre-migration record
          const localPath = path.join(__dirname, "..", key);
          if (fs.existsSync(localPath)) {
            const stats = fs.statSync(localPath);
            const ext = path.extname(key).toLowerCase();
            const extToMime = {
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".png": "image/png",
              ".webp": "image/webp",
              ".heic": "image/heic",
              ".heif": "image/heif",
              ".mp3": "audio/mpeg",
              ".m4a": "audio/m4a",
              ".wav": "audio/wav",
              ".aac": "audio/aac",
              ".webm": "audio/webm",
            };
            return {
              contentType: extToMime[ext] || "application/octet-stream",
              contentLength: stats.size,
              lastModified: stats.mtime,
            };
          }
          return null;
        }
        throw err;
      }
    } else {
      const filePath = path.join(__dirname, "..", storageRef);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const ext = path.extname(storageRef).toLowerCase();
        const extToMime = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".webp": "image/webp",
          ".heic": "image/heic",
          ".heif": "image/heif",
          ".mp3": "audio/mpeg",
          ".m4a": "audio/m4a",
          ".wav": "audio/wav",
          ".aac": "audio/aac",
          ".webm": "audio/webm",
        };
        return {
          contentType: extToMime[ext] || "application/octet-stream",
          contentLength: stats.size,
          lastModified: stats.mtime,
        };
      }
      return null;
    }
  }

  /**
   * Get readable stream for a file.
   */
  async getFileStream(storageRef) {
    if (!storageRef) return null;

    const extToMime = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".heic": "image/heic",
      ".heif": "image/heif",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/m4a",
      ".wav": "audio/wav",
      ".aac": "audio/aac",
      ".webm": "audio/webm",
    };

    if (this.provider === "cloudflare_r2") {
      if (!this.r2Client) {
        this._initCloudflareR2();
      }
      const key = storageRef.startsWith("/") ? storageRef.slice(1) : storageRef;
      const { GetObjectCommand } = require("@aws-sdk/client-s3");
      const command = new GetObjectCommand({
        Bucket: this.r2Bucket,
        Key: key,
      });

      try {
        const response = await this.r2Client.send(command);
        return {
          stream: response.Body,
          contentType: response.ContentType,
          contentLength: response.ContentLength,
        };
      } catch (r2Err) {
        if (
          r2Err.name === "NoSuchKey" ||
          r2Err.name === "NotFound" ||
          r2Err.$metadata?.httpStatusCode === 404
        ) {
          // Backward-compatible fallback: check local disk in case file exists locally
          const localPath = path.join(__dirname, "..", key);
          if (fs.existsSync(localPath)) {
            const ext = path.extname(key).toLowerCase();
            return {
              stream: fs.createReadStream(localPath),
              contentType: extToMime[ext] || "application/octet-stream",
              contentLength: fs.statSync(localPath).size,
            };
          }
          return null;
        }
        throw r2Err;
      }
    } else {
      const filePath = path.join(__dirname, "..", storageRef);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(storageRef).toLowerCase();
        return {
          stream: fs.createReadStream(filePath),
          contentType: extToMime[ext] || "application/octet-stream",
          contentLength: fs.statSync(filePath).size,
        };
      }
      return null;
    }
  }

  /**
   * Get buffer for a stored asset.
   */
  async getFileBuffer(storageRef) {
    const fileData = await this.getFileStream(storageRef);
    if (!fileData || !fileData.stream) return null;

    if (Buffer.isBuffer(fileData.stream)) {
      return fileData.stream;
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      fileData.stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      fileData.stream.on("error", (err) => reject(err));
      fileData.stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  /**
   * Generate a short-lived presigned download URL for private files.
   * @param {string} storageRef
   * @param {number} expiresInSeconds - default 3600 (1 hour)
   */
  async getPresignedDownloadUrl(storageRef, expiresInSeconds = 3600) {
    if (!storageRef) return null;

    if (this.provider === "cloudflare_r2") {
      if (!this.r2Client) {
        this._initCloudflareR2();
      }
      const key = storageRef.startsWith("/") ? storageRef.slice(1) : storageRef;
      const { GetObjectCommand } = require("@aws-sdk/client-s3");
      const command = new GetObjectCommand({
        Bucket: this.r2Bucket,
        Key: key,
      });
      return await getSignedUrl(this.r2Client, command, {
        expiresIn: expiresInSeconds,
      });
    } else {
      return this.getPublicUrl(storageRef);
    }
  }

  /**
   * Return a reachable URL for a stored asset.
   * If R2 has a public domain (R2_PUBLIC_BASE_URL or CLOUDFLARE_R2_PUBLIC_URL), it formats the public CDN URL.
   * Otherwise, if it's served through backend streaming, returns canonical URL based on PUBLIC_API_BASE_URL or APP_URL.
   *
   * @param {string} storageRef - e.g. "photos/2026-10/123.jpg" or "uploads/123.jpg"
   * @param {string|object} [context] - optional media ID, request object, or explicit host string
   */
  getPublicUrl(storageRef, context = null) {
    if (!storageRef) return null;
    if (storageRef.startsWith("http://") || storageRef.startsWith("https://")) {
      return storageRef;
    }

    const cleanRef = storageRef.startsWith("/")
      ? storageRef.slice(1)
      : storageRef;

    // 1. If Cloudflare R2 public custom domain / CDN is configured
    const publicBase = (
      process.env.R2_PUBLIC_BASE_URL ||
      process.env.CLOUDFLARE_R2_PUBLIC_URL ||
      ""
    )
      .trim()
      .replace(/\/+$/, "");

    if (this.provider === "cloudflare_r2" && publicBase) {
      return `${publicBase}/${cleanRef}`;
    }

    // 2. Resolve base API host URL for backend streaming
    let baseUrl = (
      process.env.PUBLIC_API_BASE_URL ||
      process.env.APP_URL ||
      ""
    )
      .trim()
      .replace(/\/+$/, "");

    // If context is an Express request with headers (e.g. ngrok tunnel), infer host if baseUrl not explicitly set
    if (!baseUrl && context && typeof context === "object" && context.headers) {
      const forwardedProto = context.headers["x-forwarded-proto"] || context.protocol || "http";
      const forwardedHost = context.headers["x-forwarded-host"] || context.headers["host"];
      if (forwardedHost) {
        baseUrl = `${forwardedProto}://${forwardedHost}`;
      }
    }

    if (!baseUrl) {
      baseUrl = `http://localhost:${process.env.PORT || 5000}`;
    }

    // Both Cloudflare R2 and local disk storage objects are streamed through /api/v1/media/*
    return `${baseUrl}/api/v1/media/${cleanRef}`;
  }
}

module.exports = new StorageService();
