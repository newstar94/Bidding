import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

test("package detail version selector uses the shared styled dropdown", async () => {
  const [template, coordinator, helper, combobox, components, index] = await Promise.all([
    readFile(new URL("../../views/tabs/tab_goithau_detail.html", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/packages/detail/PackageDetailCoordinator.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/shared/view_helpers.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/shared/accessibleCombobox.js", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/components.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/index.html", import.meta.url), "utf8"),
  ]);

  assert.match(
    template,
    /id="detail-workflow-version-select" class="page-version-select/u,
  );
  assert.doesNotMatch(coordinator, /verSelect\.dataset\.noCustom/u);
  assert.match(
    coordinator,
    /import \{[^}]*initCustomSelect[^}]*\} from "\.\.\/\.\.\/shared\/view_helpers\.js"/su,
  );
  assert.match(
    coordinator,
    /initCustomSelect\("detail-workflow-version-select"\)/u,
  );
  assert.match(
    helper,
    /showToggle:\s*!isVersionSelect/u,
  );
  assert.match(
    combobox,
    /wrapper\.classList\.contains\("version-select-container"\)[\s\S]*list\.classList\.add\("version-select-options"\)/u,
  );
  assert.match(
    components,
    /\.custom-select-options\.version-select-options\s*\{[^}]*min-width:\s*52px[^}]*border-radius:\s*4px/su,
  );
  assert.match(
    components,
    /\.custom-select-options\.version-select-options li\s*\{[^}]*font-size:\s*0\.75rem[^}]*text-align:\s*center/su,
  );
  assert.match(
    combobox,
    /const dropdownGap = 6;[\s\S]*rect\.bottom \+ scrollY \+ dropdownGap/su,
  );
  assert.match(
    combobox,
    /rect\.top \+ scrollY - dropdownHeight - dropdownGap/su,
  );
  assert.match(index, /components\.css\?v=2\.0/u);
});

test("package detail keeps the back action at the upper right when the title wraps", async () => {
  const [components, generated] = await Promise.all([
    readFile(new URL("../../views/css/components.css", import.meta.url), "utf8"),
    readFile(new URL("../../views/css/generated-static-styles.css", import.meta.url), "utf8"),
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 920, height: 600 } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
      <style>${components}</style>
      <style>${generated}</style>
    </head><body>
      <section style="width: 840px">
        <div class="card bf-s-115a326dbb" id="detail-workflow-card">
          <div class="card-header bf-s-b9d70c9b32">
            <div class="bf-s-bd53bc7485" id="package-detail-heading">
              <div class="bf-s-0a8a14e03e">
                <span id="detail-workflow-code">IB2600212155</span>
                <span>01</span>
                <span>Đang mời thầu</span>
              </div>
              <h3 id="detail-workflow-title" class="bf-s-4749e65682">
                Mua sắm thuốc Generic bổ sung phục vụ công tác khám bệnh, chữa bệnh năm 2026
                của Trung tâm Y tế khu vực Trạm Tấu và các đơn vị trực thuộc
              </h3>
            </div>
            <div id="detail-workflow-actions" class="bf-s-ea34a9fdaf">
              <button class="btn btn-outline bf-s-884f09ff2f">Quay lại danh sách</button>
            </div>
          </div>
        </div>
      </section>
    </body></html>`);

    const layout = await page.evaluate(() => {
      const header = document.querySelector("#detail-workflow-card > .card-header");
      const heading = document.getElementById("package-detail-heading");
      const title = document.getElementById("detail-workflow-title");
      const actions = document.getElementById("detail-workflow-actions");
      const button = actions.querySelector("button");
      const rect = (element) => element.getBoundingClientRect();
      const headerRect = rect(header);
      const headingRect = rect(heading);
      const titleRect = rect(title);
      const actionsRect = rect(actions);
      const buttonRect = rect(button);
      return {
        headerTop: headerRect.top,
        headerHeight: headerRect.height,
        headingTop: headingRect.top,
        headingHeight: headingRect.height,
        headingRight: headingRect.right,
        titleHeight: titleRect.height,
        actionsTop: actionsRect.top,
        actionsHeight: actionsRect.height,
        actionsLeft: actionsRect.left,
        buttonRight: buttonRect.right,
        headerRight: headerRect.right,
        overflowsHorizontally: header.scrollWidth > header.clientWidth,
      };
    });

    assert.ok(
      Math.abs(
        (layout.actionsTop + layout.actionsHeight / 2)
        - (layout.headingTop + layout.headingHeight / 2),
      ) <= 2,
      `back action must be vertically centered with the heading: ${JSON.stringify(layout)}`,
    );
    assert.ok(
      layout.actionsLeft >= layout.headingRight,
      `back action must remain in the right column: ${JSON.stringify(layout)}`,
    );
    assert.ok(
      layout.titleHeight > 30,
      `long title must wrap inside the left column: ${JSON.stringify(layout)}`,
    );
    assert.ok(layout.buttonRight <= layout.headerRight + 1);
    assert.equal(layout.overflowsHorizontally, false);
  } finally {
    await browser.close();
  }
});

test("package detail version selector survives switching from version 01 to 00", async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        response.writeHead(200, { "content-type": contentType(".html") });
        response.end(`<!doctype html><html><head>
          <link rel="stylesheet" data-runtime-styles href="/css/runtime-styles.css">
        </head><body>
          <span id="detail-workflow-code"></span>
          <span id="detail-workflow-version-separator"></span>
          <span id="detail-workflow-status-badge"></span>
          <h3 id="detail-workflow-title"></h3>
          <div><select id="detail-workflow-version-select" class="page-version-select"></select></div>
          <div id="detail-workflow-actions"></div>
          <div id="detail-workflow-tabs-header"></div>
          <div id="detail-workflow-content-wrapper"></div>
        </body></html>`);
        return;
      }
      const filePath = pathname === "/css/runtime-styles.css"
        ? join(projectRoot, "views", "css", "runtime-styles.css")
        : join(projectRoot, pathname.replace(/^\//, ""));
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
      const { bindPackageDetailChrome } = await import(
        "/frontend/packages/detail/PackageDetailCoordinator.js"
      );
      const view = {
        getStatusBadge: () => "Đang mời thầu",
        showPackageDetails: () => {},
      };
      const versions = [
        { id: "package-00", label: "00", selected: false },
        { id: "package-01", label: "01", selected: true },
      ];
      const detail = (packageId, selectedVersion) => ({
        packageId,
        pkg: { id: packageId, maGoiThau: "IB2600212155", tenGoiThau: "Gói thầu" },
        effectiveStatus: "Đang mời thầu",
        canCancel: false,
        tabs: [],
        activeTab: "preparation",
        versions: versions.map((version) => ({
          ...version,
          selected: version.label === selectedVersion,
        })),
      });

      const dispose01 = bindPackageDetailChrome(view, detail("package-01", "01"));
      const before = document.querySelectorAll(
        '.custom-select-container[data-target="detail-workflow-version-select"]',
      ).length;
      dispose01();
      const dispose00 = bindPackageDetailChrome(view, detail("package-00", "00"));
      const wrapper = document.querySelector(
        '.custom-select-container[data-target="detail-workflow-version-select"]',
      );
      const after = {
        count: wrapper ? 1 : 0,
        label: wrapper?.querySelector(".custom-select-trigger")?.value || "",
        options: document.getElementById("detail-workflow-version-select")?.options.length || 0,
      };
      dispose00();
      return { before, after };
    });

    assert.deepEqual(result, {
      before: 1,
      after: { count: 1, label: "00", options: 2 },
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
