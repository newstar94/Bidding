import { expect, test } from './fixtures.js';

const managerPages = [
  ['dashboard', 'Tổng quan'],
  ['kehoach', 'Kế hoạch LCNT'],
  ['goithau', 'Gói thầu'],
  ['hopdong', 'Hợp đồng'],
  ['chudautu', 'Chủ đầu tư'],
  ['nhathau', 'Nhà thầu'],
  ['chuyengia', 'Chuyên gia'],
  ['bieumau', 'Biểu mẫu Word'],
  ['managernhanvien', 'Nhân sự & Phân quyền'],
  ['managerhosogiay', 'Trạng thái Hồ sơ giấy']
];

test('measures manager navigation and F5 performance on every page', async ({ page, credentials }) => {
  test.setTimeout(180_000);

  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(async () => {
    const { getAppController } = await import('../../frontend/app/controllerRef.js');
    return typeof getAppController()?.setupProfileDropdownEvents;
  }), { timeout: 30_000 }).toBe('function');
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });

  await page.locator('.header-profile-trigger').click();
  await page.locator('.dropdown-role-btn[data-switch-role="manager"]').click();
  await expect(page.locator('#header-profile-role')).toContainText('Quản lý');

  await page.addInitScript(() => {
    const tabByPath = {
      'tong-quan': 'dashboard',
      'ke-hoach': 'kehoach',
      'goi-thau': 'goithau',
      'hop-dong': 'hopdong',
      'chu-dau-tu': 'chudautu',
      'nha-thau': 'nhathau',
      'chuyen-gia': 'chuyengia',
      'bieu-mau': 'bieumau',
      'nhan-su': 'managernhanvien',
      'trang-thai-ho-so': 'managerhosogiay'
    };
    window.__bfUnexpectedVisibleTabs = [];
    const inspectVisibleTab = () => {
      const path = location.pathname.split('/').filter(Boolean)[0] || 'tong-quan';
      const expectedTab = tabByPath[path];
      const loader = document.getElementById('system-init-loader');
      const activeTab = document.querySelector('.tab-pane.active');
      const appIsVisible = loader
        && getComputedStyle(loader).visibility === 'hidden'
        && !document.body.classList.contains('bf-init-loading');
      if (appIsVisible && expectedTab && activeTab?.id !== `tab-${expectedTab}`) {
        window.__bfUnexpectedVisibleTabs.push(activeTab?.id || 'none');
      }
      requestAnimationFrame(inspectVisibleTab);
    };
    requestAnimationFrame(inspectVisibleTab);
  });

  const measureTab = async tabName => page.evaluate(async name => {
    const button = document.querySelector(`[data-tab="${name}"]`);
    if (!button) throw new Error(`Không tìm thấy nút trang ${name}`);
    const startedAt = performance.now();
    button.click();
    const deadline = startedAt + 15_000;
    while (performance.now() < deadline) {
      const panel = document.getElementById(`tab-${name}`);
      if (panel?.classList.contains('active') && getComputedStyle(panel).display !== 'none') {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Math.round((performance.now() - startedAt) * 10) / 10;
      }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    throw new Error(`Trang ${name} không hiển thị trong 15 giây`);
  }, tabName);

  const results = [];
  for (const [tabName, label] of managerPages) {
    const firstOpenMs = await measureTab(tabName);
    const warmOpenMs = await measureTab(tabName);

    const reloadStartedAt = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(`#tab-${tabName}`)).toHaveClass(/active/);
    expect(await page.evaluate(() => window.__bfUnexpectedVisibleTabs || [])).toEqual([]);
    const reloadWallMs = Date.now() - reloadStartedAt;
    const reloadMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const loaderMetric = performance.getEntriesByName('bf:time to hide loader').at(-1);
      return {
        domContentLoadedMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
        loaderAfterAppModuleMs: loaderMetric?.duration == null ? null : Math.round(loaderMetric.duration * 10) / 10
      };
    });

    results.push({
      tab: tabName,
      label,
      firstOpenMs,
      warmOpenMs,
      f5WallMs: reloadWallMs,
      ...reloadMetrics
    });
  }

  console.log(`MANAGER_PERFORMANCE ${JSON.stringify(results)}`);
  results.forEach(result => {
    expect(result.firstOpenMs).toBeLessThan(3000);
    expect(result.warmOpenMs).toBeLessThan(1000);
    expect(result.f5WallMs).toBeLessThan(5000);
  });
});
