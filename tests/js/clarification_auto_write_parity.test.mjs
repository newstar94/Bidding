import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  lookupPackageInvitationUpdates,
  mergeInvitationUpdateRows,
  resolveInvitationNoticeTarget,
} from "../../frontend/procurement/InvitationUpdates.js";

// ADR 0091: the backend monitor port is checked against the same fixture.
const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/clarification_auto_write_parity.json", import.meta.url), "utf8"));
const IMPORTED_ID = /^lr-[a-f0-9]{64}$/;

function packageRecord(pkg) {
  return { rootId: pkg.id, rowVersion: 1, ...pkg };
}

function modelFor(pkg) {
  return {
    state: { goithau: [pkg] }, db: {}, workspaceStorage: {},
    workspaceScope: { key: "user-1:org-1", organizationId: "org-1" },
    getWorkspaceToken: () => "user-1:org-1@1",
  };
}

function previewFor(revisions) {
  return {
    schemaVersion: "biddingflow-procurement-preview-v1",
    kind: "PACKAGE",
    canonicalCode: FIXTURE.noticeNo,
    canonical: {
      canonicalCode: FIXTURE.noticeNo,
      revisions: revisions.map((revision) => ({
        noticeNo: FIXTURE.noticeNo,
        clarificationAvailable: true,
        clarificationStatus: "AVAILABLE",
        extensionAvailable: false,
        extensionStatus: "SOURCE_UNAVAILABLE",
        extensions: [],
        ...structuredClone(revision),
      })),
    },
  };
}

async function lookup(testCase) {
  const pkg = packageRecord(testCase.package);
  const client = { lookup: async () => previewFor(testCase.revisions) };
  return lookupPackageInvitationUpdates({ pkg, model: modelFor(pkg), client });
}

function identityOf(row) {
  return String(row.sourceRequestNo || "").trim() || String(row.sourceRequestId || "").trim();
}

function sourceIds(revision) {
  const ids = new Map();
  for (const [kind, rows] of [["request", revision.clarificationRequests], ["response", revision.clarificationResponses]]) {
    for (const row of rows) {
      if (row.localRowId) ids.set(`${row.sourceNoticeVersion}:${kind}:${identityOf(row)}`, row.localRowId);
    }
  }
  return ids;
}

function resolveId(value, ids) {
  if (typeof value === "string") return value;
  const { version, kind, identity } = value.idFrom;
  const id = ids.get(`${version}:${kind}:${identity}`);
  assert.ok(id, `missing source id for ${version}:${kind}:${identity}`);
  return id;
}

test("notice target resolution matches the shared fixture", () => {
  for (const { package: pkg, revision, error } of FIXTURE.targets) {
    if (error) {
      assert.throws(() => resolveInvitationNoticeTarget(packageRecord(pkg)), { code: error }, pkg.id);
    } else {
      assert.equal(resolveInvitationNoticeTarget(packageRecord(pkg)).revisionNumber, revision, pkg.id);
    }
  }
});

test("pinned source row ids match the manual update", async () => {
  const [first] = FIXTURE.cases;
  const { revision } = await lookup(first);
  const ids = sourceIds(revision);
  for (const pinned of FIXTURE.pinnedIds) {
    assert.equal(pinned.packageId, first.package.id);
    assert.equal(ids.get(`${pinned.version}:${pinned.kind}:${pinned.identity}`), pinned.id);
  }
});

for (const testCase of FIXTURE.cases) {
  test(`manual merge appends the fixture rows: ${testCase.name}`, async () => {
    const { target, revision } = await lookup(testCase);
    assert.equal(target.revisionNumber, testCase.expected.revision);
    const ids = sourceIds(revision);
    for (const [kind, sourceRows, currentRows, expectedRows, timeField, contentField] of [
      ["request", revision.clarificationRequests, testCase.current.requests, testCase.expected.requests, "thoiGianYeuCau", "noiDungYeuCau"],
      ["response", revision.clarificationResponses, testCase.current.responses, testCase.expected.responses, "thoiGianTraLoi", "noiDungTraLoi"],
    ]) {
      const current = currentRows.map((row) => ({
        id: resolveId(row.id, ids), [timeField]: row.thoi_gian, [contentField]: row.noi_dung,
      }));
      const merged = mergeInvitationUpdateRows(current, sourceRows, { kind });
      const appended = merged.rows.slice(current.length);
      assert.equal(merged.added, expectedRows.length, kind);
      assert.equal(appended.length, expectedRows.length, kind);
      appended.forEach((row, index) => {
        const expected = expectedRows[index];
        if (expected.id === "random") {
          assert.match(row.id, /^lr-/);
          assert.doesNotMatch(row.id, IMPORTED_ID);
        } else {
          assert.equal(row.id, resolveId(expected.id, ids));
        }
        assert.equal(row[timeField], expected.time);
        assert.equal(row[contentField], expected.content);
      });
    }
  });
}
