import test from "node:test";
import assert from "node:assert/strict";

import { renderManagerHoSoGiayPanel } from "../../frontend/admin/SystemUserView.js";

test("custom paper status panel trusts the tenant-scoped collection without a fake org filter", () => {
  const tbody = { innerHTML: "" };
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  globalThis.document = {
    getElementById(id) {
      return id === "manager-hosogiay-tbody" ? tbody : null;
    }
  };
  globalThis.lucide = { createIcons() {} };

  try {
    renderManagerHoSoGiayPanel.call({
      model: {
        state: {
          custompaperstatuses: [{
            id: "hsg-server",
            organizationId: "org-real",
            name: "Đã nhận hồ sơ",
            color: "#2563eb"
          }]
        }
      }
    });

    assert.match(tbody.innerHTML, /Đã nhận hồ sơ/);
    assert.match(tbody.innerHTML, /data-arg-key="bf/);
    assert.doesNotMatch(tbody.innerHTML, /Chưa cấu hình/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.lucide = previousLucide;
  }
});

test("custom paper status panel escapes server-provided display fields", () => {
  const tbody = { innerHTML: "" };
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  globalThis.document = { getElementById: () => tbody };
  globalThis.lucide = { createIcons() {} };

  try {
    renderManagerHoSoGiayPanel.call({
      model: {
        state: {
          custompaperstatuses: [{
            id: "hsg-\" onclick=\"alert(1)",
            organizationId: "org-real",
            name: "<img src=x onerror=alert(1)>",
            color: "red;position:fixed"
          }]
        }
      }
    });

    assert.doesNotMatch(tbody.innerHTML, /<img/);
    assert.match(tbody.innerHTML, /&lt;img/);
    assert.match(tbody.innerHTML, /background-color: #64748b/);
    assert.match(tbody.innerHTML, /data-arg-key="bf/);
    assert.doesNotMatch(tbody.innerHTML, /onclick=/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.lucide = previousLucide;
  }
});
