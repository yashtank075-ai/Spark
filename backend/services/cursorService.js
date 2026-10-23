const crypto = require("crypto");

// Default cursor TTL: 24 hours (in seconds)
const DEFAULT_CURSOR_TTL_SECONDS = 24 * 60 * 60;

/**
 * Derive 256-bit encryption key from secret.
 * Supports DISCOVER_CURSOR_SECRET with fallback to JWT_ACCESS_SECRET.
 */
function getCursorKey(secretOverride) {
  const secret =
    secretOverride ||
    process.env.DISCOVER_CURSOR_SECRET ||
    process.env.JWT_ACCESS_SECRET ||
    "spark-default-dev-cursor-secret-key-must-be-changed-in-prod";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Compute a compact 8-byte hexadecimal hash of the filter signature.
 */
function hashFilterSignature(filterSignature) {
  if (!filterSignature) return "0000000000000000";
  return crypto
    .createHash("sha256")
    .update(String(filterSignature))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Convert standard UUID (with hyphens) into 16-byte Buffer.
 */
function uuidToBuffer(uuidStr) {
  const cleaned = String(uuidStr).replace(/-/g, "");
  return Buffer.from(cleaned, "hex");
}

/**
 * Convert 16-byte Buffer back into standard UUID string format.
 */
function bufferToUuid(buf) {
  const hex = buf.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Generate an authenticated, encrypted, opaque pagination cursor.
 * Format: "dc_" + base64url( IV[12] + AuthTag[16] + EncryptedPayload[44] )
 * Total binary: 72 bytes -> ~96 base64url characters.
 *
 * Plaintext structure (44 bytes):
 * - userId: 16 bytes (UUID)
 * - profileId: 16 bytes (UUID)
 * - filterSigHash: 8 bytes (64-bit compact signature digest)
 * - expiresAtSec: 4 bytes (uint32 Unix timestamp in seconds)
 *
 * @param {Object} params
 * @param {string} params.userId - Authenticated user UUID
 * @param {string} params.profileId - Candidate profile anchor UUID
 * @param {string} params.filterSignature - Effective filter signature string
 * @param {number} [params.ttlSeconds] - Optional TTL in seconds (defaults to 24h)
 * @param {string} [params.secretKey] - Optional secret key override
 * @returns {string} Opaque cursor starting with "dc_"
 */
function generateCursor({
  userId,
  profileId,
  filterSignature,
  ttlSeconds = DEFAULT_CURSOR_TTL_SECONDS,
  secretKey,
}) {
  if (!userId || !profileId) {
    throw new Error("userId and profileId are required to generate cursor");
  }

  const uBuf = uuidToBuffer(userId);
  const pBuf = uuidToBuffer(profileId);
  const sigHex = hashFilterSignature(filterSignature);
  const sBuf = Buffer.from(sigHex, "hex").subarray(0, 8);

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + ttlSeconds;
  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32BE(expSec, 0);

  const plaintext = Buffer.concat([uBuf, pBuf, sBuf, expBuf]); // 44 bytes

  // Generate cryptographically secure random 12-byte IV for AES-GCM
  const iv = crypto.randomBytes(12);
  const key = getCursorKey(secretKey);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  // Pack IV (12) + Tag (16) + Ciphertext (44) = 72 bytes
  const combined = Buffer.concat([iv, tag, enc]);
  return "dc_" + combined.toString("base64url");
}

/**
 * Validate and decrypt an opaque cursor.
 *
 * @param {string} cursorStr - Raw cursor string from request
 * @param {Object} options
 * @param {string} options.expectedUserId - Authenticated user's UUID
 * @param {string} options.currentFilterSignature - Current query filter signature
 * @param {string} [options.secretKey] - Optional secret key override
 * @returns {Object} { isValid, isExpired, isTampered, isCrossUser, isFilterMismatch, profileId }
 */
function verifyAndDecodeCursor(cursorStr, {
  expectedUserId,
  currentFilterSignature,
  secretKey,
}) {
  if (!cursorStr || typeof cursorStr !== "string") {
    return { isValid: false, code: "INVALID_CURSOR" };
  }

  // Handle new opaque encrypted cursor ("dc_...")
  if (cursorStr.startsWith("dc_")) {
    let combined;
    try {
      combined = Buffer.from(cursorStr.slice(3), "base64url");
    } catch (_) {
      return { isValid: false, code: "INVALID_CURSOR" };
    }

    // Minimum length check: 12 (IV) + 16 (Tag) + 44 (Plaintext) = 72 bytes
    if (combined.length !== 72) {
      return { isValid: false, code: "INVALID_CURSOR" };
    }

    const iv = combined.subarray(0, 12);
    const tag = combined.subarray(12, 28);
    const enc = combined.subarray(28);

    const key = getCursorKey(secretKey);
    let decrypted;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      decrypted = Buffer.concat([decipher.update(enc), decipher.final()]);
    } catch (err) {
      // AEAD decryption or authentication tag mismatch (tampered or corrupted cursor)
      return { isValid: false, isTampered: true, code: "INVALID_CURSOR" };
    }

    if (decrypted.length !== 44) {
      return { isValid: false, code: "INVALID_CURSOR" };
    }

    const tokenUserId = bufferToUuid(decrypted.subarray(0, 16));
    const tokenProfileId = bufferToUuid(decrypted.subarray(16, 32));
    const tokenSigHash = decrypted.subarray(32, 40).toString("hex");
    const tokenExpSec = decrypted.readUInt32BE(40);

    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Expiration check
    if (nowSec > tokenExpSec) {
      return {
        isValid: false,
        isExpired: true,
        code: "EXPIRED_CURSOR",
        message: "The pagination cursor has expired. Please restart discovery.",
      };
    }

    // 2. Ownership check (user isolation: cross-user cursor reuse forbidden)
    if (expectedUserId && tokenUserId.toLowerCase() !== expectedUserId.toLowerCase()) {
      return {
        isValid: false,
        isCrossUser: true,
        code: "INVALID_CURSOR",
        message: "Cursor does not belong to the authenticated user.",
      };
    }

    // 3. Filter compatibility check
    if (currentFilterSignature) {
      const expectedSigHash = hashFilterSignature(currentFilterSignature);
      if (tokenSigHash !== expectedSigHash) {
        return {
          isValid: false,
          isFilterMismatch: true,
          code: "INCOMPATIBLE_CURSOR",
          message: "The provided cursor is incompatible with the current filter parameters.",
        };
      }
    }

    return {
      isValid: true,
      profileId: tokenProfileId,
    };
  }

  // Graceful backward-compatibility fallback for legacy Base64 JSON cursor during rollout
  try {
    const jsonStr = Buffer.from(cursorStr, "base64url").toString("utf8");
    const parsed = JSON.parse(jsonStr);
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (parsed && typeof parsed.id === "string" && UUID_REGEX.test(parsed.id)) {
      if (parsed.sig && currentFilterSignature && parsed.sig !== currentFilterSignature) {
        return {
          isValid: false,
          isFilterMismatch: true,
          code: "INCOMPATIBLE_CURSOR",
          message: "The provided cursor is incompatible with the current filter parameters.",
        };
      }
      return {
        isValid: true,
        profileId: parsed.id,
      };
    }
  } catch (_) {}

  return { isValid: false, code: "INVALID_CURSOR" };
}

module.exports = {
  DEFAULT_CURSOR_TTL_SECONDS,
  getCursorKey,
  hashFilterSignature,
  generateCursor,
  verifyAndDecodeCursor,
};
