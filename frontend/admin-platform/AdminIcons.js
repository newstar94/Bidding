import { escapeHtml } from "../shared/view_helpers.js";

const ICON_PATHS = Object.freeze({
  overview: '<path d="M4 13h6V4H4v9zM14 20h6v-9h-6v9zM4 20h6v-3H4v3zM14 7h6V4h-6v3z"/>',
  analytics: '<path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/>',
  organizations: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h1m4 0h1M9 14h1m4 0h1M10 21v-3h4v3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  plans: '<path d="M4 5h16v14H4zM8 9h8M8 13h5"/>',
  subscriptions: '<path d="M20 7h-9M14 17H5M17 4l3 3-3 3M8 14l-3 3 3 3"/>',
  invoices: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6"/>',
  payments: '<path d="M3 6h18v12H3zM3 10h18M7 15h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  integration: '<path d="M8 12h8M12 8v8M5 5h4v4H5zM15 15h4v4h-4zM15 5h4v4h-4zM5 15h4v4H5z"/>',
  environment: '<path d="M4 5h16v14H4zM4 9h16M8 13l2 2-2 2M13 17h3"/>',
  legal: '<path d="M6 3h9l3 3v15H6zM14 3v4h4M9 12h6M9 16h6"/>',
  audit: '<path d="M9 4H5v16h14V4h-4M9 2h6v4H9zM9 11h6M9 15h4"/>',
  health: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  security: '<path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4zM9 12l2 2 4-4"/>',
  jobs: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sync: '<path d="M20 7h-4V3M4 17h4v4M18.5 9A7 7 0 0 0 6 6l-2 1M5.5 15A7 7 0 0 0 18 18l2-1"/>',
  version: '<path d="M12 3l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  workspace: '<path d="M4 4h16v16H4zM4 9h16M9 9v11"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
});

export const ADMIN_ROUTE_ICONS = Object.freeze({
  "/admin": "overview",
  "/admin/analytics": "analytics",
  "/admin/organizations": "organizations",
  "/admin/users": "users",
  "/admin/plans": "plans",
  "/admin/subscriptions": "subscriptions",
  "/admin/invoices": "invoices",
  "/admin/payments": "payments",
  "/admin/settings": "settings",
  "/admin/chuan-hoa": "integration",
  "/admin/environment": "environment",
  "/admin/legal": "legal",
  "/admin/audit": "audit",
  "/admin/health": "health",
  "/admin/security": "security",
  "/admin/system/jobs": "jobs",
  "/admin/system/sync": "sync",
  "/admin/system/version": "version",
});

export function adminIconMarkup(name, className = "nav-link-icon") {
  const path = ICON_PATHS[name];
  if (!path) return "";
  return `<svg class="${escapeHtml(className)}" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}
