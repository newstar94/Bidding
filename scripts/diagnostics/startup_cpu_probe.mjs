// Opt-in profiler: measurements are diagnostic, not an uninstrumented CI pass.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/measure_startup.mjs")) return loaded;
    let source = String(loaded.source);
    const begin = '  const cpuBefore = hostCpuSnapshot();';
    const finish = '    }, { mode, run });';
    if (!source.includes(begin) || !source.includes(finish)) throw new Error("Startup probe anchors changed");
    source = source.replace(begin, begin + `
  const cpuSession = await page.context().newCDPSession(page);
  await cpuSession.send("Profiler.enable");
  await cpuSession.send("Performance.enable");
  await cpuSession.send("Profiler.start");
`);
    source = source.replace(finish, finish + `
    const { profile } = await cpuSession.send("Profiler.stop");
    const { metrics } = await cpuSession.send("Performance.getMetrics");
    const navigationStart = metrics.find(metric => metric.name === "NavigationStart")?.value;
    await cpuSession.detach();
    const counts = new Map();
    for (const nodeId of profile.samples || []) counts.set(nodeId, (counts.get(nodeId) || 0) + 1);
    const hottest = profile.nodes.map(node => ({
      functionName: node.callFrame.functionName,
      url: node.callFrame.url.split("?")[0], line: node.callFrame.lineNumber,
      samples: counts.get(node.id) || 0,
    })).sort((a, b) => b.samples - a.samples).slice(0, 12);
    const taskSamples = [];
    if (Number.isFinite(navigationStart)) {
      let timestamp = profile.startTime;
      const timedSamples = (profile.samples || []).map((id, index) => {
        timestamp += profile.timeDeltas[index];
        return { id, relativeMs: timestamp / 1000 - navigationStart * 1000 };
      });
      for (const task of browserMetrics.longTasks || []) {
        const hits = new Map();
        for (const sample of timedSamples) {
          if (sample.relativeMs < task.startTime || sample.relativeMs >= task.startTime + task.duration) continue;
          hits.set(sample.id, (hits.get(sample.id) || 0) + 1);
        }
        taskSamples.push({ startTime: task.startTime, duration: task.duration,
          functions: profile.nodes.filter(node => hits.has(node.id)).map(node => ({
            name: node.callFrame.functionName, url: node.callFrame.url.split("?")[0],
            line: node.callFrame.lineNumber, samples: hits.get(node.id),
          })).sort((a, b) => b.samples - a.samples).slice(0, 12) });
      }
    }
    console.error("[DIAG-startup-cpu] " + JSON.stringify({ mode, run,
      longestTaskMs: browserMetrics.longestTaskMs, hottest, taskSamples }));
`);
    console.error("[DIAG-startup-cpu] CPU instrumentation active; not final performance evidence.");
    return { ...loaded, source };
  },
});
