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
  const cleaned = [...(parts || [])];
  while (cleaned.length > 0 && isVietnamCountryPart(cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  return cleaned;
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
  const wrapper = select.parentNode?.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]`);
  const input = wrapper?.querySelector(".custom-select-search");
  if (input) {
    const selectedOpt = select.options[select.selectedIndex];
    input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : "";
  }
  const optionsList = document.querySelector(`.custom-select-options[data-parent="${select.id}"]`) || wrapper?.querySelector(".custom-select-options");
  if (optionsList) {
    optionsList.querySelectorAll("li").forEach((li) => {
      li.className = li.getAttribute("data-value") === select.value ? "selected" : "";
      li.style.display = "";
    });
  }
}
async function ensureVietnamProvinces() {
  const root = addressCacheRoot();
  if (!root._vietnamProvinces || !Array.isArray(root._vietnamProvinces) || root._vietnamProvinces.length === 0) {
    const res = await fetch("/api/address/provinces");
    if (!res.ok) return [];
    const data = await res.json();
    root._vietnamProvinces = Array.isArray(data) ? data : [];
  }
  return root._vietnamProvinces;
}
async function ensureVietnamWards(provinceCode) {
  if (!provinceCode) return [];
  const root = addressCacheRoot();
  root._vietnamWards = root._vietnamWards || {};
  if (!root._vietnamWards[provinceCode] || !Array.isArray(root._vietnamWards[provinceCode])) {
    const res = await fetch(`/api/address/wards/${provinceCode}`);
    if (!res.ok) return [];
    const data = await res.json();
    root._vietnamWards[provinceCode] = Array.isArray(data) ? data : [];
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
      String(parts[0] || "").split(",").map((part) => part.trim()).filter(Boolean)
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
  const parts = stripVietnamCountrySuffix(raw.split(",").map((part) => part.trim()).filter(Boolean));
  if (parts.length === 0) {
    return { detail: raw, wardName: "", provinceName: "", wardCode: "", provinceCode: "", formattedAddress: composeInternalAddress(raw, "", ""), rawAddress: raw };
  }
  const provinces = await ensureVietnamProvinces();
  const provinceMatch = findAdministrativeMatch(parts, provinces, "province");
  const province = provinceMatch?.item || null;
  const provinceFallback = findPrefixedAdministrativePart(parts, "province");
  const provincePartIndex = provinceMatch?.partIndex >= 0 ? provinceMatch.partIndex : provinceFallback?.partIndex ?? -1;
  let ward = null;
  let wardMatch = null;
  if (province?.code) {
    const wards = await ensureVietnamWards(province.code);
    wardMatch = findAdministrativeMatch(parts, wards, "ward");
    ward = wardMatch?.item || null;
  }
  const wardFallback = findPrefixedAdministrativePart(parts, "ward", new Set([provincePartIndex]));
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
export async function applyRawAddressToAddressControls(rawAddress, { detailInputId, provinceSelectId, wardSelectId }) {
  const parsed = await parseVietnamAddress(rawAddress);
  const detailInput = document.getElementById(detailInputId);
  const provinceSelect = document.getElementById(provinceSelectId);
  const wardSelect = document.getElementById(wardSelectId);
  if (detailInput) {
    detailInput.value = parsed.detail || rawAddress || "";
  }
  if (provinceSelect && parsed.provinceCode) {
    provinceSelect.value = String(parsed.provinceCode);
    syncCustomSelectDisplay(provinceSelect);
  }
  if (wardSelect && parsed.provinceCode) {
    const wards = await ensureVietnamWards(parsed.provinceCode);
    wardSelect.innerHTML = renderWardOptions(wards);
    wardSelect.disabled = false;
    if (parsed.wardCode) {
      wardSelect.value = String(parsed.wardCode);
    }
    syncCustomSelectDisplay(wardSelect);
  }
  return parsed;
}
export async function initAddressDropdowns(tinhSelectId, xaSelectId, currentTinhName = "", currentXaName = "", isDisabled = false) {
  const tinhSelect = document.getElementById(tinhSelectId);
  const xaSelect = document.getElementById(xaSelectId);
  if (!tinhSelect || !xaSelect) return;
  xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
  xaSelect.disabled = true;
  tinhSelect.disabled = isDisabled;
  if (!window._vietnamProvinces || !Array.isArray(window._vietnamProvinces) || window._vietnamProvinces.length === 0) {
    window._vietnamProvinces = null;
    try {
      const res = await fetch("/api/address/provinces");
      if (res.ok) {
        const data = await res.json();
        window._vietnamProvinces = Array.isArray(data) ? data : null;
        if (!window._vietnamProvinces || window._vietnamProvinces.length === 0) {
          console.error("Provinces API returned empty data");
          tinhSelect.innerHTML = '<option value="">Lỗi: Dữ liệu tỉnh thành trống</option>';
          return;
        }
      } else {
        console.error("Failed to fetch provinces, status:", res.status);
        tinhSelect.innerHTML = '<option value="">Lỗi tải danh sách tỉnh thành</option>';
        return;
      }
    } catch (err) {
      console.error("Error loading provinces:", err);
      tinhSelect.innerHTML = '<option value="">Không thể tải danh sách tỉnh thành</option>';
      return;
    }
  }
  tinhSelect.innerHTML = '<option value="">-- Chọn Tỉnh/Thành phố --</option>' + window._vietnamProvinces.map((p) => `<option value="${p.code}" data-name="${p.name}">${p.name}</option>`).join("");
  if (currentTinhName) {
    const foundProvince = window._vietnamProvinces.find((p) => p.name === currentTinhName);
    if (foundProvince) {
      tinhSelect.value = foundProvince.code;
    }
  }
  const loadWards = async (provinceCode, selectWardName = "") => {
    if (!provinceCode) {
      xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
      xaSelect.disabled = true;
      return;
    }
    xaSelect.innerHTML = '<option value="">Đang tải...</option>';
    xaSelect.disabled = true;
    window._vietnamWards = window._vietnamWards || {};
    if (!window._vietnamWards[provinceCode] || !Array.isArray(window._vietnamWards[provinceCode])) {
      try {
        const res = await fetch(`/api/address/wards/${provinceCode}`);
        if (res.ok) {
          const data = await res.json();
          window._vietnamWards[provinceCode] = Array.isArray(data) ? data : [];
        } else {
          xaSelect.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
          return;
        }
      } catch (err) {
        xaSelect.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
        return;
      }
    }
    const wards = window._vietnamWards[provinceCode];
    xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>' + wards.map((w) => `<option value="${w.code}" data-name="${w.name}">${w.name}</option>`).join("");
    xaSelect.disabled = isDisabled;
    if (selectWardName) {
      const foundWard = wards.find((w) => w.name === selectWardName);
      if (foundWard) {
        xaSelect.value = foundWard.code;
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
  if (!select) return;
  select.setAttribute("data-no-custom", "true");
  let wrapper = select.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]`);
  if (wrapper) {
    refreshCustomOptions(select, wrapper);
    return;
  }
  wrapper = document.createElement("div");
  wrapper.className = "custom-select-wrapper";
  wrapper.setAttribute("data-select-id", select.id);
  select.style.display = "none";
  select.parentNode.insertBefore(wrapper, select.nextSibling);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "custom-select-search";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.disabled = select.disabled;
  const arrow = document.createElement("div");
  arrow.className = "custom-select-arrow";
  arrow.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" style="display: block;"><path d="m6 9 6 6 6-6"/></svg>`;
  const optionsList = document.createElement("ul");
  optionsList.className = "custom-select-options";
  optionsList.setAttribute("data-parent", select.id);
  wrapper.appendChild(input);
  wrapper.appendChild(arrow);
  wrapper.appendChild(optionsList);
  refreshCustomOptions(select, wrapper);
  const toggleDropdown = (show) => {
    if (input.disabled) return;
    const wasOpen = wrapper.classList.contains("open");
    let nextOpen = wasOpen;
    if (show === void 0) {
      nextOpen = !wasOpen;
    } else {
      nextOpen = show;
    }
    if (nextOpen === wasOpen) return;
    if (nextOpen) {
      document.dispatchEvent(new Event("click"));
      wrapper.classList.add("open");
      document.body.appendChild(optionsList);
      optionsList.style.display = "block";
      optionsList.style.zIndex = "999999";
      const rect = input.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      optionsList.style.position = "absolute";
      optionsList.style.minWidth = rect.width + "px";
      optionsList.style.left = rect.left + scrollX + "px";
      const dropdownHeight = optionsList.offsetHeight || 200;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        wrapper.classList.add("drop-up");
        optionsList.style.top = rect.top + scrollY - dropdownHeight - 4 + "px";
      } else {
        wrapper.classList.remove("drop-up");
        optionsList.style.top = rect.bottom + scrollY + 4 + "px";
      }
      const selectedItem = optionsList.querySelector(".selected");
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    } else {
      wrapper.classList.remove("open");
      optionsList.style.display = "none";
      wrapper.appendChild(optionsList);
    }
  };
  input.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown(true);
  });
  input.addEventListener("focus", () => {
    toggleDropdown(true);
    input.select();
  });
  arrow.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });
  input.addEventListener("input", () => {
    const query = input.value.toLowerCase().trim();
    const items = optionsList.querySelectorAll("li:not(.custom-select-no-results)");
    let hasResults = false;
    items.forEach((item) => {
      const val = item.getAttribute("data-value");
      const opt = Array.from(select.options).find((o) => o.value === val);
      const searchAttr = opt ? opt.getAttribute("data-search") || "" : "";
      const text = (item.textContent + " " + searchAttr).toLowerCase();
      if (text.includes(query)) {
        item.style.display = "";
        hasResults = true;
      } else {
        item.style.display = "none";
      }
    });
    let noResultsMsg = optionsList.querySelector(".custom-select-no-results");
    if (!hasResults) {
      if (!noResultsMsg) {
        noResultsMsg = document.createElement("li");
        noResultsMsg.className = "custom-select-no-results";
        noResultsMsg.textContent = "Không tìm thấy kết quả";
        optionsList.appendChild(noResultsMsg);
      }
    } else if (noResultsMsg) {
      noResultsMsg.remove();
    }
  });
  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target) && !optionsList.contains(e.target)) {
      toggleDropdown(false);
      const selectedOpt = select.options[select.selectedIndex];
      input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : "";
      optionsList.querySelectorAll("li").forEach((item) => item.style.display = "");
      const noResultsMsg = optionsList.querySelector(".custom-select-no-results");
      if (noResultsMsg) noResultsMsg.remove();
    }
  });
  document.addEventListener("scroll", (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("custom-select-options")) return;
    if (wrapper.classList.contains("open")) {
      toggleDropdown(false);
      const selectedOpt = select.options[select.selectedIndex];
      input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : "";
      optionsList.querySelectorAll("li").forEach((item) => item.style.display = "");
    }
  }, { capture: true, passive: true });
  select.addEventListener("change", () => {
    const selectedOpt = select.options[select.selectedIndex];
    input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : "";
    optionsList.querySelectorAll("li").forEach((li) => {
      if (li.getAttribute("data-value") === select.value) {
        li.className = "selected";
      } else {
        li.className = "";
      }
    });
  });
  const parentForm = select.closest("form");
  if (parentForm) {
    parentForm.addEventListener("reset", () => {
      setTimeout(() => {
        const selectedOpt = select.options[select.selectedIndex];
        input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : "";
        optionsList.querySelectorAll("li").forEach((li) => {
          if (li.getAttribute("data-value") === (select.value || "")) {
            li.className = "selected";
          } else {
            li.className = "";
          }
        });
      }, 0);
    });
  }
  const observer = new MutationObserver(() => {
    refreshCustomOptions(select, wrapper);
  });
  observer.observe(select, { childList: true, attributes: true, attributeFilter: ["disabled"] });
}
function refreshCustomOptions(select, wrapper) {
  const input = wrapper.querySelector(".custom-select-search");
  const optionsList = document.querySelector(`.custom-select-options[data-parent="${select.id}"]`) || wrapper.querySelector(".custom-select-options");
  if (!optionsList) return;
  input.disabled = select.disabled;
  optionsList.innerHTML = "";
  const options = Array.from(select.options);
  options.forEach((opt) => {
    const li = document.createElement("li");
    li.textContent = opt.text;
    li.setAttribute("data-value", opt.value);
    if (opt.selected) {
      li.className = "selected";
      input.value = opt.value ? opt.text : "";
    }
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      select.value = opt.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      optionsList.querySelectorAll("li").forEach((item) => item.classList.remove("selected"));
      li.classList.add("selected");
      input.value = opt.value ? opt.text : "";
      wrapper.classList.remove("open");
      optionsList.style.display = "none";
      wrapper.appendChild(optionsList);
    });
    optionsList.appendChild(li);
  });
}
