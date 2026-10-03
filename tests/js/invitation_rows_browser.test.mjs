import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

test("invitation tables preserve multiline text, source identity and read-only textareas", async () => {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/views/css/runtime-styles.css" data-runtime-styles></head><body><div id="panel"></div></body></html>');
        return;
      }
      const path = resolve(projectRoot, `.${pathname}`);
      if (!path.startsWith(`${projectRoot}${sep}`)) throw new Error("Outside fixture");
      const payload = await readFile(path);
      response.setHeader("content-type", [".js", ".mjs"].includes(extname(path)) ? "text/javascript; charset=utf-8" : extname(path) === ".css" ? "text/css; charset=utf-8" : "text/plain; charset=utf-8");
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const resourceErrors = [];
    page.on("response", (response) => { if (response.status() >= 400) resourceErrors.push(`${response.status()} ${response.url()}`); });
    page.on("console", (message) => { if (message.type() === "error") resourceErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      globalThis.lucide = { createIcons() {} };
      const tables = await import("/frontend/shared/FormSubTables.js");
      const { renderPackageOpeningPanel } = await import("/frontend/packages/detail/PackageOpeningPanel.js");
      const model = {
        state: { chudautu: [] },
        formatForDatetimeLocal: (value) => value,
        formatCurrency: (value) => value,
        formatDateWithTime: (value) => value,
        getLatestPlan: () => null,
      };
      const controller = { model, validateGiaHanRealtime() {} };
      for (const method of ["addGiaHanRow", "addYeuCauLamRoRow", "addTraLoiLamRoRow", "_loadGiaHanRows", "_loadYeuCauLamRoRows", "_loadTraLoiLamRoRows", "updateGiaHanIndices", "updateYeuCauLamRoIndices", "updateTraLoiLamRoIndices", "_collectGiaHanRows", "_collectYeuCauLamRoRows", "_collectTraLoiLamRoRows"]) {
        controller[method] = tables[method].bind(controller);
      }
      const requestText = "Chủ đề\nCâu hỏi tiếng Việt\n</textarea><script>globalThis.injected = true</script>";
      const responseText = "Kính gửi\nNội dung trả lời đầy đủ\nTrân trọng./.";
      const reasonText = "Tạo thêm thời gian\nĐể chuẩn bị hồ sơ\n</textarea><script>globalThis.injected = true</script>";
      const pkg = { id: "package", trangThai: "Đang mời thầu", giaHanList: [{ id: "extension", sourceKey: "source-extension", thoiGianDongThau: "25/06/2026 09:00", lyDoGiaHan: reasonText }], yeuCauLamRoList: [{ id: "request", sourceKey: "source-request", thoiGianYeuCau: "15/06/2026 17:56", noiDungYeuCau: requestText }], traLoiLamRoList: [{ id: "response", thoiGianTraLoi: "16/06/2026 14:12", noiDungTraLoi: responseText }] };
      const view = { model, _biddingInfoEditMode: true };
      const container = document.getElementById("panel");
      const hiddenForm = document.createElement("form");
      hiddenForm.id = "form-goithau";
      hiddenForm.hidden = true;
      hiddenForm.innerHTML = '<table><tbody id="gt-giahan-tbody"></tbody></table><table><tbody id="gt-yeucaulamro-tbody"></tbody></table><table><tbody id="gt-traloilamro-tbody"></tbody></table>';
      document.body.prepend(hiddenForm);
      renderPackageOpeningPanel(view, { contentWrapper: container, pkg, appController: controller });
      controller.addYeuCauLamRoRow({ ...pkg.yeuCauLamRoList[0], id: "different-source-request", sourceKey: "different-source" }, container);
      const requestCount = controller._collectYeuCauLamRoRows(container).length;
      const request = controller._collectYeuCauLamRoRows(container)[0];
      const response = controller._collectTraLoiLamRoRows(container)[0];
      const sourceKey = container.querySelector("#gt-yeucaulamro-tbody tr").dataset.sourceKey;
      const extensionSourceKey = container.querySelector("#gt-giahan-tbody tr").dataset.sourceKey;
      controller.addGiaHanRow({ ...pkg.giaHanList[0], id: "different-extension", sourceKey: "other-extension" }, container);
      const extensions = controller._collectGiaHanRows(container);
      view._biddingInfoEditMode = false;
      renderPackageOpeningPanel(view, { contentWrapper: container, pkg, appController: controller });
      return { request, response, requestCount, sourceKey, extensionSourceKey, extensions, reasonText, injected: globalThis.injected === true, hiddenRows: hiddenForm.querySelectorAll("tbody tr").length, disabled: Array.from(container.querySelectorAll("textarea"), (input) => input.disabled), requestText, responseText };
    }).catch((error) => { throw new Error(`${error.message}\n${resourceErrors.join("\n")}`, { cause: error }); });
    assert.equal(result.request.noiDungYeuCau, result.requestText);
    assert.equal(result.response.noiDungTraLoi, result.responseText);
    assert.equal(result.sourceKey, "source-request");
    assert.equal(result.requestCount, 2);
    assert.equal(result.extensionSourceKey, "source-extension");
    assert.equal(result.extensions.length, 2);
    assert.equal(result.extensions[0].lyDoGiaHan, result.reasonText);
    assert.equal(result.injected, false);
    assert.equal(result.hiddenRows, 0);
    assert.deepEqual(result.disabled, [true, true, true]);

    const validation = await page.evaluate(async () => {
      const tables = await import("/frontend/shared/FormSubTables.js");
      document.getElementById("form-goithau").remove();
      document.getElementById("panel").innerHTML = '<input id="form-goithau-id" value="package"><input id="gt-thoigiandongthau" value="12/10/2026 09:00"><table><tbody id="gt-giahan-tbody"></tbody></table>';
      const history = [
        { id: "source-00", sourcePreviousClosingAt: "2026-09-18T10:00:00", thoiGianDongThau: "28/09/2026 10:00", lyDoGiaHan: "Điều chỉnh E-HSMT" },
        { id: "source-01a", thoiGianDongThau: "01/10/2026 10:00", lyDoGiaHan: "Trả lời làm rõ" },
        { id: "source-01b", thoiGianDongThau: "12/10/2026 09:00", lyDoGiaHan: "Sửa đổi E-HSMT" },
      ];
      const model = { state: { goithau: [] }, formatForDatetimeLocal: (value) => value };
      const controller = { model };
      for (const method of ["validateGiaHanRealtime", "updateGiaHanIndices", "addGiaHanRow", "_loadGiaHanRows"]) controller[method] = tables[method].bind(controller);
      const errorCount = () => document.querySelectorAll(".gh-row-error").length;
      controller._loadGiaHanRows(history);
      const importedErrors = errorCount();
      const sourcePrevious = document.querySelector("#gt-giahan-tbody tr").getAttribute("data-source-previous-closing-at");
      const savedRows = history.map(({ sourcePreviousClosingAt, ...row }) => row);
      model.state.goithau = [{ id: "package", giaHanList: savedRows }];
      controller._loadGiaHanRows(savedRows);
      const savedErrors = errorCount();
      document.querySelector(".gh-time-input").value = "20/09/2026 10:00";
      controller.validateGiaHanRealtime();
      const changedHistoricalErrors = errorCount();
      controller._loadGiaHanRows([{ id: "manual", thoiGianDongThau: "01/10/2026 10:00", lyDoGiaHan: "Manual" }]);
      const manualErrors = errorCount();
      document.querySelector(".gh-time-input").value = "13/10/2026 09:00";
      controller.validateGiaHanRealtime();
      return { importedErrors, sourcePrevious, savedErrors, changedHistoricalErrors, manualErrors, validManualErrors: errorCount() };
    });
    assert.deepEqual(validation, {
      importedErrors: 0, sourcePrevious: "2026-09-18T10:00:00", savedErrors: 0,
      changedHistoricalErrors: 1, manualErrors: 1, validManualErrors: 0,
    });

    const preview = {
      schemaVersion: "biddingflow-procurement-preview-v1", kind: "PACKAGE", canonicalCode: "IB2600493339",
      canonical: { canonicalCode: "IB2600493339", revisions: ["00", "01", "02"].map((version) => ({
        noticeNo: "IB2600493339", revisionNumber: version,
        clarificationAvailable: version !== "02", clarificationStatus: version === "02" ? "REVISION_UNAVAILABLE" : "AVAILABLE",
        extensionAvailable: version !== "02", extensionStatus: version === "02" ? "SOURCE_UNAVAILABLE" : "AVAILABLE",
        clarificationRequests: version === "02" ? [] : Array.from({ length: version === "00" ? 2 : 1 }, (_, index) => ({ sourceRequestNo: `CID-${version}-${index}`, requestedAt: `2026-09-${version === "00" ? 13 + index : 19}T11:16:44`, content: "Yêu cầu về kỹ thuật\nChi tiết tại file đính kèm" })),
        clarificationResponses: version === "02" ? [] : Array.from({ length: version === "00" ? 2 : 1 }, (_, index) => ({ sourceRequestNo: `CID-${version}-${index}`, respondedAt: "2026-09-19T09:34:21", content: "Yêu cầu về kỹ thuật\nChi tiết tại file đính kèm" })),
        extensions: version === "00" ? [{ sourceExtensionId: "source-00", previousClosingAt: "2026-09-18T10:00:00", newClosingAt: "2026-09-28T10:00:00", reason: "Điều chỉnh E-HSMT" }]
          : version === "01" ? [{ sourceExtensionId: "source-01a", previousClosingAt: "2026-09-28T10:00:00", newClosingAt: "2026-10-01T10:00:00", reason: "Trả lời làm rõ" }, { sourceExtensionId: "source-01b", previousClosingAt: "2026-10-01T10:00:00", newClosingAt: "2026-10-12T09:00:00", reason: "Sửa đổi E-HSMT" }] : [],
      })) },
    };
    const lookupRequests = [];
    await page.route("**/api/procurement/lookup", async (route) => {
      lookupRequests.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preview) });
    });
    await page.evaluate(async () => {
      document.cookie = "csrf_token=invitation-fixture; path=/";
      const tables = await import("/frontend/shared/FormSubTables.js");
      const formats = await import("/frontend/shared/formatters.js");
      const { WorkspaceMutationOutbox } = await import("/frontend/app/WorkspaceMutationOutbox.js");
      const { updateServerCapabilitiesFromSession } = await import("/frontend/auth/serverCapabilities.js");
      const { renderPackageOpeningPanel } = await import("/frontend/packages/detail/PackageOpeningPanel.js");
      updateServerCapabilitiesFromSession({ valid: true, user: { id: "actor" }, serverCapabilities: ["procurement-lookup-v1"] });
      const pkg = { id: "package", rowVersion: 1, maGoiThau: "IB2600493339", phienBan: "02", trangThai: "Đang mời thầu", thoiGianDongThau: "2026-10-12T09:00:00", thoiGianMoThau: "2026-10-12T09:00:00", giaHanList: [], yeuCauLamRoList: [], traLoiLamRoList: [] };
      const durable = new Map([[pkg.id, structuredClone(pkg)]]);
      const outbox = new WorkspaceMutationOutbox({ store: { persist() {}, async flush() {} }, getBaseSyncVersion: () => "1", isSyncedType: () => true, normalizeRecord: (record) => structuredClone(record), serializeRecord: (record) => structuredClone(record) });
      const model = {
        state: { activeuser: { id: "actor" }, chudautu: [], goithau: [pkg] },
        db: { stores: ["goithau"], async putRecord(_table, record) { durable.set(record.id, structuredClone(record)); } },
        workspaceScope: { key: "org-1", organizationId: "org-1" }, getWorkspaceToken() { return this.workspaceScope.key; },
        hasPermission: () => true, getLatestPlan: () => null, ...formats,
        beginWorkspaceMutation() { return { state: this.state, db: this.db, outbox, done: false }; },
        finishWorkspaceMutation(mutation) { mutation.done = true; },
        workspaceMutationUsesCurrentResources(mutation) { return mutation.state === this.state && mutation.db === this.db; },
        commitWorkspaceMutation(_mutation, table, { records, baseRecords }) { outbox.enqueue({ kind: "upsert", table, records, baseRecords }); },
        async persistChanges(_table, { upserts }) { upserts.forEach((record) => durable.set(record.id, structuredClone(record))); },
        flushMutationOutbox: () => outbox.flush(),
      };
      const controller = {
        model, async autoSync() {
          await new Promise((resolve) => { globalThis.__confirmInvitationSync = resolve; });
          outbox.ack(outbox.snapshotForSync(model.state)?.snapshot);
          return { ok: true };
        },
        async fetchRecordByLookup(_table, id) {
          const saved = { ...structuredClone(durable.get(id)), rowVersion: 2 };
          model.state.goithau = [saved];
          return saved;
        },
      };
      for (const method of ["addGiaHanRow", "addYeuCauLamRoRow", "addTraLoiLamRoRow", "_loadGiaHanRows", "_loadYeuCauLamRoRows", "_loadTraLoiLamRoRows", "_collectGiaHanRows", "_collectYeuCauLamRoRows", "_collectTraLoiLamRoRows", "validateGiaHanRealtime"]) controller[method] = tables[method].bind(controller);
      const view = { model, _biddingInfoEditMode: false, _currentWorkflowPackageId: pkg.id };
      globalThis.__invitationModel = model;
      globalThis.__invitationController = controller;
      globalThis.__invitationView = view;
      globalThis.__invitationOriginal = structuredClone(pkg);
      renderPackageOpeningPanel(view, { contentWrapper: document.getElementById("panel"), pkg, appController: controller });
      globalThis.__invitationUpdate = document.getElementById("btn-invitation-import-msc").onclick()
        .finally(() => { globalThis.__invitationSettled = true; });
    });
    await page.waitForFunction(() => typeof globalThis.__confirmInvitationSync === "function" || globalThis.__invitationSettled === true);
    const pendingSave = await page.evaluate(() => ({
      waiting: typeof globalThis.__confirmInvitationSync === "function",
      status: document.querySelector("#panel #invitation-import-status").textContent,
    }));
    assert.equal(pendingSave.waiting, true, `Expected canonical save: ${pendingSave.status}\n${resourceErrors.join("\n")}`);
    assert.deepEqual(lookupRequests.map(({ detailLevel, revisionMode }) => ({ detailLevel, revisionMode })), [{ detailLevel: "COMPLETE", revisionMode: "ALL" }]);
    const beforeConfirmation = await page.evaluate(() => ({
      visibleButton: Boolean(document.querySelector("#panel #btn-invitation-import-msc")),
      rows: document.querySelectorAll("#panel tbody tr").length,
      originalUnchanged: JSON.stringify(globalThis.__invitationModel.state.goithau[0]) === JSON.stringify(globalThis.__invitationOriginal),
      successMessage: document.querySelector("#panel #invitation-import-status").textContent,
    }));
    assert.deepEqual(beforeConfirmation, { visibleButton: true, rows: 0, originalUnchanged: true, successMessage: "" });
    await page.evaluate(async () => { globalThis.__confirmInvitationSync(); await globalThis.__invitationUpdate; });
    const confirmed = await page.evaluate(() => ({
      counts: ["gt-yeucaulamro-tbody", "gt-traloilamro-tbody", "gt-giahan-tbody"].map((id) => document.querySelectorAll(`#panel #${id} tr`).length),
      disabled: Array.from(document.querySelectorAll("#panel textarea"), (control) => control.disabled),
      status: document.querySelector("#panel #invitation-import-status").textContent,
      rowVersion: globalThis.__invitationModel.state.goithau[0].rowVersion,
    }));
    assert.deepEqual(confirmed.counts, [3, 3, 3]);
    assert.ok(confirmed.disabled.every(Boolean));
    assert.equal(confirmed.rowVersion, 2);
    assert.match(confirmed.status, /Đã cập nhật và lưu 3 yêu cầu, 3 trả lời làm rõ và 3 lần gia hạn/);
    assert.match(confirmed.status, /làm rõ ở phiên bản 02/);
    assert.equal(await page.locator("#panel .helper-text").textContent(), "Tổng hợp các lần gia hạn từ tất cả phiên bản thông báo mời thầu.");
    if (process.env.BIDDING_INVITATION_SCREENSHOT) {
      await page.setViewportSize({ width: 1440, height: 1250 });
      for (const name of ["variables", "base", "components", "views", "generated-static-styles"]) {
        await page.addStyleTag({ url: `/views/css/${name}.css` });
      }
      await page.locator("#panel").screenshot({ path: process.env.BIDDING_INVITATION_SCREENSHOT });
    }

    const committedReloadFailure = await page.evaluate(async () => {
      const { renderPackageOpeningPanel } = await import("/frontend/packages/detail/PackageOpeningPanel.js");
      const model = globalThis.__invitationModel;
      const controller = globalThis.__invitationController;
      const view = globalThis.__invitationView;
      const alerts = [];
      view.customAlert = async (title, message) => { alerts.push({ title, message }); };
      view._biddingInfoEditMode = true;
      renderPackageOpeningPanel(view, { contentWrapper: document.getElementById("panel"), pkg: model.state.goithau[0], appController: controller });
      document.querySelector("#panel .yc-content-input").value = "Bản nháp sửa nội dung";
      controller.autoSync = async () => ({ ok: true });
      controller.fetchRecordByLookup = async () => { throw new Error("Canonical reload unavailable"); };
      await document.querySelector("#panel #btn-luu-thongtinmoithau").onclick();
      return {
        editing: view._biddingInfoEditMode,
        saveLabel: document.querySelector("#panel #btn-luu-thongtinmoithau").textContent.trim(),
        disabled: Array.from(document.querySelectorAll("#panel textarea"), (control) => control.disabled),
        status: document.querySelector("#panel #invitation-import-status").textContent,
        alerts,
      };
    });
    assert.equal(committedReloadFailure.editing, false);
    assert.equal(committedReloadFailure.saveLabel, "Chỉnh sửa");
    assert.ok(committedReloadFailure.disabled.every(Boolean));
    assert.match(committedReloadFailure.status, /Máy chủ đã xác nhận/);
    assert.deepEqual(committedReloadFailure.alerts, [{
      title: "Đã lưu thông tin mời thầu",
      message: "Máy chủ đã xác nhận thay đổi nhưng chưa tải lại được dữ liệu. Mở lại gói thầu để xem dữ liệu đã lưu.",
    }]);
    assert.doesNotMatch(committedReloadFailure.status, /chưa xác nhận|thử lưu/);
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
});
