const User = require("../models/User");
const Profile = require("../models/Profile");

async function requireOnboarding(req, res, next) {
  try {
    const userId = req.auth.userId;

    const user = req.user || (await User.findByPk(userId));
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (!user.dateOfBirth || !user.ageEligible) {
      return res.status(403).json({
        success: false,
        message: "You must be at least 18 years old to access dating features.",
      });
    }

    const profile = await Profile.findOne({ where: { userId } });
    if (!profile || profile.onboardingStatus !== "completed") {
      return res.status(403).json({
        success: false,
        message: "Please complete your onboarding profile to continue.",
      });
    }

    req.profile = profile;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireOnboarding;
