// Opt-in timeline diagnostic; never substitute its verdict for plain performance CI.
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/scripts/measure_startup.mjs")) return loaded;
    let source = String(loaded.source);
    const begin = "  const cpuBefore = hostCpuSnapshot();";
    const finish = "    }, { mode, run });";
    if (!source.includes(begin) || !source.includes(finish)) throw new Error("Timeline probe anchors changed");
    source = source.replace(begin, begin + `
  const traceSession = await page.context().newCDPSession(page);
  const events = [];
  traceSession.on("Tracing.dataCollected", ({ value }) => {
    for (const event of value) {
      if (event.ph === "X" && event.dur >= 1000 && events.length < 20000) {
        events.push({ name: event.name, ts: event.ts, dur: event.dur, pid: event.pid, tid: event.tid,
          layout: event.name === "Layout" ? {
            dirtyObjects: event.args?.beginData?.dirtyObjects,
            totalObjects: event.args?.beginData?.totalObjects,
            partialLayout: event.args?.beginData?.partialLayout,
            stack: (event.args?.beginData?.stackTrace || []).slice(0, 10).map(frame => ({
              functionName: frame.functionName, url: String(frame.url || "").split("?")[0],
              lineNumber: frame.lineNumber, columnNumber: frame.columnNumber,
            })),
            roots: (event.args?.endData?.layoutRoots || []).map(root => root.nodeId),
          } : undefined });
      }
    }
  });
  await traceSession.send("Tracing.start", {
    categories: "devtools.timeline,v8,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack",
    transferMode: "ReportEvents",
  });
`);
    source = source.replace(finish, finish + `
    const ended = new Promise(resolve => traceSession.once("Tracing.tracingComplete", resolve));
    await traceSession.send("Tracing.end");
    await ended;
    const layouts = events.filter(event => event.name === "Layout" && event.dur >= 50000);
    for (const layout of layouts) {
      layout.nodes = [];
      for (const nodeId of layout.layout?.roots || []) {
        try {
          const { node } = await traceSession.send("DOM.describeNode", { backendNodeId: nodeId });
          const attributes = node.attributes || [];
          const named = {};
          for (let index = 0; index < attributes.length; index += 2) {
            if (["id", "class"].includes(attributes[index])) named[attributes[index]] = attributes[index + 1];
          }
          layout.nodes.push({ nodeName: node.nodeName, attributes: named });
        } catch { layout.nodes.push({ unavailable: true }); }
      }
    }
    await traceSession.detach();
    const longest = [...events].sort((a, b) => b.dur - a.dur).slice(0, 20);
    console.error("[DIAG-startup-timeline] " + JSON.stringify({mode, run,
      longestTaskMs: browserMetrics.longestTaskMs, longest, layouts}));
`);
    console.error("[DIAG-startup-timeline] Instrumented diagnostic, not final CI evidence.");
    return { ...loaded, source };
  },
});
