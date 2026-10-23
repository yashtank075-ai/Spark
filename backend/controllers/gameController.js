const { Op } = require("sequelize");
const sequelize = require("../config/db");
const {
  GameCatalog,
  GameSession,
  GameAnswer,
  Conversation,
  Match,
  User,
  Profile,
  Block,
} = require("../models");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_GAME_TYPES = ["vibe_check", "secret_answers"];

/**
 * Format participant profile safely (never leaks DOB, coordinates, phone)
 */
function formatSafeParticipant(user, profile) {
  if (!user) return null;
  return {
    user_id: user.id,
    display_name: profile ? profile.displayName : null,
    account_status: user.accountStatus,
  };
}

/**
 * Helper to check bidirectional blocks between two users
 */
async function checkBidirectionalBlock(userId1, userId2, transaction) {
  const block = await Block.findOne({
    where: {
      [Op.or]: [
        { blockerId: userId1, blockedId: userId2 },
        { blockerId: userId2, blockedId: userId1 },
      ],
    },
    transaction,
  });
  return Boolean(block);
}

/**
 * Helper to lazily evaluate and update expiration of a session
 */
async function checkAndApplySessionExpiration(session, transaction) {
  if (
    ["pending", "accepted", "in_progress"].includes(session.status) &&
    session.expiresAt &&
    new Date(session.expiresAt) <= new Date()
  ) {
    session.status = "expired";
    await session.save({ transaction });
  }
  return session;
}

/**
 * Format game session response safely without leaking unrevealed answers
 */
function formatSessionResponse(
  session,
  currentUserId,
  answers = [],
  inviterData = null,
  inviteeData = null,
) {
  const isRevealed =
    session.revealState === "revealed" || session.status === "completed";

  // Format answers: reveal other's answer ONLY if revealState === 'revealed'
  const formattedAnswers = answers.map((ans) => {
    const isOwner = ans.participantId === currentUserId;
    if (isOwner || isRevealed) {
      return {
        id: ans.id,
        session_id: ans.sessionId,
        participant_id: ans.participantId,
        question_id: ans.questionId,
        answer_payload: ans.answerPayload,
        submitted_at: ans.submittedAt,
        created_at: ans.createdAt,
      };
    } else {
      // Sealed: hide other user's answer_payload completely
      return {
        id: ans.id,
        session_id: ans.sessionId,
        participant_id: ans.participantId,
        question_id: ans.questionId,
        submitted_at: ans.submittedAt,
        created_at: ans.createdAt,
        sealed: true,
      };
    }
  });

  // Determine submission status flags for participants
  const otherUserId =
    session.inviterId === currentUserId ? session.inviteeId : session.inviterId;
  const currentUserSubmitted = answers.some(
    (a) => a.participantId === currentUserId,
  );
  const otherUserSubmitted = answers.some(
    (a) => a.participantId === otherUserId,
  );

  return {
    id: session.id,
    conversation_id: session.conversationId,
    game_type: session.gameType,
    status: session.status,
    inviter_id: session.inviterId,
    invitee_id: session.inviteeId,
    accepted_at: session.acceptedAt,
    expires_at: session.expiresAt,
    cancelled_at: session.cancelledAt,
    cancelled_by: session.cancelledBy,
    completed_at: session.completedAt,
    reveal_state: session.revealState,
    revealed_at: session.revealedAt,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    submission_status: {
      current_user_submitted: currentUserSubmitted,
      other_user_submitted: otherUserSubmitted,
    },
    answers: formattedAnswers,
    participants: {
      inviter: inviterData || { user_id: session.inviterId },
      invitee: inviteeData || { user_id: session.inviteeId },
    },
  };
}

/**
 * 1. GET /api/v1/games/catalog
 */
exports.getCatalog = async (req, res, next) => {
  try {
    const games = await GameCatalog.findAll({
      where: { isActive: true },
      order: [["created_at", "ASC"]],
    });

    const formatted = games.map((g) => ({
      id: g.id,
      game_type: g.gameType,
      display_name: g.displayName,
      description: g.description,
      is_active: g.isActive,
      supported: true,
      config: {
        invitation_expiry_hours: g.config?.invitation_expiry_hours || 24,
        questions: g.config?.default_questions || [],
      },
    }));

    return res.status(200).json({
      success: true,
      message: "Game catalog retrieved successfully.",
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. POST /api/v1/games/sessions
 * Create a game invitation
 */
exports.createSession = async (req, res, next) => {
  const { conversation_id, game_type } = req.body || {};

  if (!conversation_id || !UUID_REGEX.test(conversation_id)) {
    return res.status(400).json({
      success: false,
      message: "A valid conversation_id is required.",
    });
  }

  if (!game_type || !ALLOWED_GAME_TYPES.includes(game_type)) {
    return res.status(400).json({
      success: false,
      message: `Invalid game_type. Must be one of: ${ALLOWED_GAME_TYPES.join(", ")}.`,
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    // Check game catalog is active
    const catalogItem = await GameCatalog.findOne({
      where: { gameType: game_type, isActive: true },
      transaction: t,
    });

    if (!catalogItem) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "The requested game is currently unavailable.",
      });
    }

    // Fetch conversation with row lock
    const conversation = await Conversation.findByPk(conversation_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!conversation) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    // Fetch match
    const match = await Match.findByPk(conversation.matchId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!match) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Match not found.",
      });
    }

    // Verify current user is a participant
    if (match.userAId !== currentUserId && match.userBId !== currentUserId) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to start a game in this conversation.",
      });
    }

    // Verify match is active (not unmatched)
    if (match.status !== "active") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "MATCH_UNMATCHED",
        message: "Cannot create a game session in an unmatched conversation.",
      });
    }

    const otherUserId =
      match.userAId === currentUserId ? match.userBId : match.userAId;

    // Verify other user exists, is active, age-eligible, and completed onboarding
    const otherUser = await User.findByPk(otherUserId, {
      include: [{ model: Profile, as: "profile" }],
      transaction: t,
    });

    if (
      !otherUser ||
      otherUser.accountStatus !== "active" ||
      !otherUser.ageEligible ||
      !otherUser.profile ||
      otherUser.profile.onboardingStatus !== "completed"
    ) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "The other participant is not currently eligible to play.",
      });
    }

    // Check bidirectional blocks
    const isBlocked = await checkBidirectionalBlock(
      currentUserId,
      otherUserId,
      t,
    );
    if (isBlocked) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Cannot create a game session due to account restrictions.",
      });
    }

    // Check for existing active game session in this conversation
    const existingActiveSession = await GameSession.findOne({
      where: {
        conversationId: conversation.id,
        status: { [Op.in]: ["pending", "accepted", "in_progress"] },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (existingActiveSession) {
      // Check if it has expired
      if (
        existingActiveSession.expiresAt &&
        new Date(existingActiveSession.expiresAt) <= new Date()
      ) {
        existingActiveSession.status = "expired";
        await existingActiveSession.save({ transaction: t });
      } else {
        await t.rollback();
        return res.status(409).json({
          success: false,
          code: "ACTIVE_SESSION_EXISTS",
          message:
            "An active game invitation or session already exists for this conversation.",
          data: {
            existing_session_id: existingActiveSession.id,
            status: existingActiveSession.status,
            game_type: existingActiveSession.gameType,
          },
        });
      }
    }

    // Create session (24h expiry default for invitation)
    const expiryHours = catalogItem.config?.invitation_expiry_hours || 24;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const session = await GameSession.create(
      {
        conversationId: conversation.id,
        gameType: game_type,
        status: "pending",
        inviterId: currentUserId,
        inviteeId: otherUserId,
        expiresAt,
        revealState: "sealed",
      },
      { transaction: t },
    );

    const currentUser = req.user;
    const currentProfile = req.profile;
    const inviterSafe = formatSafeParticipant(currentUser, currentProfile);
    const inviteeSafe = formatSafeParticipant(otherUser, otherUser.profile);

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Game invitation created successfully.",
      data: formatSessionResponse(
        session,
        currentUserId,
        [],
        inviterSafe,
        inviteeSafe,
      ),
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

/**
 * 3. POST /api/v1/games/sessions/:session_id/accept
 * Only the invited participant can accept
 */
exports.acceptSession = async (req, res, next) => {
  const { session_id } = req.params;

  if (!session_id || !UUID_REGEX.test(session_id)) {
    return res.status(400).json({
      success: false,
      message: "A valid session_id is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    const session = await GameSession.findByPk(session_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!session) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Game session not found.",
      });
    }

    // Check expiration first
    await checkAndApplySessionExpiration(session, t);

    // Verify authorized participants
    if (
      session.inviterId !== currentUserId &&
      session.inviteeId !== currentUserId
    ) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to access this game session.",
      });
    }

    // Prevent inviter from accepting their own invitation
    if (session.inviterId === currentUserId) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        code: "INVITER_CANNOT_ACCEPT",
        message: "The inviter cannot accept their own game invitation.",
      });
    }

    // Verify invitee
    if (session.inviteeId !== currentUserId) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Only the invited user can accept this invitation.",
      });
    }

    // Check status
    if (session.status === "expired") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "SESSION_EXPIRED",
        message: "This game invitation has expired.",
      });
    }

    if (session.status === "cancelled") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "SESSION_CANCELLED",
        message: "This game invitation has been cancelled.",
      });
    }

    if (session.status !== "pending") {
      // If already accepted or in_progress, idempotent return 200
      if (["accepted", "in_progress"].includes(session.status)) {
        await t.commit();
        return res.status(200).json({
          success: true,
          message: "Game invitation has already been accepted.",
          data: formatSessionResponse(session, currentUserId, []),
        });
      }
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "INVALID_SESSION_STATE",
        message: `Cannot accept game session with status: ${session.status}.`,
      });
    }

    // Verify match status
    const conversation = await Conversation.findByPk(session.conversationId, {
      transaction: t,
    });
    const match = conversation
      ? await Match.findByPk(conversation.matchId, { transaction: t })
      : null;

    if (!match || match.status !== "active") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "MATCH_UNMATCHED",
        message: "Cannot accept game in an unmatched conversation.",
      });
    }

    // Check blocks
    const isBlocked = await checkBidirectionalBlock(
      session.inviterId,
      session.inviteeId,
      t,
    );
    if (isBlocked) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Cannot accept game session due to account restrictions.",
      });
    }

    // Update session state
    session.status = "accepted";
    session.acceptedAt = new Date();
    // Extend expiry for active game play (e.g., 48 hours from acceptance)
    session.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await session.save({ transaction: t });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Game invitation accepted successfully.",
      data: formatSessionResponse(session, currentUserId, []),
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

/**
 * 4. POST /api/v1/games/sessions/:session_id/answers
 * Submit an answer privately
 */
exports.submitAnswer = async (req, res, next) => {
  const { session_id } = req.params;
  const { question_id, answer } = req.body || {};

  if (!session_id || !UUID_REGEX.test(session_id)) {
    return res.status(400).json({
      success: false,
      message: "A valid session_id is required.",
    });
  }

  if (
    !question_id ||
    typeof question_id !== "string" ||
    question_id.trim().length === 0
  ) {
    return res.status(422).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "question_id must be a non-empty string.",
    });
  }

  if (answer === undefined || answer === null) {
    return res.status(422).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "answer payload is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    const session = await GameSession.findByPk(session_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!session) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Game session not found.",
      });
    }

    // Check expiration
    await checkAndApplySessionExpiration(session, t);

    // Verify participant
    if (
      session.inviterId !== currentUserId &&
      session.inviteeId !== currentUserId
    ) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to submit answers for this session.",
      });
    }

    // Verify session state: must be accepted or in_progress
    if (session.status === "pending") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "SESSION_PENDING",
        message:
          "Game invitation has not yet been accepted by the invited player.",
      });
    }

    if (session.status === "cancelled") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "SESSION_CANCELLED",
        message: "Cannot submit answers for a cancelled game session.",
      });
    }

    if (session.status === "expired") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "SESSION_EXPIRED",
        message: "Cannot submit answers for an expired game session.",
      });
    }

    if (session.status === "completed") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "SESSION_COMPLETED",
        message: "This game session is already completed.",
      });
    }

    // Verify match status
    const conversation = await Conversation.findByPk(session.conversationId, {
      transaction: t,
    });
    const match = conversation
      ? await Match.findByPk(conversation.matchId, { transaction: t })
      : null;

    if (!match || match.status !== "active") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "MATCH_UNMATCHED",
        message: "Cannot submit answers in an unmatched conversation.",
      });
    }

    // Check blocks
    const isBlocked = await checkBidirectionalBlock(
      session.inviterId,
      session.inviteeId,
      t,
    );
    if (isBlocked) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Cannot submit answers due to account restrictions.",
      });
    }

    // Fetch existing answer by this participant for this question
    let existingAnswer = await GameAnswer.findOne({
      where: {
        sessionId: session.id,
        participantId: currentUserId,
        questionId: question_id.trim(),
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let answerRecord;
    let isIdempotentUpdate = false;

    if (existingAnswer) {
      // Idempotent submission / update
      existingAnswer.answerPayload = answer;
      existingAnswer.submittedAt = new Date();
      await existingAnswer.save({ transaction: t });
      answerRecord = existingAnswer;
      isIdempotentUpdate = true;
    } else {
      answerRecord = await GameAnswer.create(
        {
          sessionId: session.id,
          participantId: currentUserId,
          questionId: question_id.trim(),
          answerPayload: answer,
          submittedAt: new Date(),
        },
        { transaction: t },
      );
    }

    // Update session state to in_progress if still accepted
    if (session.status === "accepted") {
      session.status = "in_progress";
    }

    // Check reveal conditions
    // Query all answers for this session
    const allAnswers = await GameAnswer.findAll({
      where: { sessionId: session.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const otherUserId =
      session.inviterId === currentUserId
        ? session.inviteeId
        : session.inviterId;
    const inviterAnswers = allAnswers.filter(
      (a) => a.participantId === session.inviterId,
    );
    const inviteeAnswers = allAnswers.filter(
      (a) => a.participantId === session.inviteeId,
    );

    // If both participants have submitted at least 1 answer (or matched the question requirement)
    // Reveal condition: both participants have submitted an answer for this session!
    const bothSubmitted =
      inviterAnswers.length > 0 && inviteeAnswers.length > 0;

    let justRevealed = false;
    if (bothSubmitted && session.revealState !== "revealed") {
      session.revealState = "revealed";
      session.revealedAt = new Date();
      session.status = "completed";
      session.completedAt = new Date();
      justRevealed = true;
    }
    await session.save({ transaction: t });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: justRevealed
        ? "Both participants have answered! Answers are now revealed."
        : "Answer submitted successfully and sealed privately.",
      data: {
        session_id: session.id,
        question_id: answerRecord.questionId,
        your_answer: answerRecord.answerPayload,
        submitted_at: answerRecord.submittedAt,
        session_status: session.status,
        reveal_state: session.revealState,
        other_user_submitted:
          session.inviterId === currentUserId
            ? inviteeAnswers.length > 0
            : inviterAnswers.length > 0,
      },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

/**
 * 5. GET /api/v1/games/sessions/:session_id
 * View session state and safe answers (never leak unrevealed answer)
 */
exports.getSession = async (req, res, next) => {
  const { session_id } = req.params;

  if (!session_id || !UUID_REGEX.test(session_id)) {
    return res.status(400).json({
      success: false,
      message: "A valid session_id is required.",
    });
  }

  try {
    const currentUserId = req.auth.userId;

    const session = await GameSession.findByPk(session_id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Game session not found.",
      });
    }

    // Check expiration
    await checkAndApplySessionExpiration(session);

    // Authorization check
    if (
      session.inviterId !== currentUserId &&
      session.inviteeId !== currentUserId
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this game session.",
      });
    }

    // Fetch participants
    const [inviterUser, inviteeUser] = await Promise.all([
      User.findByPk(session.inviterId, {
        include: [{ model: Profile, as: "profile" }],
      }),
      User.findByPk(session.inviteeId, {
        include: [{ model: Profile, as: "profile" }],
      }),
    ]);

    const inviterSafe = formatSafeParticipant(
      inviterUser,
      inviterUser?.profile,
    );
    const inviteeSafe = formatSafeParticipant(
      inviteeUser,
      inviteeUser?.profile,
    );

    // Fetch answers
    const answers = await GameAnswer.findAll({
      where: { sessionId: session.id },
      order: [["submitted_at", "ASC"]],
    });

    return res.status(200).json({
      success: true,
      message: "Game session retrieved successfully.",
      data: formatSessionResponse(
        session,
        currentUserId,
        answers,
        inviterSafe,
        inviteeSafe,
      ),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 6. DELETE /api/v1/games/sessions/:session_id
 * Cancel game session
 */
exports.cancelSession = async (req, res, next) => {
  const { session_id } = req.params;

  if (!session_id || !UUID_REGEX.test(session_id)) {
    return res.status(400).json({
      success: false,
      message: "A valid session_id is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    const session = await GameSession.findByPk(session_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!session) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Game session not found.",
      });
    }

    // Verify authorized participant
    if (
      session.inviterId !== currentUserId &&
      session.inviteeId !== currentUserId
    ) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this game session.",
      });
    }

    // Idempotent cancellation check
    if (session.status === "cancelled") {
      await t.commit();
      return res.status(200).json({
        success: true,
        message: "Game session has already been cancelled.",
        data: {
          id: session.id,
          status: "cancelled",
          cancelled_by: session.cancelledBy,
          cancelled_at: session.cancelledAt,
        },
      });
    }

    // Completed or expired check
    if (session.status === "completed") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "SESSION_ALREADY_COMPLETED",
        message: "Cannot cancel a completed game session.",
      });
    }

    // Cancel session
    session.status = "cancelled";
    session.cancelledAt = new Date();
    session.cancelledBy = currentUserId;
    await session.save({ transaction: t });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Game session cancelled successfully.",
      data: {
        id: session.id,
        status: "cancelled",
        cancelled_by: currentUserId,
        cancelled_at: session.cancelledAt,
      },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};
