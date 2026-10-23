const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GameAnswer = sequelize.define(
  "GameAnswer",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "session_id",
      references: {
        model: "game_sessions",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    participantId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "participant_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    questionId: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "question_id",
    },
    answerPayload: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "answer_payload",
    },
    submittedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "submitted_at",
    },
  },
  {
    tableName: "game_answers",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["session_id", "participant_id", "question_id"],
      },
      {
        fields: ["session_id"],
      },
    ],
  }
);

module.exports = GameAnswer;
