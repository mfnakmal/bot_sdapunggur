require('dotenv').config();
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const { restoreFilesFromGithub } = require('./backup/githubSync');
const { Telegraf } = require('telegraf');

// Konfigurasi Token & Owner dari .env
const tgToken = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
const ownerId = process.env.TELEGRAM_OWNER_ID;

let childBot = null;
let logsBuffer = []; // Menampung log real-time internal bot

// ========================================================
// FUNGSI MENJALANKAN BOT WA (CHILD PROCESS)
// ========================================================
function startBotWa() {
  if (childBot) {
    console.log('[INDEX] Mematikan instans botwa.js yang lama...');
    childBot.kill();
  }

  const botPath = path.join(__dirname, 'botwa.js');
  console.log('[INDEX] Menjalankan botwa.js...');

  childBot = spawn(process.execPath, [botPath], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: __dirname,
    env: { ...process.env, BYPASS_STARTUP_SYNC: 'true' }
  });

  childBot.stdout.on('data', (data) => {
    process.stdout.write(data);
    logsBuffer.push(data.toString());
    if (logsBuffer.length > 25) logsBuffer.shift();
  });

  childBot.stderr.on('data', (data) => {
    process.stderr.write(data);
    logsBuffer.push(`[ERR] ${data.toString()}`);
    if (logsBuffer.length > 25) logsBuffer.shift();
  });

  childBot.on('exit', (code) => {
    console.log(`[INDEX] botwa.js exit dengan code ${code}`);
  });

  childBot.on('error', (err) => {
    console.error('[INDEX] gagal menjalankan botwa.js:', err?.message || err);
  });
}

// ========================================================
// INTERFACE CONTROLLER TELEGRAM (Versi Telegraf)
// ========================================================
if (tgToken) {
  const bot = new Telegraf(tgToken);
  console.log('[INDEX] Telegram Controller Bot (Telegraf) Berhasil Standby!');

  const mainKeyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '🔄 Restart Bot' }, { text: '📊 Status PM2' }],
        [{ text: '📋 Lihat Log Internal' }, { text: '📑 Log PM2' }],
        [{ text: '⬇️ Sync GitHub Manual' }, { text: '🧟 Fix Error Chromium' }],
        [{ text: '🛑 Stop Bot' }, { text: '⚠️ Reset Session' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };

  const welcomeMessage = 
    `🖥️ *DR. ZEIN - SERVER CONTROLLER*\n` +
    `=============================\n` +
    `Halo Mas Fauzan! Silakan gunakan menu interaktif di bawah untuk mengontrol sistem VPS dan Bot WhatsApp.\n\n` +
    `📌 *Status Kontrol:* Standby & Connected\n` +
    `🚀 *Main Process:* \`index.js\` via PM2`;

  bot.on('message', async (ctx) => {
    const text = ctx.message.text;
    const fromId = ctx.from.id.toString();

    if (!text) return; // Abaikan jika pesan bukan berupa teks

    // Proteksi Keamanan
    if (ownerId && fromId !== ownerId.toString()) {
      return ctx.reply(`⚠️ *Akses Ditolak!*\nID Anda (${fromId}) tidak terdaftar sebagai Owner.`, { parse_mode: 'Markdown' });
    }

    if (text === '/start' || text === '/menu') {
      return ctx.reply(welcomeMessage, { parse_mode: 'Markdown', ...mainKeyboard });
    }

    if (text === '🔄 Restart Bot') {
      await ctx.reply(`⏳ *Memproses Perintah Restart...*\nMenutup proses saat ini secara aman (Graceful Shutdown). _PM2 akan otomatis menghidupkan ulang dan memicu Sync GitHub!_`, { parse_mode: 'Markdown' });
      
      // Kirim SIGTERM ke botwa.js agar ia sempat menutup browser Chromium dengan benar
      if (childBot) {
        childBot.kill('SIGTERM');
      }

      // Beri waktu 3 detik agar browser menutup, lalu exit index.js (nanti PM2 yang nyalakan lagi)
      setTimeout(() => {
        process.exit(0);
      }, 3000);
      return;
    }

    if (text === '📊 Status PM2') {
      exec('pm2 status botwa || pm2 status', (err, stdout, stderr) => {
        const result = stdout || stderr || "Tidak ada output dari server.";
        ctx.reply(`📊 *PM2 Current Status:*\n\`\`\`\n${result.trim()}\n\`\`\``, { parse_mode: 'Markdown' });
      });
      return;
    }

    if (text === '📋 Lihat Log Internal') {
      const currentLogs = logsBuffer.join('').trim();
      const cleanLogs = currentLogs ? `\`\`\`\n${currentLogs}\n\`\`\`` : `_Belum ada aktivitas log internal yang terekam._`;
      ctx.reply(`📋 *Log Internal botwa.js:*\n${cleanLogs}`, { parse_mode: 'Markdown' });
      return;
    }

    if (text === '📑 Log PM2') {
      exec('pm2 logs botwa --lines 20 --nostream', (err, stdout, stderr) => {
        const result = stdout || stderr || "Tidak ada log dari PM2.";
        const cleanLog = result.length > 3800 ? result.substring(result.length - 3800) : result;
        ctx.reply(`📑 *PM2 Native Logs (20 Baris Terakhir):*\n\`\`\`\n${cleanLog.trim()}\n\`\`\``, { parse_mode: 'Markdown' });
      });
      return;
    }

    if (text === '⬇️ Sync GitHub Manual') {
      await ctx.reply(`⏳ *Sinkronisasi Manual Dimulai...*\nMenarik pembaruan dari GitHub...`, { parse_mode: 'Markdown' });
      try {
        restoreFilesFromGithub();
        await ctx.reply(`✅ *Sync GitHub Sukses!*\nMemulai ulang sub-proses \`botwa.js\` dengan kode baru...`, { parse_mode: 'Markdown' });
        startBotWa(); 
      } catch (err) {
        ctx.reply(`❌ *Gagal Sinkronisasi:* \n\`${err?.message || err}\``, { parse_mode: 'Markdown' });
      }
      return;
    }

    if (text === '🛑 Stop Bot') {
      await ctx.reply(`🛑 *Mematikan Bot...*\nSistem sedang menjalankan \`pm2 stop botwa\`. Anda harus menyalakannya manual nanti via SSH/Terminal.`, { parse_mode: 'Markdown' });
      exec('pm2 stop botwa');
      return;
    }

    if (text === '🧟 Fix Error Chromium') {
      await ctx.reply(`🧟 *Menangani Error SingletonLock Chromium...*\n1. Menghentikan proses botwa\n2. Membasmi Zombie Chromium\n3. Menyalakan ulang proses botwa`, { parse_mode: 'Markdown' });
      
      if (childBot) {
        childBot.kill('SIGKILL');
      }

      // Beri jeda agar proses child mati, lalu basmi chromium, lalu start ulang
      setTimeout(() => {
        exec('pkill -f chromium || pkill -f chrome || taskkill /F /IM chrome.exe /T || taskkill /F /IM chromium.exe /T', () => {
          ctx.reply('✅ Zombie Chromium berhasil dibasmi. PM2 akan merestart sistem sekarang!').then(() => {
            process.exit(0);
          });
        });
      }, 2000);
      
      return;
    }

    if (text === '⚠️ Reset Session') {
      await ctx.reply(`⚠️ *Mereset Sesi WhatsApp...*\n1. Menghentikan botwa\n2. Menghapus folder auth (.wwebjs_auth & .wwebjs_cache)\n3. Me-restart ulang \`index.js\` via PM2...`, { parse_mode: 'Markdown' });
      
      // Matikan child process botwa.js agar folder auth tidak di-lock
      if (childBot) {
        childBot.kill();
      }

      setTimeout(() => {
        try {
          fs.rmSync(path.join(__dirname, '.wwebjs_auth'), { recursive: true, force: true });
          fs.rmSync(path.join(__dirname, '.wwebjs_cache'), { recursive: true, force: true });
        } catch (e) {
          console.error('[INDEX] Gagal hapus auth:', e);
        }
        
        // Pakai pm2 restart agar proses index.js hidup kembali setelah menghapus auth
        exec('pm2 restart botwa');
      }, 2000);
      return;
    }
  });

  bot.launch(); // Nyalakan bot
} else {
  console.log('[INDEX] ⚠️ Variabel TELEGRAM_BOT_TOKEN kosong di .env. Fitur remote controller dinonaktifkan.');
}

// ========================================================
// ALUR STARTUP UTAMA (BOOSTRAP)
// ========================================================
async function main() {
  try {
    console.log('[INDEX] mulai startup bootstrap...');

    const enabled = (process.env.GITHUB_STARTUP_SYNC || 'true').toLowerCase() === 'true';
    if (enabled) {
      console.log('[INDEX] sync GitHub dulu...');
      try {
        restoreFilesFromGithub();
        console.log('[INDEX] sync GitHub selesai.');
      } catch (syncErr) {
        console.error('[INDEX] Gagal sync GitHub saat startup, lanjut boot saja:', syncErr.message);
      }
    } else {
      console.log('[INDEX] startup sync dimatikan.');
    }

    startBotWa();

  } catch (err) {
    console.error('[INDEX] gagal bootstrap:', err?.message || err);
    process.exit(1);
  }
}

main();