export const ADMIN_ROUTES = Object.freeze([
  ["/admin", "Tổng quan"], ["/admin/analytics", "Phân tích"],
  ["/admin/organizations", "Tổ chức"], ["/admin/users", "Người dùng"],
  ["/admin/plans", "Gói dịch vụ"], ["/admin/subscriptions", "Đăng ký"],
  ["/admin/invoices", "Hóa đơn"], ["/admin/payments", "Thanh toán"],
  ["/admin/settings", "Cài đặt"], ["/admin/environment", "Môi trường"],
  ["/admin/legal", "Danh mục pháp lý"],
  ["/admin/audit", "Nhật ký"], ["/admin/health", "Vận hành"],
  ["/admin/security", "Bảo mật"], ["/admin/system/jobs", "Tác vụ"],
  ["/admin/system/sync", "Đồng bộ"], ["/admin/system/version", "Phiên bản"],
]);
const ROUTE_MAP = new Map(ADMIN_ROUTES);
export function normalizeAdminPath(pathname) {
  const value = String(pathname || "/admin").replace(/\/+$/u, "") || "/admin";
  return ROUTE_MAP.has(value) ? value : null;
}
export function getAdminRoute(pathname) {
  const path = normalizeAdminPath(pathname);
  return path ? { path, title: ROUTE_MAP.get(path) } : null;
}
export function navigateAdmin(path, { replace = false } = {}) {
  const route = getAdminRoute(path);
  if (!route) return false;
  history[replace ? "replaceState" : "pushState"]({ adminPath: route.path }, "", route.path);
  window.dispatchEvent(new CustomEvent("admin:navigate", { detail: route }));
  return true;
}
