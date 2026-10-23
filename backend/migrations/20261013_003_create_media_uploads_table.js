const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261013_003_create_media_uploads_table",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      await queryInterface.createTable(
        "media_uploads",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          storage_key: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
          },
          mime_type: {
            type: DataTypes.STRING,
            allowNull: false,
          },
          file_size: {
            type: DataTypes.INTEGER,
            allowNull: false,
          },
          original_filename: {
            type: DataTypes.STRING,
            allowNull: true,
          },
          status: {
            type: DataTypes.ENUM("pending", "registered", "expired"),
            allowNull: false,
            defaultValue: "pending",
          },
          expires_at: {
            type: DataTypes.DATE,
            allowNull: false,
          },
          registered_at: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
          updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex("media_uploads", ["user_id", "status"], {
        name: "media_uploads_user_id_status_idx",
        transaction,
      });

      await queryInterface.addIndex("media_uploads", ["status", "expires_at"], {
        name: "media_uploads_status_expires_at_idx",
        transaction,
      });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      await queryInterface.dropTable("media_uploads", { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
