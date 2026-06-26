/* ==========================================================================
   BiddingFlow - BidEvaluationController (Part of Controller split)
   ========================================================================== */

export function renderDanhGiaHsdtPanel() {
    const select = this.view.getActiveElement('danhgiahsdt-goithau-select');
    if (!select) return;

    // 1. Populate packages dropdown - hiện gói đang chấm thầu hoặc đã có kết quả
    const targetPackages = this.model.state.goithau.filter(g =>
        g.trangThai === 'Đang chấm thầu' || g.trangThai === 'Đã có kết quả'
    );
    const selectedVal = select.value;
    select.innerHTML = '<option value="">-- Chọn Gói thầu (Đang chấm thầu / Đã có kết quả) --</option>' +
        targetPackages.map(g => `<option value="${g.id}" data-search="${g.maGoiThau || ''} ${g.tenGoiThau || ''}">${g.tenGoiThau} (${g.maGoiThau || 'Chưa có mã'})</option>`).join('');

    if (selectedVal && targetPackages.some(g => g.id === selectedVal)) {
        select.value = selectedVal;
    } else {
        select.value = '';
    }
    this.makeSearchableSelect(select, 'Tìm kiếm Gói thầu...');

    const summaryContainer = this.view.getActiveElement('danhgiahsdt-goithau-summary');
    const evaluationContainer = this.view.getActiveElement('danhgiahsdt-container');
    const emptyState = this.view.getActiveElement('danhgiahsdt-empty-state');
    const thead = this.view.getActiveElement('danhgiahsdt-table-thead');
    const tbody = this.view.getActiveElement('danhgiahsdt-table-tbody');

    const addLetterRow = (containerId, letter = { soCv: '', ngayCv: '' }, readOnly = false) => {
        const container = this.view.getActiveElement(containerId);
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'letter-row';
        div.style.display = 'grid';
        div.style.gridTemplateColumns = '1fr 1fr auto';
        div.style.gap = '6px';
        div.style.alignItems = 'center';
        div.style.marginBottom = '6px';

        const ngayFormatted = letter.ngayCv ? this.model.formatDate(letter.ngayCv) : '';

        div.innerHTML = readOnly ? `
            <div style="font-size: 0.8rem; font-weight: 600; padding: 6px; background: rgba(0,0,0,0.02); border-radius: 4px;">${letter.soCv || '--'}</div>
            <div style="font-size: 0.8rem; padding: 6px; background: rgba(0,0,0,0.02); border-radius: 4px;">${ngayFormatted || '--'}</div>
            <div></div>
        ` : `
            <input type="text" class="form-control letter-so-cv" placeholder="Số công văn" value="${letter.soCv || ''}" style="padding: 4px 8px; font-size: 0.8rem;" required>
            <input type="text" class="form-control letter-ngay-cv flatpickr-dmy" placeholder="Chọn ngày" value="${ngayFormatted}" style="padding: 4px 8px; font-size: 0.8rem;" required>
            <button type="button" class="btn-delete-row" style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;" onclick="this.closest('.letter-row').remove()">&times;</button>
        `;
        container.appendChild(div);
        if (!readOnly) {
            flatpickr(div.querySelector('.flatpickr-dmy'), {
                dateFormat: "d/m/Y",
                locale: "vn",
                allowInput: true
            });
        }
    };

    const handlePackageSelection = () => {
        const gtId = select.value;
        if (!gtId) {
            summaryContainer.style.display = 'none';
            evaluationContainer.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        const gt = this.model.state.goithau.find(g => g.id === gtId);
        if (!gt) return;

        const kh = this.model.state.kehoach.find(k => k.id === gt.keHoachId);
        const cdt = kh ? this.model.state.chudautu.find(c => c.id === kh.chuDauTuId) : null;
        const tenCdt = cdt ? cdt.tenChuDauTu : 'Không rõ';

        const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';

        let isTechEvalSaved = false;
        let isFinEvalSaved = false;
        let isEvalSaved1G1T = false;
        let isQualifiedSaved = false;
        if (gt.danhGiaHsdtMetadata) {
            try {
                const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
                if (is1G2T) {
                    if (parsed.is1G2T) {
                        isTechEvalSaved = !!(parsed.technical && parsed.technical.saved);
                        isFinEvalSaved = !!(parsed.financial && parsed.financial.saved);
                        isQualifiedSaved = !!(parsed.technical && parsed.technical.qualifiedSaved);
                    }
                } else {
                    isEvalSaved1G1T = !!parsed.saved;
                }
            } catch (e) {
                console.error("Error parsing evaluation metadata:", e);
            }
        }

        const isCompleted = this.currentDanhGiaTab === 'technical'
            ? (is1G2T ? isTechEvalSaved : isEvalSaved1G1T)
            : isFinEvalSaved;

        const stepKey = this.currentDanhGiaTab === 'financial' ? 'eval_fin' : 'eval_tech';
        const isEditingThisStep = this.view._editingState && this.view._editingState[stepKey];
        const isReadOnly = is1G2T
            ? (this.currentDanhGiaTab === 'technical'
                ? (isQualifiedSaved || gt.trangThai === 'Đã có kết quả' || gt.trangThai === 'Hủy thầu')
                : (gt.trangThai === 'Đã có kết quả' || gt.trangThai === 'Hủy thầu'))
            : (gt.trangThai === 'Đã có kết quả' || gt.trangThai === 'Hủy thầu');
        const isEditable = !isReadOnly;

        // 2. Render Summary Card
        summaryContainer.style.display = 'block';
        summaryContainer.innerHTML = `
            <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem; margin-bottom: 12px;">
                <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdt}</span></div>
                <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}</div>
                <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                <div>• <strong>Giá gói thầu:</strong> <span class="text-blue fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                ${gt.phuongPhapDanhGia ? `<div>• <strong>Phương pháp đánh giá:</strong> ${gt.phuongPhapDanhGia}${gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá' && gt.trongSoKyThuat ? ` (${gt.trongSoKyThuat}%)` : ''}</div>` : ''}
                <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                <div>• <strong>Thời gian mở thầu:</strong> ${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '--'}</div>
            </div>
            ${isReadOnly ? `<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Hồ sơ đánh giá đã được khóa — Gói thầu đã có kết quả
            </div>` : ''}
        `;

        emptyState.style.display = 'none';
        evaluationContainer.style.display = 'block';

        // Setup Quy trình selector for Goods/Non-consulting 1G1T packages
        const quyTrinhContainer = this.view.getActiveElement('danhgiahsdt-quytrinh-container');
        const isGoodsOrNonConsulting = gt.linhVuc === 'Hàng hóa' || gt.linhVuc === 'Phi tư vấn';
        const is1G1T = gt.phuongThucLuaChon === 'Một giai đoạn một túi hồ sơ';
        const showQuyTrinh = isGoodsOrNonConsulting && is1G1T;

        if (quyTrinhContainer) {
            if (showQuyTrinh) {
                quyTrinhContainer.style.display = 'flex';
                // Load existing value
                const currentQuyTrinh = gt.quyTrinhDanhGia || 'quytrinh1';
                const radio1 = quyTrinhContainer.querySelector('input[value="quytrinh1"]');
                const radio2 = quyTrinhContainer.querySelector('input[value="quytrinh2"]');
                if (radio1 && radio2) {
                    radio1.checked = currentQuyTrinh === 'quytrinh1';
                    radio2.checked = currentQuyTrinh === 'quytrinh2';

                    if (isReadOnly) {
                        radio1.disabled = true;
                        radio2.disabled = true;
                    } else {
                        radio1.removeAttribute('disabled');
                        radio2.removeAttribute('disabled');
                    }

                    // On change event
                    radio1.onchange = () => {
                        gt.quyTrinhDanhGia = 'quytrinh1';
                        let meta = {};
                        try {
                            meta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
                        } catch (e) {}
                        meta.quyTrinhDanhGia = 'quytrinh1';
                        gt.danhGiaHsdtMetadata = JSON.stringify(meta);
                        this.model.persistData('goithau');
                        handlePackageSelection();
                    };
                    radio2.onchange = () => {
                        gt.quyTrinhDanhGia = 'quytrinh2';
                        let meta = {};
                        try {
                            meta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
                        } catch (e) {}
                        meta.quyTrinhDanhGia = 'quytrinh2';
                        gt.danhGiaHsdtMetadata = JSON.stringify(meta);
                        this.model.persistData('goithau');
                        handlePackageSelection();
                    };
                }
            } else {
                quyTrinhContainer.style.display = 'none';
            }
        }

        // 3. Setup dynamic tab structures for 1G2T packages
        const tabsHeader = this.view.getActiveElement('danhgiahsdt-tabs-header');
        const tabBtnKt = this.view.getActiveElement('tab-btn-hsdxt-kt');
        const tabBtnTc = this.view.getActiveElement('tab-btn-hsdxt-tc');

        // Parse existing metadata
        let metadata = { soBaoCao: '', ngayBaoCao: '', cvLamRo: [], cvTraLoi: [], cvGuiCdt: [] };
        if (gt.danhGiaHsdtMetadata) {
            try {
                metadata = JSON.parse(gt.danhGiaHsdtMetadata);
                if (metadata && metadata.quyTrinhDanhGia) {
                    gt.quyTrinhDanhGia = metadata.quyTrinhDanhGia;
                }
            } catch (e) {
                console.error("Failed to parse evaluation metadata:", e);
            }
        }

        if (is1G2T) {
            const isWorkflowView = document.getElementById('tab-goithau-detail')?.classList.contains('active');
            if (tabsHeader) {
                tabsHeader.style.display = isWorkflowView ? 'none' : 'flex';
            }
            if (!this.currentDanhGiaTab || (this.currentDanhGiaTab !== 'technical' && this.currentDanhGiaTab !== 'financial')) {
                this.currentDanhGiaTab = 'technical';
            }
            this._lastSelectedGtId = gtId;

            // Ensure technical metadata structure exists
            if (!metadata.is1G2T) {
                // Migrate if single metadata was stored previously
                const oldMeta = { ...metadata };
                metadata = {
                    is1G2T: true,
                    technical: oldMeta.soBaoCao ? oldMeta : { soBaoCao: '', ngayBaoCao: '', cvLamRo: [], cvTraLoi: [], cvGuiCdt: [], saved: false },
                    financial: { soBaoCao: '', ngayBaoCao: '', cvLamRo: [], cvTraLoi: [], cvGuiCdt: [], saved: false }
                };
            }

            const isKtSaved = !!(metadata.technical && metadata.technical.saved);

            // Setup tab switching buttons styling & accessibility
            if (tabBtnKt && tabBtnTc) {
                if (isKtSaved) {
                    tabBtnTc.removeAttribute('disabled');
                    tabBtnTc.style.opacity = '1';
                    tabBtnTc.style.cursor = 'pointer';
                } else {
                    tabBtnTc.setAttribute('disabled', 'true');
                    tabBtnTc.style.opacity = '0.6';
                    tabBtnTc.style.cursor = 'not-allowed';
                    this.currentDanhGiaTab = 'technical'; // fallback to technical if financial is locked
                }

                // Active styling switcher
                if (this.currentDanhGiaTab === 'technical') {
                    tabBtnKt.className = 'btn active';
                    tabBtnKt.style.background = 'var(--bg-card)';
                    tabBtnKt.style.color = 'var(--primary)';
                    tabBtnKt.style.border = '1px solid var(--border-color)';
                    tabBtnKt.style.borderBottom = 'none';

                    tabBtnTc.className = 'btn';
                    tabBtnTc.style.background = 'transparent';
                    tabBtnTc.style.color = 'var(--text-muted)';
                    tabBtnTc.style.border = '1px solid transparent';
                } else {
                    tabBtnTc.className = 'btn active';
                    tabBtnTc.style.background = 'var(--bg-card)';
                    tabBtnTc.style.color = 'var(--primary)';
                    tabBtnTc.style.border = '1px solid var(--border-color)';
                    tabBtnTc.style.borderBottom = 'none';

                    tabBtnKt.className = 'btn';
                    tabBtnKt.style.background = 'transparent';
                    tabBtnKt.style.color = 'var(--text-muted)';
                    tabBtnKt.style.border = '1px solid transparent';
                }

                // Attach click handlers
                tabBtnKt.onclick = () => {
                    if (this.currentDanhGiaTab !== 'technical') {
                        this.currentDanhGiaTab = 'technical';
                        handlePackageSelection();
                    }
                };
                tabBtnTc.onclick = () => {
                    if (isKtSaved && this.currentDanhGiaTab !== 'financial') {
                        this.currentDanhGiaTab = 'financial';
                        handlePackageSelection();
                    }
                };
            }
        } else {
            if (tabsHeader) tabsHeader.style.display = 'none';
            this.currentDanhGiaTab = 'unified';
        }

        // Determine active meta block to populate inputs
        let activeMeta = metadata;
        if (is1G2T) {
            activeMeta = this.currentDanhGiaTab === 'technical' ? metadata.technical : metadata.financial;
        }

        // Set inputs editability
        const soBaocaoInput = this.view.getActiveElement('danhgiahsdt-so-baocao');
        const ngayBaocaoInput = this.view.getActiveElement('danhgiahsdt-ngay-baocao');
        const saveBtn = this.view.getActiveElement('btn-danhgiahsdt-save');
        const addCvLamroBtn = this.view.getActiveElement('btn-add-cv-lamro');
        const addCvTraloiBtn = this.view.getActiveElement('btn-add-cv-traloi');
        const addCvGuicdtBtn = this.view.getActiveElement('btn-add-cv-guicdt');

        if (soBaocaoInput) {
            soBaocaoInput.value = activeMeta.soBaoCao || '';
            soBaocaoInput.readOnly = isReadOnly;
        }
        if (ngayBaocaoInput) {
            ngayBaocaoInput.value = activeMeta.ngayBaoCao ? this.model.formatDate(activeMeta.ngayBaoCao) : '';
            ngayBaocaoInput.readOnly = isReadOnly;
        }
        if (saveBtn) {
            if (isReadOnly) {
                saveBtn.style.display = 'none';
            } else {
                saveBtn.style.display = '';
                saveBtn.innerHTML = '<i data-lucide="save"></i> Lưu thông tin đánh giá';
                saveBtn.className = 'btn btn-primary';
                saveBtn.onclick = () => this.saveDanhGiaHsdt();
            }
        }
        if (addCvLamroBtn) {
            addCvLamroBtn.style.display = isReadOnly ? 'none' : 'block';
            addCvLamroBtn.onclick = () => addLetterRow('list-cv-lamro', { soCv: '', ngayCv: '' }, false);
        }
        if (addCvTraloiBtn) {
            addCvTraloiBtn.style.display = isReadOnly ? 'none' : 'block';
            addCvTraloiBtn.onclick = () => addLetterRow('list-cv-traloi', { soCv: '', ngayCv: '' }, false);
        }
        if (addCvGuicdtBtn) {
            addCvGuicdtBtn.style.display = isReadOnly ? 'none' : 'block';
            addCvGuicdtBtn.onclick = () => addLetterRow('list-cv-guicdt', { soCv: '', ngayCv: '' }, false);
        }

        const importExcelBtn = this.view.getActiveElement('btn-danhgiahsdt-import-excel');
        if (importExcelBtn) importExcelBtn.style.display = isReadOnly ? 'none' : 'inline-flex';
        const downloadExcelBtn = this.view.getActiveElement('btn-danhgiahsdt-download-excel');
        if (downloadExcelBtn) downloadExcelBtn.style.display = isReadOnly ? 'none' : 'inline-flex';

        // Render dynamic CV fields if elements exist
        const listCvLamro = this.view.getActiveElement('list-cv-lamro');
        const listCvTraloi = this.view.getActiveElement('list-cv-traloi');
        const listCvGuicdt = this.view.getActiveElement('list-cv-guicdt');

        if (listCvLamro) {
            listCvLamro.innerHTML = '';
            (activeMeta.cvLamRo || []).forEach(item => addLetterRow('list-cv-lamro', item, isReadOnly));
        }
        if (listCvTraloi) {
            listCvTraloi.innerHTML = '';
            (activeMeta.cvTraLoi || []).forEach(item => addLetterRow('list-cv-traloi', item, isReadOnly));
        }
        if (listCvGuicdt) {
            listCvGuicdt.innerHTML = '';
            (activeMeta.cvGuiCdt || []).forEach(item => addLetterRow('list-cv-guicdt', item, isReadOnly));
        }

        // 4. Identify dynamic table fields
        const isTuVan = gt.linhVuc === 'Tư vấn';
        const hasPhanLo = gt.phanLo === 'Có';

        let caseType = '1G1T_NO_LOT';
        if (is1G2T) {
            if (this.currentDanhGiaTab === 'technical') {
                caseType = isTuVan ? 'TU_VAN' : (hasPhanLo ? '1G2T_WITH_LOT' : '1G2T_NO_LOT');
            } else {
                caseType = hasPhanLo ? '1G2T_TC_WITH_LOT' : '1G2T_TC_NO_LOT';
            }
        } else if (isTuVan) {
            caseType = 'TU_VAN';
        } else if (is1G1T) {
            caseType = hasPhanLo ? '1G1T_WITH_LOT' : '1G1T_NO_LOT';
        }

        const tableTitle = this.view.getActiveElement('danhgiahsdt-table-title');
        if (tableTitle) {
            if (is1G2T || isTuVan) {
                if (this.currentDanhGiaTab === 'technical') {
                    tableTitle.textContent = 'Đánh giá chi tiết các E-HSĐXKT đã nộp';
                } else {
                    tableTitle.textContent = 'Đánh giá chi tiết các E-HSĐXTC đã nộp';
                }
            } else {
                tableTitle.textContent = 'Đánh giá chi tiết các HSDT nộp';
            }
        }

        const isCombinedMethod = gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá';
        const showCombinedScore = isCombinedMethod && !(is1G2T && this.currentDanhGiaTab === 'technical');

        // Render table headers (opening fields + evaluation fields)
        let theadHtml = '';
        if (caseType === 'TU_VAN') {
            theadHtml = `
                <tr>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 10%;">Mã nhà thầu</th>
                    <th style="width: 14%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 10%;">Thời gian thực hiện</th>
                    <th style="width: 8%;">Đánh giá hợp lệ</th>
                    <th style="width: 8%;">Làm rõ tính hợp lệ</th>
                    <th style="width: 8%;">Đánh giá năng lực</th>
                    <th style="width: 8%;">Làm rõ năng lực kinh nghiệm</th>
                    <th style="width: 8%;">Đánh giá kỹ thuật</th>
                    <th style="width: 8%;">Làm rõ kỹ thuật</th>
                    ${showCombinedScore ? '<th style="width: 6%;">Điểm tổng hợp</th>' : ''}
                    <th style="width: 8%;">Kết luận</th>
                </tr>
            `;
        } else if (caseType === '1G2T_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 8%;">Mã nhà thầu</th>
                    <th style="width: 12%;">Tên nhà thầu</th>
                    <th style="width: 8%;">Đảm bảo dự thầu</th>
                    <th style="width: 8%;">Hiệu lực đảm bảo</th>
                    <th style="width: 8%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 8%;">Đánh giá hợp lệ</th>
                    <th style="width: 8%;">Làm rõ tính hợp lệ</th>
                    <th style="width: 8%;">Đánh giá năng lực</th>
                    <th style="width: 8%;">Làm rõ năng lực kinh nghiệm</th>
                    <th style="width: 8%;">Đánh giá kỹ thuật</th>
                    <th style="width: 8%;">Làm rõ kỹ thuật</th>
                    <th style="width: 8%;">Kết luận</th>
                </tr>
            `;
        } else if (caseType === '1G2T_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 5%;">Mã phần lô</th>
                    <th style="width: 5%;">Tên phần lô</th>
                    <th style="width: 6%;">Loại nhà thầu</th>
                    <th style="width: 6%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 7%;">Đảm bảo dự thầu</th>
                    <th style="width: 7%;">Hiệu lực đảm bảo</th>
                    <th style="width: 7%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 7%;">Đánh giá hợp lệ</th>
                    <th style="width: 7%;">Làm rõ hợp lệ</th>
                    <th style="width: 7%;">Đánh giá năng lực</th>
                    <th style="width: 7%;">Làm rõ năng lực</th>
                    <th style="width: 7%;">Đánh giá kỹ thuật</th>
                    <th style="width: 7%;">Làm rõ kỹ thuật</th>
                    <th style="width: 8%;">Kết luận</th>
                </tr>
            `;
        } else if (caseType === '1G2T_TC_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 8%;">Mã nhà thầu</th>
                    <th style="width: 12%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Giá dự thầu</th>
                    <th style="width: 6%;">Tỷ lệ %</th>
                    <th style="width: 10%;">Giá sau giảm</th>
                    <th style="width: 10%;">Hiệu lực E-HSĐXTC</th>
                    <th style="width: 8%;">Làm rõ tài chính</th>
                    ${showCombinedScore ? `
                        <th style="width: 6%;">Đánh giá KT</th>
                        <th style="width: 6%;">Điểm tổng hợp</th>
                    ` : ''}
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
        } else if (caseType === '1G2T_TC_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 6%;">Mã phần lô</th>
                    <th style="width: 6%;">Tên phần lô</th>
                    <th style="width: 6%;">Loại nhà thầu</th>
                    <th style="width: 6%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 9%;">Giá dự thầu</th>
                    <th style="width: 5%;">Tỷ lệ %</th>
                    <th style="width: 9%;">Giá sau giảm</th>
                    <th style="width: 8%;">Hiệu lực E-HSĐXTC</th>
                    <th style="width: 8%;">Làm rõ tài chính</th>
                    ${showCombinedScore ? `
                        <th style="width: 6%;">Đánh giá KT</th>
                        <th style="width: 6%;">Điểm tổng hợp</th>
                    ` : ''}
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
        } else if (caseType === '1G1T_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 5%;">Loại nhà thầu</th>
                    <th style="width: 5%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 8%;">Giá dự thầu</th>
                    <th style="width: 4%;">Tỷ lệ %</th>
                    <th style="width: 8%;">Giá sau giảm</th>
                    <th style="width: 6%;">Hiệu lực E-HSDT</th>
                    <th style="width: 6%;">Giá trị ĐB</th>
                    <th style="width: 6%;">Hiệu lực ĐB</th>
                    <th style="width: 6%;">Thời gian TH</th>
                    <th style="width: 6%;">Đánh giá hợp lệ</th>
                    <th style="width: 6%;">Làm rõ hợp lệ</th>
                    <th style="width: 6%;">Đánh giá năng lực</th>
                    <th style="width: 6%;">Làm rõ năng lực</th>
                    <th style="width: 6%;">Đánh giá kỹ thuật</th>
                    <th style="width: 6%;">Làm rõ kỹ thuật</th>
                    <th style="width: 6%;">Làm rõ tài chính</th>
                    ${isCombinedMethod ? '<th style="width: 6%;">Điểm tổng hợp</th>' : ''}
                    <th style="width: 8%;">Kết luận</th>
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
        } else if (caseType === '1G1T_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 5%;">Mã phần lô</th>
                    <th style="width: 5%;">Tên phần lô</th>
                    <th style="width: 4%;">Loại nhà thầu</th>
                    <th style="width: 6%;">Mã nhà thầu</th>
                    <th style="width: 8%;">Tên nhà thầu</th>
                    <th style="width: 7%;">Giá dự thầu</th>
                    <th style="width: 4%;">Tỷ lệ %</th>
                    <th style="width: 7%;">Giá sau giảm</th>
                    <th style="width: 5%;">Hiệu lực E-HSDT</th>
                    <th style="width: 5%;">Giá trị ĐB</th>
                    <th style="width: 5%;">Hiệu lực ĐB</th>
                    <th style="width: 5%;">Thời gian TH</th>
                    <th style="width: 5%;">Đánh giá hợp lệ</th>
                    <th style="width: 5%;">Làm rõ hợp lệ</th>
                    <th style="width: 5%;">Đánh giá năng lực</th>
                    <th style="width: 5%;">Làm rõ năng lực</th>
                    <th style="width: 5%;">Đánh giá kỹ thuật</th>
                    <th style="width: 5%;">Làm rõ kỹ thuật</th>
                    <th style="width: 5%;">Làm rõ tài chính</th>
                    ${isCombinedMethod ? '<th style="width: 6%;">Điểm tổng hợp</th>' : ''}
                    <th style="width: 8%;">Kết luận</th>
                    <th style="width: 6%;">Xếp hạng</th>
                </tr>
            `;
        }
        thead.innerHTML = theadHtml;

        const updateAllRankings = () => {
            const rows = tbody.querySelectorAll('tr[data-bid-id]');
            const currentBids = [];
            let foundPassedBidder = false;
            let previousAllFailed = true;

            const isNumeric = (val) => {
                if (!val) return false;
                const normalized = val.trim().replace(/,/g, '.');
                return !isNaN(normalized) && isFinite(normalized) && normalized !== '';
            };

            const toggleFailReasons = (tr, conclusionText) => {
                const inpHopLe = tr.querySelector('.mt-dg-hop-le');
                const inpNangLuc = tr.querySelector('.mt-dg-nang-luc');
                const inpKyThuat = tr.querySelector('.mt-dg-ky-thuat');
                
                const valHopLe = inpHopLe ? (inpHopLe.value || inpHopLe.textContent || '').trim() : '';
                const valNangLuc = inpNangLuc ? (inpNangLuc.value || inpNangLuc.textContent || '').trim() : '';
                const valKyThuat = inpKyThuat ? (inpKyThuat.value || inpKyThuat.textContent || '').trim() : '';
                
                const reasonHopLe = tr.querySelector('.mt-reason-fail-hople');
                if (reasonHopLe) {
                    reasonHopLe.style.display = (valHopLe === 'Không đạt') ? 'block' : 'none';
                    if (valHopLe !== 'Không đạt') reasonHopLe.value = '';
                }
                
                const reasonNangLuc = tr.querySelector('.mt-reason-fail-nangluc');
                if (reasonNangLuc) {
                    reasonNangLuc.style.display = (valNangLuc === 'Không đạt') ? 'block' : 'none';
                    if (valNangLuc !== 'Không đạt') reasonNangLuc.value = '';
                }
                
                const reasonKyThuat = tr.querySelector('.mt-reason-fail-kythuat');
                if (reasonKyThuat) {
                    let shouldShowKyThuatFail = false;
                    if (valKyThuat.toLowerCase() === 'không đạt') {
                        shouldShowKyThuatFail = true;
                    } else if (isNumeric(valKyThuat)) {
                        shouldShowKyThuatFail = conclusionText.startsWith('Không đạt');
                    }
                    reasonKyThuat.style.display = shouldShowKyThuatFail ? 'block' : 'none';
                    if (!shouldShowKyThuatFail) reasonKyThuat.value = '';
                }
            };

            rows.forEach(tr => {
                const bidId = tr.getAttribute('data-bid-id');
                const bid = this.model.state.thongtinmothau.find(b => b.id === bidId);
                if (bid) {
                    const inpHopLe = tr.querySelector('.mt-dg-hop-le');
                    const inpNangLuc = tr.querySelector('.mt-dg-nang-luc');
                    const inpKyThuat = tr.querySelector('.mt-dg-ky-thuat');
                    const selectKetLuan = tr.querySelector('.mt-dg-ketluan');

                    // If Quy trình 2, determine if this row should be forced disabled
                    let forceRowDisabled = false;
                    if (!is1G2T && gt.quyTrinhDanhGia === 'quytrinh2') {
                        forceRowDisabled = !previousAllFailed || foundPassedBidder;
                    }

                    if (!isReadOnly && forceRowDisabled) {
                        tr.querySelectorAll('.mt-dg-hop-le, .mt-dg-nang-luc, .mt-dg-ky-thuat, .mt-lam-ro-hop-le, .mt-lam-ro-nang-luc, .mt-lam-ro-ky-thuat, .mt-lam-ro-tai-chinh, .mt-reason-fail-hople, .mt-reason-fail-nangluc, .mt-reason-fail-kythuat').forEach(el => {
                            el.setAttribute('disabled', 'true');
                            el.style.background = 'var(--neutral-soft)';
                            el.style.cursor = 'not-allowed';
                        });
                    } else if (!isReadOnly) {
                        // Re-enable top-level inputs for the active row
                        const inpHopLe = tr.querySelector('.mt-dg-hop-le');
                        const inpLamRoHopLe = tr.querySelector('.mt-lam-ro-hop-le');
                        if (inpHopLe) {
                            inpHopLe.removeAttribute('disabled');
                            inpHopLe.style.background = '';
                            inpHopLe.style.cursor = '';
                        }
                        if (inpLamRoHopLe) {
                            inpLamRoHopLe.removeAttribute('disabled');
                            inpLamRoHopLe.style.background = '';
                            inpLamRoHopLe.style.cursor = '';
                        }
                    }

                    // Update conclusion cell
                    if (!is1G2T && gt.quyTrinhDanhGia === 'quytrinh2' && foundPassedBidder) {
                        this.updateRowConclusion(tr, "Không đánh giá", true);
                    } else {
                        // Pass normal isReadOnly state
                        const selectKetLuan = tr.querySelector('.mt-dg-ketluan');
                        const currentSelectVal = selectKetLuan ? selectKetLuan.value : null;
                        const savedConclusion = isReadOnly ? bid.danhGiaKetLuan : ((!isReadOnly && forceRowDisabled) ? "Chờ đánh giá" : (currentSelectVal || bid.danhGiaKetLuan || null));
                        this.updateRowConclusion(tr, savedConclusion, isReadOnly || forceRowDisabled);
                    }

                     const valHopLe = (inpHopLe?.value || inpHopLe?.textContent || bid.danhGiaHopLe || '').trim();
                     const valNangLuc = (inpNangLuc?.value || inpNangLuc?.textContent || bid.danhGiaNangLuc || '').trim();
                     const valKyThuat = (inpKyThuat?.value || inpKyThuat?.textContent || bid.danhGiaKyThuat || '').trim();

                    let valKetLuan = '';
                    const conclusionCell = tr.querySelector('.mt-ketluan-cell');
                    const conclusionText = conclusionCell ? conclusionCell.textContent.trim() : '';
                    if (selectKetLuan) {
                        valKetLuan = selectKetLuan.value;
                    } else {
                        valKetLuan = conclusionText;
                    }

                    toggleFailReasons(tr, valKetLuan);

                    if (!is1G2T && gt.quyTrinhDanhGia === 'quytrinh2') {
                        if (valKetLuan === 'Đạt' || valKetLuan.startsWith('Đạt')) {
                            foundPassedBidder = true;
                        }
                        const isThisFailed = valKetLuan.startsWith('Không đạt');
                        if (!isThisFailed) {
                            previousAllFailed = false;
                        }
                    }

                    const inpGiaDuThau = tr.querySelector('.mt-gia-du-thau');
                    const inpTyLeGiam = tr.querySelector('.mt-ty-le-giam-gia');

                    const valGiaDuThau = inpGiaDuThau ? this.model.parseVND(inpGiaDuThau.value) : (bid.giaDuThau || 0);
                    const valTyLeGiam = inpTyLeGiam ? parseFloat(inpTyLeGiam.value.replace(/,/g, '.')) || 0 : (bid.tyLeGiamGia || 0);
                    const valGiaSauGiam = valGiaDuThau * (1 - valTyLeGiam / 100);

                    currentBids.push({
                        ...bid,
                        danhGiaHopLe: valHopLe,
                        danhGiaNangLuc: valNangLuc,
                        danhGiaKyThuat: valKyThuat,
                        danhGiaKetLuan: valKetLuan,
                        giaDuThau: valGiaDuThau,
                        tyLeGiamGia: valTyLeGiam,
                        giaSauGiamGia: valGiaSauGiam
                    });
                }
            });

            const { rankings, scores } = this.calculateRankings(gt, currentBids);

            rows.forEach(tr => {
                const bidId = tr.getAttribute('data-bid-id');
                const bid = this.model.state.thongtinmothau.find(b => b.id === bidId);
                const rank = rankings[bidId];
                const score = scores[bidId];
                const rankText = rank ? `Xếp hạng ${rank}` : '';

                const inpDgTaiChinh = tr.querySelector('.mt-dg-tai-chinh');
                if (inpDgTaiChinh) {
                    inpDgTaiChinh.value = rankText;
                }

                const elXepHang = tr.querySelector('.mt-dg-xep-hang');
                if (elXepHang) {
                    const conclusionCell = tr.querySelector('.mt-ketluan-cell');
                    const conclusionText = conclusionCell ? conclusionCell.textContent.trim() : '';
                    const isFailed = conclusionText.includes('Không đạt') || (bid.danhGiaKetLuan && bid.danhGiaKetLuan.includes('Không đạt'));
                    elXepHang.textContent = rank ? `Xếp hạng ${rank}` : (isFailed ? 'Không xếp hạng' : '--');
                }

                const elCombinedScore = tr.querySelector('.mt-combined-score');
                if (elCombinedScore) {
                    elCombinedScore.textContent = score !== undefined && score !== null && !isNaN(score) && score > 0 ? score.toFixed(2) : '--';
                }

                const cellConclusion = tr.querySelector('.mt-ketluan-cell');
                if (cellConclusion) {
                    const badge = cellConclusion.querySelector('.badge');
                    if (badge) {
                        const baseText = badge.textContent.trim();
                        if (baseText.startsWith('Đạt')) {
                            badge.textContent = 'Đạt';
                            badge.className = 'badge badge-success';
                        }
                    }
                }
            });
        };

        // Render bidder rows
        tbody.innerHTML = '';
        let bids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId));
        if (is1G2T && this.currentDanhGiaTab === 'financial') {
            bids = bids.filter(b => {
                const kl = String(b.danhGiaKetLuan || '').trim().toLowerCase();
                if (kl) {
                    return kl === 'đạt' || kl.startsWith('đạt');
                }
                const hl = String(b.danhGiaHopLe || '').trim().toLowerCase();
                const nl = String(b.danhGiaNangLuc || '').trim().toLowerCase();
                const kt = String(b.danhGiaKyThuat || '').trim().toLowerCase();
                return hl === 'đạt' && nl === 'đạt' && kt !== 'không đạt' && kt !== '';
            });
        }

        // Sort bids: if Quy trình 2 for 1G1T, sort by evaluated price ascending. Otherwise sort alphabetically by Lot Code
        if (!is1G2T && gt.quyTrinhDanhGia === 'quytrinh2') {
            bids.sort((a, b) => {
                const priceA = parseFloat(a.giaSauGiamGia || a.giaDuThau || 0);
                const priceB = parseFloat(b.giaSauGiamGia || b.giaDuThau || 0);
                return priceA - priceB;
            });
        } else {
            bids.sort((a, b) => {
                const codeA = String(a.maPhanLo || '').toLowerCase();
                const codeB = String(b.maPhanLo || '').toLowerCase();
                return codeA.localeCompare(codeB, 'vi', { numeric: true });
            });
        }

        if (bids.length === 0) {
            tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; padding: 24px; color: var(--text-muted);"><small>Không tìm thấy danh sách nhà thầu mở thầu. Vui lòng nhập thông tin mở thầu trước.</small></td></tr>`;
        } else {
            let previousAllFailed = true;
            bids.forEach(bid => {
                const tr = document.createElement('tr');
                tr.setAttribute('data-bid-id', bid.id);

                let maNhaThauHienThi = bid.maNhaThau || bid.maDinhDanh || '--';
                // Với liên danh: ưu tiên tên liên danh đã lưu trong bid, không ghi đè bằng tên CSDL
                let tenNhaThauHienThi = bid.tenNhaThau || '--';
                const isJVBid = bid.loaiNhaThau === 'Liên danh';
                const latestList = this.model.getLatestNhaThau();
                let matchedNt = null;
                if (bid.nhaThauId) {
                    matchedNt = latestList.find(n => n.id === bid.nhaThauId || n.rootId === bid.nhaThauId);
                }
                if (!matchedNt && maNhaThauHienThi !== '--') {
                    matchedNt = latestList.find(n => n.maNhaThau && n.maNhaThau.trim().toLowerCase() === maNhaThauHienThi.trim().toLowerCase());
                }

                if (matchedNt) {
                    maNhaThauHienThi = matchedNt.maNhaThau || maNhaThauHienThi;
                    if (!bid.tenNhaThau) {
                        tenNhaThauHienThi = matchedNt.tenNhaThau;
                    }
                }

                // Render JV details trigger link if JV
                let contractorDisplayHtml = '';
                if (isJVBid) {
                    const jvKey = `${gtId}_eval_bidder_${bid.id}`;
                    window._jvDataMap = window._jvDataMap || {};
                    window._jvDataMap[jvKey] = {
                        members: bid.thanhVienLienDanh || [],
                        leadName: tenNhaThauHienThi,
                        leadCode: maNhaThauHienThi
                    };
                    contractorDisplayHtml = `<a href="#" class="mt-jv-view-link text-success fw-bold link-hover" data-jv-key="${jvKey}" title="Xem thành viên liên danh">👥 ${tenNhaThauHienThi}</a>`;
                } else {
                    contractorDisplayHtml = `<span class="fw-bold">${tenNhaThauHienThi}</span>`;
                }

                let cellHtml = '';
                if (gt.phanLo === 'Có') {
                    cellHtml += `
                        <td>${bid.maPhanLo || '--'}</td>
                        <td>${bid.tenPhanLo || '--'}</td>
                    `;
                }

                cellHtml += `
                    <td>${bid.loaiNhaThau || 'Độc lập'}</td>
                    <td>${maNhaThauHienThi}</td>
                    <td>${contractorDisplayHtml}</td>
                `;

                // If Financial evaluation stage of 1G2T, show prices and ratings
                if (is1G2T && this.currentDanhGiaTab === 'financial') {
                    const valGiaDuThau = bid.giaDuThau ? this.model.formatVND(bid.giaDuThau) : '';
                    const valTyLeGiam = bid.tyLeGiamGia !== undefined ? this.model.formatVND(bid.tyLeGiamGia) : '0';
                    const valGiaSauGiam = bid.giaSauGiamGia ? this.model.formatVND(bid.giaSauGiamGia) : '';
                    const valHieuLucHsdt = bid.hieuLucHsdt || '';
                    const valLamRoTaiChinh = bid.lamRoTaiChinh || '';
                    const valTaiChinh = bid.danhGiaTaiChinh || '';

                    if (isReadOnly) {
                        cellHtml += `
                            <td><span>${valGiaDuThau || '--'}</span></td>
                            <td style="text-align:right;"><span>${valTyLeGiam}</span></td>
                            <td><span>${valGiaSauGiam || '--'}</span></td>
                            <td><span>${valHieuLucHsdt ? valHieuLucHsdt + ' ngày' : '--'}</span></td>
                            <td><span>${valLamRoTaiChinh || '--'}</span></td>
                            ${showCombinedScore ? `
                                <td><span>${bid.danhGiaKyThuat || '--'}</span></td>
                                <td><span class="mt-combined-score" style="font-weight:700;">--</span></td>
                            ` : ''}
                            <td><span style="font-weight:600;">${valTaiChinh || '--'}</span></td>
                        `;
                    } else {
                        cellHtml += `
                            <td><input type="text" class="form-control mt-gia-du-thau" value="${valGiaDuThau}" readonly placeholder="Ví dụ: 1.000.000.000" style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${valTyLeGiam}" readonly placeholder="0" style="background:#f1f5f9; text-align:right; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-gia-sau-giam-gia" value="${valGiaSauGiam}" readonly placeholder="Tự tính..." style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${valHieuLucHsdt ? valHieuLucHsdt + ' ngày' : ''}" readonly placeholder="Ví dụ: 90 ngày" style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-lam-ro-tai-chinh" value="${valLamRoTaiChinh}" placeholder="Nhập làm rõ tài chính..." style="padding: 4px 6px; font-size:0.8rem;"></td>
                            ${showCombinedScore ? `
                                <td><span>${bid.danhGiaKyThuat || '--'}</span></td>
                                <td><span class="mt-combined-score" style="font-weight:700;">--</span></td>
                            ` : ''}
                            <td><input type="text" class="form-control mt-dg-tai-chinh" value="${valTaiChinh}" placeholder="Xếp hạng..." style="padding: 4px 6px; font-size:0.8rem;"></td>
                        `;
                    }
                } else {
                    // Technical or Unified Evaluation view (E-HSĐXKT or 1G1T)
                    const valHopLe = bid.danhGiaHopLe || '';
                    const valLamRoHopLe = bid.lamRoHopLe || '';
                    const valNangLuc = bid.danhGiaNangLuc || '';
                    const valLamRoNangLuc = bid.lamRoNangLuc || '';
                    const valKyThuat = bid.danhGiaKyThuat || '';
                    const valLamRoKyThuat = bid.lamRoKyThuat || '';
                    const valLamRoTaiChinh = bid.lamRoTaiChinh || '';
                    const valKetLuan = bid.danhGiaKetLuan || '';
                    const isTechnical = caseType === 'TU_VAN' || caseType === '1G2T_NO_LOT' || caseType === '1G2T_WITH_LOT';

                    const valHieuLucHsdtRaw = bid.hieuLucHsdxt || bid.hieuLucHsdt || '';
                    const valHieuLucHsdtDisplay = valHieuLucHsdtRaw ? (String(valHieuLucHsdtRaw).includes('ngày') ? valHieuLucHsdtRaw : valHieuLucHsdtRaw + ' ngày') : '--';
                    const valHieuLucHsdtInput = valHieuLucHsdtRaw ? (String(valHieuLucHsdtRaw).includes('ngày') ? valHieuLucHsdtRaw : valHieuLucHsdtRaw + ' ngày') : '';

                    if (isReadOnly) {
                        if (!isTechnical) {
                            cellHtml += `
                                <td><span>${bid.giaDuThau ? this.model.formatVND(bid.giaDuThau) : '--'}</span></td>
                                <td style="text-align:right;"><span>${bid.tyLeGiamGia !== undefined ? this.model.formatVND(bid.tyLeGiamGia) : '0'}</span></td>
                                <td><span>${bid.giaSauGiamGia ? this.model.formatVND(bid.giaSauGiamGia) : '--'}</span></td>
                                <td><span>${valHieuLucHsdtDisplay}</span></td>
                                <td><span>${bid.giaTriDamBao ? this.model.formatVND(bid.giaTriDamBao) : '--'}</span></td>
                                <td><span>${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + ' ngày' : '--'}</span></td>
                                <td><span>${bid.thoiGianThucHien || gt.thoiGianThucHien || '--'}</span></td>
                            `;
                        } else {
                            if (caseType === 'TU_VAN') {
                                cellHtml += `
                                    <td><span>${valHieuLucHsdtDisplay}</span></td>
                                    <td><span>${bid.thoiGianThucHien || gt.thoiGianThucHien || '--'}</span></td>
                                `;
                            } else if (caseType === '1G2T_NO_LOT' || caseType === '1G2T_WITH_LOT') {
                                cellHtml += `
                                    <td><span>${bid.giaTriDamBao ? this.model.formatVND(bid.giaTriDamBao) : '--'}</span></td>
                                    <td><span>${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + ' ngày' : '--'}</span></td>
                                    <td><span>${valHieuLucHsdtDisplay}</span></td>
                                `;
                            }
                        }
                        cellHtml += `
                            <td>
                                <span class="mt-dg-hop-le" style="font-weight:600;">${valHopLe || '--'}</span>
                                ${bid.nguyenNhanKhongDatHopLe ? `<div style="color: #dc2626; font-size: 0.72rem; margin-top: 2px;">Lý do: ${bid.nguyenNhanKhongDatHopLe}</div>` : ''}
                            </td>
                            <td><span>${valLamRoHopLe || '--'}</span></td>
                            <td>
                                <span class="mt-dg-nang-luc" style="font-weight:600;">${valNangLuc || '--'}</span>
                                ${bid.nguyenNhanKhongDatNangLuc ? `<div style="color: #dc2626; font-size: 0.72rem; margin-top: 2px;">Lý do: ${bid.nguyenNhanKhongDatNangLuc}</div>` : ''}
                            </td>
                            <td><span>${valLamRoNangLuc || '--'}</span></td>
                            <td>
                                <span class="mt-dg-ky-thuat" style="font-weight:600;">${valKyThuat || '--'}</span>
                                ${bid.nguyenNhanKhongDatKyThuat ? `<div style="color: #dc2626; font-size: 0.72rem; margin-top: 2px;">Lý do: ${bid.nguyenNhanKhongDatKyThuat}</div>` : ''}
                            </td>
                            <td><span>${valLamRoKyThuat || '--'}</span></td>
                            ${isTechnical ? '' : `<td><span>${valLamRoTaiChinh || '--'}</span></td>`}
                            ${showCombinedScore ? `<td><span class="mt-combined-score" style="font-weight:700;">--</span></td>` : ''}
                            <td class="mt-ketluan-cell" style="text-align: center; vertical-align: middle;"></td>
                            ${isTechnical ? '' : `<td><span class="mt-dg-xep-hang" style="font-weight:600;">${bid.danhGiaTaiChinh || '--'}</span></td>`}
                        `;
                    } else {
                        const forceRowDisabled = !is1G2T && gt.quyTrinhDanhGia === 'quytrinh2' && !previousAllFailed;
                        if (!isTechnical) {
                            cellHtml += `
                                <td><input type="text" class="form-control" value="${bid.giaDuThau ? this.model.formatVND(bid.giaDuThau) : ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.tyLeGiamGia !== undefined ? this.model.formatVND(bid.tyLeGiamGia) : '0'}" readonly style="background:#f1f5f9; text-align:right; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.giaSauGiamGia ? this.model.formatVND(bid.giaSauGiamGia) : ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.hieuLucHsdt ? bid.hieuLucHsdt + ' ngày' : ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.giaTriDamBao ? this.model.formatVND(bid.giaTriDamBao) : ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + ' ngày' : ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                <td><input type="text" class="form-control" value="${bid.thoiGianThucHien || gt.thoiGianThucHien || ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            `;
                        } else {
                            if (caseType === 'TU_VAN') {
                                cellHtml += `
                                    <td><input type="text" class="form-control" value="${valHieuLucHsdtInput}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                    <td><input type="text" class="form-control" value="${bid.thoiGianThucHien || gt.thoiGianThucHien || ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                `;
                            } else if (caseType === '1G2T_NO_LOT' || caseType === '1G2T_WITH_LOT') {
                                cellHtml += `
                                    <td><input type="text" class="form-control" value="${bid.giaTriDamBao ? this.model.formatVND(bid.giaTriDamBao) : ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                    <td><input type="text" class="form-control" value="${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + ' ngày' : ''}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                    <td><input type="text" class="form-control" value="${valHieuLucHsdtInput}" readonly style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                                `;
                            }
                        }
                        cellHtml += `
                            <td>
                                <select class="form-control mt-dg-hop-le" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
                                    <option value="Đạt" ${valHopLe === 'Đạt' || valHopLe === '' ? 'selected' : ''}>Đạt</option>
                                    <option value="Không đạt" ${valHopLe === 'Không đạt' ? 'selected' : ''}>Không đạt</option>
                                </select>
                                <input type="text" class="form-control mt-reason-fail-hople" value="${bid.nguyenNhanKhongDatHopLe || ''}" placeholder="Lý do không đạt hợp lệ..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${valHopLe === 'Không đạt' ? 'block' : 'none'};" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-hop-le" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''} value="${valLamRoHopLe}" placeholder="${forceRowDisabled ? 'Chờ đánh giá hạng trên...' : 'Nhập làm rõ hợp lệ...'}"></td>
                            <td>
                                <select class="form-control mt-dg-nang-luc" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
                                    <option value="Đạt" ${valNangLuc === 'Đạt' || valNangLuc === '' ? 'selected' : ''}>Đạt</option>
                                    <option value="Không đạt" ${valNangLuc === 'Không đạt' ? 'selected' : ''}>Không đạt</option>
                                </select>
                                <input type="text" class="form-control mt-reason-fail-nangluc" value="${bid.nguyenNhanKhongDatNangLuc || ''}" placeholder="Lý do không đạt năng lực..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${valNangLuc === 'Không đạt' ? 'block' : 'none'};" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-nang-luc" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''} value="${valLamRoNangLuc}" placeholder="${forceRowDisabled ? 'Chờ đánh giá hạng trên...' : 'Nhập làm rõ năng lực...'}"></td>
                            <td>
                                <input type="text" class="form-control mt-dg-ky-thuat" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''} value="${valKyThuat}" placeholder="${forceRowDisabled ? 'Chờ đánh giá hạng trên...' : 'Điểm hoặc Đạt...'}">
                                <input type="text" class="form-control mt-reason-fail-kythuat" value="${bid.nguyenNhanKhongDatKyThuat || ''}" placeholder="Lý do không đạt kỹ thuật..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: none;" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''}>
                            </td>
                            <td><input type="text" class="form-control mt-lam-ro-ky-thuat" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''} value="${valLamRoKyThuat}" placeholder="${forceRowDisabled ? 'Chờ đánh giá hạng trên...' : 'Nhập làm rõ kỹ thuật...'}"></td>
                            ${isTechnical ? '' : `<td><input type="text" class="form-control mt-lam-ro-tai-chinh" ${forceRowDisabled ? 'disabled style="background:var(--neutral-soft); cursor:not-allowed;"' : ''} value="${valLamRoTaiChinh}" placeholder="${forceRowDisabled ? 'Chờ đánh giá hạng trên...' : 'Nhập làm rõ tài chính...'}"></td>`}
                            ${showCombinedScore ? `<td><span class="mt-combined-score" style="font-weight:700;">--</span></td>` : ''}
                            <td class="mt-ketluan-cell" style="text-align: center; vertical-align: middle;"></td>
                            ${isTechnical ? '' : `<td><span class="mt-dg-xep-hang" style="font-weight:600;">${bid.danhGiaTaiChinh || '--'}</span></td>`}
                        `;
                    }
                }

                tr.innerHTML = cellHtml;
                this.updateRowConclusion(tr, bid.danhGiaKetLuan, isReadOnly);

                // For Quy trình 2: Check if this row failed. If not failed (either pending or Đạt), the next rows must be disabled.
                if (!isReadOnly && !is1G2T && gt.quyTrinhDanhGia === 'quytrinh2') {
                    const conclusionCell = tr.querySelector('.mt-ketluan-cell');
                    const conclusionText = conclusionCell ? conclusionCell.textContent.trim() : '';
                    const isThisFailed = conclusionText.startsWith('Không đạt');
                    if (!isThisFailed) {
                        previousAllFailed = false;
                    }
                }

                // Add real-time event listeners to input elements in the row
                if (!isReadOnly) {
                    const inputs = tr.querySelectorAll('.mt-dg-hop-le, .mt-dg-nang-luc, .mt-dg-ky-thuat');
                    inputs.forEach(input => {
                        const triggerUpdate = () => {
                            updateAllRankings();
                        };
                        input.addEventListener('input', triggerUpdate);
                        input.addEventListener('change', triggerUpdate);
                    });
                    tr.addEventListener('change', (e) => {
                        if (e.target && e.target.classList.contains('mt-dg-ketluan')) {
                            updateAllRankings();
                        }
                    });
                }

                // Auto-calculation on financial input fields
                if (!isReadOnly && (caseType === '1G2T_TC_NO_LOT' || caseType === '1G2T_TC_WITH_LOT')) {
                    const inpGiaDuThau = tr.querySelector('.mt-gia-du-thau');
                    const inpTyLeGiam = tr.querySelector('.mt-ty-le-giam-gia');
                    const inpGiaTriDb = tr.querySelector('.mt-gia-tri-dam-bao');

                    const reCalc = () => {
                        const baseVal = this.model.parseVND(inpGiaDuThau?.value || '');
                        const tyLeValRaw = inpTyLeGiam?.value || '0';
                        const tyLeVal = parseFloat(tyLeValRaw.replace(/,/g, '.')) || 0;
                        const finalVal = baseVal * (1 - tyLeVal / 100);
                        const inpGiaSauGiam = tr.querySelector('.mt-gia-sau-giam-gia');
                        if (inpGiaSauGiam) {
                            inpGiaSauGiam.value = this.model.formatVND(finalVal) || '';
                        }
                        updateAllRankings();
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

                    if (inpGiaDuThau) {
                        setupAutoFormatOnInput(inpGiaDuThau);
                        inpGiaDuThau.addEventListener('input', reCalc);
                    }
                    if (inpTyLeGiam) {
                        inpTyLeGiam.addEventListener('input', reCalc);
                    }
                    if (inpGiaTriDb) {
                        setupAutoFormatOnInput(inpGiaTriDb);
                    }
                }

                // Bind focus/blur listeners for ' ngày' suffix on validity inputs in evaluation table
                tr.querySelectorAll('.mt-hieu-luc-hsdt, .mt-hieu-luc-bao-dam-ngay').forEach(input => {
                    input.addEventListener('focus', () => {
                        let val = input.value.trim();
                        if (val) {
                            const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
                            if (!isNaN(num)) input.value = num;
                        }
                    });
                    input.addEventListener('blur', () => {
                        let val = input.value.trim();
                        if (val) {
                            const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
                            if (!isNaN(num)) {
                                input.value = num + ' ngày';
                            }
                        }
                    });
                });

                // Bind read-only JV link click
                const jvViewLink = tr.querySelector('.mt-jv-view-link');
                if (jvViewLink) {
                    jvViewLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        const subMembers = (bid.thanhVienLienDanh || []).filter(m => m.vaiTro !== "Đứng đầu liên danh" && m.maSoThue !== bid.maNhaThau);
                        const leadM = (bid.thanhVienLienDanh || []).find(m => m.vaiTro === "Đứng đầu liên danh") || { tenNhaThau: bid.tenNhaThau, maSoThue: bid.maNhaThau };
                        window.openMoThauJVViewModal(subMembers, leadM.tenNhaThau, leadM.maSoThue);
                    });
                }

                tbody.appendChild(tr);
            });
            updateAllRankings();
        }
        lucide.createIcons();
    };

    select.onchange = handlePackageSelection;
    handlePackageSelection();
    this.setupExcelImportEvents();

    // Initialize flatpickr on static date input
    flatpickr(this.view.getActiveElement('danhgiahsdt-ngay-baocao'), {
        dateFormat: "d/m/Y",
        locale: "vn",
        allowInput: true
    });
}

export function updateRowConclusion(tr, savedKetLuan = null, isReadOnly = false) {
    const cell = tr.querySelector('.mt-ketluan-cell');
    if (!cell) return;

    const inpHopLe = tr.querySelector('.mt-dg-hop-le');
    const inpNangLuc = tr.querySelector('.mt-dg-nang-luc');
    const inpKyThuat = tr.querySelector('.mt-dg-ky-thuat');

    const valHopLe = (inpHopLe?.value || inpHopLe?.textContent || '').trim();
    const valNangLuc = (inpNangLuc?.value || inpNangLuc?.textContent || '').trim();
    const valKyThuat = (inpKyThuat?.value || inpKyThuat?.textContent || '').trim();

    if (!isReadOnly) {
        if (inpNangLuc) {
            if (valHopLe.toLowerCase() === 'đạt') {
                inpNangLuc.removeAttribute('disabled');
                inpNangLuc.style.background = '';
                inpNangLuc.style.cursor = 'auto';
            } else {
                inpNangLuc.setAttribute('disabled', 'true');
                inpNangLuc.style.background = 'var(--neutral-soft)';
                inpNangLuc.style.cursor = 'not-allowed';
                inpNangLuc.value = '';
            }
        }
        if (inpKyThuat) {
            if (valHopLe.toLowerCase() === 'đạt' && valNangLuc.toLowerCase() === 'đạt') {
                inpKyThuat.removeAttribute('disabled');
                inpKyThuat.style.background = '';
                inpKyThuat.style.cursor = 'auto';
            } else {
                inpKyThuat.setAttribute('disabled', 'true');
                inpKyThuat.style.background = 'var(--neutral-soft)';
                inpKyThuat.style.cursor = 'not-allowed';
                inpKyThuat.value = '';
            }
        }
    }

    const valHopLeFinal = (inpHopLe?.value || inpHopLe?.textContent || '').trim();
    const valNangLucFinal = (inpNangLuc?.value || inpNangLuc?.textContent || '').trim();
    const valKyThuatFinal = (inpKyThuat?.value || inpKyThuat?.textContent || '').trim();

    const isNumeric = (val) => {
        if (!val) return false;
        const normalized = val.trim().replace(/,/g, '.');
        return !isNaN(normalized) && isFinite(normalized) && normalized !== '';
    };

    let conclusion = '';
    let status = 'pending'; // 'pending', 'fixed_fail', 'fixed_pass', 'user_select'

    if (!valHopLeFinal) {
        conclusion = '';
        status = 'pending';
    } else if (valHopLeFinal.toLowerCase() !== 'đạt') {
        conclusion = 'Không đạt yêu cầu về tính hợp lệ';
        status = 'fixed_fail';
    } else if (!valNangLucFinal) {
        conclusion = '';
        status = 'pending';
    } else if (valNangLucFinal.toLowerCase() !== 'đạt') {
        conclusion = 'Không đạt yêu cầu về năng lực, kinh nghiệm';
        status = 'fixed_fail';
    } else {
        // Hợp lệ and Năng lực are 'Đạt'
        if (!valKyThuatFinal) {
            conclusion = '';
            status = 'pending';
        } else if (valKyThuatFinal.toLowerCase() === 'không đạt') {
            conclusion = 'Không đạt yêu cầu kỹ thuật';
            status = 'fixed_fail';
        } else if (valKyThuatFinal.toLowerCase() === 'đạt') {
            conclusion = 'Đạt';
            status = 'fixed_pass';
        } else if (isNumeric(valKyThuatFinal)) {
            status = 'user_select';
            conclusion = savedKetLuan || '';
        } else {
            // Treat non-empty other string as user decide or check
            status = 'user_select';
            conclusion = savedKetLuan || '';
        }
    }

    if (isReadOnly) {
        const finalConclusion = savedKetLuan || conclusion;
        if (finalConclusion === 'Đạt' || finalConclusion === 'Đạt (Xếp hạng 1)' || finalConclusion.startsWith('Đạt')) {
            cell.innerHTML = `<span class="badge badge-success" style="font-weight:700;">Đạt</span>`;
        } else if (finalConclusion && finalConclusion.startsWith('Không đạt')) {
            cell.innerHTML = `<span class="badge badge-danger" style="font-weight:700; background-color:rgba(239,68,68,0.08); color:#dc2626; border:1px solid rgba(239,68,68,0.25);">${finalConclusion}</span>`;
        } else {
            cell.innerHTML = `<span>${finalConclusion || '--'}</span>`;
        }
    } else {
        if (status === 'fixed_pass') {
            cell.innerHTML = `<span class="badge badge-success" style="font-weight:700; padding:6px 12px; border-radius:4px; display:inline-block;">Đạt</span>`;
        } else if (status === 'fixed_fail') {
            cell.innerHTML = `<span class="badge badge-danger" style="font-weight:700; padding:6px 12px; border-radius:4px; display:inline-block; background-color:rgba(239,68,68,0.08); color:#dc2626; border:1px solid rgba(239,68,68,0.25);">${conclusion}</span>`;
        } else if (status === 'user_select') {
            // Dropdown to let user select
            cell.innerHTML = `
                <select class="form-control mt-dg-ketluan" style="padding: 4px 6px; font-size:0.8rem; font-weight:600; border-color:var(--primary); width: 100%;">
                    <option value="">-- Chọn --</option>
                    <option value="Đạt" ${conclusion === 'Đạt' ? 'selected' : ''}>Đạt</option>
                    <option value="Không đạt" ${conclusion === 'Không đạt' ? 'selected' : ''}>Không đạt</option>
                </select>
            `;
        } else {
            cell.innerHTML = `<span style="color:var(--text-muted); font-style:italic;">Chờ đánh giá</span>`;
        }
    }
}

export async function saveDanhGiaHsdt() {
    const select = this.view.getActiveElement('danhgiahsdt-goithau-select');
    if (!select) return;
    const gtId = select.value;
    if (!gtId) return;

    const gt = this.model.state.goithau.find(g => g.id === gtId);
    if (!gt) return;

    const inpSo = this.view.getActiveElement('danhgiahsdt-so-baocao');
    const inpNgay = this.view.getActiveElement('danhgiahsdt-ngay-baocao');
    const soBaoCao = inpSo?.value.trim() || '';
    const ngayBaoCaoRaw = inpNgay?.value.trim() || '';
    const ngayBaoCao = this.model.convertDMYToYMD(ngayBaoCaoRaw);

    let hasError = false;
    const errorInputs = [];
    if (!soBaoCao) {
        hasError = true;
        if (inpSo) {
            errorInputs.push(inpSo);
            inpSo.closest('.form-group')?.classList.add('invalid');
            const clearInvalid = () => {
                inpSo.closest('.form-group')?.classList.remove('invalid');
                inpSo.removeEventListener('input', clearInvalid);
            };
            inpSo.addEventListener('input', clearInvalid);
        }
    }
    if (!ngayBaoCaoRaw) {
        hasError = true;
        if (inpNgay) {
            errorInputs.push(inpNgay);
            inpNgay.closest('.form-group')?.classList.add('invalid');
            const clearInvalid = () => {
                inpNgay.closest('.form-group')?.classList.remove('invalid');
                inpNgay.removeEventListener('change', clearInvalid);
            };
            inpNgay.addEventListener('change', clearInvalid);
        }
    }

    if (hasError) {
        if (errorInputs.length > 0) {
            const first = errorInputs[0];
            first.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            setTimeout(() => first.focus({ preventScroll: true }), 300);
        }
        return;
    }

    // Gather letter rows
    const collectLetters = (containerId) => {
        const list = [];
        const container = this.view.getActiveElement(containerId);
        if (!container) return list;
        container.querySelectorAll('.letter-row').forEach(row => {
            const soCv = row.querySelector('.letter-so-cv')?.value.trim() || '';
            const ngayCvRaw = row.querySelector('.letter-ngay-cv')?.value.trim() || '';
            const ngayCv = this.model.convertDMYToYMD(ngayCvRaw);
            if (soCv && ngayCv) {
                list.push({ soCv, ngayCv });
            }
        });
        return list;
    };

    const cvLamRo = collectLetters('list-cv-lamro');
    const cvTraLoi = collectLetters('list-cv-traloi');
    const cvGuiCdt = collectLetters('list-cv-guicdt');

    const quyTrinhContainer = this.view.getActiveElement('danhgiahsdt-quytrinh-container');
    if (quyTrinhContainer && quyTrinhContainer.style.display !== 'none') {
        const radio2 = quyTrinhContainer.querySelector('input[value="quytrinh2"]');
        if (radio2) {
            gt.quyTrinhDanhGia = radio2.checked ? 'quytrinh2' : 'quytrinh1';
        }
    }

    const activeBlock = {
        soBaoCao,
        ngayBaoCao,
        cvLamRo,
        cvTraLoi,
        cvGuiCdt,
        quyTrinhDanhGia: gt.quyTrinhDanhGia || 'quytrinh1',
        saved: true
    };

    const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
    if (is1G2T) {
        let currentMetadata = { is1G2T: true, technical: { saved: false }, financial: { saved: false } };
        if (gt.danhGiaHsdtMetadata) {
            try {
                const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
                if (parsed.is1G2T) {
                    currentMetadata = parsed;
                }
            } catch (e) {
                console.error("Error parsing existing metadata:", e);
            }
        }

        if (this.currentDanhGiaTab === 'technical') {
            currentMetadata.technical = {
                ...currentMetadata.technical,
                ...activeBlock
            };
        } else {
            currentMetadata.financial = {
                ...currentMetadata.financial,
                ...activeBlock
            };
        }
        gt.danhGiaHsdtMetadata = JSON.stringify(currentMetadata);
    } else {
        gt.danhGiaHsdtMetadata = JSON.stringify(activeBlock);
    }

    this.model.persistData('goithau');

    // Update bidder evaluation records
    const rows = this.view.getActiveElement('danhgiahsdt-table-tbody').querySelectorAll('tr');

    // First, let's collect the updated values in a temporary array to compute correct final rankings
    const updatedBidsList = [];
    rows.forEach(tr => {
        const bidId = tr.getAttribute('data-bid-id');
        const bid = this.model.state.thongtinmothau.find(b => b.id === bidId);
        if (bid) {
            let giaDuThau = bid.giaDuThau;
            let tyLeGiamGia = bid.tyLeGiamGia;
            let giaSauGiamGia = bid.giaSauGiamGia;
            let danhGiaHopLe = bid.danhGiaHopLe;
            let danhGiaNangLuc = bid.danhGiaNangLuc;
            let danhGiaKyThuat = bid.danhGiaKyThuat;
            let danhGiaKetLuan = bid.danhGiaKetLuan;

            if (is1G2T && this.currentDanhGiaTab === 'financial') {
                giaDuThau = this.model.parseVND(tr.querySelector('.mt-gia-du-thau')?.value || '');
                const tyLeRaw = tr.querySelector('.mt-ty-le-giam-gia')?.value || '0';
                tyLeGiamGia = parseFloat(tyLeRaw.replace(/,/g, '.')) || 0;
                giaSauGiamGia = this.model.parseVND(tr.querySelector('.mt-gia-sau-giam-gia')?.value || '');
            } else {
                danhGiaHopLe = tr.querySelector('.mt-dg-hop-le')?.value.trim() || '';
                danhGiaNangLuc = tr.querySelector('.mt-dg-nang-luc')?.value.trim() || '';
                danhGiaKyThuat = tr.querySelector('.mt-dg-ky-thuat')?.value.trim() || '';

                const selectKetLuan = tr.querySelector('.mt-dg-ketluan');
                if (selectKetLuan) {
                    danhGiaKetLuan = selectKetLuan.value;
                } else {
                    const cell = tr.querySelector('.mt-ketluan-cell');
                    danhGiaKetLuan = cell ? cell.textContent.trim() : '';
                }
            }

            const nguyenNhanKhongDatHopLe = tr.querySelector('.mt-reason-fail-hople')?.value.trim() || '';
            const nguyenNhanKhongDatNangLuc = tr.querySelector('.mt-reason-fail-nangluc')?.value.trim() || '';
            const nguyenNhanKhongDatKyThuat = tr.querySelector('.mt-reason-fail-kythuat')?.value.trim() || '';

            updatedBidsList.push({
                ...bid,
                giaDuThau,
                tyLeGiamGia,
                giaSauGiamGia,
                danhGiaHopLe,
                danhGiaNangLuc,
                danhGiaKyThuat,
                danhGiaKetLuan,
                nguyenNhanKhongDatHopLe,
                nguyenNhanKhongDatNangLuc,
                nguyenNhanKhongDatKyThuat
            });
        }
    });

    const { rankings } = this.calculateRankings(gt, updatedBidsList);

    rows.forEach(tr => {
        const bidId = tr.getAttribute('data-bid-id');
        if (!bidId) return;
        const bid = this.model.state.thongtinmothau.find(b => b.id === bidId);
        if (bid) {
            const finalRank = rankings[bid.id];
            if (is1G2T && this.currentDanhGiaTab === 'financial') {
                // Save Financial ratings & parameters
                bid.giaDuThau = this.model.parseVND(tr.querySelector('.mt-gia-du-thau')?.value || '');
                const tyLeRaw = tr.querySelector('.mt-ty-le-giam-gia')?.value || '0';
                bid.tyLeGiamGia = parseFloat(tyLeRaw.replace(/,/g, '.')) || 0;
                bid.giaSauGiamGia = this.model.parseVND(tr.querySelector('.mt-gia-sau-giam-gia')?.value || '');
                bid.hieuLucHsdt = parseInt(tr.querySelector('.mt-hieu-luc-hsdt')?.value || '0', 10);
                const giaTriDamBaoEl = tr.querySelector('.mt-gia-tri-dam-bao');
                if (giaTriDamBaoEl) {
                    bid.giaTriDamBao = this.model.parseVND(giaTriDamBaoEl.value || '');
                }
                const hieuLucBaoDamNgayEl = tr.querySelector('.mt-hieu-luc-bao-dam-ngay');
                if (hieuLucBaoDamNgayEl) {
                    bid.hieuLucBaoDamNgay = parseInt(hieuLucBaoDamNgayEl.value || '0', 10);
                }
                const thoiGianThucHienEl = tr.querySelector('.mt-thoi-gian-thuc-hien');
                if (thoiGianThucHienEl) {
                    bid.thoiGianThucHien = thoiGianThucHienEl.value.trim();
                }
                const isFailedFinancial = bid.danhGiaKetLuan && bid.danhGiaKetLuan.startsWith('Không đạt');
                bid.danhGiaTaiChinh = finalRank ? `Xếp hạng ${finalRank}` : (isFailedFinancial ? 'Không xếp hạng' : '--');
                bid.lamRoTaiChinh = tr.querySelector('.mt-lam-ro-tai-chinh')?.value.trim() || '';
            } else {
                // Save Technical / Unified ratings
                bid.danhGiaHopLe = tr.querySelector('.mt-dg-hop-le')?.value.trim() || '';
                bid.danhGiaNangLuc = tr.querySelector('.mt-dg-nang-luc')?.value.trim() || '';
                bid.danhGiaKyThuat = tr.querySelector('.mt-dg-ky-thuat')?.value.trim() || '';
                const selectKetLuan = tr.querySelector('.mt-dg-ketluan');
                if (selectKetLuan) {
                    bid.danhGiaKetLuan = selectKetLuan.value;
                } else {
                    const cell = tr.querySelector('.mt-ketluan-cell');
                    bid.danhGiaKetLuan = cell ? cell.textContent.trim() : '';
                }

                const isFailedTechnical = bid.danhGiaKetLuan && bid.danhGiaKetLuan.startsWith('Không đạt');
                bid.danhGiaTaiChinh = finalRank ? `Xếp hạng ${finalRank}` : (isFailedTechnical ? 'Không xếp hạng' : '--');

                const inpLamRoHopLe = tr.querySelector('.mt-lam-ro-hop-le');
                if (inpLamRoHopLe) bid.lamRoHopLe = inpLamRoHopLe.value.trim();

                const inpLamRoNangLuc = tr.querySelector('.mt-lam-ro-nang-luc');
                if (inpLamRoNangLuc) bid.lamRoNangLuc = inpLamRoNangLuc.value.trim();

                const inpLamRoKyThuat = tr.querySelector('.mt-lam-ro-ky-thuat');
                if (inpLamRoKyThuat) bid.lamRoKyThuat = inpLamRoKyThuat.value.trim();

                const inpLamRoTaiChinh = tr.querySelector('.mt-lam-ro-tai-chinh');
                if (inpLamRoTaiChinh) bid.lamRoTaiChinh = inpLamRoTaiChinh.value.trim();

                bid.nguyenNhanKhongDatHopLe = tr.querySelector('.mt-reason-fail-hople')?.value.trim() || '';
                bid.nguyenNhanKhongDatNangLuc = tr.querySelector('.mt-reason-fail-nangluc')?.value.trim() || '';
                bid.nguyenNhanKhongDatKyThuat = tr.querySelector('.mt-reason-fail-kythuat')?.value.trim() || '';
            }
        }
    });

    this.model.persistData('thongtinmothau');
    this.view.renderGoiThauTable();
    this.autoSync();

    // Tự động chuyển tab kết quả hoặc danh sách đạt kỹ thuật sau khi lưu
    const detailPane = document.getElementById('tab-goithau-detail');
    if (detailPane && detailPane.classList.contains('active')) {
        if (!is1G2T) {
            this.view._currentWorkflowTab = 'result';
        } else {
            if (this.currentDanhGiaTab === 'technical') {
                this.view._currentWorkflowTab = 'qualified';
            } else {
                this.view._currentWorkflowTab = 'result';
            }
        }
        this.view.showPackageDetails(gtId);
    }

    await this.view.customAlert('Lưu thành công', `Đã lưu toàn bộ thông tin báo cáo đánh giá của gói thầu "${gt.tenGoiThau}" thành công!`, 'check-circle');
}
