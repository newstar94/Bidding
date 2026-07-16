import { expect, test } from './fixtures.js';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
});

test('anonymous user sees the login screen', async ({ page }) => {
  const trustedTypesErrors = [];
  page.on('pageerror', error => {
    if (/TrustedScriptURL|requires.*Trusted/i.test(error.message)) trustedTypesErrors.push(error.message);
  });
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/BiddingFlow/);
  await expect(page.locator('#auth-overlay')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#form-auth-login')).toBeVisible();
  await expect(page.locator('#login-username')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#google-signin-btn-container')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#google-signin-status')).toContainText('Không thể tải đăng nhập Google');
  expect(trustedTypesErrors).toEqual([]);
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

  const packageWorkflowMethods = await page.evaluate(async () => {
    const { getAppController } = await import('../../frontend/app/controllerRef.js');
    const appController = getAppController();
    await appController.switchTab('goithau-detail', null, false);
    return {
      opening: typeof appController.renderMoThauPanel,
      evaluation: typeof appController.renderDanhGiaHsdtPanel
    };
  });
  expect(packageWorkflowMethods).toEqual({
    opening: 'function',
    evaluation: 'function'
  });

  await page.locator('#btn-add-goithau').click();
  await expect(page.locator('#modal-goithau')).toHaveClass(/active/, { timeout: 15_000 });
});

test('sync state and dialogs expose keyboard and screen-reader behavior', async ({ page, credentials }) => {
  const cspViolations = [];
  page.on('console', message => {
    if (/Content Security Policy|style-src-attr|inline style/i.test(message.text())) cspViolations.push(message.text());
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-username').fill(credentials.username);
  await page.locator('#login-password').fill(credentials.password);
  await page.locator('#form-auth-login button[type="submit"]').click();
  await expect(page.locator('#auth-overlay')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#system-init-loader')).toBeHidden({ timeout: 30_000 });
  expect(cspViolations).toEqual([]);

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

  await page.evaluate(async () => {
    const { ensureFlatpickrLoaded } = await import('../../frontend/shared/externalAssets.js');
    await ensureFlatpickrLoaded();
    const input = document.createElement('input');
    input.id = 'csp-flatpickr-probe';
    document.body.appendChild(input);
    window.flatpickr(input, {}).open();
  });
  await expect(page.locator('.flatpickr-calendar.open')).toBeVisible();
  expect(cspViolations).toEqual([]);
  await page.evaluate(() => {
    const input = document.getElementById('csp-flatpickr-probe');
    input?._flatpickr?.destroy();
    input?.remove();
  });

  await page.evaluate(async () => {
    const { getAppController } = await import('../../frontend/app/controllerRef.js');
    void getAppController().view.customConfirm('Xác nhận đăng xuất', 'Bạn có chắc chắn muốn đăng xuất?', 'log-out');
  });
  const customDialog = page.locator('#modal-custom-dialog');
  await expect(customDialog).toHaveClass(/active/);
  const cancelBox = await customDialog.locator('#btn-dialog-cancel').boundingBox();
  const confirmBox = await customDialog.locator('#btn-dialog-ok').boundingBox();
  expect(Math.abs((cancelBox?.width || 0) - (confirmBox?.width || 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((cancelBox?.height || 0) - (confirmBox?.height || 0))).toBeLessThanOrEqual(1);
  await customDialog.locator('#btn-dialog-cancel').click();
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

  await page.locator('.header-profile-trigger').click();
  await expect(page.locator('#profile-dropdown-menu')).toHaveClass(/active/);
  const profileLayering = await page.evaluate(() => {
    const appHeader = document.querySelector('.app-header');
    const dropdown = document.getElementById('profile-dropdown-menu');
    const stickyHeader = document.querySelector('#dictionary-table thead th');
    const headerZ = Number.parseInt(getComputedStyle(appHeader).zIndex, 10);
    const stickyZ = Number.parseInt(getComputedStyle(stickyHeader).zIndex, 10);
    const dropdownRect = dropdown.getBoundingClientRect();
    const stickyRect = stickyHeader.getBoundingClientRect();
    const overlapLeft = Math.max(dropdownRect.left, stickyRect.left);
    const overlapRight = Math.min(dropdownRect.right, stickyRect.right);
    const overlapTop = Math.max(dropdownRect.top, stickyRect.top);
    const overlapBottom = Math.min(dropdownRect.bottom, stickyRect.bottom);
    let dropdownWinsAtOverlap = true;
    if (overlapLeft < overlapRight && overlapTop < overlapBottom) {
      const topElement = document.elementFromPoint(
        (overlapLeft + overlapRight) / 2,
        (overlapTop + overlapBottom) / 2
      );
      dropdownWinsAtOverlap = dropdown.contains(topElement);
    }
    return { headerZ, stickyZ, dropdownWinsAtOverlap };
  });
  expect(profileLayering.headerZ).toBeGreaterThan(profileLayering.stickyZ);
  expect(profileLayering.dropdownWinsAtOverlap).toBe(true);
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
