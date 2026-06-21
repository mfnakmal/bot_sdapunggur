function generateChartUrl(dataRekap, rentangNama) {
  // dataRekap is expected to be grouped by Date or Location
  // For a basic chart, let's show Total Q per day
  const labels = [];
  const qData = [];

  // Assuming dataRekap is an array of objects: { tanggal: '2026-06-01', totalQ: 100 }
  dataRekap.forEach(item => {
    labels.push(item.tanggal);
    qData.push(item.totalQ);
  });

  const chartConfig = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Total Q (lt/dt)',
        data: qData,
        fill: false,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      }]
    },
    options: {
      title: {
        display: true,
        text: `Grafik Debit Air - ${rentangNama}`
      }
    }
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedConfig}&w=600&h=400`;
}

module.exports = { generateChartUrl };
