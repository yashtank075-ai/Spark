const request = require("supertest");
const express = require("express");
const profileRoutes = require("../routes/profileRoutes");
const User = require("../models/User");
const Profile = require("../models/Profile");
const ProfileMedia = require("../models/ProfileMedia");
const MediaUpload = require("../models/MediaUpload");

jest.mock("../middleware/authenticate", () => (req, res, next) => {
  req.auth = { userId: "user-123", sessionId: "sess-123" };
  req.user = { id: "user-123", accountStatus: "active", dateOfBirth: "1990-01-01", ageEligible: true, save: jest.fn() };
  next();
});

jest.mock("../models/User");
jest.mock("../models/Profile");
jest.mock("../models/ProfileMedia");
jest.mock("../models/MediaUpload");

const app = express();
app.use(express.json());
app.use("/api/v1", profileRoutes);

describe("Profile Onboarding APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/v1/me/profile", () => {
    it("should return 200 with full profile structure when profile exists", async () => {
      User.findByPk.mockResolvedValue({
        id: "user-123",
        dateOfBirth: "1998-10-14",
        ageEligible: true,
      });

      Profile.findOne.mockResolvedValue({
        id: "profile-1",
        userId: "user-123",
        displayName: "Sharanya",
        gender: "female",
        showGenderOnProfile: true,
        datingIntention: "explore",
        datingSpeed: "slow",
        interests: ["specialty_coffee", "filter_coffee_dosas"],
        bio: "Architect by day, exploring indie bookstores.",
        prompts: [{ question: "My ideal weekend", answer: "Coffee and road trips." }],
        boundaries: ["Honest communication"],
        boundaryPreferences: { quiet_hours: { enabled: true, start_time: "23:00", end_time: "08:00" } },
        preferences: { interested_in: ["female"], age_min: 23, age_max: 32, distance_km: 25 },
        location: { city: "Bengaluru", state: "Karnataka", country: "India", latitude: 12.9716, longitude: 77.5946, source: "device" },
        onboardingStatus: "in_progress",
      });

      ProfileMedia.findAll.mockResolvedValue([
        {
          id: "photo-1",
          userId: "user-123",
          mediaType: "photo",
          storageRef: "uploads/test1.jpg",
          isPrimary: true,
          displayOrder: 0,
          moderationStatus: "pending",
        },
      ]);

      const res = await request(app).get("/api/v1/me/profile");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.display_name).toBe("Sharanya");
      expect(res.body.data.gender).toBe("female");
      expect(res.body.data.show_gender_on_profile).toBe(true);
      expect(res.body.data.dating_intention).toBe("explore");
      expect(res.body.data.dating_speed).toBe("slow");
      expect(res.body.data.interests).toEqual(["specialty_coffee", "filter_coffee_dosas"]);
      expect(res.body.data.bio).toContain("Architect");
      expect(res.body.data.photos).toHaveLength(1);
      expect(res.body.data.photos[0].is_primary).toBe(true);
      expect(res.body.data.photos[0].url).toContain("test1.jpg");
      expect(res.body.data.location.city).toBe("Bengaluru");
      expect(res.body.age_eligible).toBe(true);
    });

    it("should return not_started status when no profile found", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123", ageEligible: true, dateOfBirth: null });
      Profile.findOne.mockResolvedValue(null);

      const res = await request(app).get("/api/v1/me/profile");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
      expect(res.body.onboarding_status).toBe("not_started");
    });
  });

  describe("Step 1: PATCH /api/v1/me/profile - About You & Connection Preferences", () => {
    it("should atomically save display_name, date_of_birth, gender, show_gender_on_profile, preferences, dating_intention, dating_speed", async () => {
      const mockUser = {
        id: "user-123",
        dateOfBirth: null,
        ageEligible: false,
        save: jest.fn().mockResolvedValue(true),
      };
      User.findByPk.mockResolvedValue(mockUser);

      const mockProfile = {
        id: "profile-1",
        userId: "user-123",
        onboardingStatus: "not_started",
        save: jest.fn().mockResolvedValue(true),
      };
      Profile.findOne.mockResolvedValue(mockProfile);

      const payload = {
        display_name: "Sharanya",
        date_of_birth: "1998-10-14",
        gender: "female",
        show_gender_on_profile: true,
        preferences: {
          interested_in: ["female"],
          age_min: 23,
          age_max: 32,
          distance_km: 25,
        },
        dating_intention: "explore",
        dating_speed: "slow",
      };

      const res = await request(app).patch("/api/v1/me/profile").send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onboarding_status).toBe("in_progress");
      expect(res.body.age_eligible).toBe(true);

      expect(mockUser.dateOfBirth).toBe("1998-10-14");
      expect(mockUser.ageEligible).toBe(true);
      expect(mockUser.save).toHaveBeenCalled();

      expect(mockProfile.displayName).toBe("Sharanya");
      expect(mockProfile.gender).toBe("female");
      expect(mockProfile.showGenderOnProfile).toBe(true);
      expect(mockProfile.datingIntention).toBe("explore");
      expect(mockProfile.datingSpeed).toBe("slow");
      expect(mockProfile.preferences.interested_in).toEqual(["female"]);
      expect(mockProfile.save).toHaveBeenCalled();
    });

    it("should reject underage date_of_birth with 422", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123", dateOfBirth: null });
      Profile.findOne.mockResolvedValue({ id: "profile-1" });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .send({ date_of_birth: "2015-01-01" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.details.date_of_birth).toBeDefined();
    });

    it("should reject invalid dating_intention with 422", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      Profile.findOne.mockResolvedValue({ id: "profile-1" });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .send({ dating_intention: "unsupported_intention" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.details.dating_intention).toBeDefined();
    });

    it("should reject invalid dating_speed with 422", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      Profile.findOne.mockResolvedValue({ id: "profile-1" });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .send({ dating_speed: "hyper_speed" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.details.dating_speed).toBeDefined();
    });

    it("should reject unknown/unsupported fields with 422", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      Profile.findOne.mockResolvedValue({ id: "profile-1" });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .send({ unknown_field: "value" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.details.unknown_field).toBeDefined();
    });
  });

  describe("Step 2: PATCH /api/v1/me/profile - Passions, Bio & Prompts", () => {
    it("should save interests, bio and prompts without erasing previous fields", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123", dateOfBirth: "1998-10-14", ageEligible: true });
      const mockProfile = {
        id: "profile-1",
        userId: "user-123",
        displayName: "Sharanya",
        gender: "female",
        datingIntention: "explore",
        onboardingStatus: "in_progress",
        save: jest.fn().mockResolvedValue(true),
      };
      Profile.findOne.mockResolvedValue(mockProfile);

      const payload = {
        interests: [
          "specialty_coffee",
          "filter_coffee_dosas",
          "rooftop_cocktails",
          "indie_gigs",
          "heritage_architecture",
          "morning_yoga",
          "weekend_getaways",
          "coastal_sunsets",
        ],
        bio: "Architect by day, exploring indie bookstores and heritage cafes by sunset.",
        prompts: [
          {
            question: "The hallmark of a perfect Sunday afternoon for me is...",
            answer: "Browsing old records on Church Street and enjoying a quiet afternoon.",
          },
          {
            question: "Together, we could finally...",
            answer: "Drive to Coorg during the monsoon.",
          },
        ],
      };

      const res = await request(app).patch("/api/v1/me/profile").send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify new fields were assigned and previous fields preserved
      expect(mockProfile.displayName).toBe("Sharanya");
      expect(mockProfile.gender).toBe("female");
      expect(mockProfile.datingIntention).toBe("explore");
      expect(mockProfile.interests).toHaveLength(8);
      expect(mockProfile.bio).toContain("Architect");
      expect(mockProfile.prompts).toHaveLength(2);
      expect(mockProfile.save).toHaveBeenCalled();
    });

    it("should reject duplicate interests or duplicate prompt questions", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      Profile.findOne.mockResolvedValue({ id: "profile-1" });

      const dupInterestsRes = await request(app)
        .patch("/api/v1/me/profile")
        .send({ interests: ["specialty_coffee", "specialty_coffee"] });

      expect(dupInterestsRes.status).toBe(422);
      expect(dupInterestsRes.body.details.interests).toContain("Duplicate");

      const dupPromptsRes = await request(app)
        .patch("/api/v1/me/profile")
        .send({
          prompts: [
            { question: "Q1", answer: "A1" },
            { question: "Q1", answer: "A2" },
          ],
        });

      expect(dupPromptsRes.status).toBe(422);
      expect(dupPromptsRes.body.details.prompts).toContain("Duplicate");
    });
  });

  describe("Step 3: Photos retrieval and reordering", () => {
    it("GET /api/v1/me/photos should return photo list", async () => {
      ProfileMedia.findAll.mockResolvedValue([
        {
          id: "photo-1",
          userId: "user-123",
          mediaType: "photo",
          storageRef: "uploads/p1.jpg",
          isPrimary: true,
          displayOrder: 0,
          moderationStatus: "approved",
        },
        {
          id: "photo-2",
          userId: "user-123",
          mediaType: "photo",
          storageRef: "uploads/p2.jpg",
          isPrimary: false,
          displayOrder: 1,
          moderationStatus: "pending",
        },
      ]);

      const res = await request(app).get("/api/v1/me/photos");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].id).toBe("photo-1");
      expect(res.body.data[0].is_primary).toBe(true);
    });

    it("PATCH /api/v1/me/photos/order should reorder photos and update primary", async () => {
      const p1 = { id: "photo-1", userId: "user-123", displayOrder: 0, isPrimary: true, storageRef: "uploads/p1.jpg", save: jest.fn().mockResolvedValue(true) };
      const p2 = { id: "photo-2", userId: "user-123", displayOrder: 1, isPrimary: false, storageRef: "uploads/p2.jpg", save: jest.fn().mockResolvedValue(true) };

      ProfileMedia.findAll
        .mockResolvedValueOnce([p1, p2]) // for validation
        .mockResolvedValueOnce([p2, p1]); // for return

      const res = await request(app)
        .patch("/api/v1/me/photos/order")
        .send({
          photo_ids: ["photo-2", "photo-1"],
          primary_photo_id: "photo-2",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(p2.displayOrder).toBe(0);
      expect(p2.isPrimary).toBe(true);
      expect(p1.displayOrder).toBe(1);
      expect(p1.isPrimary).toBe(false);
    });

    it("PATCH /api/v1/me/photos/order should reject photos not belonging to user", async () => {
      ProfileMedia.findAll.mockResolvedValue([{ id: "photo-1", userId: "user-123" }]);

      const res = await request(app)
        .patch("/api/v1/me/photos/order")
        .send({ photo_ids: ["photo-999"] });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Step 4: Voice Introduction & Boundaries", () => {
    it("should update boundaries and structured boundary_preferences", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      const mockProfile = {
        id: "profile-1",
        boundaries: [],
        boundaryPreferences: {},
        save: jest.fn().mockResolvedValue(true),
      };
      Profile.findOne.mockResolvedValue(mockProfile);

      const payload = {
        boundaries: ["Honest communication", "Respect for personal space"],
        boundary_preferences: {
          quiet_hours: {
            enabled: true,
            start_time: "23:00",
            end_time: "08:00",
          },
          physical_pace: "comfortable_taking_time",
          dating_environment: ["public_daytime_venues", "no_alcohol_on_first_dates"],
          off_app_transition: "after_first_in_person_date",
        },
      };

      const res = await request(app).patch("/api/v1/me/profile").send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockProfile.boundaries).toEqual(["Honest communication", "Respect for personal space"]);
      expect(mockProfile.boundaryPreferences.quiet_hours.enabled).toBe(true);
      expect(mockProfile.save).toHaveBeenCalled();
    });

    it("DELETE /api/v1/me/voice-intro should delete voice intro if present", async () => {
      const mockAudio = {
        id: "voice-1",
        userId: "user-123",
        storageRef: "uploads/voice.mp3",
        destroy: jest.fn().mockResolvedValue(true),
      };
      ProfileMedia.findOne.mockResolvedValue(mockAudio);

      const res = await request(app).delete("/api/v1/me/voice-intro");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAudio.destroy).toHaveBeenCalled();
    });
  });

  describe("Step 5: Location & Discovery preferences", () => {
    it("should save location and preserve discovery preferences", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      const mockProfile = {
        id: "profile-1",
        preferences: { distance_km: 25, interested_in: ["female"] },
        location: {},
        save: jest.fn().mockResolvedValue(true),
      };
      Profile.findOne.mockResolvedValue(mockProfile);

      const payload = {
        location: {
          city: "Bengaluru",
          state: "Karnataka",
          country: "India",
          latitude: 12.9716,
          longitude: 77.5946,
          source: "device",
        },
        preferences: {
          distance_km: 30,
        },
      };

      const res = await request(app).patch("/api/v1/me/profile").send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockProfile.location.city).toBe("Bengaluru");
      expect(mockProfile.location.latitude).toBe(12.9716);
      expect(mockProfile.preferences.distance_km).toBe(30);
      expect(mockProfile.preferences.interested_in).toEqual(["female"]); // Preserved
    });

    it("should accept combined location with coordinates [lng, lat] and boundaries simultaneously (v2 Step 4)", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      const mockProfile = {
        id: "profile-1",
        boundaries: [],
        location: {},
        save: jest.fn().mockResolvedValue(true),
      };
      Profile.findOne.mockResolvedValue(mockProfile);

      const payload = {
        location: {
          city: "Indiranagar, Bengaluru",
          coordinates: [77.6412, 12.9784],
        },
        boundaries: [
          "Honest communication",
          "Respect for personal space",
        ],
      };

      const res = await request(app).patch("/api/v1/me/profile").send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockProfile.location.city).toBe("Indiranagar, Bengaluru");
      expect(mockProfile.location.coordinates).toEqual([77.6412, 12.9784]);
      expect(mockProfile.boundaries).toEqual([
        "Honest communication",
        "Respect for personal space",
      ]);
      expect(mockProfile.save).toHaveBeenCalled();
    });

    it("should reject invalid coordinates with 422", async () => {
      User.findByPk.mockResolvedValue({ id: "user-123" });
      Profile.findOne.mockResolvedValue({ id: "profile-1" });

      const res = await request(app)
        .patch("/api/v1/me/profile")
        .send({ location: { latitude: 150 } });

      expect(res.status).toBe(422);
      expect(res.body.details["location.latitude"]).toBeDefined();
    });
  });

  describe("Backward Compatibility: PATCH /api/v1/profile/intention", () => {
    it("should update intention successfully", async () => {
      Profile.findOne.mockResolvedValue({ userId: "user-123", save: jest.fn() });

      const res = await request(app)
        .patch("/api/v1/profile/intention")
        .send({ intention: "vibe" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should reject invalid intention", async () => {
      const res = await request(app)
        .patch("/api/v1/profile/intention")
        .send({ intention: "invalid" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Step 6: POST /api/v1/me/onboarding/complete", () => {
    it("should complete onboarding when all mandatory data is present", async () => {
      User.findByPk.mockResolvedValue({
        id: "user-123",
        dateOfBirth: "1998-10-14",
        ageEligible: true,
      });

      const mockProfile = {
        displayName: "Sharanya",
        gender: "female",
        datingIntention: "explore",
        datingSpeed: "slow",
        location: { city: "Bengaluru" },
        save: jest.fn().mockResolvedValue(true),
      };
      Profile.findOne.mockResolvedValue(mockProfile);

      ProfileMedia.count.mockResolvedValue(2); // Has photos

      const res = await request(app).post("/api/v1/me/onboarding/complete");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.onboarding_status).toBe("completed");
      expect(mockProfile.save).toHaveBeenCalled();
    });

    it("should reject completion with 422 if mandatory profile fields are missing", async () => {
      User.findByPk.mockResolvedValue({
        id: "user-123",
        dateOfBirth: "1998-10-14",
        ageEligible: true,
      });

      Profile.findOne.mockResolvedValue({
        displayName: "Sharanya",
        gender: null, // missing gender
        datingIntention: null,
        datingSpeed: null,
        location: null,
      });

      ProfileMedia.count.mockResolvedValue(0); // missing photos

      const res = await request(app).post("/api/v1/me/onboarding/complete");

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.details).toContain("gender");
      expect(res.body.details).toContain("dating_intention");
      expect(res.body.details).toContain("dating_speed");
      expect(res.body.details).toContain("location");
      expect(res.body.details).toContain("photos");
    });

    it("should reject completion with 403 if user is underage or lacks DOB", async () => {
      User.findByPk.mockResolvedValue({
        id: "user-123",
        dateOfBirth: null,
        ageEligible: false,
      });

      Profile.findOne.mockResolvedValue({ displayName: "Test" });

      const res = await request(app).post("/api/v1/me/onboarding/complete");

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
