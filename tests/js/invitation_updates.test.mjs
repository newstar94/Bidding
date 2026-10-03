import assert from "node:assert/strict";
import test from "node:test";

import {
  lookupPackageInvitationUpdates,
  mergeInvitationUpdateRows,
  resolveInvitationNoticeTarget,
} from "../../frontend/procurement/InvitationUpdates.js";

const NOTICE = "IB2600374868";

function packageRecord(overrides = {}) {
  return {
    id: "gt-1", rootId: "gt-root", rowVersion: 3,
    maGoiThau: NOTICE, phienBan: "00", ...overrides,
  };
}

function fixture(pkg = packageRecord()) {
  const model = {
    state: { goithau: [pkg] }, db: {}, workspaceStorage: {},
    workspaceScope: { key: "user-1:org-1", organizationId: "org-1" },
    getWorkspaceToken: () => "user-1:org-1@2",
  };
  const revision = {
    noticeNo: NOTICE, revisionNumber: pkg.phienBan,
    clarificationAvailable: true, clarificationStatus: "AVAILABLE",
    extensionAvailable: false, extensionStatus: "SOURCE_UNAVAILABLE", extensions: [],
    clarificationRequests: [{
      sourceRequestId: "upstream-request-1", sourceRequestNo: "REQ01",
      requestedAt: "2026-08-03T09:00:00", content: "Tiêu chí\nCâu hỏi làm rõ",
    }],
    clarificationResponses: [{
      sourceRequestId: "upstream-request-1", sourceRequestNo: "REQ01",
      respondedAt: "2026-08-04T09:00:00", content: "Trả lời\nNội dung làm rõ",
    }],
  };
  const preview = {
    schemaVersion: "biddingflow-procurement-preview-v1",
    kind: "PACKAGE", canonicalCode: NOTICE,
    canonical: { canonicalCode: NOTICE, revisions: [revision] },
  };
  return { pkg, model, preview, revision };
}

test("notice target uses the notice version on a package imported from a newer plan", () => {
  const target = resolveInvitationNoticeTarget(packageRecord({
    phienBan: "01",
    sourceRevision: {
      provider: "MUASAMCONG", familyNo: "PL2600184109",
      revisionNumber: "05", packageRevisionNumber: "1",
    },
    noticeLink: { noticeNo: NOTICE, noticeVersion: "01" },
  }));
  assert.deepEqual(target, {
    noticeNo: NOTICE, revisionNumber: "01", packageId: "gt-1",
    rootId: "gt-root", rowVersion: "3",
  });
});

test("notice target respects an explicit version suffix and IB provenance", () => {
  const target = resolveInvitationNoticeTarget(packageRecord({
    maGoiThau: `${NOTICE}-02`, phienBan: "2",
    sourceRevision: { familyNo: NOTICE, revisionNumber: "02" },
  }));
  assert.equal(target.noticeNo, NOTICE);
  assert.equal(target.revisionNumber, "02");
});

test("official notice provenance wins over a cloned local successor version", () => {
  for (const sourceRevision of [
    { familyNo: NOTICE, revisionNumber: "00" },
    { familyNo: "PL2600184109", revisionNumber: "05", packageRevisionNumber: "00" },
  ]) {
    const target = resolveInvitationNoticeTarget(packageRecord({
      phienBan: "01", sourceRevision,
    }));
    assert.equal(target.revisionNumber, "00");
  }
  assert.equal(resolveInvitationNoticeTarget(packageRecord({
    maGoiThau: `${NOTICE}-02`, phienBan: "01",
  })).revisionNumber, "02");
});

test("notice target rejects missing, conflicting, malformed and plan-only targets", () => {
  for (const pkg of [
    packageRecord({ phienBan: undefined }),
    packageRecord({ phienBan: "LATEST" }),
    packageRecord({
      maGoiThau: `${NOTICE}-02`, sourceRevision: { familyNo: NOTICE, revisionNumber: "01" },
    }),
    packageRecord({
      sourceRevision: { familyNo: NOTICE, revisionNumber: "02", packageRevisionNumber: "01" },
    }),
    packageRecord({ maGoiThau: "PL2600184109" }),
    packageRecord({ noticeLink: { noticeNo: "IB2600433562", noticeVersion: "00" } }),
  ]) {
    assert.throws(() => resolveInvitationNoticeTarget(pkg), (error) => (
      error.code === "PROCUREMENT_CODE_INVALID" || error.code === "PROCUREMENT_REVISION_INVALID"
    ));
  }
});

test("lookup asks for COMPLETE history and never mutates the package", async () => {
  const { pkg, model, preview, revision } = fixture(packageRecord({ phienBan: "01" }));
  const before = structuredClone(pkg);
  const signal = new AbortController().signal;
  const calls = [];
  const result = await lookupPackageInvitationUpdates({
    pkg, model, signal,
    client: { lookup: async (...args) => { calls.push(args); return preview; } },
  });
  assert.deepEqual(calls, [[{
    code: NOTICE, workspaceLease: "org-1", detailLevel: "COMPLETE",
    revisionMode: "ALL",
  }, { signal }]]);
  const projected = structuredClone(result.revision);
  for (const field of ["clarificationRequests", "clarificationResponses"]) {
    projected[field].forEach((row) => { delete row.localRowId; delete row.sourceNoticeVersion; });
  }
  assert.deepEqual(projected, revision);
  assert.notEqual(result.revision, revision);
  assert.equal(revision.clarificationRequests[0].localRowId, undefined);
  assert.deepEqual(pkg, before);
});

test("lookup assigns stable local IDs scoped to package, notice, version and row kind", async () => {
  const lookup = async (context) => lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model,
    client: { lookup: async () => context.preview },
  });
  const first = await lookup(fixture());
  const repeated = await lookup(fixture());
  const requestId = first.revision.clarificationRequests[0].localRowId;
  const replyId = first.revision.clarificationResponses[0].localRowId;
  assert.match(requestId, /^lr-[a-f0-9]{64}$/);
  assert.notEqual(requestId, "upstream-request-1");
  assert.notEqual(requestId, replyId);
  assert.equal(requestId, repeated.revision.clarificationRequests[0].localRowId);
  const newRequest = fixture();
  newRequest.revision.clarificationRequests[0].sourceRequestNo = "REQ02";
  for (const context of [
    fixture(packageRecord({ id: "gt-other" })),
    fixture(packageRecord({ phienBan: "01" })),
    newRequest,
  ]) {
    const result = await lookup(context);
    assert.notEqual(requestId, result.revision.clarificationRequests[0].localRowId);
  }
  const otherNotice = fixture();
  const alternateNotice = "IB2600433562";
  otherNotice.pkg.maGoiThau = alternateNotice;
  otherNotice.preview.canonicalCode = alternateNotice;
  otherNotice.preview.canonical.canonicalCode = alternateNotice;
  otherNotice.revision.noticeNo = alternateNotice;
  assert.notEqual(requestId, (await lookup(otherNotice)).revision.clarificationRequests[0].localRowId);

  const remappedSourceId = fixture();
  remappedSourceId.revision.clarificationRequests[0].sourceRequestId = "new-source-view-id";
  assert.equal(requestId, (await lookup(remappedSourceId)).revision.clarificationRequests[0].localRowId);
  const noRequestNo = fixture();
  noRequestNo.revision.clarificationRequests[0].sourceRequestNo = null;
  const fallbackId = (await lookup(noRequestNo)).revision.clarificationRequests[0].localRowId;
  assert.match(fallbackId, /^lr-[a-f0-9]{64}$/);
  assert.equal(fallbackId, (await lookup(noRequestNo)).revision.clarificationRequests[0].localRowId);
  noRequestNo.revision.clarificationRequests[0].sourceRequestId = "other-request-id";
  assert.notEqual(fallbackId, (await lookup(noRequestNo)).revision.clarificationRequests[0].localRowId);
});

test("lookup returns explicit unavailable status so caller can preserve current rows", async () => {
  const { pkg, model, preview } = fixture();
  Object.assign(preview.canonical.revisions[0], {
    clarificationAvailable: false, clarificationStatus: "SOURCE_UNAVAILABLE",
    clarificationRequests: [], clarificationResponses: [],
  });
  const result = await lookupPackageInvitationUpdates({
    pkg, model, client: { lookup: async () => preview },
  });
  assert.equal(result.revision.clarificationAvailable, false);
  assert.equal(result.revision.clarificationStatus, "SOURCE_UNAVAILABLE");
});

test("lookup rejects stale workspace, storage, removed record, root and row version changes", async () => {
  const changes = [
    ({ model }) => { model.getWorkspaceToken = () => "user-1:org-2@3"; },
    ({ model }) => { model.state = { goithau: [] }; },
    ({ model }) => { model.db = {}; },
    ({ model }) => { model.workspaceStorage = {}; },
    ({ model }) => { model.state.goithau = []; },
    ({ model, pkg }) => { model.state.goithau = [{ ...pkg, rootId: "other-root" }]; },
    ({ model, pkg }) => { model.state.goithau = [{ ...pkg, rowVersion: 4 }]; },
    ({ pkg }) => { pkg.phienBan = "01"; },
  ];
  for (const change of changes) {
    const context = fixture();
    await assert.rejects(lookupPackageInvitationUpdates({
      pkg: context.pkg, model: context.model,
      client: { lookup: async () => { change(context); return context.preview; } },
    }), { name: "AbortError", code: "WORKSPACE_CHANGED" });
  }
});

test("lookup rejects a canceled response even when a client ignores its signal", async () => {
  const { pkg, model, preview } = fixture();
  const abort = new AbortController();
  await assert.rejects(lookupPackageInvitationUpdates({
    pkg, model, signal: abort.signal,
    client: { lookup: async () => { abort.abort(); return preview; } },
  }), { name: "AbortError" });
});

test("lookup rejects wrong notice, wrong revision and duplicate selected revisions", async () => {
  for (const change of [
    (preview) => { preview.canonicalCode = "IB2600433562"; },
    (preview) => { preview.canonical.canonicalCode = "IB2600433562"; },
    (preview) => { preview.canonical.revisions[0].noticeNo = "IB2600433562"; },
    (preview) => { preview.canonical.revisions[0].revisionNumber = "01"; },
    (preview) => { preview.canonical.revisions.push(preview.canonical.revisions[0]); },
  ]) {
    const { pkg, model, preview } = fixture();
    change(preview);
    await assert.rejects(lookupPackageInvitationUpdates({
      pkg, model, client: { lookup: async () => preview },
    }), (error) => ["PROCUREMENT_SCHEMA_CHANGED", "PROCUREMENT_REVISION_INVALID"].includes(error.code));
  }
});

test("merge preserves manual and incomplete rows, uses local IDs and preserves multiline content", () => {
  const current = [
    { id: "manual-1", thoiGianYeuCau: "03/08/2026 09:00", noiDungYeuCau: "Thủ công\nNội dung" },
    { id: "incomplete-1", thoiGianYeuCau: "", noiDungYeuCau: "Đang nhập\n" },
    { id: "incomplete-2", thoiGianYeuCau: "03/08/2026 09:01", noiDungYeuCau: "" },
  ];
  const before = structuredClone(current);
  const source = fixture().revision.clarificationRequests;
  const result = mergeInvitationUpdateRows(current, source, {
    kind: "request", generateId: (kind) => `local-${kind}-1`,
  });
  assert.deepEqual(current, before);
  assert.deepEqual(result.rows.slice(0, 3), before);
  assert.equal(result.added, 1);
  assert.equal(result.rows[3].id, "local-yeucaulamro-1");
  assert.notEqual(result.rows[3].id, source[0].sourceRequestId);
  assert.equal(result.rows[3].thoiGianYeuCau, "03/08/2026 09:00");
  assert.equal(result.rows[3].noiDungYeuCau, "Tiêu chí\nCâu hỏi làm rõ");
});

test("repeated merge preserves existing IDs and edits through source keys", () => {
  const source = fixture().revision.clarificationRequests;
  const first = mergeInvitationUpdateRows([], source, { kind: "request" });
  first.rows[0].noiDungYeuCau = "Nội dung người dùng sửa\n";
  first.rows.push({ id: "incomplete", noiDungYeuCau: "Chưa xong", thoiGianYeuCau: "" });
  const second = mergeInvitationUpdateRows(first.rows, source, { kind: "request" });
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);
  assert.deepEqual(second.rows, first.rows);
  assert.match(first.rows[0].id, /^lr-/);
});

test("merge detects equivalent persisted dates/content without surviving source metadata", () => {
  const source = fixture().revision.clarificationResponses;
  const current = [{
    id: "saved-reply", thoiGianTraLoi: "04/08/2026 09:00",
    noiDungTraLoi: "Trả lời\r\nNội dung làm rõ",
  }];
  const result = mergeInvitationUpdateRows(current, source, { kind: "response" });
  assert.equal(result.added, 0);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.rows.map(({ sourceKey: _key, ...row }) => row), current);
  assert.ok(result.rows[0].sourceKey);
});

test("different source requests and replies with identical text in one minute retain every row", () => {
  for (const kind of ["request", "response"]) {
    const timeField = kind === "request" ? "requestedAt" : "respondedAt";
    const source = ["CID-A", "CID-B"].map((sourceRequestNo, index) => ({
      sourceRequestId: `source-${sourceRequestNo}`, sourceRequestNo,
      [timeField]: `2026-06-15T17:56:${index ? "51" : "01"}`,
      content: "Yêu cầu về kỹ thuật\nNội dung trong file đính kèm",
    }));
    const first = mergeInvitationUpdateRows([], source, { kind });
    assert.equal(first.added, 2);
    assert.equal(first.rows.length, 2);
    assert.notEqual(first.rows[0].id, first.rows[1].id);
    const repeated = mergeInvitationUpdateRows(first.rows, source, { kind });
    assert.equal(repeated.added, 0);
    assert.deepEqual(repeated.rows, first.rows);
  }
});

test("content fallback consumes each existing unkeyed row once and preserves its local ID", () => {
  const original = [{
    id: "manual-preserved", thoiGianYeuCau: "15/06/2026 17:56",
    noiDungYeuCau: "Nội dung trong file đính kèm",
  }];
  const source = ["CID-A", "CID-B"].map((sourceRequestNo) => ({
    sourceRequestId: `source-${sourceRequestNo}`, sourceRequestNo,
    requestedAt: "2026-06-15T17:56:00", content: "Nội dung trong file đính kèm",
  }));
  const result = mergeInvitationUpdateRows(original, source, { kind: "request" });
  assert.equal(result.added, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].id, "manual-preserved");
  assert.ok(result.rows[0].sourceKey);
  assert.notEqual(result.rows[0].sourceKey, result.rows[1].sourceKey);
  assert.equal(original[0].sourceKey, undefined);
  result.rows[0].noiDungYeuCau = "Người dùng đã chỉnh sửa";
  assert.equal(mergeInvitationUpdateRows(result.rows, source, { kind: "request" }).added, 0);
});

test("persisted stable row IDs prevent repeated import after source metadata is stripped and text edited", async () => {
  const context = fixture();
  const { revision } = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  for (const kind of ["request", "response"]) {
    const source = kind === "request" ? revision.clarificationRequests : revision.clarificationResponses;
    const contentField = kind === "request" ? "noiDungYeuCau" : "noiDungTraLoi";
    const first = mergeInvitationUpdateRows([], source, { kind });
    assert.equal(first.rows[0].id, source[0].localRowId);
    const persisted = first.rows.map(({ sourceKey: _key, ...row }) => ({
      ...row, [contentField]: "Nội dung người dùng sửa sau khi lưu",
    }));
    const second = mergeInvitationUpdateRows(persisted, source, { kind });
    assert.equal(second.added, 0);
    assert.equal(second.matched, 1);
    assert.equal(second.rows[0].id, persisted[0].id);
    assert.equal(second.rows[0][contentField], persisted[0][contentField]);
  }
});

test("stable IDs for previous imports do not consume a new source with the same persisted text", async () => {
  const context = fixture();
  const lookup = () => lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  const original = (await lookup()).revision.clarificationRequests;
  const rows = mergeInvitationUpdateRows([], original, { kind: "request" }).rows
    .map(({ sourceKey: _key, ...row }) => row);
  context.revision.clarificationRequests.push({
    ...context.revision.clarificationRequests[0],
    sourceRequestId: "upstream-request-2", sourceRequestNo: "REQ02",
  });
  const fresh = (await lookup()).revision.clarificationRequests;
  const result = mergeInvitationUpdateRows(rows, [fresh[1], fresh[0]], { kind: "request" });
  assert.equal(result.added, 1);
  assert.equal(result.rows.length, 2);
  assert.notEqual(result.rows[0].id, result.rows[1].id);
});

test("empty and invalid source rows preserve editor rows and never create empty imports", () => {
  const current = [{ id: "manual", noiDungTraLoi: "Chưa nhập ngày", thoiGianTraLoi: "" }];
  for (const source of [[], undefined, [
    { content: "", respondedAt: "2026-08-04T09:00:00" },
    { content: "Không có ngày" },
    { content: "Ngày hỏng", respondedAt: "invalid" },
  ]]) {
    const result = mergeInvitationUpdateRows(current, source, { kind: "response" });
    assert.equal(result.added, 0);
    assert.deepEqual(result.rows, current);
  }
});

test("new request and reply IDs remain independent even when upstream request identity is shared", () => {
  const { revision } = fixture();
  const requests = mergeInvitationUpdateRows([], revision.clarificationRequests, { kind: "request" });
  const replies = mergeInvitationUpdateRows([], revision.clarificationResponses, { kind: "response" });
  assert.notEqual(requests.rows[0].id, replies.rows[0].id);
  assert.notEqual(requests.rows[0].sourceKey, replies.rows[0].sourceKey);
  assert.equal(replies.rows[0].noiDungTraLoi, "Trả lời\nNội dung làm rõ");
});

test("extension lookup IDs are stable and isolated by package and notice version", async () => {
  const ids = [];
  for (const pkg of [packageRecord(), packageRecord({ phienBan: "01" }), packageRecord({ id: "gt-2" })]) {
    const context = fixture(pkg);
    context.revision.extensionAvailable = true;
    context.revision.extensions = [{
      sourceExtensionId: "extension-1", extendedAt: "2026-09-11T18:00:00",
      previousClosingAt: "2026-09-18T09:00:00", newClosingAt: "2026-09-25T09:00:00",
      reason: "Cần thêm thời gian\nChuẩn bị hồ sơ",
    }];
    const lookup = () => lookupPackageInvitationUpdates({
      pkg, model: context.model, client: { lookup: async () => context.preview },
    });
    const first = (await lookup()).revision.extensions[0];
    const second = (await lookup()).revision.extensions[0];
    assert.match(first.localRowId, /^gh-[a-f0-9]{64}$/);
    assert.equal(first.localRowId, second.localRowId);
    ids.push(first.localRowId);
  }
  assert.equal(new Set(ids).size, 3);
});

test("extension merge uses the new closing time and preserves manual, incomplete and edited rows", async () => {
  const context = fixture();
  context.revision.extensionAvailable = true;
  context.revision.extensions = [{
    sourceExtensionId: "extension-1", extendedAt: "2026-09-11T18:00:00",
    previousClosingAt: "2026-09-18T09:00:00", newClosingAt: "2026-09-25T09:00:00",
    reason: "Cần thêm thời gian\nChuẩn bị hồ sơ",
  }];
  const { revision } = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  const current = [
    { id: "manual-1", thoiGianDongThau: "26/09/2026 09:00", lyDoGiaHan: "Thủ công\n" },
    { id: "draft-1", thoiGianDongThau: "", lyDoGiaHan: "Đang nhập" },
  ];
  const result = mergeInvitationUpdateRows(current, [...revision.extensions, ...revision.extensions], { kind: "extension" });
  assert.deepEqual(result.rows.filter((row) => !row.sourceKey), current);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.rows[0].id, revision.extensions[0].localRowId);
  assert.equal(result.rows[0].thoiGianDongThau, "25/09/2026 09:00");
  assert.equal(result.rows[0].lyDoGiaHan, "Cần thêm thời gian\nChuẩn bị hồ sơ");
  assert.equal(result.rows[0].sourcePreviousClosingAt, "2026-09-18T09:00:00");
  assert.equal(result.reordered, true);
  const persisted = result.rows.map(({ sourceKey: _key, ...row }) => row);
  persisted[0].lyDoGiaHan = "Nội dung đã sửa sau khi lưu";
  persisted[0].thoiGianDongThau = "25/09/2026 10:00";
  const repeated = mergeInvitationUpdateRows(persisted, revision.extensions, { kind: "extension" });
  assert.equal(repeated.added, 0);
  assert.equal(repeated.rows[0].id, persisted[0].id);
  assert.equal(repeated.rows[0].lyDoGiaHan, persisted[0].lyDoGiaHan);
  assert.equal(repeated.rows[0].thoiGianDongThau, persisted[0].thoiGianDongThau);
  for (const absent of [null, undefined, []]) {
    assert.deepEqual(mergeInvitationUpdateRows(current, absent, { kind: "extension" }).rows, current);
  }
});

test("extension source identity remains distinct across versions with identical content", async () => {
  const results = [];
  for (const phienBan of ["00", "01"]) {
    const context = fixture(packageRecord({ phienBan }));
    context.revision.extensionAvailable = true;
    context.revision.extensions = [{
      sourceExtensionId: "extension-1", newClosingAt: "2026-09-25T09:00:00", reason: "Gia hạn",
    }];
    results.push((await lookupPackageInvitationUpdates({
      pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
    })).revision.extensions);
  }
  const first = mergeInvitationUpdateRows([], results[0], { kind: "extension" });
  const next = mergeInvitationUpdateRows(first.rows, results[1], { kind: "extension" });
  assert.equal(next.added, 1);
  assert.notEqual(next.rows[0].id, next.rows[1].id);
  assert.notEqual(next.rows[0].sourceKey, next.rows[1].sourceKey);
});

function observedHistoryFixture(targetVersion = "02") {
  const context = fixture(packageRecord({ maGoiThau: "IB2600493339", phienBan: targetVersion }));
  context.preview.canonicalCode = "IB2600493339";
  context.preview.canonical.canonicalCode = "IB2600493339";
  const versions = ["02", "00", "01"].map((version) => ({
    noticeNo: "IB2600493339", revisionNumber: version,
    clarificationAvailable: version !== "02", clarificationStatus: version === "02" ? "REVISION_UNAVAILABLE" : "AVAILABLE",
    extensionAvailable: version !== "02", extensionStatus: version === "02" ? "SOURCE_UNAVAILABLE" : "AVAILABLE",
    clarificationRequests: [], clarificationResponses: [], extensions: [],
  }));
  const byVersion = Object.fromEntries(versions.map((revision) => [revision.revisionNumber, revision]));
  for (const [version, sourceRequestNo, requestedAt, respondedAt] of [
    ["00", "CID2600012277", "2026-09-14T17:37:09", "2026-09-19T09:34:21"],
    ["00", "CID2600012195", "2026-09-13T11:16:44", "2026-09-15T16:48:06"],
    ["01", "CID2600012555", "2026-09-19T11:55:01", "2026-09-28T19:58:58"],
  ]) {
    const content = sourceRequestNo === "CID2600012277"
      ? "Tiêu chuẩn đánh giá E-HSDT\nChi tiết xin gửi tài liệu kèm theo"
      : "Yêu cầu về kỹ thuật\nChi tiết nội dung làm rõ tại file đính kèm";
    byVersion[version].clarificationRequests.push({ sourceRequestNo, requestedAt, content });
    byVersion[version].clarificationResponses.push({ sourceRequestNo, respondedAt, content: "Chi tiết tại file đính kèm" });
  }
  for (const [version, sourceExtensionId, previousClosingAt, newClosingAt] of [
    ["00", "b0d28818-c8b5-4624-b347-df1b5bc94474", "2026-09-18T10:00:00", "2026-09-28T10:00:00"],
    ["01", "97e9b307-3e08-4de0-8c2d-f2272a53e3f0", "2026-09-28T10:00:00", "2026-10-01T10:00:00"],
    ["01", "e87ff07d-6e1d-4ed6-a839-d5e034967162", "2026-10-01T10:00:00", "2026-10-12T09:00:00"],
  ]) {
    byVersion[version].extensions.push({ sourceExtensionId, previousClosingAt, newClosingAt, reason: "Gia hạn theo dữ liệu nguồn" });
  }
  context.preview.canonical.revisions = versions;
  context.preview.rawBundle = { revisions: { "00": {}, "01": {}, "02": {} } };
  return context;
}

test("version 02 package imports verified 00/01 history and reports missing 02 clarification separately", async () => {
  const context = observedHistoryFixture();
  const { revision, history } = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  assert.equal(revision.revisionNumber, "02");
  assert.equal(revision.clarificationAvailable, true);
  assert.equal(revision.clarificationStatus, "PARTIAL_HISTORY");
  assert.equal(revision.extensionStatus, "PARTIAL_HISTORY");
  assert.equal(revision.clarificationRequests.length, 3);
  assert.equal(revision.clarificationResponses.length, 3);
  assert.equal(revision.extensions.length, 3);
  assert.deepEqual(revision.clarificationRequests.map((row) => row.sourceNoticeVersion), ["00", "00", "01"]);
  assert.deepEqual(history.revisions.map((row) => row.revisionNumber), ["00", "01", "02"]);
  assert.equal(history.revisions[2].clarificationAvailable, false);
  assert.deepEqual(history.missingRevisions, []);
  assert.equal(revision.clarificationRequests[0].content, "Tiêu chuẩn đánh giá E-HSDT\nChi tiết xin gửi tài liệu kèm theo");
  const merged = mergeInvitationUpdateRows([], [...revision.extensions].reverse(), { kind: "extension" });
  assert.deepEqual(merged.rows.map((row) => row.thoiGianDongThau), ["28/09/2026 10:00", "01/10/2026 10:00", "12/10/2026 09:00"]);
  assert.deepEqual(merged.rows.map((row) => row.sourcePreviousClosingAt), ["2026-09-18T10:00:00", "2026-09-28T10:00:00", "2026-10-01T10:00:00"]);
});

test("extensions combine all notice versions while clarification respects the target version", async () => {
  const results = [];
  for (const targetVersion of ["00", "01", "02"]) {
    const context = observedHistoryFixture(targetVersion);
    results.push(await lookupPackageInvitationUpdates({
      pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
    }));
  }
  assert.deepEqual(results.map((result) => result.revision.extensions.length), [3, 3, 3]);
  assert.deepEqual(results.map((result) => result.revision.clarificationRequests.length), [2, 3, 3]);
  assert.equal(results[0].revision.extensions[0].localRowId, results[2].revision.extensions[0].localRowId);
  assert.equal(results[0].revision.clarificationRequests[0].localRowId, results[2].revision.clarificationRequests[0].localRowId);
  assert.deepEqual(results[0].history.revisions.map((row) => row.revisionNumber), ["00", "01", "02"]);
  assert.deepEqual(results[0].history.revisions.map((row) => row.clarificationIncluded), [true, false, false]);
  for (const result of results) {
    assert.deepEqual(result.revision.extensions.map((row) => row.sourceNoticeVersion), ["00", "01", "01"]);
    const merged = mergeInvitationUpdateRows([], result.revision.extensions, { kind: "extension" });
    assert.deepEqual(merged.rows.map((row) => row.thoiGianDongThau), ["28/09/2026 10:00", "01/10/2026 10:00", "12/10/2026 09:00"]);
    assert.equal(mergeInvitationUpdateRows(merged.rows, result.revision.extensions, { kind: "extension" }).added, 0);
  }
});

test("ALL history reports an older failed detail and rejects foreign or duplicated older revisions", async () => {
  const context = observedHistoryFixture();
  context.preview.canonical.revisions = context.preview.canonical.revisions.filter((revision) => revision.revisionNumber !== "00");
  const result = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  assert.deepEqual(result.history.missingRevisions, ["00"]);
  assert.equal(result.revision.clarificationStatus, "PARTIAL_HISTORY");
  assert.equal(result.revision.clarificationRequests.length, 1);
  for (const mutate of [
    (preview) => { preview.canonical.revisions[1].noticeNo = "IB2600000001"; },
    (preview) => { preview.canonical.revisions.push(preview.canonical.revisions[1]); },
    (preview) => { preview.canonical.revisions[1].revisionNumber = "unrecognized"; },
  ]) {
    const fixture = observedHistoryFixture();
    mutate(fixture.preview);
    await assert.rejects(lookupPackageInvitationUpdates({
      pkg: fixture.pkg, model: fixture.model, client: { lookup: async () => fixture.preview },
    }), { code: "PROCUREMENT_REVISION_INVALID" });
  }
});

test("missing later detail is reported for all-version extensions without invalidating older clarifications", async () => {
  const context = observedHistoryFixture("00");
  context.preview.canonical.revisions = context.preview.canonical.revisions.filter((revision) => revision.revisionNumber !== "01");
  const result = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  assert.deepEqual(result.history.missingRevisions, ["01"]);
  assert.equal(result.revision.extensionStatus, "PARTIAL_HISTORY");
  assert.equal(result.revision.extensions.length, 1);
  assert.equal(result.revision.clarificationStatus, "AVAILABLE");
  assert.equal(result.revision.clarificationRequests.length, 2);
});

test("equal clarification child identities across source versions retain separate stable rows", async () => {
  const context = observedHistoryFixture("01");
  const zero = context.preview.canonical.revisions.find((revision) => revision.revisionNumber === "00");
  const one = context.preview.canonical.revisions.find((revision) => revision.revisionNumber === "01");
  one.clarificationRequests = [{ ...zero.clarificationRequests[0] }];
  const { revision } = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  const rows = mergeInvitationUpdateRows([], revision.clarificationRequests, { kind: "request" });
  assert.equal(rows.added, 3);
  assert.notEqual(rows.rows[0].id, rows.rows[2].id);
  assert.notEqual(rows.rows[0].sourceKey, rows.rows[2].sourceKey);
  assert.equal(mergeInvitationUpdateRows(rows.rows, revision.clarificationRequests, { kind: "request" }).added, 0);
});

test("older 00 extension is sorted before an existing 01 manual extension without changing entered values", async () => {
  const context = observedHistoryFixture("01");
  const { revision } = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  const current = [
    { id: "manual-01", thoiGianDongThau: "12/10/2026 09:00", lyDoGiaHan: "Nội dung tự nhập\nĐã sửa" },
    { id: "draft", thoiGianDongThau: "", lyDoGiaHan: "Dòng đang nhập" },
  ];
  const result = mergeInvitationUpdateRows(current, [revision.extensions[0]], { kind: "extension" });
  assert.equal(result.added, 1);
  assert.equal(result.reordered, true);
  assert.equal(result.rows[0].thoiGianDongThau, "28/09/2026 10:00");
  assert.deepEqual(result.rows.slice(1), current);
});

test("exact manual matches adopt stable source IDs and stay linked after canonical reload and edits", async () => {
  const context = fixture();
  context.revision.extensionAvailable = true;
  context.revision.extensions = [{
    sourceExtensionId: "extension-1", previousClosingAt: "2026-09-18T09:00:00",
    newClosingAt: "2026-09-25T09:00:00", reason: "Gia hạn\nĐủ nội dung",
  }];
  const { revision } = await lookupPackageInvitationUpdates({
    pkg: context.pkg, model: context.model, client: { lookup: async () => context.preview },
  });
  for (const [kind, sources, timeField, contentField, sourceTime, sourceContent] of [
    ["request", revision.clarificationRequests, "thoiGianYeuCau", "noiDungYeuCau", "requestedAt", "content"],
    ["response", revision.clarificationResponses, "thoiGianTraLoi", "noiDungTraLoi", "respondedAt", "content"],
    ["extension", revision.extensions, "thoiGianDongThau", "lyDoGiaHan", "newClosingAt", "reason"],
  ]) {
    const source = sources[0];
    const current = [{ id: `manual-${kind}`, [timeField]: source[sourceTime], [contentField]: source[sourceContent] }];
    const original = structuredClone(current);
    const first = mergeInvitationUpdateRows(current, sources, { kind });
    assert.equal(first.added, 0);
    assert.equal(first.linked, 1);
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].id, source.localRowId);
    assert.deepEqual(current, original);
    assert.equal(first.rows[0][contentField], original[0][contentField]);
    const projected = [{
      id: first.rows[0].id,
      [timeField]: "25/09/2026 10:00",
      [contentField]: "Nội dung được chỉnh sửa sau khi lưu\nĐầy đủ",
    }];
    const repeated = mergeInvitationUpdateRows(projected, sources, { kind });
    assert.equal(repeated.added, 0);
    assert.equal(repeated.linked, 0);
    assert.equal(repeated.rows.length, 1);
    assert.equal(repeated.rows[0].id, source.localRowId);
    assert.equal(repeated.rows[0][timeField], projected[0][timeField]);
    assert.equal(repeated.rows[0][contentField], projected[0][contentField]);
    const secondSource = { ...source, localRowId: `${kind === "extension" ? "gh" : "lr"}-${"b".repeat(64)}` };
    const different = mergeInvitationUpdateRows(current, [source, secondSource], { kind });
    assert.equal(different.rows.length, 2);
    assert.equal(different.linked, 1);
    assert.equal(different.added, 1);
    assert.notEqual(different.rows[0].id, different.rows[1].id);
  }
});
