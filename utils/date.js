const dayjs = require("dayjs");

function nowJakarta() {
  return dayjs().add(7, "hour");
}

function getTodayDate() {
  return nowJakarta().format("YYYY-MM-DD");
}

function getTodayDisplay() {
  return nowJakarta().format("DD-MM-YYYY");
}

function getTimeNow() {
  return nowJakarta().format("HH:mm");
}

function getTimestamp() {
  return nowJakarta().format("YYYY-MM-DDTHH:mm:ss+07:00");
}

module.exports = {
  nowJakarta,
  getTodayDate,
  getTodayDisplay,
  getTimeNow,
  getTimestamp
};