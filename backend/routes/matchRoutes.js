const express = require("express");
const authenticate = require("../middleware/authenticate");
const requireOnboarding = require("../middleware/requireOnboarding");
const { getMatches, unmatch } = require("../controllers/matchController");

const router = express.Router();

router.use(authenticate);
router.use(requireOnboarding);

// GET /api/v1/matches - List authenticated user's active matches
router.get("/matches", getMatches);

// DELETE /api/v1/matches/:match_id - Unmatch participant
router.delete("/matches/:match_id", unmatch);

module.exports = router;
