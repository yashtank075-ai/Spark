const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ProfileMedia = sequelize.define(
  "ProfileMedia",
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
    mediaType: {
      type: DataTypes.ENUM("photo", "voice_intro"),
      allowNull: false,
      field: "media_type",
    },
    storageRef: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "storage_ref",
    },
    moderationStatus: {
      type: DataTypes.ENUM("pending", "approved", "rejected"),
      allowNull: false,
      defaultValue: "pending",
      field: "moderation_status",
    },
    isPrimary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_primary",
    },
    displayOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "display_order",
    },
    faceReviewStatus: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "not_applicable",
      field: "face_review_status",
    },
    faceSimilarity: {
      type: DataTypes.FLOAT,
      allowNull: true,
      field: "face_similarity",
    },
    faceReviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "face_reviewed_at",
    },
  },
  {
    tableName: "profile_media",
    underscored: true,
    indexes: [
      {
        fields: ["user_id", "moderation_status", "media_type"],
      },
    ],
  }
);

module.exports = ProfileMedia;
