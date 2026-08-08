import { performance } from "node:perf_hooks";

import { BiddingModel } from "../frontend/app/BiddingModel.js";


const SIZES = [100, 1_000, 10_000];

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function benchmarkModel(size) {
  const persisted = Array.from({ length: size }, (_, index) => ({
    id: `package-${index}`,
    value: index,
    name: `Package ${index}`,
  }));
  const model = new BiddingModel();
  model.workspaceScope = { organizationId: "benchmark" };
  model.workspaceStorage = {
    getItem: () => "0",
    writeJson() {},
  };
  model.state.goithau = persisted.map((record) => ({ ...record }));
  model.state.goithau[Math.floor(size / 2)].value += 1;
  model.db = {
    stores: ["goithau"],
    async getTableData() {
      return persisted;
    },
    async putTableData() {},
    async putRecords() {},
    async deleteRecords() {},
    async set() {},
  };
  return model;
}

async function measure(run, iterations) {
  const samples = [];
  await run();
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await run();
    samples.push(performance.now() - startedAt);
  }
  return median(samples);
}

const results = [];
for (const size of SIZES) {
  const iterations = size >= 10_000 ? 5 : size >= 1_000 ? 10 : 20;
  const legacyModel = benchmarkModel(size);
  const explicitModel = benchmarkModel(size);
  const changedRecord = explicitModel.state.goithau[Math.floor(size / 2)];
  const legacyMedianMs = await measure(
    () => legacyModel.persistData("goithau", { throwOnError: true }),
    iterations,
  );
  const explicitMedianMs = await measure(
    () => explicitModel.persistChanges("goithau", {
      upserts: [changedRecord],
      deletions: [],
    }, { throwOnError: true }),
    iterations,
  );
  results.push({
    records: size,
    legacyMedianMs: Number(legacyMedianMs.toFixed(3)),
    explicitMedianMs: Number(explicitMedianMs.toFixed(3)),
    speedup: Number((legacyMedianMs / Math.max(explicitMedianMs, 0.001)).toFixed(1)),
  });
}

console.log(JSON.stringify({ benchmark: "explicit-persistence", results }, null, 2));
