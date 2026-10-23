const User = require("./User");
const AuthSession = require("./AuthSession");
const OtpChallenge = require("./OtpChallenge");
const Profile = require("./Profile");
const ProfileMedia = require("./ProfileMedia");
const Interaction = require("./Interaction");
const Match = require("./Match");
const RushSession = require("./RushSession");
const Block = require("./Block");
const Conversation = require("./Conversation");
const Message = require("./Message");
const GameCatalog = require("./GameCatalog");
const GameSession = require("./GameSession");
const GameAnswer = require("./GameAnswer");
const MediaUpload = require("./MediaUpload");
const StaffUser = require("./StaffUser");

// User <-> MediaUpload
User.hasMany(MediaUpload, {
  foreignKey: "user_id",
  as: "uploads",
});
MediaUpload.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User <-> AuthSession
User.hasMany(AuthSession, {
  foreignKey: "user_id",
  as: "sessions",
});
AuthSession.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User <-> Profile
User.hasOne(Profile, {
  foreignKey: "user_id",
  as: "profile",
});
Profile.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User <-> ProfileMedia
User.hasMany(ProfileMedia, {
  foreignKey: "user_id",
  as: "media",
});
ProfileMedia.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// Profile <-> ProfileMedia
Profile.hasMany(ProfileMedia, {
  foreignKey: "user_id",
  sourceKey: "userId",
  as: "media",
});
ProfileMedia.belongsTo(Profile, {
  foreignKey: "user_id",
  targetKey: "userId",
  as: "profile",
});

// User <-> Interaction (as actor and target)
User.hasMany(Interaction, {
  foreignKey: "actor_id",
  as: "interactionsGiven",
});
User.hasMany(Interaction, {
  foreignKey: "target_id",
  as: "interactionsReceived",
});
Interaction.belongsTo(User, {
  foreignKey: "actor_id",
  as: "actor",
});
Interaction.belongsTo(User, {
  foreignKey: "target_id",
  as: "target",
});

// User <-> Match (as userA and userB)
User.hasMany(Match, {
  foreignKey: "user_a_id",
  as: "matchesAsUserA",
});
User.hasMany(Match, {
  foreignKey: "user_b_id",
  as: "matchesAsUserB",
});
Match.belongsTo(User, {
  foreignKey: "user_a_id",
  as: "userA",
});
Match.belongsTo(User, {
  foreignKey: "user_b_id",
  as: "userB",
});

// Match <-> Conversation (1:1)
Match.hasOne(Conversation, {
  foreignKey: "match_id",
  as: "conversation",
});
Conversation.belongsTo(Match, {
  foreignKey: "match_id",
  as: "match",
});

// Conversation <-> Message (1:many)
Conversation.hasMany(Message, {
  foreignKey: "conversation_id",
  as: "messages",
});
Message.belongsTo(Conversation, {
  foreignKey: "conversation_id",
  as: "conversation",
});

// User <-> Message (sender)
User.hasMany(Message, {
  foreignKey: "sender_id",
  as: "sentMessages",
});
Message.belongsTo(User, {
  foreignKey: "sender_id",
  as: "sender",
});

// User <-> RushSession
User.hasMany(RushSession, {
  foreignKey: "user_id",
  as: "rushSessions",
});
RushSession.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User <-> Block (blocker and blocked)
User.hasMany(Block, {
  foreignKey: "blocker_id",
  as: "blocksIssued",
});
User.hasMany(Block, {
  foreignKey: "blocked_id",
  as: "blocksReceived",
});
Block.belongsTo(User, {
  foreignKey: "blocker_id", 
  as: "blocker",
});
Block.belongsTo(User, {
  foreignKey: "blocked_id",
  as: "blocked",
});

// Conversation <-> GameSession (1:many)
Conversation.hasMany(GameSession, {
  foreignKey: "conversation_id",
  as: "gameSessions",
});
GameSession.belongsTo(Conversation, {
  foreignKey: "conversation_id",
  as: "conversation",
});

// User <-> GameSession (inviter & invitee)
User.hasMany(GameSession, {
  foreignKey: "inviter_id",
  as: "gameInvitationsSent",
});
User.hasMany(GameSession, {
  foreignKey: "invitee_id",
  as: "gameInvitationsReceived",
});
GameSession.belongsTo(User, {
  foreignKey: "inviter_id",
  as: "inviter",
});
GameSession.belongsTo(User, {
  foreignKey: "invitee_id",
  as: "invitee",
});
GameSession.belongsTo(User, {
  foreignKey: "cancelled_by",
  as: "canceller",
});

// GameSession <-> GameAnswer (1:many)
GameSession.hasMany(GameAnswer, {
  foreignKey: "session_id",
  as: "answers",
});
GameAnswer.belongsTo(GameSession, {
  foreignKey: "session_id",
  as: "session",
});

// User <-> GameAnswer
User.hasMany(GameAnswer, {
  foreignKey: "participant_id",
  as: "gameAnswers",
});
GameAnswer.belongsTo(User, {
  foreignKey: "participant_id",
  as: "participant",
});

const sequelize = require("../config/db");

module.exports = {
  sequelize,
  User,
  AuthSession,
  OtpChallenge,
  Profile,
  ProfileMedia,
  Interaction,
  Match,
  Conversation,
  Message,
  RushSession,
  Block,
  GameCatalog,
  GameSession,
  GameAnswer,
  MediaUpload,
  StaffUser,
};
