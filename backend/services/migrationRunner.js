const fs = require("fs");
const path = require("path");
const { DataTypes } = require("sequelize");
const defaultSequelize = require("../config/db");

function getMigrationMetaModel(sequelizeInstance) {
  return sequelizeInstance.define(
    "MigrationMeta",
    {
      name: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      executedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        field: "executed_at",
      },
    },
    {
      tableName: "sequelize_migrations_meta",
      timestamps: false,
      underscored: true,
    },
  );
}

async function runMigrations(sequelizeInstance = defaultSequelize) {
  await sequelizeInstance.authenticate();
  const MigrationMeta = getMigrationMetaModel(sequelizeInstance);
  await MigrationMeta.sync();

  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".js"))
    .sort();

  const executed = await MigrationMeta.findAll({
    attributes: ["name"],
  });
  const executedSet = new Set(executed.map((m) => m.name));

  const queryInterface = sequelizeInstance.getQueryInterface();

  for (const file of files) {
    if (!executedSet.has(file)) {
      console.log(`Applying migration: ${file}...`);
      const migration = require(path.join(migrationsDir, file));
      await migration.up(queryInterface, sequelizeInstance);
      await MigrationMeta.create({ name: file });
      console.log(`Successfully applied: ${file}`);
    } else {
      console.log(`Skipping already executed migration: ${file}`);
    }
  }
}

async function rollbackLastMigration(sequelizeInstance = defaultSequelize) {
  await sequelizeInstance.authenticate();
  const MigrationMeta = getMigrationMetaModel(sequelizeInstance);
  await MigrationMeta.sync();

  const latest = await MigrationMeta.findOne({
    order: [["executed_at", "DESC"]],
  });

  if (!latest) {
    console.log("No migrations to rollback.");
    return null;
  }

  const migrationsDir = path.join(__dirname, "..", "migrations");
  const migration = require(path.join(migrationsDir, latest.name));
  const queryInterface = sequelizeInstance.getQueryInterface();

  console.log(`Rolling back migration: ${latest.name}...`);
  await migration.down(queryInterface, sequelizeInstance);
  await latest.destroy();
  console.log(`Successfully rolled back: ${latest.name}`);
  return latest.name;
}

if (require.main === module) {
  const command = process.argv[2] || "up";
  if (command === "up") {
    runMigrations()
      .then(() => {
        console.log("All migrations up to date.");
        process.exit(0);
      })
      .catch((err) => {
        console.error("Migration failed:", err);
        process.exit(1);
      });
  } else if (command === "down") {
    rollbackLastMigration()
      .then(() => {
        console.log("Rollback complete.");
        process.exit(0);
      })
      .catch((err) => {
        console.error("Rollback failed:", err);
        process.exit(1);
      });
  }
}

module.exports = {
  runMigrations,
  rollbackLastMigration,
  getMigrationMetaModel,
};
