function mainReplyKeyboard(role) {
  const keyboard = [
    ["🌅 Catat Debit Pagi", "🌇 Catat Debit Sore"],
    ["📌 Laporan Hari Ini", "🖼️ Upload Dokumentasi"],
    ["📊 Rekap Harian", "📆 Rekap Setengah Bulanan"],
    ["📤 Export Excel", "📄 Export PDF"],
    ["👤 Profil Saya"]
  ];

  return {
    reply_markup: {
      keyboard,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function removeKeyboard() {
  return {
    reply_markup: {
      remove_keyboard: true
    }
  };
}

function pintuKeyboard(pintuList) {
  const rows = [];
  let row = [];

  pintuList.forEach((pintu, index) => {
    row.push({
      text: pintu.nama,
      callback_data: `pintu_${pintu.kode}`
    });

    if (row.length === 2 || index === pintuList.length - 1) {
      rows.push(row);
      row = [];
    }
  });

  rows.push([{ text: "❌ Batal", callback_data: "batal" }]);

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

function sisiKeyboard(pintu) {
  const rows = [];
  let row = [];

  pintu.sisi.forEach((s, index) => {
    row.push({
      text: s.toUpperCase(),
      callback_data: `sisi_${s}`
    });

    if (row.length === 2 || index === pintu.sisi.length - 1) {
      rows.push(row);
      row = [];
    }
  });

  rows.push([{ text: "⬅️ Kembali", callback_data: "kembali_pilih_pintu" }]);
  rows.push([{ text: "❌ Batal", callback_data: "batal" }]);

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

function konfirmasiKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Simpan", callback_data: "simpan_laporan" },
          { text: "✏️ Edit", callback_data: "edit_laporan" }
        ],
        [
          { text: "❌ Batal", callback_data: "batal" }
        ]
      ]
    }
  };
}

module.exports = {
  mainReplyKeyboard,
  removeKeyboard,
  pintuKeyboard,
  sisiKeyboard,
  konfirmasiKeyboard
};