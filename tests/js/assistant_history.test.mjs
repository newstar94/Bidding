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

async function startServer({ listDelayMs = 0, failMessageAttempts = 0 } = {}) {
  const state = { sentPath: "", requests: [], deletedPaths: [], createdCount: 0, messageAttempts: 0, activeWorkspace: "org-a" };
  const conversations = [
    { id: "aic-help", mode: "app_help", title: "Cách dùng ứng dụng", updated_at: "2026-08-05T10:00:00Z" },
    { id: "aic-data-new", mode: "data", title: "Gói cần mở hôm nay", updated_at: "2026-08-05T09:00:00Z" },
    { id: "aic-data-old", mode: "data", title: "Gói thầu năm trước", updated_at: "2026-08-04T09:00:00Z" },
  ];
  const messages = {
    "aic-help": [
      { id: "aim-user-help", role: "user", content: "Câu hỏi hướng dẫn" },
      { id: "aim-assistant-help", role: "assistant", content: "Trả lời hướng dẫn" },
    ],
    "aic-data-new": [
      { id: "aim-user-new", role: "user", content: "Câu hỏi data mới" },
      { id: "aim-assistant-new", role: "assistant", content: "Trả lời data mới" },
    ],
    "aic-data-old": [
      { id: "aim-user-old", role: "user", content: "Câu hỏi data cũ" },
      { id: "aim-assistant-old", role: "assistant", content: "Trả lời data cũ" },
    ],
  };
  const workspaceBConversation = { id: "aic-org-b", mode: "data", title: "Dữ liệu workspace B", updated_at: "2026-08-05T12:00:00Z" };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname.startsWith("/api/")) state.requests.push(`${request.method} ${pathname}`);
      if (pathname === "/api/ai/suggested-questions") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ items: [] }));
        return;
      }
      if (pathname === "/api/ai/conversations" && request.method === "GET") {
        if (listDelayMs) await new Promise((resolve) => setTimeout(resolve, listDelayMs));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ items: state.activeWorkspace === "org-b" ? [workspaceBConversation] : conversations }));
        return;
      }
      if (pathname === "/api/ai/conversations" && request.method === "POST") {
        state.createdCount += 1;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "aic-created", mode: "data", title: null, createdAt: "2026-08-05T11:00:00Z" }));
        return;
      }
      if (pathname.startsWith("/api/ai/conversations/") && request.method === "DELETE") {
        state.deletedPaths.push(pathname);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: true }));
        return;
      }
      if (pathname === "/api/ai/conversations/aic-data-new" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ conversation: conversations[1], messages: messages["aic-data-new"] }));
        return;
      }
      if (pathname === "/api/ai/conversations/aic-help" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ conversation: conversations[0], messages: messages["aic-help"] }));
        return;
      }
      if (pathname === "/api/ai/conversations/aic-data-old" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ conversation: conversations[2], messages: messages["aic-data-old"] }));
        return;
      }
      if (pathname === "/api/ai/conversations/aic-org-b" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          conversation: workspaceBConversation,
          messages: [
            { id: "aim-user-org-b", role: "user", content: "Câu hỏi workspace B" },
            { id: "aim-assistant-org-b", role: "assistant", content: "Trả lời workspace B" },
          ],
        }));
        return;
      }
      if (pathname === "/api/ai/conversations/aic-data-new/messages" && request.method === "POST") {
        state.sentPath = pathname;
        state.messageAttempts += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (state.messageAttempts <= failMessageAttempts) {
          response.end('data: {"type":"message.failed","code":"AI_PROVIDER_UNAVAILABLE","message":"AI provider tam thoi khong kha dung."}\n\n');
          return;
        }
        response.end([
          'data: {"type":"message.started","messageId":"aim-user-followup"}',
          '',
          'data: {"type":"message.delta","delta":"Trả lời tiếp nối"}',
          '',
          'data: {"type":"message.completed","messageId":"aim-assistant-followup"}',
          '',
          '',
        ].join("\n"));
        return;
      }
      if (pathname === "/api/ai/conversations/aic-created/messages" && request.method === "POST") {
        state.sentPath = pathname;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end('data: {"type":"message.delta","delta":"Trả lời hội thoại mới"}\n\ndata: {"type":"message.completed","messageId":"aim-created"}\n\n');
        return;
      }
      if (pathname.startsWith("/api/")) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "Not Found" }));
        return;
      }
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><head>
          <link rel="stylesheet" href="/views/css/tokens.css">
          <link rel="stylesheet" href="/views/css/variables.css">
          <link rel="stylesheet" href="/views/css/base.css">
          <link rel="stylesheet" href="/views/css/components.css">
          <link rel="stylesheet" href="/views/css/ui-redesign.css">
          <link rel="stylesheet" href="/views/css/runtime-styles.css" data-runtime-styles>
        </head><body></body></html>`);
        return;
      }
      const filePath = join(projectRoot, pathname.replace(/^\//, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      if (!response.writableEnded) response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, state, port: server.address().port };
}

test("assistant restores the latest conversation for its mode and continues that thread", async () => {
  const { server, state, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(() => { document.cookie = "csrf_token=test-token; path=/"; });
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      const assistant = mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      document.getElementById("bf-assistant-trigger").click();
      return Boolean(assistant);
    });
    await page.waitForFunction(() => document.querySelectorAll(".bf-assistant-message").length === 2, null, { timeout: 2000 });
    const restored = await page.locator(".bf-assistant-bubble").allTextContents();
    assert.deepEqual(restored, ["Câu hỏi data mới", "Trả lời data mới"]);

    await page.locator(".bf-assistant-input").fill("Câu hỏi tiếp theo");
    await page.locator(".bf-assistant-send").click();
    await page.waitForTimeout(300);
    assert.equal(state.sentPath, "/api/ai/conversations/aic-data-new/messages", state.requests.join("\n"));
    const continued = await page.locator(".bf-assistant-bubble").allTextContents();
    assert.ok(continued.includes("Trả lời tiếp nối"), JSON.stringify(continued));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("assistant renders allowlisted external legal sources as safe links", async () => {
  const { server, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      const assistant = mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      assistant.onEvent({
        type: "source.added",
        source: {
          title: "Luật Đấu thầu 2023",
          url: "https://vanban.chinhphu.vn/luat-dau-thau",
          effectiveFrom: "2024-01-01",
        },
      });
      assistant.onEvent({ type: "source.added", source: { title: "Unsafe", url: "javascript:alert(1)" } });
    });
    const link = page.locator('a.bf-assistant-source[href="https://vanban.chinhphu.vn/luat-dau-thau"]');
    assert.equal(await link.count(), 1);
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.locator(".bf-assistant-source-meta").textContent(), "Hiệu lực: 2024-01-01");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("assistant groups internal sources compactly and hides generic guide routes", async () => {
  const { server, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      const assistant = mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      assistant.onEvent({
        type: "source.added",
        source: { title: "Hướng dẫn sử dụng BiddingFlow", documentType: "BIDDINGFLOW_HELP", url: "/tong-quan" },
      });
      assistant.onEvent({ type: "source.added", source: { title: "Quản lý Biểu mẫu & Từ điển", url: "/bieu-mau" } });
      assistant.onEvent({ type: "source.added", source: { title: "Timeline gói thầu", url: "/timeline-goi-thau" } });
      return {
        sourceListCount: document.querySelectorAll(".bf-assistant-source-list").length,
        sourceItemCount: document.querySelectorAll(".bf-assistant-source-item").length,
        hrefs: [...document.querySelectorAll(".bf-assistant-source-item a")].map((link) => link.getAttribute("href")),
        genericGuideLinkCount: document.querySelectorAll('a[href="/tong-quan"]').length,
      };
    });
    assert.deepEqual(result, {
      sourceListCount: 1,
      sourceItemCount: 2,
      hrefs: ["/bieu-mau", "/timeline-goi-thau"],
      genericGuideLinkCount: 0,
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("assistant removes failed placeholder and retry does not duplicate the user question", async () => {
  const { server, state, port } = await startServer({ failMessageAttempts: 1 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(() => { document.cookie = "csrf_token=test-token; path=/"; });
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      document.getElementById("bf-assistant-trigger").click();
    });
    await page.waitForFunction(() => document.querySelectorAll(".bf-assistant-message").length === 2, null, { timeout: 2000 });

    await page.locator(".bf-assistant-input").fill("How many packages open today?");
    await page.locator(".bf-assistant-send").click();
    await page.waitForFunction(() => document.querySelectorAll(".bf-assistant-error").length === 1, null, { timeout: 2000 });

    const afterFailure = await page.locator(".bf-assistant-bubble").allTextContents();
    assert.equal(afterFailure.filter((text) => text === "How many packages open today?").length, 1);
    assert.equal(afterFailure.filter((text) => text === "").length, 0);

    await page.locator(".bf-assistant-retry").click();
    await page.waitForFunction(() => {
      const bubbles = [...document.querySelectorAll(".bf-assistant-bubble")];
      return bubbles.length === 4
        && bubbles.every((node) => node.textContent.trim())
        && document.querySelectorAll(".bf-assistant-error").length === 0;
    }, null, { timeout: 2000 });

    const afterRetry = await page.locator(".bf-assistant-bubble").allTextContents();
    assert.equal(state.messageAttempts, 2);
    assert.equal(afterRetry.filter((text) => text === "How many packages open today?").length, 1);
    assert.equal(afterRetry.filter((text) => text === "").length, 0);
    assert.equal(await page.locator(".bf-assistant-error").count(), 0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("assistant loads conversation history lazily on first open", async () => {
  const { server, state, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
    });
    await page.waitForTimeout(150);
    assert.equal(state.requests.filter((item) => item === "GET /api/ai/conversations").length, 0);

    await page.locator("#bf-assistant-trigger").click();
    await page.waitForFunction(() => document.querySelectorAll(".bf-assistant-message").length === 2, null, { timeout: 2000 });
    assert.equal(state.requests.filter((item) => item === "GET /api/ai/conversations").length, 1);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("assistant history popover switches between conversations in the current mode", async () => {
  const { server, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      document.getElementById("bf-assistant-trigger").click();
    });
    await page.waitForFunction(() => document.querySelectorAll(".bf-assistant-message").length === 2, null, { timeout: 2000 });

    const trigger = page.locator(".bf-assistant-history-trigger");
    await trigger.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    const presentation = await page.evaluate(() => ({
      panelPosition: getComputedStyle(document.querySelector(".bf-assistant-history-panel")).position,
      triggerWidth: getComputedStyle(document.querySelector(".bf-assistant-history-trigger")).width,
    }));
    assert.deepEqual(presentation, { panelPosition: "absolute", triggerWidth: "34px" });
    assert.deepEqual(await page.locator(".bf-assistant-history-item-title").allTextContents(), [
      "Gói cần mở hôm nay",
      "Gói thầu năm trước",
    ]);
    assert.equal(await page.locator('.bf-assistant-history-item[aria-current="true"] .bf-assistant-history-item-title').textContent(), "Gói cần mở hôm nay");

    await page.keyboard.press("Escape");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#bf-assistant-panel").isVisible(), true);
    await trigger.click();

    await page.locator('[data-conversation-id="aic-data-old"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll(".bf-assistant-bubble")]
      .some((node) => node.textContent === "Trả lời data cũ"));
    assert.deepEqual(await page.locator(".bf-assistant-bubble").allTextContents(), ["Câu hỏi data cũ", "Trả lời data cũ"]);
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("starting a new conversation preserves prior history and adds the new thread", async () => {
  const { server, state, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(() => { document.cookie = "csrf_token=test-token; path=/"; });
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      document.getElementById("bf-assistant-trigger").click();
    });
    await page.waitForFunction(() => document.querySelectorAll(".bf-assistant-message").length === 2, null, { timeout: 2000 });

    await page.locator(".bf-assistant-clear").click();
    await page.waitForTimeout(150);
    assert.deepEqual(state.deletedPaths, []);
    assert.equal(await page.locator(".bf-assistant-welcome").count(), 1);

    await page.locator(".bf-assistant-input").fill("Bắt đầu hội thoại mới");
    await page.locator(".bf-assistant-send").click();
    await page.waitForTimeout(300);
    assert.equal(state.createdCount, 1);
    assert.equal(state.sentPath, "/api/ai/conversations/aic-created/messages");
    assert.ok((await page.locator(".bf-assistant-bubble").allTextContents()).includes("Trả lời hội thoại mới"));

    await page.locator(".bf-assistant-history-trigger").click();
    assert.deepEqual(await page.locator(".bf-assistant-history-item-title").allTextContents(), [
      "Bắt đầu hội thoại mới",
      "Gói cần mở hôm nay",
      "Gói thầu năm trước",
    ]);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("changing assistant mode restores that mode's latest conversation", async () => {
  const { server, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      document.getElementById("bf-assistant-trigger").click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll(".bf-assistant-bubble")]
      .some((node) => node.textContent === "Trả lời data mới"), null, { timeout: 2000 });

    await page.locator('.bf-assistant-mode-select .custom-select-trigger').click();
    await page.locator('.custom-select-options[data-parent="bf-assistant-mode-select"] [data-value="app_help"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll(".bf-assistant-bubble")]
      .some((node) => node.textContent === "Trả lời hướng dẫn"), null, { timeout: 2000 });
    assert.deepEqual(await page.locator(".bf-assistant-bubble").allTextContents(), ["Câu hỏi hướng dẫn", "Trả lời hướng dẫn"]);

    await page.locator(".bf-assistant-history-trigger").click();
    assert.deepEqual(await page.locator(".bf-assistant-history-item-title").allTextContents(), ["Cách dùng ứng dụng"]);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("changing workspace discards rendered history and restores only the new workspace", async () => {
  const { server, state, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(() => { sessionStorage.setItem("bf_active_org", "org-a"); });
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      document.getElementById("bf-assistant-trigger").click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll(".bf-assistant-bubble")]
      .some((node) => node.textContent === "Trả lời data mới"), null, { timeout: 2000 });

    state.activeWorkspace = "org-b";
    await page.evaluate(() => {
      sessionStorage.setItem("bf_active_org", "org-b");
      window.dispatchEvent(new Event("bf:workspace-changed"));
    });
    await page.waitForFunction(() => [...document.querySelectorAll(".bf-assistant-bubble")]
      .some((node) => node.textContent === "Trả lời workspace B"), null, { timeout: 2000 });
    assert.deepEqual(await page.locator(".bf-assistant-bubble").allTextContents(), ["Câu hỏi workspace B", "Trả lời workspace B"]);

    await page.locator(".bf-assistant-history-trigger").click();
    assert.deepEqual(await page.locator(".bf-assistant-history-item-title").allTextContents(), ["Dữ liệu workspace B"]);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("sending while history loads waits for restoration before appending the follow-up", async () => {
  const { server, state, port } = await startServer({ listDelayMs: 180 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.evaluate(() => { document.cookie = "csrf_token=test-token; path=/"; });
    await page.evaluate(async () => {
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      document.getElementById("bf-assistant-trigger").click();
    });
    await page.locator(".bf-assistant-input").fill("Câu hỏi tức thời");
    await page.locator(".bf-assistant-send").click();
    await page.waitForTimeout(500);

    assert.equal(state.sentPath, "/api/ai/conversations/aic-data-new/messages");
    assert.deepEqual(await page.locator(".bf-assistant-bubble").allTextContents(), [
      "Câu hỏi data mới",
      "Trả lời data mới",
      "Câu hỏi tức thời",
      "Trả lời tiếp nối",
    ]);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
