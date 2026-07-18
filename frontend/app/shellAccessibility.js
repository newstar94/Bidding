const MOBILE_SIDEBAR_QUERY = "(max-width: 768px)";

function setToggleAttribute(element, name, enabled) {
  if (!element) return;
  if (typeof element.toggleAttribute === "function") {
    element.toggleAttribute(name, enabled);
    return;
  }
  if (enabled) element.setAttribute?.(name, "");
  else element.removeAttribute?.(name);
}

function focusElement(element) {
  element?.focus?.({ preventScroll: true });
}

function profileMenuItems(menu) {
  const items = menu?.querySelectorAll?.("[role=menuitem], button") || [];
  return [...items].filter((item) => !item.disabled && !item.hidden && item.getAttribute?.("aria-hidden") !== "true");
}

export function setProfileMenuOpen(trigger, menu, open, { focus = "none" } = {}) {
  if (!trigger || !menu) return false;
  const expanded = Boolean(open);
  trigger.setAttribute("aria-expanded", String(expanded));
  menu.hidden = !expanded;
  menu.classList.toggle("active", expanded);

  const items = profileMenuItems(menu);
  if (expanded && focus === "first") focusElement(items[0]);
  if (expanded && focus === "last") focusElement(items.at(-1));
  if (!expanded && focus === "trigger") focusElement(trigger);
  return expanded;
}

export function synchronizeProfileMenu(trigger, menu, { restoreFocus = true } = {}) {
  if (!trigger || !menu) return false;
  const open = menu.classList.contains("active");
  const activeElement = menu.ownerDocument?.activeElement;
  const focusWasInside = Boolean(activeElement && menu.contains?.(activeElement));
  trigger.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
  if (!open && restoreFocus && focusWasInside) focusElement(trigger);
  return open;
}

export function handleProfileMenuKeydown(event, trigger, menu) {
  if (!event || !trigger || !menu) return false;
  const items = profileMenuItems(menu);
  const activeElement = menu.ownerDocument?.activeElement;
  const currentIndex = items.indexOf(activeElement);

  if (event.key === "Escape") {
    if (!menu.classList.contains("active")) return false;
    event.preventDefault();
    setProfileMenuOpen(trigger, menu, false, { focus: "trigger" });
    return true;
  }

  if (event.currentTarget === trigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    setProfileMenuOpen(trigger, menu, true, { focus: event.key === "ArrowDown" ? "first" : "last" });
    return true;
  }

  if (event.currentTarget !== menu) return false;
  if (event.key === "Tab") {
    setProfileMenuOpen(trigger, menu, false);
    return false;
  }

  let nextIndex = -1;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = items.length - 1;
  if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
  if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
  if (nextIndex < 0 || !items.length) return false;
  event.preventDefault();
  focusElement(items[nextIndex]);
  return true;
}

export function setDesktopSidebarCollapsed(appContainer, collapseButton, collapsed) {
  const isCollapsed = Boolean(collapsed);
  appContainer?.classList.toggle("sidebar-collapsed", isCollapsed);
  const brandIcon = appContainer?.querySelector?.(".brand-icon");
  if (brandIcon) {
    brandIcon.setAttribute("aria-hidden", String(!isCollapsed));
    brandIcon.setAttribute("aria-label", "Mở rộng thanh bên");
    brandIcon.setAttribute("role", "button");
    brandIcon.tabIndex = isCollapsed ? 0 : -1;
  }
  if (collapseButton) {
    collapseButton.setAttribute("aria-expanded", String(!isCollapsed));
    collapseButton.setAttribute("aria-label", isCollapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên");
    collapseButton.title = isCollapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên";
  }
  return isCollapsed;
}

export function setMobileSidebarOpen(sidebar, toggle, open, { focus = "none" } = {}) {
  if (!sidebar || !toggle) return false;
  const expanded = Boolean(open);
  sidebar.classList.toggle("active", expanded);
  setToggleAttribute(sidebar, "inert", !expanded);
  if (expanded) sidebar.removeAttribute("aria-hidden");
  else sidebar.setAttribute("aria-hidden", "true");
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", expanded ? "Đóng thanh điều hướng" : "Mở thanh điều hướng");

  if (expanded && focus === "sidebar") {
    const destination = sidebar.querySelector?.(".nav-btn.active:not([disabled]), .nav-btn:not([disabled])");
    focusElement(destination);
  }
  if (!expanded && focus === "toggle") focusElement(toggle);
  return expanded;
}

export function synchronizeSidebarViewport({ appContainer, sidebar, toggle, collapseButton, mediaQuery }) {
  const mobile = Boolean(mediaQuery?.matches);
  if (mobile) {
    appContainer?.classList.remove("sidebar-collapsed");
    setMobileSidebarOpen(sidebar, toggle, sidebar?.classList.contains("active"));
  } else {
    sidebar?.classList.remove("active");
    setToggleAttribute(sidebar, "inert", false);
    sidebar?.removeAttribute("aria-hidden");
    toggle?.setAttribute("aria-expanded", "true");
    toggle?.setAttribute("aria-label", "Thanh điều hướng đang hiển thị");
    const collapsed = appContainer?.classList.contains("sidebar-collapsed");
    setDesktopSidebarCollapsed(appContainer, collapseButton, collapsed);
  }
  return mobile;
}

export function createSidebarMediaQuery(view = globalThis.window) {
  return view?.matchMedia?.(MOBILE_SIDEBAR_QUERY) || { matches: false };
}
