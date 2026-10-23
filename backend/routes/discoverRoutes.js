const express = require("express");
const authenticate = require("../middleware/authenticate");
const requireOnboarding = require("../middleware/requireOnboarding");
const {
  getDiscoverDeck,
  getProfileDetails,
  updatePreferences,
} = require("../controllers/discoverController");
const {
  likeProfile,
  passProfile,
} = require("../controllers/interactionController");

const router = express.Router();

// Apply auth and completed onboarding to all discover & profile interaction routes
router.use(authenticate);
router.use(requireOnboarding);

// API 1: Discover deck
router.get("/discover", getDiscoverDeck);

// API 3: Update discovery preferences
router.put("/discover/preferences", updatePreferences);

// API 2: View profile details
router.get("/profiles/:profile_id", getProfileDetails);

// API 4: Like a profile
router.post("/profiles/:profile_id/like", likeProfile);

// API 5: Pass a profile
router.post("/profiles/:profile_id/pass", passProfile);

module.exports = router;
