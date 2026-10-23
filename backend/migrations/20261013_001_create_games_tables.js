const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261013_001_create_games_tables",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      // 1. Create game_catalogs table
      await queryInterface.createTable(
        "game_catalogs",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          game_type: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
          },
          display_name: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          description: {
            type: DataTypes.TEXT,
            allowNull: false,
          },
          is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          config: {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: {},
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

      await queryInterface.addIndex("game_catalogs", ["game_type"], {
        unique: true,
        name: "game_catalogs_game_type_unique",
        transaction,
      });

      // 2. Create game_sessions table
      await queryInterface.createTable(
        "game_sessions",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          conversation_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "conversations",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          game_type: {
            type: DataTypes.STRING(50),
            allowNull: false,
          },
          status: {
            type: DataTypes.ENUM(
              "pending",
              "accepted",
              "in_progress",
              "completed",
              "cancelled",
              "expired"
            ),
            allowNull: false,
            defaultValue: "pending",
          },
          inviter_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          invitee_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          accepted_at: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          expires_at: {
            type: DataTypes.DATE,
            allowNull: false,
          },
          cancelled_at: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          cancelled_by: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "SET NULL",
          },
          completed_at: {
            type: DataTypes.DATE,
            allowNull: true,
          },
          reveal_state: {
            type: DataTypes.ENUM("sealed", "revealed"),
            allowNull: false,
            defaultValue: "sealed",
          },
          revealed_at: {
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

      await queryInterface.addIndex("game_sessions", ["conversation_id"], {
        name: "game_sessions_conversation_id_idx",
        transaction,
      });

      await queryInterface.addIndex("game_sessions", ["status"], {
        name: "game_sessions_status_idx",
        transaction,
      });

      await queryInterface.addIndex("game_sessions", ["inviter_id"], {
        name: "game_sessions_inviter_id_idx",
        transaction,
      });

      await queryInterface.addIndex("game_sessions", ["invitee_id"], {
        name: "game_sessions_invitee_id_idx",
        transaction,
      });

      await queryInterface.addIndex("game_sessions", ["expires_at"], {
        name: "game_sessions_expires_at_idx",
        transaction,
      });

      // 3. Create game_answers table
      await queryInterface.createTable(
        "game_answers",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          session_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "game_sessions",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          participant_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          question_id: {
            type: DataTypes.STRING(100),
            allowNull: false,
          },
          answer_payload: {
            type: DataTypes.JSONB,
            allowNull: false,
          },
          submitted_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
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

      await queryInterface.addIndex(
        "game_answers",
        ["session_id", "participant_id", "question_id"],
        {
          unique: true,
          name: "game_answers_session_participant_question_unique",
          transaction,
        }
      );

      await queryInterface.addIndex("game_answers", ["session_id"], {
        name: "game_answers_session_id_idx",
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
      await queryInterface.dropTable("game_answers", { transaction });
      await queryInterface.dropTable("game_sessions", { transaction });
      await queryInterface.dropTable("game_catalogs", { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
