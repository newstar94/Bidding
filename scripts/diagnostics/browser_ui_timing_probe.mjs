// Temporary, opt-in timing probe. No form values, records or credentials are read.
const PREFIX = "[bf-browser-measure]";
const QUERY = new URLSearchParams(location.search).get("bf_browser_measure") === "20261001";
let enabled = QUERY;
try {
  if (QUERY) sessionStorage.setItem("bf_browser_measure_20261001", "true");
  enabled ||= sessionStorage.getItem("bf_browser_measure_20261001") === "true";
} catch { /* The query works even when diagnostic session storage is unavailable. */ }

if (enabled && typeof performance?.getEntriesByType === "function") {
  const observers = [];
  const timers = new Set();
  const frames = new Set();
  const markKeys = new Set();
  const longTasks = [];
  let longTaskObserver = null;
  let disposed = false;
  let pendingModal = null;
  let clickSequence = 0;
  const round = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const emit = (event, payload) => {
    if (!disposed) console.info(`${PREFIX} ${JSON.stringify({ event, ...payload })}`);
  };
  const later = (callback, delay) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, delay);
    timers.add(timer);
    return timer;
  };
  const frame = (callback) => {
    const handle = requestAnimationFrame((timestamp) => {
      frames.delete(handle);
      if (!disposed) callback(timestamp);
    });
    frames.add(handle);
  };
  const afterPaintOpportunity = (callback) => frame(() => frame(callback));
  const appendLongTasks = (entries) => entries.forEach((entry) => longTasks.push({
    startMs: round(entry.startTime), endMs: round(entry.startTime + entry.duration), durationMs: round(entry.duration),
  }));
  const flushLongTasks = () => {
    if (longTaskObserver) appendLongTasks(longTaskObserver.takeRecords());
  };
  const safePath = (name) => {
    try {
      const url = new URL(name, location.href);
      if (url.origin !== location.origin) {
        return url.hostname === "local.adguard.org"
          ? `${url.hostname}${url.pathname.replace(/[a-f\d]{16,}/giu, "[id]")}` : "[external]";
      }
      const path = url.pathname;
      if (/^\/(?:frontend|dist|vendor|css|modals|tabs)\//u.test(path)) return path;
      if (/^\/api\/(?:auth\/check-session|sync|paginate|init-data|holidays|health)(?:\/|$)/u.test(path)) {
        return path.split("/").slice(0, path.startsWith("/api/auth/") ? 4 : 3).join("/");
      }
      return path.startsWith("/api/") ? "/api/[other]" : "/[other]";
    } catch { return "[unavailable]"; }
  };
  const resourceTiming = (entry) => ({
    path: safePath(entry.name), initiator: entry.initiatorType,
    startMs: round(entry.startTime), endMs: round(entry.responseEnd || entry.startTime + entry.duration),
    durationMs: round(entry.duration), requestStartMs: round(entry.requestStart), responseStartMs: round(entry.responseStart),
    ttfbMs: entry.requestStart > 0 && entry.responseStart >= entry.requestStart
      ? round(entry.responseStart - entry.requestStart) : null,
    transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize,
    deliveryType: entry.deliveryType || null, protocol: entry.nextHopProtocol || null,
  });
  const summarizeResources = (startMs, boundaryMs, limit = 20) => {
    const entries = performance.getEntriesByType("resource").filter((entry) => (
      entry.startTime >= startMs && entry.startTime <= boundaryMs
      && (entry.responseEnd || entry.startTime + entry.duration) <= boundaryMs
    ));
    const modules = entries.filter((entry) => (
      /^\/(?:frontend|dist)\//u.test(safePath(entry.name)) && /\.(?:m?js)$/u.test(safePath(entry.name))
    ));
    const relevant = entries.filter((entry) => (
      /(?:BiddingCalculations|BidEvaluationWorkflow|KeHoachWorkflow|PlanImportWizard|NoticeImportWizard|ProcurementInlineLookup|ProcurementImportResume|OpeningImportWizard|GoiThauWorkflow|BidProcessWorkflow|FormSubTables|PartnerHelpers|modal_kehoach)\b/u.test(safePath(entry.name))
    ));
    return {
      completedResourceCount: entries.length, appModuleCount: modules.length,
      appModuleTransferBytes: modules.reduce((sum, entry) => sum + entry.transferSize, 0),
      appModuleEncodedBytes: modules.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      appModuleDecodedBytes: modules.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      topSlowRequests: entries.slice().sort((a, b) => b.duration - a.duration).slice(0, limit).map(resourceTiming),
      relevantWorkflowRequestCount: relevant.length,
      relevantWorkflowWaterfall: relevant.slice().sort((a, b) => a.startTime - b.startTime).slice(0, 40).map(resourceTiming),
    };
  };
  const navigationTiming = () => {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return null;
    return {
      type: nav.type, startMs: round(nav.startTime), redirectMs: round(nav.redirectEnd - nav.redirectStart),
      dnsMs: round(nav.domainLookupEnd - nav.domainLookupStart), connectMs: round(nav.connectEnd - nav.connectStart),
      tlsMs: nav.secureConnectionStart > 0 ? round(nav.connectEnd - nav.secureConnectionStart) : 0,
      requestStartMs: round(nav.requestStart), responseStartMs: round(nav.responseStart), responseEndMs: round(nav.responseEnd),
      ttfbMs: round(nav.responseStart - nav.requestStart), documentDownloadMs: round(nav.responseEnd - nav.responseStart),
      domInteractiveMs: round(nav.domInteractive), domContentLoadedMs: round(nav.domContentLoadedEventEnd),
      loadEventEndMs: round(nav.loadEventEnd), transferBytes: nav.transferSize,
      encodedBytes: nav.encodedBodySize, decodedBytes: nav.decodedBodySize, protocol: nav.nextHopProtocol || null,
    };
  };
  const startupSnapshot = (event, boundaryMs) => {
    flushLongTasks();
    const observedAtMs = performance.now();
    emit(event, {
      boundaryMs: round(boundaryMs), observedAtMs: round(observedAtMs), documentVisibility: document.visibilityState,
      navigation: navigationTiming(),
      paints: performance.getEntriesByType("paint").filter((entry) => entry.startTime <= observedAtMs)
        .map((entry) => ({ name: entry.name, startMs: round(entry.startTime) })),
      marks: performance.getEntriesByType("mark").filter((entry) => entry.name.startsWith("bf:") && entry.startTime <= boundaryMs)
        .map((entry) => ({ name: entry.name, startMs: round(entry.startTime) })),
      measures: performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("bf:") && entry.startTime + entry.duration <= boundaryMs)
        .map((entry) => ({ name: entry.name, startMs: round(entry.startTime), durationMs: round(entry.duration) })),
      longTasks: longTasks.filter((entry) => entry.startMs <= boundaryMs), resources: summarizeResources(0, boundaryMs),
    });
  };
  const observeMark = (entry) => {
    if (!["bf:loader:hidden", "bf:first-app-frame"].includes(entry.name)) return;
    const key = `${entry.name}:${entry.startTime}`;
    if (markKeys.has(key)) return;
    markKeys.add(key);
    if (entry.name === "bf:loader:hidden") startupSnapshot("loader-hidden", entry.startTime);
    else afterPaintOpportunity(() => startupSnapshot("first-app-frame", entry.startTime));
  };
  if (typeof PerformanceObserver === "function") {
    for (const [type, append] of [["mark", (entries) => entries.forEach(observeMark)], ["longtask", appendLongTasks]]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      try {
        const observer = new PerformanceObserver((list) => append(list.getEntries()));
        observer.observe({ type, buffered: true });
        observers.push(observer);
        if (type === "longtask") longTaskObserver = observer;
      } catch { emit("observer-unavailable", { entryType: type }); }
    }
  }
  performance.getEntriesByType("mark").forEach(observeMark);

  const controlCounts = (modal) => {
    const controls = [...modal.querySelectorAll("input,select,textarea,button")];
    return { total: controls.length, enabled: controls.filter((control) => !control.disabled).length,
      disabled: controls.filter((control) => control.disabled).length };
  };
  const stopModalObservation = () => {
    if (!pendingModal) return;
    pendingModal.observer.disconnect();
    clearTimeout(pendingModal.timeout);
    timers.delete(pendingModal.timeout);
    pendingModal = null;
  };
  const addTargets = new Map([
    ["btn-add-kehoach", "modal-kehoach"], ["btn-add-goithau", "modal-goithau"],
    ["btn-add-chudautu", "modal-chudautu"], ["btn-add-nhathau", "modal-nhathau"],
    ["btn-add-chuyengia", "modal-chuyengia"], ["btn-add-hopdong", "modal-hopdong"],
  ]);
  const onClick = (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest([...addTargets.keys()].map((id) => `#${id}`).join(","));
    if (!button) return;
    const targetId = button.id;
    const modalId = addTargets.get(targetId);
    const eventPrefix = modalId === "modal-kehoach" ? "plan" : modalId.replace(/^modal-/u, "");
    stopModalObservation();
    const clickId = clickSequence += 1;
    const clickMs = performance.now();
    const inputTimestampMs = event.timeStamp > performance.timeOrigin ? event.timeStamp - performance.timeOrigin : event.timeStamp;
    const existing = document.getElementById(modalId);
    emit(`${eventPrefix}-click`, {
      clickId, targetId, modalId, clickMs: round(clickMs), inputTimestampMs: round(inputTimestampMs),
      eventDispatchDelayMs: round(clickMs - inputTimestampMs), modalAlreadyInDom: Boolean(existing),
      modalAlreadyActive: Boolean(existing?.classList.contains("active")),
    });
    let insertedAtMs = existing ? clickMs : null;
    const inspect = () => {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      if (insertedAtMs === null) insertedAtMs = performance.now();
      if (!modal.classList.contains("active")) return;
      const activeMs = performance.now();
      stopModalObservation();
      emit(`${eventPrefix}-modal-active`, { clickId, modalId, activeMs: round(activeMs),
        clickToActiveMs: round(activeMs - clickMs), insertedAtMs: round(insertedAtMs), controls: controlCounts(modal) });
      let firstVisibleScheduled = false;
      let fullyVisibleScheduled = false;
      const visibleSample = () => {
        const style = getComputedStyle(modal);
        const rect = modal.getBoundingClientRect();
        return { opacity: Number(style.opacity), visible: style.display !== "none" && style.visibility !== "hidden"
          && style.visibility !== "collapse" && rect.width > 0 && rect.height > 0 };
      };
      const emitVisibleBoundary = (kind, detectedAtMs, detectedOpacity) => frame(() => {
        if (!modal.isConnected || !modal.classList.contains("active")) return;
        const confirmedAtMs = performance.now();
        const sample = visibleSample();
        if (!sample.visible || sample.opacity < (kind === "first-visible" ? 0.01 : 0.99)) return;
        flushLongTasks();
        emit(`${eventPrefix}-modal-${kind}`, {
          clickId, modalId, detectedAtMs: round(detectedAtMs), confirmedAtMs: round(confirmedAtMs),
          clickToDetectedMs: round(detectedAtMs - clickMs), clickToPaintOpportunityMs: round(confirmedAtMs - clickMs),
          paintBoundary: "rAF-following-opacity-threshold-observation", detectedOpacity, opacity: sample.opacity,
          controls: controlCounts(modal), longTasks: longTasks.filter((entry) => entry.startMs >= clickMs && entry.startMs <= confirmedAtMs),
          resources: summarizeResources(clickMs, confirmedAtMs, 30),
        });
      });
      const pollVisibility = () => {
        if (!modal.isConnected || !modal.classList.contains("active")) return;
        const sampledAtMs = performance.now();
        if (sampledAtMs - activeMs > 10000) {
          emit(`${eventPrefix}-modal-visibility-timeout`, { clickId, elapsedMs: round(sampledAtMs - clickMs) });
          return;
        }
        const sample = visibleSample();
        if (sample.visible && sample.opacity > 0.01 && !firstVisibleScheduled) {
          firstVisibleScheduled = true;
          emitVisibleBoundary("first-visible", sampledAtMs, sample.opacity);
        }
        if (sample.visible && sample.opacity >= 0.99 && !fullyVisibleScheduled) {
          fullyVisibleScheduled = true;
          emitVisibleBoundary("fully-visible", sampledAtMs, sample.opacity);
        }
        if (!fullyVisibleScheduled) frame(pollVisibility);
      };
      frame(pollVisibility);
      afterPaintOpportunity(() => {
        const observedAtMs = performance.now();
        const style = getComputedStyle(modal);
        emit(`${eventPrefix}-modal-after-first-paint`, {
          clickId, modalId, firstPaintObservationMs: round(observedAtMs), clickToFirstPaintObservationMs: round(observedAtMs - clickMs),
          paintBoundary: "two-rAF-after-active", active: modal.classList.contains("active"), opacity: style.opacity,
          overlayTransitionDuration: style.transitionDuration,
          cardTransitionDuration: getComputedStyle(modal.querySelector(".modal-card") || modal).transitionDuration,
          controls: controlCounts(modal), resources: summarizeResources(clickMs, observedAtMs),
        });
      });
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    const timeout = later(() => {
      stopModalObservation();
      emit(`${eventPrefix}-modal-timeout`, { clickId, elapsedMs: round(performance.now() - clickMs) });
    }, 10000);
    pendingModal = { observer, timeout };
    inspect();
  };
  document.addEventListener("click", onClick, true);
  window.addEventListener("pagehide", () => {
    stopModalObservation();
    disposed = true;
    observers.forEach((observer) => observer.disconnect());
    timers.forEach((timer) => clearTimeout(timer));
    frames.forEach((handle) => cancelAnimationFrame(handle));
    document.removeEventListener("click", onClick, true);
  }, { once: true });
}
