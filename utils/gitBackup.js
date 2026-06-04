const { exec } = require("child_process");

let backupTimer = null;
let isBackingUp = false;

function run(command) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stderr });
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
    console.log("🔄 Backup ke GitHub dimulai...");

    await run("git add data uploads exports");

    const status = await run("git status --porcelain");

    if (!status.trim()) {
      console.log("✅ Tidak ada perubahan untuk dibackup.");
      isBackingUp = false;
      return;
    }

    const message = `backup: ${reason} ${new Date().toISOString()}`;

    await run(`git commit -m "${message}"`);
    await run("git pull origin main --rebase");
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

  // delay 10 detik supaya kalau banyak input tidak push berkali-kali
  backupTimer = setTimeout(() => {
    backupToGithub(reason);
  }, 10000);
}

module.exports = {
  backupToGithub,
  scheduleBackup
};