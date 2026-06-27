/* ==========================================================================
   BiddingFlow - PartnerView (Part of View split)
   ========================================================================== */
import { formatCurrency, formatDate, initCustomSelect } from './view_helpers.js';

export async function renderChuDauTuTable() {
    const tableBody = document.getElementById('chudautu-table').querySelector('tbody');
    const searchVal = document.getElementById('search-chudautu').value.toLowerCase();

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.chudautu || 1;
    const pageSize = this.model.pageSize || 10;

    const sortState = this.model.sortState.chudautu || {};
    const sortBy = sortState.field || '';
    const sortOrder = sortState.order || 'asc';

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=chudautu&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&sortBy=${sortBy}&sortOrder=${sortOrder}`, {
                headers: {
                    'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                    'X-Username': sessionStorage.getItem('bf_username') || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                slicedData = data.items;
                totalItems = data.totalItems;
            }
        } catch (e) {
            console.error("Failed to fetch paginated investors", e);
        }
    } else {
        const latestChuDauTu = this.model.getLatestChuDauTu();
        const filtered = latestChuDauTu.filter(c =>
            (c.maChuDauTu || '').toLowerCase().includes(searchVal) ||
            (c.tenChuDauTu || '').toLowerCase().includes(searchVal) ||
            (c.maSoThue && c.maSoThue.includes(searchVal))
        );

        if (sortBy) {
            filtered.sort((a, b) => {
                let valA = a[sortBy] || '';
                let valB = b[sortBy] || '';
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }

        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="building"></i>
                        <p>Không tìm thấy Chủ đầu tư nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('chudautu-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        tableBody.innerHTML = slicedData.map(c => {
            const root = c.rootId || c.id;
            const allVersions = c.allVersions || this.model.state.chudautu.filter(x => (x.rootId || x.id) === root)
                .sort((a, b) => parseInt(b.phienBan || b.phien_ban || 0) - parseInt(a.phienBan || a.phien_ban || 0));

            if (!this.model.state.selectedChuDauTuVersion) {
                this.model.state.selectedChuDauTuVersion = {};
            }
            const selectedId = this.model.state.selectedChuDauTuVersion[root] || c.id;
            const displayedCdt = this.model.state.chudautu.find(x => x.id === selectedId) || c;

            const optionsHtml = allVersions.map(v => {
                const label = `V${parseInt(v.phienBan || v.phien_ban || 0)}`;
                const isSel = v.id === displayedCdt.id ? 'selected' : '';
                return `<option value="${v.id}" ${isSel}>${label}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" onchange="window.changeChuDauTuRowVersion('${root}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${optionsHtml}
                </select>
            `;

            return `
            <tr>
                <td>
                    <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                        <a href="#" onclick="event.preventDefault(); window.editChuDauTu('${displayedCdt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Chủ đầu tư" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${displayedCdt.maChuDauTu || ''}</span></a>
                        <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                        ${dropdownHtml}
                    </div>
                </td>
                <td style="min-width: 220px; max-width: 320px;" class="fw-bold text-wrap">
                    ${displayedCdt.tenChuDauTu || ''}
                    ${displayedCdt.coQuanChuQuan ? `<div style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-top:2px;">CQ chủ quản: ${displayedCdt.coQuanChuQuan}</div>` : ''}
                </td>
                <td>${displayedCdt.maSoThue || '--'}</td>
                <td><span class="fw-bold">${displayedCdt.danhXung || 'Ông'} ${displayedCdt.nguoiKyQuyetDinh || '--'}</span></td>
                <td style="min-width: 240px; max-width: 360px;" class="text-wrap">
                    <div style="font-size:0.85rem;" class="fw-bold">${(displayedCdt.diaChi || '').replace(/\s*\|\s*/g, ', ')}</div>
                    <div style="font-size:0.75rem; color:var(--text-light);">${displayedCdt.soDienThoai || ''}${displayedCdt.email ? ' | ' + displayedCdt.email : ''}</div>
                </td>
                <td>
                    <div style="font-size:0.85rem;" class="fw-bold">${displayedCdt.soTaiKhoan || '--'}</div>
                    <div style="font-size:0.75rem; color:var(--text-light);">${displayedCdt.noiMoTaiKhoan || '--'}${displayedCdt.maQHNS ? ' | QHNS: ' + displayedCdt.maQHNS : ''}</div>
                </td>
                <td class="text-right">
                    <div class="action-btn-group">
                        <button class="action-btn btn-edit" onclick="window.editChuDauTu('${displayedCdt.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteChuDauTu('${displayedCdt.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        if (window.renderTablePagination) {
            window.renderTablePagination('chudautu-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons({ root: tableBody });
    this.enhanceTableHeaders('chudautu-table', 'chudautu');
}

export async function renderNhaThauTable() {
    const tableBody = document.getElementById('nhathau-table').querySelector('tbody');
    const searchVal = document.getElementById('search-nhathau').value.toLowerCase();

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.nhathau || 1;
    const pageSize = this.model.pageSize || 10;

    const sortState = this.model.sortState.nhathau || {};
    const sortBy = sortState.field || '';
    const sortOrder = sortState.order || 'asc';

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=nhathau&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&sortBy=${sortBy}&sortOrder=${sortOrder}`, {
                headers: {
                    'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                    'X-Username': sessionStorage.getItem('bf_username') || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                slicedData = data.items;
                totalItems = data.totalItems;
            }
        } catch (e) {
            console.error("Failed to fetch paginated contractors", e);
        }
    } else {
        const latestNhaThau = this.model.getLatestNhaThau();
        const filtered = latestNhaThau.filter(n =>
            (n.maNhaThau || '').toLowerCase().includes(searchVal) ||
            (n.tenNhaThau || '').toLowerCase().includes(searchVal) ||
            (n.maSoThue && n.maSoThue.includes(searchVal)) ||
            (n.loaiNhaThau === 'Liên danh' && n.thanhVienLienDanh && n.thanhVienLienDanh.some(m => (m.tenNhaThau || '').toLowerCase().includes(searchVal) || (m.maSoThue || '').includes(searchVal)))
        );

        if (sortBy) {
            filtered.sort((a, b) => {
                let valA = a[sortBy] || '';
                let valB = b[sortBy] || '';
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }

        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="shield-alert"></i>
                        <p>Không tìm thấy Nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('nhathau-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        tableBody.innerHTML = slicedData.map(n => {
            const root = n.rootId || n.id;
            const allVersions = n.allVersions || this.model.state.nhathau.filter(x => (x.rootId || x.id) === root)
                .sort((a, b) => parseInt(b.phienBan || b.phien_ban || 0) - parseInt(a.phienBan || a.phien_ban || 0));

            if (!this.model.state.selectedNhaThauVersion) {
                this.model.state.selectedNhaThauVersion = {};
            }
            const selectedId = this.model.state.selectedNhaThauVersion[root] || n.id;
            const displayedNt = this.model.state.nhathau.find(x => x.id === selectedId) || n;

            const optionsHtml = allVersions.map(v => {
                const label = `V${parseInt(v.phienBan || v.phien_ban || 0)}`;
                const isSel = v.id === displayedNt.id ? 'selected' : '';
                return `<option value="${v.id}" ${isSel}>${label}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" onchange="window.changeNhaThauRowVersion('${root}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${optionsHtml}
                </select>
            `;

            const isJV = displayedNt.loaiNhaThau === 'Liên danh';
            if (isJV) {
                const members = displayedNt.thanhVienLienDanh || [];
                const names = members.map(m => m.tenNhaThau || '').join('<br>+ ');
                const msts = members.map(m => m.maSoThue || '').join(', ');
                const leaders = members.length > 0 ? `${members[0].danhXung || 'Ông'} ${members[0].nguoiDaiDien || '--'} (Trưởng LD)` : '--';
                const contacts = members.length > 0 ? `<small>SĐT: ${members[0].soDienThoai || '--'}</small><br><small>Email: ${members[0].email || '--'}</small>` : '--';
                const bankAccs = members.length > 0 ? `<div style="font-size:0.85rem;" class="fw-bold">${members[0].soTaiKhoan || '--'}</div><div style="font-size:0.75rem; color:var(--text-light);">${members[0].noiMoTaiKhoan || '--'} (+${members.length - 1} TV)</div>` : '--';
                return `
                    <tr>
                        <td>
                            <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                                <a href="#" onclick="event.preventDefault(); window.editNhaThau('${displayedNt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Nhà thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${displayedNt.maNhaThau || ''}</span></a>
                                <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                                ${dropdownHtml}
                            </div>
                        </td>
                        <td style="min-width: 240px; max-width: 360px;" class="fw-bold text-wrap">
                            ${displayedNt.tenNhaThau || ''}
                            <div style="margin-top: 4px;"><span class="badge badge-info">Liên danh (${members.length} TV)</span></div>
                            <div style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--primary-soft); white-space: normal !important;">
                                + ${names}
                            </div>
                        </td>
                        <td><small>${msts}</small></td>
                        <td>${leaders}</td>
                        <td>${contacts}</td>
                        <td>${bankAccs}</td>
                        <td class="text-right">
                            <div class="action-btn-group">
                                <button class="action-btn btn-edit" onclick="window.editNhaThau('${displayedNt.id}')" title="Sửa">
                                    <i data-lucide="edit-2"></i>
                                </button>
                                <button class="action-btn btn-delete" onclick="window.deleteNhaThau('${displayedNt.id}')" title="Xóa">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            } else {
                const rep = `${displayedNt.danhXung || 'Ông'} ${displayedNt.nguoiDaiDien || '--'}`;
                const contact = `<small>SĐT: ${displayedNt.soDienThoai || '--'}</small><br><small>Email: ${displayedNt.email || '--'}</small>`;
                const bankAcc = `<div style="font-size:0.85rem;" class="fw-bold">${displayedNt.soTaiKhoan || '--'}</div><div style="font-size:0.75rem; color:var(--text-light);">${displayedNt.noiMoTaiKhoan || '--'}${displayedNt.maNganHang ? ' (' + displayedNt.maNganHang + ')' : ''}</div>`;
                return `
                    <tr>
                        <td>
                            <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                                <a href="#" onclick="event.preventDefault(); window.editNhaThau('${displayedNt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Nhà thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${displayedNt.maNhaThau || ''}</span></a>
                                <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                                ${dropdownHtml}
                            </div>
                        </td>
                        <td style="min-width: 240px; max-width: 360px;" class="fw-bold text-wrap">
                            ${displayedNt.tenNhaThau || ''}
                        </td>
                        <td>${displayedNt.maSoThue || '--'}</td>
                        <td>${rep}</td>
                        <td>${contact}</td>
                        <td>${bankAcc}</td>
                        <td class="text-right">
                            <div class="action-btn-group">
                                <button class="action-btn btn-edit" onclick="window.editNhaThau('${displayedNt.id}')" title="Sửa">
                                    <i data-lucide="edit-2"></i>
                                </button>
                                <button class="action-btn btn-delete" onclick="window.deleteNhaThau('${displayedNt.id}')" title="Xóa">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }
        }).join('');

        if (window.renderTablePagination) {
            window.renderTablePagination('nhathau-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons({ root: tableBody });
    this.enhanceTableHeaders('nhathau-table', 'nhathau');
}

export async function renderChuyenGiaTable() {
    const tableBody = document.getElementById('chuyengia-table').querySelector('tbody');
    const searchVal = document.getElementById('search-chuyengia').value.toLowerCase();

    const isEmployee = this.model.state.activerole === 'employee';
    const btnAdd = document.getElementById('btn-add-chuyengia');
    if (btnAdd) {
        btnAdd.style.display = isEmployee ? 'none' : 'flex';
    }

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.chuyengia || 1;
    const pageSize = this.model.pageSize || 10;

    const sortState = this.model.sortState.chuyengia || {};
    const sortBy = sortState.field || '';
    const sortOrder = sortState.order || 'asc';

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=chuyengia&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&sortBy=${sortBy}&sortOrder=${sortOrder}`, {
                headers: {
                    'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                    'X-Username': sessionStorage.getItem('bf_username') || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                slicedData = data.items;
                totalItems = data.totalItems;
            }
        } catch (e) {
            console.error("Failed to fetch paginated experts", e);
        }
    } else {
        const latestChuyenGia = this.model.getLatestChuyenGia();
        const filtered = latestChuyenGia.filter(cg =>
            (cg.hoTen || '').toLowerCase().includes(searchVal) ||
            (cg.soCCCD || '').includes(searchVal) ||
            (cg.soChungChi || '').toLowerCase().includes(searchVal)
        );

        if (sortBy) {
            filtered.sort((a, b) => {
                let valA = a[sortBy] || '';
                let valB = b[sortBy] || '';
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }

        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i data-lucide="user-x"></i>
                        <p>Không tìm thấy Chuyên gia nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('chuyengia-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        tableBody.innerHTML = slicedData.map(cg => {
            const root = cg.rootId || cg.id;
            const allVersions = cg.allVersions || this.model.state.chuyengia.filter(x => (x.rootId || x.id) === root)
                .sort((a, b) => parseInt(b.phienBan || b.phien_ban || 0) - parseInt(a.phienBan || a.phien_ban || 0));

            if (!this.model.state.selectedChuyenGiaVersion) {
                this.model.state.selectedChuyenGiaVersion = {};
            }
            const selectedId = this.model.state.selectedChuyenGiaVersion[root] || cg.id;
            const displayedCg = this.model.state.chuyengia.find(x => x.id === selectedId) || cg;

            const optionsHtml = allVersions.map(v => {
                const label = `V${parseInt(v.phienBan || v.phien_ban || 0)}`;
                const isSel = v.id === displayedCg.id ? 'selected' : '';
                return `<option value="${v.id}" ${isSel}>${label}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" onchange="window.changeChuyenGiaRowVersion('${root}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${optionsHtml}
                </select>
            `;

            return `
            <tr>
                <td class="fw-bold">
                    <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                        <a href="#" onclick="event.preventDefault(); window.showChuyenGiaDetails('${displayedCg.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết lý lịch" style="display: inline-flex; align-items: center; line-height: 1;"><span style="margin: 0; line-height: 1;">${displayedCg.hoTen || ''}</span></a>
                        <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                        ${dropdownHtml}
                    </div>
                </td>
                <td>${displayedCg.soCCCD || ''}</td>
                <td><span class="badge badge-info">${displayedCg.soChungChi || ''}</span></td>
                <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${displayedCg.donViCapChungChi || '--'}</td>
                <td>${displayedCg.ngayCapChungChi ? formatDate(displayedCg.ngayCapChungChi) : '--'}</td>
                <td class="text-right">
                    ${isEmployee ? '' : `
                    <div class="action-btn-group">
                        <button class="action-btn btn-edit" onclick="window.editChuyenGia('${displayedCg.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteChuyenGia('${displayedCg.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                    `}
                </td>
            </tr>
            `;
        }).join('');

        if (window.renderTablePagination) {
            window.renderTablePagination('chuyengia-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons({ root: tableBody });
    this.enhanceTableHeaders('chuyengia-table', 'chuyengia');
}

export async function renderHopDongTable() {
    const tableBody = document.getElementById('hopdong-table').querySelector('tbody');
    const searchVal = document.getElementById('search-hopdong').value.toLowerCase();

    // Helper function to extract year and month safely from various date formats
    const parseYearMonth = (dateStr) => {
        if (!dateStr) return { year: null, month: null };
        let cleaned = String(dateStr).replace(/\s*-\s*/, ' ').trim();
        if (cleaned.match(/^\d{4}-\d{2}-\d{2}/)) {
            const y = cleaned.substring(0, 4);
            const m = parseInt(cleaned.substring(5, 7), 10).toString();
            return { year: y, month: m };
        } else if (cleaned.match(/^\d{2}\/\d{2}\/\d{4}/)) {
            const parts = cleaned.split(' ')[0].split('/');
            const y = parts[2];
            const m = parseInt(parts[1], 10).toString();
            return { year: y, month: m };
        }
        const d = new Date(cleaned);
        if (!isNaN(d.getTime())) {
            return {
                year: d.getFullYear().toString(),
                month: (d.getMonth() + 1).toString()
            };
        }
        return { year: null, month: null };
    };

    // Populate Year and Month dropdowns dynamically
    const yearSelect = document.getElementById('filter-hopdong-nam');
    const monthSelect = document.getElementById('filter-hopdong-thang');
    const allContracts = this.model.state.hopdong || [];
    if (yearSelect && monthSelect) {
        const prevYear = yearSelect.value;
        const prevMonth = monthSelect.value;

        const years = new Set();
        const months = new Set();
        allContracts.forEach(h => {
            if (h.ngayKy) {
                const parsed = parseYearMonth(h.ngayKy);
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

        initCustomSelect('filter-hopdong-nam');
        initCustomSelect('filter-hopdong-thang');
    }

    const filterNam = yearSelect ? yearSelect.value : '';
    const filterThang = monthSelect ? monthSelect.value : '';

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.hopdong || 1;
    const pageSize = this.model.pageSize || 10;

    const sortState = this.model.sortState.hopdong || {};
    const sortBy = sortState.field || '';
    const sortOrder = sortState.order || 'asc';

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="13" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=hopdong&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&sortBy=${sortBy}&sortOrder=${sortOrder}&nam=${encodeURIComponent(filterNam)}&thang=${encodeURIComponent(filterThang)}`, {
                headers: {
                    'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                    'X-Username': sessionStorage.getItem('bf_username') || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                slicedData = data.items;
                totalItems = data.totalItems;
            }
        } catch (e) {
            console.error("Failed to fetch paginated contracts", e);
        }
    } else {
        const latestHopDong = this.model.getLatestHopDong();
        const filtered = latestHopDong.filter(h => {
            const matchesSearch = (h.soHopDong || '').toLowerCase().includes(searchVal) ||
                (h.tenHopDong || '').toLowerCase().includes(searchVal);
            
            let matchesYear = true;
            let matchesMonth = true;
            if (h.ngayKy) {
                const parsed = parseYearMonth(h.ngayKy);
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

        if (sortBy) {
            filtered.sort((a, b) => {
                let valA = a[sortBy] || '';
                let valB = b[sortBy] || '';
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }

        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="13">
                    <div class="empty-state">
                        <i data-lucide="file-check-2"></i>
                        <p>Không tìm thấy Hợp đồng nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('hopdong-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        tableBody.innerHTML = slicedData.map(h => {
            const root = h.rootId || h.id;
            const allVersions = h.allVersions || this.model.state.hopdong.filter(x => (x.rootId || x.id) === root)
                .sort((a, b) => parseInt(b.phienBan || b.phien_ban || 0) - parseInt(a.phienBan || a.phien_ban || 0));

            if (!this.model.state.selectedHopDongVersion) {
                this.model.state.selectedHopDongVersion = {};
            }
            const selectedId = this.model.state.selectedHopDongVersion[root] || h.id;
            const displayedHd = this.model.state.hopdong.find(x => x.id === selectedId) || h;

            const optionsHtml = allVersions.map(v => {
                const label = `V${parseInt(v.phienBan || v.phien_ban || 0)}`;
                const isSel = v.id === displayedHd.id ? 'selected' : '';
                return `<option value="${v.id}" ${isSel}>${label}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" onchange="window.changeHopDongRowVersion('${root}', this.value)" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${optionsHtml}
                </select>
            `;

            const chudautuList = Array.isArray(this.model.state.chudautu) ? this.model.state.chudautu : [];
            const cdt = chudautuList.find(c => c.id === displayedHd.chuDauTuId);
            const cdtName = cdt ? cdt.tenChuDauTu : '--';

            const nhathauList = Array.isArray(this.model.state.nhathau) ? this.model.state.nhathau : [];
            const nt = nhathauList.find(n => n.id === displayedHd.nhaThauId);
            const ntName = nt ? nt.tenNhaThau : '--';

            const goithauList = typeof this.model.getLatestPackages === 'function' ? this.model.getLatestPackages() : (Array.isArray(this.model.state.goithau) ? this.model.state.goithau : []);
            const linkedPkgs = (displayedHd.goiThauIds || []).map(gtId => {
                const gt = goithauList.find(g => g.id === gtId);
                if (!gt) return '';
                return `<a href="#" onclick="event.preventDefault(); window.showPackageDetails('${gt.id}')" style="margin:2px; display:inline-block;" title="${gt.tenGoiThau || ''}"><span class="detail-code link-hover">${gt.maGoiThau || 'Gói'}</span></a>`;
            }).filter(Boolean).join(' ');

            const custompaperstatuses = Array.isArray(this.model.state.custompaperstatuses) ? this.model.state.custompaperstatuses : [];
            const statusObj = custompaperstatuses.find(s => s.name === displayedHd.trangThaiHoSo);
            const statusColor = statusObj ? statusObj.color : '#6b7280';
            const statusBadge = displayedHd.trangThaiHoSo
                ? `<span class="status-pill" style="background-color: ${statusColor}; color: white; padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 0.78rem;">${displayedHd.trangThaiHoSo}</span>`
                : '<span class="text-muted" style="font-size:0.8rem;">Chưa cập nhật</span>';

            return `
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" onclick="event.preventDefault(); window.showHopDongDetails('${displayedHd.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Hợp đồng" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code link-hover" style="margin: 0; line-height: 1;">${displayedHd.soHopDong}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${dropdownHtml}
                        </div>
                    </td>
                    <td style="min-width: 200px; max-width: 300px;" class="fw-bold text-wrap">${displayedHd.tenHopDong}</td>
                    <td>${displayedHd.ngayKy ? formatDate(displayedHd.ngayKy) : '--'}</td>
                    <td style="font-size:0.85rem; min-width: 180px; max-width: 280px;" class="text-wrap">${cdtName}</td>
                    <td style="font-size:0.85rem; min-width: 180px; max-width: 280px;" class="text-wrap">${ntName}</td>
                    <td class="fw-bold text-blue">${formatCurrency(displayedHd.giaTri)}</td>
                    <td><span class="badge badge-info">${displayedHd.loaiHopDong || 'Trọn gói'}</span></td>
                    <td><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">${displayedHd.phanLoai || 'Tư vấn'}</span></td>
                    <td>${displayedHd.soNgayThucHien ? (isNaN(displayedHd.soNgayThucHien) ? displayedHd.soNgayThucHien : displayedHd.soNgayThucHien + ' ngày') : '--'}</td>
                    <td>${linkedPkgs || '<span class="text-danger" style="font-weight: 500;">Chưa liên kết</span>'}</td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${(displayedHd.goiThauIds && displayedHd.goiThauIds.length > 0) ? `
                            <button class="action-btn btn-export" onclick="window.exportContractFromHopDong('${displayedHd.goiThauIds[0]}', '${displayedHd.soHopDong}')" title="Xuất hợp đồng" style="color: var(--emerald);">
                                <i data-lucide="file-text"></i>
                            </button>
                            ` : ''}
                            <button class="action-btn btn-edit" onclick="window.editHopDong('${displayedHd.id}')" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
                            <button class="action-btn btn-delete" onclick="window.deleteHopDong('${displayedHd.id}')" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (window.renderTablePagination) {
            window.renderTablePagination('hopdong-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons({ root: tableBody });
    this.enhanceTableHeaders('hopdong-table', 'hopdong');
}

export function showChuyenGiaDetails(id) {
    const cg = this.model.state.chuyengia.find(c => c.id === id);
    if (!cg) return;

    const avatarInitial = cg.hoTen.split(' ').map(w => w[0]).pop().toUpperCase();
    const certFileName = cg.tenAnhChungChi || (cg.soCCCD ? `CC_${cg.soCCCD}.png` : '--');
    const sigFileName = cg.tenAnhChuKy || (cg.soCCCD ? `CK_${cg.soCCCD}.png` : '--');

    const html = `
        <div class="expert-profile-grid">
            <div class="profile-passport-card">
                <div class="profile-passport-avatar">${avatarInitial}</div>
                <div class="profile-passport-name">${cg.hoTen}</div>

                <div class="passport-details-list">
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Số CCCD</div>
                        <div class="passport-detail-val fw-bold">${cg.soCCCD || '--'}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Ngày cấp CCCD</div>
                        <div class="passport-detail-val">${cg.ngayCapCCCD ? formatDate(cg.ngayCapCCCD) : '--'}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Nơi cấp CCCD</div>
                        <div class="passport-detail-val">${cg.noiCapCCCD || '--'}</div>
                    </div>
                </div>

                <div style="margin-top: 18px;">
                    <div class="passport-detail-label" style="margin-bottom: 6px;">Ảnh chữ ký chuyên gia</div>
                    <div class="signature-display-frame" onclick="window.zoomSignatureImage('${cg.id}')" title="Bấm để phóng to">
                        ${cg.anhChuKy
            ? `<img src="${cg.anhChuKy}" alt="Chữ ký" style="max-height:80px; max-width:100%; object-fit:contain;">`
            : `<span class="text-muted" style="font-size:0.78rem;">Chưa có ảnh chữ ký</span>`
        }
                    </div>
                    <div style="margin-top:4px; font-size:0.72rem; color:var(--text-light);">📁 ${sigFileName}</div>
                </div>
            </div>

            <div class="expert-profile-details">
                <div class="expert-cert-viewer">
                    <div class="expert-cert-title-bar">
                        <h5>Chứng chỉ Hành nghề Đấu thầu</h5>
                        <span class="badge badge-info">Số CC: ${cg.soChungChi}</span>
                    </div>

                    <div class="passport-details-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 0; margin-bottom: 12px;">
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Số chứng chỉ</div>
                            <div class="passport-detail-val fw-bold text-blue">${cg.soChungChi || '--'}</div>
                        </div>
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Ngày cấp</div>
                            <div class="passport-detail-val">${cg.ngayCapChungChi ? formatDate(cg.ngayCapChungChi) : '--'}</div>
                        </div>
                        <div class="passport-detail-row" style="grid-column: span 2;">
                            <div class="passport-detail-label">Đơn vị cấp chứng chỉ</div>
                            <div class="passport-detail-val fw-bold">${cg.donViCapChungChi || '--'}</div>
                        </div>
                    </div>

                    <div class="passport-detail-label" style="margin-bottom: 6px;">Ảnh chụp chứng chỉ thực tế</div>
                    <div class="cert-image-frame" onclick="window.zoomCertificateImage('${cg.id}')">
                        ${cg.anhChungChi
            ? `<img src="${cg.anhChungChi}" alt="Ảnh chứng chỉ">`
            : `<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--text-light);">Chưa có ảnh chứng chỉ</div>`
        }
                        ${cg.anhChungChi ? `<div class="cert-zoom-overlay"><i data-lucide="zoom-in"></i> Phóng to</div>` : ''}
                    </div>
                    <div style="margin-top:4px; font-size:0.72rem; color:var(--text-light);">📁 ${certFileName}</div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('detail-chuyengia-content').innerHTML = html;
    this.openModal('modal-detail-chuyengia');
    lucide.createIcons({ root: document.getElementById('detail-chuyengia-content') });
}

export function renderBieumauTab(templatesList = []) {
    const tbody = document.getElementById('word-templates-tbody');
    if (!tbody) return;

    if (templatesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Đang tải biểu mẫu...</td></tr>`;
        return;
    }

    tbody.innerHTML = templatesList.map(tpl => {
        const activeBadge = tpl.is_active
            ? '<span class="badge badge-success"><i data-lucide="check-circle"></i> Đang hoạt động</span>'
            : `<span class="badge badge-neutral btn-activate-template" data-filename="${tpl.filename}" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Nhấn để sử dụng làm mẫu chính"><i data-lucide="play" style="width: 12px; height: 12px;"></i> Sẵn sàng</span>`;

        const actionButton = tpl.is_active
            ? `<span class="text-success fw-bold" style="font-size:0.8rem;">Đang dùng</span>`
            : `<button class="btn btn-outline btn-sm btn-activate-template" data-filename="${tpl.filename}">Sử dụng</button>`;

        return `
            <tr>
                <td class="fw-bold">${tpl.name}</td>
                <td>${activeBadge}</td>
                <td class="text-right">${actionButton}</td>
            </tr>
        `;
    }).join('');
    lucide.createIcons({ root: tbody });
}

export function renderDictionary(group) {
    const tbody = document.getElementById('dictionary-table-body');
    if (!tbody) return;

    const DICTIONARY = {
        global: [],
        experts: [
            { code: '{#Danh_Sach_Chuyen_Gia}', desc: 'Bắt đầu vòng lặp tổ chuyên gia' },
            { code: '{STT}', desc: 'Số thứ tự chuyên gia' },
            { code: '{/Danh_Sach_Chuyen_Gia}', desc: 'Kết thúc vòng lặp tổ chuyên gia' },
            { code: '{#Danh_Sach_Tham_Dinh}', desc: 'Bắt đầu vòng lặp tổ thẩm định' },
            { code: '{STT}', desc: 'Số thứ tự thẩm định viên' },
            { code: '{/Danh_Sach_Tham_Dinh}', desc: 'Kết thúc vòng lặp tổ thẩm định' }
        ],
        contractors: [
            { code: '{#Danh_Sach_Nha_Thau}', desc: 'Bắt đầu vòng lặp danh sách nhà thầu tham dự' },
            { code: '{STT}', desc: 'Số thứ tự nhà thầu tham dự' },
            { code: '{#Thanh_Vien_Lien_Danh}', desc: '(Liên danh) Bắt đầu vòng lặp thành viên liên danh của nhà thầu trúng' },
            { code: '{Ten_TV}', desc: '(Liên danh) Tên thành viên liên danh' },
            { code: '{MST_TV}', desc: '(Liên danh) Mã số thuế thành viên liên danh' },
            { code: '{Vai_Tro_TV}', desc: '(Liên danh) Vai trò thành viên (Liên danh chính / liên danh phụ)' },
            { code: '{Nguoi_Dai_Dien_TV}', desc: '(Liên danh) Người đại diện thành viên liên danh' },
            { code: '{Dia_Chi_TV}', desc: '(Liên danh) Địa chỉ thành viên liên danh' },
            { code: '{So_Tai_Khoan_TV}', desc: '(Liên danh) Số tài khoản thành viên liên danh' },
            { code: '{Noi_Mo_Tai_Khoan_TV}', desc: '(Liên danh) Nơi mở tài khoản thành viên liên danh' },
            { code: '{/Thanh_Vien_Lien_Danh}', desc: '(Liên danh) Kết thúc vòng lặp thành viên liên danh' },
            { code: '{/Danh_Sach_Nha_Thau}', desc: 'Kết thúc vòng lặp nhà thầu' },
            { code: '{#Danh_Sach_Nha_Thau_Truot}', desc: 'Bắt đầu vòng lặp danh sách nhà thầu trượt thầu' },
            { code: '{Ten_Nha_Thau}', desc: 'Tên nhà thầu trượt thầu' },
            { code: '{Ma_Nha_Thau}', desc: 'Mã định danh/MST nhà thầu trượt' },
            { code: '{Ly_Do_Truot}', desc: 'Lý do trượt thầu (phân tích tự động hoặc người dùng tự gõ)' },
            { code: '{/Danh_Sach_Nha_Thau_Truot}', desc: 'Kết thúc vòng lặp danh sách nhà thầu trượt' }
        ],
        phanlo: [
            { code: '{#Danh_Sach_Phan_Lo}', desc: 'Bắt đầu vòng lặp danh sách phân lô gói thầu' },
            { code: '{STT}', desc: 'Số thứ tự phân lô' },
            { code: '{Ten_Phan_Lo}', desc: 'Tên phân lô' },
            { code: '{Gia_Tri_Phan_Lo}', desc: 'Giá trúng thầu phân lô' },
            { code: '{Nha_Thau_Trung}', desc: 'Tên nhà thầu trúng thầu phân lô tương ứng' },
            { code: '{Thoi_Gian_Thuc_Hien}', desc: 'Thời gian thực hiện hợp đồng phân lô' },
            { code: '{/Danh_Sach_Phan_Lo}', desc: 'Kết thúc vòng lặp phân lô' }
        ],
        tuychonmuathem: [
            { code: '{#Danh_Sach_Tuy_Chon_Mua_Them}', desc: 'Bắt đầu vòng lặp tùy chọn mua thêm' },
            { code: '{STT}', desc: 'Số thứ tự tùy chọn mua thêm' },
            { code: '{Hang_Muc}', desc: 'Tên hạng mục tùy chọn mua thêm' },
            { code: '{Don_Vi}', desc: 'Đơn vị tính' },
            { code: '{So_Luong}', desc: 'Số lượng mua thêm' },
            { code: '{Ty_Le}', desc: 'Tỷ lệ % mua thêm' },
            { code: '{Gia_Tri_Uoc_Tinh}', desc: 'Giá trị ước tính mua thêm' },
            { code: '{/Danh_Sach_Tuy_Chon_Mua_Them}', desc: 'Kết thúc vòng lặp mua thêm' }
        ]
    };

    // Helper functions for labels mapping
    const getTableLabel = (tbl) => {
        const labels = {
            'chu_dau_tu': 'Chủ đầu tư',
            'ke_hoach_lcnt': 'Kế hoạch LCNT',
            'goi_thau': 'Gói thầu',
            'nha_thau': 'Nhà thầu',
            'hop_dong': 'Hợp đồng',
            'chuyen_gia': 'Chuyên gia',
            'thong_tin_mo_thau': 'Thông tin mở thầu',
            'tai_khoan': 'Tài khoản cá nhân',
            'to_chuc': 'Tổ chức / Doanh nghiệp',
            'goi_dich_vu': 'Gói dịch vụ'
        };
        return labels[tbl] || tbl;
    };

    const getColumnLabel = (tbl, col) => {
        const cols = {
            'chu_dau_tu': {
                'ten_chu_dau_tu': 'Tên chủ đầu tư',
                'ma_chu_dau_tu': 'Mã chủ đầu tư',
                'ma_so_thue': 'Mã số thuế',
                'chuc_vu_nguoi_dung_dau': 'Chức vụ người đứng đầu',
                'nguoi_ky_quyet_dinh': 'Người ký QĐ',
                'chuc_vu_nguoi_ky': 'Chức vụ người ký',
                'danh_xung': 'Danh xưng',
                'dia_chi': 'Địa chỉ',
                'so_dien_thoai': 'Số điện thoại',
                'email': 'Email',
                'so_tai_khoan': 'Số tài khoản',
                'noi_mo_tai_khoan': 'Nơi mở tài khoản',
                'ma_qhns': 'Mã QHNS',
                'co_quan_chu_quan': 'Cơ quan chủ quản',
                'phien_ban': 'Phiên bản'
            },
            'ke_hoach_lcnt': {
                'ten_ke_hoach': 'Tên kế hoạch LCNT',
                'ma_ke_hoach': 'Mã kế hoạch LCNT',
                'ma_du_an': 'Mã dự án',
                'ten_du_an_du_toan': 'Tên dự án / Dự toán',
                'loai_hinh_mua_sam': 'Loại hình mua sắm',
                'tong_muc_dau_tu': 'Tổng mức đầu tư',
                'quyet_dinh_phe_duyet': 'QĐ phê duyệt',
                'ngay_phe_duyet': 'Ngày phê duyệt',
                'thoi_gian_dang_tai': 'Thời gian đăng tải',
                'nguon_von': 'Nguồn vốn',
                'thoi_gian_du_an': 'Thời gian dự án',
                'dia_diem_quy_mo': 'Địa điểm quy mô',
                'thong_tin_khac': 'Thông tin khác',
                'so_qd_phe_duyet_du_an': 'Số QĐ phê duyệt dự án',
                'ngay_qd_phe_duyet_du_an': 'Ngày QĐ phê duyệt dự án',
                'co_quan_phe_duyet_du_an': 'Cơ quan phê duyệt dự án',
                'phien_ban': 'Phiên bản'
            },
            'goi_thau': {
                'ten_goi_thau': 'Tên gói thầu',
                'ma_goi_thau': 'Mã gói thầu',
                'gia_goi_thau': 'Giá gói thầu',
                'hinh_thuc_lua_chon': 'Hình thức LCNT',
                'phuong_thuc_lua_chon': 'Phương thức LCNT',
                'loai_hop_dong': 'Loại hợp đồng',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện',
                'nguon_von': 'Nguồn vốn',
                'gia_trung_thau': 'Giá trúng thầu',
                'linh_vuc': 'Lĩnh vực',
                'tuy_chon_mua_them': 'Tùy chọn mua thêm',
                'thoi_gian_to_chuc': 'Thời gian tổ chức',
                'thoi_gian_bat_dau_to_chuc': 'Thời gian bắt đầu tổ chức',
                'phan_lo': 'Phân lô',
                'thoi_gian_dang_tai': 'Thời gian đăng tải',
                'thoi_gian_dong_thau': 'Thời gian đóng thầu',
                'thoi_gian_mo_thau': 'Thời gian mở thầu',
                'so_quyet_dinh': 'Số QĐ phê duyệt',
                'ngay_quyet_dinh': 'Ngày QĐ phê duyệt',
                'so_quyet_dinh_ket_qua': 'Số QĐ kết quả',
                'ngay_quyet_dinh_ket_qua': 'Ngày QĐ kết quả',
                'thoi_gian_goi_thau': 'Thời gian gói thầu',
                'thoi_gian_hop_dong': 'Thời gian hợp đồng',
                'gia_tri_dam_bao_du_thau': 'Giá trị bảo đảm dự thầu',
                'hieu_luc_hsdt': 'Hiệu lực HSDT',
                'hieu_luc_dam_bao_du_thau': 'Hiệu lực bảo đảm dự thầu',
                'gia_han_list': 'Gia hạn thời gian mở thầu / đóng thầu',
                'yeu_cau_lam_ro_list': 'Làm rõ hồ sơ mời thầu (Yêu cầu)',
                'tra_loi_lam_ro_list': 'Trả lời làm rõ hồ sơ mời thầu',
                'trang_thai': 'Trạng thái',
                'phien_ban': 'Phiên bản'
            },
            'nha_thau': {
                'ten_nha_thau': 'Tên nhà thầu',
                'ma_nha_thau': 'Mã nhà thầu',
                'loai_nha_thau': 'Loại nhà thầu',
                'ma_so_thue': 'Mã số thuế',
                'nguoi_dai_dien': 'Người đại diện',
                'danh_xung': 'Danh xưng',
                'so_dien_thoai': 'Số điện thoại',
                'email': 'Email',
                'dia_chi': 'Địa chỉ',
                'so_tai_khoan': 'Số tài khoản',
                'noi_mo_tai_khoan': 'Nơi mở tài khoản',
                'ma_ngan_hang': 'Mã ngân hàng',
                'phien_ban': 'Phiên bản'
            },
            'hop_dong': {
                'ten_hop_dong': 'Tên hợp đồng',
                'so_hop_dong': 'Số hợp đồng',
                'ngay_ky': 'Ngày ký',
                'gia_tri': 'Giá trị hợp đồng',
                'loai_hop_dong': 'Loại hợp đồng',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện',
                'trang_thai_ho_so': 'Trạng thái hồ sơ'
            },
            'chuyen_gia': {
                'ho_ten': 'Họ tên chuyên gia',
                'so_cccd': 'Số CCCD',
                'ngay_cap_cccd': 'Ngày cấp CCCD',
                'noi_cap_cccd': 'Nơi cấp CCCD',
                'so_chung_chi': 'Số chứng chỉ',
                'ngay_cap_chung_chi': 'Ngày cấp chứng chỉ',
                'don_vi_cap_chung_chi': 'Đơn vị cấp chứng chỉ',
                'chuc_vu': 'Chức vụ trong tổ',
                'cong_viec': 'Nhiệm vụ phân công'
            },
            'thong_tin_mo_thau': {
                'gia_du_thau': 'Giá dự thầu',
                'dam_bao_du_thau': 'Bảo đảm dự thầu',
                'hieu_luc_dam_bao': 'Hiệu lực bảo đảm',
                'hieu_luc_hsdxt': 'Hiệu lực HSDXT',
                'ty_le_giam_gia': 'Tỷ lệ giảm giá',
                'gia_sau_giam_gia': 'Giá sau giảm giá',
                'hieu_luc_hsdt': 'Hiệu lực HSDT',
                'gia_tri_dam_bao': 'Giá trị bảo đảm',
                'hieu_luc_bao_dam_ngay': 'Hiệu lực bảo đảm (ngày)',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện',
                'ten_nha_thau': 'Tên nhà thầu',
                'loai_nha_thau': 'Loại nhà thầu',
                'danh_gia_hop_le': 'Đánh giá hợp lệ',
                'danh_gia_nang_luc': 'Đánh giá năng lực',
                'danh_gia_ky_thuat': 'Đánh giá kỹ thuật',
                'danh_gia_tai_chinh': 'Đánh giá tài chính',
                'danh_gia_ket_luan': 'Đánh giá kết luận',
                'ly_do_truot': 'Lý do trượt',
                'lam_ro_hop_le': 'Làm rõ hợp lệ',
                'lam_ro_nang_luc': 'Làm rõ năng lực',
                'lam_ro_ky_thuat': 'Làm rõ kỹ thuật',
                'lam_ro_tai_chinh': 'Làm rõ tài chính'
            },
            'tai_khoan': {
                'ten_dang_nhap': 'Tên đăng nhập',
                'ho_ten': 'Họ và tên',
                'email': 'Email',
                'so_dien_thoai': 'Số điện thoại',
                'chuc_vu': 'Chức vụ'
            },
            'to_chuc': {
                'ten_to_chuc': 'Tên tổ chức',
                'ma_so_thue': 'Mã số thuế',
                'dia_chi': 'Địa chỉ',
                'nguoi_dai_dien': 'Người đại diện'
            },
            'goi_dich_vu': {
                'ten_goi': 'Tên gói dịch vụ',
                'gia_goi': 'Giá gói dịch vụ',
                'thoi_han_thang': 'Thời hạn (tháng)'
            }
        };
        return (cols[tbl] && cols[tbl][col]) || col;
    };

    // Append custom user mappings if group is global
    let variables = DICTIONARY[group] || [];
    if (group === 'global' && this.model.state && this.model.state.wordMappings) {
        const customVars = this.model.state.wordMappings.map(m => ({
            code: `{${m.tenBien}}`,
            desc: `Biến tự định nghĩa (Ánh xạ: Bảng ${getTableLabel(m.sourceTable)} -> ${getColumnLabel(m.sourceTable, m.sourceColumn)})`,
            isCustom: true,
            id: m.id,
            sourceTable: m.sourceTable,
            sourceColumn: m.sourceColumn,
            tenBien: m.tenBien
        }));
        variables = [...variables, ...customVars];
    }

    if (variables.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted" style="padding: 24px;">Chưa có biến nào trong nhóm này.</td></tr>`;
        return;
    }

    tbody.innerHTML = variables.map(v => {
        let actionHTML = '';
        if (v.isCustom) {
            actionHTML = `
                <div class="action-btn-group" style="justify-content: flex-end; gap: 8px;">
                    <button class="btn btn-outline btn-sm btn-copy-var" data-copy="${v.code}" title="Sao chép" style="padding: 4px 8px; font-size: 0.75rem;">
                        <i data-lucide="copy" style="width:12px; height:12px;"></i>
                    </button>
                    <button class="action-btn btn-edit" onclick="window.editWordMapping('${v.id}')" title="Sửa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                        <i data-lucide="edit-2" style="width:12px; height:12px; color: var(--text-muted);"></i>
                    </button>
                    <button class="action-btn btn-delete" onclick="window.deleteWordMapping('${v.id}')" title="Xóa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                        <i data-lucide="trash-2" style="width:12px; height:12px; color: var(--danger);"></i>
                    </button>
                </div>
            `;
        } else {
            actionHTML = `
                <button class="btn btn-outline btn-sm btn-copy-var" data-copy="${v.code}" style="padding: 4px 8px; font-size: 0.75rem;">
                    <i data-lucide="copy" style="width:12px; height:12px;"></i> Sao chép
                </button>
            `;
        }

        let descHTML = '';
        if (v.isCustom) {
            descHTML = `
                <span class="badge badge-info" style="font-size:0.7rem; padding: 2px 6px;">${getTableLabel(v.sourceTable)}</span>
                <span style="color:var(--text-muted); margin:0 4px;">&rarr;</span>
                <span class="fw-bold" style="font-size: 0.8rem;">${getColumnLabel(v.sourceTable, v.sourceColumn)}</span>
            `;
        } else {
            descHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">${v.desc}</span>`;
        }

        return `
            <tr>
                <td><code style="font-size:0.82rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:4px 8px; border-radius:4px;">${v.code}</code></td>
                <td>${descHTML}</td>
                <td class="text-right">${actionHTML}</td>
            </tr>
        `;
    }).join('');
    lucide.createIcons({ root: tbody });
}

export function renderWordMappingsTable(mappingsList = []) {
    // Merged table updates: refresh dictionary table rendering
    const dictionarySelect = document.getElementById('dictionary-group-select');
    const group = dictionarySelect ? dictionarySelect.value : 'global';
    renderDictionary.call(this, group);
}

export function renderWordTemplates(templatesList = []) {
    this.renderBieumauTab(templatesList);
}

export function getJointVentureMemberHTML(cardId, memberData = null) {
    return `
        <button type="button" class="btn-remove-member" onclick="window.removeJointVentureMemberCard('${cardId}')" style="position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 1.25rem; color: var(--danger); cursor: pointer;">&times;</button>
        <h5 style="margin: 0 0 12px 0; font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">Thành viên liên danh</h5>
        <div class="form-grid">
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label class="nt-member-ten-label">Tên nhà thầu thành viên <span class="required">*</span></label>
                <input type="text" class="nt-member-ten" required placeholder="Ví dụ: Công ty A" value="${memberData ? memberData.tenNhaThau : ''}">
                <span class="error-text">Vui lòng nhập tên nhà thầu</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Mã số thuế <span class="required">*</span></label>
                <input type="text" class="nt-member-mst" required placeholder="Mã số thuế" value="${memberData ? memberData.maSoThue : ''}">
                <span class="error-text">Vui lòng nhập mã số thuế</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Người đại diện <span class="required">*</span></label>
                <input type="text" class="nt-member-nguoidaidien" required placeholder="Họ tên người đại diện" value="${memberData ? memberData.nguoiDaiDien : ''}">
                <span class="error-text">Vui lòng nhập người đại diện</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Danh xưng <span class="required">*</span></label>
                <select class="nt-member-danhxung" required>
                    <option value="Ông" ${(memberData && memberData.danhXung === 'Ông') ? 'selected' : ''}>Ông</option>
                    <option value="Bà" ${(memberData && memberData.danhXung === 'Bà') ? 'selected' : ''}>Bà</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Điện thoại</label>
                <input type="tel" class="nt-member-sdt" placeholder="Số điện thoại" value="${memberData ? memberData.soDienThoai : ''}">
                <span class="error-text">Vui lòng nhập số điện thoại</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label>Email</label>
                <input type="email" class="nt-member-email" placeholder="contact@nhathau.com" value="${memberData ? memberData.email : ''}">
                <span class="error-text">Vui lòng nhập email hợp lệ</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label>Địa chỉ <span class="required">*</span></label>
                <input type="text" class="nt-member-diachi" required placeholder="Địa chỉ chi tiết" value="${memberData ? memberData.diaChi : ''}">
                <span class="error-text">Vui lòng nhập địa chỉ</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Số tài khoản <span class="required">*</span></label>
                <input type="text" class="nt-member-sotaikhoan" required placeholder="Số tài khoản" value="${memberData ? memberData.soTaiKhoan : ''}">
                <span class="error-text">Vui lòng nhập số tài khoản</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Nơi mở tài khoản <span class="required">*</span></label>
                <input type="text" class="nt-member-noimotaikhoan" required placeholder="Tên ngân hàng" value="${memberData ? memberData.noiMoTaiKhoan : ''}">
                <span class="error-text">Vui lòng nhập nơi mở</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 0;">
                <label>Mã ngân hàng</label>
                <input type="text" class="nt-member-manganhang" placeholder="Mã ngân hàng" value="${memberData ? memberData.maNganHang || '' : ''}">
            </div>
        </div>
    `;
}

export function showHopDongDetails(id) {
    const detailPane = document.getElementById('tab-hopdong-detail');
    if (!detailPane || !detailPane.classList.contains('active')) {
        window.switchTab('hopdong-detail', id);
        return;
    }
    const hd = this.model.state.hopdong.find(h => h.id === id);
    if (!hd) return;

    const editBtn = document.getElementById('btn-edit-hopdong-fullpage');
    if (editBtn) {
        editBtn.onclick = () => {
            window.editHopDong(id);
        };
    }

    this.renderContractVersionDetails(id);
}

export function renderContractVersionDetails(versionId) {
    const hd = this.model.state.hopdong.find(h => h.id === versionId);
    if (!hd) return;

    const cdt = this.model.state.chudautu.find(c => c.id === hd.chuDauTuId);
    const nt = this.model.state.nhathau.find(n => n.id === hd.nhaThauId);
    const kh = this.model.getLatestPlan(hd.keHoachId);

    const goithauList = typeof this.model.getLatestPackages === 'function' ? this.model.getLatestPackages() : (this.model.state.goithau || []);
    const linkedPkgs = (hd.goiThauIds || []).map(gtId => {
        return goithauList.find(g => g.id === gtId);
    }).filter(Boolean);

    const custompaperstatuses = this.model.state.custompaperstatuses || [];
    const statusObj = custompaperstatuses.find(s => s.name === hd.trangThaiHoSo);
    const statusColor = statusObj ? statusObj.color : '#6b7280';
    const statusBadge = hd.trangThaiHoSo
        ? `<span class="status-pill" style="background-color: ${statusColor}; color: white; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem;">${hd.trangThaiHoSo}</span>`
        : '<span class="text-muted">Chưa cập nhật</span>';

    const rootId = hd.rootId || hd.id;
    const allRelated = this.model.state.hopdong.filter(h => (h.rootId || h.id) === rootId);
    const verMap = {};
    allRelated.forEach(h => {
        const ver = h.phienBan || h.phien_ban || '00';
        if (!verMap[ver] || h.isLatest == 1 || h.is_latest == 1) {
            verMap[ver] = h;
        }
    });
    const allVersions = Object.values(verMap);
    allVersions.sort((a, b) => {
        const valA = parseInt(a.phienBan || a.phien_ban || 0);
        const valB = parseInt(b.phienBan || b.phien_ban || 0);
        return valB - valA;
    });

    const selectOptionsHtml = allVersions.map(h => {
        const ver = h.phienBan || h.phien_ban || '00';
        const label = `V${parseInt(ver)}`;
        return `<option value="${h.id}" ${h.id === versionId ? 'selected' : ''}>${label}</option>`;
    }).join('');

    const versionSelectHtml = `
        <select id="fullpage-hd-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;">
            ${selectOptionsHtml}
        </select>
    `;

    const html = `
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box;">${hd.soHopDong || '--'}</span>
                    ${versionSelectHtml}
                </div>
                <h4 class="detail-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${hd.tenHopDong || 'Hợp đồng không có tên'}</h4>
                <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    ${statusBadge}
                </div>
            </div>
            
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Số hợp đồng</div>
                    <div class="detail-value fw-bold text-blue">${hd.soHopDong || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày ký hợp đồng</div>
                    <div class="detail-value">${hd.ngayKy ? formatDate(hd.ngayKy) : '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Giá trị hợp đồng</div>
                    <div class="detail-value text-blue fw-bold" style="font-size: 1.15rem;">${formatCurrency(hd.giaTri)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại hợp đồng</div>
                    <div class="detail-value"><span class="badge badge-info">${hd.loaiHopDong || 'Trọn gói'}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phân loại</div>
                    <div class="detail-value"><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">${hd.phanLoai || 'Tư vấn'}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian thực hiện</div>
                    <div class="detail-value">${hd.soNgayThucHien ? (isNaN(hd.soNgayThucHien) ? hd.soNgayThucHien : hd.soNgayThucHien + ' ngày') : '--'}</div>
                </div>
            </div>

            <div class="detail-grid" style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                <div class="detail-item">
                    <div class="detail-label">Quyết định chỉ định thầu</div>
                    <div class="detail-value">${hd.coQdChiDinh === 1 ? '<span class="badge badge-success">Có quyết định</span>' : '<span class="badge badge-secondary">Không</span>'}</div>
                </div>
                ${hd.coQdChiDinh === 1 ? `
                    <div class="detail-item">
                        <div class="detail-label">Số quyết định chỉ định</div>
                        <div class="detail-value fw-bold">${hd.soQdChiDinh || '--'}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Ngày quyết định chỉ định</div>
                        <div class="detail-value">${hd.ngayKy ? formatDate(hd.ngayQdChiDinh) : '--'}</div>
                    </div>
                ` : ''}
            </div>

            <div class="detail-sub-section" style="margin-top: 24px;">
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

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title">Thông tin Nhà thầu trúng thầu</h5>
                ${nt ? `
                    <div class="associated-item">
                        <div>
                            <strong style="font-size: 0.9rem;">${nt.tenNhaThau}</strong><br>
                            <small class="text-muted">Mã số thuế: ${nt.maSoThue} | Đại diện: ${nt.nguoiDaiDien || '--'}</small>
                        </div>
                        <span class="associated-badge">${nt.maNhaThau || 'NHA_THAU'}</span>
                    </div>
                ` : '<div class="text-muted"><small>Không tìm thấy thông tin nhà thầu.</small></div>'}
            </div>

            ${kh ? `
                <div class="detail-sub-section" style="margin-top: 24px;">
                    <h5 class="detail-sub-title">Kế hoạch lựa chọn nhà thầu liên kết</h5>
                    <div class="associated-item" style="cursor: pointer;" onclick="window.showKeHoachDetails('${kh.id}')">
                        <div>
                            <strong style="font-size: 0.9rem; color: var(--primary);">${kh.tenKeHoach}</strong><br>
                            <small class="text-muted">Mã KH: ${kh.maKeHoach} | Tổng mức: ${formatCurrency(kh.tongMucDauTu)}</small>
                        </div>
                    </div>
                </div>
            ` : ''}

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">Các gói thầu thuộc hợp đồng (${linkedPkgs.length})</h5>
                <div class="associated-list">
                    ${linkedPkgs.length > 0 ? linkedPkgs.map(gt => `
                        <div class="associated-item" style="cursor: pointer;" onclick="window.showPackageDetails('${gt.id}')">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue" style="width:16px;"></i>
                                <span><strong>${gt.maGoiThau}</strong> - ${gt.tenGoiThau}</span>
                            </div>
                            <span class="badge badge-success">${formatCurrency(gt.giaGoiThau)}</span>
                        </div>
                    `).join('') : '<div class="text-muted"><small>Hợp đồng này chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;

    const contentEl = document.getElementById('fullpage-hopdong-content');
    if (contentEl) {
        contentEl.innerHTML = html;
        const innerSelect = document.getElementById('fullpage-hd-version-select');
        if (innerSelect) {
            innerSelect.onchange = (e) => {
                this.renderContractVersionDetails(e.target.value);
            };
            if (window.initCustomSelect) window.initCustomSelect('fullpage-hd-version-select');
        }
        lucide.createIcons();
    }
}

