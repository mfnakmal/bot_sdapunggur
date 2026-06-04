const fs = require("fs");
const path = require("path");
const { scheduleBackup } = require("./gitBackup");

function readJSON(filePath, defaultValue = null) {
  try {
    const fullPath = path.join(__dirname, "..", filePath);

    if (!fs.existsSync(fullPath)) {
      return defaultValue;
    }

    const raw = fs.readFileSync(fullPath, "utf-8");

    if (!raw.trim()) {
      return defaultValue;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error("Gagal membaca JSON:", filePath, error.message);
    return defaultValue;
  }
}

function writeJSON(filePath, data, backupReason = "update json") {
  try {
    const fullPath = path.join(__dirname, "..", filePath);
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf-8");

    // backup otomatis hanya untuk folder data
    if (filePath.startsWith("data/")) {
      scheduleBackup(backupReason);
    }

    return true;
  } catch (error) {
    console.error("Gagal menulis JSON:", filePath, error.message);
    return false;
  }
}

module.exports = {
  readJSON,
  writeJSON
};