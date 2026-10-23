const multer = require("multer");

const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
});

function handleUploadSingle(req, res, next) {
  const uploadMiddleware = upload.single("file");
  uploadMiddleware(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error: {
            code: "IMAGE_TOO_LARGE",
            message: "File exceeds maximum permitted size of 5MB.",
          },
        });
      }
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_IMAGE",
          message: err.message || "Malformed file upload request.",
        },
      });
    }
    next();
  });
}

function handleLegacyPhotoUpload(req, res, next) {
  // Allow field 'photo' or 'file'
  const uploadMiddleware = upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]);
  uploadMiddleware(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error: {
            code: "IMAGE_TOO_LARGE",
            message: "File exceeds maximum permitted size of 5MB.",
          },
        });
      }
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_IMAGE",
          message: err.message || "Malformed file upload request.",
        },
      });
    }

    // Normalize req.file from fields
    if (req.files) {
      if (req.files.photo && req.files.photo[0]) {
        req.file = req.files.photo[0];
      } else if (req.files.file && req.files.file[0]) {
        req.file = req.files.file[0];
      }
    }
    next();
  });
}

module.exports = {
  handleUploadSingle,
  handleLegacyPhotoUpload,
};
