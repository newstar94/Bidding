import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";

function openingTab(pkg) {
  return buildPackageTabs(pkg).tabs.find((tab) => tab.id === "opening" || tab.id === "opening_tech");
}

test("package opening tabs use icons matching their current meaning", () => {
  assert.deepEqual(
    openingTab({ trangThai: "Đã mở thầu", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ" }),
    { id: "opening", label: "Biên bản mở thầu", icon: "clipboard-signature" },
  );
  assert.deepEqual(
    openingTab({ trangThai: "Đang mời thầu", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ" }),
    { id: "opening", label: "Thông tin mời thầu", icon: "megaphone" },
  );
  assert.deepEqual(
    openingTab({ trangThai: "Đã mở thầu", phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" }),
    { id: "opening_tech", label: "Biên bản mở E-HSĐXKT", icon: "clipboard-signature" },
  );
  assert.deepEqual(
    openingTab({ trangThai: "Đã mở thầu", hinhThucLuaChon: "Chỉ định thầu rút gọn" }),
    { id: "opening", label: "Dữ liệu nhà thầu", icon: "users" },
  );
});

test("package opening detail exposes the Mua Sắm Công import action", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/detail/OpeningPanel.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /id="btn-mothau-import-msc"/u);
  assert.match(source, /data-lucide="cloud-download"/u);
  assert.match(source, /mothau-opening-actions/u);
  assert.doesNotMatch(source, /mothau-import-msc-description/u);
});
