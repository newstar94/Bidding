const virtualStates = /* @__PURE__ */ new WeakMap();
export function clearVirtualTable(tbody) {
  const state = virtualStates.get(tbody);
  if (state) {
    state.container.removeEventListener("scroll", state.onScroll);
    virtualStates.delete(tbody);
  }
}
export function renderVirtualTable(tbody, rows, renderRow, options = {}) {
  clearVirtualTable(tbody);
  const threshold = options.threshold || 80;
  const rowHeight = options.rowHeight || 72;
  const overscan = options.overscan || 8;
  const colSpan = options.colSpan || 1;
  const onRender = options.onRender || (() => {
  });
  if (!Array.isArray(rows) || rows.length <= threshold) {
    tbody.innerHTML = (rows || []).map(renderRow).join("");
    onRender();
    return false;
  }
  const container = tbody.closest(".table-container") || tbody.parentElement;
  if (!container) {
    tbody.innerHTML = rows.map(renderRow).join("");
    onRender();
    return false;
  }
  container.classList.add("virtual-table-container");
  container.style.overflow = "auto";
  if (!container.style.maxHeight) {
    container.style.maxHeight = options.maxHeight || "calc(100vh - 280px)";
  }
  let rafId = null;
  const renderWindow = () => {
    const viewportHeight = container.clientHeight || 520;
    const start = Math.max(0, Math.floor(container.scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const end = Math.min(rows.length, start + visibleCount);
    const topHeight = start * rowHeight;
    const bottomHeight = Math.max(0, (rows.length - end) * rowHeight);
    const topSpacer = topHeight > 0 ? `<tr aria-hidden="true" class="virtual-spacer"><td colspan="${colSpan}" style="height:${topHeight}px; padding:0; border:0;"></td></tr>` : "";
    const bottomSpacer = bottomHeight > 0 ? `<tr aria-hidden="true" class="virtual-spacer"><td colspan="${colSpan}" style="height:${bottomHeight}px; padding:0; border:0;"></td></tr>` : "";
    tbody.innerHTML = topSpacer + rows.slice(start, end).map(renderRow).join("") + bottomSpacer;
    onRender();
  };
  const onScroll = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderWindow();
    });
  };
  virtualStates.set(tbody, { container, onScroll });
  container.addEventListener("scroll", onScroll, { passive: true });
  container.scrollTop = 0;
  renderWindow();
  return true;
}
