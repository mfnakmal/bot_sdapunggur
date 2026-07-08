const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

function log(msg) {
  console.log(`[GITHUB-SYNC] ${msg}`);
}

function safeExec(command, options = {}) {
  return execSync(command, {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    encoding: 'utf8',
    ...options
  }).trim();
}

function ensureGitRepo() {
  const gitPath = path.join(ROOT_DIR, '.git');

  if (!fs.existsSync(gitPath)) {
    log('Repo git belum ada, inisialisasi...');
    safeExec('git init');
    try { safeExec('git branch -M main'); } catch (_) {}
  }

  try { safeExec('git config user.name "Auto Backup Bot"'); } catch (_) {}
  try { safeExec('git config user.email "autobackup@example.com"'); } catch (_) {}
}

function ensureRemote() {
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const remoteName = process.env.GIT_REMOTE_NAME || 'origin';

  if (!repo || !token) {
    throw new Error('GITHUB_REPO atau GITHUB_TOKEN belum diisi di .env');
  }

  const remoteUrl = `https://${token}@github.com/${repo}.git`;

  let remotes = '';
  try {
    remotes = safeExec('git remote');
  } catch (_) {}

  const remoteList = remotes
    ? remotes.split('\n').map(v => v.trim()).filter(Boolean)
    : [];

  if (!remoteList.includes(remoteName)) {
    log(`Menambahkan remote ${remoteName}...`);
    safeExec(`git remote add ${remoteName} "${remoteUrl}"`);
  } else {
    try {
      safeExec(`git remote set-url ${remoteName} "${remoteUrl}"`);
    } catch (_) {}
  }

  return remoteName;
}

function restoreFilesFromGithub() {
  const enabled = (process.env.GITHUB_STARTUP_SYNC || 'true').toLowerCase() === 'true';
  if (!enabled) {
    log('Startup sync dimatikan.');
    return;
  }

  try {
    ensureGitRepo();
    const remoteName = ensureRemote();
    const branch = process.env.GITHUB_BRANCH || 'main';

    // Bersihkan lock/rebase nyangkut sebelum sync
    try {
      fs.rmSync(path.join(ROOT_DIR, '.git', 'index.lock'), { force: true });
      fs.rmSync(path.join(ROOT_DIR, '.git', 'rebase-merge'), { recursive: true, force: true });
      fs.rmSync(path.join(ROOT_DIR, '.git', 'rebase-apply'), { recursive: true, force: true });
      safeExec('git rebase --abort');
    } catch (_) {}

    log(`Fetch terbaru dari ${remoteName}/${branch}...`);
    try {
      safeExec(`git fetch ${remoteName} ${branch}`);
    } catch (fetchErr) {
      log(`Fetch biasa gagal, mencoba fetch --all...`);
      safeExec(`git fetch --all`);
    }

    try {
      safeExec(`git checkout -B ${branch}`);
    } catch (_) {}

    // AMAN: sebelum reset dari GitHub, simpan snapshot lokal dulu
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const snapshotDir = path.join(ROOT_DIR, 'local_snapshots', stamp);

fs.mkdirSync(snapshotDir, { recursive: true });

const filesToProtect = [
  'data.json',
  'tasks.json',
  'subscribers.json',
  'owners.json',
  'bot_switch.json',
  'categories.json',
  'sticker_style.json',
  'simi.json',
  'excludes.json',
  'contact_links.json',
  'uno.json',
  'data/dm_users.json',
  'premium_users.json'
];

for (const file of filesToProtect) {
  const src = path.join(ROOT_DIR, file);
  const dst = path.join(snapshotDir, file);

  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

log(`Snapshot lokal dibuat: ${snapshotDir}`);

log(`Reset lokal ke ${remoteName}/${branch}...`);
safeExec(`git reset --hard ${remoteName}/${branch}`);

log('Startup sync selesai. Branch lokal sudah sama dengan remote.');
  } catch (err) {
    console.error('[GITHUB-SYNC] Gagal startup sync:', err.message || err);
  }
}

module.exports = {
  restoreFilesFromGithub
};