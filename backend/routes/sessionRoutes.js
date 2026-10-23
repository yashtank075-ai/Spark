
const express = require("express");
const authenticate = require("../middleware/authenticate");
const {
  getMySessions,
} = require("../controllers/sessionController");

const router = express.Router();

// GET /api/v1/me/sessions
router.get("/sessions", authenticate, getMySessions);

module.exports = router;