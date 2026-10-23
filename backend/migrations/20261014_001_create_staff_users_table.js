const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261014_001_create_staff_users_table",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      await queryInterface.createTable(
        "staff_users",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          email: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true,
          },
          password_hash: {
            type: DataTypes.STRING(255),
            allowNull: false,
          },
          first_name: {
            type: DataTypes.STRING(100),
            allowNull: true,
          },
          last_name: {
            type: DataTypes.STRING(100),
            allowNull: true,
          },
          role: {
            type: DataTypes.ENUM("super_admin", "admin", "moderator"),
            allowNull: false,
            defaultValue: "admin",
          },
          status: {
            type: DataTypes.ENUM("active", "disabled", "locked"),
            allowNull: false,
            defaultValue: "active",
          },
          mfa_enabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          mfa_secret: {
            type: DataTypes.STRING(255),
            allowNull: true,
          },
          failed_attempts: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
          },
          locked_until: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          last_login_at: {
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

      await queryInterface.addIndex("staff_users", ["email"], {
        unique: true,
        name: "staff_users_email_idx",
        transaction,
      });

      await queryInterface.addIndex("staff_users", ["status"], {
        name: "staff_users_status_idx",
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
      await queryInterface.dropTable("staff_users", { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
