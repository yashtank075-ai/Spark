const sequelize = require("../config/db");

async function checkDatabaseSchema() {
  try {
    await sequelize.authenticate();
    console.log("Database connection successful.");

    const [columns] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'profiles'
      ORDER BY ordinal_position;
    `);

    console.log("Profiles Table Columns Count:", columns.length);
    const verificationCols = columns.filter((c) =>
      [
        "is_verified",
        "verification_status",
        "verification_selfie_media_id",
        "verified_at",
        "verification_method",
      ].includes(c.column_name)
    );

    console.log("Verification Columns in DB:");
    console.table(verificationCols);

    process.exit(0);
  } catch (err) {
    console.error("Database schema check failed:", err);
    process.exit(1);
  }
}

checkDatabaseSchema();
