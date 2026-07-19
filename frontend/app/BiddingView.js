import { trustedHTML } from "../shared/trustedTypes.js";
import { getRuntimeStyle, setRuntimeStyle } from "../shared/runtimeStyles.js";
import * as SystemUser from "../admin/SystemUserView.js";
import { escapeHtml, initCustomSelect, syncCustomSelectDisabled } from "../shared/view_helpers.js";
import { ensureFlatpickrLoaded } from "../shared/externalAssets.js";
import { focusInvalidControl } from "./formStateUtils.js";
import { validateForm as validateConfiguredForm } from "../shared/FormValidation.js";
import { installPrototypeModules } from "./moduleRegistry.js";
import { executeAppCommand } from "./commandBus.js";
import { getAppController } from "./controllerRef.js";
import { renderPackageStatusBadge } from "../shared/statusBadges.js";

export function toastDeduplicationKey(title, message, type) {
  return JSON.stringify([String(type || "info"), String(title || ""), String(message || "")]);
}

const DANGER_DIALOG_ICONS = new Set(["x-circle", "trash-2", "user-x", "log-out", "shield-alert", "lock"]);
const WARNING_DIALOG_ICONS = new Set(["alert-triangle", "alert-circle"]);
const SUCCESS_DIALOG_ICONS = new Set(["check", "check-circle"]);

function applyDialogTone(modal, iconName) {
  if (!modal) return "primary";
  const tone = DANGER_DIALOG_ICONS.has(iconName)
    ? "danger"
    : WARNING_DIALOG_ICONS.has(iconName)
      ? "warning"
      : SUCCESS_DIALOG_ICONS.has(iconName)
        ? "success"
        : "primary";
  modal.dataset.dialogTone = tone;
  return tone;
}

const VIEW_MODULE_LOADERS = Object.freeze({
  dashboard: () => import("./DashboardView.js"),
  plan: () => import("./PlanView.js"),
  partner: () => import("../partners/PartnerView.js"),
  timeline: () => import("../packages/PackageTimelineView.js")
});

const VIEW_MODULES_BY_TAB = Object.freeze({
  dashboard: ["dashboard"],
  "superadmin-dashboard": ["dashboard"],
  kehoach: ["plan"],
  "kehoach-detail": ["plan"],
  goithau: ["plan"],
  "goithau-timeline": ["timeline"],
  "goithau-detail": ["plan"],
  mothau: ["plan"],
  danhgiahsdt: ["plan"],
  chudautu: ["partner"],
  "chudautu-detail": ["partner"],
  nhathau: ["partner"],
  "nhathau-detail": ["partner"],
  chuyengia: ["partner"],
  hopdong: ["partner"],
  "hopdong-detail": ["partner"],
  bieumau: ["partner"]
});

const installedViewModules = new Set(["system-user"]);
const pendingViewModules = new Map();

export class BiddingView {
  constructor(model) {
    this.model = model;
    this.elements = {};
  }
  initDOM() {
    this.elements = {
      sidebarToggle: document.getElementById("sidebar-toggle"),
      sidebar: document.getElementById("sidebar"),
      currentDateSpan: document.getElementById("current-date").querySelector("span"),
      pageTitle: document.getElementById("page-title"),
      navButtons: document.querySelectorAll(".nav-btn"),
      tabPanes: document.querySelectorAll(".tab-pane")
    };
    if (!this._tableObserver) {
      this._tableObserver = new MutationObserver((mutations) => {
        if (!this.mutationsNeedEnhancement(mutations)) return;
        if (this._enhanceFrame) return;
        this._enhanceFrame = requestAnimationFrame(() => {
          this._enhanceFrame = null;
          this.enhanceVisibleContent();
        });
      });
      this._tableObserver.observe(document.body, { childList: true, subtree: true });
    }
    setTimeout(() => this.enhanceVisibleContent(), 100);
  }
  mutationsNeedEnhancement(mutations = []) {
    const selector = "table, select, input.flatpickr-date, input.flatpickr-datetime";
    return mutations.some((mutation) => {
      const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
      return nodes.some((node) => (
        node?.nodeType === 1
        && (node.matches?.(selector) || node.querySelector?.(selector))
      ));
    });
  }
  getActiveEnhancementRoot() {
    const activeModal = document.querySelector(".modal-overlay.active:not(#modal-custom-dialog)");
    if (activeModal) return activeModal;
    return document.querySelector(".tab-pane.active") || document.querySelector(".content-viewport") || document;
  }
  isEnhancementTargetActive(element) {
    if (!element || typeof element.closest !== "function") return false;
    const inactiveModal = element.closest(".modal-overlay:not(.active)");
    if (inactiveModal) return false;
    const tabPane = element.closest(".tab-pane");
    return !tabPane || tabPane.classList.contains("active");
  }
  createIconsScoped(root = document) {
    const iconLibrary = window.lucide;
    if (!iconLibrary || typeof iconLibrary.createIcons !== "function") return;
    const hasPendingIcon = root?.matches?.("i[data-lucide]") || root?.querySelector?.("i[data-lucide]");
    if (!hasPendingIcon) return;
    try {
      iconLibrary.createIcons({ root });
    } catch (error) {
      iconLibrary.createIcons();
    }
  }
  enhanceVisibleContent(container = null) {
    this.enhanceAllTables(container || this.getActiveEnhancementRoot());
  }
  enhanceAllTables(container = null) {
    if (this._tableObserver) {
      this._tableObserver.disconnect();
    }
    const root = container || this.getActiveEnhancementRoot();
    const tables = root && typeof root.querySelectorAll === "function" ? root.querySelectorAll("table") : document.querySelectorAll("table");
    tables.forEach((table) => {
      if (!this.isEnhancementTargetActive(table)) return;
      this.enhanceTableHeaders(table);
    });
    this.upgradeAllSelects(root);
    this.initFlatpickr(root);
    if (this._tableObserver) {
      this._tableObserver.observe(document.body, { childList: true, subtree: true });
    }
  }
  upgradeAllSelects(container = document) {
    document.querySelectorAll("body > .custom-select-dropdown").forEach((dropdown) => {
      const targetId = dropdown.getAttribute("data-target");
      const selectEl = document.getElementById(targetId);
      const wrapperEl = document.querySelector(`.custom-select-container[data-target="${targetId}"]`);
      if (!selectEl || !wrapperEl || wrapperEl.offsetWidth === 0 && wrapperEl.offsetHeight === 0) {
        dropdown.remove();
      }
    });
    const root = container || document;
    const selects = root && typeof root.querySelectorAll === "function" ? root.querySelectorAll("select") : document.querySelectorAll("select");
    selects.forEach((select) => {
      if (!this.isEnhancementTargetActive(select)) return;
      const isPackageSelectInDetail = ["mothau-goithau-select", "danhgiahsdt-goithau-select", "result-goithau-select"].includes(select.id) && document.getElementById("tab-goithau-detail");
      if (isPackageSelectInDetail) {
        const existingContainer = select.parentNode.querySelector(`.custom-select-container[data-target="${select.id}"]`);
        if (existingContainer) existingContainer.remove();
        const existingWrapper = select.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]`);
        if (existingWrapper) existingWrapper.remove();
        return;
      }
      if (select.closest(".flatpickr-calendar") || select.classList.contains("flatpickr-monthDropdown-months") || select.classList.contains("flatpickr-year-select")) {
        return;
      }
      const hasNoCustomAttr = select.getAttribute("data-no-custom") === "true";
      const hasSearchableWrapper = select.id && select.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]`);
      if (select.classList.contains("version-select") || select.classList.contains("phienban-select") || select.classList.contains("modal-version-select") || hasNoCustomAttr || hasSearchableWrapper) {
        if (select.id) {
          const existingContainer = select.parentNode.querySelector(`.custom-select-container[data-target="${select.id}"]`);
          if (existingContainer) {
            existingContainer.remove();
            if (!hasSearchableWrapper) {
              setRuntimeStyle(select, "display", "");
            }
          }
        }
        return;
      }
      if (!select.id) {
        select.id = "select-" + Math.random().toString(36).substring(2, 9);
      }
      initCustomSelect(select.id);
    });
  }
  enhanceTableHeaders(tableOrId, tableKey) {
    let table = typeof tableOrId === "string" ? document.getElementById(tableOrId) : tableOrId;
    if (!table) return;
    if (table.dataset.noSort === "true") return;
    const svgUnsorted = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevrons-up-down bf-s-bd877e16c3"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>`;
    const svgAsc = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-up bf-s-bd877e16c3"><path d="m18 15-6-6-6 6"/></svg>`;
    const svgDesc = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down bf-s-bd877e16c3"><path d="m6 9 6 6 6-6"/></svg>`;
    if (!tableKey && table.id) {
      const idMap = {
        "kehoach-table": "kehoach",
        "goithau-table": "goithau",
        "chudautu-table": "chudautu",
        "nhathau-table": "nhathau",
        "chuyengia-table": "chuyengia",
        "hopdong-table": "hopdong"
      };
      tableKey = idMap[table.id];
    }
    const normalize = (str) => {
      if (!str) return "";
      return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").trim();
    };
    const sortFieldMap = {
      "kehoach": {
        "makehoach": "maKeHoach",
        "phienban": "phienBan",
        "tenkehoachluachonnhathau": "tenKeHoach",
        "phanloai": "loaiHinhMuaSam",
        "duandutoan": "tenDuAnDuToan",
        "chudautu": "chuDauTuId",
        "tonggiatri": "tongMucDauTu",
        "ngaypheduyet": "ngayPheDuyet",
        "soqd": "quyetDinhPheDuyet",
        "thoigiandangma": "thoiGianDangMa"
      },
      "goithau": {
        "magoi": "maGoiThau",
        "magoithau": "maGoiThau",
        "phienban": "phienBan",
        "tengoithau": "tenGoiThau",
        "kehoachlienket": "keHoachId",
        "giagoithau": "giaGoiThau",
        "hinhthuc": "hinhThucLuaChon",
        "hinhthuclcnt": "hinhThucLuaChon",
        "trangthai": "trangThai",
        "nhathautrungthau": "nhaThauTrungThauId"
      },
      "chudautu": {
        "macdt": "maChuDauTu",
        "machudautu": "maChuDauTu",
        "phienban": "phienBan",
        "tenchudautu": "tenChuDauTu",
        "masothue": "maSoThue",
        "daidien": "daiDienCdt",
        "diachisdt": "diaChi",
        "sotaikhoan": "soTaiKhoan"
      },
      "nhathau": {
        "manhathau": "maNhaThau",
        "phienban": "phienBan",
        "tennhathau": "tenNhaThau",
        "masothue": "maSoThue",
        "nguoidaidien": "nguoiDaiDien",
        "lienhe": "soDienThoai",
        "taikhoannganhang": "soTaiKhoan"
      },
      "chuyengia": {
        "hovatenchuyengia": "hoTen",
        "hotenchuyengia": "hoTen",
        "phienban": "phienBan",
        "socancuoccongdan": "soCCCD",
        "sochungchidauthau": "soChungChi",
        "donvicapchungchi": "donViCapChungChi",
        "ngaycapchungchi": "ngayCapChungChi",
        "ngaycapcccd": "ngayCapCCCD"
      },
      "hopdong": {
        "sohopdong": "soHopDong",
        "phienban": "phienBan",
        "tenhopdong": "tenHopDong",
        "ngayky": "ngayKy",
        "chudautu": "chuDauTuId",
        "nhathau": "nhaThauId",
        "giatrihopdong": "giaTri",
        "loaihopdong": "loaiHopDong",
        "thoigianthuchien": "soNgayThucHien",
        "goithaulienket": "goiThauId",
        "trangthaihoso": "trangThaiHoSo"
      }
    };
    const ths = table.querySelectorAll("thead th");
    const mapping = tableKey ? sortFieldMap[tableKey] : null;
    ths.forEach((th, colIndex) => {
      const rawText = th.textContent.replace(/[↕▲▼]/g, "").trim();
      const normText = normalize(rawText);
      if (!normText || ["thaotac", "hanhdong", "chucnang", "chon", "tuychon"].includes(normText)) {
        return;
      }
      const field = mapping ? mapping[normText] : null;
      let container = th.querySelector(".sort-header-container");
      if (!container) {
        setRuntimeStyle(th, "cursor", "pointer");
        setRuntimeStyle(th, "userSelect", "none");
        const headerText = th.textContent;
        th.tabIndex = 0;
        th.setAttribute("aria-label", `Sắp xếp theo ${headerText.trim()}`);
        th.setAttribute("aria-sort", "none");
        const sortContainer = document.createElement("div");
        sortContainer.className = "sort-header-container";
        const label = document.createElement("span");
        label.className = "th-label";
        setRuntimeStyle(label, "flexGrow", "1");
        setRuntimeStyle(label, "textAlign", "inherit");
        label.textContent = headerText;
        const icon = document.createElement("span");
        icon.className = "sort-icon-btn";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = trustedHTML(svgUnsorted);
        sortContainer.append(label, icon);
        th.replaceChildren(sortContainer);
        th.addEventListener("click", (e) => {
          if (e.target.closest("select") || e.target.closest("input") || e.target.closest("button") || e.target.closest("a")) return;
          if (tableKey && field) {
            executeAppCommand("toggleSortTable", tableKey, field);
          } else {
            const currentOrder = th.getAttribute("data-sort-order") === "asc" ? "desc" : "asc";
            ths.forEach((otherTh) => {
              if (otherTh !== th) {
                otherTh.removeAttribute("data-sort-order");
                otherTh.setAttribute("aria-sort", "none");
                const otherIcon = otherTh.querySelector(".sort-icon-btn");
                if (otherIcon) {
                  otherIcon.innerHTML = trustedHTML(svgUnsorted);
                  otherIcon.classList.remove("active");
                  setRuntimeStyle(otherIcon, "opacity", "");
                  setRuntimeStyle(otherIcon, "color", "");
                  setRuntimeStyle(otherIcon, "fontWeight", "");
                }
              }
            });
            th.setAttribute("data-sort-order", currentOrder);
            th.setAttribute("aria-sort", currentOrder === "asc" ? "ascending" : "descending");
            const iconBtn = th.querySelector(".sort-icon-btn");
            if (iconBtn) {
              iconBtn.innerHTML = trustedHTML(currentOrder === "asc" ? svgAsc : svgDesc);
              iconBtn.classList.add("active");
              setRuntimeStyle(iconBtn, "opacity", "");
              setRuntimeStyle(iconBtn, "color", "");
              setRuntimeStyle(iconBtn, "fontWeight", "");
            }
            const tbody = table.querySelector("tbody");
            if (tbody) {
              const rows = Array.from(tbody.querySelectorAll("tr"));
              const getCellValue = (row) => {
                const cell = row.children[colIndex];
                if (!cell) return "";
                const input = cell.querySelector("input, select");
                if (input) return input.value.trim();
                return cell.textContent.trim();
              };
              const parseValue = (val) => {
                const cleanNum = val.replace(/\./g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, "");
                if (cleanNum && !isNaN(cleanNum)) {
                  return parseFloat(cleanNum);
                }
                const dateParts = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (dateParts) {
                  return new Date(dateParts[3], dateParts[2] - 1, dateParts[1]).getTime();
                }
                return val.toLowerCase();
              };
              rows.sort((a, b) => {
                const valA = parseValue(getCellValue(a));
                const valB = parseValue(getCellValue(b));
                if (typeof valA === "number" && typeof valB === "number") {
                  return currentOrder === "asc" ? valA - valB : valB - valA;
                }
                return currentOrder === "asc" ? String(valA).localeCompare(String(valB), "vi") : String(valB).localeCompare(String(valA), "vi");
              });
              rows.forEach((row) => tbody.appendChild(row));
            }
          }
        });
        th.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          th.click();
        });
      }
      if (tableKey && field) {
        const currentSort = this.model.sortState[tableKey] || {};
        const iconBtn = th.querySelector(".sort-icon-btn");
        if (iconBtn) {
          if (currentSort.field === field) {
            th.setAttribute("aria-sort", currentSort.order === "asc" ? "ascending" : "descending");
            iconBtn.innerHTML = trustedHTML(currentSort.order === "asc" ? svgAsc : svgDesc);
            iconBtn.classList.add("active");
            setRuntimeStyle(iconBtn, "opacity", "");
            setRuntimeStyle(iconBtn, "color", "");
            setRuntimeStyle(iconBtn, "fontWeight", "");
          } else {
            th.setAttribute("aria-sort", "none");
            iconBtn.innerHTML = trustedHTML(svgUnsorted);
            iconBtn.classList.remove("active");
            setRuntimeStyle(iconBtn, "opacity", "");
            setRuntimeStyle(iconBtn, "color", "");
            setRuntimeStyle(iconBtn, "fontWeight", "");
          }
        }
      }
    });
  }
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add("active");
      this.enhanceVisibleContent(modal);
      this.createIconsScoped(modal);
    } else if (getAppController()?.ensureLazyModal) {
      getAppController().ensureLazyModal(modalId).then(() => this.openModal(modalId)).catch((err) => console.error("Failed to lazy-load modal:", modalId, err));
    }
  }
  initFlatpickr(container = document) {
    const hasDateInputs = container.querySelector?.("input.flatpickr-date, input.flatpickr-datetime");
    if (!hasDateInputs) return;
    if (typeof flatpickr === "undefined") {
      if (this._flatpickrLoading) return;
      this._flatpickrLoading = ensureFlatpickrLoaded().then(() => {
        this._flatpickrLoading = null;
        this.initFlatpickr(container);
      }).catch((err) => {
        this._flatpickrLoading = null;
        console.error("Failed to lazy-load flatpickr:", err);
      });
      return;
    }
    const setupPlugins = (instance) => {
      const footer = document.createElement("div");
      footer.className = "flatpickr-footer";
      setRuntimeStyle(footer, "display", "flex");
      setRuntimeStyle(footer, "justifyContent", "flex-end");
      setRuntimeStyle(footer, "gap", "8px");
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-outline";
      cancelBtn.textContent = "Hủy";
      setRuntimeStyle(cancelBtn, "borderRadius", "var(--radius-sm)");
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        instance.close();
      };
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "btn btn-primary";
      confirmBtn.textContent = "Xác nhận";
      setRuntimeStyle(confirmBtn, "borderRadius", "var(--radius-sm)");
      confirmBtn.onclick = (e) => {
        e.stopPropagation();
        instance.close();
      };
      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);
      instance.calendarContainer.appendChild(footer);
      const container2 = instance.calendarContainer;
      let gridOverlay = container2.querySelector(".flatpickr-grid-overlay");
      if (!gridOverlay) {
        gridOverlay = document.createElement("div");
        gridOverlay.className = "flatpickr-grid-overlay";
        setRuntimeStyle(gridOverlay, "display", "none");
        const footerEl = container2.querySelector(".flatpickr-footer");
        if (footerEl) {
          container2.insertBefore(gridOverlay, footerEl);
        } else {
          container2.appendChild(gridOverlay);
        }
      }
      const showGrid = (type) => {
        const innerContainer = container2.querySelector(".flatpickr-innerContainer");
        if (innerContainer) setRuntimeStyle(innerContainer, "display", "none");
        const timeContainer = container2.querySelector(".flatpickr-time");
        if (timeContainer) setRuntimeStyle(timeContainer, "display", "none");
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
    };
    setTimeout(() => {
      container.querySelectorAll("input.flatpickr-date").forEach((el) => {
        el.setAttribute("autocomplete", "off");
        if (el._flatpickr) return;
        flatpickr(el, {
          dateFormat: "d/m/Y",
          allowInput: true,
          monthSelectorType: "static",
          locale: "vn",
          time_24hr: true,
          onReady: function(selectedDates, dateStr, instance) {
            setupPlugins(instance);
          }
        });
      });
      container.querySelectorAll("input.flatpickr-datetime").forEach((el) => {
        el.setAttribute("autocomplete", "off");
        if (el._flatpickr) return;
        flatpickr(el, {
          dateFormat: "d/m/Y H:i",
          enableTime: true,
          time_24hr: true,
          monthSelectorType: "static",
          allowInput: true,
          locale: "vn",
          onReady: function(selectedDates, dateStr, instance) {
            setupPlugins(instance);
          }
        });
      });
    }, 50);
  }
  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove("active");
    }
  }
  customConfirm(title, message, iconName = "help-circle") {
    if (iconName === "warning") iconName = "alert-triangle";
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-custom-dialog");
      const titleEl = document.getElementById("dialog-title");
      const messageEl = document.getElementById("dialog-message");
      const iconContainer = document.getElementById("dialog-icon-container");
      const iconEl = document.getElementById("dialog-icon");
      const okBtn = document.getElementById("btn-dialog-ok");
      const cancelBtn = document.getElementById("btn-dialog-cancel");
      const closeBtn = document.getElementById("btn-dialog-close");
      const buttonContainer = document.getElementById("dialog-buttons");
      buttonContainer?.classList.remove("dialog-buttons-single");
      titleEl.textContent = title;
      messageEl.textContent = message;
      setRuntimeStyle(cancelBtn, "display", "block");
      if (closeBtn) setRuntimeStyle(closeBtn, "display", "block");
      iconEl.setAttribute("data-lucide", iconName);
      applyDialogTone(modal, iconName);
      if (iconName === "trash-2" || iconName === "user-x" || iconName === "log-out") {
        setRuntimeStyle(iconContainer, "background", "var(--danger-soft)");
        setRuntimeStyle(iconContainer, "color", "var(--danger)");
        okBtn.className = "btn btn-primary bg-danger";
        setRuntimeStyle(okBtn, "background", "var(--danger)");
        setRuntimeStyle(okBtn, "borderColor", "var(--danger)");
      } else if (iconName === "alert-triangle" || iconName === "alert-circle" || iconName === "info" || iconName === "help-circle" || iconName === "save") {
        setRuntimeStyle(iconContainer, "background", "var(--warning-soft)");
        setRuntimeStyle(iconContainer, "color", "var(--warning)");
        okBtn.className = "btn btn-primary bg-warning";
        setRuntimeStyle(okBtn, "background", "var(--warning)");
        setRuntimeStyle(okBtn, "borderColor", "var(--warning)");
      } else {
        setRuntimeStyle(iconContainer, "background", "rgba(59, 130, 246, 0.1)");
        setRuntimeStyle(iconContainer, "color", "var(--primary)");
        okBtn.className = "btn btn-primary";
        setRuntimeStyle(okBtn, "background", "");
        setRuntimeStyle(okBtn, "borderColor", "");
      }
      lucide.createIcons();
      const onOk = () => {
        cleanup();
        resolve(true);
      };
      const onCancel = () => {
        cleanup();
        resolve(false);
      };
      const onClose = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onClose);
        modal.classList.remove("active");
      };
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onClose);
      modal.classList.add("active");
    });
  }
  customVersionDeleteChoice(title, message, option1Text = "Xóa phiên bản gần nhất", option2Text = "Xóa toàn bộ các phiên bản") {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-custom-dialog");
      const titleEl = document.getElementById("dialog-title");
      const messageEl = document.getElementById("dialog-message");
      const iconContainer = document.getElementById("dialog-icon-container");
      const iconEl = document.getElementById("dialog-icon");
      const buttonContainer = document.getElementById("dialog-buttons");
      const closeBtn = document.getElementById("btn-dialog-close");
      buttonContainer?.classList.remove("dialog-buttons-single");
      titleEl.textContent = title;
      messageEl.textContent = message;
      if (closeBtn) setRuntimeStyle(closeBtn, "display", "block");
      iconEl.setAttribute("data-lucide", "trash-2");
      applyDialogTone(modal, "trash-2");
      setRuntimeStyle(iconContainer, "background", "var(--danger-soft)");
      setRuntimeStyle(iconContainer, "color", "var(--danger)");
      const originalButtonsHtml = buttonContainer.innerHTML;
      const originalFlexDirection = getRuntimeStyle(buttonContainer, "flex-direction");
      const originalGap = getRuntimeStyle(buttonContainer, "gap");
      const cardEl = modal.querySelector(".modal-card");
      const originalCardWidth = getRuntimeStyle(cardEl, "width");
      const originalCardMaxWidth = getRuntimeStyle(cardEl, "max-width");
      setRuntimeStyle(cardEl, "width", "480px");
      setRuntimeStyle(cardEl, "maxWidth", "480px");
      setRuntimeStyle(buttonContainer, "flexDirection", "row");
      setRuntimeStyle(buttonContainer, "gap", "10px");
      buttonContainer.replaceChildren();
      const cancelChoiceBtn = document.createElement("button");
      cancelChoiceBtn.type = "button";
      cancelChoiceBtn.className = "btn btn-outline";
      cancelChoiceBtn.id = "btn-dialog-cancel";
      setRuntimeStyle(cancelChoiceBtn, "cssText", "flex: 1; padding: 8px 10px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; height: 38px;");
      cancelChoiceBtn.textContent = "Huy";
      const opt1ChoiceBtn = document.createElement("button");
      opt1ChoiceBtn.type = "button";
      opt1ChoiceBtn.className = "btn btn-warning";
      opt1ChoiceBtn.id = "btn-dialog-opt1";
      setRuntimeStyle(opt1ChoiceBtn, "cssText", "flex: 1.6; padding: 8px 10px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; min-height: 44px;");
      opt1ChoiceBtn.textContent = option1Text;
      const opt2ChoiceBtn = document.createElement("button");
      opt2ChoiceBtn.type = "button";
      opt2ChoiceBtn.className = "btn btn-danger";
      opt2ChoiceBtn.id = "btn-dialog-opt2";
      setRuntimeStyle(opt2ChoiceBtn, "cssText", "flex: 1.6; padding: 8px 10px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; min-height: 44px;");
      opt2ChoiceBtn.textContent = option2Text;
      buttonContainer.append(cancelChoiceBtn, opt1ChoiceBtn, opt2ChoiceBtn);
      lucide.createIcons();
      const opt1Btn = document.getElementById("btn-dialog-opt1");
      const opt2Btn = document.getElementById("btn-dialog-opt2");
      const cancelBtn = document.getElementById("btn-dialog-cancel");
      const onOpt1 = () => {
        cleanup();
        resolve(1);
      };
      const onOpt2 = () => {
        cleanup();
        resolve(2);
      };
      const onCancel = () => {
        cleanup();
        resolve(null);
      };
      const onClose = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        opt1Btn.removeEventListener("click", onOpt1);
        opt2Btn.removeEventListener("click", onOpt2);
        cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onClose);
        modal.classList.remove("active");
        setRuntimeStyle(cardEl, "width", originalCardWidth);
        setRuntimeStyle(cardEl, "maxWidth", originalCardMaxWidth);
        setRuntimeStyle(buttonContainer, "flexDirection", originalFlexDirection);
        setRuntimeStyle(buttonContainer, "gap", originalGap);
        buttonContainer.innerHTML = trustedHTML(originalButtonsHtml);
      };
      opt1Btn.addEventListener("click", onOpt1);
      opt2Btn.addEventListener("click", onOpt2);
      cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onClose);
      modal.classList.add("active");
    });
  }
  customSelectConfirm(title, message, options = []) {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-custom-dialog");
      const titleEl = document.getElementById("dialog-title");
      const messageEl = document.getElementById("dialog-message");
      const iconContainer = document.getElementById("dialog-icon-container");
      const iconEl = document.getElementById("dialog-icon");
      const okBtn = document.getElementById("btn-dialog-ok");
      const cancelBtn = document.getElementById("btn-dialog-cancel");
      const closeBtn = document.getElementById("btn-dialog-close");
      const buttonContainer = document.getElementById("dialog-buttons");
      buttonContainer?.classList.remove("dialog-buttons-single");
      titleEl.textContent = title;
      iconEl.setAttribute("data-lucide", "help-circle");
      applyDialogTone(modal, "help-circle");
      setRuntimeStyle(iconContainer, "background", "rgba(59, 130, 246, 0.1)");
      setRuntimeStyle(iconContainer, "color", "var(--primary)");
      okBtn.className = "btn btn-primary";
      setRuntimeStyle(okBtn, "background", "");
      setRuntimeStyle(okBtn, "borderColor", "");
      const originalMessageText = messageEl.textContent;
      const originalMessageStyle = getRuntimeStyle(messageEl, "display");
      setRuntimeStyle(cancelBtn, "display", "block");
      if (closeBtn) setRuntimeStyle(closeBtn, "display", "block");
      const promptText = document.createElement("div");
      setRuntimeStyle(promptText, "marginBottom", "12px");
      promptText.textContent = message;
      const selectEl = document.createElement("select");
      selectEl.id = "dialog-custom-select";
      selectEl.className = "form-control";
      setRuntimeStyle(selectEl, "cssText", "width: 100%; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;");
      options.forEach((opt) => {
        const optionEl = document.createElement("option");
        optionEl.value = String(opt?.value ?? "");
        optionEl.textContent = String(opt?.label ?? "");
        selectEl.appendChild(optionEl);
      });
      messageEl.replaceChildren(promptText, selectEl);
      lucide.createIcons();
      modal.classList.add("active");
      const onOk = () => {
        const selectEl2 = document.getElementById("dialog-custom-select");
        const val = selectEl2 ? selectEl2.value : null;
        cleanup();
        resolve(val);
      };
      const onCancel = () => {
        cleanup();
        resolve(null);
      };
      const onClose = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onClose);
        modal.classList.remove("active");
        messageEl.textContent = originalMessageText;
        setRuntimeStyle(messageEl, "display", originalMessageStyle);
      };
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onClose);
    });
  }
  showLoader() {
    let loader = document.getElementById("top-bar-loader");
    if (!loader) {
      loader = document.createElement("div");
      loader.id = "top-bar-loader";
      document.body.appendChild(loader);
    }
    loader.className = "loading";
    setRuntimeStyle(loader, "width", "0%");
    loader.offsetWidth;
    setRuntimeStyle(loader, "width", "90%");
  }
  hideLoader() {
    const loader = document.getElementById("top-bar-loader");
    if (loader) {
      loader.className = "finished";
    }
  }
  showToast(arg1, arg2, arg3) {
    let title = "";
    let message = "";
    let type = "info";
    let duration = 4e3;
    const options = typeof arguments[3] === "object" && arguments[3] !== null ? arguments[3] : typeof arg3 === "object" && arg3 !== null ? arg3 : {};
    if (arg3 !== void 0 && (typeof arg3 === "string" || typeof arg3 === "number")) {
      title = arg1;
      message = arg2;
      type = arg3;
      if (typeof arg3 === "number") {
        duration = arg3;
        type = "info";
      }
    } else {
      message = arg1;
      type = arg2 || "info";
      duration = parseInt(arg3) || 4e3;
      if (type === "success") title = "Thành công";
      else if (type === "error") title = "Thất bại";
      else if (type === "warning") title = "Cảnh báo";
      else title = "Thông báo";
    }
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }
    const toastKey = toastDeduplicationKey(title, message, type);
    const duplicateToast = Array.from(container.querySelectorAll(".bf-toast:not(.toast-hiding)")).find(
      (item) => item.dataset.toastKey === toastKey
    );
    if (duplicateToast) return duplicateToast;
    const toast = document.createElement("div");
    toast.className = `bf-toast toast-${type}`;
    toast.dataset.toastKey = toastKey;
    toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
    toast.setAttribute("aria-live", type === "error" || type === "warning" ? "assertive" : "polite");
    const iconSvg = {
      success: '<i data-lucide="check-circle"></i>',
      error: '<i data-lucide="x-circle"></i>',
      warning: '<i data-lucide="alert-triangle"></i>',
      info: '<i data-lucide="info"></i>'
    }[type] || '<i data-lucide="info"></i>';
    const iconWrap = document.createElement("div");
    iconWrap.className = "bf-toast-icon";
    iconWrap.innerHTML = trustedHTML(iconSvg);
    const content = document.createElement("div");
    content.className = "bf-toast-content";
    const titleNode = document.createElement("div");
    titleNode.className = "bf-toast-title";
    titleNode.textContent = title || "";
    const descNode = document.createElement("div");
    descNode.className = "bf-toast-desc";
    descNode.textContent = message || "";
    content.append(titleNode, descNode);
    if (options.actionLabel && typeof options.onAction === "function") {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "bf-toast-action";
      actionButton.textContent = options.actionLabel;
      setRuntimeStyle(actionButton, "cssText", "margin-top: 8px; align-self: flex-start; border: 0; background: transparent; color: var(--primary); font-weight: 700; cursor: pointer; padding: 0;");
      actionButton.addEventListener("click", () => {
        options.onAction();
        dismissToast();
      });
      content.appendChild(actionButton);
    }
    const closeButton = document.createElement("button");
    closeButton.className = "bf-toast-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Dismiss toast");
    closeButton.innerHTML = trustedHTML('<i data-lucide="x"></i>');
    toast.append(iconWrap, content, closeButton);
    container.appendChild(toast);
    if (window.lucide) {
      lucide.createIcons({ root: toast });
    }
    let isHiding = false;
    let autoDismissTimer;
    const dismissToast = () => {
      if (isHiding) return;
      isHiding = true;
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      toast.classList.add("toast-hiding");
      toast.addEventListener("animationend", () => {
        toast.remove();
      });
    };
    const closeBtn = toast.querySelector(".bf-toast-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", dismissToast);
    }
    autoDismissTimer = setTimeout(dismissToast, duration);
    return toast;
  }
  customAlert(title, message, iconName = "info", focusTarget = null) {
    const isSuccess = title === "Thành công" || title && title.toLowerCase().includes("thành công") || title === "Chúc mừng" || title === "Hoàn thành" || iconName === "check-circle";
    if (isSuccess) {
      this.showToast(title || "Thành công", message, "success");
      return new Promise((resolve) => {
        setTimeout(() => resolve(true), 1800);
      });
    }
    if (iconName === "warning") iconName = "alert-triangle";
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-custom-dialog");
      const titleEl = document.getElementById("dialog-title");
      const messageEl = document.getElementById("dialog-message");
      const iconContainer = document.getElementById("dialog-icon-container");
      const iconEl = document.getElementById("dialog-icon");
      const okBtn = document.getElementById("btn-dialog-ok");
      const cancelBtn = document.getElementById("btn-dialog-cancel");
      const closeBtn = document.getElementById("btn-dialog-close");
      const buttonContainer = document.getElementById("dialog-buttons");
      buttonContainer?.classList.add("dialog-buttons-single");
      titleEl.textContent = title;
      const plainMessage = String(message || "").replace(/<br\s*\/?>/gi, "\n");
      if (plainMessage && plainMessage.includes("\n")) {
        setRuntimeStyle(messageEl, "whiteSpace", "pre-wrap");
        setRuntimeStyle(messageEl, "textAlign", "left");
        setRuntimeStyle(messageEl, "fontSize", "0.85rem");
        setRuntimeStyle(messageEl, "maxHeight", "340px");
        setRuntimeStyle(messageEl, "overflowY", "auto");
        messageEl.textContent = plainMessage;
      } else {
        setRuntimeStyle(messageEl, "whiteSpace", "");
        setRuntimeStyle(messageEl, "textAlign", "");
        setRuntimeStyle(messageEl, "fontSize", "");
        setRuntimeStyle(messageEl, "maxHeight", "");
        setRuntimeStyle(messageEl, "overflowY", "");
        messageEl.textContent = plainMessage;
      }
      setRuntimeStyle(cancelBtn, "display", "none");
      if (closeBtn) setRuntimeStyle(closeBtn, "display", "block");
      let elements = [];
      if (focusTarget) {
        const activePane = document.querySelector(".tab-pane.active");
        const root = activePane || document;
        if (typeof focusTarget === "string") {
          elements = Array.from(root.querySelectorAll(focusTarget));
          if (elements.length === 0 && root !== document) elements = Array.from(document.querySelectorAll(focusTarget));
        } else if (focusTarget instanceof HTMLElement) {
          elements = [focusTarget];
        } else if (focusTarget.length !== void 0) {
          Array.from(focusTarget).forEach((item) => {
            if (typeof item === "string") {
              const matches = Array.from(root.querySelectorAll(item));
              elements.push(...(matches.length > 0 || root === document ? matches : document.querySelectorAll(item)));
            } else if (item instanceof HTMLElement) {
              elements.push(item);
            }
          });
        }
      }
      const invalidEls = [];
      elements.forEach((input) => {
        invalidEls.push(input);
        const formGroup = input.closest(".form-group") || input.parentElement;
        if (formGroup) {
          formGroup.classList.add("invalid");
        }
        const clearInvalid = () => {
          const fg = input.closest(".form-group") || input.parentElement;
          if (fg) fg.classList.remove("invalid");
          input.removeEventListener("input", clearInvalid);
          input.removeEventListener("change", clearInvalid);
        };
        input.addEventListener("input", clearInvalid);
        input.addEventListener("change", clearInvalid);
      });
      iconEl.setAttribute("data-lucide", iconName);
      applyDialogTone(modal, iconName);
      if (iconName === "check-circle") {
        setRuntimeStyle(iconContainer, "background", "rgba(16, 185, 129, 0.1)");
        setRuntimeStyle(iconContainer, "color", "var(--success)");
        okBtn.className = "btn btn-primary";
        setRuntimeStyle(okBtn, "background", "");
        setRuntimeStyle(okBtn, "borderColor", "");
      } else if (iconName === "alert-triangle" || iconName === "alert-circle" || iconName === "info" || iconName === "save") {
        setRuntimeStyle(iconContainer, "background", "var(--warning-soft)");
        setRuntimeStyle(iconContainer, "color", "var(--warning)");
        okBtn.className = "btn btn-primary bg-warning";
        setRuntimeStyle(okBtn, "background", "var(--warning)");
        setRuntimeStyle(okBtn, "borderColor", "var(--warning)");
      } else if (iconName === "x-circle" || iconName === "trash-2" || iconName === "user-x" || iconName === "log-out") {
        setRuntimeStyle(iconContainer, "background", "var(--danger-soft)");
        setRuntimeStyle(iconContainer, "color", "var(--danger)");
        okBtn.className = "btn btn-primary bg-danger";
        setRuntimeStyle(okBtn, "background", "var(--danger)");
        setRuntimeStyle(okBtn, "borderColor", "var(--danger)");
      } else {
        setRuntimeStyle(iconContainer, "background", "rgba(59, 130, 246, 0.1)");
        setRuntimeStyle(iconContainer, "color", "var(--primary)");
        okBtn.className = "btn btn-primary";
        setRuntimeStyle(okBtn, "background", "");
        setRuntimeStyle(okBtn, "borderColor", "");
      }
      lucide.createIcons();
      const triggerFocus = () => {
        if (invalidEls.length > 0) {
          focusInvalidControl(invalidEls[0]);
        }
      };
      const onOk = () => {
        cleanup();
        resolve(true);
        triggerFocus();
      };
      const onClose = () => {
        cleanup();
        resolve(null);
        triggerFocus();
      };
      const cleanup = () => {
        okBtn.removeEventListener("click", onOk);
        if (closeBtn) closeBtn.removeEventListener("click", onClose);
        modal.classList.remove("active");
      };
      okBtn.addEventListener("click", onOk);
      if (closeBtn) closeBtn.addEventListener("click", onClose);
      modal.classList.add("active");
    });
  }
  customPrompt(title, message, defaultValue = "", placeholder = "", isDatePicker = false, validateFn = null, inputType = "text") {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-custom-dialog");
      const titleEl = document.getElementById("dialog-title");
      const messageEl = document.getElementById("dialog-message");
      const iconContainer = document.getElementById("dialog-icon-container");
      const iconEl = document.getElementById("dialog-icon");
      const okBtn = document.getElementById("btn-dialog-ok");
      const cancelBtn = document.getElementById("btn-dialog-cancel");
      const closeBtn = document.getElementById("btn-dialog-close");
      const buttonContainer = document.getElementById("dialog-buttons");
      buttonContainer?.classList.remove("dialog-buttons-single");
      titleEl.textContent = title;
      messageEl.textContent = message;
      setRuntimeStyle(cancelBtn, "display", "block");
      if (closeBtn) setRuntimeStyle(closeBtn, "display", "block");
      const inputContainer = document.createElement("div");
      inputContainer.id = "dialog-prompt-container";
      setRuntimeStyle(inputContainer, "marginTop", "8px");
      setRuntimeStyle(inputContainer, "marginBottom", "20px");
      setRuntimeStyle(inputContainer, "textAlign", "left");
      const inputEl = document.createElement("input");
      inputEl.type = inputType;
      inputEl.id = "dialog-prompt-input";
      inputEl.value = defaultValue;
      inputEl.placeholder = placeholder;
      setRuntimeStyle(inputEl, "width", "100%");
      setRuntimeStyle(inputEl, "padding", "10px 14px");
      setRuntimeStyle(inputEl, "border", "1px solid var(--border-color)");
      setRuntimeStyle(inputEl, "borderRadius", "var(--radius-md)");
      setRuntimeStyle(inputEl, "background", "var(--bg-card)");
      setRuntimeStyle(inputEl, "color", "var(--text-main)");
      setRuntimeStyle(inputEl, "fontFamily", "inherit");
      setRuntimeStyle(inputEl, "fontSize", "0.95rem");
      setRuntimeStyle(inputEl, "outline", "none");
      setRuntimeStyle(inputEl, "boxSizing", "border-box");
      inputContainer.appendChild(inputEl);
      messageEl.parentNode.insertBefore(inputContainer, messageEl.nextSibling);
      if (isDatePicker) {
        inputEl.classList.add("flatpickr-datetime");
        inputEl.placeholder = "dd/MM/yyyy HH:mm";
        if (defaultValue) {
          inputEl.value = this.model.formatForDatetimeLocal(defaultValue);
        }
        this.initFlatpickr(inputContainer);
      } else {
        setTimeout(() => inputEl.focus(), 100);
      }
      iconEl.setAttribute("data-lucide", "calendar");
      applyDialogTone(modal, "calendar");
      setRuntimeStyle(iconContainer, "background", "rgba(59, 130, 246, 0.1)");
      setRuntimeStyle(iconContainer, "color", "var(--primary)");
      okBtn.className = "btn btn-primary";
      setRuntimeStyle(okBtn, "background", "");
      setRuntimeStyle(okBtn, "borderColor", "");
      lucide.createIcons();
      const onOk = async () => {
        let val = inputEl.value;
        if (isDatePicker && val) {
          val = this.model.formatForDatetimeLocal(val);
        }
        if (validateFn) {
          const errorMsg = await validateFn(val);
          if (errorMsg) {
            let errEl = document.getElementById("dialog-prompt-error");
            if (!errEl) {
              errEl = document.createElement("div");
              errEl.id = "dialog-prompt-error";
              setRuntimeStyle(errEl, "color", "var(--danger)");
              setRuntimeStyle(errEl, "fontSize", "0.78rem");
              setRuntimeStyle(errEl, "marginTop", "6px");
              setRuntimeStyle(errEl, "fontWeight", "600");
              inputEl.parentNode.appendChild(errEl);
            }
            errEl.textContent = errorMsg;
            setRuntimeStyle(errEl, "display", "block");
            setRuntimeStyle(inputEl, "borderColor", "var(--danger)");
            const clearError = () => {
              setRuntimeStyle(errEl, "display", "none");
              setRuntimeStyle(inputEl, "borderColor", "");
            };
            inputEl.addEventListener("input", clearError, { once: true });
            inputEl.addEventListener("change", clearError, { once: true });
            return;
          }
        }
        cleanup();
        resolve(val);
      };
      const onCancel = () => {
        cleanup();
        resolve(null);
      };
      const onClose = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        if (inputEl._flatpickr) {
          inputEl._flatpickr.destroy();
        }
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onClose);
        modal.classList.remove("active");
        setTimeout(() => {
          const container = document.getElementById("dialog-prompt-container");
          if (container) container.remove();
        }, 300);
      };
      if (!isDatePicker) {
        inputEl.addEventListener("keyup", (e) => {
          if (e.key === "Enter") onOk();
        });
      }
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onClose);
      modal.classList.add("active");
    });
  }
  validateForm(form) {
    return validateConfiguredForm(form).valid;
  }
  getRequiredViewModules(tabName) {
    return VIEW_MODULES_BY_TAB[tabName] || [];
  }
  areViewModulesReady(tabName) {
    return this.getRequiredViewModules(tabName).every((moduleName) => installedViewModules.has(moduleName));
  }
  async ensureViewModules(tabName) {
    const moduleNames = this.getRequiredViewModules(tabName);
    await Promise.all(moduleNames.map((moduleName) => {
      if (installedViewModules.has(moduleName)) return null;
      if (!pendingViewModules.has(moduleName)) {
        const loader = VIEW_MODULE_LOADERS[moduleName];
        if (!loader) return null;
        const pending = loader().then((module) => {
          installPrototypeModules(BiddingView, [{ name: `${moduleName}-view`, module }]);
          installedViewModules.add(moduleName);
        }).finally(() => pendingViewModules.delete(moduleName));
        pendingViewModules.set(moduleName, pending);
      }
      return pendingViewModules.get(moduleName);
    }));
  }
  focusInvalidControl(input, options) {
    return focusInvalidControl(input, options);
  }
  getActiveElement(id) {
    const activePane = document.querySelector(".tab-pane.active");
    if (activePane) {
      const el = activePane.querySelector("#" + id);
      if (el) return el;
    }
    return document.getElementById(id);
  }
  formatCurrencyInput(input) {
    let value = input.value.replace(/[^0-9]/g, "");
    if (value === "") {
      input.value = "";
      return;
    }
    input.value = new Intl.NumberFormat("vi-VN").format(parseInt(value, 10));
  }
  customConflictDialog(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-custom-dialog");
      const titleEl = document.getElementById("dialog-title");
      const messageEl = document.getElementById("dialog-message");
      const iconContainer = document.getElementById("dialog-icon-container");
      const iconEl = document.getElementById("dialog-icon");
      const buttonsContainer = document.getElementById("dialog-buttons");
      const closeBtn = document.getElementById("btn-dialog-close");
      if (!modal || !titleEl || !messageEl || !buttonsContainer) {
        console.error("Conflict modal element not found!");
        return resolve("local");
      }
      titleEl.textContent = title;
      messageEl.textContent = message;
      if (closeBtn) setRuntimeStyle(closeBtn, "display", "none");
      if (iconContainer && iconEl) {
        setRuntimeStyle(iconContainer, "background", "var(--warning-soft)");
        setRuntimeStyle(iconContainer, "color", "var(--warning)");
        iconEl.setAttribute("data-lucide", "alert-circle");
        applyDialogTone(modal, "alert-circle");
        if (window.lucide) window.lucide.createIcons({ root: iconContainer });
      }
      buttonsContainer.innerHTML = trustedHTML(`
                <button type="button" class="btn btn-outline bf-s-f6af272ae6" id="btn-conflict-server">Dùng bản Server</button>
                <button type="button" class="btn btn-outline bf-s-f6af272ae6" id="btn-conflict-local">Dùng bản Local</button>
                <button type="button" class="btn btn-primary bf-s-f6af272ae6" id="btn-conflict-new">Tạo bản mới</button>
            `);
      const cleanUp = (result) => {
        modal.classList.remove("active");
        buttonsContainer.innerHTML = trustedHTML(`
                    <button type="button" class="btn btn-outline bf-s-649f9eeb60" id="btn-dialog-cancel">Hủy</button>
                    <button type="button" class="btn btn-primary bf-s-649f9eeb60" id="btn-dialog-ok">Xác nhận</button>
                `);
        if (closeBtn) setRuntimeStyle(closeBtn, "display", "block");
        resolve(result);
      };
      const btnServer = document.getElementById("btn-conflict-server");
      const btnLocal = document.getElementById("btn-conflict-local");
      const btnNew = document.getElementById("btn-conflict-new");
      if (btnServer) btnServer.onclick = () => cleanUp("server");
      if (btnLocal) btnLocal.onclick = () => cleanUp("local");
      if (btnNew) btnNew.onclick = () => cleanUp("new");
      modal.classList.add("active");
    });
  }
  getStatusBadge(status) {
    return renderPackageStatusBadge(status);
  }
}
installPrototypeModules(BiddingView, [
  { name: "system-user-view", module: SystemUser },
]);
