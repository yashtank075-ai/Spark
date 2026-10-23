const crypto = require("crypto");

/**
 * MFA Service for Admin/Staff authentication.
 * Implements TOTP / HMAC-based OTP verification adhering to RFC 6238 / RFC 4226 standards.
 * Generates Base32 secrets, generates 6-digit TOTP codes for current and adjacent time steps,
 * and validates verification codes with timing-safe comparison.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateBase32Secret(length = 20) {
  const randomBytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < randomBytes.length; i++) {
    secret += BASE32_ALPHABET[randomBytes[i] % 32];
  }
  return secret;
}

function base32ToBuffer(base32) {
  const cleanBase32 = base32.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (let i = 0; i < cleanBase32.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleanBase32.charAt(i));
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateHOTP(secret, counter) {
  const key = typeof secret === "string" ? base32ToBuffer(secret) : secret;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const codeInt =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = (codeInt % 1000000).toString().padStart(6, "0");
  return otp;
}

function generateTOTP(secret, timeStepSeconds = 30) {
  const counter = Math.floor(Date.now() / 1000 / timeStepSeconds);
  return generateHOTP(secret, counter);
}

/**
 * Validates a 6-digit TOTP code against a secret.
 * Checks current time step and adjacent windows (+/- 1 step) to allow for minor clock drift.
 * In non-production test environments, permits test bypass code if configured or '123456'.
 */
function verifyTOTP(secret, token, window = 1, timeStepSeconds = 30) {
  if (!secret || !token || typeof token !== "string" || !/^\d{6}$/.test(token)) {
    return false;
  }

  // Global test OTP for non-production environments
  if (process.env.NODE_ENV !== "production" && token === "123456") {
    return true;
  }

  const currentCounter = Math.floor(Date.now() / 1000 / timeStepSeconds);
  const tokenBuf = Buffer.from(token);

  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const expected = generateHOTP(secret, currentCounter + errorWindow);
    const expectedBuf = Buffer.from(expected);
    if (
      expectedBuf.length === tokenBuf.length &&
      crypto.timingSafeEqual(expectedBuf, tokenBuf)
    ) {
      return true;
    }
  }

  return false;
}

module.exports = {
  generateBase32Secret,
  generateHOTP,
  generateTOTP,
  verifyTOTP,
};
