const { sequelize, User, Profile, ProfileMedia } = require("../models");

async function runBenchmark() {
  await sequelize.authenticate();
  console.log("PostgreSQL connected. Preparing 500 dummy records for query plan inspection...");

  const dummyUsers = [];
  const dummyProfiles = [];
  const dummyMedia = [];
  
  for (let i = 0; i < 500; i++) {
    const uid = "ffffffff-ffff-4fff-8fff-" + String(i).padStart(12, "0");
    const pid = "eeeeeeee-eeee-4eee-8eee-" + String(i).padStart(12, "0");
    const dobYear = 1990 + (i % 15);
    dummyUsers.push({
      id: uid,
      phone: "+91888" + String(i).padStart(7, "0"),
      dateOfBirth: dobYear + "-06-15",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });
    dummyProfiles.push({
      id: pid,
      userId: uid,
      displayName: "BenchUser" + i,
      gender: i % 2 === 0 ? "female" : "male",
      datingIntention: i % 3 === 0 ? "explore" : (i % 3 === 1 ? "vibe" : "intent"),
      datingSpeed: i % 2 === 0 ? "slow" : "moderate",
      onboardingStatus: "completed",
      location: { latitude: 12.97 + (i * 0.001), longitude: 77.59 + (i * 0.001) },
      preferences: { min_age: 18, max_age: 45, interested_in_gender: "everyone" },
    });
    dummyMedia.push({
      id: "dddddddd-dddd-4ddd-8ddd-" + String(i).padStart(12, "0"),
      userId: uid,
      mediaType: "photo",
      storageRef: "bench/" + i + ".jpg",
      moderationStatus: "approved",
    });
  }

  await User.bulkCreate(dummyUsers, { ignoreDuplicates: true });
  await Profile.bulkCreate(dummyProfiles, { ignoreDuplicates: true });
  await ProfileMedia.bulkCreate(dummyMedia, { ignoreDuplicates: true });

  console.log("Inserted test batch. Running EXPLAIN (ANALYZE, BUFFERS)...");

  const [explain] = await sequelize.query(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, user_id, display_name, gender, dating_intention, dating_speed
    FROM profiles
    WHERE onboarding_status = 'completed'
      AND gender ILIKE 'female'
      AND dating_intention ILIKE 'explore'
    ORDER BY id DESC
    LIMIT 30;
  `);

  console.log("=== EXPLAIN ANALYZE OUTPUT ===");
  console.log(explain.map((r) => r["QUERY PLAN"]).join("\n"));

  // Clean up
  const uids = dummyUsers.map((u) => u.id);
  await ProfileMedia.destroy({ where: { userId: uids } });
  await Profile.destroy({ where: { userId: uids } });
  await User.destroy({ where: { id: uids } });
  console.log("Benchmark and cleanup completed successfully.");
}

runBenchmark()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
