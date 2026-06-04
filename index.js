require("dotenv").config();

const { spawn } = require("child_process");
const { startupRestore } = require("./utils/startupRestore");

async function main() {
  console.log("🚀 Starting Bot Debit PPA 06-O...");

  await startupRestore();

  console.log("🤖 Menjalankan bot.js...");

  const botProcess = spawn("node", ["bot.js"], {
    stdio: "inherit",
    cwd: process.cwd()
  });

  botProcess.on("close", (code) => {
    console.log(`bot.js berhenti dengan code: ${code}`);

    // biar PM2 restart index.js kalau bot.js mati
    process.exit(code || 1);
  });

  botProcess.on("error", (error) => {
    console.error("Gagal menjalankan bot.js:", error);
    process.exit(1);
  });
}

main();