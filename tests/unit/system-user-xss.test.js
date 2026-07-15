import test from "node:test";
import assert from "node:assert/strict";

import { renderSystemUsersTable } from "../../frontend/admin/SystemUserView.js";
import { clearCommandArgsForTests } from "../../frontend/shared/commandArgs.js";

test("system user table renders untrusted fields only as escaped text", () => {
  clearCommandArgsForTests();
  const tbody = { innerHTML: "" };
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  globalThis.document = { getElementById: () => tbody };
  globalThis.lucide = { createIcons() {} };

  try {
    renderSystemUsersTable([{
      id: 'id\" onclick=\"alert(1)',
      username: '<svg onload="alert(1)">',
      name: "Tên <img src=x onerror=alert(1)>",
      email: 'x\" onmouseover=\"alert(1)@example.com',
      role: '<script>alert(1)</script>',
      package_id: "none",
      package_end_date: ""
    }], "another-user");

    assert.doesNotMatch(tbody.innerHTML, /<svg|<img|<script|["']\s+(?:onclick|onmouseover)=/);
    assert.match(tbody.innerHTML, /&lt;svg/);
    assert.match(tbody.innerHTML, /&lt;script/);
    assert.match(tbody.innerHTML, /data-arg-key="bf[a-z0-9]+"/);
    assert.doesNotMatch(tbody.innerHTML, /data-args=/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.lucide = previousLucide;
  }
});
