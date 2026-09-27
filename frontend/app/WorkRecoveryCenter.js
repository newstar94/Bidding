import { getJson } from "../shared/apiClient.js";

const STATUS_LABELS = Object.freeze({
  pending: "Chờ xử lý",
  processing: "Đang xử lý",
  retry: "Chờ thử lại",
  completed: "Đã hoàn tất",
  failed: "Đã lỗi",
  PENDING: "Chờ xử lý",
  RUNNING: "Đang chạy",
  PARTIAL: "Đang tiếp tục",
  COMPLETED: "Đã hoàn tất",
  FAILED: "Đã lỗi",
});

function label(status) {
  return STATUS_LABELS[String(status || "")] || String(status || "Chưa xác định");
}

function formatTime(value) {
  if (!value) return "Chưa có";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function text(value) {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node;
}

function section(title, items) {
  const wrapper = document.createElement("section");
  wrapper.className = "recovery-center-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  wrapper.append(heading);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "recovery-center-empty";
    empty.textContent = "Không có mục cần xử lý.";
    wrapper.append(empty);
    return wrapper;
  }
  const list = document.createElement("ul");
  list.className = "recovery-center-list";
  items.forEach((item) => {
    const row = document.createElement("li");
    row.append(
      text(item.title),
      text(` · ${item.status}`),
      item.detail ? text(` · ${item.detail}`) : document.createTextNode(""),
    );
    list.append(row);
  });
  wrapper.append(list);
  return wrapper;
}

export function summarizeLocalRecovery(model) {
  const queue = model?.getMutationQueue?.() || {};
  const pending = Object.values(queue.upserts || {}).reduce((total, rows) => total + Object.keys(rows || {}).length, 0)
    + Object.values(queue.patches || {}).reduce((total, rows) => total + Object.keys(rows || {}).length, 0)
    + (Array.isArray(queue.deletes) ? queue.deletes.length : 0);
  const drafts = model?.getConflictRecoveryDrafts?.() || [];
  const outboxStatus = model?.getMutationOutboxStatus?.() || {};
  return { pending, drafts, outboxStatus };
}

export async function loadWorkRecoverySnapshot(controller, { signal } = {}) {
  const model = controller?.model;
  const workspaceToken = model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "";
  const local = summarizeLocalRecovery(model);
  const [jobs, operations] = await Promise.allSettled([
    getJson("/api/document-jobs?limit=20", { signal, retries: 1 }),
    getJson("/api/procurement/imports/operations?limit=20", { signal, retries: 1 }),
  ]);
  if (workspaceToken !== (model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "")) {
    return { stale: true };
  }
  return {
    local,
    jobs: jobs.status === "fulfilled" ? (jobs.value?.items || []) : [],
    operations: operations.status === "fulfilled" ? (operations.value?.items || []) : [],
    errors: [jobs, operations].filter((result) => result.status === "rejected").map((result) => result.reason),
  };
}

export async function openWorkRecoveryCenter(controller) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "recovery-center-dialog";
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "recovery-center-title");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.id = "recovery-center-title";
  title.textContent = "Trung tâm lưu và khôi phục";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn-outline";
  close.textContent = "Đóng";
  header.append(title, close);
  const content = document.createElement("div");
  content.className = "recovery-center-content";
  content.setAttribute("aria-live", "polite");
  dialog.append(header, content);
  document.body.append(dialog);
  const trigger = document.getElementById("btn-recovery-center");
  trigger?.setAttribute("aria-expanded", "true");
  const cleanup = () => {
    trigger?.setAttribute("aria-expanded", "false");
    dialog.close();
    dialog.remove();
    previousFocus?.focus?.();
  };
  close.addEventListener("click", cleanup);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); cleanup(); });
  dialog.showModal();
  const loading = document.createElement("p");
  loading.textContent = "Đang đọc trạng thái lưu và khôi phục…";
  content.append(loading);
  try {
    const snapshot = await loadWorkRecoverySnapshot(controller);
    if (snapshot.stale) {
      cleanup();
      return;
    }
    content.replaceChildren();
    const local = snapshot.local;
    const summary = document.createElement("p");
    summary.className = "recovery-center-summary";
    summary.textContent = `Đang chờ gửi/xác nhận: ${local.pending} · Xung đột: ${local.drafts.length} · Lưu cục bộ: ${local.outboxStatus.state || "chưa xác định"}`;
    content.append(summary);
    content.append(section("Bản nháp và xung đột", local.drafts.map((draft) => ({
      title: `${draft.entityType || "Bản ghi"} · ${draft.recordId || "Không rõ"}`,
      status: draft.status || "Đang chờ quyết định",
      detail: `lưu ${formatTime(draft.savedAt)} · hết hạn ${formatTime(draft.expiresAt)}`,
    }))));
    content.append(section("Phiên xuất tài liệu", snapshot.jobs.map((job) => ({
      title: job.filename || job.recordId || job.jobId,
      status: label(job.status),
      detail: `${job.phase || ""} · cập nhật ${formatTime(job.updatedAt)}`,
    }))));
    content.append(section("Tiến trình nhập dữ liệu", snapshot.operations.map((operation) => ({
      title: `${operation.familyNo || "Nguồn dữ liệu"} · ${operation.provider || ""}`,
      status: label(operation.status),
      detail: `${Number(operation.nextRevisionIndex || 0)}/${Number(operation.totalRevisions || 0)} phiên bản`,
    }))));
    if (snapshot.errors.length) {
      const note = document.createElement("p");
      note.className = "recovery-center-note";
      note.textContent = "Một số trạng thái máy chủ chưa tải được. Dữ liệu cục bộ vẫn được giữ nguyên; hãy mở lại để kiểm tra.";
      content.append(note);
    }
  } catch (error) {
    content.replaceChildren(text(error?.message || "Không thể đọc trạng thái lưu và khôi phục."));
  }
}
