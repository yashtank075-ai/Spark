const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Conversation = sequelize.define(
  "Conversation",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    matchId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      field: "match_id",
      references: {
        model: "matches",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_message_at",
    },
  },
  {
    tableName: "conversations",
    underscored: true,
  }
);

module.exports = Conversation;
