import assert from "node:assert/strict";
import test from "node:test";

import { runBusinessListBulkDelete, deleteSelectedBusinessListRows } from "../../frontend/shared/BusinessListBulkDelete.js";
import { setAppController } from "../../frontend/app/controllerRef.js";

const descriptor = (type = "kehoach") => ({ type, count: 2, mode: "explicit", selectedVersions: [{ id: "a", rootId: "a" }, { id: "b", rootId: "b" }] });
function frozen(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function preview(type = "kehoach") {
  const latest = [{ table: type, id: "a-new", expectedVersion: 3 }, { table: type, id: "b", expectedVersion: 5 }];
  const all = [...latest, { table: type, id: "a-old", expectedVersion: 2 }];
  if (type === "goithau") all.push({ table: "thongtinmothau", id: "opening-a", expectedVersion: 8 });
  return frozen({
    type, selectedCount: 2, syncVersion: "19",
    selectedRecords: [{ id: "a", rootId: "a", version: "01", name: "Dữ liệu A" }, { id: "b", rootId: "b", version: "00", name: "Dữ liệu B" }],
    choices: {
      latest: { deletions: latest, versionCount: 2, dependencyCount: 0, blockedReason: "" },
      all: { deletions: all, versionCount: 3, dependencyCount: type === "goithau" ? 1 : 0, blockedReason: "" },
    },
  });
}
function fixture({ type = "kehoach", prepared = preview(type), confirmations = [true], choices = [1], results = [{ ok: true }] } = {}) {
  const events = { confirmations: [], choices: [], alerts: [], toasts: [], submits: [], prepared: [], opened: [], closed: 0, sessions: 0 };
  let current = true;
  const controller = {
    model: { state: { activerole: "admin", [type]: [{ id: "a" }, { id: "b" }] } },
    view: {
      customConfirm: async (...args) => { events.confirmations.push(args); return confirmations.shift() ?? false; },
      customVersionDeleteChoice: async (...args) => { events.choices.push(args); return choices.shift() ?? null; },
      customAlert: async (...args) => { events.alerts.push(args); },
      showToast: (...args) => { events.toasts.push(args); },
    },
  };
  const session = {
    assertCurrent() { if (!current) { const error = new Error("Workspace changed"); error.code = "WORKSPACE_CHANGED"; throw error; } },
    readPage() {}, readRecord() {}, readSyncVersion() {},
    close() { events.closed += 1; },
  };
  const dependencies = {
    createSession: async () => { events.sessions += 1; return session; },
    prepare: async (options) => { events.prepared.push(options); return prepared; },
    submit: async (...args) => { events.submits.push(args); return results.shift(); },
    beginLoading: async (options) => { events.opened.push(options); return { close: async () => {} }; },
  };
  return { controller, events, session, dependencies, invalidate() { current = false; } };
}

for (const type of ["kehoach", "hopdong"]) {
  test(`${type} chooses one shared version scope and confirms names/count before one request`, async () => {
    const prepared = preview(type);
    const subject = fixture({ type, prepared, choices: [2] });
    const result = await runBusinessListBulkDelete(subject.controller, descriptor(type), subject.dependencies);
    assert.equal(result.ok, true);
    assert.equal(subject.events.choices.length, 1);
    assert.equal(subject.events.confirmations.length, 1);
    const message = subject.events.confirmations[0][1];
    assert.match(message, /Dữ liệu A.*phiên bản 01/u);
    assert.match(message, /Dữ liệu B.*phiên bản 00/u);
    assert.match(message, /Sẽ xóa 3 phiên bản/u);
    assert.match(message, /toàn bộ yêu cầu sẽ bị từ chối/u);
    assert.equal(subject.events.submits.length, 1);
    assert.deepEqual(subject.events.submits[0][1], { deletions: prepared.choices.all.deletions, baseSyncVersion: "19", expectedSyncVersion: "19" });
    assert.equal(Object.isFrozen(subject.events.submits[0][1]), true);
    assert.equal(subject.events.closed, 1);
    assert.deepEqual(subject.controller.model.state[type], [{ id: "a" }, { id: "b" }], "UI orchestration never removes the local projection before acknowledgement");
  });
}

test("package confirmation names whole snapshot family and opening dependencies without a latest-version option", async () => {
  const prepared = preview("goithau");
  const subject = fixture({ type: "goithau", prepared });
  await runBusinessListBulkDelete(subject.controller, descriptor("goithau"), subject.dependencies);
  assert.equal(subject.events.choices.length, 0);
  assert.match(subject.events.confirmations[0][1], /3 phiên bản gói thầu.*mọi phiên bản kế hoạch và 1 dòng thông tin mở thầu/u);
  assert.equal(subject.events.submits[0][1].deletions, prepared.choices.all.deletions);
});

test("identical scopes skip the version-choice dialog", async () => {
  const prepared = structuredClone(preview());
  prepared.choices.all = prepared.choices.latest;
  const subject = fixture({ prepared: frozen(prepared) });
  await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(subject.events.choices.length, 0);
  assert.equal(subject.events.submits.length, 1);
});

for (const cancellation of ["scope", "final"]) {
  test(`cancelling ${cancellation} confirmation submits nothing and closes the session`, async () => {
    const subject = fixture({ choices: cancellation === "scope" ? [null] : [1], confirmations: [false] });
    const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
    assert.equal(result.cancelled, true);
    assert.equal(subject.events.submits.length, 0);
    assert.equal(subject.events.closed, 1);
    assert.equal(subject.events.toasts.length, 0);
  });
}

test("a blocked chosen scope does not silently skip records or submit the other scope", async () => {
  const prepared = structuredClone(preview());
  prepared.choices.all.blockedReason = "Kế hoạch A có gói thầu đang liên kết.";
  const subject = fixture({ prepared: frozen(prepared), choices: [2] });
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.blocked, true);
  assert.equal(subject.events.confirmations.length, 0);
  assert.equal(subject.events.submits.length, 0);
  assert.equal(subject.events.alerts[0][1], prepared.choices.all.blockedReason);
});

test("preparation failure leaves all selected data and sends no delete request", async () => {
  const subject = fixture();
  subject.dependencies.prepare = async () => { throw new Error("Phiên bản đã thay đổi."); };
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.ok, false);
  assert.equal(subject.events.submits.length, 0);
  assert.equal(subject.events.closed, 1);
  assert.deepEqual(subject.controller.model.state.kehoach, [{ id: "a" }, { id: "b" }]);
  assert.match(subject.events.alerts[0][1], /Phiên bản đã thay đổi/u);
});

test("a workspace change while confirming cannot send the frozen delete command", async () => {
  const subject = fixture();
  subject.controller.view.customConfirm = async () => { subject.invalidate(); return true; };
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.workspaceChanged, true);
  assert.equal(subject.events.submits.length, 0);
  assert.equal(subject.events.toasts.length, 0);
  assert.equal(subject.events.alerts.length, 0);
});

test("unknown outcome immediate retry reuses the same session and immutable command", async () => {
  const subject = fixture({ confirmations: [true, true], results: [{ ok: false, unknown: true }, { ok: true }] });
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.ok, true);
  assert.equal(subject.events.sessions, 1);
  assert.equal(subject.events.prepared.length, 1);
  assert.equal(subject.events.submits.length, 2);
  assert.equal(subject.events.submits[0][0], subject.events.submits[1][0]);
  assert.equal(subject.events.submits[0][1], subject.events.submits[1][1]);
  assert.equal(subject.events.toasts.length, 1);
  assert.equal(subject.events.closed, 1);
});

test("deferred unknown retry ignores a changed selection and resumes the previously confirmed command", async () => {
  const subject = fixture({ confirmations: [true, false, true], results: [{ ok: false, unknown: true }, { ok: true }] });
  const first = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(first.unknown, true);
  assert.equal(subject.events.closed, 0, "unresolved session stays available for its explicit retry");
  assert.equal(subject.events.toasts.length, 0);
  const changed = { ...descriptor(), count: 1, selectedVersions: [{ id: "different", rootId: "different" }] };
  const second = await runBusinessListBulkDelete(subject.controller, changed, subject.dependencies);
  assert.equal(second.ok, true);
  assert.equal(subject.events.prepared.length, 1);
  assert.equal(subject.events.submits[0][1], subject.events.submits[1][1]);
  assert.match(subject.events.confirmations[2][1], /Dữ liệu A/u);
  assert.doesNotMatch(subject.events.confirmations[2][1], /different/u);
  assert.equal(subject.events.closed, 1);
});

test("an unresolved request prevents a new delete for another list", async () => {
  const subject = fixture({ confirmations: [true, false, true], results: [{ ok: false, unknown: true }, { ok: true }] });
  await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  const blocked = await runBusinessListBulkDelete(subject.controller, descriptor("hopdong"), subject.dependencies);
  assert.equal(blocked.unknown, true);
  assert.equal(subject.events.submits.length, 1);
  assert.equal(subject.events.prepared.length, 1);
  assert.match(subject.events.alerts[0][1], /trở lại danh sách kế hoạch/u);
  await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
});

test("a stale unresolved session is retired without retrying in a new workspace", async () => {
  const subject = fixture({ confirmations: [true, false], results: [{ ok: false, unknown: true }] });
  await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  subject.invalidate();
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.workspaceChanged, true);
  assert.equal(subject.events.submits.length, 1);
  assert.equal(subject.events.closed, 1);
});

for (const code of ["BULK_DELETE_OFFLINE", "BULK_DELETE_PENDING_CHANGES"]) {
  test(`${code} does not discard an unresolved command, including after selection becomes empty`, async () => {
    const subject = fixture({ confirmations: [true, false, true], results: [{ ok: false, unknown: true }, { ok: true }] });
    await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
    const originalAssert = subject.session.assertCurrent;
    subject.session.assertCurrent = () => { const error = new Error("Thử lại sau."); error.code = code; throw error; };
    const blocked = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
    assert.equal(blocked.ok, false);
    assert.equal(subject.events.closed, 0);
    subject.session.assertCurrent = originalAssert;
    const result = await runBusinessListBulkDelete(subject.controller, { ...descriptor(), count: 0, selectedVersions: [] }, subject.dependencies);
    assert.equal(result.ok, true);
    assert.equal(subject.events.prepared.length, 1);
    assert.equal(subject.events.submits[0][1], subject.events.submits[1][1]);
    assert.equal(subject.events.closed, 1);
  });
}

test("a workspace-changed result closes an unresolved session without stale feedback", async () => {
  const subject = fixture({ confirmations: [true, false, true], results: [{ ok: false, unknown: true }, { ok: false, unknown: true, workspaceChanged: true }] });
  await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.workspaceChanged, true);
  assert.equal(subject.events.closed, 1);
  assert.equal(subject.events.toasts.length, 0);
});

test("known rejection displays the server detail and preserves the selection data", async () => {
  const subject = fixture({ results: [{ ok: false, message: "Toàn bộ yêu cầu bị từ chối.", errors: [{ table: "kehoach", id: "a-new", message: "Có gói thầu liên kết." }] }] });
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.ok, false);
  assert.match(subject.events.alerts[0][1], /kehoach · a-new · Có gói thầu liên kết/u);
  assert.equal(subject.events.toasts.length, 0);
  assert.equal(subject.events.closed, 1);
  assert.deepEqual(subject.controller.model.state.kehoach, [{ id: "a" }, { id: "b" }]);
});

test("successful refresh can advance authorization without rechecking the old session", async () => {
  const subject = fixture();
  subject.dependencies.submit = async () => { subject.invalidate(); return { ok: true }; };
  const result = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(result.ok, true);
  assert.equal(subject.events.toasts[0][2], "success");
  assert.equal(subject.events.alerts.length, 0);
});

test("an acknowledged delete with refresh pending asks for a reload and uses warning feedback", async () => {
  const subject = fixture({ results: [{ ok: true, refreshPending: true }] });
  await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(subject.events.toasts[0][2], "warning");
  assert.match(subject.events.toasts[0][1], /Máy chủ đã xác nhận xóa/u);
});

test("another click while the same controller is preparing cannot start a second session", async () => {
  const subject = fixture();
  let finishPreparation;
  const waiting = new Promise((resolve) => { finishPreparation = resolve; });
  subject.dependencies.prepare = () => waiting;
  const first = runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  const second = await runBusinessListBulkDelete(subject.controller, descriptor(), subject.dependencies);
  assert.equal(second.busy, true);
  finishPreparation(preview());
  await first;
  assert.equal(subject.events.sessions, 1);
});

test("UI entry point refuses an unrelated controller or view model", async () => {
  const subject = fixture();
  setAppController(subject.controller);
  try {
    assert.equal((await deleteSelectedBusinessListRows({ model: {} }, "kehoach")).workspaceChanged, true);
    assert.equal((await deleteSelectedBusinessListRows({ model: subject.controller.model }, "kehoach")).workspaceChanged, true);
  } finally {
    setAppController(null);
  }
});
