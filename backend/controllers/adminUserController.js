const { Op } = require("sequelize");
const { User, Profile } = require("../models");

// Explicit allowlist of sort fields to prevent SQL injection and invalid column names
const ALLOWED_SORT_FIELDS = {
  createdAt: "created_at",
  created_at: "created_at",
  phone: "phone",
  verificationStatus: "verification_status",
  verification_status: "verification_status",
  accountStatus: "account_status",
  account_status: "account_status",
};

const ALLOWED_SORT_ORDERS = ["ASC", "DESC"];

const ALLOWED_ACCOUNT_STATUSES = ["active", "suspended", "delete"];
const ALLOWED_VERIFICATION_STATUSES = [
  "not_started",
  "pending",
  "approved",
  "retry_required",
  "rejected",
  "expired",
];

/**
 * GET /api/v1/admin/users
 * Paginated admin user search and inspection.
 * Query Parameters:
 * - page: default 1 (must be positive integer)
 * - limit: default 20 (max 100)
 * - search: optional search string (searches user phone and profile display name safely)
 * - status: optional account_status filter ('active', 'suspended', 'delete')
 * - verification_status: optional verification status filter
 * - sortBy: default 'created_at'
 * - sortOrder: default 'DESC'
 */
exports.getUsers = async (req, res, next) => {
  try {
    const query = req.query || {};

    // 1. Validate pagination
    let page = 1;
    if (query.page !== undefined) {
      const parsedPage = parseInt(query.page, 10);
      if (isNaN(parsedPage) || !Number.isInteger(Number(query.page)) || parsedPage < 1) {
        return res.status(422).json({
          success: false,
          message: "page must be a positive integer greater than or equal to 1.",
        });
      }
      page = parsedPage;
    }

    let limit = 20;
    if (query.limit !== undefined) {
      const parsedLimit = parseInt(query.limit, 10);
      if (isNaN(parsedLimit) || !Number.isInteger(Number(query.limit)) || parsedLimit < 1 || parsedLimit > 100) {
        return res.status(422).json({
          success: false,
          message: "limit must be an integer between 1 and 100.",
        });
      }
      limit = parsedLimit;
    }

    // 2. Validate sort options against allowlist
    const rawSortBy = query.sortBy || "created_at";
    if (!ALLOWED_SORT_FIELDS[rawSortBy]) {
      return res.status(422).json({
        success: false,
        message: `Invalid sortBy field. Allowed fields: ${Object.keys(ALLOWED_SORT_FIELDS).join(", ")}.`,
      });
    }
    const safeSortBy = ALLOWED_SORT_FIELDS[rawSortBy];

    const rawSortOrder = (query.sortOrder || "DESC").toUpperCase();
    if (!ALLOWED_SORT_ORDERS.includes(rawSortOrder)) {
      return res.status(422).json({
        success: false,
        message: "sortOrder must be either 'ASC' or 'DESC'.",
      });
    }

    // 3. Build where clauses safely
    const userWhere = {};

    // Status filter
    if (query.status !== undefined && query.status !== "") {
      const normalizedStatus = String(query.status).toLowerCase();
      if (!ALLOWED_ACCOUNT_STATUSES.includes(normalizedStatus)) {
        return res.status(422).json({
          success: false,
          message: `Invalid status filter. Allowed values: ${ALLOWED_ACCOUNT_STATUSES.join(", ")}.`,
        });
      }
      userWhere.accountStatus = normalizedStatus;
    }

    // Verification status filter
    if (query.verification_status !== undefined && query.verification_status !== "") {
      const normalizedVerif = String(query.verification_status).toLowerCase();
      if (!ALLOWED_VERIFICATION_STATUSES.includes(normalizedVerif)) {
        return res.status(422).json({
          success: false,
          message: `Invalid verification_status filter. Allowed values: ${ALLOWED_VERIFICATION_STATUSES.join(", ")}.`,
        });
      }
      userWhere.verificationStatus = normalizedVerif;
    }

    // Search filter: parameterized query on phone or profile displayName
    const profileInclude = {
      model: Profile,
      as: "profile",
      attributes: ["id", "displayName", "gender", "datingIntention", "datingSpeed", "onboardingStatus"],
      required: false,
    };

    if (query.search && typeof query.search === "string" && query.search.trim().length > 0) {
      const searchTerm = `%${query.search.trim()}%`;
      userWhere[Op.or] = [
        { phone: { [Op.iLike]: searchTerm } },
        { "$profile.display_name$": { [Op.iLike]: searchTerm } },
      ];
    }

    const offset = (page - 1) * limit;

    const { count, rows: users } = await User.findAndCountAll({
      where: userWhere,
      include: [profileInclude],
      attributes: [
        "id",
        "phone",
        "dateOfBirth",
        "ageEligible",
        "verificationStatus",
        "accountStatus",
        "createdAt",
        "updatedAt",
      ],
      order: [[safeSortBy, rawSortOrder]],
      limit,
      offset,
      distinct: true,
    });

    const totalPages = Math.ceil(count / limit) || 1;

    // Format safe response (never exposes tokens, passwords, sessions, or private coordinates)
    const formattedUsers = users.map((user) => {
      const profile = user.profile;
      return {
        id: user.id,
        phone: user.phone,
        date_of_birth: user.dateOfBirth,
        age_eligible: user.ageEligible,
        verification_status: user.verificationStatus,
        account_status: user.accountStatus,
        profile: profile
          ? {
              id: profile.id,
              display_name: profile.displayName || null,
              gender: profile.gender || null,
              dating_intention: profile.datingIntention || null,
              dating_speed: profile.datingSpeed || null,
              onboarding_status: profile.onboardingStatus,
            }
          : null,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        users: formattedUsers,
        pagination: {
          page,
          limit,
          total_records: count,
          total_pages: totalPages,
          has_more: page < totalPages,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
