const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "dynamodb-data");

// Create directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log("✅ Created dynamodb-data directory");
} else {
  console.log("✅ dynamodb-data directory already exists");
}

// On Windows, we don't need to set permissions, but we'll ensure the directory is writable
try {
  const testFile = path.join(dataDir, ".test");
  fs.writeFileSync(testFile, "test");
  fs.unlinkSync(testFile);
  console.log("✅ Directory is writable");
} catch (error) {
  console.error("❌ Directory is not writable:", error.message);
  process.exit(1);
}
