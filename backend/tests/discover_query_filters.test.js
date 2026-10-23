const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const sequelize = require("../config/db");
const discoverRoutes = require("../routes/discoverRoutes");
const {
  User,
  Profile,
  ProfileMedia,
  AuthSession,
  Interaction,
  Block,
  Match,
  Conversation,
} = require("../models");

function createToken(user, session) {
  return jwt.sign(
    { sessionId: session.id },
    process.env.JWT_ACCESS_SECRET,
    {
      subject: user.id,
      expiresIn: "1h",
      issuer: "spark-api",
      audience: "spark-mobile",
    }
  );
}

describe("Unified GET /api/v1/discover Query Parameter Filtering Suite", () => {
  let app;
  let meUser, meProfile, meSession, meToken;
  let candidates = [];

  beforeAll(async () => {
    const currentDb = sequelize.config.database;
    if (!currentDb || !currentDb.includes("test")) {
      throw new Error(`Destructive tests blocked! Attempted on ${currentDb}`);
    }

    await sequelize.authenticate();
    await sequelize.sync();

    app = express();
    app.use(express.json());
    app.use("/api/v1", discoverRoutes);
  });

  afterAll(async () => {
    await Interaction.destroy({ where: {}, force: true });
    await Block.destroy({ where: {}, force: true });
    await ProfileMedia.destroy({ where: {}, force: true });
    await Profile.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });
  });

  beforeEach(async () => {
    await Interaction.destroy({ where: {}, force: true });
    await Block.destroy({ where: {}, force: true });
    await ProfileMedia.destroy({ where: {}, force: true });
    await Profile.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    // Seed Authenticated User ("Me") - age 26, male, location in Indiranagar (12.9716, 77.5946)
    meUser = await User.create({
      phone: "+919999000000",
      dateOfBirth: "2000-01-01",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    meSession = await AuthSession.create({
      userId: meUser.id,
      refreshTokenHash: "hash_me_" + Date.now(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    meToken = createToken(meUser, meSession);

    meProfile = await Profile.create({
      userId: meUser.id,
      displayName: "Current Swiper",
      gender: "male",
      onboardingStatus: "completed",
      datingIntention: "explore",
      datingSpeed: "slow",
      location: {
        city: "Bengaluru",
        state: "Karnataka",
        country: "India",
        latitude: 12.9716,
        longitude: 77.5946,
      },
      preferences: {
        min_age: 20,
        max_age: 35,
        interested_in_gender: "female",
        max_distance_km: 50,
      },
    });

    // Helper to seed candidates easily
    // Candidate 1: Female, 24yo, Indiranagar (2 km away), explore, slow
    const c1User = await User.create({
      phone: "+919999000001",
      dateOfBirth: "2002-05-10",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });
    const c1Profile = await Profile.create({
      userId: c1User.id,
      displayName: "Aanya",
      gender: "female",
      onboardingStatus: "completed",
      datingIntention: "explore",
      datingSpeed: "slow",
      location: { latitude: 12.9750, longitude: 77.6000, city: "Bengaluru" },
      preferences: { min_age: 20, max_age: 35, interested_in_gender: "male" },
    });
    await ProfileMedia.create({
      userId: c1User.id,
      mediaType: "photo",
      storageRef: "uploads/aanya.jpg",
      moderationStatus: "approved",
    });

    // Candidate 2: Female, 28yo, Koramangala (6 km away), vibe, moderate
    const c2User = await User.create({
      phone: "+919999000002",
      dateOfBirth: "1998-08-15",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });
    const c2Profile = await Profile.create({
      userId: c2User.id,
      displayName: "Bhavna",
      gender: "female",
      onboardingStatus: "completed",
      datingIntention: "vibe",
      datingSpeed: "moderate",
      location: { latitude: 12.9352, longitude: 77.6245, city: "Bengaluru" },
      preferences: { min_age: 22, max_age: 32, interested_in_gender: "male" },
    });
    await ProfileMedia.create({
      userId: c2User.id,
      mediaType: "photo",
      storageRef: "uploads/bhavna.jpg",
      moderationStatus: "approved",
    });

    // Candidate 3: Female, 32yo, Whitefield (18 km away), intent, fast
    const c3User = await User.create({
      phone: "+919999000003",
      dateOfBirth: "1994-03-20",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });
    const c3Profile = await Profile.create({
      userId: c3User.id,
      displayName: "Chitrangada",
      gender: "female",
      onboardingStatus: "completed",
      datingIntention: "intent",
      datingSpeed: "fast",
      location: { latitude: 12.9698, longitude: 77.7500, city: "Bengaluru" },
      preferences: { min_age: 24, max_age: 38, interested_in_gender: "male" },
    });
    await ProfileMedia.create({
      userId: c3User.id,
      mediaType: "photo",
      storageRef: "uploads/chitrangada.jpg",
      moderationStatus: "approved",
    });

    // Candidate 4: Male, 25yo, Indiranagar (same city), explore, steady
    const c4User = await User.create({
      phone: "+919999000004",
      dateOfBirth: "2001-02-12",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });
    const c4Profile = await Profile.create({
      userId: c4User.id,
      displayName: "Dev",
      gender: "male",
      onboardingStatus: "completed",
      datingIntention: "explore",
      datingSpeed: "steady",
      location: { latitude: 12.9716, longitude: 77.5946, city: "Bengaluru" },
      preferences: { min_age: 20, max_age: 35, interested_in_gender: "everyone" },
    });
    await ProfileMedia.create({
      userId: c4User.id,
      mediaType: "photo",
      storageRef: "uploads/dev.jpg",
      moderationStatus: "approved",
    });

    // Candidate 5: Female, Mysore (140 km away)
    const c5User = await User.create({
      phone: "+919999000005",
      dateOfBirth: "2000-07-07",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });
    const c5Profile = await Profile.create({
      userId: c5User.id,
      displayName: "Farah (Mysore)",
      gender: "female",
      onboardingStatus: "completed",
      datingIntention: "explore",
      datingSpeed: "slow",
      location: { latitude: 12.2958, longitude: 76.6394, city: "Mysuru" },
      preferences: { min_age: 20, max_age: 35, interested_in_gender: "male" },
    });
    await ProfileMedia.create({
      userId: c5User.id,
      mediaType: "photo",
      storageRef: "uploads/farah.jpg",
      moderationStatus: "approved",
    });

    candidates = [
      { user: c1User, profile: c1Profile },
      { user: c2User, profile: c2Profile },
      { user: c3User, profile: c3Profile },
      { user: c4User, profile: c4Profile },
      { user: c5User, profile: c5Profile },
    ];
  });

  // 1. Saved Preference Fallback (No Query Parameters)
  describe("1. Saved preference fallback", () => {
    it("should use saved preferences when query parameters are absent", async () => {
      // Saved prefs: female only, min_age 20, max_age 35, distance <= 50km
      // Should match Aanya, Bhavna, Chitrangada (Farah is 140km away, Dev is male)
      const res = await request(app)
        .get("/api/v1/discover")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const names = res.body.data.map((p) => p.display_name);
      expect(names).toContain("Aanya");
      expect(names).toContain("Bhavna");
      expect(names).toContain("Chitrangada");
      expect(names).not.toContain("Dev");
      expect(names).not.toContain("Farah (Mysore)");
    });
  });

  // 2. Query Parameter Overrides
  describe("2. Query parameter overrides", () => {
    it("should override interested_in_gender to male", async () => {
      const res = await request(app)
        .get("/api/v1/discover?interested_in_gender=male")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      const names = res.body.data.map((p) => p.display_name);
      expect(names).toEqual(["Dev"]);
    });

    it("should override min_age and max_age dynamically", async () => {
      // Filter age 27 to 30: only Bhavna (28) matches
      const res = await request(app)
        .get("/api/v1/discover?min_age=27&max_age=30")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].display_name).toBe("Bhavna");
    });

    it("should filter by max_distance_km strictly", async () => {
      // Distance <= 5km: only Aanya (~2km) matches; Bhavna is ~6km, Chitrangada is ~18km
      const res = await request(app)
        .get("/api/v1/discover?max_distance_km=5")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      const names = res.body.data.map((p) => p.display_name);
      expect(names).toContain("Aanya");
      expect(names).not.toContain("Bhavna");
      expect(names).not.toContain("Chitrangada");
    });

    it("should filter by dating_intention", async () => {
      const res = await request(app)
        .get("/api/v1/discover?dating_intention=intent")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      const names = res.body.data.map((p) => p.display_name);
      expect(names).toContain("Chitrangada");
      expect(names).not.toContain("Aanya");
      expect(names).not.toContain("Bhavna");
    });

    it("should filter by dating_speed and support both 'slow' and legacy 'steady'", async () => {
      // Filter for speed 'slow'
      const resSlow = await request(app)
        .get("/api/v1/discover?dating_speed=slow")
        .set("Authorization", `Bearer ${meToken}`);

      expect(resSlow.status).toBe(200);
      const slowNames = resSlow.body.data.map((p) => p.display_name);
      expect(slowNames).toContain("Aanya");

      // Filter for speed 'moderate'
      const resMod = await request(app)
        .get("/api/v1/discover?dating_speed=moderate")
        .set("Authorization", `Bearer ${meToken}`);

      expect(resMod.status).toBe(200);
      const modNames = resMod.body.data.map((p) => p.display_name);
      expect(modNames).toContain("Bhavna");
    });

    it("should combine multiple filters seamlessly", async () => {
      // Multi-filter: female, age 22-30, distance <= 10km, dating_intention=vibe
      const res = await request(app)
        .get("/api/v1/discover?interested_in_gender=female&min_age=22&max_age=30&max_distance_km=10&dating_intention=vibe")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].display_name).toBe("Bhavna");
    });

    it("should not persist query filters to user's saved preferences", async () => {
      await request(app)
        .get("/api/v1/discover?min_age=29&max_age=35")
        .set("Authorization", `Bearer ${meToken}`);

      const refreshedProfile = await Profile.findByPk(meProfile.id);
      expect(refreshedProfile.preferences.min_age).toBe(20);
      expect(refreshedProfile.preferences.max_age).toBe(35);
    });
  });

  // 3. Centralized Validation and Error Handling
  describe("3. Centralized validation and error handling", () => {
    it("should reject invalid min_age with 422", async () => {
      const res = await request(app)
        .get("/api/v1/discover?min_age=16")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.min_age).toBeDefined();
    });

    it("should reject min_age greater than max_age with 422", async () => {
      const res = await request(app)
        .get("/api/v1/discover?min_age=35&max_age=22")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.age_range).toBeDefined();
    });

    it("should reject invalid max_distance_km with 422", async () => {
      const res = await request(app)
        .get("/api/v1/discover?max_distance_km=-5")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.max_distance_km).toBeDefined();
    });

    it("should reject unsupported gender with 422", async () => {
      const res = await request(app)
        .get("/api/v1/discover?interested_in_gender=martian")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.interested_in_gender).toBeDefined();
    });

    it("should reject unsupported dating_intention with 422", async () => {
      const res = await request(app)
        .get("/api/v1/discover?dating_intention=marriage_now")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.dating_intention).toBeDefined();
    });

    it("should reject unsupported dating_speed with 422", async () => {
      const res = await request(app)
        .get("/api/v1/discover?dating_speed=hyper_speed")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.dating_speed).toBeDefined();
    });
  });

  // 4. Pagination & Cursor Compatibility
  describe("4. Pagination & Cursor compatibility", () => {
    it("should paginate deterministically with limit=1", async () => {
      const page1 = await request(app)
        .get("/api/v1/discover?limit=1")
        .set("Authorization", `Bearer ${meToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(1);
      expect(page1.body.pagination.has_more).toBe(true);
      expect(page1.body.pagination.next_cursor).toBeTruthy();

      const nextCursor = page1.body.pagination.next_cursor;

      const page2 = await request(app)
        .get(`/api/v1/discover?limit=1&cursor=${nextCursor}`)
        .set("Authorization", `Bearer ${meToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(1);
      // Ensure no duplicates across pages
      expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
    });

    it("should reject cursor when filters change between pages with 400 INCOMPATIBLE_CURSOR", async () => {
      const page1 = await request(app)
        .get("/api/v1/discover?min_age=20&max_age=30&limit=1")
        .set("Authorization", `Bearer ${meToken}`);

      const nextCursor = page1.body.pagination.next_cursor;
      expect(nextCursor).toBeTruthy();

      // Change filter on page 2
      const page2 = await request(app)
        .get(`/api/v1/discover?min_age=30&max_age=40&limit=1&cursor=${nextCursor}`)
        .set("Authorization", `Bearer ${meToken}`);

      expect(page2.status).toBe(400);
      expect(page2.body.code).toBe("INCOMPATIBLE_CURSOR");
    });

    it("should reject malformed or tampered cursor with 400 INVALID_CURSOR", async () => {
      const res = await request(app)
        .get("/api/v1/discover?cursor=bad-opaque-cursor-123")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
    });

    it("should return an opaque cursor starting with dc_ and not leak internal profile IDs or JSON", async () => {
      const page1 = await request(app)
        .get("/api/v1/discover?limit=1")
        .set("Authorization", `Bearer ${meToken}`);

      const cursor = page1.body.pagination.next_cursor;
      expect(cursor).toBeTruthy();
      expect(cursor.startsWith("dc_")).toBe(true);

      // Verify that decoding raw base64url doesn't produce JSON or exposed UUIDs
      const decodedRaw = Buffer.from(cursor.slice(3), "base64url").toString("utf8");
      let parsedAsJson = false;
      try {
        const obj = JSON.parse(decodedRaw);
        if (typeof obj === "object" && obj !== null) parsedAsJson = true;
      } catch (e) {
        parsedAsJson = false;
      }
      expect(parsedAsJson).toBe(false);
      expect(decodedRaw).not.toContain(candidates[0].profile.id);
      expect(decodedRaw).not.toContain(meUser.id);
    });

    it("should reject a tampered ciphertext or modified authentication tag with 400 INVALID_CURSOR", async () => {
      const page1 = await request(app)
        .get("/api/v1/discover?limit=1")
        .set("Authorization", `Bearer ${meToken}`);

      const originalCursor = page1.body.pagination.next_cursor;
      // Tamper with the base64 characters
      const tampered = originalCursor.slice(0, -4) + "X9Z1";

      const res = await request(app)
        .get(`/api/v1/discover?cursor=${tampered}`)
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
    });

    it("should reject cursor when reused by a different user (cross-user isolation)", async () => {
      const page1 = await request(app)
        .get("/api/v1/discover?limit=1")
        .set("Authorization", `Bearer ${meToken}`);

      const nextCursor = page1.body.pagination.next_cursor;
      expect(nextCursor).toBeTruthy();

      // Create a second authenticated user token with unique phone
      const uniquePhone = "+919" + String(Date.now()).slice(-9);
      const otherUser = await User.create({
        phone: uniquePhone,
        dateOfBirth: "1996-01-01",
        ageEligible: true,
        accountStatus: "active",
        verificationStatus: "approved",
      });
      const otherProfile = await Profile.create({
        userId: otherUser.id,
        displayName: "Other User",
        gender: "male",
        onboardingStatus: "completed",
        datingIntention: "explore",
        datingSpeed: "slow",
        location: { latitude: 12.9716, longitude: 77.5946, city: "Bengaluru" },
        preferences: { min_age: 18, max_age: 40, interested_in_gender: "female", max_distance_km: 50 },
      });
      const otherSession = await AuthSession.create({
        userId: otherUser.id,
        refreshTokenHash: "other_hash_" + Date.now(),
        expiresAt: new Date(Date.now() + 86400000),
      });
      const otherToken = createToken(otherUser, otherSession);

      // Attempt to use user 1's cursor with user 2's token
      const crossUserRes = await request(app)
        .get(`/api/v1/discover?limit=1&cursor=${nextCursor}`)
        .set("Authorization", `Bearer ${otherToken}`);

      expect(crossUserRes.status).toBe(400);
      expect(crossUserRes.body.code).toBe("INVALID_CURSOR");
    });

    it("should reject an expired cursor with 400 EXPIRED_CURSOR", async () => {
      const { generateCursor } = require("../services/cursorService");

      // Generate a cursor with ttlSeconds = -10 (already expired)
      const expiredCursor = generateCursor({
        userId: meUser.id,
        profileId: candidates[0].profile.id,
        filterSignature: "dummy_sig",
        ttlSeconds: -10,
      });

      const res = await request(app)
        .get(`/api/v1/discover?cursor=${expiredCursor}`)
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("EXPIRED_CURSOR");
      expect(res.body.message).toContain("expired");
    });
  });

  // 5. Privacy, Blocks, Interactions & Empty States
  describe("5. Privacy, Blocks, Interactions & Edge Cases", () => {
    it("should exclude already liked profiles", async () => {
      await Interaction.create({
        actorId: meUser.id,
        targetId: candidates[0].user.id, // Aanya
        action: "like",
      });

      const res = await request(app)
        .get("/api/v1/discover")
        .set("Authorization", `Bearer ${meToken}`);

      const names = res.body.data.map((p) => p.display_name);
      expect(names).not.toContain("Aanya");
    });

    it("should exclude already passed profiles", async () => {
      await Interaction.create({
        actorId: meUser.id,
        targetId: candidates[1].user.id, // Bhavna
        action: "pass",
      });

      const res = await request(app)
        .get("/api/v1/discover")
        .set("Authorization", `Bearer ${meToken}`);

      const names = res.body.data.map((p) => p.display_name);
      expect(names).not.toContain("Bhavna");
    });

    it("should return empty list when no profiles match filters", async () => {
      const res = await request(app)
        .get("/api/v1/discover?min_age=50&max_age=60")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.has_more).toBe(false);
      expect(res.body.pagination.count).toBe(0);
    });

    it("should never expose exact coordinates, phone, or DOB in response", async () => {
      const res = await request(app)
        .get("/api/v1/discover")
        .set("Authorization", `Bearer ${meToken}`);

      expect(res.status).toBe(200);
      for (const card of res.body.data) {
        expect(card.date_of_birth).toBeUndefined();
        expect(card.phone).toBeUndefined();
        if (card.location) {
          expect(card.location.latitude).toBeUndefined();
          expect(card.location.longitude).toBeUndefined();
        }
      }
    });
  });
});
