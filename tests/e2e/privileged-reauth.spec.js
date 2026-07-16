import { expect, test } from "./fixtures.js";

test("sensitive admin mutation prompts for password and retries once", async ({ page }) => {
  let sensitiveAttempts = 0;
  let submittedPassword = "";
  await page.route("**/", async route => {
    const response = await route.fetch();
    const session = {
      valid: true,
      user: {
        id: "e2e-admin",
        username: "e2e-admin",
        name: "E2E Admin",
        platform_role: "super_admin",
        role: "super_admin",
        effective_roles: ["super_admin", "manager", "employee"],
        active_org_id: "org-e2e",
        organizations: [
          { id: "org-e2e", name: "E2E Organization", role: "manager", status: "active" }
        ]
      }
    };
    const body = (await response.text()).replace(
      /(<script id="bf-session-bootstrap" type="application\/json">)[\s\S]*?(<\/script>)/,
      `$1${JSON.stringify(session)}$2`
    );
    await route.fulfill({ response, body });
  });
  await page.route("**/api/test-privileged", async route => {
    sensitiveAttempts += 1;
    if (sensitiveAttempts === 1) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Cần xác thực lại mật khẩu để thực hiện thao tác quản trị nhạy cảm."
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true })
    });
  });
  await page.route("**/api/auth/privileged-reauth", async route => {
    submittedPassword = JSON.parse(route.request().postData() || "{}").password || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, expires_in: 600 })
    });
  });
  await page.route("**/api/get-all-data**", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        syncVersion: 0,
        timestamp: "0",
        deletions: [],
        partial: false,
        useServerSidePagination: false
      })
    });
  });

  await page.goto("/tong-quan");
  await expect(page.locator("#header-profile-name")).toContainText("E2E Admin");
  await page.evaluate(async () => {
    const { apiFetch } = await import("/frontend/shared/apiClient.js");
    window.__privilegedRequest = apiFetch("/api/test-privileged", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sensitive" })
    }).then(response => response.json());
  });

  const passwordInput = page.locator("#dialog-prompt-input");
  await expect(passwordInput).toBeVisible();
  await expect(passwordInput).toHaveAttribute("type", "password");
  await passwordInput.fill("correct-password");
  await page.locator("#btn-dialog-ok").evaluate(button => button.click());

  const result = await page.evaluate(() => window.__privilegedRequest);
  expect(result.success).toBe(true);
  expect(submittedPassword).toBe("correct-password");
  expect(sensitiveAttempts).toBe(2);
});
