/**
 * Image inspection and validation utility.
 * Validates actual binary file signatures (magic bytes) to reject corrupt, spoofed or invalid images.
 */

// JPEG magic bytes: FF D8 FF
function isJPEG(buffer) {
  if (!buffer || buffer.length < 3) return false;
  return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
function isPNG(buffer) {
  if (!buffer || buffer.length < 8) return false;
  return (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

// WebP magic bytes: RIFF....WEBP (bytes 0-3 = "RIFF", bytes 8-11 = "WEBP")
function isWebP(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const isRiff =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46;
  const isWebp =
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;
  return isRiff && isWebp;
}

/**
 * Validates an image file buffer against supported MIME types and magic bytes.
 * @param {Object} file - Multer file object with buffer, mimetype, size
 * @returns {{ isValid: boolean, error?: { code: string, message: string }, detectedMime?: string }}
 */
function validateImageFile(file) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    return {
      isValid: false,
      error: {
        code: "INVALID_IMAGE",
        message: "No image file provided or file is empty.",
      },
    };
  }

  // 5MB limit
  const MAX_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE || file.buffer.length > MAX_SIZE) {
    return {
      isValid: false,
      error: {
        code: "IMAGE_TOO_LARGE",
        message: "File exceeds maximum permitted size of 5MB.",
      },
    };
  }

  // Detect signature
  const buffer = file.buffer;
  let detectedMime = null;
  if (isJPEG(buffer)) {
    detectedMime = "image/jpeg";
  } else if (isPNG(buffer)) {
    detectedMime = "image/png";
  } else if (isWebP(buffer)) {
    detectedMime = "image/webp";
  }

  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!detectedMime || !allowedMimeTypes.includes(detectedMime)) {
    return {
      isValid: false,
      error: {
        code: "INVALID_IMAGE_TYPE",
        message: "Unsupported image format. Allowed formats: JPEG, PNG, WebP.",
      },
    };
  }

  // Also verify client mimetype matches or is closely related
  if (
    file.mimetype &&
    !allowedMimeTypes.includes(file.mimetype) &&
    file.mimetype !== "image/jpg"
  ) {
    return {
      isValid: false,
      error: {
        code: "INVALID_IMAGE_TYPE",
        message: "MIME type header does not match valid image types.",
      },
    };
  }

  return {
    isValid: true,
    detectedMime,
  };
}

module.exports = {
  isJPEG,
  isPNG,
  isWebP,
  validateImageFile,
};
