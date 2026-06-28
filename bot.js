require("dotenv").config();

const { generateExcel, generatePDF } = require("./utils/export");
const { generateChartUrl } = require("./utils/chart");

const { scheduleBackup } = require("./utils/gitBackup");
const { initCronJobs } = require("./utils/cron");
const { startDashboard, getDashboardUrl } = require("./dashboard/server");

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

const { readJSON, writeJSON } = require("./utils/db");
const {
  getTodayDate,
  getTodayDisplay,
  getTimeNow,
  getTimestamp
} = require("./utils/date");

const {
  mainReplyKeyboard,
  removeKeyboard,
  pintuKeyboard,
  sisiKeyboard,
  konfirmasiKeyboard,
  fotoOpsionalKeyboard,
  sumberDokumentasiKeyboard,
  modeUploadDokumentasiKeyboard,
  selesaiUploadBulkKeyboard,
  jenisDokumentasiKeyboard,
  sisiDokumentasiKeyboard,
  exportBulanKeyboard
} = require("./utils/keyboard");

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("BOT_TOKEN belum diisi di file .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Initialize Cron Jobs
initCronJobs(bot);

// Start Web Dashboard
const DASHBOARD_PORT = process.env.PORT || 3000;
startDashboard(DASHBOARD_PORT);

const USERS_PATH = "data/users.json";
const PINTU_PATH = "data/pintu.json";
const LAPORAN_PATH = "data/laporan_debit.json";
const SESSIONS_PATH = "runtime/sessions.json";
const DOKUMENTASI_PATH = "data/dokumentasi.json";

const bulkUploadQueues = new Map();

function enqueueBulkUpload(
  chatId,
  task
) {
  const key = String(chatId);

  const antreanSebelumnya =
    bulkUploadQueues.get(key) ||
    Promise.resolve();

  const antreanSekarang =
    antreanSebelumnya
      .catch(() => {
        // Antrean lama gagal, tetapi antrean
        // berikutnya tetap dilanjutkan.
      })
      .then(task);

  bulkUploadQueues.set(
    key,
    antreanSekarang
  );

  antreanSekarang.then(
    () => {
      if (
        bulkUploadQueues.get(key) ===
        antreanSekarang
      ) {
        bulkUploadQueues.delete(key);
      }
    },
    () => {
      if (
        bulkUploadQueues.get(key) ===
        antreanSekarang
      ) {
        bulkUploadQueues.delete(key);
      }
    }
  );

  return antreanSekarang;
}

async function tungguBulkUpload(chatId) {
  const antrean =
    bulkUploadQueues.get(
      String(chatId)
    );

  if (antrean) {
    await antrean.catch(() => {
      // Kesalahan foto sudah ditangani
      // pada proses upload masing-masing.
    });
  }
}

function getUserByTelegramId(telegramId) {
  const users = readJSON(USERS_PATH, {});

  for (const kodeLogin of Object.keys(users)) {
    const user = users[kodeLogin];

    if (String(user.telegramId) === String(telegramId) && user.aktif) {
      return {
        kodeLogin,
        ...user
      };
    }
  }

  return null;
}

function getSession(chatId) {
  const sessions = readJSON(SESSIONS_PATH, {});
  return sessions[String(chatId)] || {};
}

function setSession(chatId, data) {
  const sessions = readJSON(SESSIONS_PATH, {});
  sessions[String(chatId)] = data;
  writeJSON(SESSIONS_PATH, sessions);
}

function clearSession(chatId) {
  const sessions = readJSON(SESSIONS_PATH, {});
  delete sessions[String(chatId)];
  writeJSON(SESSIONS_PATH, sessions);
}

function showMainMenu(chatId, user) {
  const text = `
📋 *MENU UTAMA BOT DEBIT 06-O*

Nama: *${user.nama}*
Jabatan: *${user.jabatan}*

Silakan pilih menu dari tombol di bawah.
`;

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...mainReplyKeyboard(user.role)
  });
}

function sanitizeFileName(text) {
  return String(text)
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "");
}

async function downloadTelegramFile(fileId, savePath) {
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

  const https = require("https");

  return new Promise((resolve, reject) => {
    const dir = path.dirname(savePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const stream = fs.createWriteStream(savePath);

    https
      .get(fileUrl, (response) => {
        response.pipe(stream);

        stream.on("finish", () => {
          stream.close();
          resolve(savePath);
        });
      })
      .on("error", reject);
  });
}

bot.onText(/^\/start$/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  const user = getUserByTelegramId(telegramId);

  if (user) {
    return showMainMenu(chatId, user);
  }

  setSession(chatId, {
    step: "menunggu_kode_login"
  });

  bot.sendMessage(
    chatId,
    `👋 Selamat datang di *Bot Pencatatan Debit 06-O*.

Silakan masukkan kode login Anda.

Contoh:
PPA001`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/menu$/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  const user = getUserByTelegramId(telegramId);

  if (!user) {
    return bot.sendMessage(chatId, "Kamu belum login. Ketik /start untuk login.");
  }

  showMainMenu(chatId, user);
});

bot.onText(/^\/logout$/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  const user = getUserByTelegramId(telegramId);

  if (!user) {
    return bot.sendMessage(chatId, "Kamu belum login.");
  }

  const users = readJSON(USERS_PATH, {});
  if (users[user.kodeLogin]) {
    users[user.kodeLogin].telegramId = null;
    writeJSON(USERS_PATH, users, "logout user");
  }

  clearSession(chatId);

  bot.sendMessage(
    chatId,
    `✅ Logout berhasil.\n\nKamu telah keluar dari akun *${user.nama}*.\nKetik /start untuk login kembali.`,
    {
      parse_mode: "Markdown",
      ...removeKeyboard()
    }
  );
});

function mulaiCatatDebit(chatId, periode) {
  const pintuList = readJSON(PINTU_PATH, []);

  setSession(chatId, {
    step: "pilih_pintu",
    mode: "catat_debit",
    periode
  });

  return bot.sendMessage(
    chatId,
    `📍 Pilih pintu untuk catat debit *${periode.toUpperCase()}*:`,
    {
      parse_mode: "Markdown",
      ...pintuKeyboard(pintuList)
    }
  );
}

function buatPreviewLaporan({ chatId, telegramId, user, session, fotoData = null }) {
  const tanggal = getTodayDate();
  const periode = session.periode;

  const laporanId = `LAP-${tanggal}-${periode}-${sanitizeFileName(session.pintu)}-${sanitizeFileName(session.sisi)}-${Date.now()}`;

  return {
    id: laporanId,
    jenisBlanko: "06-O",
    tanggal,
    tanggalDisplay: getTodayDisplay(),
    periode,
    waktuInput: getTimeNow(),
    petugas: {
      telegramId: String(telegramId),
      nama: user.nama,
      jabatan: user.jabatan,
      role: user.role
    },
    lokasi: {
      daerahIrigasi: "DI Punggur Utara",
      saluran: "Saluran Sekunder",
      pintu: session.pintu,
      sisi: session.sisi,
      namaLengkap: `${session.pintu} ${session.sisi}`
    },
    dataAir: {
      H: session.H,
      satuanH: "cm",
      Q: session.Q,
      satuanQ: "lt/dt"
    },
    dokumentasi: fotoData
      ? {
          adaFoto: true,
          telegramFileId: fotoData.fileId,
          fotoLocalPath: fotoData.localPath
        }
      : {
          adaFoto: false,
          telegramFileId: null,
          fotoLocalPath: null
        },
    keterangan: "-",
    status: "tersimpan",
    createdAt: getTimestamp()
  };
}

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const data = query.data;

  const user = getUserByTelegramId(telegramId);

  await bot.answerCallbackQuery(query.id);

  if (!user) {
    return bot.sendMessage(chatId, "Kamu belum login. Ketik /start untuk login.");
  }

  if (data === "batal") {
    clearSession(chatId);
    return bot.sendMessage(chatId, "Proses dibatalkan.", mainReplyKeyboard(user.role));
  }

  if (data === "profil_saya") {
    return bot.sendMessage(
      chatId,
      `👤 *Profil Saya*

Nama: *${user.nama}*
Jabatan: *${user.jabatan}*
Role: *${user.role}*
Kode Login: *${user.kodeLogin}*`,
      { parse_mode: "Markdown" }
    );
  }

  if (data === "rekap_harian_today" || data === "rekap_harian_yesterday") {
    const session = getSession(chatId);
    if (!session || session.mode !== "rekap_harian") {
      return bot.sendMessage(chatId, "❌ Sesi rekap sudah tidak valid.");
    }
    const targetDate = data === "rekap_harian_today" ? getTodayDate() : (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    })();
    clearSession(chatId);
    return tampilkanRekapHarian(chatId, targetDate, user);
  }

  if (data === "rekap_harian_manual") {
    const session = getSession(chatId);
    setSession(chatId, { ...session, step: "input_tanggal_rekap_harian" });
    return bot.sendMessage(chatId, "Masukkan tanggal yang ingin direkap.\n\nFormat: 12-06-2026 atau hari ini");
  }

  if (data === "rekap_setengah_bulan_ini" || data === "rekap_setengah_bulan_lalu") {
    const session = getSession(chatId);
    if (!session || session.mode !== "rekap_setengah_bulanan") {
      return bot.sendMessage(chatId, "❌ Sesi rekap sudah tidak valid.");
    }
    const d = new Date();
    if (data === "rekap_setengah_bulan_lalu") {
      d.setMonth(d.getMonth() - 1);
    }
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    const bulanIso = `${y}-${m}`;
    
    setSession(chatId, { ...session, bulanRekap: bulanIso, step: "pilih_periode_setengah_bulanan" });
    
    return bot.sendMessage(
      chatId,
      `✅ Bulan dipilih: *${bulanIso}*\n\nPilih periode setengah bulan:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Tanggal 1 - 15", callback_data: "rekap_setengah_1" }],
            [{ text: "Tanggal 16 - 31", callback_data: "rekap_setengah_2" }],
          ],
        },
      }
    );
  }

  if (data === "rekap_setengah_manual") {
    const session = getSession(chatId);
    setSession(chatId, { ...session, step: "input_bulan_rekap_setengah_bulanan" });
    return bot.sendMessage(chatId, "Masukkan bulan yang ingin direkap.\n\nFormat: 06-2026");
  }

    // PILIH SUMBER FOTO YANG AKAN DITAMPILKAN
    // PILIH SUMBER DOKUMENTASI BERDASARKAN PINTU
  if (
    data === "lihat_dok_semua" ||
    data === "lihat_dok_laporan" ||
    data === "lihat_dok_tambahan"
  ) {
    const session = getSession(chatId);

    if (
      !session ||
      session.mode !== "lihat_dokumentasi" ||
      session.step !== "lihat_dokumentasi_pilih_sumber" ||
      !session.pintu
    ) {
      return bot.sendMessage(
        chatId,
        "❌ Sesi lihat dokumentasi sudah tidak valid. Silakan ulangi dari menu utama."
      );
    }

    const sumber = {
      lihat_dok_semua: "semua",
      lihat_dok_laporan: "laporan",
      lihat_dok_tambahan: "tambahan"
    }[data];

    const kodePintu = session.pintu;

    clearSession(chatId);

    return tampilkanDokumentasiPintu(
      chatId,
      kodePintu,
      sumber,
      user
    );
  }

  // PILIH JENIS DOKUMENTASI
  if (data.startsWith("dok_jenis_")) {
    const jenis = data.replace("dok_jenis_", "");
    const pintuList = readJSON(PINTU_PATH, []);

    setSession(chatId, {
      step: "dok_pilih_pintu",
      mode: "upload_dokumentasi",
      jenisDokumentasi: jenis
    });

    return bot.sendMessage(
      chatId,
      `🖼️ Jenis dokumentasi: *${jenis.toUpperCase()}*

Pilih pintu/bangunan:`,
      {
        parse_mode: "Markdown",
        ...pintuKeyboard(pintuList)
      }
    );
  }

  // PILIH PINTU, BISA UNTUK CATAT DEBIT ATAU DOKUMENTASI
  if (data.startsWith("pintu_")) {
    const kodePintu = data.replace("pintu_", "");
    const pintuList = readJSON(PINTU_PATH, []);
    const pintu = pintuList.find((p) => p.kode === kodePintu);

    if (!pintu) {
      return bot.sendMessage(chatId, "Pintu tidak ditemukan.");
    }

      const session = getSession(chatId);

    // MODE LIHAT DOKUMENTASI BERDASARKAN PINTU
    if (session.mode === "lihat_dokumentasi") {
      setSession(chatId, {
        ...session,
        step: "lihat_dokumentasi_pilih_sumber",
        pintu: pintu.kode
      });

      return bot.sendMessage(
        chatId,
        `✅ Pintu dipilih: *${pintu.nama}*

Pilih sumber dokumentasi yang ingin ditampilkan:`,
        {
          parse_mode: "Markdown",
          ...sumberDokumentasiKeyboard()
        }
      );
    }

    // MODE UPLOAD DOKUMENTASI
    if (session.mode === "upload_dokumentasi") {
      setSession(chatId, {
        ...session,
        step: "dok_pilih_sisi",
        pintu: pintu.kode
      });

      return bot.sendMessage(
        chatId,
        `Pintu dipilih: *${pintu.nama}*

Pilih sisi dokumentasi:`,
        {
          parse_mode: "Markdown",
          ...sisiDokumentasiKeyboard(pintu)
        }
      );
    }

    // MODE CATAT DEBIT
    setSession(chatId, {
      ...session,
      step: "pilih_sisi",
      pintu: pintu.kode
    });

    return bot.sendMessage(
      chatId,
      `Pintu dipilih: *${pintu.nama}*

Sekarang pilih sisi:`,
      {
        parse_mode: "Markdown",
        ...sisiKeyboard(pintu)
      }
    );
  }

  // KEMBALI KE PILIH PINTU UNTUK CATAT DEBIT
  if (data === "kembali_pilih_pintu") {
    const session = getSession(chatId);
    const pintuList = readJSON(PINTU_PATH, []);

    setSession(chatId, {
      ...session,
      step: "pilih_pintu",
      pintu: null,
      sisi: null
    });

    return bot.sendMessage(chatId, "Silakan pilih pintu:", pintuKeyboard(pintuList));
  }

  // KEMBALI KE PILIH PINTU UNTUK DOKUMENTASI
  if (data === "dok_kembali_pilih_pintu") {
    const session = getSession(chatId);
    const pintuList = readJSON(PINTU_PATH, []);

    setSession(chatId, {
      ...session,
      step: "dok_pilih_pintu",
      pintu: null,
      sisi: null
    });

    return bot.sendMessage(
      chatId,
      "Silakan pilih pintu/bangunan:",
      pintuKeyboard(pintuList)
    );
  }

  // PILIH SISI UNTUK CATAT DEBIT
  if (data.startsWith("sisi_")) {
    const sisi = data.replace("sisi_", "");
    const session = getSession(chatId);

    setSession(chatId, {
      ...session,
      step: "input_H",
      sisi
    });

    return bot.sendMessage(
      chatId,
      `✅ Lokasi dipilih: *${session.pintu} ${sisi}*

Masukkan *H / Ketinggian Muka Air* dalam cm.

Contoh:
45`,
      { parse_mode: "Markdown" }
    );
  }

   // PILIH SISI UNTUK DOKUMENTASI
  if (
    data === "dok_sisi_umum" ||
    data.startsWith("dok_sisi_")
  ) {
    const session = getSession(chatId);

    if (
      !session ||
      session.mode !== "upload_dokumentasi"
    ) {
      return bot.sendMessage(
        chatId,
        "Sesi dokumentasi tidak valid. Silakan ulangi."
      );
    }

    const sisi =
      data === "dok_sisi_umum"
        ? "umum"
        : data.replace(
            "dok_sisi_",
            ""
          );

    setSession(chatId, {
      ...session,
      step: "dok_pilih_mode_upload",
      sisi
    });

    return bot.sendMessage(
      chatId,
      `✅ Lokasi dokumentasi dipilih: *${session.pintu} ${sisi}*

Pilih cara upload dokumentasi:`,
      {
        parse_mode: "Markdown",
        ...modeUploadDokumentasiKeyboard()
      }
    );
  }

    // UPLOAD DOKUMENTASI TUNGGAL
  if (data === "dok_upload_tunggal") {
    const session = getSession(chatId);

    if (
      !session ||
      session.mode !== "upload_dokumentasi" ||
      session.step !== "dok_pilih_mode_upload"
    ) {
      return bot.sendMessage(
        chatId,
        "❌ Sesi upload dokumentasi tidak valid."
      );
    }

    setSession(chatId, {
      ...session,
      step: "dok_upload_foto"
    });

    return bot.sendMessage(
      chatId,
      `📷 Silakan kirim satu foto dokumentasi.

Lokasi: ${session.pintu} ${session.sisi}`
    );
  }

  // UPLOAD DOKUMENTASI BULK
  if (data === "dok_upload_bulk") {
    const session = getSession(chatId);

    if (
      !session ||
      session.mode !== "upload_dokumentasi" ||
      session.step !== "dok_pilih_mode_upload"
    ) {
      return bot.sendMessage(
        chatId,
        "❌ Sesi upload dokumentasi tidak valid."
      );
    }

    setSession(chatId, {
      ...session,
      step: "dok_bulk_input_tanggal",
      fotoBulk: []
    });

    return bot.sendMessage(
      chatId,
      `🖼️ UPLOAD DOKUMENTASI BULK

Lokasi: ${session.pintu} ${session.sisi}

Masukkan tanggal dokumentasi untuk seluruh foto dalam batch ini.

Format:
• 12-06-2026
• 12/06/2026
• 2026-06-12
• hari ini

Satu batch hanya boleh berisi foto dengan tanggal dan lokasi yang sama.

Ketik batal untuk membatalkan.`
    );
  }

  // SELESAI MENGIRIM FOTO BULK
  if (data === "dok_bulk_selesai") {
    await tungguBulkUpload(chatId);

    const session = getSession(chatId);

    if (
      !session ||
      session.mode !== "upload_dokumentasi" ||
      session.step !== "dok_upload_foto_bulk"
    ) {
      return bot.sendMessage(
        chatId,
        "❌ Sesi upload bulk sudah tidak valid."
      );
    }

    const fotoBulk =
      Array.isArray(session.fotoBulk)
        ? session.fotoBulk
        : [];

    if (fotoBulk.length === 0) {
      return bot.sendMessage(
        chatId,
        "❌ Belum ada foto yang diterima. Kirim minimal satu foto.",
        selesaiUploadBulkKeyboard(0)
      );
    }

    setSession(chatId, {
      ...session,
      step: "dok_bulk_input_keterangan"
    });

    return bot.sendMessage(
      chatId,
      `✅ ${fotoBulk.length} foto berhasil diterima.

Sekarang tulis satu keterangan yang akan digunakan untuk seluruh foto.

Contoh:
Dokumentasi lama kondisi BPU 9 seluruh sisi`
    );
  }

  // PILIH UPLOAD FOTO PADA CATAT DEBIT
  if (data === "upload_foto_opsional") {
    const session = getSession(chatId);

    if (!session || session.step !== "pilih_foto_opsional") {
      return bot.sendMessage(chatId, "Sesi tidak valid. Silakan ulangi input debit.");
    }

    setSession(chatId, {
      ...session,
      step: "upload_foto"
    });

    return bot.sendMessage(
      chatId,
      "📷 Silakan upload foto dokumentasi pintu/saluran."
    );
  }

  // LEWATI FOTO PADA CATAT DEBIT
  if (data === "skip_foto") {
    const session = getSession(chatId);

    if (!session || session.step !== "pilih_foto_opsional") {
      return bot.sendMessage(chatId, "Sesi tidak valid. Silakan ulangi input debit.");
    }

    const preview = buatPreviewLaporan({
      chatId,
      telegramId,
      user,
      session,
      fotoData: null
    });

    setSession(chatId, {
      ...session,
      step: "konfirmasi",
      preview
    });

    return bot.sendMessage(
      chatId,
      `📋 *Konfirmasi Laporan Debit*

Tanggal: *${preview.tanggalDisplay}*
Periode: *${preview.periode.toUpperCase()}*
Petugas: *${preview.petugas.nama}*
Pintu: *${preview.lokasi.namaLengkap}*

H: *${preview.dataAir.H} cm*
Q: *${preview.dataAir.Q} lt/dt*
Foto: *Tidak ada / dilewati*

Simpan laporan ini?`,
      {
        parse_mode: "Markdown",
        ...konfirmasiKeyboard()
      }
    );
  }

  // SIMPAN LAPORAN DEBIT
  if (data === "simpan_laporan") {
    const session = getSession(chatId);

    if (!session || !session.preview) {
      return bot.sendMessage(chatId, "Tidak ada data yang bisa disimpan.");
    }

    const laporan = readJSON(LAPORAN_PATH, []);
    laporan.push(session.preview);
    writeJSON(LAPORAN_PATH, laporan, "simpan laporan debit");

    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      `✅ Laporan berhasil disimpan.

ID Laporan:
${session.preview.id}`,
      mainReplyKeyboard(user.role)
    );
  }

  // PILIH PERIODE REKAP SETENGAH BULANAN
if (
  data === "rekap_setengah_1" ||
  data === "rekap_setengah_2"
) {
  const session = getSession(chatId);

  if (
    !session ||
    session.mode !== "rekap_setengah_bulanan" ||
    !session.bulanRekap
  ) {
    return bot.sendMessage(
      chatId,
      "❌ Sesi rekap sudah tidak valid. Silakan pilih menu kembali."
    );
  }

  const bagianPeriode =
    data === "rekap_setengah_1" ? 1 : 2;

  const bulanRekap = session.bulanRekap;

  clearSession(chatId);

  return tampilkanRekapSetengahBulanan(
    chatId,
    bulanRekap,
    bagianPeriode
  );
}

  function mulaiRekapSetengahBulanan(chatId) {
  setSession(chatId, {
    step: "pilih_opsi_rekap_setengah_bulanan",
    mode: "rekap_setengah_bulanan"
  });

  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Bulan Ini', callback_data: 'rekap_setengah_bulan_ini' }],
        [{ text: 'Bulan Lalu', callback_data: 'rekap_setengah_bulan_lalu' }],
        [{ text: '🗓️ Ketik Manual', callback_data: 'rekap_setengah_manual' }],
        [{ text: '❌ Batal', callback_data: 'batal' }]
      ]
    }
  };

  return bot.sendMessage(
    chatId,
    `📆 *REKAP SETENGAH BULANAN DEBIT 06-O*\n\nSilakan pilih bulan yang ingin direkap:`,
    opts
  );
}

function normalisasiBulanRekap(input) {
  const nilai = String(input || "")
    .trim()
    .toLowerCase();

  if (
    nilai === "bulan ini" ||
    nilai === "bulanini"
  ) {
    return getTodayDate().slice(0, 7);
  }

  let tahun;
  let bulan;

  const formatIndonesia = nilai.match(
    /^(\d{1,2})[-/](\d{4})$/
  );

  const formatIso = nilai.match(
    /^(\d{4})-(\d{1,2})$/
  );

  if (formatIndonesia) {
    bulan = Number(formatIndonesia[1]);
    tahun = Number(formatIndonesia[2]);
  } else if (formatIso) {
    tahun = Number(formatIso[1]);
    bulan = Number(formatIso[2]);
  } else {
    return null;
  }

  if (
    !Number.isInteger(tahun) ||
    !Number.isInteger(bulan) ||
    tahun < 2000 ||
    tahun > 2100 ||
    bulan < 1 ||
    bulan > 12
  ) {
    return null;
  }

  return `${String(tahun).padStart(4, "0")}-${String(bulan).padStart(2, "0")}`;
}

function formatBulanRekap(bulanIso) {
  const namaBulan = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember"
  ];

  const bagian = String(bulanIso || "").split("-");

  if (bagian.length !== 2) {
    return bulanIso;
  }

  const tahun = bagian[0];
  const bulan = Number(bagian[1]);

  return `${namaBulan[bulan - 1] || "-"} ${tahun}`;
}

function dapatkanRentangSetengahBulanan(
  bulanIso,
  bagianPeriode
) {
  const bagian = String(bulanIso || "").split("-");

  if (bagian.length !== 2) {
    return null;
  }

  const tahun = Number(bagian[0]);
  const bulan = Number(bagian[1]);

  const hariTerakhir = new Date(
    Date.UTC(tahun, bulan, 0)
  ).getUTCDate();

  const hariAwal =
    bagianPeriode === 1 ? 1 : 16;

  const hariAkhir =
    bagianPeriode === 1 ? 15 : hariTerakhir;

  const bulanString = String(bulan).padStart(2, "0");

  return {
    hariAwal,
    hariAkhir,
    tanggalAwal:
      `${tahun}-${bulanString}-${String(hariAwal).padStart(2, "0")}`,
    tanggalAkhir:
      `${tahun}-${bulanString}-${String(hariAkhir).padStart(2, "0")}`
  };
}

function nilaiAngka(nilai) {
  const angka = Number(nilai);

  return Number.isFinite(angka)
    ? angka
    : 0;
}

async function tampilkanRekapSetengahBulanan(
  chatId,
  bulanIso,
  bagianPeriode
) {
  const laporan = readJSON(LAPORAN_PATH, []);

  if (!Array.isArray(laporan)) {
    return bot.sendMessage(
      chatId,
      "❌ Format laporan_debit.json tidak valid."
    );
  }

  const rentang = dapatkanRentangSetengahBulanan(
    bulanIso,
    bagianPeriode
  );

  if (!rentang) {
    return bot.sendMessage(
      chatId,
      "❌ Bulan atau periode tidak valid."
    );
  }

  const dataRekap = laporan
    .filter((item) => {
      if (!item || !item.tanggal) {
        return false;
      }

      return (
        item.tanggal >= rentang.tanggalAwal &&
        item.tanggal <= rentang.tanggalAkhir
      );
    })
    .sort((a, b) => {
      const hasilTanggal = String(
        a.tanggal || ""
      ).localeCompare(
        String(b.tanggal || "")
      );

      if (hasilTanggal !== 0) {
        return hasilTanggal;
      }

      return urutkanDataRekap(a, b);
    });

  const namaPeriode =
    bagianPeriode === 1
      ? "Tanggal 1–15"
      : `Tanggal 16–${rentang.hariAkhir}`;

  if (dataRekap.length === 0) {
    return bot.sendMessage(
      chatId,
      `📆 Tidak ada laporan debit.

Bulan: ${formatBulanRekap(bulanIso)}
Periode: ${namaPeriode}`
    );
  }

  const jumlahPagi = dataRekap.filter(
    (item) => item.periode === "pagi"
  ).length;

  const jumlahSore = dataRekap.filter(
    (item) => item.periode === "sore"
  ).length;

  const jumlahDebitNol = dataRekap.filter(
    (item) => nilaiAngka(item.dataAir?.Q) === 0
  ).length;

  const jumlahDebitMengalir = dataRekap.filter(
    (item) => nilaiAngka(item.dataAir?.Q) > 0
  ).length;

  const jumlahFoto = dataRekap.filter(
    (item) => memilikiFoto(item)
  ).length;

  const totalQ = dataRekap.reduce(
    (total, item) => {
      return total + nilaiAngka(item.dataAir?.Q);
    },
    0
  );

  const rataRataQ =
    dataRekap.length > 0
      ? totalQ / dataRekap.length
      : 0;

  const daftarTanggal = new Set(
    dataRekap.map((item) => item.tanggal)
  );

  const daftarPetugas = new Set(
    dataRekap
      .map((item) => item.petugas?.nama)
      .filter(Boolean)
  );

  const rekapTanggal = {};

  dataRekap.forEach((item) => {
    const tanggal = item.tanggal;
    const q = nilaiAngka(item.dataAir?.Q);

    if (!rekapTanggal[tanggal]) {
      rekapTanggal[tanggal] = {
        jumlah: 0,
        pagi: 0,
        sore: 0,
        debitNol: 0,
        debitMengalir: 0,
        totalQ: 0
      };
    }

    rekapTanggal[tanggal].jumlah += 1;
    rekapTanggal[tanggal].totalQ += q;

    if (item.periode === "pagi") {
      rekapTanggal[tanggal].pagi += 1;
    }

    if (item.periode === "sore") {
      rekapTanggal[tanggal].sore += 1;
    }

    if (q > 0) {
      rekapTanggal[tanggal].debitMengalir += 1;
    } else {
      rekapTanggal[tanggal].debitNol += 1;
    }
  });

  const rekapLokasi = {};

  dataRekap.forEach((item) => {
    const pintu = item.lokasi?.pintu || "-";
    const sisi = item.lokasi?.sisi || "-";

    const namaLengkap =
      item.lokasi?.namaLengkap ||
      `${pintu} ${sisi}`;

    const key = `${pintu}_${sisi}`;

    if (!rekapLokasi[key]) {
      rekapLokasi[key] = {
        pintu,
        sisi,
        namaLengkap,
        jumlah: 0,
        totalH: 0,
        totalQ: 0,
        minimumQ: null,
        maksimumQ: null
      };
    }

    const h = nilaiAngka(item.dataAir?.H);
    const q = nilaiAngka(item.dataAir?.Q);

    rekapLokasi[key].jumlah += 1;
    rekapLokasi[key].totalH += h;
    rekapLokasi[key].totalQ += q;

    if (
      rekapLokasi[key].minimumQ === null ||
      q < rekapLokasi[key].minimumQ
    ) {
      rekapLokasi[key].minimumQ = q;
    }

    if (
      rekapLokasi[key].maksimumQ === null ||
      q > rekapLokasi[key].maksimumQ
    ) {
      rekapLokasi[key].maksimumQ = q;
    }
  });

  let hasil = `📆 REKAP SETENGAH BULANAN DEBIT 06-O

Bulan: ${formatBulanRekap(bulanIso)}
Periode: ${namaPeriode}
Rentang: ${tanggalIsoKeDisplay(rentang.tanggalAwal)} s.d. ${tanggalIsoKeDisplay(rentang.tanggalAkhir)}

RINGKASAN
• Jumlah laporan: ${dataRekap.length}
• Hari memiliki data: ${daftarTanggal.size}
• Pagi: ${jumlahPagi}
• Sore: ${jumlahSore}
• Debit mengalir: ${jumlahDebitMengalir}
• Debit 0: ${jumlahDebitNol}
• Total Q: ${formatAngka(totalQ)} lt/dt
• Rata-rata Q: ${formatAngka(rataRataQ)} lt/dt
• Memiliki foto: ${jumlahFoto}
• Petugas terlibat: ${daftarPetugas.size}
`;

  hasil += "\n📅 REKAP PER TANGGAL\n";

  Object.keys(rekapTanggal)
    .sort()
    .forEach((tanggal) => {
      const item = rekapTanggal[tanggal];

      const rataRata =
        item.jumlah > 0
          ? item.totalQ / item.jumlah
          : 0;

      hasil += `
• ${tanggalIsoKeDisplay(tanggal)}
  Laporan: ${item.jumlah}
  Pagi: ${item.pagi} | Sore: ${item.sore}
  Q > 0: ${item.debitMengalir}
  Q = 0: ${item.debitNol}
  Rata-rata Q: ${formatAngka(rataRata)} lt/dt
`;
    });

  hasil += "\n📍 REKAP PER PINTU DAN SISI\n";

  Object.values(rekapLokasi)
    .sort((a, b) => {
      const hasilPintu = a.pintu.localeCompare(
        b.pintu,
        "id",
        {
          numeric: true,
          sensitivity: "base"
        }
      );

      if (hasilPintu !== 0) {
        return hasilPintu;
      }

      return a.sisi.localeCompare(
        b.sisi,
        "id",
        {
          numeric: true,
          sensitivity: "base"
        }
      );
    })
    .forEach((item, index) => {
      const rataRataH =
        item.jumlah > 0
          ? item.totalH / item.jumlah
          : 0;

      const rataRataQ =
        item.jumlah > 0
          ? item.totalQ / item.jumlah
          : 0;

      hasil += `
${index + 1}. ${item.namaLengkap}
   Jumlah catatan: ${item.jumlah}
   Rata-rata H: ${formatAngka(rataRataH)} cm
   Rata-rata Q: ${formatAngka(rataRataQ)} lt/dt
   Q min–maks: ${formatAngka(item.minimumQ)}–${formatAngka(item.maksimumQ)} lt/dt
`;
    });

  hasil += "\n✅ Rekap setengah bulanan selesai.";

  const chartData = Object.keys(rekapTanggal).sort().map(tgl => ({
    tanggal: tgl.slice(-2),
    totalQ: rekapTanggal[tgl].totalQ
  }));

  try {
    const chartUrl = generateChartUrl(chartData, namaPeriode);
    await bot.sendPhoto(chatId, chartUrl, { caption: "📊 Grafik Pergerakan Debit (Total Q per Hari)" });
  } catch(e) {
    console.error("Gagal mengirim grafik:", e);
  }

  return kirimPesanPanjang(
    chatId,
    hasil
  );
}

  if (data === "laporan_hari_ini") {
    return tampilkanLaporanHariIni(chatId);
  }

  if (data === "rekap_harian") {
  return mulaiRekapHarian(chatId);
}

  if (data.startsWith("export_")) {
    const parts = data.split("_"); // e.g. export_excel_bulanini
    if (parts.length < 3) return;

    const tipe = parts[1]; // excel atau pdf
    const rentang = parts[2]; // bulanini atau semua

    bot.sendMessage(chatId, `Memproses export ${tipe.toUpperCase()}... Mohon tunggu ⏳`);

    try {
      const laporan = readJSON(LAPORAN_PATH, []);
      let dataToExport = laporan;

      if (rentang === "bulanini") {
        const bulanIni = getTodayDate().slice(0, 7); // e.g. "2026-06"
        dataToExport = laporan.filter(item => item.tanggal && item.tanggal.startsWith(bulanIni));
      }

      if (dataToExport.length === 0) {
        return bot.sendMessage(chatId, "❌ Tidak ada data untuk periode ini.");
      }

      // Sort data by date
      dataToExport.sort((a, b) => String(a.tanggal || "").localeCompare(String(b.tanggal || "")));

      const fileName = `Export_Debit_${rentang === "bulanini" ? "BulanIni" : "Semua"}_${Date.now()}.${tipe === 'excel' ? 'xlsx' : 'pdf'}`;
      const exportDir = path.join(__dirname, "exports");
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      const filePath = path.join(exportDir, fileName);

      if (tipe === "excel") {
        await generateExcel(dataToExport, filePath);
      } else if (tipe === "pdf") {
        await generatePDF(dataToExport, filePath);
      }

      await bot.sendDocument(chatId, filePath, {
        caption: `✅ Berhasil export ${dataToExport.length} data ke ${tipe.toUpperCase()}`
      });

      // Cleanup
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

    } catch (error) {
      console.error("Export Error:", error);
      bot.sendMessage(chatId, "❌ Terjadi kesalahan saat meng-export data.");
    }
    return;
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  if (msg.text && msg.text.startsWith("/")) {
    return;
  }

  const session = getSession(chatId);
  const user = getUserByTelegramId(telegramId);
  const text = String(msg.text || "").trim();

  // PROSES LOGIN
  if (session.step === "menunggu_kode_login") {
    const kodeInput = String(msg.text || "").trim().toUpperCase();
    const users = readJSON(USERS_PATH, {});
    const dataUser = users[kodeInput];

    if (!dataUser || !dataUser.aktif) {
      return bot.sendMessage(chatId, "Kode login salah atau akun tidak aktif.");
    }

    if (dataUser.telegramId && String(dataUser.telegramId) !== String(telegramId)) {
      return bot.sendMessage(chatId, "Kode login ini sudah digunakan oleh Telegram lain.");
    }

    users[kodeInput].telegramId = String(telegramId);
    writeJSON(USERS_PATH, users, "login user");

    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      `✅ Login berhasil.

Nama: *${dataUser.nama}*
Jabatan: *${dataUser.jabatan}*

Ketik /menu untuk membuka menu.`,
      { parse_mode: "Markdown" }
    );
  }

  // WAJIB LOGIN UNTUK SEMUA MENU
  if (!user) {
    return bot.sendMessage(chatId, "Kamu belum login. Ketik /start untuk login.");
  }

  // MENU UTAMA REPLY KEYBOARD
  if (text === "🌅 Catat Debit Pagi") {
    return mulaiCatatDebit(chatId, "pagi");
  }

  if (text === "🌇 Catat Debit Sore") {
    return mulaiCatatDebit(chatId, "sore");
  }

  if (text === "📌 Laporan Hari Ini") {
    return tampilkanLaporanHariIni(chatId);
  }

   if (text === "🗂️ Lihat Dokumentasi") {
    const pintuList = readJSON(
      PINTU_PATH,
      []
    );

    setSession(chatId, {
      step: "lihat_dokumentasi_pilih_pintu",
      mode: "lihat_dokumentasi"
    });

    return bot.sendMessage(
      chatId,
      `🗂️ *LIHAT DOKUMENTASI*

Pilih pintu atau bangunan yang ingin dilihat dokumentasinya:`,
      {
        parse_mode: "Markdown",
        ...pintuKeyboard(pintuList)
      }
    );
  }

  if (text === "🖼️ Upload Dokumentasi") {
    setSession(chatId, {
      step: "dok_pilih_jenis",
      mode: "upload_dokumentasi"
    });

    return bot.sendMessage(
      chatId,
      "🖼️ *Upload Dokumentasi Tambahan*\n\nPilih jenis dokumentasi:",
      {
        parse_mode: "Markdown",
        ...jenisDokumentasiKeyboard()
      }
    );
  }

  if (text === "📊 Rekap Harian") {
  return mulaiRekapHarian(chatId);
}

  if (text === "📆 Rekap Setengah Bulanan") {
  return mulaiRekapSetengahBulanan(chatId);
}

  if (text === "📤 Export Excel") {
    return bot.sendMessage(
      chatId,
      "📤 Pilih periode data yang ingin di-export ke Excel:",
      exportBulanKeyboard("excel")
    );
  }

  if (text === "📄 Export PDF") {
    return bot.sendMessage(
      chatId,
      "📄 Pilih periode data yang ingin di-export ke PDF:",
      exportBulanKeyboard("pdf")
    );
  }

  if (text === "🌐 Web Dashboard") {
    const url = getDashboardUrl();
    return bot.sendMessage(
      chatId,
      `🌐 *Akses Mini Web Dashboard*
      
Untuk memantau grafik dan rekap data secara real-time dari browser (HP atau Laptop), silakan buka link berikut:

🔗 ${url}`,
      { parse_mode: "Markdown" }
    );
  }

  if (text === "👤 Profil Saya") {
    return bot.sendMessage(
      chatId,
      `👤 *Profil Saya*

Nama: *${user.nama}*
Jabatan: *${user.jabatan}*
Role: *${user.role}*
Kode Login: *${user.kodeLogin}*`,
      { parse_mode: "Markdown" }
    );
  }

  if (text === "🚪 Logout") {
    const users = readJSON(USERS_PATH, {});
    if (users[user.kodeLogin]) {
      users[user.kodeLogin].telegramId = null;
      writeJSON(USERS_PATH, users, "logout user");
    }

    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      `✅ Logout berhasil.\n\nKamu telah keluar dari akun *${user.nama}*.\nKetik /start untuk login kembali.`,
      {
        parse_mode: "Markdown",
        ...removeKeyboard()
      }
    );
  }

  

  // INPUT TANGGAL REKAP HARIAN
if (session.step === "input_tanggal_rekap_harian") {
  if (text.toLowerCase() === "batal") {
    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      "❌ Rekap harian dibatalkan.",
      mainReplyKeyboard(user.role)
    );
  }

  const tanggalRekap = normalisasiTanggalRekap(text);

  if (!tanggalRekap) {
    return bot.sendMessage(
      chatId,
      `❌ Format tanggal tidak valid.

Masukkan tanggal dengan salah satu format berikut:
• 12-06-2026
• 12/06/2026
• 2026-06-12
• hari ini

Ketik batal untuk membatalkan.`
    );
  }

  clearSession(chatId);
  return tampilkanRekapHarian(chatId, tanggalRekap);
}

// INPUT BULAN REKAP SETENGAH BULANAN
if (session.step === "input_bulan_rekap_setengah_bulanan") {
  if (text.toLowerCase() === "batal") {
    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      "❌ Rekap setengah bulanan dibatalkan.",
      mainReplyKeyboard(user.role)
    );
  }

  const bulanRekap = normalisasiBulanRekap(text);

  if (!bulanRekap) {
    return bot.sendMessage(
      chatId,
      `❌ Format bulan tidak valid.

Gunakan salah satu format berikut:

06-2026
06/2026
2026-06
bulan ini

Ketik batal untuk membatalkan.`
    );
  }

  setSession(chatId, {
    ...session,
    step: "pilih_periode_rekap_setengah_bulanan",
    mode: "rekap_setengah_bulanan",
    bulanRekap
  });

  return bot.sendMessage(
    chatId,
    `📆 Bulan dipilih: ${formatBulanRekap(bulanRekap)}

Silakan pilih periode:`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📅 Tanggal 1–15",
              callback_data: "rekap_setengah_1"
            }
          ],
          [
            {
              text: "📅 Tanggal 16–Akhir Bulan",
              callback_data: "rekap_setengah_2"
            }
          ],
          [
            {
              text: "❌ Batal",
              callback_data: "batal"
            }
          ]
        ]
      }
    }
  );
}

  // INPUT TANGGAL DOKUMENTASI BULK
  if (
    session.step ===
    "dok_bulk_input_tanggal"
  ) {
    if (
      text.toLowerCase() === "batal"
    ) {
      clearSession(chatId);

      return bot.sendMessage(
        chatId,
        "❌ Upload dokumentasi bulk dibatalkan.",
        mainReplyKeyboard(user.role)
      );
    }

    const tanggalDokumentasi =
      normalisasiTanggalRekap(text);

    if (!tanggalDokumentasi) {
      return bot.sendMessage(
        chatId,
        `❌ Format tanggal tidak valid.

Gunakan:
• 12-06-2026
• 12/06/2026
• 2026-06-12
• hari ini

Ketik batal untuk membatalkan.`
      );
    }

    setSession(chatId, {
      ...session,
      step: "dok_upload_foto_bulk",
      tanggalDokumentasi,
      fotoBulk: []
    });

    return bot.sendMessage(
      chatId,
      `🖼️ Silakan kirim semua foto dokumentasi.

Tanggal: ${tanggalIsoKeDisplay(
        tanggalDokumentasi
      )}
Lokasi: ${session.pintu} ${session.sisi}

Kamu boleh:
• Mengirim beberapa foto sekaligus sebagai album.
• Mengirim foto satu per satu.
• Mengirim beberapa album.

Setelah semua foto selesai dikirim, klik tombol Selesai Upload atau ketik selesai.`,
      selesaiUploadBulkKeyboard(0)
    );
  }

    // TERIMA FOTO DOKUMENTASI BULK
  if (
    session.step ===
    "dok_upload_foto_bulk"
  ) {
    if (
      text.toLowerCase() === "selesai"
    ) {
      await tungguBulkUpload(chatId);

      const sessionTerbaru =
        getSession(chatId);

      const fotoBulk =
        Array.isArray(
          sessionTerbaru.fotoBulk
        )
          ? sessionTerbaru.fotoBulk
          : [];

      if (fotoBulk.length === 0) {
        return bot.sendMessage(
          chatId,
          "❌ Belum ada foto yang diterima.",
          selesaiUploadBulkKeyboard(0)
        );
      }

      setSession(chatId, {
        ...sessionTerbaru,
        step: "dok_bulk_input_keterangan"
      });

      return bot.sendMessage(
        chatId,
        `✅ ${fotoBulk.length} foto berhasil diterima.

Sekarang tulis satu keterangan yang akan digunakan untuk seluruh foto.`
      );
    }

    if (
      !msg.photo ||
      msg.photo.length === 0
    ) {
      return bot.sendMessage(
        chatId,
        `Silakan kirim foto dokumentasi.

Setelah selesai, klik tombol Selesai Upload atau ketik selesai.`,
        selesaiUploadBulkKeyboard(
          Array.isArray(session.fotoBulk)
            ? session.fotoBulk.length
            : 0
        )
      );
    }

    return enqueueBulkUpload(
      chatId,
      async () => {
        const sessionTerbaru =
          getSession(chatId);

        if (
          sessionTerbaru.step !==
          "dok_upload_foto_bulk"
        ) {
          return;
        }

        const largestPhoto =
          msg.photo[
            msg.photo.length - 1
          ];

        const fileId =
          largestPhoto.file_id;

        const tanggalDokumentasi =
          sessionTerbaru
            .tanggalDokumentasi ||
          getTodayDate();

        const jenis =
          sessionTerbaru
            .jenisDokumentasi ||
          "lainnya";

        const nomorFoto =
          Array.isArray(
            sessionTerbaru.fotoBulk
          )
            ? sessionTerbaru
                .fotoBulk.length + 1
            : 1;

        const namaFile =
          `${tanggalDokumentasi}_bulk_` +
          `${sanitizeFileName(jenis)}_` +
          `${sanitizeFileName(
            sessionTerbaru.pintu
          )}_` +
          `${sanitizeFileName(
            sessionTerbaru.sisi
          )}_` +
          `${Date.now()}_` +
          `${nomorFoto}.jpg`;

        const localPath = path.join(
          "uploads",
          tanggalDokumentasi,
          "dokumentasi",
          "bulk",
          namaFile
        );

        const fullLocalPath =
          path.join(
            __dirname,
            localPath
          );

        try {
          await downloadTelegramFile(
            fileId,
            fullLocalPath
          );
        } catch (error) {
          console.error(
            "Gagal menyimpan foto bulk:",
            error
          );

          return bot.sendMessage(
            chatId,
            "❌ Salah satu foto gagal disimpan. Silakan kirim ulang foto tersebut."
          );
        }

        const fotoBulk =
          Array.isArray(
            sessionTerbaru.fotoBulk
          )
            ? [
                ...sessionTerbaru
                  .fotoBulk
              ]
            : [];

        fotoBulk.push({
          telegramFileId: fileId,
          fotoLocalPath: localPath,
          mediaGroupId:
            msg.media_group_id || null
        });

        setSession(chatId, {
          ...sessionTerbaru,
          fotoBulk
        });

        scheduleBackup(
          "upload dokumentasi bulk"
        );

        return bot.sendMessage(
          chatId,
          `✅ Foto ke-${fotoBulk.length} berhasil diterima.

Kirim foto berikutnya atau klik Selesai Upload.`,
          selesaiUploadBulkKeyboard(
            fotoBulk.length
          )
        );
      }
    );
  }

  // UPLOAD FOTO DOKUMENTASI TAMBAHAN
  if (session.step === "dok_upload_foto") {
    if (!msg.photo || msg.photo.length === 0) {
      return bot.sendMessage(chatId, "Silakan kirim foto dokumentasi, bukan teks.");
    }

    const largestPhoto = msg.photo[msg.photo.length - 1];
    const fileId = largestPhoto.file_id;

    const tanggal = getTodayDate();
    const jenis = session.jenisDokumentasi || "lainnya";

    const namaFile = `${tanggal}_dok_${sanitizeFileName(jenis)}_${sanitizeFileName(session.pintu)}_${sanitizeFileName(session.sisi)}_${Date.now()}.jpg`;

    const localPath = path.join("uploads", tanggal, "dokumentasi", namaFile);
    const fullLocalPath = path.join(__dirname, localPath);

    try {
      await downloadTelegramFile(fileId, fullLocalPath);
      scheduleBackup("upload dokumentasi tambahan");
    } catch (error) {
      console.error(error);
      return bot.sendMessage(chatId, "Gagal menyimpan foto. Coba upload ulang.");
    }

    setSession(chatId, {
      ...session,
      step: "dok_input_keterangan",
      foto: {
        telegramFileId: fileId,
        fotoLocalPath: localPath
      }
    });

    return bot.sendMessage(
      chatId,
      `✅ Foto dokumentasi berhasil diterima.

Sekarang tulis keterangan singkat.

Contoh:
Foto BPU 11 mewakili sisi ki dan ka`
    );
  }

    // SIMPAN KETERANGAN DOKUMENTASI BULK
  if (
    session.step ===
    "dok_bulk_input_keterangan"
  ) {
    const keterangan =
      String(
        msg.text || ""
      ).trim();

    if (!keterangan) {
      return bot.sendMessage(
        chatId,
        "Keterangan tidak boleh kosong."
      );
    }

    const fotoBulk =
      Array.isArray(session.fotoBulk)
        ? session.fotoBulk
        : [];

    if (fotoBulk.length === 0) {
      clearSession(chatId);

      return bot.sendMessage(
        chatId,
        "❌ Data foto bulk kosong. Silakan ulangi upload.",
        mainReplyKeyboard(user.role)
      );
    }

    const tanggalDokumentasi =
      session.tanggalDokumentasi ||
      getTodayDate();

    const dokumentasiList =
      readJSON(
        DOKUMENTASI_PATH,
        []
      );

    const batchId =
      `BULK-${Date.now()}`;

    const tanggalUpload =
      getTodayDate();

    const waktuUpload =
      getTimeNow();

    const createdAt =
      getTimestamp();

    const daftarItem =
      fotoBulk.map(
        (foto, index) => {
          return {
            id:
              `DOK-${tanggalDokumentasi}-` +
              `${sanitizeFileName(
                session.pintu
              )}-` +
              `${batchId}-` +
              `${index + 1}`,

            tanggal:
              tanggalDokumentasi,

            tanggalDisplay:
              tanggalIsoKeDisplay(
                tanggalDokumentasi
              ),

            // Waktu dokumentasi lama tidak
            // diketahui, jadi tidak ditebak.
            waktuInput: null,

            jenisDokumentasi:
              session.jenisDokumentasi ||
              "lainnya",

            petugas: {
              telegramId:
                String(telegramId),
              nama: user.nama,
              jabatan: user.jabatan,
              role: user.role
            },

            lokasi: {
              daerahIrigasi:
                "DI Punggur Utara",
              saluran:
                "Saluran Sekunder",
              pintu:
                session.pintu,
              sisi:
                session.sisi,
              namaLengkap:
                `${session.pintu} ${session.sisi}`
            },

            dokumentasi: {
              adaFoto: true,
              telegramFileId:
                foto.telegramFileId,
              fotoLocalPath:
                foto.fotoLocalPath
            },

            keterangan,

            bulk: {
              batchId,
              urutan: index + 1,
              jumlahFoto:
                fotoBulk.length,
              tanggalUpload,
              waktuUpload
            },

            createdAt
          };
        }
      );

    dokumentasiList.push(
      ...daftarItem
    );

    writeJSON(
      DOKUMENTASI_PATH,
      dokumentasiList,
      `simpan ${fotoBulk.length} dokumentasi bulk`
    );

    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      `✅ *Dokumentasi bulk berhasil disimpan.*

Tanggal dokumentasi: *${tanggalIsoKeDisplay(
        tanggalDokumentasi
      )}*
Lokasi: *${session.pintu} ${session.sisi}*
Jenis: *${String(
        session.jenisDokumentasi ||
        "lainnya"
      ).toUpperCase()}*
Jumlah foto: *${fotoBulk.length}*
Keterangan: ${keterangan}`,
      {
        parse_mode: "Markdown",
        ...mainReplyKeyboard(
          user.role
        )
      }
    );
  }

  // SIMPAN KETERANGAN DOKUMENTASI TAMBAHAN
  if (session.step === "dok_input_keterangan") {
    const keterangan = String(msg.text || "").trim();

    if (!keterangan) {
      return bot.sendMessage(chatId, "Keterangan tidak boleh kosong. Tulis keterangan singkat.");
    }

    const dokumentasiList = readJSON(DOKUMENTASI_PATH, []);

    const item = {
      id: `DOK-${getTodayDate()}-${sanitizeFileName(session.pintu)}-${Date.now()}`,
      tanggal: getTodayDate(),
      tanggalDisplay: getTodayDisplay(),
      waktuInput: getTimeNow(),
      jenisDokumentasi: session.jenisDokumentasi || "lainnya",
      petugas: {
        telegramId: String(telegramId),
        nama: user.nama,
        jabatan: user.jabatan,
        role: user.role
      },
      lokasi: {
        daerahIrigasi: "DI Punggur Utara",
        saluran: "Saluran Sekunder",
        pintu: session.pintu,
        sisi: session.sisi,
        namaLengkap: `${session.pintu} ${session.sisi}`
      },
      dokumentasi: {
        adaFoto: true,
        telegramFileId: session.foto.telegramFileId,
        fotoLocalPath: session.foto.fotoLocalPath
      },
      keterangan,
      createdAt: getTimestamp()
    };

    dokumentasiList.push(item);
    writeJSON(DOKUMENTASI_PATH, dokumentasiList, "simpan dokumentasi tambahan");

    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      `✅ *Dokumentasi berhasil disimpan.*

Jenis: *${item.jenisDokumentasi.toUpperCase()}*
Lokasi: *${item.lokasi.namaLengkap}*
Keterangan: ${item.keterangan}`,
      {
        parse_mode: "Markdown",
        ...mainReplyKeyboard(user.role)
      }
    );
  }

  // INPUT H
  if (session.step === "input_H") {
    const H = parseFloat(String(msg.text || "").replace(",", "."));

    if (isNaN(H)) {
      return bot.sendMessage(chatId, "H harus berupa angka. Contoh: 45");
    }

    setSession(chatId, {
      ...session,
      step: "input_Q",
      H
    });

    return bot.sendMessage(
      chatId,
      `H tersimpan: *${H} cm*

Sekarang masukkan *Q / Debit masuk* dalam lt/dt.

Contoh:
120`,
      { parse_mode: "Markdown" }
    );
  }

  // INPUT Q
  if (session.step === "input_Q") {
    const Q = parseFloat(String(msg.text || "").replace(",", "."));

    if (isNaN(Q)) {
      return bot.sendMessage(chatId, "Q harus berupa angka. Contoh: 120");
    }

    setSession(chatId, {
      ...session,
      step: "pilih_foto_opsional",
      Q
    });

    return bot.sendMessage(
      chatId,
      `Q tersimpan: *${Q} lt/dt*

Apakah ingin upload foto dokumentasi?

Kalau foto untuk pintu ini sudah diwakili foto sisi lain, klik *Lewati Foto*.`,
      {
        parse_mode: "Markdown",
        ...fotoOpsionalKeyboard()
      }
    );
  }

  // UPLOAD FOTO SAAT CATAT DEBIT
  if (session.step === "upload_foto") {
    if (!msg.photo || msg.photo.length === 0) {
      return bot.sendMessage(chatId, "Silakan kirim foto dokumentasi, bukan teks.");
    }

    const largestPhoto = msg.photo[msg.photo.length - 1];
    const fileId = largestPhoto.file_id;

    const tanggal = getTodayDate();
    const periode = session.periode;
    const namaFile = `${tanggal}_${periode}_${sanitizeFileName(session.pintu)}_${sanitizeFileName(session.sisi)}_${Date.now()}.jpg`;
    const localPath = path.join("uploads", tanggal, periode, namaFile);
    const fullLocalPath = path.join(__dirname, localPath);

    try {
      await downloadTelegramFile(fileId, fullLocalPath);
      scheduleBackup("upload dokumentasi");
    } catch (error) {
      console.error(error);
      return bot.sendMessage(chatId, "Gagal menyimpan foto. Coba upload ulang.");
    }

    const preview = buatPreviewLaporan({
      chatId,
      telegramId,
      user,
      session,
      fotoData: {
        fileId,
        localPath
      }
    });

    setSession(chatId, {
      ...session,
      step: "konfirmasi",
      preview
    });

    return bot.sendMessage(
      chatId,
      `📋 *Konfirmasi Laporan Debit*

Tanggal: *${preview.tanggalDisplay}*
Periode: *${preview.periode.toUpperCase()}*
Petugas: *${preview.petugas.nama}*
Pintu: *${preview.lokasi.namaLengkap}*

H: *${preview.dataAir.H} cm*
Q: *${preview.dataAir.Q} lt/dt*
Foto: *Ada*

Simpan laporan ini?`,
      {
        parse_mode: "Markdown",
        ...konfirmasiKeyboard()
      }
    );
  }
});

function mulaiRekapSetengahBulanan(chatId) {
  setSession(chatId, {
    step: "input_bulan_rekap_setengah_bulanan",
    mode: "rekap_setengah_bulanan"
  });

  return bot.sendMessage(
    chatId,
    `📆 REKAP SETENGAH BULANAN DEBIT 06-O

Masukkan bulan yang ingin direkap.

Contoh:
06-2026
06/2026
2026-06
bulan ini

Ketik batal untuk membatalkan.`
  );
}

function normalisasiBulanRekap(input) {
  const nilai = String(input || "")
    .trim()
    .toLowerCase();

  if (
    nilai === "bulan ini" ||
    nilai === "bulanini"
  ) {
    return getTodayDate().slice(0, 7);
  }

  let tahun;
  let bulan;

  const formatIndonesia = nilai.match(
    /^(\d{1,2})[-/](\d{4})$/
  );

  const formatIso = nilai.match(
    /^(\d{4})-(\d{1,2})$/
  );

  if (formatIndonesia) {
    bulan = Number(formatIndonesia[1]);
    tahun = Number(formatIndonesia[2]);
  } else if (formatIso) {
    tahun = Number(formatIso[1]);
    bulan = Number(formatIso[2]);
  } else {
    return null;
  }

  if (
    !Number.isInteger(tahun) ||
    !Number.isInteger(bulan) ||
    tahun < 2000 ||
    tahun > 2100 ||
    bulan < 1 ||
    bulan > 12
  ) {
    return null;
  }

  return `${String(tahun).padStart(4, "0")}-${String(bulan).padStart(2, "0")}`;
}

function formatBulanRekap(bulanIso) {
  const namaBulan = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember"
  ];

  const bagian = String(bulanIso || "").split("-");

  if (bagian.length !== 2) {
    return bulanIso;
  }

  const tahun = bagian[0];
  const bulan = Number(bagian[1]);

  return `${namaBulan[bulan - 1] || "-"} ${tahun}`;
}

function dapatkanRentangSetengahBulanan(
  bulanIso,
  bagianPeriode
) {
  const bagian = String(bulanIso || "").split("-");

  if (bagian.length !== 2) {
    return null;
  }

  const tahun = Number(bagian[0]);
  const bulan = Number(bagian[1]);

  const hariTerakhir = new Date(
    Date.UTC(tahun, bulan, 0)
  ).getUTCDate();

  const hariAwal =
    bagianPeriode === 1 ? 1 : 16;

  const hariAkhir =
    bagianPeriode === 1 ? 15 : hariTerakhir;

  const bulanString = String(bulan).padStart(2, "0");

  return {
    hariAwal,
    hariAkhir,
    tanggalAwal:
      `${tahun}-${bulanString}-${String(hariAwal).padStart(2, "0")}`,
    tanggalAkhir:
      `${tahun}-${bulanString}-${String(hariAkhir).padStart(2, "0")}`
  };
}

function nilaiAngka(nilai) {
  const angka = Number(nilai);

  return Number.isFinite(angka)
    ? angka
    : 0;
}

async function tampilkanRekapSetengahBulanan(
  chatId,
  bulanIso,
  bagianPeriode
) {
  const laporan = readJSON(LAPORAN_PATH, []);

  if (!Array.isArray(laporan)) {
    return bot.sendMessage(
      chatId,
      "❌ Format laporan_debit.json tidak valid."
    );
  }

  const rentang = dapatkanRentangSetengahBulanan(
    bulanIso,
    bagianPeriode
  );

  if (!rentang) {
    return bot.sendMessage(
      chatId,
      "❌ Bulan atau periode tidak valid."
    );
  }

  const dataRekap = laporan
    .filter((item) => {
      if (!item || !item.tanggal) {
        return false;
      }

      return (
        item.tanggal >= rentang.tanggalAwal &&
        item.tanggal <= rentang.tanggalAkhir
      );
    })
    .sort((a, b) => {
      const hasilTanggal = String(
        a.tanggal || ""
      ).localeCompare(
        String(b.tanggal || "")
      );

      if (hasilTanggal !== 0) {
        return hasilTanggal;
      }

      return urutkanDataRekap(a, b);
    });

  const namaPeriode =
    bagianPeriode === 1
      ? "Tanggal 1–15"
      : `Tanggal 16–${rentang.hariAkhir}`;

  if (dataRekap.length === 0) {
    return bot.sendMessage(
      chatId,
      `📆 Tidak ada laporan debit.

Bulan: ${formatBulanRekap(bulanIso)}
Periode: ${namaPeriode}`
    );
  }

  const jumlahPagi = dataRekap.filter(
    (item) => item.periode === "pagi"
  ).length;

  const jumlahSore = dataRekap.filter(
    (item) => item.periode === "sore"
  ).length;

  const jumlahDebitNol = dataRekap.filter(
    (item) => nilaiAngka(item.dataAir?.Q) === 0
  ).length;

  const jumlahDebitMengalir = dataRekap.filter(
    (item) => nilaiAngka(item.dataAir?.Q) > 0
  ).length;

  const jumlahFoto = dataRekap.filter(
    (item) => memilikiFoto(item)
  ).length;

  const totalQ = dataRekap.reduce(
    (total, item) => {
      return total + nilaiAngka(item.dataAir?.Q);
    },
    0
  );

  const rataRataQ =
    dataRekap.length > 0
      ? totalQ / dataRekap.length
      : 0;

  const daftarTanggal = new Set(
    dataRekap.map((item) => item.tanggal)
  );

  const daftarPetugas = new Set(
    dataRekap
      .map((item) => item.petugas?.nama)
      .filter(Boolean)
  );

  const rekapTanggal = {};

  dataRekap.forEach((item) => {
    const tanggal = item.tanggal;
    const q = nilaiAngka(item.dataAir?.Q);

    if (!rekapTanggal[tanggal]) {
      rekapTanggal[tanggal] = {
        jumlah: 0,
        pagi: 0,
        sore: 0,
        debitNol: 0,
        debitMengalir: 0,
        totalQ: 0
      };
    }

    rekapTanggal[tanggal].jumlah += 1;
    rekapTanggal[tanggal].totalQ += q;

    if (item.periode === "pagi") {
      rekapTanggal[tanggal].pagi += 1;
    }

    if (item.periode === "sore") {
      rekapTanggal[tanggal].sore += 1;
    }

    if (q > 0) {
      rekapTanggal[tanggal].debitMengalir += 1;
    } else {
      rekapTanggal[tanggal].debitNol += 1;
    }
  });

  const rekapLokasi = {};

  dataRekap.forEach((item) => {
    const pintu = item.lokasi?.pintu || "-";
    const sisi = item.lokasi?.sisi || "-";

    const namaLengkap =
      item.lokasi?.namaLengkap ||
      `${pintu} ${sisi}`;

    const key = `${pintu}_${sisi}`;

    if (!rekapLokasi[key]) {
      rekapLokasi[key] = {
        pintu,
        sisi,
        namaLengkap,
        jumlah: 0,
        totalH: 0,
        totalQ: 0,
        minimumQ: null,
        maksimumQ: null
      };
    }

    const h = nilaiAngka(item.dataAir?.H);
    const q = nilaiAngka(item.dataAir?.Q);

    rekapLokasi[key].jumlah += 1;
    rekapLokasi[key].totalH += h;
    rekapLokasi[key].totalQ += q;

    if (
      rekapLokasi[key].minimumQ === null ||
      q < rekapLokasi[key].minimumQ
    ) {
      rekapLokasi[key].minimumQ = q;
    }

    if (
      rekapLokasi[key].maksimumQ === null ||
      q > rekapLokasi[key].maksimumQ
    ) {
      rekapLokasi[key].maksimumQ = q;
    }
  });

  let hasil = `📆 REKAP SETENGAH BULANAN DEBIT 06-O

Bulan: ${formatBulanRekap(bulanIso)}
Periode: ${namaPeriode}
Rentang: ${tanggalIsoKeDisplay(rentang.tanggalAwal)} s.d. ${tanggalIsoKeDisplay(rentang.tanggalAkhir)}

RINGKASAN
• Jumlah laporan: ${dataRekap.length}
• Hari memiliki data: ${daftarTanggal.size}
• Pagi: ${jumlahPagi}
• Sore: ${jumlahSore}
• Debit mengalir: ${jumlahDebitMengalir}
• Debit 0: ${jumlahDebitNol}
• Total Q: ${formatAngka(totalQ)} lt/dt
• Rata-rata Q: ${formatAngka(rataRataQ)} lt/dt
• Memiliki foto: ${jumlahFoto}
• Petugas terlibat: ${daftarPetugas.size}
`;

  hasil += "\n📅 REKAP PER TANGGAL\n";

  Object.keys(rekapTanggal)
    .sort()
    .forEach((tanggal) => {
      const item = rekapTanggal[tanggal];

      const rataRata =
        item.jumlah > 0
          ? item.totalQ / item.jumlah
          : 0;

      hasil += `
• ${tanggalIsoKeDisplay(tanggal)}
  Laporan: ${item.jumlah}
  Pagi: ${item.pagi} | Sore: ${item.sore}
  Q > 0: ${item.debitMengalir}
  Q = 0: ${item.debitNol}
  Rata-rata Q: ${formatAngka(rataRata)} lt/dt
`;
    });

  hasil += "\n📍 REKAP PER PINTU DAN SISI\n";

  Object.values(rekapLokasi)
    .sort((a, b) => {
      const hasilPintu = a.pintu.localeCompare(
        b.pintu,
        "id",
        {
          numeric: true,
          sensitivity: "base"
        }
      );

      if (hasilPintu !== 0) {
        return hasilPintu;
      }

      return a.sisi.localeCompare(
        b.sisi,
        "id",
        {
          numeric: true,
          sensitivity: "base"
        }
      );
    })
    .forEach((item, index) => {
      const rataRataH =
        item.jumlah > 0
          ? item.totalH / item.jumlah
          : 0;

      const rataRataQ =
        item.jumlah > 0
          ? item.totalQ / item.jumlah
          : 0;

      hasil += `
${index + 1}. ${item.namaLengkap}
   Jumlah catatan: ${item.jumlah}
   Rata-rata H: ${formatAngka(rataRataH)} cm
   Rata-rata Q: ${formatAngka(rataRataQ)} lt/dt
   Q min–maks: ${formatAngka(item.minimumQ)}–${formatAngka(item.maksimumQ)} lt/dt
`;
    });

  hasil += "\n✅ Rekap setengah bulanan selesai.";

  return kirimPesanPanjang(
    chatId,
    hasil
  );
}

function mulaiRekapHarian(chatId) {
  setSession(chatId, {
    step: "pilih_opsi_rekap_harian",
    mode: "rekap_harian"
  });

  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📅 Hari Ini', callback_data: 'rekap_harian_today' }],
        [{ text: '⏮️ Kemarin', callback_data: 'rekap_harian_yesterday' }],
        [{ text: '🗓️ Ketik Manual', callback_data: 'rekap_harian_manual' }],
        [{ text: '❌ Batal', callback_data: 'batal' }]
      ]
    }
  };

  return bot.sendMessage(
    chatId,
    `📊 *REKAP HARIAN DEBIT 06-O*\n\nSilakan pilih tanggal yang ingin direkap:`,
    opts
  );
}

function normalisasiTanggalRekap(input) {
  const nilai = String(input || "").trim().toLowerCase();

  if (
    nilai === "hari ini" ||
    nilai === "hariini" ||
    nilai === "today"
  ) {
    return getTodayDate();
  }

  let tahun;
  let bulan;
  let hari;

  const formatIndonesia = nilai.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/
  );

  const formatIso = nilai.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/
  );

  if (formatIndonesia) {
    hari = Number(formatIndonesia[1]);
    bulan = Number(formatIndonesia[2]);
    tahun = Number(formatIndonesia[3]);
  } else if (formatIso) {
    tahun = Number(formatIso[1]);
    bulan = Number(formatIso[2]);
    hari = Number(formatIso[3]);
  } else {
    return null;
  }

  const tanggal = new Date(Date.UTC(tahun, bulan - 1, hari));

  if (
    tanggal.getUTCFullYear() !== tahun ||
    tanggal.getUTCMonth() + 1 !== bulan ||
    tanggal.getUTCDate() !== hari
  ) {
    return null;
  }

  return `${String(tahun).padStart(4, "0")}-${String(bulan).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;
}

function tanggalIsoKeDisplay(tanggalIso) {
  const bagian = String(tanggalIso || "").split("-");

  if (bagian.length !== 3) {
    return tanggalIso;
  }

  return `${bagian[2]}-${bagian[1]}-${bagian[0]}`;
}

function formatAngka(nilai) {
  const angka = Number(nilai);

  if (!Number.isFinite(angka)) {
    return "0";
  }

  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 3
  }).format(angka);
}

function memilikiFoto(item) {
  return Boolean(
    item?.dokumentasi?.adaFoto ||
    item?.dokumentasi?.telegramFileId ||
    item?.dokumentasi?.fotoLocalPath
  );
}

function urutkanDataRekap(a, b) {
  const urutanPeriode = {
    pagi: 1,
    sore: 2
  };

  const periodeA = urutanPeriode[a.periode] || 99;
  const periodeB = urutanPeriode[b.periode] || 99;

  if (periodeA !== periodeB) {
    return periodeA - periodeB;
  }

  const pintuA = String(a.lokasi?.pintu || "");
  const pintuB = String(b.lokasi?.pintu || "");

  const hasilPintu = pintuA.localeCompare(pintuB, "id", {
    numeric: true,
    sensitivity: "base"
  });

  if (hasilPintu !== 0) {
    return hasilPintu;
  }

  const sisiA = String(a.lokasi?.sisi || "");
  const sisiB = String(b.lokasi?.sisi || "");

  const hasilSisi = sisiA.localeCompare(sisiB, "id", {
    numeric: true,
    sensitivity: "base"
  });

  if (hasilSisi !== 0) {
    return hasilSisi;
  }

  return String(a.waktuInput || "").localeCompare(
    String(b.waktuInput || "")
  );
}

async function kirimPesanPanjang(chatId, isiPesan) {
  const batasKarakter = 3900;
  const semuaBaris = String(isiPesan).split("\n");

  const daftarPesan = [];
  let pesanSekarang = "";

  for (const baris of semuaBaris) {
    const pesanPercobaan = pesanSekarang
      ? `${pesanSekarang}\n${baris}`
      : baris;

    if (pesanPercobaan.length <= batasKarakter) {
      pesanSekarang = pesanPercobaan;
    } else {
      if (pesanSekarang) {
        daftarPesan.push(pesanSekarang);
      }

      pesanSekarang = baris;
    }
  }

  if (pesanSekarang) {
    daftarPesan.push(pesanSekarang);
  }

  for (let index = 0; index < daftarPesan.length; index += 1) {
    let judulBagian = "";

    if (daftarPesan.length > 1) {
      judulBagian =
        `Bagian ${index + 1}/${daftarPesan.length}\n\n`;
    }

    await bot.sendMessage(
      chatId,
      `${judulBagian}${daftarPesan[index]}`
    );
  }
}

async function tampilkanRekapHarian(chatId, tanggal) {
  const laporan = readJSON(LAPORAN_PATH, []);

  if (!Array.isArray(laporan)) {
    return bot.sendMessage(
      chatId,
      "❌ Format laporan_debit.json tidak valid. Data utama harus berupa array."
    );
  }

  const dataRekap = laporan
    .filter((item) => item && item.tanggal === tanggal)
    .sort(urutkanDataRekap);

  if (dataRekap.length === 0) {
    return bot.sendMessage(
      chatId,
      `📊 Tidak ada laporan debit pada tanggal ${tanggalIsoKeDisplay(tanggal)}.`
    );
  }

  const dataPagi = dataRekap.filter(
    (item) => item.periode === "pagi"
  );

  const dataSore = dataRekap.filter(
    (item) => item.periode === "sore"
  );

  const dataPeriodeLain = dataRekap.filter(
    (item) =>
      item.periode !== "pagi" &&
      item.periode !== "sore"
  );

  const jumlahDebitNol = dataRekap.filter(
    (item) => Number(item.dataAir?.Q || 0) === 0
  ).length;

  const jumlahDebitMengalir = dataRekap.filter(
    (item) => Number(item.dataAir?.Q || 0) > 0
  ).length;

  const akumulasiQ = dataRekap.reduce(
    (total, item) => {
      return total + Number(item.dataAir?.Q || 0);
    },
    0
  );

  const jumlahDenganFoto = dataRekap.filter(
    (item) => memilikiFoto(item)
  ).length;

  let hasil = `📊 REKAP HARIAN DEBIT 06-O
Tanggal: ${tanggalIsoKeDisplay(tanggal)}

RINGKASAN
• Jumlah laporan: ${dataRekap.length}
• Pagi: ${dataPagi.length} laporan
• Sore: ${dataSore.length} laporan
• Debit mengalir (Q > 0): ${jumlahDebitMengalir} titik
• Debit 0: ${jumlahDebitNol} titik
• Akumulasi nilai Q: ${formatAngka(akumulasiQ)} lt/dt
• Memiliki foto: ${jumlahDenganFoto} laporan
`;

  function tambahkanPeriode(judul, ikon, daftarData) {
    hasil += `\n${ikon} ${judul} — ${daftarData.length} laporan\n`;

    if (daftarData.length === 0) {
      hasil += "Belum ada data.\n";
      return;
    }

    daftarData.forEach((item, index) => {
      const namaLokasi =
        item.lokasi?.namaLengkap ||
        `${item.lokasi?.pintu || "-"} ${item.lokasi?.sisi || "-"}`;

      const nilaiH = formatAngka(item.dataAir?.H);
      const nilaiQ = formatAngka(item.dataAir?.Q);

      const satuanH = item.dataAir?.satuanH || "cm";
      const satuanQ = item.dataAir?.satuanQ || "lt/dt";

      const namaPetugas = item.petugas?.nama || "-";
      const waktuInput = item.waktuInput || "-";

      const statusFoto = memilikiFoto(item)
        ? "Ada"
        : "Tidak ada";

      const keterangan = String(
        item.keterangan || "-"
      ).trim();

      hasil += `\n${index + 1}. ${namaLokasi}\n`;
      hasil += `   H: ${nilaiH} ${satuanH} | Q: ${nilaiQ} ${satuanQ}\n`;
      hasil += `   Waktu: ${waktuInput} | Foto: ${statusFoto}\n`;
      hasil += `   Petugas: ${namaPetugas}\n`;

      if (keterangan && keterangan !== "-") {
        hasil += `   Keterangan: ${keterangan}\n`;
      }
    });
  }

  tambahkanPeriode("PAGI", "🌅", dataPagi);
  tambahkanPeriode("SORE", "🌇", dataSore);

  if (dataPeriodeLain.length > 0) {
    tambahkanPeriode(
      "PERIODE LAIN",
      "🕒",
      dataPeriodeLain
    );
  }

  hasil += "\n✅ Rekap selesai.";

  return kirimPesanPanjang(chatId, hasil);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function potongCaption(value, maksimal = 350) {
  const text = String(value || "-").trim();

  if (text.length <= maksimal) {
    return text;
  }

  return `${text.slice(0, maksimal - 3)}...`;
}

function resolveFotoLocalPath(fotoLocalPath) {
  if (!fotoLocalPath) {
    return null;
  }

  const nilaiPath = String(fotoLocalPath);

  return path.isAbsolute(nilaiPath)
    ? nilaiPath
    : path.join(__dirname, nilaiPath);
}

function buatCaptionDokumentasi(item) {
  const lokasi =
    item.lokasi?.namaLengkap ||
    `${item.lokasi?.pintu || "-"} ${
      item.lokasi?.sisi || "-"
    }`;

  const petugas = item.petugas?.nama || "-";

  const tanggal =
    item.tanggalDisplay ||
    tanggalIsoKeDisplay(item.tanggal);

  const waktu = item.waktuInput || "-";

  const keterangan = potongCaption(
    item.keterangan || "-"
  );

  if (item.sumberDokumentasi === "laporan") {
    const periode = String(
      item.periode || "-"
    ).toUpperCase();

    return `<b>📋 FOTO LAPORAN DEBIT 06-O</b>

<b>Tanggal:</b> ${escapeHtml(tanggal)}
<b>Waktu:</b> ${escapeHtml(waktu)}
<b>Periode:</b> ${escapeHtml(periode)}
<b>Lokasi:</b> ${escapeHtml(lokasi)}
<b>H:</b> ${escapeHtml(
      formatAngka(item.dataAir?.H)
    )} ${escapeHtml(
      item.dataAir?.satuanH || "cm"
    )}
<b>Q:</b> ${escapeHtml(
      formatAngka(item.dataAir?.Q)
    )} ${escapeHtml(
      item.dataAir?.satuanQ || "lt/dt"
    )}
<b>Petugas:</b> ${escapeHtml(petugas)}
<b>Keterangan:</b> ${escapeHtml(keterangan)}`;
  }

  const jenis = String(
    item.jenisDokumentasi || "lainnya"
  ).toUpperCase();

  return `<b>🖼️ DOKUMENTASI TAMBAHAN</b>

<b>Tanggal:</b> ${escapeHtml(tanggal)}
<b>Waktu:</b> ${escapeHtml(waktu)}
<b>Jenis:</b> ${escapeHtml(jenis)}
<b>Lokasi:</b> ${escapeHtml(lokasi)}
<b>Petugas:</b> ${escapeHtml(petugas)}
<b>Keterangan:</b> ${escapeHtml(keterangan)}`;
}

async function kirimFotoDokumentasi(
  chatId,
  item
) {
  const dokumentasi =
    item.dokumentasi || {};

  const telegramFileId =
    dokumentasi.telegramFileId;

  const fullLocalPath =
    resolveFotoLocalPath(
      dokumentasi.fotoLocalPath
    );

  const opsi = {
    caption: buatCaptionDokumentasi(item),
    parse_mode: "HTML"
  };

  // Coba kirim menggunakan Telegram file ID.
  if (telegramFileId) {
    try {
      await bot.sendPhoto(
        chatId,
        telegramFileId,
        opsi
      );

      return true;
    } catch (error) {
      console.error(
        "Gagal mengirim foto dari Telegram file ID:",
        item.id,
        error.message
      );
    }
  }

  // Jika file ID gagal, coba file lokal VPS.
  if (
    fullLocalPath &&
    fs.existsSync(fullLocalPath)
  ) {
    try {
      await bot.sendPhoto(
        chatId,
        fullLocalPath,
        opsi
      );

      return true;
    } catch (error) {
      console.error(
        "Gagal mengirim foto lokal:",
        item.id,
        error.message
      );
    }
  }

  return false;
}

function fotoBisaDikirim(item) {
  return Boolean(
    item?.dokumentasi?.telegramFileId ||
    item?.dokumentasi?.fotoLocalPath
  );
}

async function tampilkanDokumentasiPintu(
  chatId,
  kodePintu,
  sumber = "semua",
  user = null
) {
  const daftar = [];

  // Ambil foto yang melekat pada laporan debit
  if (
    sumber === "semua" ||
    sumber === "laporan"
  ) {
    const laporan = readJSON(
      LAPORAN_PATH,
      []
    );

    if (Array.isArray(laporan)) {
      laporan
        .filter((item) => {
          return (
            item?.lokasi?.pintu === kodePintu &&
            fotoBisaDikirim(item)
          );
        })
        .forEach((item) => {
          daftar.push({
            ...item,
            sumberDokumentasi: "laporan"
          });
        });
    }
  }

  // Ambil foto dari dokumentasi tambahan
  if (
    sumber === "semua" ||
    sumber === "tambahan"
  ) {
    const dokumentasiTambahan = readJSON(
      DOKUMENTASI_PATH,
      []
    );

    if (Array.isArray(dokumentasiTambahan)) {
      dokumentasiTambahan
        .filter((item) => {
          return (
            item?.lokasi?.pintu === kodePintu &&
            fotoBisaDikirim(item)
          );
        })
        .forEach((item) => {
          daftar.push({
            ...item,
            sumberDokumentasi: "tambahan"
          });
        });
    }
  }

  // Urutkan dari dokumentasi terbaru
   daftar.sort((a, b) => {
    const tanggalA =
      String(
        a.tanggal ||
        "1970-01-01"
      );

    const tanggalB =
      String(
        b.tanggal ||
        "1970-01-01"
      );

    const hasilTanggal =
      tanggalB.localeCompare(
        tanggalA
      );

    if (hasilTanggal !== 0) {
      return hasilTanggal;
    }

    const waktuA =
      String(
        a.waktuInput ||
        "00:00"
      );

    const waktuB =
      String(
        b.waktuInput ||
        "00:00"
      );

    return waktuB.localeCompare(
      waktuA
    );
  });

  const labelSumber = {
    semua: "Semua Dokumentasi",
    laporan: "Foto Laporan Debit",
    tambahan: "Dokumentasi Tambahan"
  }[sumber] || "Semua Dokumentasi";

  if (daftar.length === 0) {
    return bot.sendMessage(
      chatId,
      `🗂️ Tidak ada file dokumentasi yang dapat ditampilkan untuk ${kodePintu}.

Data yang hanya mempunyai penanda adaFoto, tetapi tidak memiliki telegramFileId atau fotoLocalPath, belum dapat dikirim.`,
      user
        ? mainReplyKeyboard(user.role)
        : {}
    );
  }

  const maksimalFoto = 10;

  const daftarDitampilkan = daftar.slice(
    0,
    maksimalFoto
  );

  await bot.sendMessage(
    chatId,
    `🗂️ ${labelSumber}

Pintu: ${kodePintu}
Total dokumentasi tersedia: ${daftar.length}
Ditampilkan: ${daftarDitampilkan.length} foto terbaru`
  );

  let berhasil = 0;
  let gagal = 0;

  for (const item of daftarDitampilkan) {
    const terkirim = await kirimFotoDokumentasi(
      chatId,
      item
    );

    if (terkirim) {
      berhasil += 1;
    } else {
      gagal += 1;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  }

  let hasil = `✅ Selesai menampilkan dokumentasi ${kodePintu}.

Berhasil dikirim: ${berhasil}
Gagal dikirim: ${gagal}`;

  if (daftar.length > maksimalFoto) {
    hasil += `

ℹ️ Masih ada ${
      daftar.length - maksimalFoto
    } dokumentasi lama yang tidak ditampilkan.`;
  }

  return bot.sendMessage(
    chatId,
    hasil,
    user
      ? mainReplyKeyboard(user.role)
      : {}
  );
}

function tampilkanLaporanHariIni(chatId) {
  const laporan = readJSON(LAPORAN_PATH, []);
  const today = getTodayDate();

  const dataHariIni = laporan.filter((x) => x.tanggal === today);

  if (dataHariIni.length === 0) {
    return bot.sendMessage(chatId, "Belum ada laporan debit hari ini.");
  }

  const pagi = dataHariIni.filter((x) => x.periode === "pagi");
  const sore = dataHariIni.filter((x) => x.periode === "sore");

  let text = `📌 *LAPORAN DEBIT HARI INI*
Tanggal: *${getTodayDisplay()}*

`;

  text += `🌅 *PAGI* — ${pagi.length} laporan\n`;

  pagi.forEach((item, index) => {
    const statusFoto = item.dokumentasi?.adaFoto ? "Ada" : "Tidak ada";

    text += `
${index + 1}. *${item.lokasi.namaLengkap}*
H: ${item.dataAir.H} cm | Q: ${item.dataAir.Q} lt/dt
Foto: ${statusFoto}
Petugas: ${item.petugas.nama}
`;
  });

  text += `\n🌇 *SORE* — ${sore.length} laporan\n`;

  sore.forEach((item, index) => {
    const statusFoto = item.dokumentasi?.adaFoto ? "Ada" : "Tidak ada";

    text += `
${index + 1}. *${item.lokasi.namaLengkap}*
H: ${item.dataAir.H} cm | Q: ${item.dataAir.Q} lt/dt
Foto: ${statusFoto}
Petugas: ${item.petugas.nama}
`;
  });

  return bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

console.log("Bot Debit PPA 06-O berjalan...");