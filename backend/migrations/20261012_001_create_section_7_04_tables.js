const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261012_001_create_section_7_04_tables",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      // 1. Create interactions table
      await queryInterface.createTable(
        "interactions",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          actor_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          target_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          action: {
            type: DataTypes.ENUM("like", "pass"),
            allowNull: false,
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

      await queryInterface.addIndex("interactions", ["actor_id", "target_id"], {
        unique: true,
        name: "interactions_actor_id_target_id",
        transaction,
      });

      await queryInterface.addIndex("interactions", ["target_id", "action"], {
        name: "interactions_target_id_action",
        transaction,
      });

      // 2. Create matches table
      await queryInterface.createTable(
        "matches",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          user_a_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          user_b_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          status: {
            type: DataTypes.ENUM("active", "unmatched"),
            allowNull: false,
            defaultValue: "active",
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

      await queryInterface.addIndex("matches", ["user_a_id", "user_b_id"], {
        unique: true,
        name: "matches_user_a_id_user_b_id",
        transaction,
      });

      await queryInterface.addIndex("matches", ["user_a_id"], {
        name: "matches_user_a_id",
        transaction,
      });

      await queryInterface.addIndex("matches", ["user_b_id"], {
        name: "matches_user_b_id",
        transaction,
      });

      // 3. Create rush_sessions table
      await queryInterface.createTable(
        "rush_sessions",
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
          started_at: {
            type: DataTypes.DATE,
            allowNull: false,
          },
          expires_at: {
            type: DataTypes.DATE,
            allowNull: false,
          },
          eligibility_day: {
            type: DataTypes.STRING(10),
            allowNull: false,
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

      await queryInterface.addIndex("rush_sessions", ["user_id", "eligibility_day"], {
        unique: true,
        name: "rush_sessions_user_id_eligibility_day",
        transaction,
      });

      await queryInterface.addIndex("rush_sessions", ["user_id", "expires_at"], {
        name: "rush_sessions_user_id_expires_at",
        transaction,
      });

      // 4. Create blocks table
      await queryInterface.createTable(
        "blocks",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          blocker_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          blocked_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
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

      await queryInterface.addIndex("blocks", ["blocker_id", "blocked_id"], {
        unique: true,
        name: "blocks_blocker_id_blocked_id",
        transaction,
      });

      await queryInterface.addIndex("blocks", ["blocker_id"], {
        name: "blocks_blocker_id",
        transaction,
      });

      await queryInterface.addIndex("blocks", ["blocked_id"], {
        name: "blocks_blocked_id",
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
      await queryInterface.dropTable("blocks", { transaction });
      await queryInterface.dropTable("rush_sessions", { transaction });
      await queryInterface.dropTable("matches", { transaction });
      await queryInterface.dropTable("interactions", { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
