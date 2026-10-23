const express = require("express");
const authenticate = require("../middleware/authenticate");
const { handleLegacyPhotoUpload } = require("../middleware/uploadMiddleware");
const {
  getProfile,
  updateProfile,
  updateIntention,
  addPhoto,
  getPhotos,
  reorderPhotos,
  deletePhoto,
  addVoiceIntro,
  deleteVoiceIntro,
  completeOnboarding
} = require("../controllers/profileController");

const router = express.Router();
const multer = require("multer");
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } 
});

router.get("/me/profile", authenticate, getProfile);
router.patch("/me/profile", authenticate, updateProfile);
router.patch("/profile/intention", authenticate, updateIntention);

// Photos endpoints
router.get("/me/photos", authenticate, getPhotos);
router.post("/me/photos", authenticate, handleLegacyPhotoUpload, addPhoto);
router.patch("/me/photos/order", authenticate, reorderPhotos);
router.delete("/me/photos/:photo_id", authenticate, deletePhoto);

// Voice intro endpoints
router.post("/me/voice-intro", authenticate, upload.single("audio"), addVoiceIntro);
router.delete("/me/voice-intro", authenticate, deleteVoiceIntro);

// Onboarding completion
router.post("/me/onboarding/complete", authenticate, completeOnboarding);

module.exports = router;
