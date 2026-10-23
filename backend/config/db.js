const { Sequelize } = require("sequelize");
require("dotenv").config();

const isTestEnv = process.env.NODE_ENV === "test";
const dbName = isTestEnv
  ? process.env.DB_TEST_NAME || "spark_test"
  : process.env.DB_NAME;

const sequelize = new Sequelize(
  dbName,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    dialect: "postgres",
    logging: false,
  }
);

module.exports = sequelize;