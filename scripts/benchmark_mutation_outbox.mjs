import { performance } from "node:perf_hooks";

import { WorkspaceMutationOutbox } from "../frontend/app/WorkspaceMutationOutbox.js";


class CloneOnPersistStore {
  persist(queue, localDeletions) {
    this.value = structuredClone({ queue, localDeletions });
  }

  async hydrate() {
    return this.value || { queue: null, localDeletions: [] };
  }

  async flush() {}
}


function makeRecord(index, payloadSize) {
  return {
    id: `record-${index}`,
    name: `Record ${index}`,
    payload: "x".repeat(payloadSize),
    rowVersion: index + 1,
  };
}


function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}


function runLegacy(records) {
  let queue = {
    baseSyncVersion: "0",
    clientMutationId: "legacy",
    dirtyTables: {},
    upserts: {},
    deletes: [],
    revision: 0,
  };
  let durableEnvelope = null;
  records.forEach((record) => {
    const next = cloneJson(queue);
    if (!next.upserts.kehoach) next.upserts.kehoach = {};
    next.upserts.kehoach[record.id] = structuredClone(record);
    next.revision += 1;
    queue = cloneJson(next);
    durableEnvelope = structuredClone({ queue, localDeletions: [] });
  });
  return durableEnvelope;
}


function runDeepModule(records) {
  let id = 0;
  const outbox = new WorkspaceMutationOutbox({
    store: new CloneOnPersistStore(),
    createId: () => `mutation-${++id}`,
    normalizeRecord: (record) => structuredClone(record),
    serializeRecord: (record) => structuredClone(record),
  });
  records.forEach((record) => {
    outbox.enqueue({ kind: "upsert", table: "kehoach", records: [record] });
  });
  return outbox;
}


function measure(operation, warmups = 2, samples = 7) {
  for (let index = 0; index < warmups; index += 1) operation();
  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    globalThis.gc?.();
    const startedAt = performance.now();
    operation();
    durations.push(performance.now() - startedAt);
  }
  durations.sort((left, right) => left - right);
  return durations[Math.floor(durations.length / 2)];
}


const scenarios = [
  { records: 100, payloadSize: 256 },
  { records: 500, payloadSize: 256 },
  { records: 1_000, payloadSize: 256 },
];

const results = scenarios.map((scenario) => {
  const records = Array.from(
    { length: scenario.records },
    (_, index) => makeRecord(index, scenario.payloadSize),
  );
  const legacyMs = measure(() => runLegacy(records));
  const deepModuleMs = measure(() => runDeepModule(records));
  return {
    ...scenario,
    legacyMs: Number(legacyMs.toFixed(2)),
    deepModuleMs: Number(deepModuleMs.toFixed(2)),
    speedup: Number((legacyMs / deepModuleMs).toFixed(2)),
  };
});

console.table(results);
