const jwt = require("jsonwebtoken");
const AuthSession = require("../models/AuthSession");
const User = require("../models/User");

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const token = header.slice(7);

    let payload;

    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
        issuer: "spark-api",
        audience: "spark-mobile",
      });
    } catch {
      return res.status(401).json({
        success: false,
        message: "Access token is invalid or expired.",
      });
    }

    const session = await AuthSession.findOne({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        revokedAt: null,
      },
    });

    if (!session || session.expiresAt <= new Date()) {
      return res.status(401).json({
        success: false,
        message: "Session expired or revoked.",
      });
    }

    const user = await User.findByPk(payload.sub);

    if (!user || user.accountStatus !== "active") {
      return res.status(401).json({
        success: false,
        message: "Account is unavailable.",
      });
    }

    req.auth = {
      userId: user.id,
      sessionId: session.id,
    };

    req.user = user;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authenticate;