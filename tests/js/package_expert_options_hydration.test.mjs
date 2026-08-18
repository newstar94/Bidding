import assert from "node:assert/strict";
import test from "node:test";

import { hydratePackageExpertOptions } from "../../frontend/packages/GoiThauWorkflow.js";

test("package expert selectors hydrate every cursor page before rendering", async () => {
  const calls = [];
  const model = { useServerSidePagination: true, state: { chuyengia: [] } };
  const experts = await hydratePackageExpertOptions(model, {
    pageSize: 2,
    loadRecords: async (_model, table, params) => {
      calls.push({ table, params });
      return calls.length === 1
        ? {
          items: [{ id: "expert-1" }, { id: "expert-2" }],
          hasMore: true,
          nextCursor: "expert-2",
        }
        : {
          items: [{ id: "expert-3" }],
          hasMore: false,
          nextCursor: null,
        };
    },
  });

  assert.deepEqual(experts.map((expert) => expert.id), ["expert-1", "expert-2", "expert-3"]);
  assert.deepEqual(calls, [
    {
      table: "chuyengia",
      params: { pageSize: 2, pagination: "cursor", sortBy: "id", sortOrder: "asc" },
    },
    {
      table: "chuyengia",
      params: {
        pageSize: 2,
        pagination: "cursor",
        sortBy: "id",
        sortOrder: "asc",
        cursor: "expert-2",
      },
    },
  ]);
});

test("package expert selectors use the existing local catalog when pagination is disabled", async () => {
  const localExperts = [{ id: "expert-local" }];
  const experts = await hydratePackageExpertOptions({
    useServerSidePagination: false,
    state: { chuyengia: localExperts },
  }, {
    loadRecords: () => {
      throw new Error("local catalogs must not request pagination");
    },
  });

  assert.equal(experts, localExperts);
});
