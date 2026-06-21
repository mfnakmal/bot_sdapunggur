const express = require('express');
const path = require('path');
const { readJSON } = require('../utils/db');

function startDashboard(port = 3000) {
  const app = express();
  
  app.use(express.static(path.join(__dirname, 'public')));
  
  app.get('/api/data', (req, res) => {
    const data = readJSON(path.join(__dirname, '../data/laporan_debit.json'), []);
    res.json(data);
  });
  
  app.listen(port, () => {
    console.log(`🚀 Web Dashboard berjalan di http://localhost:${port}`);
  });
}

module.exports = { startDashboard };
