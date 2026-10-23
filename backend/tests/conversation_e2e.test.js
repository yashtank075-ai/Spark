const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const sequelize = require("../config/db");
const conversationRoutes = require("../routes/conversationRoutes");
const storageService = require("../services/storageService");
const {
  User,
  Profile,
  AuthSession,
  Match,
  Conversation,
  Message,
  Interaction,
  Block,
  GameSession,
  GameAnswer,
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

// Helper to generate a valid minimal WAV audio buffer fixture
function createWavAudioBuffer() {
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(8000, 24); // 8kHz
  buffer.writeUInt32LE(8000, 28); // 8000 bytes/sec
  buffer.writeUInt16LE(1, 32); // Block align
  buffer.writeUInt16LE(8, 34); // Bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(0, 40);
  return buffer;
}

describe("SPARK Backend — Complete Conversation APIs End-to-End Verification Suite", () => {
  let app;
  let userA, userB, userC;
  let sessionA, sessionB, sessionC;
  let tokenA, tokenB, tokenC;
  let matchAB, conversationAB;
  let trackedUploadFiles = [];

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
    await sequelize.sync();

    app = express();
    app.use(express.json());
    app.use("/api/v1", conversationRoutes);
  });

  afterAll(async () => {
    process.env.STORAGE_PROVIDER = originalStorageProvider;
    // Clean up any files created on disk in uploads during tests
    for (const ref of trackedUploadFiles) {
      const fullPath = path.join(__dirname, "..", ref);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (_) {}
      }
    }

    await GameAnswer.destroy({ where: {}, force: true });
    await GameSession.destroy({ where: {}, force: true });
    await Message.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await Interaction.destroy({ where: {}, force: true });
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
    await Message.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await Interaction.destroy({ where: {}, force: true });
    await Match.destroy({ where: {}, force: true });
    await Block.destroy({ where: {}, force: true });
    await Profile.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    // Seed test adult users
    userA = await User.create({
      phone: "+19992220001",
      dateOfBirth: "1996-04-12",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    userB = await User.create({
      phone: "+19992220002",
      dateOfBirth: "1997-09-19",
      ageEligible: true,
      accountStatus: "active",
      verificationStatus: "approved",
    });

    userC = await User.create({
      phone: "+19992220003",
      dateOfBirth: "1995-11-05",
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
    sessionC = await AuthSession.create({
      userId: userC.id,
      refreshTokenHash: "hash_c_" + Date.now(),
      expiresAt: future,
    });

    tokenA = createToken(userA, sessionA);
    tokenB = createToken(userB, sessionB);
    tokenC = createToken(userC, sessionC);

    // Seed completed profiles
    await Profile.create({
      userId: userA.id,
      displayName: "Rohan",
      gender: "male",
      onboardingStatus: "completed",
      datingIntention: "long_term",
      datingSpeed: "steady",
      bio: "Software developer & tea connoisseur",
    });

    await Profile.create({
      userId: userB.id,
      displayName: "Ananya",
      gender: "female",
      onboardingStatus: "completed",
      datingIntention: "long_term",
      datingSpeed: "steady",
      bio: "Visual designer who loves jazz",
    });

    await Profile.create({
      userId: userC.id,
      displayName: "Unrelated Sid",
      gender: "male",
      onboardingStatus: "completed",
      datingIntention: "vibe",
      datingSpeed: "spontaneous",
      bio: "Independent photographer",
    });

    // Canonical ordering for match user IDs
    const [firstId, secondId] = userA.id < userB.id ? [userA.id, userB.id] : [userB.id, userA.id];
    matchAB = await Match.create({
      userAId: firstId,
      userBId: secondId,
      status: "active",
    });

    conversationAB = await Conversation.create({
      matchId: matchAB.id,
    });
  });

  // =========================================================================
  // API 1: List conversations (GET /api/v1/conversations)
  // =========================================================================
  describe("API 1: GET /api/v1/conversations — List Conversations", () => {
    it("should return the authenticated user's conversations with participant details and latest message", async () => {
      // Create a test message in the conversation
      const msg = await Message.create({
        conversationId: conversationAB.id,
        senderId: userB.id,
        messageType: "text",
        content: "Hey Rohan! Looking forward to our chat.",
        isRead: false,
      });
      conversationAB.lastMessageAt = msg.createdAt;
      await conversationAB.save();

      const res = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);

      const convItem = res.body.data[0];
      expect(convItem.id).toBe(conversationAB.id);
      expect(convItem.match_id).toBe(matchAB.id);
      expect(convItem.match_status).toBe("active");
      expect(convItem.unread_count).toBe(1);
      expect(convItem.latest_message).toBeDefined();
      expect(convItem.latest_message.content).toBe("Hey Rohan! Looking forward to our chat.");
      expect(convItem.user.user_id).toBe(userB.id);
      expect(convItem.user.display_name).toBe("Ananya");

      // Privacy: no sensitive user information leaked
      expect(convItem.user.date_of_birth).toBeUndefined();
      expect(convItem.user.phone).toBeUndefined();
    });

    it("should maintain user privacy by ensuring another user's conversations are not exposed", async () => {
      // User C has no matches, should receive an empty conversation list
      const res = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${tokenC}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.count).toBe(0);
    });

    it("should return 401 when authorization token is missing or invalid", async () => {
      const missingTokenRes = await request(app).get("/api/v1/conversations");
      expect(missingTokenRes.status).toBe(401);

      const invalidTokenRes = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", "Bearer invalid.jwt.token");
      expect(invalidTokenRes.status).toBe(401);
    });
  });

  // =========================================================================
  // API 2: Get conversation messages (GET /api/v1/conversations/:id/messages)
  // =========================================================================
  describe("API 2: GET /api/v1/conversations/:conversation_id/messages — Message History", () => {
    it("should return both text and voice messages in reverse-chronological order with cursor pagination", async () => {
      // Create text message 1
      const msg1 = await Message.create({
        conversationId: conversationAB.id,
        senderId: userA.id,
        messageType: "text",
        content: "First message from User A",
        createdAt: new Date("2026-10-12T10:00:00Z"),
      });

      // Create voice message 2
      const msg2 = await Message.create({
        conversationId: conversationAB.id,
        senderId: userB.id,
        messageType: "voice",
        content: null,
        mediaUrl: "uploads/sample_note.mp3",
        duration: 12,
        createdAt: new Date("2026-10-12T10:05:00Z"),
      });

      // Create text message 3
      const msg3 = await Message.create({
        conversationId: conversationAB.id,
        senderId: userA.id,
        messageType: "text",
        content: "Third message from User A",
        createdAt: new Date("2026-10-12T10:10:00Z"),
      });

      // Query with limit = 2
      const page1Res = await request(app)
        .get(`/api/v1/conversations/${conversationAB.id}/messages?limit=2`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.body.success).toBe(true);
      expect(page1Res.body.data).toHaveLength(2);
      expect(page1Res.body.pagination.has_more).toBe(true);
      expect(page1Res.body.pagination.limit).toBe(2);
      expect(page1Res.body.pagination.next_cursor).toBeDefined();

      // Verify reverse chronological order (newest first)
      expect(page1Res.body.data[0].id).toBe(msg3.id);
      expect(page1Res.body.data[0].content).toBe("Third message from User A");
      expect(page1Res.body.data[1].id).toBe(msg2.id);
      expect(page1Res.body.data[1].message_type).toBe("voice");
      expect(page1Res.body.data[1].duration).toBe(12);
      expect(page1Res.body.data[1].audio_url).toContain("uploads/sample_note.mp3");

      // Query full conversation with higher limit
      const allRes = await request(app)
        .get(`/api/v1/conversations/${conversationAB.id}/messages?limit=10`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(allRes.status).toBe(200);
      expect(allRes.body.data).toHaveLength(3);
      expect(allRes.body.pagination.has_more).toBe(false);
      expect(allRes.body.pagination.count).toBe(3);
    });

    it("should return 400 for invalid UUID format", async () => {
      const res = await request(app)
        .get("/api/v1/conversations/not-a-valid-uuid/messages")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Valid Conversation ID");
    });

    it("should return 404 for nonexistent conversation", async () => {
      const nonexistentId = "00000000-0000-4000-8000-000000000999";
      const res = await request(app)
        .get(`/api/v1/conversations/${nonexistentId}/messages`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Conversation not found");
    });

    it("should return 403 when nonparticipant attempts to view messages", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenC}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("not authorized");
    });
  });

  // =========================================================================
  // API 3: Send a text message (POST /api/v1/conversations/:id/messages)
  // =========================================================================
  describe("API 3: POST /api/v1/conversations/:conversation_id/messages — Send Text Message", () => {
    it("should persist text message in PostgreSQL, record sender, and update last_message_at", async () => {
      const initialTimestamp = conversationAB.lastMessageAt;
      const testContent = "Automated SPARK conversation API test.";

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ content: testContent });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe(testContent);
      expect(res.body.data.sender_id).toBe(userA.id);
      expect(res.body.data.type).toBe("text");
      expect(res.body.data.message_type).toBe("text");
      expect(res.body.data.is_read).toBe(false);

      // Verify row in real PostgreSQL
      const persisted = await Message.findByPk(res.body.data.id);
      expect(persisted).not.toBeNull();
      expect(persisted.content).toBe(testContent);
      expect(persisted.senderId).toBe(userA.id);

      // Verify conversation last_message_at was updated
      await conversationAB.reload();
      expect(conversationAB.lastMessageAt).not.toEqual(initialTimestamp);
      expect(new Date(conversationAB.lastMessageAt).getTime()).toBeCloseTo(
        new Date(persisted.createdAt).getTime(),
        -2
      );
    });

    it("should reject empty or whitespace content with 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ content: "    " });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.message).toContain("empty");
    });

    it("should reject content exceeding 2000 characters with 422 VALIDATION_ERROR", async () => {
      const longContent = "A".repeat(2001);

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ content: longContent });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.message).toContain("exceeds");
    });

    it("should reject sending messages with 403 when user is not a participant", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenC}`)
        .send({ content: "Intruder attempt" });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("not authorized");
    });

    it("should reject sending messages with 400 MATCH_UNMATCHED when conversation is ended", async () => {
      matchAB.status = "unmatched";
      await matchAB.save();

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ content: "Message to unmatched conversation" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MATCH_UNMATCHED");
    });
  });

  // =========================================================================
  // API 4: Mark messages as read (POST /api/v1/conversations/:id/read)
  // =========================================================================
  describe("API 4: POST /api/v1/conversations/:conversation_id/read — Mark Messages Read", () => {
    it("should mark only messages from the other participant as read, preserving sender's own status", async () => {
      // User B sends 2 messages to User A
      const msgB1 = await Message.create({
        conversationId: conversationAB.id,
        senderId: userB.id,
        content: "Message 1 from B",
        isRead: false,
      });
      const msgB2 = await Message.create({
        conversationId: conversationAB.id,
        senderId: userB.id,
        content: "Message 2 from B",
        isRead: false,
      });

      // User A sends 1 message
      const msgA = await Message.create({
        conversationId: conversationAB.id,
        senderId: userA.id,
        content: "My own outgoing message from A",
        isRead: false,
      });

      // User A calls read endpoint
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/read`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages_marked_read).toBe(2);
      expect(res.body.data.read_at).toBeDefined();

      // Verify in PostgreSQL: User B's messages are now read
      await msgB1.reload();
      await msgB2.reload();
      expect(msgB1.isRead).toBe(true);
      expect(msgB1.readAt).not.toBeNull();
      expect(msgB2.isRead).toBe(true);
      expect(msgB2.readAt).not.toBeNull();

      // Verify in PostgreSQL: User A's own message remains unread (incoming to B, not A)
      await msgA.reload();
      expect(msgA.isRead).toBe(false);
      expect(msgA.readAt).toBeNull();
    });

    it("should handle repeated requests gracefully (idempotently updating 0 records)", async () => {
      // User B sends 1 message
      await Message.create({
        conversationId: conversationAB.id,
        senderId: userB.id,
        content: "Single message",
        isRead: false,
      });

      // First call marks 1 read
      const firstRes = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/read`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect(firstRes.status).toBe(200);
      expect(firstRes.body.data.messages_marked_read).toBe(1);

      // Repeat call marks 0 read
      const secondRes = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/read`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.data.messages_marked_read).toBe(0);
    });

    it("should reject nonparticipant access with 403", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/read`)
        .set("Authorization", `Bearer ${tokenC}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("not authorized");
    });
  });

  // =========================================================================
  // API 5: Goodbye / unmatch (POST /api/v1/conversations/:id/goodbye)
  // =========================================================================
  describe("API 5: POST /api/v1/conversations/:conversation_id/goodbye — End Conversation", () => {
    it("should update match status to unmatched, preserve message history, and reject further messaging", async () => {
      // Seed an existing message
      const priorMsg = await Message.create({
        conversationId: conversationAB.id,
        senderId: userA.id,
        content: "Message before goodbye",
        isRead: true,
      });

      // User A says goodbye
      const goodbyeRes = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/goodbye`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(goodbyeRes.status).toBe(200);
      expect(goodbyeRes.body.success).toBe(true);
      expect(goodbyeRes.body.message).toContain("Conversation ended successfully");
      expect(goodbyeRes.body.data.conversation_id).toBe(conversationAB.id);
      expect(goodbyeRes.body.data.match_id).toBe(matchAB.id);
      expect(goodbyeRes.body.data.match_status).toBe("unmatched");

      // Verify in PostgreSQL that Match status is 'unmatched'
      await matchAB.reload();
      expect(matchAB.status).toBe("unmatched");

      // Message history remains preserved
      const historyRes = await request(app)
        .get(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data).toHaveLength(1);
      expect(historyRes.body.data[0].id).toBe(priorMsg.id);
      expect(historyRes.body.match_status).toBe("unmatched");

      // Further text messaging attempt is blocked with 400 MATCH_UNMATCHED
      const postTextRes = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ content: "Attempting message after goodbye" });

      expect(postTextRes.status).toBe(400);
      expect(postTextRes.body.code).toBe("MATCH_UNMATCHED");

      // Further voice messaging attempt is blocked with 400 MATCH_UNMATCHED
      const postVoiceRes = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenB}`)
        .attach("audio", createWavAudioBuffer(), {
          filename: "note.wav",
          contentType: "audio/wav",
        });

      expect(postVoiceRes.status).toBe(400);
      expect(postVoiceRes.body.code).toBe("MATCH_UNMATCHED");
    });

    it("should handle repeated requests idempotently returning 200 already ended", async () => {
      // First goodbye
      await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/goodbye`)
        .set("Authorization", `Bearer ${tokenA}`);

      // Repeated goodbye by User B
      const repeatRes = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/goodbye`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(repeatRes.status).toBe(200);
      expect(repeatRes.body.success).toBe(true);
      expect(repeatRes.body.message).toContain("already ended");
      expect(repeatRes.body.data.match_status).toBe("unmatched");
    });

    it("should reject nonparticipant from ending another user's conversation with 403", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/goodbye`)
        .set("Authorization", `Bearer ${tokenC}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("not authorized");
    });
  });

  // =========================================================================
  // API 6: Send voice message (POST /api/v1/conversations/:id/voice)
  // =========================================================================
  describe("API 6: POST /api/v1/conversations/:conversation_id/voice — Voice Messaging", () => {
    it("should upload audio file, persist on disk, store metadata in DB, and list in message history", async () => {
      const wavBuffer = createWavAudioBuffer();

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenA}`)
        .field("duration", "24")
        .field("content", "Check out this audio clip!")
        .attach("audio", wavBuffer, {
          filename: "recording.wav",
          contentType: "audio/wav",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Voice message sent successfully");
      expect(res.body.data.message_type).toBe("voice");
      expect(res.body.data.type).toBe("voice");
      expect(res.body.data.duration).toBe(24);
      expect(res.body.data.content).toBe("Check out this audio clip!");
      expect(res.body.data.audio_url).toBeDefined();

      const storageKey = res.body.data.storage_key;
      expect(storageKey).toBeDefined();
      trackedUploadFiles.push(storageKey);

      // Verify physical file was written to disk by storageService
      const diskPath = path.join(__dirname, "..", storageKey);
      expect(fs.existsSync(diskPath)).toBe(true);

      // Verify row in real PostgreSQL
      const persisted = await Message.findByPk(res.body.data.id);
      expect(persisted).not.toBeNull();
      expect(persisted.messageType).toBe("voice");
      expect(persisted.duration).toBe(24);
      expect(persisted.mediaUrl).toBe(storageKey);
      expect(persisted.senderId).toBe(userA.id);

      // Verify it appears in message-list API
      const historyRes = await request(app)
        .get(`/api/v1/conversations/${conversationAB.id}/messages`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data).toHaveLength(1);
      expect(historyRes.body.data[0].message_type).toBe("voice");
      expect(historyRes.body.data[0].audio_url).toBe(res.body.data.audio_url);
      expect(historyRes.body.data[0].duration).toBe(24);

      // Verify it appears in conversation-list API
      const convListRes = await request(app)
        .get("/api/v1/conversations")
        .set("Authorization", `Bearer ${tokenB}`);

      expect(convListRes.status).toBe(200);
      expect(convListRes.body.data[0].latest_message.message_type).toBe("voice");
      expect(convListRes.body.data[0].latest_message.duration).toBe(24);
    });

    it("should accept voice upload when multipart field is named 'voice'", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenB}`)
        .attach("voice", createWavAudioBuffer(), {
          filename: "note_alt.wav",
          contentType: "audio/wav",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message_type).toBe("voice");
      trackedUploadFiles.push(res.body.data.storage_key);
    });

    it("should reject request with 400 when no audio file is attached", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ duration: 15 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("No audio file provided");
    });

    it("should reject unsupported MIME formats (e.g. application/pdf) with 422", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4 simulated pdf data");

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenA}`)
        .attach("audio", pdfBuffer, {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain("Invalid audio format");
    });

    it("should reject oversized files exceeding 10MB limit with 413", async () => {
      // 10.5 MB dummy buffer
      const largeBuffer = Buffer.alloc(10.5 * 1024 * 1024);

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenA}`)
        .attach("audio", largeBuffer, {
          filename: "large_audio.mp3",
          contentType: "audio/mpeg",
        });

      expect(res.status).toBe(413);
      expect(res.body.message).toContain("exceeds");
    });

    it("should reject nonparticipant with 403", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenC}`)
        .attach("audio", createWavAudioBuffer(), {
          filename: "unauthorized.wav",
          contentType: "audio/wav",
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("not authorized");
    });

    it("should clean up uploaded file if database persistence fails", async () => {
      // Spy on Message.create to simulate database persistence failure
      const createSpy = jest.spyOn(Message, "create").mockRejectedValueOnce(
        new Error("Database write error during transaction")
      );
      const deleteSpy = jest.spyOn(storageService, "deleteFile");

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationAB.id}/voice`)
        .set("Authorization", `Bearer ${tokenA}`)
        .attach("audio", createWavAudioBuffer(), {
          filename: "cleanup_test.wav",
          contentType: "audio/wav",
        });

      expect(res.status).toBe(500);
      expect(deleteSpy).toHaveBeenCalled();

      createSpy.mockRestore();
      deleteSpy.mockRestore();
    });
  });
});
