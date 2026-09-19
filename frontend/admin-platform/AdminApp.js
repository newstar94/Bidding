import { getAdminRoute, navigateAdmin } from "./AdminRouter.js";
import { renderAdminOverview } from "./AdminOverview.js";
import { adminStateMarkup } from "./AdminStateView.js";
import { postAdminJson } from "./AdminApi.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { adminIconMarkup } from "./AdminIcons.js";
import { adminNavigationMarkup } from "./AdminNavigation.js";
import { adminSearchMarkup, bindAdminSearch } from "./AdminSearch.js";

window.performance?.mark?.("bf:app-module-start");

let startupReadyMarked = false;
function markStartupReady() {
  if (startupReadyMarked) return;
  startupReadyMarked = true;
  window.performance?.mark?.("bf:loader:hidden");
}

function readSession() {
  try { return JSON.parse(document.getElementById("bf-admin-session")?.textContent || "{}"); }
  catch { return { valid: false }; }
}
function escapeText(value) {
  const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML;
}
function shellMarkup(session) {
  const name = escapeText(session.user?.name || session.user?.username || "Quản trị viên");
  const links = adminNavigationMarkup();
  return `<aside class="navbar navbar-vertical navbar-expand-lg" data-bs-theme="dark" aria-label="Điều hướng quản trị"><div class="container-fluid"><h1 class="navbar-brand navbar-brand-autodark">BiddingFlow <span>Admin</span></h1><div class="navbar-nav flex-row d-lg-none ms-auto"><button class="navbar-toggler" type="button" data-admin-nav-toggle aria-controls="admin-navbar" aria-expanded="false" aria-label="Mở điều hướng"><span class="navbar-toggler-icon"></span></button></div><div class="collapse navbar-collapse" id="admin-navbar"><ul class="navbar-nav pt-lg-3">${links}</ul></div></div></aside><div class="page-wrapper"><header class="navbar navbar-expand-md d-print-none"><div class="container-xl bf-admin-header">${adminSearchMarkup()}<div class="navbar-nav flex-row order-md-last"><span class="nav-link">${adminIconMarkup("account")}<span>${name}</span></span><a class="nav-link" href="/tong-quan" data-admin-workspace-link>${adminIconMarkup("workspace")}<span>Không gian làm việc</span></a><span class="nav-link text-danger" id="admin-workspace-status" aria-live="polite"></span></div></div></header><main id="admin-main" class="page-body" tabindex="-1"><div class="container-xl"><div id="admin-view"></div></div></main></div>`;
}
function bindNavigationToggle() {
  const toggle = document.querySelector("[data-admin-nav-toggle]");
  const navigation = document.getElementById("admin-navbar");
  if (!toggle || !navigation) return;
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    navigation.classList.toggle("show", !expanded);
  });
}
async function selectWorkspaceRole(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const link = event.currentTarget;
  link.setAttribute("aria-busy", "true");
  try {
    const result = await postAdminJson("/api/auth/active-role", {
      body: { active_role: "manager" },
    });
    if (result?.activeRole !== "manager") throw new Error("Máy chủ không xác nhận chế độ Quản lý.");
    const value = JSON.stringify("manager");
    sessionStorage.setItem("bf_active_role", value);
    localStorage.setItem("bf_active_role", value);
    window.location.assign("/tong-quan");
  } catch (error) {
    link.removeAttribute("aria-busy");
    const status = document.getElementById("admin-workspace-status");
    if (status) status.textContent = error?.message || "Không thể mở không gian làm việc.";
  }
}
let routeController = null;
let sessionExpiryHandled = false;
function handleSessionExpiry() {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;
  routeController?.abort();
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/dang-nhap?next=${encodeURIComponent(next)}`);
}
function loadAdminModule(loader, exportName, content, options = {}) {
  const controller = routeController;
  const moduleOptions = { ...options, signal: controller?.signal || options.signal };
  void loader().then((module) => {
    if (!controller?.signal.aborted) module[exportName](content, moduleOptions);
  }).catch((error) => {
    if (!controller?.signal.aborted) content.innerHTML = trustedHTML(adminStateMarkup("error", { message: error?.message || "Không thể tải trang quản trị." }));
  });
}
function renderRoute() {
  routeController?.abort(); routeController = new AbortController();
  const route = getAdminRoute(window.location.pathname); const view = document.getElementById("admin-view");
  document.querySelectorAll("[data-admin-link]").forEach((link) => { const active = link.dataset.adminLink === route?.path; link.classList.toggle("active", active); if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  if (!route) { view.innerHTML = trustedHTML(`<div class="empty"><p class="empty-title">Không tìm thấy trang quản trị</p><div class="empty-action"><a class="btn btn-primary" href="/admin" data-admin-link="/admin">Về tổng quan</a></div></div>`); document.title = "Không tìm thấy | BiddingFlow Admin"; return; }
  document.title = `${route.title} | BiddingFlow Admin`;
  view.innerHTML = trustedHTML(`<div class="page-header"><div class="row align-items-center"><div class="col"><div class="page-pretitle">Quản trị nền tảng</div><h2 class="page-title">${escapeText(route.title)}</h2></div></div></div><div id="admin-route-content" class="mt-3"></div>`);
  const content = document.getElementById("admin-route-content");
  if (route.path === "/admin") void renderAdminOverview(content, { signal: routeController.signal });
  else if (route.path === "/admin/analytics") loadAdminModule(() => import("./AdminAnalytics.js"), "renderAdminAnalytics", content, { signal: routeController.signal });
  else if (route.path === "/admin/users") loadAdminModule(() => import("./AdminDirectories.js"), "renderAdminUsers", content, { signal: routeController.signal });
  else if (route.path === "/admin/organizations") loadAdminModule(() => import("./AdminDirectories.js"), "renderAdminOrganizations", content, { signal: routeController.signal });
  else if (route.path === "/admin/plans") {
    void import("./AdminPlans.js").then(({ renderAdminPlans }) => renderAdminPlans(content, { signal: routeController.signal })).catch((error) => {
      if (!routeController.signal.aborted) content.innerHTML = trustedHTML(adminStateMarkup("error", { message: error?.message || "Không thể tải trang gói dịch vụ." }));
    });
  }
  else if (route.path === "/admin/subscriptions") loadAdminModule(() => import("./AdminBilling.js"), "renderAdminSubscriptions", content, { signal: routeController.signal });
  else if (route.path === "/admin/payments") loadAdminModule(() => import("./AdminBilling.js"), "renderAdminPayments", content, { signal: routeController.signal });
  else if (route.path === "/admin/invoices") loadAdminModule(() => import("./AdminBilling.js"), "renderAdminInvoicesUnavailable", content, {
    signal: routeController.signal,
    initialDetailId: route.detailId || "",
    setDetail(detailId, { push = false } = {}) {
      const path = detailId
        ? `/admin/invoices/${encodeURIComponent(String(detailId))}`
        : "/admin/invoices";
      history[push ? "pushState" : "replaceState"]({ adminPath: "/admin/invoices" }, "", path);
    },
  });
  else if (route.path === "/admin/legal") {
    void import("./AdminLegalCatalog.js").then(({ renderAdminLegalCatalog }) => renderAdminLegalCatalog(content, { signal: routeController.signal })).catch((error) => {
      if (!routeController.signal.aborted) content.innerHTML = trustedHTML(adminStateMarkup("error", { message: error?.message || "Không thể tải danh mục pháp lý." }));
    });
  }
  else if (route.path === "/admin/audit") loadAdminModule(() => import("./AdminSecurity.js"), "renderAdminAudit", content, { signal: routeController.signal });
  else if (route.path === "/admin/security") loadAdminModule(() => import("./AdminSecurity.js"), "renderAdminSecurity", content, { signal: routeController.signal });
  else if (route.path === "/admin/health") loadAdminModule(() => import("./AdminOperations.js"), "renderAdminHealth", content, { signal: routeController.signal });
  else if (route.path === "/admin/settings") loadAdminModule(() => import("./AdminOperations.js"), "renderAdminSettings", content, { signal: routeController.signal });
  else if (route.path === "/admin/environment") loadAdminModule(() => import("./AdminOperations.js"), "renderAdminEnvironment", content, { signal: routeController.signal });
  else if (route.path === "/admin/system/version") loadAdminModule(() => import("./AdminOperations.js"), "renderAdminSystemVersion", content, { signal: routeController.signal });
  else if (route.path === "/admin/system/jobs") loadAdminModule(() => import("./AdminSystem.js"), "renderAdminSystemJobs", content, { signal: routeController.signal });
  else if (route.path === "/admin/system/sync") loadAdminModule(() => import("./AdminSystem.js"), "renderAdminSystemSync", content, { signal: routeController.signal });
  else content.innerHTML = trustedHTML(adminStateMarkup("empty", { message: "Chức năng này chưa có nguồn dữ liệu quản trị được xác thực." }));
  document.getElementById("admin-main")?.focus({ preventScroll: true });
}
const app = document.getElementById("admin-app"); const session = readSession();
if (!session.valid || session.user?.platform_role !== "super_admin") app.innerHTML = trustedHTML(`<main class="page-body"><div class="container-tight py-5"><div class="empty"><p class="empty-title">Không có quyền truy cập</p></div></div></main>`);
else {
  window.performance?.mark?.("bf:init:start");
  app.innerHTML = trustedHTML(shellMarkup(session)); app.setAttribute("aria-busy", "false");
  bindNavigationToggle();
  bindAdminSearch(document);
  window.addEventListener("admin:session-expired", handleSessionExpiry);
  document.querySelector("[data-admin-workspace-link]")?.addEventListener("click", selectWorkspaceRole);
  document.addEventListener("click", (event) => { const link = event.target.closest("a[data-admin-link]"); if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; if (navigateAdmin(link.dataset.adminLink)) event.preventDefault(); });
  window.addEventListener("popstate", renderRoute); window.addEventListener("admin:navigate", renderRoute); renderRoute(); markStartupReady();
}
