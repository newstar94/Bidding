import { loadScriptOnce, loadStyleOnce } from "../shared/externalAssets.js";

async function loadAdminFlatpickr() {
  await loadStyleOnce("/vendor/flatpickr/flatpickr.min.css?v=4");
  const flatpickr = globalThis.flatpickr
    || await loadScriptOnce("/vendor/flatpickr/flatpickr.min.js?v=4", "flatpickr");
  if (!flatpickr?.l10ns?.vn) await loadScriptOnce("/vendor/flatpickr/l10n/vn.js?v=4");
  return flatpickr;
}

function configureDateInput(input) {
  if (!input?.isConnected || input._flatpickr || input.dataset.adminDateState === "binding") return;
  input.dataset.adminDateState = "binding";
  void loadAdminFlatpickr().then((flatpickr) => {
    if (!input.isConnected || input._flatpickr) return;
    const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
    const wrapperLabel = input.closest("label");
    const ariaLabel = input.getAttribute("aria-label")
      || wrapperLabel?.querySelector("span")?.textContent?.trim()
      || "Ngày";
    const instance = flatpickr(input, {
      allowInput: true,
      altFormat: "d/m/Y",
      altInput: true,
      altInputClass: "form-control bf-admin-date-display",
      dateFormat: "Y-m-d",
      locale: "vn",
      monthSelectorType: "static",
      onReady(_dates, _dateText, instance) {
        const visibleInput = instance.altInput || input.nextElementSibling;
        if (visibleInput && input.id) {
          visibleInput.id = `${input.id}-display`;
          label?.setAttribute("for", visibleInput.id);
          for (const attribute of ["aria-label", "aria-describedby", "aria-required"]) {
            const value = attribute === "aria-label" ? ariaLabel : input.getAttribute(attribute);
            if (value !== null) visibleInput.setAttribute(attribute, value);
          }
        }
        instance.calendarContainer.classList.add("flatpickr-calendar--admin");
        input.dataset.adminDateState = "ready";
        input.closest("#admin-app")?.__bfAdminDateInputs?.add(input);
      },
      onDestroy() {
        if (label && input.id) label.setAttribute("for", input.id);
        delete input.dataset.adminDateState;
      },
    });
    const visibleInput = instance?.altInput || input.nextElementSibling;
    if (visibleInput && input.id) {
      visibleInput.id = `${input.id}-display`;
      label?.setAttribute("for", visibleInput.id);
      for (const attribute of ["aria-label", "aria-describedby", "aria-required"]) {
        const value = attribute === "aria-label" ? ariaLabel : input.getAttribute(attribute);
        if (value !== null) visibleInput.setAttribute(attribute, value);
      }
    }
    const syncVisibleInput = () => {
      const visible = input.nextElementSibling;
      if (!(visible instanceof HTMLInputElement) || !visible.classList.contains("bf-admin-date-display")) return;
      if (input.id) visible.id = `${input.id}-display`;
      visible.setAttribute("aria-label", ariaLabel);
      label?.setAttribute("for", visible.id);
    };
    syncVisibleInput();
    setTimeout(syncVisibleInput, 0);
  }).catch(() => {
    // Keep the ISO text input usable when the optional calendar asset cannot load.
    input.dataset.adminDateState = "fallback";
  });
}

export function bindAdminDates(root) {
  const managed = new Set();
  root.__bfAdminDateInputs = managed;
  const refresh = () => {
    for (const input of managed) {
      if (!input.isConnected || !root.contains(input)) {
        input._flatpickr?.destroy();
        managed.delete(input);
      }
    }
    root.querySelectorAll("input.bf-admin-date-input").forEach(configureDateInput);
  };
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const input of managed) input._flatpickr?.destroy();
    managed.clear();
    delete root.__bfAdminDateInputs;
  };
}

export function setAdminDateValue(input, value) {
  if (!input) return;
  if (input._flatpickr) input._flatpickr.setDate(value || "", false, "Y-m-d");
  else input.value = value || "";
}
