import assert from "node:assert/strict";
import test from "node:test";
import { bindInvitationImportAction } from "../../frontend/packages/detail/InvitationImportAction.js";
import { updateServerCapabilitiesFromSession, invalidateServerCapabilities } from "../../frontend/auth/serverCapabilities.js";
import { packageWorkspaceFor } from "../../frontend/packages/detail/PackageWorkspaceState.js";

function editorFixture() {
  updateServerCapabilitiesFromSession({ valid: true, user: { id: "actor" }, serverCapabilities: ["procurement-lookup-v1"] });
  const pkg = { id: "package", tenGoiThau: "Gói A", maGoiThau: "IB2600271825", phienBan: 0, rowVersion: 1 };
  const model = {
    state: { activeuser: { id: "actor" }, goithau: [pkg] },
    hasPermission: () => true,
    formatForDatetimeLocal: (value) => value,
  };
  const view = { model, _biddingInfoEditMode: true, _currentWorkflowPackageId: pkg.id };
  const button = { disabled: false, setAttribute() {}, removeAttribute() {}, focus() {} };
  const status = { textContent: "" };
  const container = {
    dataset: {},
    contains: (node) => node === button,
    querySelector: (selector) => selector === "#btn-invitation-import-msc" ? button : status,
    querySelectorAll: () => [],
  };
  const loads = [];
  const loadScopes = [];
  const controller = {
    _loadYeuCauLamRoRows: (rows, root) => { loads.push(["request", rows]); loadScopes.push(root); },
    _loadTraLoiLamRoRows: (rows, root) => { loads.push(["response", rows]); loadScopes.push(root); },
    _loadGiaHanRows: (rows, root) => { loads.push(["extension", rows]); loadScopes.push(root); },
  };
  let loadingClosed = 0;
  const beginLoading = async () => ({ close: async () => { loadingClosed += 1; } });
  return { pkg, model, view, button, status, container, controller, loads, loadScopes, beginLoading, closed: () => loadingClosed };
}

test("manual pull fills only editor, marks dirty and requires explicit save", async () => {
  const f = editorFixture();
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: f.beginLoading,
      lookup: async () => ({ revision: {
        clarificationAvailable: true,
        clarificationRequests: [{ requestedAt: "2026-06-15T17:56:51", content: "Kỹ thuật\nCâu hỏi" }],
        clarificationResponses: [{ respondedAt: "2026-06-16T14:12:05", content: "Trả lời\nĐầy đủ" }],
      } }),
    });
    await f.button.onclick();
    assert.equal(f.loads.length, 2);
    assert.deepEqual(f.loadScopes, [f.container, f.container]);
    assert.equal(f.loads[1][1][0].noiDungTraLoi, "Trả lời\nĐầy đủ");
    assert.equal(f.pkg.yeuCauLamRoList, undefined);
    assert.equal(packageWorkspaceFor(f.view).isDirty(), true);
    assert.match(f.status.textContent, /bấm Lưu/);
    assert.equal(f.closed(), 1);
    assert.equal(f.model._workspaceRequestControllers.size, 0);
  } finally { invalidateServerCapabilities(); }
});

test("duplicate clicks issue one lookup and detached panel ignores response", async () => {
  const f = editorFixture();
  try {
    let resolveLookup;
    let lookupCalls = 0;
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: f.beginLoading,
      lookup: () => { lookupCalls += 1; return new Promise((resolve) => { resolveLookup = resolve; }); },
    });
    const first = f.button.onclick();
    await Promise.resolve();
    await f.button.onclick();
    assert.equal(lookupCalls, 1);
    f.container.contains = () => false;
    resolveLookup({ revision: { clarificationAvailable: true, clarificationRequests: [{ requestedAt: "2026-06-15", content: "Q" }], clarificationResponses: [] } });
    await first;
    assert.deepEqual(f.loads, []);
    assert.equal(f.status.textContent, "");
    assert.equal(f.button.disabled, false);
    assert.equal(f.closed(), 1);
  } finally { invalidateServerCapabilities(); }
});

test("unavailable and empty results preserve existing editor rows", async () => {
  for (const available of [false, true]) {
    const f = editorFixture();
    try {
      bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
        beginLoading: f.beginLoading,
        lookup: async () => ({ revision: { clarificationAvailable: available, clarificationRequests: [], clarificationResponses: [] } }),
      });
      await f.button.onclick();
      assert.deepEqual(f.loads, []);
      assert.equal(packageWorkspaceFor(f.view).isDirty(), false);
      assert.match(f.status.textContent, /giữ nguyên/);
    } finally { invalidateServerCapabilities(); }
  }
});

test("workspace switch suppresses returned data and releases loading", async () => {
  const f = editorFixture();
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: f.beginLoading,
      lookup: async () => {
        f.model.state = { goithau: [] };
        return { revision: { clarificationAvailable: true, clarificationRequests: [{ requestedAt: "2026-06-15", content: "Q" }], clarificationResponses: [] } };
      },
    });
    await f.button.onclick();
    assert.deepEqual(f.loads, []);
    assert.equal(f.status.textContent, "");
    assert.equal(f.closed(), 1);
  } finally { invalidateServerCapabilities(); }
});

test("clarification and extension availability are independent and import only into the editor", async () => {
  for (const clarificationAvailable of [false, true]) {
    const f = editorFixture();
    try {
      bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
        beginLoading: f.beginLoading,
        lookup: async () => ({ revision: {
          clarificationAvailable, extensionAvailable: true,
          clarificationRequests: [{ requestedAt: "2026-06-15T17:56:51", content: "Câu hỏi" }],
          clarificationResponses: [],
          extensions: [{ sourceExtensionId: "extension-1", newClosingAt: "2026-06-25T09:00:00", reason: "Lý do\nĐầy đủ" }],
        } }),
      });
      await f.button.onclick();
      assert.deepEqual(f.loads.map(([kind]) => kind), clarificationAvailable ? ["request", "extension"] : ["extension"]);
      const extension = f.loads.at(-1)[1][0];
      assert.equal(extension.thoiGianDongThau, "2026-06-25T09:00:00");
      assert.equal(extension.lyDoGiaHan, "Lý do\nĐầy đủ");
      assert.equal(f.pkg.giaHanList, undefined);
      assert.equal(f.container.dataset.invitationHistoryImported, "true");
      assert.ok(f.loadScopes.every((root) => root === f.container));
      assert.equal(packageWorkspaceFor(f.view).isDirty(), true);
      assert.match(f.status.textContent, /1 lần gia hạn/);
      assert.match(f.status.textContent, /bấm Lưu/);
      if (!clarificationAvailable) assert.match(f.status.textContent, /Chưa lấy được dữ liệu làm rõ/);
    } finally { invalidateServerCapabilities(); }
  }
});

test("unavailable or null extension sources never replace manual editor rows", async () => {
  for (const extensions of [null, [], [{ newClosingAt: "2026-06-25T09:00:00", reason: "Not authoritative" }]]) {
    const f = editorFixture();
    try {
      f.container.querySelectorAll = (selector) => selector === "#gt-giahan-tbody tr" ? [{
        getAttribute: (name) => name === "data-id" ? "manual-extension" : "",
        querySelector: (selector) => ({ value: selector === ".gh-time-input" ? "" : "Đang nhập" }),
      }] : [];
      bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
        beginLoading: f.beginLoading,
        lookup: async () => ({ revision: {
          clarificationAvailable: true, clarificationRequests: [], clarificationResponses: [],
          extensionAvailable: false, extensionStatus: "SOURCE_UNAVAILABLE", extensions,
        } }),
      });
      await f.button.onclick();
      assert.deepEqual(f.loads, []);
      assert.equal(packageWorkspaceFor(f.view).isDirty(), false);
      assert.match(f.status.textContent, /Chưa lấy được dữ liệu gia hạn/);
    } finally { invalidateServerCapabilities(); }
  }
});

test("partial history fills older rows while reporting the unavailable 02 group and failed detail", async () => {
  const f = editorFixture();
  const stages = [];
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: async () => ({ close: async () => {}, update: async (key) => stages.push(key) }),
      lookup: async () => ({
        revision: {
          clarificationAvailable: true, clarificationStatus: "PARTIAL_HISTORY",
          clarificationRequests: [{ sourceRequestNo: "CID2600012555", requestedAt: "2026-09-19T11:55:01", content: "Yêu cầu về kỹ thuật\nChi tiết tại file đính kèm" }],
          clarificationResponses: [], extensionAvailable: true, extensions: [],
        },
        history: {
          missingRevisions: ["00"],
          revisions: [
            { revisionNumber: "01", clarificationAvailable: true, extensionAvailable: true },
            { revisionNumber: "02", clarificationAvailable: false, extensionAvailable: false },
          ],
        },
      }),
    });
    await f.button.onclick();
    assert.equal(f.loads.length, 1);
    assert.match(f.status.textContent, /Đã thêm 1 yêu cầu/);
    assert.match(f.status.textContent, /làm rõ ở phiên bản 02/);
    assert.match(f.status.textContent, /chi tiết phiên bản 00/);
    assert.match(f.status.textContent, /bấm Lưu/);
    assert.deepEqual(stages, ["merge"]);
  } finally { invalidateServerCapabilities(); }
});

test("partial quota results fill accepted rows and show every skipped notice revision with its reason", async () => {
  const f = editorFixture();
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: f.beginLoading,
      lookup: async () => ({
        ...sourceUpdate(),
        usageCredits: {
          status: "PARTIAL",
          requested: ["00", "01", "02"].map((sourceRevision) => ({
            provider: "muasamcong", entityKind: "NOTICE", sourceCode: f.pkg.maGoiThau, sourceRevision,
          })),
          processed: [{ provider: "muasamcong", entityKind: "NOTICE", sourceCode: f.pkg.maGoiThau, sourceRevision: "00" }],
          skipped: ["01", "02"].map((sourceRevision) => ({
            provider: "muasamcong", entityKind: "NOTICE", sourceCode: f.pkg.maGoiThau, sourceRevision, reasonCode: "QUOTA_EXHAUSTED",
          })),
        },
      }),
    });
    await f.button.onclick();
    assert.deepEqual(f.loads.map(([kind]) => kind), ["request", "response", "extension"]);
    assert.match(f.status.textContent, /Đã thêm 1 yêu cầu, 1 trả lời làm rõ và 1 lần gia hạn/);
    assert.match(f.status.textContent, /không đủ lượt/i);
    assert.match(f.status.textContent, /IB2600271825-01/);
    assert.match(f.status.textContent, /IB2600271825-02/);
    assert.match(f.status.textContent, /bấm Lưu/);
    assert.equal(f.pkg.giaHanList, undefined);
    assert.equal(packageWorkspaceFor(f.view).isDirty(), true);
  } finally { invalidateServerCapabilities(); }
});

test("quota failures show skipped identities from HTTP fields or compatibility details without changing editor rows", async () => {
  const usageCredits = {
    status: "QUOTA_EXHAUSTED",
    requested: [{ provider: "muasamcong", entityKind: "NOTICE", sourceCode: "IB2600271825", sourceRevision: "00" }],
    processed: [],
    skipped: [{ provider: "muasamcong", entityKind: "NOTICE", sourceCode: "IB2600271825", sourceRevision: "00", reasonCode: "QUOTA_EXHAUSTED" }],
  };
  for (const payload of [
    { data: { fields: { usageCredits } } },
    { data: { details: { usageCredits } } },
    { fields: { usageCredits } },
    { details: { usageCredits } },
  ]) {
    const f = editorFixture();
    const before = structuredClone(f.pkg);
    try {
      bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
        beginLoading: f.beginLoading,
        lookup: async () => { throw Object.assign(new Error("Quota exhausted"), { code: "QUOTA_EXHAUSTED", ...payload }); },
      });
      await f.button.onclick();
      assert.match(f.status.textContent, /không đủ lượt/i);
      assert.match(f.status.textContent, /IB2600271825-00/);
      assert.match(f.status.textContent, /giữ nguyên/);
      assert.doesNotMatch(f.status.textContent, /Kiểm tra mã|Chưa xác định được phiên bản/);
      assert.deepEqual(f.loads, []);
      assert.deepEqual(f.pkg, before);
      assert.equal(packageWorkspaceFor(f.view).isDirty(), false);
      assert.equal(f.button.disabled, false);
      assert.equal(f.closed(), 1);
    } finally { invalidateServerCapabilities(); }
  }
});

test("ordering-only extension updates reload the table and require explicit save", async () => {
  const f = editorFixture();
  const existing = [
    { id: "extension-late", thoiGianDongThau: "2026-10-12T09:00:00", lyDoGiaHan: "Lần sau", sourceKey: "late-key", sourcePreviousClosingAt: "2026-10-01T10:00:00" },
    { id: "extension-early", thoiGianDongThau: "2026-10-01T10:00:00", lyDoGiaHan: "Lần trước", sourceKey: "early-key", sourcePreviousClosingAt: "2026-09-28T10:00:00" },
  ];
  try {
    f.container.querySelectorAll = (selector) => selector === "#gt-giahan-tbody tr" ? existing.map((row) => ({
      getAttribute: (name) => ({ "data-id": row.id, "data-source-key": row.sourceKey, "data-source-previous-closing-at": row.sourcePreviousClosingAt })[name] || "",
      querySelector: (selector) => ({ value: selector === ".gh-time-input" ? row.thoiGianDongThau : row.lyDoGiaHan }),
    })) : [];
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: f.beginLoading,
      lookup: async () => ({ revision: {
        clarificationAvailable: true, clarificationRequests: [], clarificationResponses: [],
        extensionAvailable: true,
        extensions: existing.map((row) => ({ sourceKey: row.sourceKey, localRowId: row.id, newClosingAt: row.thoiGianDongThau, reason: row.lyDoGiaHan })),
      } }),
    });
    await f.button.onclick();
    assert.equal(f.loads.length, 1);
    assert.equal(f.loads[0][0], "extension");
    assert.deepEqual(f.loads[0][1], [...existing].reverse());
    assert.equal(packageWorkspaceFor(f.view).isDirty(), true);
    assert.match(f.status.textContent, /sắp xếp lịch sử gia hạn/);
    assert.match(f.status.textContent, /bấm Lưu/);
  } finally { invalidateServerCapabilities(); }
});

test("future notice groups report extension availability without a clarification warning outside the record scope", async () => {
  const f = editorFixture();
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: f.beginLoading,
      lookup: async () => ({
        revision: { clarificationAvailable: true, clarificationRequests: [], clarificationResponses: [], extensionAvailable: true, extensions: [] },
        history: {
          missingRevisions: [],
          revisions: [
            { revisionNumber: "00", clarificationIncluded: true, clarificationAvailable: true, extensionAvailable: true },
            { revisionNumber: "02", clarificationIncluded: false, clarificationAvailable: false, extensionAvailable: false },
          ],
        },
      }),
    });
    await f.button.onclick();
    assert.match(f.status.textContent, /gia hạn ở phiên bản 02/);
    assert.doesNotMatch(f.status.textContent, /làm rõ ở phiên bản 02/);
  } finally { invalidateServerCapabilities(); }
});

test("linking an existing manual extension marks the scoped draft dirty and protects its current closing", async () => {
  const f = editorFixture();
  const source = {
    sourceExtensionId: "source-1", localRowId: `gh-${"a".repeat(64)}`,
    previousClosingAt: "2026-09-18T10:00:00", newClosingAt: "2026-09-28T10:00:00", reason: "Đã nhập đúng nội dung",
  };
  try {
    f.container.querySelectorAll = (selector) => selector === "#gt-giahan-tbody tr" ? [{
      getAttribute: (name) => name === "data-id" ? "manual-extension" : "",
      querySelector: (selector) => ({ value: selector === ".gh-time-input" ? source.newClosingAt : source.reason }),
    }] : [];
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      beginLoading: f.beginLoading,
      lookup: async () => ({ revision: {
        clarificationAvailable: true, clarificationRequests: [], clarificationResponses: [],
        extensionAvailable: true, extensions: [source],
      } }),
    });
    await f.button.onclick();
    assert.equal(f.loads.length, 1);
    assert.equal(f.loads[0][1][0].id, source.localRowId);
    assert.equal(f.loads[0][1][0].lyDoGiaHan, source.reason);
    assert.equal(f.loads[0][1][0].sourcePreviousClosingAt, source.previousClosingAt);
    assert.deepEqual(f.loadScopes, [f.container]);
    assert.equal(f.container.dataset.invitationHistoryImported, "true");
    assert.equal(packageWorkspaceFor(f.view).isDirty(), true);
    assert.match(f.status.textContent, /liên kết các dòng hiện có/);
    assert.match(f.status.textContent, /bấm Lưu/);
  } finally { invalidateServerCapabilities(); }
});

function sourceUpdate() {
  return { revision: {
    clarificationAvailable: true, extensionAvailable: true,
    clarificationRequests: [{ sourceRequestNo: "CID-1", localRowId: "lr-request", requestedAt: "2026-09-13T11:16:44", content: "Chủ đề\nNội dung" }],
    clarificationResponses: [{ sourceRequestNo: "CID-1", localRowId: "lr-response", respondedAt: "2026-09-15T16:48:06", content: "Trả lời\nĐầy đủ" }],
    extensions: [{ sourceExtensionId: "extension-1", localRowId: "gh-extension", previousClosingAt: "2026-09-18T10:00:00", newClosingAt: "2026-09-28T10:00:00", reason: "Gia hạn\nĐiều chỉnh E-HSMT" }],
  } };
}

test("read mode one-click update waits for canonical save then renders all three tables", async () => {
  const f = editorFixture();
  f.view._biddingInfoEditMode = false;
  let resolveSave;
  let saveCalls = 0;
  let rendered = 0;
  let pending;
  const extraButtons = [{ disabled: false }, { disabled: true }];
  const originalQueryAll = f.container.querySelectorAll;
  f.container.querySelectorAll = (selector) => selector === "button" ? extraButtons : originalQueryAll(selector);
  const stages = [];
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      lookup: async () => ({ ...sourceUpdate(), history: {
        missingRevisions: [], revisions: [{ revisionNumber: "02", clarificationAvailable: false, extensionAvailable: true }],
      } }),
      beginLoading: async () => ({ close: async () => {}, update: async (stage) => stages.push(stage) }),
      persistUpdates: (updates) => {
        saveCalls += 1; pending = updates;
        return new Promise((resolve) => { resolveSave = resolve; });
      },
      renderSaved: async (confirmed) => { assert.equal(confirmed.id, f.pkg.id); rendered += 1; },
      renderDraft: async () => { throw new Error("No failure draft on success"); },
    });
    const before = structuredClone(f.pkg);
    const update = f.button.onclick();
    for (let index = 0; index < 8 && !resolveSave; index += 1) await Promise.resolve();
    assert.equal(saveCalls, 1);
    assert.equal(rendered, 0);
    assert.equal(f.status.textContent, "");
    assert.deepEqual(f.pkg, before);
    assert.deepEqual(extraButtons.map((button) => button.disabled), [true, true]);
    await f.button.onclick();
    assert.equal(saveCalls, 1);
    assert.equal(pending.clarificationRequests.length, 1);
    assert.equal(pending.clarificationResponses.length, 1);
    assert.equal(pending.extensions.length, 1);
    assert.equal(pending.preserveCurrentClosingForHistory, true);
    assert.deepEqual(f.loads, []);
    assert.equal(packageWorkspaceFor(f.view).isDirty(), false);
    resolveSave({ ...f.pkg, rowVersion: 2 });
    await update;
    assert.equal(rendered, 1);
    assert.match(f.status.textContent, /Đã cập nhật và lưu 1 yêu cầu, 1 trả lời làm rõ và 1 lần gia hạn/);
    assert.match(f.status.textContent, /làm rõ ở phiên bản 02/);
    assert.deepEqual(stages, ["merge", "save"]);
    assert.deepEqual(extraButtons.map((button) => button.disabled), [false, true]);
    assert.equal(f.button.disabled, false);
  } finally { invalidateServerCapabilities(); }
});

test("read mode rejected or pending canonical save keeps only a manual retry draft", async () => {
  for (const code of ["MUTATION_REJECTED", "REMOTE_PENDING", "INVITATION_INVALID_ROWS"]) {
    const f = editorFixture();
    f.view._biddingInfoEditMode = false;
    let saveCalls = 0;
    let draft;
    try {
      bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
        lookup: async () => sourceUpdate(), beginLoading: f.beginLoading,
        persistUpdates: async () => { saveCalls += 1; throw Object.assign(new Error("Rejected"), { code }); },
        renderSaved: async () => { throw new Error("No render before canonical commit"); },
        renderDraft: async (updates) => { draft = updates; f.view._biddingInfoEditMode = true; packageWorkspaceFor(f.view).transition({ type: "SET_DIRTY", dirty: true }); },
      });
      await f.button.onclick();
      assert.equal(saveCalls, 1);
      assert.equal(draft.clarificationRequests.length, 1);
      assert.equal(draft.extensions.length, 1);
      assert.equal(f.pkg.giaHanList, undefined);
      assert.equal(packageWorkspaceFor(f.view).isDirty(), true);
      assert.match(f.status.textContent, /Máy chủ chưa xác nhận/);
      assert.match(f.status.textContent, /bấm Lưu/);
      assert.equal(f.button.disabled, false);
    } finally { invalidateServerCapabilities(); }
  }
});

test("read mode no changes does not save and an existing edit draft never auto-saves", async () => {
  for (const editing of [false, true]) {
    const f = editorFixture();
    f.view._biddingInfoEditMode = editing;
    let saves = 0;
    try {
      bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
        lookup: async () => editing ? sourceUpdate() : ({ revision: { clarificationAvailable: true, extensionAvailable: true, clarificationRequests: [], clarificationResponses: [], extensions: [] } }),
        beginLoading: f.beginLoading,
        persistUpdates: async () => { saves += 1; return f.pkg; }, renderSaved: async () => {}, renderDraft: async () => {},
      });
      await f.button.onclick();
      assert.equal(saves, 0);
      assert.equal(packageWorkspaceFor(f.view).isDirty(), editing);
      assert.match(f.status.textContent, editing ? /bản nháp đang sửa/ : /Không có nội dung/);
    } finally { invalidateServerCapabilities(); }
  }
});

test("workspace switch during automatic save suppresses rendering and failure drafts", async () => {
  const f = editorFixture();
  f.view._biddingInfoEditMode = false;
  let renders = 0;
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      lookup: async () => sourceUpdate(), beginLoading: f.beginLoading,
      persistUpdates: async () => { f.model.state = { goithau: [] }; return f.pkg; },
      renderSaved: async () => { renders += 1; }, renderDraft: async () => { renders += 1; },
    });
    await f.button.onclick();
    assert.equal(renders, 0);
    assert.equal(f.status.textContent, "");
    assert.equal(f.button.disabled, false);
    assert.equal(f.closed(), 1);
  } finally { invalidateServerCapabilities(); }
});

test("a confirmed mutation followed by reload failure never becomes an unconfirmed retry draft", async () => {
  const f = editorFixture();
  f.view._biddingInfoEditMode = false;
  let drafts = 0;
  try {
    bindInvitationImportAction(f.view, f.container, f.pkg, f.controller, {
      lookup: async () => sourceUpdate(), beginLoading: f.beginLoading,
      persistUpdates: async () => { throw Object.assign(new Error("Reload failed"), { canonicalCommitted: true }); },
      renderSaved: async () => {}, renderDraft: async () => { drafts += 1; },
    });
    await f.button.onclick();
    assert.equal(drafts, 0);
    assert.equal(packageWorkspaceFor(f.view).isDirty(), false);
    assert.match(f.status.textContent, /Máy chủ đã xác nhận/);
    assert.doesNotMatch(f.status.textContent, /bấm Lưu/);
  } finally { invalidateServerCapabilities(); }
});
