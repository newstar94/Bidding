import { getJson } from "../shared/apiClient.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, formatCurrency } from "../shared/view_helpers.js";
import { formatDate, formatDateWithTime } from "../shared/formatters.js";
import { normalizeOrganizations } from "../auth/accessContext.js";
import { isTrialFullAccess } from "../commercial-policy/trialMode.js";
import { loadStyleOnce } from "../shared/externalAssets.js";

const STYLE_URL = new URL("./AccountProfile.css", import.meta.url).pathname;
const OPERATION = { purchase: "Mua gói dịch vụ", renew: "Gia hạn gói dịch vụ", upgrade: "Nâng cấp gói dịch vụ", downgrade: "Chuyển xuống gói thấp hơn", credit_pack: "Mua thêm lượt tra cứu" };
const PAYMENT = { unverified: "Chờ xác minh", verified_paid: "Đã thanh toán", refund_pending: "Đang hoàn tiền", partially_refunded: "Đã hoàn một phần", refunded: "Đã hoàn tiền", refund_failed: "Hoàn tiền thất bại" };
const ACTIVATION = { not_ready: "Chưa sẵn sàng", pending: "Đang kích hoạt", applied: "Đã kích hoạt", retry: "Đang thử lại", review_required: "Cần kiểm tra", reversed: "Đã thu hồi" };
const CHECKOUT = { creating: "Đang tạo giao dịch", open: "Chờ thanh toán", create_failed: "Không tạo được thanh toán", cancelled: "Đã hủy", expired: "Đã hết hạn" };
const SUBSCRIPTION = { active: "Đang sử dụng", expired: "Đã hết hạn", package_inactive: "Gói tạm ngừng", suspended: "Tạm ngừng", cancelled: "Đã hủy", inactive: "Chưa kích hoạt" };
const VARIANT = { basic: "Cơ bản", standard: "Cơ bản", internal: "Cơ bản", advanced: "Nâng cao", connected: "Nâng cao" };
const states = new WeakMap();
const number = (value) => Number(value || 0).toLocaleString("vi-VN");
const label = (value, labels, fallback = "Chưa xác định") => labels[String(value || "")] || fallback;
const actorId = (controller) => String(controller?.model?.state?.activeuser?.id || controller?.model?.state?.activeuser?.user_id || "");
const current = (state) => state.root.isConnected && document.getElementById("tab-profile") === state.root && actorId(state.controller) === state.actorId;
const node = (state, id) => state.root.querySelector(`#${id}`);
const icons = (state) => state.controller?.view?.createIconsScoped?.(state.root);

function badgeClass(value) {
  if (["verified_paid", "applied", "active"].includes(value)) return "badge-success";
  if (["pending", "retry", "refund_pending", "partially_refunded"].includes(value)) return "badge-warning";
  if (["review_required", "reversed", "refund_failed"].includes(value)) return "badge-danger";
  return value === "refunded" ? "badge-info" : "badge-neutral";
}
const badge = (value, text) => `<span class="badge ${badgeClass(value)}">${escapeHtml(text)}</span>`;
const paymentLabel = (order) => order.paymentState !== "unverified" ? label(order.paymentState, PAYMENT) : label(order.checkoutState, CHECKOUT, PAYMENT.unverified);
function dateLabel(value, withTime = false) {
  if (!value) return "Chưa có thông tin";
  const date = typeof value === "number" ? new Date(value * 1000) : value;
  return withTime ? formatDateWithTime(date) : formatDate(date);
}
function activationMarkup(order) {
  const startsAt = Number(order.activationStartsAt);
  if (order.activationScheduled === true && startsAt > 0) return `<span class="badge badge-info">Chờ đến kỳ kích hoạt</span><div class="account-profile__order-detail">Kích hoạt từ ${escapeHtml(dateLabel(startsAt, true))}</div>`;
  return badge(order.activationState, label(order.activationState, ACTIVATION));
}
function termLabel(item = {}) {
  if (item.billingCycle === "yearly") return "Hàng năm";
  if (item.billingCycle === "monthly") return "Hàng tháng";
  return item.termDays ? `${number(item.termDays)} ngày` : "Chưa có thông tin kỳ hạn";
}
const itemName = (order) => order.item?.displayName || order.item?.skuCode || label(order.operation, OPERATION);
function itemDetails(order) {
  const item = order.item || {};
  const parts = item.displayName || item.skuCode ? [label(order.operation, OPERATION)] : [];
  if (VARIANT[item.variant]) parts.push(VARIANT[item.variant]);
  if (item.billingCycle || item.termDays) parts.push(termLabel(item));
  if (item.credits) parts.push(`${number(item.credits)} lượt`);
  return parts.join(" · ");
}

function renderPagination(state, pagination) {
  const root = node(state, "profile-purchase-history-pagination");
  root.hidden = !pagination || pagination.totalPages <= 1;
  if (root.hidden) { root.replaceChildren(); return; }
  root.innerHTML = trustedHTML(`<span>Trang ${number(pagination.page)} / ${number(pagination.totalPages)}</span><div><button type="button" class="btn btn-outline btn-sm" data-history-page="${pagination.page - 1}"${pagination.page <= 1 ? " disabled" : ""} aria-label="Trang lịch sử trước"><i data-lucide="chevron-left" aria-hidden="true"></i> Trước</button><button type="button" class="btn btn-outline btn-sm" data-history-page="${pagination.page + 1}"${pagination.page >= pagination.totalPages ? " disabled" : ""} aria-label="Trang lịch sử sau">Sau <i data-lucide="chevron-right" aria-hidden="true"></i></button></div>`);
  root.querySelectorAll("[data-history-page]").forEach((button) => button.addEventListener("click", () => loadHistory(state, Number(button.dataset.historyPage))));
}
function renderOrders(state, payload) {
  const table = node(state, "profile-purchase-history-table"), body = node(state, "profile-purchase-history-body"), status = node(state, "profile-purchase-history-status");
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  const pagination = payload?.pagination;
  renderPagination(state, pagination);
  if (!orders.length) {
    table.hidden = true; body.replaceChildren(); status.dataset.tone = "neutral";
    status.textContent = "Bạn chưa có giao dịch mua cá nhân nào."; return;
  }
  body.innerHTML = trustedHTML(orders.map((order) => `<tr><td data-label="Mã giao dịch"><strong class="account-profile__order-id">${escapeHtml(order.publicId)}</strong></td><td data-label="Ngày tạo">${escapeHtml(dateLabel(order.createdAt, true))}</td><td data-label="Gói / Nội dung"><strong>${escapeHtml(itemName(order))}</strong><div class="account-profile__order-detail">${escapeHtml(itemDetails(order))}</div></td><td data-label="Thanh toán">${badge(order.paymentState, paymentLabel(order))}${order.paymentConfirmedAt ? `<div class="account-profile__order-detail">${escapeHtml(dateLabel(order.paymentConfirmedAt, true))}</div>` : ""}</td><td data-label="Kích hoạt">${activationMarkup(order)}</td><td data-label="Số tiền" class="text-right profile-purchase-history__amount">${escapeHtml(formatCurrency(order.totalAmount))}</td></tr>`).join(""));
  table.hidden = false; status.dataset.tone = "success";
  status.textContent = pagination ? `Hiển thị ${(pagination.page - 1) * pagination.pageSize + 1}–${(pagination.page - 1) * pagination.pageSize + orders.length} / ${number(pagination.total)} giao dịch cá nhân.` : `Đã tải ${number(orders.length)} giao dịch gần nhất.`;
}
function renderPaymentSummary(state, order) {
  const root = node(state, "profile-payment-summary");
  if (!order) { root.innerHTML = trustedHTML('<p class="account-profile__empty">Bạn chưa có giao dịch mua cá nhân. Giao dịch mới sẽ xuất hiện tại đây sau khi chọn gói.</p>'); return; }
  root.innerHTML = trustedHTML(`<div class="account-profile__latest-payment"><div><strong>${escapeHtml(itemName(order))}</strong><p>${escapeHtml(itemDetails(order))}</p><span class="account-profile__order-id">${escapeHtml(order.publicId)}</span></div><strong class="account-profile__payment-amount">${escapeHtml(formatCurrency(order.totalAmount))}</strong><div class="account-profile__payment-states">${badge(order.paymentState, paymentLabel(order))}${activationMarkup(order)}</div><div class="account-profile__order-detail">Tạo lúc ${escapeHtml(dateLabel(order.createdAt, true))}${order.paymentConfirmedAt ? ` · Thanh toán lúc ${escapeHtml(dateLabel(order.paymentConfirmedAt, true))}` : ""}</div></div>`);
}
async function loadHistory(state, page = 1) {
  if (!current(state) || (state.historyLoading && state.page === page)) return;
  const status = node(state, "profile-purchase-history-status"), refresh = node(state, "profile-purchase-history-refresh");
  const version = ++state.historyVersion;
  state.historyLoading = true; state.page = page; status.dataset.tone = "neutral"; status.textContent = "Đang tải lịch sử mua…";
  node(state, "profile-purchase-history-table").hidden = true;
  node(state, "profile-purchase-history-pagination").hidden = true;
  refresh.disabled = true; refresh.setAttribute("aria-busy", "true");
  try {
    const payload = await getJson(`/api/billing/orders?page=${page}&pageSize=10`, { retries: 0 });
    if (!current(state) || version !== state.historyVersion) return;
    state.historyLoaded = true; renderOrders(state, payload);
    if (page === 1) renderPaymentSummary(state, payload?.orders?.[0]);
    icons(state);
  } catch {
    if (!current(state) || version !== state.historyVersion) return;
    state.historyLoaded = false; status.dataset.tone = "danger";
    status.textContent = "Không thể tải lịch sử mua. Bấm Làm mới để thử lại.";
    if (page === 1) node(state, "profile-payment-summary").textContent = "Chưa tải được giao dịch gần nhất. Bấm Làm mới để thử lại.";
  } finally {
    if (version === state.historyVersion) state.historyLoading = false;
    if (current(state) && version === state.historyVersion) { refresh.disabled = false; refresh.removeAttribute("aria-busy"); }
  }
}

async function openPersonalPackages(state, button) {
  const controller = state.controller, user = controller?.model?.state?.activeuser || {};
  const personal = normalizeOrganizations(user).find((workspace) => workspace.scope_type === "personal" && workspace.status === "active");
  const status = node(state, "profile-billing-status");
  button.disabled = true; button.setAttribute("aria-busy", "true");
  try {
    if (!personal) throw new Error("Không tìm thấy không gian cá nhân trong phiên hiện tại. Vui lòng làm mới phiên đăng nhập.");
    const scope = String(user.activeOrganizationId || user.active_role_organization_id || "");
    if (scope !== personal.id) await controller.switchWorkspaceContext(personal.id);
    // The existing storefront derives payment ownership from the selected workspace.
    const selectedUser = controller?.model?.state?.activeuser || {};
    const selected = String(selectedUser.activeOrganizationId || selectedUser.active_role_organization_id || "");
    if (actorId(controller) !== state.actorId || selected !== personal.id) throw new Error("Chưa chuyển được sang không gian cá nhân. Vui lòng thử lại.");
    await controller.switchTab("commercial-storefront");
  } catch (error) {
    if (current(state)) { status.dataset.tone = "danger"; status.textContent = error?.message || "Không thể mở bảng giá cá nhân. Vui lòng thử lại."; }
  } finally { if (button.isConnected) { button.disabled = false; button.removeAttribute("aria-busy"); } }
}
function renderAccountSummary(state, payload) {
  const root = node(state, "profile-account-billing"), subscription = payload.subscription, usage = payload.usage || {};
  const isFree = !subscription || ["free", "none"].includes(subscription.packageId);
  const name = subscription?.packageName || (isFree ? "Gói miễn phí" : subscription.packageId);
  const statusName = label(subscription?.status, SUBSCRIPTION, subscription ? String(subscription.status || "Chưa xác định") : "Chưa có gói trả phí");
  const detail = (title, value) => `<div><dt>${title}</dt><dd>${escapeHtml(value)}</dd></div>`;
  root.innerHTML = trustedHTML(`<section class="dashboard-card account-profile__package"><div class="card-header"><h3 class="card-title">Gói cá nhân hiện tại</h3>${badge(subscription?.status, statusName)}</div><div class="card-body"><p class="account-profile__package-name">${escapeHtml(name)}</p><div class="account-profile__package-meta">${subscription?.variant ? `<span class="badge badge-info">${escapeHtml(label(subscription.variant, VARIANT, subscription.variant))}</span>` : ""}${!isFree ? `<span>${escapeHtml(termLabel(subscription))}</span>` : ""}</div>${isFree ? '<p class="account-profile__empty">Chọn gói phù hợp để sử dụng các tính năng và lượt Mua Sắm Công được công bố.</p>' : `<dl class="account-profile__facts">${detail("Ngày bắt đầu", dateLabel(subscription.startsAt || subscription.startDate))}${detail("Ngày hết hạn", dateLabel(subscription.expiresAt || subscription.endDate))}${subscription.sourceOrderPublicId ? detail("Giao dịch kích hoạt", subscription.sourceOrderPublicId) : ""}${subscription.sourceOrderPaymentState ? detail("Thanh toán", label(subscription.sourceOrderPaymentState, PAYMENT)) : ""}</dl>`}<div class="account-profile__package-actions"><button type="button" class="btn btn-primary" id="profile-personal-packages"><i data-lucide="package-open" aria-hidden="true"></i> Xem và gia hạn gói cá nhân</button><small>Mở bảng giá trong không gian cá nhân.</small></div></div></section><section class="dashboard-card account-profile__usage"><div class="card-header"><h3 class="card-title">Lượt Mua Sắm Công cá nhân</h3><i data-lucide="database" aria-hidden="true"></i></div><div class="card-body"><p class="account-profile__usage-number">${number(usage.available)} <small>lượt còn lại</small></p><dl class="account-profile__facts">${detail("Đang giữ chỗ", number(usage.reserved))}${detail("Hết hạn lượt gần nhất", usage.nextExpiryAt ? dateLabel(Number(usage.nextExpiryAt)) : "Chưa có hạn")}</dl><p class="account-profile__note">Chỉ tính lượt còn hiệu lực của tài khoản cá nhân. Số dư tổ chức được quản lý riêng.</p></div></section>`);
  root.removeAttribute("aria-busy");
  root.querySelector("#profile-personal-packages")?.addEventListener("click", (event) => openPersonalPackages(state, event.currentTarget));
  icons(state);
}
async function loadAccountSummary(state) {
  if (!current(state) || state.summaryLoading) return;
  const root = node(state, "profile-account-billing"), status = node(state, "profile-billing-status"), refresh = node(state, "profile-billing-refresh");
  const version = ++state.summaryVersion;
  state.summaryLoading = true; root.setAttribute("aria-busy", "true"); status.dataset.tone = "neutral";
  status.textContent = "Đang tải gói và số dư cá nhân…"; refresh.disabled = true;
  try {
    const payload = await getJson("/api/billing/account-summary", { retries: 0 });
    if (!current(state) || version !== state.summaryVersion) return;
    renderAccountSummary(state, payload); state.summaryLoaded = true;
    status.textContent = "Thông tin gói và số dư đã được máy chủ xác nhận.";
  } catch {
    if (!current(state) || version !== state.summaryVersion) return;
    state.summaryLoaded = false; status.dataset.tone = "danger";
    status.textContent = "Không thể tải gói và số dư. Bấm Làm mới để thử lại.";
    root.innerHTML = trustedHTML('<div class="account-profile__empty">Chưa tải được thông tin gói cá nhân.</div>');
  } finally {
    if (version === state.summaryVersion) state.summaryLoading = false;
    if (current(state) && version === state.summaryVersion) { root.removeAttribute("aria-busy"); refresh.disabled = false; }
  }
}

function selectTab(state, name, focus = false) {
  const tabs = [...state.root.querySelectorAll("[data-profile-tab]")];
  if (!tabs.some((tab) => tab.dataset.profileTab === name && !tab.hidden)) name = "details";
  state.selectedTab = name;
  tabs.forEach((tab) => {
    const selected = tab.dataset.profileTab === name;
    tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;
    state.root.querySelector(`#${tab.getAttribute("aria-controls")}`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
  if (name === "billing") {
    if (!state.summaryLoaded) void loadAccountSummary(state);
    if (!state.historyLoaded) void loadHistory(state, 1);
  } else if (name === "history" && !state.historyLoaded) void loadHistory(state, 1);
}

export async function mountAccountProfile(controller) {
  await loadStyleOnce(STYLE_URL);
  const root = document.getElementById("tab-profile");
  if (!root) return;
  let state = states.get(root);
  if (!state || state.actorId !== actorId(controller)) {
    state = { root, controller, actorId: actorId(controller), page: 1, historyVersion: 0, summaryVersion: 0, historyLoaded: false, summaryLoaded: false, selectedTab: "details" };
    states.set(root, state);
  }
  state.controller = controller;
  if (root.dataset.accountProfileBound !== "true") {
    root.dataset.accountProfileBound = "true";
    root.querySelectorAll("[data-profile-tab]").forEach((tab) => {
      tab.addEventListener("click", () => selectTab(states.get(root), tab.dataset.profileTab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = [...root.querySelectorAll("[data-profile-tab]")].filter((item) => !item.hidden), index = tabs.indexOf(tab);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(states.get(root), tabs[next].dataset.profileTab, true);
      });
    });
    node(state, "profile-purchase-history-refresh")?.addEventListener("click", () => { const active = states.get(root); void loadHistory(active, active.page); });
    node(state, "profile-billing-refresh")?.addEventListener("click", () => { const active = states.get(root); void Promise.allSettled([loadAccountSummary(active), loadHistory(active, 1)]); });
    root.querySelector("[data-profile-open-history]")?.addEventListener("click", () => selectTab(states.get(root), "history", true));
  }
  if (isTrialFullAccess(document)) {
    root.querySelectorAll('[data-profile-tab="billing"], [data-profile-tab="history"]').forEach((tab) => { tab.hidden = true; tab.inert = true; });
    selectTab(state, "details"); return;
  }
  // Reload facts on return from checkout; keep unsaved profile form values intact.
  state.summaryLoaded = false; state.historyLoaded = false;
  const paymentResult = new URLSearchParams(window.location.search).get("payment");
  selectTab(state, ["result", "cancelled"].includes(paymentResult) ? "history" : state.selectedTab);
}
