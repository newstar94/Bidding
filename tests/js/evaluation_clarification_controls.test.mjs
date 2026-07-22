import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("editable evaluation and clarification controls do not carry the disabled cursor class", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/BidEvaluationWorkflow.js", import.meta.url),
    "utf8",
  );

  const editableControlWithDisabledClass = /class="form-control (?:mt-dg-(?:hop-le|nang-luc|ky-thuat)|mt-lam-ro-(?:hop-le|nang-luc|ky-thuat|tai-chinh))[^"\n]*bf-s-7c66cdedec/;
  assert.doesNotMatch(
    source,
    editableControlWithDisabledClass,
    "Editable evaluation controls must not inherit cursor:not-allowed from the static disabled style.",
  );

  assert.match(source, /forceRowDisabled \? 'disabled'/);
  assert.match(source, /setRuntimeStyle\(el, "cursor", "not-allowed"\)/);
});

test("a sequential-evaluation row unlocks every clarification control when it becomes eligible", async () => {
  const source = await readFile(
    new URL("../../frontend/packages/BidEvaluationWorkflow.js", import.meta.url),
    "utf8",
  );
  const forceBranch = source.indexOf("if (!isReadOnly && forceRowDisabled)");
  const unlockStart = source.indexOf("} else if (!isReadOnly) {", forceBranch);
  const unlockEnd = source.indexOf("if (!is1G2T", unlockStart);
  const unlockBlock = source.slice(unlockStart, unlockEnd);

  for (const className of [
    "mt-lam-ro-hop-le",
    "mt-lam-ro-nang-luc",
    "mt-lam-ro-ky-thuat",
    "mt-lam-ro-tai-chinh",
    "mt-reason-fail-hople",
    "mt-reason-fail-nangluc",
    "mt-reason-fail-kythuat",
  ]) {
    assert.match(unlockBlock, new RegExp(`\\.${className}\\b`));
  }
  assert.match(unlockBlock, /removeAttribute\("disabled"\)/);
});
