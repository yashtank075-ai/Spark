const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const sequelize = require("../config/db");
const gameRoutes = require("../routes/gameRoutes");
const {
  User,
  Profile,
  AuthSession,
  Match,
  Conversation,
  Block,
  GameCatalog,
  GameSession,
  GameAnswer,
} = require("../models");
const { CATALOG_ENTRIES } = require("../scripts/seed-game-catalog");

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

describe("Section 7.06 Play: Vibe Check & Secret Answers End-to-End Suite", () => {
  let app;
  let userA, userB, userUnrelated, userUnderage, userIncomplete;
  let sessionA, sessionB, sessionUnrelated, sessionUnderage, sessionIncomplete;
  let tokenA, tokenB, tokenUnrelated, tokenUnderage, tokenIncomplete;
  let matchAB, conversationAB;

  beforeAll(async () => {
    // Safety check: ensure tests ONLY run against the dedicated test database
    const currentDb = sequelize.config.database;
    if (!currentDb || !currentDb.includes("test")) {
      throw new Error(
        `Destructive tests blocked! Attempted to run against database "${currentDb}". Tests must only run against an isolated test database (e.g. spark_test).`
      );
    }

    await sequelize.authenticate();
    await sequelize.sync();

    // Seed game catalog in test database
    for (const entry of CATALOG_ENTRIES) {
      await GameCatalog.findOrCreate({
        where: { gameType: entry.gameType },
        defaults: entry,
      });
    }

    app = express();
    app.use(express.json());
    app.use("/api/v1/games", gameRoutes);
  });

  afterAll(async () => {
    await GameAnswer.destroy({ where: {}, force: true });
    await GameSession.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await Match.destroy({ where: {}, force: true });
    await Block.destroy({ where: {}, force: true });
    await Profile.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });
  });

  beforeEach(async () => {
    // Clean up test tables in dependency order
    await GameAnswer.destroy({ where: {}, force: true });
    await GameSession.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await Match.destroy({ where: {}, force: true });
    await Block.destroy({ where: {}, force: true });
    await Profile.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    // Seed test users
    userA = await User.create({
      phone: "+19993330001",
      dateOfBirth: "1996-04-12",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    userB = await User.create({
      phone: "+19993330002",
      dateOfBirth: "1997-09-19",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    userUnrelated = await User.create({
      phone: "+19993330003",
      dateOfBirth: "1995-11-05",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    userUnderage = await User.create({
      phone: "+19993330004",
      dateOfBirth: "2010-01-01",
      ageEligible: false,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    userIncomplete = await User.create({
      phone: "+19993330005",
      dateOfBirth: "1998-02-02",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    // Seed auth sessions
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    sessionA = await AuthSession.create({
      userId: userA.id,
      refreshTokenHash: "hash_a_" + Date.now(),
      expiresAt: future,
    });
    sessionB = await AuthSession.create({
      userId: userB.id,
      refreshTokenHash: "hash_b_" + Date.now(),
      expiresAt: future,
    });
    sessionUnrelated = await AuthSession.create({
      userId: userUnrelated.id,
      refreshTokenHash: "hash_u_" + Date.now(),
      expiresAt: future,
    });
    sessionUnderage = await AuthSession.create({
      userId: userUnderage.id,
      refreshTokenHash: "hash_under_" + Date.now(),
      expiresAt: future,
    });
    sessionIncomplete = await AuthSession.create({
      userId: userIncomplete.id,
      refreshTokenHash: "hash_incomp_" + Date.now(),
      expiresAt: future,
    });

    tokenA = createToken(userA, sessionA);
    tokenB = createToken(userB, sessionB);
    tokenUnrelated = createToken(userUnrelated, sessionUnrelated);
    tokenUnderage = createToken(userUnderage, sessionUnderage);
    tokenIncomplete = createToken(userIncomplete, sessionIncomplete);

    // Completed profiles
    await Profile.create({
      userId: userA.id,
      displayName: "Rohan",
      gender: "male",
      onboardingStatus: "completed",
    });
    await Profile.create({
      userId: userB.id,
      displayName: "Ananya",
      gender: "female",
      onboardingStatus: "completed",
    });
    await Profile.create({
      userId: userUnrelated.id,
      displayName: "Charlie",
      gender: "nonbinary",
      onboardingStatus: "completed",
    });
    await Profile.create({
      userId: userUnderage.id,
      displayName: "Minor User",
      gender: "other",
      onboardingStatus: "completed",
    });
    await Profile.create({
      userId: userIncomplete.id,
      displayName: "Incomplete User",
      gender: "male",
      onboardingStatus: "in_progress", // Incomplete onboarding
    });

    // Seed active mutual match & conversation between userA and userB
    const canonicalA = userA.id < userB.id ? userA.id : userB.id;
    const canonicalB = userA.id < userB.id ? userB.id : userA.id;
    matchAB = await Match.create({
      userAId: canonicalA,
      userBId: canonicalB,
      status: "active",
    });

    conversationAB = await Conversation.create({
      matchId: matchAB.id,
    });
  });

  // -------------------------------------------------------------
  // 1. GET /api/v1/games/catalog
  // -------------------------------------------------------------
  describe("1. GET /api/v1/games/catalog", () => {
    it("should reject unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/games/catalog");
      expect(res.status).toBe(401);
    });

    it("should reject underage user with 403", async () => {
      const res = await request(app)
        .get("/api/v1/games/catalog")
        .set("Authorization", `Bearer ${tokenUnderage}`);
      expect(res.status).toBe(403);
    });

    it("should reject user with incomplete onboarding with 403", async () => {
      const res = await request(app)
        .get("/api/v1/games/catalog")
        .set("Authorization", `Bearer ${tokenIncomplete}`);
      expect(res.status).toBe(403);
    });

    it("should return active supported games (Vibe Check and Secret Answers)", async () => {
      const res = await request(app)
        .get("/api/v1/games/catalog")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const types = res.body.data.map((g) => g.game_type);
      expect(types).toContain("vibe_check");
      expect(types).toContain("secret_answers");

      const vibeCheck = res.body.data.find((g) => g.game_type === "vibe_check");
      expect(vibeCheck.display_name).toBe("Vibe Check");
      expect(vibeCheck.supported).toBe(true);
      expect(vibeCheck.config.questions.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------
  // 2. POST /api/v1/games/sessions
  // -------------------------------------------------------------
  describe("2. POST /api/v1/games/sessions", () => {
    it("should reject invalid conversation_id format with 400", async () => {
      const res = await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          conversation_id: "not-a-uuid",
          game_type: "vibe_check",
        });

      expect(res.status).toBe(400);
    });

    it("should reject unsupported game type with 400", async () => {
      const res = await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          conversation_id: conversationAB.id,
          game_type: "poker_night",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Invalid game_type");
    });

    it("should reject invitation from non-participant with 403", async () => {
      const res = await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenUnrelated}`)
        .send({
          conversation_id: conversationAB.id,
          game_type: "vibe_check",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("not authorized");
    });

    it("should reject invitation in unmatched conversation with 400", async () => {
      matchAB.status = "unmatched";
      await matchAB.save();

      const res = await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          conversation_id: conversationAB.id,
          game_type: "vibe_check",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MATCH_UNMATCHED");
    });

    it("should reject invitation when a block exists between participants with 403", async () => {
      await Block.create({
        blockerId: userB.id,
        blockedId: userA.id,
      });

      const res = await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          conversation_id: conversationAB.id,
          game_type: "vibe_check",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("account restrictions");
    });

    it("should successfully create a game invitation for vibe_check", async () => {
      const res = await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          conversation_id: conversationAB.id,
          game_type: "vibe_check",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.game_type).toBe("vibe_check");
      expect(res.body.data.status).toBe("pending");
      expect(res.body.data.inviter_id).toBe(userA.id);
      expect(res.body.data.invitee_id).toBe(userB.id);
      expect(res.body.data.reveal_state).toBe("sealed");
      expect(res.body.data.participants.inviter.display_name).toBe("Rohan");
      expect(res.body.data.participants.invitee.display_name).toBe("Ananya");
      expect(res.body.data.expires_at).toBeTruthy();
    });

    it("should prevent duplicate active invitations in the same conversation with 409", async () => {
      // First invitation
      await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          conversation_id: conversationAB.id,
          game_type: "vibe_check",
        });

      // Second invitation while first is still pending
      const res = await request(app)
        .post("/api/v1/games/sessions")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          conversation_id: conversationAB.id,
          game_type: "secret_answers",
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ACTIVE_SESSION_EXISTS");
    });
  });

  // -------------------------------------------------------------
  // 3. POST /api/v1/games/sessions/:session_id/accept
  // -------------------------------------------------------------
  describe("3. POST /api/v1/games/sessions/:session_id/accept", () => {
    let session;

    beforeEach(async () => {
      session = await GameSession.create({
        conversationId: conversationAB.id,
        gameType: "secret_answers",
        status: "pending",
        inviterId: userA.id,
        inviteeId: userB.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revealState: "sealed",
      });
    });

    it("should reject acceptance by inviter with 403", async () => {
      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/accept`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("INVITER_CANNOT_ACCEPT");
    });

    it("should reject acceptance by an unrelated user with 403", async () => {
      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/accept`)
        .set("Authorization", `Bearer ${tokenUnrelated}`);

      expect(res.status).toBe(403);
    });

    it("should allow the invited user (User B) to accept the invitation", async () => {
      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/accept`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("accepted");
      expect(res.body.data.accepted_at).toBeTruthy();
    });

    it("should handle repeated accept calls idempotently with 200", async () => {
      await request(app)
        .post(`/api/v1/games/sessions/${session.id}/accept`)
        .set("Authorization", `Bearer ${tokenB}`);

      const res2 = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/accept`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("accepted");
    });

    it("should reject acceptance if invitation has expired with 400", async () => {
      // Set expires_at in the past
      session.expiresAt = new Date(Date.now() - 10000);
      await session.save();

      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/accept`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SESSION_EXPIRED");
    });

    it("should reject acceptance if session is cancelled with 400", async () => {
      session.status = "cancelled";
      session.cancelledAt = new Date();
      session.cancelledBy = userA.id;
      await session.save();

      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/accept`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SESSION_CANCELLED");
    });
  });

  // -------------------------------------------------------------
  // 4. Answers submission & Secret Reveal logic
  // -------------------------------------------------------------
  describe("4. Answers submission, Privacy, and Reveal Logic", () => {
    let session;

    beforeEach(async () => {
      session = await GameSession.create({
        conversationId: conversationAB.id,
        gameType: "secret_answers",
        status: "accepted",
        inviterId: userA.id,
        inviteeId: userB.id,
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        revealState: "sealed",
      });
    });

    it("should reject answer submission for pending session before acceptance", async () => {
      session.status = "pending";
      await session.save();

      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          question_id: "sa_1",
          answer: "My secret answer",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SESSION_PENDING");
    });

    it("should reject answer submission from non-participant with 403", async () => {
      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenUnrelated}`)
        .send({
          question_id: "sa_1",
          answer: "Impostor answer",
        });

      expect(res.status).toBe(403);
    });

    it("should reject invalid question_id or empty answer with 422", async () => {
      const res1 = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ question_id: "", answer: "value" });
      expect(res1.status).toBe(422);

      const res2 = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ question_id: "sa_1" });
      expect(res2.status).toBe(422);
    });

    it("should seal User A's answer privately and keep reveal_state sealed when User B has not answered", async () => {
      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          question_id: "sa_1",
          answer: { text: "Secret Answer by User A" },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.reveal_state).toBe("sealed");
      expect(res.body.data.other_user_submitted).toBe(false);
      expect(res.body.data.your_answer).toEqual({ text: "Secret Answer by User A" });

      // Check via GET /api/v1/games/sessions/:session_id from User B's perspective
      // User B MUST NOT see User A's answer payload!
      const getResB = await request(app)
        .get(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(getResB.status).toBe(200);
      expect(getResB.body.data.reveal_state).toBe("sealed");
      expect(getResB.body.data.submission_status.other_user_submitted).toBe(true);
      expect(getResB.body.data.submission_status.current_user_submitted).toBe(false);

      const userAAnswerInRes = getResB.body.data.answers.find((a) => a.participant_id === userA.id);
      expect(userAAnswerInRes).toBeDefined();
      expect(userAAnswerInRes.sealed).toBe(true);
      expect(userAAnswerInRes.answer_payload).toBeUndefined(); // NEVER EXPOSED
    });

    it("should reveal both answers once both User A and User B submit their answers", async () => {
      // 1. User A submits
      await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          question_id: "sa_1",
          answer: "A's secret preference",
        });

      // 2. User B submits
      const resB = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          question_id: "sa_1",
          answer: "B's secret preference",
        });

      expect(resB.status).toBe(200);
      expect(resB.body.data.reveal_state).toBe("revealed");
      expect(resB.body.data.session_status).toBe("completed");

      // 3. Both users can now read both answers in GET /sessions/:session_id
      const getResA = await request(app)
        .get(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(getResA.body.data.reveal_state).toBe("revealed");
      expect(getResA.body.data.status).toBe("completed");
      expect(getResA.body.data.answers).toHaveLength(2);

      const ansFromA = getResA.body.data.answers.find((a) => a.participant_id === userA.id);
      const ansFromB = getResA.body.data.answers.find((a) => a.participant_id === userB.id);

      expect(ansFromA.answer_payload).toBe("A's secret preference");
      expect(ansFromB.answer_payload).toBe("B's secret preference");
      expect(ansFromA.sealed).toBeUndefined();
      expect(ansFromB.sealed).toBeUndefined();
    });

    it("should update answer idempotently if resubmitted before completion", async () => {
      await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          question_id: "sa_1",
          answer: "Draft answer 1",
        });

      const resUpdate = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          question_id: "sa_1",
          answer: "Final polished answer",
        });

      expect(resUpdate.status).toBe(200);
      expect(resUpdate.body.data.your_answer).toBe("Final polished answer");

      const answersInDb = await GameAnswer.findAll({
        where: { sessionId: session.id, participantId: userA.id },
      });
      expect(answersInDb).toHaveLength(1);
      expect(answersInDb[0].answerPayload).toBe("Final polished answer");
    });
  });

  // -------------------------------------------------------------
  // 5. GET /api/v1/games/sessions/:session_id (Reconnect & State)
  // -------------------------------------------------------------
  describe("5. GET /api/v1/games/sessions/:session_id", () => {
    let session;

    beforeEach(async () => {
      session = await GameSession.create({
        conversationId: conversationAB.id,
        gameType: "vibe_check",
        status: "accepted",
        inviterId: userA.id,
        inviteeId: userB.id,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        revealState: "sealed",
      });
    });

    it("should reject non-participant with 403", async () => {
      const res = await request(app)
        .get(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenUnrelated}`);

      expect(res.status).toBe(403);
    });

    it("should support reconnect / resume preserving state without resetting or leaking data", async () => {
      // User A submits answer
      await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          question_id: "vc_1",
          answer: 2,
        });

      // User A reconnects
      const resA = await request(app)
        .get(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(resA.status).toBe(200);
      expect(resA.body.data.status).toBe("in_progress");
      expect(resA.body.data.submission_status.current_user_submitted).toBe(true);
      expect(resA.body.data.submission_status.other_user_submitted).toBe(false);
      expect(resA.body.data.answers[0].answer_payload).toBe(2);

      // User B reconnects
      const resB = await request(app)
        .get(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data.submission_status.current_user_submitted).toBe(false);
      expect(resB.body.data.submission_status.other_user_submitted).toBe(true);
      // User B must NOT see User A's answer payload!
      expect(resB.body.data.answers[0].answer_payload).toBeUndefined();
      expect(resB.body.data.answers[0].sealed).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // 6. DELETE /api/v1/games/sessions/:session_id (Cancellation)
  // -------------------------------------------------------------
  describe("6. DELETE /api/v1/games/sessions/:session_id", () => {
    let session;

    beforeEach(async () => {
      session = await GameSession.create({
        conversationId: conversationAB.id,
        gameType: "vibe_check",
        status: "pending",
        inviterId: userA.id,
        inviteeId: userB.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revealState: "sealed",
      });
    });

    it("should reject non-participant cancellation with 403", async () => {
      const res = await request(app)
        .delete(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenUnrelated}`);

      expect(res.status).toBe(403);
    });

    it("should allow authorized participant to cancel session and record cancelled_by", async () => {
      const res = await request(app)
        .delete(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("cancelled");
      expect(res.body.data.cancelled_by).toBe(userA.id);
      expect(res.body.data.cancelled_at).toBeTruthy();

      const sessionInDb = await GameSession.findByPk(session.id);
      expect(sessionInDb.status).toBe("cancelled");
      expect(sessionInDb.cancelledBy).toBe(userA.id);
    });

    it("should handle repeated cancellation idempotently with 200", async () => {
      await request(app)
        .delete(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenA}`);

      const res2 = await request(app)
        .delete(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("cancelled");
    });

    it("should prevent submitting answers to a cancelled session with 400", async () => {
      await request(app)
        .delete(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenA}`);

      const res = await request(app)
        .post(`/api/v1/games/sessions/${session.id}/answers`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          question_id: "vc_1",
          answer: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SESSION_CANCELLED");
    });

    it("should prevent cancelling an already completed game session with 400", async () => {
      session.status = "completed";
      session.completedAt = new Date();
      await session.save();

      const res = await request(app)
        .delete(`/api/v1/games/sessions/${session.id}`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SESSION_ALREADY_COMPLETED");
    });
  });
});
