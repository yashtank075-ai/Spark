const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Message = sequelize.define(
  "Message",
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
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "sender_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    messageType: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "text",
      field: "message_type",
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    mediaUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "media_url",
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_read",
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "read_at",
    },
  },
  {
    tableName: "messages",
    underscored: true,
  }
);

module.exports = Message;
