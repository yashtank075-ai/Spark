const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Interaction = sequelize.define(
  "Interaction",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    actorId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "actor_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    targetId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "target_id",
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
  },
  {
    tableName: "interactions",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["actor_id", "target_id"],
      },
      {
        fields: ["target_id", "action"],
      },
    ],
  }
);

module.exports = Interaction;
