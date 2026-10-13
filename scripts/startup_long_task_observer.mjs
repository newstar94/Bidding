// Self-contained because Playwright serializes this function into the page.
export function installStartupLongTaskObserver() {
  globalThis.__bfStartupLongTasks = [];
  try {
    const append = (entries) => {
      for (const entry of entries) {
        globalThis.__bfStartupLongTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
          attribution: (entry.attribution || []).map((item) => ({
            name: item.name || "",
            containerType: item.containerType || "",
            containerName: item.containerName || "",
            containerSrc: item.containerSrc || "",
          })),
        });
      }
    };
    const observer = new PerformanceObserver((list) => append(list.getEntries()));
    observer.observe({ type: "longtask", buffered: true });
    globalThis.__bfFlushStartupLongTasks = () => append(observer.takeRecords());
  } catch {
    // Browsers without Long Tasks support still report all startup marks.
    globalThis.__bfFlushStartupLongTasks = () => {};
  }
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
