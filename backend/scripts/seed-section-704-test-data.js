
const { sequelize, User, Profile, ProfileMedia } = require("../models");

const TEST_DATABASE = "spark_test";

const users = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    phone: "+910000000001",
    dateOfBirth: "1998-05-15",
    gender: "male",
    displayName: "Test Alex",
    preferences: {
      min_age: 18,
      max_age: 100,
      max_distance_km: 50,
      interested_in_gender: "female",
    },
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    phone: "+910000000002",
    dateOfBirth: "2000-03-20",
    gender: "female",
    displayName: "Test Bella",
    preferences: {
      min_age: 18,
      max_age: 100,
      max_distance_km: 50,
      interested_in_gender: "male",
    },
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    phone: "+910000000003",
    dateOfBirth: "1996-08-10",
    gender: "female",
    displayName: "Test Chloe",
    preferences: {
      min_age: 18,
      max_age: 100,
      max_distance_km: 50,
      interested_in_gender: "male",
    },
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    phone: "+910000000004",
    dateOfBirth: "2002-01-12",
    gender: "female",
    displayName: "Test Diana",
    preferences: {
      min_age: 18,
      max_age: 100,
      max_distance_km: 50,
      interested_in_gender: "male",
    },
  },
];

async function seed() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Blocked: set NODE_ENV=test before seeding.");
  }

  await sequelize.authenticate();

  if (sequelize.config.database !== TEST_DATABASE) {
    throw new Error(
      `Blocked: expected database ${TEST_DATABASE}, got ${sequelize.config.database}`
    );
  }

  for (const item of users) {
    const [user] = await User.findOrCreate({
      where: { id: item.id },
      defaults: {
        id: item.id,
        phone: item.phone,
        dateOfBirth: item.dateOfBirth,
        ageEligible: true,
        verificationStatus: "approved",
        accountStatus: "active",
      },
    });

    // Fail rather than silently altering an existing account.
    if (
      user.phone !== item.phone ||
      user.accountStatus !== "active" ||
      !user.ageEligible
    ) {
      throw new Error(
        `Existing test user ${item.displayName} has unexpected values.`
      );
    }

    const [profile] = await Profile.findOrCreate({
      where: { userId: item.id },
      defaults: {
        userId: item.id,
        displayName: item.displayName,
        gender: item.gender,
        prompts: [
          { question: "My ideal weekend", answer: "Coffee and exploring new places" },
        ],
        preferences: item.preferences,
        boundaries: {},
        datingSpeed: "steady",
        datingIntention: "explore",
        onboardingStatus: "completed",
      },
    });

    // Refresh the known test profile fields for repeatable tests.
    await profile.update({
      displayName: item.displayName,
      gender: item.gender,
      preferences: item.preferences,
      onboardingStatus: "completed",
    });

    await ProfileMedia.findOrCreate({
      where: {
        userId: item.id,
        storageRef: `test-seed/${item.id}/approved-photo.jpg`,
      },
      defaults: {
        userId: item.id,
        mediaType: "photo",
        storageRef: `test-seed/${item.id}/approved-photo.jpg`,
        moderationStatus: "approved",
      },
    });

    console.log(`Prepared ${item.displayName}: ${profile.id}`);
  }

  console.log("\nSeed data prepared in spark_test.");
  console.log("No existing users or interactions were deleted.");
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });