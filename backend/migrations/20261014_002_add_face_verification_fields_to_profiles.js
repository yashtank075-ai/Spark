const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261014_002_add_face_verification_fields_to_profiles",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      const profileTable = await queryInterface.describeTable("profiles", { transaction });

      if (!profileTable.is_verified) {
        await queryInterface.addColumn(
          "profiles",
          "is_verified",
          {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          { transaction }
        );
      }

      if (!profileTable.verification_status) {
        await queryInterface.addColumn(
          "profiles",
          "verification_status",
          {
            type: DataTypes.STRING(30),
            allowNull: false,
            defaultValue: "pending",
          },
          { transaction }
        );
      }

      if (!profileTable.verification_selfie_media_id) {
        await queryInterface.addColumn(
          "profiles",
          "verification_selfie_media_id",
          {
            type: DataTypes.UUID,
            allowNull: true,
          },
          { transaction }
        );
      }

      if (!profileTable.verified_at) {
        await queryInterface.addColumn(
          "profiles",
          "verified_at",
          {
            type: DataTypes.DATE,
            allowNull: true,
          },
          { transaction }
        );
      }

      if (!profileTable.verification_method) {
        await queryInterface.addColumn(
          "profiles",
          "verification_method",
          {
            type: DataTypes.STRING(50),
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
      const profileTable = await queryInterface.describeTable("profiles", { transaction });

      if (profileTable.verification_method) {
        await queryInterface.removeColumn("profiles", "verification_method", { transaction });
      }
      if (profileTable.verified_at) {
        await queryInterface.removeColumn("profiles", "verified_at", { transaction });
      }
      if (profileTable.verification_selfie_media_id) {
        await queryInterface.removeColumn("profiles", "verification_selfie_media_id", { transaction });
      }
      if (profileTable.verification_status) {
        await queryInterface.removeColumn("profiles", "verification_status", { transaction });
      }
      if (profileTable.is_verified) {
        await queryInterface.removeColumn("profiles", "is_verified", { transaction });
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
