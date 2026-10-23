const request = require("supertest");
const express = require("express");
const discoverRoutes = require("../routes/discoverRoutes");
const rushRoutes = require("../routes/rushRoutes");
const {
  User,
  Profile,
  ProfileMedia,
  Interaction,
  Match,
  RushSession,
  Block,
} = require("../models");

const VALID_UUID_1 = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_3 = "33333333-3333-4333-8333-333333333333";
const CURRENT_USER_ID = "00000000-0000-4000-8000-000000000000";
const CURRENT_PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

jest.mock("../middleware/authenticate", () => (req, res, next) => {
  req.auth = { userId: "00000000-0000-4000-8000-000000000000", sessionId: "sess-123" };
  req.user = {
    id: "00000000-0000-4000-8000-000000000000",
    accountStatus: "active",
    dateOfBirth: "1995-05-15",
    ageEligible: true,
  };
  next();
});

jest.mock("../middleware/requireOnboarding", () => (req, res, next) => {
  req.profile = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    userId: "00000000-0000-4000-8000-000000000000",
    displayName: "Current User",
    gender: "male",
    onboardingStatus: "completed",
    preferences: {
      min_age: 20,
      max_age: 35,
      interested_in_gender: "female",
      max_distance_km: 50,
    },
    save: jest.fn().mockResolvedValue(true),
  };
  next();
});

jest.mock("../models", () => ({
  User: {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
  },
  Profile: {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
  },
  ProfileMedia: {
    findAll: jest.fn(),
  },
  Interaction: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
  },
  Match: {
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
  },
  Conversation: {
    findOrCreate: jest.fn().mockResolvedValue([{}, true]),
  },
  RushSession: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  Block: {
    findOne: jest.fn(),
    findAll: jest.fn(),
  },
}));

jest.mock("../config/db", () => ({
  transaction: jest.fn().mockResolvedValue({
    commit: jest.fn().mockResolvedValue(true),
    rollback: jest.fn().mockResolvedValue(true),
    LOCK: { UPDATE: "UPDATE" },
  }),
}));

const app = express();
app.use(express.json());
app.use("/api/v1", discoverRoutes);
app.use("/api/v1/rush", rushRoutes);

describe("Section 7.04 Discover and SPARK Rush Comprehensive Audit Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("API 1: Discover deck (GET /api/v1/discover)", () => {
    it("should return eligible profiles excluding self, blocked, and already interacted", async () => {
      Block.findAll.mockResolvedValue([
        { blockerId: VALID_UUID_1, blockedId: CURRENT_USER_ID },
      ]);
      Interaction.findAll.mockResolvedValue([
        { targetId: VALID_UUID_2 },
      ]);

      const mockCandidate = {
        id: VALID_UUID_3,
        userId: VALID_UUID_3,
        displayName: "Alice",
        gender: "female",
        datingIntention: "vibe",
        datingSpeed: "slow",
        prompts: [{ question: "Fav song", answer: "Jazz" }],
        preferences: { min_age: 20, max_age: 35, interested_in_gender: "male" },
        user: {
          id: VALID_UUID_3,
          dateOfBirth: "1998-01-01",
          ageEligible: true,
          accountStatus: "active",
        },
        media: [
          {
            id: "media-1",
            mediaType: "photo",
            storageRef: "uploads/photo1.jpg",
            moderationStatus: "approved",
          },
        ],
      };

      Profile.findAll.mockResolvedValue([mockCandidate]);

      const res = await request(app).get("/api/v1/discover?limit=10");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].display_name).toBe("Alice");
      expect(res.body.data[0].age).toBeDefined();
      expect(res.body.data[0].media.length).toBe(1);
      // Ensure private/sensitive fields are not exposed
      expect(res.body.data[0].date_of_birth).toBeUndefined();
      expect(res.body.data[0].phone).toBeUndefined();
    });

    it("should filter out profiles without approved photos", async () => {
      Block.findAll.mockResolvedValue([]);
      Interaction.findAll.mockResolvedValue([]);

      const mockCandidateWithoutPhotos = {
        id: VALID_UUID_3,
        userId: VALID_UUID_3,
        displayName: "Bob",
        gender: "female",
        preferences: { min_age: 18, max_age: 40 },
        user: {
          id: VALID_UUID_3,
          dateOfBirth: "1997-01-01",
          ageEligible: true,
          accountStatus: "active",
        },
        media: [],
      };

      Profile.findAll.mockResolvedValue([mockCandidateWithoutPhotos]);

      const res = await request(app).get("/api/v1/discover");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });

    it("should reject invalid cursor format with 400", async () => {
      const res = await request(app).get("/api/v1/discover?cursor=invalid_tampered_cursor");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Invalid cursor format.");
    });
  });

  describe("API 2: Profile details (GET /api/v1/profiles/:profile_id)", () => {
    it("should return target profile if eligible and not blocked", async () => {
      Profile.findByPk.mockResolvedValue({
        id: VALID_UUID_1,
        userId: VALID_UUID_1,
        displayName: "Elena",
        gender: "female",
        datingIntention: "intent",
        datingSpeed: "fast",
        prompts: [],
        boundaries: { smoking: "never" },
        onboardingStatus: "completed",
        user: {
          id: VALID_UUID_1,
          dateOfBirth: "1996-03-20",
          ageEligible: true,
          accountStatus: "active",
        },
        media: [
          {
            id: "m-100",
            mediaType: "photo",
            moderationStatus: "approved",
          },
        ],
      });
      Block.findOne.mockResolvedValue(null);

      const res = await request(app).get(`/api/v1/profiles/${VALID_UUID_1}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.display_name).toBe("Elena");
      expect(res.body.data.boundaries).toEqual({ smoking: "never" });
      expect(res.body.data.date_of_birth).toBeUndefined();
    });

    it("should reject invalid profile_id parameter with 400", async () => {
      const res = await request(app).get("/api/v1/profiles/not-a-valid-uuid");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Valid Profile ID is required.");
    });

    it("should forbid viewing own profile via discovery endpoint", async () => {
      Profile.findByPk.mockResolvedValue({
        id: CURRENT_PROFILE_ID,
        userId: CURRENT_USER_ID,
        user: { accountStatus: "active", ageEligible: true },
      });

      const res = await request(app).get(`/api/v1/profiles/${CURRENT_PROFILE_ID}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("should return 404 if profile is blocked in either direction", async () => {
      Profile.findByPk.mockResolvedValue({
        id: VALID_UUID_1,
        userId: VALID_UUID_1,
        onboardingStatus: "completed",
        user: { accountStatus: "active", ageEligible: true },
      });
      Block.findOne.mockResolvedValue({ id: "block-1" });

      const res = await request(app).get(`/api/v1/profiles/${VALID_UUID_1}`);
      expect(res.status).toBe(404);
    });
  });

  describe("API 3: Update preferences (PUT /api/v1/discover/preferences)", () => {
    it("should update valid preferences", async () => {
      const mockProfile = {
        userId: CURRENT_USER_ID,
        preferences: {},
        save: jest.fn().mockResolvedValue(true),
      };
      Profile.findOne.mockResolvedValue(mockProfile);

      const res = await request(app)
        .put("/api/v1/discover/preferences")
        .send({
          min_age: 21,
          max_age: 30,
          max_distance_km: 25,
          interested_in_gender: "female",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockProfile.save).toHaveBeenCalled();
      expect(res.body.data.preferences.min_age).toBe(21);
      expect(res.body.data.preferences.max_age).toBe(30);
    });

    it("should reject min_age greater than max_age", async () => {
      const res = await request(app)
        .put("/api/v1/discover/preferences")
        .send({ min_age: 35, max_age: 25 });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("should reject underage min_age < 18", async () => {
      const res = await request(app)
        .put("/api/v1/discover/preferences")
        .send({ min_age: 16, max_age: 25 });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe("API 4: Like profile (POST /api/v1/profiles/:profile_id/like)", () => {
    it("should reject invalid profile_id parameter with 400", async () => {
      const res = await request(app).post("/api/v1/profiles/invalid-id/like");
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should record like without match if no reciprocal like", async () => {
      Profile.findByPk.mockResolvedValue({
        id: VALID_UUID_2,
        userId: VALID_UUID_2,
        onboardingStatus: "completed",
        user: { id: VALID_UUID_2, accountStatus: "active", ageEligible: true },
      });
      Block.findOne.mockResolvedValue(null);
      Interaction.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      Interaction.create.mockResolvedValue({
        id: "inter-1",
        actorId: CURRENT_USER_ID,
        targetId: VALID_UUID_2,
        action: "like",
      });

      const res = await request(app).post(`/api/v1/profiles/${VALID_UUID_2}/like`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action).toBe("like");
      expect(res.body.data.matched).toBe(false);
    });

    it("should create a mutual match atomically when reciprocal like exists", async () => {
      Profile.findByPk.mockResolvedValue({
        id: VALID_UUID_3,
        userId: VALID_UUID_3,
        onboardingStatus: "completed",
        user: { id: VALID_UUID_3, accountStatus: "active", ageEligible: true },
      });
      Block.findOne.mockResolvedValue(null);
      Interaction.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: "inter-reciprocal",
          actorId: VALID_UUID_3,
          targetId: CURRENT_USER_ID,
          action: "like",
        });

      Interaction.create.mockResolvedValue({
        id: "inter-new",
        actorId: CURRENT_USER_ID,
        targetId: VALID_UUID_3,
        action: "like",
      });

      Match.findOrCreate.mockResolvedValue([
        { id: "match-123", status: "active", save: jest.fn() },
        true,
      ]);

      const res = await request(app).post(`/api/v1/profiles/${VALID_UUID_3}/like`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.matched).toBe(true);
      expect(res.body.data.match_id).toBe("match-123");
    });

    it("should handle duplicate like idempotently", async () => {
      Profile.findByPk.mockResolvedValue({
        id: VALID_UUID_2,
        userId: VALID_UUID_2,
        onboardingStatus: "completed",
        user: { id: VALID_UUID_2, accountStatus: "active", ageEligible: true },
      });
      Block.findOne.mockResolvedValue(null);
      Interaction.findOne.mockResolvedValueOnce({
        id: "inter-existing",
        actorId: CURRENT_USER_ID,
        targetId: VALID_UUID_2,
        action: "like",
      });
      Match.findOne.mockResolvedValue(null);

      const res = await request(app).post(`/api/v1/profiles/${VALID_UUID_2}/like`);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Profile already liked.");
      expect(res.body.data.matched).toBe(false);
    });

    it("should reject self-like with 400", async () => {
      Profile.findByPk.mockResolvedValue({
        id: CURRENT_PROFILE_ID,
        userId: CURRENT_USER_ID,
        user: { id: CURRENT_USER_ID, accountStatus: "active", ageEligible: true },
      });

      const res = await request(app).post(`/api/v1/profiles/${CURRENT_PROFILE_ID}/like`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("You cannot like your own profile.");
    });
  });

  describe("API 5: Pass profile (POST /api/v1/profiles/:profile_id/pass)", () => {
    it("should record pass idempotently", async () => {
      Profile.findByPk.mockResolvedValue({
        id: VALID_UUID_2,
        userId: VALID_UUID_2,
        onboardingStatus: "completed",
        user: { id: VALID_UUID_2, accountStatus: "active", ageEligible: true },
      });
      Block.findOne.mockResolvedValue(null);
      Interaction.findOne.mockResolvedValue(null);
      Interaction.create.mockResolvedValue({
        id: "inter-pass-1",
        actorId: CURRENT_USER_ID,
        targetId: VALID_UUID_2,
        action: "pass",
      });

      const res = await request(app).post(`/api/v1/profiles/${VALID_UUID_2}/pass`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action).toBe("pass");
    });
  });


  describe("API 7: SPARK Rush activation (POST /api/v1/rush/activate)", () => {
    it("should activate 600-second rush session once per calendar day", async () => {
      RushSession.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const now = new Date();
      const expires = new Date(now.getTime() + 600 * 1000);
      RushSession.create.mockResolvedValue({
        id: "new-rush-sess",
        userId: CURRENT_USER_ID,
        startedAt: now,
        expiresAt: expires,
      });

      const res = await request(app).post("/api/v1/rush/activate");
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.duration_seconds).toBe(600);
      expect(res.body.data.session_id).toBe("new-rush-sess");
    });

    it("should reject activation if session already active", async () => {
      const now = new Date();
      const future = new Date(now.getTime() + 400 * 1000);
      RushSession.findOne.mockResolvedValueOnce({
        id: "active-rush",
        expiresAt: future,
      });

      const res = await request(app).post("/api/v1/rush/activate");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RUSH_ALREADY_ACTIVE");
    });

    it("should reject activation if already used today", async () => {
      RushSession.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "used-earlier-today" });

      const res = await request(app).post("/api/v1/rush/activate");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RUSH_DAILY_LIMIT_REACHED");
    });

    it("should handle concurrency conflict with 409 when unique constraint triggers", async () => {
      RushSession.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const uniqueError = new Error("Validation error");
      uniqueError.name = "SequelizeUniqueConstraintError";
      RushSession.create.mockRejectedValueOnce(uniqueError);

      const res = await request(app).post("/api/v1/rush/activate");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RUSH_DAILY_LIMIT_REACHED");
    });
  });
});
