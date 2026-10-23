const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../app");
const {
  sequelize,
  StaffUser,
  User,
  Profile,
  Match,
  Conversation,
  Message,
  ProfileMedia,
  AuthSession,
} = require("../models");
const adminMfaService = require("../services/adminMfaService");

describe("Admin APIs Suite — Auth, Dashboard, User Search & Security", () => {
  let superAdminUser;
  let adminUser;
  let moderatorUser;
  let disabledStaff;
  let lockedStaff;
  let noMfaStaff;

  let validSuperAdminToken;
  let validAdminToken;
  let validModeratorToken;

  let datingUser;
  let datingUserSession;
  let datingUserToken;

  const TEST_PASSWORD = "TestAdminSecretPassword123!";

  beforeAll(async () => {
    // Ensure test environment
    await sequelize.authenticate();
    await sequelize.sync();

    const salt = await bcrypt.genSalt(8);
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, salt);

    // Create staff users
    superAdminUser = await StaffUser.create({
      email: "test_superadmin@spark.internal",
      passwordHash,
      firstName: "Super",
      lastName: "Admin",
      role: "super_admin",
      status: "active",
      mfaEnabled: true,
      mfaSecret: "JBSWY3DPEHPK3PXP",
    });

    adminUser = await StaffUser.create({
      email: "test_admin@spark.internal",
      passwordHash,
      firstName: "Reg",
      lastName: "Admin",
      role: "admin",
      status: "active",
      mfaEnabled: true,
      mfaSecret: "JBSWY3DPEHPK3PXP",
    });

    moderatorUser = await StaffUser.create({
      email: "test_moderator@spark.internal",
      passwordHash,
      firstName: "Mod",
      lastName: "Staff",
      role: "moderator",
      status: "active",
      mfaEnabled: true,
      mfaSecret: "JBSWY3DPEHPK3PXP",
    });

    noMfaStaff = await StaffUser.create({
      email: "test_nomfa@spark.internal",
      passwordHash,
      firstName: "No",
      lastName: "Mfa",
      role: "admin",
      status: "active",
      mfaEnabled: false,
      mfaSecret: null,
    });

    disabledStaff = await StaffUser.create({
      email: "test_disabled@spark.internal",
      passwordHash,
      firstName: "Disabled",
      lastName: "Staff",
      role: "admin",
      status: "disabled",
      mfaEnabled: false,
      mfaSecret: null,
    });

    lockedStaff = await StaffUser.create({
      email: "test_locked@spark.internal",
      passwordHash,
      firstName: "Locked",
      lastName: "Staff",
      role: "admin",
      status: "locked",
      mfaEnabled: false,
      mfaSecret: null,
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000),
    });

    const adminSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET;

    validSuperAdminToken = jwt.sign(
      { role: "super_admin", email: superAdminUser.email },
      adminSecret,
      {
        subject: superAdminUser.id,
        expiresIn: "1h",
        issuer: "spark-admin",
        audience: "spark-admin-portal",
      }
    );

    validAdminToken = jwt.sign(
      { role: "admin", email: adminUser.email },
      adminSecret,
      {
        subject: adminUser.id,
        expiresIn: "1h",
        issuer: "spark-admin",
        audience: "spark-admin-portal",
      }
    );

    validModeratorToken = jwt.sign(
      { role: "moderator", email: moderatorUser.email },
      adminSecret,
      {
        subject: moderatorUser.id,
        expiresIn: "1h",
        issuer: "spark-admin",
        audience: "spark-admin-portal",
      }
    );

    // Create an ordinary dating user and mobile user token
    datingUser = await User.create({
      phone: "+919876543210",
      dateOfBirth: "1997-04-12",
      ageEligible: true,
      verificationStatus: "approved",
      accountStatus: "active",
    });

    await Profile.create({
      userId: datingUser.id,
      displayName: "Alice In Wonderland",
      gender: "female",
      onboardingStatus: "completed",
    });

    datingUserSession = await AuthSession.create({
      userId: datingUser.id,
      refreshTokenHash: "testhash" + Math.random().toString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    datingUserToken = jwt.sign(
      { sessionId: datingUserSession.id },
      process.env.JWT_ACCESS_SECRET,
      {
        subject: datingUser.id,
        expiresIn: "15m",
        issuer: "spark-api",
        audience: "spark-mobile",
      }
    );
  });

  afterAll(async () => {
    // Clean up created records
    try {
      if (datingUserSession) await datingUserSession.destroy();
      if (datingUser) {
        await Profile.destroy({ where: { userId: datingUser.id } });
        await datingUser.destroy();
      }
      await StaffUser.destroy({
        where: {
          email: [
            "test_superadmin@spark.internal",
            "test_admin@spark.internal",
            "test_moderator@spark.internal",
            "test_nomfa@spark.internal",
            "test_disabled@spark.internal",
            "test_locked@spark.internal",
          ],
        },
      });
      await sequelize.close();
    } catch (err) {
      console.warn("Cleanup error:", err.message);
    }
  });

  describe("1. Admin Authentication (POST /api/v1/admin/auth/login & /api/v1/admin/auth/mfa/verify)", () => {
    it("should reject login when email or password is missing", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_admin@spark.internal" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/required/i);
    });

    it("should reject login with non-existent staff email", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "ghost@spark.internal", password: TEST_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it("should reject login with invalid password", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_admin@spark.internal", password: "WrongPassword123" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it("should reject disabled staff account", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_disabled@spark.internal", password: TEST_PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/disabled/i);
    });

    it("should reject locked staff account", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_locked@spark.internal", password: TEST_PASSWORD });

      expect(res.status).toBe(423);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/locked/i);
    });

    it("should return mfa_required: true and temporary mfa_token when MFA policy is enforced", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_admin@spark.internal", password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mfa_required).toBe(true);
      expect(res.body.mfa_token).toBeDefined();
      expect(res.body.access_token).toBeUndefined(); // Must NOT issue full access token yet!
    });

    it("should issue full admin access token directly when MFA is disabled for that staff user", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_nomfa@spark.internal", password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mfa_required).toBe(false);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe("admin");
      expect(res.body.user.password_hash).toBeUndefined(); // Never expose password hash!
    });

    it("should reject MFA verify with missing or invalid parameters", async () => {
      const res = await request(app)
        .post("/api/v1/admin/auth/mfa/verify")
        .send({ mfa_token: "not-a-token", mfa_code: "12" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it("should reject MFA verify with invalid TOTP code", async () => {
      // 1. Login to get valid mfa_token
      const loginRes = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_admin@spark.internal", password: TEST_PASSWORD });

      const mfaToken = loginRes.body.mfa_token;

      // 2. Send invalid code (e.g. 000000)
      const res = await request(app)
        .post("/api/v1/admin/auth/mfa/verify")
        .send({ mfa_token: mfaToken, mfa_code: "000000" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid or expired MFA code/i);
    });

    it("should issue full admin token upon valid TOTP verification", async () => {
      const loginRes = await request(app)
        .post("/api/v1/admin/auth/login")
        .send({ email: "test_admin@spark.internal", password: TEST_PASSWORD });

      const mfaToken = loginRes.body.mfa_token;
      // In non-production test mode, adminMfaService supports code 123456 or calculated TOTP
      const validTotp = adminMfaService.generateTOTP("JBSWY3DPEHPK3PXP");

      const res = await request(app)
        .post("/api/v1/admin/auth/mfa/verify")
        .send({ mfa_token: mfaToken, mfa_code: validTotp });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.token_type).toBe("Bearer");
      expect(res.body.user.email).toBe("test_admin@spark.internal");
      expect(res.body.user.password_hash).toBeUndefined();
      expect(res.body.user.mfa_secret).toBeUndefined();
    });
  });

  describe("Security & Guardrails across Protected Admin Endpoints", () => {
    it("should reject requests with missing authorization header", async () => {
      const res = await request(app).get("/api/v1/admin/dashboard");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/authentication required/i);
    });

    it("should reject requests with invalid or expired admin token", async () => {
      const res = await request(app)
        .get("/api/v1/admin/dashboard")
        .set("Authorization", "Bearer invalid.jwt.token");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid or expired/i);
    });

    it("should reject ordinary user token on admin endpoints (cross-token rejection)", async () => {
      const res = await request(app)
        .get("/api/v1/admin/dashboard")
        .set("Authorization", `Bearer ${datingUserToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid or expired/i);
    });

    it("should reject ordinary user token on admin users endpoint", async () => {
      const res = await request(app)
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${datingUserToken}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("2. Admin Dashboard (GET /api/v1/admin/dashboard)", () => {
    it("should allow super_admin and admin roles to view dashboard", async () => {
      const res = await request(app)
        .get("/api/v1/admin/dashboard")
        .set("Authorization", `Bearer ${validAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const { users, profiles, activity, moderation, definitions } = res.body.data;
      expect(users).toBeDefined();
      expect(typeof users.total).toBe("number");
      expect(typeof users.active).toBe("number");
      expect(typeof users.new_last_7_days).toBe("number");
      expect(typeof users.new_last_24_hours).toBe("number");

      expect(profiles).toBeDefined();
      expect(typeof profiles.completed).toBe("number");

      expect(activity).toBeDefined();
      expect(typeof activity.active_matches).toBe("number");
      expect(typeof activity.conversations).toBe("number");

      expect(moderation).toBeDefined();
      expect(typeof moderation.pending_media_reviews).toBe("number");
      expect(typeof moderation.pending_reports).toBe("number");

      expect(definitions).toBeDefined();
      expect(definitions.new_users_time_window).toBeDefined();
    });

    it("should reject moderator role from viewing dashboard (insufficient permissions)", async () => {
      const res = await request(app)
        .get("/api/v1/admin/dashboard")
        .set("Authorization", `Bearer ${validModeratorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/insufficient permissions/i);
    });
  });

  describe("3. Paginated Admin User Search (GET /api/v1/admin/users)", () => {
    it("should return paginated list of users for moderator, admin, and super_admin", async () => {
      const res = await request(app)
        .get("/api/v1/admin/users?page=1&limit=10")
        .set("Authorization", `Bearer ${validModeratorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.users)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(10);
      expect(typeof res.body.data.pagination.total_records).toBe("number");
    });

    it("should never expose sensitive internal fields like password hashes, OTPs, or session tokens", async () => {
      const res = await request(app)
        .get("/api/v1/admin/users?limit=10")
        .set("Authorization", `Bearer ${validAdminToken}`);

      expect(res.status).toBe(200);
      const users = res.body.data.users;
      for (const u of users) {
        expect(u.password_hash).toBeUndefined();
        expect(u.passwordHash).toBeUndefined();
        expect(u.otp_hash).toBeUndefined();
        expect(u.mfa_secret).toBeUndefined();
        expect(u.refresh_token_hash).toBeUndefined();
        expect(u.auth_sessions).toBeUndefined();
      }
    });

    it("should filter users by search keyword (phone or profile name)", async () => {
      const res = await request(app)
        .get("/api/v1/admin/users?search=Alice")
        .set("Authorization", `Bearer ${validAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.users.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.users.find((u) => u.phone === "+919876543210");
      expect(found).toBeDefined();
      expect(found.profile.display_name).toBe("Alice In Wonderland");
    });

    it("should filter users by status", async () => {
      const res = await request(app)
        .get("/api/v1/admin/users?status=active")
        .set("Authorization", `Bearer ${validAdminToken}`);

      expect(res.status).toBe(200);
      for (const u of res.body.data.users) {
        expect(u.account_status).toBe("active");
      }
    });

    it("should reject invalid pagination values", async () => {
      const res1 = await request(app)
        .get("/api/v1/admin/users?page=0")
        .set("Authorization", `Bearer ${validAdminToken}`);
      expect(res1.status).toBe(422);

      const res2 = await request(app)
        .get("/api/v1/admin/users?limit=150")
        .set("Authorization", `Bearer ${validAdminToken}`);
      expect(res2.status).toBe(422);

      const res3 = await request(app)
        .get("/api/v1/admin/users?page=-5")
        .set("Authorization", `Bearer ${validAdminToken}`);
      expect(res3.status).toBe(422);
    });

    it("should reject invalid sort field and invalid sort order (SQL injection protection)", async () => {
      const res1 = await request(app)
        .get("/api/v1/admin/users?sortBy=password_hash;DROP TABLE users;--")
        .set("Authorization", `Bearer ${validAdminToken}`);
      expect(res1.status).toBe(422);
      expect(res1.body.message).toMatch(/invalid sortBy field/i);

      const res2 = await request(app)
        .get("/api/v1/admin/users?sortBy=phone&sortOrder=INVALID_ORDER")
        .set("Authorization", `Bearer ${validAdminToken}`);
      expect(res2.status).toBe(422);
      expect(res2.body.message).toMatch(/sortOrder must be either/i);
    });

    it("should reject invalid status filter value", async () => {
      const res = await request(app)
        .get("/api/v1/admin/users?status=hacked_status")
        .set("Authorization", `Bearer ${validAdminToken}`);
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/invalid status filter/i);
    });
  });
});
