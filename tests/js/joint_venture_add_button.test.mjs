import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveJvMemberNameAfterLookup } from "../../frontend/packages/bidProcessJointVenture.js";

test("joint venture add-member button contains one icon and no literal plus", async () => {
  const sourcePath = fileURLToPath(new URL("../../frontend/packages/bidProcessJointVenture.js", import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  const buttonMarkup = source.match(/<button[^>]*id="btn-add-mothau-jv-member"[\s\S]*?<\/button>/)?.[0] || "";

  assert.match(buttonMarkup, /data-lucide="plus"/);
  assert.equal((buttonMarkup.match(/data-lucide="plus"/g) || []).length, 1);
  assert.doesNotMatch(buttonMarkup, />\s*\+\s*Thêm thành viên/);
});

test("joint venture validation renders below inputs without opening alert modal", async () => {
  const sourcePath = fileURLToPath(new URL("../../frontend/packages/bidProcessJointVenture.js", import.meta.url));
  const source = await readFile(sourcePath, "utf8");
  const saveHandler = source.match(/btn-save-mothau-jv"\)\.onclick = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";

  assert.match(source, /id="jv-input-lead-name-error" class="error-text"/);
  assert.match(source, /id="jv-member-\$\{rowSequence\}-mst-error" class="error-text"/);
  assert.match(source, /id="jv-member-\$\{rowSequence\}-name-error" class="error-text"/);
  assert.match(saveHandler, /setValidationError\(leadNameInput,/);
  assert.match(saveHandler, /setValidationError\(inputTen,/);
  assert.match(saveHandler, /setValidationError\(inputMst,/);
  assert.doesNotMatch(saveHandler, /customAlert/);
});

test("joint venture lookup keeps a manually entered member name when lookup has no result", () => {
  assert.equal(resolveJvMemberNameAfterLookup("Công ty Thành Viên", null), "Công ty Thành Viên");
  assert.equal(
    resolveJvMemberNameAfterLookup("Tên nhập thủ công", { tenNhaThau: "Tên từ dữ liệu nhà thầu" }),
    "Tên từ dữ liệu nhà thầu"
  );
});
