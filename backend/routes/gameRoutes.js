const express = require("express");
const authenticate = require("../middleware/authenticate");
const requireOnboarding = require("../middleware/requireOnboarding");
const {
  getCatalog,
  createSession,
  acceptSession,
  submitAnswer,
  getSession,
  cancelSession,
} = require("../controllers/gameController");

const router = express.Router();

router.use(authenticate);
router.use(requireOnboarding);

// 1. GET /api/v1/games/catalog
router.get("/catalog", getCatalog);

// 2. POST /api/v1/games/sessions
router.post("/sessions", createSession);

// 3. POST /api/v1/games/sessions/:session_id/accept
router.post("/sessions/:session_id/accept", acceptSession);

// 4. POST /api/v1/games/sessions/:session_id/answers
router.post("/sessions/:session_id/answers", submitAnswer);

// 5. GET /api/v1/games/sessions/:session_id
router.get("/sessions/:session_id", getSession);

// 6. DELETE /api/v1/games/sessions/:session_id
router.delete("/sessions/:session_id", cancelSession);

module.exports = router;
