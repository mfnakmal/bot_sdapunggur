const { execSync } = require("child_process");

function runCommand(command) {
  console.log(`$ ${command}`);
  return execSync(command, {
    stdio: "inherit",
    cwd: process.cwd()
  });
}

async function startupRestore() {
  console.log("🔄 Mengecek backup GitHub sebelum bot dijalankan...");

  try {
    runCommand("git status");

    // Ambil data terbaru dari GitHub
    runCommand("git pull origin main --rebase");

    console.log("✅ Restore/pull dari GitHub selesai.");
    return true;
  } catch (error) {
    console.error("⚠️ Gagal restore dari GitHub.");
    console.error("Bot tetap akan dijalankan dengan data lokal.");
    return false;
  }
}

module.exports = {
  startupRestore
};