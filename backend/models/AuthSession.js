const sequelize = require("../config/db");
const { DataTypes } = require("sequelize");

const AuthSession = sequelize.define(
  "AuthSession",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "user_id",
    },
    refreshTokenHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      field: "refresh_token_hash",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "expires_at",
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "revoked_at",
    },
  },
  {
    tableName: "auth_sessions",
    underscored: true,
  },
);

module.exports = AuthSession;
