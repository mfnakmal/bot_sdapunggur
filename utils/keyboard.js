function mainReplyKeyboard(role) {
  const keyboard = [
    ["🌅 Catat Debit Pagi", "🌇 Catat Debit Sore"],
    ["📌 Laporan Hari Ini", "📊 Rekap Harian"],
    ["🖼️ Upload Dokumentasi", "🗂️ Lihat Dokumentasi"],
    ["📆 Rekap Setengah Bulanan"],
    ["📤 Export Excel", "📄 Export PDF"],
    ["🌐 Web Dashboard", "👤 Profil Saya"],
    ["🚪 Logout"]
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

    if (
      row.length === 2 ||
      index === pintuList.length - 1
    ) {
      rows.push(row);
      row = [];
    }
  });

  rows.push([
    {
      text: "❌ Batal",
      callback_data: "batal"
    }
  ]);

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

function sisiKeyboard(pintu) {
  const rows = [];
  let row = [];

  pintu.sisi.forEach((sisi, index) => {
    row.push({
      text: sisi.toUpperCase(),
      callback_data: `sisi_${sisi}`
    });

    if (
      row.length === 2 ||
      index === pintu.sisi.length - 1
    ) {
      rows.push(row);
      row = [];
    }
  });

  rows.push([
    {
      text: "⬅️ Kembali",
      callback_data: "kembali_pilih_pintu"
    }
  ]);

  rows.push([
    {
      text: "❌ Batal",
      callback_data: "batal"
    }
  ]);

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

function fotoOpsionalKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📷 Upload Foto",
            callback_data: "upload_foto_opsional"
          },
          {
            text: "⏭️ Lewati Foto",
            callback_data: "skip_foto"
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
  };
}

function konfirmasiKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Simpan",
            callback_data: "simpan_laporan"
          },
          {
            text: "✏️ Edit",
            callback_data: "edit_laporan"
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
  };
}

function sumberDokumentasiKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🗂️ Semua Dokumentasi",
            callback_data: "lihat_dok_semua"
          }
        ],
        [
          {
            text: "📋 Foto Laporan Debit",
            callback_data: "lihat_dok_laporan"
          }
        ],
        [
          {
            text: "🖼️ Dokumentasi Tambahan",
            callback_data: "lihat_dok_tambahan"
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
  };
}

function modeUploadDokumentasiKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📷 Upload 1 Foto",
            callback_data: "dok_upload_tunggal"
          }
        ],
        [
          {
            text: "🖼️ Upload Banyak Foto",
            callback_data: "dok_upload_bulk"
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
  };
}

function selesaiUploadBulkKeyboard(
  jumlahFoto = 0
) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `✅ Selesai Upload (${jumlahFoto})`,
            callback_data: "dok_bulk_selesai"
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
  };
}

function jenisDokumentasiKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📷 Foto Pintu",
            callback_data: "dok_jenis_pintu"
          },
          {
            text: "🌊 Foto Saluran",
            callback_data: "dok_jenis_saluran"
          }
        ],
        [
          {
            text: "🛠️ Kerusakan",
            callback_data: "dok_jenis_kerusakan"
          },
          {
            text: "🧹 Pembersihan",
            callback_data: "dok_jenis_pembersihan"
          }
        ],
        [
          {
            text: "📝 Lainnya",
            callback_data: "dok_jenis_lainnya"
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
  };
}

function sisiDokumentasiKeyboard(pintu) {
  const rows = [];

  rows.push([
    {
      text: "📌 Umum / Semua Sisi",
      callback_data: "dok_sisi_umum"
    }
  ]);

  let row = [];

  pintu.sisi.forEach((sisi, index) => {
    row.push({
      text: sisi.toUpperCase(),
      callback_data: `dok_sisi_${sisi}`
    });

    if (
      row.length === 2 ||
      index === pintu.sisi.length - 1
    ) {
      rows.push(row);
      row = [];
    }
  });

  rows.push([
    {
      text: "⬅️ Kembali",
      callback_data: "dok_kembali_pilih_pintu"
    }
  ]);

  rows.push([
    {
      text: "❌ Batal",
      callback_data: "batal"
    }
  ]);

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

function exportBulanKeyboard(tipe) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📅 Bulan Ini",
            callback_data: `export_${tipe}_bulanini`
          }
        ],
        [
          {
            text: "🗂️ Semua Data",
            callback_data: `export_${tipe}_semua`
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
  };
}

module.exports = {
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
};