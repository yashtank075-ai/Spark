const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Match = sequelize.define(
  "Match",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userAId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "user_a_id",
      references: {
        model: "users",
        key: "id",
      },
      onDelete: "CASCADE",
    },
    userBId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "user_b_id",
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
  },
  {
    tableName: "matches",
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ["user_a_id", "user_b_id"],
      },
      {
        fields: ["user_a_id"],
      },
      {
        fields: ["user_b_id"],
      },
    ],
  }
);

module.exports = Match;
