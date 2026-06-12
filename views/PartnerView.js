/* ==========================================================================
   BiddingFlow - PartnerView (Part of View split)
   ========================================================================== */

export async function renderChuDauTuTable() {
    const tableBody = document.getElementById('chudautu-table').querySelector('tbody');
    const searchVal = document.getElementById('search-chudautu').value.toLowerCase();

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.chudautu || 1;
    const pageSize = this.model.pageSize || 10;

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=chudautu&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}`, {
                headers: {
                    'X-Session-Token': localStorage.getItem('bf_session_token') || '',
                    'X-Username': localStorage.getItem('bf_username') || ''
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
                <select class="form-control version-droplist" onchange="window.changeChuDauTuRowVersion('${root}', this.value)" style="width: 70px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
                    ${optionsHtml}
                </select>
            `;

            return `
            <tr>
                <td>
                    <a href="#" onclick="event.preventDefault(); window.editChuDauTu('${displayedCdt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Chủ đầu tư">
                        <span class="detail-code">${displayedCdt.maChuDauTu || ''}</span>
                    </a>
                </td>
                <td>
                    ${dropdownHtml}
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
}

export async function renderNhaThauTable() {
    const tableBody = document.getElementById('nhathau-table').querySelector('tbody');
    const searchVal = document.getElementById('search-nhathau').value.toLowerCase();

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.nhathau || 1;
    const pageSize = this.model.pageSize || 10;

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=nhathau&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}`, {
                headers: {
                    'X-Session-Token': localStorage.getItem('bf_session_token') || '',
                    'X-Username': localStorage.getItem('bf_username') || ''
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
                <select class="form-control version-droplist" onchange="window.changeNhaThauRowVersion('${root}', this.value)" style="width: 70px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
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
                            <a href="#" onclick="event.preventDefault(); window.editNhaThau('${displayedNt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Nhà thầu">
                                <span class="detail-code">${displayedNt.maNhaThau || ''}</span>
                            </a>
                        </td>
                        <td>
                            ${dropdownHtml}
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
                            <a href="#" onclick="event.preventDefault(); window.editNhaThau('${displayedNt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Nhà thầu">
                                <span class="detail-code">${displayedNt.maNhaThau || ''}</span>
                            </a>
                        </td>
                        <td>
                            ${dropdownHtml}
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

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=chuyengia&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}`, {
                headers: {
                    'X-Session-Token': localStorage.getItem('bf_session_token') || '',
                    'X-Username': localStorage.getItem('bf_username') || ''
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
        const filtered = this.model.state.chuyengia.filter(cg =>
            (cg.hoTen || '').toLowerCase().includes(searchVal) ||
            (cg.soCCCD || '').includes(searchVal) ||
            (cg.soChungChi || '').toLowerCase().includes(searchVal)
        );
        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6">
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
        tableBody.innerHTML = slicedData.map(cg => `
            <tr>
                <td class="fw-bold"><a href="#" onclick="event.preventDefault(); window.showChuyenGiaDetails('${cg.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết lý lịch">${cg.hoTen || ''}</a></td>
                <td><code>${cg.soCCCD || ''}</code></td>
                <td><span class="badge badge-info">${cg.soChungChi || ''}</span></td>
                <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${cg.donViCapChungChi || '--'}</td>
                <td>${cg.ngayCapChungChi ? this.model.formatDate(cg.ngayCapChungChi) : '--'}</td>
                <td class="text-right">
                    ${isEmployee ? '' : `
                    <div class="action-btn-group">
                        <button class="action-btn btn-edit" onclick="window.editChuyenGia('${cg.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteChuyenGia('${cg.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                    `}
                </td>
            </tr>
        `).join('');

        if (window.renderTablePagination) {
            window.renderTablePagination('chuyengia-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons({ root: tableBody });
}

export async function renderHopDongTable() {
    const tableBody = document.getElementById('hopdong-table').querySelector('tbody');
    const searchVal = document.getElementById('search-hopdong').value.toLowerCase();

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.hopdong || 1;
    const pageSize = this.model.pageSize || 10;

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=hopdong&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}`, {
                headers: {
                    'X-Session-Token': localStorage.getItem('bf_session_token') || '',
                    'X-Username': localStorage.getItem('bf_username') || ''
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
        const latestHopDong = this.model.getFilteredHopDong();
        const filtered = latestHopDong.filter(h =>
            (h.soHopDong || '').toLowerCase().includes(searchVal) ||
            (h.tenHopDong || '').toLowerCase().includes(searchVal)
        );
        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10">
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
            const chudautuList = Array.isArray(this.model.state.chudautu) ? this.model.state.chudautu : [];
            const cdt = chudautuList.find(c => c.id === h.chuDauTuId);
            const cdtName = cdt ? cdt.tenChuDauTu : '--';

            const nhathauList = Array.isArray(this.model.state.nhathau) ? this.model.state.nhathau : [];
            const nt = nhathauList.find(n => n.id === h.nhaThauId);
            const ntName = nt ? nt.tenNhaThau : '--';

            const goithauList = typeof this.model.getLatestPackages === 'function' ? this.model.getLatestPackages() : (Array.isArray(this.model.state.goithau) ? this.model.state.goithau : []);
            const linkedPkgs = (h.goiThauIds || []).map(gtId => {
                const gt = goithauList.find(g => g.id === gtId);
                if (!gt) return '';
                return `<a href="#" onclick="event.preventDefault(); window.showPackageDetails('${gt.id}')" style="margin:2px; display:inline-block;" title="${gt.tenGoiThau || ''}"><span class="detail-code link-hover">${gt.maGoiThau || 'Gói'}</span></a>`;
            }).filter(Boolean).join(' ');

            const custompaperstatuses = Array.isArray(this.model.state.custompaperstatuses) ? this.model.state.custompaperstatuses : [];
            const statusObj = custompaperstatuses.find(s => s.name === h.trangThaiHoSo);
            const statusColor = statusObj ? statusObj.color : '#6b7280';
            const statusBadge = h.trangThaiHoSo
                ? `<span class="status-pill" style="background-color: ${statusColor}; color: white; padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 0.78rem;">${h.trangThaiHoSo}</span>`
                : '<span class="text-muted" style="font-size:0.8rem;">Chưa cập nhật</span>';

            return `
                <tr>
                    <td><a href="#" onclick="event.preventDefault(); window.editHopDong('${h.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết / Sửa Hợp đồng"><span class="detail-code link-hover">${h.soHopDong}</span></a></td>
                    <td style="min-width: 200px; max-width: 300px;" class="fw-bold text-wrap">${h.tenHopDong}</td>
                    <td>${h.ngayKy ? this.model.formatDate(h.ngayKy) : '--'}</td>
                    <td style="font-size:0.85rem; min-width: 180px; max-width: 280px;" class="text-wrap">${cdtName}</td>
                    <td style="font-size:0.85rem; min-width: 180px; max-width: 280px;" class="text-wrap">${ntName}</td>
                    <td class="fw-bold text-blue">${this.model.formatCurrency(h.giaTri)}</td>
                    <td><span class="badge badge-info">${h.loaiHopDong || 'Trọn gói'}</span></td>
                    <td>${h.soNgayThucHien ? (isNaN(h.soNgayThucHien) ? h.soNgayThucHien : h.soNgayThucHien + ' ngày') : '--'}</td>
                    <td>${linkedPkgs || '<span class="text-danger" style="font-weight: 500;">Chưa liên kết</span>'}</td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            <button class="action-btn btn-edit" onclick="window.editHopDong('${h.id}')" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
                            <button class="action-btn btn-delete" onclick="window.deleteHopDong('${h.id}')" title="Xóa">
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
                        <div class="passport-detail-val">${cg.ngayCapCCCD ? this.model.formatDate(cg.ngayCapCCCD) : '--'}</div>
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
                            <div class="passport-detail-val">${cg.ngayCapChungChi ? this.model.formatDate(cg.ngayCapChungChi) : '--'}</div>
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
        global: [
            { code: '{Ten_Chu_Dau_Tu}', desc: 'Tên Chủ đầu tư (Bên mời thầu)' },
            { code: '{Ma_Chu_Dau_Tu}', desc: 'Mã Chủ đầu tư' },
            { code: '{Dia_Chi_Day_Du_CDT}', desc: 'Địa chỉ đầy đủ Chủ đầu tư (gồm Xã, Tỉnh)' },
            { code: '{Tinh_Rieng_CDT}', desc: 'Tên Tỉnh/Thành phố riêng của Chủ đầu tư (đã xóa tiền tố)' },
            { code: '{Xa_Rieng_CDT}', desc: 'Tên Xã/Phường riêng của Chủ đầu tư (đã xóa tiền tố)' },
            { code: '{Dia_Chi_Rut_Gon_CDT}', desc: 'Địa chỉ rút gọn Chủ đầu tư (tên Tỉnh/Thành phố riêng)' },
            { code: '{SDT_CDT}', desc: 'Số điện thoại Chủ đầu tư' },
            { code: '{Email_CDT}', desc: 'Email Chủ đầu tư' },
            { code: '{MST_CDT}', desc: 'Mã số thuế Chủ đầu tư' },
            { code: '{Nguoi_Dai_Dien_CDT}', desc: 'Người đại diện pháp luật của Chủ đầu tư' },
            { code: '{Chuc_Vu_CDT}', desc: 'Chức vụ người đại diện Chủ đầu tư' },
            { code: '{So_Tai_Khoan_CDT}', desc: 'Số tài khoản ngân hàng Chủ đầu tư' },
            { code: '{Noi_Mo_Tai_Khoan_CDT}', desc: 'Ngân hàng mở tài khoản Chủ đầu tư' },
            { code: '{Co_Quan_Chu_Quan}', desc: 'Cơ quan chủ quản của Chủ đầu tư' },
            { code: '{So_Quyet_Dinh}', desc: 'Số Quyết định phê duyệt kế hoạch' },
            { code: '{Ngay_Phe_Duyet}', desc: 'Ngày ký Quyết định phê duyệt (dd/MM/yyyy)' },
            { code: '{Ten_Ke_Hoach}', desc: 'Tên Kế hoạch LCNT' },
            { code: '{Ma_Ke_Hoach}', desc: 'Mã Kế hoạch LCNT' },
            { code: '{Ma_Du_An}', desc: 'Mã dự án (nếu loại hình là Dự án)' },
            { code: '{Tong_Muc_Dau_Tu}', desc: 'Tổng mức đầu tư (đã định dạng VND)' },
            { code: '{Nguon_Von}', desc: 'Nguồn vốn' },
            { code: '{Ten_Goi_Thau}', desc: 'Tên Gói thầu' },
            { code: '{Ma_Goi_Thau}', desc: 'Mã thông báo mời thầu' },
            { code: '{Gia_Goi_Thau}', desc: 'Giá dự toán gói thầu (đã định dạng VND)' },
            { code: '{Phuong_Thuc_Lua_Chon}', desc: 'Phương thức lựa chọn nhà thầu' },
            { code: '{Hinh_Thuc_LCNT}', desc: 'Hình thức lựa chọn nhà thầu (đấu thầu rộng rãi,...)' },
            { code: '{Loai_Hop_Dong}', desc: 'Loại hợp đồng áp dụng' },
            { code: '{Thoi_Gian_Thuc_Hien}', desc: 'Thời gian thực hiện hợp đồng (số ngày)' },
            { code: '{Linh_Vuc}', desc: 'Lĩnh vực gói thầu (Hàng hóa / Xây lắp / Tư vấn / Phi tư vấn)' },
            { code: '{Thoi_Gian_Dong_Thau}', desc: 'Thời gian đóng thầu / hạn nộp hồ sơ dự thầu' },
            { code: '{Thoi_Gian_Mo_Thau}', desc: 'Thời gian mở thầu' },
            { code: '{Gia_Tri_Bao_Dam}', desc: 'Giá trị bảo đảm dự thầu (VND)' },
            { code: '{Loai_Nha_Thau}', desc: 'Hình thức nhà thầu trúng thầu (Liên danh / Độc lập)' },
            { code: '{Ten_Nha_Thau_Trung}', desc: 'Tên nhà thầu trúng thầu (tên liên danh hoặc nhà thầu độc lập)' },
            { code: '{Ma_Nha_Thau_Trung}', desc: 'Mã nhà thầu trúng thầu' },
            { code: '{MST_Nha_Thau_Trung}', desc: 'Mã số thuế nhà thầu trúng thầu' },
            { code: '{Nguoi_Dai_Dien_NT}', desc: 'Người đại diện nhà thầu trúng thầu' },
            { code: '{Dia_Chi_NT}', desc: 'Địa chỉ nhà thầu trúng thầu' },
            { code: '{So_Tai_Khoan_NT}', desc: 'Số tài khoản ngân hàng nhà thầu trúng thầu' },
            { code: '{Noi_Mo_Tai_Khoan_NT}', desc: 'Ngân hàng mở tài khoản nhà thầu trúng thầu' },
            { code: '{Gia_Du_Thau}', desc: 'Giá dự thầu ban đầu' },
            { code: '{Gia_Sau_Giam_Gia}', desc: 'Giá dự thầu sau giảm giá' },
            { code: '{Ty_Le_Giam_Gia}', desc: 'Tỷ lệ giảm giá (%)' },
            { code: '{So_Hop_Dong}', desc: 'Số hợp đồng' },
            { code: '{Ten_Hop_Dong}', desc: 'Tên hợp đồng' },
            { code: '{Ngay_Ky_Hop_Dong}', desc: 'Ngày ký hợp đồng (dd/MM/yyyy)' },
            { code: '{Gia_Tri_Hop_Dong}', desc: 'Giá trị hợp đồng (đã định dạng VND)' },
            { code: '{So_Ngay_Thuc_Hien}', desc: 'Số ngày thực hiện hợp đồng' },
            { code: '{Ngay_Hien_Tai}', desc: 'Ngày hiện tại (dd/MM/yyyy)' },
            { code: '{Ngay_}', desc: 'Ngày (dd) của ngày hiện tại' },
            { code: '{Thang_}', desc: 'Tháng (MM) của ngày hiện tại' },
            { code: '{Nam_}', desc: 'Năm (yyyy) của ngày hiện tại' }
        ],
        experts: [
            { code: '{#Danh_Sach_Chuyen_Gia}', desc: 'Bắt đầu vòng lặp danh sách chuyên gia tổ chuyên gia' },
            { code: '{STT}', desc: 'Số thứ tự trong danh sách' },
            { code: '{Ho_Ten}', desc: 'Họ và tên chuyên gia' },
            { code: '{So_CCCD}', desc: 'Số Căn cước công dân' },
            { code: '{Ngay_Cap_CCCD}', desc: 'Ngày cấp Căn cước công dân' },
            { code: '{Noi_Cap_CCCD}', desc: 'Nơi cấp Căn cước công dân' },
            { code: '{So_Chung_Chi}', desc: 'Số Chứng chỉ hành nghề đấu thầu' },
            { code: '{Ngay_Cap_Chung_Chi}', desc: 'Ngày cấp chứng chỉ (dd/MM/yyyy)' },
            { code: '{Don_Vi_Cap_Chung_Chi}', desc: 'Đơn vị cấp chứng chỉ hành nghề' },
            { code: '{Chuc_Vu}', desc: 'Chức vụ trong tổ chuyên gia (Tổ trưởng / Thành viên)' },
            { code: '{/Danh_Sach_Chuyen_Gia}', desc: 'Kết thúc vòng lặp chuyên gia' }
        ],
        contractors: [
            { code: '{#Danh_Sach_Nha_Thau}', desc: 'Bắt đầu vòng lặp danh sách nhà thầu tham dự' },
            { code: '{STT}', desc: 'Số thứ tự trong danh sách' },
            { code: '{Ten_Nha_Thau}', desc: 'Tên nhà thầu (tên liên danh hoặc tên độc lập)' },
            { code: '{Loai_Nha_Thau}', desc: 'Loại hình nhà thầu (Độc lập / Liên danh)' },
            { code: '{Ma_So_Thue}', desc: 'Mã số thuế / mã định danh nhà thầu' },
            { code: '{Nguoi_Dai_Dien}', desc: 'Người đại diện pháp luật' },
            { code: '{So_Dien_Thoai}', desc: 'Số điện thoại liên hệ' },
            { code: '{Email}', desc: 'Email liên hệ nhà thầu' },
            { code: '{Dia_Chi}', desc: 'Địa chỉ nhà thầu' },
            { code: '{Gia_Du_Thau}', desc: 'Giá dự thầu (VND)' },
            { code: '{Ty_Le_Giam_Gia}', desc: 'Tỷ lệ giảm giá (%)' },
            { code: '{Gia_Sau_Giam}', desc: 'Giá dự thầu sau giảm giá' },
            { code: '{Hieu_Luc_HSDT}', desc: 'Hiệu lực hồ sơ dự thầu (ngày)' },
            { code: '{Gia_Tri_Dam_Bao}', desc: 'Giá trị bảo đảm dự thầu' },
            { code: '{Hieu_Luc_Dam_Bao}', desc: 'Hiệu lực bảo đảm dự thầu (ngày)' },
            { code: '{Thoi_Gian_Thuc_Hien}', desc: 'Thời gian thực hiện đề xuất (ngày)' },
            { code: '{#Thanh_Vien_Lien_Danh}', desc: '(Liên danh) Bắt đầu vòng lặp thành viên liên danh' },
            { code: '{Ten_TV}', desc: '(Liên danh) Tên thành viên liên danh' },
            { code: '{MST_TV}', desc: '(Liên danh) Mã số thuế thành viên liên danh' },
            { code: '{Vai_Tro_TV}', desc: '(Liên danh) Vai trò thành viên (Đứng đầu / Thành viên)' },
            { code: '{/Thanh_Vien_Lien_Danh}', desc: '(Liên danh) Kết thúc vòng lặp thành viên' },
            { code: '{/Danh_Sach_Nha_Thau}', desc: 'Kết thúc vòng lặp nhà thầu' }
        ]
    };

    const variables = DICTIONARY[group] || [];
    tbody.innerHTML = variables.map(v => `
        <tr>
            <td><code style="font-size:0.85rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:4px 8px; border-radius:4px;">${v.code}</code></td>
            <td>${v.desc}</td>
            <td class="text-right">
                <button class="btn btn-outline btn-sm btn-copy-var" data-copy="${v.code}">
                    <i data-lucide="copy" style="width:14px; height:14px;"></i> Sao chép
                </button>
            </td>
        </tr>
    `).join('');
    lucide.createIcons({ root: tbody });
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
                <label>Email <span class="required">*</span></label>
                <input type="email" class="nt-member-email" required placeholder="contact@nhathau.com" value="${memberData ? memberData.email : ''}">
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

