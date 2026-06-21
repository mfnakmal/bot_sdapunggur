const xlsx = require('xlsx');
const fs = require('fs');
const PDFDocument = require('pdfkit-table');

async function generateExcel(data, filePath) {
  // Map data to a simpler structure for Excel
  const rows = data.map((item, index) => ({
    No: index + 1,
    Tanggal: item.tanggalDisplay,
    Periode: item.periode.toUpperCase(),
    Pintu: item.lokasi?.namaLengkap || "-",
    "H (cm)": item.dataAir?.H || 0,
    "Q (lt/dt)": item.dataAir?.Q || 0,
    Petugas: item.petugas?.nama || "-",
    Keterangan: item.keterangan || "-"
  }));

  const worksheet = xlsx.utils.json_to_sheet(rows);
  
  // Set column widths
  worksheet['!cols'] = [
    { wch: 5 }, // No
    { wch: 15 }, // Tanggal
    { wch: 10 }, // Periode
    { wch: 25 }, // Pintu
    { wch: 10 }, // H
    { wch: 15 }, // Q
    { wch: 20 }, // Petugas
    { wch: 25 }  // Keterangan
  ];

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Laporan Debit");

  xlsx.writeFile(workbook, filePath);
  return filePath;
}

async function generatePDF(data, filePath) {
  return new Promise((resolve, reject) => {
    // Landscape format for better table fitting
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    
    doc.pipe(fs.createWriteStream(filePath))
       .on('finish', () => resolve(filePath))
       .on('error', reject);

    doc.fontSize(18).text('Laporan Debit SDA Punggur', { align: 'center' });
    doc.fontSize(12).text(`Jumlah Data: ${data.length}`, { align: 'center' });
    doc.moveDown();

    const tableArray = {
      headers: ["No", "Tanggal", "Periode", "Lokasi", "H (cm)", "Q (lt/dt)", "Petugas"],
      rows: data.map((item, index) => [
        String(index + 1),
        item.tanggalDisplay || "-",
        item.periode ? item.periode.toUpperCase() : "-",
        item.lokasi?.namaLengkap || "-",
        String(item.dataAir?.H || 0),
        String(item.dataAir?.Q || 0),
        item.petugas?.nama || "-"
      ])
    };

    doc.table(tableArray, {
      prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
      prepareRow: () => doc.font("Helvetica").fontSize(10)
    });

    doc.end();
  });
}

module.exports = { generateExcel, generatePDF };
