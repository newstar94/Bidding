import assert from "node:assert/strict";
import { validateXlsxArchiveBytes } from "../frontend/documents/excelArchiveGuard.js";

const encoder = new TextEncoder();

function uint16(target, offset, value) {
  new DataView(target.buffer).setUint16(offset, value, true);
}

function uint32(target, offset, value) {
  new DataView(target.buffer).setUint32(offset, value, true);
}

function makeArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressedSize = entry.compressedSize ?? 8;
    const uncompressedSize = entry.uncompressedSize ?? compressedSize;
    const flags = (entry.flags ?? 0) | 0x0800;
    const local = new Uint8Array(30 + name.length + compressedSize);
    uint32(local, 0, 0x04034b50);
    uint16(local, 4, 20);
    uint16(local, 6, flags);
    uint16(local, 8, 0);
    uint32(local, 18, compressedSize);
    uint32(local, 22, uncompressedSize);
    uint16(local, 26, name.length);
    local.set(name, 30);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    uint32(central, 0, 0x02014b50);
    uint16(central, 4, 20);
    uint16(central, 6, 20);
    uint16(central, 8, flags);
    uint16(central, 10, 0);
    uint32(central, 20, compressedSize);
    uint32(central, 24, uncompressedSize);
    uint16(central, 28, name.length);
    uint32(central, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const eocd = new Uint8Array(22);
  uint32(eocd, 0, 0x06054b50);
  uint16(eocd, 8, entries.length);
  uint16(eocd, 10, entries.length);
  uint32(eocd, 12, centralSize);
  uint32(eocd, 16, localOffset);

  const result = new Uint8Array(localOffset + centralSize + eocd.length);
  let offset = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    result.set(part, offset);
    offset += part.length;
  }
  return result.buffer;
}

const required = [
  { name: "[Content_Types].xml" },
  { name: "xl/workbook.xml" },
];

assert.doesNotThrow(() => validateXlsxArchiveBytes(makeArchive(required)));

const rejected = [
  [{ name: "[Content_Types].xml" }, { name: "xl/workbook.xml", compressedSize: 1, uncompressedSize: 101 }],
  [{ name: "[Content_Types].xml" }, { name: "xl/workbook.xml" }, { name: "../evil.xml" }],
  [{ name: "[Content_Types].xml" }, { name: "xl/workbook.xml" }, { name: "XL/WORKBOOK.XML" }],
  [{ name: "[Content_Types].xml", flags: 1 }, { name: "xl/workbook.xml" }],
  [{ name: "[Content_Types].xml" }, { name: "xl/workbook.xml" }, { name: "xl/externalLinks/link1.xml" }],
  [{ name: "xl/workbook.xml" }],
];
for (const entries of rejected) {
  assert.throws(() => validateXlsxArchiveBytes(makeArchive(entries)));
}

const malformed = new ArrayBuffer(10 * 1024 * 1024);
const startedAt = performance.now();
assert.throws(() => validateXlsxArchiveBytes(malformed));
assert.ok(performance.now() - startedAt < 1_000, "malformed archive validation must remain bounded");

process.stdout.write("Excel archive guard: safe archive accepted; zip bomb, traversal, duplicate, encryption, external link and malformed inputs rejected.\n");
