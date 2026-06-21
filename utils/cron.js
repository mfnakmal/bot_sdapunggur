const cron = require('node-cron');
const { readJSON } = require('./db');

function initCronJobs(bot) {
  // Pagi jam 08:00
  cron.schedule('0 8 * * *', () => {
    broadcastReminder(bot, 'pagi');
  });

  // Sore jam 17:00
  cron.schedule('0 17 * * *', () => {
    broadcastReminder(bot, 'sore');
  });
}

function broadcastReminder(bot, periode) {
  const users = readJSON('data/users.json', {});
  const msg = `🔔 *REMINDER PENCATATAN DEBIT*\n\nHalo Bapak/Ibu PPA,\nWaktunya untuk mencatat debit air *${periode.toUpperCase()}*.\n\nSilakan buka menu "Catat Debit ${periode === 'pagi' ? 'Pagi' : 'Sore'}" untuk mulai melaporkan.`;

  for (const kodeLogin of Object.keys(users)) {
    const user = users[kodeLogin];
    if (user.aktif && user.telegramId) {
      // Send reminder non-blocking
      bot.sendMessage(user.telegramId, msg, { parse_mode: "Markdown" }).catch(err => {
        console.error(`Gagal mengirim reminder ke ${user.nama} (${user.telegramId}):`, err.message);
      });
    }
  }
}

module.exports = { initCronJobs };
