const fs = require('fs');

function generateRekayasa() {
    const file = './data/laporan_debit.json';
    let data = [];
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch(e) {
        console.warn("⚠️ File laporan_debit.json rusak atau gagal dibaca. Mereset ke file baru...");
        data = [];
    }

    const pintuData = JSON.parse(fs.readFileSync('./data/pintu.json', 'utf8'));
    
    const flowing = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-19"];
    const zero = ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"];
    const dates = [...flowing, ...zero].sort();
    
    // Flatten locations
    const locations = [];
    for (const pintu of pintuData) {
        for (const sisi of pintu.sisi) {
            locations.push({
                daerahIrigasi: "DI Punggur Utara",
                saluran: "Saluran Sekunder",
                pintu: pintu.nama,
                sisi: sisi,
                namaLengkap: `${pintu.nama} ${sisi}`
            });
        }
    }

    // Bersihkan data simulasi / rekayasa lama untuk tanggal 1-19 Juni
    let initialLength = data.length;
    data = data.filter(d => {
        const isRekayasa = d.keterangan.includes('rekayasa') || d.petugas.nama === "DATA SIMULASI" || d.id.includes('REKAYASA') || d.id.includes('-REK') || d.keterangan.includes('simulasi');
        if (d.tanggal >= "2026-06-01" && d.tanggal <= "2026-06-19" && isRekayasa) {
            return false;
        }
        return true;
    });
    console.log(`Menghapus ${initialLength - data.length} data rekayasa/simulasi lama...`);

    const usersData = JSON.parse(fs.readFileSync('./data/users.json', 'utf8'));
    const ppaList = Object.values(usersData).filter(u => u.role === 'ppa' && !u.nama.includes('ESTHA'));

    let generatedCount = 0;

    for (const tgl of dates) {
        const isFlowing = flowing.includes(tgl);
        const tglParts = tgl.split('-');
        const tglDisplay = `${tglParts[2]}-${tglParts[1]}-${tglParts[0]}`;

        for (const periode of ['pagi', 'sore']) {
            const waktu = periode === 'pagi' ? '08:00' : '17:00';

            for (const loc of locations) {
                const H = isFlowing ? Math.floor(Math.random() * 50) + 30 : Math.floor(Math.random() * 20) + 5;
                const Q = isFlowing ? Math.floor(Math.random() * 400) + 100 : 0;
                const ket = `Data rekayasa magang - Debit ${isFlowing ? 'Mengalir' : 'Mati'}`;
                
                // Pilih petugas random dari ppaList
                const randomPpa = ppaList[Math.floor(Math.random() * ppaList.length)];

                const id = `LAP-${tgl}-${periode}-${loc.pintu.replace(/ /g, '_')}-${loc.sisi.replace(/\./g, '_')}-REK`;
                data.push({
                    id,
                    jenisBlanko: "06-O",
                    tanggal: tgl,
                    tanggalDisplay: tglDisplay,
                    periode: periode,
                    waktuInput: waktu,
                    petugas: {
                        telegramId: randomPpa.telegramId,
                        nama: randomPpa.nama,
                        jabatan: randomPpa.jabatan,
                        role: randomPpa.role
                    },
                    lokasi: loc,
                    dataAir: { H, satuanH: "cm", Q, satuanQ: "lt/dt" },
                    dokumentasi: { adaFoto: false, telegramFileId: null, fotoLocalPath: null },
                    keterangan: ket,
                    status: "tersimpan",
                    createdAt: `${tgl}T${waktu}:00+07:00`
                });
                generatedCount++;
            }
        }
    }

    // Sort by Date & Time
    data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`✅ Rekayasa selesai!`);
    console.log(`- Dibuat baru: ${generatedCount} laporan`);
}

generateRekayasa();
