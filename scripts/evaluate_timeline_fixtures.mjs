import fs from "node:fs";
import { buildEffectiveTimeline } from "../frontend/packages/timelineRuleEngine.js";

const fixturePath = process.argv[2];
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const projected = fixtures.map((fixture) => ({
  name: fixture.name,
  rows: buildEffectiveTimeline(fixture.package, fixture.related, fixture.savedEntries).map((row) => ({
    milestoneKey: row.milestoneKey,
    instanceKey: row.instanceKey,
    displayCode: row.displayCode,
    title: row.title,
    applicability: row.applicability,
    applicabilityReason: row.applicabilityReason,
    sourceEntityId: row.sourceEntityId,
    effectiveClosingTime: row.effectiveClosingTime
  }))
}));
process.stdout.write(JSON.stringify(projected));
