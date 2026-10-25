// Presentation-only motion layer adapted from the interaction patterns of
// Animate UI (https://animate-ui.com, MIT + Commons Clause, Elliot Sutton).
// Re-implemented in plain DOM/CSS: no business state, DOM hooks, ARIA
// semantics or field visibility are changed. Decorations are aria-hidden and
// every effect is skipped under prefers-reduced-motion.

const TABLIST_SELECTOR = '[role="tablist"]';
const SELECTED_TAB_SELECTOR = '[role="tab"][aria-selected="true"], [role="tab"].active';
const RIPPLE_SELECTOR = ".btn, .landing-button";
const OPT_OUT_SELECTOR = '[data-bf-motion="off"]';
const RIPPLE_DURATION_MS = 560;

const installedRoots = new WeakMap();

export function tabIndicatorGeometry(listRect, tabRect, {
  scrollLeft = 0,
  scrollTop = 0,
  clientLeft = 0,
  clientTop = 0,
} = {}) {
  const width = Number(tabRect?.width) || 0;
  const height = Number(tabRect?.height) || 0;
  if (width <= 0 || height <= 0) return null;
  return {
    x: (Number(tabRect.left) || 0) - (Number(listRect?.left) || 0) + scrollLeft - clientLeft,
    y: (Number(tabRect.top) || 0) - (Number(listRect?.top) || 0) + scrollTop - clientTop,
    width,
    height,
  };
}

export function rippleGeometry(rect, clientX, clientY) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  const x = Math.min(Math.max((Number(clientX) || 0) - (Number(rect?.left) || 0), 0), width);
  const y = Math.min(Math.max((Number(clientY) || 0) - (Number(rect?.top) || 0), 0), height);
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  return { x, y, size: radius * 2 };
}

// Animate UI "Counting Number": ease-out cubic from 0 to the target integer.
export function countingNumberValue(target, progress) {
  const end = Math.max(0, Math.trunc(Number(target) || 0));
  const clamped = Math.min(Math.max(Number(progress) || 0, 0), 1);
  return Math.round(end * (1 - (1 - clamped) ** 3));
}

export function parseCountingText(text) {
  const match = /^(\d+)(.*)$/su.exec(String(text ?? "").trim());
  return match ? { target: Number(match[1]), suffix: match[2] } : null;
}

function hasOwnPseudoContent(view, element) {
  const content = view?.getComputedStyle?.(element, "::after")?.content;
  return Boolean(content && content !== "none" && content !== "normal");
}

export function installMotionEnhancements(root = globalThis.document) {
  if (!root?.querySelectorAll) return null;
  if (installedRoots.has(root)) return installedRoots.get(root);

  const ownerDocument = root.nodeType === 9 ? root : root.ownerDocument;
  const view = ownerDocument?.defaultView || globalThis.window;
  const request = view?.requestAnimationFrame?.bind(view);
  if (!request || !view?.getComputedStyle) return null;

  const reducedMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
  const Observer = view.MutationObserver || globalThis.MutationObserver;
  const Resize = view.ResizeObserver || globalThis.ResizeObserver;
  const tablists = new Set();
  const pending = new Set();
  let frame = null;

  const resizeObserver = Resize
    ? new Resize((entries) => entries.forEach((entry) => schedule(entry.target)))
    : null;

  const placeIndicator = (list) => {
    if (!list.isConnected) {
      tablists.delete(list);
      resizeObserver?.unobserve(list);
      return;
    }
    const tab = list.querySelector(SELECTED_TAB_SELECTOR);
    const geometry = tab && tabIndicatorGeometry(
      list.getBoundingClientRect(),
      tab.getBoundingClientRect(),
      list,
    );
    if (!geometry) {
      list.dataset.bfTabMotion = "hidden";
      return;
    }
    list.style.setProperty("--bf-tab-x", `${geometry.x}px`);
    list.style.setProperty("--bf-tab-y", `${geometry.y}px`);
    list.style.setProperty("--bf-tab-w", `${geometry.width}px`);
    list.style.setProperty("--bf-tab-h", `${geometry.height}px`);
    if (list.dataset.bfTabMotion === "ready") return;
    // First placement is instant; transitions start from the next frame so
    // the indicator never slides in from the corner.
    list.dataset.bfTabMotion = "placed";
    request(() => {
      if (list.dataset.bfTabMotion === "placed") list.dataset.bfTabMotion = "ready";
    });
  };

  const flush = () => {
    frame = null;
    const lists = [...pending];
    pending.clear();
    lists.forEach(placeIndicator);
  };

  function schedule(list) {
    if (!tablists.has(list)) return;
    pending.add(list);
    if (frame === null) frame = request(flush);
  }

  const trackTablist = (list) => {
    if (tablists.has(list)) {
      schedule(list);
      return;
    }
    if (list.closest(OPT_OUT_SELECTOR) || hasOwnPseudoContent(view, list)) return;
    tablists.add(list);
    list.classList.add("bf-motion-tablist");
    if (view.getComputedStyle(list).position === "static") {
      list.classList.add("bf-motion-anchor");
    }
    resizeObserver?.observe(list);
    schedule(list);
  };

  const trackWithin = (node) => {
    if (node.matches?.(TABLIST_SELECTOR)) trackTablist(node);
    node.querySelectorAll?.(TABLIST_SELECTOR).forEach(trackTablist);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || reducedMotion?.matches) return;
    const button = event.target?.closest?.(RIPPLE_SELECTOR);
    if (
      !button
      || button.disabled
      || button.getAttribute("aria-disabled") === "true"
      || button.getAttribute("aria-busy") === "true"
      || button.closest(OPT_OUT_SELECTOR)
    ) return;
    const { x, y, size } = rippleGeometry(button.getBoundingClientRect(), event.clientX, event.clientY);
    if (size <= 0) return;
    if (view.getComputedStyle(button).position === "static") {
      button.classList.add("bf-motion-anchor");
    }
    const host = ownerDocument.createElement("span");
    host.className = "bf-motion-ripple-host";
    host.setAttribute("aria-hidden", "true");
    const ripple = ownerDocument.createElement("span");
    ripple.className = "bf-motion-ripple";
    ripple.style.setProperty("--bf-ripple-x", `${x}px`);
    ripple.style.setProperty("--bf-ripple-y", `${y}px`);
    ripple.style.setProperty("--bf-ripple-size", `${size}px`);
    host.append(ripple);
    button.append(host);
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      host.remove();
    };
    ripple.addEventListener("animationend", remove, { once: true });
    view.setTimeout?.(remove, RIPPLE_DURATION_MS + 200);
  };

  const onResize = () => tablists.forEach(schedule);

  const mutationObserver = Observer
    ? new Observer((mutations) => mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) trackWithin(node);
        });
        const list = mutation.target.closest?.(TABLIST_SELECTOR);
        if (list) schedule(list);
        return;
      }
      const target = mutation.target;
      if (target.matches?.(TABLIST_SELECTOR)) trackTablist(target);
      else if (target.matches?.('[role="tab"]')) {
        const list = target.closest(TABLIST_SELECTOR);
        if (list) schedule(list);
      }
    }))
    : null;
  mutationObserver?.observe(root.documentElement || root, {
    attributeFilter: ["aria-selected", "class", "hidden", "role"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  root.addEventListener?.("pointerdown", onPointerDown, { passive: true });
  view.addEventListener?.("resize", onResize, { passive: true });
  ownerDocument?.fonts?.ready?.then(onResize).catch(() => {});

  trackWithin(root.documentElement || root);

  const installation = {
    disconnect() {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      root.removeEventListener?.("pointerdown", onPointerDown, { passive: true });
      view.removeEventListener?.("resize", onResize, { passive: true });
      if (frame !== null) view.cancelAnimationFrame?.(frame);
      tablists.clear();
      pending.clear();
      installedRoots.delete(root);
    },
    refresh: onResize,
  };
  installedRoots.set(root, installation);
  return installation;
}
