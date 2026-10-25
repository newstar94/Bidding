import { loadScriptOnce, loadStyleOnce } from "../shared/externalAssets.js";
import { bindDateRangePicker, enhanceFlatpickrMonthYear, FLATPICKR_THEME_URL, syncDateRangePicker } from "../shared/flatpickrTheme.js";
import { escapeHtml } from "../shared/view_helpers.js";

async function loadAdminFlatpickr() {
  await loadStyleOnce(FLATPICKR_THEME_URL);
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
    const range = input.dataset.adminDateMode === "range";
    const instance = flatpickr(input, {
      // Range mode keeps one popup: the first click sets the start, the second the end.
      ...(range ? { mode: "range" } : {}),
      ...(input.dataset.adminDateMin ? { minDate: input.dataset.adminDateMin } : {}),
      ...(input.dataset.adminDateMax ? { maxDate: input.dataset.adminDateMax } : {}),
      allowInput: true,
      altFormat: "d/m/Y",
      altInput: true,
      altInputClass: "form-control bf-admin-date-display",
      dateFormat: "Y-m-d",
      locale: range ? { ...flatpickr.l10ns.vn, rangeSeparator: " – " } : "vn",
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
        enhanceFlatpickrMonthYear(instance);
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

function configureRangeInput(input) {
  if (!input?.isConnected || input._flatpickr || input.dataset.adminDateState === "binding") return;
  const from = input.form?.elements.namedItem(input.dataset.adminRangeFrom);
  const to = input.form?.elements.namedItem(input.dataset.adminRangeTo);
  if (!from || !to) return;
  input.dataset.adminDateState = "binding";
  void loadAdminFlatpickr().then((flatpickr) => {
    if (!input.isConnected || input._flatpickr) return;
    bindDateRangePicker(flatpickr, input, { from, to, calendarClass: "flatpickr-calendar--admin" });
    input.dataset.adminDateState = "ready";
    input.closest("#admin-app")?.__bfAdminDateInputs?.add(input);
  }).catch(() => {
    input.dataset.adminDateState = "fallback";
  });
}

// One visible "từ ngày – đến ngày" field; the hidden fields keep the form's from/to names and ISO values.
export function adminDateRangeMarkup({ id, label, fromName, toName, fromValue = "", toValue = "", labelClass = "form-label", labelTag = "label" }) {
  const field = `<input class="form-control bf-admin-date-range" id="${escapeHtml(id)}" type="text" inputmode="numeric" placeholder="dd/mm/yyyy – dd/mm/yyyy" title="Chọn một ngày để lọc từ ngày đó trở đi, hoặc chọn ngày bắt đầu rồi ngày kết thúc." aria-label="${escapeHtml(label)}" data-admin-range-from="${escapeHtml(fromName)}" data-admin-range-to="${escapeHtml(toName)}">`;
  const hidden = [[fromName, fromValue], [toName, toValue]]
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value || "")}">`).join("");
  return labelTag === "label"
    ? `<label class="${labelClass}" for="${escapeHtml(id)}">${escapeHtml(label)}</label>${field}${hidden}`
    : `<label class="${labelClass}"><span>${escapeHtml(label)}</span>${field}</label>${hidden}`;
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
    root.querySelectorAll("input.bf-admin-date-range").forEach(configureRangeInput);
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
  const range = [...input.form?.querySelectorAll("input.bf-admin-date-range") || []]
    .find((control) => control._bfDateRange?.from === input || control._bfDateRange?.to === input);
  syncDateRangePicker(range);
}
