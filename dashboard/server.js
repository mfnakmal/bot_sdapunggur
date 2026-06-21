const express = require('express');
const path = require('path');
const { readJSON } = require('../utils/db');
const localtunnel = require('localtunnel');

let publicUrl = "Sedang menghubungkan ke server...";

function getDashboardUrl() {
  return publicUrl;
}

function startDashboard(port = 3000) {
  const app = express();
  
  app.use(express.static(path.join(__dirname, 'public')));
  
  app.get('/api/data', (req, res) => {
    const data = readJSON(path.join(__dirname, '../data/laporan_debit.json'), []);
    res.json(data);
  });
  
  app.listen(port, '127.0.0.1', async () => {
    console.log(`🚀 Web Dashboard berjalan di lokal port ${port}`);
    try {
      // Create a tunnel to bypass NAT VPS Firewalls
      const tunnel = await localtunnel({ port: port });
      publicUrl = tunnel.url;
      console.log(`🌐 Public URL tersedia di: ${publicUrl}`);
      
      tunnel.on('close', () => {
        console.log('Terputus dari localtunnel');
      });
      tunnel.on('error', (err) => {
        console.error('Localtunnel error:', err);
      });
    } catch (e) {
      console.error("Gagal membuat tunnel:", e);
      publicUrl = "Gagal membuat public link. Coba restart bot.";
    }
  });
}

module.exports = { startDashboard, getDashboardUrl };
