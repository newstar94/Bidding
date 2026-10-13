// Self-contained because Playwright serializes this function into the page.
export function installStartupLongTaskObserver() {
  globalThis.__bfStartupLongTasks = [];
  const observers = [];
  const append = (entries) => {
    for (const entry of entries) {
      const startTime = Number(entry.startTime);
      const duration = Number(entry.duration);
      if (!Number.isFinite(startTime) || !Number.isFinite(duration)) continue;
      const duplicate = globalThis.__bfStartupLongTasks.some((current) => (
        Math.abs(current.startTime - startTime) < 1
        && Math.abs(current.duration - duration) < 1
      ));
      if (duplicate) continue;
      globalThis.__bfStartupLongTasks.push({
        startTime,
        duration,
        attribution: (entry.attribution || []).map((item) => ({
          name: item.name || "",
          containerType: item.containerType || "",
          containerName: item.containerName || "",
          containerSrc: item.containerSrc || "",
        })),
      });
    }
  };
  const observe = (type, normalize = (entries) => entries) => {
    try {
      const observer = new PerformanceObserver((list) => append(normalize(list.getEntries())));
      observer.observe({ type, buffered: true });
      observers.push({ observer, normalize });
    } catch {
      // Unsupported timing sources are optional; startup marks remain available.
    }
  };
  observe("longtask");
  // Chromium can omit the first document Long Task on a cold renderer. LoAF
  // script timings cover that gap without treating render/layout time or a
  // collection of short tasks as one long task.
  observe("long-animation-frame", (entries) => entries.flatMap((entry) => (
    Array.from(entry.scripts || []).map((script) => ({
      startTime: script.startTime,
      duration: script.duration,
      attribution: [],
    }))
  )));
  globalThis.__bfFlushStartupLongTasks = () => {
    for (const { observer, normalize } of observers) append(normalize(observer.takeRecords()));
  };
}

// Finish the task that contains readiness marks before reading its Long Task
// entry. Drain queued entries even if observer delivery has not run yet.
export async function flushStartupLongTasks() {
  await new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
  globalThis.__bfFlushStartupLongTasks?.();
}
