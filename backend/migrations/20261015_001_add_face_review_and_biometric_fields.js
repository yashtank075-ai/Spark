const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261015_001_add_face_review_and_biometric_fields",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      // 1. Extend profile_media table with face review columns
      const mediaTable = await queryInterface.describeTable("profile_media", { transaction });

      if (!mediaTable.face_review_status) {
        await queryInterface.addColumn(
          "profile_media",
          "face_review_status",
          {
            type: DataTypes.STRING(30),
            allowNull: false,
            defaultValue: "not_applicable",
          },
          { transaction }
        );
      }

      if (!mediaTable.face_similarity) {
        await queryInterface.addColumn(
          "profile_media",
          "face_similarity",
          {
            type: DataTypes.FLOAT,
            allowNull: true,
          },
          { transaction }
        );
      }

      if (!mediaTable.face_reviewed_at) {
        await queryInterface.addColumn(
          "profile_media",
          "face_reviewed_at",
          {
            type: DataTypes.DATE,
            allowNull: true,
          },
          { transaction }
        );
      }

      // Add index for querying photos by face_review_status
      try {
        await queryInterface.addIndex("profile_media", ["user_id", "face_review_status"], {
          name: "idx_profile_media_user_face_review",
          transaction,
        });
      } catch (idxErr) {
        // Index may already exist
      }

      // 2. Extend profiles table with biometric reference info if missing
      const profileTable = await queryInterface.describeTable("profiles", { transaction });

      if (!profileTable.verification_status) {
        await queryInterface.addColumn(
          "profiles",
          "verification_status",
          {
            type: DataTypes.STRING(30),
            allowNull: false,
            defaultValue: "not_started",
          },
          { transaction }
        );
      }

      if (!profileTable.biometric_consent) {
        await queryInterface.addColumn(
          "profiles",
          "biometric_consent",
          {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          { transaction }
        );
      }

      if (!profileTable.biometric_consent_at) {
        await queryInterface.addColumn(
          "profiles",
          "biometric_consent_at",
          {
            type: DataTypes.DATE,
            allowNull: true,
          },
          { transaction }
        );
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      const mediaTable = await queryInterface.describeTable("profile_media", { transaction });

      try {
        await queryInterface.removeIndex("profile_media", "idx_profile_media_user_face_review", { transaction });
      } catch (idxErr) {
        // Ignore if index does not exist
      }

      if (mediaTable.face_reviewed_at) {
        await queryInterface.removeColumn("profile_media", "face_reviewed_at", { transaction });
      }
      if (mediaTable.face_similarity) {
        await queryInterface.removeColumn("profile_media", "face_similarity", { transaction });
      }
      if (mediaTable.face_review_status) {
        await queryInterface.removeColumn("profile_media", "face_review_status", { transaction });
      }

      const profileTable = await queryInterface.describeTable("profiles", { transaction });
      if (profileTable.biometric_consent_at) {
        await queryInterface.removeColumn("profiles", "biometric_consent_at", { transaction });
      }
      if (profileTable.biometric_consent) {
        await queryInterface.removeColumn("profiles", "biometric_consent", { transaction });
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
