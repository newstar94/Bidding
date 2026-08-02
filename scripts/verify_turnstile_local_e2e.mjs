import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";


const baseUrl = process.env.TURNSTILE_E2E_BASE_URL || "http://127.0.0.1:8765";
const expectation = process.env.TURNSTILE_E2E_EXPECTATION || "pass";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  if (expectation === "slow") {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.continue();
    });
  } else if (expectation === "auto-pending") {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => {
      route.fulfill({
        contentType: "application/javascript",
        body: `globalThis.turnstile = {
          render(target) {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = "cf-turnstile-response";
            target.appendChild(input);
            return "auto-pending-widget";
          },
          getResponse() { return ""; },
          reset() {}
        };`,
      });
    });
  } else if (expectation === "script-failure") {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.abort());
  }
  const response = await page.goto(`${baseUrl}/tong-quan`, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`Application returned ${response?.status()}`);

  const csp = response.headers()["content-security-policy"] || "";
  if (!csp.includes("https://challenges.cloudflare.com")) {
    throw new Error("Turnstile origin is missing from the enabled CSP.");
  }
  const enabled = await page.locator('meta[name="bf-turnstile-enabled"]').getAttribute("content");
  const siteKey = await page.locator('meta[name="bf-turnstile-site-key"]').getAttribute("content");
  if (enabled !== "true" || !siteKey) {
    throw new Error("Public Turnstile bootstrap configuration is incomplete.");
  }

  await page.locator("#auth-overlay").waitFor({ state: "visible" });
  if (!await page.locator('.auth-turnstile[data-turnstile-action="login"]').isHidden()) {
    throw new Error("Login challenge must stay hidden before the adaptive threshold.");
  }
  await page.locator("#link-show-register").click();
  await page.locator("#register-username").fill("2");
  await page.locator("#register-email").fill("a@d.n");
  await page.locator("#register-password").fill("12345678");
  await page.locator("#register-confirm-password").fill("12345678");
  await page.locator('#form-auth-register button[type="submit"]').click();
  await page.locator("#register-username-error").waitFor({ state: "visible" });
  await page.locator("#register-fullname-error").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.id === "register-username");
  const inlineValidation = await page.evaluate(() => {
    const username = document.getElementById("register-username");
    const fullName = document.getElementById("register-fullname");
    const usernameError = document.getElementById("register-username-error");
    const fullNameError = document.getElementById("register-fullname-error");
    const summary = document.getElementById("register-error");
    return {
      firstFocused: document.activeElement?.id || "",
      fullNameDescribedBy: fullName?.getAttribute("aria-describedby") || "",
      fullNameErrorBelowControl: fullNameError?.previousElementSibling?.classList.contains("auth-input-wrapper") === true,
      fullNameInvalid: fullName?.getAttribute("aria-invalid") || "",
      fullNameMessage: fullNameError?.textContent?.trim() || "",
      summaryVisible: summary ? getComputedStyle(summary).display !== "none" : false,
      usernameDescribedBy: username?.getAttribute("aria-describedby") || "",
      usernameInvalid: username?.getAttribute("aria-invalid") || "",
      usernameMessage: usernameError?.textContent?.trim() || "",
    };
  });
  if (
    inlineValidation.firstFocused !== "register-username"
    || inlineValidation.usernameInvalid !== "true"
    || inlineValidation.fullNameInvalid !== "true"
    || !inlineValidation.usernameDescribedBy.includes("register-username-error")
    || !inlineValidation.fullNameDescribedBy.includes("register-fullname-error")
    || !inlineValidation.fullNameErrorBelowControl
    || !inlineValidation.usernameMessage.includes("Tên đăng nhập")
    || inlineValidation.fullNameMessage !== "Vui lòng nhập họ và tên."
    || inlineValidation.summaryVisible
  ) {
    throw new Error(`Inline auth validation is inconsistent: ${JSON.stringify(inlineValidation)}`);
  }
  await page.locator("#register-username").fill("nguoidung_2");
  await page.locator("#register-fullname").fill("Nguyễn Văn An");
  const challenge = page.locator('.auth-turnstile[data-turnstile-action="register"]');
  await challenge.waitFor({ state: "attached" });

  const status = challenge.locator('.auth-turnstile-status[role="status"][aria-live="polite"]');
  if (await status.count() !== 1) {
    throw new Error("Turnstile accessible status region is missing.");
  }
  if (expectation === "auto-pending") {
    await page.waitForFunction(
      () => document.querySelector(
        '.auth-turnstile[data-turnstile-action="register"]'
      )?.dataset.state === "ready",
      undefined,
      { timeout: 15_000 },
    );
    const pendingPresentation = await challenge.evaluate((element) => ({
      hidden: element.hidden,
      statusText: element.querySelector(".auth-turnstile-status")?.textContent?.trim() || "",
    }));
    if (!pendingPresentation.hidden) {
      throw new Error(`Automatic Turnstile pending state leaked into the form: ${pendingPresentation.statusText}`);
    }
  } else if (expectation === "script-failure") {
    await page.waitForFunction(
      () => document.querySelector(
        '.auth-turnstile[data-turnstile-action="register"]'
      )?.dataset.state === "error",
      undefined,
      { timeout: 15_000 },
    );
  } else {
    const responseInput = challenge.locator('input[name="cf-turnstile-response"]');
    if (expectation === "slow" && await challenge.getAttribute("data-state") !== "loading") {
      throw new Error("Slow Turnstile loading state was not announced.");
    }
    await responseInput.waitFor({ state: "attached", timeout: 15_000 });
    if (expectation === "pass" || expectation === "slow") {
      await page.waitForFunction(
        () => Boolean(document.querySelector(
          '.auth-turnstile[data-turnstile-action="register"] input[name="cf-turnstile-response"]'
        )?.value),
        undefined,
        { timeout: 15_000 },
      );
      if (!await responseInput.inputValue()) {
        throw new Error("Turnstile did not issue a local test token.");
      }
      if (await challenge.getAttribute("data-state") !== "verified") {
        throw new Error("Turnstile local test token was not accepted by the widget callback.");
      }
      if (!await challenge.isHidden()) {
        throw new Error("Automatically verified Turnstile must not remain visible in the auth form.");
      }
    } else if (expectation === "fail") {
      await page.waitForFunction(
        () => document.querySelector(
          '.auth-turnstile[data-turnstile-action="register"]'
        )?.dataset.state === "error",
        undefined,
        { timeout: 15_000 },
      );
      if (await responseInput.inputValue()) {
        throw new Error("Always-fail Turnstile unexpectedly issued a token.");
      }
      if (await challenge.isHidden()) {
        throw new Error("Failed Turnstile must remain visible so the user can recover.");
      }
    } else if (expectation === "interactive") {
      const deadline = Date.now() + 15_000;
      while (
        Date.now() < deadline
        && !page.frames().some((frame) => frame.url().includes("challenges.cloudflare.com"))
      ) {
        await page.waitForTimeout(200);
      }
      if (!page.frames().some((frame) => frame.url().includes("challenges.cloudflare.com"))) {
        throw new Error("Force-interactive Turnstile challenge frame did not load.");
      }
      await page.waitForFunction(
        () => document.querySelector(
          '.auth-turnstile[data-turnstile-action="register"]'
        )?.dataset.state === "interactive",
        undefined,
        { timeout: 15_000 },
      );
      if (await challenge.isHidden()) {
        throw new Error("Interactive Turnstile must be visible so the user can complete it.");
      }
    } else {
      throw new Error(`Unknown Turnstile E2E expectation: ${expectation}`);
    }
  }
  const shellPresentation = await challenge.evaluate((element) => {
    const shellStyle = getComputedStyle(element);
    const statusElement = element.querySelector(".auth-turnstile-status");
    const statusRect = statusElement?.getBoundingClientRect();
    return {
      backgroundColor: shellStyle.backgroundColor,
      borderTopWidth: shellStyle.borderTopWidth,
      paddingTop: shellStyle.paddingTop,
      statusHeight: statusRect?.height || 0,
    };
  });
  if (
    shellPresentation.backgroundColor !== "rgba(0, 0, 0, 0)"
    || shellPresentation.borderTopWidth !== "0px"
    || shellPresentation.paddingTop !== "0px"
  ) {
    throw new Error("Turnstile shell must not render a nested card background or border.");
  }
  if (shellPresentation.statusHeight > 32) {
    throw new Error("Turnstile status must remain a compact single-line indicator.");
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("Turnstile causes horizontal overflow on a mobile viewport.");
  const accessibility = await new AxeBuilder({ page }).include(".auth-card").analyze();
  const severeViolations = accessibility.violations.filter(({ impact }) => (
    impact === "serious" || impact === "critical"
  ));
  if (severeViolations.length) {
    throw new Error(`Turnstile auth accessibility violations: ${severeViolations.map(({ id }) => id).join(", ")}`);
  }

  process.stdout.write(`Turnstile local browser verification passed (${expectation}).\n`);
} finally {
  await browser.close();
}
