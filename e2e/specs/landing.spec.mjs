import { expect, test } from "@playwright/test";

const REQUIRED_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];

test.beforeEach(async ({ browserName, context, page }) => {
  page.__bfRuntimeFailures = [];
  page.on("requestfailed", (request) => {
    page.__bfRuntimeFailures.push(
      `requestfailed: ${request.url()} (${request.failure()?.errorText || "unknown"})`,
    );
  });
  page.on("console", (message) => {
    if (message.type() === "error") page.__bfRuntimeFailures.push(`console: ${message.text()}`);
  });
  if (browserName === "firefox") {
    await context.route("http://local.adguard.org/**", (route) => route.abort("blockedbyclient"));
  }
  const browserReady = await page.goto("/health/live", { waitUntil: "commit" });
  expect(browserReady?.ok()).toBe(true);
});

async function openLanding(page) {
  // The assertions below are the page's semantic readiness contract. Host-level
  // browser instrumentation can hold DOMContentLoaded after the landing DOM is
  // already complete, especially in Firefox/WebKit on Windows.
  if (page.url() !== "about:blank") {
    await page.goto("about:blank", { waitUntil: "commit" });
  }
  const response = await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("html")).toHaveAttribute("data-bf-shell", "landing");
  await expect(page.locator("body")).not.toHaveAttribute("hidden", "");
  await expect(page.locator("body")).toHaveClass(/landing-ready/u).catch((error) => {
    throw new Error(
      page.__bfRuntimeFailures.join("\n") || "landing bootstrap did not reach its ready state",
      { cause: error },
    );
  });
  await expect(page.locator("h1")).toHaveCount(1);
  return response;
}

async function resetScroll(page) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
  });
  // History restoration and the sticky header can leave a small, stable
  // scroll-anchor offset. The next assertion measures native movement from
  // that settled baseline instead of treating the offset as a scroll lock.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(16);
  return page.evaluate(() => window.scrollY);
}

async function expectHistoryPositionRestored(page) {
  await expect(page).toHaveURL(/#giai-phap$/u);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  // The landing document intentionally uses smooth anchor navigation. A URL
  // and non-zero offset can therefore be observable while the compositor is
  // still restoring the history entry. Wait for the native scroll position to
  // settle before issuing a new input; otherwise that pending restoration can
  // overwrite the wheel movement being verified below.
  await page.evaluate(() => new Promise((resolve) => {
    let previous = window.scrollY;
    let stableFrames = 0;
    const observe = () => {
      const current = window.scrollY;
      stableFrames = Math.abs(current - previous) < 1 ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 5) resolve();
      else requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }));
}

async function expectStoredHistoryPositionRestored(page) {
  await expect.poll(() => page.evaluate(() => {
    const savedPosition = Number(history.state?.bfLandingScrollY);
    return Number.isFinite(savedPosition)
      ? Math.abs(window.scrollY - savedPosition)
      : Number.POSITIVE_INFINITY;
  })).toBeLessThanOrEqual(1);
  return page.evaluate(() => Number(history.state.bfLandingScrollY));
}

async function expectPageScrolls(page, action) {
  const previous = await page.evaluate(() => document.documentElement.style.scrollBehavior);
  try {
    const baseline = await resetScroll(page);
    await action();
    await expect.poll(() => page.evaluate((start) => window.scrollY - start, baseline)).toBeGreaterThan(100).catch(async (error) => {
      const state = await page.evaluate(() => ({
        path: location.pathname, hash: location.hash,
        scrollY, scrollHeight: document.scrollingElement?.scrollHeight,
        viewportHeight: innerHeight,
        htmlOverflow: getComputedStyle(document.documentElement).overflow,
        bodyOverflow: getComputedStyle(document.body).overflow,
        focused: document.activeElement?.tagName,
        wheelEvents: window.__bfWheelDiagnostics || [],
        scrollAncestors: (() => {
          const items = [];
          let node = document.elementFromPoint(40, 450);
          while (node) {
            const style = getComputedStyle(node);
            items.push({ tag: node.tagName, className: node.getAttribute("class"),
              top: node.scrollTop, height: node.clientHeight, scrollHeight: node.scrollHeight,
              overflowY: style.overflowY, overscroll: style.overscrollBehaviorY });
            node = node.parentElement;
          }
          return items;
        })(),
        wheelTarget: document.elementFromPoint(40, 450)?.outerHTML.slice(0, 400),
      }));
      throw new Error(`Native scroll did not advance: ${JSON.stringify(state)}`, { cause: error });
    });
  } finally {
    await page.evaluate((value) => {
      document.documentElement.style.scrollBehavior = value;
    }, previous);
  }
}

test("public landing exposes crawlable SEO and semantic content", async ({ page }) => {
  const response = await openLanding(page);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("BiddingFlow – Phần mềm quản lý đấu thầu và gói thầu");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /quản lý kế hoạch lựa chọn nhà thầu/u);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/u);
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:description"]')).toHaveCount(1);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  await expect(page.locator("main#landing-main")).toContainText("Kế hoạch LCNT");
  await expect(page.locator("main#landing-main")).toContainText("nghiệp vụ đấu thầu");
  const structured = await page.locator('script[type="application/ld+json"]').textContent();
  expect(() => JSON.parse(structured || "")).not.toThrow();
});

test("landing keeps native scroll at every required viewport", async ({ page }) => {
  // One responsive document is the subject of this test. Re-navigating for
  // every viewport cold-loads the same module graph eight times and tests
  // navigation reliability instead of responsive scrolling; that lifecycle
  // has its own scenario below.
  await openLanding(page);
  for (const viewport of REQUIRED_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
    }));
    expect(metrics.scrollHeight, JSON.stringify(viewport)).toBeGreaterThan(metrics.innerHeight);
    expect(metrics.scrollWidth, JSON.stringify(viewport)).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.bodyOverflowY).not.toBe("hidden");
    await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 640)));
    for (const id of ["giai-phap", "quy-trinh", "vai-tro"]) {
      const section = page.locator(`#${id}`);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeInViewport();
    }
    const pricing = page.locator("#bang-gia");
    if (await pricing.isVisible()) {
      await pricing.scrollIntoViewIfNeeded();
      await expect(pricing).toBeInViewport();
    }
    await page.locator(".landing-footer").scrollIntoViewIfNeeded();
    await expect(page.locator(".landing-footer")).toBeInViewport();
  }
});

test("wheel and keyboard scrolling remain native", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLanding(page);
  await expectPageScrolls(page, async () => {
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 720);
  });

  // Keyboard scrolling is animated by the browser compositor. Exercise each
  // input from a fresh document so a previous animation cannot race the reset.
  await openLanding(page);
  await expectPageScrolls(page, () => page.keyboard.press("PageDown"));
  await openLanding(page);
  await expectPageScrolls(page, () => page.keyboard.press("Space"));
});

test("navigation lifecycle does not leak a scroll lock", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLanding(page);
  await page.locator('.landing-nav a[href="#giai-phap"]').click();
  await expect(page).toHaveURL(/#giai-phap$/u);
  await expect(page.locator("#giai-phap")).toBeInViewport();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("hidden");

  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("body")).toHaveClass(/landing-ready/u);
  await expectHistoryPositionRestored(page);
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
  const savedHistoryPosition = await page.evaluate(() => window.scrollY);
  await page.goto("/dang-nhap", { waitUntil: "commit" });
  await expect(page.locator("#form-auth-login")).toBeVisible();
  await page.goBack({ waitUntil: "commit" });
  await expect(page.locator("body")).toHaveClass(/landing-ready/u);
  await expectHistoryPositionRestored(page);
  const firstStoredHistoryPosition = await expectStoredHistoryPositionRestored(page);
  expect(Math.abs(firstStoredHistoryPosition - savedHistoryPosition)).toBeLessThanOrEqual(1);
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
  await page.goForward({ waitUntil: "commit" });
  await expect(page.locator("#form-auth-login")).toBeVisible();
  await page.goBack({ waitUntil: "commit" });
  await expect(page.locator("body")).toHaveClass(/landing-ready/u);
  await expectHistoryPositionRestored(page);
  expect(await expectStoredHistoryPositionRestored(page)).toBeGreaterThan(100);
  await expectPageScrolls(page, async () => {
    await page.evaluate(() => {
      window.__bfWheelDiagnostics = [];
      document.addEventListener("wheel", (event) => {
        const entry = { deltaY: event.deltaY, target: event.target?.tagName, prevented: event.defaultPrevented };
        window.__bfWheelDiagnostics.push(entry);
        queueMicrotask(() => { entry.prevented = event.defaultPrevented; });
      }, { capture: true, passive: true, once: true });
    });
    // Target the page background instead of a composited product-preview
    // descendant. This assertion verifies the root scroll container after
    // history restoration, independent of preview hit-test caching.
    await page.mouse.move(720, 450);
    await page.mouse.move(40, 450);
    await page.mouse.wheel(0, 500);
  });

  await context.clearCookies();
  await openLanding(page);
  await expectPageScrolls(page, () => page.keyboard.press("PageDown"));
  await page.setViewportSize({ width: 390, height: 844 });
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
});

test("guest CTA continues to the authenticated entry point", async ({ page }) => {
  await openLanding(page);
  const heroCta = page
    .locator(".landing-hero-actions")
    .getByRole("link", { name: /Bắt đầu sử dụng/u });
  await expect(heroCta).toHaveAttribute("href", "/dang-nhap");
  await heroCta.click();
  await expect(page).toHaveURL(/\/dang-nhap$/u);
});

test.describe("Chromium touch input", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP touch input is available in the Chromium project");

  test("mobile touch surface permits vertical gestures", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await openLanding(page);
      const session = await context.newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 195, y: 700 }],
      });
      for (const y of [620, 540, 460, 380, 300]) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 195, y }],
        });
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
