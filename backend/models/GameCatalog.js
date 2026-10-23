const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GameCatalog = sequelize.define(
  "GameCatalog",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    gameType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      field: "game_type",
    },
    displayName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "display_name",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
  },
  {
    tableName: "game_catalogs",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["game_type"],
      },
    ],
  }
);

module.exports = GameCatalog;
