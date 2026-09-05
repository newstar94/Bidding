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

async function openLanding(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-bf-shell", "landing");
  await expect(page.locator("body")).not.toHaveAttribute("hidden", "");
  await expect(page.locator("body")).toHaveClass(/landing-ready/u);
  await expect(page.locator("h1")).toHaveCount(1);
}

async function resetScroll(page) {
  await page.evaluate(() => {
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    document.documentElement.style.scrollBehavior = previous;
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

async function expectPageScrolls(page, action) {
  await resetScroll(page);
  await action();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
}

test("public landing exposes crawlable SEO and semantic content", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
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
  for (const viewport of REQUIRED_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openLanding(page);
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
  await expectPageScrolls(page, () => page.mouse.wheel(0, 720));
  await expectPageScrolls(page, () => page.keyboard.press("PageDown"));
  await expectPageScrolls(page, () => page.keyboard.press("Space"));
});

test("navigation lifecycle does not leak a scroll lock", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLanding(page);
  await page.locator('.landing-nav a[href="#giai-phap"]').click();
  await expect(page).toHaveURL(/#giai-phap$/u);
  await expect(page.locator("#giai-phap")).toBeInViewport();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("hidden");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
  await page.goForward({ waitUntil: "domcontentloaded" });
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expectPageScrolls(page, () => page.mouse.wheel(0, 500));

  await context.clearCookies();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectPageScrolls(page, () => page.keyboard.press("PageDown"));
  await page.setViewportSize({ width: 390, height: 844 });
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectPageScrolls(page, () => page.evaluate(() => window.scrollTo(0, 500)));
});

test("guest CTA continues to the authenticated entry point", async ({ page }) => {
  await openLanding(page);
  await expect(page.locator('[data-cta-location="hero"]')).toHaveAttribute("href", "/dang-nhap");
  await page.locator('[data-cta-location="hero"]').click();
  await expect(page).toHaveURL(/\/dang-nhap$/u);
});

test("mobile touch surface permits vertical gestures", async ({ browserName, browser }) => {
  test.skip(browserName !== "chromium", "CDP touch input is available in the Chromium project");
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
