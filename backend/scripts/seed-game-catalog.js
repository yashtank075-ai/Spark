const { sequelize, GameCatalog } = require("../models");

const CATALOG_ENTRIES = [
  {
    gameType: "vibe_check",
    displayName: "Vibe Check",
    description:
      "A quick, playful question deck to compare personalities, habits, and spontaneous thoughts. Answers are revealed simultaneously once both participants answer.",
    isActive: true,
    config: {
      invitation_expiry_hours: 24,
      session_expiry_hours: 48,
      default_questions: [
        {
          id: "vc_1",
          question: "Ideal Sunday morning:",
          options: ["Sleeping in past noon", "Coffee and a quiet book", "Morning run / workout", "Exploring brunch spots"],
        },
        {
          id: "vc_2",
          question: "Spontaneous road trip with 10 minutes notice?",
          options: ["Pack a bag right now!", "Need at least 24h notice", "Only if there's great snacks", "Absolutely not"],
        },
        {
          id: "vc_3",
          question: "Our first shared activity should be:",
          options: ["Cocktails & lively conversation", "Coffee walk in the park", "Art gallery or museum", "Arcade / interactive games"],
        },
      ],
    },
  },
  {
    gameType: "secret_answers",
    displayName: "Secret Answers",
    description:
      "Submit your answer in confidence without seeing your match's response. The curtain opens and reveals both answers only after both players have submitted.",
    isActive: true,
    config: {
      invitation_expiry_hours: 24,
      session_expiry_hours: 48,
      default_questions: [
        {
          id: "sa_1",
          question: "What is something quirky or unconventional you find genuinely attractive?",
          prompt_hint: "Be completely honest — nobody sees this until both lock in their answer!",
        },
        {
          id: "sa_2",
          question: "What is your biggest personal green flag that most people might miss at first?",
          prompt_hint: "Share something authentic about yourself.",
        },
      ],
    },
  },
];

async function seedGameCatalog() {
  await sequelize.authenticate();
  console.log("Database connected. Seeding game catalog...");

  for (const entry of CATALOG_ENTRIES) {
    const [item, created] = await GameCatalog.findOrCreate({
      where: { gameType: entry.gameType },
      defaults: entry,
    });

    if (!created) {
      item.displayName = entry.displayName;
      item.description = entry.description;
      item.isActive = entry.isActive;
      item.config = entry.config;
      await item.save();
      console.log(`Updated catalog entry: ${entry.gameType}`);
    } else {
      console.log(`Created catalog entry: ${entry.gameType}`);
    }
  }

  console.log("Game catalog seed completed successfully.");
}

if (require.main === module) {
  seedGameCatalog()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Game catalog seed failed:", err);
      process.exit(1);
    });
}

module.exports = {
  seedGameCatalog,
  CATALOG_ENTRIES,
};
