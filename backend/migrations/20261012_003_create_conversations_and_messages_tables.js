const { DataTypes } = require("sequelize");

module.exports = {
  name: "20261012_003_create_conversations_and_messages_tables",
  async up(queryInterface, sequelizeInstance) {
    const transaction = await sequelizeInstance.transaction();
    try {
      // 1. Create conversations table
      await queryInterface.createTable(
        "conversations",
        {
          id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
          },
          match_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
            references: {
              model: "matches",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          last_message_at: {
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

      await queryInterface.addIndex("conversations", ["match_id"], {
        unique: true,
        name: "conversations_match_id_unique",
        transaction,
      });

      await queryInterface.addIndex("conversations", ["last_message_at"], {
        name: "conversations_last_message_at_idx",
        transaction,
      });

      // 2. Create messages table
      await queryInterface.createTable(
        "messages",
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
          sender_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          content: {
            type: DataTypes.TEXT,
            allowNull: false,
          },
          is_read: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          read_at: {
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

      await queryInterface.addIndex("messages", ["conversation_id", "created_at"], {
        name: "messages_conversation_id_created_at_idx",
        transaction,
      });

      await queryInterface.addIndex("messages", ["conversation_id", "is_read"], {
        name: "messages_conversation_id_is_read_idx",
        transaction,
      });

      await queryInterface.addIndex("messages", ["sender_id"], {
        name: "messages_sender_id_idx",
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
      await queryInterface.dropTable("messages", { transaction });
      await queryInterface.dropTable("conversations", { transaction });
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
