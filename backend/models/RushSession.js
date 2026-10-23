const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RushSession = sequelize.define(
  "RushSession",
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
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "started_at",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "expires_at",
    },
    eligibilityDay: {
      type: DataTypes.STRING(10), // e.g. YYYY-MM-DD
      allowNull: false,
      field: "eligibility_day",
    },
  },
  {
    tableName: "rush_sessions",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["user_id", "eligibility_day"],
      },
      {
        fields: ["user_id", "expires_at"],
      },
    ],
  }
);

module.exports = RushSession;
