import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  return [".js", ".mjs"].includes(extname(pathname))
    ? "text/javascript; charset=utf-8"
    : extname(pathname) === ".css"
      ? "text/css; charset=utf-8"
    : "text/html; charset=utf-8";
}


test("form validation reports errors at fields without adding a page-level summary", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const filePath = join(projectRoot, pathname.replace(/^\//, ""));
      const payload = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.setContent(`<form id="form">
      <button type="button" class="validation-summary" data-validation-summary>3 lỗi cần xử lý</button>
      <div class="form-group"><label for="name">Tên</label><input id="name" required></div>
    </form>`);
    await page.addStyleTag({ url: `http://127.0.0.1:${address.port}/views/css/components.css` });
    const result = await page.evaluate(async () => {
      const { validateForm: runValidation } = await import("/frontend/shared/FormValidation.js");
      const form = document.getElementById("form");
      const validation = runValidation(form, { focus: false });
      return {
        valid: validation.valid,
        summaryCount: form.querySelectorAll(".validation-summary, [data-validation-summary]").length,
        fieldError: form.querySelector(".field-validation-error, .error-text")?.textContent || "",
        invalid: document.getElementById("name")?.getAttribute("aria-invalid"),
      };
    });
    assert.equal(result.valid, false);
    assert.equal(result.summaryCount, 0);
    assert.match(result.fieldError, /Vui lòng nhập tên trường này\.|Vui lòng nhập tên\./u);
    assert.equal(result.invalid, "true");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
