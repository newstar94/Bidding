import { apiFetch } from "../shared/apiClient.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { formatDateWithTime } from "../shared/formatters.js";
import {
  classifyPublicCommercialResponse,
  formatCommercialMoney,
  presentCommercialOffer,
  visibleOffersForOwner,
} from "./PublicCommercialCatalog.js";
import { COMMERCIAL_GROUPS, selectCommercialOffers } from "./CommercialOfferSelection.js";
import { createCheckoutPaymentDialog } from "./CheckoutPaymentDialog.js";
import {
  checkoutIntentFromLocation,
  clearPendingCheckoutIntent,
  clearCheckoutIntentFromLocation,
  readPendingCheckoutIntent,
} from "./pendingCheckout.js";

const STYLE_URL = new URL("./CommercialStorefront.css", import.meta.url).pathname;
const TERMINAL_ACTIVATIONS = new Set(["applied", "review_required", "reversed"]);
const state = {
  availability: "available",
  offers: [], creditPacks: [], quotaWarnings: [70, 90, 100],
  balance: null, orders: [], loading: false, polling: null, commercialReleaseId: "",
  group: "basic", periods: {},
  checkoutSession: null,
  contextGeneration: 0,
};
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const money = (value) => formatCommercialMoney(value, "VND");
const activeCommercialScope = (actor) => String(actor?.activeOrganizationId || actor?.active_role_organization_id || actor?.active_org_id || "");
function commercialContext(controller) {
  const model = controller?.model;
  const actor = model?.state?.activeuser || {};
  return { controller, model, contextGeneration: state.contextGeneration,
    actorId: String(actor.id || actor.user_id || ""), activeScope: activeCommercialScope(actor), workspaceToken: model?.getWorkspaceToken?.() || "" };
}
const request = async (path, options = {}) => {
  const response = await apiFetch(path, { handleHttpErrors: false, retries: 0, ...options });
  let payload = {}; try { payload = await response.json(); } catch { /* closed empty response */ }
  if (!response.ok) { const error = new Error(payload.error || "Không thể tải dữ liệu thương mại."); error.code = payload.code || "COMMERCIAL_REQUEST_FAILED"; error.status = response.status; throw error; }
  return payload;
};
const sendCommercialEvent = (event, extra = {}) => {
  if (!state.commercialReleaseId) return;
  const payload = { event, commercialReleaseId: state.commercialReleaseId, source: "commercial_storefront", ...extra };
  void fetch("/api/commercial-analytics/events", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
};
export const sendCommercialFeedback = async (moment, reason) => {
  if (!state.commercialReleaseId || !moment || !reason) return false;
  try {
    const response = await fetch("/api/commercial-analytics/feedback", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moment, reason, commercialReleaseId: state.commercialReleaseId }),
    });
    return response.ok;
  } catch { return false; }
};
const showOptionalFeedback = (moment) => {
  const panel = document.getElementById("storefront-feedback");
  const input = document.getElementById("storefront-feedback-moment");
  if (panel && input) { input.value = moment; panel.hidden = false; panel.scrollIntoView({ block: "nearest" }); }
};
const status = (message, tone = "neutral") => { const node = document.getElementById("storefront-status"); if (node) { node.dataset.tone = tone; node.textContent = message; } };
const clearPaymentAction = () => {
  const node = document.getElementById("storefront-payment-action");
  if (!node) return;
  node.hidden = true;
  node.replaceChildren();
};
const renderPaymentAction = (order) => {
  const node = document.getElementById("storefront-payment-action");
  if (!node) return;
  const checkoutUrl = resumableCheckoutUrl(order);
  if (!checkoutUrl) { clearPaymentAction(); return; }
  node.hidden = false;
  node.innerHTML = trustedHTML(`<div><strong>Đơn thanh toán đang chờ xử lý</strong><span>Mở mã QR để tiếp tục thanh toán giao dịch hiện tại.</span></div><button type="button" class="btn btn-primary" data-storefront-resume="${escapeHtml(order.publicId)}">Mở QR thanh toán</button>`);
  node.querySelector("button")?.addEventListener("click", () => resumeCheckout(order));
};

function renderOffers(controller) {
  const root = document.getElementById("storefront-offers");
  if (!root) return;
  const emptyState = state.availability === "off"
    ? `<div class="commercial-empty"><strong>Cửa hàng chưa mở bán.</strong><p>Bảng giá mới sẽ xuất hiện tại đây sau khi chính sách thương mại được phê duyệt và phát hành.</p></div>`
    : `<div class="commercial-empty"><strong>Chưa có gói phù hợp.</strong><p>Catalog hiện hành chưa công bố gói bán cho không gian làm việc này.</p></div>`;
  const selection = selectCommercialOffers(state.offers, state);
  const card = (offer, selectedCard = null) => {
    const presented = presentCommercialOffer(offer);
    const badge = presented.badge || presented.recommended
      ? `<span class="commercial-badge" data-tone="${presented.recommended ? "success" : "neutral"}">${escapeHtml(presented.badge || "Gói đề xuất")}</span>`
      : "";
    const variant = presented.variantLabel || ({ internal: "Cơ bản", connected: "Nâng cao" })[offer.variant] || "";
    const variantLabel = `<span>${escapeHtml(variant)}${variant ? " · " : ""}${escapeHtml(presented.code)}</span>`;
    const description = presented.description ? `<p class="commercial-storefront__description">${escapeHtml(presented.description)}</p>` : "";
    const benefits = presented.details.map(detail => `<li>${escapeHtml(detail.label)}${detail.value === undefined ? "" : `: <strong>${escapeHtml(detail.value)}</strong>`}</li>`).join("");
    const cardId = selectedCard ? `storefront-offer-${encodeURIComponent(selectedCard.key)}` : "";
    const periods = selectedCard ? `<div class="commercial-storefront__card-periods" role="group" aria-label="Chu kỳ thanh toán ${escapeHtml(presented.name)}">${[["monthly", "Hàng tháng"], ["yearly", "Hàng năm"]].map(([period, label]) => `<button type="button" data-storefront-period="${period}" data-storefront-card-key="${escapeHtml(selectedCard.key)}" aria-controls="${cardId}" aria-pressed="${period === selectedCard.period}"${selectedCard.periods.includes(period) ? "" : ' disabled aria-disabled="true"'}>${label}</button>`).join("")}</div>` : "";
    const note = selectedCard && !selectedCard.periods.includes("monthly") ? '<small class="commercial-storefront__period-note">Giá hàng tháng chưa được công bố.</small>' : "";
    return `<article class="commercial-storefront__card${presented.recommended ? " is-featured" : ""}" data-commercial-offer-code="${escapeHtml(presented.code)}"${selectedCard ? ` id="${cardId}" data-pricing-card="${escapeHtml(selectedCard.key)}"` : ""}><h3>${escapeHtml(presented.name)}</h3><div class="commercial-storefront__card-top">${variantLabel}</div>${badge}${periods}<p class="commercial-storefront__price"><strong>${escapeHtml(presented.priceLabel)}</strong><small>Giá bán sau VAT ${escapeHtml(presented.periodLabel)}</small></p>${description}<ul>${benefits}</ul><p class="storefront-checkout-error" id="storefront-error-${escapeHtml(presented.code)}" role="alert"></p><div class="commercial-storefront__card-actions"><button type="button" class="btn btn-primary storefront-buy" data-operation="purchase" data-sku="${escapeHtml(presented.code)}">Chọn gói</button><button type="button" class="btn btn-outline storefront-buy" data-operation="renew" data-sku="${escapeHtml(presented.code)}">Gia hạn gói này</button></div>${note}</article>`;
  };
  const groupControls = selection.grouped
    ? `<div class="commercial-storefront__pricing-controls"><div role="group" aria-label="Nhóm gói dịch vụ">${Object.entries(COMMERCIAL_GROUPS).map(([group, item]) => `<button type="button" data-storefront-group="${group}" aria-controls="storefront-price-list" aria-pressed="${group === state.group}">${item.label}</button>`).join("")}</div></div>`
    : "";
  const audience = (label, offers, kind) => offers.length
    ? `<section class="commercial-storefront__audience" data-pricing-audience="${kind}"><h3>${label}</h3><div class="commercial-storefront__grid">${offers.map((item) => item.offer ? card(item.offer, item) : card(item)).join("")}</div></section>` : "";
  const offerContent = selection.grouped
    ? `${audience("Cá nhân", selection.personal, "account")}${audience("Tổ chức", selection.organization, "organization")}${selection.selected.length ? "" : `<p class="commercial-empty">Chưa có gói ${COMMERCIAL_GROUPS[state.group].label} đang bán.</p>`}${audience("Các gói khác", selection.additional, "other")}`
    : `<div class="commercial-storefront__grid">${selection.additional.map((item) => card(item)).join("")}</div>`;
  const packs = state.creditPacks.length
    ? `<div class="commercial-storefront__packs"><h3>Mua thêm lượt lấy hồ sơ Mua Sắm Công</h3>${state.creditPacks.map((pack) => `<article><div><strong>${Number(pack.quantity || 0).toLocaleString("vi-VN")} lượt</strong><span>${money(pack.price)}</span></div><button type="button" class="btn btn-outline storefront-buy" data-operation="credit_pack" data-sku="${escapeHtml(pack.code)}">Mua thêm</button><p class="storefront-checkout-error" id="storefront-error-${escapeHtml(pack.code)}" role="alert"></p></article>`).join("")}</div>`
    : "";
  root.innerHTML = trustedHTML(state.offers.length ? `${groupControls}<div id="storefront-price-list" aria-live="polite">${offerContent}</div>${packs}` : emptyState);
  root.querySelectorAll("[data-storefront-group], [data-storefront-period]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      if (button.dataset.storefrontGroup) state.group = button.dataset.storefrontGroup;
      const cardKey = button.dataset.storefrontCardKey;
      if (cardKey && button.dataset.storefrontPeriod) state.periods[cardKey] = button.dataset.storefrontPeriod;
      const selector = button.dataset.storefrontGroup
        ? `[data-storefront-group="${state.group}"]` : null;
      const period = button.dataset.storefrontPeriod;
      renderOffers(controller);
      const target = selector ? root.querySelector(selector)
        : [...root.querySelectorAll("[data-storefront-period]")].find((node) => node.dataset.storefrontCardKey === cardKey && node.dataset.storefrontPeriod === period);
      target?.focus({ preventScroll: true });
    });
  });
  root.querySelectorAll(".storefront-buy").forEach((button) => button.addEventListener("click", () => {
    sendCommercialEvent("pricing.offer_selected", { skuCode: button.dataset.sku });
    void startCheckout(button.dataset.sku, controller, button.dataset.operation, button);
  }));
  if (state.checkoutSession) root.querySelectorAll(".storefront-buy").forEach((button) => { button.disabled = true; });
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
  root.innerHTML = trustedHTML(`<div class="commercial-storefront__balance-copy"><div><span>Lượt lấy dữ liệu tự động</span><strong>${Number(balance.available || 0).toLocaleString("vi-VN")} còn lại</strong></div><b>${percent}% đã dùng</b></div><div class="commercial-storefront__progress" role="progressbar" aria-label="Tỷ lệ quota đã dùng" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div><div class="commercial-storefront__balance-footer"><span>${reached ? `Đã chạm ngưỡng cảnh báo ${reached}%` : "Mức sử dụng đang ổn định"}</span><span>${balance.nextExpiryAt ? `Hết hạn gần nhất ${new Date(Number(balance.nextExpiryAt) * 1000).toLocaleDateString("vi-VN")}` : "Chưa có hạn"}</span></div>${reached >= 70 ? '<button type="button" class="btn btn-outline" id="storefront-quota-cta">Xem gói lượt &amp; nâng cấp</button>' : ""}`);
  document.getElementById("storefront-quota-cta")?.addEventListener("click", () => document.querySelector(".commercial-storefront__packs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function resumableCheckoutUrl(order) {
  if (order.checkoutState !== "open" || order.paymentState !== "unverified"
      || TERMINAL_ACTIVATIONS.has(order.activationState)) return "";
  if (order.checkoutExpiresAt && Number(order.checkoutExpiresAt) * 1000 <= Date.now()) return "";
  try {
    const url = new URL(order.checkoutUrl, window.location.origin);
    return ["http:", "https:"].includes(url.protocol) && order.checkoutUrl ? url.href : "";
  } catch { return ""; }
}

function rememberOrder(order) {
  if (!order?.publicId) return;
  const existing = state.orders.findIndex((item) => item.publicId === order.publicId);
  if (existing < 0) state.orders.unshift(order);
  else state.orders[existing] = order;
  renderOrders();
}

function scheduledActivationDate(order) {
  const startsAt = Number(order?.activationStartsAt);
  const date = new Date(startsAt * 1000);
  if (order?.activationScheduled !== true || startsAt <= 0 || !Number.isFinite(date.getTime())) return "";
  return formatDateWithTime(date);
}

function renderOrders() {
  const node = document.getElementById("storefront-orders");
  if (!node) return;
  const resumableOrder = state.orders.find((order) => resumableCheckoutUrl(order));
  if (resumableOrder) renderPaymentAction(resumableOrder);
  else clearPaymentAction();
  node.innerHTML = trustedHTML(state.orders.length ? `<div class="commercial-storefront__orders">${state.orders.map((order) => {
    const checkoutUrl = resumableCheckoutUrl(order);
    const scheduledDate = scheduledActivationDate(order);
    const orderState = scheduledDate ? `Chờ đến kỳ kích hoạt · ${scheduledDate}` : `${order.paymentState} · ${order.activationState}`;
    const resume = checkoutUrl ? `<button type="button" class="btn btn-outline" data-storefront-resume="${escapeHtml(order.publicId)}" aria-label="Mở lại thanh toán ${escapeHtml(order.publicId)}">Mở lại thanh toán</button>` : "";
    return `<div data-order="${escapeHtml(order.publicId)}"><strong>${escapeHtml(order.publicId)}</strong><span>${escapeHtml(orderState)}</span><b>${money(order.totalAmount)}</b><div class="commercial-storefront__order-actions">${resume}</div></div>`;
  }).join("")}</div>` : '<div class="commercial-empty">Chưa có order.</div>');
  node.querySelectorAll("[data-storefront-resume]").forEach((button) => {
    button.addEventListener("click", () => resumeCheckout(state.orders.find((order) => order.publicId === button.dataset.storefrontResume)));
  });
}

const PAID_PAYMENT_STATES = new Set(["verified_paid", "refund_pending", "partially_refunded", "refunded", "refund_failed"]);
const CLOSED_CHECKOUT_STATES = new Set(["cancelled", "expired", "create_failed"]);

function openCheckoutSession(controller, title, order = null) {
  const session = { controller, order, cancelRequested: false, cancelling: false, creating: false, createStarted: false, createUncertain: false, dismissed: false, cancelPolling: null, paymentPolling: null, successReturnTimer: null, returnToOverviewOnDismiss: false, pollGeneration: 0, settled: false, checkoutKey: `storefront-${crypto.randomUUID()}`, quotePublicId: "", paymentSignature: "", packageTitle: "", activationRefresh: null,
    ...commercialContext(controller) };
  state.checkoutSession = session;
  document.querySelectorAll(".storefront-buy").forEach((button) => { button.disabled = true; });
  session.dialog = createCheckoutPaymentDialog({
    title,
    onCancel: () => cancelCheckoutSession(session),
    onDismiss: () => {
      session.dismissed = true;
      window.clearTimeout(session.cancelPolling);
      window.clearTimeout(session.successReturnTimer);
      if (state.checkoutSession === session) {
        state.checkoutSession = null;
        document.querySelectorAll(".storefront-buy").forEach((button) => { button.disabled = false; button.removeAttribute("aria-busy"); });
      }
      if (session.returnToOverviewOnDismiss) {
        const switchTab = session.controller?.switchTab;
        if (typeof switchTab === "function") void switchTab.call(session.controller, "dashboard");
      }
    },
  });
  return session;
}

function showSuccessfulCheckoutState(session, message) {
  if (!session || session.dismissed) return;
  session.settled = true;
  session.returnToOverviewOnDismiss = true;
  session.dialog.showState(message, "success", { canDismiss: true, hidePayment: true });
  window.clearTimeout(session.successReturnTimer);
  session.successReturnTimer = window.setTimeout(() => {
    if (!session.dismissed) session.dialog.close();
  }, 5000);
}

function checkoutContextIsCurrent(session) {
  if (!session) return true;
  const model = session.controller?.model;
  const actor = model?.state?.activeuser || {};
  return state.controller === session.controller
    && model === session.model
    && state.contextGeneration === session.contextGeneration
    && String(actor.id || actor.user_id || "") === session.actorId
    && activeCommercialScope(actor) === session.activeScope
    && (!session.workspaceToken || typeof model?.isWorkspaceCurrent !== "function" || model.isWorkspaceCurrent(session.workspaceToken));
}

function retireStaleCheckout(session) {
  if (checkoutContextIsCurrent(session)) return false;
  window.clearTimeout(session.paymentPolling);
  window.clearTimeout(session.cancelPolling);
  window.clearTimeout(session.successReturnTimer);
  session.returnToOverviewOnDismiss = false;
  session.dialog.close();
  return true;
}

async function verifyRefreshedAccess(controller) {
  const payload = await request("/api/auth/check-session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" }),
  });
  const actor = controller?.model?.state?.activeuser || {};
  const user = payload.user || {};
  const scope = activeCommercialScope(actor);
  if (payload.valid !== true || String(user.id || "") !== String(actor.id || actor.user_id || "") || String(user.active_org_id || "") !== scope) return false;
  const workspace = actor.organizations?.find((item) => String(item.id) === scope);
  const expectedWorkspace = user.organizations?.find((item) => String(item.id) === scope);
  const subscription = workspace?.subscription;
  const expectedSubscription = expectedWorkspace?.subscription || user.subscription;
  const expectedEntitlements = user.entitlements || expectedWorkspace?.entitlements || {};
  return String(actor.package_id || "none") === String(user.package_id || "none")
    && Number(subscription?.revision || 0) === Number(expectedSubscription?.revision || 0)
    && Boolean(actor.wordExportEnabled) === Boolean(expectedEntitlements.word_export)
    && Boolean(actor.excelExportEnabled) === Boolean(expectedEntitlements.excel_export)
    && Boolean(actor.awardResultExcelExportEnabled) === Boolean(expectedEntitlements.award_result_excel_export);
}

async function refreshActivatedPurchase(controller, session) {
  if (session && retireStaleCheckout(session)) return;
  if (session?.activationRefresh) return session.activationRefresh;
  const message = session?.packageTitle
    ? `Thanh toán đã được máy chủ xác minh. Gói “${session.packageTitle}” đã được kích hoạt.`
    : "Thanh toán đã được máy chủ xác minh và quyền lợi đã kích hoạt.";
  if (session) showSuccessfulCheckoutState(session, message);
  status(message, "success");
  const update = (async () => {
    try {
      // A pre-existing session request may have read the subscription before
      // activation. Finish it, then request the current authoritative access
      // context through the normal session checker and its identity guards.
      if (controller?._sessionCheckInFlight) await controller._sessionCheckInFlight;
      if (!checkoutContextIsCurrent(session)) return;
      await controller?._checkSessionNow?.();
      if (!checkoutContextIsCurrent(session)) return;
      // The existing checker intentionally logs and swallows transport errors.
      // Verify its applied package/export flags against a fresh session read;
      // this check never assigns permissions from a checkout or changes roles.
      const accessCurrent = await verifyRefreshedAccess(controller);
      if (!checkoutContextIsCurrent(session)) return;
      await refresh(controller);
      if (!checkoutContextIsCurrent(session)) return;
      if (!accessCurrent) throw new Error("Session refresh is pending");
      status(message, "success");
    } catch {
      if (!checkoutContextIsCurrent(session)) return;
      const warning = `${message} Phiên làm việc đang chờ cập nhật quyền lợi; vui lòng bấm Làm mới.`;
      status(warning, "warning");
      if (session && !session.dismissed) session.dialog.showState(warning, "warning", { canDismiss: true, hidePayment: true });
    }
  })();
  if (session) session.activationRefresh = update;
  return update;
}

async function cancellationResult(session, order) {
  if (retireStaleCheckout(session)) return true;
  if (!order?.publicId) return false;
  session.order = order;
  rememberOrder(order);
  if (PAID_PAYMENT_STATES.has(order.paymentState)) {
    session.settled = true;
    session.cancelRequested = false;
    if (order.activationState === "applied") { await refreshActivatedPurchase(session.controller, session); return true; }
    const scheduledDate = scheduledActivationDate(order);
    const message = scheduledDate
      ? `Thanh toán đã được máy chủ xác minh; quyền lợi sẽ kích hoạt từ ${scheduledDate}.`
      : "Thanh toán đã được máy chủ xác minh. Đang kích hoạt quyền lợi…";
    showSuccessfulCheckoutState(session, message);
    status(message, "success");
    if (order.activationState === "pending" && !scheduledDate) void pollOrder(order.publicId, session.controller, 0, session);
    return true;
  }
  if (CLOSED_CHECKOUT_STATES.has(order.checkoutState)) {
    session.settled = true;
    status(order.checkoutState === "cancelled" ? "Đã hủy giao dịch thanh toán." : "Giao dịch đã hết hiệu lực.", "neutral");
    session.dialog.close();
    return true;
  }
  return false;
}

function cancellationFailure(session, error) {
  if (retireStaleCheckout(session)) return;
  session.cancelling = false;
  session.dialog.showState(`Chưa hủy được giao dịch. ${error.message || "Vui lòng thử lại."}`, "danger", { hidePayment: true, cancelLabel: "Thử hủy lại" });
  status("Chưa có xác nhận hủy giao dịch. Vui lòng thử hủy lại trong cửa sổ thanh toán.", "warning");
}

async function pollCancellation(session, attempt = 0) {
  if (session.dismissed || !session.cancelRequested || retireStaleCheckout(session)) return;
  try {
    const payload = await request(`/api/billing/orders/${encodeURIComponent(session.order.publicId)}`);
    if (await cancellationResult(session, payload.order)) { session.cancelling = false; return; }
  } catch (error) {
    if (retireStaleCheckout(session)) return;
    if (attempt >= 39) { cancellationFailure(session, error); return; }
  }
  if (attempt >= 39) { cancellationFailure(session, new Error("Máy chủ đang tiếp tục đối soát yêu cầu hủy.")); return; }
  session.cancelPolling = window.setTimeout(() => { void pollCancellation(session, attempt + 1); }, 3000);
}

async function cancelCheckoutSession(session) {
  if (session.dismissed || session.cancelling || retireStaleCheckout(session)) return;
  if (session.settled) { session.dialog.close(); return; }
  session.cancelRequested = true;
  session.pollGeneration += 1;
  window.clearTimeout(session.paymentPolling);
  if (!session.order) {
    if (session.createUncertain && !session.creating) {
      session.cancelling = true;
      session.dialog.showState("Đang xác định giao dịch để hủy…", "neutral", { busy: true, hidePayment: true });
      try {
        await createCheckoutOrder(session);
        session.cancelling = false;
        await cancelCheckoutSession(session);
      } catch (error) { cancellationFailure(session, error); }
    } else if (!session.creating) {
      status("Đã hủy lựa chọn gói. Chưa tạo giao dịch thanh toán.", "neutral");
      session.dialog.close();
    } else {
      session.dialog.showState("Đang hủy giao dịch… Vui lòng chờ xác nhận từ máy chủ.", "neutral", { busy: true, hidePayment: true });
    }
    return;
  }
  session.cancelling = true;
  session.dialog.showState("Đang hủy giao dịch… Vui lòng chờ xác nhận từ payOS.", "neutral", { busy: true, hidePayment: true });
  try {
    const payload = await request(`/api/billing/orders/${encodeURIComponent(session.order.publicId)}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Người dùng đóng hoặc hủy cửa sổ thanh toán" }),
    });
    if (retireStaleCheckout(session)) return;
    if (await cancellationResult(session, payload.order)) { session.cancelling = false; return; }
    session.dialog.showState("Đã gửi yêu cầu hủy, đang chờ payOS xác nhận…", "neutral", { busy: true, hidePayment: true });
    session.cancelPolling = window.setTimeout(() => { void pollCancellation(session); }, 3000);
  } catch (error) {
    if (retireStaleCheckout(session)) return;
    // A payment may finish while the cancellation request is in flight. Only
    // the server's latest order can decide whether this is already settled.
    try {
      const payload = await request(`/api/billing/orders/${encodeURIComponent(session.order.publicId)}`);
      if (retireStaleCheckout(session)) return;
      if (await cancellationResult(session, payload.order)) { session.cancelling = false; return; }
    } catch { /* Retain the cancellation intent for an explicit retry. */ }
    cancellationFailure(session, error);
  }
}

async function createCheckoutOrder(session) {
  if (retireStaleCheckout(session)) return null;
  const wasUncertain = session.createUncertain;
  session.creating = true;
  session.createStarted = true;
  try {
    const payload = await request("/api/billing/checkouts", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": session.checkoutKey }, body: JSON.stringify({ quotePublicId: session.quotePublicId }),
    });
    if (retireStaleCheckout(session)) return null;
    if (!payload.order?.publicId) throw new Error("Máy chủ chưa trả mã giao dịch thanh toán.");
    session.order = payload.order;
    session.createUncertain = false;
    rememberOrder(payload.order);
    return payload.order;
  } catch (error) {
    if (retireStaleCheckout(session)) return null;
    session.createUncertain = wasUncertain || !error.status || error.status >= 500;
    throw error;
  } finally { session.creating = false; }
}

function showSessionPayment(session, order) {
  if (order.checkoutState !== "open" || PAID_PAYMENT_STATES.has(order.paymentState)) return;
  const signature = `${order.checkoutState}:${order.paymentDetails?.qrCodeImage || ""}:${order.checkoutUrl || ""}`;
  if (session.paymentSignature === signature) return;
  session.paymentSignature = signature;
  session.dialog.showPayment(order, resumableCheckoutUrl(order));
}

async function presentCreatedCheckout(session) {
  if (retireStaleCheckout(session) || session.dismissed || !session.order) return;
  if (session.cancelRequested) { await cancelCheckoutSession(session); return; }
  if (session.order.checkoutState === "creating") {
    session.dialog.showState("Đang chuẩn bị mã QR từ payOS…");
  } else {
    showSessionPayment(session, session.order);
  }
  status("Đang chờ máy chủ đối soát giao dịch thanh toán…", "neutral");
  await pollOrder(session.order.publicId, session.controller, 0, session);
}

function resumeCheckout(order) {
  if (state.checkoutSession) { state.checkoutSession.dialog.show(); return; }
  const checkoutUrl = order && resumableCheckoutUrl(order);
  if (!checkoutUrl) return;
  const session = openCheckoutSession(state.controller, "Giao dịch đang chờ thanh toán", order);
  showSessionPayment(session, order);
  void pollOrder(order.publicId, state.controller, 0, session);
}

async function pollOrder(publicId, controller, attempt = 0, session = null) {
  const generation = session?.pollGeneration;
  const canContinue = () => !session?.cancelRequested
    && (!session?.dismissed || session?.settled)
    && generation === session?.pollGeneration
    && checkoutContextIsCurrent(session);
  const schedule = () => {
    const timer = window.setTimeout(() => pollOrder(publicId, controller, attempt + 1, session).catch(() => {}), 3000);
    if (session) session.paymentPolling = timer;
    else state.polling = timer;
  };
  if (!canContinue()) return;
  window.clearTimeout(session ? session.paymentPolling : state.polling);
  let payload;
  try {
    payload = await request(`/api/billing/orders/${encodeURIComponent(publicId)}`);
  } catch (error) {
    if (!canContinue()) return;
    if (attempt >= 39) {
      status(`Không thể cập nhật trạng thái order (${error.code || "NETWORK_ERROR"}). Hãy bấm làm mới để tiếp tục theo dõi.`, "warning");
      return;
    }
    status("Đang tạm mất kết nối; sẽ tự thử lại trạng thái thanh toán…", "warning");
    if (canContinue()) schedule();
    return;
  }
  if (!canContinue()) return;
  const order = payload.order;
  if (session) session.order = order;
  rememberOrder(order);
  const scheduledDate = scheduledActivationDate(order);
  if (scheduledDate) {
    const message = `Thanh toán đã được máy chủ xác minh; quyền lợi sẽ kích hoạt từ ${scheduledDate}. Bạn có thể đóng trang và xem lại trong lịch sử mua.`;
    status(message, "success");
    if (session) showSuccessfulCheckoutState(session, message);
    return;
  }
  const paid = PAID_PAYMENT_STATES.has(order.paymentState);
  if (order.activationState === "applied") { await refreshActivatedPurchase(controller, session); return; }
  if (TERMINAL_ACTIVATIONS.has(order.activationState) || (CLOSED_CHECKOUT_STATES.has(order.checkoutState) && !paid)) {
    const message = order.activationState === "applied" ? "Thanh toán đã được máy chủ xác minh và quyền lợi đã kích hoạt."
      : order.checkoutState === "cancelled" ? "Giao dịch đã được hủy." : order.checkoutState === "expired" ? "Mã QR đã hết hạn. Vui lòng chọn lại gói để tạo giao dịch mới." : order.checkoutState === "create_failed" ? "Không thể tạo mã thanh toán. Vui lòng chọn lại gói." : `Giao dịch cần xử lý: ${order.activationState}.`;
    const tone = order.activationState === "applied" ? "success" : "warning";
    status(message, tone);
    if (session) { session.settled = paid || CLOSED_CHECKOUT_STATES.has(order.checkoutState); session.dialog.showState(message, tone, { canDismiss: session.settled, hidePayment: true }); }
    await refresh(controller);
    return;
  }
  if (session && paid) {
    session.settled = true;
    session.dialog.showState("Đã xác minh thanh toán. Đang kích hoạt quyền lợi…", "success", { canDismiss: true, hidePayment: true });
  } else if (session) showSessionPayment(session, order);
  if (attempt >= 39) { status("Giao dịch vẫn đang đối soát. Bấm Làm mới để kiểm tra trạng thái.", "warning"); return; }
  schedule();
}

async function startCheckout(skuCode, controller, operation = "purchase", button = null) {
  if (state.checkoutSession) { state.checkoutSession.dialog.show(); return; }
  const errorNode = document.getElementById(`storefront-error-${skuCode}`);
  if (errorNode) errorNode.textContent = "";
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  const offer = state.offers.find((item) => item.code === skuCode);
  const presented = offer ? presentCommercialOffer(offer) : null;
  const packageTitle = presented ? [presented.name, presented.variantLabel].filter(Boolean).join(" · ") : "Gói lượt tra cứu";
  const session = openCheckoutSession(controller, packageTitle);
  session.packageTitle = packageTitle;
  try {
    sendCommercialEvent("checkout.started", { skuCode });
    const actor = controller?.model?.state?.activeuser || {};
    const activeScope = activeCommercialScope(actor);
    const ownerKind = activeScope && !activeScope.startsWith("personal:") ? "organization" : "account";
    const ownerId = ownerKind === "organization" ? activeScope : actor.id || actor.user_id;
    const quote = await request("/api/billing/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerKind, ownerId, operation, skuCode }) });
    if (retireStaleCheckout(session)) return;
    if (session.cancelRequested) return;
    session.quotePublicId = quote.publicId;
    await createCheckoutOrder(session);
    await presentCreatedCheckout(session);
  } catch (error) {
    session.creating = false;
    if (retireStaleCheckout(session) || session.dismissed) return;
    if (session.createUncertain) {
      if (session.cancelRequested) { await cancelCheckoutSession(session); return; }
      // Repeat with the same key when the response was lost after a commit.
      // This resolves the original transaction instead of creating another.
      try { await createCheckoutOrder(session); await presentCreatedCheckout(session); return; } catch { /* Keep an unresolved transaction available for cancellation. */ }
    }
    sendCommercialEvent("checkout.cancelled", { skuCode });
    const message = `${error.code}: ${error.message}`;
    session.settled = !session.order && !session.createUncertain;
    session.dialog.showState(session.createUncertain ? "Chưa xác định được giao dịch do mất kết nối. Bấm Hủy thanh toán để kiểm tra và hủy giao dịch hiện tại." : message, "danger", { canDismiss: session.settled, hidePayment: true });
    if (errorNode) errorNode.textContent = message;
    status(message, error.code === "BLOCKED_DECISION" ? "warning" : "danger");
    showOptionalFeedback("checkout_abandoned");
  } finally { if (button) { button.disabled = Boolean(state.checkoutSession && !state.checkoutSession.settled); button.removeAttribute("aria-busy"); } }
}

async function refresh(controller) {
  const context = commercialContext(controller);
  const existing = state.refreshRequest;
  if (existing && existing.context.controller === controller
      && existing.context.actorId === context.actorId && existing.context.activeScope === context.activeScope
      && existing.context.workspaceToken === context.workspaceToken && checkoutContextIsCurrent(existing.context)) {
    return existing.promise;
  }
  const refreshRequest = { context, promise: null };
  state.refreshRequest = refreshRequest;
  const isCurrent = () => state.refreshRequest === refreshRequest && checkoutContextIsCurrent(context);
  state.loading = true; status("Đang đồng bộ bảng giá và số dư…");
  state.balance = null;
  state.orders = [];
  renderBalance();
  renderOrders();
  refreshRequest.promise = (async () => {
  try {
    const catalog = await request("/api/public/commercial/offers");
    if (!isCurrent()) return;
    const classification = classifyPublicCommercialResponse(catalog);
    state.availability = classification.state;
    if (classification.state === "unavailable") {
      state.commercialReleaseId = "";
      state.offers = [];
      state.creditPacks = [];
      throw new Error("Catalog thương mại không đúng định dạng công khai hiện hành.");
    }
    const effectiveCatalog = classification.catalog;
    state.commercialReleaseId = String(effectiveCatalog.releaseId || "");
    const actor = controller?.model?.state?.activeuser || {};
    const activeScope = activeCommercialScope(actor);
    const ownerKind = activeScope && !activeScope.startsWith("personal:") ? "organization" : "account";
    state.offers = visibleOffersForOwner(effectiveCatalog.offers, ownerKind);
    state.creditPacks = effectiveCatalog.creditPacks || [];
    state.quotaWarnings = effectiveCatalog.quotaWarnings || [70, 90, 100];
    renderOffers(controller);
    sendCommercialEvent("pricing.viewed");
    if (state.availability === "off") {
      state.balance = null;
      state.orders = [];
      renderBalance();
      renderOrders();
      status("Cửa hàng đang tạm đóng trong khi chính sách thương mại được hoàn thiện.", "neutral");
      return;
    }
    let balanceFailed = false;
    try { const balance = await request("/api/billing/usage"); if (!isCurrent()) return; state.balance = balance; } catch (error) {
      if (!isCurrent()) return;
      balanceFailed = true;
      state.balance = null;
      if (error.code === "BLOCKED_DECISION") status("Usage tổ chức đang chờ quyết định quyền đọc.", "warning");
    }
    renderBalance();
    let ordersFailed = false;
    try { const orders = await request("/api/billing/orders"); if (!isCurrent()) return; state.orders = orders.orders || []; } catch { if (!isCurrent()) return; ordersFailed = true; state.orders = []; }
    renderOrders();
    if (balanceFailed || ordersFailed) {
      status("Bảng giá đã đồng bộ nhưng chưa tải đủ số dư/lịch sử order. Hãy thử làm mới lại.", "warning");
    } else {
      status("Đã đồng bộ theo release hiện hành.", "success");
    }
  } catch (error) { if (isCurrent()) { status(`${error.code}: ${error.message}`, "danger"); renderOffers(controller); } } finally { if (state.refreshRequest === refreshRequest) { state.loading = false; state.refreshRequest = null; } }
  })();
  return refreshRequest.promise;
}

export async function mountCommercialStorefront(controller) {
  state.controller = controller;
  state.contextGeneration++;
  if (state.checkoutSession) retireStaleCheckout(state.checkoutSession);
  await loadStyleOnce(STYLE_URL);
  const locationIntent = checkoutIntentFromLocation();
  if (locationIntent) controller._pendingCommercialCheckout = locationIntent;
  document.getElementById("storefront-refresh")?.addEventListener("click", async () => {
    try {
      await controller?._checkSessionNow?.();
      const accessCurrent = await verifyRefreshedAccess(controller);
      await refresh(controller);
      if (!accessCurrent) status("Phiên làm việc đang chờ cập nhật quyền lợi. Vui lòng thử làm mới lại.", "warning");
    }
    catch { status("Chưa tải được phiên làm việc và quyền lợi mới. Vui lòng thử làm mới lại.", "warning"); }
  });
  document.getElementById("storefront-feedback-dismiss")?.addEventListener("click", () => { document.getElementById("storefront-feedback").hidden = true; });
  document.getElementById("storefront-feedback-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const moment = document.getElementById("storefront-feedback-moment")?.value;
    const reason = document.getElementById("storefront-feedback-reason")?.value;
    if (!reason) return;
    const recorded = await sendCommercialFeedback(moment, reason);
    status(recorded ? "Cảm ơn bạn đã gửi phản hồi." : "Không thể ghi nhận phản hồi lúc này; giao dịch của bạn không bị ảnh hưởng.", recorded ? "success" : "warning");
    document.getElementById("storefront-feedback").hidden = true;
  });
  await refresh(controller);
  const pendingCheckout = controller?._pendingCommercialCheckout || readPendingCheckoutIntent();
  if (pendingCheckout) {
    controller._pendingCommercialCheckout = null;
    clearPendingCheckoutIntent();
    clearCheckoutIntentFromLocation();
    const button = [...document.querySelectorAll('.storefront-buy[data-operation="purchase"]')]
      .find((node) => node.dataset.sku === pendingCheckout.sku);
    if (button) {
      queueMicrotask(() => { void startCheckout(pendingCheckout.sku, controller, "purchase", button); });
    } else {
      status("Gói bạn vừa chọn không còn trong catalog đang bán. Vui lòng chọn lại gói hiện hành.", "warning");
    }
  }
}

export async function startCommercialCheckoutFromLanding({ offer, session, onReturnToOverview } = {}) {
  if (session?.valid !== true || !offer?.code) return false;
  const activeuser = { ...(session.user || {}) };
  const controller = {
    model: { state: { activeuser } },
    switchTab(tab) {
      if (tab === "dashboard") onReturnToOverview?.();
    },
    async _checkSessionNow() {
      const payload = await request("/api/auth/check-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" }),
      });
      if (payload.user && typeof payload.user === "object") Object.assign(activeuser, payload.user);
      return payload;
    },
  };
  state.controller = controller;
  state.contextGeneration++;
  if (state.checkoutSession) retireStaleCheckout(state.checkoutSession);
  state.offers = [offer];
  await loadStyleOnce(STYLE_URL);
  await startCheckout(offer.code, controller, "purchase");
  return true;
}
