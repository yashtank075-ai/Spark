const express = require("express");
const multer = require("multer");
const authenticate = require("../middleware/authenticate");
const requireOnboarding = require("../middleware/requireOnboarding");
const {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  goodbye,
  sendVoiceMessage,
} = require("../controllers/conversationController");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

const uploadVoice = (req, res, next) => {
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "voice", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          message: "Audio file exceeds maximum allowed size of 10MB.",
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || "File upload error.",
      });
    }

    if (req.files) {
      if (req.files.audio && req.files.audio[0]) {
        req.file = req.files.audio[0];
      } else if (req.files.voice && req.files.voice[0]) {
        req.file = req.files.voice[0];
      } else if (req.files.file && req.files.file[0]) {
        req.file = req.files.file[0];
      }
    }

    next();
  });
};

router.use(authenticate);
router.use(requireOnboarding);

// GET /api/v1/conversations
router.get("/conversations", getConversations);

// GET /api/v1/conversations/:conversation_id/messages
router.get("/conversations/:conversation_id/messages", getMessages);

// POST /api/v1/conversations/:conversation_id/messages
router.post("/conversations/:conversation_id/messages", sendMessage);

// POST /api/v1/conversations/:conversation_id/read
router.post("/conversations/:conversation_id/read", markAsRead);

// POST /api/v1/conversations/:conversation_id/goodbye
router.post("/conversations/:conversation_id/goodbye", goodbye);

// POST /api/v1/conversations/:conversation_id/voice
router.post("/conversations/:conversation_id/voice", uploadVoice, sendVoiceMessage);

module.exports = router;

