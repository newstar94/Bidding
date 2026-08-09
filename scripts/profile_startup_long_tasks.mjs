import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STARTUP_LONG_TASK_LIMIT_MS = 100;

const resourcePath = (value) => {
  try {
    return new URL(String(value || ""), "http://localhost").pathname;
  } catch {
    return "unknown";
  }
};

export function summarizeStartupLongTasks(report = {}) {
  const configuredLimit = Number(report?.thresholds?.longTaskLimitMs);
  const limitMs = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : STARTUP_LONG_TASK_LIMIT_MS;
  const samples = [
    ...(Array.isArray(report?.cold?.samples) ? report.cold.samples : []),
    ...(Array.isArray(report?.warm?.samples) ? report.warm.samples : []),
  ];
  const tasks = samples.flatMap((sample) => (
    Array.isArray(sample?.longTasks)
      ? sample.longTasks.map((task) => ({ sample, task }))
      : []
  ));
  const phaseCounts = {};
  tasks.forEach(({ task }) => {
    const phase = String(task?.phase || "unknown");
    phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
  });
  const orderedPhaseCounts = Object.fromEntries(
    Object.entries(phaseCounts).sort(([left], [right]) => left.localeCompare(right)),
  );
  const overBudgetTasks = tasks
    .filter(({ task }) => Number(task?.duration || 0) > limitMs)
    .sort((left, right) => Number(right.task.duration) - Number(left.task.duration))
    .map(({ sample, task }) => ({
      mode: String(sample?.mode || "unknown"),
      run: Number(sample?.run || 0),
      startTime: Number(task?.startTime || 0),
      duration: Number(task?.duration || 0),
      phase: String(task?.phase || "unknown"),
      hostCpuBusyPercent: Number(sample?.hostCpuBusyPercent || 0),
      overlappingResources: (Array.isArray(task?.overlappingResources)
        ? task.overlappingResources
        : []).map((resource) => ({
        path: resourcePath(resource?.name),
        initiatorType: String(resource?.initiatorType || "unknown"),
      })),
    }));

  return {
    limitMs,
    totalTaskCount: tasks.length,
    overBudgetCount: overBudgetTasks.length,
    longestTaskMs: Math.max(0, ...tasks.map(({ task }) => Number(task?.duration || 0))),
    phaseCounts: orderedPhaseCounts,
    overBudgetTasks,
  };
}

const isCli = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const reportPath = path.resolve(process.argv[2] || "data/logs/startup-performance.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  console.log(JSON.stringify(summarizeStartupLongTasks(report), null, 2));
}
