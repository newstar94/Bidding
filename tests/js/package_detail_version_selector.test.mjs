import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("package detail version selector uses the shared styled dropdown", async () => {
  const [template, coordinator, helper, combobox, components, index] = await Promise.all([
    readFile(new URL("../../views/tabs/tab_goithau_detail.html", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/packages/detail/PackageDetailCoordinator.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/shared/view_helpers.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/shared/accessibleCombobox.js", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/components.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(
    template,
    /id="detail-workflow-version-select" class="page-version-select/u,
  );
  assert.doesNotMatch(coordinator, /verSelect\.dataset\.noCustom/u);
  assert.match(
    coordinator,
    /import \{[^}]*initCustomSelect[^}]*\} from "\.\.\/\.\.\/shared\/view_helpers\.js"/su,
  );
  assert.match(
    coordinator,
    /initCustomSelect\("detail-workflow-version-select"\)/u,
  );
  assert.match(
    helper,
    /showToggle:\s*!isVersionSelect/u,
  );
  assert.match(
    combobox,
    /wrapper\.classList\.contains\("version-select-container"\)[\s\S]*list\.classList\.add\("version-select-options"\)/u,
  );
  assert.match(
    components,
    /\.custom-select-options\.version-select-options\s*\{[^}]*min-width:\s*52px[^}]*border-radius:\s*4px/su,
  );
  assert.match(
    components,
    /\.custom-select-options\.version-select-options li\s*\{[^}]*font-size:\s*0\.75rem[^}]*text-align:\s*center/su,
  );
  assert.match(index, /components\.css\?v=2\.0/u);
});
