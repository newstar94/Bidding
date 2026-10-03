import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

test("partner create forms initialize once and respect navigation while address data is pending", async () => {
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  const markup = (await Promise.all(["nhathau", "chudautu"].map(
    (name) => readFile(join(projectRoot, `views/modals/modal_${name}.html`), "utf8"),
  ))).join("");
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (!extname(pathname)) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head>
          <link rel="stylesheet" data-runtime-styles href="/views/css/runtime-styles.css">
          </head><body>
          <h1 id="page-title"></h1>
          <section class="tab-pane" id="tab-nhathau"></section>
          <section class="tab-pane" id="tab-chudautu"></section>
          <button id="btn-add-nhathau">Thêm Nhà thầu mới</button>
          <button id="btn-add-chudautu">Thêm Chủ đầu tư mới</button>${markup}</body></html>`);
        return;
      }
      const payload = await readFile(join(projectRoot, pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": extname(pathname) === ".css"
        ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const tab of ["nhathau", "chudautu"]) {
      for (const entry of ["button", "route", "navigation-away", "lazy-navigation-away"]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/${tab}`);
        await page.evaluate(async ({ tab, entry }) => {
          const { editNhaThau } = await import("/frontend/partners/NhaThauWorkflow.js");
          const { editChuDauTu } = await import("/frontend/partners/ChuDauTuWorkflow.js");
          const { switchTab } = await import("/frontend/app/BiddingControllerUI.js");
          const { setupActionListeners } = await import("/frontend/app/BiddingControllerForms.js");
          let releaseAddress;
          let addressStarts = 0;
          let editorStarts = 0;
          let opens = 0;
          const alerts = [];
          const pendingEditors = [];
          const addressReady = new Promise((resolve) => { releaseAddress = resolve; });
          const controller = {
            model: {
              state: { activetab: tab, activeaction: null, activeuser: { id: "specialist" }, nhathau: [], chudautu: [] },
              hasPermission: () => true,
              formatForDateInput: (value) => value,
              getLatestNhaThau: () => [], getLatestChuDauTu: () => [],
            },
            routeMap: { nhathau: "nha-thau", chudautu: "chu-dau-tu" },
            actionMap: { taomoi: "tao-moi" }, _workflowModulesReady: true, lazyTabPartials: {},
            view: {
              elements: { pageTitle: document.getElementById("page-title") },
              areViewModulesReady: () => true,
              openModal(id) { opens += 1; document.getElementById(id).classList.add("active"); },
              customAlert(title, message) { alerts.push({ title, message }); },
            },
            renderTabData() { return new Promise((resolve) => requestAnimationFrame(resolve)); },
            switchTab(...args) { return switchTab.call(this, ...args); },
            async initAddressDropdowns() { addressStarts += 1; await addressReady; },
          };
          if (entry === "lazy-navigation-away") {
            const modal = document.getElementById(`modal-${tab}`);
            modal.remove();
            controller.ensureLazyModal = async () => {
              await addressReady;
              document.body.appendChild(modal);
            };
          }
          const startEditor = (implementation, id) => {
            editorStarts += 1;
            // Bound the broken recursion so this regression can report its cause.
            if (editorStarts > 4) return Promise.resolve();
            const task = implementation.call(controller, id);
            pendingEditors.push(task);
            return task;
          };
          controller.partners = {
            editContractor: (id) => startEditor(editNhaThau, id),
            editInvestor: (id) => startEditor(editChuDauTu, id),
          };
          setupActionListeners.call(controller);
          window.__partnerCreateFixture = {
            releaseAddress, pendingEditors, controller,
            state: () => ({ editorStarts, addressStarts, opens, alerts }),
          };
          if (entry === "route") await controller.switchTab(tab, "taomoi", false);
          else document.getElementById(`btn-add-${tab}`).click();
        }, { tab, entry });
        const started = await page.evaluate(() => window.__partnerCreateFixture.state());
        assert.equal(started.addressStarts, entry === "lazy-navigation-away" ? 0 : 1,
          JSON.stringify({ tab, entry, started, pageErrors }));
        const beforeAddress = await page.evaluate(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return window.__partnerCreateFixture.state();
        });
        const addressStarts = entry === "lazy-navigation-away" ? 0 : 1;
        assert.deepEqual(beforeAddress, {
          editorStarts: 1, addressStarts,
          opens: entry === "lazy-navigation-away" ? 0 : 1, alerts: [],
        }, `${tab} ${entry}: the modal must open while address data is pending`);
        const destination = tab === "nhathau" ? "chudautu" : "nhathau";
        const navigatesAway = entry.endsWith("navigation-away");
        if (navigatesAway) {
          await page.evaluate((destination) => (
            window.__partnerCreateFixture.controller.switchTab(destination, null, true)
          ), destination);
        }
        const afterAddress = await page.evaluate(async (tab) => {
          const fixture = window.__partnerCreateFixture;
          fixture.releaseAddress();
          await Promise.all(fixture.pendingEditors);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return {
            ...fixture.state(), path: location.pathname,
            tab: fixture.controller.model.state.activetab, action: fixture.controller.model.state.activeaction,
            active: document.getElementById(`modal-${tab}`).classList.contains("active"),
          };
        }, tab);
        const expectedTab = navigatesAway ? destination : tab;
        const expectedPath = expectedTab === "nhathau" ? "/nha-thau" : "/chu-dau-tu";
        assert.deepEqual(afterAddress, {
          editorStarts: 1, addressStarts, opens: entry === "lazy-navigation-away" ? 0 : 1, alerts: [],
          path: expectedPath + (navigatesAway ? "" : "/tao-moi"),
          tab: expectedTab, action: navigatesAway ? null : "taomoi",
          active: !navigatesAway,
        }, `${tab} ${entry}`);
      }
    }
    for (const tab of ["chudautu", "nhathau"]) {
      for (const mode of ["create", "saved", "saved-cleared", "ward-edited", "raw", "raw-edited", "newer-form", ...(tab === "nhathau" ? ["readonly"] : [])]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/${tab}`);
        await page.evaluate(async ({ tab, mode }) => {
          const { editNhaThau } = await import("/frontend/partners/NhaThauWorkflow.js");
          const { editChuDauTu } = await import("/frontend/partners/ChuDauTuWorkflow.js");
          const { initAddressDropdowns } = await import("/frontend/shared/PartnerHelpers.js");
          const { PARTNER_FORM_CONFIGS } = await import("/frontend/partners/PartnerFormController.js");
          const config = PARTNER_FORM_CONFIGS[tab];
          const prefix = tab === "chudautu" ? "cdt" : "nt";
          const provinces = [{ code: "01", name: "Tỉnh P" }, { code: "02", name: "Tỉnh Q" }];
          const wards = { "01": [{ code: "001", name: "Phường W" }], "02": [{ code: "002", name: "Phường X" }] };
          let releaseAddress;
          let releaseWards;
          const addressReady = new Promise((resolve) => { releaseAddress = resolve; });
          const wardsReady = new Promise((resolve) => { releaseWards = resolve; });
          const addressTasks = [];
          window.fetch = async (url) => {
            const path = String(url);
            if (path.endsWith("/api/address/provinces")) {
              await addressReady;
              return new Response(JSON.stringify(provinces));
            }
            const provinceCode = path.match(/\/api\/address\/wards\/(\d+)$/u)?.[1];
            if (provinceCode) {
              if (mode === "ward-edited") await wardsReady;
              return new Response(JSON.stringify(wards[provinceCode]));
            }
            throw new Error(`Unexpected request: ${path}`);
          };
          const raw = "12 Main, Phường W, Tỉnh P";
          const record = {
            id: "record-1", [config.codeField]: "CODE-1", [config.nameField]: "Partner One",
            [config.representativeField]: "Nguyễn An", chucVuDaiDien: "Giám đốc",
            chucVuNguoiDungDau: "Giám đốc", ngayApDung: "2026-10-03",
            soTaiKhoan: "123456789012", noiMoTaiKhoan: "Bank Full", soDienThoai: "0901234567",
            email: "partner@example.test", coQuanChuQuan: "Agency Full",
            diaChi: mode.startsWith("raw") || mode === "newer-form" ? raw : "12 Main | Phường W | Tỉnh P",
            diaChiGoc: raw, anhDau: "data:image/png;base64,AAAA",
          };
          const controller = {
            _tabTransitionVersion: 1,
            model: {
              state: { activetab: tab, activeuser: { id: "owner" }, [tab]: [record] },
              hasPermission: () => true,
              formatForDateInput: (value) => value,
              getLatestNhaThau: () => [record], getLatestChuDauTu: () => [record],
            },
            switchTab() { this._tabTransitionVersion += 1; },
            initAddressDropdowns(...args) {
              const task = initAddressDropdowns(...args);
              addressTasks.push(task);
              return task;
            },
            view: {
              openModal(id) { document.getElementById(id).classList.add("active"); },
              customAlert(_title, message) { throw new Error(message); },
            },
          };
          const editor = tab === "chudautu" ? editChuDauTu : editNhaThau;
          const editorTasks = [editor.call(controller, mode === "create" ? null : record.id, mode === "readonly")];
          const selectedName = (id) => {
            const select = document.getElementById(id);
            return select.options[select.selectedIndex]?.dataset.name || "";
          };
          window.__partnerAddressFixture = {
            releaseAddress, releaseWards, addressTasks, editorTasks, controller, editor, record, prefix,
            state: () => ({
              active: document.getElementById(`modal-${tab}`).classList.contains("active"),
              name: document.getElementById(`${prefix}-ten`).value,
              account: document.getElementById(`${prefix}-sotaikhoan`).value,
              bank: document.getElementById(`${prefix}-noimotaikhoan`).value,
              phone: document.getElementById(`${prefix}-sdt`).value,
              email: document.getElementById(`${prefix}-email`).value,
              detail: document.getElementById(`${prefix}-diachichitiet`).value,
              province: selectedName(`${prefix}-tinh`), ward: selectedName(`${prefix}-xa`),
              wardCodes: Array.from(document.getElementById(`${prefix}-xa`).options).map((option) => option.value),
              provinceDisabled: document.getElementById(`${prefix}-tinh`).disabled,
              wardDisabled: document.getElementById(`${prefix}-xa`).disabled,
              raw: document.getElementById(`form-${tab}`).dataset.diaChiGoc,
            }),
          };
        }, { tab, mode });
        const before = await page.evaluate(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return window.__partnerAddressFixture.state();
        });
        assert.equal(before.active, true, `${tab} ${mode}: address pending must not delay modal`);
        if (mode !== "create") {
          assert.equal(before.account, "123456789012");
          assert.equal(before.bank, "Bank Full");
          assert.equal(before.phone, "0901234567");
          assert.equal(before.email, "partner@example.test");
          assert.equal(before.raw, "12 Main, Phường W, Tỉnh P");
          assert.equal(before.detail, mode.startsWith("raw") || mode === "newer-form" ? before.raw : "12 Main");
          if (mode === "saved" || mode === "readonly" || mode === "saved-cleared" || mode === "ward-edited") {
            assert.equal(before.province, "Tỉnh P");
            assert.equal(before.ward, "Phường W");
          }
        }
        if (mode === "create" || mode === "raw-edited") {
          await page.evaluate(() => {
            const prefix = window.__partnerAddressFixture.prefix;
            document.getElementById(`${prefix}-ten`).value = "Entered Name";
            document.getElementById(`${prefix}-sotaikhoan`).value = "Entered Account";
            document.getElementById(`${prefix}-diachichitiet`).value = "Entered Detail";
          });
        } else if (mode === "saved-cleared") {
          await page.evaluate(() => {
            const select = document.getElementById(`${window.__partnerAddressFixture.prefix}-tinh`);
            select.value = "";
            select.dispatchEvent(new Event("change", { bubbles: true }));
          });
        } else if (mode === "ward-edited") {
          await page.evaluate(async () => {
            const fixture = window.__partnerAddressFixture;
            fixture.releaseAddress();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            document.getElementById(`${fixture.prefix}-xa`).value = "";
          });
        } else if (mode === "newer-form") {
          await page.evaluate(() => {
            const fixture = window.__partnerAddressFixture;
            const configRecord = fixture.record;
            fixture.controller.model.state[fixture.prefix === "cdt" ? "chudautu" : "nhathau"].push({
              ...configRecord, id: "record-2", diaChi: "Other Detail | Phường X | Tỉnh Q", diaChiGoc: "Other Raw",
            });
            fixture.editorTasks.push(fixture.editor.call(fixture.controller, "record-2"));
          });
        }
        const after = await page.evaluate(async () => {
          const fixture = window.__partnerAddressFixture;
          fixture.releaseAddress();
          fixture.releaseWards();
          await Promise.all([...fixture.editorTasks, ...fixture.addressTasks]);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return fixture.state();
        });
        assert.equal(after.active, true, `${tab} ${mode}`);
        if (mode === "create" || mode === "raw-edited") {
          assert.equal(after.name, "Entered Name");
          assert.equal(after.account, "Entered Account");
          assert.equal(after.detail, "Entered Detail");
        } else if (mode === "saved-cleared") {
          assert.equal(after.detail, "12 Main");
          assert.equal(after.province, "");
          assert.equal(after.ward, "");
        } else if (mode === "ward-edited") {
          assert.equal(after.detail, "12 Main");
          assert.equal(after.province, "Tỉnh P");
          assert.equal(after.ward, "");
          assert.ok(after.wardCodes.includes("001"), "catalog choices must remain available after a user clears the saved ward");
        } else if (mode === "newer-form") {
          assert.equal(after.detail, "Other Detail");
          assert.equal(after.province, "Tỉnh Q");
          assert.equal(after.ward, "Phường X");
          assert.equal(after.raw, "Other Raw");
        } else {
          assert.equal(after.detail, "12 Main");
          assert.equal(after.province, "Tỉnh P");
          assert.equal(after.ward, "Phường W");
        }
        if (mode === "readonly") {
          assert.equal(before.provinceDisabled, true);
          assert.equal(before.wardDisabled, true);
          assert.equal(after.provinceDisabled, true);
          assert.equal(after.wardDisabled, true);
        }
      }
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
