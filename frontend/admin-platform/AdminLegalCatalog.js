import { getJson, postJson } from "../shared/apiClient.js";
import { mountLegalCatalogAdmin } from "../legal-versioning/LegalCatalogAdmin.js";
import {
  adminLoadingMarkup,
  adminStateMarkup,
  renderAdminMarkup,
} from "./AdminStateView.js";

const PROFILES_ENDPOINT = "/api/legal-versioning/profiles";

export function legalCatalogShellMarkup() {
  return `<section class="card" id="legal-catalog-admin-card" aria-labelledby="admin-legal-catalog-title"><div class="card-header"><div><h3 class="card-title" id="admin-legal-catalog-title">Danh mục phiên bản pháp lý</h3><p class="card-subtitle">Quản lý văn bản nguồn và hồ sơ nguồn bất biến từ dữ liệu đã được phê duyệt.</p></div></div><div class="card-body" id="admin-legal-catalog-root"></div></section>`;
}

export function legalCatalogFailureMarkup(error) {
  const status = Number(error?.status) || 0;
  if (status === 401 || status === 403) {
    return adminStateMarkup("permission", { message: error?.message });
  }
  if (status === 404) {
    return adminStateMarkup("empty", {
      title: "Chức năng chưa được bật",
      message: "Quản lý phiên bản pháp lý đang được tắt trong cấu hình triển khai.",
    });
  }
  return adminStateMarkup("error", { message: error?.message, retry: true });
}

export async function renderAdminLegalCatalog(container, {
  read,
  write,
  fetchImpl,
  signal,
  mount = mountLegalCatalogAdmin,
} = {}) {
  const readApi = read || ((url, options = {}) => getJson(url, { ...options, signal }, fetchImpl));
  const writeApi = write || ((url, body, options = {}) => postJson(url, body, { ...options, signal }, fetchImpl));
  renderAdminMarkup(container, adminLoadingMarkup("Đang tải danh mục pháp lý…"), { busy: true });
  try {
    const profiles = await readApi(PROFILES_ENDPOINT, { retries: 0 });
    if (signal?.aborted) return null;
    renderAdminMarkup(container, legalCatalogShellMarkup());
    const root = container.querySelector("#admin-legal-catalog-root");
    let firstProfilesRead = true;
    const cachedRead = (url, options) => {
      if (firstProfilesRead && url === PROFILES_ENDPOINT) {
        firstProfilesRead = false;
        return Promise.resolve(profiles);
      }
      return readApi(url, options);
    };
    return await mount(root, {
      enabled: true,
      read: cachedRead,
      write: writeApi,
    });
  } catch (error) {
    if (signal?.aborted) return null;
    renderAdminMarkup(container, legalCatalogFailureMarkup(error));
    container.querySelector("[data-admin-retry]")?.addEventListener(
      "click",
      () => renderAdminLegalCatalog(container, { read, write, fetchImpl, signal, mount }),
      { once: true },
    );
    return null;
  }
}
