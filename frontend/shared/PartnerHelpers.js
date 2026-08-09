import { trustedHTML } from "./trustedTypes.js";
import { apiFetch } from "./apiClient.js";
import { initAccessibleCombobox } from "./accessibleCombobox.js";

function addressCacheRoot() {
  return typeof window !== "undefined" ? window : globalThis;
}
function normalizeAddressToken(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[.,;:()]/g, " ").replace(/\s+/g, " ").trim();
}
const VIETNAM_COUNTRY_ALIASES = new Set([
  "viet nam",
  "vietnam",
  "nuoc viet nam",
  "cong hoa xa hoi chu nghia viet nam"
]);
function isVietnamCountryPart(value) {
  return VIETNAM_COUNTRY_ALIASES.has(normalizeAddressToken(value));
}
export function stripVietnamCountrySuffix(parts) {
  // API có thể trả quốc gia ở cuối hoặc xen giữa các thành phần. Loại bỏ
  // ngay tại đây trước khi nhận diện tỉnh/phường và địa chỉ chi tiết.
  return [...(parts || [])].filter((part) => !isVietnamCountryPart(part));
}
export function splitAddressParts(rawAddress) {
  return String(rawAddress || "")
    .split(/\s*(?:,|;|\||\r?\n)\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
}
function stripAdminPrefix(value, type) {
  const text = normalizeAddressToken(value);
  if (type === "province") {
    return text.replace(/^(tinh|thanh pho|tp)\s+/, "").replace(/^(t p)\s+/, "").trim();
  }
  return text.replace(/^(phuong|xa|thi tran|tt)\s+/, "").trim();
}
function escapeOptionText(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderWardOptions(wards) {
  return '<option value="">-- Chọn Xã/Phường --</option>' + wards.map((w) => `<option value="${w.code}" data-name="${escapeOptionText(w.name)}">${escapeOptionText(w.name)}</option>`).join("");
}
function syncCustomSelectDisplay(select) {
  if (!select) return;
  select.__bfAccessibleCombobox?.refresh();
}
async function ensureVietnamProvinces() {
  const root = addressCacheRoot();
  if (!root._vietnamProvinces || !Array.isArray(root._vietnamProvinces) || root._vietnamProvinces.length === 0) {
    try {
      const res = await apiFetch("/api/address/provinces");
      if (!res.ok) return [];
      const data = await res.json();
      root._vietnamProvinces = Array.isArray(data) ? data : [];
    } catch (error) {
      console.warn("Không thể tải danh mục tỉnh/thành để chuẩn hóa địa chỉ:", error);
      return [];
    }
  }
  return root._vietnamProvinces;
}
async function ensureVietnamWards(provinceCode) {
  if (!provinceCode) return [];
  const root = addressCacheRoot();
  root._vietnamWards = root._vietnamWards || {};
  if (!root._vietnamWards[provinceCode] || !Array.isArray(root._vietnamWards[provinceCode])) {
    try {
      const res = await apiFetch(`/api/address/wards/${provinceCode}`);
      if (!res.ok) return [];
      const data = await res.json();
      root._vietnamWards[provinceCode] = Array.isArray(data) ? data : [];
    } catch (error) {
      console.warn("Không thể tải danh mục xã/phường để chuẩn hóa địa chỉ:", error);
      return [];
    }
  }
  return root._vietnamWards[provinceCode];
}
function findAdministrativeMatch(parts, candidates, type) {
  const normalizedParts = parts.map((part) => normalizeAddressToken(part));
  const normalizedAddress = normalizeAddressToken(parts.join(", "));
  const sorted = [...candidates].sort((a, b) => String(b.name || "").length - String(a.name || "").length);
  for (const item of sorted) {
    const full = normalizeAddressToken(item.name);
    const short = stripAdminPrefix(item.name, type);
    const aliases = [...new Set([full, short].filter(Boolean))];
    for (let idx = normalizedParts.length - 1; idx >= 0; idx--) {
      const part = normalizedParts[idx];
      if (aliases.some((alias) => part === alias || part.endsWith(` ${alias}`) || alias.endsWith(` ${part}`))) {
        return { item, partIndex: idx };
      }
    }
    if (aliases.some((alias) => normalizedAddress.endsWith(` ${alias}`) || normalizedAddress.includes(` ${alias} `))) {
      return { item, partIndex: -1 };
    }
  }
  return null;
}
function findPrefixedAdministrativePart(parts, type, excludedIndexes = new Set()) {
  const prefix = type === "province"
    ? /^(tỉnh|thành phố|tp\.?)(?:\s|$)/iu
    : /^(phường|xã|thị trấn|tt\.?)(?:\s|$)/iu;
  for (let idx = parts.length - 1; idx >= 0; idx--) {
    if (!excludedIndexes.has(idx) && prefix.test(String(parts[idx] || "").trim())) {
      return { name: String(parts[idx] || "").trim(), partIndex: idx };
    }
  }
  return null;
}
function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function stripAdministrativeSuffix(detail, ...administrativeNames) {
  let result = String(detail || "").trim();
  const names = [...new Set(administrativeNames.map((name) => String(name || "").trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  let changed = true;
  while (result && changed) {
    changed = false;
    for (const name of names) {
      const pattern = new RegExp(`(?:\\s*[,;:/\\-–—]\\s*)?${escapeRegExp(name)}\\s*$`, "iu");
      const cleaned = result.replace(pattern, "").replace(/[\s,;:/\-–—]+$/u, "").trim();
      if (cleaned !== result) {
        result = cleaned;
        changed = true;
      }
    }
  }
  return result;
}
export function composeInternalAddress(detail = "", wardName = "", provinceName = "") {
  const cleanDetail = stripAdministrativeSuffix(detail, wardName, provinceName);
  return `${cleanDetail} | ${String(wardName || "").trim()} | ${String(provinceName || "").trim()}`;
}
export function parseStoredInternalAddress(storedAddress) {
  const raw = String(storedAddress || "").trim();
  const parts = raw.split(/\s*\|\s*/u);
  const wardName = String(parts[1] || "").trim();
  const provinceName = String(parts[2] || "").trim();
  if (parts.length >= 3 && (wardName || provinceName)) {
    const detailWithoutCountry = stripVietnamCountrySuffix(
      splitAddressParts(parts[0])
    ).join(", ");
    return {
      detail: stripAdministrativeSuffix(detailWithoutCountry, wardName, provinceName),
      wardName,
      provinceName,
      requiresLookup: false,
      rawAddress: raw
    };
  }
  return { detail: raw, wardName: "", provinceName: "", requiresLookup: true, rawAddress: raw };
}
export async function parseVietnamAddress(rawAddress) {
  const raw = String(rawAddress || "").trim();
  if (!raw) {
    return { detail: "", wardName: "", provinceName: "", wardCode: "", provinceCode: "", formattedAddress: "", rawAddress: "" };
  }
  const parts = stripVietnamCountrySuffix(splitAddressParts(raw));
  if (parts.length === 0) {
    return { detail: raw, wardName: "", provinceName: "", wardCode: "", provinceCode: "", formattedAddress: composeInternalAddress(raw, "", ""), rawAddress: raw };
  }
  // Nhận diện theo tiền tố trước để vẫn tách được địa chỉ cũ khi API địa giới
  // không hoạt động hoặc danh mục hiện tại không còn đơn vị hành chính đó.
  const provinceFallback = findPrefixedAdministrativePart(parts, "province");
  const provinces = await ensureVietnamProvinces();
  const provinceMatch = findAdministrativeMatch(parts, provinces, "province");
  const province = provinceMatch?.item || null;
  const provincePartIndex = provinceMatch?.partIndex >= 0 ? provinceMatch.partIndex : provinceFallback?.partIndex ?? -1;
  const wardFallback = findPrefixedAdministrativePart(parts, "ward", new Set([provincePartIndex]));
  let ward = null;
  let wardMatch = null;
  if (province?.code) {
    const wards = await ensureVietnamWards(province.code);
    wardMatch = findAdministrativeMatch(parts, wards, "ward");
    ward = wardMatch?.item || null;
  }
  const wardPartIndex = wardMatch?.partIndex >= 0 ? wardMatch.partIndex : wardFallback?.partIndex ?? -1;
  const removeIndexes = /* @__PURE__ */ new Set();
  if (provincePartIndex >= 0) removeIndexes.add(provincePartIndex);
  if (wardPartIndex >= 0) removeIndexes.add(wardPartIndex);
  const matchedDetail = parts.filter((_, idx) => !removeIndexes.has(idx)).join(", ").trim() || raw;
  const wardName = ward?.name || wardFallback?.name || "";
  const provinceName = province?.name || provinceFallback?.name || "";
  const detail = stripAdministrativeSuffix(matchedDetail, wardName, provinceName);
  return {
    detail,
    wardName,
    provinceName,
    wardCode: ward?.code || "",
    provinceCode: province?.code || "",
    formattedAddress: composeInternalAddress(detail, wardName, provinceName),
    rawAddress: raw
  };
}
function selectAddressOption(select, code, name, legacyPrefix) {
  if (!select || (!code && !name)) return;
  let option = code
    ? Array.from(select.options).find((item) => String(item.value) === String(code))
    : null;
  if (!option && name) {
    const normalizedName = normalizeAddressToken(name);
    option = Array.from(select.options).find((item) => normalizeAddressToken(item.dataset?.name || item.text) === normalizedName);
  }
  if (!option && name) {
    option = document.createElement("option");
    option.value = `${legacyPrefix}:${name}`;
    option.textContent = name;
    option.dataset.name = name;
    select.appendChild(option);
  }
  if (option) select.value = option.value;
}
export async function applyRawAddressToAddressControls(rawAddress, { detailInputId, provinceSelectId, wardSelectId }) {
  const parsed = await parseVietnamAddress(rawAddress);
  const detailInput = document.getElementById(detailInputId);
  const provinceSelect = document.getElementById(provinceSelectId);
  const wardSelect = document.getElementById(wardSelectId);
  if (detailInput) {
    detailInput.value = parsed.detail || rawAddress || "";
  }
  if (provinceSelect && (parsed.provinceCode || parsed.provinceName)) {
    selectAddressOption(provinceSelect, parsed.provinceCode, parsed.provinceName, "legacy-province");
    syncCustomSelectDisplay(provinceSelect);
  }
  if (wardSelect && (parsed.provinceCode || parsed.wardName)) {
    if (parsed.provinceCode) {
      const wards = await ensureVietnamWards(parsed.provinceCode);
      wardSelect.innerHTML = trustedHTML(renderWardOptions(wards));
    }
    wardSelect.disabled = false;
    selectAddressOption(wardSelect, parsed.wardCode, parsed.wardName, "legacy-ward");
    syncCustomSelectDisplay(wardSelect);
  }
  return parsed;
}
export async function initAddressDropdowns(tinhSelectId, xaSelectId, currentTinhName = "", currentXaName = "", isDisabled = false) {
  const tinhSelect = document.getElementById(tinhSelectId);
  const xaSelect = document.getElementById(xaSelectId);
  if (!tinhSelect || !xaSelect) return;
  xaSelect.innerHTML = trustedHTML('<option value="">-- Chọn Xã/Phường --</option>');
  xaSelect.disabled = true;
  tinhSelect.disabled = isDisabled;
  const provinces = await ensureVietnamProvinces();
  if (!provinces.length) {
    tinhSelect.innerHTML = trustedHTML('<option value="">Không thể tải danh sách tỉnh thành</option>');
    return;
  }
  tinhSelect.innerHTML = trustedHTML('<option value="">-- Chọn Tỉnh/Thành phố --</option>' + provinces.map((p) => `<option value="${p.code}" data-name="${escapeOptionText(p.name)}">${escapeOptionText(p.name)}</option>`).join(""));
  if (currentTinhName) {
    const foundProvince = provinces.find((p) => p.name === currentTinhName);
    if (foundProvince) {
      tinhSelect.value = foundProvince.code;
    } else {
      selectAddressOption(tinhSelect, "", currentTinhName, "legacy-province");
    }
  }
  const loadWards = async (provinceCode, selectWardName = "") => {
    if (!provinceCode) {
      xaSelect.innerHTML = trustedHTML('<option value="">-- Chọn Xã/Phường --</option>');
      xaSelect.disabled = true;
      return;
    }
    if (String(provinceCode).startsWith("legacy-province:")) {
      xaSelect.innerHTML = trustedHTML('<option value="">-- Chọn Xã/Phường --</option>');
      xaSelect.disabled = isDisabled;
      selectAddressOption(xaSelect, "", selectWardName, "legacy-ward");
      return;
    }
    xaSelect.innerHTML = trustedHTML('<option value="">Đang tải...</option>');
    xaSelect.disabled = true;
    const wards = await ensureVietnamWards(provinceCode);
    xaSelect.innerHTML = trustedHTML(renderWardOptions(wards));
    xaSelect.disabled = isDisabled;
    if (selectWardName) {
      const foundWard = wards.find((w) => w.name === selectWardName);
      if (foundWard) {
        xaSelect.value = foundWard.code;
      } else {
        selectAddressOption(xaSelect, "", selectWardName, "legacy-ward");
      }
    }
  };
  tinhSelect.onchange = (e) => {
    loadWards(e.target.value);
  };
  if (tinhSelect.value) {
    await loadWards(tinhSelect.value, currentXaName);
  }
  makeSearchableSelect(tinhSelect, "Tìm kiếm Tỉnh/Thành phố...");
  makeSearchableSelect(xaSelect, "Tìm kiếm Xã/Phường...");
}
export function makeSearchableSelect(select, placeholder) {
  if (!select?.id) return null;
  const activeWrapper = select.parentNode?.querySelector(
    `.bf-combobox[data-select-id="${select.id}"]`,
  );
  if (activeWrapper && !activeWrapper.classList.contains("custom-select-wrapper")) {
    select.__bfAccessibleCombobox?.destroy();
  }
  if (!select.__bfAccessibleCombobox) {
    select.parentNode
      ?.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]:not(.bf-combobox)`)
      ?.remove();
    select.parentNode
      ?.querySelector(`.custom-select-container[data-target="${select.id}"]:not(.bf-combobox)`)
      ?.remove();
    document.querySelectorAll(`body > .custom-select-options[data-parent="${select.id}"]`).forEach((stale) => stale.remove());
  }
  return initAccessibleCombobox(select, {
    compatibilityMode: "searchable-select",
    includeEmptyOption: true,
    noResultsText: "Không tìm thấy kết quả",
    placeholder,
    portal: true,
    searchable: true,
    showToggle: true,
  });
}
