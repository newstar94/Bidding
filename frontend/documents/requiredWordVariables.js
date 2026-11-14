// ADR 0106 — a selected Word template uses a workspace "Biến kết quả" that is
// not configured yet (for example the deadline printed in a letter). Exports are
// blocked until a manager defines it; this module explains why and, for people
// who may configure Word variables, opens the result-variable form.

export const REQUIRED_VARIABLES_CODE = "DOCUMENT_EXPORT_REQUIRED_VARIABLES_MISSING";
const TITLE = "Cần cấu hình biến kết quả";

function errorCode(error) {
  return String(error?.code || error?.data?.code || "").trim();
}

export function requiredVariablesWarning(error) {
  const source = errorCode(error) === REQUIRED_VARIABLES_CODE
    ? error
    : errorCode(error?.cause) === REQUIRED_VARIABLES_CODE ? error.cause : null;
  if (!source) return null;
  const data = source.data && typeof source.data === "object" ? source.data : {};
  const missing = (Array.isArray(data.missingVariables) ? data.missingVariables : [])
    .map((item) => ({ name: String(item?.name || "").trim(), label: String(item?.label || "").trim() }))
    .filter((item) => item.name);
  return {
    message: String(data.error || source.message || "").trim()
      || "Biểu mẫu Word đang dùng biến kết quả chưa được cấu hình.",
    missing,
    canConfigure: data.canConfigure === true,
  };
}

export async function openComputedVariableForm(controller, variableName) {
  await controller?.switchTab?.("bieumau");
  const fill = () => {
    const name = globalThis.document?.getElementById("wmc-ten-bien");
    const formula = globalThis.document?.getElementById("wmc-formula");
    if (!name || !formula) return false;
    const id = globalThis.document.getElementById("wmc-id");
    if (id) id.value = "";
    name.value = variableName;
    formula.value = "";
    controller?.setWordDictionaryGroup?.("computed", false);
    formula.focus?.();
    return true;
  };
  if (fill()) return true;
  await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  return fill();
}

export async function presentRequiredVariablesWarning(controller, warning, {
  open = openComputedVariableForm,
  defer = (task) => globalThis.setTimeout(task, 0),
} = {}) {
  const view = controller?.view;
  const first = warning.missing[0];
  if (!warning.canConfigure || !first || typeof view?.customConfirm !== "function") {
    await view?.customAlert?.(TITLE, warning.message, "alert-triangle");
    return false;
  }
  const configure = await view.customConfirm(TITLE, warning.message, "alert-triangle", {
    confirmLabel: "Cấu hình ngay",
    cancelLabel: "Để sau",
  });
  // Open after the caller's own cleanup so it does not move focus back.
  if (configure) defer(() => open(controller, first.name));
  return Boolean(configure);
}
