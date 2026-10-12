import { build } from "esbuild";
import { expect, test } from "@playwright/test";

test("package row actions survive a refresh started during the pointer gesture", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { outputFiles } = await build({
    entryPoints: ["frontend/packages/GoiThauTable.js"],
    bundle: true, write: false, format: "esm",
    platform: "browser",
  });
  await page.route("http://package-table.test/", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><meta charset="utf-8"><table><tbody><tr><td><button data-bf-action="edit-package">Sửa gói</button></td></tr></tbody></table>' }));
  await page.goto("http://package-table.test/");
  await page.route("http://package-table.test/packageTable.js", (route) => route.fulfill({ contentType: "text/javascript", body: outputFiles[0].text }));
  await page.evaluate(async () => { window.packageTable = await import("/packageTable.js"); });
  expect(errors).toEqual([]);
  await page.evaluate(() => {
    const tableBody = document.querySelector("tbody");
    window.originalAction = tableBody.querySelector("button");
    window.actionCount = 0;
    window.renderCount = 0;
    window.refreshPackageRow = async () => {
      const current = packageTable.beginPackageTableRender(tableBody);
      const allowed = await packageTable.canPackageTableRenderOwnDom(tableBody, current);
      if (!packageTable.canPackageTableRenderCommit(allowed, current)) return;
      tableBody.innerHTML = '<tr><td><button data-bf-action="edit-package">Sửa gói</button></td></tr>';
      window.renderCount += 1;
    };
    packageTable.installPackageTableInteractionOwnership(tableBody, window.refreshPackageRow);
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-bf-action="edit-package"]')) window.actionCount += 1;
    });
  });
  const button = page.getByRole("button", { name: "Sửa gói" });
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A search/background refresh can start after pointerdown, including while
  // the user holds the button. Keep the native click's original target mounted.
  await page.evaluate(() => window.refreshPackageRow());
  expect(await page.evaluate(() => window.originalAction.isConnected)).toBe(true);
  expect(await page.evaluate(() => window.renderCount)).toBe(0);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.actionCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.renderCount)).toBe(1);
});
