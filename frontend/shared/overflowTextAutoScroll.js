const TEXT_CONTROL_SELECTOR = [
  "input:not([type])",
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="url"]',
  'input[type="tel"]',
].map((selector) => (
  `${selector}:not([data-bf-auto-scroll="off"]):not(.mt-ma-nha-thau)`
)).join(",");

export const OVERFLOW_SCROLL_DEFAULTS = Object.freeze({
  endDelayMs: 1600,
  speedPxPerSecond: 34,
  startDelayMs: 1100,
});

const installedRoots = new WeakMap();

export function textControlOverflowDistance(control) {
  const scrollWidth = Number(control?.scrollWidth) || 0;
  const clientWidth = Number(control?.clientWidth) || 0;
  return Math.max(0, scrollWidth - clientWidth);
}

export function overflowScrollPosition(
  elapsedMs,
  maxScroll,
  options = OVERFLOW_SCROLL_DEFAULTS,
) {
  const distance = Math.max(0, Number(maxScroll) || 0);
  if (distance === 0) return 0;
  const speed = Math.max(1, Number(options.speedPxPerSecond) || 1);
  const startDelay = Math.max(0, Number(options.startDelayMs) || 0);
  const endDelay = Math.max(0, Number(options.endDelayMs) || 0);
  const travelDuration = distance / speed * 1000;
  const cycleDuration = startDelay + travelDuration + endDelay;
  const cycleElapsed = Math.max(0, Number(elapsedMs) || 0) % cycleDuration;
  if (cycleElapsed <= startDelay) return 0;
  if (cycleElapsed >= startDelay + travelDuration) return distance;
  return Math.min(distance, (cycleElapsed - startDelay) / 1000 * speed);
}

export function shouldAutoScrollTextControl(control, activeElement = null) {
  return Boolean(
    control?.matches?.(TEXT_CONTROL_SELECTOR)
    && control.isConnected !== false
    && String(control.value || "").length > 0
    && control !== activeElement
    && textControlOverflowDistance(control) > 1,
  );
}

function matchingTextControls(root) {
  const descendants = root?.querySelectorAll?.(TEXT_CONTROL_SELECTOR) || [];
  return root?.matches?.(TEXT_CONTROL_SELECTOR)
    ? [root, ...descendants]
    : [...descendants];
}

function animationApi(ownerDocument) {
  const view = ownerDocument?.defaultView || globalThis.window;
  return {
    cancel: view?.cancelAnimationFrame?.bind(view),
    clearInterval: view?.clearInterval?.bind(view),
    request: view?.requestAnimationFrame?.bind(view),
    setInterval: view?.setInterval?.bind(view),
    view,
  };
}

export function installOverflowTextAutoScroll(root = globalThis.document) {
  if (!root?.querySelectorAll) return null;
  if (installedRoots.has(root)) return installedRoots.get(root);

  const ownerDocument = root.nodeType === 9 ? root : root.ownerDocument;
  const {
    cancel,
    clearInterval: clearIntervalInView,
    request,
    setInterval: setIntervalInView,
    view,
  } = animationApi(ownerDocument);
  if (!request) return null;

  const states = new Map();
  const activeControls = new Set();
  const reducedMotion = view?.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
  const Observer = view?.MutationObserver || globalThis.MutationObserver;
  const Resize = view?.ResizeObserver || globalThis.ResizeObserver;
  const Intersection = view?.IntersectionObserver || globalThis.IntersectionObserver;
  let animationFrame = null;

  const setOverflowTitle = (control, state, hasOverflow) => {
    if (hasOverflow && control.value) {
      if (!state.generatedTitle && !control.hasAttribute("title")) {
        state.generatedTitle = true;
      }
      if (state.generatedTitle) control.setAttribute("title", control.value);
      return;
    }
    if (state.generatedTitle) {
      control.removeAttribute("title");
      state.generatedTitle = false;
    }
  };

  const stopAnimationWhenIdle = () => {
    if (activeControls.size || animationFrame === null) return;
    cancel?.(animationFrame);
    animationFrame = null;
  };

  const animate = (timestamp) => {
    animationFrame = null;
    activeControls.forEach((control) => {
      const state = states.get(control);
      if (!state || !shouldAutoScrollTextControl(control, ownerDocument?.activeElement)) {
        activeControls.delete(control);
        return;
      }
      const maxScroll = textControlOverflowDistance(control);
      if (state.startedAt === null || state.maxScroll !== maxScroll) {
        state.startedAt = timestamp;
        state.maxScroll = maxScroll;
      }
      control.scrollLeft = overflowScrollPosition(timestamp - state.startedAt, maxScroll);
    });
    if (activeControls.size) animationFrame = request(animate);
  };

  const startAnimation = () => {
    if (animationFrame !== null || !activeControls.size) return;
    animationFrame = request(animate);
  };

  const synchronizeControl = (control) => {
    const state = states.get(control);
    if (!state) return;
    const currentValue = String(control.value || "");
    state.lastValue = currentValue;
    const hasOverflow = currentValue.length > 0
      && textControlOverflowDistance(control) > 1;
    state.hasOverflow = hasOverflow;
    setOverflowTitle(control, state, hasOverflow);
    const shouldAnimate = hasOverflow
      && state.isVisible
      && control !== ownerDocument?.activeElement
      && !reducedMotion?.matches;
    if (shouldAnimate) {
      activeControls.add(control);
      startAnimation();
      return;
    }
    activeControls.delete(control);
    state.startedAt = null;
    state.maxScroll = 0;
    if (control !== ownerDocument?.activeElement) control.scrollLeft = 0;
    stopAnimationWhenIdle();
  };

  const resizeObserver = Resize
    ? new Resize((entries) => entries.forEach((entry) => synchronizeControl(entry.target)))
    : null;
  const intersectionObserver = Intersection
    ? new Intersection((entries) => entries.forEach((entry) => {
      const state = states.get(entry.target);
      if (!state) return;
      state.isVisible = entry.isIntersecting;
      synchronizeControl(entry.target);
    }))
    : null;

  const track = (control) => {
    if (states.has(control)) {
      synchronizeControl(control);
      return;
    }
    states.set(control, {
      generatedTitle: false,
      hasOverflow: false,
      isVisible: !intersectionObserver,
      lastValue: String(control.value || ""),
      maxScroll: 0,
      startedAt: null,
    });
    resizeObserver?.observe(control);
    intersectionObserver?.observe(control);
    synchronizeControl(control);
  };

  const untrack = (control) => {
    const state = states.get(control);
    if (!state) return;
    resizeObserver?.unobserve(control);
    intersectionObserver?.unobserve(control);
    activeControls.delete(control);
    if (state.generatedTitle) control.removeAttribute("title");
    states.delete(control);
    stopAnimationWhenIdle();
  };

  const trackWithin = (node) => matchingTextControls(node).forEach(track);
  const untrackWithin = (node) => matchingTextControls(node).forEach(untrack);
  const refreshAll = () => states.forEach((_state, control) => synchronizeControl(control));
  const resetAndRefresh = (control) => {
    const state = states.get(control);
    if (!state) return;
    state.startedAt = null;
    state.maxScroll = 0;
    control.scrollLeft = 0;
    synchronizeControl(control);
  };

  const onInput = (event) => {
    if (event.target?.matches?.(TEXT_CONTROL_SELECTOR)) synchronizeControl(event.target);
  };
  const onFocusIn = (event) => {
    const control = event.target;
    if (!states.has(control)) return;
    activeControls.delete(control);
    states.get(control).startedAt = null;
    stopAnimationWhenIdle();
  };
  const onFocusOut = (event) => {
    const control = event.target;
    if (!states.has(control)) return;
    request(() => resetAndRefresh(control));
  };
  const onPointerDown = (event) => {
    const control = event.target;
    if (!states.has(control)) return;
    activeControls.delete(control);
    states.get(control).startedAt = null;
    control.scrollLeft = 0;
    stopAnimationWhenIdle();
  };
  const onVisibilityChange = () => {
    if (ownerDocument?.hidden) {
      activeControls.forEach((control) => {
        const state = states.get(control);
        if (state) state.startedAt = null;
      });
      return;
    }
    refreshAll();
  };
  const onReducedMotionChange = () => refreshAll();
  const detectProgrammaticValueChanges = () => {
    if (ownerDocument?.hidden) return;
    states.forEach((state, control) => {
      if (String(control.value || "") !== state.lastValue) synchronizeControl(control);
    });
  };

  root.addEventListener?.("input", onInput);
  root.addEventListener?.("change", onInput);
  root.addEventListener?.("focusin", onFocusIn);
  root.addEventListener?.("focusout", onFocusOut);
  root.addEventListener?.("pointerdown", onPointerDown, true);
  ownerDocument?.addEventListener?.("visibilitychange", onVisibilityChange);
  reducedMotion?.addEventListener?.("change", onReducedMotionChange);

  const mutationObserver = Observer
    ? new Observer((mutations) => mutations.forEach((mutation) => {
      mutation.removedNodes?.forEach?.((node) => {
        if (node.nodeType === 1) untrackWithin(node);
      });
      mutation.addedNodes?.forEach?.((node) => {
        if (node.nodeType === 1) trackWithin(node);
      });
      if (mutation.type === "attributes") {
        if (mutation.target.matches?.(TEXT_CONTROL_SELECTOR)) track(mutation.target);
        else untrack(mutation.target);
      }
    }))
    : null;
  mutationObserver?.observe(root.documentElement || root, {
    attributeFilter: ["data-bf-auto-scroll", "type", "value"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  const valuePoll = setIntervalInView?.(detectProgrammaticValueChanges, 800) ?? null;

  trackWithin(root);
  ownerDocument?.fonts?.ready?.then(refreshAll).catch(() => {});

  const installation = {
    disconnect() {
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      root.removeEventListener?.("input", onInput);
      root.removeEventListener?.("change", onInput);
      root.removeEventListener?.("focusin", onFocusIn);
      root.removeEventListener?.("focusout", onFocusOut);
      root.removeEventListener?.("pointerdown", onPointerDown, true);
      ownerDocument?.removeEventListener?.("visibilitychange", onVisibilityChange);
      reducedMotion?.removeEventListener?.("change", onReducedMotionChange);
      if (valuePoll !== null) clearIntervalInView?.(valuePoll);
      if (animationFrame !== null) cancel?.(animationFrame);
      states.forEach((state, control) => {
        control.scrollLeft = 0;
        if (state.generatedTitle) control.removeAttribute("title");
      });
      activeControls.clear();
      states.clear();
      animationFrame = null;
      installedRoots.delete(root);
    },
    refresh: refreshAll,
  };
  installedRoots.set(root, installation);
  return installation;
}
