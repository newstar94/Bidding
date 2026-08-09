import assert from "node:assert/strict";
import test from "node:test";

import { summarizeStartupLongTasks } from "../../scripts/profile_startup_long_tasks.mjs";

test("startup profiler identifies exact over-budget phases and bounded resource paths", () => {
  const report = {
    thresholds: { longTaskLimitMs: 100 },
    cold: {
      samples: [
        {
          mode: "cold",
          run: 10,
          hostCpuBusyPercent: 46.7,
          longTasks: [{
            startTime: 287,
            duration: 145,
            phase: "document-bootstrap",
            overlappingResources: [
              { name: "http://127.0.0.1:8012/dist/assets/font-a.woff2", initiatorType: "css" },
            ],
          }],
        },
        {
          mode: "cold",
          run: 11,
          longTasks: [{ startTime: 229, duration: 98, phase: "document-bootstrap" }],
        },
      ],
    },
    warm: {
      samples: [{
        mode: "warm",
        run: 1,
        longTasks: [{ startTime: 20, duration: 51, phase: "app-bootstrap" }],
      }],
    },
  };

  assert.deepEqual(summarizeStartupLongTasks(report), {
    limitMs: 100,
    totalTaskCount: 3,
    overBudgetCount: 1,
    longestTaskMs: 145,
    phaseCounts: {
      "app-bootstrap": 1,
      "document-bootstrap": 2,
    },
    overBudgetTasks: [{
      mode: "cold",
      run: 10,
      startTime: 287,
      duration: 145,
      phase: "document-bootstrap",
      hostCpuBusyPercent: 46.7,
      overlappingResources: [{
        path: "/dist/assets/font-a.woff2",
        initiatorType: "css",
      }],
    }],
  });
});

test("startup profiler keeps the reviewed 100 ms budget when input omits thresholds", () => {
  const summary = summarizeStartupLongTasks({
    cold: { samples: [] },
    warm: { samples: [] },
  });

  assert.equal(summary.limitMs, 100);
  assert.equal(summary.overBudgetCount, 0);
  assert.equal(summary.longestTaskMs, 0);
});
