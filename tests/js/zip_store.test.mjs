import assert from "node:assert/strict";
import test from "node:test";
import { crc32, createStoredZip, uniqueZipEntryName } from "../../frontend/shared/zipStore.js";

async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const total = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = [];
  for (let index = 0; index < total; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const checksum = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const dataStart = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.slice(dataStart, dataStart + size);
    assert.equal(crc32(data), checksum);
    entries.push({ name, text: new TextDecoder().decode(data) });
    offset += 46 + nameLength;
  }
  return entries;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
});

test("stored zip keeps UTF-8 names and exact bytes for every entry", async () => {
  const archive = await createStoredZip([
    { name: "Hợp_đồng_01.docx", data: new Blob(["word-bytes"]) },
    { name: "Ket_qua_xuat_Word.txt", data: "Thành công: 1" },
  ], { now: new Date(2026, 10, 2, 9, 30) });
  assert.equal(archive.type, "application/zip");
  assert.deepEqual(await readZip(archive), [
    { name: "Hợp_đồng_01.docx", text: "word-bytes" },
    { name: "Ket_qua_xuat_Word.txt", text: "Thành công: 1" },
  ]);
  await assert.rejects(createStoredZip([{ name: "a", data: "1" }, { name: "a", data: "2" }]), TypeError);
});

test("entry names are unique, flat and safe", () => {
  const used = new Set();
  assert.equal(uniqueZipEntryName("Hop_dong_A.docx", used), "Hop_dong_A.docx");
  assert.equal(uniqueZipEntryName("hop_dong_a.docx", used), "hop_dong_a (2).docx");
  assert.equal(uniqueZipEntryName("../x/y:z.docx", used), ".._x_y_z.docx");
  assert.equal(uniqueZipEntryName("", used), "tai_lieu");
});
