import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "@playwright/test";

test("navigation cancels native API body readers without runtime errors", async ({ browser }) => {
  const apiClientSource = await readFile(new URL("../../frontend/shared/apiClient.js", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/apiClient.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(apiClientSource);
    } else if (pathname === "/api/slow-body") {
      response.writeHead(200, { "Content-Type": "application/json" });
      // Keep the body pending after its headers and first chunk arrive. A
      // document navigation must cancel this real native fetch response.
      response.write('{"ready":');
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>API navigation lifecycle</title>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const useApiClient of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      await context.route(/^https?:\/\/local\.adguard\.org(?::\d+)?(?:\/|$)/iu, (route) => route.abort("blockedbyclient"));
      try {
        const page = await context.newPage();
        const failures = [];
        page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
        page.on("console", (message) => {
          if (message.type() === "error") failures.push(`console: ${message.text()}`);
        });
        await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "domcontentloaded" });
        await page.evaluate(async (useApiClient) => {
          const { apiFetch } = await import("/apiClient.js");
          const fetchBody = useApiClient ? apiFetch : fetch;
          const responses = await Promise.all([1, 2].map((request) => fetchBody(`/api/slow-body?request=${request}`, { retries: 0 })));
          // Consumers handle cancellation. Gecko must not emit an additional
          // native console error merely because the response crosses a bridge.
          responses.forEach((response) => { void response.json().catch(() => {}); });
        }, useApiClient);
        await page.goto("data:text/html,<title>Committed reset document</title>", { waitUntil: "commit" });
        // The errors arrive from Gecko's cancellation callbacks after commit.
        await page.waitForTimeout(100);
        assert.deepEqual(failures, [], useApiClient ? "API fetch cancellation" : "native fetch negative control");
      } finally {
        await context.close();
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
