import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function readOpeningFailureState(packageName) {
  const wrapper = document.getElementById("detail-workflow-content-wrapper");
  const dialog = document.querySelector("#modal-custom-dialog.active");
  const button = document.getElementById("btn-mothau-save");
  const app = globalThis.app;
  return {
    packages: (app?.model?.state?.goithau || [])
      .filter((pkg) => pkg.tenGoiThau === packageName)
      .map((pkg) => ({
        id: pkg.id,
        status: pkg.trangThai,
        rowVersion: pkg.rowVersion,
        openingTime: pkg.thoiGianMoThau,
        closingTime: pkg.thoiGianDongThau,
        method: pkg.phuongThucLuaChon,
      })),
    dialog: dialog ? {
      title: dialog.querySelector("#dialog-title")?.textContent?.trim() || "",
      message: dialog.querySelector("#dialog-message")?.textContent?.trim() || "",
    } : null,
    rendered: wrapper ? { ...wrapper.dataset } : null,
    content: wrapper?.textContent?.trim().slice(0, 1500) || "",
    saveButton: button ? {
      disabled: button.disabled,
      visible: button.getClientRects().length > 0
        && getComputedStyle(button).visibility !== "hidden",
    } : null,
    synchronization: {
      active: Boolean(app?._autoSyncOwner?.promise),
      queued: Boolean(app?._autoSyncQueued),
      startupPhase: app?.getStartupReconciliationState?.()?.phase || "",
    },
  };
}

export async function reportOpeningFailure({
  page, packageName, runId, error, pageErrors = [], recentApiTraffic = [],
  directory = "test-results/lifecycle",
}) {
  let state;
  let handle;
  try {
    // Unlike evaluate(), this also has a deadline if the renderer is stuck.
    handle = await page.waitForFunction(readOpeningFailureState, packageName, { timeout: 5000 });
    state = await handle.jsonValue();
  } catch (probeError) {
    state = { diagnosticsUnavailable: String(probeError.message).slice(0, 500) };
  } finally {
    await handle?.dispose().catch(() => {});
  }
  const diagnostics = { state, pageErrors: pageErrors.slice(-8), recentApiTraffic: recentApiTraffic.slice(-20) };
  const artifactErrors = [];
  const name = String(runId).replace(/[^a-zA-Z0-9_-]/g, "_");
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}-opening.json`), JSON.stringify(diagnostics, null, 2));
    await page.screenshot({ path: join(directory, `${name}-opening.png`), timeout: 5000 });
  } catch (artifactError) {
    artifactErrors.push(String(artifactError.message));
  }
  throw new Error(`Technical opening panel did not become ready: ${JSON.stringify({ ...diagnostics, artifactErrors })}`, { cause: error });
}
