import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";


const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(
  path.join(PROJECT_ROOT, relativePath), "utf8",
);

function elementById(markup, tag, id) {
  const match = markup.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>(?:[\\s\\S]*?<\\/${tag}>)?`));
  if (!match) throw new Error(`Missing #${id} in form markup`);
  return match[0];
}

function inlineLookupFixture(markup, {
  codeId, buttonId, statusId, headingId, heading,
}) {
  const input = elementById(markup, "input", codeId);
  const button = elementById(markup, "button", buttonId);
  const status = elementById(markup, "span", statusId)
    .replace(" hidden", "")
    .replace("></span>", ">Đang lấy dữ liệu từ Mua Sắm Công…</span>");
  return `<section class="form-group procurement-inline-fixture" aria-labelledby="${headingId}">`
    + `<h2 id="${headingId}">${heading}</h2>`
    + `<label for="${codeId}">Mã tra cứu</label>${input}${button}${status}</section>`;
}

const plan = inlineLookupFixture(read("views/modals/modal_kehoach.html"), {
  codeId: "kh-ma",
  buttonId: "btn-open-procurement-lookup-plan",
  statusId: "procurement-lookup-plan-status",
  headingId: "plan-heading",
  heading: "Kế hoạch lựa chọn nhà thầu",
});
const packageLookup = inlineLookupFixture(read("views/modals/modal_goithau.html"), {
  codeId: "gt-ma",
  buttonId: "btn-open-procurement-lookup-package",
  statusId: "procurement-lookup-package-status",
  headingId: "package-heading",
  heading: "Gói thầu",
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
try {
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="vi"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body><main>${plan}${packageLookup}</main></body></html>`,
  );
  for (const stylesheet of [
    "views/css/tokens.css",
    "views/css/variables.css",
    "views/css/base.css",
    "views/css/components.css",
    "views/css/generated-static-styles.css",
  ]) {
    await page.addStyleTag({ path: path.join(PROJECT_ROOT, stylesheet) });
  }
  await page.addStyleTag({ content: `
    main { display: grid; gap: 1rem; padding: 0.75rem; }
    .procurement-inline-fixture { min-width: 0; }
    .procurement-inline-fixture h2 { font-size: 1rem; }
  ` });
  const layout = await page.evaluate(() => ({
    viewportWidth: globalThis.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    sectionsInsideViewport: [...document.querySelectorAll(".procurement-inline-fixture")]
      .every((section) => {
        const rect = section.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= globalThis.innerWidth;
      }),
    buttonHeights: [...document.querySelectorAll(".procurement-inline-fixture .btn")]
      .map((button) => button.getBoundingClientRect().height),
    statuses: [...document.querySelectorAll(".procurement-inline-status")]
      .map((status) => ({ role: status.getAttribute("role"), live: status.getAttribute("aria-live") })),
  }));
  const axe = await new AxeBuilder({ page }).include("main").analyze();
  const serious = axe.violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  const valid = layout.pageScrollWidth <= layout.viewportWidth
    && layout.sectionsInsideViewport
    && layout.buttonHeights.length === 2
    && layout.buttonHeights.every((height) => height >= 44)
    && layout.statuses.length === 2
    && layout.statuses.every((status) => status.role === "status" && status.live === "polite")
    && serious.length === 0;
  if (!valid) {
    throw new Error(JSON.stringify({ layout, serious: serious.map((item) => item.id) }));
  }
  process.stdout.write(`${JSON.stringify({ viewport: "320x720", layout, serious: [] })}\n`);
} finally {
  await context.close();
  await browser.close();
}
