require("dotenv").config();

const app = require("./app");
const sequelize = require("./config/db");

require("./models");

const { validateRushTimezone } = require("./controllers/rushController");
const storageService = require("./services/storageService");

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Validate storage provider configuration on startup
    storageService.validateConfig();

    // Validate RUSH_TIMEZONE immediately at startup (fails fast if invalid)
    validateRushTimezone(process.env.RUSH_TIMEZONE);

    await sequelize.authenticate();
    console.log("PostgreSQL Connected");

    if (process.env.NODE_ENV === "development") {
      await sequelize.sync();
      console.log("Development Model Synchronized");
    }

    app.listen(PORT, () => {
      console.log(`Spark Api Running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
