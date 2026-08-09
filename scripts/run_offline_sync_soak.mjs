import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_RUNS = 5;
const MAX_RUNS = 50;


export function normalizeOfflineSyncSoakRuns(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_RUNS;
  const runs = Number(value);
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    throw new Error(`Offline sync soak runs must be between 1 and ${MAX_RUNS}.`);
  }
  return runs;
}


export function runOfflineSyncSoak({ runs = DEFAULT_RUNS, runOnce } = {}) {
  const normalizedRuns = normalizeOfflineSyncSoakRuns(runs);
  if (typeof runOnce !== "function") throw new TypeError("runOnce must be a function.");
  for (let run = 1; run <= normalizedRuns; run += 1) {
    const execution = runOnce(run, normalizedRuns) || {};
    if (execution.status !== 0) {
      return {
        ok: false,
        runs: normalizedRuns,
        completed: run - 1,
        failedRun: run,
        status: Number.isInteger(execution.status) ? execution.status : 1,
      };
    }
  }
  return { ok: true, runs: normalizedRuns, completed: normalizedRuns };
}


const isCli = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const runs = normalizeOfflineSyncSoakRuns(
    process.argv[2] || process.env.OFFLINE_SYNC_SOAK_RUNS,
  );
  const result = runOfflineSyncSoak({
    runs,
    runOnce: (run, total) => {
      process.stdout.write(`Offline sync soak ${run}/${total}\n`);
      return spawnSync(
        process.execPath,
        ["--env-file-if-exists=.env", "scripts/verify_offline_sync_e2e.mjs"],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: "inherit",
          windowsHide: true,
        },
      );
    },
  });
  if (!result.ok) {
    process.stderr.write(
      `Offline sync soak failed on run ${result.failedRun}/${result.runs}.\n`,
    );
    process.exitCode = result.status || 1;
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
