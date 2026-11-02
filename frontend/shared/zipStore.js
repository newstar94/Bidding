// Minimal ZIP writer using the STORE method. DOCX/ZIP payloads are already
// deflated, so storing them avoids a compression dependency. Entry bodies stay
// as Blobs (disk-backed in browsers); only one entry is read at a time for CRC.

const MAX_ZIP32 = 0xFFFFFFFF;
const MAX_ENTRIES = 0xFFFF;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Give each name a unique, path-free spelling inside one archive. */
export function uniqueZipEntryName(name, used) {
  const printable = [...String(name || "")].map((char) => (char.charCodeAt(0) < 32 ? "_" : char)).join("");
  const clean = printable.replace(/[\\/:*?"<>|]+/gu, "_").trim() || "tai_lieu";
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = dot > 0 ? clean.slice(dot) : "";
  let candidate = clean;
  for (let counter = 2; used.has(candidate.toLocaleLowerCase("vi")); counter += 1) {
    candidate = `${stem} (${counter})${extension}`;
  }
  used.add(candidate.toLocaleLowerCase("vi"));
  return candidate;
}

/** Build a ZIP Blob from `{ name, data }` entries (data: Blob, string or bytes). */
export async function createStoredZip(entries, { now = new Date() } = {}) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new RangeError("Số tệp vượt giới hạn của tệp ZIP.");
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(now);
  const names = new Set();
  const body = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;
  for (const entry of entries) {
    const name = String(entry?.name || "");
    if (!name || names.has(name)) throw new TypeError("Tên tệp trong ZIP bị trống hoặc trùng.");
    names.add(name);
    const nameBytes = encoder.encode(name);
    const data = entry.data instanceof Blob ? entry.data : new Blob([entry.data ?? ""]);
    const checksum = crc32(new Uint8Array(await data.arrayBuffer()));
    const size = data.size;
    if (offset + 30 + nameBytes.length + size > MAX_ZIP32) throw new RangeError("Tổng dung lượng vượt giới hạn 4 GB của tệp ZIP.");

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    body.push(local.buffer, nameBytes, data);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, checksum, true);
    record.setUint32(20, size, true);
    record.setUint32(24, size, true);
    record.setUint16(28, nameBytes.length, true);
    record.setUint32(38, 0, true);
    record.setUint32(42, offset, true);
    central.push(record.buffer, nameBytes);
    offset += 30 + nameBytes.length + size;
    centralSize += 46 + nameBytes.length;
  }
  if (offset + centralSize > MAX_ZIP32) throw new RangeError("Tổng dung lượng vượt giới hạn 4 GB của tệp ZIP.");
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...body, ...central, end.buffer], { type: "application/zip" });
}
