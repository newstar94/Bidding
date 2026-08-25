const LOGIN_PATH = "/dang-nhap";
const WORKSPACE_PATH = "/tong-quan";

function applySessionAwareLinks(session) {
  const signedIn = session?.valid === true;
  const destination = signedIn ? WORKSPACE_PATH : LOGIN_PATH;
  const appLabel = signedIn ? "Mở không gian làm việc" : "Bắt đầu sử dụng";

  document.querySelectorAll("[data-landing-app-link]").forEach((link) => {
    link.href = destination;
  });
  document.querySelectorAll("[data-landing-app-label]").forEach((label) => {
    label.textContent = appLabel;
  });
  const headerLabel = document.querySelector(".landing-header-cta [data-landing-app-label]");
  if (headerLabel) headerLabel.textContent = signedIn ? "Mở ứng dụng" : "Bắt đầu";
  document.querySelectorAll("[data-landing-auth-link]").forEach((link) => {
    link.href = destination;
  });
  document.querySelectorAll("[data-landing-auth-label]").forEach((label) => {
    label.textContent = signedIn ? "Về tổng quan" : "Đăng nhập";
  });
}

function installSectionReveal() {
  const elements = [...document.querySelectorAll("[data-landing-reveal]")];
  if (!elements.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.12 });
  elements.forEach((element) => observer.observe(element));
}

function installHeaderState() {
  const header = document.querySelector("[data-landing-header]");
  if (!header) return;
  const update = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function formatAnnualPrice(value) {
  const amount = Number(value || 0);
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)}đ`;
}

function createLandingIcon(name) {
  const icon = document.createElement("i");
  icon.dataset.lucide = name;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function appendCommercialBenefit(list, label) {
  const item = document.createElement("li");
  item.append(createLandingIcon("check"), document.createTextNode(label));
  list.append(item);
}

function createCommercialOption(offer) {
  const connected = offer?.variant === "connected";
  const option = document.createElement("div");
  option.className = `landing-commercial-option${connected ? " is-connected" : ""}`;

  const label = document.createElement("span");
  label.className = "landing-commercial-option-label";
  label.append(createLandingIcon(connected ? "radio-tower" : "layers-3"));
  label.append(document.createTextNode(connected ? "Kết nối" : "Nội bộ"));

  const price = document.createElement("div");
  price.className = "landing-commercial-price";
  const amount = document.createElement("strong");
  amount.textContent = formatAnnualPrice(offer?.price?.total);
  const period = document.createElement("small");
  period.textContent = "/ năm";
  price.append(amount, period);

  const benefits = document.createElement("ul");
  const memberQuota = Math.max(1, Number(offer?.memberQuota || 1));
  appendCommercialBenefit(benefits, `${memberQuota.toLocaleString("vi-VN")} thành viên`);
  const procurementQuota = Math.max(0, Number(offer?.includedProcurementQuota || 0));
  appendCommercialBenefit(
    benefits,
    procurementQuota > 0
      ? `${procurementQuota.toLocaleString("vi-VN")} lượt tra cứu kèm theo`
      : "Có thể mua thêm lượt tra cứu"
  );
  appendCommercialBenefit(
    benefits,
    offer?.violationCheckEnabled === true
      ? "Có kiểm tra vi phạm nhà thầu"
      : "Không gian quản lý dữ liệu nội bộ"
  );

  const action = document.createElement("a");
  action.className = `landing-button ${connected ? "landing-button-primary" : "landing-button-secondary"}`;
  action.href = document.querySelector("[data-landing-app-link]")?.href || LOGIN_PATH;
  action.textContent = "Bắt đầu với gói này";
  action.append(createLandingIcon("arrow-right"));

  option.append(label, price, benefits, action);
  return option;
}

function renderCommercialOffers(offers = []) {
  const pricingGrid = document.getElementById("landing-pricing-grid");
  if (!pricingGrid || !Array.isArray(offers) || offers.length === 0) return false;

  const tierOrder = ["personal", "silver", "gold", "diamond"];
  const groups = new Map();
  offers.forEach((offer) => {
    const tier = String(offer?.tier || "");
    if (!tier) return;
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(offer);
  });
  if (!groups.size) return false;

  pricingGrid.replaceChildren();
  pricingGrid.className = "landing-commercial-grid";
  [...groups.entries()]
    .sort(([left], [right]) => {
      const leftIndex = tierOrder.indexOf(left);
      const rightIndex = tierOrder.indexOf(right);
      return (leftIndex < 0 ? tierOrder.length : leftIndex) - (rightIndex < 0 ? tierOrder.length : rightIndex);
    })
    .forEach(([tier, tierOffers]) => {
      const card = document.createElement("article");
      const recommended = tierOffers.some((offer) => offer?.display?.recommended === true);
      card.className = `landing-commercial-tier${recommended ? " is-recommended" : ""}`;
      card.dataset.landingReveal = "";

      const header = document.createElement("div");
      header.className = "landing-commercial-tier-head";
      const title = document.createElement("span");
      const eyebrow = document.createElement("small");
      eyebrow.textContent = tier === "personal" ? "DÀNH CHO CÁ NHÂN" : "DÀNH CHO TỔ CHỨC";
      const heading = document.createElement("h3");
      heading.textContent = String(tierOffers[0]?.display?.name || tier);
      title.append(eyebrow, heading);
      header.append(title);
      if (recommended) {
        const badge = document.createElement("b");
        badge.textContent = "CÓ GÓI KẾT NỐI";
        header.append(badge);
      }

      const options = document.createElement("div");
      options.className = "landing-commercial-options";
      tierOffers
        .sort((left, right) => (left?.variant === "internal" ? -1 : 1) - (right?.variant === "internal" ? -1 : 1))
        .forEach((offer) => options.append(createCommercialOption(offer)));
      card.append(header, options);
      pricingGrid.append(card);
    });

  window.lucide?.createIcons({ root: pricingGrid });
  installSectionReveal();
  return true;
}

function applyPublicPackages(packages = []) {
  if (!Array.isArray(packages) || packages.length === 0) return;
  const activeIds = new Set(packages.map((item) => String(item?.id || "")));
  document.querySelectorAll("[data-package-id]").forEach((card) => {
    card.hidden = !activeIds.has(card.dataset.packageId || "");
  });
  packages.forEach((pkg) => {
    const card = document.querySelector(`[data-package-id="${CSS.escape(String(pkg.id || ""))}"]`);
    if (!card) return;
    const name = card.querySelector("h3");
    const description = card.querySelector(".landing-price-description");
    const price = card.querySelector(".landing-price strong");
    const quota = card.querySelector("[data-package-quota]") || card.querySelector(".landing-price-quota span");
    if (name) name.textContent = String(pkg.name || "");
    if (description) description.textContent = String(pkg.description || "");
    if (price) price.textContent = formatAnnualPrice(pkg.price);
    if (quota) {
      const quotaValue = Number(pkg.quota || 0);
      quota.textContent = quotaValue >= 999 ? "Không giới hạn nhân sự" : `Tối đa ${quotaValue} nhân sự`;
    }
  });
}

async function loadPublicPackages() {
  try {
    // Commercial offers are the live server-resolved source.  The legacy
    // endpoint remains a compatibility projection while rollout is off.
    let response = await fetch("/api/public/commercial/offers", {
      headers: { Accept: "application/json" }
    });
    if (response.ok) {
      const catalog = await response.json();
      const offers = Array.isArray(catalog?.offers) ? catalog.offers : [];
      if (renderCommercialOffers(offers)) return;
    }
    response = await fetch("/api/public/packages", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      document.querySelectorAll("[data-package-id]").forEach((card) => {
        card.hidden = true;
      });
      const notice = document.querySelector("[data-landing-pricing-notice]");
      if (notice) {
        notice.hidden = false;
        notice.textContent = "Bảng giá đang được kiểm tra trước khi mở bán.";
      }
      return;
    }
    const payload = await response.json();
    applyPublicPackages(payload?.packages);
  } catch (_) {
    const notice = document.querySelector("[data-landing-pricing-notice]");
    if (notice) {
      notice.hidden = false;
      notice.textContent = "Không thể cập nhật bảng giá lúc này. Vui lòng thử lại sau.";
    }
  }
}

export function isLandingPath(pathname = window.location.pathname) {
  return pathname === "/";
}

export async function bootstrapLandingPage(session = { valid: false }) {
  if (!APP_DEBUG) await loadStyleOnce(LANDING_STYLESHEET_URL);
  document.body.classList.remove("bf-init-loading");
  document.body.classList.add("landing-ready");
  document.body.removeAttribute("hidden");
  document.querySelectorAll("[data-landing-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
  applySessionAwareLinks(session);
  installHeaderState();
  installSectionReveal();
  void loadPublicPackages();
}
import { APP_DEBUG } from "../app/appConfig.js";
import { loadStyleOnce } from "../shared/externalAssets.js";

const LANDING_STYLESHEET_URL = new URL("../../views/css/landing.css", import.meta.url).pathname;
