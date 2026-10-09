import assert from "node:assert/strict";
import test from "node:test";
import { handleChuyenGiaSubmit } from "../../frontend/experts/ChuyenGiaWorkflow.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function withExpertForm(run, { identifiers = false } = {}) {
  const previousDocument = globalThis.document;
  const ids = ["form-chuyengia", "form-chuyengia-id", "cg-hoten", "cg-socccd",
    "cg-noicapcccd", "cg-ngaycapcccd", "cg-sochungchi", "cg-donvicapchungchi", "cg-ngaycapchungchi"];
  const controls = new Map(ids.map(id => [id, {
    value: "", closest() { return null; }, focus() { this.focused = true; },
  }]));
  controls.get("cg-hoten").value = "Chuyên gia đang lưu";
  if (identifiers) {
    controls.get("cg-socccd").value = "012345678901";
    controls.get("cg-sochungchi").value = "CERT-1";
  }
  // Form controls are real handler inputs; no loading overlay is needed here.
  globalThis.document = { getElementById: id => controls.get(id) };
  const calls = { persists: [], syncs: 0, closes: 0, versionPrompts: 0 };
  const controller = {
    _expertEditorGeneration: 1,
    tempChuyenGiaImageBase64: "", tempChuyenGiaSignatureBase64: "",
    model: {
      state: { chuyengia: [], activeuser: {} },
      convertDMYToYMD: value => value,
      getFileExtensionFromBase64: () => "",
      getCurrentDateTimeString: () => "2026-10-09",
      async persistChanges(table, changes) { calls.persists.push({ table, changes }); },
      async flushMutationOutbox() {},
    },
    view: {
      validateForm: () => true,
      renderChuyenGiaTable() {}, showToast() {},
      async customConfirm() { calls.versionPrompts++; return true; },
    },
    async autoSync() { calls.syncs++; return { ok: true, localMutationsPending: true }; },
    async closeModal() { calls.closes++; },
  };
  const submit = () => handleChuyenGiaSubmit.call(controller, { preventDefault() {} });
  try { await run({ controller, calls, controls, submit }); }
  finally { globalThis.document = previousDocument; }
}

for (const identifiers of [false, true]) {
  test(`pending expert Save retries the same mutation with identifiers=${identifiers}`, async () => {
    await withExpertForm(async ({ controller, calls, controls, submit }) => {
      const first = await submit();
      await first.syncPromise;
      const assignedId = controller.model.state.chuyengia[0].id;
      assert.equal(controls.get("form-chuyengia-id").value, assignedId);
      await submit();
      assert.equal(controller.model.state.chuyengia.length, 1);
      assert.equal(calls.persists.length, 1, "retry must not append another outbox mutation");
      assert.equal(calls.syncs, 2, "retry asks the server to settle the existing receipt");
      assert.equal(calls.versionPrompts, 0, "retry must not create a version");
      assert.equal(controls.get("cg-socccd").focused, undefined, "pending record must not fail self-duplicate validation");
    }, { identifiers });
  });
}

test("an unresolved expert synchronization cannot start a second mutation", async () => {
  await withExpertForm(async ({ controller, calls, submit }) => {
    const remote = deferred();
    controller.autoSync = () => { calls.syncs++; return remote.promise; };
    const first = await submit();
    await submit();
    assert.equal(calls.persists.length, 1);
    assert.equal(calls.syncs, 1);
    assert.equal(calls.versionPrompts, 0);
    remote.resolve({ ok: true });
    await first.syncPromise;
    assert.equal(calls.closes, 1);
  });
});

test("prior expert confirmation keeps newer entered values and explicit Save persists them", async () => {
  await withExpertForm(async ({ controller, calls, controls, submit }) => {
    const remote = deferred();
    controller.autoSync = () => { calls.syncs++; return remote.promise; };
    const first = await submit();
    const assignedId = controls.get("form-chuyengia-id").value;
    controls.get("cg-hoten").value = "Nội dung mới chưa lưu";
    remote.resolve({ ok: true });
    await first.syncPromise;
    assert.equal(calls.closes, 0, "late confirmation must not discard newer entered values");
    assert.equal(controls.get("cg-hoten").value, "Nội dung mới chưa lưu");
    assert.equal(controls.get("form-chuyengia-id").value, assignedId);
    controller.view.customConfirm = async () => { calls.versionPrompts++; return false; };
    controller.autoSync = async () => ({ ok: true });
    const second = await submit();
    await second.syncPromise;
    assert.equal(calls.persists.length, 2);
    assert.equal(controller.model.state.chuyengia.length, 1);
    assert.equal(controller.model.state.chuyengia[0].id, assignedId);
    assert.equal(controller.model.state.chuyengia[0].hoTen, "Nội dung mới chưa lưu");
    assert.equal(calls.versionPrompts, 1);
    assert.equal(calls.closes, 1);
  });
});

test("pending expert retry confirms only the earlier receipt and retains changed draft", async () => {
  await withExpertForm(async ({ controller, calls, controls, submit }) => {
    const first = await submit();
    await first.syncPromise;
    controls.get("cg-hoten").value = "Giữ bản sửa chủ động";
    controller.autoSync = async () => { calls.syncs++; return { ok: true }; };
    await submit();
    assert.equal(calls.persists.length, 1);
    assert.equal(calls.closes, 0);
    assert.equal(controls.get("cg-hoten").value, "Giữ bản sửa chủ động");
    assert.equal(controller._expertEditorPendingSubmission, null);
  });
});

for (const canonicalResult of [{ ok: false, status: 400 }, { ok: false, status: 409, conflict: true }]) {
  test(`rejected expert receipt retains draft for explicit retry: ${canonicalResult.status}`, async () => {
    await withExpertForm(async ({ controller, calls, controls, submit }) => {
      controller.autoSync = async () => canonicalResult;
      const result = await submit();
      await result.syncPromise;
      assert.equal(calls.closes, 0);
      assert.equal(controller._expertEditorPendingSubmission, null);
      assert.equal(controls.get("form-chuyengia-id").value, "");
      assert.equal(controls.get("cg-hoten").value, "Chuyên gia đang lưu");
      assert.equal(calls.persists.length, 1);
    });
  });
}

test("late expert receipt does not change a replacement editor or workspace", async () => {
  await withExpertForm(async ({ controller, calls, controls, submit }) => {
    const remote = deferred();
    controller.autoSync = () => remote.promise;
    const first = await submit();
    controller._expertEditorGeneration++;
    controller.model.state = { chuyengia: [], activeuser: {} };
    controls.get("form-chuyengia-id").value = "replacement";
    controls.get("cg-hoten").value = "Editor mới";
    remote.resolve({ ok: false, status: 409, conflict: true });
    await first.syncPromise;
    assert.equal(calls.closes, 0);
    assert.equal(controls.get("form-chuyengia-id").value, "replacement");
    assert.equal(controls.get("cg-hoten").value, "Editor mới");
  });
});
