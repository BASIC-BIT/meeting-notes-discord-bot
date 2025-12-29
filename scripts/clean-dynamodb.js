const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "dynamodb-data");
const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const removeContents = (dir) => {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
};

const removeDirectory = async (dir) => {
  let lastError;
  for (let attempt = 0; attempt < RETRY_COUNT; attempt += 1) {
    try {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (error) {
          if (error.code === "ENOTEMPTY") {
            removeContents(dir);
            fs.rmSync(dir, { recursive: true, force: true });
          } else {
            throw error;
          }
        }
      }
      return;
    } catch (error) {
      lastError = error;
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
};

if (fs.existsSync(dataDir)) {
  removeDirectory(dataDir)
    .then(() => {
      console.log("Cleaned dynamodb-data directory");
    })
    .catch((error) => {
      console.error("Failed to clean directory:", error.message);
      console.error("Try stopping Docker containers and retrying.");
      process.exit(1);
    });
} else {
  console.log("Directory already clean");
}
