const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "dynamodb-data");

if (fs.existsSync(dataDir)) {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log("✅ Cleaned dynamodb-data directory");
  } catch (error) {
    console.error("❌ Failed to clean directory:", error.message);
    process.exit(1);
  }
} else {
  console.log("✅ Directory already clean");
}
