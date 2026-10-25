import { trustedHTML } from "./trustedTypes.js";
import { getRuntimeStyle, setRuntimeStyle } from "./runtimeStyles.js";

// Theme for every flatpickr calendar; ensureFlatpickrLoaded and the admin loader load it before flatpickr's CSS.
export const FLATPICKR_THEME_URL = new URL("./flatpickrTheme.css?no-inline", import.meta.url).pathname;

// Click the month or year in the header to pick from a grid; the header reads "Tháng N".
export function enhanceFlatpickrMonthYear(instance) {
  const container2 = instance.calendarContainer;
  let gridOverlay = container2.querySelector(".flatpickr-grid-overlay");
  if (!gridOverlay) {
    gridOverlay = document.createElement("div");
    gridOverlay.className = "flatpickr-grid-overlay";
    setRuntimeStyle(gridOverlay, "display", "none");
    const innerContainer = container2.querySelector(".flatpickr-innerContainer");
    if (innerContainer) {
      container2.insertBefore(gridOverlay, innerContainer);
    } else {
      container2.appendChild(gridOverlay);
    }
  }
  const showGrid = (type) => {
    container2.classList.add("flatpickr-grid-open");
    const innerContainer = container2.querySelector(".flatpickr-innerContainer");
    if (innerContainer) setRuntimeStyle(innerContainer, "display", "none!important");
    const timeContainer = container2.querySelector(".flatpickr-time");
    if (timeContainer) setRuntimeStyle(timeContainer, "display", "none!important");
    const prevMonth = container2.querySelector(".flatpickr-prev-month");
    const nextMonth = container2.querySelector(".flatpickr-next-month");
    if (prevMonth) setRuntimeStyle(prevMonth, "display", "none");
    if (nextMonth) setRuntimeStyle(nextMonth, "display", "none");
    setRuntimeStyle(gridOverlay, "display", "block");
    gridOverlay.innerHTML = trustedHTML("");
    if (type === "month") {
      gridOverlay.className = "flatpickr-grid-overlay flatpickr-month-grid-mode";
      const header = document.createElement("div");
      header.className = "grid-header";
      header.innerHTML = trustedHTML(`<span class="grid-title">Chọn Tháng</span>`);
      gridOverlay.appendChild(header);
      const grid = document.createElement("div");
      grid.className = "flatpickr-month-grid";
      for (let m = 0; m < 12; m++) {
        const item = document.createElement("div");
        item.className = `flatpickr-grid-item ${instance.currentMonth === m ? "active" : ""}`;
        item.textContent = `Tháng ${m + 1}`;
        item.onclick = (e) => {
          e.stopPropagation();
          instance.changeMonth(m, false);
          hideGrid();
        };
        grid.appendChild(item);
      }
      gridOverlay.appendChild(grid);
    } else if (type === "year") {
      gridOverlay.className = "flatpickr-grid-overlay flatpickr-year-grid-mode";
      const startYear = instance.currentYear - 5;
      const header = document.createElement("div");
      header.className = "grid-header";
      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "grid-nav-btn";
      prevBtn.innerHTML = trustedHTML("&larr;");
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        instance.currentYear -= 10;
        showGrid("year");
      };
      const title = document.createElement("span");
      title.className = "grid-title";
      title.textContent = `${startYear} - ${startYear + 11}`;
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "grid-nav-btn";
      nextBtn.innerHTML = trustedHTML("&rarr;");
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        instance.currentYear += 10;
        showGrid("year");
      };
      header.appendChild(prevBtn);
      header.appendChild(title);
      header.appendChild(nextBtn);
      gridOverlay.appendChild(header);
      const grid = document.createElement("div");
      grid.className = "flatpickr-year-grid";
      for (let y = startYear; y < startYear + 12; y++) {
        const item = document.createElement("div");
        item.className = `flatpickr-grid-item flatpickr-year-grid-item ${instance.currentYear === y ? "active" : ""}`;
        item.textContent = y;
        item.onclick = (e) => {
          e.stopPropagation();
          instance.changeYear(y);
          hideGrid();
        };
        grid.appendChild(item);
      }
      gridOverlay.appendChild(grid);
    }
  };
  const hideGrid = () => {
    container2.classList.remove("flatpickr-grid-open");
    setRuntimeStyle(gridOverlay, "display", "none");
    const innerContainer = container2.querySelector(".flatpickr-innerContainer");
    if (innerContainer) setRuntimeStyle(innerContainer, "display", "");
    const timeContainer = container2.querySelector(".flatpickr-time");
    if (timeContainer) setRuntimeStyle(timeContainer, "display", "");
    const prevMonth = container2.querySelector(".flatpickr-prev-month");
    const nextMonth = container2.querySelector(".flatpickr-next-month");
    if (prevMonth) setRuntimeStyle(prevMonth, "display", "");
    if (nextMonth) setRuntimeStyle(nextMonth, "display", "");
  };
  const monthElement = container2.querySelector(".flatpickr-current-month");
  if (monthElement) {
    const curMonthSpan = monthElement.querySelector(".cur-month");
    if (curMonthSpan) {
      setRuntimeStyle(curMonthSpan, "cursor", "pointer");
      curMonthSpan.onclick = (e) => {
        e.stopPropagation();
        if (getRuntimeStyle(gridOverlay, "display") === "block" && gridOverlay.classList.contains("flatpickr-month-grid-mode")) {
          hideGrid();
        } else {
          showGrid("month");
        }
      };
    }
    const yearInputWrapper = monthElement.querySelector(".numInputWrapper");
    if (yearInputWrapper) {
      setRuntimeStyle(yearInputWrapper, "cursor", "pointer");
      yearInputWrapper.onclick = (e) => {
        e.stopPropagation();
        if (getRuntimeStyle(gridOverlay, "display") === "block" && gridOverlay.classList.contains("flatpickr-year-grid-mode")) {
          hideGrid();
        } else {
          showGrid("year");
        }
      };
      const yearInput = yearInputWrapper.querySelector(".cur-year");
      if (yearInput) {
        setRuntimeStyle(yearInput, "pointerEvents", "none");
      }
    }
  }
  const formatHeaderMonth = () => {
    setTimeout(() => {
      const curMonthSpan = container2.querySelector(".cur-month");
      if (curMonthSpan) {
        curMonthSpan.textContent = `Tháng ${instance.currentMonth + 1}`;
      }
    }, 0);
  };
  formatHeaderMonth();
  instance.config.onMonthChange.push(formatHeaderMonth);
  instance.config.onOpen.push(formatHeaderMonth);
  instance.config.onYearChange.push(formatHeaderMonth);
  instance.config.onChange.push(formatHeaderMonth);
  instance.config.onClose.push(() => {
    hideGrid();
  });
}

// A modal <dialog> sits in the top layer, so its calendars are appended to the dialog and placed against the viewport.
export function positionCalendarInDialog(instance) {
  const calendar = instance.calendarContainer;
  const dialog = calendar.parentElement;
  const anchor = (instance.altInput || instance._input).getBoundingClientRect();
  const frame = dialog.getBoundingClientRect();
  const { offsetHeight: height, offsetWidth: width } = calendar;
  const top = anchor.bottom + 4 + height <= window.innerHeight || anchor.top - height - 4 < 0 ? anchor.bottom + 4 : anchor.top - height - 4;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  setRuntimeStyle(calendar, "top", `${Math.round(top - frame.top - dialog.clientTop)}px`);
  setRuntimeStyle(calendar, "left", `${Math.round(left - frame.left - dialog.clientLeft)}px`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function rangeDates(from, to) {
  return ISO_DATE.test(from.value) ? [from.value, to.value].filter((value) => ISO_DATE.test(value)) : [];
}

// One date in a range picker is an open end ("từ ngày X trở đi"); show it as "X – …".
function showOpenEnd(instance) {
  if (instance.selectedDates.length === 1) {
    instance.input.value = `${instance.formatDate(instance.selectedDates[0], instance.config.dateFormat)} – …`;
  }
}

// One popup picks a "từ ngày – đến ngày" range into the two existing ISO fields.
// One picked day means "from that day on"; picking the same day twice means just that day.
export function bindDateRangePicker(flatpickr, input, { from, to, calendarClass = "", ...config }) {
  const iso = (date) => flatpickr.formatDate(date, "Y-m-d");
  const write = (dates) => {
    const values = [dates[0] ? iso(dates[0]) : "", dates[1] ? iso(dates[1]) : ""];
    [from, to].forEach((field, index) => {
      if (field.value === values[index]) return;
      field.value = values[index];
      for (const type of ["input", "change"]) field.dispatchEvent(new Event(type, { bubbles: true }));
    });
  };
  input._bfDateRange = { from, to };
  return flatpickr(input, {
    ...config,
    mode: "range",
    allowInput: true,
    dateFormat: "d/m/Y",
    monthSelectorType: "static",
    locale: { ...flatpickr.l10ns.vn, rangeSeparator: " – " },
    defaultDate: rangeDates(from, to),
    parseDate: (value, format) => {
      const text = String(value).trim();
      if (!/\d/.test(text)) return undefined;
      return flatpickr.parseDate(text, ISO_DATE.test(text) ? "Y-m-d" : format);
    },
    onChange: (dates) => write(dates),
    onValueUpdate: (_dates, _text, instance) => showOpenEnd(instance),
    onReady: (_dates, _text, instance) => {
      if (calendarClass) instance.calendarContainer.classList.add(calendarClass);
      enhanceFlatpickrMonthYear(instance);
      showOpenEnd(instance);
    },
  });
}

// Re-reads the two fields after code (not the picker) changed them, e.g. an analytics preset.
export function syncDateRangePicker(input) {
  const range = input?._bfDateRange;
  if (!range || !input._flatpickr) return;
  input._flatpickr.setDate(rangeDates(range.from, range.to), false, "Y-m-d");
  showOpenEnd(input._flatpickr);
}

// Typed fallback when the calendar asset is unavailable: "dd/mm/yyyy – dd/mm/yyyy", or one day meaning "from that day on".
export function parseDateRangeText(text) {
  const dates = [...String(text || "").matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4})/g)]
    .map((m) => (m[1] ? [m[1], m[2], m[3]] : [m[6], m[5].padStart(2, "0"), m[4].padStart(2, "0")]).join("-"))
    .sort();
  if (dates.length > 2) return null;
  return [dates[0] || "", dates[1] || ""];
}
