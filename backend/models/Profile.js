const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Profile = sequelize.define(
  "Profile",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      field: "user_id",
    },
    displayName: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "display_name",
    },
    gender: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    showGenderOnProfile: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "show_gender_on_profile",
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    interests: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    prompts: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    preferences: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    boundaries: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    boundaryPreferences: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      field: "boundary_preferences",
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    datingSpeed: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "dating_speed",
    },
    datingIntention: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "dating_intention",
    },
    onboardingStatus: {
      type: DataTypes.ENUM("not_started", "in_progress", "completed"),
      allowNull: false,
      defaultValue: "not_started",
      field: "onboarding_status",
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_verified",
    },
    verificationStatus: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "pending",
      field: "verification_status",
    },
    verificationSelfieMediaId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "verification_selfie_media_id",
    },
    verifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "verified_at",
    },
    verificationMethod: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "verification_method",
    },
    biometricConsent: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "biometric_consent",
    },
    biometricConsentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "biometric_consent_at",
    },
  },
  {
    tableName: "profiles",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["user_id"],
      },
      {
        fields: ["onboarding_status", "id"],
      },
    ],
  }
);

module.exports = Profile;
