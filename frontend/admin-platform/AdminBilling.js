import { renderAdminDirectory } from "./AdminDirectory.js";
import { getAdminJson, postAdminJson, requiresPrivilegedReauthentication } from "./AdminApi.js";
import { adminLoadingMarkup, adminStateMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { trapAdminDialogFocus } from "./AdminFocusTrap.js";

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? text(value) : escapeHtml(date.toLocaleDateString("vi-VN"));
}

export function formatMinorMoney(amountMinor, currency) {
  const amount = Number(amountMinor);
  const code = String(currency || "").trim().toUpperCase();
  if (!Number.isSafeInteger(amount) || !/^[A-Z]{3}$/u.test(code)) return "N/A";
  try {
    const formatter = new Intl.NumberFormat("vi-VN", { style: "currency", currency: code });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(amount / (10 ** fractionDigits));
  } catch {
    return "N/A";
  }
}

function ownerMarkup(owner) {
  if (!owner) return "N/A";
  const secondary = [owner.kind, owner.email || owner.id].filter(Boolean).map(text).join(" · ");
  return `<strong>${text(owner.name)}</strong><div class="small text-secondary">${secondary || "N/A"}</div>`;
}

function transactionMarkup(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return '<span class="text-secondary">Chưa có giao dịch xác thực</span>';
  }
  return transactions.map((transaction) => (
    `<div><strong>${text(transaction.status)}</strong> · ${text(transaction.type)}<div class="small text-secondary">${escapeHtml(formatMinorMoney(transaction.verifiedPaidAmountMinor, transaction.currency))} · ${formatDate(transaction.createdAt)}</div></div>`
  )).join("");
}

function timelineMarkup(entries) {
  const rows = entries
    .filter((entry) => entry?.value !== null && entry?.value !== undefined && entry?.value !== "")
    .map((entry) => `<li class="list-group-item"><div class="fw-semibold">${text(entry.label)}</div><div class="small text-secondary">${formatDate(entry.value)}${entry.detail ? ` · ${text(entry.detail)}` : ""}</div></li>`)
    .join("");
  return rows
    ? `<ol class="list-group list-group-flush mb-3">${rows}</ol>`
    : '<p class="text-secondary">Chưa có mốc thời gian được ghi nhận.</p>';
}

function detailShell(eyebrow, title, body) {
  return `<div class="offcanvas-header"><div><div class="text-secondary small">${text(eyebrow)}</div><h2 class="offcanvas-title">${text(title)}</h2></div><button class="btn-close" type="button" aria-label="Đóng" data-admin-close-billing-detail></button></div><div class="offcanvas-body">${body}</div>`;
}

export function subscriptionDetailMarkup(subscription) {
  const owner = subscription?.owner;
  const quota = Number.isFinite(subscription?.memberQuota) ? escapeHtml(subscription.memberQuota) : "N/A";
  return detailShell("Chi tiết đăng ký", owner?.name || owner?.id, `<dl class="row"><dt class="col-5">Chủ đăng ký</dt><dd class="col-7">${ownerMarkup(owner)}</dd><dt class="col-5">Gói dịch vụ</dt><dd class="col-7">${text(subscription?.packageId)}</dd><dt class="col-5">Phiên bản gói</dt><dd class="col-7">${text(subscription?.planVersionId)}</dd><dt class="col-5">Trạng thái</dt><dd class="col-7">${text(subscription?.status)}</dd><dt class="col-5">Nguồn</dt><dd class="col-7">${text(subscription?.source)}</dd><dt class="col-5">Đơn hàng nguồn</dt><dd class="col-7">${text(subscription?.sourceOrderPublicId)}</dd><dt class="col-5">Hạn mức thành viên</dt><dd class="col-7">${quota}</dd><dt class="col-5">Revision</dt><dd class="col-7">${Number.isFinite(subscription?.revision) ? escapeHtml(subscription.revision) : "N/A"}</dd></dl><h3 class="h4">Dòng thời gian đăng ký</h3>${timelineMarkup([
    { label: "Tạo bản ghi", value: subscription?.createdAt },
    { label: "Bắt đầu hiệu lực", value: subscription?.startsAt },
    { label: "Cập nhật gần nhất", value: subscription?.updatedAt },
    { label: "Hết hạn", value: subscription?.expiresAt },
  ])}`);
}

export function paymentDetailMarkup(payment) {
  const amount = payment?.amounts;
  const provider = payment?.provider;
  const transactions = Array.isArray(payment?.transactions) ? payment.transactions : [];
  const transactionTimeline = transactions.length
    ? transactions.map((transaction) => `<li class="list-group-item"><div><strong>${text(transaction.status)}</strong> · ${text(transaction.type)}</div><div class="small text-secondary">${escapeHtml(formatMinorMoney(transaction.verifiedPaidAmountMinor, transaction.currency))} · ${formatDate(transaction.providerOccurredAt || transaction.createdAt)}</div><div class="small text-secondary">${text(transaction.providerTransactionId, transaction.id)}</div></li>`).join("")
    : '<li class="list-group-item text-secondary">Chưa có giao dịch thanh toán.</li>';
  return detailShell("Chi tiết thanh toán", payment?.publicId, `<dl class="row"><dt class="col-5">Chủ thanh toán</dt><dd class="col-7">${ownerMarkup(payment?.owner)}</dd><dt class="col-5">Nghiệp vụ</dt><dd class="col-7">${text(payment?.operation)}</dd><dt class="col-5">Tổng đơn hàng</dt><dd class="col-7">${escapeHtml(formatMinorMoney(amount?.totalMinor, amount?.currency))}</dd><dt class="col-5">Tạm tính</dt><dd class="col-7">${escapeHtml(formatMinorMoney(amount?.subtotalMinor, amount?.currency))}</dd><dt class="col-5">Thuế</dt><dd class="col-7">${escapeHtml(formatMinorMoney(amount?.taxMinor, amount?.currency))}</dd><dt class="col-5">Thanh toán</dt><dd class="col-7">${text(payment?.paymentState)}</dd><dt class="col-5">Kích hoạt</dt><dd class="col-7">${text(payment?.activationState)}</dd><dt class="col-5">Checkout</dt><dd class="col-7">${text(payment?.checkoutState)}</dd><dt class="col-5">Nhà cung cấp</dt><dd class="col-7">${text(provider?.name)} · ${text(provider?.environment)}</dd><dt class="col-5">Tham chiếu</dt><dd class="col-7">${text(provider?.reference)}</dd></dl><h3 class="h4">Dòng thời gian đơn hàng</h3>${timelineMarkup([
    { label: "Tạo đơn hàng", value: payment?.createdAt },
    { label: "Cập nhật đơn hàng", value: payment?.updatedAt },
    { label: "Checkout hết hạn", value: payment?.checkoutExpiresAt },
  ])}<h3 class="h4">Giao dịch thanh toán</h3><ol class="list-group list-group-flush">${transactionTimeline}</ol>`);
}

export function invoiceRequestDetailMarkup(payload) {
  const request = payload?.invoiceRequest || payload;
  const amount = request?.amounts;
  const transaction = request?.paymentTransaction;
  const provider = request?.provider;
  return detailShell("Yêu cầu phát hành hóa đơn", request?.id, `<div class="alert alert-info" role="note">${text(payload?.notice, "Đây là dữ liệu yêu cầu phát hành hóa đơn, không phải tài liệu hóa đơn đã phát hành.")}</div><dl class="row"><dt class="col-5">Trạng thái yêu cầu</dt><dd class="col-7">${text(request?.status)}</dd><dt class="col-5">Chủ thanh toán</dt><dd class="col-7">${ownerMarkup(request?.owner)}</dd><dt class="col-5">Đơn hàng</dt><dd class="col-7">${text(request?.orderPublicId)}</dd><dt class="col-5">Tổng đơn hàng</dt><dd class="col-7">${escapeHtml(formatMinorMoney(amount?.orderTotalMinor, amount?.currency))}</dd><dt class="col-5">Đã xác minh thanh toán</dt><dd class="col-7">${escapeHtml(formatMinorMoney(amount?.verifiedPaidMinor, amount?.currency))}</dd><dt class="col-5">Giao dịch</dt><dd class="col-7">${text(transaction?.providerTransactionId, transaction?.id)} · ${text(transaction?.status)}</dd><dt class="col-5">Nhà cung cấp</dt><dd class="col-7">${text(provider?.name)} · ${text(provider?.environment)}</dd><dt class="col-5">Tham chiếu hóa đơn</dt><dd class="col-7">${text(provider?.invoiceReference, "Chưa có")}</dd><dt class="col-5">Số lần thử</dt><dd class="col-7">${Number.isFinite(request?.attemptCount) ? escapeHtml(request.attemptCount) : "N/A"}</dd><dt class="col-5">Tài liệu tải xuống</dt><dd class="col-7">${request?.documentAvailable === true ? "Khả dụng" : "Chưa có mô hình tài liệu hóa đơn"}</dd></dl><h3 class="h4">Dòng thời gian yêu cầu</h3>${timelineMarkup([
    { label: "Thanh toán tại nhà cung cấp", value: transaction?.providerOccurredAt, detail: transaction?.status },
    { label: "Ghi nhận giao dịch", value: transaction?.createdAt },
    { label: "Tạo yêu cầu hóa đơn", value: request?.createdAt, detail: request?.status },
    { label: "Cập nhật yêu cầu", value: request?.updatedAt, detail: request?.status },
  ])}`);
}

function openBillingDetail(button, markup, { onClose } = {}) {
  document.querySelector("[data-admin-billing-detail-drawer]")?.remove();
  document.querySelector("[data-admin-billing-detail-backdrop]")?.remove();
  const drawer = document.createElement("aside");
  drawer.className = "offcanvas offcanvas-end show";
  drawer.tabIndex = -1;
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-label", "Chi tiết thanh toán");
  drawer.setAttribute("data-admin-billing-detail-drawer", "");
  drawer.style.visibility = "visible";
  drawer.innerHTML = trustedHTML(markup);
  const backdrop = document.createElement("div");
  backdrop.className = "offcanvas-backdrop fade show";
  backdrop.setAttribute("data-admin-billing-detail-backdrop", "");
  let closed = false;
  let releaseFocusTrap = () => {};
  const remove = () => {
    releaseFocusTrap();
    drawer.remove(); backdrop.remove();
    window.removeEventListener("popstate", dismissForNavigation);
    window.removeEventListener("admin:navigate", dismissForNavigation);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    remove();
    onClose?.();
    button?.focus?.();
  };
  const dismissForNavigation = () => {
    if (closed) return;
    closed = true;
    remove();
  };
  const bindClose = () => drawer.querySelector("[data-admin-close-billing-detail]")?.addEventListener("click", close);
  bindClose();
  backdrop.addEventListener("click", close);
  releaseFocusTrap = trapAdminDialogFocus(drawer, { onEscape: close });
  window.addEventListener("popstate", dismissForNavigation);
  window.addEventListener("admin:navigate", dismissForNavigation);
  document.body.append(drawer, backdrop);
  drawer.querySelector("button")?.focus();
  return { drawer, close, bindClose };
}

function bindBillingDetails(root, items, options, kind) {
  const idFor = (item) => String(kind === "invoice" ? item?.id : kind === "payment" ? item?.publicId : `${item?.owner?.kind}:${item?.owner?.id}`);
  const byId = new Map(items.map((item) => [idFor(item), item]));
  const open = async (id, { button = null, push = false } = {}) => {
    id = String(id || "");
    const item = byId.get(id);
    if (!item && kind !== "invoice") return;
    if (kind === "invoice" && push) options.setDetail?.(id, { push: true });
    if (kind === "subscription") {
      openBillingDetail(button, subscriptionDetailMarkup(item));
      return;
    }
    if (kind === "payment") {
      openBillingDetail(button, paymentDetailMarkup(item));
      return;
    }
    const detail = openBillingDetail(
      button,
      detailShell("Yêu cầu phát hành hóa đơn", id, adminLoadingMarkup("Đang tải yêu cầu hóa đơn…")),
      { onClose: () => options.setDetail?.("", { push: false }) },
    );
    try {
      const payload = await getAdminJson(`/api/admin/invoices/${encodeURIComponent(id)}`, options);
      detail.drawer.innerHTML = trustedHTML(invoiceRequestDetailMarkup(payload));
      detail.bindClose();
      detail.drawer.querySelector("button")?.focus();
    } catch (error) {
      if (options.signal?.aborted) return detail.close();
      detail.drawer.innerHTML = trustedHTML(detailShell("Yêu cầu phát hành hóa đơn", id, adminStateMarkup(error?.status === 403 ? "permission" : "error", { message: error?.message })));
      detail.bindClose();
      detail.drawer.querySelector("button")?.focus();
    }
  };
  root.querySelectorAll("[data-admin-billing-detail]").forEach((button) => button.addEventListener("click", () => {
    void open(button.dataset.adminBillingDetail, { button, push: kind === "invoice" });
  }));
  if (kind === "invoice" && options.initialDetailId) void open(options.initialDetailId);
}

const PAYMENT_ACTION_COPY = Object.freeze({
  review: { label: "Chuyển kiểm tra", success: "Đã chuyển đơn hàng sang trạng thái cần kiểm tra." },
  reconcile: { label: "Đối soát", success: "Đã gửi và xử lý yêu cầu đối soát." },
  refund: { label: "Tạo yêu cầu hoàn", success: "Đã tạo yêu cầu hoàn tiền thủ công." },
});

function newIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `admin-refund:${globalThis.crypto.randomUUID()}`;
  }
  const bytes = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  return `admin-refund:${Array.from(bytes, (value) => value.toString(16).padStart(8, "0")).join("")}`;
}

export function adminValueDialogMarkup({
  title, message, label, type = "text", inputMode = "text", autocomplete = null,
  confirmLabel = "Tiếp tục",
}) {
  const autocompleteValue = autocomplete || (type === "password" ? "current-password" : "off");
  const field = label === null
    ? ""
    : `<label class="form-label">${escapeHtml(label)}<input class="form-control" name="value" type="${escapeHtml(type)}" inputmode="${escapeHtml(inputMode)}" required autocomplete="${escapeHtml(autocompleteValue)}"></label>`;
  return `<div class="modal-dialog modal-dialog-centered" role="document"><form class="modal-content"><div class="modal-header"><h2 id="admin-prompt-title" class="modal-title">${escapeHtml(title)}</h2></div><div class="modal-body"><p class="text-secondary" id="admin-prompt-description">${escapeHtml(message)}</p>${field}</div><div class="modal-footer"><button class="btn btn-link link-secondary" type="button" data-admin-prompt-cancel>Hủy</button><button class="btn btn-primary" type="submit">${escapeHtml(confirmLabel)}</button></div></form></div>`;
}

export function requestAdminValue({
  title, message, label, type = "text", inputMode = "text", autocomplete = null,
  confirmLabel = "Tiếp tục",
}) {
  if (!globalThis.document?.body) return Promise.resolve(null);
  const opener = document.activeElement;
  const modal = document.createElement("div");
  modal.className = "modal modal-blur show";
  modal.tabIndex = -1;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "admin-prompt-title");
  modal.setAttribute("aria-describedby", "admin-prompt-description");
  modal.style.display = "block";
  modal.innerHTML = trustedHTML(adminValueDialogMarkup({
    title, message, label, type, inputMode, autocomplete, confirmLabel,
  }));
  document.body.append(modal);
  const input = modal.querySelector("input[name='value']");
  return new Promise((resolve) => {
    let settled = false;
    let releaseFocusTrap = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true;
      releaseFocusTrap();
      modal.remove();
      opener?.focus?.();
      resolve(value);
    };
    modal.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      finish(input ? String(input.value || "") : "");
    });
    modal.querySelector("[data-admin-prompt-cancel]")?.addEventListener("click", () => finish(null));
    releaseFocusTrap = trapAdminDialogFocus(modal, { onEscape: () => finish(null) });
    (input || modal.querySelector("button[type='submit']"))?.focus();
  });
}

async function collectPaymentActionInput(action, payment, requestValue) {
  if (action === "refund") {
    const amount = await requestValue({
      title: "Số tiền hoàn",
      message: `Nhập số tiền theo đơn vị nhỏ nhất của ${String(payment?.amounts?.currency || "tiền tệ")}.`,
      label: "Số tiền hoàn (minor unit)",
      inputMode: "numeric",
    });
    if (amount === null) return null;
    if (!/^[1-9]\d*$/u.test(amount) || !Number.isSafeInteger(Number(amount))) {
      throw new Error("Số tiền hoàn phải là số nguyên dương theo đơn vị nhỏ nhất của tiền tệ.");
    }
    const reason = await requestValue({
      title: "Lý do hoàn tiền",
      message: "Lý do này được lưu cùng yêu cầu hoàn tiền và nhật ký kiểm toán.",
      label: "Lý do",
    });
    if (reason === null) return null;
    return { amount: Number(amount), reason: reason.trim() };
  }
  const reason = await requestValue({
    title: PAYMENT_ACTION_COPY[action].label,
    message: "Nhập lý do để lưu trong nhật ký kiểm toán.",
    label: "Lý do",
  });
  return reason === null ? null : { reason: reason.trim() };
}

export async function executePaymentAction(action, payment, {
  fetchImpl,
  signal,
  confirmImpl = (message) => globalThis.confirm?.(message) === true,
  requestValue = requestAdminValue,
  idempotencyKey = newIdempotencyKey(),
} = {}) {
  if (!Object.hasOwn(PAYMENT_ACTION_COPY, action)) throw new TypeError("Unsupported payment action");
  const publicId = String(payment?.publicId || "").trim();
  if (!publicId) throw new TypeError("Payment order public ID is required");
  const body = await collectPaymentActionInput(action, payment, requestValue);
  if (!body) return { cancelled: true };
  if (action === "refund" && !body.reason) throw new Error("Lý do hoàn tiền không được để trống.");
  const confirmed = await confirmImpl(`${PAYMENT_ACTION_COPY[action].label} cho đơn hàng ${publicId}?`);
  if (!confirmed) return { cancelled: true };
  const path = `/api/billing/admin/orders/${encodeURIComponent(publicId)}/${action}`;
  const mutate = () => postAdminJson(path, {
    body,
    fetchImpl,
    signal,
    idempotencyKey: action === "refund" ? idempotencyKey : "",
  });
  try {
    return { payload: await mutate(), message: PAYMENT_ACTION_COPY[action].success };
  } catch (error) {
    if (!requiresPrivilegedReauthentication(error)) throw error;
    const password = await requestValue({
      title: "Xác thực thao tác quản trị",
      message: "Nhập lại mật khẩu để tiếp tục thao tác nhạy cảm.",
      label: "Mật khẩu hiện tại",
      type: "password",
    });
    if (password === null) return { cancelled: true };
    await postAdminJson("/api/auth/privileged-reauth", {
      body: { password }, fetchImpl, signal,
    });
    return { payload: await mutate(), message: PAYMENT_ACTION_COPY[action].success };
  }
}

function paymentActionsMarkup(payment) {
  const publicId = text(payment?.publicId, "");
  const canRefund = ["verified_paid", "partially_refunded"].includes(payment?.paymentState);
  return `<div class="btn-list flex-nowrap"><button class="btn btn-sm btn-outline-secondary" type="button" data-admin-payment-action="review" data-admin-payment-id="${publicId}">Kiểm tra</button><button class="btn btn-sm btn-outline-primary" type="button" data-admin-payment-action="reconcile" data-admin-payment-id="${publicId}">Đối soát</button><button class="btn btn-sm btn-outline-danger" type="button" data-admin-payment-action="refund" data-admin-payment-id="${publicId}"${canRefund ? "" : " disabled"}>Hoàn tiền</button></div><div class="small mt-2" role="status" aria-live="polite" data-admin-payment-status="${publicId}"></div>`;
}

export function bindPaymentActions(root, { fetchImpl, signal } = {}) {
  const inFlight = new Set();
  root.querySelectorAll("[data-admin-payment-action]").forEach((button) => button.addEventListener("click", async () => {
    const publicId = String(button.dataset.adminPaymentId || "");
    if (!publicId || inFlight.has(publicId)) return;
    const payment = button._adminPayment;
    const status = Array.from(root.querySelectorAll("[data-admin-payment-status]"))
      .find((item) => item.dataset.adminPaymentStatus === publicId);
    const peers = Array.from(root.querySelectorAll("[data-admin-payment-id]"))
      .filter((item) => item.dataset.adminPaymentId === publicId);
    inFlight.add(publicId);
    peers.forEach((peer) => { peer.disabled = true; });
    if (status) { status.textContent = "Đang xử lý…"; status.className = "small mt-2 text-secondary"; }
    try {
      const result = await executePaymentAction(button.dataset.adminPaymentAction, payment, { fetchImpl, signal });
      if (status) {
        status.textContent = result.cancelled ? "Đã hủy thao tác." : result.message;
        status.className = `small mt-2 ${result.cancelled ? "text-secondary" : "text-success"}`;
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (status) { status.textContent = error?.message || "Không thể thực hiện thao tác."; status.className = "small mt-2 text-danger"; }
    } finally {
      inFlight.delete(publicId);
      peers.forEach((peer) => { peer.disabled = peer.dataset.adminPaymentAction === "refund" && !["verified_paid", "partially_refunded"].includes(payment?.paymentState); });
    }
  }));
}

export const SUBSCRIPTION_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/subscriptions",
  title: "Đăng ký",
  searchPlaceholder: "Chủ tài khoản, email hoặc gói dịch vụ",
  emptyMessage: "Không có đăng ký phù hợp với bộ lọc.",
  defaultSort: "updated_at",
  defaultSortDir: "desc",
  sortKeys: ["owner", "status", "starts_at", "expires_at", "created_at", "updated_at"],
  filters: [
    { key: "ownerKind", label: "Loại chủ thể", allLabel: "Mọi chủ thể", options: [["account", "Cá nhân"], ["organization", "Tổ chức"]] },
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["active", "Hoạt động"], ["suspended", "Tạm dừng"], ["expired", "Hết hạn"], ["cancelled", "Đã hủy"]] },
    { key: "source", label: "Nguồn", allLabel: "Mọi nguồn", options: [["order", "Đơn hàng"], ["admin", "Quản trị"], ["legacy", "Dữ liệu cũ"]] },
  ],
  columns: [
    { label: "Chủ đăng ký", sortKey: "owner" }, { label: "Gói dịch vụ" },
    { label: "Trạng thái", sortKey: "status" }, { label: "Nguồn" },
    { label: "Bắt đầu", sortKey: "starts_at" }, { label: "Hết hạn", sortKey: "expires_at" },
    { label: "Hạn mức" }, { label: "Cập nhật", sortKey: "updated_at" }, { label: "Chi tiết" },
  ],
  rowMarkup(subscription) {
    const quota = Number.isFinite(subscription?.memberQuota) ? escapeHtml(subscription.memberQuota) : "N/A";
    const detailId = text(`${subscription?.owner?.kind}:${subscription?.owner?.id}`, "");
    return `<tr><td data-label="Chủ đăng ký">${ownerMarkup(subscription?.owner)}</td><td data-label="Gói dịch vụ"><strong>${text(subscription?.packageId)}</strong><div class="small text-secondary">${text(subscription?.planVersionId)}</div></td><td data-label="Trạng thái">${text(subscription?.status)}</td><td data-label="Nguồn">${text(subscription?.source)}<div class="small text-secondary">${text(subscription?.sourceOrderPublicId)}</div></td><td data-label="Bắt đầu">${formatDate(subscription?.startsAt)}</td><td data-label="Hết hạn">${formatDate(subscription?.expiresAt)}</td><td data-label="Hạn mức">${quota}</td><td data-label="Cập nhật">${formatDate(subscription?.updatedAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-billing-detail="${detailId}">Xem</button></td></tr>`;
  },
  bindResultActions(root, options) { bindBillingDetails(root, options.payload?.items || [], options, "subscription"); },
});

export const PAYMENT_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/payments",
  title: "Thanh toán",
  searchPlaceholder: "Mã đơn hàng, tham chiếu hoặc chủ thanh toán",
  emptyMessage: "Không có đơn hàng thanh toán phù hợp với bộ lọc.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "updated_at", "total_amount", "payment_state", "checkout_state"],
  filters: [
    { key: "ownerKind", label: "Loại chủ thể", allLabel: "Mọi chủ thể", options: [["account", "Cá nhân"], ["organization", "Tổ chức"]] },
    { key: "paymentState", label: "Thanh toán", allLabel: "Mọi trạng thái", options: [["unverified", "Chưa xác thực"], ["verified_paid", "Đã xác thực"], ["refund_pending", "Đang hoàn"], ["partially_refunded", "Hoàn một phần"], ["refunded", "Đã hoàn"], ["refund_failed", "Hoàn thất bại"]] },
    { key: "transactionStatus", label: "Giao dịch", allLabel: "Mọi giao dịch", options: [["verified", "Đã xác minh"], ["settled", "Đã quyết toán"], ["failed", "Thất bại"]] },
  ],
  columns: [
    { label: "Đơn hàng" }, { label: "Chủ thanh toán" },
    { label: "Số tiền", sortKey: "total_amount" },
    { label: "Thanh toán", sortKey: "payment_state" },
    { label: "Checkout", sortKey: "checkout_state" },
    { label: "Giao dịch" }, { label: "Ngày tạo", sortKey: "created_at" }, { label: "Chi tiết" }, { label: "Thao tác" },
  ],
  rowMarkup(payment) {
    const amount = payment?.amounts;
    const provider = payment?.provider;
    return `<tr><td data-label="Đơn hàng"><strong>${text(payment?.publicId)}</strong><div class="small text-secondary">${text(payment?.operation)} · ${text(provider?.name)}</div></td><td data-label="Chủ thanh toán">${ownerMarkup(payment?.owner)}</td><td data-label="Số tiền"><strong>${escapeHtml(formatMinorMoney(amount?.totalMinor, amount?.currency))}</strong><div class="small text-secondary">${text(amount?.currency)}</div></td><td data-label="Thanh toán">${text(payment?.paymentState)}<div class="small text-secondary">${text(payment?.activationState)}</div></td><td data-label="Checkout">${text(payment?.checkoutState)}<div class="small text-secondary">${text(provider?.reference)}</div></td><td data-label="Giao dịch">${transactionMarkup(payment?.transactions)}</td><td data-label="Ngày tạo">${formatDate(payment?.createdAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-billing-detail="${text(payment?.publicId, "")}">Xem</button></td><td data-label="Thao tác">${paymentActionsMarkup(payment)}</td></tr>`;
  },
  bindResultActions(root, options) {
    const payments = new Map((options.payload?.items || []).map((payment) => [String(payment?.publicId || ""), payment]));
    root.querySelectorAll("[data-admin-payment-action]").forEach((button) => {
      button._adminPayment = payments.get(button.dataset.adminPaymentId);
    });
    bindBillingDetails(root, options.payload?.items || [], options, "payment");
    bindPaymentActions(root, options);
  },
});

export const INVOICE_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/invoices",
  title: "Yêu cầu hóa đơn",
  searchPlaceholder: "Mã yêu cầu, đơn hàng, giao dịch hoặc chủ thanh toán",
  emptyMessage: "Chưa có yêu cầu phát hành hóa đơn phù hợp với bộ lọc.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["status", "created_at", "updated_at"],
  filters: [
    { key: "ownerKind", label: "Loại chủ thể", allLabel: "Mọi chủ thể", options: [["account", "Cá nhân"], ["organization", "Tổ chức"]] },
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["requested", "Đã yêu cầu"], ["issued", "Đã phát hành"], ["failed", "Thất bại"]] },
  ],
  columns: [
    { label: "Yêu cầu" }, { label: "Chủ thanh toán" }, { label: "Đơn hàng" },
    { label: "Số tiền" }, { label: "Trạng thái", sortKey: "status" },
    { label: "Nhà cung cấp" }, { label: "Ngày tạo", sortKey: "created_at" }, { label: "Chi tiết" },
  ],
  rowMarkup(request) {
    return `<tr><td data-label="Yêu cầu"><strong>${text(request?.id)}</strong><div class="small text-secondary">Yêu cầu phát hành hóa đơn</div></td><td data-label="Chủ thanh toán">${ownerMarkup(request?.owner)}</td><td data-label="Đơn hàng">${text(request?.orderPublicId)}<div class="small text-secondary">${text(request?.paymentTransaction?.providerTransactionId)}</div></td><td data-label="Số tiền"><strong>${escapeHtml(formatMinorMoney(request?.amounts?.orderTotalMinor, request?.amounts?.currency))}</strong><div class="small text-secondary">${text(request?.amounts?.currency)}</div></td><td data-label="Trạng thái">${text(request?.status)}<div class="small text-secondary">${Number.isFinite(request?.attemptCount) ? `${escapeHtml(request.attemptCount)} lần thử` : "N/A"}</div></td><td data-label="Nhà cung cấp">${text(request?.provider?.name)}<div class="small text-secondary">${text(request?.provider?.invoiceReference, "Chưa có tham chiếu")}</div></td><td data-label="Ngày tạo">${formatDate(request?.createdAt)}</td><td data-label="Chi tiết"><button class="btn btn-sm btn-outline-primary" type="button" data-admin-billing-detail="${text(request?.id, "")}">Xem</button></td></tr>`;
  },
  bindResultActions(root, options) { bindBillingDetails(root, options.payload?.items || [], options, "invoice"); },
});

export function renderAdminSubscriptions(container, options) {
  return renderAdminDirectory(container, SUBSCRIPTION_DIRECTORY, options);
}

export function renderAdminPayments(container, options) {
  return renderAdminDirectory(container, PAYMENT_DIRECTORY, options);
}

export function invoiceUnavailableMarkup() {
  return '<div class="alert alert-info" role="note">Trang này hiển thị yêu cầu phát hành hóa đơn đã được hệ thống ghi nhận. Đây không phải tài liệu hóa đơn được tạo giả.</div>';
}

export function renderAdminInvoicesUnavailable(container, options) {
  const result = renderAdminDirectory(container, INVOICE_DIRECTORY, options);
  return result;
}
