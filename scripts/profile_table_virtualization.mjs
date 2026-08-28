import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(".");
const ORIGIN = "http://table-benchmark.local";
const SAMPLE_COUNT = Math.max(20, Number(process.env.TABLE_BENCHMARK_SAMPLES || 20));
const WARMUP_COUNT = Math.max(1, Number(process.env.TABLE_BENCHMARK_WARMUPS || 2));
const OUTPUT_PATH = path.resolve(
  process.env.TABLE_BENCHMARK_OUTPUT || "data/logs/table-virtualization-benchmark.json",
);

const scenarios = Object.freeze({
  packageGoods: {
    columns: 7,
    rowHeight: 72,
    productionStrategy: "paginated",
    interactionConstraint: "editable rows use delegated commands and a 10-row data-model page",
  },
  bidderGoods: {
    columns: 19,
    rowHeight: 80,
    productionStrategy: "paginated",
    interactionConstraint: "server/client pageRows already bound the live DOM",
  },
  detailedEvaluation: {
    columns: 8,
    rowHeight: 92,
    chunkSize: 10,
    productionStrategy: "incremental-chunked",
    interactionConstraint: "editable controls and draft collection depend on mounted rows",
  },
  timeline: {
    columns: 10,
    rowHeight: 68,
    chunkSize: 10,
    productionStrategy: "chunked",
    interactionConstraint: "each mounted date input owns a Flatpickr lifecycle",
  },
  contractors: {
    columns: 8,
    rowHeight: 72,
    productionStrategy: "virtualized",
    interactionConstraint: "shared virtualTable utility is already active",
  },
});

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function summarize(samples) {
  return {
    medianMs: Math.round(percentile(samples.map((sample) => sample.durationMs), 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(samples.map((sample) => sample.durationMs), 0.95) * 10) / 10,
    completionP95Ms: Math.round(
      percentile(samples.map((sample) => sample.completionDurationMs), 0.95) * 10,
    ) / 10,
    longestChunkMs: Math.round(
      Math.max(0, ...samples.map((sample) => sample.longestChunkMs || 0)) * 10,
    ) / 10,
    longestTaskMs: Math.round(Math.max(0, ...samples.map((sample) => sample.longestTaskMs)) * 10) / 10,
    maxMountedRows: Math.max(0, ...samples.map((sample) => sample.mountedRows)),
    samples,
  };
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

async function measure(page, { scenario, rowCount, strategy, options }) {
  return page.evaluate(async ({ scenarioName, count, renderStrategy, virtualOptions }) => {
    const { clearVirtualTable, renderVirtualTable } = globalThis.__tableBenchmarkVirtual;
    const { renderChunkedSequence } = globalThis.__tableBenchmarkChunked;
    const { trustedHTML } = globalThis.__tableBenchmarkTrusted;
    const renderRow = (index) => {
      const text = `Dòng ${index + 1} — Nội dung kiểm tra hiệu năng bảng có độ dài thực tế`;
      if (scenarioName === "packageGoods") {
        return `<tr><td>${index + 1}</td><td>L${index % 20}</td><td>${text}</td><td>Thiết bị ${index}</td><td>Cái</td><td><input value="${(index % 97) + 1}"></td><td><button>Sửa</button></td></tr>`;
      }
      if (scenarioName === "bidderGoods") {
        return `<tr>${Array.from({ length: 19 }, (_unused, column) => (
          column > 9 && column < 17
            ? `<td><input value="${index}-${column}"></td>`
            : `<td>${column === 3 ? text : `${index + 1}.${column + 1}`}</td>`
        )).join("")}</tr>`;
      }
      if (scenarioName === "detailedEvaluation") {
        return `<tr><td>${index + 1}</td><td>${text}</td><td><textarea>Nội dung HSDT ${index}</textarea></td><td><input type="radio" name="r${index}"></td><td><input type="radio" name="r${index}"></td><td><select><option>Đạt</option></select></td><td>100</td><td><textarea>Nhận xét ${index}</textarea></td></tr>`;
      }
      if (scenarioName === "timeline") {
        return `<tr><td>${index + 1}</td><td>${text}</td><td><input value="01/08/2026"></td><td><input value="02/08/2026"></td><td><select><option>Áp dụng</option></select></td><td>3 ngày</td><td>Đúng hạn</td><td>${text}</td><td><button>Lưu</button></td><td><button>Xóa</button></td></tr>`;
      }
      return `<tr><td>${index + 1}</td><td>NT-${index}</td><td>${text}</td><td>010${String(index).padStart(7, "0")}</td><td>Độc lập</td><td>Đang hoạt động</td><td>v1</td><td><button>Chi tiết</button></td></tr>`;
    };

    const frame = document.createElement("div");
    frame.className = "table-container benchmark-table-frame";
    frame.innerHTML = trustedHTML("<table><tbody></tbody></table>");
    document.body.replaceChildren(frame);
    const tbody = frame.querySelector("tbody");
    const rows = Array.from({ length: count }, (_unused, index) => index);
    globalThis.__tableBenchmarkLongTasks.length = 0;
    const startedAt = performance.now();
    let chunkDurations = [];
    let completion = null;
    if (renderStrategy === "virtual") {
      renderVirtualTable(tbody, rows, renderRow, virtualOptions);
    } else if (renderStrategy === "chunked") {
      clearVirtualTable(tbody);
      tbody.innerHTML = trustedHTML("");
      completion = renderChunkedSequence(tbody, rows, (chunk) => {
        tbody.insertAdjacentHTML("beforeend", trustedHTML(chunk.map(renderRow).join("")));
      }, {
        chunkSize: Math.max(1, Number(virtualOptions.chunkSize) || 10),
        budgetMs: 12,
        onChunk: ({ durationMs }) => chunkDurations.push(durationMs),
      });
    } else if (renderStrategy === "paginated") {
      clearVirtualTable(tbody);
      tbody.innerHTML = trustedHTML(rows.slice(0, 10).map(renderRow).join(""));
    } else {
      clearVirtualTable(tbody);
      tbody.innerHTML = trustedHTML(rows.map(renderRow).join(""));
    }
    void tbody.offsetHeight;
    const durationMs = performance.now() - startedAt;
    if (completion) await completion;
    const completionDurationMs = performance.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 75));
    const taskWindowEnd = performance.now();
    const tasks = globalThis.__tableBenchmarkLongTasks.splice(0).filter((entry) => (
      entry.startTime <= taskWindowEnd
      && entry.startTime + entry.duration >= startedAt
    ));
    return {
      durationMs: Math.round(durationMs * 10) / 10,
      completionDurationMs: Math.round(completionDurationMs * 10) / 10,
      longestChunkMs: Math.round(Math.max(0, ...chunkDurations) * 10) / 10,
      longestTaskMs: Math.round(Math.max(0, ...tasks.map((entry) => entry.duration)) * 10) / 10,
      mountedRows: tbody.querySelectorAll("tr:not(.virtual-spacer)").length,
    };
  }, {
    scenarioName: scenario,
    count: rowCount,
    renderStrategy: strategy,
    virtualOptions: options,
  });
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const openStrategyPage = async () => {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (route) => {
      const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
      if (pathname === "/benchmark.html") {
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" data-runtime-styles href="/empty.css"><style>.benchmark-table-frame{height:520px;max-height:520px;overflow:auto}table{width:100%;border-collapse:collapse}td{padding:8px;border:1px solid #ddd}input,select,textarea{width:100%;box-sizing:border-box}</style>',
        });
        return;
      }
      if (pathname === "/empty.css") {
        await route.fulfill({ contentType: "text/css", body: "" });
        return;
      }
      const relativePath = pathname.replace(/^\/+/, "");
      const filePath = path.resolve(ROOT, relativePath);
      if (filePath !== ROOT && filePath.startsWith(`${ROOT}${path.sep}`)) {
        try {
          await route.fulfill({
            contentType: contentType(filePath),
            body: await fs.readFile(filePath),
          });
          return;
        } catch {
          // Unknown benchmark resource is rejected below.
        }
      }
      await route.abort();
    });
    await page.addInitScript(() => {
      globalThis.__tableBenchmarkLongTasks = [];
      try {
        const observer = new PerformanceObserver((list) => {
          globalThis.__tableBenchmarkLongTasks.push(...list.getEntries().map((entry) => ({
            duration: entry.duration,
            startTime: entry.startTime,
          })));
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Render durations remain available without Long Tasks support.
      }
    });
    await page.goto(`${ORIGIN}/benchmark.html`, { waitUntil: "load" });
    await page.evaluate(async () => {
      [
        globalThis.__tableBenchmarkVirtual,
        globalThis.__tableBenchmarkTrusted,
        globalThis.__tableBenchmarkChunked,
      ] = await Promise.all([
        import("/frontend/shared/virtualTable.js"),
        import("/frontend/shared/trustedTypes.js"),
        import("/frontend/shared/ChunkedRenderer.js"),
      ]);
    });
    return page;
  };

  for (const [scenario, config] of Object.entries(scenarios)) {
    const rowCounts = [100, 500, 1000];
    for (const rowCount of rowCounts) {
      const fullSamples = [];
      const virtualSamples = [];
      const optimizedSamples = [];
      const optimizedStrategy = config.productionStrategy === "incremental-chunked"
        || config.productionStrategy === "chunked"
        ? "chunked"
        : config.productionStrategy === "paginated"
          ? "paginated"
          : config.productionStrategy === "virtualized"
            ? "virtual"
            : "full";
      const virtualOptions = {
        threshold: 80,
        rowHeight: config.rowHeight,
        overscan: 8,
        colSpan: config.columns,
        chunkSize: config.chunkSize,
      };
      const collectSamples = async (strategy, options, target) => {
        const page = await openStrategyPage();
        try {
          for (let sample = -WARMUP_COUNT; sample < SAMPLE_COUNT; sample += 1) {
            const result = await measure(page, { scenario, rowCount, strategy, options });
            if (sample >= 0) target.push(result);
          }
        } finally {
          await page.close();
        }
      };
      // Keep strategies in separate blocks. Interleaving a 1,000-row full DOM
      // replacement with optimized samples lets delayed GC/style work from the
      // baseline contaminate the following strategy's Long Tasks window.
      await collectSamples("full", {}, fullSamples);
      await collectSamples("virtual", virtualOptions, virtualSamples);
      await collectSamples(optimizedStrategy, virtualOptions, optimizedSamples);
      const full = summarize(fullSamples);
      const virtual = summarize(virtualSamples);
      const optimized = summarize(optimizedSamples);
      results.push({
        scenario,
        rowCount,
        productionStrategy: config.productionStrategy,
        interactionConstraint: config.interactionConstraint,
        full,
        virtual,
        optimizedStrategy,
        optimized,
        initialRenderSpeedup: virtual.medianMs > 0
          ? Math.round(full.medianMs / virtual.medianMs * 10) / 10
          : null,
      });
    }
  }
} finally {
  await browser.close();
}

const output = {
  benchmark: "shared-table-virtualization",
  generatedAt: new Date().toISOString(),
  releaseId: process.env.RELEASE_ID || execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim(),
  worktreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim()),
  environment: {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model || "unknown",
    logicalCpuCount: os.cpus().length,
    node: process.version,
    browser: `Chromium ${browser.version()}`,
    headless: true,
    buildMode: "source-module benchmark",
  },
  sampleCount: SAMPLE_COUNT,
  warmupCount: WARMUP_COUNT,
  rowCounts: [100, 500, 1000],
  results,
};
await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
