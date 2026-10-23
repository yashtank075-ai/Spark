const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MediaUpload = sequelize.define(
  "MediaUpload",
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
    storageKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: "storage_key",
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "mime_type",
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "file_size",
    },
    originalFilename: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "original_filename",
    },
    status: {
      type: DataTypes.ENUM("pending", "registered", "expired"),
      allowNull: false,
      defaultValue: "pending",
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "expires_at",
    },
    registeredAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "registered_at",
    },
  },
  {
    tableName: "media_uploads",
    underscored: true,
    indexes: [
      {
        fields: ["user_id", "status"],
      },
      {
        fields: ["status", "expires_at"],
      },
    ],
  }
);

module.exports = MediaUpload;
