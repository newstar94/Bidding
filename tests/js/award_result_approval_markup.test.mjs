import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("award approval action cannot submit an ancestor form", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/detail/AwardResultApprovalMarkup.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /<button type="button" class="btn btn-primary bf-s-a9f6996ecf" id="btn-approve-award">/u,
  );
});
