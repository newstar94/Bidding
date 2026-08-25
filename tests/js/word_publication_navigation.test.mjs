import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BiddingController } from "../../frontend/app/BiddingController.js";

test("document-system sidebar keeps Word templates and adds Word publication", async () => {
  const sidebar = await readFile("views/components/sidebar.html", "utf8");
  assert.doesNotMatch(sidebar, />Hệ thống mẫu</u);
  assert.match(sidebar, />Hệ thống văn bản</u);
  assert.match(sidebar, /data-tab="bieumau"[^>]*id="btn-tab-bieumau"/u);
  assert.match(sidebar, /data-tab="xuatban-word"[^>]*id="btn-tab-xuatban-word"/u);
  assert.doesNotMatch(sidebar, /procurement-center|Trung tâm hồ sơ/u);
  assert.ok(sidebar.indexOf("btn-tab-bieumau") < sidebar.indexOf("btn-tab-xuatban-word"));
});

test("existing Word-template route remains unchanged and publication uses a lazy page", () => {
  const controller = new BiddingController({}, {});
  assert.equal(controller.routeMap.bieumau, "bieu-mau");
  assert.equal(controller.lazyTabPartials.bieumau, "/tabs/tab_bieumau.html");
  assert.equal(controller.routeMap["xuatban-word"], "xuat-ban-word");
  assert.equal(controller.lazyTabPartials["xuatban-word"], "/tabs/tab_xuatban_word.html");
  assert.deepEqual(controller.getStartupPriorityKeys("/xuat-ban-word"), ["KEHOACH", "GOITHAU"]);
});

test("initial route shell and page markup expose the new active navigation target", async () => {
  const [routeShell, page] = await Promise.all([
    readFile("views/vendor/initial-route.js", "utf8"),
    readFile("views/tabs/tab_xuatban_word.html", "utf8"),
  ]);
  assert.match(routeShell, /"xuat-ban-word": \["xuatban-word", "Xuất bản Word"/u);
  assert.match(routeShell, /querySelector\(`\[data-tab="\$\{tab\}"\]`\)\?\.classList\.add\("active"\)/u);
  assert.match(page, /id="tab-xuatban-word"/u);
  assert.match(page, /id="word-publication-plan-select"[^>]*data-no-custom="true"/u);
  assert.match(page, /id="word-publication-package-select"[^>]*data-no-custom="true"[^>]*disabled/u);
  assert.match(page, /Loại văn bản có thể xuất bản/u);
});

test("Word publication styling stays in its lazy route chunk", async () => {
  const [moduleSource, assignmentSource, routeCss, mainCss] = await Promise.all([
    readFile("frontend/documents/WordPublication.js", "utf8"),
    readFile("frontend/documents/WordTemplateAssignments.js", "utf8"),
    readFile("frontend/documents/WordPublication.css", "utf8"),
    readFile("views/css/views.css", "utf8"),
  ]);
  assert.doesNotMatch(moduleSource, /import "\.\/WordPublication\.css";/u);
  assert.match(
    moduleSource,
    /new URL\(\s*"\.\/WordPublication\.css\?no-inline", import\.meta\.url,?\s*\)\.pathname/u,
  );
  assert.match(moduleSource, /await loadStyleOnce\(WORD_PUBLICATION_STYLESHEET_URL\)/u);
  assert.doesNotMatch(assignmentSource, /import "\.\/WordTemplateAssignments\.css";/u);
  assert.match(
    assignmentSource,
    /new URL\(\s*"\.\/WordTemplateAssignments\.css\?no-inline", import\.meta\.url,?\s*\)/u,
  );
  assert.match(routeCss, /\/\* Word publication/u);
  assert.doesNotMatch(mainCss, /\/\* Word publication/u);
});
