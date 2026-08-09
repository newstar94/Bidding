import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

test("assistant feedback is exclusive, toggleable, and has no suggestion strip", async () => {
  const state = { suggestionRequests: 0, feedback: [] };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/api/ai/suggested-questions") state.suggestionRequests += 1;
      if (url.pathname.startsWith("/api/")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ items: [] }));
        return;
      }
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/frontend/assistant/assistant.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" href="/views/css/runtime-styles.css" data-runtime-styles>
        </head><body></body></html>`);
        return;
      }
      const filePath = join(projectRoot, url.pathname.replace(/^\//, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await page.evaluate(async () => {
      window.lucide = {
        createIcons({ root = document } = {}) {
          root.querySelectorAll("i[data-lucide]").forEach((node) => {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("data-lucide", node.getAttribute("data-lucide"));
            node.replaceWith(svg);
          });
        },
      };
      const { assistantApi } = await import("/frontend/assistant/AssistantApi.js");
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      const calls = [];
      assistantApi.feedback = async (...args) => { calls.push(["set", ...args]); return { success: true }; };
      assistantApi.clearFeedback = async (...args) => { calls.push(["clear", ...args]); return { success: true }; };
      const assistant = mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      const rendered = assistant.addBubble("assistant", "Câu trả lời");
      assistant.addFeedback(rendered.row, "message-1");
      const buttons = rendered.row.querySelectorAll(".bf-assistant-feedback-button");
      const snapshot = () => [...buttons].map((button) => ({
        selected: button.classList.contains("is-selected"),
        pressed: button.getAttribute("aria-pressed"),
        disabled: button.disabled,
      }));
      await buttons[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterLike = snapshot();
      await buttons[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterUnlike = snapshot();
      await buttons[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterDislike = snapshot();
      await buttons[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        suggestionStrip: Boolean(document.querySelector(".bf-assistant-suggestions")),
        afterLike,
        afterUnlike,
        afterDislike,
        afterSwitch: snapshot(),
        calls,
      };
    });
    assert.equal(result.suggestionStrip, false);
    assert.deepEqual(result.afterLike.map((item) => item.selected), [true, false]);
    assert.deepEqual(result.afterLike.map((item) => item.pressed), ["true", "false"]);
    assert.deepEqual(result.afterUnlike.map((item) => item.selected), [false, false]);
    assert.deepEqual(result.afterUnlike.map((item) => item.pressed), ["false", "false"]);
    assert.deepEqual(result.afterDislike.map((item) => item.selected), [false, true]);
    assert.deepEqual(result.afterSwitch.map((item) => item.selected), [true, false]);
    assert.deepEqual(result.calls.map(([action, messageId]) => [action, messageId]), [
      ["set", "message-1"],
      ["clear", "message-1"],
      ["set", "message-1"],
      ["set", "message-1"],
    ]);
    assert.equal(state.suggestionRequests, 0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
