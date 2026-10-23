const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GameSession = sequelize.define(
  "GameSession",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "conversation_id",
      references: {
        model: "conversations",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    gameType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "game_type",
    },
    status: {
      type: DataTypes.ENUM(
        "pending",
        "accepted",
        "in_progress",
        "completed",
        "cancelled",
        "expired"
      ),
      allowNull: false,
      defaultValue: "pending",
    },
    inviterId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "inviter_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    inviteeId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "invitee_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    acceptedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "accepted_at",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "expires_at",
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "cancelled_at",
    },
    cancelledBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "cancelled_by",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "SET NULL",
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "completed_at",
    },
    revealState: {
      type: DataTypes.ENUM("sealed", "revealed"),
      allowNull: false,
      defaultValue: "sealed",
      field: "reveal_state",
    },
    revealedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "revealed_at",
    },
  },
  {
    tableName: "game_sessions",
    underscored: true,
    indexes: [
      {
        fields: ["conversation_id"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["inviter_id"],
      },
      {
        fields: ["invitee_id"],
      },
      {
        fields: ["expires_at"],
      },
    ],
  }
);

module.exports = GameSession;
