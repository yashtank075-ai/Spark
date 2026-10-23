const request = require("supertest");
const express = require("express");
const conversationRoutes = require("../routes/conversationRoutes");
const { Match, Conversation, Message, User, Profile, ProfileMedia } = require("../models");
const storageService = require("../services/storageService");

const USER_A_ID = "00000000-0000-4000-8000-000000000000";
const USER_B_ID = "11111111-1111-4111-8111-111111111111";
const UNRELATED_USER_ID = "22222222-2222-4222-8222-222222222222";

const MATCH_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MESSAGE_ID_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let mockAuthUserId = USER_A_ID;

jest.mock("../middleware/authenticate", () => (req, res, next) => {
  if (!mockAuthUserId) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  req.auth = { userId: mockAuthUserId, sessionId: "sess-123" };
  req.user = {
    id: mockAuthUserId,
    accountStatus: "active",
    dateOfBirth: "1995-05-15",
    ageEligible: true,
  };
  next();
});

jest.mock("../middleware/requireOnboarding", () => (req, res, next) => {
  req.profile = {
    id: "prof-0000",
    userId: req.auth.userId,
    onboardingStatus: "completed",
  };
  next();
});

jest.mock("../models", () => ({
  Match: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
  },
  Conversation: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
    create: jest.fn(),
  },
  Message: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  User: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
  Profile: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
  },
  ProfileMedia: {
    findAll: jest.fn(),
  },
}));

jest.mock("../config/db", () => ({
  transaction: jest.fn().mockImplementation(async () => ({
    commit: jest.fn().mockResolvedValue(true),
    rollback: jest.fn().mockResolvedValue(true),
    LOCK: { UPDATE: "UPDATE" },
  })),
  fn: jest.fn((name, ...args) => `${name}(${args.join(",")})`),
  col: jest.fn((name) => name),
}));

const app = express();
app.use(express.json());
app.use("/api/v1", conversationRoutes);

describe("SPARK Section 7.05 — Phase 2: Conversations & Messaging Unit Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUserId = USER_A_ID;
  });

  describe("1. GET /api/v1/conversations — Listing & Participant Card", () => {
    it("should list active conversations with safe public participant profile", async () => {
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      };

      const mockConversation = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
        lastMessageAt: new Date("2026-10-12T12:00:00Z"),
        createdAt: new Date("2026-10-12T10:00:00Z"),
      };

      Match.findAll.mockResolvedValue([mockMatch]);
      Conversation.findOrCreate.mockResolvedValue([mockConversation, false]);
      Conversation.findAll.mockResolvedValue([mockConversation]);

      User.findAll.mockResolvedValue([
        {
          id: USER_B_ID,
          dateOfBirth: "1998-10-14",
          accountStatus: "active",
          profile: {
            id: "prof-b",
            userId: USER_B_ID,
            displayName: "Sharanya",
            gender: "female",
            showGenderOnProfile: true,
            datingIntention: "explore",
            datingSpeed: "slow",
            interests: ["specialty_coffee"],
            bio: "Architect by day.",
            location: { city: "Bengaluru", latitude: 12.9716, longitude: 77.5946 },
            media: [
              {
                id: "media-1",
                mediaType: "photo",
                storageRef: "uploads/p1.jpg",
                isPrimary: true,
                moderationStatus: "approved",
              },
            ],
          },
        },
      ]);

      Message.findAll.mockResolvedValue([
        {
          id: MESSAGE_ID_1,
          conversationId: CONVERSATION_ID,
          senderId: USER_B_ID,
          content: "Hey, see you on Church Street!",
          isRead: false,
          readAt: null,
          createdAt: new Date("2026-10-12T12:00:00Z"),
        },
      ]);

      const res = await request(app).get("/api/v1/conversations");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);

      const conv = res.body.data[0];
      expect(conv.id).toBe(CONVERSATION_ID);
      expect(conv.match_id).toBe(MATCH_ID);
      expect(conv.unread_count).toBe(1);
      expect(conv.latest_message.content).toBe("Hey, see you on Church Street!");

      // Privacy verification: no sensitive user information
      expect(conv.user.user_id).toBe(USER_B_ID);
      expect(conv.user.display_name).toBe("Sharanya");
      expect(conv.user.date_of_birth).toBeUndefined();
      expect(conv.user.phone).toBeUndefined();
      expect(conv.user.location.latitude).toBeUndefined();
      expect(conv.user.location.city).toBe("Bengaluru");
    });

    it("should return empty list when authenticated user has no active matches", async () => {
      Match.findAll.mockResolvedValue([]);

      const res = await request(app).get("/api/v1/conversations");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.count).toBe(0);
    });

    it("should reject invalid cursor with 400", async () => {
      const res = await request(app).get("/api/v1/conversations?cursor=invalid-cursor");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("cursor");
    });
  });

  describe("2. GET /api/v1/conversations/:conversation_id/messages — Message History", () => {
    it("should return message history for authorized participant", async () => {
      Conversation.findByPk.mockResolvedValue({
        id: CONVERSATION_ID,
        match: {
          id: MATCH_ID,
          userAId: USER_A_ID,
          userBId: USER_B_ID,
          status: "active",
        },
      });

      Message.findAll.mockResolvedValue([
        {
          id: MESSAGE_ID_1,
          conversationId: CONVERSATION_ID,
          senderId: USER_A_ID,
          content: "Hello!",
          isRead: true,
          readAt: new Date("2026-10-12T11:00:00Z"),
          createdAt: new Date("2026-10-12T10:30:00Z"),
        },
      ]);

      const res = await request(app).get(`/api/v1/conversations/${CONVERSATION_ID}/messages`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].content).toBe("Hello!");
      expect(res.body.match_status).toBe("active");
    });

    it("should reject access with 403 if user is not a participant", async () => {
      mockAuthUserId = UNRELATED_USER_ID;

      Conversation.findByPk.mockResolvedValue({
        id: CONVERSATION_ID,
        match: {
          id: MATCH_ID,
          userAId: USER_A_ID,
          userBId: USER_B_ID,
          status: "active",
        },
      });

      const res = await request(app).get(`/api/v1/conversations/${CONVERSATION_ID}/messages`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("not authorized");
    });

    it("should return 404 if conversation does not exist", async () => {
      Conversation.findByPk.mockResolvedValue(null);

      const res = await request(app).get(`/api/v1/conversations/${CONVERSATION_ID}/messages`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should reject invalid conversation_id with 400", async () => {
      const res = await request(app).get("/api/v1/conversations/not-a-uuid/messages");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("3. POST /api/v1/conversations/:conversation_id/messages — Sending Messages", () => {
    it("should persist and return message when match is active", async () => {
      const mockConv = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
        lastMessageAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      const mockCreatedMessage = {
        id: MESSAGE_ID_1,
        conversationId: CONVERSATION_ID,
        senderId: USER_A_ID,
        content: "Let us meet at the bookstore.",
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-10-12T12:00:00Z"),
      };

      Message.create.mockResolvedValue(mockCreatedMessage);

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/messages`)
        .send({ content: "Let us meet at the bookstore." });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(MESSAGE_ID_1);
      expect(res.body.data.content).toBe("Let us meet at the bookstore.");
      expect(mockConv.save).toHaveBeenCalled();
    });

    it("should reject sending messages with 400 if match is unmatched", async () => {
      Conversation.findByPk.mockResolvedValue({
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
      });
      Match.findByPk.mockResolvedValue({
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "unmatched",
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/messages`)
        .send({ content: "Are you still there?" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MATCH_UNMATCHED");
      expect(res.body.message).toContain("unmatched conversation");
    });

    it("should reject empty or whitespace message content with 422", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/messages`)
        .send({ content: "   " });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should reject sending messages with 403 if user is not participant", async () => {
      mockAuthUserId = UNRELATED_USER_ID;

      Conversation.findByPk.mockResolvedValue({
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
      });
      Match.findByPk.mockResolvedValue({
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      });

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/messages`)
        .send({ content: "Intruder message" });

      expect(res.status).toBe(403);
    });
  });

  describe("4. POST /api/v1/conversations/:conversation_id/read — Read Receipts", () => {
    it("should mark incoming unread messages as read", async () => {
      Conversation.findByPk.mockResolvedValue({
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
      });
      Match.findByPk.mockResolvedValue({
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      });

      Message.update.mockResolvedValue([3]); // 3 messages updated

      const res = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/read`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages_marked_read).toBe(3);
      expect(res.body.data.read_at).toBeDefined();

      expect(Message.update).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: true }),
        expect.objectContaining({
          where: expect.objectContaining({
            conversationId: CONVERSATION_ID,
            isRead: false,
          }),
        })
      );
    });

    it("should reject marking as read if user is not participant with 403", async () => {
      mockAuthUserId = UNRELATED_USER_ID;

      Conversation.findByPk.mockResolvedValue({
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
      });
      Match.findByPk.mockResolvedValue({
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      });

      const res = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/read`);

      expect(res.status).toBe(403);
    });
  });

  describe("5. Authentication Check", () => {
    it("should reject unauthenticated requests with 401", async () => {
      mockAuthUserId = null;

      const res = await request(app).get("/api/v1/conversations");
      expect(res.status).toBe(401);

      const goodbyeRes = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/goodbye`);
      expect(goodbyeRes.status).toBe(401);

      const voiceRes = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/voice`);
      expect(voiceRes.status).toBe(401);
    });
  });

  describe("6. POST /api/v1/conversations/:conversation_id/goodbye — Ending Conversation", () => {
    it("should successfully end active conversation and update match status to unmatched", async () => {
      const mockConv = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
      };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/goodbye`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Conversation ended successfully");
      expect(res.body.data.conversation_id).toBe(CONVERSATION_ID);
      expect(res.body.data.match_id).toBe(MATCH_ID);
      expect(res.body.data.match_status).toBe("unmatched");
      expect(mockMatch.status).toBe("unmatched");
      expect(mockMatch.save).toHaveBeenCalled();
    });

    it("should return 200 idempotently if conversation has already ended", async () => {
      const mockConv = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
      };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "unmatched",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/goodbye`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("already ended");
      expect(res.body.data.match_status).toBe("unmatched");
    });

    it("should reject ending conversation with 403 if user is not a participant", async () => {
      mockAuthUserId = UNRELATED_USER_ID;

      const mockConv = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
      };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/goodbye`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("not authorized");
    });

    it("should return 404 if conversation does not exist", async () => {
      Conversation.findByPk.mockResolvedValue(null);

      const res = await request(app).post(`/api/v1/conversations/${CONVERSATION_ID}/goodbye`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Conversation not found");
    });

    it("should reject invalid conversation ID format with 400", async () => {
      const res = await request(app).post("/api/v1/conversations/not-a-valid-uuid/goodbye");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Valid Conversation ID");
    });
  });

  describe("7. POST /api/v1/conversations/:conversation_id/voice — Voice Messaging", () => {
    it("should upload audio file, create voice message, and return formatted response", async () => {
      const mockConv = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
        lastMessageAt: null,
        save: jest.fn().mockResolvedValue(true),
      };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      jest.spyOn(storageService, "uploadFile").mockResolvedValue("uploads/voice_test_123.mp3");

      const mockVoiceMessage = {
        id: MESSAGE_ID_1,
        conversationId: CONVERSATION_ID,
        senderId: USER_A_ID,
        messageType: "voice",
        content: "Quick voice note",
        mediaUrl: "uploads/voice_test_123.mp3",
        duration: 15,
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-10-12T12:00:00Z"),
      };

      Message.create.mockResolvedValue(mockVoiceMessage);

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .field("duration", "15")
        .field("content", "Quick voice note")
        .attach("audio", Buffer.from("mock audio content"), {
          filename: "sample.mp3",
          contentType: "audio/mpeg",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Voice message sent successfully");
      expect(res.body.data.id).toBe(MESSAGE_ID_1);
      expect(res.body.data.message_type).toBe("voice");
      expect(res.body.data.type).toBe("voice");
      expect(res.body.data.audio_url).toContain("uploads/voice_test_123.mp3");
      expect(res.body.data.media_url).toContain("uploads/voice_test_123.mp3");
      expect(res.body.data.storage_key).toBe("uploads/voice_test_123.mp3");
      expect(res.body.data.duration).toBe(15);
      expect(mockConv.save).toHaveBeenCalled();
    });

    it("should accept voice upload when field is named 'voice'", async () => {
      const mockConv = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
        lastMessageAt: null,
        save: jest.fn().mockResolvedValue(true),
      };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      jest.spyOn(storageService, "uploadFile").mockResolvedValue("uploads/voice_alt.mp3");

      const mockVoiceMessage = {
        id: MESSAGE_ID_1,
        conversationId: CONVERSATION_ID,
        senderId: USER_A_ID,
        messageType: "voice",
        content: null,
        mediaUrl: "uploads/voice_alt.mp3",
        duration: null,
        isRead: false,
        readAt: null,
        createdAt: new Date("2026-10-12T12:00:00Z"),
      };

      Message.create.mockResolvedValue(mockVoiceMessage);

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .attach("voice", Buffer.from("mock audio"), {
          filename: "voice.ogg",
          contentType: "audio/ogg",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message_type).toBe("voice");
    });

    it("should reject request with 400 if no audio file is provided", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .send({ duration: 10 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("No audio file provided");
    });

    it("should reject request with 422 if unsupported audio format is uploaded", async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .attach("audio", Buffer.from("not audio"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Invalid audio format");
    });

    it("should reject request with 404 if conversation is missing", async () => {
      Conversation.findByPk.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .attach("audio", Buffer.from("audio"), {
          filename: "audio.wav",
          contentType: "audio/wav",
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Conversation not found");
    });

    it("should reject request with 403 if user is not participant", async () => {
      mockAuthUserId = UNRELATED_USER_ID;

      const mockConv = { id: CONVERSATION_ID, matchId: MATCH_ID };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .attach("audio", Buffer.from("audio"), {
          filename: "audio.mp3",
          contentType: "audio/mpeg",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("not authorized");
    });

    it("should reject voice message with 400 if conversation is unmatched", async () => {
      const mockConv = { id: CONVERSATION_ID, matchId: MATCH_ID };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "unmatched",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .attach("audio", Buffer.from("audio"), {
          filename: "audio.mp3",
          contentType: "audio/mpeg",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("MATCH_UNMATCHED");
      expect(res.body.message).toContain("unmatched conversation");
    });

    it("should clean up uploaded file if database persistence fails", async () => {
      const mockConv = {
        id: CONVERSATION_ID,
        matchId: MATCH_ID,
        save: jest.fn(),
      };
      const mockMatch = {
        id: MATCH_ID,
        userAId: USER_A_ID,
        userBId: USER_B_ID,
        status: "active",
      };

      Conversation.findByPk.mockResolvedValue(mockConv);
      Match.findByPk.mockResolvedValue(mockMatch);

      const deleteSpy = jest.spyOn(storageService, "deleteFile").mockResolvedValue(true);
      jest.spyOn(storageService, "uploadFile").mockResolvedValue("uploads/temp_audio.mp3");

      Message.create.mockRejectedValue(new Error("Database connection timeout"));

      const res = await request(app)
        .post(`/api/v1/conversations/${CONVERSATION_ID}/voice`)
        .attach("audio", Buffer.from("audio"), {
          filename: "audio.mp3",
          contentType: "audio/mpeg",
        });

      expect(res.status).toBe(500);
      expect(deleteSpy).toHaveBeenCalledWith("uploads/temp_audio.mp3");
    });
  });
});

