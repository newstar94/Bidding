import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import { draftEditorMarkup } from "../../frontend/admin-platform/AdminPlans.js";

test("retired offer editor is replaced by escaped versioned draft editing", async () => {
  await assert.rejects(() => access(new URL("../../frontend/commercial-policy/CommercialOfferEditor.js", import.meta.url)));
  const markup = draftEditorMarkup({
    id: "draft-1",
    revision: 1,
    document: { offers: [{ display: { name: "<img src=x onerror=alert(1)>" } }] },
  });
  assert.doesNotMatch(markup, /<img/u);
  assert.match(markup, /&lt;img/u);
  assert.match(markup, /Lưu bản nháp|save/u);
});
