import "@tabler/core/dist/css/tabler.min.css";
import "@tabler/core/dist/js/tabler.esm.js";
import "./admin.css";
import { ADMIN_ROUTES, getAdminRoute, navigateAdmin } from "./AdminRouter.js";
import { trustedHTML } from "../shared/trustedTypes.js";

function readSession() {
  try { return JSON.parse(document.getElementById("bf-admin-session")?.textContent || "{}"); }
  catch { return { valid: false }; }
}
function escapeText(value) {
  const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML;
}
function shellMarkup(session) {
  const name = escapeText(session.user?.name || session.user?.username || "Quản trị viên");
  const links = ADMIN_ROUTES.map(([path, title]) => `<li class="nav-item"><a class="nav-link" href="${path}" data-admin-link="${path}"><span class="nav-link-title">${escapeText(title)}</span></a></li>`).join("");
  return `<aside class="navbar navbar-vertical navbar-expand-lg" data-bs-theme="dark" aria-label="Điều hướng quản trị"><div class="container-fluid"><h1 class="navbar-brand navbar-brand-autodark">BiddingFlow <span>Admin</span></h1><div class="navbar-nav flex-row d-lg-none ms-auto"><button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#admin-navbar" aria-controls="admin-navbar" aria-expanded="false" aria-label="Mở điều hướng"><span class="navbar-toggler-icon"></span></button></div><div class="collapse navbar-collapse" id="admin-navbar"><ul class="navbar-nav pt-lg-3">${links}</ul></div></div></aside><div class="page-wrapper"><header class="navbar navbar-expand-md d-print-none"><div class="container-xl"><div class="navbar-nav flex-row order-md-last"><span class="nav-link">${name}</span><a class="nav-link" href="/tong-quan">Không gian làm việc</a></div></div></header><main id="admin-main" class="page-body" tabindex="-1"><div class="container-xl"><div id="admin-view"></div></div></main></div>`;
}
function renderRoute() {
  const route = getAdminRoute(window.location.pathname); const view = document.getElementById("admin-view");
  document.querySelectorAll("[data-admin-link]").forEach((link) => { const active = link.dataset.adminLink === route?.path; link.classList.toggle("active", active); if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  if (!route) { view.innerHTML = trustedHTML(`<div class="empty"><p class="empty-title">Không tìm thấy trang quản trị</p><div class="empty-action"><a class="btn btn-primary" href="/admin" data-admin-link="/admin">Về tổng quan</a></div></div>`); document.title = "Không tìm thấy | BiddingFlow Admin"; return; }
  document.title = `${route.title} | BiddingFlow Admin`;
  view.innerHTML = trustedHTML(`<div class="page-header"><div class="row align-items-center"><div class="col"><div class="page-pretitle">Quản trị nền tảng</div><h2 class="page-title">${escapeText(route.title)}</h2></div></div></div><div class="card mt-3"><div class="card-body"><div class="empty"><p class="empty-title">Đang kết nối dữ liệu thực</p><p class="empty-subtitle text-secondary">Màn hình này sẽ chỉ hiển thị dữ liệu đã được máy chủ xác thực.</p></div></div></div>`);
  document.getElementById("admin-main")?.focus({ preventScroll: true });
}
const app = document.getElementById("admin-app"); const session = readSession();
if (!session.valid || session.user?.platform_role !== "super_admin") app.innerHTML = trustedHTML(`<main class="page-body"><div class="container-tight py-5"><div class="empty"><p class="empty-title">Không có quyền truy cập</p></div></div></main>`);
else {
  app.innerHTML = trustedHTML(shellMarkup(session)); app.setAttribute("aria-busy", "false");
  document.addEventListener("click", (event) => { const link = event.target.closest("a[data-admin-link]"); if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; if (navigateAdmin(link.dataset.adminLink)) event.preventDefault(); });
  window.addEventListener("popstate", renderRoute); window.addEventListener("admin:navigate", renderRoute); renderRoute();
}
