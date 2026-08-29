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

function appendPublicPackageFeature(list, label) {
  const item = document.createElement("li");
  item.append(createLandingIcon("check"), document.createTextNode(label));
  list.append(item);
}

function createPublicPackageCard(pkg, index, packageCount) {
  const featured = packageCount > 1 && index === Math.floor(packageCount / 2);
  const premium = packageCount > 2 && index === packageCount - 1;
  const card = document.createElement("article");
  card.className = `landing-price-card${featured ? " is-featured" : ""}${premium ? " is-premium" : ""}`;
  card.dataset.packageId = String(pkg?.id || "");
  card.dataset.landingReveal = "";

  if (featured) {
    const recommendation = document.createElement("div");
    recommendation.className = "landing-price-popular";
    recommendation.append(createLandingIcon("scale"), document.createTextNode("LỰA CHỌN CÂN BẰNG"));
    card.append(recommendation);
  }

  const topLine = document.createElement("div");
  topLine.className = "landing-price-topline";
  const tier = document.createElement("span");
  tier.className = "landing-price-tier";
  const tierLabel = document.createElement("small");
  tierLabel.textContent = `GÓI ${String(index + 1).padStart(2, "0")}`;
  const tierCaption = document.createElement("b");
  tierCaption.textContent = featured ? "Cân bằng" : premium ? "Quy mô lớn" : "Khởi đầu";
  tier.append(tierLabel, tierCaption);
  const emblem = document.createElement("span");
  emblem.className = "landing-price-emblem";
  emblem.setAttribute("aria-hidden", "true");
  emblem.append(createLandingIcon(featured ? "sparkles" : premium ? "gem" : "layers-2"));
  topLine.append(tier, emblem);

  const title = document.createElement("div");
  title.className = "landing-price-title";
  const heading = document.createElement("h3");
  heading.textContent = String(pkg?.name || pkg?.id || "Gói dịch vụ");
  title.append(heading);

  const description = document.createElement("p");
  description.className = "landing-price-description";
  description.textContent = String(pkg?.description || "Năng lực vận hành được cấu hình theo catalog hiện hành.");

  const price = document.createElement("div");
  price.className = "landing-price";
  const amount = document.createElement("strong");
  amount.textContent = formatAnnualPrice(pkg?.price);
  const period = document.createElement("span");
  period.textContent = "/ năm";
  price.append(amount, period);

  const quota = document.createElement("div");
  quota.className = "landing-price-quota";
  quota.append(createLandingIcon("users-round"));
  const quotaCopy = document.createElement("span");
  const quotaLabel = document.createElement("small");
  quotaLabel.textContent = "Hạn mức nhân sự";
  const quotaValue = document.createElement("span");
  const memberQuota = Math.max(0, Number(pkg?.quota || 0));
  quotaValue.textContent = memberQuota >= 999 ? "Không giới hạn nhân sự" : `Tối đa ${memberQuota} nhân sự`;
  quotaCopy.append(quotaLabel, quotaValue);
  quota.append(quotaCopy);

  const featuresLabel = document.createElement("p");
  featuresLabel.className = "landing-price-features-label";
  featuresLabel.textContent = "Năng lực được cấu hình";
  const features = document.createElement("ul");
  appendPublicPackageFeature(features, "Quản lý kế hoạch, gói thầu và hợp đồng");
  appendPublicPackageFeature(features, "Đồng bộ dữ liệu có kiểm soát");
  const capabilities = pkg?.capabilities || {};
  if (capabilities["document.export.word"] === true) appendPublicPackageFeature(features, "Xuất biểu mẫu Word");
  if (capabilities["document.export.excel"] === true) appendPublicPackageFeature(features, "Xuất dữ liệu Excel");
  if (capabilities["document.export.award_result_excel"] === true) appendPublicPackageFeature(features, "Xuất kết quả lựa chọn nhà thầu");

  const action = document.createElement("a");
  action.className = `landing-button ${featured ? "landing-button-primary" : "landing-button-secondary"} landing-price-action`;
  action.href = document.querySelector("[data-landing-app-link]")?.href || LOGIN_PATH;
  action.append(document.createTextNode(`Bắt đầu với ${heading.textContent}`), createLandingIcon("arrow-right"));

  card.append(topLine, title, description, price, quota, featuresLabel, features, action);
  return card;
}

function renderPublicPackages(packages = []) {
  const pricingGrid = document.getElementById("landing-pricing-grid");
  if (!pricingGrid || !Array.isArray(packages) || packages.length === 0) return false;
  pricingGrid.replaceChildren();
  pricingGrid.className = "landing-pricing-grid";
  packages.forEach((pkg, index) => pricingGrid.append(createPublicPackageCard(pkg, index, packages.length)));
  pricingGrid.removeAttribute("aria-busy");
  window.lucide?.createIcons({ root: pricingGrid });
  installSectionReveal();
  return true;
}

function renderPricingUnavailable(message) {
  const pricingGrid = document.getElementById("landing-pricing-grid");
  if (pricingGrid) {
    pricingGrid.replaceChildren();
    pricingGrid.className = "landing-pricing-grid";
    pricingGrid.removeAttribute("aria-busy");
  }
  const notice = document.querySelector("[data-landing-pricing-notice]");
  if (notice) {
    notice.hidden = false;
    notice.textContent = message;
  }
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
      renderPricingUnavailable("Bảng giá đang được kiểm tra trước khi mở bán.");
      return;
    }
    const payload = await response.json();
    if (!renderPublicPackages(payload?.packages)) {
      renderPricingUnavailable("Chưa có gói dịch vụ đang được công bố.");
    }
  } catch (_) {
    renderPricingUnavailable("Không thể cập nhật bảng giá lúc này. Vui lòng thử lại sau.");
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
  if (document.documentElement.dataset.trialFullAccess !== "true") {
    void loadPublicPackages();
  }
}
import { APP_DEBUG } from "../app/appConfig.js";
import { loadStyleOnce } from "../shared/externalAssets.js";

const LANDING_STYLESHEET_URL = new URL("../../views/css/landing.css", import.meta.url).pathname;
