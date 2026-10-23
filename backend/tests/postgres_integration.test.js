const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const sequelize = require("../config/db");
const discoverRoutes = require("../routes/discoverRoutes");
const rushRoutes = require("../routes/rushRoutes");
const {
  User,
  Profile,
  ProfileMedia,
  AuthSession,
  Interaction,
  Match,
  Conversation,
  Message,
  RushSession,
  Block,
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

// Real PostgreSQL Test Suite
describe("Section 7.04 Real PostgreSQL Concurrency & Constraint Integration Suite", () => {
  let app;
  let testUser1, testUser2, testUser3;
  let testProfile1, testProfile2, testProfile3;
  let session1, session2, session3;
  let token1, token2, token3;

  let originalStorageProvider;

  beforeAll(async () => {
    originalStorageProvider = process.env.STORAGE_PROVIDER;
    process.env.STORAGE_PROVIDER = "local";

    // Safety check: ensure tests ONLY run against the dedicated test database
    const currentDb = sequelize.config.database;
    if (!currentDb || !currentDb.includes("test")) {
      throw new Error(
        `Destructive tests blocked! Attempted to run against database "${currentDb}". Tests must only run against an isolated test database (e.g. spark_test).`
      );
    }

    await sequelize.authenticate();
    // Synchronize models on the isolated test database
    await sequelize.sync();

    const matchRoutes = require("../routes/matchRoutes");
    const conversationRoutes = require("../routes/conversationRoutes");
    app = express();
    app.use(express.json());
    app.use("/api/v1", discoverRoutes);
    app.use("/api/v1/rush", rushRoutes);
    app.use("/api/v1", matchRoutes);
    app.use("/api/v1", conversationRoutes);
  });

  afterAll(async () => {
    process.env.STORAGE_PROVIDER = originalStorageProvider;
  });

  beforeEach(async () => {
    // Clean up test tables in correct dependency order
    await Message.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await Interaction.destroy({ where: {}, force: true });
    await Match.destroy({ where: {}, force: true });
    await RushSession.destroy({ where: {}, force: true });
    await Block.destroy({ where: {}, force: true });
    await ProfileMedia.destroy({ where: {}, force: true });
    await Profile.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    // Seed 3 active, eligible adult test users
    testUser1 = await User.create({
      phone: "+19991110001",
      dateOfBirth: "1995-06-15",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    testUser2 = await User.create({
      phone: "+19991110002",
      dateOfBirth: "1997-08-20",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    testUser3 = await User.create({
      phone: "+19991110003",
      dateOfBirth: "1994-03-10",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    // Seed AuthSessions
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    session1 = await AuthSession.create({
      userId: testUser1.id,
      refreshTokenHash: "hash1_" + Date.now(),
      expiresAt: future,
    });
    session2 = await AuthSession.create({
      userId: testUser2.id,
      refreshTokenHash: "hash2_" + Date.now(),
      expiresAt: future,
    });
    session3 = await AuthSession.create({
      userId: testUser3.id,
      refreshTokenHash: "hash3_" + Date.now(),
      expiresAt: future,
    });

    token1 = createToken(testUser1, session1);
    token2 = createToken(testUser2, session2);
    token3 = createToken(testUser3, session3);

    // Seed their completed onboarding profiles
    testProfile1 = await Profile.create({
      userId: testUser1.id,
      displayName: "User One",
      gender: "male",
      onboardingStatus: "completed",
      datingIntention: "vibe",
      preferences: {
        min_age: 18,
        max_age: 40,
        interested_in_gender: "everyone",
        max_distance_km: 50,
      },
    });

    testProfile2 = await Profile.create({
      userId: testUser2.id,
      displayName: "User Two",
      gender: "female",
      onboardingStatus: "completed",
      datingIntention: "vibe",
      preferences: {
        min_age: 18,
        max_age: 40,
        interested_in_gender: "everyone",
        max_distance_km: 50,
      },
    });

    testProfile3 = await Profile.create({
      userId: testUser3.id,
      displayName: "User Three",
      gender: "female",
      onboardingStatus: "completed",
      datingIntention: "intent",
      preferences: {
        min_age: 18,
        max_age: 40,
        interested_in_gender: "male",
        max_distance_km: 50,
      },
    });

    // Seed an approved photo for User 2 so User 2 appears in Discover
    await ProfileMedia.create({
      userId: testUser2.id,
      mediaType: "photo",
      storageRef: "uploads/real_test_photo_2.jpg",
      moderationStatus: "approved",
    });
  });

  afterAll(async () => {
    // Final cleanup of test data
    await Interaction.destroy({ where: {}, force: true });
    await Match.destroy({ where: {}, force: true });
    await RushSession.destroy({ where: {}, force: true });
    await Block.destroy({ where: {}, force: true });
    await ProfileMedia.destroy({ where: {}, force: true });
    await Profile.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });
  });

  describe("1. Real PostgreSQL Concurrency: Simultaneous Reciprocal Likes", () => {
    it("should create exactly one canonical match when User 1 and User 2 like each other simultaneously", async () => {
      // Execute simultaneous like requests with real JWT tokens and real DB transactions
      const promise1 = request(app)
        .post(`/api/v1/profiles/${testProfile2.id}/like`)
        .set("Authorization", `Bearer ${token1}`);

      const promise2 = request(app)
        .post(`/api/v1/profiles/${testProfile1.id}/like`)
        .set("Authorization", `Bearer ${token2}`);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);

      // Verify at least one reported matched: true
      const matchesReported = (res1.body.data.matched ? 1 : 0) + (res2.body.data.matched ? 1 : 0);
      expect(matchesReported).toBeGreaterThanOrEqual(1);

      // Verify in PostgreSQL table: exactly 1 match record exists
      const matchesInDb = await Match.findAll({
        where: { status: "active" },
      });
      expect(matchesInDb.length).toBe(1);

      const canonicalUserA = testUser1.id < testUser2.id ? testUser1.id : testUser2.id;
      const canonicalUserB = testUser1.id < testUser2.id ? testUser2.id : testUser1.id;
      expect(matchesInDb[0].userAId).toBe(canonicalUserA);
      expect(matchesInDb[0].userBId).toBe(canonicalUserB);
    });
  });

  describe("2. Real PostgreSQL Concurrency: Simultaneous Rush Activations", () => {
    it("should allow only one activation and reject the other with 409 conflict under concurrent execution", async () => {
      // Fire 3 simultaneous activation requests for testUser1
      const req1 = request(app)
        .post("/api/v1/rush/activate")
        .set("Authorization", `Bearer ${token1}`);
      const req2 = request(app)
        .post("/api/v1/rush/activate")
        .set("Authorization", `Bearer ${token1}`);
      const req3 = request(app)
        .post("/api/v1/rush/activate")
        .set("Authorization", `Bearer ${token1}`);

      const [r1, r2, r3] = await Promise.all([req1, req2, req3]);
      const statuses = [r1.status, r2.status, r3.status];

      // Exactly one should succeed with 201, while others must fail with 409
      const successCount = statuses.filter((s) => s === 201).length;
      const conflictCount = statuses.filter((s) => s === 409).length;

      expect(successCount).toBe(1);
      expect(conflictCount).toBe(2);

      // Verify in PostgreSQL table: exactly 1 session exists for testUser1
      const sessionsInDb = await RushSession.findAll({
        where: { userId: testUser1.id },
      });
      expect(sessionsInDb.length).toBe(1);
      expect(sessionsInDb[0].eligibilityDay).toBeDefined();
    });
  });

  describe("3. Real PostgreSQL Integrity: Interaction Conflict & Idempotency", () => {
    it("should handle like followed by pass deterministically without duplicate rows", async () => {
      // First: User 1 passes User 2
      const passRes = await request(app)
        .post(`/api/v1/profiles/${testProfile2.id}/pass`)
        .set("Authorization", `Bearer ${token1}`);

      expect(passRes.status).toBe(200);
      expect(passRes.body.data.action).toBe("pass");

      // Verify interaction row in PostgreSQL
      let interactions = await Interaction.findAll({
        where: { actorId: testUser1.id, targetId: testUser2.id },
      });
      expect(interactions.length).toBe(1);
      expect(interactions[0].action).toBe("pass");

      // Second: User 1 subsequently likes User 2
      const likeRes = await request(app)
        .post(`/api/v1/profiles/${testProfile2.id}/like`)
        .set("Authorization", `Bearer ${token1}`);

      expect(likeRes.status).toBe(200);
      expect(likeRes.body.data.action).toBe("like");

      // Verify interaction row updated in PostgreSQL, still exactly 1 row
      interactions = await Interaction.findAll({
        where: { actorId: testUser1.id, targetId: testUser2.id },
      });
      expect(interactions.length).toBe(1);
      expect(interactions[0].action).toBe("like");
    });
  });

  describe("4. Real PostgreSQL Discovery Deck, Pagination & Privacy", () => {
    it("should return eligible profiles in Discover and never expose sensitive attributes", async () => {
      const res = await request(app)
        .get("/api/v1/discover?limit=5")
        .set("Authorization", `Bearer ${token1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1); // User 2 has approved photo

      const card = res.body.data[0];
      expect(card.id).toBe(testProfile2.id);
      expect(card.display_name).toBe("User Two");
      expect(card.age).toBeDefined();
      expect(card.media.length).toBe(1);

      // Verify strict privacy: sensitive fields must not be present
      expect(card.date_of_birth).toBeUndefined();
      expect(card.phone).toBeUndefined();
      expect(card.access_token).toBeUndefined();
      expect(card.refresh_token).toBeUndefined();
      expect(card.storage_ref).toBeUndefined();
    });

    it("should exclude profiles blocked by or blocking the current user", async () => {
      // User 2 blocks User 1
      await Block.create({
        blockerId: testUser2.id,
        blockedId: testUser1.id,
      });

      const res = await request(app)
        .get("/api/v1/discover")
        .set("Authorization", `Bearer ${token1}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0); // Excluded due to block
    });
  });

  describe("5. Section 7.05 Real PostgreSQL Matches Listing and Unmatch APIs", () => {
    it("should list active matches in real PostgreSQL and successfully unmatch using transaction", async () => {
      // Create canonical match between testUser1 and testUser2
      const canonicalUserA = testUser1.id < testUser2.id ? testUser1.id : testUser2.id;
      const canonicalUserB = testUser1.id < testUser2.id ? testUser2.id : testUser1.id;

      const match = await Match.create({
        userAId: canonicalUserA,
        userBId: canonicalUserB,
        status: "active",
      });

      // 1. GET /api/v1/matches for testUser1
      const listRes = await request(app)
        .get("/api/v1/matches")
        .set("Authorization", `Bearer ${token1}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.success).toBe(true);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].id).toBe(match.id);
      expect(listRes.body.data[0].user.user_id).toBe(testUser2.id);
      expect(listRes.body.data[0].user.date_of_birth).toBeUndefined();
      expect(listRes.body.data[0].user.phone).toBeUndefined();

      // 2. Unrelated user (testUser3) attempting to unmatch should get 403
      const forbiddenRes = await request(app)
        .delete(`/api/v1/matches/${match.id}`)
        .set("Authorization", `Bearer ${token3}`);

      expect(forbiddenRes.status).toBe(403);
      expect(forbiddenRes.body.success).toBe(false);

      // 3. Authorized participant (testUser1) unmatching should succeed
      const unmatchRes = await request(app)
        .delete(`/api/v1/matches/${match.id}`)
        .set("Authorization", `Bearer ${token1}`);

      expect(unmatchRes.status).toBe(200);
      expect(unmatchRes.body.success).toBe(true);
      expect(unmatchRes.body.data.status).toBe("unmatched");

      // Verify row in PostgreSQL has status 'unmatched'
      await match.reload();
      expect(match.status).toBe("unmatched");

      // 4. Listing again should return 0 active matches
      const reListRes = await request(app)
        .get("/api/v1/matches")
        .set("Authorization", `Bearer ${token1}`);

      expect(reListRes.status).toBe(200);
      expect(reListRes.body.data.length).toBe(0);
    });
  });

  describe("6. Section 7.05 Phase 2 Real PostgreSQL Conversations & Messaging Lifecycle", () => {
    it("should manage complete conversation lifecycle: list, send, read receipt, and unmatch cutoff", async () => {
      const canonicalUserA = testUser1.id < testUser2.id ? testUser1.id : testUser2.id;
      const canonicalUserB = testUser1.id < testUser2.id ? testUser2.id : testUser1.id;

      const match = await Match.create({
        userAId: canonicalUserA,
        userBId: canonicalUserB,
        status: "active",
      });

      // 1. GET /api/v1/conversations creates conversation on demand if not present and returns it
      const convListRes = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${token1}`);

      expect(convListRes.status).toBe(200);
      expect(convListRes.body.data.length).toBe(1);
      const convId = convListRes.body.data[0].id;
      expect(convListRes.body.data[0].match_id).toBe(match.id);
      expect(convListRes.body.data[0].unread_count).toBe(0);

      // 2. User 1 sends message to User 2
      const sendRes = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ content: "Hello from real PostgreSQL test!" });

      expect(sendRes.status).toBe(201);
      expect(sendRes.body.success).toBe(true);
      expect(sendRes.body.data.content).toBe("Hello from real PostgreSQL test!");
      expect(sendRes.body.data.is_read).toBe(false);

      // 3. User 2 checks conversations: unread_count should be 1
      const convListUser2 = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${token2}`);

      expect(convListUser2.status).toBe(200);
      expect(convListUser2.body.data[0].unread_count).toBe(1);
      expect(convListUser2.body.data[0].latest_message.content).toBe("Hello from real PostgreSQL test!");

      // 4. User 2 reads message history
      const historyRes = await request(app)
        .get(`/api/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${token2}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data.length).toBe(1);
      expect(historyRes.body.data[0].content).toBe("Hello from real PostgreSQL test!");

      // 5. User 2 marks as read
      const readRes = await request(app)
        .post(`/api/v1/conversations/${convId}/read`)
        .set("Authorization", `Bearer ${token2}`);

      expect(readRes.status).toBe(200);
      expect(readRes.body.data.messages_marked_read).toBe(1);

      // 6. User 3 (unrelated) attempts to send message: should receive 403
      const forbiddenSend = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${token3}`)
        .send({ content: "Unauthorized message" });

      expect(forbiddenSend.status).toBe(403);

      // 7. User 1 unmatches
      const unmatchRes = await request(app)
        .delete(`/api/v1/matches/${match.id}`)
        .set("Authorization", `Bearer ${token1}`);

      expect(unmatchRes.status).toBe(200);

      // 8. Further messages on unmatched conversation MUST be rejected with 400
      const blockedSend = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${token1}`)
        .send({ content: "Post-unmatch message attempt" });

      expect(blockedSend.status).toBe(400);
      expect(blockedSend.body.code).toBe("MATCH_UNMATCHED");
    });

    it("should handle voice messaging and goodbye termination in real PostgreSQL", async () => {
      const canonicalUserA = testUser1.id < testUser2.id ? testUser1.id : testUser2.id;
      const canonicalUserB = testUser1.id < testUser2.id ? testUser2.id : testUser1.id;

      const match = await Match.create({
        userAId: canonicalUserA,
        userBId: canonicalUserB,
        status: "active",
      });

      const conv = await Conversation.create({
        matchId: match.id,
      });

      // 1. User 1 sends a voice message with audio attachment
      const voiceRes = await request(app)
        .post(`/api/v1/conversations/${conv.id}/voice`)
        .set("Authorization", `Bearer ${token1}`)
        .field("duration", "18")
        .field("content", "Listening to live jazz!")
        .attach("audio", Buffer.from("simulated audio bytes for postgres test"), {
          filename: "test_voice.mp3",
          contentType: "audio/mpeg",
        });

      expect(voiceRes.status).toBe(201);
      expect(voiceRes.body.success).toBe(true);
      expect(voiceRes.body.data.message_type).toBe("voice");
      expect(voiceRes.body.data.duration).toBe(18);
      expect(voiceRes.body.data.audio_url).toBeDefined();

      // Verify row in real PostgreSQL
      const persistedMsg = await Message.findByPk(voiceRes.body.data.id);
      expect(persistedMsg).not.toBeNull();
      expect(persistedMsg.messageType).toBe("voice");
      expect(persistedMsg.mediaUrl).toMatch(/\.mp3$/);

      // 2. User 2 views message history, voice note appears correctly
      const historyRes = await request(app)
        .get(`/api/v1/conversations/${conv.id}/messages`)
        .set("Authorization", `Bearer ${token2}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data.length).toBe(1);
      expect(historyRes.body.data[0].message_type).toBe("voice");
      expect(historyRes.body.data[0].audio_url).toBeDefined();
      expect(historyRes.body.data[0].duration).toBe(18);

      // 3. User 2 ends conversation via goodbye API
      const goodbyeRes = await request(app)
        .post(`/api/v1/conversations/${conv.id}/goodbye`)
        .set("Authorization", `Bearer ${token2}`);

      expect(goodbyeRes.status).toBe(200);
      expect(goodbyeRes.body.success).toBe(true);
      expect(goodbyeRes.body.data.match_status).toBe("unmatched");

      // Verify Match status is unmatched in PostgreSQL
      await match.reload();
      expect(match.status).toBe("unmatched");

      // 4. Calling goodbye again is idempotent (200)
      const repeatGoodbye = await request(app)
        .post(`/api/v1/conversations/${conv.id}/goodbye`)
        .set("Authorization", `Bearer ${token1}`);

      expect(repeatGoodbye.status).toBe(200);
      expect(repeatGoodbye.body.message).toContain("already ended");

      // 5. Sending voice message after goodbye is blocked with 400
      const blockedVoice = await request(app)
        .post(`/api/v1/conversations/${conv.id}/voice`)
        .set("Authorization", `Bearer ${token1}`)
        .attach("audio", Buffer.from("audio"), {
          filename: "late.mp3",
          contentType: "audio/mpeg",
        });

      expect(blockedVoice.status).toBe(400);
      expect(blockedVoice.body.code).toBe("MATCH_UNMATCHED");

      // 6. Message history is preserved despite ending conversation
      const preservedHistory = await request(app)
        .get(`/api/v1/conversations/${conv.id}/messages`)
        .set("Authorization", `Bearer ${token1}`);

      expect(preservedHistory.status).toBe(200);
      expect(preservedHistory.body.data.length).toBe(1);
      expect(preservedHistory.body.match_status).toBe("unmatched");
    });
  });
});

