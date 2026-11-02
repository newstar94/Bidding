import { getAppController } from "../app/controllerRef.js";
import { serializeOutboundRecord } from "../app/outboundSerializer.js";
import { organizationEmployeeLabel } from "../auth/accessContext.js";
import { ensureCurrentUserAssignee } from "../packages/packageAssignmentPolicy.js";
import { getBusinessListSelection } from "./BusinessListSelection.js";
import {
  BUSINESS_LIST_BULK_DELETE_LIMIT, createBusinessListBulkSession, submitBusinessListBulkUpdate,
} from "./BusinessListBulkDeleteService.js";
import { bulkTargetLabel, resolveBusinessListBulkTargets } from "./BusinessListBulkTargets.js";
import { beginLongTaskLoading } from "./LongTaskLoading.js";
import { classForRuntimeDeclarations } from "./runtimeStyles.js";
import { generateRecordId } from "./idUtils.js";
import { initializeMultiAssigneeSelect, normalizeAssigneeIds, selectedAssigneeIds } from "./MultiAssigneeSelect.js";
import { loadWorkspaceEmployees } from "./workspaceEmployeeLoader.js";
import { trustedHTML } from "./trustedTypes.js";
import { escapeHtml } from "./view_helpers.js";

const LABELS = { kehoach: "kế hoạch", goithau: "gói thầu", hopdong: "hợp đồng" };
const FILE_LABELS = { kehoach: "Ke_hoach", goithau: "Goi_thau", hopdong: "Hop_dong" };
const ACTION_TYPES = {
  assign: new Set(["goithau", "hopdong"]),
  status: new Set(["hopdong"]),
  word: new Set(["kehoach", "goithau", "hopdong"]),
};
const ACTIVE = new WeakSet();
const MAX_ASSIGNMENT_SCAN = 50_000;
const SNAPSHOT_RETRY_CODES = new Set(["EXPORT_SNAPSHOT_STALE", "EXPORT_SNAPSHOT_CHANGED"]);
const count = (value) => Number(value || 0).toLocaleString("vi-VN");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function dialog(view, method, ...args) {
  const message = globalThis.document?.getElementById("dialog-message");
  const className = message && classForRuntimeDeclarations("max-height:32vh;overflow-y:auto;white-space:pre-line;overflow-wrap:anywhere");
  if (className) message.classList.add(className);
  try {
    return await view[method](...args);
  } finally {
    if (className) message.classList.remove(className);
  }
}

function numberedNames(records, type) {
  return records.map((record, index) => `${index + 1}. ${bulkTargetLabel(record, type)}`).join("\n");
}

function isWorkspaceChange(error) {
  return error?.code === "WORKSPACE_CHANGED"
    || (error?.name === "AbortError" && error?.code !== "PAGINATION_AUTHORIZATION_SCOPE_CHANGED");
}

async function prepareTargets(controller, descriptor, { action, createSession, resolveTargets, beginLoading }) {
  const loading = await beginLoading({
    task: `business-list-bulk-${action}-prepare`, title: "Đang kiểm tra dữ liệu đã chọn",
    message: "Đang tải phiên bản hiện tại của các dòng đã chọn…",
    minimumVisibleMs: 0, exitTransitionMs: 0,
  });
  try {
    const session = await createSession(controller, { action: action === "word" ? "export" : "update" });
    try {
      const targets = await resolveTargets({
        descriptor: structuredClone(descriptor), ...session, maxRecords: BUSINESS_LIST_BULK_DELETE_LIMIT,
      });
      return { session, targets };
    } catch (error) {
      session.close();
      throw error;
    }
  } finally {
    await loading.close();
  }
}

async function submitUpdate(context, command, { submit, beginLoading, title, success }) {
  while (true) {
    context.session.assertCurrent();
    const loading = await beginLoading({
      task: "business-list-bulk-update", title,
      message: "Đang chờ máy chủ xác nhận toàn bộ yêu cầu…",
      minimumVisibleMs: 0, exitTransitionMs: 0,
    });
    let result;
    try {
      result = await submit(context.session, command);
    } finally {
      await loading.close();
    }
    if (result?.workspaceChanged) return result;
    if (result?.ok) {
      context.view.showToast?.(
        result.refreshPending ? "Đã cập nhật, cần làm mới danh sách" : success,
        result.refreshPending ? "Máy chủ đã xác nhận thay đổi. Vui lòng tải lại danh sách để xem dữ liệu mới nhất." : "Toàn bộ thay đổi đã được máy chủ xác nhận.",
        result.refreshPending ? "warning" : "success",
      );
      return result;
    }
    if (!result?.unknown) {
      const details = (result?.errors || []).map((error) => [error.table, error.id, error.message || error.reason].filter(Boolean).join(" · "));
      await dialog(context.view, "customAlert", "Không thể cập nhật", [result?.message || "Máy chủ từ chối thay đổi.", ...details].join("\n"), "alert-triangle");
      return result || { ok: false };
    }
    const retry = await dialog(context.view, "customConfirm", "Chưa xác định kết quả",
      `Chưa xác định máy chủ đã hoàn tất yêu cầu hay chưa. Thử lại sẽ kiểm tra và gửi lại đúng yêu cầu đã xác nhận.\n\n${context.summary}`,
      "alert-triangle", { confirmLabel: "Thử lại yêu cầu này", cancelLabel: "Để sau" });
    if (!retry) {
      context.view.showToast?.("Chưa xác định kết quả", "Vui lòng tải lại danh sách để kiểm tra dữ liệu trước khi thao tác lại.", "warning");
      return result;
    }
  }
}

async function guarded(controller, run) {
  if (ACTIVE.has(controller)) return { ok: false, busy: true };
  ACTIVE.add(controller);
  let session;
  try {
    return await run((value) => { session = value; });
  } catch (error) {
    if (isWorkspaceChange(error)) return { ok: false, workspaceChanged: true };
    await dialog(controller.view, "customAlert", "Không thể thực hiện", error?.message || "Chưa thể kiểm tra dữ liệu đã chọn. Vui lòng thử lại.", "alert-triangle");
    return { ok: false, error };
  } finally {
    session?.close?.();
    ACTIVE.delete(controller);
  }
}

// ---------- Assignment ----------

async function promptAssignment(view, { title, message, options }) {
  const okBtn = globalThis.document.getElementById("btn-dialog-ok");
  const pending = view.customConfirm(title, message, "users-round", { confirmLabel: "Tiếp tục", cancelLabel: "Hủy" });
  const messageEl = globalThis.document.getElementById("dialog-message");
  const content = globalThis.document.createElement("div");
  content.className = "business-list-bulk-dialog";
  content.innerHTML = trustedHTML(`
    <div class="form-group">
      <label for="business-list-bulk-assignees">Chuyên viên phụ trách</label>
      <select id="business-list-bulk-assignees" multiple data-no-custom="true">
        ${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
      </select>
    </div>
    <fieldset class="assignment-transfer-mode-group">
      <legend>Cách áp dụng</legend>
      <div class="assignment-transfer-mode-options">
        <label class="assignment-transfer-mode is-selected">
          <input type="radio" name="business-list-bulk-assignment-mode" value="add" checked>
          <span><strong>Thêm vào hiện có</strong><small>Giữ người đang phụ trách, chỉ thêm người được chọn</small></span>
        </label>
        <label class="assignment-transfer-mode">
          <input type="radio" name="business-list-bulk-assignment-mode" value="replace">
          <span><strong>Thay thế toàn bộ</strong><small>Người được chọn trở thành danh sách phụ trách duy nhất</small></span>
        </label>
      </div>
    </fieldset>`);
  messageEl?.after(content);
  const select = content.querySelector("select");
  initializeMultiAssigneeSelect(select, { searchPlaceholder: "Chọn hoặc tìm chuyên viên phụ trách..." });
  const mode = () => content.querySelector("input[name='business-list-bulk-assignment-mode']:checked")?.value || "add";
  const update = () => {
    if (okBtn) okBtn.disabled = selectedAssigneeIds(select).length === 0;
    content.querySelectorAll(".assignment-transfer-mode").forEach((label) => {
      label.classList.toggle("is-selected", Boolean(label.querySelector("input")?.checked));
    });
  };
  content.addEventListener("change", update);
  update();
  try {
    const confirmed = await pending;
    return confirmed ? { employeeIds: normalizeAssigneeIds(selectedAssigneeIds(select)), mode: mode() } : null;
  } finally {
    select.__bfMultiAssigneeSelect?.destroy?.();
    content.remove();
    if (okBtn) okBtn.disabled = false;
  }
}

async function readAllAssignments(session) {
  const rows = [];
  const ids = new Set();
  const cursors = new Set();
  let cursor = "";
  do {
    const page = await session.readPage("assignments", {
      pageSize: 200, pagination: "cursor", sortBy: "id", sortOrder: "asc", ...(cursor ? { cursor } : {}),
    });
    if (!Array.isArray(page?.items) || typeof page.hasMore !== "boolean") {
      throw fail("BULK_ACTION_UNCONFIRMED", "Chưa đọc được đầy đủ dữ liệu phân công. Vui lòng thử lại.");
    }
    for (const item of page.items) {
      const id = String(item?.id || "");
      if (!id || ids.has(id)) throw fail("BULK_ACTION_SELECTION_CHANGED", "Dữ liệu phân công thay đổi trong lúc chuẩn bị. Vui lòng thử lại.");
      ids.add(id);
      rows.push(item);
    }
    if (rows.length > MAX_ASSIGNMENT_SCAN) throw fail("BULK_ACTION_TOO_LARGE", "Dữ liệu phân công vượt giới hạn chuẩn bị. Vui lòng liên hệ quản trị.");
    if (!page.hasMore) break;
    const next = String(page.nextCursor || "");
    if (!page.items.length || !next || cursors.has(next)) throw fail("BULK_ACTION_UNCONFIRMED", "Không thể đọc đầy đủ dữ liệu phân công. Vui lòng thử lại.");
    cursors.add(next);
    cursor = next;
  } while (cursor);
  return rows;
}

/** Build the exact assignment delta for current-version targets. */
export function buildBulkAssignmentCommand({ type, records, assignments, employeeIds, mode, syncVersion, createId = () => generateRecordId("assignments") }) {
  const selected = normalizeAssigneeIds(employeeIds);
  if (!selected.length || !["add", "replace"].includes(mode)) throw fail("BULK_ACTION_INVALID_COMMAND", "Vui lòng chọn ít nhất một chuyên viên phụ trách.");
  const byTarget = new Map();
  for (const assignment of assignments) {
    if (String(assignment?.type || "") !== type) continue;
    const target = String(assignment.targetId || "");
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(assignment);
  }
  const additions = [];
  const deletions = [];
  let changedTargets = 0;
  for (const record of records) {
    const targetId = String(record.id);
    const existing = byTarget.get(targetId) || [];
    const existingEmployees = new Set(existing.map((assignment) => String(assignment.empId || "")));
    const before = additions.length + deletions.length;
    for (const empId of selected) {
      if (!existingEmployees.has(empId)) additions.push({ id: createId(), empId, targetId, type });
    }
    if (mode === "replace") {
      for (const assignment of existing) {
        if (selected.includes(String(assignment.empId || ""))) continue;
        deletions.push({ table: "assignments", id: String(assignment.id),
          ...(Number.isSafeInteger(assignment.rowVersion) && assignment.rowVersion > 0 ? { expectedVersion: assignment.rowVersion } : {}) });
      }
    }
    if (additions.length + deletions.length > before) changedTargets += 1;
  }
  return {
    changedTargets, additionCount: additions.length, removalCount: deletions.length,
    command: {
      expectedSyncVersion: String(syncVersion),
      ...(additions.length ? { upserts: { assignments: additions } } : {}),
      deletions,
    },
  };
}

export async function runBusinessListBulkAssignment(controller, descriptor, {
  createSession = createBusinessListBulkSession, resolveTargets = resolveBusinessListBulkTargets,
  submit = submitBusinessListBulkUpdate, beginLoading = beginLongTaskLoading,
  loadEmployees = loadWorkspaceEmployees, prompt = promptAssignment,
} = {}) {
  const { model, view } = controller;
  const { type } = descriptor;
  if (!ACTION_TYPES.assign.has(type) || model.state.activerole === "employee") return { ok: false, unsupported: true };
  return guarded(controller, async (track) => {
    const currentUserId = String(model.state.activeuser?.id || "");
    const employees = model.state.employees?.length ? model.state.employees : await loadEmployees(model);
    const options = ensureCurrentUserAssignee(employees, {
      id: currentUserId, name: model.state.activeuser?.name, email: model.state.activeuser?.email,
      role: model.state.activerole,
    }).filter((employee) => String(employee?.id || "")).map((employee) => ({
      value: String(employee.id), label: organizationEmployeeLabel(employee) || String(employee.id),
    }));
    const choice = await prompt(view, {
      title: "Phân công phụ trách hàng loạt",
      message: `Áp dụng cho ${count(descriptor.count)} ${LABELS[type]} đã chọn. Hệ thống kiểm tra quyền từng dòng; một dòng không hợp lệ sẽ hủy cả đợt.`,
      options,
    });
    if (!choice) return { ok: false, cancelled: true };
    const { session, targets } = await prepareTargets(controller, descriptor, { action: "assign", createSession, resolveTargets, beginLoading });
    track(session);
    const assignments = await readAllAssignments(session);
    if (Number(await session.readSyncVersion()) !== targets.syncVersion) {
      throw fail("BULK_ACTION_SELECTION_CHANGED", "Dữ liệu thay đổi trong lúc chuẩn bị. Vui lòng tải lại danh sách và chọn lại.");
    }
    const plan = buildBulkAssignmentCommand({ type, records: targets.records, assignments, ...choice, syncVersion: targets.syncVersion });
    if (!plan.changedTargets) {
      await dialog(view, "customAlert", "Không có thay đổi", "Các dòng đã chọn đã có đúng người phụ trách này.", "info");
      return { ok: true, unchanged: true };
    }
    if (plan.additionCount + plan.removalCount > BUSINESS_LIST_BULK_DELETE_LIMIT) {
      throw fail("BULK_ACTION_TOO_LARGE", `Đợt này gồm ${count(plan.additionCount + plan.removalCount)} thay đổi phân công, vượt giới hạn ${count(BUSINESS_LIST_BULK_DELETE_LIMIT)} mỗi đợt. Vui lòng giảm số dòng đã chọn.`);
    }
    const names = new Map(options.map((option) => [option.value, option.label]));
    const summary = [
      `Đã chọn ${count(targets.records.length)} ${LABELS[type]}; ${count(plan.changedTargets)} dòng có thay đổi.`,
      `${choice.mode === "replace" ? "Thay thế toàn bộ người phụ trách bằng" : "Thêm người phụ trách"}: ${choice.employeeIds.map((id) => names.get(id) || id).join(", ")}.`,
      `Thêm ${count(plan.additionCount)} phân công${choice.mode === "replace" ? `, gỡ ${count(plan.removalCount)} phân công` : ""}.`,
      numberedNames(targets.records, type),
      "Nếu một dòng không thể cập nhật, toàn bộ yêu cầu sẽ bị từ chối; không cập nhật một phần.",
    ].join("\n\n");
    if (!await dialog(view, "customConfirm", "Xác nhận phân công", summary, "users-round", { confirmLabel: "Phân công" })) {
      return { ok: false, cancelled: true };
    }
    return submitUpdate({ view, session, summary }, plan.command, {
      submit, beginLoading, title: "Đang phân công phụ trách",
      success: `Đã phân công cho ${count(plan.changedTargets)} ${LABELS[type]}`,
    });
  });
}

// ---------- Contract status ----------

/** Build an in-place status update for current contract versions. */
export function buildBulkContractStatusCommand({ records, status, syncVersion, model, now = "" }) {
  const target = String(status || "").trim();
  if (!target) throw fail("BULK_ACTION_INVALID_COMMAND", "Vui lòng chọn trạng thái hợp đồng.");
  const normalize = (value, table) => (typeof model?.normalizeRecordKeys === "function" ? model.normalizeRecordKeys(value, table) : value);
  const changed = records.filter((record) => String(record.trangThaiHopDong || "") !== target);
  const upserts = changed.map((record) => {
    // The writer replaces contract-package links from goiThauIds; never send
    // a contract whose links were not part of the canonical read.
    if (!Array.isArray(record.goiThauIds)) {
      throw fail("BULK_ACTION_RECORD_CHANGED", "Chưa xác nhận được gói thầu liên kết của hợp đồng. Vui lòng tải lại danh sách.");
    }
    const serialized = serializeOutboundRecord({ ...record, trangThaiHopDong: target, ...(now ? { updatedAt: now } : {}) }, "hopdong", normalize);
    if (!Number.isSafeInteger(serialized?.expectedVersion) || serialized.expectedVersion !== record.rowVersion) {
      throw fail("BULK_ACTION_RECORD_CHANGED", "Chưa xác nhận được phiên bản của hợp đồng. Vui lòng tải lại danh sách.");
    }
    return serialized;
  });
  return {
    changedCount: changed.length,
    command: changed.length ? {
      expectedSyncVersion: String(syncVersion),
      upserts: { hopdong: upserts },
      projectedFields: { hopdong: ["trangThaiHopDong", ...(now ? ["updatedAt"] : [])] },
      deletions: [],
    } : null,
  };
}

export async function runBusinessListBulkContractStatus(controller, descriptor, {
  createSession = createBusinessListBulkSession, resolveTargets = resolveBusinessListBulkTargets,
  submit = submitBusinessListBulkUpdate, beginLoading = beginLongTaskLoading,
} = {}) {
  const { model, view } = controller;
  if (descriptor.type !== "hopdong") return { ok: false, unsupported: true };
  return guarded(controller, async (track) => {
    const statuses = (model.state.customcontractstatuses || []).map((status) => String(status?.name || "").trim()).filter(Boolean);
    if (!statuses.length) {
      await dialog(view, "customAlert", "Chưa có trạng thái hợp đồng", "Tổ chức chưa khai báo danh mục trạng thái hợp đồng.", "info");
      return { ok: false, cancelled: true };
    }
    const status = await view.customSelectConfirm("Đổi trạng thái hợp đồng",
      `Chọn trạng thái mới cho ${count(descriptor.count)} hợp đồng đã chọn. Trạng thái được ghi vào phiên bản hiện tại, không tạo phiên bản mới.`,
      statuses.map((name) => ({ value: name, label: name })));
    if (!status) return { ok: false, cancelled: true };
    const { session, targets } = await prepareTargets(controller, descriptor, { action: "status", createSession, resolveTargets, beginLoading });
    track(session);
    const plan = buildBulkContractStatusCommand({ records: targets.records, status, syncVersion: targets.syncVersion, model,
      now: model.getCurrentDateTimeString?.() || "" });
    if (!plan.command) {
      await dialog(view, "customAlert", "Không có thay đổi", `Các hợp đồng đã chọn đều đang ở trạng thái “${status}”.`, "info");
      return { ok: true, unchanged: true };
    }
    const summary = [
      `Đổi ${count(plan.changedCount)}/${count(targets.records.length)} hợp đồng sang trạng thái “${status}”.`,
      numberedNames(targets.records.filter((record) => String(record.trangThaiHopDong || "") !== status), "hopdong"),
      "Nếu một hợp đồng không thể cập nhật, toàn bộ yêu cầu sẽ bị từ chối; không cập nhật một phần.",
    ].join("\n\n");
    if (!await dialog(view, "customConfirm", "Xác nhận đổi trạng thái", summary, "help-circle", { confirmLabel: "Đổi trạng thái" })) {
      return { ok: false, cancelled: true };
    }
    return submitUpdate({ view, session, summary }, plan.command, {
      submit, beginLoading, title: "Đang đổi trạng thái hợp đồng",
      success: `Đã đổi trạng thái ${count(plan.changedCount)} hợp đồng`,
    });
  });
}

// ---------- Word export ----------

function saveBlob(blob, filename) {
  const anchor = globalThis.document.createElement("a");
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = filename;
  globalThis.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout?.(() => URL.revokeObjectURL(url), 1_000);
}

function timestampToken(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function withTemplates(url, templates) {
  return templates.reduce((current, template) => (
    `${current}${current.includes("?") ? "&" : "?"}templateFilename=${encodeURIComponent(template.filename)}`
  ), url);
}

/** Describe the per-record export request, mirroring the single-record entry points. */
export function bulkWordExportRequest(type, record, { documentType, templates, buildRequest, contractFilename }) {
  if (type === "hopdong") {
    const packageId = String(record.goiThauIds?.[0] || "");
    if (!packageId) return null;
    return { createJobUrl: `/api/document-jobs/package-report/${encodeURIComponent(packageId)}?type=contract`,
      filename: contractFilename(record.soHopDong) };
  }
  const request = buildRequest({ documentType, plan: type === "kehoach" ? record : null, packageRecord: type === "goithau" ? record : null });
  return {
    createJobUrl: withTemplates(request.createJobUrl, templates),
    filename: templates.length > 1 ? request.filename.replace(/\.docx$/iu, ".zip") : request.filename,
  };
}

async function loadWordModules() {
  const [policy, state, config, job, contract, zip, snapshot] = await Promise.all([
    import("../documents/WordPublicationPolicy.js"),
    import("../documents/WordPublicationState.js"),
    import("../documents/WordPublicationTemplateConfig.js"),
    import("../documents/WordPublicationJob.js"),
    import("../contracts/ContractWordExport.js"),
    import("./zipStore.js"),
    import("./exportSnapshot.js"),
  ]);
  return { ...policy, ...state, ...config, ...job, ...contract, ...zip, ...snapshot };
}

export async function runBusinessListBulkWordExport(controller, descriptor, {
  createSession = createBusinessListBulkSession, resolveTargets = resolveBusinessListBulkTargets,
  beginLoading = beginLongTaskLoading, modules = null, save = saveBlob, now = () => new Date(),
} = {}) {
  const { model, view } = controller;
  const { type } = descriptor;
  if (!ACTION_TYPES.word.has(type)) return { ok: false, unsupported: true };
  if (!model.state.activeuser?.wordExportEnabled) {
    await dialog(view, "customAlert", "Chức năng cần quyền xuất Word", "Phạm vi đang làm việc chưa có quyền tạo hoặc tải tài liệu Word.", "lock-keyhole");
    return { ok: false, blocked: true };
  }
  return guarded(controller, async (track) => {
    const word = modules || await loadWordModules();
    let documentType = null;
    let templates = [];
    if (type !== "hopdong") {
      if (type === "kehoach") {
        documentType = word.WORD_PUBLICATION_DOCUMENTS.find((item) => item.exportTarget?.scope === "plan");
      } else {
        const packageTypes = word.WORD_PUBLICATION_DOCUMENTS.filter((item) => item.exportTarget?.scope === "package");
        const selected = await view.customSelectConfirm("Xuất Word hàng loạt",
          `Chọn loại văn bản cần xuất cho ${count(descriptor.count)} gói thầu đã chọn.`,
          packageTypes.map((item) => ({ value: item.id, label: item.label })));
        if (!selected) return { ok: false, cancelled: true };
        documentType = packageTypes.find((item) => item.id === selected);
      }
      const config = await word.loadWordPublicationTemplateConfig(controller);
      templates = word.resolvedWordPublicationTemplates(config, documentType?.id);
      if (!documentType || !templates.length) {
        await dialog(view, "customAlert", "Chưa chọn biểu mẫu Word", "Hãy gán biểu mẫu phù hợp cho chức năng này trong màn hình Biểu mẫu Word.", "file-warning");
        return { ok: false, blocked: true };
      }
    }
    const { session, targets } = await prepareTargets(controller, descriptor, { action: "word", createSession, resolveTargets, beginLoading });
    track(session);
    const jobs = [];
    const skipped = [];
    for (const record of targets.records) {
      const applicable = type !== "goithau"
        || word.getAvailableWordPublicationTypes({ packageRecord: record }).some((item) => item.id === documentType.id);
      const request = applicable ? bulkWordExportRequest(type, record, {
        documentType, templates, buildRequest: word.buildWordPublicationExportRequest, contractFilename: word.contractFilename,
      }) : null;
      if (request) jobs.push({ record, request });
      else skipped.push(bulkTargetLabel(record, type));
    }
    if (!jobs.length) {
      await dialog(view, "customAlert", "Không có tài liệu để xuất",
        type === "hopdong" ? "Các hợp đồng đã chọn chưa liên kết gói thầu nên chưa thể xuất hợp đồng." : "Loại văn bản này không áp dụng cho các gói thầu đã chọn.", "info");
      return { ok: false, blocked: true };
    }
    const label = type === "hopdong" ? "Hợp đồng" : documentType.label;
    const confirmation = [
      `Xuất “${label}” cho ${count(jobs.length)} ${LABELS[type]}${templates.length > 1 ? ` (mỗi dòng ${templates.length} biểu mẫu)` : ""}.`,
      skipped.length ? `Bỏ qua ${count(skipped.length)} dòng không áp dụng:\n${skipped.join("\n")}` : "",
      "Mỗi tài liệu được tạo bằng đúng quy trình xuất từng bản ghi và gộp vào một tệp ZIP. Có thể dừng sau tài liệu đang tạo.",
    ].filter(Boolean).join("\n\n");
    if (!await dialog(view, "customConfirm", "Xác nhận xuất Word", confirmation, "file-text", { confirmLabel: "Xuất Word" })) {
      return { ok: false, cancelled: true };
    }

    let stopped = false;
    let snapshotVersion = String(await session.readSyncVersion());
    const loading = await beginLoading({
      task: "business-list-bulk-word-export", title: "Đang xuất Word hàng loạt",
      message: `Đang chuẩn bị 0/${count(jobs.length)} tài liệu…`,
      minimumVisibleMs: 0, exitTransitionMs: 0,
      onCancel: () => { stopped = true; }, cancelLabel: "Dừng sau tài liệu hiện tại",
    });
    const files = [];
    const failures = [];
    try {
      for (const [index, { record, request }] of jobs.entries()) {
        if (stopped) break;
        await loading.update("working", `Đang tạo ${index + 1}/${count(jobs.length)}: ${bulkTargetLabel(record, type)}`);
        for (let attempt = 0; ; attempt += 1) {
          let blob = null;
          try {
            await word.runWordPublicationExportJob({
              createJobUrl: word.appendExportSnapshotVersion(request.createJobUrl, snapshotVersion),
              filename: request.filename,
            }, {
              request: (url, options) => session.requestJson(url, options),
              download: async (url) => { blob = await session.readBlob(url); },
              preview: null,
              // Polling treats request errors as transient; re-check the
              // workspace fence between polls so a switch stops the batch.
              wait: async (milliseconds) => {
                session.assertCurrent();
                await new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
                session.assertCurrent();
              },
            });
            files.push({ name: request.filename, data: blob });
            break;
          } catch (error) {
            if (isWorkspaceChange(error)) throw error;
            const code = String(error?.code || error?.data?.code || "");
            if (SNAPSHOT_RETRY_CODES.has(code) && attempt < 2) {
              snapshotVersion = String(await session.readSyncVersion());
              continue;
            }
            failures.push(`${bulkTargetLabel(record, type)}: ${error?.message || "Không thể tạo tài liệu."}`);
            break;
          }
        }
      }
    } finally {
      await loading.close();
    }
    const pendingCount = jobs.length - files.length - failures.length;
    if (!files.length) {
      await dialog(view, "customAlert", "Không thể xuất Word", failures.join("\n") || "Đã dừng trước khi tạo tài liệu nào.", "x-circle");
      return { ok: false, failures, stopped };
    }
    const used = new Set();
    const entries = files.map((file) => ({ name: word.uniqueZipEntryName(file.name, used), data: file.data }));
    if (failures.length || skipped.length || pendingCount) {
      const report = [
        `Kết quả xuất “${label}”`,
        `Thành công: ${files.length}`,
        failures.length ? `\nKhông tạo được (${failures.length}):\n${failures.join("\n")}` : "",
        skipped.length ? `\nBỏ qua vì không áp dụng (${skipped.length}):\n${skipped.join("\n")}` : "",
        pendingCount ? `\nChưa xuất do người dùng dừng: ${pendingCount}` : "",
      ].filter(Boolean).join("\n");
      entries.push({ name: word.uniqueZipEntryName("Ket_qua_xuat_Word.txt", used), data: new Blob([report], { type: "text/plain;charset=utf-8" }) });
    }
    const archive = await word.createStoredZip(entries, { now: now() });
    save(archive, `Xuat_Word_${FILE_LABELS[type]}_${timestampToken(now())}.zip`);
    view.showToast?.(
      failures.length || pendingCount ? "Đã xuất một phần" : "Đã xuất Word",
      `${count(files.length)}/${count(jobs.length)} tài liệu đã được gộp vào tệp ZIP.${failures.length ? " Xem Ket_qua_xuat_Word.txt để biết dòng chưa xuất được." : ""}`,
      failures.length || pendingCount ? "warning" : "success",
    );
    return { ok: true, exported: files.length, failures, skipped, stopped };
  });
}

const RUNNERS = {
  assign: runBusinessListBulkAssignment,
  status: runBusinessListBulkContractStatus,
  word: runBusinessListBulkWordExport,
};

export async function runSelectedBusinessListAction(view, type, action) {
  const controller = getAppController();
  if (!controller || controller.model !== view.model || controller.view !== view) return { ok: false, workspaceChanged: true };
  const runner = RUNNERS[action];
  if (!runner || !ACTION_TYPES[action]?.has(type)) return { ok: false, unsupported: true };
  return runner(controller, getBusinessListSelection(view.model, type));
}
