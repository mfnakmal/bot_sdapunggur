const {
  execFileSync
} = require("child_process");

const {
  commitLocalData,
  syncCommitsToGithub
} = require("./gitBackup");

function runGit(args, silent = false) {
  if (!silent) {
    console.log(
      `$ git ${args.join(" ")}`
    );
  }

  return execFileSync(
    "git",
    args,
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: silent
        ? ["ignore", "pipe", "pipe"]
        : "inherit"
    }
  );
}

function getCurrentCommit() {
  try {
    return String(
      runGit(
        ["rev-parse", "HEAD"],
        true
      )
    ).trim();
  } catch (error) {
    return null;
  }
}

async function startupRestore() {
  console.log(
    "🔄 Menyimpan data lokal lalu mengambil script terbaru dari GitHub..."
  );

  const commitBefore =
    getCurrentCommit();

  try {
    /*
      1. Data lokal disimpan dahulu.

      Jadi laporan debit yang belum sempat ter-push
      tidak hilang ketika VPS direstore.
    */
    await commitLocalData(
      "backup data lokal sebelum startup restore"
    );

    /*
      2. Perubahan script lokal di VPS dibuang.

      Sesuai flow yang disepakati:
      script GitHub adalah sumber utama.
    */
    runGit([
      "reset",
      "--hard",
      "HEAD"
    ]);

    /*
      3. Gabungkan commit data VPS dengan versi GitHub,
      kemudian push.

      Ini tetap dijalankan walaupun tidak ada perubahan
      baru, karena mungkin terdapat commit backup lama
      yang belum berhasil di-push.
    */
    await syncCommitsToGithub();

    /*
      4. Paksa seluruh file tracked di VPS sama
      dengan versi terbaru GitHub.
    */
    runGit([
      "fetch",
      "origin",
      "main"
    ]);

    runGit([
      "reset",
      "--hard",
      "origin/main"
    ]);

    const commitAfter =
      getCurrentCommit();

    const updated = Boolean(
      commitBefore &&
      commitAfter &&
      commitBefore !== commitAfter
    );

    console.log(
      "✅ Restore GitHub selesai. Data lokal tetap aman."
    );

    return {
      ok: true,
      updated,
      commitBefore,
      commitAfter
    };
  } catch (error) {
    console.error(
      "⚠️ Restore GitHub gagal."
    );

    console.error(
      error.stderr?.toString() ||
      error.stdout?.toString() ||
      error.message ||
      error
    );

    console.error(
      "Bot tetap dijalankan menggunakan file lokal."
    );

    return {
      ok: false,
      updated: false
    };
  }
}

module.exports = {
  startupRestore
};