function normalizedLotCode(value) {
  return String(value || "").trim().toLocaleUpperCase("vi-VN");
}

async function setCurrentCheckedState(locator, checked) {
  await locator.evaluate((input, nextChecked) => {
    if (input.checked === nextChecked) return;
    input.checked = nextChecked;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, checked);
}

export async function waitForEvaluationLotScopeProjection({
  page,
  lotCode,
  selectedOnly = false,
  timeout = 15_000,
} = {}) {
  if (!page?.waitForFunction) {
    throw new TypeError("Evaluation lot scope synchronization requires a Playwright page.");
  }
  const expectedCode = normalizedLotCode(lotCode);
  if (!expectedCode) throw new TypeError("Evaluation lot code is required.");

  await page.waitForFunction(({ code, requireSingleSelection }) => {
    const selectedMode = document.querySelector(
      'input[name="danhgiahsdt-scope-mode"][value="selected"]',
    );
    if (!selectedMode?.checked) return false;
    const inputs = [...document.querySelectorAll(
      "#danhgiahsdt-lot-options [data-evaluation-lot-id]",
    )];
    const target = inputs.find((input) => (
      String(input.getAttribute("data-evaluation-lot-code") || "").trim().toLocaleUpperCase("vi-VN") === code
    ));
    if (!target) return false;
    const container = document.getElementById("danhgiahsdt-scope-container");
    if (container?.dataset.evaluationLotScopeMode !== "selected") return false;
    let renderedCodes;
    try {
      renderedCodes = JSON.parse(container.dataset.evaluationLotScopeSelectedCodes || "[]")
        .map((value) => String(value || "").trim().toLocaleUpperCase("vi-VN"));
    } catch {
      return false;
    }
    if (!requireSingleSelection) return renderedCodes.includes(code);
    const selected = inputs.filter((input) => input.checked);
    return selected.length === 1
      && selected[0] === target
      && renderedCodes.length === 1
      && renderedCodes[0] === code;
  }, { code: expectedCode, requireSingleSelection: selectedOnly }, {
    polling: 100,
    timeout,
  });
}

export async function selectSingleEvaluationLot({
  page,
  lotCode,
  timeout = 15_000,
} = {}) {
  if (!page?.locator || !page?.evaluate) {
    throw new TypeError("Evaluation lot selection requires a Playwright page.");
  }
  const selectedMode = page.locator(
    'input[name="danhgiahsdt-scope-mode"][value="selected"]',
  );
  if (await selectedMode.count() === 0) return false;

  await setCurrentCheckedState(selectedMode, true);
  await waitForEvaluationLotScopeProjection({ page, lotCode, timeout });

  const expectedCode = normalizedLotCode(lotCode);
  const readInputs = () => page.locator(
    "#danhgiahsdt-lot-options [data-evaluation-lot-id]",
  ).evaluateAll((inputs) => inputs.map((input) => ({
    code: String(input.getAttribute("data-evaluation-lot-code") || "")
      .trim().toLocaleUpperCase("vi-VN"),
    checked: Boolean(input.checked),
  })));

  let inputs = await readInputs();
  if (!inputs.some((input) => input.code === expectedCode)) {
    throw new Error(`Evaluation lot ${expectedCode} is not rendered.`);
  }

  // Each change event schedules a projection render which replaces the
  // checkbox nodes. Mutate one live locator at a time and reacquire the list
  // after every render; never retain element handles across that boundary.
  for (const input of inputs) {
    if (!input.checked || input.code === expectedCode) continue;
    const current = await readInputs();
    const index = current.findIndex((candidate) => candidate.code === input.code);
    if (index < 0) continue;
    await setCurrentCheckedState(page.locator(
      "#danhgiahsdt-lot-options [data-evaluation-lot-id]",
    ).nth(index), false);
    await waitForEvaluationLotScopeProjection({ page, lotCode, timeout });
    inputs = await readInputs();
  }

  inputs = await readInputs();
  const targetIndex = inputs.findIndex((input) => input.code === expectedCode);
  if (targetIndex < 0) throw new Error(`Evaluation lot ${expectedCode} disappeared during selection.`);
  if (!inputs[targetIndex].checked) {
    await setCurrentCheckedState(page.locator(
      "#danhgiahsdt-lot-options [data-evaluation-lot-id]",
    ).nth(targetIndex), true);
    await waitForEvaluationLotScopeProjection({ page, lotCode, timeout });
  }

  await waitForEvaluationLotScopeProjection({
    page,
    lotCode,
    selectedOnly: true,
    timeout,
  });
  return true;
}
