import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";


const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(
  path.join(PROJECT_ROOT, relativePath), "utf8",
);

const modal = read("views/modals/modal_procurement_lookup.html")
  .replace('class="modal-overlay"', 'class="modal-overlay active"');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
try {
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="vi"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body>${modal}</body></html>`,
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
  const layout = await page.evaluate(() => {
    const card = document.querySelector(".procurement-lookup");
    const tableWrap = document.querySelector(".procurement-import__table-wrap");
    const cardRect = card.getBoundingClientRect();
    const wrapRect = tableWrap.getBoundingClientRect();
    return {
      viewportWidth: globalThis.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      cardScrollWidth: card.scrollWidth,
      cardClientWidth: card.clientWidth,
      tableWrapLeft: wrapRect.left,
      tableWrapRight: wrapRect.right,
      tableScrollWidth: tableWrap.scrollWidth,
      tableClientWidth: tableWrap.clientWidth,
      buttonHeights: [...document.querySelectorAll(".modal-footer .btn")]
        .map((button) => button.getBoundingClientRect().height),
    };
  });
  const axe = await new AxeBuilder({ page })
    .include("#modal-procurement-lookup")
    .analyze();
  const serious = axe.violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  const valid = layout.pageScrollWidth <= layout.viewportWidth
    && layout.cardLeft >= 0
    && layout.cardRight <= layout.viewportWidth
    && layout.cardScrollWidth <= layout.cardClientWidth
    && layout.tableWrapLeft >= 0
    && layout.tableWrapRight <= layout.viewportWidth
    && layout.tableScrollWidth > layout.tableClientWidth
    && layout.buttonHeights.every((height) => height >= 44)
    && serious.length === 0;
  if (!valid) {
    throw new Error(JSON.stringify({ layout, serious: serious.map((item) => item.id) }));
  }
  process.stdout.write(`${JSON.stringify({ viewport: "320x720", layout, serious: [] })}\n`);
} finally {
  await context.close();
  await browser.close();
}
