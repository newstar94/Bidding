import { escapeHtml } from "../shared/view_helpers.js";
import { ADMIN_ROUTE_ICONS, adminIconMarkup } from "./AdminIcons.js";
import { ADMIN_NAV_GROUPS, ADMIN_ROUTES } from "./AdminRouter.js";

export function adminNavigationMarkup({ groups = ADMIN_NAV_GROUPS, routes = ADMIN_ROUTES, compact = false } = {}) {
  const routeTitles = new Map(routes);
  if (compact) {
    return routes.map(([path, title]) => `<li class="nav-item${path === "/admin/settings" ? " bf-admin-nav-divider" : ""}"><a class="nav-link" href="${escapeHtml(path)}" data-admin-link="${escapeHtml(path)}">${adminIconMarkup(ADMIN_ROUTE_ICONS[path])}<span class="nav-link-title">${escapeHtml(title)}</span></a></li>`).join("");
  }
  return groups.map((group) => {
    const links = group.paths.map((path) => {
      const title = routeTitles.get(path);
      if (!title) return "";
      return `<li class="nav-item"><a class="nav-link" href="${escapeHtml(path)}" data-admin-link="${escapeHtml(path)}">${adminIconMarkup(ADMIN_ROUTE_ICONS[path])}<span class="nav-link-title">${escapeHtml(title)}</span></a></li>`;
    }).join("");
    return `<li class="nav-item admin-nav-section-title">${escapeHtml(group.label)}</li>${links}`;
  }).join("");
}
