import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { applyWordNavigationPresentation } from "../../frontend/auth/accessContext.js";

test("free workspace hides the complete Word menu and paid workspace restores it", () => {
  const previousElement = globalThis.Element;
  globalThis.Element = class {};
  try {
    const nodes = [{}, {}, {}];
    const documentRef = { querySelectorAll(selector) {
      assert.equal(selector, "[data-word-navigation]");
      return nodes;
    } };
    applyWordNavigationPresentation({ subscription: { package_id: "free" } }, documentRef);
    assert.ok(nodes.every((node) => node.hidden && node.inert));
    applyWordNavigationPresentation({ subscription: null, entitlements: { word_export: false } }, documentRef);
    assert.ok(nodes.every((node) => node.hidden && node.inert));
    applyWordNavigationPresentation({ subscription: null, entitlements: { word_export: true } }, documentRef);
    assert.ok(nodes.every((node) => !node.hidden && !node.inert));
    applyWordNavigationPresentation({ subscription: { package_id: "gold" } }, documentRef);
    assert.ok(nodes.every((node) => !node.hidden && !node.inert));
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});

test("real personal sidebar stays invisible under employee role CSS and returns after upgrade", async () => {
  const sidebar = await readFile(new URL("../../views/components/sidebar.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../../views/css/components.css", import.meta.url), "utf8");
  const initialRoute = await readFile(new URL("../../views/vendor/initial-route.js", import.meta.url), "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://word-menu.test/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/tong-quan") {
        await route.fulfill({ contentType: "text/html", body: `<link rel="stylesheet" href="/runtime.css" data-runtime-styles><style>${styles}</style>${sidebar}` });
      } else if (path === "/runtime.css") {
        await route.fulfill({ contentType: "text/css", body: "" });
      } else if (path.startsWith("/frontend/") && !path.includes("..")) {
        await route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(`../..${path}`, import.meta.url), "utf8") });
      } else await route.abort();
    });
    await page.goto("http://word-menu.test/tong-quan");
    await page.evaluate(() => {
      const node = document.createElement("script");
      node.id = "bf-session-bootstrap";
      node.type = "application/json";
      node.textContent = JSON.stringify({ valid: true, user: {
        active_org_id: "personal:test", effective_roles: ["employee"],
        organizations: [{ id: "personal:test", scope_type: "personal", status: "active", subscription: null, entitlements: { word_export: false } }],
      } });
      document.body.appendChild(node);
    });
    await page.addScriptTag({ content: initialRoute });
    for (const node of await page.locator("[data-word-navigation]").all()) {
      assert.equal(await node.isVisible(), false);
    }
    await page.evaluate(async () => {
      const { applyAccessContext } = await import("/frontend/auth/accessContext.js");
      const user = {};
      applyAccessContext(user, {
        platform_role: "user", active_org_id: "personal:test",
        organizations: [{ id: "personal:test", scope_type: "personal", role: "employee", status: "active", subscription: null, entitlements: { word_export: false } }],
      });
      document.getElementById("sidebar").dataset.activeRole = "employee";
    });
    for (const node of await page.locator("[data-word-navigation]").all()) {
      assert.equal(await node.isVisible(), false);
    }
    assert.equal(await page.locator("#btn-tab-goithau").isVisible(), true);
    await page.evaluate(async () => {
      const { applyWordNavigationPresentation } = await import("/frontend/auth/accessContext.js");
      applyWordNavigationPresentation({ subscription: { package_id: "gold" } });
    });
    for (const node of await page.locator("[data-word-navigation]").all()) {
      assert.equal(await node.isVisible(), true);
    }
  } finally {
    await browser.close();
  }
});
