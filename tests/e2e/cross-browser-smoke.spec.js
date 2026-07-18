import { expect, test } from './fixtures.js';

test('core landing, login and authenticated reload work on the selected browser profile', async ({
  page,
  credentials,
}, testInfo) => {
  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#landing-page')).toBeVisible();
  await expect(page).toHaveTitle(/BiddingFlow/);

  if (testInfo.project.name === 'mobile-chromium') {
    expect(page.viewportSize()?.width).toBeLessThanOrEqual(500);
    await expect(page.locator('#landing-hero-title')).toBeVisible();
  }

  await page.goto('/dang-nhap', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#tab-dashboard')).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#tab-dashboard')).toBeVisible();
});
