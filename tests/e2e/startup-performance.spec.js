import { expect, test } from './fixtures.js';

test('records authenticated cold and warm F5 startup metrics', async ({ page, credentials }) => {
  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.goto('/dang-nhap', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });

  const measureReload = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
    return page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const loaderMetric = performance.getEntriesByName('bf:time to hide loader').at(-1);
      const navigationLoaderMetric = performance.getEntriesByName('bf:navigation to hide loader').at(-1);
      const appModuleLoaderMetric = performance.getEntriesByName('bf:app module to hide loader').at(-1);
      return {
        domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
        navigationToLoaderHiddenMs: navigationLoaderMetric?.duration ?? null,
        appModuleToLoaderHiddenMs: appModuleLoaderMetric?.duration ?? null,
        loaderAfterAppModuleMs: loaderMetric?.duration ?? null,
        transferredBytes: performance.getEntriesByType('resource')
          .reduce((total, item) => total + (item.transferSize || 0), 0)
      };
    });
  };

  const cold = await measureReload();
  const warm = await measureReload();
  console.log(`STARTUP_BENCHMARK ${JSON.stringify({ cold, warm })}`);
  expect(warm.loaderAfterAppModuleMs).not.toBeNull();
  expect(warm.navigationToLoaderHiddenMs).not.toBeNull();
  expect(warm.loaderAfterAppModuleMs).toBeLessThan(3000);
});
