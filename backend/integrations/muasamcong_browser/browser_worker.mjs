import readline from "node:readline";

import { chromium } from "playwright";
import puppeteer from "puppeteer";

import { BrowserLookupRuntime } from "./browser_runtime.mjs";
import { MscIntegrationRuntime } from "./integration_runtime.mjs";


const ALLOWED_ERRORS = new Set([
  "PROCUREMENT_NOT_FOUND",
  "PROCUREMENT_INTERACTION_REQUIRED",
  "PROCUREMENT_TIMEOUT",
  "PROCUREMENT_UPSTREAM_UNAVAILABLE",
  "PROCUREMENT_BROWSER_FAILED",
  "PROCUREMENT_SCHEMA_CHANGED",
  "PROCUREMENT_ADAPTER_UNSUPPORTED",
  "PROCUREMENT_LOOKUP_BUSY",
  "PROCUREMENT_SESSION_FAILED",
  "PROCUREMENT_ENDPOINT_CHANGED",
]);

let runtime = null;
let integration = null;
let runtimeConfiguration = null;


async function fallbackRuntime() {
  if (runtime) return runtime;
  runtime = new BrowserLookupRuntime({ chromium });
  await runtime.initialize(runtimeConfiguration || {});
  return runtime;
}


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
      integration?.close();
      runtime = null;
      integration = new MscIntegrationRuntime({ puppeteer });
      const configuration = { ...(request.configuration || {}) };
      configuration.fallbackBrowserExecutablePath = chromium.executablePath();
      runtimeConfiguration = configuration;
      const msc = integration.initialize(configuration);
      return {
        requestId,
        ok: true,
        result: {
          ready: true,
          browserStartupMs: 0,
          browserFallback: "lazy",
          integration: msc,
        },
      };
    }
    case "lookup": {
      if (!runtime) throw new Error("PROCUREMENT_BROWSER_FAILED");
      const code = String(request.code || "").trim().toUpperCase();
      const kind = String(request.kind || "").trim().toUpperCase();
      const pattern = kind === "PLAN" ? /^PL\d{10}$/ : /^IB\d{10}$/;
      if (!pattern.test(code) || !["PLAN", "PACKAGE"].includes(kind)) {
        throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
      }
      const browser = await fallbackRuntime();
      return {
        requestId,
        ok: true,
        result: await browser.lookup(code, kind),
      };
    }
    case "probe": {
      const browser = await fallbackRuntime();
      return { requestId, ok: true, result: await browser.probe() };
    }
    case "listPlanRevisions": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return {
        requestId,
        ok: true,
        result: await integration.listPlanRevisions(String(request.planNo || "")),
      };
    }
    case "getPlanRevision": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return {
        requestId,
        ok: true,
        result: await integration.getPlanRevision(
          String(request.planNo || ""),
          String(request.revisionId || ""),
        ),
      };
    }
    case "listNoticeRevisions": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return {
        requestId,
        ok: true,
        result: await integration.listNoticeRevisions(String(request.noticeNo || "")),
      };
    }
    case "getNoticeRevision": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return {
        requestId,
        ok: true,
        result: await integration.getNoticeRevision(
          String(request.noticeNo || ""),
          String(request.revisionId || ""),
        ),
      };
    }
    case "getOpeningBundle": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return {
        requestId,
        ok: true,
        result: await integration.getOpeningBundle(
          String(request.noticeNo || ""),
          String(request.revisionId || ""),
        ),
      };
    }
    case "search": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return {
        requestId,
        ok: true,
        result: await integration.search(
          String(request.code || ""),
          String(request.kind || ""),
        ),
      };
    }
    case "beginUserRetry": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return { requestId, ok: true, result: integration.beginUserRetry() };
    }
    case "getResultBundle": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return {
        requestId,
        ok: true,
        result: await integration.getResultBundle(
          String(request.noticeNo || ""),
          String(request.revisionId || ""),
        ),
      };
    }
    case "collectCompleteBundle": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      const record = request.record;
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
      }
      return {
        requestId,
        ok: true,
        result: await integration.collectCompleteBundle(record, {
          detailLevel: request.detailLevel,
          revisionMode: request.revisionMode,
          revisionNumbers: request.revisionNumbers,
          searchSource: request.searchSource,
        }),
      };
    }
    case "refreshSession": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return { requestId, ok: true, result: await integration.refreshSession() };
    }
    case "integrationHealth": {
      if (!integration) throw new Error("PROCUREMENT_BROWSER_FAILED");
      const health = integration.health();
      try {
        const probe = runtime ? await runtime.probe() : null;
        const frontendStatus = probe?.driverCandidate
          ? (probe.interactionRequired ? "PARTIAL" : "UP")
          : "NOT_PROBED";
        return {
          requestId,
          ok: true,
          result: {
            ...health,
            status: health.status === "UP" ? "UP" : health.status,
            browserFallback: { launched: Boolean(runtime) },
            frontend: {
              status: frontendStatus,
              framework: probe?.framework || "unknown",
              driverCandidate: probe?.driverCandidate || null,
              interactionRequired: Boolean(probe?.interactionRequired),
              capabilities: {
                ...(probe?.capabilities || {}),
                protectedApi: health.api?.status === "UP",
                networkJson: true,
              },
            },
          },
        };
      } catch {
        return {
          requestId,
          ok: true,
          result: {
            ...health,
            status: health.status === "UP" ? "FRONTEND_CHANGED" : health.status,
            browserFallback: { launched: Boolean(runtime) },
            frontend: {
              status: "FRONTEND_CHANGED",
              framework: "unknown",
              driverCandidate: null,
              interactionRequired: false,
              capabilities: {},
            },
          },
        };
      }
    }
    case "shutdown": {
      await runtime?.close();
      integration?.close();
      runtime = null;
      integration = null;
      runtimeConfiguration = null;
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
  integration?.close();
});
