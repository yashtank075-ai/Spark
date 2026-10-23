const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const StaffUser = sequelize.define(
  "StaffUser",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "password_hash",
    },
    firstName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "first_name",
    },
    lastName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "last_name",
    },
    role: {
      type: DataTypes.ENUM("super_admin", "admin", "moderator"),
      allowNull: false,
      defaultValue: "admin",
    },
    status: {
      type: DataTypes.ENUM("active", "disabled", "locked"),
      allowNull: false,
      defaultValue: "active",
    },
    mfaEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "mfa_enabled",
    },
    mfaSecret: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "mfa_secret",
    },
    failedAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "failed_attempts",
    },
    lockedUntil: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "locked_until",
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_login_at",
    },
  },
  {
    tableName: "staff_users",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["email"],
      },
      {
        fields: ["status"],
      },
    ],
  }
);

module.exports = StaffUser;
