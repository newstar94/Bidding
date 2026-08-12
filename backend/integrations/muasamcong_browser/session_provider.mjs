import fs from "node:fs";


export const MSC_PORTAL_URL = "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection";
export const MSC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LAUNCH_ARGS = Object.freeze([
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--ignore-certificate-errors",
  "--disable-blink-features=AutomationControlled",
  "--window-size=1280,800",
]);


function systemExecutablePath(explicitPath = "", fallbackPath = "") {
  const candidates = [
    explicitPath,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    fallbackPath,
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}


function timeout(promise, timeoutMs, code = "PROCUREMENT_TIMEOUT") {
  let timeoutId;
  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeoutId));
}


const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));


export class MscSessionProvider {
  constructor({
    puppeteer,
    executablePath = "",
    fallbackExecutablePath = "",
    ttlMs = 30 * 60 * 1000,
    navigationTimeoutMs = 20_000,
    sessionTimeoutMs = 60_000,
    refreshAheadMs = 5 * 60 * 1000,
    headless = true,
    recaptchaSiteKey = "",
    clock = () => Date.now(),
    fetchImpl = globalThis.fetch,
    sleep = delay,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    if (!puppeteer || typeof puppeteer.launch !== "function") {
      throw new Error("PROCUREMENT_BROWSER_FAILED");
    }
    this.puppeteer = puppeteer;
    this.executablePath = executablePath;
    this.fallbackExecutablePath = fallbackExecutablePath;
    this.ttlMs = Math.max(60_000, Math.min(Number(ttlMs) || 1_800_000, 3_600_000));
    this.navigationTimeoutMs = Math.max(
      5_000,
      Math.min(Number(navigationTimeoutMs) || 20_000, 60_000),
    );
    this.sessionTimeoutMs = Math.max(
      this.navigationTimeoutMs,
      Math.min(Number(sessionTimeoutMs) || 60_000, 120_000),
    );
    this.refreshAheadMs = Math.max(
      1_000,
      Math.min(
        Number(refreshAheadMs) || 300_000,
        Math.max(1_000, Math.floor(this.ttlMs / 2)),
      ),
    );
    this.headless = headless === false ? false : "new";
    this.recaptchaSiteKey = String(recaptchaSiteKey || "").trim();
    this.clock = clock;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.cached = null;
    this.refreshPromise = null;
    this.refreshTimer = null;
    this.lastError = null;
    this.refreshCount = 0;
    this.lastBrowserStartupMs = 0;
  }

  _valid() {
    return Boolean(
      this.cached?.token
      && this.clock() - this.cached.fetchedAt < this.ttlMs,
    );
  }

  async acquire({ forceRefresh = false } = {}) {
    if (!forceRefresh && this._valid()) return { ...this.cached };
    if (this.refreshPromise) return { ...(await this.refreshPromise) };
    this.refreshPromise = timeout(
      this._refresh(),
      this.sessionTimeoutMs,
      "PROCUREMENT_SESSION_FAILED",
    );
    try {
      return { ...(await this.refreshPromise) };
    } finally {
      this.refreshPromise = null;
    }
  }

  refresh() {
    return this.acquire({ forceRefresh: true });
  }

  invalidate() {
    if (this.refreshTimer !== null) {
      this.clearTimer(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.cached = null;
  }

  _scheduleRefresh() {
    if (this.refreshTimer !== null) this.clearTimer(this.refreshTimer);
    const delayMs = Math.max(1_000, this.ttlMs - this.refreshAheadMs);
    this.refreshTimer = this.setTimer(async () => {
      this.refreshTimer = null;
      try {
        await this.acquire({ forceRefresh: true });
      } catch {
        // A foreground caller can still use the unexpired cached session and
        // will retry refresh through the normal bounded policy if needed.
      }
    }, delayMs);
    this.refreshTimer?.unref?.();
  }

  health() {
    return {
      status: this._valid() ? "UP" : this.lastError ? "SESSION_DEGRADED" : "PARTIAL",
      cached: this._valid(),
      refreshing: Boolean(this.refreshPromise),
      refreshCount: this.refreshCount,
      browserStartupMs: this.lastBrowserStartupMs,
      lastError: this.lastError,
    };
  }

  metadata() {
    return {
      provider: "BrowserSessionV1",
      fetchedAt: this.cached?.fetchedAt || null,
      ageMs: this.cached ? Math.max(0, this.clock() - this.cached.fetchedAt) : null,
      ttlMs: this.ttlMs,
      hasToken: Boolean(this.cached?.token),
      hasCookie: Boolean(this.cached?.cookie),
    };
  }

  async _refresh() {
    let browser = null;
    let foundToken = "";
    let foundCookie = "";
    let resolveCapturedToken;
    const capturedToken = new Promise((resolve) => {
      resolveCapturedToken = resolve;
    });
    const waitForCapturedToken = async (milliseconds) => {
      if (foundToken) return;
      await Promise.race([capturedToken, this.sleep(milliseconds)]);
    };
    const startupStarted = this.clock();
    try {
      void Promise.resolve()
        .then(() => this.fetchImpl(MSC_PORTAL_URL, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(8_000),
          headers: { "user-agent": MSC_USER_AGENT },
        }))
        .then((response) => response.body?.cancel?.().catch(() => {}))
        .catch(() => null);

      const launchOptions = {
        headless: this.headless,
        args: [...LAUNCH_ARGS],
      };
      const executablePath = systemExecutablePath(
        this.executablePath,
        this.fallbackExecutablePath,
      );
      if (executablePath) launchOptions.executablePath = executablePath;
      browser = await this.puppeteer.launch(launchOptions);
      this.lastBrowserStartupMs = Math.max(0, this.clock() - startupStarted);
      const page = await browser.newPage();
      await page.setBypassCSP(true);
      await page.setUserAgent(MSC_USER_AGENT);

      page.on("request", (request) => {
        try {
          const parsed = new URL(request.url());
          const token = parsed.searchParams.get("token") || "";
          if (token.length > 20) {
            foundToken = token;
            resolveCapturedToken();
          }
        } catch {
          // Ignore malformed third-party request URLs.
        }
      });

      await page.goto(MSC_PORTAL_URL, {
        waitUntil: "domcontentloaded",
        timeout: this.navigationTimeoutMs,
      }).catch(() => null);
      await page.evaluate(() => window.stop()).catch(() => null);

      if (!foundToken) {
        try {
          await page.waitForSelector("button, .btn-search, [type='submit']", {
            timeout: 1_000,
          });
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button"));
            const search = buttons.find((button) => (
              button.textContent?.includes("Tìm kiếm")
              || String(button.className || "").includes("search")
            ));
            search?.click();
          });
          await waitForCapturedToken(3_000);
        } catch {
          await waitForCapturedToken(3_000);
        }
      }

      if (!foundToken) {
        try {
          if (!this.recaptchaSiteKey) throw new Error("Missing reCAPTCHA site key");
          const hasRecaptcha = await page.evaluate(
            () => typeof window.grecaptcha !== "undefined",
          );
          if (!hasRecaptcha) {
            await timeout(page.addScriptTag({
              url: `https://www.google.com/recaptcha/api.js?render=${this.recaptchaSiteKey}`,
            }), 15_000, "PROCUREMENT_SESSION_FAILED");
          }
          await page.waitForFunction(
            () => window.grecaptcha && typeof window.grecaptcha.execute === "function",
            { timeout: 20_000 },
          );
          foundToken = await timeout(
            page.evaluate((siteKey) => new Promise((resolve, reject) => {
              window.grecaptcha.ready(() => {
                window.grecaptcha.execute(siteKey, { action: "submit" })
                  .then(resolve)
                  .catch(reject);
              });
            }), this.recaptchaSiteKey),
            20_000,
            "PROCUREMENT_SESSION_FAILED",
          );
        } catch {
          // The normalized error below keeps secrets and upstream HTML private.
        }
      }

      const cookies = await page.cookies();
      if (Array.isArray(cookies) && cookies.length) {
        foundCookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
      }
      if (!foundToken) throw new Error("PROCUREMENT_SESSION_FAILED");
      this.cached = {
        token: foundToken,
        cookie: foundCookie,
        fetchedAt: this.clock(),
      };
      this._scheduleRefresh();
      this.refreshCount += 1;
      this.lastError = null;
      return this.cached;
    } catch (error) {
      this.lastError = /timeout/i.test(String(error?.message || ""))
        ? "PROCUREMENT_TIMEOUT"
        : "PROCUREMENT_SESSION_FAILED";
      throw new Error(this.lastError);
    } finally {
      await browser?.close?.().catch(() => null);
    }
  }
}

