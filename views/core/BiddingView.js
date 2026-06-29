/* ==========================================================================
   BiddingFlow - View Orchestrator (DOM, Caching & Sub-view Dispatcher)
   ========================================================================== */

import * as Dashboard from '/views/subviews/DashboardView.js';
import * as Plan from '/views/subviews/PlanView.js';
import * as Partner from '/views/subviews/PartnerView.js';
import * as SystemUser from '/views/subviews/SystemUserView.js';
import { initCustomSelect, syncCustomSelectDisabled } from '../subviews/view_helpers.js';

// Expose helpers globally so other files can access them without ESM import issues
window.initCustomSelect = initCustomSelect;
window.syncCustomSelectDisabled = syncCustomSelectDisabled;

export class BiddingView {
    constructor(model) {
        this.model = model;

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

        // Auto-upgrade all eligible native selects in the DOM to the custom style
        this.upgradeAllSelects();


        if (this._tableObserver) {
            this._tableObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    upgradeAllSelects() {
        // Garbage collection for any orphaned/hidden custom dropdowns currently on body
        document.querySelectorAll('body > .custom-select-dropdown').forEach(dropdown => {
            const targetId = dropdown.getAttribute('data-target');
            const selectEl = document.getElementById(targetId);
            const wrapperEl = document.querySelector(`.custom-select-container[data-target="${targetId}"]`);
            if (!selectEl || !wrapperEl || (wrapperEl.offsetWidth === 0 && wrapperEl.offsetHeight === 0)) {
                dropdown.remove();
            }
        });

        document.querySelectorAll('select').forEach(select => {
            // Exclude version selects, elements marked as no-custom, or those with a custom-select-wrapper sibling (searchable selects)
            const hasNoCustomAttr = select.getAttribute('data-no-custom') === 'true';
            const hasSearchableWrapper = select.id && select.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]`);
            
            if (select.classList.contains('version-select') || 
                select.classList.contains('phienban-select') || 
                select.classList.contains('modal-version-select') ||
                hasNoCustomAttr ||
                hasSearchableWrapper) {
                
                // If a custom-select-container was created for it by mistake, remove it
                if (select.id) {
                    const existingContainer = select.parentNode.querySelector(`.custom-select-container[data-target="${select.id}"]`);
                    if (existingContainer) {
                        existingContainer.remove();
                        // Restore display if it was hidden by mistake (but searchable select hides it anyway)
                        if (!hasSearchableWrapper) {
                            select.style.display = '';
                        }
                    }
                }
                return;
            }

            // Ensure the select has a unique ID for targeting
            if (!select.id) {
                select.id = 'select-' + Math.random().toString(36).substring(2, 9);
            }

            initCustomSelect(select.id);
        });
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
        if (iconName === 'warning') iconName = 'alert-triangle';
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

    customVersionDeleteChoice(title, message, option1Text = 'Xóa phiên bản gần nhất', option2Text = 'Xóa toàn bộ các phiên bản') {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-custom-dialog');
            const titleEl = document.getElementById('dialog-title');
            const messageEl = document.getElementById('dialog-message');
            const iconContainer = document.getElementById('dialog-icon-container');
            const iconEl = document.getElementById('dialog-icon');
            const buttonContainer = document.getElementById('dialog-buttons');
            const closeBtn = document.getElementById('btn-dialog-close');

            titleEl.textContent = title;
            messageEl.textContent = message;
            if (closeBtn) closeBtn.style.display = 'block';

            iconEl.setAttribute('data-lucide', 'trash-2');
            iconContainer.style.background = 'var(--danger-soft)';
            iconContainer.style.color = 'var(--danger)';

            // Save original button container HTML and styles, and card styles
            const originalButtonsHtml = buttonContainer.innerHTML;
            const originalFlexDirection = buttonContainer.style.flexDirection;
            const originalGap = buttonContainer.style.gap;
            const cardEl = modal.querySelector('.modal-card');
            const originalCardWidth = cardEl.style.width;
            const originalCardMaxWidth = cardEl.style.maxWidth;

            // Maintain standard modal width (480px)
            cardEl.style.setProperty('width', '480px', 'important');
            cardEl.style.setProperty('max-width', '480px', 'important');

            // Render three buttons horizontally with smaller font and padding
            buttonContainer.style.flexDirection = 'row';
            buttonContainer.style.gap = '10px';
            buttonContainer.innerHTML = `
                <button type="button" class="btn btn-outline" id="btn-dialog-cancel" style="flex: 1; padding: 8px 10px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; height: 38px;">Hủy</button>
                <button type="button" class="btn btn-primary" id="btn-dialog-opt1" style="flex: 1.6; background: var(--warning); border-color: var(--warning); padding: 8px 10px; font-size: 0.8rem; color: #fff; font-weight: 600; white-space: nowrap; height: 38px;">${option1Text}</button>
                <button type="button" class="btn btn-primary" id="btn-dialog-opt2" style="flex: 1.6; background: var(--danger); border-color: var(--danger); padding: 8px 10px; font-size: 0.8rem; color: #fff; font-weight: 600; white-space: nowrap; height: 38px;">${option2Text}</button>
            `;

            lucide.createIcons();

            const opt1Btn = document.getElementById('btn-dialog-opt1');
            const opt2Btn = document.getElementById('btn-dialog-opt2');
            const cancelBtn = document.getElementById('btn-dialog-cancel');

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
                opt1Btn.removeEventListener('click', onOpt1);
                opt2Btn.removeEventListener('click', onOpt2);
                cancelBtn.removeEventListener('click', onCancel);
                if (closeBtn) closeBtn.removeEventListener('click', onClose);
                
                modal.classList.remove('active');

                // Restore card styles and button container after transition finishes
                setTimeout(() => {
                    cardEl.style.width = originalCardWidth;
                    cardEl.style.maxWidth = originalCardMaxWidth;
                    buttonContainer.style.flexDirection = originalFlexDirection;
                    buttonContainer.style.gap = originalGap;
                    buttonContainer.innerHTML = originalButtonsHtml;
                }, 300);
            };

            opt1Btn.addEventListener('click', onOpt1);
            opt2Btn.addEventListener('click', onOpt2);
            cancelBtn.addEventListener('click', onCancel);
            if (closeBtn) closeBtn.addEventListener('click', onClose);

            modal.classList.add('active');
        });
    }

    customAlert(title, message, iconName = 'info', focusTarget = null) {
        if (iconName === 'warning') iconName = 'alert-triangle';
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
            // Hỗ trợ nội dung nhiều dòng: nếu message có ký tự xuống dòng thì dùng white-space:pre-wrap
            if (message && message.includes('\n')) {
                messageEl.style.whiteSpace = 'pre-wrap';
                messageEl.style.textAlign = 'left';
                messageEl.style.fontSize = '0.85rem';
                messageEl.style.maxHeight = '340px';
                messageEl.style.overflowY = 'auto';
                messageEl.textContent = message;
            } else {
                messageEl.style.whiteSpace = '';
                messageEl.style.textAlign = '';
                messageEl.style.fontSize = '';
                messageEl.style.maxHeight = '';
                messageEl.style.overflowY = '';
                messageEl.textContent = message;
            }
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

            if (isDatePicker) {
                inputEl.type = 'datetime-local';
                if (defaultValue) {
                    inputEl.value = this.model.formatForDatetimeLocal(defaultValue);
                }
                setTimeout(() => inputEl.focus(), 100);
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
                let val = inputEl.value;
                if (isDatePicker && val) {
                    val = this.model.formatDate(val);
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
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
                if (closeBtn) closeBtn.removeEventListener('click', onClose);

                modal.classList.remove('active');

                setTimeout(() => {
                    const container = document.getElementById('dialog-prompt-container');
                    if (container) container.remove();
                }, 300);
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
        return function (...args) {
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
