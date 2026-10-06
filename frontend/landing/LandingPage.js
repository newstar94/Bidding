const LOGIN_PATH = "/dang-nhap";
const WORKSPACE_PATH = "/tong-quan";
const LANDING_HISTORY_SCROLL_KEY = "bfLandingScrollY";
let landingHistoryCaptureInstalled = false;
let landingMotionCleanup = null;
const pricingState = {
  offers: [],
  group: "basic",
  period: "yearly",
};

const PRICING_GROUPS = Object.freeze({
  basic: { label: "Cơ bản", variant: "internal" },
  advanced: { label: "Nâng cao", variant: "connected" },
});

function pricingGroupForOffer(offer) {
  if (offer?.variant === PRICING_GROUPS.basic.variant) return "basic";
  if (offer?.variant === PRICING_GROUPS.advanced.variant) return "advanced";
  return "unclassified";
}

function pricingPeriodForOffer(offer) {
  return typeof offer?.price?.period === "string" ? offer.price.period : "";
}

function pricingGroupOffers(offers, group, period) {
  const periodOffers = offers.filter((offer) => pricingPeriodForOffer(offer) === period);
  const knownOffers = periodOffers.filter((offer) => pricingGroupForOffer(offer) !== "unclassified");
  if (knownOffers.length === 0) return periodOffers;
  return periodOffers.filter((offer) => pricingGroupForOffer(offer) === group);
}

function pricingGroupLabel(group, offer) {
  if (group === "basic") return "Cơ bản";
  if (group === "advanced") return "Nâng cao";
  return offer?.display?.variantLabel || "Gói dịch vụ";
}

function pricingTierLabel(offer, presented) {
  const tierLabels = { personal: "Cá nhân", silver: "Bạc", gold: "Vàng", diamond: "Kim cương" };
  return tierLabels[offer?.tier] || presented.name;
}

function applySessionAwareLinks(session) {
  const signedIn = session?.valid === true;
  const trialAvailable = document.documentElement.dataset.trialFullAccess === "true";
  const destination = signedIn ? WORKSPACE_PATH : LOGIN_PATH;
  const appLabel = signedIn
    ? "Mở không gian làm việc"
    : trialAvailable ? "Bắt đầu sử dụng" : "Bắt đầu sử dụng";

  document.querySelectorAll("[data-landing-app-link]").forEach((link) => {
    link.href = destination;
  });
  document.querySelectorAll("[data-landing-app-label]").forEach((label) => {
    label.textContent = appLabel;
  });
  const headerLabel = document.querySelector(".landing-header-cta [data-landing-app-label]");
  if (headerLabel) {
    headerLabel.textContent = signedIn
      ? "Mở ứng dụng"
      : trialAvailable ? "Bắt đầu sử dụng" : "Bắt đầu sử dụng";
  }
  document.querySelectorAll("[data-landing-auth-link]").forEach((link) => {
    link.href = destination;
  });
  document.querySelectorAll("[data-landing-auth-label]").forEach((label) => {
    label.textContent = signedIn ? "Về tổng quan" : "Đăng nhập";
  });
}

function installHeaderState() {
  const header = document.querySelector("[data-landing-header]");
  if (!header || header.dataset.scrollStateInstalled === "true") return;
  header.dataset.scrollStateInstalled = "true";
  let frame = 0;
  const update = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
  const scheduleUpdate = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
}

function installMobileNavigation() {
  const header = document.querySelector("[data-landing-header]");
  const toggle = document.querySelector("[data-landing-menu-toggle]");
  const navigation = document.querySelector("[data-landing-nav]");
  if (!header || !toggle || !navigation || toggle.dataset.menuInstalled === "true") return;
  toggle.dataset.menuInstalled = "true";

  const close = ({ returnFocus = false } = {}) => {
    header.classList.remove("is-menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Mở menu điều hướng");
    if (returnFocus) toggle.focus();
  };
  const open = () => {
    header.classList.add("is-menu-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Đóng menu điều hướng");
    navigation.querySelector("a")?.focus();
  };
  toggle.addEventListener("click", () => {
    toggle.getAttribute("aria-expanded") === "true" ? close() : open();
  });
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      close({ returnFocus: true });
    }
  });
  window.matchMedia("(min-width: 901px)").addEventListener("change", (event) => {
    if (event.matches) close();
  });
}

function installLandingMotion() {
  if (landingMotionCleanup) return;
  const root = document.getElementById("landing-page");
  if (!root) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const revealNodes = [...root.querySelectorAll("[data-landing-reveal]")];
  const processItems = [...root.querySelectorAll(".landing-process-list > li")];
  if (reduced.matches || !("IntersectionObserver" in window)) {
    revealNodes.forEach((node) => node.classList.add("is-visible"));
    landingMotionCleanup = () => {};
    return;
  }
  revealNodes.forEach((node, index) => node.style.setProperty("--landing-reveal-delay", `${Math.min(index * 45, 260)}ms`));
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add("is-visible"); });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 });
  revealNodes.forEach((node) => revealObserver.observe(node));
  const processObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.target.classList.toggle("is-active", entry.isIntersecting));
  }, { rootMargin: "-38% 0px -48% 0px", threshold: 0 });
  processItems.forEach((node) => processObserver.observe(node));
  landingMotionCleanup = () => { revealObserver.disconnect(); processObserver.disconnect(); };
}

function createLandingIcon(name) {
  return createLandingSvgIcon(name);
}

function appendCommercialBenefit(list, label) {
  const item = document.createElement("li");
  item.append(createLandingIcon("check"), document.createTextNode(label));
  list.append(item);
}

function createCommercialOption(offer, group) {
  const presented = presentCommercialOffer(offer);
  const option = document.createElement("div");
  option.className = `landing-commercial-option${group === "advanced" ? " is-connected" : ""}`;
  option.dataset.commercialVariant = offer?.variant || "";

  const label = document.createElement("span");
  label.className = "landing-commercial-option-label";
  label.append(createLandingIcon("layers-3"));
  label.append(document.createTextNode(pricingGroupLabel(group, offer)));

  const price = document.createElement("div");
  price.className = "landing-commercial-price";
  const amount = document.createElement("strong");
  amount.textContent = presented.priceLabel;
  const period = document.createElement("small");
  period.textContent = presented.periodLabel;
  price.append(amount, period);

  const benefits = document.createElement("ul");
  presented.benefits.forEach((benefit) => appendCommercialBenefit(benefits, benefit));

  const action = document.createElement("a");
  action.className = `landing-button ${presented.recommended ? "landing-button-primary" : "landing-button-secondary"}`;
  action.href = document.querySelector("[data-landing-app-link]")?.href || LOGIN_PATH;
  action.textContent = "Bắt đầu với gói này";
  action.append(createLandingIcon("arrow-right"));

  option.append(label, price, benefits, action);
  return option;
}

function renderPricingControls(offers = []) {
  const periodButtons = document.querySelectorAll("[data-pricing-period]");
  const availablePeriods = new Set(offers.map(pricingPeriodForOffer).filter(Boolean));
  const preferredPeriod = availablePeriods.has(pricingState.period)
    ? pricingState.period
    : availablePeriods.has("yearly") ? "yearly" : [...availablePeriods][0] || "yearly";
  pricingState.period = preferredPeriod;
  periodButtons.forEach((button) => {
    const period = button.dataset.pricingPeriod;
    const available = availablePeriods.has(period);
    button.disabled = !available;
    button.setAttribute("aria-disabled", String(!available));
    button.setAttribute("aria-selected", String(period === pricingState.period));
    button.classList.toggle("is-active", period === pricingState.period);
  });
  document.querySelectorAll("[data-pricing-group]").forEach((button) => {
    const group = button.dataset.pricingGroup;
    const active = group === pricingState.group;
    button.setAttribute("aria-selected", String(active));
    button.classList.toggle("is-active", active);
  });
  const periodNote = document.querySelector("[data-landing-period-note]");
  if (periodNote) {
    periodNote.hidden = availablePeriods.has("monthly");
    periodNote.textContent = availablePeriods.has("monthly")
      ? ""
      : "Gói hàng tháng sẽ hiển thị khi được công bố trong catalog thương mại hiện hành.";
  }
}

function installPricingControls() {
  const controls = document.querySelector("[data-landing-pricing-controls]");
  if (!controls || controls.dataset.installed === "true") return;
  controls.dataset.installed = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-pricing-group], button[data-pricing-period]");
    if (!button || button.disabled) return;
    if (button.dataset.pricingGroup) pricingState.group = button.dataset.pricingGroup;
    if (button.dataset.pricingPeriod) pricingState.period = button.dataset.pricingPeriod;
    renderCommercialOffers(pricingState.offers);
  });
}

function renderCommercialOffers(offers = []) {
  const pricingGrid = document.getElementById("landing-pricing-grid");
  const visibleOffers = visibleOffersForOwner(offers);
  pricingState.offers = visibleOffers;
  renderPricingControls(visibleOffers);
  const selectedOffers = pricingGroupOffers(visibleOffers, pricingState.group, pricingState.period);
  if (!pricingGrid || selectedOffers.length === 0) return false;

  pricingGrid.replaceChildren();
  pricingGrid.className = "landing-commercial-grid landing-commercial-grid-by-tier";
  pricingGrid.dataset.offerCount = String(Math.min(selectedOffers.length, 5));
  selectedOffers.forEach((offer) => {
      const presented = presentCommercialOffer(offer);
      const card = document.createElement("article");
      card.className = `landing-commercial-tier${presented.recommended ? " is-recommended" : ""}`;
      card.dataset.commercialOfferCode = presented.code;
      card.dataset.commercialGroup = pricingGroupForOffer(offer);

      const header = document.createElement("div");
      header.className = "landing-commercial-tier-head";
      const title = document.createElement("span");
      const audience = document.createElement("small");
      audience.textContent = offer?.ownerKind === "organization" ? "Tổ chức" : "Cá nhân";
      const heading = document.createElement("h3");
      heading.textContent = pricingTierLabel(offer, presented);
      title.append(audience, heading);
      header.append(title);
      if (presented.badge) {
        const badge = document.createElement("b");
        badge.textContent = presented.badge;
        header.append(badge);
      }

      const description = document.createElement("p");
      description.className = "landing-price-description";
      description.textContent = presented.description;

      const options = document.createElement("div");
      options.className = "landing-commercial-options";
      options.append(createCommercialOption(offer, pricingGroupForOffer(offer)));
      card.append(header);
      if (presented.description) card.append(description);
      card.append(options);
      pricingGrid.append(card);
    });

  pricingGrid.classList.remove("is-empty");
  pricingGrid.removeAttribute("aria-busy");
  const notice = document.querySelector("[data-landing-pricing-notice]");
  if (notice) notice.hidden = true;
  renderDecisionSupport(selectedOffers);
  return true;
}

function renderDecisionSupport(offers = []) {
  const support = document.querySelector("[data-landing-decision-support]");
  const list = document.querySelector("[data-landing-decision-list]");
  if (!support || !list) return;
  list.replaceChildren();
  offers.forEach((offer) => {
    const presented = presentCommercialOffer(offer);
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const description = document.createElement("span");
    name.textContent = presented.name;
    description.textContent = presented.description
      || presented.benefits.slice(0, 2).join(" · ")
      || "Quyền lợi theo bản phát hành thương mại hiện hành.";
    item.append(name, description);
    list.append(item);
  });
  support.hidden = offers.length === 0;
}

function renderPricingUnavailable(message) {
  const pricingGrid = document.getElementById("landing-pricing-grid");
  if (pricingGrid) {
    pricingGrid.replaceChildren();
    pricingGrid.className = "landing-pricing-grid is-empty";
    delete pricingGrid.dataset.offerCount;
    pricingGrid.removeAttribute("aria-busy");
  }
  renderDecisionSupport([]);
  const notice = document.querySelector("[data-landing-pricing-notice]");
  if (notice) {
    notice.hidden = false;
    notice.textContent = message;
  }
}

async function loadPublicPackages() {
  try {
    const response = await fetch("/api/public/commercial/offers", {
      headers: { Accept: "application/json" }
    });
    if (response.ok) {
      const classification = classifyPublicCommercialResponse(await response.json());
      if (classification.state === "unavailable") {
        renderPricingUnavailable("Bảng giá đang được kiểm tra trước khi mở bán.");
        return;
      }
      if (classification.state === "off") {
        renderPricingUnavailable("Các gói trả phí hiện chưa được mở bán.");
        return;
      }
      if (classification.state === "empty" || !renderCommercialOffers(classification.catalog.offers)) {
        renderPricingUnavailable("Chưa có gói dịch vụ đang được công bố.");
      }
      return;
    }
    renderPricingUnavailable("Bảng giá đang được kiểm tra trước khi mở bán.");
  } catch (_) {
    renderPricingUnavailable("Không thể cập nhật bảng giá lúc này. Vui lòng thử lại sau.");
  }
}

export function isLandingPath(pathname = window.location.pathname) {
  return pathname === "/";
}

function landingNavigationType() {
  return globalThis.performance?.getEntriesByType?.("navigation")?.[0]?.type || "";
}

function materializeLandingLayout() {
  document.querySelectorAll(
    ".landing-page main > section:not(.landing-hero), .landing-footer",
  ).forEach((node) => { node.style.contentVisibility = "visible"; });
}

function canonicalLandingScrollY() {
  const anchor = [...document.querySelectorAll(
    ".landing-page main > section, .landing-footer",
  )].find((node) => node.getBoundingClientRect().bottom > 0);
  if (!anchor) return window.scrollY;
  const priorTop = anchor.getBoundingClientRect().top;
  materializeLandingLayout();
  const canonicalTop = anchor.getBoundingClientRect().top;
  // Account for both prefix height changes and native scroll anchoring or
  // clamping. Preserve the visible section's position, not an estimated Y.
  return Math.max(0, window.scrollY + canonicalTop - priorTop);
}

export function installLandingHistoryScrollCapture() {
  if (landingHistoryCaptureInstalled) return;
  landingHistoryCaptureInstalled = true;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.('a[href^="#"]');
    if (!anchor || anchor.hash.length < 2) return;
    // Native anchor navigation must calculate its destination from real
    // predecessor heights, before the browser performs the default scroll.
    materializeLandingLayout();
    document.getElementById("landing-main")?.getBoundingClientRect();
  }, { capture: true });
  window.addEventListener("pagehide", () => {
    const priorState = history.state && typeof history.state === "object"
      ? history.state
      : {};
    history.replaceState({
      ...priorState,
      [LANDING_HISTORY_SCROLL_KEY]: canonicalLandingScrollY(),
    }, "");
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    requestAnimationFrame(() => {
      restoreLandingFragment({ navigationType: "back_forward" });
    });
  });
}

export function restoreLandingFragment({ navigationType = landingNavigationType() } = {}) {
  const savedHistoryPosition = Number(history.state?.[LANDING_HISTORY_SCROLL_KEY]);
  if (navigationType === "back_forward" && Number.isFinite(savedHistoryPosition)) {
    if (savedHistoryPosition > 0) {
      // A history coordinate was recorded against real section heights. Do
      // not restore it against estimates for previously skipped sections.
      materializeLandingLayout();
    }
    window.scrollTo({ top: savedHistoryPosition, behavior: "instant" });
    return true;
  }
  if (navigationType !== "reload") return false;
  const encodedId = String(window.location.hash || "").slice(1);
  if (!encodedId) return false;
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return false;
  }
  const target = document.getElementById(id);
  if (!target) return false;
  materializeLandingLayout();
  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  target.scrollIntoView({ block: "start", inline: "nearest" });
  root.style.scrollBehavior = previousBehavior;
  return true;
}

export async function bootstrapLandingPage(session = { valid: false }) {
  const bundledShell = document.querySelector(
    'link[data-bf-shell-styles="landing"]',
  );
  if (!APP_DEBUG && !bundledShell) await loadStyleOnce(LANDING_STYLESHEET_URL);
  document.body.classList.remove("bf-init-loading");
  document.body.classList.add("landing-ready");
  document.body.removeAttribute("hidden");
  document.querySelectorAll("[data-landing-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
  renderLandingIcons(document.getElementById("landing-page"));
  applySessionAwareLinks(session);
  installHeaderState();
  installMobileNavigation();
  installPricingControls();
  installLandingMotion();
  installLandingHistoryScrollCapture();
  // WebKit resolves the fragment while the landing shell is still hidden and
  // can therefore retain the URL at the top of the page after a reload. Once
  // the shell is visible and laid out, restore the fragment exactly once.
  restoreLandingFragment();
  if (document.documentElement.dataset.trialFullAccess !== "true") {
    void loadPublicPackages();
  }
}
import { APP_DEBUG } from "../app/appConfig.js";
import {
  classifyPublicCommercialResponse,
  presentCommercialOffer,
  visibleOffersForOwner,
} from "../commercial-policy/PublicCommercialCatalog.js";
import { loadStyleOnce } from "../shared/externalAssets.js";
import { createLandingSvgIcon, renderLandingIcons } from "./landingIcons.js";

const LANDING_STYLESHEET_URL = new URL("../../views/css/landing.css", import.meta.url).pathname;
