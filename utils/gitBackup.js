const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

/*
  Semua isi data, uploads, dan exports akan dibackup.

  data/sessions.json dikecualikan untuk keamanan selama
  masa perpindahan ke runtime/sessions.json.
*/
const BACKUP_PATHS = [
  "data",
  "uploads",
  "exports",
  ":(exclude)data/sessions.json"
];

let backupTimer = null;
let activeBackup = null;
let backupRequestedAgain = false;
let latestReason = "update data";

function ensureBackupFolders() {
  const folders = [
    "data",
    "uploads",
    "exports",
    "exports/excel",
    "exports/pdf",
    "runtime"
  ];

  folders.forEach((folder) => {
    const fullPath = path.join(
      process.cwd(),
      folder
    );

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, {
        recursive: true
      });
    }
  });

  const keepFiles = [
    "uploads/.gitkeep",
    "exports/excel/.gitkeep",
    "exports/pdf/.gitkeep"
  ];

  keepFiles.forEach((file) => {
    const fullPath = path.join(
      process.cwd(),
      file
    );

    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(
        fullPath,
        "",
        "utf-8"
      );
    }
  });
}

function runGit(args, allowFailure = false) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: process.cwd(),
        maxBuffer: 20 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const result = {
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          code: error?.code ?? 0
        };

        if (error && !allowFailure) {
          return reject(result);
        }

        resolve(result);
      }
    );
  });
}

function makeCommitMessage(reason) {
  const cleanReason = String(
    reason || "update data"
  )
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 100);

  return `backup: ${cleanReason} ${new Date().toISOString()}`;
}

async function commitLocalData(
  reason = "update data"
) {
  ensureBackupFolders();

  await runGit([
    "add",
    "-A",
    "--",
    ...BACKUP_PATHS
  ]);

  const status = await runGit([
    "status",
    "--porcelain",
    "--",
    ...BACKUP_PATHS
  ]);

  if (!status.stdout.trim()) {
    return {
      ok: true,
      changed: false
    };
  }

  await runGit([
    "commit",
    "-m",
    makeCommitMessage(reason),
    "--",
    ...BACKUP_PATHS
  ]);

  return {
    ok: true,
    changed: true
  };
}

async function syncCommitsToGithub(
  maxAttempts = 3
) {
  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    await runGit([
      "fetch",
      "origin",
      "main"
    ]);

    try {
      await runGit([
        "rebase",
        "origin/main"
      ]);
    } catch (error) {
      await runGit(
        ["rebase", "--abort"],
        true
      );

      throw error;
    }

    try {
      await runGit([
        "push",
        "origin",
        "main"
      ]);

      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      console.log(
        `⚠️ Push ditolak karena GitHub berubah. ` +
        `Mencoba ulang ${attempt + 1}/${maxAttempts}...`
      );
    }
  }
}

async function performBackup(reason) {
  console.log(
    `🔄 Backup GitHub dimulai: ${reason}`
  );

  try {
    const commitResult =
      await commitLocalData(reason);

    /*
      Tetap sinkronkan walaupun tidak ada perubahan baru.

      Ini berguna apabila sebelumnya data sudah berhasil
      di-commit, tetapi push ke GitHub sempat gagal.
    */
    await syncCommitsToGithub();

    if (commitResult.changed) {
      console.log(
        "✅ Data berhasil di-commit dan di-push ke GitHub."
      );
    } else {
      console.log(
        "✅ Tidak ada data baru. GitHub sudah sinkron."
      );
    }

    return {
      ok: true,
      changed: commitResult.changed
    };
  } catch (error) {
    console.error(
      "❌ Backup ke GitHub gagal:"
    );

    console.error(
      error.stderr ||
      error.stdout ||
      error
    );

    return {
      ok: false,
      changed: false,
      error
    };
  }
}

async function backupToGithub(
  reason = "update data"
) {
  latestReason = reason;

  /*
    Jika backup sebelumnya masih berlangsung,
    jangan jalankan dua proses Git bersamaan.
  */
  if (activeBackup) {
    backupRequestedAgain = true;
    return activeBackup;
  }

  activeBackup = (async () => {
    let result;

    do {
      backupRequestedAgain = false;

      result = await performBackup(
        latestReason
      );
    } while (backupRequestedAgain);

    return result;
  })();

  try {
    return await activeBackup;
  } finally {
    activeBackup = null;
  }
}

function scheduleBackup(
  reason = "update data"
) {
  latestReason = reason;

  if (backupTimer) {
    clearTimeout(backupTimer);
  }

  /*
    Tunggu 10 detik agar beberapa perubahan berdekatan
    digabung menjadi satu commit GitHub.
  */
  backupTimer = setTimeout(() => {
    backupTimer = null;

    backupToGithub(
      latestReason
    );
  }, 10000);
}

async function flushBackup(
  reason = "flush backup"
) {
  latestReason = reason;

  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }

  return backupToGithub(
    latestReason
  );
}

module.exports = {
  backupToGithub,
  scheduleBackup,
  flushBackup,
  commitLocalData,
  syncCommitsToGithub
};