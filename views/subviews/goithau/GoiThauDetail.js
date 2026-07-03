import { authFetchDownload, initCustomSelect } from '../view_helpers.js';

export function checkBidQualified(b) {
    if (!b) return false;
    const kl = String(b.danhGiaKetLuan || '').trim().toLowerCase();
    if (kl) {
        return kl === 'đạt' || kl.startsWith('đạt') || kl.includes('trúng thầu');
    }
    const hl = String(b.danhGiaHopLe || '').trim().toLowerCase();
    const nl = String(b.danhGiaNangLuc || '').trim().toLowerCase();
    const kt = String(b.danhGiaKyThuat || '').trim().toLowerCase();
    return hl === 'đạt' && nl === 'đạt' && kt !== 'không đạt' && kt !== '';
}


export function showPackageDetails(id, isSwitchingVersion = false) {
    if (!window._vietnameseHolidays) {
        fetch('/api/holidays')
            .then(r => r.json())
            .then(data => {
                window._vietnameseHolidays = data || {};
                this.showPackageDetails(id, isSwitchingVersion);
            })
            .catch(e => {
                console.error('Failed to load holidays:', e);
                window._vietnameseHolidays = {};
                this.showPackageDetails(id, isSwitchingVersion);
            });
        return;
    }
    let targetId = id;
    if (!isSwitchingVersion) {
        const latestPkg = this.model.getLatestPackage(id);
        if (latestPkg) {
            targetId = latestPkg.id;
        }
    }
    id = targetId;

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
        this._biddingInfoEditMode = false;
    }

    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;

    // Calculate tabs & select current active tab first to ensure correct button visibility checks
    const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
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
    const qualifiedBidsForOpening = allBidsForOpening.filter(checkBidQualified);
    const isFinOpeningSaved = qualifiedBidsForOpening.some(b => b.giaDuThau && b.giaDuThau > 0);

    let tabs = [{ id: 'preparation', label: 'Thông tin gói thầu' }];
    if (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
        tabs.push({ id: 'opening', label: 'Dữ liệu nhà thầu' });
        const hasSavedBidders = this.model.state.thongtinmothau.some(b => String(b.goiThauId) === String(gt.id));
        if (hasSavedBidders) {
            tabs.push({ id: 'result', label: 'Kết quả lựa chọn nhà thầu' });
        }
    } else {
        if (gt.trangThai === 'Chuẩn bị') {
            tabs.push({ id: 'preparation_action', label: 'Phát hành E-HSMT' });
        } else {
            if (is1G2T) {
                tabs.push({ id: 'opening_tech', label: gt.trangThai === 'Đang mời thầu' ? 'Thông tin mời thầu' : 'Biên bản mở E-HSĐXKT' });
                if (gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu' && (gt.trangThai !== 'Hủy thầu' || isTechEvalSaved)) {
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

                const hasQualifiedBidders = qualifiedBidsForOpening.length > 0;
                if (isTechEvalSaved && hasQualifiedBidders) {
                    tabs.push({ id: 'qualified', label: 'Danh sách nhà thầu đạt kỹ thuật' });
                }
                if (isTechEvalSaved && isQualifiedSaved && hasQualifiedBidders) {
                    tabs.push({ id: 'opening_fin', label: 'Biên bản mở E-HSĐXTC' });
                }
                if (isTechEvalSaved && isQualifiedSaved && hasQualifiedBidders && isFinOpeningSaved) {
                    tabs.push({ id: 'eval_fin', label: 'Báo cáo đánh giá E-HSĐXTC' });
                }

                const showResultNoQualified = isTechEvalSaved && !hasQualifiedBidders;
                const showResultNormal = isTechEvalSaved && isQualifiedSaved && hasQualifiedBidders && isFinOpeningSaved && (isFinEvalSaved || gt.trangThai === 'Đã có kết quả' || (gt.trangThai === 'Hủy thầu' && gt.soQuyetDinhKetQua));

                if (showResultNoQualified || showResultNormal) {
                    tabs.push({ id: 'result', label: 'Kết quả lựa chọn nhà thầu' });
                }
            } else {
                tabs.push({ id: 'opening', label: gt.trangThai === 'Đang mời thầu' ? 'Thông tin mời thầu' : 'Biên bản mở thầu' });
                if (gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu' && (gt.trangThai !== 'Hủy thầu' || isEvalSaved1G1T)) {
                    tabs.push({ id: 'eval_tech', label: 'Báo cáo đánh giá E-HSDT' });
                }
                if (isEvalSaved1G1T || gt.trangThai === 'Đã có kết quả' || (gt.trangThai === 'Hủy thầu' && isEvalSaved1G1T && gt.soQuyetDinhKetQua)) {
                    tabs.push({ id: 'result', label: 'Kết quả lựa chọn nhà thầu' });
                }
            }
        }
    }

    let hasCancelDetails = false;
    if (gt.danhGiaHsdtMetadata) {
        try {
            const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
            if (parsed.cancelDetails && (parsed.cancelDetails.soQuyetDinhHuyThau || parsed.cancelDetails.lyDoHuyThau)) {
                hasCancelDetails = true;
            }
        } catch (e) { }
    }
    if (gt.trangThai === 'Hủy thầu' || this._currentWorkflowTab === 'cancel' || hasCancelDetails) {
        tabs.push({ id: 'cancel', label: 'Hủy thầu' });
    }

    if (!tabs.some(t => t.id === this._currentWorkflowTab) || this._currentWorkflowPackageId !== id) {
        this._currentWorkflowTab = tabs[0] ? tabs[0].id : 'preparation';
        this._currentWorkflowPackageId = id;
    }

    const latestPlan = this.model.getLatestPlan(gt.keHoachId);
    const isPlanLatest = latestPlan && latestPlan.id === gt.keHoachId;
    const latestPkg = this.model.getLatestPackage(gt.id);
    const isPkgLatest = latestPkg && latestPkg.id === gt.id;
    const isEditable = isPkgLatest && gt.trangThai !== 'Hủy thầu';

    const kh = this.model.getLatestPlan(gt.keHoachId);

    // 1. Update header elements
    const codeEl = document.getElementById('detail-workflow-code');
    const badgeEl = document.getElementById('detail-workflow-status-badge');
    const titleEl = document.getElementById('detail-workflow-title');

    if (codeEl) codeEl.innerText = gt.maGoiThau || 'Gói thầu';
    if (badgeEl) badgeEl.innerHTML = this.getStatusBadge(gt.trangThai);
    if (titleEl) titleEl.innerText = gt.tenGoiThau || 'Chưa nhập tên';

    const actionsEl = document.getElementById('detail-workflow-actions');
    if (actionsEl) {
        let actionsHtml = `
            <button class="btn btn-outline" onclick="window.switchTab('goithau')"
                style="padding: 10px 20px; font-weight: 600; display: flex; align-items: center; gap: 6px; height: 38px;">
                <i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> Quay lại danh sách
            </button>
        `;
        if (gt.trangThai !== 'Chuẩn bị' && gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu' && gt.trangThai !== 'Hủy thầu') {
            actionsHtml += `
                <button id="btn-workflow-cancel-package" class="btn btn-danger"
                    style="padding: 10px 20px; font-weight: 600; display: flex; align-items: center; gap: 6px; height: 38px; background-color: var(--danger, #ef4444); color: white; border: none; border-radius: var(--radius-md); cursor: pointer;">
                    <i data-lucide="x-circle" style="width: 16px; height: 16px;"></i> Hủy thầu
                </button>
            `;
        }
        actionsEl.innerHTML = actionsHtml;

        const btnCancel = document.getElementById('btn-workflow-cancel-package');
        if (btnCancel) {
            btnCancel.onclick = () => {
                this._currentWorkflowTab = 'cancel';
                this.showPackageDetails(gt.id);
            };
        }
    }

    const verSelect = document.getElementById('detail-workflow-version-select');
    if (verSelect) {
        // Step 1: Always destroy stale custom select wrapper and body dropdown first
        const staleWrapper = verSelect.parentElement
            ? verSelect.parentElement.querySelector('.custom-select-container[data-target="detail-workflow-version-select"]')
            : null;
        if (staleWrapper) staleWrapper.remove();
        const staleDropdown = document.body.querySelector('.custom-select-dropdown[data-target="detail-workflow-version-select"]');
        if (staleDropdown) staleDropdown.remove();
        verSelect.style.display = 'none';

        // Step 2: Build version list for this specific package
        const rootId = gt.rootId || gt.id;
        const allRelated = this.model.state.goithau.filter(g => (g.rootId || g.id) === rootId);

        const verMap = {};
        allRelated.forEach(g => {
            const ver = g.phienBan || '00';
            if (!verMap[ver]) {
                verMap[ver] = g;
            } else {
                const p1 = this.model.getLatestPlan(g.keHoachId);
                const p2 = this.model.getLatestPlan(verMap[ver].keHoachId);
                const v1 = p1 ? (parseInt(p1.phienBan) || 0) : 0;
                const v2 = p2 ? (parseInt(p2.phienBan) || 0) : 0;
                if (v1 > v2) {
                    verMap[ver] = g;
                }
            }
        });
        const relatedGts = Object.values(verMap);
        relatedGts.sort((a, b) => (parseInt(a.phienBan || 0) - parseInt(b.phienBan || 0)));

        const separator = document.getElementById('detail-workflow-version-separator');

        // Step 3: Rebuild select options for this package
        verSelect.innerHTML = relatedGts.map(g => {
            const label = g.phienBan || '00';
            const isSelected = (g.phienBan || '00') === (gt.phienBan || '00');
            return `<option value="${g.id}" ${isSelected ? 'selected' : ''}>${label}</option>`;
        }).join('');

        // Step 4: Show/hide and wire up based on version count
        if (separator) separator.style.display = 'inline-block';
        verSelect.style.display = 'inline-block';

        if (relatedGts.length >= 2) {
            verSelect.disabled = false;
            verSelect.onchange = (e) => {
                this.showPackageDetails(e.target.value, true);
            };
        } else {
            verSelect.disabled = true;
            verSelect.onchange = null;
        }

        // Step 5: Build fresh custom select UI
        if (window.initCustomSelect) window.initCustomSelect('detail-workflow-version-select');
    }

    // 2. Setup dynamic workflow sub-tab
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
                this._biddingInfoEditMode = false;
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
                const khObj = this.model.getLatestPlan(gt.keHoachId);
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
                                        <span style="color: var(--text-muted); font-weight: 600;">Kế hoạch LCNT</span>
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
                                        <span style="color: var(--text-muted); font-weight: 600;">Bắt đầu tổ chức</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianBatDauToChuc || '--'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: ${(gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') ? 'none' : '1px solid rgba(226, 232, 240, 0.5)'}; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">${khObj && khObj.pheDuyet === 'Kế hoạch' ? 'Phê duyệt kế hoạch' : 'Phê duyệt dự toán và kế hoạch'}</span>
                                        <span style="color: var(--text-main); font-weight: 700;">${khObj && khObj.ngayPheDuyet ? this.model.formatDate(khObj.ngayPheDuyet) : '--'}</span>
                                    </div>
                                    ${(gt.hinhThucLuaChon !== 'Chỉ định thầu rút gọn' && gt.hinhThucLuaChon !== 'Lựa chọn nhà thầu trong trường hợp đặc biệt') ? `
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian đăng tải</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-dangtai" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianDangTai ? this.model.formatForDatetimeLocal(gt.thoiGianDangTai) : ''}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianDangTai ? this.model.formatDateWithTime(gt.thoiGianDangTai) : '--'}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian đóng thầu</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-dongthau" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianDongThau ? this.model.formatForDatetimeLocal(gt.thoiGianDongThau) : ''}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: ${gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ' ? '1px solid rgba(226, 232, 240, 0.5)' : 'none'}; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">${gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ' ? 'Thời gian mở E-HSĐXKT' : 'Thời gian mở thầu'}</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-mothau" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianMoThau ? this.model.formatForDatetimeLocal(gt.thoiGianMoThau) : ''}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</span>
                                        `}
                                    </div>
                                    ${gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ' ? `
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Thời gian mở E-HSĐXTC</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-moehsdxtc" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianMoEhsdxtc ? this.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : ''}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.thoiGianMoEhsdxtc ? this.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : '--'}</span>
                                        `}
                                    </div>
                                    ` : ''}
                                    ` : ''}
                                </div>
                            </div>
                        </div>

                        ${gt.hinhThucLuaChon === 'Chào hàng cạnh tranh' ? `
                        <!-- Cột 4: Quyết định phê duyệt HSMT (Dành riêng cho Chào hàng cạnh tranh ở dạng cột) -->
                        <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); display: flex; flex-direction: column; justify-content: space-between;">
                            <div>
                                <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                    <i data-lucide="file-text" style="width: 18px; height: 18px;"></i> Quyết định phê duyệt HSMT
                                </h4>
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
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayQuyetDinh ? this.model.formatForDateInput(gt.ngayQuyetDinh) : ''}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.ngayQuyetDinh ? this.model.formatDate(gt.ngayQuyetDinh) : '--'}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                        ` : ''}
                    </div>

                    ${gt.hinhThucLuaChon !== 'Chào hàng cạnh tranh' && gt.hinhThucLuaChon !== 'Chỉ định thầu rút gọn' && gt.hinhThucLuaChon !== 'Lựa chọn nhà thầu trong trường hợp đặc biệt' ? `
                    <!-- Cột 4: Phê duyệt HSMT (Trải ngang full chiều rộng) -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 24px;">
                            <h4 style="font-weight: 700; color: var(--primary); border-bottom: 2px solid rgba(59, 130, 246, 0.1); padding-bottom: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">
                                <i data-lucide="file-text" style="width: 18px; height: 18px;"></i> Phê duyệt HSMT
                            </h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Số tờ trình HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-sototrinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.soToTrinhHsmt || ''}" placeholder="Nhập số tờ trình">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.soToTrinhHsmt || '--'}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Ngày trình HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngaytrinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayTrinhHsmt ? this.model.formatForDateInput(gt.ngayTrinhHsmt) : ''}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.ngayTrinhHsmt ? this.model.formatDate(gt.ngayTrinhHsmt) : '--'}</span>
                                        `}
                                    </div>
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
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayQuyetDinh ? this.model.formatForDateInput(gt.ngayQuyetDinh) : ''}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.ngayQuyetDinh ? this.model.formatDate(gt.ngayQuyetDinh) : '--'}</span>
                                        `}
                                    </div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Yêu cầu thẩm định HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <div style="display: flex; gap: 16px; align-items: center;">
                                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-weight: 600; color: var(--text-main);">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Có" ${gt.yeuCauThamDinhHsmt === 'Có' ? 'checked' : ''} style="cursor: pointer; accent-color: var(--primary); margin: 0;"> Có
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-weight: 600; color: var(--text-main);">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Không" ${gt.yeuCauThamDinhHsmt === 'Không' || !gt.yeuCauThamDinhHsmt ? 'checked' : ''} style="cursor: pointer; accent-color: var(--primary); margin: 0;"> Không
                                                </label>
                                            </div>
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.yeuCauThamDinhHsmt || 'Không'}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-sobaocaothamdinh" style="display: ${this._inPlaceEditMode || gt.yeuCauThamDinhHsmt === 'Có' ? 'flex' : 'none'}; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Số BCTĐ HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <div style="display: flex; flex-direction: column; align-items: flex-end;">
                                                <input type="text" id="ip-sobaocaothamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.soBaoCaoThamDinhHsmt || ''}" placeholder="Nhập số báo cáo">
                                                <span class="error-msg-inline" id="err-sobaocao" style="display: none; color: #ef4444; font-size: 0.72rem; margin-top: 4px; font-weight: 600;">Vui lòng nhập số báo cáo</span>
                                            </div>
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.soBaoCaoThamDinhHsmt || '--'}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-ngaybaocaothamdinh" style="display: ${this._inPlaceEditMode || gt.yeuCauThamDinhHsmt === 'Có' ? 'flex' : 'none'}; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span style="color: var(--text-muted); font-weight: 600;">Ngày BCTĐ HSMT</span>
                                        ${this._inPlaceEditMode ? `
                                            <div style="display: flex; flex-direction: column; align-items: flex-end;">
                                                <input type="text" id="ip-ngaybaocaothamdinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayBaoCaoThamDinhHsmt ? this.model.formatForDateInput(gt.ngayBaoCaoThamDinhHsmt) : ''}" placeholder="dd/MM/yyyy">
                                                <span class="error-msg-inline" id="err-ngaybaocao" style="display: none; color: #ef4444; font-size: 0.72rem; margin-top: 4px; font-weight: 600;">Vui lòng chọn ngày báo cáo</span>
                                            </div>
                                        ` : `
                                            <span style="color: var(--text-main); font-weight: 700;">${gt.ngayBaoCaoThamDinhHsmt ? this.model.formatDate(gt.ngayBaoCaoThamDinhHsmt) : '--'}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                        ` : ''}
                     ${this._inPlaceEditMode ? `
                        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                            <button id="btn-cancel-inplace" class="btn btn-outline" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Hủy</button>
                            <button id="btn-save-inplace" class="btn btn-primary" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Lưu</button>
                        </div>
                    ` : `
                        ${isEditable && gt.trangThai !== 'Đang chấm thầu' && gt.trangThai !== 'Đã có kết quả' && gt.trangThai !== 'Hủy thầu' ? `
                            <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
                                <button id="btn-edit-goithau-bottom" class="btn btn-primary" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">
                                    <i data-lucide="edit"></i> Sửa gói thầu
                                </button>
                            </div>
                        ` : ''}
                    `}
                `;
                lucide.createIcons();

                const btnEditBottom = document.getElementById('btn-edit-goithau-bottom');
                if (btnEditBottom) {
                    btnEditBottom.onclick = () => {
                        if (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                            if (window.editGoiThau) {
                                window.editGoiThau(id);
                            }
                        } else {
                            this._inPlaceEditMode = true;
                            this.showPackageDetails(id);
                        }
                    };
                }

                if (this._inPlaceEditMode) {


                    const radioYeuCaus = document.querySelectorAll('input[name="ip-yeucauthamdinh"]');
                    if (radioYeuCaus.length > 0) {
                        const toggleReportFields = () => {
                            const checkedRadio = document.querySelector('input[name="ip-yeucauthamdinh"]:checked');
                            const show = checkedRadio && checkedRadio.value === 'Có';
                            document.getElementById('wrapper-sobaocaothamdinh').style.display = show ? 'flex' : 'none';
                            document.getElementById('wrapper-ngaybaocaothamdinh').style.display = show ? 'flex' : 'none';
                        };
                        radioYeuCaus.forEach(radio => {
                            radio.onchange = toggleReportFields;
                        });
                        toggleReportFields();
                    }

                    const btnSave = document.getElementById('btn-save-inplace');
                    if (btnSave) {
                        btnSave.onclick = async () => {
                            const valDangTai = document.getElementById('ip-dangtai').value;
                            const valDongThau = document.getElementById('ip-dongthau').value;
                            const valMoThau = document.getElementById('ip-mothau').value;
                            const inputMoEhsdxtc = document.getElementById('ip-moehsdxtc');
                            const valMoEhsdxtc = inputMoEhsdxtc ? inputMoEhsdxtc.value : '';
                            const valSoQuyetDinh = document.getElementById('ip-soquyetdinh').value;
                            const valNgayQuyetDinh = document.getElementById('ip-ngayquyetdinh').value;
                            const valSoToTrinh = document.getElementById('ip-sototrinh')?.value || '';
                            const valNgayTrinh = document.getElementById('ip-ngaytrinh')?.value || '';
                            const checkedRadio = document.querySelector('input[name="ip-yeucauthamdinh"]:checked');
                            const valYeuCauThamDinh = checkedRadio ? checkedRadio.value : 'Không';
                            const valSoBaoCao = document.getElementById('ip-sobaocaothamdinh')?.value || '';
                            const valNgayBaoCao = document.getElementById('ip-ngaybaocaothamdinh')?.value || '';
                             if (valYeuCauThamDinh === 'Có') {
                                 let hasErr = false;
                                 const inpSo = document.getElementById('ip-sobaocaothamdinh');
                                 const inpNgay = document.getElementById('ip-ngaybaocaothamdinh');
                                 
                                 if (inpSo) {
                                     const errEl = document.getElementById('err-sobaocao');
                                     if (!valSoBaoCao.trim()) {
                                         inpSo.style.setProperty('border', '1px solid #ef4444', 'important');
                                         if (errEl) errEl.style.display = 'block';
                                         hasErr = true;
                                     } else {
                                         inpSo.style.removeProperty('border');
                                         if (errEl) errEl.style.display = 'none';
                                     }
                                     inpSo.oninput = () => {
                                         inpSo.style.removeProperty('border');
                                         if (errEl) errEl.style.display = 'none';
                                     };
                                 }
                                 if (inpNgay) {
                                     const errEl = document.getElementById('err-ngaybaocao');
                                     if (!valNgayBaoCao.trim()) {
                                         inpNgay.style.setProperty('border', '1px solid #ef4444', 'important');
                                         if (errEl) errEl.style.display = 'block';
                                         hasErr = true;
                                     } else {
                                         inpNgay.style.removeProperty('border');
                                         if (errEl) errEl.style.display = 'none';
                                     }
                                     inpNgay.onchange = () => {
                                         inpNgay.style.removeProperty('border');
                                         if (errEl) errEl.style.display = 'none';
                                     };
                                 }
                                 if (hasErr) return;
                             }

                            const gtData = {
                                thoiGianDangTai: valDangTai ? this.model.convertDMYHMSToYMDHMS(valDangTai) : '',
                                thoiGianDongThau: valDongThau ? this.model.convertDMYHMSToYMDHMS(valDongThau) : '',
                                thoiGianMoThau: valMoThau ? this.model.convertDMYHMSToYMDHMS(valMoThau) : '',
                                thoiGianMoEhsdxtc: valMoEhsdxtc ? this.model.convertDMYHMSToYMDHMS(valMoEhsdxtc) : '',
                                soQuyetDinh: valSoQuyetDinh,
                                ngayQuyetDinh: valNgayQuyetDinh ? this.model.convertDMYToYMD(valNgayQuyetDinh) : '',
                                soToTrinhHsmt: valSoToTrinh,
                                ngayTrinhHsmt: valNgayTrinh ? this.model.convertDMYToYMD(valNgayTrinh) : '',
                                yeuCauThamDinhHsmt: valYeuCauThamDinh,
                                soBaoCaoThamDinhHsmt: valYeuCauThamDinh === 'Không' ? '' : valSoBaoCao,
                                ngayBaoCaoThamDinhHsmt: (valYeuCauThamDinh === 'Không' || !valNgayBaoCao) ? '' : this.model.convertDMYToYMD(valNgayBaoCao)
                            };

                            const oldTimeDang = gt.thoiGianDangTai ? String(gt.thoiGianDangTai).trim() : '';
                            const newTimeDang = String(gtData.thoiGianDangTai || '').trim();

                            const oldTimeDong = gt.thoiGianDongThau ? String(gt.thoiGianDongThau).trim() : '';
                            const newTimeDong = String(gtData.thoiGianDongThau || '').trim();

                            const oldTimeMo = gt.thoiGianMoThau ? String(gt.thoiGianMoThau).trim() : '';
                            const newTimeMo = String(gtData.thoiGianMoThau || '').trim();

                            let saveAsNewVersion = false;
                            if (oldTimeDang !== '') {
                                const compareDate = (oldStr, newStr) => {
                                    if (!oldStr && !newStr) return false;
                                    if (!oldStr || !newStr) return true;
                                    const d1 = new Date(oldStr);
                                    const d2 = new Date(newStr);
                                    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
                                        return oldStr !== newStr;
                                    }
                                    return d1.getTime() !== d2.getTime();
                                };

                                const dangChanged = compareDate(oldTimeDang, newTimeDang);
                                const dongChanged = compareDate(oldTimeDong, newTimeDong);
                                const moChanged = compareDate(oldTimeMo, newTimeMo);

                                if (dangChanged || dongChanged || moChanged) {
                                    saveAsNewVersion = true;
                                }
                            }

                            let finalId = id;
                            if (saveAsNewVersion) {
                                const rootId = gt.rootId || gt.id;
                                const relatedGts = this.model.state.goithau.filter(g => (g.rootId || g.id) === rootId);
                                const maxVersion = Math.max(...relatedGts.map(g => parseInt(g.phienBan) || 0));
                                const nextVersion = String(maxVersion + 1).padStart(2, '0');

                                relatedGts.forEach(g => { g.isLatest = 0; g.is_latest = 0; });
                                const newGtId = window.generateUUID();
                                finalId = newGtId;

                                if (!this.model.state.selectedPackageVersion) {
                                    this.model.state.selectedPackageVersion = {};
                                }
                                this.model.state.selectedPackageVersion[rootId] = newGtId;

                                // Clone and push new package version
                                const latestPlan = this.model.getLatestPlan(gt.keHoachId);
                                const latestPlanId = latestPlan ? latestPlan.id : gt.keHoachId;
                                this.model.state.goithau.push({
                                    ...gt,
                                    ...gtData,
                                    keHoachId: latestPlanId,
                                    id: newGtId,
                                    phienBan: nextVersion,
                                    isLatest: 1,
                                    is_latest: 1,
                                    rootId: rootId,
                                    createdAt: gt.createdAt || this.model.getCurrentDateTimeString(),
                                    created_at: gt.created_at || this.model.getCurrentDateTimeString(),
                                    updatedAt: this.model.getCurrentDateTimeString(),
                                    updated_at: this.model.getCurrentDateTimeString()
                                });

                                // Duplicate related contracts (hopdong)
                                if (Array.isArray(this.model.state.hopdong)) {
                                    this.model.state.hopdong = this.model.state.hopdong.map(h => {
                                        if (h.goiThauIds && h.goiThauIds.includes(id)) {
                                            const updatedGoiThauIds = [...h.goiThauIds];
                                            if (!updatedGoiThauIds.includes(newGtId)) {
                                                updatedGoiThauIds.push(newGtId);
                                            }
                                            return {
                                                ...h,
                                                goiThauIds: updatedGoiThauIds
                                            };
                                        }
                                        return h;
                                    });
                                    this.model.persistData('hopdong');
                                }

                                // Duplicate related bids (thongtinmothau)
                                if (Array.isArray(this.model.state.thongtinmothau)) {
                                    const oldBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(id));
                                    const newBids = oldBids.map(b => ({
                                        ...b,
                                        id: window.generateUUID(),
                                        goiThauId: newGtId
                                    }));
                                    this.model.state.thongtinmothau = [...this.model.state.thongtinmothau, ...newBids];
                                    this.model.persistData('thongtinmothau');
                                }
                            } else {
                                // Overwrite current version
                                const latestPlan = this.model.getLatestPlan(gt.keHoachId);
                                if (latestPlan) {
                                    gt.keHoachId = latestPlan.id;
                                }
                                Object.assign(gt, gtData);
                                gt.updatedAt = this.model.getCurrentDateTimeString();
                                gt.updated_at = gt.updatedAt;
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
                            this.showPackageDetails(finalId);
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
        case 'opening_tech': {
            const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
            if (gt.trangThai === 'Chuẩn bị' && !isDirectOrSpecial) {
                // Keep fallback just in case
                const khObj = this.model.getLatestPlan(gt.keHoachId);
                const cdtObj = khObj ? this.model.state.chudautu.find(c => c.id === khObj.chuDauTuId) : null;
                const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : 'Không rõ';
                const tenKhStr = khObj ? khObj.tenKeHoach : 'Không rõ';

                contentWrapper.innerHTML = `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdtStr}</span></div>
                            <div>• <strong>Tên kế hoạch:</strong> <span class="text-dark fw-bold">${tenKhStr}</span></div>
                            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}${gt.linhVuc === 'Hàng hóa' ? (gt.isThuoc === 1 || gt.isThuoc === '1' ? ' (Thuốc)' : ' (Không phải thuốc)') : ''}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
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
            } else if (gt.trangThai === 'Đang mời thầu' && !isDirectOrSpecial) {
                const khObj = this.model.getLatestPlan(gt.keHoachId);
                const cdtObj = khObj ? this.model.state.chudautu.find(c => c.id === khObj.chuDauTuId) : null;
                const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : 'Không rõ';
                const tenKhStr = khObj ? khObj.tenKeHoach : 'Không rõ';

                contentWrapper.innerHTML = `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdtStr}</span></div>
                            <div>• <strong>Tên kế hoạch:</strong> <span class="text-dark fw-bold">${tenKhStr}</span></div>
                            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}${gt.linhVuc === 'Hàng hóa' ? (gt.isThuoc === 1 || gt.isThuoc === '1' ? ' (Thuốc)' : ' (Không phải thuốc)') : ''}</div>
                            <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong>Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            <div>• <strong>Thời gian đóng thầu:</strong> <span id="display-thoigiandongthau" style="font-weight:700;">${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</span></div>
                            <div>• <strong>Thời gian mở thầu:</strong> <span id="display-thoigianmothau" style="font-weight:700;">${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</span></div>
                        </div>
                    </div>

                    <!-- Gia hạn thời điểm đóng thầu -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4 style="font-weight: 700; color: var(--primary); margin: 0; font-size: 0.95rem;">Gia hạn thời điểm đóng thầu</h4>
                            <button type="button" id="btn-them-giahan" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: ${this._biddingInfoEditMode ? 'flex' : 'none'}; align-items: center; gap: 4px;">
                                <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Thêm gia hạn
                            </button>
                        </div>
                        <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto;">
                            <table class="data-table" id="giahan-table" style="min-width: 100%;">
                                <thead>
                                    <tr>
                                        <th style="width: 120px; text-align: center;">Lần gia hạn</th>
                                        <th>Thời gian đóng thầu <span style="color:var(--danger)">*</span></th>
                                        <th>Lý do gia hạn <span style="color:var(--danger)">*</span></th>
                                        <th style="width: 50px; display: ${this._biddingInfoEditMode ? '' : 'none'};"></th>
                                    </tr>
                                </thead>
                                <tbody id="gt-giahan-tbody"></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Yêu cầu làm rõ HSMT -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4 style="font-weight: 700; color: var(--primary); margin: 0; font-size: 0.95rem;">Yêu cầu làm rõ HSMT</h4>
                            <button type="button" id="btn-them-yeucaulamro" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: ${this._biddingInfoEditMode ? 'flex' : 'none'}; align-items: center; gap: 4px;">
                                <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Thêm yêu cầu
                            </button>
                        </div>
                        <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto;">
                            <table class="data-table" id="yeucaulamro-table" style="min-width: 100%;">
                                <thead>
                                    <tr>
                                        <th style="width: 80px; text-align: center;">STT</th>
                                        <th style="width: 250px;">Thời gian yêu cầu làm rõ <span style="color:var(--danger)">*</span></th>
                                        <th>Nội dung yêu cầu <span style="color:var(--danger)">*</span></th>
                                        <th style="width: 50px; display: ${this._biddingInfoEditMode ? '' : 'none'};"></th>
                                    </tr>
                                </thead>
                                <tbody id="gt-yeucaulamro-tbody"></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Trả lời làm rõ -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h4 style="font-weight: 700; color: var(--primary); margin: 0; font-size: 0.95rem;">Trả lời làm rõ</h4>
                            <button type="button" id="btn-them-traloilamro" class="btn btn-outline btn-sm" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: ${this._biddingInfoEditMode ? 'flex' : 'none'}; align-items: center; gap: 4px;">
                                <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Thêm trả lời
                            </button>
                        </div>
                        <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto;">
                            <table class="data-table" id="traloilamro-table" style="min-width: 100%;">
                                <thead>
                                    <tr>
                                        <th style="width: 80px; text-align: center;">STT</th>
                                        <th style="width: 250px;">Thời gian trả lời làm rõ <span style="color:var(--danger)">*</span></th>
                                        <th>Nội dung trả lời <span style="color:var(--danger)">*</span></th>
                                        <th style="width: 50px; display: ${this._biddingInfoEditMode ? '' : 'none'};"></th>
                                    </tr>
                                </thead>
                                <tbody id="gt-traloilamro-tbody"></tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color);">
                        <button class="btn btn-primary" onclick="window.moThauGoiThau('${gt.id}')" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;">
                            <i data-lucide="unlock"></i> Tiến hành Mở thầu
                        </button>
                        <button class="btn btn-primary" id="btn-luu-thongtinmoithau" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; background: ${this._biddingInfoEditMode ? '#10b981' : 'var(--primary)'}; border-color: ${this._biddingInfoEditMode ? '#10b981' : 'var(--primary)'};">
                            <i data-lucide="${this._biddingInfoEditMode ? 'save' : 'edit-3'}"></i> ${this._biddingInfoEditMode ? 'Lưu thông tin mời thầu' : 'Chỉnh sửa'}
                        </button>
                    </div>
                `;

                // Load existing sub-table rows
                if (window.appController) {
                    window.appController._loadGiaHanRows(gt.giaHanList || []);
                    window.appController._loadYeuCauLamRoRows(gt.yeuCauLamRoList || []);
                    window.appController._loadTraLoiLamRoRows(gt.traLoiLamRoList || []);
                }

                // If in read-only mode, disable inputs and hide last column (delete action column)
                if (!this._biddingInfoEditMode) {
                    document.querySelectorAll('#gt-giahan-tbody input, #gt-yeucaulamro-tbody input, #gt-traloilamro-tbody input').forEach(input => {
                        input.disabled = true;
                        input.style.background = 'var(--neutral-soft)';
                        input.style.cursor = 'not-allowed';
                    });
                    document.querySelectorAll('#gt-giahan-tbody td:last-child, #gt-yeucaulamro-tbody td:last-child, #gt-traloilamro-tbody td:last-child').forEach(td => {
                        td.style.display = 'none';
                    });
                }

                // Bind events to buttons
                const btnThemGiaHan = document.getElementById('btn-them-giahan');
                if (btnThemGiaHan) {
                    btnThemGiaHan.onclick = () => window.appController.addGiaHanRow();
                }
                const btnThemYeuCau = document.getElementById('btn-them-yeucaulamro');
                if (btnThemYeuCau) {
                    btnThemYeuCau.onclick = () => window.appController.addYeuCauLamRoRow();
                }
                const btnThemTraLoi = document.getElementById('btn-them-traloilamro');
                if (btnThemTraLoi) {
                    btnThemTraLoi.onclick = () => window.appController.addTraLoiLamRoRow();
                }

                // Bind Save/Edit button event
                const btnLuuThongTinMoiThau = document.getElementById('btn-luu-thongtinmoithau');
                if (btnLuuThongTinMoiThau) {
                    btnLuuThongTinMoiThau.onclick = async () => {
                        if (!this._biddingInfoEditMode) {
                            // Switch to edit mode
                            this._biddingInfoEditMode = true;
                            this.showPackageDetails(id);
                            return;
                        }

                        const giaHanList = window.appController._collectGiaHanRows();
                        const yeuCauLamRoList = window.appController._collectYeuCauLamRoRows();
                        const traLoiLamRoList = window.appController._collectTraLoiLamRoRows();

                        gt.giaHanList = giaHanList;
                        gt.yeuCauLamRoList = yeuCauLamRoList;
                        gt.traLoiLamRoList = traLoiLamRoList;

                        // Auto update thoiGianDongThau / thoiGianMoThau if extended
                        if (giaHanList.length > 0) {
                            const lastGiaHan = giaHanList[giaHanList.length - 1];
                            if (lastGiaHan.thoiGianDongThau) {
                                const convertedTime = this.model.convertDMYHMSToYMDHMS(lastGiaHan.thoiGianDongThau);
                                gt.thoiGianDongThau = convertedTime;
                                gt.thoiGianMoThau = convertedTime;
                            }
                        }

                        await this.model.persistData('goithau');
                        if (window.appController && typeof window.appController.autoSync === 'function') {
                            try {
                                await window.appController.autoSync();
                            } catch (e) {
                                console.error("Sync failed:", e);
                            }
                        }

                        this._biddingInfoEditMode = false;
                        this.showPackageDetails(id);
                        await this.customAlert('Thành công', 'Lưu thông tin mời thầu thành công!', 'check-circle');
                    };
                }

                lucide.createIcons();
            } else {
                contentWrapper.innerHTML = `
                    <select id="mothau-goithau-select" style="display:none;"><option value="${gt.id}" selected>${gt.tenGoiThau}</option></select>
                    <div id="mothau-goithau-summary" style="display:none;"></div>
                    <div id="mothau-bid-container" style="display:none;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                            <h4 id="mothau-table-title" style="font-weight:700; font-size:0.95rem; color:var(--text-main);">${isDirectOrSpecial ? 'Danh sách Nhà thầu' : 'Danh sách Nhà thầu tham dự &amp; Nộp hồ sơ'}</h4>
                            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="mothau" id="btn-mothau-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="mothau" id="btn-mothau-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                                <button class="btn btn-outline btn-sm" id="btn-mothau-add-bid" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600;"><i data-lucide="plus"></i> ${isDirectOrSpecial ? 'Thêm nhà thầu' : 'Thêm Nhà thầu nộp hồ sơ'}</button>
                            </div>
                        </div>
                        <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px;">
                            <table class="data-table" id="mothau-table" style="min-width:100%;">
                                <thead id="mothau-table-thead"></thead>
                                <tbody id="mothau-table-tbody"></tbody>
                            </table>
                        </div>
                        <div style="display:flex; justify-content:flex-end; gap:12px;">
                            <button class="btn btn-primary" id="btn-mothau-save" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> ${isDirectOrSpecial ? 'Lưu thông tin' : 'Lưu thông tin mở thầu'}</button>
                        </div>
                    </div>
                    <div id="mothau-empty-state" style="display:none;"></div>
                `;
                window.appController.renderMoThauPanel();
            }
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
                            <input type="text" id="danhgiahsdt-ngay-baocao" class="form-control flatpickr-date" required placeholder="dd/MM/yyyy">
                            <span class="error-text">Vui lòng chọn ngày báo cáo đánh giá</span>
                        </div>
                    </div>
                    <div id="danhgiahsdt-extra-fields-container" style="display: none; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày mời đối chiếu tài liệu/Thương thảo</label>
                            <input type="text" id="danhgiahsdt-ngay-moi-doichieu" class="form-control flatpickr-date" placeholder="dd/MM/yyyy">
                        </div>
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày đối chiếu tài liệu/Thương thảo</label>
                            <input type="text" id="danhgiahsdt-ngay-doichieu" class="form-control flatpickr-date" placeholder="dd/MM/yyyy">
                        </div>
                    </div>
                    <div id="danhgiahsdt-quytrinh-container" style="display:none; margin-bottom: 20px; padding: 12px 16px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: var(--radius-md); align-items: center; gap: 24px; flex-wrap: wrap;">
                        <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);">Quy trình đánh giá:</span>
                        <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text-main);">
                            <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh1" checked style="accent-color: var(--primary); cursor: pointer;">
                            Quy trình 1
                        </label>
                        <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text-main);">
                            <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh2" style="accent-color: var(--primary); cursor: pointer;">
                            Quy trình 2
                        </label>
                        <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; color: var(--text-main); margin-left: 12px; padding-left: 12px; border-left: 1px solid var(--border-color);">
                            <input type="checkbox" id="eval-co-uu-dai" style="accent-color: var(--primary); cursor: pointer;">
                            Có nhà thầu được hưởng ưu đãi
                        </label>
                        <span id="quytrinh2-warning-msg" style="color: #ef4444; font-size: 0.8rem; font-weight: 600; display: none;"></span>
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
                            <input type="text" id="danhgiahsdt-ngay-baocao" class="form-control flatpickr-date" required placeholder="dd/MM/yyyy">
                            <span class="error-text">Vui lòng chọn ngày báo cáo đánh giá</span>
                        </div>
                    </div>
                    <div id="danhgiahsdt-extra-fields-container" style="display: none; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày mời đối chiếu tài liệu/Thương thảo</label>
                            <input type="text" id="danhgiahsdt-ngay-moi-doichieu" class="form-control flatpickr-date" placeholder="dd/MM/yyyy">
                        </div>
                        <div class="form-group">
                            <label style="font-weight:700; font-size:0.85rem; color:var(--text-main); display:block; margin-bottom:6px;">Ngày đối chiếu tài liệu/Thương thảo</label>
                            <input type="text" id="danhgiahsdt-ngay-doichieu" class="form-control flatpickr-date" placeholder="dd/MM/yyyy">
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

        case 'qualified': {
            const allBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
            const qualifiedBids = allBids.filter(checkBidQualified);
            const hasTechScore = qualifiedBids.some(b => {
                if (!b.danhGiaKyThuat) return false;
                const clean = String(b.danhGiaKyThuat).trim().replace(/,/g, '.');
                return !isNaN(parseFloat(clean)) && isFinite(clean);
            }) || ['Kết hợp giữa kỹ thuật và giá', 'Giá cố định', 'Dựa trên kỹ thuật'].includes(gt.phuongPhapDanhGia);

            if (!isTechEvalSaved) {
                contentWrapper.innerHTML = `
                    <div style="text-align: center; padding: 48px; color: var(--text-muted);">
                        <i data-lucide="shield-alert" style="width: 48px; height: 48px; margin: 0 auto 16px; color: var(--warning);"></i>
                        <h4 style="font-weight: 700; color: var(--text-main);">Chưa có Nhà thầu đạt kỹ thuật</h4>
                        <p style="font-size: 0.85rem;">Vui lòng hoàn thành và Lưu Báo cáo đánh giá E-HSĐXKT trước.</p>
                    </div>
                `;
            } else {
                const khObj = this.model.getLatestPlan(gt.keHoachId);
                const cdtObj = khObj ? this.model.state.chudautu.find(c => c.id === khObj.chuDauTuId) : null;
                const tenCdt = cdtObj ? cdtObj.tenChuDauTu : 'Không rõ';
                const tenKhStr = khObj ? khObj.tenKeHoach : 'Không rõ';
                const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';

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
                const ngayQd = metadata.technical.ngayQdPheDuyetKt || '';
                const soBctd = metadata.technical.soBctdKt || '';
                const ngayBctd = metadata.technical.ngayBctdKt || '';
                const isCompleted = !!metadata.technical.qualifiedSaved;
                const isEditingThisStep = this._editingState && this._editingState[this._currentWorkflowTab];
                const isFinOpened = !!gt.thoiGianMoEhsdxtc; // Biên bản mở E-HSĐXTC đã được lưu
                const isReadOnly = (isCompleted && !isEditingThisStep) || gt.trangThai === 'Đã có kết quả' || gt.trangThai === 'Hủy thầu';
                // Cho phép chỉnh sửa nếu đã lưu nhưng biên bản mở TC chưa có
                const canEdit = isReadOnly && isCompleted && !isFinOpened && gt.trangThai !== 'Đã có kết quả' && gt.trangThai !== 'Hủy thầu';
                const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');

                contentWrapper.innerHTML = `
                    <div style="padding: 12px 16px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: var(--radius-md); font-size: 0.85rem; color: var(--text-main); line-height: 1.6; margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong style="color: var(--primary);">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdt}</span></div>
                            <div>• <strong style="color: var(--primary);">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${tenKhStr}</span></div>
                            <div>• <strong style="color: var(--primary);">Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}</div>
                            <div>• <strong style="color: var(--primary);">Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong style="color: var(--primary);">Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong style="color: var(--primary);">Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong style="color: var(--primary);">Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong style="color: var(--primary);">Phương pháp đánh giá:</strong> ${gt.phuongPhapDanhGia}${gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá' && gt.trongSoKyThuat ? ` (${gt.trongSoKyThuat}%)` : ''}</div>` : ''}
                            <div>• <strong style="color: var(--primary);">Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong style="color: var(--primary);">Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong style="color: var(--primary);">Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong style="color: var(--primary);">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                            <div>• <strong style="color: var(--primary);">${is1G2T ? 'Thời gian mở E-HSĐXKT' : 'Thời gian mở thầu'}:</strong> ${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</div>
                            ${is1G2T ? `<div>• <strong style="color: var(--primary);">Thời gian mở E-HSĐXTC:</strong> ${gt.thoiGianMoEhsdxtc ? this.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : 'Chưa mở'}</div>` : ''}
                            ` : ''}
                        </div>
                    </div>

                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
                            ${gt.hinhThucLuaChon !== 'Chào hàng cạnh tranh' ? `
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Số BCTĐ kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-so-bctd" class="form-control" value="${soBctd}" placeholder="Nhập số báo cáo thẩm định..." style="width: 100%;" ${isReadOnly ? 'readonly' : ''}>
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số BCTĐ kỹ thuật!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Ngày BCTĐ kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-ngay-bctd" class="form-control flatpickr-date" value="${ngayBctd ? this.model.formatForDateInput(ngayBctd) : ''}" style="width: 100%;" ${isReadOnly ? 'readonly' : ''} placeholder="dd/MM/yyyy">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng chọn Ngày BCTĐ kỹ thuật!</span>
                            </div>
                            ` : ''}
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Số QĐ phê duyệt nhà thầu đạt kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-so-qd" class="form-control" value="${soQd}" placeholder="Ví dụ: 120/QĐ-CDT" style="width: 100%;" ${isReadOnly ? 'readonly' : ''}>
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số QĐ phê duyệt!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Ngày QĐ phê duyệt <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-ngay-qd" class="form-control flatpickr-date" value="${ngayQd ? this.model.formatForDateInput(ngayQd) : ''}" style="width: 100%;" ${isReadOnly ? 'readonly' : ''} placeholder="dd/MM/yyyy">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng chọn Ngày QĐ phê duyệt!</span>
                            </div>
                        </div>
                    </div>
 
                     <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                         ${qualifiedBids.length === 0 ? `
                             <div style="text-align: center; padding: 24px; color: var(--danger); font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                 <i data-lucide="info" style="width: 18px; height: 18px;"></i> Không có nhà thầu nào đạt yêu cầu kỹ thuật. Vui lòng nhập số quyết định phê duyệt và ngày quyết định phía trên để lưu danh sách đạt kỹ thuật trống và chuyển sang bước Hủy thầu.
                             </div>
                         ` : `
                         <table class="data-table" style="min-width: 100%;">
                              <thead>
                                  <tr>
                                      ${gt.phanLo === 'Có' ? `
                                          <th style="width: 15%;">Mã phần lô</th>
                                          <th style="width: 20%;">Tên phần lô</th>
                                      ` : ''}
                                      <th style="width: 15%;">Mã nhà thầu</th>
                                      <th style="width: ${gt.phanLo === 'Có' ? '25%' : '40%'};">Tên nhà thầu</th>
                                      ${hasTechScore ? `<th style="width: 15%; text-align: center;">Điểm kỹ thuật</th>` : ''}
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
                                          <td>${b.tenNhaThau || '--'}</td>
                                          ${hasTechScore ? `<td style="text-align: center;">${b.danhGiaKyThuat || '--'}</td>` : ''}
                                          <td style="text-align: center;">
                                              <span class="badge badge-success" style="font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 4px;">Đạt kỹ thuật</span>
                                          </td>
                                      </tr>
                                  `).join('')}
                              </tbody>
                          </table>
                          `}
                     </div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                         ${!isReadOnly ? `
                             <button class="btn btn-primary" id="btn-save-qualified-decision" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;"><i data-lucide="save"></i> Lưu QĐ phê duyệt</button>
                         ` : canEdit ? `
                             <button class="btn btn-primary" id="btn-edit-qualified-decision" style="padding: 10px 24px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px;"><i data-lucide="edit-3"></i> Chỉnh sửa</button>
                         ` : ''}
                     </div>
                 `;

                if (typeof this.initFlatpickr === 'function') {
                    this.initFlatpickr(contentWrapper);
                }

                // Nút Chỉnh sửa (khi đã lưu nhưng biên bản mở TC chưa có)
                const btnEdit = contentWrapper.querySelector('#btn-edit-qualified-decision');
                if (btnEdit) {
                    btnEdit.onclick = () => {
                        this._editingState = this._editingState || {};
                        this._editingState[this._currentWorkflowTab] = true;
                        this.showPackageDetails(gt.id);
                    };
                }

                if (!isReadOnly) {
                    const btnSave = contentWrapper.querySelector('#btn-save-qualified-decision');
                    if (btnSave) {
                        btnSave.onclick = async () => {
                            const inpSo = contentWrapper.querySelector('#qualified-so-qd');
                            const inpNgay = contentWrapper.querySelector('#qualified-ngay-qd');
                            const inpSoBctd = contentWrapper.querySelector('#qualified-so-bctd');
                            const inpNgayBctd = contentWrapper.querySelector('#qualified-ngay-bctd');
                            const valSo = inpSo.value.trim();
                            const valNgayRaw = inpNgay.value.trim();
                            const valSoBctd = inpSoBctd ? inpSoBctd.value.trim() : '';
                            const valNgayBctdRaw = inpNgayBctd ? inpNgayBctd.value.trim() : '';

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

                            if (inpSoBctd) {
                                if (!valSoBctd) {
                                    hasErr = true;
                                    inpSoBctd.closest('.form-group').querySelector('.error-text').style.display = 'block';
                                    inpSoBctd.closest('.form-group').classList.add('invalid');
                                } else {
                                    inpSoBctd.closest('.form-group').querySelector('.error-text').style.display = 'none';
                                    inpSoBctd.closest('.form-group').classList.remove('invalid');
                                }
                            }

                            if (inpNgayBctd) {
                                if (!valNgayBctdRaw) {
                                    hasErr = true;
                                    inpNgayBctd.closest('.form-group').querySelector('.error-text').style.display = 'block';
                                    inpNgayBctd.closest('.form-group').classList.add('invalid');
                                } else {
                                    inpNgayBctd.closest('.form-group').querySelector('.error-text').style.display = 'none';
                                    inpNgayBctd.closest('.form-group').classList.remove('invalid');
                                }
                            }

                            if (hasErr) return;

                            metadata.technical.soQdPheDuyetKt = valSo;
                            metadata.technical.ngayQdPheDuyetKt = this.model.convertDMYToYMD(valNgayRaw);
                            if (inpSoBctd) metadata.technical.soBctdKt = valSoBctd;
                            if (inpNgayBctd) metadata.technical.ngayBctdKt = this.model.convertDMYToYMD(valNgayBctdRaw);
                            metadata.technical.qualifiedSaved = true;

                            gt.danhGiaHsdtMetadata = JSON.stringify(metadata);
                            this.model.persistData('goithau');
                            window.appController.autoSync();

                            if (this._editingState) {
                                this._editingState[this._currentWorkflowTab] = false;
                            }

                            await this.customAlert('Thành công', 'Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!', 'check-circle');
                            const allBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
                            const qualifiedBids = allBids.filter(checkBidQualified);
                            this._currentWorkflowTab = qualifiedBids.length > 0 ? 'opening_fin' : 'result';
                            this.showPackageDetails(gt.id);
                        };
                    }
                }
            }
            break;
        }
        case 'opening_fin': {
            const allBidsForOpening = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
            const qualifiedBidsForOpening = allBidsForOpening.filter(checkBidQualified);
            qualifiedBidsForOpening.sort((a, b) => {
                const lotA = String(a.maPhanLo || '').toLowerCase();
                const lotB = String(b.maPhanLo || '').toLowerCase();
                const lotCompare = lotA.localeCompare(lotB, 'vi', { numeric: true });
                if (lotCompare !== 0) return lotCompare;

                const ntA = String(a.maNhaThau || a.maDinhDanh || '').toLowerCase();
                const ntB = String(b.maNhaThau || b.maDinhDanh || '').toLowerCase();
                return ntA.localeCompare(ntB, 'vi', { numeric: true });
            });
            const hasTechScore = qualifiedBidsForOpening.some(b => {
                if (!b.danhGiaKyThuat) return false;
                const clean = String(b.danhGiaKyThuat).trim().replace(/,/g, '.');
                return !isNaN(parseFloat(clean)) && isFinite(clean);
            }) || ['Kết hợp giữa kỹ thuật và giá', 'Giá cố định', 'Dựa trên kỹ thuật'].includes(gt.phuongPhapDanhGia);
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
                let isFinEvalSaved = false;
                if (gt.danhGiaHsdtMetadata) {
                    try {
                        const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
                        if (parsed.financial && parsed.financial.saved) {
                            isFinEvalSaved = true;
                        }
                    } catch (e) { }
                }
                const isReadOnly = (isCompleted && !isEditingThisStep) || gt.trangThai === 'Đã có kết quả' || gt.trangThai === 'Hủy thầu' || isFinEvalSaved;
                const canEdit = !isFinEvalSaved && gt.trangThai !== 'Đã có kết quả' && gt.trangThai !== 'Hủy thầu';
                const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');

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
                    <div style="padding: 12px 16px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: var(--radius-md); font-size: 0.85rem; color: var(--text-main); line-height: 1.6; margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong style="color: var(--primary);">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${(() => { const khO = this.model.getLatestPlan(gt.keHoachId); const cdO = khO ? this.model.state.chudautu.find(c => c.id === khO.chuDauTuId) : null; return cdO ? cdO.tenChuDauTu : 'Không rõ'; })()}</span></div>
                            <div>• <strong style="color: var(--primary);">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${(() => { const khO = this.model.getLatestPlan(gt.keHoachId); return khO ? khO.tenKeHoach : 'Không rõ'; })()}</span></div>
                            <div>• <strong style="color: var(--primary);">Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}</div>
                            <div>• <strong style="color: var(--primary);">Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong style="color: var(--primary);">Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong style="color: var(--primary);">Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong style="color: var(--primary);">Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong style="color: var(--primary);">Phương pháp đánh giá:</strong> ${gt.phuongPhapDanhGia}${gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá' && gt.trongSoKyThuat ? ` (${gt.trongSoKyThuat}%)` : ''}</div>` : ''}
                            <div>• <strong style="color: var(--primary);">Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong style="color: var(--primary);">Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong style="color: var(--primary);">Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong style="color: var(--primary);">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                            <div>• <strong style="color: var(--primary);">Thời gian mở E-HSĐXKT:</strong> <span class="text-dark fw-bold">${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</span></div>
                            <div style="display: flex; align-items: center; gap: 8px; grid-column: span 2; white-space: nowrap;">
                                <span>• <strong style="color: var(--primary);">Thời gian mở E-HSĐXTC:</strong></span>
                                ${isReadOnly
                            ? `<span class="text-dark fw-bold">${gt.thoiGianMoEhsdxtc ? this.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : 'Chưa mở'}</span>`
                            : `<input type="text" id="op-fin-thoigianmothau" class="form-control flatpickr-datetime" style="font-size: 0.82rem; padding: 4px 10px; width: 200px; display: inline-block;" value="${gt.thoiGianMoEhsdxtc ? this.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : ''}" placeholder="dd/MM/yyyy HH:mm">`
                        }
                            </div>
                            ` : ''}
                        </div>
                        ${isReadOnly ? `
                        <div style="margin-top: 12px; padding: 8px 12px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; color: #dc2626; font-weight: 600; font-size: 0.82rem; display: flex; align-items: center; gap: 6px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                            Biên bản mở E-HSĐXTC đã được khóa
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
                                    ${gt.phanLo === 'Có' ? `
                                        <th style="width:120px;">Mã phần lô</th>
                                        <th style="width:180px;">Tên phần lô</th>
                                    ` : ''}
                                    <th>Mã nhà thầu</th>
                                    <th>Tên nhà thầu</th>
                                    ${hasTechScore ? `<th style="width:100px; text-align: center;">Điểm kỹ thuật</th>` : ''}
                                    <th style="width:160px;">Giá dự thầu (VNĐ)</th>
                                    <th style="width:80px;">Tỷ lệ %</th>
                                    <th style="width:160px;">Giá sau giảm</th>
                                    ${gt.linhVuc === 'Tư vấn' ? `<th style="width:150px;">Hiệu lực E-HSĐXTC</th>` : ''}
                                </tr>
                            </thead>
                            <tbody>

                                ${qualifiedBidsForOpening.map(b => {

                            const valGiaDuThau = this.model.formatVND(b.giaDuThau) || '';
                            const valTyLeGiam = (b.tyLeGiamGia || 0).toString().replace('.', ',');
                            const valGiaSauGiam = this.model.formatVND(b.giaSauGiamGia) || '';
                            const valHieuLucHsdt = b.hieuLucHsdt || b.hieuLucHsdxt || '';

                            if (isReadOnly) {
                                return `
                                            <tr>
                                                ${gt.phanLo === 'Có' ? `
                                                    <td>${b.maPhanLo || '--'}</td>
                                                    <td>${b.tenPhanLo || '--'}</td>
                                                ` : ''}
                                                <td>${b.maNhaThau || b.maDinhDanh || '--'}</td>
                                                <td>${b.tenNhaThau}</td>
                                                ${hasTechScore ? `<td style="text-align:center;">${b.danhGiaKyThuat || '--'}</td>` : ''}
                                                <td>${valGiaDuThau || '--'}</td>
                                                <td style="text-align:right;">${valTyLeGiam}</td>
                                                <td>${valGiaSauGiam || '--'}</td>
                                                ${gt.linhVuc === 'Tư vấn' ? `<td>${valHieuLucHsdt ? valHieuLucHsdt + (String(valHieuLucHsdt).includes('ngày') ? '' : ' ngày') : '--'}</td>` : ''}
                                            </tr>
                                        `;
                            } else {
                                return `
                                            <tr data-opening-bid-id="${b.id}">
                                                ${gt.phanLo === 'Có' ? `
                                                    <td>${b.maPhanLo || '--'}</td>
                                                    <td>${b.tenPhanLo || '--'}</td>
                                                ` : ''}
                                                <td>${b.maNhaThau || b.maDinhDanh || '--'}</td>
                                                <td>${b.tenNhaThau}</td>
                                                ${hasTechScore ? `<td style="text-align:center;">${b.danhGiaKyThuat || '--'}</td>` : ''}
                                                <td><input type="text" class="form-control op-gia-du-thau" value="${valGiaDuThau}" placeholder="Nhập giá..." style="padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-ty-le-giam" value="${valTyLeGiam}" placeholder="0" style="text-align:right; padding:4px 8px; font-size:0.8rem;"></td>
                                                <td><input type="text" class="form-control op-gia-sau-giam" value="${valGiaSauGiam}" readonly style="background:#f1f5f9; padding:4px 8px; font-size:0.8rem;"></td>
                                                ${gt.linhVuc === 'Tư vấn' ? `<td><input type="text" class="form-control op-hieu-luc-hsdt" value="${valHieuLucHsdt ? valHieuLucHsdt + (String(valHieuLucHsdt).includes('ngày') ? '' : ' ngày') : ''}" placeholder="Ví dụ: 90 ngày" style="padding:4px 8px; font-size:0.8rem;"></td>` : ''}
                                            </tr>
                                        `;
                            }
                        }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:flex-end;">
                        ${isReadOnly ? (canEdit ? `
                            <button class="btn btn-primary" id="btn-edit-opening-fin" style="padding:10px 24px; font-weight:700; display: inline-flex; align-items: center; gap: 8px;"><i data-lucide="edit"></i> Chỉnh sửa</button>
                        ` : '') : `
                            <button class="btn btn-primary" id="btn-save-opening-fin" style="padding:10px 24px; font-weight:700;"><i data-lucide="save"></i> Lưu Biên bản mở E-HSĐXTC</button>
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

                    const importBtn = document.getElementById('btn-opening-fin-import-excel');
                    if (importBtn) {
                        importBtn.onclick = () => {
                            window.appController.triggerExcelImport('opening_fin');
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
                                    const hieuLucEl = tr.querySelector('.op-hieu-luc-hsdt');
                                    if (hieuLucEl) {
                                        bid.hieuLucHsdt = parseInt(hieuLucEl.value, 10) || 0;
                                    } else if (gt.linhVuc === 'Tư vấn') {
                                        bid.hieuLucHsdt = parseInt(bid.hieuLucHsdxt, 10) || 0;
                                    }
                                }
                            });
                            this.model.persistData('thongtinmothau');
                            const inputOpFinTime = document.getElementById('op-fin-thoigianmothau');
                            if (inputOpFinTime && inputOpFinTime.value) {
                                gt.thoiGianMoEhsdxtc = this.model.convertDMYHMSToYMDHMS(inputOpFinTime.value);
                            } else if (!gt.thoiGianMoEhsdxtc) {
                                gt.thoiGianMoEhsdxtc = this.model.getCurrentDateTimeString();
                            }
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

                // Register handlers outside if (!isReadOnly) so they work in read-only view mode
                const exportBtn = document.getElementById('btn-opening-fin-export-excel');
                if (exportBtn) {
                    exportBtn.onclick = () => {
                        const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                        authFetchDownload(`/api/export-opening-fin-template?package_id=${gt.id}&package_name=${encodeURIComponent(safeCode)}`, `Mau_Mo_Tai_Chinh_${safeCode}.xlsx`);
                    };
                }

                const editBtn = document.getElementById('btn-edit-opening-fin');
                if (editBtn) {
                    editBtn.onclick = () => {
                        this._editingState = this._editingState || {};
                        this._editingState[this._currentWorkflowTab] = true;
                        this.showPackageDetails(gt.id);
                    };
                }
            }
            break;
        }

        case 'result':
            const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
            let metadata = { technical: {}, result: {} };
            if (gt.danhGiaHsdtMetadata) {
                try {
                    metadata = JSON.parse(gt.danhGiaHsdtMetadata);
                    if (!metadata.technical) metadata.technical = {};
                    if (!metadata.result) metadata.result = {};
                } catch (e) {
                    console.error(e);
                }
            }
            const soBctdResult = metadata.result.soBctdKetQua || '';
            const ngayBctdResult = metadata.result.ngayBctdKetQua || '';

            const allBidsForResult = this.model.state.thongtinmothau.filter(b =>
                String(b.goiThauId) === String(gt.id) && checkBidQualified(b)
            );
            const isAwarded = gt.trangThai === 'Đã có kết quả';

            if (isAwarded) {
                if (!gt.nhaThauTrungThauId && allBidsForResult.length === 1) {
                    gt.nhaThauTrungThauId = allBidsForResult[0].nhaThauId || allBidsForResult[0].id;
                }
                const winnerBid = allBidsForResult.find(b => String(b.nhaThauId) === String(gt.nhaThauTrungThauId)) || allBidsForResult[0];

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
                                    <a href="#" onclick="event.preventDefault(); window.showNhaThauDetails('${currentWinnerBid.nhaThauId}')" class="link-hover" style="color:var(--primary);">${currentWinnerBid.tenNhaThau}</a>
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
                                <td class="text-muted">${lyDo}</td>
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
                                <td class="text-muted">${lyDo}</td>
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
                            ${soBctdResult ? `
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Số BCTĐ kết quả</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${soBctdResult}</h5>
                            </div>
                            ` : ''}
                            ${ngayBctdResult ? `
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Ngày BCTĐ kết quả</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${this.model.formatDate(ngayBctdResult)}</h5>
                            </div>
                            ` : ''}
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Số QĐ phê duyệt Kết quả</span>
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--text-main);">${gt.soQuyetDinhKetQua || '--'}</h5>
                            </div>
                            <div>
                                <span class="text-muted" style="font-size:0.75rem; font-weight:700; text-transform:uppercase;">Ngày ký QĐ phê duyệt Kết quả</span>
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
                    
                    ${isEditable ? `
                        <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                            <button class="btn btn-primary" id="btn-edit-result-bottom" style="font-weight:700;">
                                <i data-lucide="edit"></i> Sửa kết quả
                            </button>
                        </div>
                    ` : ''}
                `;

                const editResultBottomBtn = document.getElementById('btn-edit-result-bottom');
                if (editResultBottomBtn) {
                    editResultBottomBtn.onclick = async () => {
                        gt.trangThai = 'Đang chấm thầu';

                        // Clear any stored standard reasons in database to let them recalculate fresh
                        const standardReasons = [
                            "Không đạt yêu cầu về tính hợp lệ",
                            "Không đạt yêu cầu về năng lực, kinh nghiệm",
                            "Không đạt yêu cầu kỹ thuật",
                            "Nhà thầu xếp hạng 1 trúng thầu",
                            "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",
                            ""
                        ];
                        const pkgBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(id));
                        pkgBids.forEach(b => {
                            if (b.lyDoTruot && standardReasons.includes(b.lyDoTruot.trim())) {
                                b.lyDoTruot = '';
                            }
                        });

                        this.model.persistData('thongtinmothau');
                        this.model.persistData('goithau');
                        window.appController.autoSync();
                        this.showPackageDetails(id);
                    };
                }

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
                const kh = this.model.getLatestPlan(gt.keHoachId);
                const cdt = kh ? this.model.state.chudautu.find(c => c.id === kh.chuDauTuId) : null;
                const tenCdt = cdt ? cdt.tenChuDauTu : 'Không rõ';
                const tenKhStr = kh ? kh.tenKeHoach : 'Không rõ';
                const allBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
                // Sort by maPhanLo A-Z
                allBids.sort((x, y) => {
                    const lotX = String(x.maPhanLo || '').trim();
                    const lotY = String(y.maPhanLo || '').trim();
                    return lotX.localeCompare(lotY, 'vi', { numeric: true });
                });

                const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
                const danhGiaNangLuc = metadata.result.danhGiaNangLuc || 'Không';
                // Helper tính ngày làm việc (trừ thứ 7, CN và các ngày nghỉ lễ từ holidays.json)
                const addWorkingDays = (startDateStr, days) => {
                    if (!startDateStr) return '';
                    let date = new Date(startDateStr);
                    if (isNaN(date.getTime())) return '';

                    const holidaysData = window._vietnameseHolidays || {};
                    let direction = days < 0 ? -1 : 1;
                    let remainingDays = Math.abs(days);
                    while (remainingDays > 0) {
                        date.setDate(date.getDate() + direction);
                        let dayOfWeek = date.getDay();
                        let dateStr = date.toISOString().split('T')[0];
                        let yearStr = String(date.getFullYear());

                        let isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

                        // Check working weekend swaps
                        const yearWorkingWeekends = holidaysData[yearStr]?.working_weekends || [];
                        if (isWeekend && yearWorkingWeekends.includes(dateStr)) {
                            isWeekend = false;
                        }

                        // Check holidays
                        const yearHolidays = holidaysData[yearStr]?.holidays || [];
                        const isHoliday = yearHolidays.includes(dateStr);

                        if (!isWeekend && !isHoliday) {
                            remainingDays--;
                        }
                    }
                    return date.toISOString().split('T')[0];
                };

                let defaultYcbgi = '';
                let defaultGbgi = '';
                let defaultBcdg = '';
                let defaultMtt = '';
                let defaultTt = '';
                let defaultTkq = '';
                let defaultPdkq = '';

                if (kh) {
                    const isPheDuyetKeHoach = kh.pheDuyet === 'Kế hoạch';
                    const anchorDate = isPheDuyetKeHoach ? kh.ngayTrinhDuToan : kh.ngayTrinhKeHoach;
                    const approvalDate = kh.ngayPheDuyet || '';

                    defaultYcbgi = addWorkingDays(anchorDate, -5);
                    defaultGbgi = addWorkingDays(anchorDate, -1);
                    defaultBcdg = approvalDate;
                    defaultMtt = approvalDate;
                    defaultTt = addWorkingDays(approvalDate, 1);
                    defaultTkq = defaultTt;
                    defaultPdkq = defaultTkq;
                }

                const ngayYeuCauBaoGia = metadata.result.ngayYeuCauBaoGia ? this.model.formatForDateInput(metadata.result.ngayYeuCauBaoGia) : (defaultYcbgi ? this.model.formatForDateInput(defaultYcbgi) : '');
                const ngayGuiBaoGia = metadata.result.ngayGuiBaoGia ? this.model.formatForDateInput(metadata.result.ngayGuiBaoGia) : (defaultGbgi ? this.model.formatForDateInput(defaultGbgi) : '');
                const ngayBaoCaoDanhGiaNhaThau = metadata.result.ngayBaoCaoDanhGiaNhaThau ? this.model.formatForDateInput(metadata.result.ngayBaoCaoDanhGiaNhaThau) : (defaultBcdg ? this.model.formatForDateInput(defaultBcdg) : '');
                const ngayMoiThuongThao = metadata.result.ngayMoiThuongThao ? this.model.formatForDateInput(metadata.result.ngayMoiThuongThao) : (defaultMtt ? this.model.formatForDateInput(defaultMtt) : '');
                const ngayThuongThao = metadata.result.ngayThuongThao ? this.model.formatForDateInput(metadata.result.ngayThuongThao) : (defaultTt ? this.model.formatForDateInput(defaultTt) : '');
                const ngayTrinhKetQua = metadata.result.ngayTrinhKetQua ? this.model.formatForDateInput(metadata.result.ngayTrinhKetQua) : (defaultTkq ? this.model.formatForDateInput(defaultTkq) : '');
                const defaultDecDate = gt.ngayQuyetDinhKetQua ? this.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : (defaultPdkq ? this.model.formatForDateInput(defaultPdkq) : '');
                const { rankings, scores } = window.appController.calculateRankings(gt, allBids);
                const isCombinedMethod = gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá';
                const getIsQualified = (bidItem) => {
                    return checkBidQualified(bidItem);
                };
                const lots = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);

                let allBiddersHtml = '';
                if (isDirectOrSpecial && allBids.length === 0) {
                    allBiddersHtml = `
                        <tr>
                            <td colspan="100%" style="text-align: center; padding: 24px; color: var(--danger); font-weight: 600;">
                                <i data-lucide="info" style="width: 18px; height: 18px; display: inline-block; vertical-align: middle; margin-right: 6px;"></i>
                                Vui lòng nhập và lưu danh sách nhà thầu tại tab "Biên bản mở thầu" trước.
                            </td>
                        </tr>
                    `;
                } else {
                    allBiddersHtml = allBids.map((b, idx) => {
                        const isQualified = getIsQualified(b);

                        let defaultReason = '';
                        if (gt.quyTrinhDanhGia === 'quytrinh2' && b.danhGiaKetLuan === 'Không đánh giá') {
                            defaultReason = "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";
                        } else if (!isQualified) {
                            const hl = String(b.danhGiaHopLe || '').trim().toLowerCase();
                            const nl = String(b.danhGiaNangLuc || '').trim().toLowerCase();
                            if (hl !== 'đạt') {
                                defaultReason = "Không đạt yêu cầu về tính hợp lệ";
                            } else if (nl !== 'đạt') {
                                defaultReason = "Không đạt yêu cầu về năng lực, kinh nghiệm";
                            } else {
                                defaultReason = "Không đạt yêu cầu kỹ thuật";
                            }
                        } else {
                            defaultReason = "Nhà thầu xếp hạng 1 trúng thầu";
                        }

                        const standardReasons = [
                            "Không đạt yêu cầu về tính hợp lệ",
                            "Không đạt yêu cầu về năng lực, kinh nghiệm",
                            "Không đạt yêu cầu kỹ thuật",
                            "Nhà thầu xếp hạng 1 trúng thầu",
                            "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",
                            ""
                        ];
                        const isStaleOrEmpty = !b.lyDoTruot || standardReasons.includes(b.lyDoTruot.trim());
                        const displayReason = isStaleOrEmpty ? defaultReason : b.lyDoTruot;

                        const defaultPrice = this.model.formatVND(b.giaSauGiamGia || b.giaDuThau || '') || '';
                        const defaultDurationPkg = b.thoiGianThucHien || gt.thoiGianThucHien || '';
                        const defaultDurationCtr = b.thoiGianThucHienHopDong || (defaultDurationPkg ? (defaultDurationPkg + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '');
                        const rank = rankings[b.id];
                        const score = scores[b.id];
                        const rankDisplay = rank ? `Xếp hạng ${rank}` : (isQualified ? '--' : 'Không xếp hạng');

                        let isRowWinner = false;
                        if (isDirectOrSpecial) {
                            isRowWinner = true;
                        } else if (isQualified) {
                            if (gt.phanLo === 'Có') {
                                const plList = lots;
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
                                    <td>
                                        ${b.maPhanLo || '--'}
                                    </td>
                                    <td>
                                        ${b.tenPhanLo || '--'}
                                    </td>
                                ` : ''}
                                ${isDirectOrSpecial ? `
                                     <td>
                                         ${b.loaiNhaThau || 'Độc lập'}
                                     </td>
                                 ` : ''}
                                <td>
                                ${b.maNhaThau || b.maDinhDanh || '--'}
                                </td>
                                <td>
                                    ${b.tenNhaThau || '--'}
                                    ${b.loaiNhaThau === 'Liên danh' ? `
                                         <div class="row-jv-members-container" style="margin-top: 4px;">
                                              <button type="button" class="btn btn-outline btn-xs row-btn-manage-members" style="padding: 2px 6px; font-size: 0.72rem; font-weight: 700; border-style: dashed; display: inline-flex; align-items: center; gap: 4px; color: var(--primary); border-color: var(--primary-soft);">
                                                  <i data-lucide="users" style="width: 12px; height: 12px;"></i>
                                                  <span class="row-jv-btn-text">Thành viên liên danh (${(b.thanhVienLienDanh || []).filter(m => m.vaiTro !== "Đứng đầu liên danh" && m.maSoThue !== b.maNhaThau).length})</span>
                                              </button>
                                         </div>
                                    ` : ''}
                                </td>
                                ${isCombinedMethod ? `
                                    <td style="text-align: center; color: var(--primary);">${score !== undefined && score !== null && !isNaN(score) && score > 0 ? score.toFixed(2) : '--'}</td>
                                ` : ''}
                                ${!isDirectOrSpecial ? `
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
                                ` : ''}
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
                }

                contentWrapper.innerHTML = `
                    <div style="padding: 12px 16px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: var(--radius-md); font-size: 0.85rem; color: var(--text-main); line-height: 1.6; margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong style="color: var(--primary);">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdt}</span></div>
                            <div>• <strong style="color: var(--primary);">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${tenKhStr}</span></div>
                            <div>• <strong style="color: var(--primary);">Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}</div>
                            <div>• <strong style="color: var(--primary);">Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                            <div>• <strong style="color: var(--primary);">Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                            <div>• <strong style="color: var(--primary);">Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong style="color: var(--primary);">Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong style="color: var(--primary);">Phương pháp đánh giá:</strong> ${gt.phuongPhapDanhGia}${gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá' && gt.trongSoKyThuat ? ` (${gt.trongSoKyThuat}%)` : ''}</div>` : ''}
                            <div>• <strong style="color: var(--primary);">Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                            <div>• <strong style="color: var(--primary);">Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                            <div>• <strong style="color: var(--primary);">Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong style="color: var(--primary);">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                            <div>• <strong style="color: var(--primary);">${is1G2T ? 'Thời gian mở E-HSĐXKT' : 'Thời gian mở thầu'}:</strong> ${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</div>
                            ${is1G2T ? `<div>• <strong style="color: var(--primary);">Thời gian mở E-HSĐXTC:</strong> ${gt.thoiGianMoEhsdxtc ? this.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : 'Chưa mở'}</div>` : ''}
                            ` : ''}
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin: 0;">
                                Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)
                            </h4>
                            <p class="text-muted" style="font-size:0.82rem; margin: 4px 0 0 0;">
                                ${(gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt')
                        ? 'Kiểm tra danh sách nhà thầu trúng thầu, điền QĐ phê duyệt và nhấn Phê duyệt &amp; Hoàn thành LCNT.'
                        : 'Vui lòng nhập QĐ phê duyệt và chọn kết quả trúng thầu/trượt thầu cho từng nhà thầu bên dưới.'}
                            </p>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            ${!isDirectOrSpecial ? `
                                <button class="btn-excel-action btn-sm" id="btn-result-export-excel-template" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; height: 32px;">
                                    <i data-lucide="download"></i> Tải Excel Mẫu
                                </button>
                                <button class="btn-excel-action btn-sm" id="btn-result-import-excel" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; height: 32px;">
                                    <i data-lucide="upload"></i> Nhập từ Excel
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    ${isDirectOrSpecial ? `
                    <div style="background: var(--neutral-soft); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
                        <div style="font-weight: 700; color: var(--primary); font-size: 0.85rem; min-width: 140px; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="check-circle" style="width: 16px; height: 16px;"></i> Quyết định phê duyệt:
                        </div>
                        <div style="display: flex; gap: 16px; flex-grow: 1; flex-wrap: wrap;">
                            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
                                <input type="text" id="award-decision-no" class="form-control" value="${gt.soQuyetDinhKetQua || ''}" placeholder="Số QĐ phê duyệt *" style="width: 100%; height: 36px; font-size: 0.85rem;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date" value="${gt.ngayQuyetDinhKetQua ? this.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : (defaultDecDate ? defaultDecDate : '')}" style="width: 100%; height: 36px; font-size: 0.85rem;" placeholder="Ngày ký QĐ * (dd/MM/yyyy)">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>

                    <div style="background: var(--neutral-soft); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 16px;">
                        <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;">
                            <span style="font-weight: 700; color: var(--primary); font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                                <i data-lucide="shield-check" style="width: 16px; height: 16px;"></i> Đánh giá năng lực nhà thầu:
                            </span>
                            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.85rem; cursor: pointer; margin-bottom: 0;">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Có" ${danhGiaNangLuc === 'Có' ? 'checked' : ''}> Có
                            </label>
                            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.85rem; cursor: pointer; margin-bottom: 0;">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Không" ${danhGiaNangLuc === 'Không' ? 'checked' : ''}> Không
                            </label>
                        </div>
                        
                        <div id="result-dates-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.78rem; margin-bottom: 4px; display: block;">Ngày yêu cầu báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-yeu-cau-bao-gia" class="form-control flatpickr-date" value="${ngayYeuCauBaoGia}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.72rem; display: none; margin-top: 4px;">Vui lòng nhập Ngày yêu cầu báo giá!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.78rem; margin-bottom: 4px; display: block;">Ngày gửi báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-gui-bao-gia" class="form-control flatpickr-date" value="${ngayGuiBaoGia}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.72rem; display: none; margin-top: 4px;">Vui lòng nhập Ngày gửi báo giá!</span>
                            </div>
                            <div class="form-group" id="container-date-bao-cao-danh-gia" style="margin-bottom: 0; display: ${danhGiaNangLuc === 'Có' ? 'block' : 'none'};">
                                <label style="font-weight: 600; font-size: 0.78rem; margin-bottom: 4px; display: block;">Ngày báo cáo đánh giá nhà thầu <span class="text-danger">*</span></label>
                                <input type="text" id="date-bao-cao-danh-gia" class="form-control flatpickr-date" value="${ngayBaoCaoDanhGiaNhaThau}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.72rem; display: none; margin-top: 4px;">Vui lòng nhập Ngày báo cáo đánh giá nhà thầu!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.78rem; margin-bottom: 4px; display: block;">Ngày mời thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-moi-thuong-thao" class="form-control flatpickr-date" value="${ngayMoiThuongThao}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.72rem; display: none; margin-top: 4px;">Vui lòng nhập Ngày mời thương thảo!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.78rem; margin-bottom: 4px; display: block;">Ngày thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-thuong-thao" class="form-control flatpickr-date" value="${ngayThuongThao}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.72rem; display: none; margin-top: 4px;">Vui lòng nhập Ngày thương thảo!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.78rem; margin-bottom: 4px; display: block;">Ngày trình kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="date-trinh-ket-qua" class="form-control flatpickr-date" value="${ngayTrinhKetQua}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.72rem; display: none; margin-top: 4px;">Vui lòng nhập Ngày trình kết quả!</span>
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Quyết định phê duyệt Kết quả LCNT</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
                            ${(gt.hinhThucLuaChon !== 'Chào hàng cạnh tranh') ? `
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Số BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-so-bctd" class="form-control" value="${soBctdResult}" placeholder="Nhập số báo cáo thẩm định..." style="width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số BCTĐ kết quả!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Ngày BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-ngay-bctd" class="form-control flatpickr-date" value="${ngayBctdResult ? this.model.formatForDateInput(ngayBctdResult) : ''}" style="width: 100%;" placeholder="dd/MM/yyyy">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng chọn Ngày BCTĐ kết quả!</span>
                            </div>
                            ` : ''}
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Số QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control" value="${gt.soQuyetDinhKetQua || ''}" placeholder="Số QĐ Kết quả..." style="width: 100%;">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0;">
                                <label style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; display: block;">Ngày ký QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date" value="${gt.ngayQuyetDinhKetQua ? this.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : ''}" style="width: 100%;" placeholder="dd/MM/yyyy">
                                <span class="error-text" style="color: var(--danger); font-size: 0.75rem; display: none; margin-top: 4px;">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>
                    `}

                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; margin-bottom: 12px;">
                        <h5 style="font-weight:700; font-size:0.9rem; color:var(--text-main); display:flex; align-items:center; gap:6px; margin: 0;">
                            <i data-lucide="list"></i> ${isDirectOrSpecial ? 'Danh sách nhà thầu trúng thầu' : 'Danh sách nhà thầu tham dự &amp; Kết quả LCNT'}
                        </h5>
                    </div>

                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                        <table class="data-table" style="min-width: 100%;">
                            <thead>
                                <tr>
                                    ${gt.phanLo === 'Có' ? `
                                        <th style="width: 10%;">Mã phần lô</th>
                                        <th style="width: 10%;">Tên phần lô</th>
                                    ` : ''}
                                    ${isDirectOrSpecial ? `<th style="width: 12%;">Loại nhà thầu</th>` : ''}
                                    <th style="width: 12%;">Mã nhà thầu</th>
                                    <th style="width: 20%;">Tên nhà thầu</th>
                                    ${isCombinedMethod ? `
                                        <th style="width: 10%; text-align: center;">Điểm tổng hợp</th>
                                    ` : ''}
                                    ${!isDirectOrSpecial ? `
                                        <th style="width: 10%; text-align: center;">Xếp hạng nhà thầu</th>
                                        <th style="width: 10%;">Trúng thầu/trượt thầu</th>
                                        <th style="width: 14%;">Lý do trượt</th>
                                    ` : ''}
                                    <th style="width: 12%;">Giá trúng thầu</th>
                                    <th style="width: 14%;">Thời gian thực hiện gói thầu</th>
                                    <th style="width: 18%;">Thời gian thực hiện hợp đồng</th>
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

                // Toggle evaluation report date container based on capability assessment selection
                const rads = contentWrapper.querySelectorAll('input[name="result-danh-gia-nang-luc"]');
                const dgContainer = contentWrapper.querySelector('#container-date-bao-cao-danh-gia');
                rads.forEach(rad => {
                    rad.addEventListener('change', () => {
                        if (dgContainer) {
                            dgContainer.style.display = rad.value === 'Có' ? 'block' : 'none';
                        }
                    });
                });

                // Auto-sync cascaded dates
                const inpThuongThao = contentWrapper.querySelector('#date-thuong-thao');
                const inpTrinhkq = contentWrapper.querySelector('#date-trinh-ket-qua');
                const inpDecDate = contentWrapper.querySelector('#award-decision-date');

                if (inpThuongThao && inpTrinhkq) {
                    inpThuongThao.addEventListener('change', () => {
                        inpTrinhkq.value = inpThuongThao.value;
                        if (inpTrinhkq._flatpickr) inpTrinhkq._flatpickr.setDate(inpThuongThao.value);
                        if (inpDecDate) {
                            inpDecDate.value = inpThuongThao.value;
                            if (inpDecDate._flatpickr) inpDecDate._flatpickr.setDate(inpThuongThao.value);
                        }
                    });
                }
                if (inpTrinhkq && inpDecDate) {
                    inpTrinhkq.addEventListener('change', () => {
                        inpDecDate.value = inpTrinhkq.value;
                        if (inpDecDate._flatpickr) inpDecDate._flatpickr.setDate(inpTrinhkq.value);
                    });
                }

                const tbodyApprove = document.getElementById('approve-bidders-tbody');
                if (tbodyApprove) {
                    // Populate initial Joint Venture members data on tr elements
                    allBids.forEach(b => {
                        const tr = tbodyApprove.querySelector(`tr[data-approve-bid-id="${b.id}"]`);
                        if (tr) {
                            tr._thanhVienLienDanh = (b.thanhVienLienDanh || []).filter(m => m.vaiTro !== "Đứng đầu liên danh" && m.maSoThue !== b.maNhaThau);
                            tr._leadMemberName = b.tenNhaThau || '';
                        }
                    });

                    // Format VND currency input
                    const initRowListeners = (tr) => {
                        tr.querySelectorAll('.row-gia-trung').forEach(inp => {
                            inp.addEventListener('input', (e) => {
                                const formatted = this.model.formatVND(e.target.value);
                                e.target.value = formatted;
                            });
                        });

                        tr.querySelectorAll('.row-tg-goithau').forEach(inp => {
                            inp.addEventListener('input', (e) => {
                                const inpDurationCtr = tr.querySelector('.row-tg-hopdong');
                                if (inpDurationCtr) {
                                    const val = e.target.value.trim();
                                    inpDurationCtr.value = val ? (val + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '';
                                }
                            });
                        });

                        // Toggle Joint Venture elements based on type dropdown selection
                        const selectLoai = tr.querySelector('.row-loai-nha-thau');
                        const jvContainer = tr.querySelector('.row-jv-members-container');
                        if (selectLoai && jvContainer) {
                            selectLoai.addEventListener('change', () => {
                                jvContainer.style.display = selectLoai.value === 'Liên danh' ? 'block' : 'none';
                            });
                        }

                        // Bind manage JV members button
                        const btnManage = tr.querySelector('.row-btn-manage-members');
                        if (btnManage) {
                            btnManage.addEventListener('click', (e) => {
                                e.preventDefault();
                                window.openMoThauJVManager(tr);
                            });
                        }

                        // Auto fill contractor name if code matches one in the database
                        const inputMa = tr.querySelector('.row-ma-nha-thau');
                        const inputTen = tr.querySelector('.row-ten-nha-thau');
                        if (inputMa && inputTen) {
                            const handleCodeChange = () => {
                                const code = inputMa.value.trim();
                                if (!code) return;
                                const latestList = this.model.getLatestNhaThau();
                                const matched = latestList.find(n => n.maNhaThau && n.maNhaThau.trim().toLowerCase() === code.toLowerCase());
                                if (matched) {
                                    inputTen.value = matched.tenNhaThau || '';
                                }
                            };
                            inputMa.addEventListener('input', handleCodeChange);
                            inputMa.addEventListener('change', handleCodeChange);
                        }
                    };

                    tbodyApprove.querySelectorAll('tr').forEach(initRowListeners);

                    if (isDirectOrSpecial) {
                        // Event delegation for removal
                        tbodyApprove.addEventListener('click', async (e) => {
                            const btnRemove = e.target.closest('.row-remove-bidder');
                            if (btnRemove) {
                                const tr = btnRemove.closest('tr');
                                if (tr) {
                                    const confirmed = await this.customConfirm('Xác nhận xóa', 'Bạn có chắc chắn muốn xóa dòng nhà thầu này?', 'trash-2');
                                    if (confirmed) {
                                        tr.remove();
                                    }
                                }
                            }
                        });

                        // Event delegation for lot select change
                        tbodyApprove.addEventListener('change', (e) => {
                            if (e.target.classList.contains('row-ma-phan-lo')) {
                                const selectEl = e.target;
                                const tr = selectEl.closest('tr');
                                const tenPhanLoInput = tr.querySelector('.row-ten-phan-lo');
                                if (tenPhanLoInput) {
                                    const selectedOption = selectEl.options[selectEl.selectedIndex];
                                    const tenPhanLo = selectedOption ? selectedOption.getAttribute('data-name') : '';
                                    tenPhanLoInput.value = tenPhanLo || '';
                                }
                            }
                        });
                    } else {
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
                }

                // ── Event handlers cho bảng nhập nhà thầu (Chỉ định thầu rút gọn) ──────
                const isSpecialBiddingType = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
                const cdtrugTbody = document.getElementById('cdtrug-mothau-tbody');

                // Helper: thêm hàng mới vào bảng nhập nhà thầu
                const addCdtrugRow = (bidData = {}) => {
                    if (!cdtrugTbody) return;
                    const rowId = bidData.id || window.generateUUID();
                    const hasPhanLo = gt.phanLo === 'Có';
                    const lotList = gt.phanLoList || [];
                    const lotOptions = (Array.isArray(lotList) ? lotList : (typeof lotList === 'string' ? JSON.parse(lotList || '[]') : []))
                        .map(l => `<option value="${l.maPhanLo}" data-name="${l.tenPhanLo}" ${bidData.maPhanLo === l.maPhanLo ? 'selected' : ''}>${l.maPhanLo}</option>`).join('');

                    const ntCode = bidData.maNhaThau || bidData.maDinhDanh || '';
                    const ntName = bidData.tenNhaThau || '';
                    const ntType = bidData.loaiNhaThau || 'Độc lập';

                    const tr = document.createElement('tr');
                    tr.setAttribute('data-cdtrug-id', rowId);
                    tr.innerHTML = `
                        ${hasPhanLo ? `
                            <td><select class="form-control cdtrug-ma-phan-lo" style="padding:4px 6px;font-size:0.8rem;">
                                <option value="">-- Chọn --</option>${lotOptions}
                            </select></td>
                            <td><input type="text" class="form-control cdtrug-ten-phan-lo" value="${bidData.tenPhanLo || ''}" readonly placeholder="Tên lô" style="padding:4px 6px;font-size:0.8rem;"></td>
                        ` : ''}
                        <td><select class="form-control cdtrug-loai-nha-thau" style="padding:4px 6px;font-size:0.8rem;">
                            <option value="Độc lập" ${ntType === 'Độc lập' ? 'selected' : ''}>Độc lập</option>
                            <option value="Liên danh" ${ntType === 'Liên danh' ? 'selected' : ''}>Liên danh</option>
                        </select></td>
                        <td><input type="text" class="form-control cdtrug-ma-nha-thau" value="${ntCode}" required placeholder="Mã NT" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-gia-du-thau cdtrug-format-vnd" value="${bidData.giaDuThau ? this.model.formatVND(bidData.giaDuThau) : ''}" placeholder="Giá dự thầu" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-ty-le-giam-gia" value="${bidData.tyLeGiamGia !== undefined ? (bidData.tyLeGiamGia || 0).toString().replace('.', ',') : '0'}" style="padding:4px 6px;font-size:0.8rem;text-align:right;"></td>
                        <td><input type="text" class="form-control cdtrug-gia-sau-giam-gia cdtrug-format-vnd" value="${bidData.giaSauGiamGia ? this.model.formatVND(bidData.giaSauGiamGia) : ''}" readonly placeholder="Tự tính" style="padding:4px 6px;font-size:0.8rem;background:var(--bg-input-disabled,#f1f5f9);cursor:not-allowed;"></td>
                        <td><input type="text" class="form-control cdtrug-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + ' ngày' : (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-gia-tri-dam-bao cdtrug-format-vnd" value="${bidData.giaTriDamBao ? this.model.formatVND(bidData.giaTriDamBao) : ''}" placeholder="Giá trị ĐB" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-hieu-luc-bao-dam-ngay" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + ' ngày' : (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-thoi-gian-thuc-hien" value="${bidData.thoiGianThucHien || gt.thoiGianThucHien || ''}" placeholder="Thực hiện" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td style="text-align:center;">
                            <button type="button" class="action-btn btn-delete cdtrug-remove-row" title="Xóa hàng">
                                <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
                            </button>
                        </td>
                    `;

                    // Auto-calc giá sau giảm
                    const inpGia = tr.querySelector('.cdtrug-gia-du-thau');
                    const inpTL = tr.querySelector('.cdtrug-ty-le-giam-gia');
                    const inpGSG = tr.querySelector('.cdtrug-gia-sau-giam-gia');
                    const calcGSG = () => {
                        const g = this.model.parseVND(inpGia.value) || 0;
                        const t = parseFloat((inpTL.value || '0').replace(/,/g, '.')) || 0;
                        const gsg = g * (1 - t / 100);
                        inpGSG.value = gsg > 0 ? this.model.formatVND(gsg) : '';
                    };
                    if (inpGia) inpGia.addEventListener('input', calcGSG);
                    if (inpTL) inpTL.addEventListener('input', calcGSG);

                    // Format VND
                    ['.cdtrug-gia-du-thau', '.cdtrug-gia-tri-dam-bao'].forEach(cls => {
                        const el = tr.querySelector(cls);
                        if (el) el.addEventListener('blur', () => { el.value = this.model.formatVND(this.model.parseVND(el.value)) || ''; });
                    });

                    // Lot select change
                    const lotSel = tr.querySelector('.cdtrug-ma-phan-lo');
                    if (lotSel) {
                        lotSel.addEventListener('change', () => {
                            const opt = lotSel.options[lotSel.selectedIndex];
                            const tenPhanLoEl = tr.querySelector('.cdtrug-ten-phan-lo');
                            if (tenPhanLoEl) tenPhanLoEl.value = opt?.getAttribute('data-name') || '';
                        });
                    }

                    // Delete row
                    tr.querySelector('.cdtrug-remove-row').addEventListener('click', () => tr.remove());

                    cdtrugTbody.appendChild(tr);
                    if (window.lucide) window.lucide.createIcons({ root: tr });
                };

                if (isSpecialBiddingType && cdtrugTbody) {
                    // Pre-populate existing bids
                    const existingBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
                    if (existingBids.length > 0) {
                        existingBids.forEach(b => addCdtrugRow(b));
                    } else {
                        addCdtrugRow(); // empty row
                    }

                    // 'Add Bidder' button
                    const btnAddCdtrug = document.getElementById('btn-cdtrug-add-bidder');
                    if (btnAddCdtrug) {
                        btnAddCdtrug.addEventListener('click', () => {
                            addCdtrugRow();
                            if (window.lucide) window.lucide.createIcons();
                        });
                    }
                }

                const approveBtn = document.getElementById('btn-approve-award');
                if (approveBtn) {
                    approveBtn.onclick = async () => {
                        if (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                            await window.saveKetQuaChiDinhThau(gt.id);
                            return;
                        }

                        const decNo = document.getElementById('award-decision-no')?.value.trim() || '';
                        const decDateRaw = document.getElementById('award-decision-date')?.value || '';
                        const decDate = this.model.convertDMYToYMD(decDateRaw);

                        const soBctdResultVal = document.getElementById('award-so-bctd')?.value.trim() || '';
                        const ngayBctdResultRaw = document.getElementById('award-ngay-bctd')?.value || '';
                        const ngayBctdResultVal = this.model.convertDMYToYMD(ngayBctdResultRaw);

                        let hasError = false;
                        const errorInputs = [];

                        // Validate inputs
                        const fields = [];
                        if (document.getElementById('award-so-bctd')) {
                            fields.push({ el: document.getElementById('award-so-bctd'), val: soBctdResultVal });
                        }
                        if (document.getElementById('award-ngay-bctd')) {
                            fields.push({ el: document.getElementById('award-ngay-bctd'), val: ngayBctdResultRaw });
                        }
                        fields.push(
                            { el: document.getElementById('award-decision-no'), val: decNo },
                            { el: document.getElementById('award-decision-date'), val: decDateRaw }
                        );

                        fields.forEach(f => {
                            if (!f.val) {
                                hasError = true;
                                if (f.el) {
                                    errorInputs.push(f.el);
                                    f.el.closest('.form-group')?.querySelector('.error-text') ? (f.el.closest('.form-group').querySelector('.error-text').style.display = 'block') : null;
                                    f.el.closest('.form-group')?.classList.add('invalid');
                                    const clearInvalid = () => {
                                        f.el.closest('.form-group')?.querySelector('.error-text') ? (f.el.closest('.form-group').querySelector('.error-text').style.display = 'none') : null;
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
                            const status = tr.querySelector('.row-status-select')?.value || (isDirectOrSpecial ? 'trung' : 'truot');
                            if (status === 'trung') {
                                winnerRows.push(tr);
                            }
                        });

                        winnerRows.forEach(wTr => {
                            const finalPriceRaw = wTr.querySelector('.row-gia-trung')?.value || '';
                            const durPkg = wTr.querySelector('.row-tg-goithau')?.value.trim() || '';
                            const durCtr = wTr.querySelector('.row-tg-hopdong')?.value.trim() || '';

                            const rowInputs = [];
                            if (isDirectOrSpecial) {
                                rowInputs.push(
                                    { el: wTr.querySelector('.row-ma-nha-thau'), val: wTr.querySelector('.row-ma-nha-thau')?.value.trim() },
                                    { el: wTr.querySelector('.row-ten-nha-thau'), val: wTr.querySelector('.row-ten-nha-thau')?.value.trim() }
                                );
                            }
                            rowInputs.push(
                                { el: wTr.querySelector('.row-gia-trung'), val: finalPriceRaw },
                                { el: wTr.querySelector('.row-tg-goithau'), val: durPkg },
                                { el: wTr.querySelector('.row-tg-hopdong'), val: durCtr }
                            );

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

                        if (isDirectOrSpecial) {
                            // Reconstruct bidders from input rows
                            this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) !== String(gt.id));
                        }

                        // Save bidder failure reasons to database / model state
                        tbodyApprove.querySelectorAll('tr').forEach(tr => {
                            const bidId = tr.getAttribute('data-approve-bid-id');
                            let bid = this.model.state.thongtinmothau.find(b => b.id === bidId);

                            const maNhaThau = tr.querySelector('.row-ma-nha-thau')?.value.trim() || '';
                            const tenNhaThau = tr.querySelector('.row-ten-nha-thau')?.value.trim() || '';
                            const giaTrungRaw = tr.querySelector('.row-gia-trung')?.value || '';
                            const giaTrung = this.model.parseVND(giaTrungRaw);
                            const durPkg = tr.querySelector('.row-tg-goithau')?.value.trim() || '';
                            const durCtr = tr.querySelector('.row-tg-hopdong')?.value.trim() || '';

                            let maPhanLo = '';
                            let tenPhanLo = '';
                            if (gt.phanLo === 'Có') {
                                maPhanLo = tr.querySelector('.row-ma-phan-lo')?.value || '';
                                tenPhanLo = tr.querySelector('.row-ten-phan-lo')?.value || '';
                            }

                            if (isDirectOrSpecial) {
                                const loaiNt = tr.querySelector('.row-loai-nha-thau')?.value || 'Độc lập';
                                const tvLd = tr._thanhVienLienDanh || [];

                                // Find or create contractor in nhathau table to get the correct nhaThauId
                                let foundNt = this.model.state.nhathau.find(n =>
                                    (n.maNhaThau && maNhaThau && n.maNhaThau.toLowerCase() === maNhaThau.toLowerCase()) ||
                                    (n.tenNhaThau && tenNhaThau && n.tenNhaThau.toLowerCase() === tenNhaThau.toLowerCase())
                                );

                                if (!foundNt && tenNhaThau) {
                                    const newNtId = window.generateUUID();
                                    foundNt = {
                                        id: newNtId,
                                        rootId: newNtId,
                                        phienBan: '00',
                                        isLatest: 1,
                                        maNhaThau: maNhaThau || 'NT-' + window.generateUUID().toString().substr(8),
                                        tenNhaThau: tenNhaThau,
                                        loaiNhaThau: loaiNt,
                                        maSoThue: maNhaThau || '',
                                        nguoiDaiDien: '',
                                        danhXung: 'Ông',
                                        soDienThoai: '',
                                        email: '',
                                        diaChi: '',
                                        soTaiKhoan: '',
                                        noiMoTaiKhoan: '',
                                        maNganHang: '',
                                        thanhVienLienDanh: loaiNt === 'Liên danh' ? tvLd.map(m => ({
                                            tenNhaThau: m.tenNhaThau,
                                            maSoThue: m.maSoThue,
                                            vaiTro: "Thành viên liên danh"
                                        })) : []
                                    };
                                    this.model.state.nhathau.push(foundNt);
                                    this.model.persistData('nhathau');
                                }

                                const nhaThauId = foundNt ? foundNt.id : bidId;

                                // Reconstruct full JV list including the lead member
                                const fullJvList = [];
                                if (loaiNt === 'Liên danh') {
                                    // Lead member
                                    fullJvList.push({
                                        tenNhaThau: tr._leadMemberName || tenNhaThau,
                                        maSoThue: maNhaThau,
                                        vaiTro: "Đứng đầu liên danh"
                                    });
                                    // Other members
                                    tvLd.forEach(m => {
                                        fullJvList.push({
                                            tenNhaThau: m.tenNhaThau,
                                            maSoThue: m.maSoThue,
                                            vaiTro: "Thành viên liên danh"
                                        });
                                    });
                                }

                                bid = {
                                    id: bidId,
                                    goiThauId: gt.id,
                                    nhaThauId: nhaThauId,
                                    maNhaThau: maNhaThau,
                                    tenNhaThau: tenNhaThau,
                                    loaiNhaThau: loaiNt,
                                    thanhVienLienDanh: fullJvList,
                                    giaDuThau: giaTrung || gt.giaGoiThau,
                                    giaSauGiamGia: giaTrung || gt.giaGoiThau,
                                    danhGiaHopLe: 'Đạt',
                                    danhGiaNangLuc: 'Đạt',
                                    danhGiaKyThuat: 'Đạt',
                                    danhGiaTaiChinh: 'Đạt',
                                    danhGiaKetLuan: 'Đạt',
                                    thoiGianThucHien: durPkg,
                                    lyDoTruot: ''
                                };
                                if (gt.phanLo === 'Có') {
                                    bid.maPhanLo = maPhanLo;
                                    bid.tenPhanLo = tenPhanLo;
                                }
                                this.model.state.thongtinmothau.push(bid);
                            } else {
                                if (bid) {
                                    const status = tr.querySelector('.row-status-select')?.value || (isDirectOrSpecial ? 'trung' : 'truot');
                                    if (status === 'trung') {
                                        bid.lyDoTruot = '';
                                    } else {
                                        bid.lyDoTruot = tr.querySelector('.row-ly-do-truot')?.value.trim() || '';
                                    }
                                }
                            }
                        });

                        let hasWinner = winnerRows.length > 0;
                        let winnerIdStr = 'none';
                        if (gt.phanLo === 'Có') {
                            const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
                            plList.forEach(pl => {
                                const lotWinnerTr = winnerRows.find(tr => {
                                    if (isDirectOrSpecial) {
                                        return tr.querySelector('.row-ma-phan-lo')?.value === pl.maPhanLo;
                                    } else {
                                        return tr.cells[0]?.textContent.trim() === pl.maPhanLo;
                                    }
                                });
                                if (lotWinnerTr) {
                                    let wId = lotWinnerTr.getAttribute('data-nt-id');
                                    if (isDirectOrSpecial) {
                                        const wMa = lotWinnerTr.querySelector('.row-ma-nha-thau')?.value.trim() || '';
                                        const wTen = lotWinnerTr.querySelector('.row-ten-nha-thau')?.value.trim() || '';
                                        const foundWinnerNt = this.model.state.nhathau.find(n =>
                                            (n.maNhaThau && wMa && n.maNhaThau.toLowerCase() === wMa.toLowerCase()) ||
                                            (n.tenNhaThau && wTen && n.tenNhaThau.toLowerCase() === wTen.toLowerCase())
                                        );
                                        wId = foundWinnerNt ? foundWinnerNt.id : lotWinnerTr.getAttribute('data-approve-bid-id');
                                    }
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
                                let wId = firstWinner.getAttribute('data-nt-id');
                                if (isDirectOrSpecial) {
                                    const wMa = firstWinner.querySelector('.row-ma-nha-thau')?.value.trim() || '';
                                    const wTen = firstWinner.querySelector('.row-ten-nha-thau')?.value.trim() || '';
                                    const foundWinnerNt = this.model.state.nhathau.find(n =>
                                        (n.maNhaThau && wMa && n.maNhaThau.toLowerCase() === wMa.toLowerCase()) ||
                                        (n.tenNhaThau && wTen && n.tenNhaThau.toLowerCase() === wTen.toLowerCase())
                                    );
                                    wId = foundWinnerNt ? foundWinnerNt.id : firstWinner.getAttribute('data-approve-bid-id');
                                }
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
                                if (isDirectOrSpecial) {
                                    const wMa = winnerTr.querySelector('.row-ma-nha-thau')?.value.trim() || '';
                                    const wTen = winnerTr.querySelector('.row-ten-nha-thau')?.value.trim() || '';
                                    const foundWinnerNt = this.model.state.nhathau.find(n =>
                                        (n.maNhaThau && wMa && n.maNhaThau.toLowerCase() === wMa.toLowerCase()) ||
                                        (n.tenNhaThau && wTen && n.tenNhaThau.toLowerCase() === wTen.toLowerCase())
                                    );
                                    winnerIdStr = foundWinnerNt ? foundWinnerNt.id : winnerTr.getAttribute('data-approve-bid-id');
                                } else {
                                    winnerIdStr = winnerTr.getAttribute('data-nt-id');
                                }
                                finalPrice = this.model.parseVND(winnerTr.querySelector('.row-gia-trung')?.value || '0');
                                durPkg = winnerTr.querySelector('.row-tg-goithau')?.value.trim() || '';
                                durCtr = winnerTr.querySelector('.row-tg-hopdong')?.value.trim() || '';
                            }
                            gt.nhaThauTrungThauId = winnerIdStr === 'none' ? '' : (isNaN(winnerIdStr) ? winnerIdStr : parseInt(winnerIdStr));
                            gt.giaTrungThau = finalPrice;
                            gt.thoiGianGoiThau = winnerIdStr === 'none' ? '' : durPkg;
                            gt.thoiGianHopDong = winnerIdStr === 'none' ? '' : durCtr;
                        }
                        let meta = {};
                        try {
                            meta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
                        } catch (e) { }
                        if (!meta.result) meta.result = {};
                        meta.result.soBctdKetQua = soBctdResultVal;
                        meta.result.ngayBctdKetQua = ngayBctdResultVal;

                        const hasActualWinner = (gt.phanLo === 'Có')
                            ? (typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || [])).some(pl => pl.nhaThauTrungThauId)
                            : (winnerIdStr !== 'none' && !!gt.nhaThauTrungThauId);

                        if (!hasActualWinner) {
                            if (!meta.cancelDetails) meta.cancelDetails = {};
                            meta.cancelDetails.soQuyetDinhHuyThau = decNo;
                            meta.cancelDetails.ngayQuyetDinhHuyThau = decDate;
                            meta.cancelDetails.lyDoHuyThau = "Tất cả các hồ sơ dự thầu không đáp ứng yêu cầu của hồ sơ mời thầu. Hủy thầu theo quy định tại Điểm a Khoản 1 Điều 17 Luật Đấu thầu số 22/2023/QH15 ngày 23 tháng 6 năm 2023, sửa đổi, bổ sung tại Luật số 57/2024/QH15, Luật số 90/2025/QH15.";

                            gt.danhGiaHsdtMetadata = JSON.stringify(meta);
                            gt.soQuyetDinhKetQua = decNo;
                            gt.ngayQuyetDinhKetQua = decDate;

                            this.model.persistData('goithau');
                            this.model.persistData('thongtinmothau');
                            this.renderGoiThauTable();
                            window.appController.autoSync();

                            this._currentWorkflowTab = 'cancel';
                            await this.customAlert('Không có nhà thầu trúng thầu', 'Không có nhà thầu nào đạt yêu cầu. Hệ thống đã tự động điền các thông tin hủy thầu tương ứng và chuyển bạn sang tab Hủy thầu để xem lại hoặc điều chỉnh trước khi xác nhận hủy thầu chính thức.', 'info');
                            this.showPackageDetails(gt.id);
                            return;
                        }

                        gt.danhGiaHsdtMetadata = JSON.stringify(meta);

                        gt.soQuyetDinhKetQua = decNo;
                        gt.ngayQuyetDinhKetQua = decDate;
                        gt.trangThai = 'Đã có kết quả';

                        this.model.persistData('goithau');
                        this.model.persistData('thongtinmothau');
                        this.renderGoiThauTable();
                        window.appController.autoSync();

                        await this.customAlert('Chúc mừng', `Đã phê duyệt kết quả trúng thầu cho gói thầu "${gt.tenGoiThau}" thành công!`, 'check-circle');
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
                    window.appController.triggerExcelImport('ketquaqd');
                };
            }

            const btnAddBidder = document.getElementById('btn-result-add-bidder');
            if (btnAddBidder) {
                btnAddBidder.onclick = () => {
                    const tbody = document.getElementById('approve-bidders-tbody');
                    if (!tbody) return;

                    const newId = window.generateUUID();
                    const tr = document.createElement('tr');
                    tr.setAttribute('data-approve-bid-id', newId);
                    tr.setAttribute('data-is-qualified', 'true');
                    tr.setAttribute('data-nt-id', newId);

                    let lotCells = '';
                    if (gt.phanLo === 'Có') {
                        const lots = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
                        const optionsHtml = lots.map(l => `<option value="${l.maPhanLo}" data-name="${l.tenPhanLo}">${l.maPhanLo}</option>`).join('');
                        const firstLotName = lots[0] ? lots[0].tenPhanLo : '';
                        lotCells = `
                            <td>
                                <select class="form-control row-ma-phan-lo" style="padding:4px 8px; font-size:0.8rem;">
                                    ${optionsHtml}
                                </select>
                            </td>
                            <td>
                                <input type="text" class="form-control row-ten-phan-lo" value="${firstLotName}" readonly style="padding:4px 8px; font-size:0.8rem; background:#f1f5f9;">
                            </td>
                        `;
                    }

                    tr._thanhVienLienDanh = [];
                    tr._leadMemberName = '';
                    tr.innerHTML = `
                        ${lotCells}
                        <td>
                            <select class="form-control row-loai-nha-thau" style="padding:4px 8px; font-size:0.8rem;">
                                <option value="Độc lập" selected>Độc lập</option>
                                <option value="Liên danh">Liên danh</option>
                            </select>
                        </td>
                        <td>
                            <input type="text" class="form-control row-ma-nha-thau" value="" placeholder="Mã nhà thầu" style="padding:4px 8px; font-size:0.8rem;">
                        </td>
                        <td>
                            <input type="text" class="form-control row-ten-nha-thau" value="" placeholder="Tên nhà thầu" style="padding:4px 8px; font-size:0.8rem;">
                            <div class="row-jv-members-container" style="margin-top: 4px; display: none;">
                                <button type="button" class="btn btn-outline btn-xs row-btn-manage-members" style="padding: 2px 6px; font-size: 0.72rem; font-weight: 700; border-style: dashed; width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--primary); border-color: var(--primary-soft);">
                                    <i data-lucide="users" style="width: 12px; height: 12px;"></i>
                                    <span class="row-jv-btn-text">Thành viên liên danh (0)</span>
                                </button>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="form-control row-gia-trung" value="" placeholder="Giá trúng..." style="padding:4px 8px; font-size:0.8rem; width:100%;">
                        </td>
                        <td>
                            <input type="text" class="form-control row-tg-goithau" value="${gt.thoiGianThucHien || ''}" placeholder="Thời gian gói..." style="padding:4px 8px; font-size:0.8rem; width:100%;">
                        </td>
                        <td>
                            <input type="text" class="form-control row-tg-hopdong" value="${gt.thoiGianThucHien ? (gt.thoiGianThucHien + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : ''}" placeholder="Thời gian HĐ..." style="padding:4px 8px; font-size:0.8rem; width:100%;">
                        </td>
                        <td style="text-align: center;">
                            <button class="action-btn btn-delete row-remove-bidder" style="border:none; background:none; cursor:pointer; color:var(--danger);"><i data-lucide="trash-2" style="width:16px; height:16px;"></i></button>
                        </td>
                    `;

                    tbody.appendChild(tr);

                    if (window.lucide) {
                        window.lucide.createIcons();
                    }

                    initRowListeners(tr);
                };
            }
            break;

        case 'cancel': {
            let meta = {};
            try {
                meta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
            } catch (e) { }
            if (!meta.cancelDetails) meta.cancelDetails = {};

            const soQdHuy = meta.cancelDetails.soQuyetDinhHuyThau || '';
            const ngayQdHuy = meta.cancelDetails.ngayQuyetDinhHuyThau || '';
            const lyDoHuy = meta.cancelDetails.lyDoHuyThau || '';

            const displayDate = ngayQdHuy ? this.model.formatForDateInput(ngayQdHuy) : '';
            const isCanceled = gt.trangThai === 'Hủy thầu';

            contentWrapper.innerHTML = `
                <div class="card" style="padding: 24px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); box-shadow: var(--shadow-sm);">
                    <h4 style="font-weight: 700; color: var(--danger, #ef4444); border-bottom: 2px solid rgba(239, 68, 68, 0.1); padding-bottom: 12px; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; font-size: 1.05rem;">
                        <i data-lucide="x-circle" style="width: 20px; height: 20px;"></i> Quyết định Hủy thầu
                    </h4>
                    
                    <div style="display: flex; flex-direction: column; gap: 20px; max-width: 650px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
                                <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-main);">Số quyết định hủy thầu <span style="color: var(--danger);">*</span></label>
                                <input type="text" id="cancel-dec-no" class="form-control" value="${soQdHuy}" placeholder="VD: 123/QĐ-CDT" ${isCanceled ? 'disabled' : ''} style="width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: ${isCanceled ? 'var(--bg-input-disabled, #f1f5f9)' : 'var(--bg-input)'}; color: var(--text-main);" />
                            </div>
                            <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
                                <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-main);">Ngày quyết định hủy thầu <span style="color: var(--danger);">*</span></label>
                                <input type="text" id="cancel-dec-date" class="form-control flatpickr-date" value="${displayDate}" placeholder="dd/MM/yyyy" ${isCanceled ? 'disabled' : ''} style="width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: ${isCanceled ? 'var(--bg-input-disabled, #f1f5f9)' : 'var(--bg-input)'}; color: var(--text-main);" />
                            </div>
                        </div>
                        
                        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
                            <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-main);">Lý do hủy thầu <span style="color: var(--danger);">*</span></label>
                            <textarea id="cancel-reason" class="form-control" rows="5" placeholder="Nhập lý do hủy thầu..." ${isCanceled ? 'disabled' : ''} style="width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: ${isCanceled ? 'var(--bg-input-disabled, #f1f5f9)' : 'var(--bg-input)'}; color: var(--text-main); resize: vertical; line-height: 1.5; font-family: inherit;">${lyDoHuy}</textarea>
                        </div>
                        
                        ${!isCanceled ? `
                        <div style="display: flex; gap: 12px; margin-top: 10px;">
                            <button id="btn-save-cancel-details" class="btn btn-primary" style="padding: 10px 24px; font-weight: 700; background-color: var(--primary); border: none; border-radius: var(--radius-md); color: white; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                                <i data-lucide="check"></i> Xác nhận hủy thầu
                            </button>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;

            if (typeof this.initFlatpickr === 'function') {
                this.initFlatpickr(contentWrapper);
            }
            if (window.lucide) window.lucide.createIcons();

            const btnSaveCancel = document.getElementById('btn-save-cancel-details');
            if (btnSaveCancel) {
                btnSaveCancel.onclick = async () => {
                    const decNo = document.getElementById('cancel-dec-no').value.trim();
                    const decDate = document.getElementById('cancel-dec-date').value.trim();
                    const reason = document.getElementById('cancel-reason').value.trim();

                    if (!decNo || !decDate || !reason) {
                        await this.customAlert('Thiếu thông tin', 'Vui lòng điền đầy đủ Số quyết định, Ngày quyết định và Lý do hủy thầu.', 'alert-triangle');
                        return;
                    }

                    const formattedDecDate = decDate ? this.model.convertDMYToYMD(decDate) : '';

                    let meta = {};
                    try {
                        meta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
                    } catch (e) { }
                    if (!meta.cancelDetails) meta.cancelDetails = {};
                    if (!meta.cancelDetails.trangThaiTruocHuy && gt.trangThai !== 'Hủy thầu') {
                        meta.cancelDetails.trangThaiTruocHuy = gt.trangThai;
                    }
                    meta.cancelDetails.soQuyetDinhHuyThau = decNo;
                    meta.cancelDetails.ngayQuyetDinhHuyThau = formattedDecDate;
                    meta.cancelDetails.lyDoHuyThau = reason;
                    gt.danhGiaHsdtMetadata = JSON.stringify(meta);

                    gt.trangThai = 'Hủy thầu';

                    this.model.persistData('goithau');
                    this.renderGoiThauTable();
                    window.appController.autoSync();

                    await this.customAlert('Thành công', 'Đã lưu quyết định hủy thầu và cập nhật trạng thái gói thầu.', 'check-circle');
                    this.showPackageDetails(gt.id);
                };
            }
            break;
        }
    }
    lucide.createIcons();
    if (window.appController && window.appController.setupExcelImportEvents) {
        window.appController.setupExcelImportEvents();
    }

    // Programmatically remove redundant package selection custom dropdown elements from DOM in detail view
    ['mothau-goithau-select', 'danhgiahsdt-goithau-select', 'result-goithau-select'].forEach(selectId => {
        const wrapper = document.querySelector(`.custom-select-wrapper[data-select-id="${selectId}"]`);
        if (wrapper) wrapper.remove();
        const container = document.querySelector(`.custom-select-container[data-target="${selectId}"]`);
        if (container) container.remove();
    });
    if (window.appController && typeof window.appController.unifyTableInputsHeight === 'function') {
        window.appController.unifyTableInputsHeight(document);
    }
}



