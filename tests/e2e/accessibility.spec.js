import AxeBuilder from '@axe-core/playwright';

import { expect, test } from './fixtures.js';

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const workspaceTabs = [
  'dashboard',
  'kehoach',
  'goithau',
  'hopdong',
  'chudautu',
  'nhathau',
  'chuyengia',
  'bieumau',
  'managernhanvien',
  'managerhosogiay',
];

const violationSummary = violations => violations.map(violation => ({
  id: violation.id,
  impact: violation.impact,
  help: violation.help,
  targets: violation.nodes.map(node => node.target.join(' ')),
}));

const expectWcagAA = async page => {
  // Avoid measuring transient opacity while the shell's short entrance
  // animation is still running; WCAG contrast applies to its settled state.
  await page.waitForTimeout(250);
  const result = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(result.violations)).toEqual([]);
};

test('landing, authentication and workspace shells pass automated WCAG A/AA checks', async ({ page, credentials }) => {
  test.setTimeout(180_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#landing-page')).toBeVisible();
  await expectWcagAA(page);

  await page.goto('/dang-nhap', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#auth-overlay')).toBeVisible();
  await expectWcagAA(page);

  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(async () => {
    const { getAppController } = await import('../../frontend/app/controllerRef.js');
    return typeof getAppController()?.ensureLazyTab;
  }), { timeout: 30_000 }).toBe('function');
  await page.locator('.header-profile-trigger').click();
  await page.locator('.dropdown-role-btn[data-switch-role="manager"]').click();
  await expect(page.locator('#header-profile-role')).toContainText('Quản lý');
  await expect(page.locator('#tab-dashboard')).toBeVisible();
  for (const tabName of workspaceTabs) {
    await page.evaluate(async name => {
      const { getAppController } = await import('../../frontend/app/controllerRef.js');
      const controller = getAppController();
      await controller.ensureLazyTab(name);
      controller.switchTab(name);
      controller.setupActionListeners();
    }, tabName);
    await expect(page.locator(`#tab-${tabName}`)).toBeVisible();
    await expectWcagAA(page);
  }
});
