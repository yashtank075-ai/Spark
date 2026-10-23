const bcrypt = require("bcryptjs");
const { sequelize, StaffUser } = require("../models");
const adminMfaService = require("../services/adminMfaService");

/**
 * Development & Test Only Staff Seeder.
 * Never execute in production environments!
 */
async function seedAdminUsers() {
  if (process.env.NODE_ENV === "production") {
    console.error("CRITICAL ERROR: Seeder cannot be run in production!");
    process.exit(1);
  }

  await sequelize.authenticate();
  console.log("Database connected. Seeding development staff accounts...");

  const salt = await bcrypt.genSalt(10);
  const defaultPassword = process.env.DEV_ADMIN_PASSWORD || "AdminSecurePass!2026";
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  const staffAccounts = [
    {
      id: "99999999-9999-4999-8999-999999999991",
      email: "superadmin@spark.internal",
      passwordHash,
      firstName: "Super",
      lastName: "Admin",
      role: "super_admin",
      status: "active",
      mfaEnabled: true,
      mfaSecret: "JBSWY3DPEHPK3PXP", // standard RFC3548 Base32 test secret
    },
    {
      id: "99999999-9999-4999-8999-999999999992",
      email: "admin@spark.internal",
      passwordHash,
      firstName: "Test",
      lastName: "Admin",
      role: "admin",
      status: "active",
      mfaEnabled: true,
      mfaSecret: "JBSWY3DPEHPK3PXP",
    },
    {
      id: "99999999-9999-4999-8999-999999999993",
      email: "moderator@spark.internal",
      passwordHash,
      firstName: "Test",
      lastName: "Moderator",
      role: "moderator",
      status: "active",
      mfaEnabled: true,
      mfaSecret: "JBSWY3DPEHPK3PXP",
    },
    {
      id: "99999999-9999-4999-8999-999999999994",
      email: "nomfa@spark.internal",
      passwordHash,
      firstName: "No",
      lastName: "MFA",
      role: "admin",
      status: "active",
      mfaEnabled: false,
      mfaSecret: null,
    },
    {
      id: "99999999-9999-4999-8999-999999999995",
      email: "disabled@spark.internal",
      passwordHash,
      firstName: "Disabled",
      lastName: "Staff",
      role: "admin",
      status: "disabled",
      mfaEnabled: false,
      mfaSecret: null,
    },
    {
      id: "99999999-9999-4999-8999-999999999996",
      email: "locked@spark.internal",
      passwordHash,
      firstName: "Locked",
      lastName: "Staff",
      role: "admin",
      status: "locked",
      mfaEnabled: false,
      mfaSecret: null,
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000), // locked for 1 hour
    },
  ];

  for (const acc of staffAccounts) {
    const [user, created] = await StaffUser.findOrCreate({
      where: { email: acc.email },
      defaults: acc,
    });

    if (!created) {
      await user.update(acc);
      console.log(`Updated existing dev staff: ${acc.email} (${acc.role})`);
    } else {
      console.log(`Created dev staff: ${acc.email} (${acc.role})`);
    }
  }

  console.log("Admin development seeding complete.");
}

if (require.main === module) {
  seedAdminUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}

module.exports = { seedAdminUsers };
