/* ==========================================================================
   BiddingFlow - PlanView (Part of View split)
   ========================================================================== */

export async function renderKeHoachTable() {
    const tableBody = document.getElementById('kehoach-table').querySelector('tbody');
    const searchVal = document.getElementById('search-kehoach').value.toLowerCase();

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.kehoach || 1;
    const pageSize = this.model.pageSize || 10;

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=kehoach&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}`, {
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
            console.error("Failed to fetch paginated plans", e);
        }
    } else {
        const latestPlans = this.model.getFilteredKeHoach();
        const filtered = latestPlans.filter(kh =>
            kh.maKeHoach.toLowerCase().includes(searchVal) ||
            kh.tenKeHoach.toLowerCase().includes(searchVal) ||
            (kh.tenDuAnDuToan && kh.tenDuAnDuToan.toLowerCase().includes(searchVal))
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
                        <i data-lucide="file-warning"></i>
                        <p>Không tìm thấy Kế hoạch lựa chọn nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('kehoach-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        tableBody.innerHTML = slicedData.map(kh => {
            const root = kh.rootId || kh.id;
            const allVersions = kh.allVersions || this.model.state.kehoach.filter(k => (k.rootId || k.id) === root)
                .sort((a, b) => parseInt(b.phienBan) - parseInt(a.phienBan));

            if (!this.model.state.selectedPlanVersion) {
                this.model.state.selectedPlanVersion = {};
            }
            const selectedId = this.model.state.selectedPlanVersion[root] || kh.id;
            const displayedKh = this.model.state.kehoach.find(k => k.id === selectedId) || kh;

            const cdt = this.model.state.chudautu.find(c => c.id === displayedKh.chuDauTuId);

            const optionsHtml = allVersions.map(v => {
                const label = v.phienBan || '00';
                const isSel = v.id === displayedKh.id ? 'selected' : '';
                return `<option value="${v.id}" ${isSel}>${label}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" onchange="window.changePlanRowVersion('${root}', this.value)" style="width: 70px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
                    ${optionsHtml}
                </select>
            `;

            const isLatest = displayedKh.id === kh.id;
            const editBtnHtml = isLatest ? `
                            <button class="action-btn btn-edit" onclick="window.editKeHoach('${displayedKh.id}')" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
            ` : ``;

            return `
                <tr>
                    <td><a href="#" onclick="event.preventDefault(); window.showKeHoachDetails('${displayedKh.id}')" class="text-blue fw-bold link-hover">${this.model.getPlanBaseCode(displayedKh.maKeHoach) || '<span class="text-muted">(Chưa nhập)</span>'}</a></td>
                    <td>${dropdownHtml}</td>
                    <td style="min-width: 240px; max-width: 360px;" class="fw-bold text-wrap">${displayedKh.tenKeHoach}</td>
                    <td>${displayedKh.loaiHinhMuaSam ? `<span class="badge ${displayedKh.loaiHinhMuaSam === 'Dự án' ? 'badge-info' : 'badge-warning'}">${displayedKh.loaiHinhMuaSam}</span>` : '<span class="text-muted">--</span>'}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${displayedKh.tenDuAnDuToan || '--'}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${cdt ? cdt.tenChuDauTu : '<span class="text-danger">Không rõ</span>'}</td>
                    <td class="text-blue fw-bold">${this.model.formatCurrency(displayedKh.tongMucDauTu)}</td>
                    <td>${this.model.formatDate(displayedKh.ngayPheDuyet)}</td>
                    <td><code>${displayedKh.quyetDinhPheDuyet}</code></td>
                    <td><small class="fw-bold text-muted">${displayedKh.thoiGianDangMa ? this.model.formatDateWithTime(displayedKh.thoiGianDangMa) : '--'}</small></td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${editBtnHtml}
                            <button class="action-btn btn-delete" onclick="window.deleteKeHoach('${displayedKh.id}')" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        if (window.renderTablePagination) {
            window.renderTablePagination('kehoach-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons();
}

export async function renderGoiThauTable() {
    const tableBody = document.getElementById('goithau-table').querySelector('tbody');
    const searchVal = document.getElementById('search-goithau').value.toLowerCase();
    const filterTrangThai = document.getElementById('filter-goithau-trangthai').value;
    const filterHinhThuc = document.getElementById('filter-goithau-hinhthuc').value;

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.goithau || 1;
    const pageSize = this.model.pageSize || 10;

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=goithau&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&trangThai=${encodeURIComponent(filterTrangThai)}&hinhThuc=${encodeURIComponent(filterHinhThuc)}`, {
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
            console.error("Failed to fetch paginated packages", e);
        }
    } else {
        const latestPackages = this.model.getFilteredGoiThau();
        const filtered = latestPackages.filter(gt => {
            const matchesSearch = gt.maGoiThau.toLowerCase().includes(searchVal) ||
                gt.tenGoiThau.toLowerCase().includes(searchVal);
            const matchesTrangThai = !filterTrangThai || gt.trangThai === filterTrangThai;
            const matchesHinhThuc = !filterHinhThuc || gt.hinhThucLuaChon === filterHinhThuc;
            return matchesSearch && matchesTrangThai && matchesHinhThuc;
        });

        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="archive"></i>
                        <p>Không tìm thấy Gói thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('goithau-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        // Global map lưu dữ liệu thành viên liên danh để tránh inline JSON trong onclick
        window._jvDataMap = window._jvDataMap || {};

        tableBody.innerHTML = slicedData.map(gt => {
            const root = gt.rootId || gt.id;
            const allVersions = gt.allVersions || this.model.state.goithau.filter(g => (g.rootId || g.id) === root)
                .sort((a, b) => parseInt(b.phienBan) - parseInt(a.phienBan));

            if (!this.model.state.selectedPackageVersion) {
                this.model.state.selectedPackageVersion = {};
            }
            const selectedId = this.model.state.selectedPackageVersion[root] || gt.id;
            const displayedGt = this.model.state.goithau.find(g => g.id === selectedId) || gt;

            const kh = this.model.state.kehoach.find(k => k.id === displayedGt.keHoachId);
            const nt = displayedGt.nhaThauTrungThauId ? this.model.state.nhathau.find(n => n.id === displayedGt.nhaThauTrungThauId) : null;
            const matchBid = displayedGt.nhaThauTrungThauId ? this.model.state.thongtinmothau.find(b => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(displayedGt.nhaThauTrungThauId)) : null;
            const ntDisplayName = matchBid ? matchBid.tenNhaThau : (nt ? nt.tenNhaThau : '--');
            const isWinnerJV = matchBid && matchBid.loaiNhaThau === 'Liên danh';
            let ntLink;
            if (isWinnerJV) {
                const allJvMembers = matchBid.thanhVienLienDanh || [];
                const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                const leadName = leadMember?.tenNhaThau || ntDisplayName;
                const leadCode = leadMember?.maSoThue || matchBid.maNhaThau || '';
                // Lọc bỏ thành viên đứng đầu khỏi danh sách thành viên phụ
                const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');
                // Lưu vào global map để tránh inline JSON
                window._jvDataMap[displayedGt.id] = {
                    members: subMembers,
                    leadName,
                    leadCode
                };
                ntLink = `<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${displayedGt.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${ntDisplayName}</a>`;
            } else if (nt) {
                ntLink = `<a href="#" onclick="event.preventDefault(); window.editNhaThau('${nt.id}')" class="text-blue fw-bold link-hover">${ntDisplayName}</a>`;
            } else {
                ntLink = `<span class="fw-bold text-success">${ntDisplayName}</span>`;
            }

            const optionsHtml = allVersions.map(v => {
                const label = v.phienBan || '00';
                const isSel = v.id === displayedGt.id ? 'selected' : '';
                return `<option value="${v.id}" ${isSel}>${label}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" onchange="window.changePackageRowVersion('${root}', this.value)" style="width: 70px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.85rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
                    ${optionsHtml}
                </select>
            `;

            const isLatest = displayedGt.id === gt.id;
            const editBtnHtml = isLatest ? `
                            <button class="action-btn btn-edit" onclick="window.editGoiThau('${displayedGt.id}')" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
            ` : ``;

            return `
                <tr>
                    <td><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${displayedGt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu"><span class="detail-code">${this.model.getPackageBaseCode(displayedGt.maGoiThau) || '<span class="text-muted">(Chưa nhập)</span>'}</span></a></td>
                    <td>${dropdownHtml}</td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap"><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${displayedGt.id}')" class="text-blue fw-bold link-hover">${displayedGt.tenGoiThau}</a></td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap">${kh ? '<a href="#" onclick="event.preventDefault(); window.showKeHoachDetails(\'' + kh.id + '\')" class="text-blue fw-bold link-hover">' + kh.tenKeHoach + '</a>' : '<span class="text-danger">Không liên kết</span>'}</td>
                    <td class="fw-bold">${this.model.formatCurrency(displayedGt.giaGoiThau)}</td>
                    <td>${displayedGt.hinhThucLuaChon}</td>
                    <td>${this.getStatusBadge(displayedGt.trangThai)}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-wrap">${displayedGt.nhaThauTrungThauId ? (ntLink + '<br><small class="text-muted">Giá: ' + this.model.formatCurrency(displayedGt.giaTrungThau) + '</small>') : '--'}</td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${editBtnHtml}
                            <button class="action-btn btn-delete" onclick="window.deleteGoiThau('${displayedGt.id}')" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        if (window.renderTablePagination) {
            window.renderTablePagination('goithau-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons();
}

export function showPackageDetails(id) {
    const detailPane = document.getElementById('tab-goithau-detail');
    if (!detailPane || !detailPane.classList.contains('active')) {
        window.switchTab('goithau-detail', id);
        return;
    }

    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;

    const kh = this.model.state.kehoach.find(k => k.id === gt.keHoachId);
    const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';

    // 1. Update header elements
    const codeEl = document.getElementById('detail-workflow-code');
    const badgeEl = document.getElementById('detail-workflow-status-badge');
    const titleEl = document.getElementById('detail-workflow-title');

    if (codeEl) codeEl.innerText = gt.maGoiThau || 'Gói thầu';
    if (badgeEl) badgeEl.innerHTML = this.getStatusBadge(gt.trangThai);
    if (titleEl) titleEl.innerText = gt.tenGoiThau || 'Chưa nhập tên';

    // 2. Setup dynamic workflow sub-tab
    let isTechEvalSaved = false;
    let isFinEvalSaved = false;
    let isEvalSaved1G1T = false;
    if (gt.danhGiaHsdtMetadata) {
        try {
            const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
            if (is1G2T) {
                if (parsed.is1G2T) {
                    isTechEvalSaved = !!(parsed.technical && parsed.technical.saved);
                    isFinEvalSaved = !!(parsed.financial && parsed.financial.saved);
                }
            } else {
                isEvalSaved1G1T = !!parsed.saved;
            }
        } catch (e) {
            console.error("Error parsing evaluation metadata:", e);
        }
    }

    const allBidsForOpening = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
    const qualifiedBidsForOpening = allBidsForOpening.filter(b =>
        b.danhGiaKetLuan ? b.danhGiaKetLuan === 'Đạt' : (b.danhGiaHopLe === 'Đạt' && b.danhGiaNangLuc === 'Đạt' && b.danhGiaKyThuat !== 'Không đạt' && b.danhGiaKyThuat !== '')
    );
    const isFinOpeningSaved = qualifiedBidsForOpening.some(b => b.giaDuThau && b.giaDuThau > 0);

    const tabs = [];
    if (gt.trangThai === 'Chuẩn bị') {
        tabs.push({ id: 'preparation', label: 'Chuẩn bị' });
    } else if (is1G2T) {
        tabs.push({ id: 'opening_tech', label: 'Biên bản mở HSĐXKT' });
        if (gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu') {
            tabs.push({ id: 'eval_tech', label: 'Báo cáo đánh giá E-HSĐXKT' });
        }

        let isQualifiedSaved = false;
        if (gt.danhGiaHsdtMetadata) {
            try {
                const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
                if (parsed.is1G2T && parsed.technical) {
                    isQualifiedSaved = !!parsed.technical.qualifiedSaved;
                }
            } catch (e) { }
        }

        if (isTechEvalSaved) {
            tabs.push({ id: 'qualified', label: 'Danh sách nhà thầu đạt kỹ thuật' });
        }
        if (isTechEvalSaved && isQualifiedSaved) {
            tabs.push({ id: 'opening_fin', label: 'Biên bản mở E-HSĐXTC' });
        }
        if (isTechEvalSaved && isQualifiedSaved && isFinOpeningSaved) {
            tabs.push({ id: 'eval_fin', label: 'Báo cáo đánh giá E-HSĐXTC' });
        }
        if (isTechEvalSaved && isQualifiedSaved && isFinOpeningSaved && (isFinEvalSaved || gt.trangThai === 'Đã có kết quả')) {
            tabs.push({ id: 'result', label: 'Kết quả lựa chọn nhà thầu' });
        }
    } else {
        tabs.push({ id: 'opening', label: 'Biên bản mở thầu' });
        if (gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu') {
            tabs.push({ id: 'eval_tech', label: 'Báo cáo đánh giá E-HSDT' });
        }
        if (isEvalSaved1G1T || gt.trangThai === 'Đã có kết quả') {
            tabs.push({ id: 'result', label: 'Kết quả lựa chọn nhà thầu' });
        }
    }

    if (!tabs.some(t => t.id === this._currentWorkflowTab) || this._currentWorkflowPackageId !== id) {
        this._currentWorkflowTab = tabs[0] ? tabs[0].id : (is1G2T ? 'opening_tech' : 'opening');
        this._currentWorkflowPackageId = id;
    }

    const tabHeadersEl = document.getElementById('detail-workflow-tabs-header');

    if (tabHeadersEl) {
        tabHeadersEl.innerHTML = tabs.map(t => {
            const activeClass = this._currentWorkflowTab === t.id ? 'active' : '';
            const style = this._currentWorkflowTab === t.id
                ? 'background: var(--bg-card); color: var(--primary); border: 1px solid var(--border-color); border-bottom: 2px solid var(--primary); font-weight: 700;'
                : 'background: transparent; color: var(--text-muted); border: 1px solid transparent; cursor: pointer;';
            return `<button type="button" class="btn ${activeClass}" data-workflow-tab="${t.id}" style="padding: 10px 18px; border-radius: var(--radius-md) var(--radius-md) 0 0; font-size: 0.82rem; transition: all 0.2s; ${style}">${t.label}</button>`;
        }).join('');

        tabHeadersEl.querySelectorAll('[data-workflow-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._currentWorkflowTab = btn.getAttribute('data-workflow-tab');
                this.showPackageDetails(id);
            });
        });
    }

    const contentWrapper = document.getElementById('detail-workflow-content-wrapper');
    if (!contentWrapper) return;
    contentWrapper.innerHTML = '';

    // 3. Render content based on current tab
    switch (this._currentWorkflowTab) {
        case 'preparation':
            if (true) {
                const khObj = this.model.state.kehoach.find(k => k.id === gt.keHoachId);
                const cdtObj = khObj ? this.model.state.chudautu.find(c => c.id === khObj.chuDauTuId) : null;
                const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : 'Không rõ';

                contentWrapper.innerHTML = `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdtStr}</span></div>
                            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Khác'}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                            <div>• <strong>Thời gian mở thầu:</strong> ${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</div>
                        </div>
                    </div>

                    <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); margin: 20px 0;">
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(245, 158, 11, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="settings" style="width: 32px; height: 32px; color: #f59e0b;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
                        <p style="font-size: 0.85rem; margin-bottom: 24px; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
                        </p>
                        <button class="btn btn-primary" onclick="window.phatHanhHsmtGoiThau('${gt.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-md);">
                            <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
                        </button>
                    </div>
                `;
                lucide.createIcons();
            }
            break;

        case 'opening':
        case 'opening_tech':
            if (gt.trangThai === 'Chuẩn bị') {
                // Keep fallback just in case
                const khObj = this.model.state.kehoach.find(k => k.id === gt.keHoachId);
                const cdtObj = khObj ? this.model.state.chudautu.find(c => c.id === khObj.chuDauTuId) : null;
                const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : 'Không rõ';

                contentWrapper.innerHTML = `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdtStr}</span></div>
                            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Khác'}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                            <div>• <strong>Thời gian mở thầu:</strong> ${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</div>
                        </div>
                    </div>

                    <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); margin: 20px 0;">
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(245, 158, 11, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="settings" style="width: 32px; height: 32px; color: #f59e0b;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
                        <p style="font-size: 0.85rem; margin-bottom: 24px; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
                        </p>
                        <button class="btn btn-primary" onclick="window.phatHanhHsmtGoiThau('${gt.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-md);">
                            <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
                        </button>
                    </div>
                `;
                lucide.createIcons();
            } else if (gt.trangThai === 'Đang mời thầu') {
                const khObj = this.model.state.kehoach.find(k => k.id === gt.keHoachId);
                const cdtObj = khObj ? this.model.state.chudautu.find(c => c.id === khObj.chuDauTuId) : null;
                const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : 'Không rõ';

                contentWrapper.innerHTML = `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdtStr}</span></div>
                            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Khác'}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                            <div>• <strong>Thời gian mở thầu:</strong> ${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</div>
                        </div>
                    </div>

                    <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); margin: 20px 0;">
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(59, 130, 246, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="unlock" style="width: 32px; height: 32px; color: var(--primary);"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đang trong thời gian mời thầu</h4>
                        <p style="font-size: 0.85rem; margin-bottom: 24px; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này hiện đang mời thầu và chưa được mở. Để thực hiện ghi nhận thông tin nộp thầu và lập biên bản mở thầu, vui lòng tiến hành mở thầu chính thức.
                        </p>
                        <button class="btn btn-primary" onclick="window.moThauGoiThau('${gt.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-md);">
                            <i data-lucide="folder-open"></i> Tiến hành Mở thầu
                        </button>
                    </div>
                `;
                lucide.createIcons();
            } else {
                contentWrapper.innerHTML = `
                    <select id="mothau-goithau-select" style="display:none;"><option value="${gt.id}" selected>${gt.tenGoiThau}</option></select>
                    <div id="mothau-goithau-summary" style="display:none;"></div>
                    <div id="mothau-bid-container" style="display:none;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                            <h4 id="mothau-table-title" style="font-weight:700; font-size:0.95rem; color:var(--text-main);">Danh sách Nhà thầu tham dự & Nộp hồ sơ</h4>
                            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                                <button class="btn btn-outline btn-sm" id="btn-mothau-import-excel" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: flex; align-items: center; gap: 6px; background: #ffffff; color: var(--text-main); border: 1px solid var(--border-color);"><i data-lucide="file-spreadsheet"></i> Nhập từ Excel</button>
                                <button class="btn btn-outline btn-sm" id="btn-mothau-add-bid" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600;"><i data-lucide="plus"></i> Thêm Nhà thầu nộp hồ sơ</button>
                            </div>
                        </div>
                        <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                            <table class="data-table" id="mothau-table" style="min-width:100%;">
                                <thead id="mothau-table-thead"></thead>
                                <tbody id="mothau-table-tbody"></tbody>
                            </table>
                        </div>
                        <div style="display:flex; justify-content:flex-end; gap:12px;">
                            <button class="btn btn-emerald" id="btn-mothau-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin mở thầu</button>
                        </div>
                    </div>
                    <div id="mothau-empty-state" style="display:none;"></div>
                `;
                window.appController.renderMoThauPanel();
            }
            break;

        case 'eval_tech':
            contentWrapper.innerHTML = `
                <select id="danhgiahsdt-goithau-select" style="display:none;"><option value="${gt.id}" selected>${gt.tenGoiThau}</option></select>
                <div id="danhgiahsdt-goithau-summary" style="display:none;"></div>
                <div id="danhgiahsdt-container" style="display:none;">
                    <div id="danhgiahsdt-tabs-header" style="display:none;">
                        <button type="button" id="tab-btn-hsdxt-kt" class="active">KT</button>
                        <button type="button" id="tab-btn-hsdxt-tc">TC</button>
                    </div>
                    <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:20px;">
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Số báo cáo đánh giá <span class="required">*</span></label>
                            <input type="text" id="danhgiahsdt-so-baocao" class="form-control" required placeholder="Ví dụ: 12/BC-TCD">
                            <span class="error-text">Vui lòng nhập số báo cáo đánh giá</span>
                        </div>
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày báo cáo đánh giá <span class="required">*</span></label>
                            <input type="text" id="danhgiahsdt-ngay-baocao" class="form-control flatpickr-dmy" required placeholder="Chọn ngày">
                            <span class="error-text">Vui lòng chọn ngày báo cáo đánh giá</span>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; margin-bottom:24px; border-bottom:1px solid var(--border-color); padding-bottom:20px;">
                        <div style="background:var(--bg-nested); padding:14px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <h5 style="margin:0; font-size:0.85rem; font-weight:700;">Công văn Yêu cầu làm rõ</h5>
                                <button type="button" class="btn btn-outline btn-xs" id="btn-add-cv-lamro">+ Thêm</button>
                            </div>
                            <div id="list-cv-lamro"></div>
                        </div>
                        <div style="background:var(--bg-nested); padding:14px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <h5 style="margin:0; font-size:0.85rem; font-weight:700;">Công văn Trả lời làm rõ</h5>
                                <button type="button" class="btn btn-outline btn-xs" id="btn-add-cv-traloi">+ Thêm</button>
                            </div>
                            <div id="list-cv-traloi"></div>
                        </div>
                        <div style="background:var(--bg-nested); padding:14px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <h5 style="margin:0; font-size:0.85rem; font-weight:700;">CV Tư vấn gửi CĐT</h5>
                                <button type="button" class="btn btn-outline btn-xs" id="btn-add-cv-guicdt">+ Thêm</button>
                            </div>
                            <div id="list-cv-guicdt"></div>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 style="font-weight:700; font-size:0.95rem;">Đánh giá chi tiết các HSDT nộp</h4>
                        <button class="btn btn-outline btn-sm btn-import-excel" id="btn-danhgiahsdt-import-excel"><i data-lucide="file-spreadsheet"></i> Nhập từ Excel</button>
                    </div>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                        <table class="data-table" id="danhgiahsdt-table">
                            <thead id="danhgiahsdt-table-thead"></thead>
                            <tbody id="danhgiahsdt-table-tbody"></tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-emerald" id="btn-danhgiahsdt-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
                    </div>
                </div>
                <div id="danhgiahsdt-empty-state" style="display:none;"></div>
            `;
            window.appController.currentDanhGiaTab = 'technical';
            window.appController.renderDanhGiaHsdtPanel();
            break;

        case 'eval_fin':
            contentWrapper.innerHTML = `
                <select id="danhgiahsdt-goithau-select" style="display:none;"><option value="${gt.id}" selected>${gt.tenGoiThau}</option></select>
                <div id="danhgiahsdt-goithau-summary" style="display:none;"></div>
                <div id="danhgiahsdt-container" style="display:none;">
                    <div id="danhgiahsdt-tabs-header" style="display:none;">
                        <button type="button" id="tab-btn-hsdxt-kt">KT</button>
                        <button type="button" id="tab-btn-hsdxt-tc" class="active">TC</button>
                    </div>
                    <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:20px;">
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Số báo cáo đánh giá <span class="required">*</span></label>
                            <input type="text" id="danhgiahsdt-so-baocao" class="form-control" required placeholder="Ví dụ: 12/BC-TCD">
                            <span class="error-text">Vui lòng nhập số báo cáo đánh giá</span>
                        </div>
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày báo cáo đánh giá <span class="required">*</span></label>
                            <input type="text" id="danhgiahsdt-ngay-baocao" class="form-control flatpickr-dmy" required placeholder="Chọn ngày">
                            <span class="error-text">Vui lòng chọn ngày báo cáo đánh giá</span>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; margin-bottom:24px; border-bottom:1px solid var(--border-color); padding-bottom:20px;">
                        <div style="background:var(--bg-nested); padding:14px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <h5 style="margin:0; font-size:0.85rem; font-weight:700;">Công văn Yêu cầu làm rõ</h5>
                                <button type="button" class="btn btn-outline btn-xs" id="btn-add-cv-lamro">+ Thêm</button>
                            </div>
                            <div id="list-cv-lamro"></div>
                        </div>
                        <div style="background:var(--bg-nested); padding:14px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <h5 style="margin:0; font-size:0.85rem; font-weight:700;">Công văn Trả lời làm rõ</h5>
                                <button type="button" class="btn btn-outline btn-xs" id="btn-add-cv-traloi">+ Thêm</button>
                            </div>
                            <div id="list-cv-traloi"></div>
                        </div>
                        <div style="background:var(--bg-nested); padding:14px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <h5 style="margin:0; font-size:0.85rem; font-weight:700;">CV Tư vấn gửi CĐT</h5>
                                <button type="button" class="btn btn-outline btn-xs" id="btn-add-cv-guicdt">+ Thêm</button>
                            </div>
                            <div id="list-cv-guicdt"></div>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 style="font-weight:700; font-size:0.95rem;">Đánh giá chi tiết các HSDT nộp</h4>
                        <button class="btn btn-outline btn-sm btn-import-excel" id="btn-danhgiahsdt-import-excel"><i data-lucide="file-spreadsheet"></i> Nhập từ Excel</button>
                    </div>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                        <table class="data-table" id="danhgiahsdt-table">
                            <thead id="danhgiahsdt-table-thead"></thead>
                            <tbody id="danhgiahsdt-table-tbody"></tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-emerald" id="btn-danhgiahsdt-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
                    </div>
                </div>
                <div id="danhgiahsdt-empty-state" style="display:none;"></div>
            `;
            window.appController.currentDanhGiaTab = 'financial';
            window.appController.renderDanhGiaHsdtPanel();
            break;

        case 'qualified':
            const allBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
            const qualifiedBids = allBids.filter(b =>
                b.danhGiaKetLuan ? b.danhGiaKetLuan === 'Đạt' : (b.danhGiaHopLe === 'Đạt' && b.danhGiaNangLuc === 'Đạt' && b.danhGiaKyThuat !== 'Không đạt' && b.danhGiaKyThuat !== '')
            );

            if (qualifiedBids.length === 0) {
                contentWrapper.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <i data-lucide="shield-alert" style="width: 48px; height: 48px; margin: 0 auto 16px; color: var(--warning);"></i>
                        <h4 style="font-weight: 700; color: var(--text-main);">Chưa có Nhà thầu đạt kỹ thuật</h4>
                        <p style="font-size: 0.85rem;">Vui lòng hoàn thành và Lưu Báo cáo đánh giá E-HSĐXKT trước.</p>
                    </div>
                `;
            } else {
                let metadata = { is1G2T: true, technical: { saved: false }, financial: { saved: false } };
                if (gt.danhGiaHsdtMetadata) {
                    try {
                        const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
                        if (parsed.is1G2T) {
                            metadata = parsed;
                        } else {
                            metadata = {
                                is1G2T: true,
                                technical: parsed.soBaoCao ? parsed : { saved: false },
                                financial: { saved: false }
                            };
                        }
                    } catch (e) {
                        console.error("Failed to parse metadata", e);
                    }
                }
                if (!metadata.technical) {
                    metadata.technical = { saved: true };
                }

                const soQd = metadata.technical.soQdPheDuyetKt || '';
                const ngayQd = metadata.technical.ngayQdPheDuyetKt ? this.model.formatDate(metadata.technical.ngayQdPheDuyetKt) : '';
                const isReadOnly = gt.trangThai === 'Đã có kết quả';

                contentWrapper.innerHTML = `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Quyết định phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Số QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-so-qd" class="form-control" value="${soQd}" placeholder="Ví dụ: 120/QĐ-CDT" style="width: 100%;" ${isReadOnly ? 'readonly' : ''}>
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số QĐ phê duyệt!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Ngày QĐ phê duyệt <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-ngay-qd" class="form-control flatpickr-dmy" value="${ngayQd}" placeholder="Chọn ngày" style="width: 100%;" ${isReadOnly ? 'readonly' : ''}>
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng chọn Ngày QĐ phê duyệt!</span>
                            </div>
                        </div>
                        ${!isReadOnly ? `
                        <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                            <button class="btn btn-primary" id="btn-save-qualified-decision" style="padding: 8px 20px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;"><i data-lucide="save"></i> Lưu quyết định phê duyệt</button>
                        </div>` : ''}
                    </div>

                    <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="shield-check" class="text-emerald" style="width: 20px; height: 20px;"></i>
                        Danh sách Nhà thầu vượt qua bước Đánh giá Kỹ thuật (E-HSĐXKT)
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px;">
                        ${qualifiedBids.map(b => `
                            <div class="card" style="padding: 16px; border: 1px solid rgba(16, 185, 129, 0.2); border-left: 4px solid var(--success); background: var(--bg-card); display: flex; flex-direction: column; gap: 8px; border-radius: var(--radius-md);">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                    <h5 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--text-main);">${b.tenNhaThau}</h5>
                                    <span class="badge badge-success" style="font-size: 0.72rem;">ĐẠT KỸ THUẬT</span>
                                </div>
                                <div style="font-size: 0.8rem; color: var(--text-muted); display:flex; flex-direction:column; gap:4px; margin-top: 6px;">
                                    <div>• <strong>Mã nhà thầu:</strong> ${b.maNhaThau || b.maDinhDanh || '--'}</div>
                                    <div>• <strong>Đánh giá hợp lệ:</strong> <span class="text-emerald" style="font-weight:700;">${b.danhGiaHopLe}</span></div>
                                    <div>• <strong>Đánh giá năng lực:</strong> <span class="text-emerald" style="font-weight:700;">${b.danhGiaNangLuc}</span></div>
                                    <div>• <strong>Đánh giá kỹ thuật:</strong> <span class="text-emerald" style="font-weight:700;">${b.danhGiaKyThuat}</span></div>
                                    ${b.danhGiaKetLuan ? `<div>• <strong>Kết luận:</strong> <span class="text-emerald" style="font-weight:700;">${b.danhGiaKetLuan}</span></div>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;

                if (!isReadOnly) {
                    flatpickr(contentWrapper.querySelector('#qualified-ngay-qd'), {
                        dateFormat: "d/m/Y",
                        locale: "vn",
                        allowInput: true
                    });

                    const btnSave = contentWrapper.querySelector('#btn-save-qualified-decision');
                    if (btnSave) {
                        btnSave.onclick = async () => {
                            const inpSo = contentWrapper.querySelector('#qualified-so-qd');
                            const inpNgay = contentWrapper.querySelector('#qualified-ngay-qd');
                            const valSo = inpSo.value.trim();
                            const valNgayRaw = inpNgay.value.trim();

                            let hasErr = false;
                            if (!valSo) {
                                hasErr = true;
                                inpSo.closest('.form-group').querySelector('.error-text').style.display = 'block';
                                inpSo.closest('.form-group').classList.add('invalid');
                            } else {
                                inpSo.closest('.form-group').querySelector('.error-text').style.display = 'none';
                                inpSo.closest('.form-group').classList.remove('invalid');
                            }

                            if (!valNgayRaw) {
                                hasErr = true;
                                inpNgay.closest('.form-group').querySelector('.error-text').style.display = 'block';
                                inpNgay.closest('.form-group').classList.add('invalid');
                            } else {
                                inpNgay.closest('.form-group').querySelector('.error-text').style.display = 'none';
                                inpNgay.closest('.form-group').classList.remove('invalid');
                            }

                            if (hasErr) return;

                            metadata.technical.soQdPheDuyetKt = valSo;
                            metadata.technical.ngayQdPheDuyetKt = this.model.convertDMYToYMD(valNgayRaw);
                            metadata.technical.qualifiedSaved = true;

                            gt.danhGiaHsdtMetadata = JSON.stringify(metadata);
                            this.model.persistData('goithau');
                            window.appController.autoSync();

                            await this.customAlert('Thành công', 'Đã lưu Quyết định phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!', 'check-circle');
                            this._currentWorkflowTab = 'opening_fin';
                            this.showPackageDetails(gt.id);
                        };
                    }
                }
            }
            break;

        case 'opening_fin':
            const allBidsForOpening = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
            const qualifiedBidsForOpening = allBidsForOpening.filter(b =>
                b.danhGiaKetLuan ? b.danhGiaKetLuan === 'Đạt' : (b.danhGiaHopLe === 'Đạt' && b.danhGiaNangLuc === 'Đạt' && b.danhGiaKyThuat !== 'Không đạt' && b.danhGiaKyThuat !== '')
            );

            if (qualifiedBidsForOpening.length === 0) {
                contentWrapper.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <i data-lucide="lock" style="width: 48px; height: 48px; margin: 0 auto 16px; color: var(--text-muted);"></i>
                        <h4 style="font-weight: 700; color: var(--text-main);">Chưa mở túi hồ sơ Đề xuất Tài chính</h4>
                        <p style="font-size: 0.85rem;">Vui lòng hoàn thành Đánh giá kỹ thuật để xác định danh sách nhà thầu đủ điều kiện mở túi HSĐXTC.</p>
                    </div>
                `;
            } else {
                const isReadOnly = gt.trangThai === 'Đã có kết quả';
                contentWrapper.innerHTML = `
                    <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 16px;">
                        Biên bản mở hồ sơ đề xuất tài chính (E-HSĐXTC)
                    </h4>
                    <p class="text-muted" style="font-size: 0.82rem; margin-bottom: 20px;">
                        Nhập giá dự thầu, tỷ lệ giảm giá, và thông tin bảo đảm dự thầu của các nhà thầu vượt qua bước đánh giá kỹ thuật.
                    </p>
                    <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto; margin-bottom: 24px;">
                        <table class="data-table" id="opening-fin-table" style="min-width: 100%;">
                            <thead>
                                <tr>
                                    <th>Mã nhà thầu</th>
                                    <th>Tên nhà thầu</th>
                                    <th style="width:160px;">Giá dự thầu (VNĐ)</th>
                                    <th style="width:80px;">Tỷ lệ %</th>
                                    <th style="width:160px;">Giá sau giảm</th>
                                    <th style="width:140px;">Đảm bảo dự thầu (VNĐ)</th>
                                    <th style="width:100px;">Hiệu lực ĐB (ngày)</th>
                                    <th style="width:120px;">Hiệu lực HSDT</th>
                                    <th style="width:120px;">Thời gian TH</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${qualifiedBidsForOpening.map(b => {
                    const valGiaDuThau = this.model.formatVND(b.giaDuThau) || '';
                    const valTyLeGiam = (b.tyLeGiamGia || 0).toString().replace('.', ',');
                    const valGiaSauGiam = this.model.formatVND(b.giaSauGiamGia) || '';
                    const valDamBao = this.model.formatVND(b.damBaoDuThau) || '';
                    const valHieuLucDb = b.hieuLucDamBao || '';
                    const valHieuLucHsdt = b.hieuLucHsdt || '';
                    const valThoiGianTh = b.thoiGianThucHien || '';

                    if (isReadOnly) {
                        return `
                                            <tr>
                                                <td><strong>${b.maNhaThau || b.maDinhDanh || '--'}</strong></td>
                                                <td><strong>${b.tenNhaThau}</strong></td>
                                                <td>${valGiaDuThau || '--'}</td>
                                                <td style="text-align:right;">${valTyLeGiam}</td>
                                                <td>${valGiaSauGiam || '--'}</td>
                                                <td>${valDamBao || '--'}</td>
                                                <td style="text-align:right;">${valHieuLucDb || '--'}</td>
                                                <td>${valHieuLucHsdt ? valHieuLucHsdt + ' ngày' : '--'}</td>
                                                <td>${valThoiGianTh || '--'}</td>
                                            </tr>
                                        `;
                    } else {
                        return `
                                            <tr data-opening-bid-id="${b.id}">
                                                <td><strong>${b.maNhaThau || b.maDinhDanh || '--'}</strong></td>
                                                <td><strong>${b.tenNhaThau}</strong></td>
                                                <td><input type="text" class="form-control op-gia-du-thau" value="${valGiaDuThau}" placeholder="Nhập giá..." style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-ty-le-giam" value="${valTyLeGiam}" placeholder="0" style="text-align:right; padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-gia-sau-giam" value="${valGiaSauGiam}" readonly style="background:#f1f5f9; padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-dam-bao" value="${valDamBao}" placeholder="Nhập giá..." style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-hieu-luc-db" value="${valHieuLucDb}" placeholder="Ví dụ: 120 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-hieu-luc-hsdt" value="${valHieuLucHsdt ? valHieuLucHsdt + ' ngày' : ''}" placeholder="Ví dụ: 90 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-thoi-gian-th" value="${valThoiGianTh}" placeholder="Ví dụ: 60 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                            </tr>
                                        `;
                    }
                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${!isReadOnly ? `
                        <div style="display:flex; justify-content:flex-end;">
                            <button class="btn btn-emerald" id="btn-save-opening-fin" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu Biên bản mở HSĐXTC</button>
                        </div>
                    ` : ''}
                `;

                if (!isReadOnly) {
                    const rows = contentWrapper.querySelectorAll('#opening-fin-table tbody tr');
                    rows.forEach(tr => {
                        const inpGia = tr.querySelector('.op-gia-du-thau');
                        const inpTyLe = tr.querySelector('.op-ty-le-giam');
                        const inpDamBao = tr.querySelector('.op-dam-bao');
                        const inpGiaSauGiam = tr.querySelector('.op-gia-sau-giam');

                        const reCalc = () => {
                            const base = this.model.parseVND(inpGia.value);
                            const pctRaw = inpTyLe.value || '0';
                            const pct = parseFloat(pctRaw.replace(/,/g, '.')) || 0;
                            const final = base * (1 - pct / 100);
                            inpGiaSauGiam.value = this.model.formatVND(final) || '';
                        };

                        const setupAutoFormatOnInput = (el) => {
                            if (!el) return;
                            el.addEventListener('input', (e) => {
                                const cursorPosition = e.target.selectionStart;
                                const originalLength = e.target.value.length;
                                const formatted = this.model.formatVND(e.target.value);
                                e.target.value = formatted;
                                const newLength = formatted.length;
                                const newPosition = cursorPosition + (newLength - originalLength);
                                e.target.setSelectionRange(newPosition, newPosition);
                            });
                        };

                        setupAutoFormatOnInput(inpGia);
                        inpGia.addEventListener('input', reCalc);
                        setupAutoFormatOnInput(inpDamBao);
                    });

                    const saveBtn = document.getElementById('btn-save-opening-fin');
                    if (saveBtn) {
                        saveBtn.onclick = async () => {
                            rows.forEach(tr => {
                                const bidId = tr.getAttribute('data-opening-bid-id');
                                const bid = this.model.state.thongtinmothau.find(b => b.id === bidId);
                                if (bid) {
                                    bid.giaDuThau = this.model.parseVND(tr.querySelector('.op-gia-du-thau')?.value || '');
                                    const tyLeValRaw = tr.querySelector('.op-ty-le-giam')?.value || '0';
                                    bid.tyLeGiamGia = parseFloat(tyLeValRaw.replace(/,/g, '.')) || 0;
                                    bid.giaSauGiamGia = this.model.parseVND(tr.querySelector('.op-gia-sau-giam')?.value || '');
                                    bid.damBaoDuThau = this.model.parseVND(tr.querySelector('.op-dam-bao')?.value || '');
                                    bid.hieuLucDamBao = tr.querySelector('.op-hieu-luc-db')?.value.trim() || '';
                                    bid.hieuLucHsdt = parseInt(tr.querySelector('.op-hieu-luc-hsdt')?.value || '0', 10);
                                    bid.thoiGianThucHien = tr.querySelector('.op-thoi-gian-th')?.value.trim() || '';
                                }
                            });
                            this.model.persistData('thongtinmothau');
                            this.model.persistData('goithau');
                            window.appController.autoSync();
                            await this.customAlert('Thành công', 'Đã lưu Biên bản mở thầu E-HSĐXTC thành công!', 'check-circle');
                            this._currentWorkflowTab = 'eval_fin';
                            this.showPackageDetails(id);
                        };
                    }
                }
            }
            break;

        case 'result':
            const allBidsForResult = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
            const isAwarded = gt.trangThai === 'Đã có kết quả';

            if (isAwarded) {
                const winnerBid = allBidsForResult.find(b => String(b.nhaThauId) === String(gt.nhaThauTrungThauId)) || allBidsForResult[0];
                const savings = gt.giaGoiThau - (gt.giaTrungThau || 0);
                const savingsPct = gt.giaGoiThau > 0 ? ((savings / gt.giaGoiThau) * 100).toFixed(2) : '0,00';

                let winnerDisplayHtml = '';
                if (winnerBid) {
                    if (winnerBid.loaiNhaThau === 'Liên danh') {
                        const allJvMembers = winnerBid.thanhVienLienDanh || [];
                        const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                        const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');

                        window._jvDataMap = window._jvDataMap || {};
                        window._jvDataMap[gt.id] = {
                            members: subMembers,
                            leadName: leadMember?.tenNhaThau || winnerBid.tenNhaThau,
                            leadCode: leadMember?.maSoThue || winnerBid.maNhaThau || ''
                        };

                        const membersListHtml = allJvMembers.map(m => {
                            const isLead = m.vaiTro === 'Đứng đầu liên danh';
                            return `
                                <li style="margin-top: 4px; font-size: 0.85rem; color: var(--text-main);">
                                    <span style="font-weight: 600;">${m.tenNhaThau}</span> 
                                    <span class="text-muted">(${m.maSoThue || 'Chưa có MST'})</span> - 
                                    <span class="badge ${isLead ? 'badge-success' : 'badge-secondary'}" style="font-size: 0.7rem; padding: 2px 6px;">${m.vaiTro || 'Thành viên'}</span>
                                </li>
                            `;
                        }).join('');

                        winnerDisplayHtml = `
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                    <a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${gt.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="link-hover" title="Xem chi tiết liên danh" style="color:var(--primary);">👥 ${winnerBid.tenNhaThau}</a>
                                </h5>
                            </div>
                        `;
                    } else {
                        winnerDisplayHtml = `
                            <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                <a href="#" onclick="event.preventDefault(); window.editNhaThau('${winnerBid.nhaThauId}')" class="link-hover" style="color:var(--primary);">${winnerBid.tenNhaThau}</a>
                            </h5>
                            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                                MST: <strong>${winnerBid.maNhaThau || 'Chưa có'}</strong>
                            </div>
                        `;
                    }
                } else {
                    winnerDisplayHtml = `<h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">Chưa xác định</h5>`;
                }

                contentWrapper.innerHTML = `
                    <div class="card" style="padding: 24px; border: 1px solid rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.02); border-radius: var(--radius-lg); margin-bottom: 24px; display: flex; flex-direction: column; gap: 16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                            <div style="display:flex; gap:12px; align-items:center;">
                                <i data-lucide="check-circle" class="text-success" style="width:36px; height:36px;"></i>
                                <div>
                                    <h4 style="margin:0; font-size:1.15rem; font-weight:800; color:var(--text-main);">Gói thầu đã hoàn thành LCNT</h4>
                                    <p class="text-muted" style="margin:0; font-size:0.8rem;">Đã phê duyệt kết quả lựa chọn nhà thầu chính thức.</p>
                                </div>
                            </div>
                            <button class="btn btn-primary" id="btn-export-docx-report" style="font-weight:700;"><i data-lucide="file-text"></i> Xuất Báo cáo Kết quả (Word)</button>
                        </div>

                        <hr style="border-color:var(--border-color); margin:4px 0;">

                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:20px;">
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Nhà thầu trúng thầu</span>
                                ${winnerDisplayHtml}
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Giá trúng thầu</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${this.model.formatCurrency(gt.giaTrungThau)}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Thời gian thực hiện</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${gt.thoiGianGoiThau || '--'}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Hiệu quả tiết kiệm</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--success);">${this.model.formatCurrency(savings)} (${savingsPct}%)</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Quyết định phê duyệt số</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${gt.soQuyetDinhKetQua || '--'}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Ngày ký quyết định</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${gt.ngayQuyetDinhKetQua ? this.model.formatDate(gt.ngayQuyetDinhKetQua) : '--'}</h5>
                            </div>
                        </div>
                    </div>
                `;

                const exportBtn = document.getElementById('btn-export-docx-report');
                if (exportBtn) {
                    exportBtn.onclick = () => {
                        exportBtn.disabled = true;
                        const origText = exportBtn.innerHTML;
                        exportBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:16px;"></i> Đang xuất...';
                        lucide.createIcons();

                        const dbId = parseInt(id.replace('gt-', '')) || 1;
                        fetch('/api/sync', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Session-Token': localStorage.getItem('bf_session_token') || '',
                                'X-Username': localStorage.getItem('bf_username') || ''
                            },
                            body: JSON.stringify(this.model.state)
                        })
                            .then(s => {
                                if (!s.ok) throw new Error('Không thể đồng bộ dữ liệu');
                                return fetch(`/api/export-report/${dbId}`);
                            })
                            .then(r => {
                                if (!r.ok) throw new Error('Không thể xuất báo cáo');
                                return r.blob();
                            })
                            .then(b => {
                                const url = window.URL.createObjectURL(b);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `Bao_cao_ket_qua_danh_gia_ho_so_du_thau_${gt.maGoiThau}.docx`;
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                window.URL.revokeObjectURL(url);
                            })
                            .catch(err => {
                                this.customAlert('Lỗi', 'Lỗi xuất báo cáo: ' + err.message, 'x-circle');
                            })
                            .finally(() => {
                                exportBtn.disabled = false;
                                exportBtn.innerHTML = origText;
                                lucide.createIcons();
                            });
                    };
                }
            } else {
                contentWrapper.innerHTML = `
                    <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 16px;">
                        Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)
                    </h4>
                    <p class="text-muted" style="font-size:0.82rem; margin-bottom: 20px;">
                        Vui lòng chọn nhà thầu trúng thầu chính thức và cập nhật các thông số phê duyệt hợp đồng để hoàn tất gói thầu.
                    </p>

                    <div class="card" style="padding: 24px; border: 1px solid var(--border-color); border-radius: var(--radius-lg); background: var(--bg-card); display: flex; flex-direction: column; gap: 16px; max-width: 600px;">
                        <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                            <label for="award-winner-select" style="font-weight:700; font-size:0.85rem;">Chọn nhà thầu trúng thầu <span class="required">*</span></label>
                            <div class="select-wrapper">
                                <select id="award-winner-select" class="form-control" required style="font-weight:600;">
                                    <option value="">-- Chọn Nhà thầu thắng thầu --</option>
                                    ${allBidsForResult.map(b => `<option value="${b.nhaThauId || b.id}">${b.tenNhaThau}</option>`).join('')}
                                </select>
                            </div>
                            <span class="error-text">Vui lòng chọn nhà thầu trúng thầu</span>
                        </div>

                        <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                            <label style="font-weight:700; font-size:0.85rem;">Giá trúng thầu (VNĐ) <span class="required">*</span></label>
                            <input type="text" id="award-price" class="form-control" required placeholder="Ví dụ: 1.000.000.000">
                            <span class="error-text">Vui lòng nhập giá trúng thầu</span>
                        </div>

                        <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                                <label style="font-weight:700; font-size:0.85rem;">Quyết định phê duyệt số <span class="required">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control" required value="${gt.soQuyetDinhKetQua || ''}" placeholder="Số quyết định...">
                                <span class="error-text">Vui lòng nhập số quyết định</span>
                            </div>
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                                <label style="font-weight:700; font-size:0.85rem;">Ngày ký quyết định <span class="required">*</span></label>
                                <input type="text" id="award-decision-date" class="form-control flatpickr-dmy" required value="${gt.ngayQuyetDinhKetQua ? this.model.formatDate(gt.ngayQuyetDinhKetQua) : ''}" placeholder="Chọn ngày...">
                                <span class="error-text">Vui lòng chọn ngày ký quyết định</span>
                            </div>
                        </div>

                        <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                                <label style="font-weight:700; font-size:0.85rem;">Thời gian thực hiện gói thầu <span class="required">*</span></label>
                                <input type="text" id="award-duration-package" class="form-control" required placeholder="Ví dụ: 60 ngày">
                                <span class="error-text">Vui lòng nhập thời gian thực hiện gói thầu</span>
                            </div>
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                                <label style="font-weight:700; font-size:0.85rem;">Thời gian thực hiện hợp đồng <span class="required">*</span></label>
                                <input type="text" id="award-duration-contract" class="form-control" required placeholder="Ví dụ: 60 ngày">
                                <span class="error-text">Vui lòng nhập thời gian thực hiện hợp đồng</span>
                            </div>
                        </div>

                        <button class="btn btn-emerald" id="btn-approve-award" style="padding:12px; font-weight:700; margin-top:8px; display:flex; justify-content:center; align-items:center; gap:8px;">
                            <i data-lucide="check-circle2"></i> Phê duyệt & Hoàn thành LCNT
                        </button>
                    </div>
                `;

                flatpickr('#award-decision-date', {
                    dateFormat: "d/m/Y",
                    locale: "vn",
                    allowInput: true
                });

                const inpPrice = document.getElementById('award-price');
                if (inpPrice) {
                    inpPrice.addEventListener('input', (e) => {
                        e.target.value = this.model.formatVND(e.target.value);
                    });
                }

                const winnerSelect = document.getElementById('award-winner-select');
                if (winnerSelect) {
                    winnerSelect.addEventListener('change', () => {
                        const winnerId = winnerSelect.value;
                        if (winnerId) {
                            const selectedBid = allBidsForResult.find(b => String(b.nhaThauId || b.id) === String(winnerId));
                            if (selectedBid) {
                                const bidPrice = (selectedBid.giaSauGiamGia && selectedBid.giaSauGiamGia > 0) ? selectedBid.giaSauGiamGia : (selectedBid.giaDuThau || 0);
                                if (inpPrice) {
                                    inpPrice.value = this.model.formatVND(bidPrice) || '';
                                }
                                const inpPkgDur = document.getElementById('award-duration-package');
                                if (inpPkgDur) {
                                    inpPkgDur.value = selectedBid.thoiGianThucHien || '';
                                }
                                const inpCtrDur = document.getElementById('award-duration-contract');
                                if (inpCtrDur) {
                                    const child_val = selectedBid.thoiGianThucHien || '';
                                    inpCtrDur.value = child_val ? (child_val + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '';
                                }
                            }
                        } else {
                            if (inpPrice) inpPrice.value = '';
                            const inpPkgDur = document.getElementById('award-duration-package');
                            if (inpPkgDur) inpPkgDur.value = '';
                            const inpCtrDur = document.getElementById('award-duration-contract');
                            if (inpCtrDur) inpCtrDur.value = '';
                        }
                    });
                }

                const approveBtn = document.getElementById('btn-approve-award');
                if (approveBtn) {
                    approveBtn.onclick = async () => {
                        const winnerSelect = document.getElementById('award-winner-select');
                        const finalPriceRaw = document.getElementById('award-price')?.value || '';
                        const decNo = document.getElementById('award-decision-no')?.value.trim() || '';
                        const decDateRaw = document.getElementById('award-decision-date')?.value || '';
                        const durPkg = document.getElementById('award-duration-package')?.value.trim() || '';
                        const durCtr = document.getElementById('award-duration-contract')?.value.trim() || '';

                        const winnerIdStr = winnerSelect.value;
                        const finalPrice = this.model.parseVND(finalPriceRaw);
                        const decDate = this.model.convertDMYToYMD(decDateRaw);

                        let hasError = false;
                        const errorInputs = [];
                        const fields = [
                            { el: winnerSelect, val: winnerIdStr },
                            { el: document.getElementById('award-price'), val: finalPriceRaw },
                            { el: document.getElementById('award-decision-no'), val: decNo },
                            { el: document.getElementById('award-decision-date'), val: decDateRaw },
                            { el: document.getElementById('award-duration-package'), val: durPkg },
                            { el: document.getElementById('award-duration-contract'), val: durCtr }
                        ];

                        fields.forEach(f => {
                            if (!f.val) {
                                hasError = true;
                                if (f.el) {
                                    errorInputs.push(f.el);
                                    f.el.closest('.form-group')?.classList.add('invalid');
                                    const clearInvalid = () => {
                                        f.el.closest('.form-group')?.classList.remove('invalid');
                                        f.el.removeEventListener('input', clearInvalid);
                                        f.el.removeEventListener('change', clearInvalid);
                                    };
                                    f.el.addEventListener('input', clearInvalid);
                                    f.el.addEventListener('change', clearInvalid);
                                }
                            }
                        });

                        if (hasError) {
                            if (errorInputs.length > 0) {
                                const first = errorInputs[0];
                                first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                                setTimeout(() => first.focus({ preventScroll: true }), 300);
                            }
                            return;
                        }

                        gt.nhaThauTrungThauId = isNaN(winnerIdStr) ? winnerIdStr : parseInt(winnerIdStr);
                        gt.giaTrungThau = finalPrice;
                        gt.soQuyetDinhKetQua = decNo;
                        gt.ngayQuyetDinhKetQua = decDate;
                        gt.thoiGianGoiThau = durPkg;
                        gt.thoiGianHopDong = durCtr;
                        gt.trangThai = 'Đã có kết quả';

                        this.model.persistData('goithau');
                        this.renderGoiThauTable();
                        window.appController.autoSync();

                        await this.customAlert('Chúc mừng', `Đã phê duyệt trúng thầu cho gói thầu "${gt.tenGoiThau}" thành công!`, 'check-circle');
                        this.showPackageDetails(id);
                    };
                }
            }
            break;
    }
    lucide.createIcons();
}

export function showKeHoachDetails(id) {
    const kh = this.model.state.kehoach.find(k => k.id === id);
    if (!kh) return;

    const rootId = kh.rootId || kh.id;
    const allVersions = this.model.state.kehoach.filter(k => (k.rootId || k.id) === rootId);

    allVersions.sort((a, b) => {
        const valA = parseInt(a.phienBan) || 0;
        const valB = parseInt(b.phienBan) || 0;
        return valB - valA;
    });

    const selectEl = document.getElementById('detail-kh-version-select');
    selectEl.innerHTML = allVersions.map(k => {
        const label = this.model.getPlanVersionLabel(k.phienBan);
        const timeLabel = k.thoiGianDangMa ? this.model.formatDateWithTime(k.thoiGianDangMa) : '--';
        return `<option value="${k.id}" ${k.id === id ? 'selected' : ''}>${label} (Đăng lúc: ${timeLabel})</option>`;
    }).join('');

    selectEl.onchange = (e) => {
        this.renderPlanVersionDetails(e.target.value);
    };

    this.renderPlanVersionDetails(id);
    this.openModal('modal-detail-kehoach');
}

export function renderPlanVersionDetails(versionId) {
    const kh = this.model.state.kehoach.find(k => k.id === versionId);
    if (!kh) return;

    const cdt = this.model.state.chudautu.find(c => c.id === kh.chuDauTuId);
    const latestPackages = this.model.getLatestPackages();
    const linkedPackages = latestPackages.filter(gt => gt.keHoachId === kh.id);

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
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 220px;">Đơn vị thực hiện</th>
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 220px;">Văn bản phê duyệt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list1.map(item => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${item.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 700; color: var(--primary); text-align: right !important;">${this.model.formatCurrency(item.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${item.donViThucHien || '--'}</td>
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${item.vanBanPheDuyet || '--'}</td>
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
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important; width: 300px;">Đơn vị thực hiện</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list2.map(item => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${item.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 700; color: var(--primary); text-align: right !important;">${this.model.formatCurrency(item.giaTri)}</td>
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 600; color: var(--text-muted); text-align: left !important;">${item.donViThucHien || '--'}</td>
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
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: left !important;">Tên phần công việc</th>
                                <th style="padding: 10px 14px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); text-align: right !important; width: 180px;">Giá trị (VND)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list3.map(item => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 600; color: var(--text-main); text-align: left !important;">${item.tenCongViec}</td>
                                    <td style="padding: 10px 14px; font-size: 0.84rem; font-weight: 700; color: var(--primary); text-align: right !important;">${this.model.formatCurrency(item.giaTri)}</td>
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
                <div class="detail-value">${this.model.formatDate(kh.ngayTrinhDuToan) || '--'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày phê duyệt dự toán</div>
                <div class="detail-value">${this.model.formatDate(kh.ngayPheDuyetDuToan) || '--'}</div>
            </div>
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Số QĐ phê duyệt dự toán</div>
                <div class="detail-value"><code>${kh.soQdPheDuyetDuToan || '--'}</code></div>
            </div>
        `;
    }

    let projectDetailHtml = '';
    if (kh.loaiHinhMuaSam === 'Dự án') {
        projectDetailHtml = `
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Mã dự án</div>
                <div class="detail-value"><code>${kh.maDuan || '--'}</code></div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Số QĐ phê duyệt dự án</div>
                <div class="detail-value"><code>${kh.soQdPheDuyetDuAn || '--'}</code></div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày QĐ phê duyệt dự án</div>
                <div class="detail-value">${this.model.formatDate(kh.ngayQdPheDuyetDuAn) || '--'}</div>
            </div>
            <div class="detail-item" style="grid-column: span 2;">
                <div class="detail-label">Cơ quan phê duyệt dự án</div>
                <div class="detail-value">${kh.coQuanPheDuyetDuAn || '--'}</div>
            </div>
        `;
    }

    const html = `
        <div class="detail-section">
            <div class="detail-header-block">
                <span class="detail-code">${this.model.getPlanBaseCode(kh.maKeHoach) || '<span class="text-muted">(Chưa nhập)</span>'}</span>
                <h4 class="detail-title">${kh.tenKeHoach}</h4>
                <div style="margin-top: 8px;">
                    <span class="badge badge-info"><i data-lucide="info"></i> ${this.model.getPlanVersionLabel(kh.phienBan)}</span>
                </div>
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
                    <div class="detail-value text-blue" style="font-size: 1.15rem;">${this.model.formatCurrency(kh.tongMucDauTu)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian đăng mã kế hoạch</div>
                    <div class="detail-value">${kh.thoiGianDangMa ? this.model.formatDateWithTime(kh.thoiGianDangMa) : '--'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số quyết định phê duyệt</div>
                    <div class="detail-value"><code>${kh.quyetDinhPheDuyet}</code></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày quyết định phê duyệt</div>
                    <div class="detail-value">${this.model.formatDate(kh.ngayPheDuyet)}</div>
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
                        <div class="associated-item">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue" style="width:16px;"></i>
                                <span><strong>${gt.maGoiThau}</strong> - ${gt.tenGoiThau}</span>
                            </div>
                            <span class="badge badge-success">${this.model.formatCurrency(gt.giaGoiThau)}</span>
                        </div>
                    `).join('') : '<div class="text-muted"><small>Phiên bản kế hoạch này hiện chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;

    document.getElementById('detail-kehoach-content').innerHTML = html;
    lucide.createIcons();
}

export function renderExcelPreview(rows, importType) {
    const previewContainer = document.getElementById('excel-preview-container');
    const tableHeader = document.getElementById('excel-preview-header');
    const tableBody = document.getElementById('excel-preview-tbody');

    if (!previewContainer || !tableBody || !tableHeader) return;

    if (rows.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Không tìm thấy dữ liệu hợp lệ trong file Excel</td></tr>`;
        previewContainer.style.display = 'block';
        return;
    }

    // Dynamic header mappings to friendly names
    const labelMap = {
        // kehoach
        maKeHoach: 'Mã kế hoạch',
        tenKeHoach: 'Tên kế hoạch',
        loaiHinhMuaSam: 'Loại hình',
        tenDuAnDuToan: 'Dự án / Dự toán',
        tongMucDauTu: 'Tổng mức đầu tư',
        ngayPheDuyet: 'Ngày phê duyệt',
        quyetDinhPheDuyet: 'Quyết định phê duyệt',
        thoiGianDangMa: 'Thời gian đăng mã',

        // goithau
        maGoiThau: 'Mã gói thầu',
        tenGoiThau: 'Tên gói thầu',
        keHoachId: 'Mã Kế hoạch liên kết',
        giaGoiThau: 'Giá gói thầu',
        hinhThucLuaChon: 'Hình thức LCNT',
        phuongThucLuaChon: 'Phương thức LCNT',
        thoiGianThucHien: 'TG thực hiện (ngày)',
        trangThai: 'Trạng thái',
        loaiHopDong: 'Loại hợp đồng',
        nguonVon: 'Nguồn vốn',

        // chudautu
        maChuDauTu: 'Mã CĐT',
        tenChuDauTu: 'Tên chủ đầu tư',
        maSoThue: 'Mã số thuế',
        diaChi: 'Địa chỉ',
        soDienThoai: 'Điện thoại',
        email: 'Email',
        chucVuNguoiDungDau: 'Chức vụ người đứng đầu',
        nguoiKyQuyetDinh: 'Người ký quyết định',
        chucVuNguoiKy: 'Chức vụ người ký',
        danhXung: 'Danh xưng',
        soTaiKhoan: 'Số tài khoản',
        noiMoTaiKhoan: 'Nơi mở tài khoản',
        maQHNS: 'Mã QHNS',

        // nhathau
        maNhaThau: 'Mã nhà thầu',
        tenNhaThau: 'Tên nhà thầu',
        loaiNhaThau: 'Loại nhà thầu',
        nguoiDaiDien: 'Người đại diện',
        soTaiKhoan: 'Số tài khoản',
        noiMoTaiKhoan: 'Nơi mở tài khoản',

        // chuyengia
        hoTen: 'Họ và tên',
        soCCCD: 'Số CCCD',
        ngayCapCCCD: 'Ngày cấp CCCD',
        noiCapCCCD: 'Nơi cấp CCCD',
        soChungChi: 'Số chứng chỉ',
        ngayCapChungChi: 'Ngày cấp CC',
        donViCapChungChi: 'Đơn vị cấp CC',

        // hopdong
        soHopDong: 'Số hợp đồng',
        tenHopDong: 'Tên hợp đồng',
        ngayKy: 'Ngày ký',
        giaTri: 'Giá trị hợp đồng',
        soNgayThucHien: 'Số ngày thực hiện',

        // mothau
        maDinhDanh: 'Mã nhà thầu',
        maNhaThau: 'Mã nhà thầu',
        nhaThauId: 'Nhà thầu',
        maPhanLo: 'Mã phần lô',
        tenPhanLo: 'Tên phần lô',
        damBaoDuThau: 'Đảm bảo dự thầu',
        hieuLucDamBao: 'Hiệu lực ĐB (ngày)',
        hieuLucHsdxt: 'Hiệu lực E-HSĐXKT',
        giaDuThau: 'Giá dự thầu',
        tyLeGiamGia: 'Tỷ lệ giảm (%)',
        giaSauGiamGia: 'Giá sau giảm giá',
        hieuLucHsdt: 'Hiệu lực E-HSDT',
        giaTriDamBao: 'Giá trị đảm bảo',
        hieuLucBaoDamNgay: 'Hiệu lực ĐB (ngày)',
        thoiGianThucHien: 'Thời gian thực hiện',

        // danhgiahsdt
        danhGiaHopLe: 'Đánh giá hợp lệ',
        danhGiaNangLuc: 'Đánh giá năng lực',
        danhGiaKyThuat: 'Đánh giá kỹ thuật',
        danhGiaKetLuan: 'Kết luận'
    };

    // Find keys of interest (skip internal meta keys)
    const firstRow = rows[0];
    const keys = Object.keys(firstRow).filter(k => k !== '_valid' && k !== '_comment');

    // Build Headers
    let headerHtml = '<tr>';
    keys.forEach(k => {
        const label = labelMap[k] || k;
        let align = 'left';
        if (['tongMucDauTu', 'giaGoiThau', 'giaTri', 'giaTriPhanLo', 'giaTrungThau', 'damBaoDuThau', 'giaDuThau', 'giaSauGiamGia', 'giaTriDamBao'].includes(k)) {
            align = 'right';
        }
        headerHtml += `<th style="text-align: ${align} !important;">${label}</th>`;
    });
    headerHtml += '<th style="text-align: center !important;">Thông tin kiểm tra</th></tr>';
    tableHeader.innerHTML = headerHtml;

    // Build Rows
    tableBody.innerHTML = rows.map(r => {
        const rowClass = r._valid ? '' : 'style="background-color: rgba(239, 68, 68, 0.08);"';
        const statusHtml = r._valid
            ? '<span class="badge badge-success"><i data-lucide="check"></i> Hợp lệ</span>'
            : `<span class="badge badge-danger" title="${r._comment}"><i data-lucide="alert-circle"></i> Lỗi dữ liệu</span>`;

        let rowHtml = `<tr ${rowClass}>`;
        keys.forEach(k => {
            let val = r[k];
            let align = 'left';
            let style = '';

            if (['tongMucDauTu', 'giaGoiThau', 'giaTri', 'giaTriPhanLo', 'giaTrungThau', 'damBaoDuThau', 'giaDuThau', 'giaSauGiamGia', 'giaTriDamBao'].includes(k)) {
                align = 'right';
                style = 'font-weight:700; color:var(--primary);';
                val = this.model.formatVND ? this.model.formatVND(val || 0) : (this.model.formatCurrency ? this.model.formatCurrency(val || 0) : val);
            } else if (k === 'maKeHoach' || k === 'maGoiThau' || k === 'maChuDauTu' || k === 'maNhaThau' || k === 'soHopDong' || k === 'soChungChi' || k === 'maDinhDanh') {
                style = 'font-weight:700;';
            } else if (k === 'nhaThauId') {
                // Find contractor name instead of raw UUID/ID
                const matchedNt = this.model.state.nhathau.find(n => n.id === val);
                if (matchedNt) val = matchedNt.tenNhaThau;
            }

            rowHtml += `<td style="text-align: ${align} !important; ${style}">${val !== undefined && val !== null && val !== '' ? val : '--'}</td>`;
        });
        rowHtml += `<td style="text-align: center; vertical-align: middle;">${statusHtml}</td></tr>`;
        return rowHtml;
    }).join('');

    previewContainer.style.display = 'block';
    lucide.createIcons();
}
