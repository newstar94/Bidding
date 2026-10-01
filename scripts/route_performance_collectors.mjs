// Both exports are self-contained so Playwright can serialize them into the
// measured page without importing application code or changing its load path.
export function installRoutePerformanceCollectors() {
  const previous = globalThis.__bfRoutePerformanceCollector;
  for (const observer of Object.values(previous?.observers || {})) {
    observer.disconnect();
  }

  const collector = {
    observers: {},
    observerStatus: {},
    errors: [],
    longTasks: [],
    longAnimationFrames: [],
  };
  globalThis.__bfRoutePerformanceCollector = collector;
  globalThis.__bfRouteLongTasks = collector.longTasks;
  globalThis.__bfRouteLongAnimationFrames = collector.longAnimationFrames;

  const appendLongTasks = (entries) => {
    for (const entry of entries) {
      collector.longTasks.push({
        name: entry.name,
        duration: entry.duration,
        startTime: entry.startTime,
        attribution: [...(entry.attribution || [])].map((item) => ({
          name: item.name,
          containerType: item.containerType,
          containerName: item.containerName,
          containerSrc: item.containerSrc,
          containerId: item.containerId,
        })),
      });
    }
  };
  const appendLongAnimationFrames = (entries) => {
    for (const entry of entries) {
      collector.longAnimationFrames.push({
        duration: entry.duration,
        startTime: entry.startTime,
        blockingDuration: entry.blockingDuration,
        renderStart: entry.renderStart,
        styleAndLayoutStart: entry.styleAndLayoutStart,
        scripts: [...(entry.scripts || [])].map((script) => ({
          invoker: script.invoker,
          invokerType: script.invokerType,
          sourceURL: script.sourceURL,
          sourceFunctionName: script.sourceFunctionName,
          duration: script.duration,
          executionStart: script.executionStart,
          forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
        })),
      });
    }
  };
  const entryTypes = [
    ["longtask", appendLongTasks],
    ["long-animation-frame", appendLongAnimationFrames],
  ];
  collector.validate = () => {
    const failures = [...collector.errors];
    for (const [type] of entryTypes) {
      if (!collector.observerStatus[type]?.installed
        || typeof collector.observers[type]?.takeRecords !== "function") {
        failures.push(`${type} collector is not installed`);
      }
    }
    if (failures.length) {
      throw new Error(`Invalid route performance collection: ${failures.join("; ")}`);
    }
  };
  collector.snapshot = (observationEndMs) => {
    collector.validate();
    for (const [type, append] of entryTypes) {
      // takeRecords empties the same buffer consumed by callbacks, so merging
      // through one path neither loses pending records nor duplicates them.
      append(collector.observers[type].takeRecords());
    }
    return {
      observerStatus: Object.fromEntries(entryTypes.map(([type]) => (
        [type, { ...collector.observerStatus[type] }]
      ))),
      longTasks: collector.longTasks.filter((entry) => entry.startTime <= observationEndMs),
      longAnimationFrames: collector.longAnimationFrames
        .filter((entry) => entry.startTime <= observationEndMs),
    };
  };

  if (typeof PerformanceObserver !== "function") {
    collector.errors.push("PerformanceObserver is unavailable");
    return;
  }
  const supported = PerformanceObserver.supportedEntryTypes || [];
  for (const [type, append] of entryTypes) {
    const status = { supported: supported.includes(type), installed: false };
    collector.observerStatus[type] = status;
    if (!status.supported) {
      collector.errors.push(`${type} is unsupported`);
      continue;
    }
    try {
      const observer = new PerformanceObserver((list) => append(list.getEntries()));
      collector.observers[type] = observer;
      observer.observe({ type, buffered: true });
      status.installed = true;
    } catch (error) {
      collector.errors.push(`${type} observation failed: ${error.message || String(error)}`);
    }
  }
}

export async function waitForRoutePerformanceSnapshot({ settleTimeoutMs = 5000 } = {}) {
  const collector = globalThis.__bfRoutePerformanceCollector;
  if (typeof collector?.validate !== "function" || typeof collector?.snapshot !== "function") {
    throw new Error("Route performance collector is missing");
  }
  collector.validate();
  if (typeof requestAnimationFrame !== "function") {
    throw new Error("Route performance snapshot requires requestAnimationFrame");
  }
  const readyMs = Math.round(performance.now() * 100) / 100;
  const observationEndMs = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Route performance rendering boundary timed out"));
    }, settleTimeoutMs);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // The second frame follows the first render. Freeze the gate here;
      // waiting for delivery must not keep expanding the measured window.
      const cutoff = performance.now();
      setTimeout(() => {
        clearTimeout(timeout);
        resolve(cutoff);
      }, 0);
    }));
  });
  return {
    readyMs,
    observationEndMs,
    ...collector.snapshot(observationEndMs),
  };
}
