import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";

const TARGET_MEGABYTES = Object.freeze([1, 5, 10]);
const SAMPLE_COUNT = Math.max(1, Number(process.env.EXCEL_BENCHMARK_SAMPLES || 3));
const OUTPUT_PATH = path.resolve(
  process.env.EXCEL_BENCHMARK_OUTPUT || "data/logs/excel-parse-benchmark.json",
);
const VENDOR_PATH = path.resolve("views/vendor/xlsx/xlsx.full.min.js");
const WORKER_SOURCE_PATH = "frontend/documents/excelParseWorker.js";
const WORKER_PATH = path.resolve(WORKER_SOURCE_PATH);
const BENCHMARK_ORIGIN = "http://excel-benchmark.local";

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples) {
  return {
    medianMs: Math.round(percentile(samples.map((sample) => sample.durationMs), 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(samples.map((sample) => sample.durationMs), 0.95) * 10) / 10,
    longestTaskMs: Math.round(Math.max(0, ...samples.map((sample) => sample.longestTaskMs)) * 10) / 10,
    maxLongTaskCount: Math.max(0, ...samples.map((sample) => sample.longTaskCount)),
    samples,
  };
}

async function loadSheetJs(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: VENDOR_PATH });
  if (!context.XLSX?.write || !context.XLSX?.utils) {
    throw new Error("Vendored SheetJS did not expose the expected browser API.");
  }
  return context.XLSX;
}

function makeWorkbookBuffer(XLSX, rowCount) {
  const rows = [["STT", "Mã hàng hóa", "Tên hàng hóa", "Số lượng", "Ghi chú"]];
  for (let index = 0; index < rowCount; index += 1) {
    const sequence = index + 1;
    rows.push([
      sequence,
      `HH-${String(sequence).padStart(8, "0")}`,
      `Thiết bị benchmark ${sequence} / mã kiểm tra ${sequence.toString(36).padStart(8, "0")}`,
      (sequence % 97) + 1,
      `Dòng dữ liệu Excel xác định ${sequence.toString(16).padStart(8, "0")}`,
    ]);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Danh sách");
  return Buffer.from(XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: false,
  }));
}

function makeSizedFixture(XLSX, targetMegabytes) {
  const targetBytes = targetMegabytes * 1024 * 1024;
  let rowCount = Math.max(1, Math.round(targetMegabytes * 5_500));
  let buffer = makeWorkbookBuffer(XLSX, rowCount);
  rowCount = Math.max(1, Math.round(rowCount * targetBytes / buffer.byteLength));
  buffer = makeWorkbookBuffer(XLSX, rowCount);
  return { buffer, rowCount, targetBytes };
}

async function benchmarkParse(page, fixturePath, executionMode) {
  return page.evaluate(async ({ path: sourcePath, mode }) => {
    const data = await fetch(sourcePath).then((response) => response.arrayBuffer());
    globalThis.__excelBenchmarkLongTasks.length = 0;
    const startedAt = performance.now();
    let rowCount = 0;
    if (mode === "mainThread") {
      const workbook = globalThis.XLSX.read(data, { type: "array", cellDates: true });
      rowCount = workbook.SheetNames.reduce((total, name) => (
        total + globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[name], {
          header: 1,
          defval: "",
          raw: false,
          blankrows: true,
        }).length
      ), 0);
    } else {
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker("/excelParseWorker.js");
        worker.onmessage = (event) => {
          worker.terminate();
          if (event.data?.ok) resolve(event.data.result);
          else reject(new Error(event.data?.error || "Excel worker failed."));
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message || "Excel worker failed."));
        };
        worker.postMessage({ data, mode: "sheets" }, [data]);
      });
      rowCount = result.reduce((total, sheet) => total + sheet.rows.length, 0);
    }
    const durationMs = performance.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 75));
    const tasks = globalThis.__excelBenchmarkLongTasks.splice(0);
    return {
      durationMs: Math.round(durationMs * 10) / 10,
      longTaskCount: tasks.length,
      longestTaskMs: Math.round(Math.max(0, ...tasks.map((entry) => entry.duration)) * 10) / 10,
      rowCount,
    };
  }, { path: fixturePath, mode: executionMode });
}

const generationStartedAt = performance.now();
const [vendorSource, workerSource] = await Promise.all([
  fs.readFile(VENDOR_PATH, "utf8"),
  fs.readFile(WORKER_PATH, "utf8"),
]);
const XLSX = await loadSheetJs(vendorSource);
const fixtures = TARGET_MEGABYTES.map((target) => makeSizedFixture(XLSX, target));
const fixtureByPath = new Map(fixtures.map((fixture, index) => [
  `/fixture-${TARGET_MEGABYTES[index]}mb.xlsx`,
  fixture,
]));

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage();
  await page.route(`${BENCHMARK_ORIGIN}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/benchmark.html") {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><meta charset="utf-8"><script src="/vendor/xlsx/xlsx.full.min.js"></script>',
      });
      return;
    }
    if (pathname === "/vendor/xlsx/xlsx.full.min.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: vendorSource });
      return;
    }
    if (pathname === "/excelParseWorker.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: workerSource });
      return;
    }
    const fixture = fixtureByPath.get(pathname);
    if (fixture) {
      await route.fulfill({
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: fixture.buffer,
      });
      return;
    }
    await route.abort();
  });
  await page.addInitScript(() => {
    globalThis.__excelBenchmarkLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        globalThis.__excelBenchmarkLongTasks.push(...list.getEntries().map((entry) => ({
          duration: entry.duration,
          startTime: entry.startTime,
        })));
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Duration remains available when the browser lacks Long Tasks support.
    }
  });
  await page.goto(`${BENCHMARK_ORIGIN}/benchmark.html`, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(globalThis.XLSX?.read));

  for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
    const fixture = fixtures[fixtureIndex];
    const targetMegabytes = TARGET_MEGABYTES[fixtureIndex];
    const fixturePath = `/fixture-${targetMegabytes}mb.xlsx`;
    const mainThreadSamples = [];
    const workerSamples = [];
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      mainThreadSamples.push(await benchmarkParse(page, fixturePath, "mainThread"));
      workerSamples.push(await benchmarkParse(page, fixturePath, "worker"));
    }
    results.push({
      targetMegabytes,
      actualBytes: fixture.buffer.byteLength,
      actualMegabytes: Math.round(fixture.buffer.byteLength / 1024 / 1024 * 100) / 100,
      generatedRows: fixture.rowCount + 1,
      mainThread: summarize(mainThreadSamples),
      worker: summarize(workerSamples),
    });
  }
} finally {
  await browser.close();
}

const output = {
  benchmark: "excel-browser-parsing",
  generatedAt: new Date().toISOString(),
  sheetJsVersion: XLSX.version,
  sampleCount: SAMPLE_COUNT,
  generationMs: Math.round((performance.now() - generationStartedAt) * 10) / 10,
  results,
};
await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
