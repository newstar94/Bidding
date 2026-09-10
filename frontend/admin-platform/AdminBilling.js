import { renderAdminDirectory } from "./AdminDirectory.js";
import { adminStateMarkup, renderAdminMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

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
    { label: "Hạn mức" }, { label: "Cập nhật", sortKey: "updated_at" },
  ],
  rowMarkup(subscription) {
    const quota = Number.isFinite(subscription?.memberQuota) ? escapeHtml(subscription.memberQuota) : "N/A";
    return `<tr><td data-label="Chủ đăng ký">${ownerMarkup(subscription?.owner)}</td><td data-label="Gói dịch vụ"><strong>${text(subscription?.packageId)}</strong><div class="small text-secondary">${text(subscription?.planVersionId)}</div></td><td data-label="Trạng thái">${text(subscription?.status)}</td><td data-label="Nguồn">${text(subscription?.source)}<div class="small text-secondary">${text(subscription?.sourceOrderPublicId)}</div></td><td data-label="Bắt đầu">${formatDate(subscription?.startsAt)}</td><td data-label="Hết hạn">${formatDate(subscription?.expiresAt)}</td><td data-label="Hạn mức">${quota}</td><td data-label="Cập nhật">${formatDate(subscription?.updatedAt)}</td></tr>`;
  },
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
    { label: "Giao dịch" }, { label: "Ngày tạo", sortKey: "created_at" },
  ],
  rowMarkup(payment) {
    const amount = payment?.amounts;
    const provider = payment?.provider;
    return `<tr><td data-label="Đơn hàng"><strong>${text(payment?.publicId)}</strong><div class="small text-secondary">${text(payment?.operation)} · ${text(provider?.name)}</div></td><td data-label="Chủ thanh toán">${ownerMarkup(payment?.owner)}</td><td data-label="Số tiền"><strong>${escapeHtml(formatMinorMoney(amount?.totalMinor, amount?.currency))}</strong><div class="small text-secondary">${text(amount?.currency)}</div></td><td data-label="Thanh toán">${text(payment?.paymentState)}<div class="small text-secondary">${text(payment?.activationState)}</div></td><td data-label="Checkout">${text(payment?.checkoutState)}<div class="small text-secondary">${text(provider?.reference)}</div></td><td data-label="Giao dịch">${transactionMarkup(payment?.transactions)}</td><td data-label="Ngày tạo">${formatDate(payment?.createdAt)}</td></tr>`;
  },
});

export function renderAdminSubscriptions(container, options) {
  return renderAdminDirectory(container, SUBSCRIPTION_DIRECTORY, options);
}

export function renderAdminPayments(container, options) {
  return renderAdminDirectory(container, PAYMENT_DIRECTORY, options);
}

export function invoiceUnavailableMarkup() {
  return adminStateMarkup("empty", {
    title: "Chưa có nguồn dữ liệu hóa đơn",
    message: "Hệ thống hiện chưa lưu dữ liệu hóa đơn để hiển thị. Không có số liệu giả được tạo cho mục này.",
  });
}

export function renderAdminInvoicesUnavailable(container) {
  renderAdminMarkup(container, invoiceUnavailableMarkup());
}
