require("dotenv").config();

const { spawn } = require("child_process");
const {
  startupRestore
} = require("./utils/startupRestore");

async function main() {
  console.log(
    "🚀 Starting Bot Debit PPA 06-O..."
  );

  const restoreResult =
    await startupRestore();

  if (restoreResult.updated) {
    console.log(
      "♻️ Ada pembaruan project dari GitHub."
    );

    console.log(
      "♻️ Memulai ulang proses agar seluruh script terbaru dimuat..."
    );

    /*
      PM2 akan otomatis menjalankan index.js kembali.
      Pada proses kedua, commit sudah sama sehingga
      tidak terjadi restart berulang.
    */
    process.exit(75);
    return;
  }

  console.log(
    "🤖 Menjalankan bot.js..."
  );

  const botProcess = spawn(
    "node",
    ["bot.js"],
    {
      stdio: "inherit",
      cwd: process.cwd()
    }
  );

  botProcess.on("close", (code) => {
    console.log(
      `bot.js berhenti dengan code: ${code}`
    );

    process.exit(code || 1);
  });

  botProcess.on("error", (error) => {
    console.error(
      "Gagal menjalankan bot.js:",
      error
    );

    process.exit(1);
  });
}

main().catch((error) => {
  console.error(
    "Index gagal dijalankan:",
    error
  );

  process.exit(1);
});