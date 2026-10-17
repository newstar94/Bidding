function normalizedCode(input) {
  return String(input?.value || "").trim().toUpperCase();
}

export function setProcurementLookupLoading(loadingScreen, form, loading, code = "") {
  if (loading) form?.setAttribute?.("aria-busy", "true");
  else form?.removeAttribute?.("aria-busy");
  if (!loadingScreen) return;

  const codeLabel = loadingScreen.querySelector?.("[data-procurement-loading-code]");
  if (codeLabel) {
    codeLabel.textContent = code;
    codeLabel.hidden = !code;
  }
  loadingScreen.setAttribute("aria-busy", String(loading));
  loadingScreen.hidden = !loading;
}

export function bindProcurementCodeAutoLookup({
  codeInput,
  checkbox,
  enabled = true,
  runLookup,
  onCleanup,
}) {
  codeInput?.__bfProcurementAutoLookupCleanup?.();
  checkbox?.__bfProcurementAutoLookupCleanup?.();
  if (
    !codeInput
    || !checkbox
    || !enabled
    || typeof runLookup !== "function"
  ) {
    return null;
  }

  let pendingCode = "";
  let completedCode = "";
  const lookup = async () => {
    if (!checkbox.checked || checkbox.disabled) return null;
    const code = normalizedCode(codeInput);
    if (!code || code === pendingCode || code === completedCode) return null;
    pendingCode = code;
    try {
      const result = await runLookup();
      if (result) completedCode = code;
      return result;
    } finally {
      if (pendingCode === code) pendingCode = "";
    }
  };
  const handleCodeFinished = () => {
    if (normalizedCode(codeInput) !== completedCode) completedCode = "";
    void lookup();
  };
  const handleCheckboxChange = () => {
    completedCode = "";
    if (checkbox.checked) void lookup();
  };

  codeInput.addEventListener("change", handleCodeFinished);
  codeInput.addEventListener("blur", handleCodeFinished);
  checkbox.addEventListener("change", handleCheckboxChange);

  const cleanup = () => {
    onCleanup?.();
    codeInput.removeEventListener("change", handleCodeFinished);
    codeInput.removeEventListener("blur", handleCodeFinished);
    checkbox.removeEventListener("change", handleCheckboxChange);
    if (codeInput.__bfProcurementAutoLookupCleanup === cleanup) {
      delete codeInput.__bfProcurementAutoLookupCleanup;
    }
    if (checkbox.__bfProcurementAutoLookupCleanup === cleanup) {
      delete checkbox.__bfProcurementAutoLookupCleanup;
    }
  };
  codeInput.__bfProcurementAutoLookupCleanup = cleanup;
  checkbox.__bfProcurementAutoLookupCleanup = cleanup;
  return cleanup;
}
