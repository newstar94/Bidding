import { trustedHTML } from "./trustedTypes.js";
import { getRuntimeStyle, setRuntimeStyle } from "./runtimeStyles.js";

// Theme for every flatpickr calendar; ensureFlatpickrLoaded and the admin loader load it before flatpickr's CSS.
export const FLATPICKR_THEME_URL = new URL("./flatpickrTheme.css?no-inline", import.meta.url).pathname;

// Click the month or year in the header to pick from a grid; the header reads "Tháng N".
export function enhanceFlatpickrMonthYear(instance) {
  const container2 = instance.calendarContainer;
  let yearPage = instance.currentYear;
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
        const item = document.createElement("button");
        item.type = "button";
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
      const startYear = yearPage - 5;
      const header = document.createElement("div");
      header.className = "grid-header";
      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.setAttribute("aria-label", "Nhóm năm trước");
      prevBtn.className = "grid-nav-btn";
      prevBtn.innerHTML = trustedHTML("&larr;");
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        yearPage -= 10;
        showGrid("year");
      };
      const title = document.createElement("span");
      title.className = "grid-title";
      title.textContent = `${startYear} - ${startYear + 11}`;
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.setAttribute("aria-label", "Nhóm năm tiếp theo");
      nextBtn.className = "grid-nav-btn";
      nextBtn.innerHTML = trustedHTML("&rarr;");
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        yearPage += 10;
        showGrid("year");
      };
      header.appendChild(prevBtn);
      header.appendChild(title);
      header.appendChild(nextBtn);
      gridOverlay.appendChild(header);
      const grid = document.createElement("div");
      grid.className = "flatpickr-year-grid";
      for (let y = startYear; y < startYear + 12; y++) {
        const item = document.createElement("button");
        item.type = "button";
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
          yearPage = instance.currentYear;
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

const DATE_IN_TEXT = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4})/g;

// Reads "dd/mm/yyyy – dd/mm/yyyy", "dd/mm/yyyy – …" (from that day on) or "… – dd/mm/yyyy" (up to that day).
// Invalid or half-typed dates return null so they never clear an existing bound.
export function parseDateRangeText(text) {
  const value = String(text || "");
  const matches = [...value.matchAll(DATE_IN_TEXT)];
  // Reject partial dates and stray text instead of silently dropping a bound.
  if (matches.length > 2 || /[^\s–—….\-]/u.test(value.replace(DATE_IN_TEXT, ""))) return null;
  const dates = matches.map((m) => (m[1] ? [m[1], m[2], m[3]] : [m[6], m[5].padStart(2, "0"), m[4].padStart(2, "0")]).join("-"));
  if (dates.some((iso) => {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    return year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day;
  })) return null;
  if (matches.length === 2 && !/^\s*[–—-]\s*$/u.test(value.slice(matches[0].index + matches[0][0].length, matches[1].index))) return null;
  if (matches.length === 1 && /[–—…-]/.test(value.slice(0, matches[0].index))) return ["", dates[0]];
  dates.sort();
  return [dates[0] || "", dates[1] || ""];
}

// One popup picks a "từ ngày – đến ngày" range into the two existing ISO fields. Either end may stay
// open: one picked day means "from that day on", and the footer can turn it into "up to that day".
// Picking the same day twice means just that day.
export function bindDateRangePicker(flatpickr, input, { from, to, calendarClass = "", ...config }) {
  const shown = (value) => (ISO_DATE.test(value) ? flatpickr.formatDate(flatpickr.parseDate(value, "Y-m-d"), "d/m/Y") : "");
  const text = () => {
    const [start, end] = [shown(from.value), shown(to.value)];
    return start && end ? `${start} – ${end}` : start ? `${start} – …` : end ? `… – ${end}` : "";
  };
  const display = () => { input.value = text(); };
  const write = (values) => {
    [from, to].forEach((field, index) => {
      if (field.value === values[index]) return;
      field.value = values[index];
      for (const type of ["input", "change"]) field.dispatchEvent(new Event(type, { bubbles: true }));
    });
    display();
  };
  let instance;
  let footer;
  let destroyed = false;
  const sync = () => {
    if (destroyed) return;
    instance.setDate(rangeDates(from, to), false, "Y-m-d");
    if (!ISO_DATE.test(from.value) && ISO_DATE.test(to.value)) instance.jumpToDate(to.value);
    display();
    if (footer) footer.hidden = instance.selectedDates.length !== 1;
  };
  const iso = (date) => flatpickr.formatDate(date, "Y-m-d");
  // flatpickr would read "… – X" as a start date, so typed text is committed here instead.
  const commitTyped = () => {
    if (input.value === text()) return;
    const values = parseDateRangeText(input.value);
    if (values) write(values);
    sync();
  };
  const host = input.parentElement;
  const onBlur = (event) => {
    if (event.target !== input) return;
    event.stopPropagation();
    // Moving into the calendar (picking a day) is not a typed commit.
    if (!instance.calendarContainer?.contains(event.relatedTarget)) commitTyped();
  };
  const onKeyDown = (event) => {
    if (event.target !== input || event.key !== "Enter") return;
    event.stopPropagation();
    commitTyped();
    instance.close();
  };
  host.addEventListener("blur", onBlur, true);
  host.addEventListener("keydown", onKeyDown, true);
  input._bfDateRange = { from, to, sync: () => sync() };
  instance = flatpickr(input, {
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
    onChange: (dates) => {
      write([dates[0] ? iso(dates[0]) : "", dates[1] ? iso(dates[1]) : ""]);
      if (footer && footer.hidden !== (dates.length !== 1)) {
        footer.hidden = dates.length !== 1;
        if (instance?.isOpen) instance._positionCalendar();
      }
    },
    // flatpickr closes before it reports the second pick, so re-read the fields afterwards.
    onClose: () => queueMicrotask(sync),
    onDestroy: [() => {
      destroyed = true;
      host.removeEventListener("blur", onBlur, true);
      host.removeEventListener("keydown", onKeyDown, true);
      delete input._bfDateRange;
    }, ...[].concat(config.onDestroy || [])],
    onReady: (_dates, _text, self) => {
      if (calendarClass) self.calendarContainer.classList.add(calendarClass);
      enhanceFlatpickrMonthYear(self);
      footer = document.createElement("div");
      footer.className = "flatpickr-footer bf-range-footer";
      footer.hidden = true;
      for (const [label, until] of [["Từ ngày này trở đi", false], ["Đến ngày này", true]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          const day = self.selectedDates[0] ? iso(self.selectedDates[0]) : "";
          write(until ? ["", day] : [day, ""]);
          self.close();
        });
        footer.appendChild(button);
      }
      self.calendarContainer.appendChild(footer);
    },
  });
  sync();
  return instance;
}

// Re-reads the two fields after code (not the picker) changed them, e.g. an analytics preset.
export function syncDateRangePicker(input) {
  input?._bfDateRange?.sync();
}
