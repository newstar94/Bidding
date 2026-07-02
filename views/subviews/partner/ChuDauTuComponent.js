import { initCustomSelect } from '../view_helpers.js';

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
                const label = String(parseInt(v.phienBan || v.phien_ban || 0)).padStart(2, '0');
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
                        <a href="#" onclick="event.preventDefault(); window.showChuDauTuDetails('${displayedCdt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Chủ đầu tư" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${displayedCdt.maChuDauTu || ''}</span></a>
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
                        ${displayedCdt.id === c.id ? `
                        <button class="action-btn btn-edit" onclick="window.editChuDauTu('${displayedCdt.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteChuDauTu('${displayedCdt.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                        ` : ''}
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

export function showChuDauTuDetails(id, isSwitchingVersion = false) {
    const detailPane = document.getElementById('tab-chudautu-detail');
    if (!detailPane || !detailPane.classList.contains('active')) {
        window.switchTab('chudautu-detail', id);
        return;
    }

    const cdt = this.model.state.chudautu.find(c => c.id === id);
    if (!cdt) return;

    this.renderChuDauTuVersionDetails(id);
}

export function renderChuDauTuVersionDetails(versionId) {
    const cdt = this.model.state.chudautu.find(c => c.id === versionId);
    if (!cdt) return;

    const root = cdt.rootId || cdt.id;
    const allRelated = (this.model.state.chudautu || []).filter(c => c.rootId === root || c.id === root);
    allRelated.sort((a, b) => (parseInt(b.phienBan || b.phien_ban || 0) - parseInt(a.phienBan || a.phien_ban || 0)));
    const isLatest = allRelated[0] && allRelated[0].id === versionId;

    const editBtn = document.getElementById('btn-edit-chudautu-fullpage');
    if (editBtn) {
        if (isLatest) {
            editBtn.style.display = 'flex';
            editBtn.onclick = () => {
                window.editChuDauTu(versionId);
            };
        } else {
            editBtn.style.display = 'none';
        }
    }

    const selectOptionsHtml = allRelated.map(v => {
        const ver = String(parseInt(v.phienBan || v.phien_ban || 0)).padStart(2, '0');
        return `<option value="${v.id}" ${v.id === versionId ? 'selected' : ''}>${ver}</option>`;
    }).join('');

    const versionSelectHtml = `
        <select id="fullpage-cdt-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;" ${allRelated.length < 2 ? 'disabled' : ''}>
            ${selectOptionsHtml}
        </select>
    `;

    const addressParts = (cdt.diaChi || '').split(' | ');
    const addressStr = addressParts.filter(Boolean).join(', ');

    const html = `
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box;">${cdt.maChuDauTu || '--'}</span>
                        <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                        ${versionSelectHtml}
                    </div>
                </div>
                <h4 class="detail-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${cdt.tenChuDauTu || 'Chủ đầu tư chưa có tên'}</h4>
            </div>
            
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Mã số thuế</div>
                    <div class="detail-value fw-bold">${cdt.maSoThue || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Người ký quyết định</div>
                    <div class="detail-value">${cdt.nguoiKyQuyetDinh ? cdt.danhXung + ' ' + cdt.nguoiKyQuyetDinh : '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người ký</div>
                    <div class="detail-value">${cdt.chucVuNguoiKy || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đứng đầu</div>
                    <div class="detail-value">${cdt.chucVuNguoiDungDau || '--'}</div>
                </div>
                <div class="detail-item" style="grid-column: span 2;">
                    <div class="detail-label">Địa chỉ</div>
                    <div class="detail-value">${addressStr || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số điện thoại</div>
                    <div class="detail-value">${cdt.soDienThoai || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Email liên hệ</div>
                    <div class="detail-value">${cdt.email || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số tài khoản</div>
                    <div class="detail-value fw-bold text-blue">${cdt.soTaiKhoan || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Nơi mở tài khoản</div>
                    <div class="detail-value">${cdt.noiMoTaiKhoan || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã QHNS</div>
                    <div class="detail-value">${cdt.maQHNS || '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Cơ quan chủ quản</div>
                    <div class="detail-value">${cdt.coQuanChuQuan || '--'}</div>
                </div>
            </div>
        </div>
    `;

    const contentEl = document.getElementById('fullpage-chudautu-content');
    if (contentEl) {
        contentEl.innerHTML = html;
        const innerSelect = document.getElementById('fullpage-cdt-version-select');
        if (innerSelect) {
            if (allRelated.length >= 2) {
                innerSelect.onchange = (e) => {
                    this.renderChuDauTuVersionDetails(e.target.value);
                };
            } else {
                innerSelect.onchange = null;
            }
            if (window.initCustomSelect) window.initCustomSelect('fullpage-cdt-version-select');
        }
        lucide.createIcons();
    }
}
