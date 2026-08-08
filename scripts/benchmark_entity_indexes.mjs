import { performance } from "node:perf_hooks";

import { EntityIndexes } from "../frontend/app/EntityIndexes.js";


const RECORD_COUNT = 10_000;
const LOOKUPS = 2_000;
const RUNS = 7;
const records = Array.from({ length: RECORD_COUNT }, (_, index) => ({
  id: `package-${index}`,
  rootId: `root-${Math.floor(index / 4)}`,
  keHoachId: `plan-${index % 100}`,
  phienBan: index % 4,
  isLatest: index % 4 === 3 ? 1 : 0,
}));
const lookupIds = Array.from(
  { length: LOOKUPS },
  (_, index) => `package-${(index * 7919) % RECORD_COUNT}`,
);

function linearLookup() {
  for (const id of lookupIds) {
    const record = records.find((candidate) => candidate.id === id);
    records.filter((candidate) => candidate.rootId === record.rootId);
  }
}

const indexes = new EntityIndexes(() => records);
indexes.byId("goithau");
function indexedLookup() {
  for (const id of lookupIds) {
    const record = indexes.byId("goithau").get(id);
    indexes.byRootId("goithau").get(record.rootId);
  }
}

function median(run) {
  const samples = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return samples.sort((left, right) => left - right)[Math.floor(samples.length / 2)];
}

const linearMs = median(linearLookup);
const indexedMs = median(indexedLookup);
console.log(JSON.stringify({
  records: RECORD_COUNT,
  lookups: LOOKUPS,
  linearMedianMs: Number(linearMs.toFixed(3)),
  indexedMedianMs: Number(indexedMs.toFixed(3)),
  speedup: Number((linearMs / indexedMs).toFixed(1)),
}));
