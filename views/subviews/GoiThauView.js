import { getAuthDownloadUrl, authFetchDownload } from './view_helpers.js';
export async function renderGoiThauTable() {
    const tableBody = document.getElementById('goithau-table').querySelector('tbody');
    const searchVal = document.getElementById('search-goithau').value.toLowerCase();
    const filterTrangThai = document.getElementById('filter-goithau-trangthai').value;
    const filterHinhThuc = document.getElementById('filter-goithau-hinhthuc').value;

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.goithau || 1;
    const pageSize = this.model.pageSize || 10;

    const sortState = this.model.sortState.goithau || {};
    const sortBy = sortState.field || '';
    const sortOrder = sortState.order || 'asc';

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=goithau&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&trangThai=${encodeURIComponent(filterTrangThai)}&hinhThuc=${encodeURIComponent(filterHinhThuc)}&sortBy=${sortBy}&sortOrder=${sortOrder}`, {
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
                const leadCode = leadMember?.maSoThue || nt?.maSoThue || nt?.maNhaThau || matchBid.maDinhDanh || matchBid.maNhaThau || '';
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
                ntLink = `<a href="#" onclick="event.preventDefault(); window.editNhaThau('${nt.id}', true)" class="text-blue fw-bold link-hover">${ntDisplayName}</a>`;
            } else {
                ntLink = `<span class="fw-bold text-success">${ntDisplayName}</span>`;
            }

            let winnerInfoHtml = '--';
            if (displayedGt.phanLo === 'Có') {
                const plList = typeof displayedGt.phanLoList === 'string' ? JSON.parse(displayedGt.phanLoList || '[]') : (displayedGt.phanLoList || []);
                const winningLots = plList.filter(pl => pl.nhaThauTrungThauId);
                const uniqueWinnerIds = [...new Set(winningLots.map(pl => String(pl.nhaThauTrungThauId)).filter(Boolean))];

                if (uniqueWinnerIds.length > 1) {
                    window._lotWinnersMap = window._lotWinnersMap || {};
                    window._lotWinnersMap[displayedGt.id] = winningLots.map(pl => {
                        const bidderInfo = this.model.state.thongtinmothau.find(b => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(pl.nhaThauTrungThauId));
                        const ntInfo = this.model.state.nhathau.find(n => n.id === pl.nhaThauTrungThauId);
                        const ntName = bidderInfo ? bidderInfo.tenNhaThau : (ntInfo ? ntInfo.tenNhaThau : 'Nhà thầu #' + pl.nhaThauTrungThauId);
                        const isJV = bidderInfo && bidderInfo.loaiNhaThau === 'Liên danh';
                        let jvData = null;
                        if (isJV) {
                            const allJvMembers = bidderInfo.thanhVienLienDanh || [];
                            const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                            const leadName = leadMember?.tenNhaThau || ntName;
                            const leadCode = leadMember?.maSoThue || ntInfo?.maSoThue || ntInfo?.maNhaThau || bidderInfo.maDinhDanh || bidderInfo.maNhaThau || '';
                            const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');
                            jvData = {
                                members: subMembers,
                                leadName,
                                leadCode
                            };
                        }
                        return {
                            maPhanLo: pl.maPhanLo,
                            tenPhanLo: pl.tenPhanLo,
                            nhaThauTrungThauId: pl.nhaThauTrungThauId,
                            tenNhaThau: ntName,
                            giaTrungThau: pl.giaTrungThau,
                            isJV,
                            jvData
                        };
                    });
                    const totalGiaTrung = winningLots.reduce((sum, pl) => sum + (parseFloat(pl.giaTrungThau) || 0), 0);
                    winnerInfoHtml = `<a href="#" onclick="event.preventDefault(); window.showLotWinnersModal('${displayedGt.id}')" class="text-blue fw-bold link-hover" style="text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a><br><small class="text-muted">Tổng giá: ${this.model.formatCurrency(totalGiaTrung)}</small>`;
                } else if (uniqueWinnerIds.length === 1) {
                    const singleWinnerId = uniqueWinnerIds[0];
                    const singleWinnerNt = this.model.state.nhathau.find(n => String(n.id) === String(singleWinnerId));
                    const singleWinnerBid = this.model.state.thongtinmothau.find(b => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(singleWinnerId));
                    const name = singleWinnerBid ? singleWinnerBid.tenNhaThau : (singleWinnerNt ? singleWinnerNt.tenNhaThau : 'Nhà thầu #' + singleWinnerId);
                    const totalGiaTrung = winningLots.reduce((sum, pl) => sum + (parseFloat(pl.giaTrungThau) || 0), 0);

                    let link;
                    if (singleWinnerBid && singleWinnerBid.loaiNhaThau === 'Liên danh') {
                        const allJvMembers = singleWinnerBid.thanhVienLienDanh || [];
                        const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                        const leadName = leadMember?.tenNhaThau || name;
                        const leadCode = leadMember?.maSoThue || singleWinnerNt?.maSoThue || singleWinnerNt?.maNhaThau || singleWinnerBid.maDinhDanh || singleWinnerBid.maNhaThau || '';
                        const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');
                        window._jvDataMap[displayedGt.id] = {
                            members: subMembers,
                            leadName,
                            leadCode
                        };
                        link = `<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${displayedGt.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${name}</a>`;
                    } else if (singleWinnerNt) {
                        link = `<a href="#" onclick="event.preventDefault(); window.editNhaThau('${singleWinnerNt.id}', true)" class="text-blue fw-bold link-hover">${name}</a>`;
                    } else {
                        link = `<span class="fw-bold text-success">${name}</span>`;
                    }
                    winnerInfoHtml = `${link}<br><small class="text-muted">Giá: ${this.model.formatCurrency(totalGiaTrung)}</small>`;
                } else {
                    winnerInfoHtml = '--';
                }
            } else {
                winnerInfoHtml = displayedGt.nhaThauTrungThauId ? (ntLink + '<br><small class="text-muted">Giá: ' + this.model.formatCurrency(displayedGt.giaTrungThau) + '</small>') : '--';
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
            const hasResultOrCanceled = displayedGt.trangThai === 'Đã có kết quả' || displayedGt.trangThai === 'Hủy thầu';

            let actionButtonsHtml = '';
            if (isLatest) {
                if (hasResultOrCanceled) {
                    actionButtonsHtml = `
                        <button class="action-btn btn-view" onclick="window.editGoiThau('${displayedGt.id}', true)" title="Xem chi tiết Gói thầu">
                            <i data-lucide="eye" style="color: var(--primary);"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteGoiThau('${displayedGt.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `;
                } else {
                    actionButtonsHtml = `
                        <button class="action-btn btn-edit" onclick="window.editGoiThau('${displayedGt.id}')" title="Sửa">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteGoiThau('${displayedGt.id}')" title="Xóa">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `;
                }
            }

            return `
                <tr>
                    <td><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${displayedGt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu"><span class="detail-code">${this.model.getPackageBaseCode(displayedGt.maGoiThau) || '<span class="text-muted">(Chưa nhập)</span>'}</span></a></td>
                    <td>${dropdownHtml}</td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap"><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${displayedGt.id}')" class="text-blue fw-bold link-hover">${displayedGt.tenGoiThau}</a></td>
                    <td style="min-width: 240px; max-width: 320px;" class="text-wrap">${kh ? '<a href="#" onclick="event.preventDefault(); window.showKeHoachDetails(\'' + kh.id + '\')" class="text-blue fw-bold link-hover">' + kh.tenKeHoach + '</a>' : '<span class="text-danger">Không liên kết</span>'}</td>
                    <td class="fw-bold">${this.model.formatCurrency(displayedGt.giaGoiThau)}</td>
                    <td>${displayedGt.hinhThucLuaChon}</td>
                    <td>${this.getStatusBadge(displayedGt.trangThai)}</td>
                    <td style="min-width: 200px; max-width: 300px;" class="text-wrap">${winnerInfoHtml}</td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            ${actionButtonsHtml}
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
    this.enhanceTableHeaders('goithau-table', 'goithau');
}


export function showPackageDetails(id) {
    // Safely restore form-goithau to its modal parent before clearing innerHTML
    const formEl = document.getElementById('form-goithau');
    const modalMCard = document.querySelector('#modal-goithau .modal-card');
    if (formEl && modalMCard && !modalMCard.contains(formEl)) {
        modalMCard.appendChild(formEl);
    }
    window._editingInPlace = false;
    const tabHeaders = document.getElementById('detail-workflow-tabs-header');
    if (tabHeaders) tabHeaders.style.display = 'flex';

    const detailPane = document.getElementById('tab-goithau-detail');
    if (!detailPane || !detailPane.classList.contains('active')) {
        window.switchTab('goithau-detail', id);
        return;
    }

    if (this._currentWorkflowPackageId !== id) {
        this._inPlaceEditMode = false;
    }

    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;

    const editBtn = document.getElementById('btn-edit-goithau-fullpage');
    const editAwardBtn = document.getElementById('btn-edit-award-result');
    if (editBtn) {
        if (this._currentWorkflowTab === 'preparation' && gt.trangThai !== 'Đang chấm thầu' && gt.trangThai !== 'Đã có kết quả' && gt.trangThai !== 'Hủy thầu' && !this._inPlaceEditMode) {
            editBtn.style.display = 'flex';
            editBtn.onclick = () => {
                this._inPlaceEditMode = true;
                this.showPackageDetails(id);
            };
        } else {
            editBtn.style.display = 'none';
        }
    }
    if (editAwardBtn) {
        if (this._currentWorkflowTab === 'result' && (gt.trangThai === 'Đã có kết quả' || gt.trangThai === 'Hủy thầu')) {
            editAwardBtn.style.display = 'flex';
            editAwardBtn.onclick = async () => {
                gt.trangThai = 'Đang chấm thầu';
                this.model.persistData('goithau');
                window.appController.autoSync();
                this.showPackageDetails(id);
            };
        } else {
            editAwardBtn.style.display = 'none';
        }
    }

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

    const tabs = [{ id: 'preparation', label: 'Thông tin gói thầu' }];
    if (gt.trangThai === 'Chuẩn bị') {
        tabs.push({ id: 'preparation_action', label: 'Chuẩn bị' });
    } else {
        if (is1G2T) {
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
    }

    if (!tabs.some(t => t.id === this._currentWorkflowTab) || this._currentWorkflowPackageId !== id) {
        this._currentWorkflowTab = tabs[0] ? tabs[0].id : 'preparation';
        this._currentWorkflowPackageId = id;
    }

    const tabHeadersEl = document.getElementById('detail-workflow-tabs-header');
    if (tabHeadersEl) {
        tabHeadersEl.style.display = 'flex';
        tabHeadersEl.innerHTML = tabs.map(t => {
            const activeClass = this._currentWorkflowTab === t.id ? 'active' : '';
            const style = this._currentWorkflowTab === t.id
                ? 'background: var(--bg-card); color: var(--primary); border: 1px solid var(--border-color); border-bottom: 2px solid var(--primary); font-weight: 700;'
                : 'background: transparent; color: var(--text-muted); border: 1px solid transparent; cursor: pointer;';
            return `<button type="button" class="btn ${activeClass}" data-workflow-tab="${t.id}" style="padding: 10px 18px; border-radius: var(--radius-md) var(--radius-md) 0 0; font-size: 0.82rem; transition: all 0.2s; ${style}">${t.label}</button>`;
        }).join('');

        tabHeadersEl.querySelectorAll('[data-workflow-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._inPlaceEditMode = false;
                this._currentWorkflowTab = btn.getAttribute('data-workflow-tab');
                this.showPackageDetails(id);
            });
        });
    }

    const contentWrapper = document.getElementById('detail-workflow-content-wrapper');
    if (!contentWrapper) return;
    contentWrapper.innerHTML = '';

    switch (this._currentWorkflowTab) {
        case 'preparation':
            if (true) {
                const khObj = this.model.state.kehoach.find(k => k.id === gt.keHoachId);
                const cdtObj = khObj ? this.model.state.chudautu.find(c => c.id === khObj.chuDauTuId) : null;
                const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : 'Không rõ';
                const tenKhStr = khObj ? khObj.tenKeHoach : 'Không rõ';

                let statusBoxHtml = '';
                if (gt.trangThai === 'Chuẩn bị') {
                    statusBoxHtml = `
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(245, 158, 11, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="settings" style="width: 32px; height: 32px; color: #f59e0b;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
                        <p style="font-size: 0.85rem; margin-bottom: 24px; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
                        </p>
                        <button class="btn btn-primary" onclick="window.phatHanhHsmtGoiThau('${gt.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-md); margin: 0 auto;">
                            <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
                        </button>
                    `;
                } else {
                    statusBoxHtml = `
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="check-circle" style="width: 32px; height: 32px; color: #10b981;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đã phát hành HSMT</h4>
                        <p style="font-size: 0.85rem; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này đã hoàn thành bước chuẩn bị và đã phát hành hồ sơ mời thầu (Trạng thái hiện tại: <strong style="color: var(--primary);">${gt.trangThai}</strong>). Bạn có thể chuyển sang các tab tiếp theo để xem/nhập thông tin mở thầu và chấm thầu.
                        </p>
                    `;
                }

                contentWrapper.innerHTML = `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 24px;">
                        <!-- Cột 1: Thông tin chung -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                    <i data-lucide="info" style="width: 18px; height: 18px;"></i> Thông tin chung
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Mã TBMT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.maGoiThau || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Tên gói thầu</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right; word-break: break-word;">${gt.tenGoiThau || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Chủ đầu tư</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${tenCdtStr}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Kế hoạch liên kết</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${tenKhStr}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Lĩnh vực</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.linhVuc || '--'}${gt.linhVuc === 'Hàng hóa' ? (gt.isThuoc == 1 ? ' (Thuốc)' : ' (Không phải thuốc)') : ''}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Giá gói thầu</span>
                                        <span style="color: var(--primary); font-weight: 800;">${this.model.formatCurrency(gt.giaGoiThau) || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Nguồn vốn</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${gt.nguonVon || '--'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 2: Hình thức & Phương thức -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                    <i data-lucide="layers" style="width: 18px; height: 18px;"></i> Hình thức & Phương thức
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Hình thức LCNT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.hinhThucLuaChon || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Phương thức LCNT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.phuongThucLuaChon || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Phương pháp đánh giá</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.phuongPhapDanhGia || '--'}</span>
                                    </div>
                                    ${gt.trongSoKyThuat ? `
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Trọng số kỹ thuật (%)</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.trongSoKyThuat}%</span>
                                    </div>` : ''}
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Đấu thầu qua mạng</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.quaMang || 'Qua mạng'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Phân lô</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.phanLo || 'Không'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Tùy chọn mua thêm</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.tuyChonMuaThem || 'Không'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 3: Thời gian & Tiến độ -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                    <i data-lucide="calendar" style="width: 18px; height: 18px;"></i> Thời gian & Tiến độ
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian thực hiện</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianThucHien || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian tổ chức LCNT</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianToChuc || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Bắt đầu tổ chức</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianBatDauToChuc || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian đăng tải</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-dangtai" class="form-control" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianDangTai ? this.model.formatDateWithTime(gt.thoiGianDangTai) : ''}" placeholder="Chọn ngày giờ">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianDangTai ? this.model.formatDateWithTime(gt.thoiGianDangTai) : '--'}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian đóng thầu</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-dongthau" class="form-control" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : ''}" placeholder="Chọn ngày giờ">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian mở thầu</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-mothau" class="form-control" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : ''}" placeholder="Chọn ngày giờ">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 4: Quyết định & Thẩm định HSMT (Trải ngang full chiều rộng) -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); grid-column: 1 / -1;">
                            <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                <i data-lucide="file-text" style="width: 18px; height: 18px;"></i> Quyết định & Thẩm định HSMT
                            </h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Số quyết định phê duyệt HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-soquyetdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.soQuyetDinh || ''}" placeholder="Nhập số quyết định">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.soQuyetDinh || '--'}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Ngày quyết định phê duyệt HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayQuyetDinh ? this.model.formatDate(gt.ngayQuyetDinh) : ''}" placeholder="Chọn ngày">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.ngayQuyetDinh ? this.model.formatDate(gt.ngayQuyetDinh) : '--'}</span>
                                        `}
                                    </div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Yêu cầu thẩm định HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <select id="ip-yeucauthamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align-last: right;">
                                                <option value="Có" ${gt.yeuCauThamDinhHsmt === 'Có' ? 'selected' : ''}>Có</option>
                                                <option value="Không" ${gt.yeuCauThamDinhHsmt === 'Không' || !gt.yeuCauThamDinhHsmt ? 'selected' : ''}>Không</option>
                                            </select>
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.yeuCauThamDinhHsmt || 'Không'}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-sobaocaothamdinh" style="display: ${this._inPlaceEditMode || gt.yeuCauThamDinhHsmt === 'Có' ? 'flex' : 'none'}; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Số báo cáo thẩm định HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-sobaocaothamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.soBaoCaoThamDinhHsmt || ''}" placeholder="Nhập số báo cáo">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.soBaoCaoThamDinhHsmt || '--'}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-ngaybaocaothamdinh" style="display: ${this._inPlaceEditMode || gt.yeuCauThamDinhHsmt === 'Có' ? 'flex' : 'none'}; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Ngày báo cáo thẩm định HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngaybaocaothamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayBaoCaoThamDinhHsmt ? this.model.formatDate(gt.ngayBaoCaoThamDinhHsmt) : ''}" placeholder="Chọn ngày">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.ngayBaoCaoThamDinhHsmt ? this.model.formatDate(gt.ngayBaoCaoThamDinhHsmt) : '--'}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    ${this._inPlaceEditMode ? `
                        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                            <button id="btn-cancel-inplace" class="btn btn-outline" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Hủy</button>
                            <button id="btn-save-inplace" class="btn btn-primary" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Lưu</button>
                        </div>
                    ` : ''}
                `;
                lucide.createIcons();

                if (this._inPlaceEditMode) {
                    flatpickr("#ip-dangtai", {
                        locale: "vn", enableTime: true, enableSeconds: false,
                        time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                        position: "auto"
                    });
                    flatpickr("#ip-dongthau", {
                        locale: "vn", enableTime: true, enableSeconds: false,
                        time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                        position: "auto"
                    });
                    flatpickr("#ip-mothau", {
                        locale: "vn", enableTime: true, enableSeconds: false,
                        time_24hr: true, dateFormat: "d/m/Y H:i", allowInput: true,
                        position: "auto"
                    });
                    flatpickr("#ip-ngayquyetdinh", {
                        locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto"
                    });
                    flatpickr("#ip-ngaybaocaothamdinh", {
                        locale: "vn", dateFormat: "d/m/Y", allowInput: true, position: "auto"
                    });

                    const selectYeuCau = document.getElementById('ip-yeucauthamdinh');
                    if (selectYeuCau) {
                        const toggleReportFields = () => {
                            const show = selectYeuCau.value === 'Có';
                            document.getElementById('wrapper-sobaocaothamdinh').style.display = show ? 'flex' : 'none';
                            document.getElementById('wrapper-ngaybaocaothamdinh').style.display = show ? 'flex' : 'none';
                        };
                        selectYeuCau.onchange = toggleReportFields;
                        toggleReportFields();
                    }

                    const btnSave = document.getElementById('btn-save-inplace');
                    if (btnSave) {
                        btnSave.onclick = async () => {
                            const valDangTai = document.getElementById('ip-dangtai').value;
                            const valDongThau = document.getElementById('ip-dongthau').value;
                            const valMoThau = document.getElementById('ip-mothau').value;
                            const valSoQuyetDinh = document.getElementById('ip-soquyetdinh').value;
                            const valNgayQuyetDinh = document.getElementById('ip-ngayquyetdinh').value;
                            const valYeuCauThamDinh = document.getElementById('ip-yeucauthamdinh').value;
                            const valSoBaoCao = document.getElementById('ip-sobaocaothamdinh').value;
                            const valNgayBaoCao = document.getElementById('ip-ngaybaocaothamdinh').value;

                            gt.thoiGianDangTai = valDangTai ? this.model.convertDMYHMSToYMDHMS(valDangTai) : '';
                            gt.thoiGianDongThau = valDongThau ? this.model.convertDMYHMSToYMDHMS(valDongThau) : '';
                            gt.thoiGianMoThau = valMoThau ? this.model.convertDMYHMSToYMDHMS(valMoThau) : '';
                            gt.soQuyetDinh = valSoQuyetDinh;
                            gt.ngayQuyetDinh = valNgayQuyetDinh ? this.model.convertDMYToYMD(valNgayQuyetDinh) : '';
                            gt.yeuCauThamDinhHsmt = valYeuCauThamDinh;
                            if (valYeuCauThamDinh === 'Không') {
                                gt.soBaoCaoThamDinhHsmt = '';
                                gt.ngayBaoCaoThamDinhHsmt = '';
                            } else {
                                gt.soBaoCaoThamDinhHsmt = valSoBaoCao;
                                gt.ngayBaoCaoThamDinhHsmt = valNgayBaoCao ? this.model.convertDMYToYMD(valNgayBaoCao) : '';
                            }

                            await this.model.persistData('goithau');
                            if (window.appController && typeof window.appController.autoSync === 'function') {
                                try {
                                    await window.appController.autoSync();
                                } catch (e) {
                                    console.error("Sync failed:", e);
                                }
                            }

                            this._inPlaceEditMode = false;
                            this.showPackageDetails(id);
                            await this.customAlert('Thành công', 'Cập nhật thông tin gói thầu thành công!', 'check-circle');
                        };
                    }

                    const btnCancel = document.getElementById('btn-cancel-inplace');
                    if (btnCancel) {
                        btnCancel.onclick = () => {
                            this._inPlaceEditMode = false;
                            this.showPackageDetails(id);
                        };
                    }
                }
            }
            break;

        case 'preparation_action':
            if (true) {
                let statusBoxHtml = '';
                if (gt.trangThai === 'Chuẩn bị') {
                    statusBoxHtml = `
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(245, 158, 11, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="settings" style="width: 32px; height: 32px; color: #f59e0b;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
                        <p style="font-size: 0.85rem; margin-bottom: 24px; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
                        </p>
                        <button class="btn btn-primary" onclick="window.phatHanhHsmtGoiThau('${gt.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; border-radius: var(--radius-md); margin: 0 auto;">
                            <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
                        </button>
                    `;
                } else {
                    statusBoxHtml = `
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.08); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                            <i data-lucide="check-circle" style="width: 32px; height: 32px; color: #10b981;"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; font-size: 1.1rem;">Gói thầu đã phát hành HSMT</h4>
                        <p style="font-size: 0.85rem; max-width: 460px; margin-left: auto; margin-right: auto; line-height: 1.5; color: var(--text-muted);">
                            Gói thầu này đã hoàn thành bước chuẩn bị và đã phát hành hồ sơ mời thầu (Trạng thái hiện tại: <strong style="color: var(--primary);">${gt.trangThai}</strong>). Bạn có thể chuyển sang các tab tiếp theo để xem/nhập thông tin mở thầu và chấm thầu.
                        </p>
                    `;
                }

                contentWrapper.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color); margin: 20px 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        ${statusBoxHtml}
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
                            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}${gt.linhVuc === 'Hàng hóa' ? (gt.isThuoc === 1 || gt.isThuoc === '1' ? ' (Thuốc)' : ' (Không phải thuốc)') : ''}</div>
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
                            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}${gt.linhVuc === 'Hàng hóa' ? (gt.isThuoc === 1 || gt.isThuoc === '1' ? ' (Thuốc)' : ' (Không phải thuốc)') : ''}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            <div>• <strong>Thời gian đóng thầu:</strong> <span id="display-thoigiandongthau" style="font-weight:700;">${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</span></div>
                            <div>• <strong>Thời gian mở thầu:</strong> <span id="display-thoigianmothau" style="font-weight:700;">${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</span></div>
                        </div>
                    </div>

                    <div class="card" style="padding: 24px; border: 1px dashed var(--border-color); text-align: center; background: rgba(59, 130, 246, 0.02); border-radius: var(--radius-lg); margin-top: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;">
                        <div style="width: 54px; height: 54px; border-radius: 50%; background: rgba(59, 130, 246, 0.08); display: flex; align-items: center; justify-content: center;">
                            <i data-lucide="folder-open" style="width: 26px; height: 26px; color: var(--primary);"></i>
                        </div>
                        <h4 style="font-weight: 700; color: var(--text-main); margin: 0; font-size: 1.05rem;">Mở thầu Gói thầu</h4>
                        <p style="font-size: 0.82rem; color: var(--text-muted); max-width: 440px; margin: 0; line-height: 1.5;">
                            Nếu thời gian đóng thầu đã hết và không có gia hạn hay làm rõ HSMT nào, vui lòng tiến hành mở thầu để bắt đầu ghi nhận hồ sơ thầu.<br>
                            <em style="font-size:0.78rem; opacity:0.75;">Để ghi nhận gia hạn hoặc làm rõ HSMT, vui lòng chỉnh sửa gói thầu.</em>
                        </p>
                        <button class="btn btn-primary" onclick="window.moThauGoiThau('${gt.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; margin-top:8px;">
                            <i data-lucide="unlock"></i> Tiến hành Mở thầu
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
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="mothau" id="btn-mothau-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="mothau" id="btn-mothau-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
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
                            <button class="btn btn-primary" id="btn-mothau-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin mở thầu</button>
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
                    <div id="danhgiahsdt-quytrinh-container" style="display:none; margin-bottom: 20px; padding: 12px 16px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: var(--radius-md); align-items: center; gap: 24px;">
                        <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);">Quy trình đánh giá:</span>
                        <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text-main);">
                            <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh1" checked style="accent-color: var(--primary); cursor: pointer;">
                            Quy trình 1
                        </label>
                        <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text-main);">
                            <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh2" style="accent-color: var(--primary); cursor: pointer;">
                            Quy trình 2
                        </label>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 id="danhgiahsdt-table-title" style="font-weight:700; font-size:0.95rem;">Đánh giá chi tiết các HSDT nộp</h4>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-excel-action btn-download-excel-template-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                            <button class="btn-excel-action btn-import-excel-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                        </div>
                    </div>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                        <table class="data-table" id="danhgiahsdt-table">
                            <thead id="danhgiahsdt-table-thead"></thead>
                            <tbody id="danhgiahsdt-table-tbody"></tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-danhgiahsdt-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
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

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 id="danhgiahsdt-table-title" style="font-weight:700; font-size:0.95rem;">Đánh giá chi tiết các HSDT nộp</h4>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-excel-action btn-download-excel-template-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                            <button class="btn-excel-action btn-import-excel-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                        </div>
                    </div>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                        <table class="data-table" id="danhgiahsdt-table">
                            <thead id="danhgiahsdt-table-thead"></thead>
                            <tbody id="danhgiahsdt-table-tbody"></tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-danhgiahsdt-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
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
                const isCompleted = !!metadata.technical.qualifiedSaved;
                const isEditingThisStep = this._editingState && this._editingState[this._currentWorkflowTab];
                const isReadOnly = (isCompleted && !isEditingThisStep) || gt.trangThai === 'Đã có kết quả';

                contentWrapper.innerHTML = `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
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
                    </div>
 
                     <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                         <table class="data-table" style="min-width: 100%;">
                             <thead>
                                 <tr>
                                     ${gt.phanLo === 'Có' ? `
                                         <th style="width: 15%;">Mã phần lô</th>
                                         <th style="width: 25%;">Tên phần lô</th>
                                     ` : ''}
                                     <th style="width: 15%;">Mã nhà thầu</th>
                                     <th style="width: 30%;">Tên nhà thầu</th>
                                     <th style="width: 15%; text-align: center;">Kết quả</th>
                                 </tr>
                             </thead>
                             <tbody>
                                 ${qualifiedBids.map(b => `
                                     <tr>
                                         ${gt.phanLo === 'Có' ? `
                                             <td>${b.maPhanLo || '--'}</td>
                                             <td>${b.tenPhanLo || '--'}</td>
                                         ` : ''}
                                         <td>${b.maNhaThau || b.maDinhDanh || '--'}</td>
                                         <td class="fw-bold">${b.tenNhaThau || '--'}</td>
                                         <td style="text-align: center;">
                                             <span class="badge badge-success" style="font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 4px;">Đạt kỹ thuật</span>
                                         </td>
                                     </tr>
                                 `).join('')}
                             </tbody>
                         </table>
                     </div>
                     <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                         ${isReadOnly ? '' : `
                             <button class="btn btn-primary" id="btn-save-qualified-decision" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;"><i data-lucide="save"></i> Lưu QĐ phê duyệt</button>
                         `}
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

                            if (this._editingState) {
                                this._editingState[this._currentWorkflowTab] = false;
                            }

                            await this.customAlert('Thành công', 'Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!', 'check-circle');
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
                const isFinOpeningSaved = qualifiedBidsForOpening.some(b => b.giaDuThau && b.giaDuThau > 0);
                const isCompleted = isFinOpeningSaved;
                const isEditingThisStep = this._editingState && this._editingState[this._currentWorkflowTab];
                const isReadOnly = (isCompleted && !isEditingThisStep) || gt.trangThai === 'Đã có kết quả';

                contentWrapper.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                        <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin: 0;">
                            Biên bản mở hồ sơ đề xuất tài chính (E-HSĐXTC)
                        </h4>
                        ${!isReadOnly ? `
                            <div style="display:flex; gap:8px;">
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="opening_fin" id="btn-opening-fin-export-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="opening_fin" id="btn-opening-fin-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                            </div>
                        ` : ''}
                    </div>
                    <p class="text-muted" style="font-size: 0.82rem; margin-bottom: 20px;">
                        Nhập giá dự thầu, tỷ lệ giảm giá của các nhà thầu vượt qua bước đánh giá kỹ thuật.
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
                                    <th style="width:120px;">Hiệu lực HSDT</th>
                                    <th style="width:120px;">Thời gian TH</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${qualifiedBidsForOpening.map(b => {
                    const valGiaDuThau = this.model.formatVND(b.giaDuThau) || '';
                    const valTyLeGiam = (b.tyLeGiamGia || 0).toString().replace('.', ',');
                    const valGiaSauGiam = this.model.formatVND(b.giaSauGiamGia) || '';
                    const valHieuLucHsdt = b.hieuLucHsdt || '';
                    const valThoiGianTh = b.thoiGianThucHien || gt.thoiGianThucHien || '';

                    if (isReadOnly) {
                        return `
                                            <tr>
                                                <td><strong>${b.maNhaThau || b.maDinhDanh || '--'}</strong></td>
                                                <td><strong>${b.tenNhaThau}</strong></td>
                                                <td>${valGiaDuThau || '--'}</td>
                                                <td style="text-align:right;">${valTyLeGiam}</td>
                                                <td>${valGiaSauGiam || '--'}</td>
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
                                                <td><input type="text" class="form-control op-hieu-luc-hsdt" value="${valHieuLucHsdt ? valHieuLucHsdt + ' ngày' : ''}" placeholder="Ví dụ: 90 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-thoi-gian-th" value="${valThoiGianTh}" placeholder="Ví dụ: 60 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>
                                            </tr>
                                        `;
                    }
                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end;">
                        ${isReadOnly ? '' : `
                            <button class="btn btn-primary" id="btn-save-opening-fin" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu Biên bản mở HSĐXTC</button>
                        `}
                    </div>
                `;

                if (!isReadOnly) {
                    const rows = contentWrapper.querySelectorAll('#opening-fin-table tbody tr');
                    rows.forEach(tr => {
                        const inpGia = tr.querySelector('.op-gia-du-thau');
                        const inpTyLe = tr.querySelector('.op-ty-le-giam');
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
                        if (inpGia) inpGia.addEventListener('input', reCalc);
                        if (inpTyLe) inpTyLe.addEventListener('input', reCalc);
                    });

                    const exportBtn = document.getElementById('btn-opening-fin-export-excel');
                    if (exportBtn) {
                        exportBtn.onclick = () => {
                            const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                            authFetchDownload(`/api/export-opening-fin-template?package_id=${gt.id}&package_name=${encodeURIComponent(safeCode)}`, `Mau_Mo_Tai_Chinh_${safeCode}.xlsx`);
                        };
                    }

                    const importBtn = document.getElementById('btn-opening-fin-import-excel');
                    if (importBtn) {
                        importBtn.onclick = () => {
                            window.appController.openExcelImportModal('opening_fin');
                        };
                    }

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
                                    bid.hieuLucHsdt = parseInt(tr.querySelector('.op-hieu-luc-hsdt')?.value || '0', 10);
                                    const opThoiGianVal = tr.querySelector('.op-thoi-gian-th')?.value.trim() || '';
                                    bid.thoiGianThucHien = opThoiGianVal || bid.thoiGianThucHien || gt.thoiGianThucHien || '';
                                }
                            });
                            this.model.persistData('thongtinmothau');
                            this.model.persistData('goithau');
                            window.appController.autoSync();

                            if (this._editingState) {
                                this._editingState[this._currentWorkflowTab] = false;
                            }

                            await this.customAlert('Thành công', 'Đã lưu Biên bản mở thầu E-HSĐXTC thành công!', 'check-circle');
                            this._currentWorkflowTab = 'eval_fin';
                            this.showPackageDetails(id);
                        };
                    }
                }
            }
            break;

        case 'result':
            const allBidsForResult = this.model.state.thongtinmothau.filter(b =>
                String(b.goiThauId) === String(gt.id) &&
                (b.danhGiaKetLuan ? (b.danhGiaKetLuan === 'Đạt' || b.danhGiaKetLuan.startsWith('Đạt') || b.danhGiaKetLuan.includes('Trúng thầu')) : (b.danhGiaHopLe === 'Đạt' && b.danhGiaNangLuc === 'Đạt' && b.danhGiaKyThuat !== 'Không đạt' && b.danhGiaKyThuat !== ''))
            );
            const isAwarded = gt.trangThai === 'Đã có kết quả';

            if (isAwarded) {
                if (!gt.nhaThauTrungThauId && allBidsForResult.length === 1) {
                    gt.nhaThauTrungThauId = allBidsForResult[0].nhaThauId || allBidsForResult[0].id;
                }
                const winnerBid = allBidsForResult.find(b => String(b.nhaThauId) === String(gt.nhaThauTrungThauId)) || allBidsForResult[0];
                const savings = gt.giaGoiThau - (gt.giaTrungThau || 0);
                const savingsPct = gt.giaGoiThau > 0 ? ((savings / gt.giaGoiThau) * 100).toFixed(2) : '0,00';

                let winnerDisplayHtml = '';
                let hasMultipleWinners = false;
                let winningLots = [];
                let uniqueWinnerIds = [];
                if (gt.phanLo === 'Có') {
                    const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
                    winningLots = plList.filter(pl => pl.nhaThauTrungThauId);
                    uniqueWinnerIds = [...new Set(winningLots.map(pl => String(pl.nhaThauTrungThauId)).filter(Boolean))];
                    if (uniqueWinnerIds.length > 1) {
                        hasMultipleWinners = true;
                    }
                }

                if (hasMultipleWinners) {
                    window._lotWinnersMap = window._lotWinnersMap || {};
                    window._lotWinnersMap[gt.id] = winningLots.map(pl => {
                        const bidderInfo = this.model.state.thongtinmothau.find(b => String(b.goiThauId) === String(gt.id) && String(b.nhaThauId) === String(pl.nhaThauTrungThauId));
                        const ntInfo = this.model.state.nhathau.find(n => n.id === pl.nhaThauTrungThauId);
                        const ntName = bidderInfo ? bidderInfo.tenNhaThau : (ntInfo ? ntInfo.tenNhaThau : 'Nhà thầu #' + pl.nhaThauTrungThauId);
                        const isJV = bidderInfo && bidderInfo.loaiNhaThau === 'Liên danh';
                        let jvData = null;
                        if (isJV) {
                            const allJvMembers = bidderInfo.thanhVienLienDanh || [];
                            const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                            const leadName = leadMember?.tenNhaThau || ntName;
                            const leadCode = leadMember?.maSoThue || ntInfo?.maSoThue || ntInfo?.maNhaThau || bidderInfo.maDinhDanh || bidderInfo.maNhaThau || '';
                            const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');
                            jvData = {
                                members: subMembers,
                                leadName,
                                leadCode
                            };
                        }
                        return {
                            maPhanLo: pl.maPhanLo,
                            tenPhanLo: pl.tenPhanLo,
                            nhaThauTrungThauId: pl.nhaThauTrungThauId,
                            tenNhaThau: ntName,
                            giaTrungThau: pl.giaTrungThau,
                            isJV,
                            jvData
                        };
                    });
                    winnerDisplayHtml = `
                        <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                            <a href="#" onclick="event.preventDefault(); window.showLotWinnersModal('${gt.id}')" class="link-hover" style="color:var(--primary); text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a>
                        </h5>
                    `;
                } else {
                    const finalWinnerId = uniqueWinnerIds.length === 1 ? uniqueWinnerIds[0] : (gt.nhaThauTrungThauId || (winnerBid ? (winnerBid.nhaThauId || winnerBid.id) : null));
                    const currentWinnerBid = allBidsForResult.find(b => String(b.nhaThauId) === String(finalWinnerId)) || winnerBid;
                    if (currentWinnerBid) {
                        if (currentWinnerBid.loaiNhaThau === 'Liên danh') {
                            const allJvMembers = currentWinnerBid.thanhVienLienDanh || [];
                            const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                            const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');

                            const winnerNt = this.model.state.nhathau.find(n => String(n.id) === String(currentWinnerBid.nhaThauId));
                            window._jvDataMap = window._jvDataMap || {};
                            window._jvDataMap[gt.id] = {
                                members: subMembers,
                                leadName: leadMember?.tenNhaThau || currentWinnerBid.tenNhaThau,
                                leadCode: leadMember?.maSoThue || winnerNt?.maSoThue || winnerNt?.maNhaThau || currentWinnerBid.maDinhDanh || currentWinnerBid.maNhaThau || ''
                            };

                            winnerDisplayHtml = `
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                        <a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${gt.id}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="link-hover" title="Xem chi tiết liên danh" style="color:var(--primary);">👥 ${currentWinnerBid.tenNhaThau}</a>
                                    </h5>
                                </div>
                            `;
                        } else {
                            const winnerNt = this.model.state.nhathau.find(n => String(n.id) === String(currentWinnerBid.nhaThauId));
                            const winnerMst = winnerNt ? (winnerNt.maSoThue || winnerNt.maNhaThau) : (currentWinnerBid.maDinhDanh || currentWinnerBid.maNhaThau);
                            winnerDisplayHtml = `
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                    <a href="#" onclick="event.preventDefault(); window.editNhaThau('${currentWinnerBid.nhaThauId}', true)" class="link-hover" style="color:var(--primary);">${currentWinnerBid.tenNhaThau}</a>
                                </h5>
                                <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                                    MST: <strong>${winnerMst || 'Chưa có'}</strong>
                                </div>
                            `;
                        }
                    } else {
                        winnerDisplayHtml = `<h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">Chưa xác định</h5>`;
                    }
                }

                const allBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
                allBids.sort((a, b) => {
                    const codeA = String(a.maPhanLo || '').toLowerCase();
                    const codeB = String(b.maPhanLo || '').toLowerCase();
                    return codeA.localeCompare(codeB, 'vi', { numeric: true });
                });
                const winningIds = new Set();
                if (gt.nhaThauTrungThauId) {
                    winningIds.add(String(gt.nhaThauTrungThauId));
                }
                if (gt.phanLo === 'Có' && gt.phanLoList) {
                    try {
                        const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList) : gt.phanLoList;
                        plList.forEach(pl => {
                            if (pl.nhaThauTrungThauId) winningIds.add(String(pl.nhaThauTrungThauId));
                        });
                    } catch (e) {
                        console.error(e);
                    }
                }

                const bidsByNt = {};
                allBids.forEach(b => {
                    const ntId = String(b.nhaThauId || b.id || '');
                    if (!ntId) return;
                    if (!bidsByNt[ntId]) bidsByNt[ntId] = [];
                    bidsByNt[ntId].push(b);
                });

                const isPhanLo = gt.phanLo === 'Có';
                const allBiddersHtml = allBids.map((b, idx) => {
                    const ntId = String(b.nhaThauId || b.id);

                    let bidIsWinner = false;
                    let giaTrungHtml = '—';
                    let thoiGianThucHienHtml = '—';
                    if (isPhanLo) {
                        const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
                        const matchedPl = plList.find(pl => String(pl.maPhanLo) === String(b.maPhanLo) && String(pl.nhaThauTrungThauId) === String(b.nhaThauId));
                        if (matchedPl) {
                            bidIsWinner = true;
                            giaTrungHtml = this.model.formatCurrency(matchedPl.giaTrungThau || 0);
                            thoiGianThucHienHtml = matchedPl.thoiGianGoiThau || '—';
                        } else {
                            thoiGianThucHienHtml = b.thoiGianThucHien || b.thoiGianGoiThau || '—';
                        }
                    } else {
                        if (gt.nhaThauTrungThauId && String(gt.nhaThauTrungThauId) === String(b.nhaThauId)) {
                            bidIsWinner = true;
                            giaTrungHtml = this.model.formatCurrency(gt.giaTrungThau || 0);
                            thoiGianThucHienHtml = gt.thoiGianGoiThau || '—';
                        } else {
                            thoiGianThucHienHtml = b.thoiGianThucHien || b.thoiGianGoiThau || '—';
                        }
                    }

                    const badge = bidIsWinner
                        ? `<span class="badge badge-success" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(16, 185, 129, 0.08); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25);">Trúng thầu</span>`
                        : `<span class="badge badge-danger" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(239,68,68,0.08); color: #dc2626; border: 1px solid rgba(239,68,68,0.25);">Trượt thầu</span>`;

                    let lyDo = '';
                    if (bidIsWinner) {
                        lyDo = '—';
                    } else {
                        lyDo = b.lyDoTruot || '';
                        if (!lyDo) {
                            if (gt.quyTrinhDanhGia === 'quytrinh2' && b.danhGiaKetLuan === 'Không đánh giá') {
                                lyDo = "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";
                            } else {
                                const ketLuan = b.danhGiaKetLuan;
                                if (ketLuan === 'Không đạt' || (ketLuan && ketLuan.startsWith('Không đạt'))) {
                                    const failedSteps = [];
                                    if (b.danhGiaHopLe === 'Không đạt') failedSteps.push("Đánh giá hợp lệ");
                                    if (b.danhGiaNangLuc === 'Không đạt') failedSteps.push("Đánh giá năng lực");
                                    if (b.danhGiaKyThuat === 'Không đạt' || (b.danhGiaKyThuat && String(b.danhGiaKyThuat).toLowerCase().includes('không đạt'))) failedSteps.push("Đánh giá kỹ thuật");
                                    if (b.danhGiaTaiChinh === 'Không đạt' || (b.danhGiaTaiChinh && String(b.danhGiaTaiChinh).toLowerCase().includes('không đạt'))) failedSteps.push("Đánh giá tài chính");

                                    if (failedSteps.length > 0) {
                                        lyDo = `Không đạt ở bước: ${failedSteps.join(', ')}`;
                                    } else {
                                        lyDo = "Không đạt đánh giá chi tiết";
                                    }
                                } else {
                                    lyDo = "Nhà thầu xếp hạng 1 trúng thầu";
                                }
                            }
                        }
                    }

                    const isJV = b.loaiNhaThau === 'Liên danh';
                    let contractorHtml = '';
                    if (isJV) {
                        const allJvMembers = b.thanhVienLienDanh || [];
                        const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                        const leadName = leadMember?.tenNhaThau || b.tenNhaThau;
                        const leadCode = leadMember?.maSoThue || b.maDinhDanh || b.maNhaThau || '';
                        const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');

                        const jvKey = `${gt.id}_result_bidder_${idx}`;
                        window._jvDataMap = window._jvDataMap || {};
                        window._jvDataMap[jvKey] = {
                            members: subMembers,
                            leadName,
                            leadCode
                        };
                        contractorHtml = `<a href="#" onclick="event.preventDefault(); var d=window._jvDataMap['${jvKey}']; d && window.openMoThauJVViewModal(d.members, d.leadName, d.leadCode)" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${b.tenNhaThau || '--'}</a>`;
                    } else {
                        contractorHtml = `<span class="fw-bold">${b.tenNhaThau || '--'}</span>`;
                    }

                    if (isPhanLo) {
                        return `
                            <tr>
                                <td>${b.maPhanLo || '—'}</td>
                                <td>${b.tenPhanLo || '—'}</td>
                                <td>${b.maNhaThau || b.maDinhDanh || '--'}</td>
                                <td>${contractorHtml}</td>
                                <td class="fw-bold text-success">${giaTrungHtml}</td>
                                <td>${thoiGianThucHienHtml}</td>
                                <td style="text-align: center;">${badge}</td>
                                <td class="text-muted" style="font-size: 0.82rem;">${lyDo}</td>
                            </tr>
                        `;
                    } else {
                        return `
                            <tr>
                                <td>${b.maNhaThau || b.maDinhDanh || '--'}</td>
                                <td>${contractorHtml}</td>
                                <td class="fw-bold text-success">${giaTrungHtml}</td>
                                <td>${thoiGianThucHienHtml}</td>
                                <td style="text-align: center;">${badge}</td>
                                <td class="text-muted" style="font-size: 0.82rem;">${lyDo}</td>
                            </tr>
                        `;
                    }
                }).join('');

                let tableHeaderHtml = '';
                if (isPhanLo) {
                    tableHeaderHtml = `
                        <tr>
                            <th style="width: 10%;">Mã phần lô</th>
                            <th style="width: 12%;">Tên phần lô</th>
                            <th style="width: 10%;">Mã nhà thầu</th>
                            <th style="width: 20%;">Tên nhà thầu</th>
                            <th style="width: 13%;">Giá trị trúng thầu</th>
                            <th style="width: 15%;">Thời gian thực hiện</th>
                            <th style="width: 10%; text-align: center;">Trạng thái</th>
                            <th style="width: 10%;">Lý do trượt thầu</th>
                        </tr>
                    `;
                } else {
                    tableHeaderHtml = `
                        <tr>
                            <th style="width: 15%;">Mã nhà thầu</th>
                            <th style="width: 35%;">Tên nhà thầu</th>
                            <th style="width: 15%;">Giá trị trúng thầu</th>
                            <th style="width: 15%;">Thời gian thực hiện</th>
                            <th style="width: 10%; text-align: center;">Trạng thái</th>
                            <th style="width: 10%;">Lý do trượt thầu</th>
                        </tr>
                    `;
                }

                contentWrapper.innerHTML = `
                    <div class="card" style="padding: 24px; border: 1px solid rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.02); border-radius: var(--radius-lg); margin-bottom: 24px; display: flex; flex-direction: column; gap: 16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                            <div style="display:flex; gap:12px; align-items:center;">
                                <i data-lucide="check-circle" class="text-success" style="width:36px; height:36px;"></i>
                                <div>
                                    <h4 style="margin:0; font-size:1.15rem; font-weight:800; color:var(--text-main);">Gói thầu đã hoàn thành LCNT</h4>
                                    <p class="text-muted" style="margin:0; font-size:0.8rem;">Đã phê duyệt kết quả lựa chọn nhà thầu chính thức.</p>                                </div>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="ketquaqd" id="btn-result-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="ketquaqd" id="btn-result-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                                <button class="btn btn-primary" id="btn-export-docx-report" style="font-weight:700;"><i data-lucide="file-text"></i> Xuất Báo cáo Kết quả (Word)</button>
                            </div>
                        </div>

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
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">QĐ phê duyệt số</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${gt.soQuyetDinhKetQua || '--'}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Ngày ký QĐ</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${gt.ngayQuyetDinhKetQua ? this.model.formatDate(gt.ngayQuyetDinhKetQua) : '--'}</h5>
                            </div>
                        </div>
                    </div>

                    <h5 style="margin-top:24px; margin-bottom:12px; font-weight:700; font-size:0.95rem; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                        <i data-lucide="list"></i> Danh sách Nhà thầu tham dự và kết quả đánh giá
                    </h5>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                        <table class="data-table" style="min-width: 100%;">
                            <thead>
                                ${tableHeaderHtml}
                            </thead>
                            <tbody>
                                ${allBiddersHtml}
                            </tbody>
                        </table>
                    </div>
                `;

                const exportBtn = document.getElementById('btn-export-docx-report');
                if (exportBtn) {
                    exportBtn.onclick = () => {
                        exportBtn.disabled = true;
                        const origText = exportBtn.innerHTML;
                        exportBtn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:16px;"></i> Đang xuất...';
                        lucide.createIcons();

                        // Gọi thẳng API xuất Word, không cần sync lại toàn bộ state
                        // Dữ liệu đã được đồng bộ tự động khi người dùng lưu
                        const dbId = id;
                        const headers = {
                            'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                            'X-Username': sessionStorage.getItem('bf_username') || ''
                        };
                        fetch(`/api/export-report/${dbId}`, { headers })
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
                const allBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
                // Sort by maPhanLo A-Z
                allBids.sort((x, y) => {
                    const lotX = String(x.maPhanLo || '').trim();
                    const lotY = String(y.maPhanLo || '').trim();
                    return lotX.localeCompare(lotY, 'vi', { numeric: true });
                });
                const allBidsForResult = this.model.state.thongtinmothau.filter(b =>
                    String(b.goiThauId) === String(gt.id) &&
                    (b.danhGiaKetLuan ? (b.danhGiaKetLuan === 'Đạt' || b.danhGiaKetLuan.startsWith('Đạt')) : (b.danhGiaHopLe === 'Đạt' && b.danhGiaNangLuc === 'Đạt' && b.danhGiaKyThuat !== 'Không đạt' && b.danhGiaKyThuat !== ''))
                );

                const { rankings, scores } = window.appController.calculateRankings(gt, allBids);
                const isCombinedMethod = gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá';
                const getIsQualified = (bidItem) => {
                    return bidItem.danhGiaKetLuan ? (bidItem.danhGiaKetLuan === 'Đạt' || bidItem.danhGiaKetLuan.startsWith('Đạt')) : (bidItem.danhGiaHopLe === 'Đạt' && bidItem.danhGiaNangLuc === 'Đạt' && bidItem.danhGiaKyThuat !== 'Không đạt' && bidItem.danhGiaKyThuat !== '' && bidItem.danhGiaKyThuat);
                };

                const allBiddersHtml = allBids.map((b, idx) => {
                    const isQualified = getIsQualified(b);

                    let defaultReason = '';
                    if (gt.quyTrinhDanhGia === 'quytrinh2' && b.danhGiaKetLuan === 'Không đánh giá') {
                        defaultReason = "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";
                    } else if (!isQualified) {
                        if (!b.danhGiaHopLe || b.danhGiaHopLe !== 'Đạt') {
                            defaultReason = "Không đạt yêu cầu về tính hợp lệ";
                        } else if (!b.danhGiaNangLuc || b.danhGiaNangLuc !== 'Đạt') {
                            defaultReason = "Không đạt yêu cầu về năng lực, kinh nghiệm";
                        } else {
                            defaultReason = "Không đạt yêu cầu kỹ thuật";
                        }
                    } else {
                        defaultReason = "Nhà thầu xếp hạng 1 trúng thầu";
                    }

                    const displayReason = b.lyDoTruot || defaultReason;

                    const defaultPrice = this.model.formatVND(b.giaSauGiamGia || b.giaDuThau || '') || '';
                    const defaultDurationPkg = b.thoiGianThucHien || gt.thoiGianThucHien || '';
                    const defaultDurationCtr = defaultDurationPkg ? (defaultDurationPkg + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '';
                    const rank = rankings[b.id];
                    const score = scores[b.id];
                    const rankDisplay = rank ? `Xếp hạng ${rank}` : (isQualified ? '--' : 'Không xếp hạng');

                    let isRowWinner = false;
                    if (isQualified) {
                        if (gt.phanLo === 'Có') {
                            const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
                            const currentLotCode = b.maPhanLo;
                            const pl = plList.find(p => p.maPhanLo === currentLotCode);
                            if (pl && pl.nhaThauTrungThauId) {
                                isRowWinner = String(pl.nhaThauTrungThauId) === String(b.nhaThauId || b.id);
                            } else {
                                isRowWinner = (rank === 1);
                            }
                        } else {
                            if (gt.nhaThauTrungThauId) {
                                isRowWinner = String(gt.nhaThauTrungThauId) === String(b.nhaThauId || b.id);
                            } else {
                                isRowWinner = (rank === 1);
                            }
                        }
                    }

                    return `
                        <tr data-approve-bid-id="${b.id}" data-is-qualified="${isQualified}" data-nt-id="${b.nhaThauId || b.id}"
                            data-default-price="${defaultPrice}" data-default-duration-pkg="${defaultDurationPkg}" data-default-duration-ctr="${defaultDurationCtr}"
                            data-default-reason="${defaultReason}">
                            ${gt.phanLo === 'Có' ? `
                                <td>${b.maPhanLo || '--'}</td>
                                <td>${b.tenPhanLo || '--'}</td>
                            ` : ''}
                            <td>${b.maNhaThau || b.maDinhDanh || '--'}</td>
                            <td class="fw-bold">${b.tenNhaThau || '--'}</td>
                            ${isCombinedMethod ? `
                                <td style="text-align: center; font-weight: 700; color: var(--primary);">${score !== undefined && score !== null && !isNaN(score) && score > 0 ? score.toFixed(2) : '--'}</td>
                            ` : ''}
                            <td style="text-align: center; font-weight: bold; color: var(--primary);">${rankDisplay}</td>
                            <td>
                                <select class="form-control row-status-select" style="padding:4px 8px; font-size:0.8rem; font-weight:600;" ${!isQualified ? 'disabled' : ''}>
                                    <option value="truot" ${!isRowWinner ? 'selected' : ''}>Trượt thầu</option>
                                    ${isQualified ? `<option value="trung" ${isRowWinner ? 'selected' : ''}>Trúng thầu</option>` : ''}
                                </select>
                            </td>
                            <td>
                                <input type="text" class="form-control row-ly-do-truot" value="${!isRowWinner ? displayReason : ''}" placeholder="Lý do trượt..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${isRowWinner ? 'disabled style="background:#f1f5f9;"' : ''}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-gia-trung" value="${isRowWinner ? defaultPrice : ''}" placeholder="Giá trúng..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ''}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-tg-goithau" value="${isRowWinner ? defaultDurationPkg : ''}" placeholder="Thời gian gói..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ''}>
                            </td>
                            <td>
                                <input type="text" class="form-control row-tg-hopdong" value="${isRowWinner ? defaultDurationCtr : ''}" placeholder="Thời gian HĐ..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ''}>
                            </td>
                        </tr>
                    `;
                }).join('');

                contentWrapper.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin: 0;">
                                Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)
                            </h4>
                            <p class="text-muted" style="font-size:0.82rem; margin: 4px 0 0 0;">
                                Vui lòng nhập QĐ phê duyệt và chọn kết quả trúng thầu/trượt thầu cho từng nhà thầu bên dưới.
                            </p>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-excel-action" id="btn-result-export-excel-template">
                                <i data-lucide="download"></i> Tải Excel Mẫu
                            </button>
                            <button class="btn-excel-action" id="btn-result-import-excel">
                                <i data-lucide="upload"></i> Nhập từ Excel
                            </button>
                        </div>
                    </div>

                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-lg); background: var(--bg-card); display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px;">
                        <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px; margin-bottom:0;">
                                <label style="font-weight:700; font-size:0.85rem;">QĐ phê duyệt số <span class="required">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control" required value="${gt.soQuyetDinhKetQua || ''}" placeholder="Số QĐ...">
                                <span class="error-text">Vui lòng nhập số QĐ</span>
                            </div>
                            <div class="form-group" style="display:flex; flex-direction:column; gap:6px; margin-bottom:0;">
                                <label style="font-weight:700; font-size:0.85rem;">Ngày ký QĐ <span class="required">*</span></label>
                                <input type="text" id="award-decision-date" class="form-control flatpickr-dmy" required value="${gt.ngayQuyetDinhKetQua ? this.model.formatDate(gt.ngayQuyetDinhKetQua) : ''}" placeholder="Chọn ngày...">
                                <span class="error-text">Vui lòng chọn ngày ký QĐ</span>
                            </div>
                        </div>
                    </div>

                    <h5 style="margin-top:24px; margin-bottom:12px; font-weight:700; font-size:0.95rem; color:var(--text-main); display:flex; align-items:center; gap:6px;">
                        <i data-lucide="list"></i> Danh sách nhà thầu tham dự & Kết quả LCNT
                    </h5>
                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                        <table class="data-table" style="min-width: 100%;">
                            <thead>
                                <tr>
                                    ${gt.phanLo === 'Có' ? `
                                        <th style="width: 10%;">Mã phần lô</th>
                                        <th style="width: 10%;">Tên phần lô</th>
                                    ` : ''}
                                    <th style="width: 10%;">Mã nhà thầu</th>
                                    <th style="width: 16%;">Tên nhà thầu</th>
                                    ${isCombinedMethod ? `
                                        <th style="width: 10%; text-align: center;">Điểm tổng hợp</th>
                                    ` : ''}
                                    <th style="width: 10%; text-align: center;">Xếp hạng nhà thầu</th>
                                    <th style="width: 10%;">Trúng thầu/trượt thầu</th>
                                    <th style="width: 14%;">Lý do trượt</th>
                                    <th style="width: 10%;">Giá trúng thầu</th>
                                    <th style="width: 8%;">Thời gian thực hiện gói thầu</th>
                                    <th style="width: 8%;">Thời gian thực hiện hợp đồng</th>
                                </tr>
                            </thead>
                            <tbody id="approve-bidders-tbody">
                                ${allBiddersHtml}
                            </tbody>
                        </table>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-approve-award" style="padding:12px 24px; font-weight:700; display:flex; align-items:center; gap:8px;">
                            <i data-lucide="check-circle2"></i> Phê duyệt & Hoàn thành LCNT
                        </button>
                    </div>
                `;

                flatpickr('#award-decision-date', {
                    dateFormat: "d/m/Y",
                    locale: "vn",
                    allowInput: true
                });

                const tbodyApprove = document.getElementById('approve-bidders-tbody');
                if (tbodyApprove) {
                    // Format VND currency input
                    tbodyApprove.querySelectorAll('.row-gia-trung').forEach(inp => {
                        inp.addEventListener('input', (e) => {
                            const formatted = this.model.formatVND(e.target.value);
                            e.target.value = formatted;
                        });
                    });

                    // Auto-fill contract execution duration based on package execution duration
                    tbodyApprove.querySelectorAll('.row-tg-goithau').forEach(inp => {
                        inp.addEventListener('input', (e) => {
                            const tr = e.target.closest('tr');
                            const inpDurationCtr = tr.querySelector('.row-tg-hopdong');
                            if (inpDurationCtr) {
                                const val = e.target.value.trim();
                                inpDurationCtr.value = val ? (val + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '';
                            }
                        });
                    });

                    // Dropdown status change listeners
                    tbodyApprove.querySelectorAll('.row-status-select').forEach(selectEl => {
                        selectEl.addEventListener('change', (e) => {
                            const tr = e.target.closest('tr');
                            const val = e.target.value;

                            if (val === 'trung') {
                                // Reset all other rows to 'truot' (only in same lot if package has lots)
                                const currentLot = tr.cells[0]?.textContent.trim();
                                tbodyApprove.querySelectorAll('tr').forEach(otherTr => {
                                    if (otherTr !== tr) {
                                        if (gt.phanLo === 'Có') {
                                            const otherLot = otherTr.cells[0]?.textContent.trim();
                                            if (otherLot !== currentLot) return; // skip rows belonging to different lots
                                        }

                                        const otherSelect = otherTr.querySelector('.row-status-select');
                                        if (otherSelect && !otherSelect.disabled) {
                                            otherSelect.value = 'truot';
                                        }

                                        const otherLyDo = otherTr.querySelector('.row-ly-do-truot');
                                        if (otherLyDo) {
                                            otherLyDo.disabled = false;
                                            otherLyDo.style.background = '';
                                            if (!otherLyDo.value) {
                                                otherLyDo.value = otherTr.getAttribute('data-default-reason') || 'Nhà thầu xếp hạng 1 trúng thầu';
                                            }
                                        }

                                        const otherGia = otherTr.querySelector('.row-gia-trung');
                                        if (otherGia) { otherGia.disabled = true; otherGia.style.background = '#f1f5f9'; otherGia.value = ''; }
                                        const otherDurationPkg = otherTr.querySelector('.row-tg-goithau');
                                        if (otherDurationPkg) { otherDurationPkg.disabled = true; otherDurationPkg.style.background = '#f1f5f9'; otherDurationPkg.value = ''; }
                                        const otherDurationCtr = otherTr.querySelector('.row-tg-hopdong');
                                        if (otherDurationCtr) { otherDurationCtr.disabled = true; otherDurationCtr.style.background = '#f1f5f9'; otherDurationCtr.value = ''; }
                                    }
                                });

                                // Enable winning inputs on this row and populate defaults
                                const inpGia = tr.querySelector('.row-gia-trung');
                                if (inpGia) {
                                    inpGia.disabled = false;
                                    inpGia.style.background = '';
                                    inpGia.value = tr.getAttribute('data-default-price') || '';
                                }
                                const inpDurationPkg = tr.querySelector('.row-tg-goithau');
                                if (inpDurationPkg) {
                                    inpDurationPkg.disabled = false;
                                    inpDurationPkg.style.background = '';
                                    inpDurationPkg.value = tr.getAttribute('data-default-duration-pkg') || '';
                                }
                                const inpDurationCtr = tr.querySelector('.row-tg-hopdong');
                                if (inpDurationCtr) {
                                    inpDurationCtr.disabled = false;
                                    inpDurationCtr.style.background = '';
                                    inpDurationCtr.value = tr.getAttribute('data-default-duration-ctr') || '';
                                }

                                // Disable failure reason input on this row
                                const inpLyDo = tr.querySelector('.row-ly-do-truot');
                                if (inpLyDo) { inpLyDo.disabled = true; inpLyDo.style.background = '#f1f5f9'; inpLyDo.value = ''; }
                            } else {
                                // Enable failure reason, disable and clear winning inputs on this row
                                const inpGia = tr.querySelector('.row-gia-trung');
                                if (inpGia) { inpGia.disabled = true; inpGia.style.background = '#f1f5f9'; inpGia.value = ''; }
                                const inpDurationPkg = tr.querySelector('.row-tg-goithau');
                                if (inpDurationPkg) { inpDurationPkg.disabled = true; inpDurationPkg.style.background = '#f1f5f9'; inpDurationPkg.value = ''; }
                                const inpDurationCtr = tr.querySelector('.row-tg-hopdong');
                                if (inpDurationCtr) { inpDurationCtr.disabled = true; inpDurationCtr.style.background = '#f1f5f9'; inpDurationCtr.value = ''; }

                                const inpLyDo = tr.querySelector('.row-ly-do-truot');
                                if (inpLyDo) {
                                    inpLyDo.disabled = false;
                                    inpLyDo.style.background = '';
                                    inpLyDo.value = tr.getAttribute('data-default-reason') || 'Nhà thầu xếp hạng 1 trúng thầu';
                                }
                            }
                        });
                    });
                }

                const approveBtn = document.getElementById('btn-approve-award');
                if (approveBtn) {
                    approveBtn.onclick = async () => {
                        const decNo = document.getElementById('award-decision-no')?.value.trim() || '';
                        const decDateRaw = document.getElementById('award-decision-date')?.value || '';
                        const decDate = this.model.convertDMYToYMD(decDateRaw);

                        let hasError = false;
                        const errorInputs = [];

                        // Validate QĐ inputs
                        const fields = [
                            { el: document.getElementById('award-decision-no'), val: decNo },
                            { el: document.getElementById('award-decision-date'), val: decDateRaw }
                        ];

                        fields.forEach(f => {
                            if (!f.val) {
                                hasError = true;
                                if (f.el) {
                                    errorInputs.push(f.el);
                                    f.el.closest('.form-group')?.classList.add('invalid');
                                    const clearInvalid = () => {
                                        f.el.closest('.form-group')?.classList.remove('invalid');
                                    };
                                    f.el.addEventListener('input', clearInvalid);
                                    f.el.addEventListener('change', clearInvalid);
                                }
                            }
                        });

                        // Identify winner rows
                        const winnerRows = [];
                        tbodyApprove.querySelectorAll('tr').forEach(tr => {
                            const status = tr.querySelector('.row-status-select')?.value;
                            if (status === 'trung') {
                                winnerRows.push(tr);
                            }
                        });

                        winnerRows.forEach(wTr => {
                            const finalPriceRaw = wTr.querySelector('.row-gia-trung')?.value || '';
                            const durPkg = wTr.querySelector('.row-tg-goithau')?.value.trim() || '';
                            const durCtr = wTr.querySelector('.row-tg-hopdong')?.value.trim() || '';

                            const rowInputs = [
                                { el: wTr.querySelector('.row-gia-trung'), val: finalPriceRaw },
                                { el: wTr.querySelector('.row-tg-goithau'), val: durPkg },
                                { el: wTr.querySelector('.row-tg-hopdong'), val: durCtr }
                            ];

                            rowInputs.forEach(f => {
                                if (!f.val) {
                                    hasError = true;
                                    if (f.el) {
                                        errorInputs.push(f.el);
                                        f.el.style.border = '1px solid var(--danger)';
                                        const clearInvalid = () => {
                                            f.el.style.border = '';
                                        };
                                        f.el.addEventListener('input', clearInvalid);
                                    }
                                }
                            });
                        });

                        if (hasError) {
                            if (errorInputs.length > 0) {
                                const first = errorInputs[0];
                                first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                                setTimeout(() => first.focus({ preventScroll: true }), 300);
                            }
                            return;
                        }

                        // Save bidder failure reasons to database / model state
                        tbodyApprove.querySelectorAll('tr').forEach(tr => {
                            const bidId = tr.getAttribute('data-approve-bid-id');
                            const bid = this.model.state.thongtinmothau.find(b => b.id === bidId);
                            if (bid) {
                                const status = tr.querySelector('.row-status-select')?.value;
                                if (status === 'trung') {
                                    bid.lyDoTruot = '';
                                } else {
                                    bid.lyDoTruot = tr.querySelector('.row-ly-do-truot')?.value.trim() || '';
                                }
                            }
                        });

                        let hasWinner = winnerRows.length > 0;
                        let winnerIdStr = 'none';
                        if (gt.phanLo === 'Có') {
                            const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
                            plList.forEach(pl => {
                                const lotWinnerTr = winnerRows.find(tr => tr.cells[0]?.textContent.trim() === pl.maPhanLo);
                                if (lotWinnerTr) {
                                    const wId = lotWinnerTr.getAttribute('data-nt-id');
                                    pl.nhaThauTrungThauId = wId ? (isNaN(wId) ? wId : parseInt(wId)) : '';
                                    pl.giaTrungThau = this.model.parseVND(lotWinnerTr.querySelector('.row-gia-trung')?.value || '0');
                                    pl.thoiGianGoiThau = lotWinnerTr.querySelector('.row-tg-goithau')?.value.trim() || '';
                                    pl.thoiGianHopDong = lotWinnerTr.querySelector('.row-tg-hopdong')?.value.trim() || '';
                                } else {
                                    pl.nhaThauTrungThauId = '';
                                    pl.giaTrungThau = 0;
                                    pl.thoiGianGoiThau = '';
                                    pl.thoiGianHopDong = '';
                                }
                            });
                            gt.phanLoList = plList;

                            const firstWinner = winnerRows[0];
                            if (firstWinner) {
                                const wId = firstWinner.getAttribute('data-nt-id');
                                gt.nhaThauTrungThauId = wId ? (isNaN(wId) ? wId : parseInt(wId)) : '';
                                gt.giaTrungThau = winnerRows.reduce((sum, tr) => sum + this.model.parseVND(tr.querySelector('.row-gia-trung')?.value || '0'), 0);
                                winnerIdStr = wId || 'none';
                            } else {
                                gt.nhaThauTrungThauId = '';
                                gt.giaTrungThau = 0;
                            }
                            gt.thoiGianGoiThau = '';
                            gt.thoiGianHopDong = '';
                        } else {
                            const winnerTr = winnerRows[0];
                            let finalPrice = 0;
                            let durPkg = '';
                            let durCtr = '';
                            if (winnerTr) {
                                winnerIdStr = winnerTr.getAttribute('data-nt-id');
                                finalPrice = this.model.parseVND(winnerTr.querySelector('.row-gia-trung')?.value || '0');
                                durPkg = winnerTr.querySelector('.row-tg-goithau')?.value.trim() || '';
                                durCtr = winnerTr.querySelector('.row-tg-hopdong')?.value.trim() || '';
                            }
                            gt.nhaThauTrungThauId = winnerIdStr === 'none' ? '' : (isNaN(winnerIdStr) ? winnerIdStr : parseInt(winnerIdStr));
                            gt.giaTrungThau = finalPrice;
                            gt.thoiGianGoiThau = winnerIdStr === 'none' ? '' : durPkg;
                            gt.thoiGianHopDong = winnerIdStr === 'none' ? '' : durCtr;
                        }
                        gt.soQuyetDinhKetQua = decNo;
                        gt.ngayQuyetDinhKetQua = decDate;
                        gt.trangThai = hasWinner ? 'Đã có kết quả' : 'Hủy thầu';

                        this.model.persistData('goithau');
                        this.model.persistData('thongtinmothau');
                        this.renderGoiThauTable();
                        window.appController.autoSync();

                        const alertTitle = winnerIdStr === 'none' ? 'Hủy thầu thành công' : 'Chúc mừng';
                        const alertMsg = winnerIdStr === 'none' ? `Đã cập nhật trạng thái hủy thầu cho gói thầu "${gt.tenGoiThau}" thành công!` : `Đã phê duyệt trúng thầu cho gói thầu "${gt.tenGoiThau}" thành công!`;
                        await this.customAlert(alertTitle, alertMsg, 'check-circle');
                        this.showPackageDetails(id);
                    };
                }
            }

            const resultExportBtn = document.getElementById('btn-result-export-excel-template');
            if (resultExportBtn) {
                resultExportBtn.onclick = () => {
                    const safeCode = (gt.tenGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9]/g, '_');
                    authFetchDownload(`/api/export-ketquaqd-template?package_id=${gt.id}&package_name=${encodeURIComponent(safeCode)}`, `KetQua_QD_${safeCode}.xlsx`);
                };
            }

            const resultImportBtn = document.getElementById('btn-result-import-excel');
            if (resultImportBtn) {
                resultImportBtn.onclick = () => {
                    window.appController._currentResultPackageId = gt.id;
                    window.appController.openExcelImportModal('ketquaqd');
                };
            }
            break;
    }
    lucide.createIcons();
    if (window.appController && window.appController.setupExcelImportEvents) {
        window.appController.setupExcelImportEvents();
    }
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
        quyetDinhPheDuyet: 'QĐ phê duyệt',
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
        nguoiKyQuyetDinh: 'Người ký QĐ',
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
        danhGiaKetLuan: 'Kết luận',

        // ketquaqd
        giaTrungThau: 'Giá trúng thầu',
        thoiGianGoiThau: 'Thời gian thực hiện gói thầu',
        thoiGianHopDong: 'Thời gian thực hiện hợp đồng',
        lyDoTruot: 'Lý do trượt thầu'
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
