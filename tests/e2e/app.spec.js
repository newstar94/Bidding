import { expect, test } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

test('anonymous user sees the login screen', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/BiddingFlow/);
  await expect(page.locator('#auth-overlay')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#form-auth-login')).toBeVisible();
  await expect(page.locator('#login-username')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#google-signin-btn-container')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#google-signin-status')).toContainText('Không thể tải đăng nhập Google');
});

test('login form supports basic input interactions', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#auth-overlay')).toBeVisible({ timeout: 20_000 });

  await page.locator('#login-username').fill('automation_user');
  await page.locator('#login-password').fill('temporary-password');

  await expect(page.locator('#login-username')).toHaveValue('automation_user');
  await expect(page.locator('#login-password')).toHaveValue('temporary-password');

  await page.locator('.toggle-password[data-target="login-password"]').click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
});

test('authenticated reload keeps lazy workflows and Excel actions ready', async ({ page, credentials }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
  await page.evaluate(async () => {
    const { getAppController } = await import('../../frontend/app/controllerRef.js');
    const appController = getAppController();
    await appController.ensureLazyTab('goithau');
    appController.switchTab('goithau');
    appController.setupActionListeners();
  });
  await expect(page.locator('#tab-goithau')).toBeVisible();
  await expect(page.locator('.btn-download-excel-template-direct[data-type="goithau"]')).toBeVisible();
  await expect.poll(() => page.locator('.btn-download-excel-template-direct[data-type="goithau"]')
    .evaluate(button => button._hasExcelListener === true)).toBe(true);

  await page.locator('#btn-add-goithau').click();
  await expect(page.locator('#modal-goithau')).toHaveClass(/active/, { timeout: 15_000 });
});

test('sync state and dialogs expose keyboard and screen-reader behavior', async ({ page, credentials }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });

  const syncState = page.locator('#btn-force-sync');
  await expect(syncState).toHaveAttribute('aria-live', /polite|assertive/);
  await expect(syncState).toHaveAttribute('aria-label', /đồng bộ/i);

  await page.evaluate(async () => {
    const { getAppController } = await import('../../frontend/app/controllerRef.js');
    const controller = getAppController();
    await controller.ensureLazyTab('goithau');
    controller.switchTab('goithau');
    controller.setupActionListeners();
  });
  const trigger = page.locator('#btn-add-goithau');
  await trigger.click();
  const modal = page.locator('#modal-goithau');
  await expect(modal).toHaveClass(/active/);
  await expect(modal.locator('.modal-card')).toHaveAttribute('role', 'dialog');
  await expect(modal.locator('.modal-card')).toHaveAttribute('aria-modal', 'true');
  await expect.poll(() => page.evaluate(() => document.querySelector('#modal-goithau')?.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/active/);
  await expect(trigger).toBeFocused();
});

test('Word template F5 never reveals the dashboard after the loader', async ({ page, credentials }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
  await page.goto('/bieu-mau', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/bieu-mau$/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#tab-bieumau')).toHaveClass(/active/);
  await expect(page.locator('#tab-bieumau')).toBeVisible();
  await expect(page.locator('#tab-dashboard')).not.toHaveClass(/active/);
  await expect(page.locator('#page-title')).toHaveText('Quản lý Biểu mẫu & Từ điển');
});

test('super admin can switch active roles from the profile dropdown', async ({ page, credentials }) => {
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

  const selectRole = async role => {
    await page.locator('.header-profile-trigger').click();
    await expect(page.locator('#profile-dropdown-menu')).toHaveClass(/active/);
    await page.locator(`.dropdown-role-btn[data-switch-role="${role}"]`).click();
    await expect.poll(() => page.evaluate(async () => {
      const { getAppController } = await import('../../frontend/app/controllerRef.js');
      return getAppController()?.model.state.activerole;
    })).toBe(role);
  };

  await selectRole('manager');
  await selectRole('employee');
  await selectRole('super_admin');
});
