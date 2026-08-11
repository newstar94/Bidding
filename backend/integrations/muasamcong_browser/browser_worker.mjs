import readline from "node:readline";

import { chromium } from "playwright";

import { BrowserLookupRuntime } from "./browser_runtime.mjs";


const ALLOWED_ERRORS = new Set([
  "PROCUREMENT_NOT_FOUND",
  "PROCUREMENT_INTERACTION_REQUIRED",
  "PROCUREMENT_TIMEOUT",
  "PROCUREMENT_UPSTREAM_UNAVAILABLE",
  "PROCUREMENT_BROWSER_FAILED",
  "PROCUREMENT_SCHEMA_CHANGED",
  "PROCUREMENT_ADAPTER_UNSUPPORTED",
  "PROCUREMENT_LOOKUP_BUSY",
]);

let runtime = null;


function publicError(error) {
  const message = String(error?.message || "");
  if (ALLOWED_ERRORS.has(message)) return message;
  if (/timeout/i.test(message)) return "PROCUREMENT_TIMEOUT";
  if (/browser|target|page|context/i.test(message)) return "PROCUREMENT_BROWSER_FAILED";
  return "PROCUREMENT_UPSTREAM_UNAVAILABLE";
}


function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}


async function handle(request) {
  const requestId = String(request?.requestId || "");
  if (!requestId) throw new Error("PROCUREMENT_BROWSER_FAILED");
  switch (request.operation) {
    case "initialize": {
      await runtime?.close();
      runtime = new BrowserLookupRuntime({ chromium });
      const result = await runtime.initialize(request.configuration || {});
      return { requestId, ok: true, result };
    }
    case "lookup": {
      if (!runtime) throw new Error("PROCUREMENT_BROWSER_FAILED");
      const code = String(request.code || "").trim().toUpperCase();
      const kind = String(request.kind || "").trim().toUpperCase();
      const pattern = kind === "PLAN" ? /^PL\d{10}$/ : /^IB\d{10}$/;
      if (!pattern.test(code) || !["PLAN", "PACKAGE"].includes(kind)) {
        throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
      }
      return {
        requestId,
        ok: true,
        result: await runtime.lookup(code, kind),
      };
    }
    case "probe": {
      if (!runtime) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return { requestId, ok: true, result: await runtime.probe() };
    }
    case "shutdown": {
      await runtime?.close();
      runtime = null;
      return { requestId, ok: true, result: { closed: true } };
    }
    default:
      throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
  }
}


const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", async (line) => {
  let request = null;
  try {
    request = JSON.parse(line);
    const response = await handle(request);
    send(response);
    if (request.operation === "shutdown") {
      input.close();
      setImmediate(() => process.exit(0));
    }
  } catch (error) {
    send({
      requestId: String(request?.requestId || ""),
      ok: false,
      error: publicError(error),
    });
  }
});

input.on("close", async () => {
  await runtime?.close();
});
