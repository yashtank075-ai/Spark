const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261012_002_consolidate_onboarding_profile_fields",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      // 1. Add missing columns to profiles table
      const profileTable = await queryInterface.describeTable("profiles", { transaction });

      if (!profileTable.interests) {
        await queryInterface.addColumn(
          "profiles",
          "interests",
          {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: [],
          },
          { transaction }
        );
      }

      if (!profileTable.bio) {
        await queryInterface.addColumn(
          "profiles",
          "bio",
          {
            type: DataTypes.TEXT,
            allowNull: true,
          },
          { transaction }
        );
      }

      if (!profileTable.show_gender_on_profile) {
        await queryInterface.addColumn(
          "profiles",
          "show_gender_on_profile",
          {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          { transaction }
        );
      }

      if (!profileTable.boundary_preferences) {
        await queryInterface.addColumn(
          "profiles",
          "boundary_preferences",
          {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: {},
          },
          { transaction }
        );
      }

      if (!profileTable.location) {
        await queryInterface.addColumn(
          "profiles",
          "location",
          {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: {},
          },
          { transaction }
        );
      }

      // 2. Add is_primary and display_order to profile_media table
      const mediaTable = await queryInterface.describeTable("profile_media", { transaction });

      if (!mediaTable.is_primary) {
        await queryInterface.addColumn(
          "profile_media",
          "is_primary",
          {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          { transaction }
        );
      }

      if (!mediaTable.display_order) {
        await queryInterface.addColumn(
          "profile_media",
          "display_order",
          {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
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
      const profileTable = await queryInterface.describeTable("profiles", { transaction });
      if (profileTable.location) await queryInterface.removeColumn("profiles", "location", { transaction });
      if (profileTable.boundary_preferences) await queryInterface.removeColumn("profiles", "boundary_preferences", { transaction });
      if (profileTable.show_gender_on_profile) await queryInterface.removeColumn("profiles", "show_gender_on_profile", { transaction });
      if (profileTable.bio) await queryInterface.removeColumn("profiles", "bio", { transaction });
      if (profileTable.interests) await queryInterface.removeColumn("profiles", "interests", { transaction });

      const mediaTable = await queryInterface.describeTable("profile_media", { transaction });
      if (mediaTable.display_order) await queryInterface.removeColumn("profile_media", "display_order", { transaction });
      if (mediaTable.is_primary) await queryInterface.removeColumn("profile_media", "is_primary", { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
