const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const QUARTER_LABELS = ["I", "II", "III", "IV"];

const pad2 = (value) => String(value).padStart(2, "0");


export function createE2ETestClock({
  now = process.env.E2E_TEST_NOW || Date.now(),
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("E2E_TEST_NOW must be a valid instant.");
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  const anchorDay = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
  );
  const resolveDay = (offset) => {
    if (!Number.isInteger(offset)) throw new Error("Expected an integer day offset.");
    return new Date(anchorDay + offset * DAY_MS);
  };
  const date = (offset = 0) => {
    const value = resolveDay(offset);
    return `${pad2(value.getUTCDate())}/${pad2(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  };
  const normalizeTime = (time) => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(time));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new Error("Expected time in HH:MM format.");
    }
    return String(time);
  };
  const isoDate = (offset = 0) => {
    const value = resolveDay(offset);
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  };
  return Object.freeze({
    date,
    dateTime(offset = 0, time = "09:00") {
      return `${date(offset)} ${normalizeTime(time)}`;
    },
    isoDate,
    isoDateTime(offset = 0, time = "09:00") {
      return `${isoDate(offset)} ${normalizeTime(time)}:00`;
    },
    quarter(offset = 0) {
      const value = resolveDay(offset);
      const quarter = Math.floor(value.getUTCMonth() / 3);
      return `Quý ${QUARTER_LABELS[quarter]}/${value.getUTCFullYear()}`;
    },
  });
}
