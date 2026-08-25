import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { trustedHTML } from "../shared/trustedTypes.js";

const STYLE_URL = new URL("./CommercialStorefront.css", import.meta.url).pathname;
const TERMINAL_ACTIVATIONS = new Set(["applied", "review_required", "reversed"]);
const state = {
  offers: [], creditPacks: [], quotaWarnings: [70, 90, 100],
  balance: null, orders: [], loading: false, polling: null,
};
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => `${new Intl.NumberFormat("vi-VN").format(Number(value || 0))} ₫`;
const request = async (path, options = {}) => {
  const response = await apiFetch(path, { handleHttpErrors: false, retries: 0, ...options });
  let payload = {}; try { payload = await response.json(); } catch { /* closed empty response */ }
  if (!response.ok) { const error = new Error(payload.error || "Không thể tải dữ liệu thương mại."); error.code = payload.code || "COMMERCIAL_REQUEST_FAILED"; error.status = response.status; throw error; }
  return payload;
};
const status = (message, tone = "neutral") => { const node = document.getElementById("storefront-status"); if (node) { node.dataset.tone = tone; node.textContent = message; } };

function renderOffers(controller) {
  const root = document.getElementById("storefront-offers");
  if (!root) return;
  root.innerHTML = trustedHTML(state.offers.length ? `<div class="commercial-storefront__grid">${state.offers.map((offer) => `<article class="commercial-storefront__card ${offer.variant === "connected" ? "is-featured" : ""}"><div class="commercial-storefront__card-top"><span class="commercial-badge" data-tone="${offer.variant === "connected" ? "success" : "neutral"}">${offer.variant === "connected" ? "Kết nối" : "Nội bộ"}</span><span>${escapeHtml(offer.display?.name || offer.tier)}</span></div><h3>${escapeHtml(offer.display?.name || offer.code)}</h3><p class="commercial-storefront__price">${money(offer.price?.total)} <small>/ năm</small></p><ul><li>${Number(offer.memberQuota || 0).toLocaleString("vi-VN")} thành viên</li><li>${Number(offer.includedProcurementQuota || 0).toLocaleString("vi-VN")} lượt tra cứu kèm theo</li><li>${offer.variant === "connected" ? "Có kiểm tra vi phạm Nhà thầu" : "Dùng tra cứu đối tác chung"}</li></ul><p class="storefront-checkout-error" id="storefront-error-${escapeHtml(offer.code)}" role="alert"></p><button type="button" class="btn btn-primary storefront-buy" data-operation="purchase" data-sku="${escapeHtml(offer.code)}">Chọn gói</button></article>`).join("")}</div><div class="commercial-storefront__packs"><h3>Mua thêm lượt tra cứu</h3>${state.creditPacks.map((pack) => `<article><div><strong>${Number(pack.quantity || 0).toLocaleString("vi-VN")} lượt</strong><span>${money(pack.price)}</span></div><button type="button" class="btn btn-outline storefront-buy" data-operation="credit_pack" data-sku="${escapeHtml(pack.code)}">Mua thêm</button><p class="storefront-checkout-error" id="storefront-error-${escapeHtml(pack.code)}" role="alert"></p></article>`).join("")}</div>` : `<div class="commercial-empty"><strong>Chưa có offer sellable.</strong><p>Super Admin cần publish release trước khi mở bán.</p></div>`);
  root.querySelectorAll(".storefront-buy").forEach((button) => button.addEventListener("click", () => startCheckout(button.dataset.sku, controller, button.dataset.operation, button)));
}

function renderBalance() {
  const root = document.getElementById("storefront-balance");
  if (!root) return;
  const balance = state.balance;
  if (!balance) { root.innerHTML = trustedHTML("<strong>Chưa có số dư</strong><span>Chọn gói hoặc mua thêm lượt để bắt đầu.</span>"); return; }
  const total = Math.max(0, Number(balance.total || 0));
  const used = Math.max(0, Number(balance.used || 0));
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const thresholds = [...state.quotaWarnings].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const reached = thresholds.filter((threshold) => percent >= threshold).at(-1) || 0;
  const tone = reached >= 90 ? "danger" : reached >= 70 ? "warning" : "neutral";
  root.dataset.tone = tone;
  root.innerHTML = trustedHTML(`<div class="commercial-storefront__balance-copy"><div><span>Lượt Mua Sắm Công</span><strong>${Number(balance.available || 0).toLocaleString("vi-VN")} còn lại</strong></div><b>${percent}% đã dùng</b></div><div class="commercial-storefront__progress" role="progressbar" aria-label="Tỷ lệ quota đã dùng" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div><div class="commercial-storefront__balance-footer"><span>${reached ? `Đã chạm ngưỡng cảnh báo ${reached}%` : "Mức sử dụng đang ổn định"}</span><span>${balance.nextExpiryAt ? `Hết hạn gần nhất ${new Date(Number(balance.nextExpiryAt) * 1000).toLocaleDateString("vi-VN")}` : "Chưa có hạn"}</span></div>${reached >= 70 ? '<button type="button" class="btn btn-outline" id="storefront-quota-cta">Xem gói lượt &amp; nâng cấp</button>' : ""}`);
  document.getElementById("storefront-quota-cta")?.addEventListener("click", () => document.querySelector(".commercial-storefront__packs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function renderOrders() {
  const node = document.getElementById("storefront-orders");
  if (!node) return;
  node.innerHTML = trustedHTML(state.orders.length ? `<div class="commercial-storefront__orders">${state.orders.map((order) => `<div data-order="${escapeHtml(order.publicId)}"><strong>${escapeHtml(order.publicId)}</strong><span>${escapeHtml(order.paymentState)} · ${escapeHtml(order.activationState)}</span><b>${money(order.totalAmount)}</b></div>`).join("")}</div>` : '<div class="commercial-empty">Chưa có order.</div>');
}

async function pollOrder(publicId, controller, attempt = 0) {
  window.clearTimeout(state.polling);
  const payload = await request(`/api/billing/orders/${encodeURIComponent(publicId)}`);
  const order = payload.order;
  if (TERMINAL_ACTIVATIONS.has(order.activationState) || ["cancelled", "expired", "create_failed"].includes(order.checkoutState)) {
    status(order.activationState === "applied" ? "Thanh toán đã được máy chủ xác minh và quyền lợi đã kích hoạt." : `Order cần xử lý: ${order.activationState}.`, order.activationState === "applied" ? "success" : "warning");
    await refresh(controller);
    return;
  }
  if (attempt >= 39) { status("Order vẫn đang đối soát. Bạn có thể đóng trang và làm mới lịch sử sau.", "warning"); return; }
  state.polling = window.setTimeout(() => pollOrder(publicId, controller, attempt + 1).catch(() => {}), 3000);
}

async function startCheckout(skuCode, controller, operation = "purchase", button = null) {
  const errorNode = document.getElementById(`storefront-error-${skuCode}`);
  if (errorNode) errorNode.textContent = "";
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    const actor = controller?.model?.state?.activeuser || {};
    const activeScope = String(actor.activeOrganizationId || actor.active_role_organization_id || "");
    const ownerKind = activeScope && !activeScope.startsWith("personal:") ? "organization" : "account";
    const ownerId = ownerKind === "organization" ? activeScope : actor.id || actor.user_id;
    const quote = await request("/api/billing/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerKind, ownerId, operation, skuCode }) });
    const order = await request("/api/billing/checkouts", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `storefront-${crypto.randomUUID()}` }, body: JSON.stringify({ quotePublicId: quote.publicId }) });
    if (order.order?.checkoutUrl) window.open(order.order.checkoutUrl, "_blank", "noopener");
    status("Checkout đã tạo. Đang chờ máy chủ đối soát thanh toán…", "neutral");
    await pollOrder(order.order.publicId, controller);
  } catch (error) {
    const message = `${error.code}: ${error.message}`;
    if (errorNode) errorNode.textContent = message;
    status(message, error.code === "BLOCKED_DECISION" ? "warning" : "danger");
  } finally { if (button) { button.disabled = false; button.removeAttribute("aria-busy"); } }
}

async function refresh(controller) {
  if (state.loading) return;
  state.loading = true; status("Đang đồng bộ bảng giá và số dư…");
  try {
    const catalog = await request("/api/public/commercial/offers");
    const actor = controller?.model?.state?.activeuser || {};
    const activeScope = String(actor.activeOrganizationId || actor.active_role_organization_id || "");
    const ownerKind = activeScope && !activeScope.startsWith("personal:") ? "organization" : "account";
    state.offers = (catalog.offers || []).filter((offer) => offer.ownerKind === ownerKind);
    state.creditPacks = catalog.creditPacks || [];
    state.quotaWarnings = catalog.quotaWarnings || [70, 90, 100];
    renderOffers(controller);
    try { state.balance = await request("/api/billing/usage"); } catch (error) { state.balance = null; if (error.code === "BLOCKED_DECISION") status("Usage tổ chức đang chờ quyết định quyền đọc.", "warning"); }
    renderBalance();
    try { const orders = await request("/api/billing/orders"); state.orders = orders.orders || []; } catch { state.orders = []; }
    renderOrders();
    status("Đã đồng bộ theo release hiện hành.", "success");
  } catch (error) { status(`${error.code}: ${error.message}`, "danger"); renderOffers(controller); } finally { state.loading = false; }
}

export async function mountCommercialStorefront(controller) {
  await loadStyleOnce(STYLE_URL);
  document.getElementById("storefront-refresh")?.addEventListener("click", () => refresh(controller));
  await refresh(controller);
}
