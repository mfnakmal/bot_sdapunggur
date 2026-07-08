require('dotenv').config();
console.log('[BOOT]', __filename, new Date().toISOString());

// ========================================================
// AUTO GITHUB STARTUP SYNC (UNTUK PM2 DIRECT RUN)
// ========================================================
try {
  const enabledSync = (process.env.GITHUB_STARTUP_SYNC || 'true').toLowerCase() === 'true';
  if (enabledSync && !process.env.BYPASS_STARTUP_SYNC) {
    const { execSync } = require('child_process');
    let beforeHash = null;
    try { beforeHash = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim(); } catch (_) {}

    console.log('[BOOT] Mengecek dan menarik update terbaru dari GitHub...');
    const { restoreFilesFromGithub } = require('./backup/githubSync');
    restoreFilesFromGithub();

    let afterHash = null;
    try { afterHash = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim(); } catch (_) {}

    if (beforeHash && afterHash && beforeHash !== afterHash) {
      console.log(`[BOOT] 🔄 Update baru terdeteksi (${beforeHash.slice(0,7)} -> ${afterHash.slice(0,7)}). Me-restart proses agar menggunakan kode baru...`);
      process.exit(0);
    }
    console.log('[BOOT] GitHub sync selesai.');
  }
} catch (e) {
  console.log('[BOOT] GitHub sync dilewatkan:', e?.message || e);
}

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const cron = require('node-cron');
const FormData = require('form-data');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const { startAutoBackup } = require('./backup/backup');
const tugasCmd = require('./commands/tugas');

const { createDonationPromo } = require('./utils/donationPromo');
const { handleAICommand } = require('./ai/command');
const { handleInstagramDownload, handleInstagramMp3Download } = require('./commands/instagram');
const { handleInstagramStoriesDownload } = require('./commands/instagramStories');
const { handleTikTokDownload } = require('./commands/tiktok');
const { handleTwitterDownload } = require('./commands/twitter');
const { handleYouTubeDownload } = require('./commands/youtube');
const { handleTTS } = require('./commands/tts');
const { handleResiCommand } = require('./commands/resi');
const { createImageToPdfHandlers } = require('./commands/imageToPdf');
const { createPdfToImageHandlers } = require('./commands/pdfToImage');
const { createPdfToolsHandlers } = require('./commands/pdfTools');
const { registerWeddingReminder } = require('./commands/weddingReminder');
const { registerHealthReminder } = require('./commands/healthReminder');
const { buildStickerStore } = require('./utils/sticker');
const { createStickerHandlers } = require('./commands/sticker');
const { safeSendMessage, safeSendMedia, canSendNow } = require('./utils/send');
const { checkAndGetPromo } = require('./utils/channelPromo');
const { initDedup } = require('./utils/dedup');
const { broadcastText, broadcastImage, resolveSpintax } = require('./utils/broadcast');
const { buildFinanceNaturalHandler } = require('./finance/handler');
const financeDashboard = require('./finance/dashboard');

/*
const { handleImageCommand } = require('./ai/imageCommand');
const { createImageEditHandlers } = require('./commands/imageEdit');
*/


const CHROME_PATH = '/usr/bin/google-chrome-stable';

if (!CHROME_PATH) {
  throw new Error("Browser tidak ditemukan (Chrome/Edge).");
}

console.log("🌐 Browser dipakai:", CHROME_PATH);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// ==== OWNER & SWITCH & LOG ====
const OWNERS_PATH = 'owners.json';
const SWITCH_PATH = 'bot_switch.json';
// seed owner awal (ganti ke nomormu jika perlu)
const OWNER_SEED = '6281379826684@c.us';
const PRIMARY_OWNER = '6281379826684@c.us';




function isPrimaryOwnerJid(jid) {
  return canonicalJid(jid) === PRIMARY_OWNER;
}
// ==== MUTE / EXCLUDES ====
const EXCLUDES_PATH = 'excludes.json';
// ==== STICKER STYLE (per chat) ====
const STICKER_STYLE_PATH = 'sticker_style.json';

// ==== CATEGORIES STORE ====
const CATEGORIES_PATH = 'categories.json';



function loadCategories() {
  try {
    return JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf8'));
  } catch (e) { return {}; }
}
function saveCategories(obj) {
  try {
    fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(obj, null, 2));
  } catch (e) { }
}

let categories = loadCategories();

let pendingBroadcast = {};

let pendingBroadcastImage = {}; // { [ownerJid]: { caption, created } }

//sticker const



async function seedDmUsersFromLegacySources() {
  try {
    const legacySet = new Set();

    for (const k of Object.keys(data || {})) {
      const id = canonicalJid(k);
      if (id && /^62\d+@c\.us$/i.test(id)) legacySet.add(id);
    }

    for (const k of Object.keys(tasks || {})) {
      const id = canonicalJid(k);
      if (id && /^62\d+@c\.us$/i.test(id)) legacySet.add(id);
    }

    for (const j of (subs || [])) {
      const id = canonicalJid(j);
      if (id && /^62\d+@c\.us$/i.test(id)) legacySet.add(id);
    }

    for (const j of (excludes?.list || [])) {
      const id = canonicalJid(j);
      if (id && /^62\d+@c\.us$/i.test(id)) legacySet.add(id);
    }

    for (const j of [...legacySet]) {
      if (typeof isOwnerJid === 'function' && isOwnerJid(j)) {
        legacySet.delete(j);
      }
    }

    const merged = new Set([
      ...(dmUsers.list || []),
      ...legacySet
    ]);

    dmUsers.list = [...merged]
      .map(canonicalJid)
      .filter(j => j && /^62\d+@c\.us$/i.test(j));

    saveDmUsers();
    console.log('[DM_USERS] seeded:', dmUsers.list.length);
  } catch (e) {
    console.log('[DM_USERS] seed gagal:', e?.message || e);
  }
}



// --- Pastikan file konfigurasi ada (auto-create jika hilang) ---
function ensureJson(path, defaultObj) {
  try {
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path, JSON.stringify(defaultObj, null, 2));
    } else {
      // validasi: kalau rusak/invalid, tulis ulang
      JSON.parse(fs.readFileSync(path, 'utf8'));
    }
  } catch {
    fs.writeFileSync(path, JSON.stringify(defaultObj, null, 2));
  }
}

ensureJson(OWNERS_PATH, { list: [OWNER_SEED] });           // ← OWNER_SEED: '6281379826684@c.us'
ensureJson(EXCLUDES_PATH, { list: [] });
ensureJson(SWITCH_PATH, { enabled: true, logEnabled: false });



const CONTACT_LINKS_PATH = 'contact_links.json';
ensureJson(CONTACT_LINKS_PATH, {});

const dedup = initDedup(ensureJson);

function loadContactLinks() {
  try {
    return JSON.parse(fs.readFileSync(CONTACT_LINKS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveContactLinks(obj) {
  fs.writeFileSync(CONTACT_LINKS_PATH, JSON.stringify(obj, null, 2));
}

let contactLinks = loadContactLinks();

let IS_STARTING_UP = true;

// DM USERS SUBSTORE //
const DATA_DIR = path.join(process.cwd(), 'data');
ensureDirSync(DATA_DIR);

const DM_USERS_PATH = path.join(DATA_DIR, 'dm_users.json');
ensureJson(DM_USERS_PATH, { list: [] });

function loadDmUsers() {
  try {
    return JSON.parse(fs.readFileSync(DM_USERS_PATH, 'utf8'));
  } catch {
    return { list: [] };
  }
}

let dmUsers = loadDmUsers();
dmUsers.list = [...new Set((dmUsers.list || []).map(canonicalJid))]
  .filter(j => j && /^62\d+@c\.us$/i.test(j));

saveDmUsers();

function saveDmUsers(reason = null) {
  writeJson(DM_USERS_PATH, dmUsers, reason);
}
//===============================//

function normalizePhoneToCUs(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();

  if (s.endsWith('@c.us')) return s;

  s = s.replace(/[^\d]/g, '');
  if (s.startsWith('0')) s = '62' + s.slice(1);
  if (!s.startsWith('62')) return null;

  return `${s}@c.us`;
}

function canonicalJid(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return s;

  // grup: biarkan stabil apa adanya
  if (s.endsWith('@g.us')) return s;

  // jid user normal
  if (s.endsWith('@c.us')) return s;

  // lid: pakai mapping kalau sudah ada
  if (s.endsWith('@lid') && contactLinks[s]) {
    return String(contactLinks[s]).toLowerCase();
  }

  // selain itu biarkan dulu
  return s;
}

async function learnLidMapping(msg) {
  try {
    const rawFrom = String(msg.from || '').trim().toLowerCase();
    if (!rawFrom.endsWith('@lid')) return;

    const contact = await msg.getContact().catch(() => null);
    if (!contact) return;

    const candidates = [
      contact?.id?._serialized,
      contact?.number,
      contact?.userid,
      contact?.phoneNumber,
      contact?.pushname
    ].filter(Boolean);

    let mapped = null;

    for (const c of candidates) {
      const s = String(c).trim().toLowerCase();

      if (s.endsWith('@c.us')) {
        mapped = s;
        break;
      }

      const n = normalizePhoneToCUs(s);
      if (n) {
        mapped = n;
        break;
      }
    }

    if (mapped && contactLinks[rawFrom] !== mapped) {
      contactLinks[rawFrom] = mapped;
      saveContactLinks(contactLinks);
      console.log('[LID MAP]', rawFrom, '->', mapped);
    }
  } catch (e) {
    console.log('[LID MAP] gagal:', e?.message || e);
  }
}



//======================================================//



async function sendInChunks(client, to, text, chunkSize = 3800) {
  if (!text) return;

  const parts = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    parts.push(text.slice(i, i + chunkSize));
  }

  for (const p of parts) {
    await safeSendMessage(client, to, p);
    await new Promise(r => setTimeout(r, 1500));
  }
}




// ==== CATEGORY HELPERS ====
function normalizeCategoryName(name) {
  const s = (name || '').toString().trim().replace(/\s+/g, ' ').slice(0, 30);
  // Kapitalisasi awal kata
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function addCategoryForChat(chatKey, cat) {
  if (!cat) return null;
  const c = normalizeCategoryName(cat);
  categories[chatKey] = categories[chatKey] || [];
  if (!categories[chatKey].includes(c)) {
    categories[chatKey].push(c);
    saveCategories(categories);
  }
  return c;
}

// Ambil #Kategori di UJUNG deskripsi; hapus dari deskripsi
function extractCategoryFromDesc(desc) {
  // Contoh cocok: "beli ayam #Makanan", "bbm #transportasi", "tiket # hiburan"
  const m = desc.match(/#\s*([^\s#][\w\s\-_/]{0,28}[^\s#]?)\s*$/i);
  if (!m) return { clean: desc.trim(), category: null };
  const raw = m[1];
  const clean = desc.replace(m[0], '').trim();
  return { clean, category: normalizeCategoryName(raw) };
}



// ============ collect DM known ============ //
async function collectKnownDM(client) {
  const set = new Set();

  try {
    for (const j of (dmUsers.list || [])) {
      const id = canonicalJid(j);
      if (id && /^62\d+@c\.us$/i.test(id)) set.add(id);
    }
  } catch { }

  try {
    for (const j of [...set]) {
      if (typeof isOwnerJid === 'function' && isOwnerJid(j)) {
        set.delete(j);
      }
    }
  } catch { }

  return [...set].sort();
}

//====== HELPER: Broadcast dengan batching dan jeda acak ======//
function collectBroadcastTargets() {
  const set = new Set();

  try {
    for (const k of Object.keys(data || {})) {
      const id = canonicalJid(k);
      if (id && /^62\d+@c\.us$/i.test(id)) set.add(id);
    }
  } catch { }

  try {
    for (const k of Object.keys(tasks || {})) {
      const id = canonicalJid(k);
      if (id && /^62\d+@c\.us$/i.test(id)) set.add(id);
    }
  } catch { }

  try {
    for (const j of (subs || [])) {
      const id = canonicalJid(j);
      if (id && /^62\d+@c\.us$/i.test(id)) set.add(id);
    }
  } catch { }

  try {
    for (const j of [...set]) {
      if (isOwnerJid(j)) set.delete(j);
      if (isExcludedJid(j)) set.delete(j);
    }
  } catch { }

  return [...set].sort();
}

//====== BATAS STICKER ========//

let excludes = fs.existsSync(EXCLUDES_PATH)
  ? JSON.parse(fs.readFileSync(EXCLUDES_PATH))
  : { list: [] }; // contoh item: "62812xxxxxxx@c.us"

function saveExcludes() { fs.writeFileSync(EXCLUDES_PATH, JSON.stringify(excludes, null, 2)); }

/** Normalisasi input nomor ke jid @c.us */
function normalizeJid(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();

  if (s.endsWith('@g.us')) return s;
  if (s.endsWith('@c.us')) return s;
  if (s.endsWith('@lid')) return canonicalJid(s);

  s = s.replace(/[@\s\-]/g, '').replace(/^\+/, '');

  if (s.startsWith('08')) s = '628' + s.slice(2);
  if (!s.startsWith('62')) return null;

  return `${s}@c.us`.toLowerCase();
}

function jidToLocal08(input) {
  let s = String(input || '').trim().toLowerCase();

  s = s.replace(/@c\.us$/i, '');

  if (s.startsWith('62')) s = '0' + s.slice(2);
  if (/^[1-9]\d+$/.test(s)) s = '0' + s;

  return s;
}


function isExcludedJid(jid) {
  jid = (jid || '').toLowerCase();
  return excludes.list.includes(jid);
}


let owners = fs.existsSync(OWNERS_PATH)
  ? JSON.parse(fs.readFileSync(OWNERS_PATH))
  : { list: [OWNER_SEED] };
function saveOwners() { fs.writeFileSync(OWNERS_PATH, JSON.stringify(owners, null, 2)); }
function isOwnerJid(jid) { return owners.list.includes(jid); }

const PREM_USERS_PATH = 'premium_users.json';
let premUsers = fs.existsSync(PREM_USERS_PATH)
  ? JSON.parse(fs.readFileSync(PREM_USERS_PATH))
  : { list: [] };
function savePremUsers() { fs.writeFileSync(PREM_USERS_PATH, JSON.stringify(premUsers, null, 2)); }
function isPremiumUser(jid) {
  if (!jid) return false;
  const norm = normalizePhoneToCUs(jid) || canonicalJid(jid);
  if (isOwnerJid(norm) || isPrimaryOwnerJid(norm)) return true;
  return (premUsers.list || []).includes(norm);
}

let botSwitch = fs.existsSync(SWITCH_PATH)
  ? JSON.parse(fs.readFileSync(SWITCH_PATH))
  : { enabled: true, logEnabled: false };
function saveSwitch() { fs.writeFileSync(SWITCH_PATH, JSON.stringify(botSwitch, null, 2)); }

// logger ringan (aktif kalau /logon)
function log(...args) { if (botSwitch.logEnabled) console.log('[BOT]', ...args); }

function clearWWCaches() {
  try {
    const sessionPath = path.join(__dirname, '.wwebjs_auth', 'session', 'Default');
    const swPath = path.join(sessionPath, 'Service Worker');
    const cachePath = path.join(sessionPath, 'Cache');
    const cacheStoragePath = path.join(sessionPath, 'CacheStorage');

    if (fs.existsSync(swPath)) fs.rmSync(swPath, { recursive: true, force: true });
    if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { recursive: true, force: true });
    if (fs.existsSync(cacheStoragePath)) fs.rmSync(cacheStoragePath, { recursive: true, force: true });
    
    console.log('[BOOT] Cache ServiceWorker/Cache dibersihkan untuk mencegah stuck AUTH.');
  } catch (e) {
    // Abaikan jika tidak ada folder
  }
}
clearWWCaches();

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),

  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },

  puppeteer: {
    headless: "new",
    executablePath: CHROME_PATH,
    defaultViewport: null,
    timeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-zygote',
      '--disable-breakpad'
    ]
  },

  takeoverOnConflict: false,
  takeoverTimeoutMs: 60000,
  restartOnAuthFail: false
});




// Load data
let data = fs.existsSync('data.json') ? JSON.parse(fs.readFileSync('data.json')) : {};

// Start dashboard server with reference to data
financeDashboard.startDashboardServer(data, saveData);
let subs = fs.existsSync('subscribers.json') ? JSON.parse(fs.readFileSync('subscribers.json')) : [];
let tasks = fs.existsSync('tasks.json') ? JSON.parse(fs.readFileSync('tasks.json')) : {};

function remapObjectKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const nk = canonicalJid(k);
    if (!out[nk]) out[nk] = v;
    else {
      // merge sederhana kalau tabrakan
      if (typeof v === 'object' && !Array.isArray(v) && typeof out[nk] === 'object' && !Array.isArray(out[nk])) {
        out[nk] = { ...out[nk], ...v };
      }
    }
  }
  return out;
}

function mergeMonthStores(base = {}, extra = {}) {
  const out = { ...base };
  for (const [monthKey, items] of Object.entries(extra || {})) {
    if (!out[monthKey]) out[monthKey] = [];
    out[monthKey] = [...(out[monthKey] || []), ...(items || [])];
  }
  return out;
}

function remapDataKeys(store) {
  const out = {};
  for (const [k, v] of Object.entries(store || {})) {
    const nk = canonicalJid(k);
    if (!out[nk]) out[nk] = v;
    else out[nk] = mergeMonthStores(out[nk], v);
  }
  return out;
}


data = remapDataKeys(data);
tasks = remapObjectKeys(tasks);
subs = [...new Set((subs || []).map(canonicalJid))].filter(j => j && j.endsWith('@c.us'));
excludes.list = [...new Set((excludes.list || []).map(canonicalJid))];
owners.list = [...new Set((owners.list || []).map(canonicalJid))];

saveData(null);
saveTasks(null);
saveSubs(null);
saveExcludes(null);
saveOwners(null);
seedDmUsersFromLegacySources();


let pendingTasks = {}; // untuk menyimpan input tahap pertama
let pendingTugas = {}; // { [userJid]: { desc, datetime, created } }
let pendingConfirms = {}; // { [from]: { action:'hapus_tugas', scope:'chat'|'pribadi'|'semua', created:number } }
// ==== FORWARD-ONCE (owner only) ====
let pendingForward = {};
// bentuk: { [ownerJid]: { created: number, targets: string[] } }
// Menunggu kiriman foto setelah /sticker
let pendingSticker = {}; // { [chatId]: { created:number } }
let pendingImagePdf = {}; // { [userJid]: { dir, files, created } }
let pendingPdfToImage = {}; // { [userJid]: { dir, files, created } }
let pendingPdfTools = {};
let dmIntroSent = {};      // { [jid]: true }
let lastFallbackAt = {};   // { [jid]: timestamp }

const stickerStore = buildStickerStore(STICKER_STYLE_PATH);
const getStickerStyle = stickerStore.getStickerStyle;
const setStickerStyle = stickerStore.setStickerStyle;
const resetStickerStyle = stickerStore.resetStickerStyle;

const {
  handleStickerCommand,
  handlePendingSticker,
  handleStickerStyleCommand
} = createStickerHandlers({
  client,
  getStickerStyle,
  setStickerStyle,
  resetStickerStyle,
  pendingSticker,
  resolveJid: canonicalJid
});

const {
  handleImagePdfCommand,
  handlePendingImagePdf,
  cancelImagePdf
} = createImageToPdfHandlers({
  pendingImagePdf,
  safeSendMedia,
  client,
  rootDir: process.cwd(),
  resolveJid: canonicalJid
});

const {
  handlePdfMergeCommand,
  handlePdfCompressCommand,
  handlePdfSplitCommand,
  handlePendingPdfTools,
  cancelPdfTools
} = createPdfToolsHandlers({
  pendingPdfTools,
  safeSendMedia,
  client,
  rootDir: process.cwd(),
  resolveJid: canonicalJid
});

const {
  handlePdfToImageCommand,
  handlePendingPdfToImage,
  cancelPdfToImage
} = createPdfToImageHandlers({
  pendingPdfToImage,
  safeSendMedia,
  client,
  rootDir: process.cwd(),
  resolveJid: canonicalJid
});

/*
const {
  handleImageEditCommand,
  handlePendingImageEdit
} = createImageEditHandlers({
  pendingImageEdit
});
*/

// ==== SIMI MODE ====
let simi = fs.existsSync('simi.json') ? JSON.parse(fs.readFileSync('simi.json')) : {};

function saveSimi() {
  fs.writeFileSync('simi.json', JSON.stringify(simi, null, 2));
}
function getSimiCfg(chatId) {
  if (!simi[chatId]) {
    simi[chatId] = {
      enabled: false,     // aktif/tidak di grup ini
      chance: 35,         // peluang balas (%)
      cooldownSec: 20,    // jeda antar balasan (detik)
      allowMention: true, // selalu balas jika di-mention
      lastReplyAt: 0      // timestamp detik
    };
  }
  return simi[chatId];
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// =====================================
// === SIMI SMART REPLY ENGINE v3.0 ===
// =====================================

const SIMI_CONTEXT_PATH = './data/simi_context.json';

if (!fs.existsSync('./data')) fs.mkdirSync('./data');

if (!fs.existsSync(SIMI_CONTEXT_PATH)) {
  fs.writeFileSync(SIMI_CONTEXT_PATH, JSON.stringify({}, null, 2));
}

let simiCtx = {};

try {
  simiCtx = JSON.parse(fs.readFileSync(SIMI_CONTEXT_PATH, 'utf8'));
} catch (_) {
  simiCtx = {};
}

function saveSimiCtx() {
  fs.writeFileSync(SIMI_CONTEXT_PATH, JSON.stringify(simiCtx, null, 2));
}

function normalizeSimiText(input = '') {
  return String(input || '')
    .toLowerCase()
    .replace(/@\d+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDisplayName(name = '') {
  const raw = String(name || '').trim();
  if (!raw) return 'kak';

  if (/^\d+$/.test(raw)) return 'kak';

  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 20);
}

function rememberGroupContext(chatId, entry = {}) {
  if (!simiCtx[chatId]) {
    simiCtx[chatId] = {
      recent: []
    };
  }

  if (!Array.isArray(simiCtx[chatId].recent)) {
    simiCtx[chatId].recent = [];
  }

  simiCtx[chatId].recent.push({
    text: String(entry.text || '').slice(0, 300),
    sender: String(entry.sender || '').slice(0, 40),
    time: Date.now()
  });

  simiCtx[chatId].recent = simiCtx[chatId].recent
    .filter(x => x && x.text)
    .slice(-8);

  saveSimiCtx();
}

function getRecentContext(chatId) {
  const recent = simiCtx[chatId]?.recent;
  if (!Array.isArray(recent)) return [];

  const maxAge = 30 * 60 * 1000; // 30 menit
  const now = Date.now();

  return recent.filter(x => now - Number(x.time || 0) <= maxAge);
}

function pickSimi(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function looksLikeQuestion(t = '') {
  return /\?$/.test(t) ||
    /\b(apa|apaan|kenapa|mengapa|gimana|bagaimana|kapan|dimana|di mana|siapa|berapa|masa|serius|beneran|kok|emang)\b/i.test(t);
}

function isLaugh(t = '') {
  return /(wkwk|wkwwk|haha|hehe|hihi|lol|ngakak|anjir|anjay|awok|xixi)/i.test(t);
}

function isGreeting(t = '') {
  return /(ass?alam|halo|h[ai]|hello|hey|hei|pagi|siang|sore|malam|permisi)/i.test(t);
}

function isThanks(t = '') {
  return /(makasih|terima kasih|thanks|thank you|thx|tq)/i.test(t);
}

function isAgree(t = '') {
  return /\b(iya|ya|yoi|betul|bener|setuju|sepakat|oke|ok|sip|mantap|gas|lanjut)\b/i.test(t);
}

function isDisagree(t = '') {
  return /\b(nggak|gak|ga|tidak|bukan|jangan|salah|kurang|engga|enggak)\b/i.test(t);
}

function detectTopic(t = '') {
  const topics = [
    ['makan', 'makanan'],
    ['minum', 'minuman'],
    ['tidur', 'tidur'],
    ['kerja', 'kerjaan'],
    ['kuliah', 'kuliah'],
    ['tugas', 'tugas'],
    ['game', 'game'],
    ['bot', 'bot'],
    ['uang', 'uang'],
    ['duit', 'duit'],
    ['capek', 'capek'],
    ['pusing', 'pusing'],
    ['gabut', 'gabut'],
    ['youtube', 'YouTube'],
    ['tiktok', 'TikTok'],
    ['wa', 'WhatsApp'],
    ['whatsapp', 'WhatsApp']
  ];

  for (const [key, label] of topics) {
    if (t.includes(key)) return label;
  }

  const words = t
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4);

  return words[0] || '';
}

async function genSimiReplySmart({
  text,
  sender,
  chatId,
  mentionedBot = false,
  quotedText = ''
}) {
  const name = cleanDisplayName(sender);
  const raw = String(text || '').trim();
  const t = normalizeSimiText(raw);
  const q = normalizeSimiText(quotedText);

  if (!t) return null;

  // Simpan konteks sebelum diolah agar AI tahu pesan terbaru
  rememberGroupContext(chatId, {
    text: raw,
    sender: name
  });

  const recent = getRecentContext(chatId);
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return "Maaf, fitur cerdas sedang offline karena API Key belum diatur.";
  }

  // Siapkan konteks obrolan
  let contextStr = recent.map(r => `[${r.sender}]: ${r.text}`).join('\n');
  let quotedInfo = q ? `\nPesan yang di-reply oleh ${name}: "${q}"\n` : '';
  let botMentionInfo = mentionedBot ? `\n(Catatan: ${name} sengaja nge-tag atau mereply pesan kamu)` : '';

  const prompt = `Kamu adalah teman obrolan grup WhatsApp. Panggil dirimu sesuai gayamu (atau nama bot WA yang asik).
Gaya bicaramu: asik, santai, agak savage/ngejek secara bercanda (tapi tidak kasar), kadang lucu, dan nyambung dengan obrolan tongkrongan. Jangan terlihat kaku seperti asisten robot AI. Gunakan bahasa gaul Indonesia (gue/lu, wkwk, njir, dsb. sewajarnya). Jika ditanya sesuatu yang serius, tetap jawab secara informatif namun tidak kaku.

Berikut adalah riwayat chat beberapa saat terakhir (untuk konteks):
${contextStr}
${quotedInfo}${botMentionInfo}

Tugasmu: Berikan balasan HANYA pesan balasan dari kamu untuk pesan terakhir dari [${name}]. Jangan tambah label/nama pengirim di awal jawabanmu. Langsung saja ketik jawabannya sesingkat dan senatural mungkin (maksimal 2-3 kalimat santai).`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 150
        }
      }
    );
    
    let aiReply = response.data.candidates[0]?.content?.parts[0]?.text;
    return aiReply ? aiReply.trim() : null;
  } catch (error) {
    console.error('Gemini API Error:', error?.response?.data || error?.message);
    return `Waduh pusing pala gue mikir jawaban (API Error) 😭`;
  }
}

function writeJson(fileName, value, backupReason = null) {
  fs.writeFileSync(fileName, JSON.stringify(value, null, 2));

  if (!IS_STARTING_UP && backupReason) {
    try {
      const { scheduleBackup } = require('./backup/backup');
      scheduleBackup(backupReason);
    } catch (e) {
      console.error('[AUTO-BACKUP] gagal trigger:', e?.message || e);
    }
  }
}

function saveData(reason = 'changed:data.json') {
  writeJson('data.json', data, reason);
}

function saveTasks(reason = 'changed:tasks.json') {
  writeJson('tasks.json', tasks, reason);
}

function saveSubs(reason = 'changed:subscribers.json') {
  writeJson('subscribers.json', subs, reason);
}

function saveOwners(reason = 'changed:owners.json') {
  writeJson(OWNERS_PATH, owners, reason);
}

function saveExcludes(reason = 'changed:excludes.json') {
  writeJson(EXCLUDES_PATH, excludes, reason);
}

function saveSwitch(reason = 'changed:bot_switch.json') {
  writeJson(SWITCH_PATH, botSwitch, reason);
}

function getSenderId(msg) {
  return msg.author || msg.from;
}
function isGroupMessage(msg) {
  return msg.from.endsWith('@g.us');
}

function makeTxId() {
  // 6-7 char id: waktu base36 + random base36
  const t = Date.now().toString(36).slice(-4);
  const r = Math.random().toString(36).slice(2, 5);
  return (t + r).toUpperCase(); // contoh: K9F3QW
}

const { maybeSendDonationPromo } = createDonationPromo({
  rootDir: process.cwd(),
  stateFile: 'promo_state.json',
  qrisImage: 'assets/qris.jpeg',

  minInteraction: 5,
  maxInteraction: 10,
  cooldownMs: 24 * 60 * 60 * 1000,

  // true = kalau interaksi di grup, promonya dikirim ke DM user
  // false = promonya dikirim ke grup
  sendGroupPromoToDm: true,

  resolveJid: canonicalJid,
  isOwner: jid => isOwnerJid(jid) || isPrimaryOwnerJid(jid),
  safeSendMessage
});

// ====== HELPER: Cari transaksi by ID lintas bulan ======
function findTxByIdAllMonths(chatKey, idUpper) {
  const store = data[chatKey] || {};
  for (const mKey of Object.keys(store).sort()) { // urut bukan wajib
    const arr = store[mKey] || [];
    const idx = arr.findIndex(x => String(x?.id || '').toUpperCase() === idUpper);
    if (idx >= 0) {
      return { monthKey: mKey, index: idx, item: arr[idx] };
    }
  }
  return null;
}

function getSortedMonthKeys(chatKey) {
  return Object.keys(data[chatKey] || {}).sort();
}

function summarizeItems(items = []) {
  let income = 0;
  let expense = 0;

  for (const it of items) {
    if (it?.type === 'income') income += Number(it.amount || 0);
    else if (it?.type === 'expense') expense += Number(it.amount || 0);
  }

  return {
    income,
    expense,
    saldo: income - expense,
    count: items.length
  };
}

function summarizeStore(chatKey) {
  const store = data[chatKey] || {};
  const monthKeys = getSortedMonthKeys(chatKey);

  let totalIncome = 0;
  let totalExpense = 0;
  let totalCount = 0;
  let firstDate = null;
  let lastDate = null;

  const perMonth = monthKeys.map(monthKey => {
    const items = store[monthKey] || [];
    const sum = summarizeItems(items);

    totalIncome += sum.income;
    totalExpense += sum.expense;
    totalCount += sum.count;

    for (const it of items) {
      if (!it?.date) continue;
      const d = new Date(it.date);
      if (isNaN(d)) continue;

      if (!firstDate || d < firstDate) firstDate = d;
      if (!lastDate || d > lastDate) lastDate = d;
    }

    return {
      monthKey,
      ...sum
    };
  });

  return {
    monthKeys,
    perMonth,
    totalIncome,
    totalExpense,
    totalSaldo: totalIncome - totalExpense,
    totalCount,
    firstDate,
    lastDate
  };
}

function searchTransactionsAllMonths(chatKey, keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  const store = data[chatKey] || {};
  const results = [];

  if (!q) return results;

  for (const monthKey of Object.keys(store).sort()) {
    const items = store[monthKey] || [];

    items.forEach((it, idx) => {
      const desc = String(it?.desc || '');
      if (!desc.toLowerCase().includes(q)) return;

      results.push({
        monthKey,
        index: idx,
        item: it
      });
    });
  }

  results.sort((a, b) => {
    const da = new Date(a.item?.date || 0).getTime();
    const db = new Date(b.item?.date || 0).getTime();
    return db - da; // terbaru dulu
  });

  return results;
}

function getAllTransactionsIndexed(chatKey) {
  const store = data[chatKey] || {};
  const rows = [];

  const monthKeys = Object.keys(store).sort(); // lama → baru

  for (const mKey of monthKeys) {
    const arr = store[mKey] || [];

    arr.forEach((item, index) => {
      rows.push({
        globalNo: rows.length + 1,
        monthKey: mKey,
        index,
        item
      });
    });
  }

  return rows;
}

function findTxByGlobalNo(chatKey, globalNo) {
  const rows = getAllTransactionsIndexed(chatKey);
  return rows.find(r => r.globalNo === Number(globalNo)) || null;
}


// ========== UNO STORAGE ==========
let uno = fs.existsSync('uno.json') ? JSON.parse(fs.readFileSync('uno.json')) : {};
function saveUno() {
  fs.writeFileSync('uno.json', JSON.stringify(uno, null, 2));
}
function getGame(chatId) {
  if (!uno[chatId]) {
    uno[chatId] = {
      lobbyOpen: false,
      started: false,
      ownerId: null,
      players: [], // {id, name, hand:[]}
      turnIndex: 0,
      direction: 1, // 1 searah jarum jam, -1 sebaliknya
      drawPile: [],
      discardPile: [],
      currentColor: null,
      pendingDraw: 0, // akumulasi D2/W4 (v1: tidak bisa ditumpuk, pemain berikut wajib draw)
      drewThisTurn: false // pemain saat ini sudah draw atau belum
    };
  }
  return uno[chatId];
}
function isSameId(a, b) { return (a || '').toLowerCase() === (b || '').toLowerCase(); }

// Kartu: { color: 'R|G|B|Y|null', value: '0-9|S|R|D2|W|W4' }
const COLORS = ['R', 'G', 'B', 'Y']; // merah, hijau, biru, kuning
const COLOR_EMO = { R: '🔴', G: '🟢', B: '🔵', Y: '🟡' };
const VALUE_EMO = { S: '⏭', R: '🔁', D2: '+2', W: '🃏', W4: '🃏+4' };

function buildDeck() {
  const deck = [];
  for (const c of COLORS) {
    deck.push({ color: c, value: '0' });
    for (let i = 1; i <= 9; i++) { deck.push({ color: c, value: String(i) }, { color: c, value: String(i) }); }
    for (const v of ['S', 'R', 'D2']) { deck.push({ color: c, value: v }, { color: c, value: v }); }
  }
  for (let i = 0; i < 4; i++) { deck.push({ color: null, value: 'W' }, { color: null, value: 'W4' }); }
  return shuffle(deck);
}
function shuffle(a) {
  const arr = [...a]; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function cardToText(card) {
  if (!card) return '(kosong)';
  if (card.value === 'W' || card.value === 'W4') return VALUE_EMO[card.value];
  const v = /^[0-9]$/.test(card.value) ? card.value : VALUE_EMO[card.value];
  return `${COLOR_EMO[card.color]} ${v}`;
}
function parseColorWord(w) {
  if (!w) return null;
  w = w.toLowerCase();
  if (w === 'r' || w.startsWith('mer')) return 'R';
  if (w === 'g' || w.startsWith('hij')) return 'G';
  if (w === 'b' || w.startsWith('bir')) return 'B';
  if (w === 'k' || w.startsWith('kun')) return 'Y';
  return null;
}
function nextIndex(game, step = 1) {
  const n = game.players.length;
  return (game.turnIndex + game.direction * step + n * 10) % n;
}
function ensureDrawPile(game) {
  if (game.drawPile.length === 0) {
    const keepTop = game.discardPile.pop();
    game.drawPile = shuffle(game.discardPile);
    game.discardPile = [keepTop];
  }
}
function drawOne(game) { ensureDrawPile(game); return game.drawPile.pop(); }

// cek boleh main
function canPlay(game, card) {
  const top = game.discardPile[game.discardPile.length - 1];
  if (!top) return true; // awal
  if (card.value === 'W' || card.value === 'W4') return true;
  // respect warna aktif (bisa di-set via Wild)
  const activeColor = game.currentColor || top.color;
  return (card.color === activeColor) || (card.value === top.value);
}

function dealAndStart(game) {
  game.drawPile = buildDeck();
  game.discardPile = [];
  // bagi 7
  for (const p of game.players) {
    p.hand = [];
    for (let i = 0; i < 7; i++) { p.hand.push(drawOne(game)); }
  }
  // buka kartu atas non-Wild
  let first;
  do {
    first = drawOne(game);
    // jika deck habis, re-fill
    if (!first) { ensureDrawPile(game); first = drawOne(game); }
  } while (first && (first.value === 'W' || first.value === 'W4')); // supaya mudah, hindari wild di awal
  game.discardPile.push(first);
  game.currentColor = first.color;
  game.pendingDraw = 0;
  game.turnIndex = 0;
  game.direction = 1;
  game.drewThisTurn = false;

  // jika kartu pertama aksi (S/R/D2), terapkan efek langsung ke giliran
  if (first.value === 'R') {
    // reverse: untuk 2 pemain = skip
    if (game.players.length === 2) {
      game.turnIndex = nextIndex(game, 1);
    } else {
      game.direction *= -1;
    }
  } else if (first.value === 'S') {
    game.turnIndex = nextIndex(game, 1); // skip satu
  } else if (first.value === 'D2') {
    const victim = nextIndex(game, 1);
    for (let i = 0; i < 2; i++) { game.players[victim].hand.push(drawOne(game)); }
    game.turnIndex = nextIndex(game, 2); // korban kehilangan giliran
  }
}

function handToLines(hand) {
  // tampilkan index & kode singkat
  return hand.map((c, i) => {
    const short = (c.value === 'W' || c.value === 'W4') ? c.value : (c.color + c.value);
    return `${i + 1}. ${cardToText(c)}  \`${short}\``;
  }).join('\n');
}
function findPlayer(game, userId) {
  return game.players.find(p => isSameId(p.id, userId));
}
function removeFromHandByCode(player, code) {
  // code contoh: R5, G0, B9, Y2, W, W4, G+2 -> D2
  code = (code || '').toUpperCase().replace('+2', 'D2').trim();
  for (let i = 0; i < player.hand.length; i++) {
    const c = player.hand[i];
    const short = (c.value === 'W' || c.value === 'W4') ? c.value : (c.color + c.value);
    if (short === code) {
      return player.hand.splice(i, 1)[0];
    }
  }
  return null;
}


// === Helpers umum ===
function parseMonthArg(arg) {
  if (!arg) return null;
  if (/^\d{2}-\d{4}$/.test(arg)) {
    const [mm, yyyy] = arg.split('-');
    return `${yyyy}-${mm.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}$/.test(arg)) {
    return arg;
  }
  return null;
}
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDirSync(path.join(process.cwd(), 'tmp'));
function toCsvValue(v) {
  const s = String(v ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function formatIDR(n) {
  return `Rp${Number(n || 0).toLocaleString('id-ID')}`;
}

const APP_TIMEZONE = 'Asia/Jakarta';

function getDatePartsJakarta(dateInput = new Date()) {
  const date = new Date(dateInput);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const obj = {};
  for (const p of parts) {
    if (p.type !== 'literal') obj[p.type] = p.value;
  }

  return {
    year: obj.year,
    month: obj.month,
    day: obj.day
  };
}

function getDateKeyJakarta(dateInput = new Date()) {
  const p = getDatePartsJakarta(dateInput);
  return `${p.year}-${p.month}-${p.day}`;
}

function getMonthKeyJakarta(dateInput = new Date()) {
  const p = getDatePartsJakarta(dateInput);
  return `${p.year}-${p.month}`;
}

function formatDateTimeJakarta(dateInput) {
  return new Date(dateInput).toLocaleString('id-ID', {
    timeZone: APP_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatDateOnlyJakarta(dateInput) {
  return new Date(dateInput).toLocaleDateString('id-ID', {
    timeZone: APP_TIMEZONE
  });
}

function formatDateHeaderJakarta(dateInput) {
  return new Date(dateInput).toLocaleDateString('id-ID', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

const { handleNaturalFinanceMessage } = buildFinanceNaturalHandler({
  data,
  saveData,
  makeTxId,
  formatIDR,
  addCategoryForChat,
  getMonthKey: () => getMonthKeyJakarta()
});


async function sendTelegramMessage(text) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log('[TELEGRAM] token/chat_id belum diisi');
      return;
    }

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text
      },
      {
        timeout: 15000
      }
    );

    console.log('[TELEGRAM] pesan terkirim');
  } catch (e) {
    console.error('[TELEGRAM] gagal kirim pesan:', e?.response?.data || e?.message || e);
  }
}

async function sendTelegramPhotoBuffer(buffer, caption = '', filename = 'qr.png') {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log('[TELEGRAM] token/chat_id belum diisi');
      return;
    }

    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('caption', caption);
    form.append('photo', buffer, { filename });

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      form,
      {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        timeout: 15000
      }
    );

    console.log('[TELEGRAM] foto QR terkirim');
  } catch (e) {
    console.error('[TELEGRAM] gagal kirim foto:', e?.response?.data || e?.message || e);
  }
}



client.on('qr', async (qr) => {
  console.log('[QR] generate buffer...');

  try {
    qrcode.generate(qr, { small: true });

    const now = Date.now();
    if (lastQrValue === qr && (now - lastQrSentAt) < 60 * 1000) {
      console.log('[QR] sama seperti sebelumnya, skip kirim ke Telegram');
      return;
    }

    const qrBuffer = await QRCode.toBuffer(qr, {
      width: 320,
      margin: 1
    });

    lastQrValue = qr;
    lastQrSentAt = now;

    sendTelegramPhotoBuffer(qrBuffer, 'QR login WhatsApp bot', 'qr.png')
      .catch(err => console.error('[QR TELEGRAM]', err?.message || err));

    console.log('✅ QR berhasil dikirim ke Telegram');
  } catch (err) {
    console.error('❌ Gagal generate/kirim QR:', err?.message || err);
  }
});

let READY_ONCE = false;
let tugasReminderInterval = null;
let autoClearChatInterval = null;
let lastQrSentAt = 0;
let lastQrValue = null;

const AUTO_CLEAR_DAYS = 3;
const AUTO_CLEAR_MS = AUTO_CLEAR_DAYS * 24 * 60 * 60 * 1000;

let AUTO_BACKUP_STARTED = false;

async function startAutoBackupOnce() {
  if (AUTO_BACKUP_STARTED) return;

  let tries = 0;
  const maxTries = 12; // total sekitar 1 menit kalau interval 5 detik

  while (tries < maxTries) {
    tries++;

    const ok = await canSendNow(client);
    if (ok) {
      AUTO_BACKUP_STARTED = true;
      startAutoBackup();
      console.log('[AUTO-BACKUP] started after bot really connected');

      await sendTelegramMessage('✅ Bot WhatsApp sudah stabil dan backup watcher aktif.');
      return;
    }

    console.log(`[AUTO-BACKUP] bot belum stabil, retry ${tries}/${maxTries}...`);
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('[AUTO-BACKUP] batal start: bot belum stabil/connect penuh');
  await sendTelegramMessage('⚠️ Auto-backup belum aktif karena bot belum stabil.');
}

async function onReadyWork() {
  if (READY_ONCE) return;
  READY_ONCE = true;

  async function patchSendSeen(client) {
    try {
      const page = client.pupPage;
      if (!page || page.isClosed()) {
        console.warn('⚠️ pupPage belum siap / sudah tertutup, skip patch sendSeen');
        return;
      }

      await page.evaluate(() => {
        if (window.WWebJS && typeof window.WWebJS.sendSeen === 'function') {
          window.WWebJS.sendSeen = async () => { };
        }
      }).catch(err => {
        console.warn('⚠️ patch sendSeen gagal (evaluate):', err?.message || err);
      });

      console.log('🛠️ sendSeen patched');
    } catch (e) {
      console.warn('⚠️ Failed to patch sendSeen:', e?.message || e);
    }
  }

  async function hydrateChatsLight(client) {
    try {
      const enabled = (process.env.HYDRATE_STORE || 'false').toLowerCase() === 'true';
      if (!enabled) {
        console.log('💾 skip hydrate store (disabled)');
        return;
      }

      const chats = await client.getChats();

      let picked = (chats || []).filter(c => c.isPinned).slice(0, 5);

      // fallback kalau tidak ada pinned
      if (!picked.length) {
        picked = (chats || [])
          .filter(c => !c.isGroup)
          .slice(0, 5);
      }

      console.log('💾 hydrate start:', picked.length, 'chats');

      for (const chat of picked) {
        try {
          await chat.fetchMessages({ limit: 1 }).catch(() => null);
          await new Promise(r => setTimeout(r, 1500));
        } catch (_) { }
      }

      console.log('💾 hydrate done');
    } catch (e) {
      console.log('skip hydrate:', e?.message || e);
    }
  }

  await patchSendSeen(client);
  console.log('✅ Bot is ready!');

  // server lambat: beri waktu settle
  await new Promise(r => setTimeout(r, 8000));

  // hydrate ringan
  await hydrateChatsLight(client);

  // jeda lagi setelah hydrate
  await new Promise(r => setTimeout(r, 5000));

  // beri jeda lagi setelah hydrate
  await new Promise(r => setTimeout(r, 3000));

  try {
    const tz = 'Asia/Jakarta';

    const sendReminder = async (label) => {
      for (const jid of subs || []) {
        await safeSendMessage(
          client,
          jid,
          `⏰ *Pengingat Keuangan* (${label})\n` +
          `Jangan lupa catat pemasukan/pengeluaran hari ini.\n` +
          `• Tambah pemasukan:  _+ <deskripsi> <nominal>_\n` +
          `• Tambah pengeluaran:  _- <deskripsi> <nominal>_\n` +
          `• Cek saldo:  _/saldo_`
        );
        await new Promise(r => setTimeout(r, 500));
      }
    };

    cron.schedule('0 20 * * *', () => sendReminder('malam 20:00'), { timezone: tz });

    console.log('⏱️ Reminder keuangan terjadwal: 20:00 (Asia/Jakarta)');

    // kalau nanti server sudah stabil, boleh aktifkan lagi:
    registerWeddingReminder({ cron, client, timezone: tz });
    /* registerHealthReminder({
      cron,
      client,
      timezone: tz,
      targets: ['6281379826684@c.us']
    });
    */

  } catch (e) {
    console.error('Gagal menjadwalkan reminder:', e?.message || e);
  }
}

function getNextRepeatedTaskDate(currentDate, repeat) {
  const next = new Date(currentDate);

  if (repeat === 'daily') {
    next.setDate(next.getDate() + 1);
    return next;
  }

  if (repeat === 'weekly') {
    next.setDate(next.getDate() + 7);
    return next;
  }

  if (repeat === 'monthly') {
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  if (repeat === 'yearly') {
    next.setFullYear(next.getFullYear() + 1);
    return next;
  }

  return null;
}

function startTaskReminderLoop() {
  if (tugasReminderInterval) return;

  tugasReminderInterval = setInterval(async () => {
    const now = new Date();
    const nowTime = now.getTime();
    let changed = false;

    for (const scopeKey in tasks) {
      for (const task of (tasks[scopeKey] || [])) {
        const taskTime = new Date(task.datetime).getTime();
        const diffMin = Math.floor((taskTime - nowTime) / 60000);

        if (!task.notified) task.notified = [];

        const targets = Array.isArray(task.targets) && task.targets.length
          ? [...new Set(task.targets.map(canonicalJid).filter(Boolean))]
          : [canonicalJid(scopeKey)].filter(Boolean);

        const blast = async (message) => {
          for (const jid of targets) {
            await safeSendMessage(client, jid, message);
            await new Promise(r => setTimeout(r, 500));
          }
        };

        if (
          diffMin <= 60 &&
          diffMin > 55 &&
          !task.notified.includes('60')
        ) {
          await blast(`⏰ [1 jam lagi] Tugas: ${task.desc}`);
          task.notified.push('60');
          changed = true;
        }

        if (
          diffMin <= 10 &&
          diffMin > 5 &&
          !task.notified.includes('10')
        ) {
          await blast(`⏰ [10 menit lagi] Tugas: ${task.desc}`);
          task.notified.push('10');
          changed = true;
        }

        if (
          diffMin <= 5 &&
          diffMin > 0 &&
          !task.notified.includes('5')
        ) {
          await blast(`⏰ [5 menit lagi] Tugas: ${task.desc} — segera siap-siap!`);
          task.notified.push('5');
          changed = true;
        }

        if (
          diffMin <= 0 &&
          diffMin >= -5 &&
          !task.notified.includes('0')
        ) {
          await blast(`📌 Saatnya mengerjakan tugas: ${task.desc}`);
          task.notified.push('0');

          if (task.repeat && task.repeat !== 'once') {
            const nextDate = getNextRepeatedTaskDate(task.datetime, task.repeat);

            if (nextDate) {
              task.datetime = nextDate.toISOString();
              task.notified = [];

              console.log(
                '[TASK REPEAT] rescheduled:',
                task.desc,
                '->',
                task.datetime,
                'repeat:',
                task.repeat
              );
            }
          }

          changed = true;
        }
      }
    }

    if (changed) {
      saveTasks();
    }
  }, 60 * 1000);

  console.log('[TASK REMINDER] loop aktif');
}

async function clearOldChats(client) {
  try {
    const chats = await client.getChats();
    const threeDaysAgo = Date.now() - AUTO_CLEAR_MS;

    const protectedChats = new Set([
      canonicalJid('6281379826684@c.us')
    ]);

    let cleaned = 0;
    let skipped = 0;

    for (const chat of chats) {
      try {
        const rawChatId = chat?.id?._serialized;
        if (!rawChatId) continue;
        const chatId = canonicalJid(rawChatId);

        // skip owner / chat penting
        if (protectedChats.has(chatId)) {
          skipped++;
          continue;
        }

        // skip chat yang dipin
        if (chat.isPinned) {
          skipped++;
          continue;
        }

        // skip chat yang masih punya tugas aktif
        if (tasks[chatId] && tasks[chatId].length > 0) {
          skipped++;
          continue;
        }

        const messages = await chat.fetchMessages({ limit: 1 });
        if (!messages.length) continue;

        const lastMessage = messages[0];
        const lastTimestamp = (lastMessage.timestamp || 0) * 1000;

        if (lastTimestamp < threeDaysAgo) {
          await chat.clearMessages();
          cleaned++;

          console.log(`[AUTO-CLEAR] chat dibersihkan: ${chat.name || chatId}`);

          // jeda kecil supaya aman
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        const msg = err?.message || String(err);
        if (msg.includes('waitForChatLoading') || msg.includes('loadEarlierMsgs')) {
          // Abaikan error loading internal dari library WA
        } else {
          console.error('[AUTO-CLEAR] gagal clear chat:', msg);
        }
      }
    }

    console.log(`[AUTO-CLEAR] selesai. Dibersihkan: ${cleaned}, dilewati: ${skipped}`);
  } catch (err) {
    console.error('[AUTO-CLEAR] error utama:', err?.message || err);
  }
}

function normalizeChatJid(input) {
  if (!input) return null;

  let raw = String(input).trim().toLowerCase();

  if (raw.endsWith('@g.us')) return raw;
  if (raw.endsWith('@c.us')) return raw;
  if (raw.endsWith('@lid')) return canonicalJid(raw);

  raw = raw.replace(/[^\d]/g, '');

  if (raw.startsWith('0')) {
    raw = '62' + raw.slice(1);
  }

  if (!raw.startsWith('62')) {
    return null;
  }

  return `${raw}@c.us`;
}

const LAST_CLEAR_PATH = path.join(process.cwd(), 'data', 'last_clear.json');

function startAutoClearChatLoop() {
  if (autoClearChatInterval) return;

  const runClearIfNeeded = async () => {
    try {
      let lastClear = 0;
      if (fs.existsSync(LAST_CLEAR_PATH)) {
        const data = JSON.parse(fs.readFileSync(LAST_CLEAR_PATH, 'utf8'));
        lastClear = data.lastClear || 0;
      }

      const now = Date.now();
      if (now - lastClear >= AUTO_CLEAR_MS) {
        console.log(`[AUTO-CLEAR] Mulai mengeksekusi clear chat rutin...`);
        await clearOldChats(client);
        
        fs.writeFileSync(LAST_CLEAR_PATH, JSON.stringify({ lastClear: Date.now() }));
      } else {
        const nextClear = new Date(lastClear + AUTO_CLEAR_MS).toLocaleString();
        console.log(`[AUTO-CLEAR] Belum waktunya. Clear chat selanjutnya pada: ${nextClear}`);
      }
    } catch (err) {
      console.error('[AUTO-CLEAR] Error mengecek jadwal clear:', err);
    }
  };

  // Cek 1 menit setelah bot ready
  setTimeout(runClearIfNeeded, 60 * 1000);

  // ulang tiap 1 jam untuk mengecek apakah sudah waktunya
  autoClearChatInterval = setInterval(runClearIfNeeded, 60 * 60 * 1000);

  console.log(`[AUTO-CLEAR] loop aktif mengecek tiap 1 jam, eksekusi tiap ${AUTO_CLEAR_DAYS} hari`);
}

client.on('ready', async () => {
  console.log('[READY]');
  dedup.cleanup();

  await sendTelegramMessage('🟡 Bot WhatsApp terhubung, sedang finalisasi...');
  await onReadyWork();

  IS_STARTING_UP = false;

  setTimeout(() => {
    startTaskReminderLoop();
  }, 30000);

  setTimeout(() => {
    startAutoBackupOnce();
  }, 15000);



  setTimeout(() => {
    startAutoClearChatLoop();
  }, 150000);
});

client.on('disconnected', async (r) => {
  console.log('[DISC]', r);

  sendTelegramMessage(`⚠️ Bot WhatsApp disconnected: ${r || 'unknown'}`)
    .catch(err => console.error('[DISC TELEGRAM]', err?.message || err));

  console.log('[DISC] proses akan dihentikan agar PM2 me-restart dari nol...');
  setTimeout(() => process.exit(1), 300);
});

//client.on('authenticated', () => {
//  let tries = 0;
//  const iv = setInterval(async () => {
//tries++;
//const st = await client.getState().catch(() => null);
// if (st) console.log('ℹ️ getState:', st);
//   if (st === 'CONNECTED') {
//    clearInterval(iv);
//     onReadyWork(); // paksa jalankan “ready work” sekali saja
//   }
//   if (tries > 90) clearInterval(iv); // stop setelah ~90 detik
// }, 1000);
//}
//);


const { parse, isValid, format, addDays, setHours, setMinutes, setSeconds, nextDay } = require('date-fns');
const { id } = require('date-fns/locale');

function parseNaturalDatetime(input) {
  const raw = (input || "").toLowerCase().trim();
  const now = new Date();

  let date = null;
  let hour = 9;
  let minute = 0;

  const monthMap = {
    januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
    juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11
  };

  const days = {
    senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6, minggu: 0
  };

  // 1) tanggal relatif
  if (/\bbesok\b/.test(raw)) {
    date = new Date(now);
    date.setDate(now.getDate() + 1);
  } else if (/\blusa\b/.test(raw)) {
    date = new Date(now);
    date.setDate(now.getDate() + 2);
  } else {
    for (const [dayName, dayIndex] of Object.entries(days)) {
      if (new RegExp(`\\b${dayName}\\b`).test(raw)) {
        date = new Date(now);
        const currentDay = now.getDay();
        let diff = (dayIndex - currentDay + 7) % 7;
        if (diff === 0) diff = 7;
        date.setDate(now.getDate() + diff);
        break;
      }
    }
  }

  // 2) tanggal eksplisit
  // contoh: 1 april / 1-april / 1/april / 1 4 / 1-4 / 1/4
  const explicitDateMatch = raw.match(
    /(?:^|\s)(\d{1,2})[\/\-\s](januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|\d{1,2})(?:\s|$)/
  );

  if (explicitDateMatch) {
    const day = parseInt(explicitDateMatch[1], 10);
    const monthRaw = explicitDateMatch[2];

    let month;
    if (/^\d{1,2}$/.test(monthRaw)) {
      month = parseInt(monthRaw, 10) - 1;
    } else {
      month = monthMap[monthRaw];
    }

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      let year = now.getFullYear();
      const candidate = new Date(year, month, day);

      // kalau tanggal sudah lewat jauh, anggap tahun depan
      if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        year += 1;
      }

      date = new Date(year, month, day);
    }
  }

  // 3) jam eksplisit — wajib ada kata jam/pukul
  // contoh: jam 8 / jam 08.30 / pukul 7 malam
  const timeMatch = raw.match(
    /\b(?:jam|pukul)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam)?\b/
  );

  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = parseInt(timeMatch[2] || "0", 10);
    const period = timeMatch[3];

    if (period === "siang" && hour >= 1 && hour <= 5) hour += 12;
    if (period === "sore" && hour >= 1 && hour <= 11) hour += 12;
    if (period === "malam" && hour >= 1 && hour <= 11) hour += 12;
  }

  if (!date) {
    date = new Date(now);
  }

  date.setHours(hour, minute, 0, 0);

  // 4) bersihkan deskripsi
  let desc = input;

  if (explicitDateMatch) {
    desc = desc.replace(explicitDateMatch[0], " ");
  }

  if (timeMatch) {
    desc = desc.replace(timeMatch[0], " ");
  }

  desc = desc
    .replace(/\b(besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    desc: desc || "Tugas",
    datetime: date
  };
}

function parseSeparatedTugas(input) {
  const raw = String(input || '').trim();
  const parts = raw.split(';').map(v => v.trim()).filter(Boolean);

  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const desc = parts[0];
  const datePart = parts[1] || '';
  const timePart = parts[2] || '';

  if (!desc) return null;

  const now = new Date();
  let date = null;

  const monthMap = {
    januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
    juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11
  };

  const dayMap = {
    senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6, minggu: 0
  };

  const dp = datePart.toLowerCase().trim();

  // tanggal relatif
  if (dp === 'besok') {
    date = new Date(now);
    date.setDate(now.getDate() + 1);
  } else if (dp === 'lusa') {
    date = new Date(now);
    date.setDate(now.getDate() + 2);
  } else if (dayMap.hasOwnProperty(dp)) {
    date = new Date(now);
    const currentDay = now.getDay();
    let diff = (dayMap[dp] - currentDay + 7) % 7;
    if (diff === 0) diff = 7;
    date.setDate(now.getDate() + diff);
  } else {
    // format: 1 april / 1-april / 1/4 / 1 4
    const m = dp.match(/^(\d{1,2})[\/\-\s](januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|\d{1,2})$/i);
    if (!m) return null;

    const day = parseInt(m[1], 10);
    const monthRaw = m[2].toLowerCase();

    let month;
    if (/^\d{1,2}$/.test(monthRaw)) {
      month = parseInt(monthRaw, 10) - 1;
    } else {
      month = monthMap[monthRaw];
    }

    if (month < 0 || month > 11 || day < 1 || day > 31) return null;

    let year = now.getFullYear();
    const candidate = new Date(year, month, day);

    // kalau sudah lewat, anggap tahun depan
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (candidate < todayOnly) year += 1;

    date = new Date(year, month, day);
  }

  // jam default
  let hour = 9;
  let minute = 0;

  if (timePart) {
    const tp = timePart.toLowerCase().trim();
    const tm = tp.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|siang|sore|malam)?$/i);
    if (!tm) return null;

    hour = parseInt(tm[1], 10);
    minute = parseInt(tm[2] || '0', 10);
    const period = (tm[3] || '').toLowerCase();

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    if (period === 'siang' && hour >= 1 && hour <= 5) hour += 12;
    if (period === 'sore' && hour >= 1 && hour <= 11) hour += 12;
    if (period === 'malam' && hour >= 1 && hour <= 11) hour += 12;
  }

  date.setHours(hour, minute, 0, 0);

  return {
    desc,
    date
  };
}

// === LOGGER PESAN (untuk debug) — taruh di atas handler utama
//client.on('message', m => {
//  console.log('RX:', m.from, '→', JSON.stringify(m.body));
//});


client.on('message', async msg => {
  await learnLidMapping(msg);

  if (msg.fromMe) return;

  // Abaikan pesan sistem WhatsApp (seperti enkripsi e2e, protocol, dll) yang tidak memiliki teks asli
  if (['e2e_notification', 'protocol', 'call_log', 'gp2', 'ciphertext', 'reaction', 'revoke'].includes(msg.type)) return;

  // Abaikan jika pesan benar-benar kosong dan tidak mengandung media (menghindari fallback terpanggil tiba-tiba)
  if (!msg.body && !msg.hasMedia) return;

  if (dedup.isOld(msg)) {
    console.log('[DEDUP] skip old startup message');
    return;
  }

  if (dedup.has(msg)) {
    console.log('[DEDUP] skip duplicate message');
    return;
  }

  const rawFrom = String(msg.from || '').toLowerCase();
  const from = canonicalJid(rawFrom);

  // --- CHANNEL PROMO INJECTION ---
  const promoMsg = checkAndGetPromo(from);
  if (promoMsg) {
    // Kirim 3.5 detik setelah bot memproses pesan utama agar terlihat natural
    setTimeout(() => {
      safeSendMessage(client, from, promoMsg).catch(() => {});
    }, 3500);
  }
  // -------------------------------

  // auto simpan semua user DM yang pernah chat bot
  if (
    from.endsWith('@c.us') &&
    /^62\d+@c\.us$/i.test(from) &&
    !dmUsers.list.includes(from)
  ) {
    dmUsers.list.push(from);
    dmUsers.list = [...new Set(dmUsers.list.map(canonicalJid))]
      .filter(j => j && /^62\d+@c\.us$/i.test(j));

    saveDmUsers();
  }

  const now = new Date();
  const key = from;
  const monthKey = getMonthKeyJakarta(now);

  // ==== Gate bot ON/OFF + identitas owner ====
  const rawSenderJid = String(getSenderId(msg) || '').toLowerCase();
  const senderJid = canonicalJid(rawSenderJid);
  const isOwner = isPrimaryOwnerJid(senderJid);

  let text = (msg.body || '').trim();
  let isCommand = false;
  if (text.startsWith('/')) {
    isCommand = true;
    text = text.slice(1).trim().toLowerCase();
  }

  const normalizedText = String(text || '').trim().toLowerCase();

  // === STOP HANDLER ===
  if (normalizedText === 'stop' && !isOwner) {
    if (!excludes.list.includes(senderJid)) {
      excludes.list.push(senderJid);
      saveExcludes();
    }
    return msg.reply('✅ Anda telah berhasil berhenti berlangganan. Anda tidak akan lagi menerima pesan broadcast dari bot ini.');
  }

  function hasPendingYaConfirmation() {
    // Konfirmasi tugas/reminder
    if (pendingTugas[senderJid]) return true;

    // Konfirmasi broadcast teks
    if (pendingBroadcast[senderJid]) return true;

    // Konfirmasi hapus transaksi / hapus tugas
    if (pendingConfirms[from]) return true;

    return false;
  }

  function hasPendingCancelProcess() {
    if (pendingSticker[from]) return true;
    if (pendingForward[senderJid]) return true;
    if (pendingConfirms[from]) return true;
    if (pendingTugas[senderJid]) return true;
    if (pendingBroadcast[senderJid]) return true;
    if (pendingBroadcastImage[senderJid]) return true;
    if (pendingImagePdf[senderJid]) return true;
    if (pendingPdfToImage[senderJid]) return true;
    if (pendingPdfTools[senderJid]) return true;

    return false;
  }

  const isYaConfirm =
    normalizedText === 'ya' &&
    (isCommand || hasPendingYaConfirmation());

  const isCancelConfirm =
    ['batal', 'tidak'].includes(normalizedText) &&
    (isCommand || hasPendingCancelProcess());

  maybeSendDonationPromo({
    client,
    msg,
    from,
    senderJid,
    isCommand: isCommand || isYaConfirm || isCancelConfirm,
    text: normalizedText
  }).catch(e => console.error('[PROMO DONATION]', e?.message || e));

  // HANDLER CEK RESI //
  if (isCommand && (text === 'resi' || text.startsWith('resi '))) {
    const handled = await handleResiCommand({ msg, text });
    if (handled) return;
  }

  // HANDLER IG DOWNLOADMEDIA //
  if (isCommand && (text === 'ig' || text.startsWith('ig '))) {
    const handled = await handleInstagramDownload({
      msg,
      client,
      from,
      safeSendMedia
    });

    if (handled) return;

    return msg.reply('Format: /ig <link reels Instagram>');
  }

  // HANDLER IGMP3 DOWNLOAD
  if (isCommand && (text === 'igmp3' || text.startsWith('igmp3 '))) {
    const handled = await handleInstagramMp3Download({
      msg,
      client,
      from
    });

    if (handled) return;

    return msg.reply('Format: /igmp3 <link reels/post Instagram>');
  }

  if (isCommand && (text === 'igs' || text.startsWith('igs '))) {
    const handled = await handleInstagramStoriesDownload({
      msg,
      client,
      from
    });

    if (handled) return;

    return msg.reply('Format: /igs <username atau link story>');
  }

  // =================================== //

  if (isCommand && (text === 'tt' || text.startsWith('tt '))) {
    const handled = await handleTikTokDownload({
      msg,
      client,
      from,
      safeSendMedia
    });

    if (handled) return;

    return msg.reply('Format: /tt <link TikTok>');
  }

  // =======================//

  if (isCommand && (text === 'x' || text.startsWith('x ') || text === 'twitter' || text.startsWith('twitter '))) {
    const handled = await handleTwitterDownload({
      msg,
      client,
      from,
      safeSendMedia
    });

    if (handled) return;

    return msg.reply('Format: /x <link tweet>');
  }

  // =======================//
  // HANDLER YOUTUBE DOWNLOADER //

  if (
    isCommand &&
    (
      text === 'yt' ||
      text.startsWith('yt ') ||
      text === 'ytmp4' ||
      text.startsWith('ytmp4 ') ||
      text === 'ytmp3' ||
      text.startsWith('ytmp3 ') ||
      text === 'ytvn' ||
      text.startsWith('ytvn ')
    )
  ) {
    const handled = await handleYouTubeDownload({
      msg,
      client,
      from,
      safeSendMedia
    });

    if (handled) return;

    return msg.reply(
      'Format YouTube Downloader:\n\n' +
      '• /yt mp4 <link YouTube>\n' +
      '• /yt mp3 <link YouTube>\n' +
      '• /yt vn <link YouTube>\n\n' +
      'Alias:\n' +
      '• /ytmp4 <link>\n' +
      '• /ytmp3 <link>\n' +
      '• /ytvn <link>'
    );
  }

  // =======================//

  if (isCommand && (text === 'tts' || text.startsWith('tts '))) {
    const handled = await handleTTS(msg, text);
    if (handled) return;
  }

  // =======================//

  if (isCommand) {
    dedup.mark(msg);
  }

  // ==== GLOBAL MUTE GUARD (revisi, allow start/help/menu) ====
  try {
    if (!isOwner) {
      const cmdName = isCommand ? text.split(/\s+/)[0] : '';
      const allowBasic = isCommand && ['start', 'help', 'menu'].includes(cmdName);
      if (!allowBasic) {
        const isDm = !from.endsWith('@g.us');
        if (isDm && isExcludedJid(from)) return;

        const authorJid = canonicalJid(getSenderId(msg));
        if (authorJid && isExcludedJid(authorJid)) return;
      }
    }
  } catch (_) { /* ignore */ }

  {
    const state = pendingBroadcastImage[senderJid];

    if (state) {
      if (isCancelConfirm) {
        delete pendingBroadcastImage[senderJid];
        return msg.reply('✅ Broadcast gambar dibatalkan.');
      }


      if (Date.now() - state.created > 5 * 60 * 1000) {
        delete pendingBroadcastImage[senderJid];
        return msg.reply('⌛ Mode /bcimg kedaluwarsa. Ketik /bcimg lagi.');
      }

      if (isCommand) {
        return msg.reply('ℹ️ Mode /bcimg masih aktif. Kirim gambar atau ketik *batal*.');
      } else {
        if (!msg.hasMedia) {
          return msg.reply('❌ Kirim *gambar* ya, bukan teks saja.');
        }

        dedup.mark(msg);

        const media = await msg.downloadMedia().catch(() => null);

        if (!media || !media.data) {
          delete pendingBroadcastImage[senderJid];
          return msg.reply('❌ Gagal membaca file gambar.');
        }

        if (!String(media.mimetype || '').startsWith('image/')) {
          delete pendingBroadcastImage[senderJid];
          return msg.reply('❌ File yang dikirim bukan gambar.');
        }

        const targets = collectBroadcastTargets();
        if (!targets.length) {
          delete pendingBroadcastImage[senderJid];
          return msg.reply('ℹ️ Tidak ada target broadcast aktif.');
        }

        const outMedia = new MessageMedia(
          media.mimetype,
          media.data,
          'broadcast-image'
        );

        await msg.reply(
          `📢 Broadcast gambar dimulai ke ${targets.length} target...\n` +
          `Caption: ${state.caption ? 'ya' : 'tidak'}`
        );

        const result = await broadcastImage({
          client,
          targets,
          media: outMedia,
          caption: state.caption || ''
        });

        delete pendingBroadcastImage[senderJid];

        if (result.stopped) {
          return msg.reply(
            `⚠️ Broadcast gambar dihentikan.\n` +
            `Alasan: ${result.reason}\n` +
            `Berhasil: ${result.ok}\n` +
            `Gagal: ${result.fail}\n` +
            `Total target: ${result.total}`
          );
        }

        return msg.reply(
          `✅ Broadcast gambar selesai.\n` +
          `Berhasil: ${result.ok}\n` +
          `Gagal: ${result.fail}\n` +
          `Total target: ${result.total}`
        );
      }
    }
  }


  // --- Guard: larang command khusus grup dipakai di private chat ---
  if (isCommand) {
    const groupOnlyCommands = new Set(['simi', 'uno', 'ping']);
    const cmdName = text.split(/\s+/)[0]; // ambil nama command tanpa argumen

    // cek apakah chat ini grup
    let isGroup = false;
    try {
      const chat = await msg.getChat();
      isGroup = chat?.isGroup === true;
    } catch (e) {
      // fallback cepat kalau getChat gagal
      isGroup = msg.from.endsWith('@g.us');
    }

    if (!isGroup && groupOnlyCommands.has(cmdName)) {
      await msg.reply('⚠️ Command ini hanya dapat digunakan di dalam grup.');
      return; // hentikan eksekusi command berikutnya
    }
  }

  // =========== BATAL SECTION ============ //
  if (isCancelConfirm) {
    const senderJid = canonicalJid(getSenderId(msg));
    let did = false;

    if (pendingSticker[from]) { delete pendingSticker[from]; did = true; }
    if (pendingForward[senderJid]) { delete pendingForward[senderJid]; did = true; }
    if (pendingConfirms[from]) { delete pendingConfirms[from]; did = true; }
    if (pendingTugas[senderJid]) { delete pendingTugas[senderJid]; did = true; }
    if (pendingBroadcast[senderJid]) { delete pendingBroadcast[senderJid]; did = true; }
    if (pendingBroadcastImage[senderJid]) { delete pendingBroadcastImage[senderJid]; did = true; }
    if (cancelImagePdf(senderJid)) { did = true; }
    if (cancelPdfToImage(senderJid)) { did = true; }
    if (cancelPdfTools(senderJid)) { did = true; }

    if (did) return msg.reply('✅ Dibatalkan. Tidak ada proses yang dilakukan.');
    return msg.reply('ℹ️ Tidak ada proses yang perlu dibatalkan.');
  }

  // ==== PILIHAN PENGULANGAN REMINDER ====
  {
    const repeatChoice = await tugasCmd.handleRepeatChoice({
      msg,
      text,
      from,
      sender: senderJid,
      pendingTugas,
      jidToLocal08
    });

    if (repeatChoice.handled) {
      return msg.reply(repeatChoice.reply);
    }
  }

  // /start
  if (isCommand && text === 'start') {
    const welcomeMsg = `👋 Halo!

Aku *Dr. Zein* — asisten WhatsApp buatan *Fauzan Akmal*. Aku bisa bantu:
• 💰 Catat pemasukan/pengeluaran otomatis dari chat biasa, atau pakai format + / -
• ⏰ Pengingat input keuangan *1× sehari* (20:00) — *DM saja*
• 📒 Histori, rekap, dan ekspor CSV
• 📝 Tugas & pengingat deadline
• 🖼️ */sticker* → kirim foto/video (maks 7s); caption *opsional* (foto saja)
• 🧰 Tools: YouTube/IG/TikTok/X downloader dan PDF tools
• 👥 Fitur grup: */ping*, */simi*, dan 🎲 *UNO*
• 🤖 */ai* buat bantu apa pun

Gunakan bot ini secara bijak untuk aktivitas harianmu 💪

👉 Lihat daftar perintah: */menu*
ℹ️ Butuh bantuan? */help* (kontak owner)`;
    await msg.reply(welcomeMsg);
    return; // penting: hentikan eksekusi berikutnya
  }


  // /help → tampilkan kontak owner (kartu sederhana + link klik)
  if (isCommand && text === 'help') {
    const ownerNumber = '6281379826684';                 // tanpa @c.us
    const waLink = `https://wa.me/${ownerNumber}`;       // link klik untuk chat

    const contactCard =
      `┏━━━━━━━━━━━━━━━━━━━━━━┓
┃ 👤  *Contact Owner*       ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🧑‍💻 Nama : *Fauzan Akmal*
┃ 📱 WA   : *${ownerNumber}*
┃ 🔗 Chat : ${waLink}
┗━━━━━━━━━━━━━━━━━━━━━━┛

Jika butuh bantuan cepat, klik link di atas untuk WhatsApp ya.`;

    await msg.reply(contactCard);
    return;
  }



  // ==== Jika owner sedang mode forward: tangkap pesan berikutnya (bukan command) ====
  {
    const senderJid = canonicalJid(getSenderId(msg));
    const pf = pendingForward[senderJid];

    if (pf) {
      // Allow cancel terlebih dulu

      // Abaikan jika masih command lain
      if (isCommand) {
        // biarkan command lain jalan (mis. /helpowner)
      } else {
        // batas waktu: 10 menit
        if (Date.now() - pf.created > 10 * 60 * 1000) {
          delete pendingForward[senderJid];
          return msg.reply('⌛ Mode forward kedaluwarsa. Jalankan /forward lagi.');
        }

        // Lanjut forward pesan ini ke semua target
        let ok = 0, fail = 0;

        try {
          if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            const rawCaption = (msg.body || '').trim();

            for (const t of pf.targets) {
              try {
                // Gunakan resolveSpintax jika tersedia, jika tidak (misal user lupa upload file utils), gunakan raw
                const finalCaption = typeof resolveSpintax === 'function' ? resolveSpintax(rawCaption) : rawCaption;
                await safeSendMedia(client, t, media, { caption: finalCaption });
                ok++;

                // jeda lebih aman antar target
                await new Promise(r => setTimeout(r, 7000 + Math.floor(Math.random() * 5000)));
              } catch (e) {
                fail++;
              }
            }
          } else {
            const body = (msg.body || '').trim();
            if (!body) {
              delete pendingForward[senderJid];
              return msg.reply('❌ Pesan kosong. Kirim teks atau media setelah /forward.');
            }
            for (const t of pf.targets) {
              try {
                // Gunakan resolveSpintax jika tersedia
                const finalBody = typeof resolveSpintax === 'function' ? resolveSpintax(body) : body;
                await safeSendMessage(client, t, finalBody);
                ok++;

                // jeda ekstra antar target
                await new Promise(r => setTimeout(r, 5000 + Math.floor(Math.random() * 5000)));
              } catch (e) {
                fail++;
              }
            }
          }
        } finally {
          delete pendingForward[senderJid];
        }

        return msg.reply(`✅ Forward selesai. Berhasil: ${ok}, gagal: ${fail}.`);
      }
    }
  }


  // Saat OFF → bot diam total untuk non-owner
  if (!botSwitch.enabled && !isOwner) {
    return;
  }

  // /helpowner — hanya owner
  if (isCommand && text === 'helpowner') {
    const senderJid = canonicalJid(getSenderId(msg));
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }

    const helpOwnerMsg = [
      '📖 BANTUAN KHUSUS OWNER',
      '',
      '📌 Manajemen Bot',
      '  /bot on                   aktifkan bot',
      '  /bot off                  nonaktifkan bot sementara',
      '  /bot status               lihat status bot',
      '  /shutdown                 matikan proses bot',
      '  /restart                  restart proses bot (butuh PM2/forever)',
      '  /eval <code>              eksekusi kode JS (hati-hati)',
      '',
      '📌 Manajemen User',
      '  /bc <pesan>               broadcast teks ke semua target aktif',
      '  /bcimg <caption>          broadcast gambar + caption ke semua target aktif',
      '  /forward                  mode kirim pesan berikutnya ke target manual / known DM',
      '  /kick <@tag>              keluarkan user dari grup (butuh bot admin)',
      '  /addowner <62xxx@c.us>    tambah owner',
      '  /delowner <62xxx@c.us>    hapus owner',
      '  /addprem <nomor>          tambah pengguna premium',
      '  /delprem <nomor>          hapus pengguna premium (alias: /deletepremi)',
      '  /premlist                 lihat daftar pengguna premium',
      '  /subcount                 jumlah subscriber pengingat (DM)',
      '  /sublist [hal] [size]     daftar subscriber (paging, all untuk semua)',
      '  /subexport                ekspor CSV daftar subscriber',
      '',
      '📌 Daftar Mute / Excludes',
      '  /mutelist                 lihat daftar nomor yang dibisukan',
      '  /muteadd <62xxx|jid>      tambahkan nomor ke daftar mute (di DM bisa tanpa argumen)',
      '  /mutedel <62xxx|jid>      hapus nomor dari daftar mute (di DM bisa tanpa argumen)',
      '  /muteclear                kosongkan semua daftar mute',
      '',
      '📌 Keuangan & Tugas',
      '  /hapus semua              hapus semua transaksi bulan ini (konfirmasi: ya atau /ya)',
      '  /hapus_tugas semua        hapus semua tugas (konfirmasi: ya atau /ya)',
      '',
      '📌 Debug & Log',
      '  /logon                    aktifkan console log',
      '  /logoff                   nonaktifkan console log',
      '  /clearchat all            hapus semua isi chat di WhatsApp Web',
      '  /clearchat old            hapus chat yang sudah lebih dari 3 hari',
      '  /clearchat 62xxxx         hapus chat nomor tertentu',
      '  /clearchat 62xxxx@c.us    hapus chat nomor tertentu',
    ].join('\n');

    return msg.reply(helpOwnerMsg);
  }

  // INI OWNER SECTION //

  if (isCommand && text.startsWith('clearchat')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const args = text.split(/\s+/);
    const target = (args[1] || '').trim();

    if (!target) {
      return msg.reply(
        '❌ Format:\n' +
        '/clearchat all\n' +
        '/clearchat old\n' +
        '/clearchat 628xxxx\n' +
        '/clearchat 628xxxx@c.us'
      );
    }

    // hapus chat lama (> 3 hari)
    if (target === 'old') {
      await msg.reply('🧹 Membersihkan chat lama...');
      await clearOldChats(client);
      return msg.reply('✅ Pembersihan chat lama selesai.');
    }

    // hapus semua chat
    if (target === 'all') {
      const chats = await client.getChats();

      const protectedChats = new Set([
        canonicalJid('6281379826684@c.us')
      ]);

      let cleaned = 0;
      let skipped = 0;

      for (const chat of chats) {
        try {
          const rawChatId = chat?.id?._serialized;
          if (!rawChatId) continue;
          const chatId = canonicalJid(rawChatId);

          if (protectedChats.has(chatId)) {
            skipped++;
            continue;
          }

          if (chat.isPinned) {
            skipped++;
            continue;
          }

          await chat.clearMessages();
          cleaned++;

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.error('[CLEAR-ALL]', err?.message || err);
        }
      }

      return msg.reply(`✅ Semua chat dibersihkan.\nDibersihkan: ${cleaned}\nDilewati: ${skipped}`);
    }

    // hapus chat nomor tertentu
    const jid = normalizeChatJid(target);
    if (!jid) {
      return msg.reply('❌ Nomor tidak valid. Contoh: /clearchat 628123456789');
    }

    try {
      const chat = await client.getChatById(jid);

      if (!chat) {
        return msg.reply('❌ Chat tidak ditemukan.');
      }

      await chat.clearMessages();

      return msg.reply(`✅ Chat berhasil dibersihkan:\n${jid}`);
    } catch (err) {
      console.error('[CLEAR-ONE]', err?.message || err);
      return msg.reply('❌ Gagal membersihkan chat tersebut.');
    }
  }

  // ==== /mutelist (owner only): lihat daftar mute ====
  if (isCommand && text === 'mutelist') {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    if (!excludes.list.length) return msg.reply('ℹ️ Daftar mute kosong.');
    const lines = excludes.list.map((j, i) => `${i + 1}. ${j}`).join('\n');
    return msg.reply(`🔇 *Daftar Mute (${excludes.list.length})*\n` + lines);
  }

  // ==== /muteadd <62xxxx | 62xxx@c.us> (owner only) ====
  if (isCommand && text.startsWith('muteadd')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const arg = (text.split(/\s+/)[1] || '').trim();
    // jika di DM dan tanpa argumen, tambahkan lawan bicara saat ini
    let target = arg || (from.endsWith('@c.us') ? from : '');

    const jid = normalizeJid(target);
    if (!jid) return msg.reply('❌ Format: /muteadd 62xxxxxxxxxx ATAU /muteadd 62xxxxxxxxxx@c.us (boleh dijalankan di DM tanpa arg).');

    // jangan izinkan mute owner (agar tidak terkunci)
    if (isOwnerJid(jid)) return msg.reply('⚠️ Tidak dapat menambahkan owner ke daftar mute.');

    if (excludes.list.includes(jid)) return msg.reply(`ℹ️ ${jid} sudah ada dalam daftar mute.`);
    excludes.list.push(jid);
    saveExcludes();

    return msg.reply(`✅ Ditambahkan ke daftar mute: ${jid}\nBot tidak akan membalas chat dari nomor ini.`);
  }

  // ==== /mutedel <62xxxx | 62xxx@c.us> (owner only) ====
  if (isCommand && text.startsWith('mutedel')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const arg = (text.split(/\s+/)[1] || '').trim();
    let target = arg || (from.endsWith('@c.us') ? from : '');

    const jid = normalizeJid(target);
    if (!jid) return msg.reply('❌ Format: /mutedel 62xxxxxxxxxx ATAU /mutedel 62xxxxxxxxxx@c.us (boleh dijalankan di DM tanpa arg).');

    const before = excludes.list.length;
    excludes.list = excludes.list.filter(x => x !== jid);
    if (excludes.list.length === before) return msg.reply(`ℹ️ ${jid} tidak ada di daftar mute.`);
    saveExcludes();

    return msg.reply(`✅ Dihapus dari daftar mute: ${jid}`);
  }

  // ==== /muteclear (owner only) — opsional ====
  if (isCommand && text === 'muteclear') {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const n = excludes.list.length;
    excludes.list = [];
    saveExcludes();
    return msg.reply(`🧹 Daftar mute dikosongkan (${n} entri dihapus).`);
  }

  // alias singkat
  if (isCommand && text === 'subs') {
    // teruskan ke /subcount
    text = 'subcount';
  }

  // ==== /subcount (owner only): total semua nomor DM yang pernah chat ====
  if (isCommand && text === 'subcount') {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const list = await collectKnownDM(client);
    const total = list.length;

    const preview = list.slice(0, 5).map((j, i) => `${i + 1}. ${jidToLocal08(j)}`).join('\n');
    const more = total > 5 ? `\n… dan ${total - 5} lainnya` : '';

    return msg.reply(
      `👥 *Total user (DM) terdeteksi*: *${total}* nomor.\n` +
      (total ? `\nContoh:\n${preview}${more}` : '')
    );
  }

  // ==== /sublist (owner only): daftar semua nomor DM yang pernah chat (paging) ====
  // /sublist                -> halaman 1, size 50
  // /sublist 2              -> halaman 2, size 50
  // /sublist 3 100          -> halaman 3, size 100
  // /sublist all            -> semua (dikirim bertahap, per 100)
  if (isCommand && text.startsWith('sublist')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const rawArgs = (msg.body || '').trim().slice('/sublist'.length).trim();
    const parts = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : [];
    let page = 1, size = 50, showAll = false;

    if (parts[0]) {
      if (/^\d+$/.test(parts[0])) page = Math.max(1, parseInt(parts[0], 10));
      else if (parts[0].toLowerCase() === 'all') showAll = true;
    }
    if (parts[1] && /^\d+$/.test(parts[1])) {
      size = Math.min(200, Math.max(5, parseInt(parts[1], 10)));
    }

    const list = await collectKnownDM(client); // ini tetap return JID
    const total = list.length;

    if (showAll) {
      if (!total) return msg.reply('ℹ️ Belum ada user DM yang terdeteksi.');
      const chunk = 100;
      for (let i = 0; i < total; i += chunk) {
        const slice = list.slice(i, i + chunk)
          .map((j, idx) => `${i + idx + 1}. ${jidToLocal08(j)}`).join('\n');
        await safeSendMessage(client, from, `👥 *User DM* ${i + 1}-${Math.min(i + chunk, total)} / ${total}\n` + slice);
        await new Promise(r => setTimeout(r, 3000));
      }
      return;
    }

    const pages = Math.max(1, Math.ceil(total / size));
    if (page > pages) page = pages;

    const start = (page - 1) * size;
    const slice = list.slice(start, start + size);
    const lines = slice.map((j, i) => `${start + i + 1}. ${jidToLocal08(j)}`).join('\n') || '—';

    return msg.reply(
      `👥 *User DM* halaman ${page}/${pages}\n` +
      `Total: *${total}*\n\n` +
      `${lines}\n\n` +
      `Gunakan: */sublist [hal] [size]* (contoh: */sublist 2 100*)\n` +
      `Atau */sublist all* untuk semua.`
    );
  }


  // ==== /subexport (owner only): ekspor CSV semua nomor DM yang pernah chat ====
  if (isCommand && text === 'subexport') {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const list = await collectKnownDM(client); // list JID
    const rows = [['phone']]; // hanya nomor 08…
    for (const jid of list) {
      rows.push([jidToLocal08(jid)]);
    }

    // pakai toCsvValue kalau ada, kalau tidak gunakan escape sederhana
    const csvEscape = (v) => {
      const s = String(v ?? '');
      return (/[",\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const toCell = (typeof toCsvValue === 'function') ? toCsvValue : csvEscape;

    const csv = rows.map(r => r.map(toCell).join(',')).join('\n');

    const tmpDir = path.join(process.cwd(), 'tmp');
    ensureDirSync(tmpDir);
    const filename = `dm-users-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace('-', '')}.csv`;
    const outPath = path.join(tmpDir, filename);
    fs.writeFileSync(outPath, csv, 'utf8');

    const media = MessageMedia.fromFilePath(outPath);
    await safeSendMedia(client, from, media, {
      caption: `👥 User DM CSV (${list.length} nomor, format 08xxxx)`,
      sendMediaAsDocument: true
    });

    return;
  }

  // ==== /bot on|off|status (owner only) ====
  if (isCommand && text.startsWith('bot')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const sub = (text.split(/\s+/)[1] || '').toLowerCase();

    if (sub === 'on') {
      botSwitch.enabled = true; saveSwitch();
      return msg.reply('✅ Bot *diaktifkan*.');
    }
    if (sub === 'off') {
      botSwitch.enabled = false; saveSwitch();
      return msg.reply('🛑 Bot *dinonaktifkan sementara*. Hanya owner yang bisa menyalakan kembali dengan */bot on*.');
    }
    return msg.reply(`📟 Status bot: ${botSwitch.enabled ? 'ON' : 'OFF'}`);
  }

  // ==== /shutdown (owner only) ====
  if (isCommand && text === 'shutdown') {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    await msg.reply('🛑 Shutdown dimulai. Proses akan berhenti.');
    setTimeout(() => process.exit(0), 500);
    return;
  }

  // ==== /restart (owner only) ====
  // Catatan: agar restart otomatis, jalankan bot dengan PM2/forever/systemd
  if (isCommand && text === 'restart') {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    await msg.reply('♻️ Restart dimulai. Pastikan menggunakan PM2/forever agar otomatis hidup lagi.');
    setTimeout(() => process.exit(2), 500);
    return;
  }

  // ==== /eval <code> (owner only, dangerous) ====
  // Ambil kode dari msg.body asli (bukan 'text' yang sudah lowercased)
  if (isCommand && (text === 'eval' || text.startsWith('eval '))) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }

    const code = (msg.body || '').slice('/eval'.length).trim();
    if (!code) return msg.reply('❌ Sertakan kode JavaScript sesudah /eval');

    try {
      const fn = new Function(
        'client', 'msg', 'data', 'tasks', 'subs', 'owners', 'botSwitch', 'require', '__dirname', '__filename',
        code
      );
      const result = await fn(client, msg, data, tasks, subs, owners, botSwitch, require, __dirname, __filename);

      let out = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      if (!out) out = '(no return)';
      if (out.length > 3500) out = out.slice(0, 3500) + '\n... (dipotong)';

      return msg.reply('✅ Hasil eval:\n```js\n' + out + '\n```');
    } catch (e) {
      let err = (e && (e.stack || e.message)) || String(e);
      if (err.length > 3500) err = err.slice(0, 3500) + '\n... (dipotong)';
      return msg.reply('❌ Error eval:\n```js\n' + err + '\n```');
    }
  }


  if (isCommand && (text === 'bc' || text.startsWith('bc '))) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const message = (msg.body || '').replace(/^\/bc\b/i, '').trim();
    if (!message) {
      return msg.reply(
        '❌ Format: /bc <pesan>\n\nContoh:\n/bc Halo semuanya'
      );
    }

    const targets = collectBroadcastTargets();
    if (!targets.length) {
      return msg.reply('ℹ️ Tidak ada target broadcast aktif.');
    }

    pendingBroadcast[senderJid] = {
      message,
      targets,
      created: Date.now()
    };

    return msg.reply(
      `📢 *Konfirmasi Broadcast*\n\n` +
      `Pesan:\n${message}\n\n` +
      `Target: *${targets.length} user*\n` +
      `💡 _Tips: Gunakan format {Teks1|Teks2} untuk merandom kalimat dan menghindari spam._\n\n` +
      `Ketik *ya* atau */ya* untuk kirim\n` +
      `Ketik *batal* atau */batal* untuk membatalkan`
    );
  }

  // ==== /broadcast <pesan> (owner only, teks saja) ====

  if (isCommand && text.startsWith('bcimg')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const caption = (msg.body || '').replace(/^\/bcimg\b/i, '').trim();

    pendingBroadcastImage[senderJid] = {
      caption,
      created: Date.now()
    };

    return msg.reply(
      '🖼️ Oke, sekarang kirim *gambar* untuk broadcast.\n' +
      'Caption akan ikut dalam *1 bubble* dengan gambar.\n' +
      'Ketik *batal* atau */batal* kalau mau membatalkan.'
    );
  }

  // ==== /kick <@tag> (owner only, di grup, bot harus admin) ====
  if (isCommand && text.startsWith('kick')) {
    const chat = await msg.getChat();
    if (!chat.isGroup) return msg.reply('❌ /kick hanya bisa di grup.');

    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }

    if (!chat.participants.some(p => p.id._serialized === (client.info?.wid?._serialized) && p.isAdmin)) {
      return msg.reply('❌ Bot bukan admin, tidak bisa mengeluarkan anggota.');
    }

    const mentioned = msg.mentionedIds || [];
    if (!mentioned.length) return msg.reply('❌ Tag anggota yang mau dikeluarkan. Contoh: /kick @user');

    try {
      await chat.removeParticipants(mentioned);
      return msg.reply('✅ Anggota yang ditag telah dikeluarkan.');
    } catch (e) {
      log('Kick error:', e?.message || e);
      return msg.reply('⚠️ Gagal mengeluarkan anggota. Pastikan bot admin & nomor valid.');
    }
  }

  // ==== /addowner <62xxx@c.us> (owner only) ====
  if (isCommand && text.startsWith('addowner ')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const jid = text.split(/\s+/)[1];
    if (!jid || !/@c\.us$/i.test(jid)) return msg.reply('❌ Format: /addowner 62xxxxxxxxxx@c.us');
    if (owners.list.includes(jid)) return msg.reply('ℹ️ Nomor itu sudah jadi owner.');

    owners.list.push(jid);
    saveOwners();
    return msg.reply(`✅ Ditambahkan sebagai owner: ${jid}`);
  }

  // ==== /delowner <62xxx@c.us> (owner only) ====
  if (isCommand && text.startsWith('delowner ')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    const jid = text.split(/\s+/)[1];
    if (!jid || !/@c\.us$/i.test(jid)) return msg.reply('❌ Format: /delowner 62xxxxxxxxxx@c.us');

    // cegah kosong total
    if (!owners.list.includes(jid)) return msg.reply('ℹ️ Nomor itu bukan owner.');
    if (owners.list.length <= 1) return msg.reply('❌ Tidak bisa menghapus owner terakhir.');

    owners.list = owners.list.filter(x => x !== jid);
    saveOwners();
    return msg.reply(`✅ Dihapus dari owner: ${jid}`);
  }

  // ==== /addprem | /addpremi <nomor> (owner only) ====
  if (isCommand && (text.startsWith('addprem ') || text.startsWith('addpremi '))) {
    if (!isOwnerJid(senderJid) && !isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner bot.');
    }
    const rawInput = text.split(/\s+/)[1];
    const targetJid = normalizePhoneToCUs(rawInput);
    if (!targetJid) {
      return msg.reply('❌ Format nomor tidak valid!\nContoh: */addprem 081381794225*');
    }
    if (premUsers.list.includes(targetJid)) {
      return msg.reply(`ℹ️ Nomor *${rawInput}* sudah terdaftar dalam list Premium.`);
    }

    premUsers.list.push(targetJid);
    savePremUsers();

    await msg.reply(`✅ Nomor *${rawInput}* telah terdaftar premium dan bisa menggunakan fitur premium.`);

    // Kirim notifikasi selamat ke nomor target jika berbeda chat
    try {
      if (targetJid !== canonicalJid(msg.from)) {
        await client.sendMessage(targetJid, '🎉 *Selamat!*\nNomor Anda telah didaftarkan sebagai pengguna *PREMIUM*.\nSekarang Anda bisa menikmati akses ke seluruh fitur premium bot!');
      }
    } catch (e) {
      // abaikan jika nomor belum pernah interaksi/error kirim
    }
    return;
  }

  // ==== /delprem | /delpremi | /deletepremi <nomor> (owner only) ====
  if (isCommand && (text.startsWith('delprem ') || text.startsWith('delpremi ') || text.startsWith('deletepremi '))) {
    if (!isOwnerJid(senderJid) && !isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner bot.');
    }
    const rawInput = text.split(/\s+/)[1];
    const targetJid = normalizePhoneToCUs(rawInput);
    if (!targetJid) {
      return msg.reply('❌ Format nomor tidak valid!\nContoh: */deletepremi 081381794225*');
    }
    if (!premUsers.list.includes(targetJid)) {
      return msg.reply(`ℹ️ Nomor *${rawInput}* tidak ada dalam daftar Premium.`);
    }

    premUsers.list = premUsers.list.filter(x => x !== targetJid);
    savePremUsers();
    return msg.reply(`✅ Nomor *${rawInput}* berhasil dihapus dari daftar Premium.`);
  }

  // ==== /premlist | /listprem (owner only) ====
  if (isCommand && (text === 'premlist' || text === 'listprem' || text === 'listpremi')) {
    if (!isOwnerJid(senderJid) && !isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner bot.');
    }
    if (!premUsers.list || premUsers.list.length === 0) {
      return msg.reply('📋 Daftar Pengguna Premium saat ini masih kosong.');
    }
    const listTxt = premUsers.list.map((j, idx) => `${idx + 1}. +${j.replace('@c.us', '')}`).join('\n');
    return msg.reply(`👑 *Daftar Pengguna Premium (${premUsers.list.length}):*\n\n${listTxt}`);
  }

  // ==== /logon | /logoff (owner only) ====
  if (isCommand && (text === 'logon' || text === 'logoff')) {
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }
    botSwitch.logEnabled = (text === 'logon');
    saveSwitch();
    return msg.reply(`🧪 Log console: ${botSwitch.logEnabled ? 'ON' : 'OFF'}`);
  }

  ////////////////////////////////////////////////////////////////////////////////////
  // ==== /forward (owner only): mode "kirim pesan berikutnya" ====
  // Kini mendukung: /forward [daftar_nomor...]  (spasi/koma, boleh JID @c.us)
  if (isCommand && text.startsWith('forward')) {
    const owner = canonicalJid(getSenderId(msg));
    if (!isPrimaryOwnerJid(senderJid)) {
      return msg.reply('❌ Command ini hanya untuk owner utama bot.');
    }

    // Ambil argumen asli dari body (bukan text yg sudah lowercase)
    const rawArgs = (msg.body || '').trim().slice('/forward'.length).trim(); // string setelah "/forward"
    let targets = [];

    if (rawArgs) {
      // Mode TARGET KHUSUS: parse nomor/jid dipisah spasi/koma
      const tokens = rawArgs.split(/[,\s]+/).filter(Boolean);
      for (const t of tokens) {
        const jid = normalizeJid(t);
        if (!jid) {
          return msg.reply(`❌ Nomor/JID tidak valid: "${t}"\nContoh: /forward 62812xxxxx 62813yyyyy@c.us`);
        }
        if (jid !== owner) targets.push(jid);
      }

      // filter duplikat + hormati excludes
      targets = [...new Set(targets)].filter(j => !isExcludedJid(j));

      if (!targets.length) {
        return msg.reply('ℹ️ Tidak ada target valid setelah difilter. Coba ulangi.');
      }

    } else {
      // Mode LAMA: kumpulkan semua DM yang dikenal
      const chats = await client.getChats().catch(() => []);
      const dmFromClient = (chats || [])
        .filter(c => !c.isGroup && c.id?._serialized)
        .map(c => canonicalJid(c.id._serialized))
        .filter(j => j && j.endsWith('@c.us'));

      const set = new Set(dmFromClient);
      for (const k of Object.keys(data || {})) {
        const j = canonicalJid(k);
        if (j && j.endsWith('@c.us')) set.add(j);
      }
      for (const k of Object.keys(tasks || {})) {
        const j = canonicalJid(k);
        if (j && j.endsWith('@c.us')) set.add(j);
      }
      for (const j of (subs || [])) {
        const x = canonicalJid(j);
        if (x && x.endsWith('@c.us')) set.add(x);
      }

      // buang owner & nomor yg di-mute/excluded
      set.delete(owner);
      targets = [...set].filter(j => !isExcludedJid(j));

      if (!targets.length) {
        return msg.reply('ℹ️ Belum ada target DM yang dikenal. Chat dulu nomor tujuan, atau sebutkan nomor di /forward.');
      }
    }

    pendingForward[owner] = {
      created: Date.now(),
      targets
    };

    return msg.reply(
      `📨 *Mode Forward Aktif*\n` +
      `Kirim *1 pesan berikutnya* (teks/media/dokumen).\n` +
      `Target: *${targets.length}* nomor${rawArgs ? ' (custom)' : ''}.\n` +
      `Ketik */batal* untuk membatalkan.`
    );
  }


  //////////////////

  // /help
  // /help — ringkas & rapi
  // /help — versi rapi + contoh untuk user awam

  // ===== MENU UTAMA =====
  if (isCommand && text === 'menu') {
    const overview = [
      '```',
      '📖 BANTUAN BOT',
      '',
      '🔹 /menu1 — KEUANGAN',
      '   Input pemasukan/pengeluaran, saldo, histori, rekap, export, cari & hapus transaksi.',
      '',
      '🔹 /menu2 — REMINDER & AI',
      '   Tugas, pengingat, daftar tugas, hapus tugas, dan bantuan AI.',
      '',
      '🔹 /menu3 — KHUSUS GRUP',
      '   Mention semua anggota, Simi-Simi, UNO, dan fitur khusus grup.',
      '',
      '🔹 /menu4 — TOOLS',
      '   Stiker, downloader Instagram/TikTok/YouTube/X, Instagram Stories, PDF tools, dan tools lainnya.',
      '',
      '💡 CONTOH CEPAT KEUANGAN',
      '',
      '  Chat pribadi:',
      '  • makan 50rb dari cash',
      '  • dapet gaji 2jt masuk bca',
      '',
      '  Grup:',
      '  • catat makan 50rb dari cash',
      '  • catat dapet gaji 2jt masuk bca',
      '',
      '📌 Catatan:',
      '  • Semua fitur uang ada di /menu1',
      '  • Reminder tugas dan AI ada di /menu2',
      '  • Fitur khusus grup ada di /menu3',
      '  • Stiker, downloader YouTube/IG/TikTok/X, dan PDF tools ada di /menu4',
      '',
      'Ketik /menu1, /menu2, /menu3, atau /menu4 untuk melihat detail.',
      '```'
    ].join('\n');

    return safeSendMessage(client, from, overview);
  }

  // ===== MENU 1: KEUANGAN =====
  if (isCommand && text === 'menu1') {
    const help1 = [
      '```',
      '💰 MENU KEUANGAN',
      '',
      'Menu ini berisi semua fitur pencatatan uang:',
      'input pemasukan/pengeluaran, saldo, histori, rekap, export, cari, dan hapus transaksi.',
      '',
      '────────────────────────',
      '✨ INPUT OTOMATIS / BAHASA NATURAL',
      '────────────────────────',
      '',
      '  Chat pribadi:',
      '  Kamu bisa langsung chat seperti biasa tanpa command.',
      '',
      '  Contoh pengeluaran:',
      '  • makan 50k dari seabank',
      '  • bayar bensin 30rb pakai cash',
      '  • beli kopi 18rb via dana',
      '  • jajan bakso 15k',
      '',
      '  Contoh pemasukan:',
      '  • dapet gaji 2,5jt masuk bca',
      '  • refund 30rb masuk gopay',
      '  • jual barang 150rb',
      '  • kontrakan masuk 1jt',
      '',
      '  Grup:',
      '  Supaya bot tidak salah membaca obrolan, input keuangan wajib diawali kata "catat".',
      '',
      '  Contoh di grup:',
      '  • catat makan 50k dari seabank',
      '  • catat bayar bensin 30rb pakai cash',
      '  • catat dapet gaji 2,5jt masuk bca',
      '  • catat refund 30rb masuk gopay',
      '',
      '  Trigger grup yang didukung:',
      '  • catat',
      '  • catetin',
      '  • input',
      '  • simpan',
      '  • note',
      '',
      '  Format nominal:',
      '  • 50000',
      '  • 50rb / 50 ribu / 50k',
      '  • 1jt / 1 juta',
      '  • 2,5jt',
      '',
      '  Catatan:',
      '  • Di chat pribadi, transaksi bisa dicatat otomatis.',
      '  • Di grup, bot hanya mencatat jika diawali trigger seperti "catat".',
      '  • Kalau kalimat ambigu, bot akan diam agar tidak salah catat.',
      '',
      '────────────────────────',
      '🧾 INPUT MANUAL / MODE PRESISI',
      '────────────────────────',
      '',
      '  + <deskripsi> <nominal>',
      '    Tambah pemasukan',
      '    Contoh: + gaji 2500000',
      '',
      '  - <deskripsi> <nominal>',
      '    Tambah pengeluaran',
      '    Contoh: - beli pulsa 50000',
      '',
      '  Tambah kategori manual:',
      '    Contoh: - makan siang 30000 #Makanan',
      '',
      '────────────────────────',
      '📊 CEK SALDO',
      '────────────────────────',
      '',
      '  /saldo',
      '    Ringkasan keuangan semua bulan',
      '',
      '  /saldo bulanini',
      '    Lihat saldo khusus bulan berjalan',
      '',
      '  /saldo 07-2025',
      '    Lihat saldo bulan tertentu',
      '',
      '────────────────────────',
      '📒 HISTORI TRANSAKSI',
      '────────────────────────',
      '',
      '  /h',
      '    Lihat histori transaksi bulan ini',
      '',
      '  /h 07-2025',
      '    Lihat histori bulan tertentu',
      '',
      '  /h 2025-07',
      '    Format lain untuk lihat histori bulan tertentu',
      '',
      '  /h masuk 07-2025',
      '    Lihat histori pemasukan bulan tertentu',
      '',
      '  /h keluar 07-2025',
      '    Lihat histori pengeluaran bulan tertentu',
      '',
      '────────────────────────',
      '📈 REKAP KEUANGAN',
      '────────────────────────',
      '',
      '  /r',
      '    Rekap bulan berjalan',
      '',
      '  /r 07-2025',
      '    Rekap bulan tertentu',
      '',
      '  /r semua',
      '    Rekap semua bulan',
      '',
      '────────────────────────',
      '📈 DASHBOARD',
      '────────────────────────',
      '',
      '  /dashboard',
      '    Buka dashboard web untuk visualisasi grafik dan tabel keuangan bulanan Anda.',
      '',
      '────────────────────────',
      '📤 EXPORT DATA',
      '────────────────────────',
      '',
      '  /export',
      '    Export histori bulan ini ke file CSV',
      '',
      '  /export 07-2025',
      '    Export histori bulan tertentu',
      '',
      '  /export semua',
      '    Export semua histori transaksi',
      '',
      '  Catatan:',
      '  • File export bisa dibuka di Excel',
      '  • Cocok untuk backup atau laporan bulanan',
      '',
      '────────────────────────',
      '🔎 CARI TRANSAKSI',
      '────────────────────────',
      '',
      '  /cari <kata>',
      '    Cari transaksi berdasarkan deskripsi dari semua bulan',
      '',
      '  Contoh:',
      '  • /cari ayam',
      '  • /cari pulsa',
      '  • /cari gaji',
      '  • /cari bensin',
      '',
      '  Hasil pencarian menampilkan:',
      '  • Tanggal transaksi',
      '  • Bulan transaksi',
      '  • Jenis masuk/keluar',
      '  • Nominal',
      '  • ID transaksi',
      '',
      '────────────────────────',
      '🗑️ HAPUS TRANSAKSI',
      '────────────────────────',
      '',
      '  /hapus <nomor>',
      '    Hapus transaksi sesuai nomor dari histori /h bulan ini',
      '    Contoh: /hapus 2',
      '',
      '  /hapusid <ID>',
      '    Hapus transaksi berdasarkan ID unik lintas bulan',
      '    Contoh: /hapusid K9F3QW',
      '',
      '  /hapus terakhir',
      '    Hapus transaksi terbaru pada bulan ini',
      '',
      '  /hapus',
      '    Hapus semua data bulan ini',
      '',
      '  /hapus semua',
      '    Hapus semua riwayat semua bulan',
      '',
      '  /hapus 07-2025',
      '    Hapus semua transaksi bulan tertentu',
      '',
      '  /hapus bulan 07-2025',
      '    Alias untuk hapus semua transaksi pada bulan tertentu',
      '',
      '  /hapus cari <kata>',
      '    Cari transaksi lintas bulan untuk bantu menemukan ID/data yang mau dihapus',
      '    Contoh: /hapus cari ayam',
      '',
      '  /ya atau ya',
      '    Konfirmasi hapus atau simpan proses tertentu',
      '    Catatan: ya tanpa slash hanya aktif saat ada proses konfirmasi',
      '',
      '  /batal atau batal',
      '    Batalkan proses yang sedang menunggu konfirmasi',
      '    Bisa juga pakai /tidak atau tidak',
      '',
      '────────────────────────',
      '⏰ PENGINGAT INPUT KEUANGAN',
      '────────────────────────',
      '',
      '  /ingatkan on',
      '    Nyalakan pengingat input keuangan',
      '',
      '  /ingatkan off',
      '    Matikan pengingat input keuangan',
      '',
      '  Catatan:',
      '  • Fitur ini khusus chat pribadi / DM',
      '  • Jadwal default: 20:00 WIB',
      '',
      '────────────────────────',
      '📌 RINGKASAN COMMAND KEUANGAN',
      '────────────────────────',
      '',
      '  Input natural:',
      '  • DM: makan 50rb dari cash',
      '  • Grup: catat makan 50rb dari cash',
      '',
      '  Input manual:',
      '  • + gaji 2500000',
      '  • - beli pulsa 50000',
      '',
      '  Cek data:',
      '  • /saldo',
      '  • /h',
      '  • /r',
      '  • /export',
      '  • /dashboard',
      '',
      '  Kelola data:',
      '  • /cari ayam',
      '  • /hapus 2',
      '  • /hapusid K9F3QW',
      '',
      '```'
    ].join('\n');

    return safeSendMessage(client, from, help1);
  }

  // ===== MENU 2: REMINDER & AI =====
  if (isCommand && text === 'menu2') {
    const help2 = [
      '```',
      '⏰ MENU REMINDER & AI',
      '',
      'Menu ini berisi fitur tugas/reminder dan bantuan AI.',
      '',
      '────────────────────────',
      '⏰ TUGAS & REMINDER',
      '────────────────────────',
      '',
      '  Input otomatis / bahasa natural:',
      '  Kamu bisa langsung chat dengan kata pemicu seperti:',
      '',
      '  • tolong ingatkan saya untuk pergi ke mall besok jam 9',
      '  • ingatkan nanti sore beli sayur jam 5',
      '  • jangan lupa bayar wifi lusa jam 8 malam',
      '  • reminder minum obat dalam 30 menit',
      '',
      '  Catatan:',
      '  • Bot akan minta pilihan pengulangan dulu sebelum menyimpan reminder',
      '  • Pilih: sekali, harian, mingguan, atau bulanan',
      '  • Setelah itu ketik ya atau /ya untuk simpan',
      '  • Ketik batal, /batal, tidak, atau /tidak untuk membatalkan',
      '',
      '  /tugas <isi>',
      '    Tambah tugas/reminder secara manual.',
      '',
      '  Contoh:',
      '  • /tugas kuliah besok jam 7',
      '  • /tugas bayar wifi ; 1 april ; 8 malam',
      '',
      '  /tugas ke <nomor> | <isi>',
      '    Buat reminder dan kirim ke nomor tertentu.',
      '    (Mendukung bahasa natural: "ingatkan ke 08... besok meeting")',
      '',
      '  Contoh:',
      '  • /tugas ke 08123456789 | minum obat besok jam 8',
      '  • ingetin ke 08123456789 besok jam 9 untuk meeting',
      '',
      '  /tugas ke <nomor1>, <nomor2> | <isi>',
      '    Buat reminder untuk banyak penerima sekaligus.',
      '',
      '  Contoh:',
      '  • /tugas ke 08123456789,08129876543 | meeting besok jam 9',
      '  • ingatkan ke 08123, 08129 besok kumpul jam 5',
      '',
      '  /dt',
      '    Lihat daftar tugas aktif.',
      '',
      '  /hapus_tugas <opsi>',
      '    Hapus tugas dari daftar.',
      '',
      '  Contoh:',
      '  • /hapus_tugas 2',
      '  • /hapus_tugas id TABC12',
      '  • /hapus_tugas semua',
      '',
      '  /ya atau ya',
      '    Konfirmasi simpan/hapus reminder.',
      '    ya tanpa slash hanya aktif kalau ada proses konfirmasi.',
      '',
      '  /batal atau batal',
      '    Batalkan proses reminder.',
      '    Bisa juga pakai /tidak atau tidak.',
      '',
      '────────────────────────',
      '🤖 AI',
      '────────────────────────',
      '',
      '  /ai <pertanyaan>',
      '    Tanya AI langsung dari WhatsApp.',
      '',
      '  Contoh:',
      '  • /ai jelaskan iterative model dengan singkat',
      '  • /ai buat caption promosi bengkel',
      '  • /ai bantu ringkas teks ini',
      '',
      '  Catatan:',
      '  • Gunakan pertanyaan yang jelas',
      '  • Untuk jawaban panjang, bot mungkin butuh beberapa detik',
      '',
      '────────────────────────',
      '📌 RINGKASAN COMMAND REMINDER & AI',
      '────────────────────────',
      '',
      '  Reminder:',
      '  • /tugas <isi>',
      '  • /tugas ke <nomor> | <isi>',
      '  • /dt',
      '  • /hapus_tugas 2',
      '  • /hapus_tugas id TABC12',
      '  • /hapus_tugas semua',
      '',
      '  Konfirmasi:',
      '  • ya atau /ya',
      '  • batal atau /batal',
      '  • tidak atau /tidak',
      '',
      '  AI:',
      '  • /ai <pertanyaan>',
      '',
      '```'
    ].join('\n');

    return safeSendMessage(client, from, help2);
  }


  // ===== MENU 3: KHUSUS GRUP =====
  if (isCommand && text === 'menu3') {
    const help3 = [
      '```',
      '👥 MENU KHUSUS GRUP',
      '',
      'Menu ini berisi fitur yang dipakai di grup:',
      'mention semua anggota, Simi-Simi, dan game UNO.',
      '',
      'Catatan:',
      '• Sebagian besar command di menu ini hanya bisa dipakai di grup.',
      '• Kalau dipakai di chat pribadi, bot bisa menolak command tersebut.',
      '',
      '────────────────────────',
      '📢 MENTION SEMUA ANGGOTA',
      '────────────────────────',
      '',
      '  /ping',
      '    Mention semua anggota grup.',
      '',
      '  /ping <pesan>',
      '    Mention semua anggota grup dengan tambahan pesan.',
      '',
      '  Contoh:',
      '  • /ping',
      '  • /ping Rapat dimulai sekarang',
      '  • /ping Jangan lupa kumpul jam 8 malam',
      '',
      '  Catatan:',
      '  • Fitur ini hanya untuk grup',
      '  • Gunakan seperlunya agar tidak mengganggu anggota grup',
      '',
      '────────────────────────',
      '💬 SIMI-SIMI / AUTO CHAT GRUP',
      '────────────────────────',
      '',
      '  /simi on',
      '    Mengaktifkan Simi-Simi di grup ini.',
      '',
      '  /simi off',
      '    Mematikan Simi-Simi di grup ini.',
      '',
      '  /simi status',
      '    Melihat status Simi-Simi di grup ini.',
      '',
      '  /simi chance <persen>',
      '    Mengatur peluang bot membalas chat.',
      '',
      '  Contoh:',
      '  • /simi chance 20',
      '  • /simi chance 50',
      '',
      '  /simi cooldown <detik>',
      '    Mengatur jeda waktu antar balasan bot.',
      '',
      '  Contoh:',
      '  • /simi cooldown 30',
      '  • /simi cooldown 60',
      '',
      '  /simi mention on',
      '    Bot lebih fokus membalas jika di-mention.',
      '',
      '  /simi mention off',
      '    Bot boleh membalas tanpa harus di-mention, sesuai chance.',
      '',
      '  Catatan:',
      '  • Chance makin besar = bot makin sering ikut ngobrol',
      '  • Cooldown makin besar = bot lebih jarang membalas',
      '  • Kalau grup ramai, disarankan chance kecil dan cooldown besar',
      '',
      '────────────────────────',
      '🎲 UNO / GAME GRUP',
      '────────────────────────',
      '',
      '  /uno start',
      '    Membuka lobby game UNO di grup.',
      '',
      '  /uno join',
      '    Ikut masuk ke permainan UNO.',
      '',
      '  /uno begin',
      '    Memulai permainan setelah pemain terkumpul.',
      '',
      '  /uno hand',
      '    Melihat kartu yang kamu pegang.',
      '',
      '  /uno top',
      '    Melihat kartu paling atas di meja.',
      '',
      '  /uno status',
      '    Melihat status permainan saat ini.',
      '',
      '  /uno play <kode>',
      '    Mengeluarkan kartu dari tangan.',
      '',
      '  Contoh:',
      '  • /uno play R5',
      '  • /uno play G2',
      '  • /uno play BD2',
      '  • /uno play W merah',
      '  • /uno play W4 biru',
      '',
      '  /uno draw',
      '    Ambil kartu dari deck.',
      '',
      '  /uno pass',
      '    Lewati giliran setelah mengambil kartu.',
      '',
      '  /uno leave',
      '    Keluar dari permainan.',
      '',
      '  /uno end',
      '    Mengakhiri permainan UNO di grup.',
      '',
      '  Warna kartu:',
      '  • R = Merah',
      '  • G = Hijau',
      '  • B = Biru',
      '  • Y = Kuning',
      '',
      '  Kode kartu aksi:',
      '  • S  = Skip',
      '  • R  = Reverse',
      '  • D2 = Draw 2',
      '  • W  = Wild',
      '  • W4 = Wild Draw 4',
      '',
      '────────────────────────',
      '📌 RINGKASAN COMMAND GRUP',
      '────────────────────────',
      '',
      '  Mention:',
      '  • /ping',
      '  • /ping <pesan>',
      '',
      '  Simi-Simi:',
      '  • /simi on',
      '  • /simi off',
      '  • /simi status',
      '  • /simi chance 30',
      '  • /simi cooldown 60',
      '  • /simi mention on',
      '',
      '  UNO:',
      '  • /uno start',
      '  • /uno join',
      '  • /uno begin',
      '  • /uno hand',
      '  • /uno play <kode>',
      '  • /uno draw',
      '  • /uno pass',
      '  • /uno status',
      '  • /uno leave',
      '  • /uno end',
      '',
      '```'
    ].join('\n');

    return safeSendMessage(client, from, help3);
  }

  // ===== MENU 4: TOOLS =====
  if (isCommand && text === 'menu4') {
    const help4 = [
      '```',
      '🧰 MENU TOOLS',
      '',
      'Menu ini berisi tools tambahan seperti stiker, downloader media sosial, konversi gambar ke PDF, dan tools lainnya.',
      '',
      '────────────────────────',
      '🖼️ STIKER',
      '────────────────────────',
      '',
      '  /sticker',
      '    Aktifkan mode pembuat stiker.',
      '    Setelah itu kirim foto yang mau dijadikan stiker.',
      '',
      '  Kirim foto + caption /sticker',
      '    Bisa langsung dalam 1 bubble.',
      '',
      '  Contoh:',
      '  • Kirim foto dengan caption: /sticker',
      '  • Kirim foto dengan caption: /sticker waduh kena deh',
      '',
      '  Caption opsional:',
      '  • Kalau caption diisi, teks akan jadi label putih di bawah stiker.',
      '  • Kalau caption kosong, bot hanya membuat stiker dari foto.',
      '',
      '────────────────────────',
      '🎨 STYLE STIKER',
      '────────────────────────',
      '',
      '  /stickerstyle show',
      '    Lihat style stiker yang aktif di chat ini.',
      '',
      '  /stickerstyle preset <nama>',
      '    Pakai preset style stiker.',
      '',
      '  Preset yang tersedia:',
      '  • compact',
      '  • classic',
      '  • pill',
      '  • top',
      '',
      '  Contoh:',
      '  • /stickerstyle preset compact',
      '  • /stickerstyle preset pill',
      '',
      '  /stickerstyle reset',
      '    Reset style stiker ke default.',
      '',
      '  Catatan:',
      '  • Style stiker tersimpan per chat',
      '  • Setiap grup/chat bisa punya style berbeda',
      '',
      '────────────────────────',
      '📦 CEK RESI EKSPEDISI',
      '────────────────────────',
      '',
      '  /resi <kurir> <nomor_resi>',
      '    Melacak paket dari berbagai ekspedisi lokal.',
      '',
      '  Contoh:',
      '  • /resi jnt JP1234567890',
      '  • /resi jne 01234567890123',
      '',
      '  Kurir yang didukung:',
      '  • jnt, jne, sicepat, anteraja, spx (Shopee Express)',
      '  • pos, ninja, lion, wahana, tiki, idexpress, dll.',
      '',
      '────────────────────────',
      '📥 DOWNLOADER INSTAGRAM',
      '────────────────────────',
      '',
      '  /ig <link>',
      '    Download media Instagram.',
      '',
      '  Bisa untuk:',
      '  • Reels',
      '  • Video post',
      '  • Foto post',
      '  • Carousel / multiple slide',
      '',
      '  Contoh:',
      '  • /ig https://www.instagram.com/reel/xxxx',
      '  • /ig https://www.instagram.com/p/xxxx',
      '',
      '  /igmp3 <link>',
      '    Download audio (mp3) Instagram.',
      '',
      '  Contoh:',
      '  • /igmp3 https://www.instagram.com/reel/xxxx',
      '',
      '  Catatan:',
      '  • Konten harus bisa diakses oleh bot',
      '  • Kalau konten private, cookies Instagram harus punya akses',
      '',
      '────────────────────────',
      '📸 INSTAGRAM STORIES',
      '────────────────────────',
      '',
      '  /igs <username>',
      '    Download Instagram Stories dari username.',
      '',
      '  Contoh:',
      '  • /igs username_ig',
      '  • /igs @username_ig',
      '',
      '  /igs <link story>',
      '    Download story dari link langsung.',
      '',
      '  Contoh:',
      '  • /igs https://www.instagram.com/stories/username/123456789/',
      '',
      '  Catatan:',
      '  • Hanya bisa mengambil story yang masih aktif',
      '  • Butuh cookies Instagram aktif',
      '  • Untuk akun private, akun cookies harus follow akun tersebut',
      '',
      '────────────────────────',
      '🎵 DOWNLOADER TIKTOK',
      '────────────────────────',
      '',
      '  /tt <link>',
      '    Download video TikTok.',
      '',
      '  Contoh:',
      '  • /tt https://vt.tiktok.com/xxxx',
      '  • /tt https://www.tiktok.com/@user/video/xxxx',
      '',
      '  Catatan:',
      '  • Cocok untuk link TikTok biasa atau link pendek vt.tiktok.com',
      '',
      '────────────────────────',
      '▶️ DOWNLOADER YOUTUBE',
      '────────────────────────',
      '',
      '  /yt mp4 <link>',
      '    Download video YouTube menjadi file MP4.',
      '',
      '  /yt mp3 <link>',
      '    Download YouTube menjadi file audio MP3.',
      '',
      '  /yt vn <link>',
      '    Ubah audio YouTube menjadi voice note WhatsApp.',
      '',
      '  Alias cepat:',
      '  • /ytmp4 <link>',
      '  • /ytmp3 <link>',
      '  • /ytvn <link>',
      '',
      '  Contoh:',
      '  • /yt mp4 https://youtu.be/xxxx',
      '  • /yt mp3 https://youtu.be/xxxx',
      '  • /yt vn https://youtu.be/xxxx',
      '',
      '  Catatan:',
      '  • Video panjang/besar bisa gagal karena batas ukuran WhatsApp.',
      '  • Format MP4 dibatasi kualitas maksimal 720p agar ukuran tidak terlalu besar.',
      '',
      '────────────────────────',
      '🐦 DOWNLOADER TWITTER / X',
      '────────────────────────',
      '',
      '  /x <link>',
      '    Download media Twitter/X.',
      '',
      '  Bisa untuk:',
      '  • Video tweet',
      '  • Gambar tweet',
      '  • Multiple image tweet',
      '',
      '  Contoh:',
      '  • /x https://x.com/user/status/xxxx',
      '  • /x https://twitter.com/user/status/xxxx',
      '',
      '  Alias:',
      '  • /twitter <link>',
      '',
      '────────────────────────',
      '🔊 TEXT TO SPEECH (SUARA)',
      '────────────────────────',
      '',
      '  /tts <teks pesan>',
      '    Mengubah teks menjadi pesan suara (voice note).',
      '',
      '  Contoh:',
      '  • /tts Halo semuanya selamat pagi!',
      '  • /tts Jangan lupa minum air putih hari ini.',
      '',
      '  Catatan:',
      '  • Bot akan membalas dengan audio menggunakan aksen Indonesia.',
      '  • Maksimal panjang teks adalah 200 karakter.',
      '',
      '────────────────────────',
      '📄 PDF TOOLS',
      '────────────────────────',
      '',
      '  /pdf',
      '    Ubah satu atau beberapa gambar menjadi file PDF.',
      '',
      '  Cara pakai /pdf:',
      '  1. Ketik /pdf',
      '  2. Kirim gambar satu per satu',
      '  3. Ketik selesai atau /selesai',
      '  4. Bot mengirim file PDF',
      '',
      '  /pdf2img',
      '    Ubah file PDF menjadi gambar (per halaman).',
      '',
      '  Cara pakai /pdf2img:',
      '  1. Ketik /pdf2img',
      '  2. Kirim 1 file PDF',
      '  3. Bot mengirim gambar per halaman',
      '',
      '  /pdfmerge',
      '    Gabungkan beberapa file PDF menjadi 1 PDF.',
      '',
      '  Cara pakai /pdfmerge:',
      '  1. Ketik /pdfmerge',
      '  2. Kirim beberapa file PDF satu per satu',
      '  3. Ketik selesai atau /selesai',
      '  4. Bot mengirim PDF gabungan',
      '',
      '  /pdfcompress',
      '    Kompres ukuran file PDF.',
      '',
      '  Pilihan kualitas:',
      '  • /pdfcompress screen   → ukuran paling kecil',
      '  • /pdfcompress ebook    → seimbang, disarankan',
      '  • /pdfcompress printer  → kualitas lebih bagus',
      '  • /pdfcompress prepress → kualitas tinggi',
      '',
      '  /pdfsplit',
      '    Pecah PDF per halaman.',
      '',
      '  /pdfsplit <range>',
      '    Ambil halaman tertentu menjadi 1 PDF baru.',
      '',
      '  Contoh:',
      '  • /pdfsplit',
      '  • /pdfsplit 1-3',
      '  • /pdfsplit 1,3,5',
      '  • /pdfsplit 1-3,7',
      '',
      '  Perintah saat mode PDF aktif:',
      '  • selesai / /selesai  → proses PDF',
      '  • batal / /batal      → batalkan proses',
      '',
      '  Catatan:',
      '  • /pdfsplit tanpa range akan mengirim file PDF per halaman',
      '  • Untuk PDF banyak halaman, bot hanya mengirim 20 file pertama agar tidak spam',
      '',
      '────────────────────────',
      '📌 RINGKASAN COMMAND TOOLS',
      '────────────────────────',
      '',
      '  Stiker:',
      '  • /sticker',
      '  • /stickerstyle show',
      '  • /stickerstyle preset compact',
      '  • /stickerstyle preset pill',
      '  • /stickerstyle reset',
      '',
      '  Downloader:',
      '  • /ig <link Instagram>',
      '  • /igmp3 <link Instagram>',
      '  • /igs <username/link story>',
      '  • /tt <link TikTok>',
      '  • /yt mp4 <link YouTube>',
      '  • /yt mp3 <link YouTube>',
      '  • /yt vn <link YouTube>',
      '  • /x <link Twitter/X>',
      '  • /twitter <link Twitter/X>',
      '',
      '  Audio & Suara:',
      '  • /tts <teks pesan>',
      '',
      '  PDF Tools:',
      '  • /pdf',
      '  • /pdf2img',
      '  • /pdfmerge',
      '  • /pdfcompress',
      '  • /pdfsplit',
      '  • /pdfsplit 1-3',
      '',
      '```'
    ].join('\n');

    return safeSendMessage(client, from, help4);
  }


  // INI COMMAND UMUM ATAU PUBLIK //
  if (!data[key]) data[key] = {};
  if (!data[key][monthKey]) data[key][monthKey] = [];

  // ==== PDF TOOLS ====
  if (isCommand && text === 'pdf') {
    return handleImagePdfCommand(msg, {
      from,
      sender: senderJid
    });
  }

  if (isCommand && (text === 'pdf2img' || text === 'pdf2image' || text === 'pdftoimg')) {
    return handlePdfToImageCommand(msg, {
      from,
      sender: senderJid
    });
  }

  if (isCommand && text === 'pdfmerge') {
    return handlePdfMergeCommand(msg, {
      from,
      sender: senderJid
    });
  }

  if (isCommand && (text === 'pdfcompress' || text.startsWith('pdfcompress '))) {
    return handlePdfCompressCommand(msg, {
      from,
      sender: senderJid
    });
  }

  if (isCommand && (text === 'pdfsplit' || text.startsWith('pdfsplit '))) {
    return handlePdfSplitCommand(msg, {
      from,
      sender: senderJid
    });
  }

  if (await handlePendingImagePdf(msg, {
    from,
    sender: senderJid
  })) {
    return;
  }

  if (await handlePendingPdfToImage(msg, {
    from,
    sender: senderJid
  })) {
    return;
  }

  if (await handlePendingPdfTools(msg, {
    from,
    sender: senderJid
  })) {
    return;
  }

  // ==== NATURAL TASK / REMINDER PARSER ====
  if (!isCommand && !msg.hasMedia) {
    const handledNaturalTask = await tugasCmd.handleNaturalTugas({
      msg,
      from,
      sender: senderJid,
      tasks,
      saveTasks,
      pendingTugas,
      normalizeJid,
      jidToLocal08,
      dedup
    });

    if (handledNaturalTask) return;
  }

  // ==== NATURAL FINANCE PARSER ====
  if (!isCommand && !msg.hasMedia) {
    const handledNaturalFinance = await handleNaturalFinanceMessage({
      msg,
      key,
      isCommand,
      dedup,
      isGroup: from.endsWith('@g.us')
    });

    if (handledNaturalFinance) return;
  }

  // + pemasukan (cari angka terakhir sebagai nominal; dukung #Kategori di akhir)
  if (!isCommand && msg.body.trim().startsWith('+')) {
    dedup.mark(msg);

    const raw = msg.body.trim().slice(1).trim(); // hapus tanda +
    const parts = raw.split(/\s+/);

    // cari token angka terakhir
    let nominal = null;
    let nominalIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) {               // angka bulat
        nominal = parseInt(parts[i], 10);
        nominalIndex = i;
        break;
      }
    }
    if (nominal === null) {
      return msg.reply('❌ Format salah. Contoh: + gaji bulanan 2500000 #Gaji');
    }

    // sisakan deskripsi (+ kemungkinan #Kategori) lalu ekstrak
    parts.splice(nominalIndex, 1);
    const rawDesc = parts.join(' ');
    const { clean, category } = extractCategoryFromDesc(rawDesc);

    const tx = {
      id: makeTxId(),
      type: 'income',
      desc: clean,
      amount: nominal,
      date: new Date().toISOString()
    };
    if (category) { tx.category = category; addCategoryForChat(key, category); }

    data[key] = data[key] || {};
    data[key][monthKey] = data[key][monthKey] || [];
    data[key][monthKey].push(tx);
    saveData();

    const tag = tx.category ? ` [#${tx.category}]` : '';
    return msg.reply(`✅ Pemasukan dicatat: ${tx.desc}${tag} — ${formatIDR(tx.amount)}\nID: #${tx.id}`);
  }



  if (!isCommand && msg.body.trim().startsWith('-')) {
    dedup.mark(msg);
    const raw = msg.body.trim().slice(1).trim(); // hapus tanda -

    // pisahkan kata-kata
    const parts = raw.split(/\s+/);

    // cari angka terakhir (nominal)
    let nominal = null;
    let nominalIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) {
        nominal = parseInt(parts[i], 10);
        nominalIndex = i;
        break;
      }
    }

    if (nominal === null) {
      return msg.reply('❌ Format salah. Contoh: - makan siang 30000 #Makanan');
    }

    // sisanya (selain nominal) gabungkan lagi jadi deskripsi
    parts.splice(nominalIndex, 1);
    const rawDesc = parts.join(' ');

    // ekstrak kategori opsional
    const { clean, category } = extractCategoryFromDesc(rawDesc);

    const tx = {
      id: makeTxId(),
      type: 'expense',
      desc: clean,
      amount: nominal,
      date: new Date().toISOString()
    };
    if (category) {
      tx.category = category;
      addCategoryForChat(key, category);
    }

    data[key] = data[key] || {};
    data[key][monthKey] = data[key][monthKey] || [];
    data[key][monthKey].push(tx);
    saveData();

    const tag = tx.category ? ` [#${tx.category}]` : '';
    return msg.reply(`✅ Pengeluaran dicatat: ${tx.desc}${tag} — ${formatIDR(tx.amount)}\nID: #${tx.id}`);
  }




  // /r
  if (isCommand) {
    const cmd = text.split(/\s+/)[0];
    if (cmd === 'r') {
      const args = text.split(' ');
      let targetMonth = monthKey;

      if (args.length === 2 && args[1] !== 'semua') {
        const parsed = parseMonthArg(args[1]);
        if (!parsed) return msg.reply('❌ Format salah. Contoh: /r 07-2025 atau /r 2025-07');
        targetMonth = parsed;
      }

      if (args[1] === 'semua') {
        const months = Object.keys(data[key] || {});
        if (months.length === 0) return msg.reply("❌ Belum ada data keuangan.");

        let totalIncome = 0, totalExpense = 0;
        let lines = [];
        months.forEach(m => {
          const items = data[key][m];
          let income = 0, expense = 0;
          items.forEach(i => {
            if (i.type === 'income') income += i.amount;
            else if (i.type === 'expense') expense += i.amount;
          });
          totalIncome += income;
          totalExpense += expense;
          lines.push(`📅 ${m} → Masuk: ${formatIDR(income)}, Keluar: ${formatIDR(expense)}`);
        });

        const saldo = totalIncome - totalExpense;
        return msg.reply(`📊 Rekap Semua Bulan:\n` + lines.join('\n') + `\n\n🧮 Total Saldo: ${formatIDR(saldo)}`);
      }

      const items = (data[key] && data[key][targetMonth]) || [];
      let income = 0, expense = 0;
      items.forEach(i => {
        if (i.type === 'income') income += i.amount;
        else if (i.type === 'expense') expense += i.amount;
      });
      const saldo = income - expense;

      if (items.length === 0) return msg.reply(`📊 Tidak ada data untuk bulan ${targetMonth}.`);
      return msg.reply(`📊 Rekap ${targetMonth}\nPemasukan: ${formatIDR(income)}\nPengeluaran: ${formatIDR(expense)}\nSaldo: ${formatIDR(saldo)}`);
    }
  }

  // /h (per hari + filter masuk/keluar + dukung bulan) — terbaru → terlama
  // /h ...
  if (isCommand) {
    const cmd = text.split(/\s+/)[0]; // nama command saja
    if (cmd === 'h') {
      const parts = text.split(/\s+/).filter(Boolean); // ['h', ...]
      let typeFilter = null; // 'income' | 'expense' | null
      let targetMonth = monthKey;

      if (parts.length >= 2) {
        if (parts[1] === 'masuk') typeFilter = 'income';
        else if (parts[1] === 'keluar') typeFilter = 'expense';
        else {
          const m = parseMonthArg(parts[1]);
          if (m) targetMonth = m;
          else return msg.reply('❌ Format salah. Contoh: /h 07-2025 | /h 2025-07 | /h masuk | /h keluar 07-2025');
        }
      }
      if (parts.length >= 3) {
        const m = parseMonthArg(parts[2]);
        if (m) targetMonth = m;
        else return msg.reply('❌ Format salah. Contoh: /h masuk 07-2025 | /h keluar 2025-07');
      }

      const items = (data[key] && data[key][targetMonth]) || [];
      if (items.length === 0) {
        return msg.reply(`❌ Belum ada data untuk bulan ${targetMonth}.`);
      }

      // Kelompokkan per tanggal, sambil simpan nomor asli transaksi bulanan
      const groups = {}; // { 'YYYY-MM-DD': { income:[], expense:[] } }

      const globalRows = getAllTransactionsIndexed(key);
      const globalNoMap = new Map();

      globalRows.forEach(row => {
        globalNoMap.set(`${row.monthKey}:${row.index}`, row.globalNo);
      });

      items.forEach((it, originalIndex) => {
        if (typeFilter && it.type !== typeFilter) return;

        const dateKey = it?.date ? getDateKeyJakarta(it.date) : 'tanpa-tanggal';
        if (!groups[dateKey]) groups[dateKey] = { income: [], expense: [] };

        const entry = {
          ...it,
          _no: globalNoMap.get(`${targetMonth}:${originalIndex}`) || (originalIndex + 1)
        };

        if (it.type === 'income') groups[dateKey].income.push(entry);
        else if (it.type === 'expense') groups[dateKey].expense.push(entry);
      });

      const dateKeys = Object.keys(groups);
      if (dateKeys.length === 0) {
        if (typeFilter === 'income') return msg.reply(`ℹ️ Tidak ada *pemasukan* pada ${targetMonth}.`);
        if (typeFilter === 'expense') return msg.reply(`ℹ️ Tidak ada *pengeluaran* pada ${targetMonth}.`);
        return msg.reply(`ℹ️ Tidak ada data pada ${targetMonth}.`);
      }

      // Urutkan tanggal terbaru → terlama
      const sortedDates = dateKeys.sort((a, b) => b.localeCompare(a));

      // Rakit pesan
      let out = [];
      for (const d of sortedDates) {
        const label = d === 'tanpa-tanggal'
          ? '(tanpa tanggal)'
          : formatDateHeaderJakarta(d);

        out.push(`📅 *${label}*`);

        const incs = groups[d].income.map(i => {
          const catTag = i.category ? ` [#${i.category}]` : '';
          const idTag = i.id ? ` [#${String(i.id).toUpperCase()}]` : '';
          return `  ${i._no}. + ${i.desc}${catTag} — ${formatIDR(i.amount)}${idTag}`;
        });

        const exps = groups[d].expense.map(i => {
          const catTag = i.category ? ` [#${i.category}]` : '';
          const idTag = i.id ? ` [#${String(i.id).toUpperCase()}]` : '';
          return `  ${i._no}. - ${i.desc}${catTag} — ${formatIDR(i.amount)}${idTag}`;
        });

        if (!typeFilter || typeFilter === 'income') {
          if (incs.length) {
            out.push('  💰 *Pemasukan*');
            out.push(...incs);
          }
        }
        if (!typeFilter || typeFilter === 'expense') {
          if (exps.length) {
            out.push('  💸 *Pengeluaran*');
            out.push(...exps);
          }
        }

        const sumInc = groups[d].income.reduce((s, x) => s + (x.amount || 0), 0);
        const sumExp = groups[d].expense.reduce((s, x) => s + (x.amount || 0), 0);

        if (typeFilter === 'income') {
          out.push(`  ── *Total pemasukan hari itu:* ${formatIDR(sumInc)}\n`);
        } else if (typeFilter === 'expense') {
          out.push(`  ── *Total pengeluaran hari itu:* ${formatIDR(sumExp)}\n`);
        } else {
          out.push(`  ── *Saldo hari itu:* ${formatIDR(sumInc - sumExp)}\n`);
        }
      }

      out.push(
        `📌 *Bantuan hapus:*\n` +
        `• Nomor di atas adalah *nomor global semua bulan*\n` +
        `• Ketik */hapus <nomor>* sesuai nomor di atas\n` +
        `• Contoh: */hapus 728*\n` +
        `• Ketik */hapusid <ID>* jika ingin hapus berdasarkan ID`
      );

      return sendInChunks(client, from, out.join('\n'));
    }
  }

  if (isCommand && text === 'dashboard') {
    const token = financeDashboard.generateDashboardToken(key);
    // Jika menggunakan domain via Cloudflare, kita pakai https dan hapus portnya
    let url = '';
    if (financeDashboard.HOST === 'drzein.my.id') {
      url = `https://${financeDashboard.HOST}/dashboard/${token}`;
    } else {
      url = `http://${financeDashboard.HOST}:${financeDashboard.PORT}/dashboard/${token}`;
    }
    
    return msg.reply(
      `📊 *FINANCE DASHBOARD*\n\n` +
      `Klik link berikut untuk membuka dashboard keuangan Anda:\n${url}\n\n` +
      `_Link ini unik, rahasia, dan akan kadaluarsa dalam 1 jam._`
    );
  }

  if (isCommand && text === 'kategori list') {
    const set = new Set(categories[key] || []);
    // tambahkan kategori yang ditemukan dari data bila store kosong
    const store = data[key] || {};
    Object.keys(store).forEach(mKey => {
      (store[mKey] || []).forEach(t => { if (t.category) set.add(t.category); });
    });

    if (!set.size) return msg.reply('Belum ada kategori. Tambahkan dengan menulis #NamaKategori di akhir deskripsi transaksi.');
    return msg.reply('📚 *Kategori Tersimpan*\n- ' + Array.from(set).sort().join('\n- '));
  }

  if (isCommand && text.startsWith('kategori tambah ')) {
    const name = text.replace(/^kategori tambah\s+/i, '').trim();
    if (!name) return msg.reply('Format: /kategori tambah <nama>');
    const c = addCategoryForChat(key, name);
    return msg.reply(`✅ Kategori ditambahkan: #${c}`);
  }

  if (isCommand && text === 'r kategori') {
    const store = (data[key] && data[key][monthKey]) || [];
    if (!store.length) return msg.reply(`Belum ada transaksi di bulan ${monthKey}.`);
    const agg = {};
    for (const t of store) {
      const cat = t.category || 'Tanpa Kategori';
      const sign = t.type === 'income' ? 1 : -1;
      agg[cat] = (agg[cat] || 0) + sign * (t.amount || 0);
    }
    const lines = Object.entries(agg)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([cat, val]) => `• ${cat}: ${formatIDR(val)}`);
    return msg.reply(`📊 *Rekap Per Kategori* (${monthKey})\n` + lines.join('\n'));
  }


  // /export → kirim file CSV ke chat (siap buka di Excel)
  if (isCommand && text.startsWith('export')) {
    const parts = text.split(/\s+/).filter(Boolean); // ['export', ...]
    let typeFilter = null; // 'income' | 'expense' | null
    let targetMonth = monthKey;

    if (parts.length >= 2) {
      if (parts[1] === 'masuk') typeFilter = 'income';
      else if (parts[1] === 'keluar') typeFilter = 'expense';
      else {
        const m = parseMonthArg(parts[1]);
        if (m) targetMonth = m;
        else return msg.reply('❌ Format salah. Contoh: /export 07-2025 | /export 2025-07 | /export masuk | /export keluar 07-2025');
      }
    }
    if (parts.length >= 3) {
      const m = parseMonthArg(parts[2]);
      if (m) targetMonth = m;
      else return msg.reply('❌ Format salah. Contoh: /export masuk 07-2025 | /export keluar 2025-07');
    }

    const items = (data[key] && data[key][targetMonth]) || [];
    if (items.length === 0) {
      return msg.reply(`❌ Belum ada data untuk bulan ${targetMonth}.`);
    }

    // Susun baris CSV: Date, Type, Description, Amount (urut terbaru → terlama)
    const rows = [['Date', 'Type', 'Description', 'Amount']];

    const sorted = items
      .filter(it => (typeFilter ? it.type === typeFilter : true))
      .map(it => {
        const dt = it?.date ? new Date(it.date) : null;
        // Untuk data lama tanpa tanggal: letakkan paling bawah
        const sortKey = dt ? dt.toISOString() : '0000-00-00T00:00:00.000Z';
        return { ...it, __sortKey: sortKey };
      })
      .sort((a, b) => b.__sortKey.localeCompare(a.__sortKey)); // terbaru → terlama

    for (const it of sorted) {
      const dateStr = it?.date
        ? new Date(it.date).toLocaleString('id-ID', {
          timeZone: APP_TIMEZONE,
          dateStyle: 'medium',
          timeStyle: 'short'
        })
        : '(tanpa tanggal)';
      const typeStr = it.type === 'income' ? 'Income' : 'Expense';
      rows.push([dateStr, typeStr, it.desc || '', it.amount ?? 0]);
    }

    const csv = rows.map(r => r.map(toCsvValue).join(',')).join('\n');

    // simpan file ke folder exports
    const exportsDir = path.join(process.cwd(), 'exports');
    ensureDirSync(exportsDir);
    const safeMonth = targetMonth.replace(/[^0-9-]/g, '');
    const filterTag = typeFilter ? `-${typeFilter}` : '';
    const baseName = `histori-${from.replace(/[@.]/g, '_')}-${safeMonth}${filterTag}.csv`;
    const filePath = path.join(exportsDir, baseName);
    fs.writeFileSync(filePath, csv, 'utf8');

    // kirim file ke chat
    const media = MessageMedia.fromFilePath(filePath);
    await safeSendMedia(client, from, media, {
      caption: `📤 Ekspor histori ${targetMonth}${typeFilter ? ` (${typeFilter})` : ''} — total ${rows.length - 1} baris.`
    });

    return; // selesai
  }

  // ==== CARI TRANSAKSI (lintas bulan) ====
  // /hapus cari <kata>
  if (isCommand && text.startsWith('hapus cari ')) {
    const keyword = text.replace('hapus cari ', '').trim().toLowerCase();
    const store = data[key] || {};
    const results = [];

    for (const mKey of Object.keys(store).sort()) {
      const arr = store[mKey] || [];
      // tampilkan dengan nomor lokal per bulan (index+1), label bulan
      arr.forEach((t, i) => {
        if ((t?.desc || '').toLowerCase().includes(keyword)) {
          results.push({
            monthKey: mKey,
            index: i + 1,
            type: t.type,
            desc: t.desc,
            amount: t.amount,
            id: t.id || null
          });
        }
      });
    }

    if (!results.length) {
      return msg.reply(`❌ Tidak ada transaksi dengan kata kunci: "${keyword}" di semua bulan.`);
    }

    // batasi kiriman agar tidak terlalu panjang
    const MAX = 60;
    let replyText = `🔍 Hasil pencarian: "${keyword}" (lintas bulan)\n\n`;
    results.slice(0, MAX).forEach(t => {
      const sign = t.type === 'income' ? '+' : '-';
      const idTag = t.id ? ` • #${String(t.id).toUpperCase()}` : '';
      replyText += `[${t.monthKey}] ${t.index}. ${sign} ${t.desc} — ${formatIDR(t.amount)}${idTag}\n`;
    });
    if (results.length > MAX) {
      replyText += `\n… dan ${results.length - MAX} hasil lainnya. Gunakan filter /h <bulan> untuk melihat rinciannya.`;
    }

    replyText += `\n\nTips hapus cepat: gunakan */hapusid <ID>* (unik lintas bulan).`;
    return msg.reply(replyText.trim());
  }


  // /hapus
  // dukung:
  // /hapus
  // /hapus 2
  // /hapus semua
  // /hapus 07-2025
  // /hapus bulan 07-2025
  if (isCommand && (text === 'hapus' || text.startsWith('hapus '))) {
    const parts = text.split(/\s+/).filter(Boolean); // ['hapus', ...]

    // /hapus  -> hapus semua bulan ini
    if (parts.length === 1) {
      const count = (data[key][monthKey] || []).length;
      if (count === 0) {
        return msg.reply('ℹ️ Tidak ada data bulan ini untuk dihapus.');
      }

      pendingConfirms[from] = {
        action: 'hapus_semua_transaksi_bulan_tertentu',
        created: Date.now(),
        payload: { key, monthKey, count }
      };

      return msg.reply(
        `⚠️ *Konfirmasi Hapus Semua Transaksi Bulan Ini*\n` +
        `Bulan: *${monthKey}*\n` +
        `Jumlah data: *${count}*\n\n` +
        `Ketik *ya* atau */ya* untuk melanjutkan, atau *batal* untuk membatalkan.`
      );
    }

    // /hapus semua  -> hapus semua bulan
    if (parts[1] === 'semua') {
      const summary = summarizeStore(key);

      if (summary.totalCount === 0) {
        return msg.reply('ℹ️ Tidak ada data transaksi untuk dihapus.');
      }

      pendingConfirms[from] = {
        action: 'hapus_semua_transaksi_semua_bulan',
        created: Date.now(),
        payload: {
          key,
          totalCount: summary.totalCount,
          totalMonths: summary.monthKeys.length
        }
      };

      return msg.reply(
        `⚠️ *Konfirmasi Hapus Semua Riwayat Transaksi*\n` +
        `Jumlah bulan: *${summary.monthKeys.length}*\n` +
        `Jumlah transaksi: *${summary.totalCount}*\n\n` +
        `Ketik *ya* atau */ya* untuk melanjutkan, atau *batal* untuk membatalkan.`
      );
    }

    // /hapus bulan 07-2025
    // /hapus bulan 2025-07
    let targetMonth = null;
    if (parts[1] === 'bulan' && parts[2]) {
      targetMonth = parseMonthArg(parts[2]);
      if (!targetMonth) {
        return msg.reply('❌ Format salah. Contoh: /hapus bulan 07-2025');
      }
    }

    // /hapus 07-2025
    if (!targetMonth) {
      const parsedMonth = parseMonthArg(parts[1]);
      if (parsedMonth) {
        targetMonth = parsedMonth;
      }
    }

    if (targetMonth) {
      const count = ((data[key] || {})[targetMonth] || []).length;

      if (count === 0) {
        return msg.reply(`ℹ️ Tidak ada data pada bulan *${targetMonth}* untuk dihapus.`);
      }

      pendingConfirms[from] = {
        action: 'hapus_semua_transaksi_bulan_tertentu',
        created: Date.now(),
        payload: { key, monthKey: targetMonth, count }
      };

      return msg.reply(
        `⚠️ *Konfirmasi Hapus Semua Transaksi Bulan Tertentu*\n` +
        `Bulan: *${targetMonth}*\n` +
        `Jumlah data: *${count}*\n\n` +
        `Ketik *ya* atau */ya* untuk melanjutkan, atau *batal* untuk membatalkan.`
      );
    }

    // /hapus 2  -> hapus nomor transaksi bulan ini
    const no = parseInt(parts[1], 10) - 1;
    if (isNaN(no) || no < 0) {
      return msg.reply(
        '❌ Format hapus tidak valid.\n\n' +
        'Contoh:\n' +
        '• /hapus\n' +
        '• /hapus 2\n' +
        '• /hapus semua\n' +
        '• /hapus 07-2025\n' +
        '• /hapus bulan 07-2025'
      );
    }

    const hit = findTxByGlobalNo(key, no + 1);

    if (!hit) {
      return msg.reply('❌ Nomor tidak ditemukan di semua riwayat transaksi.');
    }

    const { monthKey: targetMonthKey, index: targetIndex, item: it, globalNo } = hit;

    pendingConfirms[from] = {
      action: 'hapus_transaksi',
      created: Date.now(),
      payload: {
        key,
        monthKey: targetMonthKey,
        index: targetIndex,
        globalNo,
        id: it.id || null,
        type: it.type,
        desc: it.desc,
        amount: it.amount
      }
    };

    const jenis = it.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
    return msg.reply(
      `⚠️ *Konfirmasi Hapus Transaksi*\n` +
      `Nomor Global: *${globalNo}*\n` +
      `Bulan: *${targetMonthKey}*\n` +
      `Jenis: *${jenis}*\n` +
      `Deskripsi: ${it.desc}\n` +
      `Jumlah: ${formatIDR(it.amount)}\n\n` +
      `Ketik *ya* atau */ya* untuk melanjutkan, atau *batal* untuk membatalkan.`
    );
  }

  // ==== HAPUS BERDASARKAN ID (lintas bulan) ====
  // /hapusid <ID>
  if (isCommand && text.startsWith('hapusid ')) {
    const parts = text.split(/\s+/);
    const id = (parts[1] || '').trim().toUpperCase();
    if (!id) return msg.reply('❌ Format: /hapusid <ID>. Lihat ID di /h (contoh: [#K9F3QW]).');

    // 🔎 Cari ke SEMUA bulan
    const hit = findTxByIdAllMonths(key, id);
    if (!hit) {
      return msg.reply(`❌ ID ${id} tidak ditemukan di semua bulan.`);
    }

    const { monthKey: mKey, index: idx, item: it } = hit;

    // simpan niat konfirmasi lintas bulan
    pendingConfirms[from] = {
      action: 'hapus_transaksi',
      created: Date.now(),
      payload: { key, monthKey: mKey, index: idx, id, type: it.type, desc: it.desc, amount: it.amount }
    };

    const jenis = it.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
    return msg.reply(
      `⚠️ *Konfirmasi Hapus Transaksi (by ID)*\n` +
      `Bulan: *${mKey}*\n` +
      `ID: #${id}\n` +
      `Jenis: *${jenis}*\n` +
      `Deskripsi: ${it.desc}\n` +
      `Jumlah: ${formatIDR(it.amount)}\n\n` +
      `Ketik *ya* atau */ya* untuk melanjutkan, atau *batal* untuk membatalkan.`
    );
  }





  // ==== HAPUS TERBARU ====
  // /hapus terakhir
  if (isCommand && text === 'hapus terakhir') {
    const items = data[key][monthKey] || [];
    if (!items.length) return msg.reply('ℹ️ Tidak ada transaksi bulan ini.');
    const idx = items.length - 1;
    const it = items[idx];

    pendingConfirms[from] = {
      action: 'hapus_transaksi',
      created: Date.now(),
      payload: { key, monthKey, index: idx, id: it.id || null, type: it.type, desc: it.desc, amount: it.amount }
    };

    const jenis = it.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
    return msg.reply(
      `⚠️ *Konfirmasi Hapus Transaksi (terbaru)*\n` +
      `Nomor: *${idx + 1}* ${it.id ? `• ID: #${it.id}\n` : '\n'}` +
      `Jenis: *${jenis}*\n` +
      `Deskripsi: ${it.desc}\n` +
      `Jumlah: ${formatIDR(it.amount)}\n\n` +
      `Ketik *ya* atau */ya* untuk melanjutkan, atau *batal* untuk membatalkan.`
    );
  }



  // /saldo | /saldo bulanini | /saldo 07-2025 | /saldo 2025-07
  if (isCommand && text.startsWith('saldo')) {
    const parts = text.split(/\s+/).filter(Boolean); // ['saldo', ...]

    const store = data[key] || {};
    const monthKeys = Object.keys(store).sort();

    if (monthKeys.length === 0) {
      return msg.reply('❌ Belum ada data keuangan.');
    }

    // /saldo bulanini
    if (parts[1] === 'bulanini') {
      const items = store[monthKey] || [];
      const sum = summarizeItems(items);

      return msg.reply(
        `💰 *Saldo Bulan Ini* (${monthKey})\n` +
        `🧾 Jumlah transaksi: *${sum.count}*\n` +
        `📈 Pemasukan: *${formatIDR(sum.income)}*\n` +
        `📉 Pengeluaran: *${formatIDR(sum.expense)}*\n` +
        `🧮 Saldo: *${formatIDR(sum.saldo)}*\n\n` +
        `📌 *Bantuan cepat:*\n` +
        `• Ketik */h* untuk melihat riwayat transaksi bulan ini\n` +
        `• Ketik */hapus terakhir* untuk menghapus transaksi terbaru\n` +
        `• Ketik */hapus <nomor>* untuk menghapus transaksi dari daftar */h*`
      );
    }

    // /saldo 07-2025 atau /saldo 2025-07
    if (parts[1]) {
      const parsedMonth = parseMonthArg(parts[1]);
      if (!parsedMonth) {
        return msg.reply(
          '❌ Format salah.\n' +
          'Contoh:\n' +
          '• /saldo\n' +
          '• /saldo bulanini\n' +
          '• /saldo 07-2025\n' +
          '• /saldo 2025-07'
        );
      }

      const items = store[parsedMonth] || [];
      const sum = summarizeItems(items);

      if (!items.length) {
        return msg.reply(`❌ Belum ada data untuk bulan ${parsedMonth}.`);
      }

      return msg.reply(
        `💰 *Saldo Bulan ${parsedMonth}*\n` +
        `🧾 Jumlah transaksi: *${sum.count}*\n` +
        `📈 Pemasukan: *${formatIDR(sum.income)}*\n` +
        `📉 Pengeluaran: *${formatIDR(sum.expense)}*\n` +
        `🧮 Saldo: *${formatIDR(sum.saldo)}*\n\n` +
        `📌 *Bantuan cepat:*\n` +
        `• Ketik */h ${parsedMonth}* untuk melihat riwayat bulan ini\n` +
        `• Ketik */hapus ${parsedMonth.split('-').reverse().join('-')}* untuk menghapus semua transaksi bulan ini\n` +
        `• Ketik */hapusid <ID>* untuk menghapus transaksi tertentu berdasarkan ID`
      );
    }

    // default: /saldo = semua bulan
    const summary = summarizeStore(key);

    const lines = summary.perMonth.map(m =>
      `• ${m.monthKey} → ${m.count} trx | +${formatIDR(m.income)} | -${formatIDR(m.expense)} | saldo ${formatIDR(m.saldo)}`
    );

    const periodText =
      summary.firstDate && summary.lastDate
        ? `${summary.firstDate.toLocaleDateString('id-ID', { timeZone: APP_TIMEZONE })} s/d ${summary.lastDate.toLocaleDateString('id-ID', { timeZone: APP_TIMEZONE })}`
        : '-';

    return msg.reply(
      `💰 *Ringkasan Keuangan Keseluruhan*\n` +
      `📦 Total bulan tercatat: *${summary.monthKeys.length}*\n` +
      `🧾 Total transaksi: *${summary.totalCount}*\n` +
      `📅 Periode data: *${periodText}*\n\n` +
      `📈 Total pemasukan: *${formatIDR(summary.totalIncome)}*\n` +
      `📉 Total pengeluaran: *${formatIDR(summary.totalExpense)}*\n` +
      `🧮 Saldo akhir: *${formatIDR(summary.totalSaldo)}*\n\n` +
      `📚 *Rincian per bulan:*\n` +
      lines.join('\n') +
      `\n\n` +
      `📌 *Bantuan cepat:*\n` +
      `• Ketik */h* untuk melihat riwayat transaksi bulan ini\n` +
      `• Ketik */h 07-2025* untuk melihat riwayat bulan tertentu\n` +
      `• Ketik */hapus terakhir* untuk menghapus transaksi terbaru\n` +
      `• Ketik */hapus <nomor>* untuk menghapus transaksi dari daftar */h*\n` +
      `• Ketik */hapusid <ID>* untuk menghapus transaksi berdasarkan ID\n` +
      `• Ketik */menu1* untuk melihat panduan keuangan lengkap`
    );
  }

  // /cari <kata>
  if (isCommand && text.startsWith('cari ')) {
    const keyword = msg.body.replace(/^\/cari\s+/i, '').trim();

    if (!keyword) {
      return msg.reply(
        '🔎 *Format pencarian:*\n' +
        '/cari <kata>\n\n' +
        'Contoh:\n' +
        '• /cari ayam\n' +
        '• /cari pulsa\n' +
        '• /cari gaji'
      );
    }

    const found = searchTransactionsAllMonths(key, keyword);

    if (!found.length) {
      return msg.reply(`❌ Tidak ditemukan transaksi dengan kata kunci *"${keyword}"*.`);
    }

    let totalIncome = 0;
    let totalExpense = 0;

    const lines = found.slice(0, 20).map((row, i) => {
      const it = row.item || {};
      const type = it.type === 'income' ? '📈 Masuk' : '📉 Keluar';
      const amount = Number(it.amount || 0);

      if (it.type === 'income') totalIncome += amount;
      else if (it.type === 'expense') totalExpense += amount;

      const dateText = it.date
        ? new Date(it.date).toLocaleString('id-ID', {
          timeZone: APP_TIMEZONE,
          dateStyle: 'medium',
          timeStyle: 'short'
        })
        : '-';

      return (
        `${i + 1}. ${type} — *${it.desc || '-'}*\n` +
        `💰 ${formatIDR(amount)}\n` +
        `📅 ${dateText}\n` +
        `🗂️ Bulan: ${row.monthKey}\n` +
        `🆔 ID: ${it.id || '-'}`
      );
    });

    // hitung total semua hasil, bukan cuma 20 teratas
    totalIncome = 0;
    totalExpense = 0;
    for (const row of found) {
      const it = row.item || {};
      const amount = Number(it.amount || 0);
      if (it.type === 'income') totalIncome += amount;
      else if (it.type === 'expense') totalExpense += amount;
    }

    const moreText =
      found.length > 20
        ? `\n\nMenampilkan 20 dari ${found.length} hasil.`
        : '';

    return sendInChunks(
      client,
      from,
      `🔎 *Hasil Pencarian: "${keyword}"*\n` +
      `📦 Total ditemukan: *${found.length} transaksi*\n` +
      `📈 Total pemasukan terkait: *${formatIDR(totalIncome)}*\n` +
      `📉 Total pengeluaran terkait: *${formatIDR(totalExpense)}*\n\n` +
      lines.join('\n\n') +
      moreText
    );
  }

  // /ingatkan on|off — KHUSUS DM
  if (isCommand && text.startsWith('ingatkan')) {
    if (!from.endsWith('@c.us')) {
      return msg.reply('❌ Pengingat hanya bisa di *chat pribadi (DM)*.');
    }

    const sub = (text.split(/\s+/)[1] || 'on').toLowerCase();

    if (sub === 'off') {
      const before = subs.length;
      subs = (subs || []).filter(j => j !== from); // ← cukup satu filter
      saveSubs();
      return msg.reply(before !== subs.length
        ? '🔕 Pengingat keuangan *dimatikan* untuk DM ini.'
        : 'ℹ️ DM ini belum terdaftar di pengingat.');
    }

    // default: on
    if (from.endsWith('@c.us') && !subs.includes(from)) {
      subs.push(from);
      subs = [...new Set(subs.map(canonicalJid))].filter(j => j && j.endsWith('@c.us'));
      saveSubs();
    }
    return msg.reply('🔔 Pengingat keuangan *aktif*.\nJadwal: *20:00* (WIB).');
  }




  // /tugas <deskripsi + waktu>
  if (isCommand && text.startsWith('tugas')) {
    return tugasCmd.handleTugasCommand({
      msg,
      from,
      text,
      sender: senderJid,
      tasks,
      pendingTugas,
      parseNaturalDatetime,
      parseSeparatedTugas,
      normalizeJid,
      jidToLocal08
    });
  }

  if (isCommand && (text === "dt" || text === "daftar")) {
    return tugasCmd.handleDaftarTugas({
      msg,
      tasks,
      from,
      sender: senderJid,
      jidToLocal08
    });
  }

  // ==== HAPUS DAFTAR TUGAS DENGAN KONFIRMASI ====

  // /hapus_tugas [chat|pribadi|semua]
  if (isCommand && text.startsWith('hapus_tugas')) {
    return tugasCmd.handleHapusTugas({
      msg,
      text,
      tasks,
      from,
      sender: senderJid,
      pendingConfirms,
      saveTasks
    });
  }



  // /ya → jalankan aksi yang menunggu konfirmasi
  // /ya atau ya → jalankan aksi yang menunggu konfirmasi
  if (isYaConfirm) {
    const sender = senderJid;

    // 1) prioritas: konfirmasi tugas
    const tugasYa = await tugasCmd.handleYaForTugas({
      msg,
      from,
      sender,
      tasks,
      saveTasks,
      pendingTugas,
      pendingConfirms
    });

    if (tugasYa.handled) {
      return msg.reply(tugasYa.reply);
    }

    // 2) konfirmasi broadcast teks
    if (pendingBroadcast[senderJid]) {
      const entry = pendingBroadcast[senderJid];

      // kedaluwarsa 5 menit
      if (Date.now() - entry.created > 5 * 60 * 1000) {
        delete pendingBroadcast[senderJid];
        return msg.reply('⌛ Konfirmasi broadcast kedaluwarsa. Jalankan /bc lagi.');
      }

      delete pendingBroadcast[senderJid];

      await msg.reply(`📢 Broadcast dimulai ke ${entry.targets.length} target...`);

      const result = await broadcastText({
        client,
        targets: entry.targets,
        text: entry.message
      });

      if (result.stopped) {
        return msg.reply(
          `⚠️ Broadcast dihentikan.\n` +
          `Alasan: ${result.reason}\n` +
          `Berhasil: ${result.ok}\n` +
          `Gagal: ${result.fail}\n` +
          `Total target: ${result.total}`
        );
      }

      return msg.reply(
        `✅ Broadcast selesai.\n` +
        `Berhasil: ${result.ok}\n` +
        `Gagal: ${result.fail}\n` +
        `Total target: ${result.total}`
      );
    }

    // 3) konfirmasi lain via pendingConfirms
    const pending = pendingConfirms[from];
    if (!pending) return msg.reply('ℹ️ Tidak ada proses yang perlu dikonfirmasi.');

    if (Date.now() - pending.created > 5 * 60 * 1000) {
      delete pendingConfirms[from];
      return msg.reply('⌛ Konfirmasi kedaluwarsa. Jalankan perintahnya lagi.');
    }

    if (pending.action === 'hapus_transaksi') {
      const { key: k, monthKey: m, index, id, type, desc, amount } = pending.payload;
      const items = (data[k] && data[k][m]) || [];
      const cur = items[index];

      if (!cur) {
        delete pendingConfirms[from];
        return msg.reply('❌ Data sudah berubah. Coba perintahnya lagi.');
      }

      if (id && (String(cur.id).toUpperCase() !== String(id).toUpperCase())) {
        delete pendingConfirms[from];
        return msg.reply('❌ ID tidak cocok. Coba perintahnya lagi.');
      }

      if (cur.type !== type || cur.desc !== desc || Number(cur.amount) !== Number(amount)) {
        delete pendingConfirms[from];
        return msg.reply('❌ Data sudah berubah. Coba perintahnya lagi.');
      }

      const removed = items.splice(index, 1)[0];
      saveData();
      delete pendingConfirms[from];
      return msg.reply(`🗑️ Dihapus: ${removed.type === 'income' ? '+' : '-'} ${removed.desc} ${formatIDR(removed.amount)}`);

    } else if (pending.action === 'hapus_semua_transaksi_bulan_tertentu') {
      const { key: k, monthKey: m, count } = pending.payload;

      data[k] = data[k] || {};
      data[k][m] = [];
      saveData();
      delete pendingConfirms[from];

      return msg.reply(`🧹 Semua data bulan *${m}* (${count} item) telah dihapus.`);

    } else if (pending.action === 'hapus_semua_transaksi_semua_bulan') {
      const { key: k, totalCount, totalMonths } = pending.payload;

      data[k] = {};
      saveData();
      delete pendingConfirms[from];

      return msg.reply(
        `🧹 Semua riwayat transaksi berhasil dihapus.\n` +
        `📦 Bulan terhapus: *${totalMonths}*\n` +
        `🧾 Total transaksi terhapus: *${totalCount}*`
      );
    }

    delete pendingConfirms[from];
    return msg.reply('ℹ️ Tidak ada aksi yang cocok untuk dikonfirmasi.');
  }



  // /ai → Gemini utama, OpenRouter fallback
  if (isCommand && (text === 'ai' || text.startsWith('ai '))) {
    const prompt = (msg.body || '').replace(/^\/ai\b/i, '').trim();

    return handleAICommand({
      msg,
      client,
      from,
      prompt,
      sendInChunks
    });
  }
  /*
  // /img → generate image via OpenRouter
  if (isCommand && (text === 'img' || text.startsWith('img '))) {
    const prompt = (msg.body || '').replace(/^\/img\b/i, '').trim();
  
    return handleImageCommand({
      msg,
      prompt
    });
  }
  */

  /*
  if (isCommand && (text === 'imgedit' || text.startsWith('imgedit '))) {
    return handleImageEditCommand(msg);
  }
  */

  // ======== COMMAND SIMI ========
  if (isGroupMessage(msg) && isCommand && text.startsWith('simi')) {
    const chatId = msg.from;
    const cfg = getSimiCfg(chatId);
    const args = text.split(/\s+/); // ['simi', 'on'|'off'|'status'|'chance' ...]
    const sub = (args[1] || '').toLowerCase();

    if (sub === 'on') {
      cfg.enabled = true; saveSimi();
      return msg.reply(`✅ Simi diaktifkan di grup ini.\nChance: ${cfg.chance}% • Cooldown: ${cfg.cooldownSec}s • Mention: ${cfg.allowMention ? 'on' : 'off'}`);
    }
    if (sub === 'off') {
      cfg.enabled = false; saveSimi();
      return msg.reply(`🛑 Simi dimatikan di grup ini.`);
    }
    if (sub === 'status') {
      return msg.reply(
        `📟 *Status Simi*\n` +
        `Aktif: ${cfg.enabled ? 'ya' : 'tidak'}\n` +
        `Chance: ${cfg.chance}%\n` +
        `Cooldown: ${cfg.cooldownSec}s\n` +
        `Mention auto-reply: ${cfg.allowMention ? 'on' : 'off'}`
      );
    }
    if (sub === 'chance') {
      const n = parseInt(args[2], 10);
      if (isNaN(n) || n < 0 || n > 100) return msg.reply('❌ Masukkan angka 0–100. Contoh: /simi chance 35');
      cfg.chance = n; saveSimi();
      return msg.reply(`✅ Chance di-set ke ${cfg.chance}%`);
    }
    if (sub === 'cooldown') {
      const n = parseInt(args[2], 10);
      if (isNaN(n) || n < 0 || n > 3600) return msg.reply('❌ Masukkan detik 0–3600. Contoh: /simi cooldown 20');
      cfg.cooldownSec = n; saveSimi();
      return msg.reply(`✅ Cooldown di-set ke ${cfg.cooldownSec}s`);
    }
    if (sub === 'mention') {
      const v = (args[2] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) return msg.reply('❌ Gunakan: /simi mention on | /simi mention off');
      cfg.allowMention = (v === 'on'); saveSimi();
      return msg.reply(`✅ Mention auto-reply: ${cfg.allowMention ? 'on' : 'off'}`);
    }

    return msg.reply(
      '🗣️ Mode Simi\n' +
      '• /simi on | off | status\n' +
      '• /simi chance 40\n' +
      '• /simi cooldown 15\n' +
      '• /simi mention on|off'
    );
  }

  // ======== AUTO-REPLY SIMI (GRUP) ========
  if (isGroupMessage(msg) && !msg.fromMe) {
    const chatId = msg.from;
    const cfg = getSimiCfg(chatId);

    if (cfg.enabled) {
      // jangan balas command, pesan sistem, atau media doang
      const rawBody = msg.body || '';
      const isCmdLike = rawBody.trim().startsWith('/');
      if (!isCmdLike && !msg.hasMedia) {

        // cek mention: kalau bot di-mention & allowMention = true → balas pasti
        let mentionedBot = false;
        try {
          const me = client.info?.wid?._serialized;
          if (me && Array.isArray(msg.mentionedIds)) {
            mentionedBot = msg.mentionedIds.includes(me);
          }
        } catch (e) { }

        // cooldown
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec - (cfg.lastReplyAt || 0) >= cfg.cooldownSec) {
          const shouldReply = mentionedBot && cfg.allowMention
            ? true
            : (Math.random() * 100 < cfg.chance);

          if (shouldReply) {
            let senderName = '';
            try {
              const contact = await msg.getContact();
              senderName = contact?.pushname || contact?.name || contact?.number || '';
            } catch (e) { }

            let quotedText = '';

            try {
              if (msg.hasQuotedMsg) {
                const quoted = await msg.getQuotedMessage();
                quotedText = quoted?.body || '';
              }
            } catch (_) { }

            const reply = await genSimiReplySmart({
              text: rawBody,
              sender: senderName,
              chatId,
              mentionedBot,
              quotedText
            });

            if (reply) {
              cfg.lastReplyAt = nowSec;
              saveSimi();

              await safeSendMessage(client, chatId, reply, {
                quotedMessageId: msg.id._serialized
              });
            }
          }
        }
      }
    }
  }

  // /ping (mention semua anggota grup)
  if (isCommand && text.startsWith('ping') && isGroupMessage(msg)) {
    const chat = await msg.getChat();
    const isiPesan = msg.body.slice(5).trim() || 'Halo semuanya!';
    if (!chat.participants || chat.participants.length === 0) {
      return msg.reply('⚠️ Gagal mengambil anggota grup. Pastikan bot adalah admin.');
    }
    let mentionList = [];
    let mentionText = `📢 *Pesan dari @${getSenderId(msg).replace(/@.+/, '')}*:\n\n${isiPesan}\n\n`;
    for (let participant of chat.participants) {
      if (participant.id._serialized !== msg.from) {
        mentionList.push(participant.id._serialized);
        mentionText += `@${participant.id.user} `;
      }
    }
    await safeSendMessage(client, msg.from, mentionText, { mentions: mentionList });
  }

  // call sticker
  if (isCommand && (text === 'sticker' || text.startsWith('sticker '))) {
    return handleStickerCommand(msg);
  }

  /*
  if (await handlePendingImageEdit(msg)) {
    return;
  }
  
  */
  if (pendingSticker[from]) {
    dedup.mark(msg);
  }

  if (await handlePendingSticker(msg)) {
    return;
  }


  if (isCommand && text.startsWith('stickerstyle')) {
    return handleStickerStyleCommand(msg);
  }

  // ========== UNO COMMANDS (GROUP ONLY) ==========
  if (isGroupMessage(msg) && isCommand && text.startsWith('uno')) {
    const chatId = msg.from;
    const game = getGame(chatId);
    const parts = text.split(/\s+/); // ['uno', ...]
    const sub = (parts[1] || '').toLowerCase();

    // helper quick
    const contact = await msg.getContact().catch(() => null);
    const displayName = contact?.pushname || contact?.name || contact?.number || '';
    const userId = contact?.id?._serialized || msg.author || msg.from;

    async function announceState() {
      const top = game.discardPile[game.discardPile.length - 1];
      const cur = game.players[game.turnIndex];
      const counts = game.players.map(p => `${p.name.split(' ')[0]}(${p.hand.length})`).join(' • ');
      return msg.reply(
        `🃏 UNO — Giliran: *${cur?.name || '-'}*\n` +
        `Kartu atas: ${cardToText(top)}  (${game.currentColor ? COLOR_EMO[game.currentColor] : '∅'})\n` +
        `Arah: ${game.direction === 1 ? '➡️' : '⬅️'}  • Pending draw: ${game.pendingDraw}\n` +
        `Pemain: ${counts}`
      );
    }

    // /uno help
    if (sub === 'help' || parts.length === 1) {
      return msg.reply(
        `🎲 *UNO - Bantuan Singkat*
- /uno start → buka lobby (grup), /uno join → gabung, /uno begin → mulai
- /uno hand → kirim kartu ke DM
- /uno play <kode> [warna] (contoh: R5, G+2, W biru, W4 merah)
- /uno draw → ambil 1 kartu, /uno pass → lewati giliran (setelah draw)
- /uno top → lihat kartu atas, /uno status → urutan & sisa kartu
- /uno leave → keluar, /uno end → akhiri game (admin)

Aturan ringkas:
• Cocokkan warna *atau* angka/simbol. W/W4 bisa kapan saja.
• D2: pemain berikutnya ambil 2 & skip. W4: ambil 4 & pilih warna.
• Reverse membalik arah (2 pemain = efeknya mirip skip).
• v1: *tanpa stacking* draw (yang kena D2/W4 wajib ambil, tidak bisa balas).`
      );
    }

    // /uno start
    if (sub === 'start') {
      if (game.started || game.lobbyOpen) return msg.reply('⚠️ Masih ada game/lobby aktif. Selesaikan dulu dengan /uno end.');
      game.lobbyOpen = true;
      game.started = false;
      game.ownerId = userId;
      game.players = [];
      saveUno();
      return msg.reply('✅ Lobby UNO dibuka! Ketik */uno join* untuk gabung. Owner bisa mulai dengan */uno begin*.');
    }

    // /uno join
    if (sub === 'join') {
      if (!game.lobbyOpen) return msg.reply('❌ Lobby belum dibuka. Ketik */uno start* dulu.');
      if (game.players.find(p => isSameId(p.id, userId))) return msg.reply('ℹ️ Kamu sudah ada di lobby.');
      game.players.push({ id: userId, name: displayName, hand: [] });
      saveUno();
      return msg.reply(`✅ ${displayName} bergabung ke lobby. Total pemain: ${game.players.length}`);
    }

    // /uno begin
    if (sub === 'begin') {
      if (!game.lobbyOpen) return msg.reply('❌ Lobby belum ada. /uno start dulu.');
      if (game.started) return msg.reply('ℹ️ Game sudah berjalan.');
      if (game.players.length < 2) return msg.reply('❌ Minimal 2 pemain untuk mulai.');
      // hanya owner atau admin grup
      const chat = await msg.getChat();
      const isAdmin = chat?.isGroup && chat.participants?.some(m => m.id._serialized === userId && m.isAdmin);
      if (!isSameId(game.ownerId, userId) && !isAdmin) return msg.reply('⚠️ Hanya owner lobby atau admin yang bisa mulai.');
      game.lobbyOpen = false;
      game.started = true;

      dealAndStart(game);
      saveUno();

      // kirim kartu ke DM masing-masing
      for (const p of game.players) {
        try {
          await safeSendMessage(client, p.id, `🃏 Kartu kamu:\n${handToLines(p.hand)}`);
        } catch (e) {
          // fallback info di grup
          await msg.reply(`⚠️ Gagal DM ${p.name}. Minta dia chat bot dulu agar bisa menerima DM.`);
        }
      }

      await msg.reply('🚀 Game dimulai! Aku DM kartu kalian. Gunakan */uno hand* kalau belum menerima.');
      return announceState();
    }

    // /uno hand
    if (sub === 'hand') {
      if (!game.started) return msg.reply('❌ Game belum mulai.');
      const p = findPlayer(game, userId);
      if (!p) return msg.reply('❌ Kamu bukan pemain di game ini.');
      try {
        await safeSendMessage(client, p.id, `🃏 Kartu kamu:\n${handToLines(p.hand)}`);
        return msg.reply('✅ Kartu dikirim ke DM kamu.');
      } catch (e) {
        return msg.reply('⚠️ Gagal DM. Chat bot dulu secara pribadi, lalu ulangi /uno hand.');
      }
    }

    // guard: harus game aktif untuk command berikut
    if (!game.started) {
      return msg.reply('ℹ️ Game belum aktif. /uno start → /uno join → /uno begin');
    }

    // pastikan yang main adalah pemain terdaftar
    const me = findPlayer(game, userId);
    if (!me) return msg.reply('❌ Kamu bukan pemain di game ini.');

    // siapa giliran
    const current = game.players[game.turnIndex];
    const myTurn = isSameId(current?.id, userId);

    // /uno top
    if (sub === 'top') {
      const top = game.discardPile[game.discardPile.length - 1];
      return msg.reply(`Kartu atas: ${cardToText(top)}  (warna aktif: ${game.currentColor ? COLOR_EMO[game.currentColor] : '∅'})`);
    }

    // /uno status
    if (sub === 'status') {
      return announceState();
    }

    // /uno leave
    if (sub === 'leave') {
      const idx = game.players.findIndex(p => isSameId(p.id, userId));
      if (idx < 0) return msg.reply('❌ Kamu tidak sedang bermain.');
      // jika pemain keluar saat gilirannya, geser turn ke pemain berikut
      const leavingWasTurn = (idx === game.turnIndex);
      game.players.splice(idx, 1);
      if (game.players.length < 2) {
        game.started = false; game.lobbyOpen = false;
        saveUno();
        return msg.reply('🛑 Pemain tersisa <2. Game berakhir.');
      }
      if (leavingWasTurn) {
        if (idx <= game.turnIndex) game.turnIndex = (game.turnIndex - 1 + game.players.length) % game.players.length;
        game.turnIndex = nextIndex(game, 1);
        game.drewThisTurn = false;
      }
      saveUno();
      return msg.reply(`👋 ${displayName} keluar dari game. Pemain tersisa: ${game.players.length}`);
    }

    // /uno end (admin)
    if (sub === 'end') {
      const chat = await msg.getChat();
      const isAdmin = chat?.participants?.some(m => m.id._serialized === userId && m.isAdmin);
      if (!isAdmin && !isSameId(game.ownerId, userId)) return msg.reply('❌ Hanya admin / owner yang bisa mengakhiri game.');
      uno[chatId] = undefined; delete uno[chatId]; saveUno();
      return msg.reply('🛑 Game UNO di grup ini diakhiri.');
    }

    // ========== AKSI GILIRAN ==========
    // /uno draw
    if (sub === 'draw') {
      if (!myTurn) return msg.reply('⛔ Bukan giliran kamu.');
      // jika ada pendingDraw (kena D2/W4), pemain *wajib* ambil semuanya
      if (game.pendingDraw > 0) {
        const take = game.pendingDraw;
        for (let i = 0; i < take; i++) {
          me.hand.push(drawOne(game));
        }
        game.pendingDraw = 0;
        game.turnIndex = nextIndex(game, 1);
        game.drewThisTurn = false;
        saveUno();
        await msg.reply(`📥 Kamu terpaksa ambil ${take} kartu penalti. Giliran berpindah.`);
        return announceState();
      }

      // normal draw 1x
      me.hand.push(drawOne(game));
      game.drewThisTurn = true;
      saveUno();
      try {
        await safeSendMessage(client, me.id, `📥 Kamu mengambil 1 kartu.\n${handToLines(me.hand)}`);
      } catch (e) { }
      return msg.reply('📥 Kamu ambil 1 kartu. Mainkan dengan */uno play <kode>* atau */uno pass*.');
    }

    // /uno pass
    if (sub === 'pass') {
      if (!myTurn) return msg.reply('⛔ Bukan giliran kamu.');
      if (!game.drewThisTurn) return msg.reply('⚠️ Kamu harus /uno draw dulu sebelum pass.');
      // end turn
      game.turnIndex = nextIndex(game, 1);
      game.drewThisTurn = false;
      saveUno();
      await msg.reply('➡️ Giliran diteruskan.');
      return announceState();
    }

    // /uno play <kode> [warna]
    if (sub === 'play') {
      if (!myTurn) return msg.reply('⛔ Bukan giliran kamu.');
      const code = (parts[2] || '').toUpperCase().replace('+2', 'D2');
      if (!code) return msg.reply('❌ Format: /uno play <kode> [warna]  contoh: R5 | G+2 | W biru | W4 merah');

      // jika ada pendingDraw, tidak boleh main apa pun (v1 tanpa stacking)
      if (game.pendingDraw > 0) return msg.reply('⚠️ Kamu kena penalti draw. /uno draw dulu ya.');

      const card = removeFromHandByCode(me, code);
      if (!card) {
        return msg.reply('❌ Kartumu tidak punya kode itu. Cek DM dengan */uno hand*.');
      }

      // untuk Wild/W4: izinkan pilih warna di argumen
      let chosenColor = null;
      if (card.value === 'W' || card.value === 'W4') {
        chosenColor = parseColorWord(parts[3]);
        if (!chosenColor) {
          return msg.reply('🎨 Pilih warna setelah Wild: /uno play W merah  (merah/hijau/biru/kuning)');
        }
      }

      // cek boleh main
      if (!(card.value === 'W' || card.value === 'W4') && !canPlay(game, card)) {
        // balikin kartu
        me.hand.push(card);
        return msg.reply('❌ Kartu itu tidak cocok dengan warna/angka saat ini.');
      }

      // taruh ke discard
      game.discardPile.push(card);

      // set warna aktif
      if (card.value === 'W' || card.value === 'W4') {
        game.currentColor = chosenColor;
      } else {
        game.currentColor = card.color;
      }

      // efek aksi
      let advance = 1;
      if (card.value === 'R') {
        if (game.players.length === 2) {
          // reverse pada 2 pemain ⇒ mirip skip
          advance = 2;
        } else {
          game.direction *= -1;
        }
      } else if (card.value === 'S') {
        advance = 2; // skip satu pemain
      } else if (card.value === 'D2') {
        const victim = nextIndex(game, 1);
        for (let i = 0; i < 2; i++) { game.players[victim].hand.push(drawOne(game)); }
        advance = 2;
      } else if (card.value === 'W4') {
        const victim = nextIndex(game, 1);
        for (let i = 0; i < 4; i++) { game.players[victim].hand.push(drawOne(game)); }
        advance = 2;
      }

      // menang?
      if (me.hand.length === 0) {
        saveUno();
        await msg.reply(`🏆 ${me.name} menang! Game selesai.`);
        uno[chatId] = undefined; delete uno[chatId]; saveUno();
        return;
      }

      // UNO warning (opsional): saat sisa 1
      if (me.hand.length === 1) {
        await msg.reply(`🔔 *UNO!* ${me.name} sisa 1 kartu!`);
      }

      // lanjut giliran
      game.turnIndex = nextIndex(game, advance);
      game.drewThisTurn = false;
      saveUno();
      await msg.reply(`✅ ${me.name} memainkan ${cardToText(card)} ${game.currentColor ? `| warna: ${COLOR_EMO[game.currentColor]}` : ''}`);
      return announceState();
    }

    // fallback unknown subcommand
    return msg.reply('Ketik */uno help* untuk bantuan UNO.');
  }


  // === FALLBACK KHUSUS PRIVATE CHAT (ramah user + anti spam) ===
  try {
    const chat = await msg.getChat();
    const isGroup = chat?.isGroup === true;

    if (!isGroup && !isCommand && !msg.fromMe) {
      const body = (msg.body || '').trim();
      const bodyLower = body.toLowerCase();
      const nowTs = Date.now();

      // anti spam: maksimal 1 fallback per 2 menit per user
      if (lastFallbackAt[from] && (nowTs - lastFallbackAt[from] < 10 * 60 * 1000)) {
        return;
      }

      // 1) Kalau user kirim media
      if (msg.hasMedia) {
        lastFallbackAt[from] = nowTs;
        await msg.reply(
          '📷 Kalau mau bikin stiker, ketik */sticker* dulu lalu kirim fotonya/videonya ya.'
        );
        return;
      }

      // 2) Kalau user menyebut sticker/stiker
      if (/(stiker|sticker|bikin sticker|buat sticker|jadi sticker)/i.test(bodyLower)) {
        lastFallbackAt[from] = nowTs;
        await msg.reply(
          '🖼️ Untuk bikin stiker, ketik */sticker* lalu kirim fotonya/videonya ya.'
        );
        return;
      }

      // 3) Kalau user tanya menu / bantuan
      if (/(menu|bantuan|help|fitur|perintah|command|cara pakai)/i.test(bodyLower)) {
        lastFallbackAt[from] = nowTs;
        await msg.reply(
          '📖 Ketik */menu* untuk lihat daftar fitur yang tersedia.\n' +
          'Kalau butuh bantuan owner, ketik */help*.'
        );
        return;
      }

      // 4) Sapaan / chat pertama: kirim intro lengkap SEKALI
      if (!dmIntroSent[from]) {
        dmIntroSent[from] = true;
        lastFallbackAt[from] = nowTs;

        await msg.reply(
          `Halo 👋\n\n` +
          `Aku *Dr. Zein*, asisten WhatsApp buatan *Fauzan Akmal*.\n\n` +
          `Aku bisa bantu:\n` +
          `• 💰 Catat keuangan\n` +
          `• 📝 Tugas & pengingat\n` +
          `• 🖼️ Bikin stiker\n` +
          `• 🤖 Chat AI\n\n` +
          `Coba salah satu:\n` +
          `• */menu*\n` +
          `• */sticker*\n` +
          `• */saldo*\n` +
          `• */tugas belajar besok jam 7*`
        );
        return;
      }

      // 5) Fallback singkat untuk pesan random
      lastFallbackAt[from] = nowTs;
      await msg.reply(
        `Ketik */menu* untuk lihat fitur yang tersedia ya.`
      );
      return;
    }
  } catch (_) { /* ignore */ }





});






client.on('change_state', s => console.log('🔄 state:', s));
client.on('loading_screen', (p, msg) => console.log('[LOADING]', p, msg));
client.on('qr', () => console.log('[QR]'));
client.on('authenticated', () => console.log('[AUTH]'));
client.on('auth_failure', m => console.log('[AUTH_FAIL]', m));


client.initialize();

// Graceful shutdown untuk memastikan Chromium tertutup dengan benar
async function gracefulShutdown(signal) {
  console.log(`[BOTWA] Menerima ${signal}, mematikan client whatsapp...`);
  try {
    await client.destroy();
  } catch (e) {
    console.error(`[BOTWA] Error saat mematikan client:`, e);
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
