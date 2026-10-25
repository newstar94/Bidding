import { getAdminJson, postAdminJson, requiresPrivilegedReauthentication } from "./AdminApi.js";
import { requestAdminValue } from "./AdminBilling.js";
import { adminLoadingMarkup, renderAdminFailure, renderAdminMarkup } from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

// Public-holiday calendar used by every working-day deadline (dashboard
// alerts, timelines, Word formulas). Edits replace holidays.json atomically.

const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function formatDay(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  const value = new Date(year, month - 1, day);
  return `${WEEKDAYS[value.getDay()]}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

// Accepts one day or a range, as ISO (picker value) or dd/mm/yyyy (typed fallback).
function rangeDays(text) {
  const dates = [...String(text || "").matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4})/g)]
    .map((m) => m[1] ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : Date.UTC(+m[6], +m[5] - 1, +m[4]))
    .filter(Number.isFinite);
  if (!dates.length || dates.length > 2) return [];
  const [start, end] = [Math.min(...dates), Math.max(...dates)];
  const days = [];
  for (let time = start; time <= end && days.length <= 366; time += 86400000) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}

function dayList(year, kind, days) {
  if (!days.length) return `<p class="text-secondary small mb-2">Chưa có ngày nào.</p>`;
  return `<ul class="list-group list-group-flush mb-2">${days.map((iso) => `
    <li class="list-group-item d-flex align-items-center justify-content-between gap-2 px-0">
      <span>${escapeHtml(formatDay(iso))}</span>
      <button type="button" class="btn btn-sm btn-ghost-danger" data-holiday-remove="${escapeHtml(year)}|${kind}|${escapeHtml(iso)}" aria-label="Xóa ngày ${escapeHtml(formatDay(iso))}">Xóa</button>
    </li>`).join("")}</ul>`;
}

function yearCard(year, entry) {
  return `<div class="col-12 col-xl-6"><section class="card" data-holiday-year="${escapeHtml(year)}">
    <div class="card-header"><h3 class="card-title">Năm ${escapeHtml(year)}</h3>
      <div class="card-actions"><button type="button" class="btn btn-sm btn-outline-danger" data-holiday-remove-year="${escapeHtml(year)}">Xóa năm</button></div></div>
    <div class="card-body">
      <h4 class="h5">Ngày nghỉ lễ, Tết (${entry.holidays.length})</h4>
      ${dayList(year, "holidays", entry.holidays)}
      <form class="d-flex gap-2 mb-4" data-holiday-add="${escapeHtml(year)}|holidays">
        <input class="form-control bf-admin-date-input" type="text" name="day" inputmode="numeric" placeholder="Chọn ngày hoặc khoảng ngày" data-admin-date-mode="range" data-admin-date-min="${escapeHtml(year)}-01-01" data-admin-date-max="${escapeHtml(year)}-12-31" aria-label="Thêm ngày nghỉ năm ${escapeHtml(year)}">
        <button class="btn btn-outline-primary" type="submit">Thêm ngày nghỉ</button>
      </form>
      <h4 class="h5">Ngày làm bù vào thứ Bảy/Chủ nhật (${entry.working_weekends.length})</h4>
      ${dayList(year, "working_weekends", entry.working_weekends)}
      <form class="d-flex gap-2" data-holiday-add="${escapeHtml(year)}|working_weekends">
        <input class="form-control bf-admin-date-input" type="text" name="day" inputmode="numeric" placeholder="Chọn ngày hoặc khoảng ngày" data-admin-date-mode="range" data-admin-date-min="${escapeHtml(year)}-01-01" data-admin-date-max="${escapeHtml(year)}-12-31" aria-label="Thêm ngày làm bù năm ${escapeHtml(year)}">
        <button class="btn btn-outline-primary" type="submit">Thêm ngày làm bù</button>
      </form>
    </div></section></div>`;
}

function pageMarkup(state) {
  const years = Object.keys(state.calendar).sort();
  const missing = state.coverage?.missingYears || [];
  const warning = missing.length
    ? `<div class="alert alert-warning" role="alert">Chưa có lịch nghỉ cho năm ${missing.map(escapeHtml).join(", ")}. Các hạn tính theo ngày làm việc trong năm này sẽ bỏ qua ngày lễ.</div>`
    : "";
  // The admin shell already renders the "Ngày nghỉ lễ" page title.
  return `<div class="mb-3"><div class="row align-items-center g-2">
      <div class="col">
        <p class="text-secondary mb-0">Dùng cho mọi hạn tính theo ngày làm việc: cảnh báo tổng quan, tiến độ gói thầu và công thức Word.</p></div>
      <div class="col-auto d-flex gap-2">
        <form class="d-flex gap-2" data-holiday-add-year>
          <input class="form-control" type="number" name="year" min="2000" max="2100" required placeholder="Năm" aria-label="Năm cần thêm">
          <button class="btn btn-outline-primary" type="submit">Thêm năm</button>
        </form>
        <button type="button" class="btn btn-primary" data-holiday-save${state.dirty ? "" : " disabled"}>Lưu thay đổi</button>
      </div></div></div>
    ${warning}
    <p class="text-secondary small" data-holiday-status role="status" aria-live="polite">${escapeHtml(state.status || "")}</p>
    <div class="row row-cards">${years.length ? years.map((year) => yearCard(year, state.calendar[year])).join("") : `<div class="col-12"><p class="text-secondary">Chưa có năm nào.</p></div>`}</div>`;
}

function normalizeCalendar(calendar) {
  const result = {};
  for (const [year, entry] of Object.entries(calendar || {})) {
    result[year] = {
      holidays: [...new Set(entry?.holidays || [])].sort(),
      working_weekends: [...new Set(entry?.working_weekends || [])].sort(),
    };
  }
  return result;
}

async function saveCalendar(calendar, { fetchImpl, signal, requestPassword }) {
  const mutate = () => postAdminJson("/api/admin/holidays", { body: { calendar }, fetchImpl, signal });
  try {
    return await mutate();
  } catch (error) {
    if (!requiresPrivilegedReauthentication(error)) throw error;
    const password = await requestPassword();
    if (password === null) return null;
    await postAdminJson("/api/auth/privileged-reauth", { body: { password }, fetchImpl, signal });
    return mutate();
  }
}

export async function renderAdminHolidays(container, { fetchImpl, signal } = {}) {
  renderAdminMarkup(container, adminLoadingMarkup(), { busy: true });
  let payload;
  try {
    payload = await getAdminJson("/api/admin/holidays", { fetchImpl, signal });
  } catch (error) {
    if (signal?.aborted) return;
    renderAdminFailure(container, error, () => renderAdminHolidays(container, { fetchImpl, signal }));
    return;
  }
  const state = { calendar: normalizeCalendar(payload.calendar), coverage: payload.coverage, dirty: false, status: "" };
  const render = () => renderAdminMarkup(container, pageMarkup(state));
  const change = (mutate) => { mutate(); state.dirty = true; state.status = "Có thay đổi chưa lưu."; render(); };
  render();
  const beforeNavigate = (event) => {
    if (state.dirty && !window.confirm("Lịch ngày nghỉ có thay đổi chưa lưu. Rời trang?")) event.preventDefault();
  };
  window.addEventListener("admin:before-navigate", beforeNavigate);
  signal?.addEventListener?.("abort", () => window.removeEventListener("admin:before-navigate", beforeNavigate), { once: true });

  container.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.matches("[data-holiday-add-year]")) {
      event.preventDefault();
      const year = String(form.elements.year.value || "").trim();
      if (!/^\d{4}$/.test(year)) return;
      if (state.calendar[year]) { state.status = `Năm ${year} đã có.`; render(); return; }
      change(() => { state.calendar[year] = { holidays: [], working_weekends: [] }; });
      return;
    }
    if (form.matches("[data-holiday-add]")) {
      event.preventDefault();
      const [year, kind] = form.dataset.holidayAdd.split("|");
      let days = rangeDays(form.elements.day.value);
      if (!days.length) { state.status = "Chọn một ngày hoặc một khoảng ngày."; render(); return; }
      if (!days.every((day) => day.startsWith(`${year}-`))) { state.status = `Ngày phải thuộc năm ${year}.`; render(); return; }
      let skipped = 0;
      if (kind === "working_weekends") {
        const weekends = days.filter((day) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()));
        skipped = days.length - weekends.length;
        days = weekends;
        if (!days.length) { state.status = "Ngày làm bù phải là thứ Bảy hoặc Chủ nhật."; render(); return; }
      }
      change(() => {
        const entry = state.calendar[year];
        entry[kind] = [...new Set([...entry[kind], ...days])].sort();
      });
      if (skipped) { state.status = `Đã thêm ${days.length} ngày cuối tuần; bỏ qua ${skipped} ngày thường. Có thay đổi chưa lưu.`; render(); }
    }
  });
  container.addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-holiday-remove]");
    if (remove) {
      const [year, kind, day] = remove.dataset.holidayRemove.split("|");
      change(() => { state.calendar[year][kind] = state.calendar[year][kind].filter((value) => value !== day); });
      return;
    }
    const removeYear = event.target.closest("[data-holiday-remove-year]");
    if (removeYear) {
      const year = removeYear.dataset.holidayRemoveYear;
      if (!window.confirm(`Xóa toàn bộ lịch nghỉ năm ${year}?`)) return;
      change(() => { delete state.calendar[year]; });
      return;
    }
    const save = event.target.closest("[data-holiday-save]");
    if (save && state.dirty) {
      save.disabled = true;
      try {
        const result = await saveCalendar(state.calendar, {
          fetchImpl, signal,
          requestPassword: () => requestAdminValue({
            title: "Xác thực thao tác quản trị",
            message: "Nhập lại mật khẩu để lưu lịch ngày nghỉ.",
            label: "Mật khẩu hiện tại",
            type: "password",
          }),
        });
        if (result === null) { state.status = "Đã hủy lưu."; render(); return; }
        state.calendar = normalizeCalendar(result.calendar);
        state.coverage = result.coverage;
        state.dirty = false;
        state.status = result.changedYears?.length
          ? `Đã lưu. Năm thay đổi: ${result.changedYears.join(", ")}.`
          : "Đã lưu, không có thay đổi.";
      } catch (error) {
        state.status = error?.message || "Không thể lưu lịch ngày nghỉ.";
      }
      render();
    }
  });
}
