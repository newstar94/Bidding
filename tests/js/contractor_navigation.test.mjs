import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  resolveLatestNhaThauVersionId,
  showNhaThauDetails,
} from "../../frontend/partners/NhaThauComponent.js";

test("contractor navigation resolves an opening snapshot to the latest complete version", () => {
  const model = {
    state: {
      nhathau: [
        {
          id: "nt-v0",
          rootId: "nt-root",
          phienBan: "00",
          isLatest: 0,
          maNhaThau: "VN4401034451",
          tenNhaThau: "Công ty thử",
        },
        {
          id: "nt-v1",
          rootId: "nt-root",
          phienBan: "01",
          isLatest: 1,
          maNhaThau: "VN4401034451",
          tenNhaThau: "Công ty thử",
          nguoiDaiDien: "Nguyễn Văn A",
          diaChi: "Địa chỉ đầy đủ",
        },
      ],
    },
  };

  assert.equal(resolveLatestNhaThauVersionId(model, "nt-v0"), "nt-v1");
});

test("contractor details load a missing paginated record before rendering", async () => {
  const originalDocument = globalThis.document;
  const rendered = [];
  globalThis.document = {
    getElementById(id) {
      return id === "tab-nhathau-detail"
        ? { classList: { contains: () => true } }
        : null;
    },
  };
  try {
    const controller = {
      model: { state: { nhathau: [] } },
      async ensureDetailRecordLoaded() {
        controller.model.state.nhathau.push({ id: "nt-loaded", isLatest: 1 });
        return { id: "nt-loaded" };
      },
      renderNhaThauVersionDetails(id) { rendered.push(id); },
    };
    await showNhaThauDetails.call(controller, "nt-missing");
  } finally {
    globalThis.document = originalDocument;
  }
  assert.deepEqual(rendered, ["nt-loaded"]);
});

test("contractor detail navigation keeps the record-loading seam", () => {
  const source = fs.readFileSync("frontend/partners/NhaThauComponent.js", "utf8");
  assert.match(source, /ensureDetailRecordLoaded\("nhathau-detail", resolvedId\)/);
});
