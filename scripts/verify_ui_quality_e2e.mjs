import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const viewports = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
];
const results = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const httpErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().includes("/api/")) {
        httpErrors.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const loader = document.getElementById("system-init-loader");
      return loader?.getAttribute("aria-busy") === "false" && getComputedStyle(loader).visibility === "hidden";
    }, null, { timeout: 20_000 });

    const metrics = await page.evaluate(() => {
      const visibleControls = [...document.querySelectorAll("button, input, a, select, textarea")]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
      const unnamed = visibleControls.filter((element) => {
        const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
        return !String(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || element.value || label?.textContent || "").trim();
      }).map((element) => `${element.tagName.toLowerCase()}#${element.id}`);
      const submit = document.querySelector('#form-auth-login button[type="submit"]');
      const google = document.querySelector("#google-signin-btn-container");
      return {
        viewport: [innerWidth, innerHeight],
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        language: document.documentElement.lang,
        font: getComputedStyle(document.body).fontFamily,
        bodyText: document.body.innerText,
        unnamed,
        submitRect: submit ? { width: submit.getBoundingClientRect().width, height: submit.getBoundingClientRect().height } : null,
        googleRect: google ? { width: google.getBoundingClientRect().width, height: google.getBoundingClientRect().height } : null,
      };
    });
    if (metrics.horizontalOverflow) throw new Error(`${viewport.name}: horizontal overflow ${JSON.stringify(metrics)}`);
    if (metrics.language !== "vi" || !metrics.font.includes("Plus Jakarta Sans")) {
      throw new Error(`${viewport.name}: wrong language/font ${JSON.stringify(metrics)}`);
    }
    const mojibakeMatch = /\ufffd|\u00c3\u0192|\u00c3\u00a2\u00e2|\u00c4\u2018|\u00c4\u0192|\u00c6\u00b0|\u00e1\u00bb|\u00e1\u00ba/.exec(metrics.bodyText);
    if (mojibakeMatch) {
      const start = Math.max(0, mojibakeMatch.index - 80);
      throw new Error(`${viewport.name}: mojibake detected near ${JSON.stringify(metrics.bodyText.slice(start, mojibakeMatch.index + 120))}`);
    }
    if (metrics.unnamed.length) throw new Error(`${viewport.name}: unnamed visible controls ${metrics.unnamed.join(", ")}`);
    if (!metrics.submitRect || metrics.submitRect.height < 40 || !metrics.googleRect || metrics.googleRect.height < 40) {
      throw new Error(`${viewport.name}: touch targets too small ${JSON.stringify(metrics)}`);
    }

    await page.locator("#login-username").focus();
    await page.keyboard.press("Shift+Tab");
    const reverseTabInsideAuth = await page.evaluate(() => Boolean(document.activeElement?.closest?.("#auth-overlay")));
    if (!reverseTabInsideAuth) throw new Error(`${viewport.name}: reverse Tab escaped the login overlay`);
    await page.locator("#login-username").focus();
    await page.keyboard.press("Tab");
    const firstTabTarget = await page.evaluate(() => document.activeElement?.id || "");
    if (firstTabTarget !== "login-password") throw new Error(`${viewport.name}: username Tab moved to ${firstTabTarget}`);
    await page.locator("#login-password").focus();
    await page.keyboard.press("Enter");
    const validation = await page.evaluate(() => ({
      formValid: document.getElementById("form-auth-login")?.checkValidity(),
      usernameMissing: document.getElementById("login-username")?.validity?.valueMissing,
      activeElement: document.activeElement?.id || ""
    }));
    if (validation.formValid !== false || validation.usernameMissing !== true || validation.activeElement !== "login-username") {
      throw new Error(`${viewport.name}: keyboard validation missing ${JSON.stringify(validation)}`);
    }
    await page.route("**/api/auth/login", (route) => route.abort("internetdisconnected"));
    await page.locator("#login-username").fill("network-probe");
    await page.locator("#login-password").fill("Valid!Network9");
    await page.locator("#form-auth-login button[type='submit']").click();
    await page.locator("#login-error").waitFor({ state: "visible", timeout: 10_000 });
    const networkMessage = await page.locator("#login-error").innerText();
    if (!/Lỗi kết nối máy chủ|Không thể kết nối/i.test(networkMessage)) {
      throw new Error(`${viewport.name}: login network error was unclear: ${networkMessage}`);
    }
    const expectedNetworkConsole = consoleErrors.findIndex((message) => message.includes("ERR_INTERNET_DISCONNECTED"));
    if (expectedNetworkConsole >= 0) consoleErrors.splice(expectedNetworkConsole, 1);
    for (let index = consoleErrors.length - 1; index >= 0; index -= 1) {
      if (consoleErrors[index].includes("Applying inline style violates") && consoleErrors[index].includes("accounts.google.com")) {
        consoleErrors.splice(index, 1);
      }
    }
    await page.unroute("**/api/auth/login");
    if (pageErrors.length || consoleErrors.length || httpErrors.length) {
      throw new Error(`${viewport.name}: runtime errors ${JSON.stringify({ pageErrors, consoleErrors, httpErrors })}`);
    }
    results.push({ name: viewport.name, ...metrics, reverseTabInsideAuth, keyboardTarget: firstTabTarget, validation, networkMessage });
    await context.close();
  }
  process.stdout.write(`${JSON.stringify({ viewports: results }, null, 2)}\n`);
} finally {
  await browser.close();
}
