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
const INVOICE_DETAIL = /^\/admin\/invoices\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/u;
export function normalizeAdminPath(pathname) {
  const value = String(pathname || "/admin").replace(/\/+$/u, "") || "/admin";
  return ROUTE_MAP.has(value) || INVOICE_DETAIL.test(value) ? value : null;
}
export function getAdminRoute(pathname) {
  const path = normalizeAdminPath(pathname);
  if (!path) return null;
  const invoiceDetail = INVOICE_DETAIL.exec(path);
  if (invoiceDetail) {
    return {
      path: "/admin/invoices",
      href: path,
      title: ROUTE_MAP.get("/admin/invoices"),
      detailId: invoiceDetail[1],
    };
  }
  return { path, title: ROUTE_MAP.get(path) };
}
export function navigateAdmin(path, { replace = false } = {}) {
  const route = getAdminRoute(path);
  if (!route) return false;
  history[replace ? "replaceState" : "pushState"]({ adminPath: route.path }, "", route.href || route.path);
  window.dispatchEvent(new CustomEvent("admin:navigate", { detail: route }));
  return true;
}
