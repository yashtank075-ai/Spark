const request = require("supertest");
const express = require("express");
const matchRoutes = require("../routes/matchRoutes");
const { Match, User, Profile, ProfileMedia } = require("../models");

const CURRENT_USER_ID = "00000000-0000-4000-8000-000000000000";
const OTHER_USER_ID = "11111111-1111-4111-8111-111111111111";
const THIRD_USER_ID = "22222222-2222-4222-8222-222222222222";
const FOURTH_USER_ID = "33333333-3333-4333-8333-333333333333";

const VALID_MATCH_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VALID_MATCH_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNRELATED_MATCH_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let mockAuthUserId = CURRENT_USER_ID;

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
}));

const app = express();
app.use(express.json());
app.use("/api/v1", matchRoutes);

describe("SPARK Section 7.05 — Phase 1: Matches APIs Unit Suite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUserId = CURRENT_USER_ID;
  });

  describe("1. GET /api/v1/matches — Successful Listing & Safe Participant Profile", () => {
    it("should return matches involving the authenticated user with other participant's safe public profile", async () => {
      const mockMatch = {
        id: VALID_MATCH_ID_1,
        userAId: CURRENT_USER_ID,
        userBId: OTHER_USER_ID,
        status: "active",
        createdAt: new Date("2026-10-12T10:00:00Z"),
      };

      Match.findAll.mockResolvedValue([mockMatch]);

      User.findAll.mockResolvedValue([
        {
          id: OTHER_USER_ID,
          dateOfBirth: "1998-10-14",
          accountStatus: "active",
          profile: {
            id: "prof-other-1",
            userId: OTHER_USER_ID,
            displayName: "Sharanya",
            gender: "female",
            showGenderOnProfile: true,
            datingIntention: "explore",
            datingSpeed: "slow",
            interests: ["specialty_coffee", "indie_gigs"],
            bio: "Architect by day.",
            prompts: [{ question: "Ideal Sunday", answer: "Records on Church St" }],
            boundaries: ["Honest communication"],
            location: { city: "Bengaluru", state: "Karnataka", country: "India", latitude: 12.9716, longitude: 77.5946 },
            media: [
              {
                id: "photo-other-1",
                mediaType: "photo",
                storageRef: "uploads/p1.jpg",
                isPrimary: true,
                moderationStatus: "approved",
              },
            ],
          },
        },
      ]);

      const res = await request(app).get("/api/v1/matches");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);

      const matchItem = res.body.data[0];
      expect(matchItem.id).toBe(VALID_MATCH_ID_1);
      expect(matchItem.status).toBe("active");
      expect(matchItem.user.user_id).toBe(OTHER_USER_ID);
      expect(matchItem.user.display_name).toBe("Sharanya");
      expect(matchItem.user.age).toBeDefined();

      // Privacy verification: NO sensitive attributes exposed
      expect(matchItem.user.date_of_birth).toBeUndefined();
      expect(matchItem.user.phone).toBeUndefined();
      expect(matchItem.user.access_token).toBeUndefined();
      expect(matchItem.user.refresh_token).toBeUndefined();
      expect(matchItem.user.location.latitude).toBeUndefined();
      expect(matchItem.user.location.longitude).toBeUndefined();
      expect(matchItem.user.location.city).toBe("Bengaluru");
    });

    it("should return empty list when authenticated user has no matches", async () => {
      Match.findAll.mockResolvedValue([]);
      User.findAll.mockResolvedValue([]);

      const res = await request(app).get("/api/v1/matches");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.count).toBe(0);
      expect(res.body.pagination.has_more).toBe(false);
    });

    it("should reject invalid cursor with 400", async () => {
      const res = await request(app).get("/api/v1/matches?cursor=not-a-uuid");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("cursor");
    });
  });

  describe("2. DELETE /api/v1/matches/:match_id — Unmatching & Authorization", () => {
    it("should reject invalid match_id format with 400", async () => {
      const res = await request(app).delete("/api/v1/matches/invalid-uuid");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Valid Match ID");
    });

    it("should return 404 when match does not exist", async () => {
      Match.findByPk.mockResolvedValue(null);

      const res = await request(app).delete(`/api/v1/matches/${VALID_MATCH_ID_1}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Match not found");
    });

    it("should return 403 when authenticated user is not a participant in the match", async () => {
      const mockUnrelatedMatch = {
        id: UNRELATED_MATCH_ID,
        userAId: THIRD_USER_ID,
        userBId: FOURTH_USER_ID,
        status: "active",
      };

      Match.findByPk.mockResolvedValue(mockUnrelatedMatch);

      const res = await request(app).delete(`/api/v1/matches/${UNRELATED_MATCH_ID}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("not authorized");
    });

    it("should successfully unmatch when authenticated user is userA", async () => {
      const mockMatch = {
        id: VALID_MATCH_ID_1,
        userAId: CURRENT_USER_ID,
        userBId: OTHER_USER_ID,
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app).delete(`/api/v1/matches/${VALID_MATCH_ID_1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Unmatched successfully");
      expect(res.body.data.status).toBe("unmatched");
      expect(mockMatch.status).toBe("unmatched");
      expect(mockMatch.save).toHaveBeenCalled();
    });

    it("should successfully unmatch when authenticated user is userB", async () => {
      const mockMatch = {
        id: VALID_MATCH_ID_2,
        userAId: OTHER_USER_ID,
        userBId: CURRENT_USER_ID,
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app).delete(`/api/v1/matches/${VALID_MATCH_ID_2}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMatch.status).toBe("unmatched");
      expect(mockMatch.save).toHaveBeenCalled();
    });

    it("should return 200 idempotently if match is already unmatched", async () => {
      const mockMatch = {
        id: VALID_MATCH_ID_1,
        userAId: CURRENT_USER_ID,
        userBId: OTHER_USER_ID,
        status: "unmatched",
      };

      Match.findByPk.mockResolvedValue(mockMatch);

      const res = await request(app).delete(`/api/v1/matches/${VALID_MATCH_ID_1}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("unmatched");
    });
  });

  describe("3. Authentication Enforcement", () => {
    it("should reject unauthenticated requests with 401", async () => {
      mockAuthUserId = null;

      const getRes = await request(app).get("/api/v1/matches");
      expect(getRes.status).toBe(401);

      const delRes = await request(app).delete(`/api/v1/matches/${VALID_MATCH_ID_1}`);
      expect(delRes.status).toBe(401);
    });
  });
});
