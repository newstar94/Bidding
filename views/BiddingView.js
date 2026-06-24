/* ==========================================================================
   BiddingFlow - View Orchestrator (DOM, Caching & Sub-view Dispatcher)
   ========================================================================== */

import * as Dashboard from '/views/DashboardView.js?v=6.10';
import * as Plan from '/views/PlanView.js?v=6.10';
import * as Partner from '/views/PartnerView.js?v=6.10';
import * as SystemUser from '/views/SystemUserView.js?v=6.10';

export class BiddingView {
    constructor(model) {
        this.model = model;

        // Flatpickr instances
        this.fpNgayPheDuyet = null;
        this.fpThoiGianDang = null;
        this.fpNgayTrinhDuToan = null;
        this.fpNgayPheDuyetDuToan = null;
        this.fpNgayTrinhKeHoach = null;
        this.fpNgayQdPheDuyetDuAn = null;
        this.fpNgayCapChungChi = null;
        this.fpNgayCapCCCD = null;
        this.fpNgayKy = null;
        this.fpThoiGianBatDauToChuc = null;
        this.fpThoiGianDangTai = null;
        this.fpThoiGianDongThau = null;
        this.fpThoiGianMoThau = null;

        // Cache elements
        this.elements = {};
    }

    initDOM() {
        this.elements = {
            themeToggle: document.getElementById('theme-toggle'),
            sunIcon: document.getElementById('sun-icon'),
            moonIcon: document.getElementById('moon-icon'),
            sidebarToggle: document.getElementById('sidebar-toggle'),
            sidebar: document.getElementById('sidebar'),
            currentDateSpan: document.getElementById('current-date').querySelector('span'),
            pageTitle: document.getElementById('page-title'),
            navButtons: document.querySelectorAll('.nav-btn'),
            tabPanes: document.querySelectorAll('.tab-pane')
        };

        // Automatically observe DOM changes to enhance any rendered tables with sorting
        if (!this._tableObserver) {
            this._tableObserver = new MutationObserver(() => {
                this.enhanceAllTables();
            });
            this._tableObserver.observe(document.body, { childList: true, subtree: true });
        }
        // Run initial enhancement
        setTimeout(() => this.enhanceAllTables(), 100);
    }

    enhanceAllTables() {
        if (this._tableObserver) {
            this._tableObserver.disconnect();
        }

        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
            this.enhanceTableHeaders(table);
        });

        if (this._tableObserver) {
            this._tableObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    enhanceTableHeaders(tableOrId, tableKey) {
        let table = typeof tableOrId === 'string' ? document.getElementById(tableOrId) : tableOrId;
        if (!table) return;

        const svgUnsorted = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevrons-up-down" style="display: block;"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>`;
        const svgAsc = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-up" style="display: block;"><path d="m18 15-6-6-6 6"/></svg>`;
        const svgDesc = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" style="display: block;"><path d="m6 9 6 6 6-6"/></svg>`;

        // If tableKey is not provided but the table has one of the known IDs, map it
        if (!tableKey && table.id) {
            const idMap = {
                'kehoach-table': 'kehoach',
                'goithau-table': 'goithau',
                'chudautu-table': 'chudautu',
                'nhathau-table': 'nhathau',
                'chuyengia-table': 'chuyengia',
                'hopdong-table': 'hopdong'
            };
            tableKey = idMap[table.id];
        }

        const normalize = (str) => {
            if (!str) return '';
            return str.toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]/g, "")
                .trim();
        };

        const sortFieldMap = {
            'kehoach': {
                'makehoach': 'maKeHoach',
                'phienban': 'phienBan',
                'tenkehoachluachonnhathau': 'tenKeHoach',
                'phanloai': 'loaiHinhMuaSam',
                'duandutoan': 'tenDuAnDuToan',
                'chudautu': 'chuDauTuId',
                'tonggiatri': 'tongMucDauTu',
                'ngaypheduyet': 'ngayPheDuyet',
                'soqd': 'quyetDinhPheDuyet',
                'thoigiandangma': 'thoiGianDangMa'
            },
            'goithau': {
                'magoi': 'maGoiThau',
                'magoithau': 'maGoiThau',
                'phienban': 'phienBan',
                'tengoithau': 'tenGoiThau',
                'kehoachlienket': 'keHoachId',
                'giagoithau': 'giaGoiThau',
                'hinhthuc': 'hinhThucLuaChon',
                'hinhthuclcnt': 'hinhThucLuaChon',
                'trangthai': 'trangThai',
                'nhathautrungthau': 'nhaThauTrungThauId'
            },
            'chudautu': {
                'macdt': 'maChuDauTu',
                'machudautu': 'maChuDauTu',
                'phienban': 'phienBan',
                'tenchudautu': 'tenChuDauTu',
                'masothue': 'maSoThue',
                'daidien': 'nguoiKyQuyetDinh',
                'diachisdt': 'diaChi',
                'sotaikhoan': 'soTaiKhoan'
            },
            'nhathau': {
                'manhathau': 'maNhaThau',
                'phienban': 'phienBan',
                'tennhathau': 'tenNhaThau',
                'masothue': 'maSoThue',
                'nguoidaidien': 'nguoiDaiDien',
                'lienhe': 'soDienThoai',
                'taikhoannganhang': 'soTaiKhoan'
            },
            'chuyengia': {
                'hovatenchuyengia': 'hoTen',
                'hotenchuyengia': 'hoTen',
                'phienban': 'phienBan',
                'socancuoccongdan': 'soCCCD',
                'sochungchidauthau': 'soChungChi',
                'donvicapchungchi': 'donViCapChungChi',
                'ngaycapchungchi': 'ngayCapChungChi',
                'ngaycapcccd': 'ngayCapCCCD'
            },
            'hopdong': {
                'sohopdong': 'soHopDong',
                'phienban': 'phienBan',
                'tenhopdong': 'tenHopDong',
                'ngayky': 'ngayKy',
                'chudautu': 'chuDauTuId',
                'nhathau': 'nhaThauId',
                'giatrihopdong': 'giaTri',
                'loaihopdong': 'loaiHopDong',
                'thoigianthuchien': 'soNgayThucHien',
                'goithaulienket': 'goiThauId',
                'trangthaihoso': 'trangThaiHoSo'
            }
        };

        const ths = table.querySelectorAll('thead th');
        const mapping = tableKey ? sortFieldMap[tableKey] : null;

        ths.forEach((th, colIndex) => {
            const rawText = th.textContent.replace(/[↕▲▼]/g, '').trim();
            const normText = normalize(rawText);

            // Skip action/operation columns
            if (!normText || ['thaotac', 'hanhdong', 'chucnang', 'chon', 'tuychon'].includes(normText)) {
                return;
            }

            const field = mapping ? mapping[normText] : null;

            let container = th.querySelector('.sort-header-container');
            if (!container) {
                th.style.cursor = 'pointer';
                th.style.userSelect = 'none';

                const thText = th.innerHTML;
                th.innerHTML = `
                    <div class="sort-header-container">
                        <span class="th-label" style="flex-grow: 1; text-align: inherit;">${thText}</span>
                        <span class="sort-icon-btn">
                            ${svgUnsorted}
                        </span>
                    </div>
                `;

                th.addEventListener('click', (e) => {
                    if (e.target.closest('select') || e.target.closest('input') || e.target.closest('button') || e.target.closest('a')) return;

                    if (tableKey && field) {
                        // Backend paginated sorting
                        window.toggleSortTable(tableKey, field);
                    } else {
                        // Client-side sorting for other tables/columns
                        const currentOrder = th.getAttribute('data-sort-order') === 'asc' ? 'desc' : 'asc';

                        // Reset all other headers in this table
                        ths.forEach(otherTh => {
                            if (otherTh !== th) {
                                otherTh.removeAttribute('data-sort-order');
                                const otherIcon = otherTh.querySelector('.sort-icon-btn');
                                if (otherIcon) {
                                    otherIcon.innerHTML = svgUnsorted;
                                    otherIcon.classList.remove('active');
                                    otherIcon.style.opacity = '';
                                    otherIcon.style.color = '';
                                    otherIcon.style.fontWeight = '';
                                }
                            }
                        });

                        th.setAttribute('data-sort-order', currentOrder);
                        const iconBtn = th.querySelector('.sort-icon-btn');
                        if (iconBtn) {
                            iconBtn.innerHTML = currentOrder === 'asc' ? svgAsc : svgDesc;
                            iconBtn.classList.add('active');
                            iconBtn.style.opacity = '';
                            iconBtn.style.color = '';
                            iconBtn.style.fontWeight = '';
                        }

                        // Do client-side sort
                        const tbody = table.querySelector('tbody');
                        if (tbody) {
                            const rows = Array.from(tbody.querySelectorAll('tr'));
                            const getCellValue = (row) => {
                                const cell = row.children[colIndex];
                                if (!cell) return '';
                                const input = cell.querySelector('input, select');
                                if (input) return input.value.trim();
                                return cell.textContent.trim();
                            };

                            const parseValue = (val) => {
                                const cleanNum = val.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
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
                                if (typeof valA === 'number' && typeof valB === 'number') {
                                    return currentOrder === 'asc' ? valA - valB : valB - valA;
                                }
                                return currentOrder === 'asc'
                                    ? String(valA).localeCompare(String(valB), 'vi')
                                    : String(valB).localeCompare(String(valA), 'vi');
                            });

                            rows.forEach(row => tbody.appendChild(row));
                        }
                    }
                });
            }

            // Keep the visual state in sync for backend-sorted columns
            if (tableKey && field) {
                const currentSort = this.model.sortState[tableKey] || {};
                const iconBtn = th.querySelector('.sort-icon-btn');
                if (iconBtn) {
                    if (currentSort.field === field) {
                        iconBtn.innerHTML = currentSort.order === 'asc' ? svgAsc : svgDesc;
                        iconBtn.classList.add('active');
                        iconBtn.style.opacity = '';
                        iconBtn.style.color = '';
                        iconBtn.style.fontWeight = '';
                    } else {
                        iconBtn.innerHTML = svgUnsorted;
                        iconBtn.classList.remove('active');
                        iconBtn.style.opacity = '';
                        iconBtn.style.color = '';
                        iconBtn.style.fontWeight = '';
                    }
                }
            }
        });
    }

    setupFlatpickr() {
        if (typeof flatpickr !== 'undefined') {
            const fpCommon = {
                onReady: (selectedDates, dateStr, fp) => {
                    this._fpOnReady(selectedDates, dateStr, fp, false);
                    setTimeout(() => {
                        if (typeof fp._positionCalendar === 'function') fp._positionCalendar();
                    }, 0);
                },
                onMonthChange: (selectedDates, dateStr, fp) => {
                    this._fpOnMonthChange(selectedDates, dateStr, fp);
                    setTimeout(() => {
                        if (typeof fp._positionCalendar === 'function') fp._positionCalendar();
                    }, 0);
                },
                onYearChange: (selectedDates, dateStr, fp) => {
                    this._fpOnMonthChange(selectedDates, dateStr, fp);
                    setTimeout(() => {
                        if (typeof fp._positionCalendar === 'function') fp._positionCalendar();
                    }, 0);
                },
                onChange: (selectedDates, dateStr, fp) => {
                    this._fpOnChange(selectedDates, dateStr, fp);
                }
            };

            this.fpNgayPheDuyet = flatpickr("#kh-ngaypheduyet", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpThoiGianDang = flatpickr("#kh-thoigiandang", {
                locale: "vn", enableTime: true, enableSeconds: false,
                time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                position: "auto",
                ...fpCommon
            });
            this.fpNgayTrinhDuToan = flatpickr("#kh-ngaytrinhdutoan", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpNgayPheDuyetDuToan = flatpickr("#kh-ngaypheduyetdutoan", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpNgayTrinhKeHoach = flatpickr("#kh-ngaytrinhkehoach", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpNgayQdPheDuyetDuAn = flatpickr("#kh-ngayqdpheduyetduan", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpNgayQuyetDinh = flatpickr("#gt-ngayquyetdinh", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpThoiGianDangTai = flatpickr("#gt-thoigiandangtai", {
                locale: "vn", enableTime: true, enableSeconds: false,
                time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                position: "auto",
                ...fpCommon
            });
            this.fpNgayCapChungChi = flatpickr("#cg-ngaycapchungchi", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpNgayCapCCCD = flatpickr("#cg-ngaycapcccd", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpNgayKy = flatpickr("#hd-ngayky", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpThoiGianDongThau = flatpickr("#gt-thoigiandongthau", {
                locale: "vn", enableTime: true, enableSeconds: false,
                time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                position: "auto",
                ...fpCommon
            });
            this.fpThoiGianMoThau = flatpickr("#gt-thoigianmothau", {
                locale: "vn", enableTime: true, enableSeconds: false,
                time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                position: "auto",
                ...fpCommon
            });
            this.fpSuStartDate = flatpickr("#detail-su-startdate", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpSuEndDate = flatpickr("#detail-su-enddate", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });

            this.fpPhathanhNgayQuyetDinh = flatpickr("#phathanh-ngayquyetdinh", {
                locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto", ...fpCommon
            });
            this.fpPhathanhThoiGianDangTai = flatpickr("#phathanh-thoigiandangtai", {
                locale: "vn", enableTime: true, enableSeconds: false,
                time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                position: "auto",
                ...fpCommon
            });
            this.fpPhathanhThoiGianDongThau = flatpickr("#phathanh-thoigiandongthau", {
                locale: "vn", enableTime: true, enableSeconds: false,
                time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                position: "auto",
                ...fpCommon
            });
        }
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }

    customConfirm(title, message, iconName = 'help-circle') {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-custom-dialog');
            const titleEl = document.getElementById('dialog-title');
            const messageEl = document.getElementById('dialog-message');
            const iconContainer = document.getElementById('dialog-icon-container');
            const iconEl = document.getElementById('dialog-icon');
            const okBtn = document.getElementById('btn-dialog-ok');
            const cancelBtn = document.getElementById('btn-dialog-cancel');
            const closeBtn = document.getElementById('btn-dialog-close');

            titleEl.textContent = title;
            messageEl.textContent = message;
            cancelBtn.style.display = 'block';
            if (closeBtn) closeBtn.style.display = 'block';

            // Set icon and colors based on iconName
            iconEl.setAttribute('data-lucide', iconName);
            if (iconName === 'trash-2' || iconName === 'user-x' || iconName === 'log-out') {
                iconContainer.style.background = 'var(--danger-soft)';
                iconContainer.style.color = 'var(--danger)';
                okBtn.className = 'btn btn-primary bg-danger';
                okBtn.style.background = 'var(--danger)';
                okBtn.style.borderColor = 'var(--danger)';
            } else if (iconName === 'alert-triangle' || iconName === 'alert-circle' || iconName === 'info' || iconName === 'help-circle' || iconName === 'save') {
                iconContainer.style.background = 'var(--warning-soft)';
                iconContainer.style.color = 'var(--warning)';
                okBtn.className = 'btn btn-primary bg-warning';
                okBtn.style.background = 'var(--warning)';
                okBtn.style.borderColor = 'var(--warning)';
            } else {
                iconContainer.style.background = 'rgba(59, 130, 246, 0.1)';
                iconContainer.style.color = 'var(--primary)';
                okBtn.className = 'btn btn-primary';
                okBtn.style.background = '';
                okBtn.style.borderColor = '';
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
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                if (closeBtn) closeBtn.removeEventListener('click', onClose);
                modal.classList.remove('active');
            };

            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            if (closeBtn) closeBtn.addEventListener('click', onClose);

            modal.classList.add('active');
        });
    }

    customAlert(title, message, iconName = 'info', focusTarget = null) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-custom-dialog');
            const titleEl = document.getElementById('dialog-title');
            const messageEl = document.getElementById('dialog-message');
            const iconContainer = document.getElementById('dialog-icon-container');
            const iconEl = document.getElementById('dialog-icon');
            const okBtn = document.getElementById('btn-dialog-ok');
            const cancelBtn = document.getElementById('btn-dialog-cancel');
            const closeBtn = document.getElementById('btn-dialog-close');

            titleEl.textContent = title;
            messageEl.textContent = message;
            cancelBtn.style.display = 'none';
            if (closeBtn) closeBtn.style.display = 'block';

            // Resolve focusTarget elements and mark them invalid
            let elements = [];
            if (focusTarget) {
                const activePane = document.querySelector('.tab-pane.active');
                const root = activePane || document;
                if (typeof focusTarget === 'string') {
                    elements = Array.from(root.querySelectorAll(focusTarget));
                } else if (focusTarget instanceof HTMLElement) {
                    elements = [focusTarget];
                } else if (focusTarget.length !== undefined) {
                    Array.from(focusTarget).forEach(item => {
                        if (typeof item === 'string') {
                            elements.push(...root.querySelectorAll(item));
                        } else if (item instanceof HTMLElement) {
                            elements.push(item);
                        }
                    });
                }
            }

            const invalidEls = [];
            elements.forEach(input => {
                invalidEls.push(input);
                const formGroup = input.closest('.form-group') || input.parentElement;
                if (formGroup) {
                    formGroup.classList.add('invalid');
                }

                const clearInvalid = () => {
                    const fg = input.closest('.form-group') || input.parentElement;
                    if (fg) fg.classList.remove('invalid');
                    input.removeEventListener('input', clearInvalid);
                    input.removeEventListener('change', clearInvalid);
                };
                input.addEventListener('input', clearInvalid);
                input.addEventListener('change', clearInvalid);
            });

            // Set icon and colors
            iconEl.setAttribute('data-lucide', iconName);
            if (iconName === 'check-circle') {
                iconContainer.style.background = 'rgba(16, 185, 129, 0.1)';
                iconContainer.style.color = 'var(--success)';
                okBtn.className = 'btn btn-primary';
                okBtn.style.background = '';
                okBtn.style.borderColor = '';
            } else if (iconName === 'alert-triangle' || iconName === 'alert-circle' || iconName === 'info' || iconName === 'save') {
                iconContainer.style.background = 'var(--warning-soft)';
                iconContainer.style.color = 'var(--warning)';
                okBtn.className = 'btn btn-primary bg-warning';
                okBtn.style.background = 'var(--warning)';
                okBtn.style.borderColor = 'var(--warning)';
            } else if (iconName === 'x-circle' || iconName === 'trash-2' || iconName === 'user-x' || iconName === 'log-out') {
                iconContainer.style.background = 'var(--danger-soft)';
                iconContainer.style.color = 'var(--danger)';
                okBtn.className = 'btn btn-primary bg-danger';
                okBtn.style.background = 'var(--danger)';
                okBtn.style.borderColor = 'var(--danger)';
            } else {
                iconContainer.style.background = 'rgba(59, 130, 246, 0.1)';
                iconContainer.style.color = 'var(--primary)';
                okBtn.className = 'btn btn-primary';
                okBtn.style.background = '';
                okBtn.style.borderColor = '';
            }

            lucide.createIcons();

            const triggerFocus = () => {
                if (invalidEls.length > 0) {
                    const firstInvalid = invalidEls[0];
                    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                    setTimeout(() => {
                        firstInvalid.focus({ preventScroll: true });
                    }, 300);
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
                okBtn.removeEventListener('click', onOk);
                if (closeBtn) closeBtn.removeEventListener('click', onClose);
                modal.classList.remove('active');
            };

            okBtn.addEventListener('click', onOk);
            if (closeBtn) closeBtn.addEventListener('click', onClose);

            modal.classList.add('active');
        });
    }

    customPrompt(title, message, defaultValue = '', placeholder = '', isDatePicker = false) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-custom-dialog');
            const titleEl = document.getElementById('dialog-title');
            const messageEl = document.getElementById('dialog-message');
            const iconContainer = document.getElementById('dialog-icon-container');
            const iconEl = document.getElementById('dialog-icon');
            const okBtn = document.getElementById('btn-dialog-ok');
            const cancelBtn = document.getElementById('btn-dialog-cancel');
            const closeBtn = document.getElementById('btn-dialog-close');

            titleEl.textContent = title;
            messageEl.textContent = message;
            cancelBtn.style.display = 'block';
            if (closeBtn) closeBtn.style.display = 'block';

            // Tạo container động
            const inputContainer = document.createElement('div');
            inputContainer.id = 'dialog-prompt-container';
            inputContainer.style.marginTop = '16px';
            inputContainer.style.textAlign = 'left';

            const inputEl = document.createElement('input');
            inputEl.type = 'text';
            inputEl.id = 'dialog-prompt-input';
            inputEl.value = defaultValue;
            inputEl.placeholder = placeholder;
            inputEl.style.width = '100%';
            inputEl.style.padding = '10px 14px';
            inputEl.style.border = '1px solid var(--border-color)';
            inputEl.style.borderRadius = 'var(--radius-md)';
            inputEl.style.background = 'var(--bg-card)';
            inputEl.style.color = 'var(--text-main)';
            inputEl.style.fontFamily = 'inherit';
            inputEl.style.fontSize = '0.95rem';
            inputEl.style.outline = 'none';
            inputEl.style.boxSizing = 'border-box';

            inputContainer.appendChild(inputEl);
            messageEl.parentNode.insertBefore(inputContainer, messageEl.nextSibling);

            let fpInstance = null;
            if (isDatePicker && typeof flatpickr !== 'undefined') {
                // Ẩn input text — chỉ dùng làm giá trị trung gian
                inputEl.style.display = 'none';

                // Tạo vùng chứa inline calendar ngay bên dưới
                const calendarWrapper = document.createElement('div');
                calendarWrapper.id = 'dialog-fp-inline-wrapper';
                calendarWrapper.style.cssText = 'margin-top: 8px; display: flex; justify-content: center;';
                inputContainer.appendChild(calendarWrapper);

                // Tạo một input ẩn để flatpickr bám vào (dùng appendTo để render vào wrapper)
                const hiddenAnchor = document.createElement('input');
                hiddenAnchor.type = 'text';
                hiddenAnchor.style.display = 'none';
                calendarWrapper.appendChild(hiddenAnchor);

                fpInstance = flatpickr(hiddenAnchor, {
                    locale: "vn",
                    enableTime: true,
                    enableSeconds: false,
                    time_24hr: true,
                    dateFormat: "d/m/Y H:i",
                    inline: true,
                    appendTo: calendarWrapper,
                    onReady: (selectedDates, dateStr, fp) => {
                        this._fpOnReady(selectedDates, dateStr, fp, true);
                    },
                    onMonthChange: (selectedDates, dateStr, fp) => {
                        this._fpOnMonthChange(selectedDates, dateStr, fp);
                    },
                    onYearChange: (selectedDates, dateStr, fp) => {
                        this._fpOnMonthChange(selectedDates, dateStr, fp);
                    },
                    onChange: (selectedDates, dateStr, fp) => {
                        this._fpOnChange(selectedDates, dateStr, fp);
                        // Ghi giá trị vào inputEl ẩn để onOk lấy được
                        inputEl.value = dateStr;
                    }
                });
            } else {
                // Tự động focus nếu không phải date picker
                setTimeout(() => inputEl.focus(), 100);
            }

            // Set icon and colors
            iconEl.setAttribute('data-lucide', 'calendar');
            iconContainer.style.background = 'rgba(59, 130, 246, 0.1)';
            iconContainer.style.color = 'var(--primary)';
            okBtn.className = 'btn btn-primary';
            okBtn.style.background = '';
            okBtn.style.borderColor = '';

            lucide.createIcons();

            const onOk = () => {
                const val = inputEl.value;
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
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                if (closeBtn) closeBtn.removeEventListener('click', onClose);

                if (fpInstance) {
                    fpInstance.destroy();
                    fpInstance = null;
                }

                const container = document.getElementById('dialog-prompt-container');
                if (container) container.remove();

                modal.classList.remove('active');
            };

            if (!isDatePicker) {
                inputEl.addEventListener('keyup', (e) => {
                    if (e.key === 'Enter') onOk();
                });
            }

            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
            if (closeBtn) closeBtn.addEventListener('click', onClose);

            modal.classList.add('active');
        });
    }

    // --- Flatpickr shared hooks (used by both init and customPrompt) ---
    _fpOnReady(selectedDates, dateStr, fp, skipOkBtn = false) {
        const cal = fp.calendarContainer;
        if (!cal) return;

        // Header
        if (!cal.querySelector('.fp-date-header')) {
            const hdr = document.createElement('div');
            hdr.className = 'fp-date-header';
            hdr.innerHTML = '<span class="fp-date-label">Chọn ngày</span><span class="fp-date-value">—</span>';
            cal.insertBefore(hdr, cal.firstChild);
        }
        this._fpUpdateHeader(selectedDates, fp);
        this._fpAddYearDropdown(fp);
        this._fpTrimExtraWeek(fp);

        if (!skipOkBtn) {
            this._fpAddOkButton(fp);
        }
    }

    _fpOnMonthChange(selectedDates, dateStr, fp) {
        this._fpSyncYearDropdown(fp);
        this._fpTrimExtraWeek(fp);
    }

    _fpOnChange(selectedDates, dateStr, fp) {
        this._fpUpdateHeader(selectedDates, fp);
    }

    _fpUpdateHeader(selectedDates, fp) {
        const VN_DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        const VN_MON = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
        const val = fp.calendarContainer && fp.calendarContainer.querySelector('.fp-date-value');
        if (!val) return;
        if (selectedDates && selectedDates.length > 0) {
            const d = selectedDates[0];
            val.textContent = `${VN_DOW[d.getDay()]}, ${d.getDate()} ${VN_MON[d.getMonth()]} ${d.getFullYear()}`;
        } else {
            val.textContent = '—';
        }
    }

    _fpTrimExtraWeek(fp) {
        const cal = fp.calendarContainer;
        if (!cal) return;
        const allDays = Array.from(cal.querySelectorAll('.flatpickr-day'));
        for (let row = allDays.length - 7; row >= 0; row -= 7) {
            const rowDays = allDays.slice(row, row + 7);
            if (rowDays[0] && rowDays[0].classList.contains('nextMonthDay')) {
                rowDays.forEach(d => {
                    d.style.cssText = 'display:none!important;height:0!important;min-width:0!important;max-width:0!important;margin:0!important;padding:0!important;line-height:0!important;overflow:hidden!important;';
                });
            } else { break; }
        }
    }

    _fpAddYearDropdown(fp) {
        const cal = fp.calendarContainer;
        if (!cal || cal.querySelector('.fp-year-custom-dropdown')) return;
        const wrapper = cal.querySelector('.numInputWrapper');
        if (!wrapper) return;

        const baseYear = new Date().getFullYear();
        const curYear = fp.currentYear;

        const dropdown = document.createElement('div');
        dropdown.className = 'fp-year-custom-dropdown';
        dropdown.addEventListener('mousedown', e => e.stopPropagation());
        dropdown.addEventListener('click', e => e.stopPropagation());

        const trigger = document.createElement('div');
        trigger.className = 'fp-year-trigger';
        trigger.textContent = curYear;

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'fp-year-options';

        for (let y = baseYear - 20; y <= baseYear + 30; y++) {
            const opt = document.createElement('div');
            opt.className = 'fp-year-option' + (y === curYear ? ' selected' : '');
            opt.textContent = y;
            opt.setAttribute('data-value', y);
            opt.addEventListener('mousedown', e => e.stopPropagation());
            opt.addEventListener('click', e => {
                e.stopPropagation();
                fp.changeYear(y);
                optionsContainer.classList.remove('show');
            });
            optionsContainer.appendChild(opt);
        }

        trigger.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.fp-year-options').forEach(el => {
                if (el !== optionsContainer) el.classList.remove('show');
            });
            optionsContainer.classList.toggle('show');
            if (optionsContainer.classList.contains('show')) {
                const selOpt = optionsContainer.querySelector('.fp-year-option.selected');
                if (selOpt) {
                    optionsContainer.scrollTop = selOpt.offsetTop - (optionsContainer.clientHeight / 2) + (selOpt.clientHeight / 2);
                }
            }
        });

        const closeHandler = () => optionsContainer.classList.remove('show');
        document.addEventListener('click', closeHandler);
        if (!fp.config.onDestroy) fp.config.onDestroy = [];
        if (Array.isArray(fp.config.onDestroy)) {
            fp.config.onDestroy.push(() => document.removeEventListener('click', closeHandler));
        }

        dropdown.appendChild(trigger);
        dropdown.appendChild(optionsContainer);
        wrapper.style.display = 'none';
        wrapper.after(dropdown);
    }

    _fpSyncYearDropdown(fp) {
        const cal = fp.calendarContainer;
        if (!cal) return;
        const trigger = cal.querySelector('.fp-year-trigger');
        if (trigger) trigger.textContent = fp.currentYear;
        const optionsContainer = cal.querySelector('.fp-year-options');
        if (optionsContainer) {
            optionsContainer.querySelectorAll('.fp-year-option').forEach(opt => {
                opt.classList.toggle('selected', parseInt(opt.getAttribute('data-value')) === fp.currentYear);
            });
        }
    }

    _fpAddOkButton(fp) {
        const cal = fp.calendarContainer;
        if (!cal) return;
        const timeContainer = cal.querySelector('.flatpickr-time');
        if (!timeContainer || timeContainer.querySelector('.fp-ok-btn')) return;
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'fp-ok-btn';
        okBtn.textContent = 'OK';
        okBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fp.close();
        });
        timeContainer.appendChild(okBtn);
    }

    validateForm(form) {
        let isValid = true;
        const requiredInputs = form.querySelectorAll('[required]');
        const invalidInputs = [];

        requiredInputs.forEach(input => {
            const formGroup = input.closest('.form-group');
            if (formGroup && formGroup.offsetWidth === 0 && formGroup.offsetHeight === 0) {
                return;
            }
            if (!formGroup && input.offsetWidth === 0 && input.offsetHeight === 0 && input.type !== 'hidden') {
                return;
            }

            let inputValid = true;

            if (input.value.trim() === '') {
                inputValid = false;
            } else if (input.type === 'number') {
                const val = parseFloat(input.value);
                const min = input.getAttribute('min') ? parseFloat(input.getAttribute('min')) : -Infinity;
                if (isNaN(val) || val < min) {
                    inputValid = false;
                }
            } else if (input.type === 'email') {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(input.value.trim())) {
                    inputValid = false;
                }
            }

            if (formGroup) {
                if (!inputValid) {
                    formGroup.classList.add('invalid');
                    invalidInputs.push(input);
                    isValid = false;
                } else {
                    formGroup.classList.remove('invalid');
                }

                const handler = () => {
                    if (input.value.trim() !== '') {
                        formGroup.classList.remove('invalid');
                        input.removeEventListener('input', handler);
                        input.removeEventListener('change', handler);
                    }
                };
                input.addEventListener('input', handler);
                input.addEventListener('change', handler);
            }
        });

        if (!isValid) {
            if (invalidInputs.length > 0) {
                const firstInvalid = invalidInputs[0];
                firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                setTimeout(() => {
                    if (firstInvalid.tagName === 'SELECT' && firstInvalid.style.display === 'none') {
                        const wrapper = firstInvalid.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${firstInvalid.id}"]`);
                        const customInput = wrapper ? wrapper.querySelector('.custom-select-search') : null;
                        if (customInput) {
                            customInput.focus({ preventScroll: true });
                            return;
                        }
                    }
                    firstInvalid.focus({ preventScroll: true });
                }, 300);
            }
        }

        return isValid;
    }

    getActiveElement(id) {
        const activePane = document.querySelector('.tab-pane.active');
        if (activePane) {
            const el = activePane.querySelector('#' + id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    formatCurrencyInput(input) {
        let value = input.value.replace(/[^0-9]/g, '');
        if (value === '') {
            input.value = '';
            return;
        }
        input.value = new Intl.NumberFormat('vi-VN').format(parseInt(value, 10));
    }

    customConflictDialog(title, message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-custom-dialog');
            const titleEl = document.getElementById('dialog-title');
            const messageEl = document.getElementById('dialog-message');
            const iconContainer = document.getElementById('dialog-icon-container');
            const iconEl = document.getElementById('dialog-icon');
            const buttonsContainer = document.getElementById('dialog-buttons');
            const closeBtn = document.getElementById('btn-dialog-close');

            if (!modal || !titleEl || !messageEl || !buttonsContainer) {
                console.error("Conflict modal element not found!");
                return resolve('local');
            }

            titleEl.textContent = title;
            messageEl.textContent = message;
            if (closeBtn) closeBtn.style.display = 'none';

            if (iconContainer && iconEl) {
                iconContainer.style.background = 'var(--warning-soft)';
                iconContainer.style.color = 'var(--warning)';
                iconEl.setAttribute('data-lucide', 'alert-circle');
                if (window.lucide) window.lucide.createIcons({ root: iconContainer });
            }

            buttonsContainer.innerHTML = `
                <button type="button" class="btn btn-outline" id="btn-conflict-server" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Dùng bản Server</button>
                <button type="button" class="btn btn-outline" id="btn-conflict-local" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Dùng bản Local</button>
                <button type="button" class="btn btn-primary" id="btn-conflict-new" style="flex: 1; font-size: 0.8rem; padding: 6px 8px;">Tạo bản mới</button>
            `;

            const cleanUp = (result) => {
                modal.classList.remove('active');
                buttonsContainer.innerHTML = `
                    <button type="button" class="btn btn-outline" id="btn-dialog-cancel" style="flex: 1;">Hủy</button>
                    <button type="button" class="btn btn-primary" id="btn-dialog-ok" style="flex: 1;">Xác nhận</button>
                `;
                if (closeBtn) closeBtn.style.display = 'block';
                resolve(result);
            };

            const btnServer = document.getElementById('btn-conflict-server');
            const btnLocal = document.getElementById('btn-conflict-local');
            const btnNew = document.getElementById('btn-conflict-new');

            if (btnServer) btnServer.onclick = () => cleanUp('server');
            if (btnLocal) btnLocal.onclick = () => cleanUp('local');
            if (btnNew) btnNew.onclick = () => cleanUp('new');

            modal.classList.add('active');
        });
    }

    getStatusBadge(status) {
        const maps = {
            'Chuẩn bị': '<span class="badge badge-neutral"><i data-lucide="circle-dot"></i> Chuẩn bị</span>',
            'Đang mời thầu': '<span class="badge badge-info"><i data-lucide="megaphone"></i> Đang mời thầu</span>',
            'Đã mở thầu': '<span class="badge" style="background-color: #f59e0b; color: white;"><i data-lucide="folder-open"></i> Đã mở thầu</span>',
            'Đang chấm thầu': '<span class="badge badge-warning"><i data-lucide="award"></i> Đang chấm thầu</span>',
            'Đã có kết quả': '<span class="badge badge-success"><i data-lucide="check-circle"></i> Đã có kết quả</span>',
            'Hủy thầu': '<span class="badge badge-danger"><i data-lucide="x-circle"></i> Hủy thầu</span>'
        };
        return maps[status] || `<span class="badge">${status}</span>`;
    }
}

// Attach all sub-view prototype extensions
Object.assign(BiddingView.prototype, {
    ...Dashboard,
    ...Plan,
    ...Partner,
    ...SystemUser
});
