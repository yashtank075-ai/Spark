const sequelize = require("../config/db");
const { DataTypes } = require("sequelize");

const OtpChallenge = sequelize.define(
  "OtpChallenge",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    phone: {
      type: DataTypes.STRING(16),
      allowNull: false,
    },
    codeHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: "code_hash",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "expires_at",
    },
    resendAfter: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "resend_after",
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    consumedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "consumed_at",
    },
  },
  {
    tableName: "otp_challenges",
    underscored: true,
    updatedAt: false,
  },
);

module.exports = OtpChallenge;
