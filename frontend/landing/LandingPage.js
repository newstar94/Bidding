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
    const quota = card.querySelector(".landing-price-quota span");
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
    const response = await fetch("/api/public/packages", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return;
    const payload = await response.json();
    applyPublicPackages(payload?.packages);
  } catch (_) {
  }
}

export function isLandingPath(pathname = window.location.pathname) {
  return pathname === "/";
}

export function bootstrapLandingPage(session = { valid: false }) {
  document.body.classList.remove("bf-init-loading");
  document.body.classList.add("landing-ready");
  document.querySelectorAll("[data-landing-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
  applySessionAwareLinks(session);
  installHeaderState();
  installSectionReveal();
  void loadPublicPackages();
}
