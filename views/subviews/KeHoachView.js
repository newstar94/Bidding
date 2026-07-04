import { formatCurrency, formatDate, initCustomSelect } from './view_helpers.js';
import { parseYearMonth, sortRecords } from './tableDataUtils.js';
import { clearVirtualTable, renderVirtualTable } from './virtualTable.js';
export async function renderKeHoachTable() {
    const tableBody = document.getElementById('kehoach-table').querySelector('tbody');
    const searchVal = document.getElementById('search-kehoach').value.toLowerCase();

    // Populate Year and Month dropdowns dynamically
    const yearSelect = document.getElementById('filter-kehoach-nam');
    const monthSelect = document.getElementById('filter-kehoach-thang');
    const allPlans = this.model.state.kehoach || [];
    if (yearSelect && monthSelect) {
        const prevYear = yearSelect.value;
        const prevMonth = monthSelect.value;

        const years = new Set();
        const months = new Set();
        allPlans.forEach(kh => {
            if (kh.ngayPheDuyet) {
                const parsed = parseYearMonth(kh.ngayPheDuyet);
                if (parsed.year) years.add(parsed.year);
                if (parsed.month) months.add(parsed.month);
            }
        });

        const sortedYears = Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
        const sortedMonths = Array.from(months).sort((a, b) => parseInt(b) - parseInt(a));

        yearSelect.innerHTML = '<option value="">Năm</option>' + sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
        monthSelect.innerHTML = '<option value="">Tháng</option>' + sortedMonths.map(m => `<option value="${m}">Tháng ${m}</option>`).join('');

        if (sortedYears.includes(prevYear)) yearSelect.value = prevYear;
        if (sortedMonths.includes(prevMonth)) monthSelect.value = prevMonth;

        initCustomSelect('filter-kehoach-nam');
        initCustomSelect('filter-kehoach-thang');
    }

    const filterNam = yearSelect ? yearSelect.value : '';
    const filterThang = monthSelect ? monthSelect.value : '';

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.kehoach || 1;
    const pageSize = this.model.pageSize || 10;

    const sortState = this.model.sortState.kehoach || {};
    const sortBy = sortState.field || '';
    const sortOrder = sortState.order || 'asc';

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=kehoach&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&sortBy=${sortBy}&sortOrder=${sortOrder}&nam=${encodeURIComponent(filterNam)}&thang=${encodeURIComponent(filterThang)}`);
            if (res.ok) {
                const data = await res.json();
                slicedData = data.items;
                totalItems = data.totalItems;
            }
        } catch (e) {
            console.error("Failed to fetch paginated plans", e);
        }
    } else {
        const latestPlans = this.model.getFilteredKeHoach();
        const filtered = latestPlans.filter(kh => {
            const matchesSearch = kh.maKeHoach.toLowerCase().includes(searchVal) ||
                kh.tenKeHoach.toLowerCase().includes(searchVal) ||
                (kh.tenDuAnDuToan && kh.tenDuAnDuToan.toLowerCase().includes(searchVal));
            
            let matchesYear = true;
            let matchesMonth = true;
            if (kh.ngayPheDuyet) {
                const parsed = parseYearMonth(kh.ngayPheDuyet);
                if (filterNam) {
                    matchesYear = parsed.year === filterNam;
                }
                if (filterThang) {
                    matchesMonth = parsed.month === filterThang;
                }
            } else {
                if (filterNam || filterThang) {
                    matchesYear = false;
                    matchesMonth = false;
                }
            }
            return matchesSearch && matchesYear && matchesMonth;
        });

        sortRecords(filtered, sortBy, sortOrder);

        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        clearVirtualTable(tableBody);
        tableBody.innerHTML = `
            <tr>
                <td colspan="10">
                    <div class="empty-state">
                        <i data-lucide="file-warning"></i>
                        <p>Không tìm thấy Kế hoạch lựa chọn nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('kehoach-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        const esc = window.escapeHTML || ((value) => String(value ?? ''));
        renderVirtualTable(tableBody, slicedData, kh => {
            const root = kh.rootId || kh.id;
            const allVersions = kh.allVersions || this.model.state.kehoach.filter(k => (k.rootId || k.id) === root)
                .sort((a, b) => parseInt(b.phienBan) - parseInt(a.phienBan));

            if (!this.model.state.selectedPlanVersion) {
                this.model.state.selectedPlanVersion = {};
            }
            const selectedId = this.model.state.selectedPlanVersion[root] || allVersions[0]?.id || kh.id;
            const displayedKh = this.model.state.kehoach.find(k => k.id === selectedId) || kh;

            const cdt = this.model.state.chudautu.find(c => c.id === displayedKh.chuDauTuId);

            const optionsHtml = allVersions.map(v => {
                const label = v.phienBan || '00';
                const isSel = v.id === displayedKh.id ? 'selected' : '';
                return `<option value="${esc(v.id)}" ${isSel}>${esc(label)}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" data-bf-change="change-plan-version" data-root="${esc(root)}" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${optionsHtml}
                </select>
            `;

            const isLatest = displayedKh.id === kh.id;
            const editBtnHtml = isLatest ? `
                            <button class="action-btn btn-edit" data-bf-action="edit-plan" data-id="${esc(displayedKh.id)}" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
            ` : ``;

            return `
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" data-bf-action="show-plan" data-id="${esc(displayedKh.id)}" class="text-blue fw-bold link-hover" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${this.model.getPlanBaseCode(displayedKh.maKeHoach) ? esc(this.model.getPlanBaseCode(displayedKh.maKeHoach)) : '<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${dropdownHtml}
                        </div>
                    </td>
                    <td style="min-width: 240px; max-width: 320px;" class="fw-bold text-wrap">${esc(displayedKh.tenKeHoach)}</td>
                    <td>${displayedKh.loaiHinhMuaSam ? `<span class="badge ${displayedKh.loaiHinhMuaSam === 'Dự án' ? 'badge-info' : 'badge-warning'}">${esc(displayedKh.loaiHinhMuaSam)}</span>` : '<span class="text-muted">--</span>'}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${esc(displayedKh.tenDuAnDuToan || '--')}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${cdt ? esc(cdt.tenChuDauTu) : '<span class="text-danger">Không rõ</span>'}</td>
                    <td class="text-blue fw-bold">${formatCurrency(displayedKh.tongMucDauTu)}</td>
                    <td>${formatDate(displayedKh.ngayPheDuyet)}</td>
                    <td>${esc(displayedKh.quyetDinhPheDuyet)}</td>
                    <td><span class="fw-bold text-muted">${displayedKh.thoiGianDangMa ? this.model.formatDateWithTime(displayedKh.thoiGianDangMa) : '--'}</span></td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${editBtnHtml}
                            <button class="action-btn btn-delete" data-bf-action="delete-plan" data-id="${esc(displayedKh.id)}" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }, { colSpan: 10, rowHeight: 82, onRender: () => lucide.createIcons({ root: tableBody }) });

        if (window.renderTablePagination) {
            window.renderTablePagination('kehoach-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons();
    this.enhanceTableHeaders('kehoach-table', 'kehoach');
}


export function showKeHoachDetails(id, isSwitchingVersion = false) {
    let targetId = id;
    if (!isSwitchingVersion) {
        const latestPlan = this.model.getLatestPlan(id);
        if (latestPlan) {
            targetId = latestPlan.id;
        }
    }
    id = targetId;

    const detailPane = document.getElementById('tab-kehoach-detail');
    if (!detailPane || !detailPane.classList.contains('active')) {
        window.switchTab('kehoach-detail', id);
        return;
    }
    const kh = this.model.state.kehoach.find(k => k.id === id);
    if (!kh) return;

    this.renderPlanVersionDetails(id);
}


async function fetchPlanPackageSnapshots(planId) {
    if (!planId) return [];

    const pageSize = 200;
    let page = 1;
    let totalItems = 0;
    const items = [];

    do {
        const res = await fetch(`/api/paginate?table=goithau&page=${page}&pageSize=${pageSize}&keHoachId=${encodeURIComponent(planId)}`);
        if (!res.ok) break;

        const data = await res.json();
        const pageItems = Array.isArray(data.items) ? data.items : [];
        totalItems = Number(data.totalItems || pageItems.length || 0);
        items.push(...pageItems);

        if (pageItems.length === 0) break;
        page += 1;
    } while (items.length < totalItems);

    if (items.length > 0 && this.model) {
        if (!Array.isArray(this.model.state.goithau)) {
            this.model.state.goithau = [];
        }

        items.forEach(item => {
            const idx = this.model.state.goithau.findIndex(existing => String(existing.id) === String(item.id));
            if (idx !== -1) {
                this.model.state.goithau[idx] = item;
            } else {
                this.model.state.goithau.push(item);
            }
        });

        if (this.model.db && typeof this.model.db.putRecords === 'function') {
            this.model.db.putRecords('goithau', items).catch(e => console.error("Error storing plan package snapshots", e));
        } else if (typeof this.model.persistData === 'function') {
            this.model.persistData('goithau');
        }
    }

    return items;
}

export async function renderPlanVersionDetails(versionId) {
    const kh = this.model.state.kehoach.find(k => k.id === versionId);
    if (!kh) return;

    const editBtn = document.getElementById('btn-edit-kehoach-fullpage');
    if (editBtn) {
        const latestPlan = this.model.getLatestPlan(versionId);
        const isLatest = latestPlan && latestPlan.id === versionId;
        if (isLatest) {
            editBtn.style.display = 'flex';
            editBtn.onclick = () => {
                window.editKeHoach(versionId);
            };
        } else {
            editBtn.style.display = 'none';
        }
    }

    const rootId = kh.rootId || kh.id;
    const allRelated = this.model.state.kehoach.filter(k => (k.rootId || k.id) === rootId);
    const verMap = {};
    allRelated.forEach(k => {
        const ver = k.phienBan || '00';
        if (!verMap[ver] || k.isLatest == 1) {
            verMap[ver] = k;
        }
    });
    const allVersions = Object.values(verMap);
    allVersions.sort((a, b) => {
        const valA = parseInt(a.phienBan) || 0;
        const valB = parseInt(b.phienBan) || 0;
        return valA - valB;
    });

    const cdt = this.model.state.chudautu.find(c => c.id === kh.chuDauTuId);
    let linkedPackages = this.model.getLatestPackagesForPlan(kh.id);
    if (this.model.useServerSidePagination && linkedPackages.length === 0) {
        await fetchPlanPackageSnapshots.call(this, kh.id);
        linkedPackages = this.model.getLatestPackagesForPlan(kh.id);
    }

    // Group by rootId, code, or name to guarantee absolute uniqueness of each package root in the display list
    const uniqueLinkedPackages = [];
    const seenRoots = new Set();
    const seenCodes = new Set();
    const seenNames = new Set();

    linkedPackages.forEach(gt => {
        const root = gt.rootId;
        const code = gt.maGoiThau ? gt.maGoiThau.trim().toLowerCase() : '';
        const name = gt.tenGoiThau ? gt.tenGoiThau.trim().toLowerCase() : '';

        let isDuplicate = false;
        if (root && seenRoots.has(root)) isDuplicate = true;
        if (code && code !== '(chưa nhập)' && seenCodes.has(code)) isDuplicate = true;
        if (name && seenNames.has(name)) isDuplicate = true;

        if (!isDuplicate) {
            if (root) seenRoots.add(root);
            if (code && code !== '(chưa nhập)') seenCodes.add(code);
            if (name) seenNames.add(name);
            uniqueLinkedPackages.push(gt);
        }
    });

    const list1 = kh.cvDaThucHienList || [];
    const list2 = kh.cvKhongApDungList || [];
    const list3 = kh.cvChuaDuDieuKienList || [];

    let breakdownSection1 = '';
    if (list1.length > 0) {
        breakdownSection1 = `
            <div class="detail-sub-section" style="margin-top: 16px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">I. Phần công việc đã thực hiện</h5>
                <div class="phanlo-table-wrap" style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-top: 8px;">
                    <table class="phanlo-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--neutral-soft); text-align: left; border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 220px;">Đơn vị thực hiện</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 220px;">Văn bản phê duyệt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list1.map(item => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${item.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${formatCurrency(item.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${item.donViThucHien || '--'}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${item.vanBanPheDuyet || '--'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    let breakdownSection2 = '';
    if (list2.length > 0) {
        breakdownSection2 = `
            <div class="detail-sub-section" style="margin-top: 20px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">II. Phần công việc không áp dụng được hình thức LCNT</h5>
                <div class="phanlo-table-wrap" style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-top: 8px;">
                    <table class="phanlo-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--neutral-soft); text-align: left; border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 300px;">Đơn vị thực hiện</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list2.map(item => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${item.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${formatCurrency(item.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${item.donViThucHien || '--'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    let breakdownSection3 = '';
    if (list3.length > 0) {
        breakdownSection3 = `
            <div class="detail-sub-section" style="margin-top: 20px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">III. Phần công việc chưa đủ điều kiện lập kế hoạch LCNT</h5>
                <div class="phanlo-table-wrap" style="overflow-x: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-top: 8px;">
                    <table class="phanlo-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--neutral-soft); text-align: left; border-bottom: 1px solid var(--border-color);">
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.88rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list3.map(item => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${item.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.88rem; font-weight: 700; color: var(--primary); text-align: right !important;">${formatCurrency(item.giaTri)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    let pheDuyetDetailHtml = '';
    if (kh.pheDuyet === 'Kế hoạch') {
        pheDuyetDetailHtml = `
            <div class="detail-item">
                <div class="detail-label">Ngày trình dự toán</div>
                <div class="detail-value">${formatDate(kh.ngayTrinhDuToan) || '--'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày phê duyệt dự toán</div>
                <div class="detail-value">${formatDate(kh.ngayPheDuyetDuToan) || '--'}</div>
            </div>
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Số QĐ phê duyệt dự toán</div>
                <div class="detail-value">${kh.soQdPheDuyetDuToan || '--'}</div>
            </div>
        `;
    }

    let projectDetailHtml = '';
    if (kh.loaiHinhMuaSam === 'Dự án') {
        projectDetailHtml = `
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Mã dự án</div>
                <div class="detail-value">${kh.maDuan || '--'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Số QĐ phê duyệt dự án</div>
                <div class="detail-value">${kh.soQdPheDuyetDuAn || '--'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày QĐ phê duyệt dự án</div>
                <div class="detail-value">${formatDate(kh.ngayQdPheDuyetDuAn) || '--'}</div>
            </div>
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Cơ quan phê duyệt dự án</div>
                <div class="detail-value">${kh.coQuanPheDuyetDuAn || '--'}</div>
            </div>
        `;
    }

    const html = `
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box; font-size: 0.85rem; padding: 4px 10px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.15); color: var(--primary); border-radius: 4px; font-weight: 700;">${this.model.getPlanBaseCode(kh.maKeHoach) || '<span class="text-muted">(Chưa nhập)</span>'}</span>
                        <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                        <select id="fullpage-kh-version-select" class="page-version-select" ${allVersions.length < 2 ? 'disabled' : ''}>
                            ${allVersions.map(k => `<option value="${k.id}" ${k.id === versionId ? 'selected' : ''}>${k.phienBan || '00'}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <h4 class="detail-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${kh.tenKeHoach}</h4>
            </div>
            
            <div class="detail-grid">
                <div class="detail-item" style="grid-column: span 2;">
                    <div class="detail-label">Tên Dự án / Dự toán</div>
                    <div class="detail-value text-blue" style="font-size: 1.1rem;">${kh.tenDuAnDuToan || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Hình thức</div>
                    <div class="detail-value">${kh.loaiHinhMuaSam ? `<span class="badge ${kh.loaiHinhMuaSam === 'Dự án' ? 'badge-info' : 'badge-warning'}">${kh.loaiHinhMuaSam}</span>` : '<span class="text-muted">Chưa xác định</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phê duyệt</div>
                    <div class="detail-value">${kh.pheDuyet ? `<span class="badge ${kh.pheDuyet === 'Kế hoạch' ? 'badge-info' : 'badge-success'}">${kh.pheDuyet}</span>` : '<span class="text-muted">--</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tổng Giá Trị Kế Hoạch</div>
                    <div class="detail-value text-blue" style="font-size: 1.15rem;">${formatCurrency(kh.tongMucDauTu)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian đăng mã kế hoạch</div>
                    <div class="detail-value">${kh.thoiGianDangMa ? this.model.formatDateWithTime(kh.thoiGianDangMa) : '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số QĐ phê duyệt</div>
                    <div class="detail-value">${kh.quyetDinhPheDuyet}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày QĐ phê duyệt</div>
                    <div class="detail-value">${formatDate(kh.ngayPheDuyet)}</div>
                </div>
                ${pheDuyetDetailHtml}
                ${projectDetailHtml}
            </div>

            <div class="detail-sub-section">
                <h5 class="detail-sub-title">Thông tin Chủ đầu tư</h5>
                ${cdt ? `
                    <div class="associated-item">
                        <div>
                            <strong style="font-size: 0.9rem;">${cdt.tenChuDauTu}</strong><br>
                            <small class="text-muted">Mã số thuế: ${cdt.maSoThue} | Địa chỉ: ${(cdt.diaChi || '').replace(/\s*\|\s*/g, ', ')}</small>
                        </div>
                        <span class="associated-badge">${cdt.maChuDauTu}</span>
                    </div>
                ` : '<div class="text-muted"><small>Không tìm thấy thông tin chủ đầu tư.</small></div>'}
            </div>

            ${breakdownSection1}
            ${breakdownSection2}
            ${breakdownSection3}

            <div class="detail-sub-section" style="margin-top: 20px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">IV. Phần công việc thuộc kế hoạch lựa chọn nhà thầu (Các gói thầu - ${uniqueLinkedPackages.length})</h5>
                <div class="associated-list">
                    ${uniqueLinkedPackages.length > 0 ? uniqueLinkedPackages.map(gt => `
                        <div class="associated-item" style="cursor: pointer;" data-bf-action="show-package" data-id="${gt.id}" title="Xem chi tiết Gói thầu">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue" style="width:16px;"></i>
                                <span><strong>${gt.maGoiThau}</strong> - ${gt.tenGoiThau}</span>
                            </div>
                            <span class="badge badge-success">${formatCurrency(gt.giaGoiThau)}</span>
                        </div>
                    `).join('') : '<div class="text-muted"><small>Phiên bản kế hoạch này hiện chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;

    document.getElementById('fullpage-kehoach-content').innerHTML = html;
    const innerSelect = document.getElementById('fullpage-kh-version-select');
    if (innerSelect) {
        innerSelect.onchange = (e) => {
            this.renderPlanVersionDetails(e.target.value);
        };
        if (window.initCustomSelect) window.initCustomSelect('fullpage-kh-version-select');
    }
    lucide.createIcons();
}
