const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Block = sequelize.define(
  "Block",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    blockerId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "blocker_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    blockedId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "blocked_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
  },
  {
    tableName: "blocks",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["blocker_id", "blocked_id"],
      },
      {
        fields: ["blocker_id"],
      },
      {
        fields: ["blocked_id"],
      },
    ],
  }
);

module.exports = Block;
