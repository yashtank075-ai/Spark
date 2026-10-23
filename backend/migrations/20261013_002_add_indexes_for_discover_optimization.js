const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261013_002_add_indexes_for_discover_optimization",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      // 1. Composite index on profiles (onboarding_status, id DESC) for cursor-based discovery pagination
      await queryInterface.addIndex(
        "profiles",
        ["onboarding_status", "id"],
        {
          name: "profiles_onboarding_status_id_idx",
          transaction,
        }
      );

      // 2. Index on profiles user_id for rapid lookups and joins
      await queryInterface.addIndex(
        "profiles",
        ["user_id"],
        {
          name: "profiles_user_id_idx",
          transaction,
        }
      );

      // 3. Composite index on profile_media (user_id, moderation_status, media_type)
      await queryInterface.addIndex(
        "profile_media",
        ["user_id", "moderation_status", "media_type"],
        {
          name: "profile_media_user_mod_type_idx",
          transaction,
        }
      );

      // 4. Index on users (account_status, age_eligible)
      await queryInterface.addIndex(
        "users",
        ["account_status", "age_eligible"],
        {
          name: "users_account_status_age_eligible_idx",
          transaction,
        }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      await queryInterface.removeIndex("users", "users_account_status_age_eligible_idx", { transaction });
      await queryInterface.removeIndex("profile_media", "profile_media_user_mod_type_idx", { transaction });
      await queryInterface.removeIndex("profiles", "profiles_user_id_idx", { transaction });
      await queryInterface.removeIndex("profiles", "profiles_onboarding_status_id_idx", { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
