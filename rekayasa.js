const fs = require('fs');
const path = require('./data/laporan_debit.json'); // We will read directly

function generateRekayasa() {
    const file = './data/laporan_debit.json';
    let data = [];
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch(e) {
        console.error("Gagal membaca laporan_debit.json");
        return;
    }

    const pintuData = JSON.parse(fs.readFileSync('./data/pintu.json', 'utf8'));
    
    const flowing = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-19"];
    const zero = ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"];
    const dates = [...flowing, ...zero].sort();
    
    // Flatten locations
    const locations = [];
    for (const di in pintuData) {
        for (const saluran in pintuData[di]) {
            for (const namaPintu in pintuData[di][saluran]) {
                for (const sisi of pintuData[di][saluran][namaPintu]) {
                    locations.push({
                        daerahIrigasi: di,
                        saluran: saluran,
                        pintu: namaPintu,
                        sisi: sisi,
                        namaLengkap: `${namaPintu} ${sisi}`
                    });
                }
            }
        }
    }

    let generatedCount = 0;
    let modifiedCount = 0;

    for (const tgl of dates) {
        const isFlowing = flowing.includes(tgl);
        const tglParts = tgl.split('-');
        const tglDisplay = `${tglParts[2]}-${tglParts[1]}-${tglParts[0]}`;

        for (const periode of ['pagi', 'sore']) {
            const waktu = periode === 'pagi' ? '08:00' : '17:00';

            for (const loc of locations) {
                const existingIndex = data.findIndex(d => d.tanggal === tgl && d.periode === periode && d.lokasi.namaLengkap === loc.namaLengkap);
                
                const H = isFlowing ? Math.floor(Math.random() * 50) + 30 : Math.floor(Math.random() * 20) + 5;
                const Q = isFlowing ? Math.floor(Math.random() * 400) + 100 : 0;
                const ket = `Data rekayasa magang - Debit ${isFlowing ? 'Mengalir' : 'Mati'}`;

                if (existingIndex !== -1) {
                    data[existingIndex].dataAir.H = H;
                    data[existingIndex].dataAir.Q = Q;
                    data[existingIndex].keterangan = ket;
                    modifiedCount++;
                } else {
                    const id = `LAP-${tgl}-${periode}-${loc.pintu.replace(/ /g, '_')}-${loc.sisi.replace(/\./g, '_')}-REK`;
                    data.push({
                        id,
                        jenisBlanko: "06-O",
                        tanggal: tgl,
                        tanggalDisplay: tglDisplay,
                        periode: periode,
                        waktuInput: waktu,
                        petugas: { telegramId: null, nama: "DATA SIMULASI", jabatan: "PPA", role: "ppa" },
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
    }

    // Sort by Date & Time
    data.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`✅ Rekayasa selesai!`);
    console.log(`- Dimodifikasi: ${modifiedCount} laporan`);
    console.log(`- Dibuat baru: ${generatedCount} laporan`);
}

generateRekayasa();
