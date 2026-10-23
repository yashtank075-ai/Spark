const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261012_004_add_voice_message_fields_to_messages",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      // 1. Add message_type column
      await queryInterface.addColumn(
        "messages",
        "message_type",
        {
          type: DataTypes.STRING(32),
          allowNull: false,
          defaultValue: "text",
        },
        { transaction }
      );

      // 2. Add media_url column
      await queryInterface.addColumn(
        "messages",
        "media_url",
        {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        { transaction }
      );

      // 3. Add duration column
      await queryInterface.addColumn(
        "messages",
        "duration",
        {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        { transaction }
      );

      // 4. Alter content column to allow null
      await queryInterface.changeColumn(
        "messages",
        "content",
        {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        { transaction }
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
      await queryInterface.removeColumn("messages", "duration", { transaction });
      await queryInterface.removeColumn("messages", "media_url", { transaction });
      await queryInterface.removeColumn("messages", "message_type", { transaction });
      await queryInterface.changeColumn(
        "messages",
        "content",
        {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        { transaction }
      );
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
