import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const modalPath = fileURLToPath(new URL("../../views/modals/modal_kehoach.html", import.meta.url));

test("plan form requires every field enforced by backend plan validation", async () => {
  const html = await readFile(modalPath, "utf8");
  const requiredIds = [
    "kh-ngaypheduyet",
    "kh-quyetdinh",
    "kh-ngaytrinhkehoach",
    "kh-ngaytrinhdutoan",
    "kh-ngaypheduyetdutoan",
    "kh-quyetdinhpheduyetdutoan",
    "kh-maduan",
    "kh-soqdpheduyetduan",
    "kh-ngayqdpheduyetduan",
    "kh-coquanpheduyetduan"
  ];

  for (const id of requiredIds) {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(input, `missing #${id}`);
    assert.match(input, /\brequired\b/, `#${id} must be required`);
  }
});
