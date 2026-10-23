const express = require("express");
const authenticate = require("../middleware/authenticate");
const requireOnboarding = require("../middleware/requireOnboarding");
const {
  activateRush,
} = require("../controllers/rushController");

const router = express.Router();

router.use(authenticate);
router.use(requireOnboarding);

// API 7: Manually activate SPARK Rush
router.post("/activate", activateRush);

module.exports = router;
