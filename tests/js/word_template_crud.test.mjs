import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordTemplateActions,
  buildWordTemplateFileLink,
  buildWordTemplateStatus,
} from "../../frontend/partners/PartnerView.js";
import {
  handleWordTemplateAvailabilityToggle,
  handleWordTemplateDelete,
  normalizeWordTemplateName,
  templateResourceUrl,
  validateWordTemplateName,
} from "../../frontend/documents/WordIntegration.js";

test("manager independently enables or pauses each Word template", () => {
  const enabled = buildWordTemplateStatus({
    filename: "bao-cao.docx",
    is_available: true,
    is_enabled: true,
  }, true);
  const paused = buildWordTemplateStatus({
    filename: "quyet-dinh.docx",
    is_available: true,
    is_enabled: false,
  }, true);

  assert.match(enabled, /btn-toggle-template-availability/);
  assert.match(enabled, /aria-pressed="true"/);
  assert.match(enabled, /Sẵn sàng/);
  assert.match(paused, /aria-pressed="false"/);
  assert.match(paused, /Tạm ngừng/);
  assert.match(paused, /Cho phép sử dụng biểu mẫu quyet-dinh\.docx/);
});

test("read-only user sees template availability without a toggle", () => {
  const html = buildWordTemplateStatus({
    filename: "bao-cao.docx",
    is_available: true,
    is_enabled: false,
  }, false);

  assert.doesNotMatch(html, /<button/);
  assert.match(html, /Tạm ngừng/);
});

test("system template actions do not expose legacy activation, edit or delete", () => {
  const html = buildWordTemplateActions({
    filename: "mau_bao_cao_dau_thau.docx",
    is_system: true,
    is_available: true,
    is_active: false,
  }, true);

  assert.doesNotMatch(html, /btn-activate-template/);
  assert.doesNotMatch(html, /btn-edit-template/);
  assert.doesNotMatch(html, /btn-delete-template/);
});

test("legacy default template actions include edit and delete", () => {
  const html = buildWordTemplateActions({
    filename: "mau_bao_cao_dau_thau.docx",
    is_system: false,
    is_mutable: true,
    is_available: true,
    is_active: false,
  }, true);

  assert.match(html, /btn-edit-template/);
  assert.match(html, /btn-delete-template/);
});

test("active template actions do not repeat the active status label", () => {
  const html = buildWordTemplateActions({
    filename: "bao_cao.docx",
    is_system: false,
    is_mutable: true,
    is_available: true,
    is_active: true,
  }, true);

  assert.doesNotMatch(html, /Đang dùng/);
  assert.doesNotMatch(html, /btn-activate-template/);
  assert.match(html, /btn-edit-template/);
  assert.match(html, /btn-delete-template/);
});

test("manager can edit and delete every ready custom template without activating one", () => {
  const html = buildWordTemplateActions({
    filename: "bao cao & quyet dinh.docx",
    is_system: false,
    is_available: true,
    is_active: false,
  }, true);

  assert.doesNotMatch(html, /btn-activate-template/);
  assert.match(html, /btn-edit-template/);
  assert.match(html, /btn-delete-template/);
  assert.match(html, /aria-label="Sửa biểu mẫu bao cao &amp; quyet dinh\.docx"/);
  assert.match(html, /aria-label="Xóa biểu mẫu bao cao &amp; quyet dinh\.docx"/);
  assert.doesNotMatch(html, /<\/i>\s*(?:Sử dụng|Sửa|Xóa)\s*<\/button>/);
  assert.doesNotMatch(html, /data-filename="bao cao & quyet dinh.docx"/);
});

test("template file column links to the scoped viewer in a new tab", () => {
  const html = buildWordTemplateFileLink({
    filename: "Báo cáo #1.docx",
    name: "Báo cáo #1.docx",
    is_available: true,
  });

  assert.match(html, /href="\/api\/templates\/B%C3%A1o%20c%C3%A1o%20%231\.docx"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/);
  assert.match(html, /data-word-template-display/);
});

test("organization employee cannot mutate a custom template", () => {
  const html = buildWordTemplateActions({
    filename: "bao_cao.docx",
    is_system: false,
    is_available: true,
    is_active: false,
  }, false);

  assert.doesNotMatch(html, /btn-activate-template/);
  assert.doesNotMatch(html, /btn-edit-template/);
  assert.doesNotMatch(html, /btn-delete-template/);
});

test("custom template URL encodes the complete filename", () => {
  assert.equal(
    templateResourceUrl("bao cao #1.docx"),
    "/api/templates/bao%20cao%20%231.docx",
  );
});

test("edited template names retain Unicode and receive the docx extension", () => {
  assert.equal(
    normalizeWordTemplateName(" Báo cáo lựa chọn nhà thầu "),
    "Báo cáo lựa chọn nhà thầu.docx",
  );
  assert.equal(validateWordTemplateName("Báo cáo lựa chọn nhà thầu"), "");
  assert.match(validateWordTemplateName("bad/name"), /không hợp lệ/);
});

test("availability toggle persists the independent enabled state", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      success: true,
      filename: "bao-cao.docx",
      enabled: false,
      revision: 9,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  let reloads = 0;
  const controller = {
    model: {
      state: {
        activerole: "manager",
        activeuser: {
          activeOrganizationId: "org-a",
          organizations: [{
            id: "org-a",
            name: "Đơn vị A",
            scope_type: "organization",
            role: "manager",
            status: "active",
          }],
        },
      },
    },
    view: { showToast() {}, customAlert: async () => {} },
    _wordPublicationTemplateConfig: { revision: 8 },
    loadWordTemplates: async () => { reloads += 1; },
  };

  try {
    const result = await handleWordTemplateAvailabilityToggle.call(
      controller,
      "bao-cao.docx",
      false,
    );
    assert.equal(result, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/templates/active");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    template_name: "bao-cao.docx",
    enabled: false,
    expectedRevision: 8,
  });
  assert.equal(reloads, 1);
});

test("duplicate delete gestures send only one request per template", async () => {
  const originalFetch = globalThis.fetch;
  let deleteRequests = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "DELETE") deleteRequests += 1;
    return new Response(JSON.stringify({ success: true, deleted: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const controller = {
    model: {
      state: {
        activerole: "manager",
        activeuser: {
          activeOrganizationId: "org-a",
          organizations: [{
            id: "org-a",
            name: "HCP",
            scope_type: "organization",
            role: "manager",
          }],
        },
      },
    },
    view: {
      customConfirm: async () => true,
      customAlert: async () => {},
    },
    loadWordTemplates: async () => {},
  };

  try {
    await Promise.all([
      handleWordTemplateDelete.call(controller, "Bìa E-HSMT.docx"),
      handleWordTemplateDelete.call(controller, "Bìa E-HSMT.docx"),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(deleteRequests, 1);
});
