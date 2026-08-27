import { getJson } from "../shared/apiClient.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, formatCurrency } from "../shared/view_helpers.js";
import { formatDateWithTime } from "../shared/formatters.js";

const OPERATION_LABELS = Object.freeze({
  purchase: "Mua gói dịch vụ",
  renew: "Gia hạn gói dịch vụ",
  upgrade: "Nâng cấp gói dịch vụ",
  downgrade: "Chuyển xuống gói thấp hơn",
  credit_pack: "Mua thêm lượt tra cứu",
});

const PAYMENT_LABELS = Object.freeze({
  unverified: "Chờ xác minh",
  verified_paid: "Đã thanh toán",
  refund_pending: "Đang hoàn tiền",
  partially_refunded: "Đã hoàn một phần",
  refunded: "Đã hoàn tiền",
  refund_failed: "Hoàn tiền thất bại",
});

const ACTIVATION_LABELS = Object.freeze({
  not_ready: "Chưa sẵn sàng",
  pending: "Đang kích hoạt",
  applied: "Đã kích hoạt",
  retry: "Đang thử lại",
  review_required: "Cần kiểm tra",
  reversed: "Đã thu hồi",
});

const CHECKOUT_LABELS = Object.freeze({
  creating: "Đang tạo giao dịch",
  open: "Chờ thanh toán",
  create_failed: "Không tạo được thanh toán",
  cancelled: "Đã hủy",
  expired: "Đã hết hạn",
});

let requestVersion = 0;

function label(value, labels, fallback = "Chưa xác định") {
  return labels[String(value || "")] || fallback;
}

function paymentLabel(order) {
  if (order.paymentState !== "unverified") {
    return label(order.paymentState, PAYMENT_LABELS);
  }
  return label(order.checkoutState, CHECKOUT_LABELS, PAYMENT_LABELS.unverified);
}

function badgeClass(value, kind) {
  if (kind === "payment") {
    if (value === "verified_paid") return "badge-success";
    if (["refund_pending", "partially_refunded"].includes(value)) return "badge-warning";
    if (value === "refunded") return "badge-info";
    if (value === "refund_failed") return "badge-danger";
    return "badge-neutral";
  }
  if (value === "applied") return "badge-success";
  if (["pending", "retry"].includes(value)) return "badge-warning";
  if (["review_required", "reversed"].includes(value)) return "badge-danger";
  return "badge-neutral";
}

function renderOrders(orders) {
  const table = document.getElementById("profile-purchase-history-table");
  const body = document.getElementById("profile-purchase-history-body");
  const status = document.getElementById("profile-purchase-history-status");
  if (!table || !body || !status) return;

  if (!orders.length) {
    table.hidden = true;
    body.replaceChildren();
    status.dataset.tone = "neutral";
    status.textContent = "Bạn chưa có giao dịch mua cá nhân nào.";
    return;
  }

  body.innerHTML = trustedHTML(orders.map((order) => `
    <tr>
      <td data-label="Mã giao dịch"><strong>${escapeHtml(order.publicId)}</strong></td>
      <td data-label="Ngày tạo">${escapeHtml(formatDateWithTime(order.createdAt))}</td>
      <td data-label="Loại giao dịch">${escapeHtml(label(order.operation, OPERATION_LABELS))}</td>
      <td data-label="Thanh toán"><span class="badge ${badgeClass(order.paymentState, "payment")}">${escapeHtml(paymentLabel(order))}</span></td>
      <td data-label="Kích hoạt"><span class="badge ${badgeClass(order.activationState, "activation")}">${escapeHtml(label(order.activationState, ACTIVATION_LABELS))}</span></td>
      <td data-label="Số tiền" class="text-right profile-purchase-history__amount">${escapeHtml(formatCurrency(order.totalAmount))}</td>
    </tr>
  `).join(""));
  table.hidden = false;
  status.dataset.tone = "success";
  status.textContent = `Đã tải ${orders.length.toLocaleString("vi-VN")} giao dịch gần nhất.`;
}

async function loadPurchaseHistory(controller) {
  const status = document.getElementById("profile-purchase-history-status");
  const refreshButton = document.getElementById("profile-purchase-history-refresh");
  if (!status) return;
  const currentRequest = ++requestVersion;
  status.dataset.tone = "neutral";
  status.textContent = "Đang tải lịch sử mua…";
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
  }
  try {
    const payload = await getJson("/api/billing/orders", { retries: 0 });
    if (currentRequest !== requestVersion || !document.getElementById("profile-purchase-history-status")) return;
    renderOrders(Array.isArray(payload?.orders) ? payload.orders : []);
    controller?.view?.createIconsScoped?.(document.querySelector(".profile-purchase-history"));
  } catch (error) {
    if (currentRequest !== requestVersion || !document.getElementById("profile-purchase-history-status")) return;
    status.dataset.tone = "danger";
    status.textContent = "Không thể tải lịch sử mua. Vui lòng thử lại.";
    controller?.view?.showToast?.(
      "Không thể tải lịch sử mua",
      error?.message || "Vui lòng kiểm tra kết nối và thử lại.",
      "error",
    );
  } finally {
    if (currentRequest === requestVersion && refreshButton) {
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
    }
  }
}

export async function mountProfilePurchaseHistory(controller) {
  const refreshButton = document.getElementById("profile-purchase-history-refresh");
  if (!refreshButton) return;
  if (refreshButton.dataset.purchaseHistoryBound !== "true") {
    refreshButton.dataset.purchaseHistoryBound = "true";
    refreshButton.addEventListener("click", () => loadPurchaseHistory(controller));
  }
  await loadPurchaseHistory(controller);
}
