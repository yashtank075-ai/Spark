
const { Op } = require("sequelize");
const AuthSession = require("../models/AuthSession");

async function getMySessions(req, res, next) {
  try {
    // Set by your existing JWT authentication middleware.
    const { userId, sessionId } = req.auth;

    const sessions = await AuthSession.findAll({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          [Op.gt]: new Date(),
        },
      },
      attributes: [
        "id",
        "createdAt",
        "expiresAt",
      ],
      order: [["createdAt", "DESC"]],
    });

    const data = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: session.id === sessionId,
    }));

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMySessions,
};