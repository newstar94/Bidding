import { getAdminJson } from "./AdminApi.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminFailure,
  renderAdminMarkup,
} from "./AdminStateView.js";
import { escapeHtml } from "../shared/view_helpers.js";

const PAGE_SIZES = new Set([25, 50, 100]);

export function createLatestAdminLoader() {
  let activeController = null;
  let sequence = 0;
  return {
    async run(operation, { signal, onSuccess, onError } = {}) {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const current = ++sequence;
      const cancel = () => controller.abort(signal?.reason);
      if (signal?.aborted) cancel();
      else signal?.addEventListener?.("abort", cancel, { once: true });
      try {
        const result = await operation(controller.signal);
        if (current === sequence && !controller.signal.aborted) onSuccess?.(result);
      } catch (error) {
        if (current === sequence && !controller.signal.aborted) onError?.(error);
      } finally {
        signal?.removeEventListener?.("abort", cancel);
      }
    },
    cancel() {
      sequence += 1;
      activeController?.abort();
    },
  };
}

function selected(value, expected) {
  return value === expected ? " selected" : "";
}

function normalizeState(config, values = {}) {
  const page = Math.max(1, Number.parseInt(values.page, 10) || 1);
  const requestedSize = Number.parseInt(values.pageSize, 10) || 25;
  const sortBy = config.sortKeys.includes(values.sortBy) ? values.sortBy : config.defaultSort;
  const searchKey = config.searchQueryKey || "search";
  const detail = config.detailKind
    ? String(values.detail || "").trim().slice(0, 200)
    : "";
  return {
    page,
    pageSize: PAGE_SIZES.has(requestedSize) ? requestedSize : 25,
    [searchKey]: String(values[searchKey] || "").trim().slice(0, 100),
    sortBy,
    sortDir: values.sortDir === "desc" || (!values.sortDir && config.defaultSortDir === "desc") ? "desc" : "asc",
    ...(config.detailKind ? { detail } : {}),
    ...Object.fromEntries(config.filters.map((filter) => {
      const value = String(values[filter.key] || "");
      if (Array.isArray(filter.options)) {
        return [filter.key, filter.options.some(([option]) => option === value) ? value : ""];
      }
      const maximum = Number.isSafeInteger(filter.maxLength) ? filter.maxLength : 200;
      return [filter.key, value.trim().slice(0, maximum)];
    })),
  };
}

export function readDirectoryState(config, search = globalThis.location?.search || "") {
  const params = new globalThis.URLSearchParams(search);
  return normalizeState(config, Object.fromEntries(params.entries()));
}

export function directoryQuery(state, config) {
  const searchKey = config.searchQueryKey || "search";
  return Object.fromEntries([
    ["page", state.page], ["pageSize", state.pageSize], [searchKey, state[searchKey]],
    ["sortBy", state.sortBy], ["sortDir", state.sortDir],
    ...config.filters.map((filter) => [filter.key, state[filter.key]]),
  ].filter(([, value]) => value !== ""));
}

export function directoryBrowserQuery(state, config) {
  return {
    ...directoryQuery(state, config),
    ...(config.detailKind && state.detail ? { detail: state.detail } : {}),
  };
}

function filterMarkup(filter, state) {
  if (!Array.isArray(filter.options)) {
    const type = filter.type === "date" ? "date" : "text";
    return `<label class="form-label mb-0"><span class="visually-hidden">${escapeHtml(filter.label)}</span><input class="form-control" name="${escapeHtml(filter.key)}" type="${type}" value="${escapeHtml(state[filter.key])}" maxlength="${escapeHtml(filter.maxLength || 200)}" placeholder="${escapeHtml(filter.placeholder || filter.label)}" aria-label="${escapeHtml(filter.label)}"></label>`;
  }
  const options = [["", filter.allLabel], ...filter.options]
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${selected(state[filter.key], value)}>${escapeHtml(label)}</option>`)
    .join("");
  return `<label class="form-label mb-0"><span class="visually-hidden">${escapeHtml(filter.label)}</span><select class="form-select" name="${escapeHtml(filter.key)}" aria-label="${escapeHtml(filter.label)}">${options}</select></label>`;
}

function controlsMarkup(config, state) {
  const searchKey = config.searchQueryKey || "search";
  const searchControl = config.hideSearch ? "" : `<div class="col-12 col-lg"><label class="visually-hidden" for="admin-directory-search">Tìm kiếm</label><input id="admin-directory-search" class="form-control" type="search" name="${escapeHtml(searchKey)}" value="${escapeHtml(state[searchKey] || "")}" maxlength="100" placeholder="${escapeHtml(config.searchPlaceholder)}"></div>`;
  return `<form class="card card-body mb-3" data-admin-directory-form role="search"><div class="row g-2 align-items-center">${searchControl}${config.filters.map((filter) => `<div class="col-6 col-lg-auto">${filterMarkup(filter, state)}</div>`).join("")}<div class="col-12 col-lg-auto"><button class="btn btn-primary w-100" type="submit">Áp dụng</button></div></div></form><div data-admin-directory-results aria-live="polite"></div>`;
}

function sortHeader(column, state) {
  if (!column.sortKey) return `<th scope="col">${escapeHtml(column.label)}</th>`;
  const active = state.sortBy === column.sortKey;
  const ariaSort = active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none";
  const nextDirection = active && state.sortDir === "asc" ? "desc" : "asc";
  return `<th scope="col" aria-sort="${ariaSort}"><button class="btn btn-link p-0 text-reset" type="button" data-admin-sort="${escapeHtml(column.sortKey)}" data-admin-sort-dir="${nextDirection}">${escapeHtml(column.label)}</button></th>`;
}

function paginationMarkup(pagination) {
  const page = Math.max(1, Number(pagination?.page) || 1);
  const pages = Math.max(1, Number(pagination?.totalPages) || 1);
  const total = Math.max(0, Number(pagination?.totalRows) || 0);
  return `<footer class="card-footer d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2"><span class="text-secondary">${escapeHtml(total)} bản ghi · Trang ${escapeHtml(page)}/${escapeHtml(pages)}</span><div class="btn-list"><button class="btn btn-outline-secondary" type="button" data-admin-page="${page - 1}"${page <= 1 ? " disabled" : ""}>Trang trước</button><button class="btn btn-outline-secondary" type="button" data-admin-page="${page + 1}"${page >= pages ? " disabled" : ""}>Trang sau</button></div></footer>`;
}

export function directoryResultsMarkup(config, state, payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const summary = typeof config.summaryMarkup === "function"
    ? String(config.summaryMarkup(payload?.summary) || "")
    : "";
  if (!items.length) return `${summary}${adminStateMarkup("empty", { message: config.emptyMessage })}`;
  const selectionHeader = config.selectable
    ? '<th scope="col" class="w-1"><input class="form-check-input" type="checkbox" data-admin-select-all aria-label="Chọn tất cả bản ghi trên trang"></th>'
    : "";
  const headers = selectionHeader + config.columns.map((column) => sortHeader(column, state)).join("");
  const rows = items.map((item, index) => {
    const markup = config.rowMarkup(item, index);
    if (!config.selectable) return markup;
    const recordId = String(config.selectionKey?.(item) ?? item?.id ?? item?.publicId ?? item?.sessionId ?? "").trim();
    if (!recordId) return markup;
    const control = `<td><input class="form-check-input" type="checkbox" data-admin-select-row="${escapeHtml(recordId)}" aria-label="Chọn bản ghi ${escapeHtml(recordId)}"></td>`;
    return markup.replace(/^(<tr[^>]*>)/u, `$1${control}`);
  }).join("");
  const selectionStatus = config.selectable
    ? '<div class="card-header py-2"><span class="text-secondary" data-admin-selection-status aria-live="polite">Chưa chọn bản ghi</span></div>'
    : "";
  return `${summary}<section class="card" aria-label="${escapeHtml(config.title)}">${selectionStatus}<div class="table-responsive"><table class="table table-vcenter card-table bf-admin-directory-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>${paginationMarkup(payload.pagination)}</section>`;
}

function writeBrowserQuery(state, config, { push = false } = {}) {
  if (!globalThis.history?.replaceState || !globalThis.location) return;
  const query = Object.entries(directoryBrowserQuery(state, config))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  globalThis.history[push ? "pushState" : "replaceState"](
    globalThis.history.state,
    "",
    `${globalThis.location.pathname}?${query}`,
  );
}

export function renderAdminDirectory(container, config, { fetchImpl, signal } = {}) {
  let state = readDirectoryState(config);
  const selectedIds = new Set();
  const loader = createLatestAdminLoader();
  renderAdminMarkup(container, controlsMarkup(config, state));
  const results = container.querySelector("[data-admin-directory-results]");
  const setDetail = (detail, { push = false } = {}) => {
    state = normalizeState(config, { ...state, detail });
    writeBrowserQuery(state, config, { push });
  };

  const bindResultActions = () => {
    const selectionStatus = results.querySelector("[data-admin-selection-status]");
    const selectAll = results.querySelector("[data-admin-select-all]");
    const rowSelectors = Array.from(results.querySelectorAll("[data-admin-select-row]"));
    const updateSelection = () => {
      rowSelectors.forEach((control) => { control.checked = selectedIds.has(control.dataset.adminSelectRow); });
      const selectedOnPage = rowSelectors.filter((control) => control.checked).length;
      if (selectAll) {
        selectAll.checked = rowSelectors.length > 0 && selectedOnPage === rowSelectors.length;
        selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < rowSelectors.length;
      }
      if (selectionStatus) selectionStatus.textContent = selectedIds.size
        ? `Đã chọn ${selectedIds.size} bản ghi`
        : "Chưa chọn bản ghi";
    };
    rowSelectors.forEach((control) => control.addEventListener("change", () => {
      if (control.checked) selectedIds.add(control.dataset.adminSelectRow);
      else selectedIds.delete(control.dataset.adminSelectRow);
      updateSelection();
    }));
    selectAll?.addEventListener("change", () => {
      rowSelectors.forEach((control) => {
        if (selectAll.checked) selectedIds.add(control.dataset.adminSelectRow);
        else selectedIds.delete(control.dataset.adminSelectRow);
      });
      updateSelection();
    });
    updateSelection();
    results.querySelectorAll("[data-admin-sort]").forEach((button) => button.addEventListener("click", () => {
      state = normalizeState(config, { ...state, page: 1, sortBy: button.dataset.adminSort, sortDir: button.dataset.adminSortDir });
      void load();
    }));
    results.querySelectorAll("[data-admin-page]").forEach((button) => button.addEventListener("click", () => {
      state = normalizeState(config, { ...state, page: button.dataset.adminPage });
      void load();
    }));
    config.bindResultActions?.(results, {
      fetchImpl, signal, reload: load, payload: currentPayload, state, setDetail,
    });
  };
  let currentPayload = null;
  const load = async () => {
    writeBrowserQuery(state, config);
    renderAdminMarkup(results, adminLoadingMarkup(`Đang tải ${config.title.toLowerCase()}…`), { busy: true });
    await loader.run(
      (requestSignal) => getAdminJson(config.endpoint, { query: directoryQuery(state, config), fetchImpl, signal: requestSignal }),
      {
        signal,
        onSuccess(payload) {
          currentPayload = payload;
          renderAdminMarkup(results, directoryResultsMarkup(config, state, payload));
          bindResultActions();
        },
        onError(error) {
          renderAdminFailure(results, error, load);
        },
      },
    );
  };
  container.querySelector("[data-admin-directory-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    state = normalizeState(config, { ...state, ...values, page: 1, detail: "" });
    void load();
  });
  signal?.addEventListener?.("abort", () => loader.cancel(), { once: true });
  void load();
  return { reload: load, cancel: () => loader.cancel() };
}
