const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const WIB_TIMEZONE = "Asia/Jakarta";

function nowJakarta() {
  return dayjs().tz(WIB_TIMEZONE);
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
  return nowJakarta().format(
    "YYYY-MM-DDTHH:mm:ssZ"
  );
}

module.exports = {
  nowJakarta,
  getTodayDate,
  getTodayDisplay,
  getTimeNow,
  getTimestamp
};