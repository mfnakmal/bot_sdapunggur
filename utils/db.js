const fs = require("fs");
const path = require("path");
const { scheduleBackup } = require("./gitBackup");

const NO_BACKUP_FILES = new Set([
  "data/sessions.json",
  "runtime/sessions.json"
]);

function normalizeFilePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function resolveProjectPath(filePath) {
  return path.join(
    __dirname,
    "..",
    normalizeFilePath(filePath)
  );
}

function readJSON(filePath, defaultValue = null) {
  try {
    const fullPath = resolveProjectPath(filePath);

    if (!fs.existsSync(fullPath)) {
      return defaultValue;
    }

    const raw = fs.readFileSync(fullPath, "utf-8");

    if (!raw.trim()) {
      return defaultValue;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error(
      "Gagal membaca JSON:",
      filePath,
      error.message
    );

    return defaultValue;
  }
}

function shouldBackup(filePath) {
  const normalizedPath = normalizeFilePath(filePath);

  return (
    normalizedPath.startsWith("data/") &&
    !NO_BACKUP_FILES.has(normalizedPath)
  );
}

function writeJSON(
  filePath,
  data,
  backupReason = "update json"
) {
  const fullPath = resolveProjectPath(filePath);
  const tempPath = `${fullPath}.tmp`;

  try {
    fs.mkdirSync(path.dirname(fullPath), {
      recursive: true
    });

    // Tulis ke file sementara terlebih dahulu agar JSON
    // tidak mudah rusak saat proses tiba-tiba berhenti.
    fs.writeFileSync(
      tempPath,
      JSON.stringify(data, null, 2),
      "utf-8"
    );

    fs.renameSync(tempPath, fullPath);

    // Hanya data penting yang memicu backup GitHub.
    // File runtime/sessions.json tidak ikut.
    if (shouldBackup(filePath)) {
      scheduleBackup(backupReason);
    }

    return true;
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {
        // Abaikan jika file sementara gagal dibersihkan.
      }
    }

    console.error(
      "Gagal menulis JSON:",
      filePath,
      error.message
    );

    return false;
  }
}

module.exports = {
  readJSON,
  writeJSON
};