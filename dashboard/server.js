const express = require('express');
const path = require('path');
const { readJSON } = require('../utils/db');

// Menggunakan Public IP yang telah dikonfigurasi
let publicUrl = "http://143.14.13.10:50120";

function getDashboardUrl() {
  return publicUrl;
}

function startDashboard(port = 3000) {
  const app = express();
  
  app.use(express.static(path.join(__dirname, 'public')));
  
  app.get('/api/data', (req, res) => {
    const data = readJSON('data/laporan_debit.json', []);
    res.json(data);
  });
  
  // Gunakan port 50120 secara langsung, dengarkan pada 0.0.0.0 untuk mengizinkan akses dari 10.10.10.55
  const dashboardPort = 50120;
  
  app.listen(dashboardPort, '0.0.0.0', () => {
    console.log(`🚀 Web Dashboard berjalan di port ${dashboardPort} (0.0.0.0)`);
    console.log(`🌐 Public URL (via NAT) tersedia di: ${publicUrl}`);
  });
}

module.exports = { startDashboard, getDashboardUrl };
