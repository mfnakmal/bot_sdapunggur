const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// pastikan folder & file dm_users ada sebelum backup
if (!fs.existsSync('data')) {
  fs.mkdirSync('data');
}

if (!fs.existsSync('data/dm_users.json')) {
  fs.writeFileSync('data/dm_users.json', JSON.stringify({ list: [] }, null, 2));
}

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 jam
const DEBOUNCE_MS = 15000; // tunggu 15 detik setelah ada perubahan

let backupTimer = null;
let backupInProgress = false;

function logSuccess(message) {
  console.log(`[AUTO-BACKUP] ✅ ${message}`);
}

function logError(message, err) {
  console.error("[AUTO-BACKUP] ❌", message, err || "");
}

function execPromise(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: ROOT_DIR, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject({
          error,
          stdout: stdout?.trim(),
          stderr: stderr?.trim(),
        });
        return;
      }
      resolve({
        stdout: stdout?.trim(),
        stderr: stderr?.trim(),
      });
    });
  });
}

function getImportantFiles() {
  const important = [
    "data.json",
    "tasks.json",
    "subscribers.json",
    "owners.json",
    "bot_switch.json",
    "categories.json",
    "sticker_style.json",
    "simi.json",
    "excludes.json",
    "contact_links.json",
    "uno.json",
    "data/dm_users.json",
    "premium_users.json",
    "instagram_cookies.txt",
    "youtube_cookies.txt",

    "index.js",
    "backup/backup.js",
    "backup/githubSync.js",

    "commands/resi.js",
    "commands/tugas.js",
    "commands/task/parser.js",
    "commands/task/store.js",
    "commands/healthReminder.js",
    "commands/weddingReminder.js",
    "commands/sticker.js",
    "commands/imageEdit.js",
    "commands/instagram.js",
    "commands/instagramStories.js",
    "commands/tiktok.js",
    "commands/twitter.js",
    "commands/imageToPdf.js",
    "commands/pdfToImage.js",
    "commands/pdfTools.js",
    'commands/youtube.js',
    "commands/tts.js",

    "utils/send.js",
    "utils/jid.js",
    "utils/sticker.js",
    "utils/dedup.js",
    "utils/broadcast.js",
    "utils/donationPromo.js",
    "utils/channelPromo.js",

    "finance/vocab.js",
    "finance/normalizer.js",
    "finance/parser.js",
    "finance/handler.js",
    "finance/dashboard.js",
    "public/dashboard.html",
    "public/css/style.css",
    "public/js/app.js",

    "ai/command.js",
    "ai/imageCommand.js",
    "ai/index.js",
    "ai/providers/gemini.js",
    "ai/providers/openrouter.js",
    "ai/image.js",

    "promo_state.json",
    "assets/qris.jpeg"
  ];

  return important.filter((file) => {
    const fullPath = path.join(ROOT_DIR, file);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  });
}

async function ensureGitRepo() {
  const gitPath = path.join(ROOT_DIR, ".git");

  if (!fs.existsSync(gitPath)) {
    await execPromise("git init");
    try {
      await execPromise("git branch -M main");
    } catch (_) { }
  }

  try {
    await execPromise('git config user.name "Auto Backup Bot"');
  } catch (_) { }

  try {
    await execPromise('git config user.email "autobackup@example.com"');
  } catch (_) { }
}

async function ensureRemote() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const remoteName = process.env.GIT_REMOTE_NAME || "origin";

  if (!repo || !token) {
    console.log("[AUTO-BACKUP] remote GitHub belum diatur, backup lokal saja.");
    return null;
  }

  const remoteUrl = `https://${token}@github.com/${repo}.git`;

  try {
    const { stdout } = await execPromise("git remote");
    const remotes = stdout ? stdout.split("\n").map((v) => v.trim()) : [];

    if (!remotes.includes(remoteName)) {
      await execPromise(`git remote add ${remoteName} "${remoteUrl}"`);
    } else {
      try {
        await execPromise(`git remote set-url ${remoteName} "${remoteUrl}"`);
      } catch (_) { }
    }

    return remoteName;
  } catch (err) {
    logError("Gagal memastikan remote:", err.stderr || err.error?.message || err);
    return null;
  }
}

function parseChangedFiles(reason) {
  if (!reason.startsWith("changed:")) return null;

  const raw = reason.slice("changed:".length).trim();
  if (!raw) return null;

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function doBackup(reason = "scheduled") {
  console.log("[AUTO-BACKUP] doBackup jalan. reason =", reason);

  if (backupInProgress) {
    console.log("[AUTO-BACKUP] skip, backup masih berjalan");
    return;
  }

  if (!acquireBackupLock()) {
    console.log("[AUTO-BACKUP] skip, lock file masih aktif");
    return;
  }

  backupInProgress = true;

  try {
    const files = getImportantFiles();
    if (files.length === 0) {
      console.log("[AUTO-BACKUP] tidak ada file penting");
      return;
    }

    await ensureGitRepo();
    const remoteName = await ensureRemote();

    for (const file of files) {
      await execPromise(`git add "${file}"`);
    }

    let changedFiles = [];

    try {
      const { stdout } = await execPromise("git diff --cached --name-only");
      changedFiles = stdout
        ? stdout.split("\n").map((v) => v.trim()).filter(Boolean)
        : [];
    } catch (_) { }

    if (changedFiles.length === 0) {
      console.log("[AUTO-BACKUP] tidak ada perubahan untuk di-commit");
      return;
    }

    const message = `auto backup ${new Date().toISOString()} [${reason}]`;

    try {
      await execPromise(`git commit -m "${message}"`);
    } catch (err) {
      const stderr = err.stderr || "";
      if (stderr.includes("nothing to commit")) {
        console.log("[AUTO-BACKUP] nothing to commit");
        return;
      }
      throw err;
    }

    if (remoteName) {
      const branch = process.env.GITHUB_BRANCH || "main";

      await execPromise(`git fetch ${remoteName} ${branch}`);

      try {
        await execPromise(`git rebase --autostash ${remoteName}/${branch}`);
      } catch (err) {
        await execPromise("git rebase --abort").catch(() => { });
        // Paksa hapus direktori rebase jika abort gagal (terutama di Windows/VPS Linux)
        try {
          const fs = require('fs');
          const path = require('path');
          fs.rmSync(path.join(process.cwd(), '.git', 'rebase-merge'), { recursive: true, force: true });
          fs.rmSync(path.join(process.cwd(), '.git', 'rebase-apply'), { recursive: true, force: true });
        } catch (e) {}
        throw err;
      }

      await execPromise(`git push ${remoteName} ${branch}`);
    }

    const reasonFiles = parseChangedFiles(reason);
    const shownFiles = reasonFiles?.length ? reasonFiles : changedFiles;

    logSuccess(`Backup sukses (${shownFiles.join(", ")})`);
  } catch (err) {
    logError("Backup gagal:", err.stderr || err.error?.message || err);
  } finally {
    backupInProgress = false;
    releaseBackupLock();
  }
}

function scheduleBackup(reason = "file-changed") {
  if (backupTimer) clearTimeout(backupTimer);

  backupTimer = setTimeout(() => {
    doBackup(reason);
  }, DEBOUNCE_MS);
}

function watchImportantFiles() {
  const files = getImportantFiles();
  if (files.length === 0) {
    console.log("[AUTO-BACKUP] tidak ada file penting untuk dipantau");
    return;
  }

  console.log("[AUTO-BACKUP] memantau file:", files.join(", "));

  for (const file of files) {
    const fullPath = path.join(ROOT_DIR, file);

    try {
      fs.watchFile(
        fullPath,
        { interval: 15000 },
        (curr, prev) => {
          if (curr.mtimeMs !== prev.mtimeMs) {
            console.log(`[AUTO-BACKUP] perubahan terdeteksi: ${file}`);
            scheduleBackup(`changed:${file}`);
          }
        }
      );
    } catch (err) {
      logError(`Gagal memantau ${file}:`, err.message);
    }
  }
}

function startAutoBackup() {
  console.log("[AUTO-BACKUP] startAutoBackup() terpanggil");
  watchImportantFiles();

  setInterval(() => {
    console.log("[AUTO-BACKUP] interval run");
    doBackup("interval");
  }, BACKUP_INTERVAL_MS);
}

const LOCK_FILE = path.join(ROOT_DIR, '.backup.lock');

function acquireBackupLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      const ageMs = Date.now() - stat.mtimeMs;

      // lock lebih dari 5 menit dianggap nyangkut
      if (ageMs > 5 * 60 * 1000) {
        console.log('[AUTO-BACKUP] lock basi dibersihkan');
        fs.unlinkSync(LOCK_FILE);
      } else {
        return false;
      }
    }

    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch (err) {
    console.error('[AUTO-BACKUP] gagal acquire lock:', err?.message || err);
    return false;
  }
}

function releaseBackupLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (_) { }
}

module.exports = {
  startAutoBackup,
  doBackup,
  scheduleBackup,
};
