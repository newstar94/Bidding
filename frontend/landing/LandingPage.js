const LOGIN_PATH = "/dang-nhap";
const WORKSPACE_PATH = "/tong-quan";

function applySessionAwareLinks(session) {
  const signedIn = session?.valid === true;
  const trialAvailable = document.documentElement.dataset.trialFullAccess === "true";
  const destination = signedIn ? WORKSPACE_PATH : LOGIN_PATH;
  const appLabel = signedIn
    ? "Mở không gian làm việc"
    : trialAvailable ? "Dùng thử miễn phí" : "Bắt đầu sử dụng";

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
      : trialAvailable ? "Dùng thử miễn phí" : "Bắt đầu";
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

function createLandingIcon(name) {
  return createLandingSvgIcon(name);
}

function appendCommercialBenefit(list, label) {
  const item = document.createElement("li");
  item.append(createLandingIcon("check"), document.createTextNode(label));
  list.append(item);
}

function createCommercialOption(offer) {
  const presented = presentCommercialOffer(offer);
  const option = document.createElement("div");
  option.className = "landing-commercial-option";

  const label = document.createElement("span");
  label.className = "landing-commercial-option-label";
  label.append(createLandingIcon("layers-3"));
  label.append(document.createTextNode(presented.variantLabel));

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

function renderCommercialOffers(offers = []) {
  const pricingGrid = document.getElementById("landing-pricing-grid");
  const visibleOffers = visibleOffersForOwner(offers);
  if (!pricingGrid || visibleOffers.length === 0) return false;

  pricingGrid.replaceChildren();
  pricingGrid.className = "landing-commercial-grid";
  pricingGrid.dataset.offerCount = String(Math.min(visibleOffers.length, 5));
  visibleOffers.forEach((offer) => {
      const presented = presentCommercialOffer(offer);
      const card = document.createElement("article");
      card.className = `landing-commercial-tier${presented.recommended ? " is-recommended" : ""}`;
      card.dataset.commercialOfferCode = presented.code;

      const header = document.createElement("div");
      header.className = "landing-commercial-tier-head";
      const title = document.createElement("span");
      const heading = document.createElement("h3");
      heading.textContent = presented.name;
      title.append(heading);
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
      options.append(createCommercialOption(offer));
      card.append(header);
      if (presented.description) card.append(description);
      card.append(options);
      pricingGrid.append(card);
    });

  pricingGrid.classList.remove("is-empty");
  pricingGrid.removeAttribute("aria-busy");
  const notice = document.querySelector("[data-landing-pricing-notice]");
  if (notice) notice.hidden = true;
  renderDecisionSupport(visibleOffers);
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
