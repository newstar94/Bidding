import { getAdminJson } from "./AdminApi.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { trustedHTML } from "../shared/trustedTypes.js";

const KIND_LABELS = Object.freeze({
  user: "Người dùng",
  organization: "Tổ chức",
  subscription: "Đăng ký",
  invoice: "Hóa đơn",
});

function safeAdminHref(value) {
  const href = String(value || "");
  return /^\/admin(?:[/?]|$)/u.test(href) && !/[\u0000-\u001f\u007f"'<>]/u.test(href)
    ? href
    : "/admin";
}

export function adminSearchMarkup() {
  return `<form class="bf-admin-global-search" role="search" autocomplete="off" data-admin-global-search><label class="visually-hidden" for="admin-global-search-input">Tìm kiếm quản trị</label><div class="input-icon"><span class="input-icon-addon" aria-hidden="true">⌕</span><input id="admin-global-search-input" class="form-control" type="search" name="admin_global_search" minlength="2" maxlength="100" placeholder="Tìm tổ chức, người dùng, đăng ký, hóa đơn…" aria-controls="admin-global-search-results"></div><div id="admin-global-search-results" class="bf-admin-search-results card" role="status" aria-live="polite" hidden></div></form>`;
}

export function adminSearchResultsMarkup(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) return '<div class="bf-admin-search-message">Không tìm thấy kết quả phù hợp.</div>';
  return `<div class="list-group list-group-flush">${items.map((item) => {
    const kind = KIND_LABELS[item?.kind] || "Kết quả";
    return `<a class="list-group-item list-group-item-action" href="${escapeHtml(safeAdminHref(item?.href))}"><div class="d-flex justify-content-between gap-3"><strong>${escapeHtml(item?.title || "N/A")}</strong><span class="badge bg-secondary-lt text-dark">${escapeHtml(kind)}</span></div><div class="text-secondary small mt-1">${escapeHtml(item?.description || "N/A")}${item?.status ? ` · ${escapeHtml(item.status)}` : ""}</div></a>`;
  }).join("")}</div>`;
}

export function createAdminSearchController({
  search,
  render,
  setBusy,
  schedule = globalThis.setTimeout,
  cancelSchedule = globalThis.clearTimeout,
  delay = 250,
}) {
  let timer = null;
  let requestController = null;
  let generation = 0;

  const query = (value) => {
    const normalized = String(value || "").trim();
    generation += 1;
    const currentGeneration = generation;
    if (timer !== null) cancelSchedule(timer);
    timer = null;
    requestController?.abort();
    requestController = null;
    if (normalized.length < 2) {
      setBusy(false);
      render({ kind: "hint" });
      return;
    }
    timer = schedule(async () => {
      timer = null;
      const controller = new AbortController();
      requestController = controller;
      setBusy(true);
      try {
        const payload = await search(normalized, { signal: controller.signal });
        if (generation === currentGeneration && !controller.signal.aborted) {
          render({ kind: "results", payload });
        }
      } catch (error) {
        if (generation === currentGeneration && !controller.signal.aborted) {
          render({ kind: "error", message: error?.message || "Không thể tìm kiếm." });
        }
      } finally {
        if (generation === currentGeneration) setBusy(false);
      }
    }, delay);
  };

  return {
    query,
    dispose() {
      generation += 1;
      if (timer !== null) cancelSchedule(timer);
      requestController?.abort();
      timer = null;
      requestController = null;
      setBusy(false);
    },
  };
}

export function bindAdminSearch(root, { fetchImpl = globalThis.fetch } = {}) {
  const form = root?.querySelector?.("[data-admin-global-search]");
  const input = form?.querySelector?.('[name="admin_global_search"]');
  const results = form?.querySelector?.("#admin-global-search-results");
  if (!form || !input || !results) return () => {};
  const show = () => { results.hidden = false; };
  const hide = () => { results.hidden = true; };
  const controller = createAdminSearchController({
    search: (query, { signal }) => getAdminJson("/api/admin/search", {
      query: { q: query, limit: 5 }, signal, fetchImpl,
    }),
    render(state) {
      if (state.kind === "hint") { hide(); results.replaceChildren(); return; }
      if (state.kind === "error") {
        results.innerHTML = trustedHTML(`<div class="bf-admin-search-message text-danger">${escapeHtml(state.message)}</div>`);
      } else {
        results.innerHTML = trustedHTML(adminSearchResultsMarkup(state.payload));
      }
      show();
    },
    setBusy(busy) { input.setAttribute("aria-busy", String(busy)); },
  });
  const onInput = () => controller.query(input.value);
  const onKeydown = (event) => { if (event.key === "Escape") { hide(); input.blur(); } };
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  input.addEventListener("focus", () => { if (results.childElementCount) show(); });
  form.addEventListener("submit", (event) => event.preventDefault());
  return () => {
    controller.dispose();
    input.removeEventListener("input", onInput);
    input.removeEventListener("keydown", onKeydown);
  };
}
