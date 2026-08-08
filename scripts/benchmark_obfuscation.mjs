import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import JavaScriptObfuscator from "javascript-obfuscator";

const ROOT = path.resolve(".");
const ORIGIN = "http://obfuscation-benchmark.local";
const SAMPLE_COUNT = Math.max(1, Number(process.env.OBFUSCATION_BENCHMARK_SAMPLES || 5));
const OUTPUT_PATH = path.resolve(
  process.env.OBFUSCATION_BENCHMARK_OUTPUT || "data/logs/obfuscation-benchmark.json",
);

const COMMON_OPTIONS = Object.freeze({
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjectionThreshold: 0.02,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  sourceMap: false,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: false,
  stringArrayEncoding: [],
  stringArrayThreshold: 0.35,
  target: "browser-no-eval",
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  seed: 794012026,
});

const variants = Object.freeze({
  on: Object.freeze({ ...COMMON_OPTIONS, deadCodeInjection: true }),
  off: Object.freeze({ ...COMMON_OPTIONS, deadCodeInjection: false }),
});

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples) {
  return {
    count: samples.length,
    medianMs: Math.round(percentile(samples.map((sample) => sample.startupMs), 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(samples.map((sample) => sample.startupMs), 0.95) * 10) / 10,
    longestTaskMs: Math.round(Math.max(0, ...samples.map((sample) => sample.longestTaskMs)) * 10) / 10,
    samples,
  };
}

function contentType(filePath) {
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

async function runBuild(outputDirectory) {
  const vitePath = path.resolve("node_modules/vite/bin/vite.js");
  const startedAt = performance.now();
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      vitePath,
      "build",
      "--mode",
      "production",
      "--outDir",
      outputDirectory,
      "--emptyOutDir",
    ], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Vite benchmark build failed (${code}).\n${stdout}\n${stderr}`));
    });
  });
  return { durationMs: performance.now() - startedAt, ...output };
}

async function listJavaScriptFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listJavaScriptFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) result.push(target);
  }
  return result;
}

async function transformVariant(baseDirectory, targetDirectory, options) {
  await fs.cp(baseDirectory, targetDirectory, { recursive: true });
  const files = await listJavaScriptFiles(targetDirectory);
  const startedAt = performance.now();
  for (const file of files) {
    const input = await fs.readFile(file, "utf8");
    const output = JavaScriptObfuscator.obfuscate(input, options).getObfuscatedCode();
    await fs.writeFile(file, output, "utf8");
  }
  const durationMs = performance.now() - startedAt;
  let jsBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const code = await fs.readFile(file);
    jsBytes += code.byteLength;
    gzipBytes += gzipSync(code, { level: 9 }).byteLength;
  }
  return { durationMs, jsBytes, gzipBytes, fileCount: files.length };
}

function benchmarkHtml(indexSource, variant, entryFile) {
  const source = indexSource
    .replace(/<link\s+rel="modulepreload"[^>]*>\s*/gi, "")
    .replace(/__BF_(?:WORKSPACE_PRELOAD|INITIAL_ROUTE_PRELOAD|CANONICAL_LINK)__/g, "")
    .replace(/<script\s+type="module"\s+src="\/frontend\/app\/app\.js[^>]*><\/script>/i, "")
    .replace("__BF_SESSION_BOOTSTRAP__", '{"valid":false}')
    .replace("__BF_PAGE_TITLE__", "Obfuscation benchmark")
    .replace("__BF_PAGE_DESCRIPTION__", "Obfuscation benchmark")
    .replace("__GOOGLE_CLIENT_ID__", "")
    .replace("__TURNSTILE_ENABLED__", "false")
    .replace("__TURNSTILE_SITE_KEY__", "");
  const instrumentation = `<script>
    globalThis.__obfuscationBenchmarkStartedAt = performance.now();
    globalThis.__obfuscationBenchmarkLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        globalThis.__obfuscationBenchmarkLongTasks.push(...list.getEntries().map((entry) => ({ duration: entry.duration })));
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {}
  </script>`;
  const runner = `<script type="module">
    try {
      await import("/bench/${variant}/${entryFile}");
      const finish = () => requestAnimationFrame(() => requestAnimationFrame(() => {
        globalThis.__obfuscationBenchmarkDone = {
          startupMs: performance.now() - globalThis.__obfuscationBenchmarkStartedAt,
          error: ""
        };
      }));
      if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", finish, { once: true });
      else finish();
    } catch (error) {
      globalThis.__obfuscationBenchmarkDone = {
        startupMs: performance.now() - globalThis.__obfuscationBenchmarkStartedAt,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  </script>`;
  return source.replace("<head>", `<head>${instrumentation}`).replace("</body>", `${runner}</body>`);
}

async function measureNavigation(page, variant, mode, run) {
  await page.goto(`${ORIGIN}/?variant=${variant}&mode=${mode}&run=${run}`, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(globalThis.__obfuscationBenchmarkDone), null, {
    timeout: 60_000,
  });
  const result = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 75));
    const value = globalThis.__obfuscationBenchmarkDone;
    const tasks = globalThis.__obfuscationBenchmarkLongTasks || [];
    return {
      startupMs: Math.round(value.startupMs * 10) / 10,
      longestTaskMs: Math.round(Math.max(0, ...tasks.map((entry) => entry.duration)) * 10) / 10,
      longTaskCount: tasks.length,
      error: value.error,
    };
  });
  if (result.error) throw new Error(`${variant} startup failed: ${result.error}`);
  return { mode, run, ...result };
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "biddingflow-obfuscation-"));
const baseDirectory = path.join(tempRoot, "base");
const variantDirectories = {
  on: path.join(tempRoot, "on"),
  off: path.join(tempRoot, "off"),
};

try {
  const viteConfig = await fs.readFile(path.join(ROOT, "vite.config.js"), "utf8");
  if (!/deadCodeInjection:\s*true/.test(viteConfig) || !/deadCodeInjectionThreshold:\s*0\.02/.test(viteConfig)) {
    throw new Error("Secure production obfuscation settings changed; update the benchmark deliberately.");
  }
  const build = await runBuild(baseDirectory);
  const transformResults = {};
  for (const [name, options] of Object.entries(variants)) {
    transformResults[name] = await transformVariant(
      baseDirectory,
      variantDirectories[name],
      options,
    );
  }

  const manifest = JSON.parse(await fs.readFile(
    path.join(baseDirectory, ".vite", "manifest.json"),
    "utf8",
  ));
  const entryFile = manifest["frontend/app/app.js"]?.file;
  if (!entryFile) throw new Error("Benchmark build manifest has no application entry.");
  const indexSource = await fs.readFile(path.join(ROOT, "views", "index.html"), "utf8");

  const browser = await chromium.launch({ headless: true });
  const startupResults = {};
  try {
    const context = await browser.newContext();
    const routeHandler = async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") {
        const variant = url.searchParams.get("variant") === "off" ? "off" : "on";
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          headers: { "Cache-Control": "no-store" },
          body: benchmarkHtml(indexSource, variant, entryFile),
        });
        return;
      }
      const variantMatch = /^\/bench\/(on|off)\/(.+)$/.exec(url.pathname);
      let filePath = "";
      if (variantMatch) {
        filePath = path.resolve(variantDirectories[variantMatch[1]], variantMatch[2]);
      } else if (url.pathname.startsWith("/css/")) {
        filePath = path.resolve(ROOT, "views", url.pathname.slice(1));
      } else if (url.pathname.startsWith("/vendor/")) {
        filePath = path.resolve(ROOT, "views", url.pathname.slice(1));
      }
      if (filePath) {
        try {
          const body = await fs.readFile(filePath);
          await route.fulfill({
            body,
            contentType: contentType(filePath),
            headers: { "Cache-Control": "public, max-age=3600" },
          });
          return;
        } catch {
          // Missing optional assets are rejected below.
        }
      }
      if (url.pathname === "/api/public/packages") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '{"packages":[]}',
        });
        return;
      }
      await route.abort();
    };
    await context.route(`${ORIGIN}/**`, routeHandler);

    for (const variant of Object.keys(variants)) {
      const cold = [];
      for (let run = 1; run <= SAMPLE_COUNT; run += 1) {
        const coldContext = await browser.newContext();
        await coldContext.route(`${ORIGIN}/**`, routeHandler);
        const page = await coldContext.newPage();
        cold.push(await measureNavigation(page, variant, "cold", run));
        await coldContext.close();
      }
      const warmPage = await context.newPage();
      await measureNavigation(warmPage, variant, "warmup", 0);
      const warm = [];
      for (let run = 1; run <= SAMPLE_COUNT; run += 1) {
        warm.push(await measureNavigation(warmPage, variant, "warm", run));
      }
      await warmPage.close();
      startupResults[variant] = { cold: summarize(cold), warm: summarize(warm) };
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const output = {
    benchmark: "dead-code-injection-ab",
    generatedAt: new Date().toISOString(),
    sampleCount: SAMPLE_COUNT,
    baseBuildMs: Math.round(build.durationMs * 10) / 10,
    variants: Object.fromEntries(Object.keys(variants).map((name) => [name, {
      deadCodeInjection: variants[name].deadCodeInjection,
      transformMs: Math.round(transformResults[name].durationMs * 10) / 10,
      effectiveBuildMs: Math.round((build.durationMs + transformResults[name].durationMs) * 10) / 10,
      jsBytes: transformResults[name].jsBytes,
      gzipBytes: transformResults[name].gzipBytes,
      fileCount: transformResults[name].fileCount,
      ...startupResults[name],
    }])),
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
