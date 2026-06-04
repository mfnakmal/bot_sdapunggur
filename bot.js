require("dotenv").config();

const { scheduleBackup } = require("./utils/gitBackup");
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
  fotoOpsionalKeyboard
} = require("./utils/keyboard");

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("BOT_TOKEN belum diisi di file .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const USERS_PATH = "data/users.json";
const PINTU_PATH = "data/pintu.json";
const LAPORAN_PATH = "data/laporan_debit.json";
const SESSIONS_PATH = "data/sessions.json";

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



  if (data.startsWith("pintu_")) {
    const kodePintu = data.replace("pintu_", "");
    const pintuList = readJSON(PINTU_PATH, []);
    const pintu = pintuList.find((p) => p.kode === kodePintu);

    if (!pintu) {
      return bot.sendMessage(chatId, "Pintu tidak ditemukan.");
    }

    const session = getSession(chatId);

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

  if (data === "simpan_laporan") {
    const session = getSession(chatId);

    if (!session || !session.preview) {
      return bot.sendMessage(chatId, "Tidak ada data yang bisa disimpan.");
    }

    const laporan = readJSON(LAPORAN_PATH, []);
    laporan.push(session.preview);
    writeJSON(LAPORAN_PATH, laporan);

    clearSession(chatId);

    return bot.sendMessage(
      chatId,
      `✅ Laporan berhasil disimpan.

ID Laporan:
${session.preview.id}`,
      mainReplyKeyboard(user.role)
    );
  }

  if (data === "laporan_hari_ini") {
    return tampilkanLaporanHariIni(chatId);
  }

  if (data === "rekap_harian") {
    return bot.sendMessage(chatId, "📊 Fitur rekap harian kita buat di tahap berikutnya.");
  }

  if (data === "export_menu") {
    return bot.sendMessage(chatId, "📤 Fitur export Excel/PDF kita buat di tahap berikutnya.");
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  if (msg.text && msg.text.startsWith("/")) {
    return;
  }

const text = String(msg.text || "").trim();

if (text === "🌅 Catat Debit Pagi") {
  return mulaiCatatDebit(chatId, "pagi");
}

if (text === "🌇 Catat Debit Sore") {
  return mulaiCatatDebit(chatId, "sore");
}

if (text === "📌 Laporan Hari Ini") {
  return tampilkanLaporanHariIni(chatId);
}

if (text === "🖼️ Upload Dokumentasi") {
  return bot.sendMessage(chatId, "🖼️ Fitur upload dokumentasi tambahan kita buat setelah fitur catat debit utama selesai.");
}

if (text === "📊 Rekap Harian") {
  return bot.sendMessage(chatId, "📊 Fitur rekap harian kita buat di tahap berikutnya.");
}

if (text === "📆 Rekap Setengah Bulanan") {
  return bot.sendMessage(chatId, "📆 Fitur rekap setengah bulanan kita buat di tahap berikutnya.");
}

if (text === "📤 Export Excel") {
  return bot.sendMessage(chatId, "📤 Fitur export Excel kita buat setelah database laporan sudah aman.");
}

if (text === "📄 Export PDF") {
  return bot.sendMessage(chatId, "📄 Fitur export PDF kita buat setelah export Excel selesai.");
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

  const session = getSession(chatId);
  const user = getUserByTelegramId(telegramId);

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
    writeJSON(USERS_PATH, users);

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

  if (!user) {
    return bot.sendMessage(chatId, "Kamu belum login. Ketik /start untuk login.");
  }

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

    const laporanId = `LAP-${tanggal}-${periode}-${sanitizeFileName(session.pintu)}-${sanitizeFileName(session.sisi)}-${Date.now()}`;

    const preview = {
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
      dokumentasi: {
        adaFoto: true,
        telegramFileId: "...",
        fotoLocalPath: "uploads/..."
      },
      keterangan: "-",
      status: "tersimpan",
      createdAt: getTimestamp()
    };

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

Simpan laporan ini?`,
      {
        parse_mode: "Markdown",
        ...konfirmasiKeyboard()
      }
    );
  }
});

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