const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { Match, Conversation, Message, User, Profile, ProfileMedia } = require("../models");
const storageService = require("../services/storageService");

// UUID v4 format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Calculate age utility
function calculateAge(birthDateString) {
  if (!birthDateString) return null;
  const today = new Date();
  const birthDate = new Date(birthDateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// Map profile media to safe public schema
function formatPublicMedia(mediaList = []) {
  return mediaList
    .filter((m) => m.moderationStatus === "approved")
    .map((m) => ({
      id: m.id,
      media_type: m.mediaType,
      url: storageService.getPublicUrl(m.storageRef),
      is_primary: Boolean(m.isPrimary),
    }));
}

// Map profile to safe public profile representation (never expose DOB, phone, credentials, coordinates)
function formatPublicProfile(profile, user) {
  if (!profile) return null;
  const age = calculateAge(user ? user.dateOfBirth : null);
  const media = formatPublicMedia(profile.media || []);
  const loc = profile.location || {};
  const safeLocation = loc.city
    ? {
        city: loc.city,
        state: loc.state || null,
        country: loc.country || null,
      }
    : null;

  return {
    id: profile.id,
    user_id: profile.userId,
    display_name: profile.displayName || null,
    age,
    gender: profile.showGenderOnProfile !== false ? profile.gender : null,
    dating_intention: profile.datingIntention || null,
    dating_speed: profile.datingSpeed || null,
    interests: profile.interests || [],
    bio: profile.bio || null,
    prompts: profile.prompts || [],
    boundaries: profile.boundaries || [],
    location: safeLocation,
    media,
    is_verified: Boolean(profile.isVerified),
  };
}

// Format message item for response
function formatMessageItem(msg) {
  const mediaRef = msg.mediaUrl || msg.audioUrl || msg.storageKey || null;
  const publicUrl = mediaRef ? storageService.getPublicUrl(mediaRef) : null;
  const duration = msg.duration !== undefined && msg.duration !== null ? Number(msg.duration) : null;

  return {
    id: msg.id,
    conversation_id: msg.conversationId,
    sender_id: msg.senderId,
    type: msg.messageType || "text",
    message_type: msg.messageType || "text",
    content: msg.content !== undefined ? msg.content : null,
    audio_url: publicUrl,
    media_url: publicUrl,
    storage_key: mediaRef,
    duration,
    is_read: msg.isRead,
    read_at: msg.readAt,
    created_at: msg.createdAt,
  };
}

// GET /api/v1/conversations
exports.getConversations = async (req, res, next) => {
  try {
    const currentUserId = req.auth.userId;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    if (cursor && !UUID_REGEX.test(cursor)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cursor format.",
      });
    }

    // 1. Find all active matches involving the current user
    const matches = await Match.findAll({
      where: {
        status: "active",
        [Op.or]: [
          { userAId: currentUserId },
          { userBId: currentUserId },
        ],
      },
    });

    if (matches.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Conversations fetched successfully.",
        data: [],
        pagination: {
          limit,
          has_more: false,
          next_cursor: null,
          count: 0,
        },
      });
    }

    const matchIds = matches.map((m) => m.id);
    const matchMap = new Map(matches.map((m) => [m.id, m]));

    // 2. Ensure each active match has a conversation record
    for (const m of matches) {
      await Conversation.findOrCreate({
        where: { matchId: m.id },
        defaults: { matchId: m.id },
      });
    }

    // Query conversations associated with these matches
    const convWhere = {
      matchId: { [Op.in]: matchIds },
    };

    if (cursor) {
      convWhere.id = {
        [Op.lt]: cursor,
      };
    }

    const conversations = await Conversation.findAll({
      where: convWhere,
      order: [
        [sequelize.fn("COALESCE", sequelize.col("last_message_at"), sequelize.col("created_at")), "DESC"],
        ["id", "DESC"],
      ],
      limit: limit + 1,
    });

    const hasMore = conversations.length > limit;
    const activeConversations = hasMore ? conversations.slice(0, limit) : conversations;

    if (activeConversations.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Conversations fetched successfully.",
        data: [],
        pagination: {
          limit,
          has_more: false,
          next_cursor: null,
          count: 0,
        },
      });
    }

    // 3. Collect conversation IDs and other participant IDs
    const convIds = activeConversations.map((c) => c.id);
    const otherUserIds = [];
    for (const c of activeConversations) {
      const match = matchMap.get(c.matchId);
      if (match) {
        const otherId = match.userAId === currentUserId ? match.userBId : match.userAId;
        otherUserIds.push(otherId);
      }
    }

    // 4. Batch query participant profiles
    const otherUsers = await User.findAll({
      where: {
        id: { [Op.in]: otherUserIds },
        accountStatus: "active",
      },
      include: [
        {
          model: Profile,
          as: "profile",
          include: [
            {
              model: ProfileMedia,
              as: "media",
              required: false,
              where: { moderationStatus: "approved" },
            },
          ],
        },
      ],
    });

    const userProfileMap = new Map();
    for (const u of otherUsers) {
      userProfileMap.set(u.id, { user: u, profile: u.profile });
    }

    // 5. Query latest message and unread counts for each active conversation
    const messages = await Message.findAll({
      where: {
        conversationId: { [Op.in]: convIds },
      },
      order: [["created_at", "DESC"]],
    });

    const latestMessageMap = new Map();
    const unreadCountMap = new Map();

    for (const msg of messages) {
      if (!latestMessageMap.has(msg.conversationId)) {
        latestMessageMap.set(msg.conversationId, msg);
      }
      if (msg.senderId !== currentUserId && !msg.isRead) {
        unreadCountMap.set(
          msg.conversationId,
          (unreadCountMap.get(msg.conversationId) || 0) + 1
        );
      }
    }

    // 6. Build formatted response
    const formattedList = [];
    for (const c of activeConversations) {
      const match = matchMap.get(c.matchId);
      if (!match) continue;

      const otherId = match.userAId === currentUserId ? match.userBId : match.userAId;
      const target = userProfileMap.get(otherId);
      if (!target || !target.profile) continue;

      const latestMsg = latestMessageMap.get(c.id);
      const unreadCount = unreadCountMap.get(c.id) || 0;

      formattedList.push({
        id: c.id,
        match_id: c.matchId,
        match_status: match.status,
        last_message_at: c.lastMessageAt || c.createdAt,
        unread_count: unreadCount,
        latest_message: latestMsg ? formatMessageItem(latestMsg) : null,
        user: formatPublicProfile(target.profile, target.user),
      });
    }

    const nextCursor = activeConversations.length > 0 && hasMore
      ? activeConversations[activeConversations.length - 1].id
      : null;

    return res.status(200).json({
      success: true,
      message: "Conversations fetched successfully.",
      data: formattedList,
      pagination: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
        count: formattedList.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/conversations/:conversation_id/messages
exports.getMessages = async (req, res, next) => {
  try {
    const currentUserId = req.auth.userId;
    const { conversation_id } = req.params;

    if (!conversation_id || !UUID_REGEX.test(conversation_id)) {
      return res.status(400).json({
        success: false,
        message: "Valid Conversation ID is required.",
      });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    if (cursor && !UUID_REGEX.test(cursor)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cursor format.",
      });
    }

    // Verify conversation existence and membership via Match
    const conversation = await Conversation.findByPk(conversation_id, {
      include: [
        {
          model: Match,
          as: "match",
        },
      ],
    });

    if (!conversation || !conversation.match) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found.",
      });
    }

    const match = conversation.match;
    if (match.userAId !== currentUserId && match.userBId !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this conversation.",
      });
    }

    const msgWhere = {
      conversationId: conversation.id,
    };

    if (cursor) {
      msgWhere.id = {
        [Op.lt]: cursor,
      };
    }

    // Query messages in reverse chronological order for pagination
    const messages = await Message.findAll({
      where: msgWhere,
      order: [["created_at", "DESC"], ["id", "DESC"]],
      limit: limit + 1,
    });

    const hasMore = messages.length > limit;
    const activeMessages = hasMore ? messages.slice(0, limit) : messages;

    const formattedMessages = activeMessages.map(formatMessageItem);

    const nextCursor = activeMessages.length > 0 && hasMore
      ? activeMessages[activeMessages.length - 1].id
      : null;

    return res.status(200).json({
      success: true,
      message: "Messages fetched successfully.",
      data: formattedMessages,
      match_status: match.status,
      pagination: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
        count: formattedMessages.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/conversations/:conversation_id/messages
exports.sendMessage = async (req, res, next) => {
  const { conversation_id } = req.params;

  if (!conversation_id || !UUID_REGEX.test(conversation_id)) {
    return res.status(400).json({
      success: false,
      message: "Valid Conversation ID is required.",
    });
  }

  const { content } = req.body || {};
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return res.status(422).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Message content cannot be empty.",
      details: { content: "content must be a non-empty string." },
    });
  }

  if (content.trim().length > 2000) {
    return res.status(422).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Message content exceeds maximum allowed length.",
      details: { content: "content cannot exceed 2000 characters." },
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    // 1. Fetch conversation
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

    // 2. Fetch associated match with row lock
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

    // Check membership
    if (match.userAId !== currentUserId && match.userBId !== currentUserId) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to send messages in this conversation.",
      });
    }

    // Check match status: MUST BE active
    if (match.status !== "active") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        code: "MATCH_UNMATCHED",
        message: "Cannot send messages in an unmatched conversation.",
      });
    }

    // Create message
    const message = await Message.create(
      {
        conversationId: conversation.id,
        senderId: currentUserId,
        content: content.trim(),
        isRead: false,
        readAt: null,
      },
      { transaction: t }
    );

    // Update conversation last_message_at
    conversation.lastMessageAt = message.createdAt;
    await conversation.save({ transaction: t });

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Message sent successfully.",
      data: formatMessageItem(message),
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

// POST /api/v1/conversations/:conversation_id/read
exports.markAsRead = async (req, res, next) => {
  const { conversation_id } = req.params;

  if (!conversation_id || !UUID_REGEX.test(conversation_id)) {
    return res.status(400).json({
      success: false,
      message: "Valid Conversation ID is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

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

    // Check membership
    if (match.userAId !== currentUserId && match.userBId !== currentUserId) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to access this conversation.",
      });
    }

    // Mark all unread incoming messages as read (senderId != currentUserId)
    const readTimestamp = new Date();
    const [updatedCount] = await Message.update(
      {
        isRead: true,
        readAt: readTimestamp,
      },
      {
        where: {
          conversationId: conversation.id,
          senderId: { [Op.ne]: currentUserId },
          isRead: false,
        },
        transaction: t,
      }
    );

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Messages marked as read.",
      data: {
        conversation_id: conversation.id,
        messages_marked_read: updatedCount,
        read_at: readTimestamp,
      },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

// POST /api/v1/conversations/:conversation_id/goodbye
exports.goodbye = async (req, res, next) => {
  const { conversation_id } = req.params;

  if (!conversation_id || !UUID_REGEX.test(conversation_id)) {
    return res.status(400).json({
      success: false,
      message: "Valid Conversation ID is required.",
    });
  }

  const t = await sequelize.transaction();
  try {
    const currentUserId = req.auth.userId;

    // 1. Fetch conversation with row lock
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

    // 2. Fetch associated match with row lock
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

    // 3. Verify that the authenticated user is a participant
    if (match.userAId !== currentUserId && match.userBId !== currentUserId) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not authorized to end this conversation.",
      });
    }

    // 4. Handle already-ended conversation idempotently
    if (match.status === "unmatched") {
      await t.rollback();
      return res.status(200).json({
        success: true,
        message: "Conversation has already ended.",
        data: {
          conversation_id: conversation.id,
          match_id: match.id,
          match_status: "unmatched",
          status: "unmatched",
        },
      });
    }

    // 5. Update match status to unmatched
    match.status = "unmatched";
    await match.save({ transaction: t });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Conversation ended successfully.",
      data: {
        conversation_id: conversation.id,
        match_id: match.id,
        match_status: "unmatched",
        status: "unmatched",
      },
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

// POST /api/v1/conversations/:conversation_id/voice
exports.sendVoiceMessage = async (req, res, next) => {
  const { conversation_id } = req.params;

  if (!conversation_id || !UUID_REGEX.test(conversation_id)) {
    return res.status(400).json({
      success: false,
      message: "Valid Conversation ID is required.",
    });
  }

  // Validate uploaded audio file existence
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No audio file provided.",
    });
  }

  // Validate supported audio MIME types
  const allowedMimeTypes = [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/ogg",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/x-m4a",
    "audio/m4a",
  ];
  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(422).json({
      success: false,
      message: "Invalid audio format.",
    });
  }

  const currentUserId = req.auth.userId;

  // Pre-validate conversation and match before uploading to storage
  const conversation = await Conversation.findByPk(conversation_id);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: "Conversation not found.",
    });
  }

  const match = await Match.findByPk(conversation.matchId);
  if (!match) {
    return res.status(404).json({
      success: false,
      message: "Match not found.",
    });
  }

  if (match.userAId !== currentUserId && match.userBId !== currentUserId) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to send messages in this conversation.",
    });
  }

  if (match.status !== "active") {
    return res.status(400).json({
      success: false,
      code: "MATCH_UNMATCHED",
      message: "Cannot send messages in an unmatched conversation.",
    });
  }

  // Upload file to configured storage provider
  let storageRef;
  try {
    storageRef = await storageService.uploadFile(req.file);
  } catch (storageErr) {
    return res.status(501).json({
      success: false,
      message: storageErr.message || "Failed to upload audio file.",
    });
  }

  // Persist message record inside a Sequelize transaction
  const t = await sequelize.transaction();
  try {
    const lockedConv = await Conversation.findByPk(conversation_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const lockedMatch = await Match.findByPk(conversation.matchId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (lockedMatch.status !== "active") {
      await t.rollback();
      try {
        await storageService.deleteFile(storageRef);
      } catch (cleanupErr) {
        console.error("Storage cleanup failed:", cleanupErr.message);
      }
      return res.status(400).json({
        success: false,
        code: "MATCH_UNMATCHED",
        message: "Cannot send messages in an unmatched conversation.",
      });
    }

    let duration = null;
    if (req.body && req.body.duration !== undefined && req.body.duration !== null && req.body.duration !== "") {
      const parsedDuration = parseInt(req.body.duration, 10);
      if (!isNaN(parsedDuration) && parsedDuration >= 0) {
        duration = parsedDuration;
      }
    }

    const content =
      req.body && typeof req.body.content === "string" && req.body.content.trim().length > 0
        ? req.body.content.trim()
        : null;

    const message = await Message.create(
      {
        conversationId: lockedConv.id,
        senderId: currentUserId,
        messageType: "voice",
        content,
        mediaUrl: storageRef,
        duration,
        isRead: false,
        readAt: null,
      },
      { transaction: t }
    );

    lockedConv.lastMessageAt = message.createdAt;
    await lockedConv.save({ transaction: t });

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Voice message sent successfully.",
      data: formatMessageItem(message),
    });
  } catch (dbError) {
    await t.rollback();
    // Cleanup uploaded file if database persistence fails
    try {
      await storageService.deleteFile(storageRef);
    } catch (cleanupErr) {
      console.error("Storage cleanup failed after DB error:", cleanupErr.message);
    }
    next(dbError);
  }
};
