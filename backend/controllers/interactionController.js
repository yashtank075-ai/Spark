const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { Profile, User, Interaction, Match, Conversation, Block, RushSession } = require("../models");

// UUID v4 format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// POST /api/v1/profiles/:profile_id/like
exports.likeProfile = async (req, res, next) => {
  const { profile_id } = req.params;

  if (!profile_id || !UUID_REGEX.test(profile_id)) {
    return res.status(400).json({
      success: false,
      message: "Valid Profile ID is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    // Find target profile and its user
    const targetProfile = await Profile.findByPk(profile_id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "accountStatus", "ageEligible"],
        },
      ],
      transaction: t,
    });

    if (!targetProfile || !targetProfile.user) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Profile not found.",
      });
    }

    const targetUserId = targetProfile.userId;

    // Check self-like
    if (targetUserId === currentUserId) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot like your own profile.",
      });
    }

    // Check target eligibility & account status
    if (
      targetProfile.user.accountStatus !== "active" ||
      !targetProfile.user.ageEligible ||
      targetProfile.onboardingStatus !== "completed"
    ) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Profile is not available for interaction.",
      });
    }

    // Check bidirectional blocks
    const block = await Block.findOne({
      where: {
        [Op.or]: [
          { blockerId: currentUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: currentUserId },
        ],
      },
      transaction: t,
    });

    if (block) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Profile not found.",
      });
    }

    // Check existing interaction from actor to target
    let existingInteraction = await Interaction.findOne({
      where: {
        actorId: currentUserId,
        targetId: targetUserId,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let isMatch = false;
    let matchRecord = null;

    if (existingInteraction) {
      if (existingInteraction.action === "like") {
        // Idempotent retry: already liked
        // Check if a match currently exists
        const userA = currentUserId < targetUserId ? currentUserId : targetUserId;
        const userB = currentUserId < targetUserId ? targetUserId : currentUserId;
        matchRecord = await Match.findOne({
          where: { userAId: userA, userBId: userB, status: "active" },
          transaction: t,
        });

        await t.commit();
        return res.status(200).json({
          success: true,
          message: "Profile already liked.",
          data: {
            interaction_id: existingInteraction.id,
            action: "like",
            matched: Boolean(matchRecord),
            match_id: matchRecord ? matchRecord.id : null,
          },
        });
      } else {
        // Previous pass: update action to like
        existingInteraction.action = "like";
        await existingInteraction.save({ transaction: t });
      }
    } else {
      // Create new like interaction
      existingInteraction = await Interaction.create(
        {
          actorId: currentUserId,
          targetId: targetUserId,
          action: "like",
        },
        { transaction: t }
      );
    }

    // Check if reciprocal like exists from target to actor
    const reciprocalLike = await Interaction.findOne({
      where: {
        actorId: targetUserId,
        targetId: currentUserId,
        action: "like",
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (reciprocalLike) {
      // Mutual like detected! Create regular match with canonical user order
      const userA = currentUserId < targetUserId ? currentUserId : targetUserId;
      const userB = currentUserId < targetUserId ? targetUserId : currentUserId;

      const [m, created] = await Match.findOrCreate({
        where: {
          userAId: userA,
          userBId: userB,
        },
        defaults: {
          status: "active",
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!created && m.status !== "active") {
        m.status = "active";
        await m.save({ transaction: t });
      }

      // Ensure conversation exists for the match
      await Conversation.findOrCreate({
        where: { matchId: m.id },
        defaults: { matchId: m.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      isMatch = true;
      matchRecord = m;
    }

    await t.commit();

    return res.status(200).json({
      success: true,
      message: isMatch ? "It's a Match!" : "Profile liked successfully.",
      data: {
        interaction_id: existingInteraction.id,
        action: "like",
        matched: isMatch,
        match_id: matchRecord ? matchRecord.id : null,
      },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

// POST /api/v1/profiles/:profile_id/pass
exports.passProfile = async (req, res, next) => {
  const { profile_id } = req.params;

  if (!profile_id || !UUID_REGEX.test(profile_id)) {
    return res.status(400).json({
      success: false,
      message: "Valid Profile ID is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    const targetProfile = await Profile.findByPk(profile_id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "accountStatus", "ageEligible"],
        },
      ],
      transaction: t,
    });

    if (!targetProfile || !targetProfile.user) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Profile not found.",
      });
    }

    const targetUserId = targetProfile.userId;

    if (targetUserId === currentUserId) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "You cannot pass your own profile.",
      });
    }

    // Check blocks
    const block = await Block.findOne({
      where: {
        [Op.or]: [
          { blockerId: currentUserId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: currentUserId },
        ],
      },
      transaction: t,
    });

    if (block) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Profile not found.",
      });
    }

    // Record or update pass interaction idempotently
    let existingInteraction = await Interaction.findOne({
      where: {
        actorId: currentUserId,
        targetId: targetUserId,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (existingInteraction) {
      if (existingInteraction.action !== "pass") {
        existingInteraction.action = "pass";
        await existingInteraction.save({ transaction: t });
      }
    } else {
      existingInteraction = await Interaction.create(
        {
          actorId: currentUserId,
          targetId: targetUserId,
          action: "pass",
        },
        { transaction: t }
      );
    }

    // Note: per specifications, passing does NOT automatically destroy an existing match.
    // Matches are explicitly terminated via the unmatch endpoint.

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Profile passed.",
      data: {
        interaction_id: existingInteraction.id,
        action: "pass",
      },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};
