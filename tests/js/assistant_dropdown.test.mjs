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

test("assistant mode dropdown uses the shared custom select and stays synchronized", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname.startsWith("/api/")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ items: [] }));
        return;
      }
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
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
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(async () => {
      window.lucide = {
        createIcons({ root = document } = {}) {
          root.querySelectorAll('i[data-lucide]').forEach((node) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('data-lucide', node.getAttribute('data-lucide'));
            node.replaceWith(svg);
          });
        },
      };
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      const assistant = mountAssistant({ model: { state: { activeuser: { organizations: [] } } } }, { enabled: true });
      const assistantTrigger = document.getElementById("bf-assistant-trigger");
      const triggerPresentation = {
        accessibleLabel: assistantTrigger?.getAttribute("aria-label") || "",
        visualLabel: assistantTrigger?.querySelector(".bf-assistant-trigger-label")?.textContent || "",
        hint: assistantTrigger?.querySelector(".bf-assistant-trigger-hint")?.textContent || "",
        hasRobotFace: Boolean(assistantTrigger?.querySelector(".bf-assistant-trigger-robot")),
        height: assistantTrigger ? getComputedStyle(assistantTrigger).minHeight : "",
      };
      assistantTrigger.click();
      const select = document.getElementById("bf-assistant-mode-select");
      const wrapper = document.querySelector('.custom-select-container[data-target="bf-assistant-mode-select"]');
      const trigger = wrapper?.querySelector(".custom-select-trigger");
      trigger?.click();
      const options = wrapper?.querySelector(".custom-select-options");
      const opened = {
        selectDisplay: getComputedStyle(select).display,
        optionsTag: options?.tagName || "",
        optionsDisplay: options ? getComputedStyle(options).display : "",
        optionsRadius: options ? getComputedStyle(options).borderRadius : "",
        optionsShadow: options ? getComputedStyle(options).boxShadow : "",
        wrapperOpen: wrapper?.classList.contains("open") || false,
        optionCount: options?.querySelectorAll(".custom-option-item").length || 0,
      };
      options?.querySelector('[data-value="app_help"]')?.click();
      await new Promise((resolve) => queueMicrotask(resolve));
      assistant.activeMessage = assistant.addBubble('assistant', '');
      assistant.onEvent({
        type: 'message.delta',
        delta: 'H\u00f4m nay kh\u00f4ng c\u00f3 g\u00f3i th\u1ea7u n\u00e0o c\u1ea7n m\u1edf th\u1ea7u.',
      });
      assistant.onEvent({
        type: 'tool.completed',
        status: 'completed',
        result: {
          summary: { recordCount: 0 },
          filters: { dateFrom: '2026-08-05', dateTo: '2026-08-05' },
          records: [],
          sourceLinks: [],
        },
      });
      assistant.onEvent({ type: 'message.completed', messageId: 'message-1' });
      return {
        triggerPresentation,
        closePresentation: {
          usesSharedClose: document.querySelector('.bf-assistant-close')?.classList.contains('modal-close'),
          hasEmbeddedIcon: Boolean(document.querySelector('.bf-assistant-close')?.querySelector('svg, i')),
          accessibleLabel: document.querySelector('.bf-assistant-close')?.getAttribute('aria-label'),
          width: getComputedStyle(document.querySelector('.bf-assistant-close')).width,
          height: getComputedStyle(document.querySelector('.bf-assistant-close')).height,
          borderRadius: getComputedStyle(document.querySelector('.bf-assistant-close')).borderRadius,
        },
        welcomePresentation: {
          display: getComputedStyle(document.querySelector('.bf-assistant-welcome')).display,
          height: Math.round(document.querySelector('.bf-assistant-welcome').getBoundingClientRect().height),
          markMarginBottom: getComputedStyle(document.querySelector('.bf-assistant-welcome-mark')).marginBottom,
        },
        openAccessibleLabel: assistantTrigger?.getAttribute("aria-label") || "",
        opened,
        value: select?.value,
        triggerText: trigger?.textContent?.trim(),
        selected: [...(options?.querySelectorAll(".custom-option-item") || [])]
          .filter((item) => item.classList.contains("selected"))
          .map((item) => item.dataset.value),
        ariaSelected: [...(options?.querySelectorAll(".custom-option-item") || [])]
          .filter((item) => item.getAttribute("aria-selected") === "true")
          .map((item) => item.dataset.value),
        assistantMode: assistant.mode,
        answerPresentation: {
          text: assistant.activeMessage.bubble.textContent,
          resultCards: document.querySelectorAll('.bf-assistant-result-card').length,
          filterRows: document.querySelectorAll('.bf-assistant-filter-row').length,
          feedbackButtons: assistant.activeMessage.row.querySelectorAll('.bf-assistant-feedback-button').length,
          feedbackTitles: [...assistant.activeMessage.row.querySelectorAll('.bf-assistant-feedback-button')]
            .map((button) => button.title),
          feedbackIcons: assistant.activeMessage.row.querySelectorAll(
            '.bf-assistant-feedback-button svg[data-lucide]'
          ).length,
        },
      };
    });

    assert.deepEqual(result.triggerPresentation, {
      accessibleLabel: "Mở trợ lý BiddingFlow",
      visualLabel: "Trợ lý AI",
      hint: "Hỏi về đấu thầu",
      hasRobotFace: true,
      height: "54px",
    });
    assert.equal(result.openAccessibleLabel, "Đóng trợ lý BiddingFlow");
    assert.equal(result.opened.selectDisplay, "none");
    assert.equal(result.opened.optionsTag, "UL");
    assert.equal(result.opened.optionsDisplay, "block");
    assert.equal(result.opened.optionsRadius, "10px");
    assert.match(result.opened.optionsShadow, /rgba\(17, 26, 44, 0\.16\)/);
    assert.equal(result.opened.wrapperOpen, true);
    assert.equal(result.opened.optionCount, 3);
    assert.equal(result.value, "app_help");
    assert.equal(result.triggerText, "Hướng dẫn ứng dụng");
    assert.deepEqual(result.selected, ["app_help"]);
    assert.deepEqual(result.ariaSelected, ["app_help"]);
    assert.equal(result.assistantMode, "app_help");
    assert.deepEqual(result.closePresentation, {
      usesSharedClose: true,
      hasEmbeddedIcon: false,
      accessibleLabel: 'Đóng trợ lý',
      width: '38px',
      height: '38px',
      borderRadius: '8px',
    });
    assert.equal(result.welcomePresentation.display, 'grid');
    assert.ok(result.welcomePresentation.height <= 84);
    assert.equal(result.welcomePresentation.markMarginBottom, '0px');
    assert.deepEqual(result.answerPresentation, {
      text: 'H\u00f4m nay kh\u00f4ng c\u00f3 g\u00f3i th\u1ea7u n\u00e0o c\u1ea7n m\u1edf th\u1ea7u.',
      resultCards: 0,
      filterRows: 0,
      feedbackButtons: 2,
      feedbackTitles: ['Hữu ích', 'Chưa đúng'],
      feedbackIcons: 2,
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
