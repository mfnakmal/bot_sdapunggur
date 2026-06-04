const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

let backupTimer = null;
let isBackingUp = false;

function ensureBackupFolders() {
  const folders = [
    "data",
    "uploads",
    "exports",
    "exports/excel",
    "exports/pdf"
  ];

  folders.forEach((folder) => {
    const fullPath = path.join(process.cwd(), folder);

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  const keepFiles = [
    "uploads/.gitkeep",
    "exports/excel/.gitkeep",
    "exports/pdf/.gitkeep"
  ];

  keepFiles.forEach((file) => {
    const fullPath = path.join(process.cwd(), file);

    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, "");
    }
  });
}

function run(command) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        return reject({
          error,
          stdout,
          stderr
        });
      }

      resolve(stdout);
    });
  });
}

async function backupToGithub(reason = "update data") {
  if (isBackingUp) {
    console.log("⏳ Backup masih berjalan, skip dulu...");
    return;
  }

  isBackingUp = true;

  try {
    ensureBackupFolders();

    console.log("🔄 Backup ke GitHub dimulai...");

    // Stage file yang memang perlu dibackup
    // sessions.json sengaja tidak ikut karena hanya sesi sementara
    await run(
      "git add -A data/users.json data/pintu.json data/laporan_debit.json data/dokumentasi.json uploads exports .gitignore"
    );

    const status = await run(
      "git status --porcelain data/users.json data/pintu.json data/laporan_debit.json data/dokumentasi.json uploads exports .gitignore"
    );

    if (!status.trim()) {
      console.log("✅ Tidak ada perubahan untuk dibackup.");
      return;
    }

    const safeReason = String(reason).replace(/"/g, "'");
    const message = `backup: ${safeReason} ${new Date().toISOString()}`;

    await run(`git commit -m "${message}"`);

    // Ambil update terbaru dari GitHub dengan aman
    await run("git pull origin main --rebase --autostash");

    // Push hasil backup
    await run("git push origin main");

    console.log("✅ Backup ke GitHub berhasil.");
  } catch (err) {
    console.error("❌ Backup ke GitHub gagal:");
    console.error(err.stderr || err.error?.message || err);
  } finally {
    isBackingUp = false;
  }
}

function scheduleBackup(reason = "update data") {
  if (backupTimer) {
    clearTimeout(backupTimer);
  }

  // Delay 10 detik supaya kalau banyak input tidak push berkali-kali
  backupTimer = setTimeout(() => {
    backupToGithub(reason);
  }, 10000);
}

module.exports = {
  backupToGithub,
  scheduleBackup
};