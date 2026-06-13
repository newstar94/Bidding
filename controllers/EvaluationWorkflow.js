/* ==========================================================================
   BiddingFlow - EvaluationWorkflow (Split Workflow Controller Component)
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

        const isReadOnly = gt.trangThai === 'Đã có kết quả';

        // 2. Render Summary Card
        summaryContainer.style.display = 'block';
        summaryContainer.innerHTML = `
            <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem; margin-bottom: 12px;">
                <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdt}</span></div>
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
            ${isReadOnly ? `<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Hồ sơ đánh giá đã được khóa — Gói thầu đã có kết quả
            </div>` : ''}
        `;

        emptyState.style.display = 'none';
        evaluationContainer.style.display = 'block';

        // 3. Setup dynamic tab structures for 1G2T packages
        const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
        const tabsHeader = this.view.getActiveElement('danhgiahsdt-tabs-header');
        const tabBtnKt = this.view.getActiveElement('tab-btn-hsdxt-kt');
        const tabBtnTc = this.view.getActiveElement('tab-btn-hsdxt-tc');

        // Parse existing metadata
        let metadata = { soBaoCao: '', ngayBaoCao: '', cvLamRo: [], cvTraLoi: [], cvGuiCdt: [] };
        if (gt.danhGiaHsdtMetadata) {
            try {
                metadata = JSON.parse(gt.danhGiaHsdtMetadata);
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
        if (saveBtn) saveBtn.style.display = isReadOnly ? 'none' : 'block';
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
        if (importExcelBtn) importExcelBtn.style.display = isReadOnly ? 'none' : 'flex';

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
        const is1G1T = gt.phuongThucLuaChon === 'Một giai đoạn một túi hồ sơ';
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
                    <th style="width: 6%;">Loại nhà thầu</th>
                    <th style="width: 8%;">Mã phần lô</th>
                    <th style="width: 8%;">Tên phần lô</th>
                    <th style="width: 8%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 7%;">Đảm bảo</th>
                    <th style="width: 7%;">Hiệu lực ĐB</th>
                    <th style="width: 7%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 8%;">Đánh giá hợp lệ</th>
                    <th style="width: 8%;">Làm rõ tính hợp lệ</th>
                    <th style="width: 8%;">Đánh giá năng lực</th>
                    <th style="width: 8%;">Làm rõ năng lực kinh nghiệm</th>
                    <th style="width: 8%;">Đánh giá kỹ thuật</th>
                    <th style="width: 8%;">Làm rõ kỹ thuật</th>
                    <th style="width: 7%;">Kết luận</th>
                </tr>
            `;
        } else if (caseType === '1G2T_TC_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 10%;">Mã nhà thầu</th>
                    <th style="width: 12%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Giá dự thầu</th>
                    <th style="width: 6%;">Tỷ lệ %</th>
                    <th style="width: 10%;">Giá sau giảm</th>
                    <th style="width: 9%;">Hiệu lực E-HSĐXTC</th>
                    <th style="width: 9%;">Giá trị ĐB</th>
                    <th style="width: 7%;">Hiệu lực ĐB</th>
                    <th style="width: 9%;">Thời gian TH</th>
                    <th style="width: 10%;">Làm rõ tài chính</th>
                    <th style="width: 10%;">Đánh giá tài chính</th>
                </tr>
            `;
        } else if (caseType === '1G2T_TC_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 6%;">Loại nhà thầu</th>
                    <th style="width: 6%;">Mã phần lô</th>
                    <th style="width: 6%;">Tên phần lô</th>
                    <th style="width: 8%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 9%;">Giá dự thầu</th>
                    <th style="width: 5%;">Tỷ lệ %</th>
                    <th style="width: 9%;">Giá sau giảm</th>
                    <th style="width: 8%;">Hiệu lực E-HSĐXTC</th>
                    <th style="width: 9%;">Giá trị ĐB</th>
                    <th style="width: 6%;">Hiệu lực ĐB</th>
                    <th style="width: 8%;">Thời gian TH</th>
                    <th style="width: 10%;">Làm rõ tài chính</th>
                    <th style="width: 10%;">Đánh giá tài chính</th>
                </tr>
            `;
        } else if (caseType === '1G1T_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 6%;">Loại nhà thầu</th>
                    <th style="width: 8%;">Mã nhà thầu</th>
                    <th style="width: 10%;">Tên nhà thầu</th>
                    <th style="width: 8%;">Giá dự thầu</th>
                    <th style="width: 4%;">Tỷ lệ %</th>
                    <th style="width: 8%;">Giá sau giảm</th>
                    <th style="width: 6%;">Hiệu lực E-HSDT</th>
                    <th style="width: 6%;">Giá trị ĐB</th>
                    <th style="width: 5%;">Hiệu lực ĐB</th>
                    <th style="width: 5%;">Thời gian TH</th>
                    <th style="width: 7%;">Đánh giá hợp lệ</th>
                    <th style="width: 7%;">Làm rõ hợp lệ</th>
                    <th style="width: 7%;">Đánh giá năng lực</th>
                    <th style="width: 7%;">Làm rõ năng lực</th>
                    <th style="width: 7%;">Đánh giá kỹ thuật</th>
                    <th style="width: 7%;">Làm rõ kỹ thuật</th>
                    <th style="width: 7%;">Làm rõ tài chính</th>
                </tr>
            `;
        } else if (caseType === '1G1T_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 4%;">Loại nhà thầu</th>
                    <th style="width: 5%;">Mã phần lô</th>
                    <th style="width: 5%;">Tên phần lô</th>
                    <th style="width: 6%;">Mã nhà thầu</th>
                    <th style="width: 8%;">Tên nhà thầu</th>
                    <th style="width: 7%;">Giá dự thầu</th>
                    <th style="width: 4%;">Tỷ lệ %</th>
                    <th style="width: 7%;">Giá sau giảm</th>
                    <th style="width: 5%;">Hiệu lực E-HSDT</th>
                    <th style="width: 5%;">Giá trị ĐB</th>
                    <th style="width: 5%;">Hiệu lực ĐB</th>
                    <th style="width: 5%;">Thời gian TH</th>
                    <th style="width: 6%;">Đánh giá hợp lệ</th>
                    <th style="width: 6%;">Làm rõ hợp lệ</th>
                    <th style="width: 6%;">Đánh giá năng lực</th>
                    <th style="width: 6%;">Làm rõ năng lực</th>
                    <th style="width: 6%;">Đánh giá kỹ thuật</th>
                    <th style="width: 6%;">Làm rõ kỹ thuật</th>
                    <th style="width: 6%;">Làm rõ tài chính</th>
                </tr>
            `;
        }
        thead.innerHTML = theadHtml;

        // Render bidder rows
        tbody.innerHTML = '';
        let bids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId));
        if (is1G2T && this.currentDanhGiaTab === 'financial') {
            bids = bids.filter(b =>
                b.danhGiaKetLuan ? b.danhGiaKetLuan === 'Đạt' : (b.danhGiaHopLe === 'Đạt' && b.danhGiaNangLuc === 'Đạt' && b.danhGiaKyThuat !== 'Không đạt' && b.danhGiaKyThuat !== '')
            );
        }
        if (bids.length === 0) {
            tbody.innerHTML = `<tr><td colspan="15" style="text-align:center; padding: 24px; color: var(--text-muted);"><small>Không tìm thấy danh sách nhà thầu mở thầu. Vui lòng nhập thông tin mở thầu trước.</small></td></tr>`;
        } else {
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
                    // Chỉ dùng tên CSDL cho nhà thầu độc lập
                    if (!isJVBid) {
                        tenNhaThauHienThi = matchedNt.tenNhaThau || tenNhaThauHienThi;
                    }
                }

                const typeSelectHtml = `<span style="font-size:0.9rem;">${bid.loaiNhaThau || 'Độc lập'}</span>`;
                const jvBtnCount = (bid.thanhVienLienDanh || []).length;
                const jvDetailsHtml = isJVBid
                    ? `<div style="margin-top:4px; font-size:0.78rem;"><a href="#" class="mt-jv-view-link" style="color:var(--primary); text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:4px;">👥 Liên danh ${jvBtnCount} thành viên</a></div>`
                    : '';

                let cellHtml = '';

                // Render based on case type
                if (caseType === 'TU_VAN') {
                    cellHtml = `
                        <td>${typeSelectHtml}</td>
                        <td><span>${maNhaThauHienThi}</span></td>
                        <td><span>${tenNhaThauHienThi}</span>${jvDetailsHtml}</td>
                        <td>${bid.hieuLucHsdxt || '--'}</td>
                        <td>${bid.thoiGianThucHien || '--'}</td>
                    `;
                } else if (caseType === '1G2T_NO_LOT') {
                    cellHtml = `
                        <td>${typeSelectHtml}</td>
                        <td><span>${maNhaThauHienThi}</span></td>
                        <td><span>${tenNhaThauHienThi}</span>${jvDetailsHtml}</td>
                        <td>${this.model.formatVND(bid.damBaoDuThau) || '--'}</td>
                        <td>${bid.hieuLucDamBao || '--'}</td>
                        <td>${bid.hieuLucHsdxt || '--'}</td>
                    `;
                } else if (caseType === '1G2T_WITH_LOT') {
                    cellHtml = `
                        <td>${typeSelectHtml}</td>
                        <td>${bid.maPhanLo || '--'}</td>
                        <td>${bid.tenPhanLo || '--'}</td>
                        <td><span>${maNhaThauHienThi}</span></td>
                        <td><span>${tenNhaThauHienThi}</span>${jvDetailsHtml}</td>
                        <td>${this.model.formatVND(bid.damBaoDuThau) || '--'}</td>
                        <td>${bid.hieuLucDamBao || '--'}</td>
                        <td>${bid.hieuLucHsdxt || '--'}</td>
                    `;
                } else if (caseType === '1G2T_TC_NO_LOT') {
                    cellHtml = `
                        <td>${typeSelectHtml}</td>
                        <td><span>${maNhaThauHienThi}</span></td>
                        <td><span>${tenNhaThauHienThi}</span>${jvDetailsHtml}</td>
                    `;
                } else if (caseType === '1G2T_TC_WITH_LOT') {
                    cellHtml = `
                        <td>${typeSelectHtml}</td>
                        <td>${bid.maPhanLo || '--'}</td>
                        <td>${bid.tenPhanLo || '--'}</td>
                        <td><span>${maNhaThauHienThi}</span></td>
                        <td><span>${tenNhaThauHienThi}</span>${jvDetailsHtml}</td>
                    `;
                } else if (caseType === '1G1T_NO_LOT') {
                    cellHtml = `
                        <td>${typeSelectHtml}</td>
                        <td><span>${maNhaThauHienThi}</span></td>
                        <td><span>${tenNhaThauHienThi}</span>${jvDetailsHtml}</td>
                        <td>${this.model.formatVND(bid.giaDuThau) || '--'}</td>
                        <td style="text-align:right;">${(bid.tyLeGiamGia || 0).toString().replace('.', ',')}</td>
                        <td>${this.model.formatVND(bid.giaSauGiamGia) || '--'}</td>
                        <td>${bid.hieuLucHsdt ? bid.hieuLucHsdt + ' ngày' : '--'}</td>
                        <td>${this.model.formatVND(bid.giaTriDamBao) || '--'}</td>
                        <td style="text-align:right;">${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + ' ngày' : '--'}</td>
                        <td>${bid.thoiGianThucHien || '--'}</td>
                    `;
                } else if (caseType === '1G1T_WITH_LOT') {
                    cellHtml = `
                        <td>${typeSelectHtml}</td>
                        <td>${bid.maPhanLo || '--'}</td>
                        <td>${bid.tenPhanLo || '--'}</td>
                        <td><span>${maNhaThauHienThi}</span></td>
                        <td><span>${tenNhaThauHienThi}</span>${jvDetailsHtml}</td>
                        <td>${this.model.formatVND(bid.giaDuThau) || '--'}</td>
                        <td style="text-align:right;">${(bid.tyLeGiamGia || 0).toString().replace('.', ',')}</td>
                        <td>${this.model.formatVND(bid.giaSauGiamGia) || '--'}</td>
                        <td>${bid.hieuLucHsdt ? bid.hieuLucHsdt + ' ngày' : '--'}</td>
                        <td>${this.model.formatVND(bid.giaTriDamBao) || '--'}</td>
                        <td style="text-align:right;">${bid.hieuLucBaoDamNgay ? bid.hieuLucBaoDamNgay + ' ngày' : '--'}</td>
                        <td>${bid.thoiGianThucHien || '--'}</td>
                    `;
                }

                // Add evaluation column inputs depending on whether E-HSĐXKT (Technical) or E-HSĐXTC (Financial)
                if (caseType === '1G2T_TC_NO_LOT' || caseType === '1G2T_TC_WITH_LOT') {
                    // Financial Evaluation view (1G2T E-HSĐXTC)
                    const valGiaDuThau = this.model.formatVND(bid.giaDuThau) || '';
                    const valTyLeGiam = (bid.tyLeGiamGia || 0).toString().replace('.', ',');
                    const valGiaSauGiam = this.model.formatVND(bid.giaSauGiamGia) || '';
                    const valHieuLucHsdt = bid.hieuLucHsdt || '';
                    const valGiaTriDb = this.model.formatVND(bid.giaTriDamBao) || '';
                    const valHieuLucDb = bid.hieuLucBaoDamNgay || '';
                    const valThoiGianTh = bid.thoiGianThucHien || '';
                    const valTaiChinh = bid.danhGiaTaiChinh || '';
                    const valLamRoTaiChinh = bid.lamRoTaiChinh || '';

                    if (isReadOnly) {
                        cellHtml += `
                            <td><span>${valGiaDuThau || '--'}</span></td>
                            <td style="text-align:right;"><span>${valTyLeGiam}</span></td>
                            <td><span>${valGiaSauGiam || '--'}</span></td>
                            <td><span>${valHieuLucHsdt ? valHieuLucHsdt + ' ngày' : '--'}</span></td>
                            <td><span>${valGiaTriDb || '--'}</span></td>
                            <td style="text-align:right;"><span>${valHieuLucDb ? valHieuLucDb + ' ngày' : '--'}</span></td>
                            <td><span>${valThoiGianTh || '--'}</span></td>
                            <td><span>${valLamRoTaiChinh || '--'}</span></td>
                            <td><span style="font-weight:600;">${valTaiChinh || '--'}</span></td>
                        `;
                    } else {
                        cellHtml += `
                            <td><input type="text" class="form-control mt-gia-du-thau" value="${valGiaDuThau}" placeholder="Ví dụ: 1.000.000.000" style="padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${valTyLeGiam}" placeholder="0" style="text-align:right; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-gia-sau-giam-gia" value="${valGiaSauGiam}" readonly placeholder="Tự tính..." style="background:#f1f5f9; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${valHieuLucHsdt ? valHieuLucHsdt + ' ngày' : ''}" placeholder="Ví dụ: 90 ngày" style="padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-gia-tri-dam-bao" value="${valGiaTriDb}" placeholder="Ví dụ: 10.000.000" style="padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${valHieuLucDb ? valHieuLucDb + ' ngày' : ''}" placeholder="Ví dụ: 120 ngày" style="text-align:right; padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${valThoiGianTh}" placeholder="Ví dụ: 60 ngày" style="padding: 4px 6px; font-size:0.8rem;"></td>
                            <td><input type="text" class="form-control mt-lam-ro-tai-chinh" value="${valLamRoTaiChinh}" placeholder="Nhập làm rõ tài chính..." style="padding: 4px 6px; font-size:0.8rem;"></td>
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
 
                    if (isReadOnly) {
                        cellHtml += `
                            <td><span style="font-weight:600;">${valHopLe || '--'}</span></td>
                            <td><span>${valLamRoHopLe || '--'}</span></td>
                            <td><span style="font-weight:600;">${valNangLuc || '--'}</span></td>
                            <td><span>${valLamRoNangLuc || '--'}</span></td>
                            <td><span style="font-weight:600;">${valKyThuat || '--'}</span></td>
                            <td><span>${valLamRoKyThuat || '--'}</span></td>
                            ${isTechnical ? `<td><span style="font-weight:600;">${valKetLuan || '--'}</span></td>` : `<td><span>${valLamRoTaiChinh || '--'}</span></td>`}
                        `;
                    } else {
                        cellHtml += `
                            <td><input type="text" class="form-control mt-dg-hop-le" value="${valHopLe}" placeholder="Đạt / Không đạt..."></td>
                            <td><input type="text" class="form-control mt-lam-ro-hop-le" value="${valLamRoHopLe}" placeholder="Nhập làm rõ hợp lệ..."></td>
                            <td><input type="text" class="form-control mt-dg-nang-luc" value="${valNangLuc}" placeholder="Đạt / Không đạt..."></td>
                            <td><input type="text" class="form-control mt-lam-ro-nang-luc" value="${valLamRoNangLuc}" placeholder="Nhập làm rõ năng lực..."></td>
                            <td><input type="text" class="form-control mt-dg-ky-thuat" value="${valKyThuat}" placeholder="Điểm hoặc Đạt..."></td>
                            <td><input type="text" class="form-control mt-lam-ro-ky-thuat" value="${valLamRoKyThuat}" placeholder="Nhập làm rõ kỹ thuật..."></td>
                            ${isTechnical ? `
                            <td>
                                <select class="form-control mt-dg-ketluan" style="padding: 4px 6px; font-size:0.8rem;">
                                    <option value="">-- Chọn --</option>
                                    <option value="Đạt" ${valKetLuan === 'Đạt' ? 'selected' : ''}>Đạt</option>
                                    <option value="Không đạt" ${valKetLuan === 'Không đạt' ? 'selected' : ''}>Không đạt</option>
                                </select>
                            </td>` : `<td><input type="text" class="form-control mt-lam-ro-tai-chinh" value="${valLamRoTaiChinh}" placeholder="Nhập làm rõ tài chính..."></td>`}
                        `;
                    }
                }

                tr.innerHTML = cellHtml;

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
        }
        lucide.createIcons();
    };

    select.onchange = handlePackageSelection;
    handlePackageSelection();

    const saveBtn = this.view.getActiveElement('btn-danhgiahsdt-save');
    if (saveBtn) {
        saveBtn.onclick = () => this.saveDanhGiaHsdt();
    }

    const importExcelBtn = this.view.getActiveElement('btn-danhgiahsdt-import-excel');
    if (importExcelBtn) {
        importExcelBtn.onclick = () => this.openExcelImportModal('danhgiahsdt');
    }

    // Initialize flatpickr on static date input
    flatpickr(this.view.getActiveElement('danhgiahsdt-ngay-baocao'), {
        dateFormat: "d/m/Y",
        locale: "vn",
        allowInput: true
    });
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

    const activeBlock = {
        soBaoCao,
        ngayBaoCao,
        cvLamRo,
        cvTraLoi,
        cvGuiCdt,
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
            currentMetadata.technical = activeBlock;
        } else {
            currentMetadata.financial = activeBlock;
        }
        gt.danhGiaHsdtMetadata = JSON.stringify(currentMetadata);
    } else {
        gt.danhGiaHsdtMetadata = JSON.stringify(activeBlock);
    }

    this.model.persistData('goithau');

    // Update bidder evaluation records
    const rows = this.view.getActiveElement('danhgiahsdt-table-tbody').querySelectorAll('tr');
    rows.forEach(tr => {
        const bidId = tr.getAttribute('data-bid-id');
        if (!bidId) return;
        const bid = this.model.state.thongtinmothau.find(b => b.id === bidId);
        if (bid) {
            if (is1G2T && this.currentDanhGiaTab === 'financial') {
                // Save Financial ratings & parameters
                bid.giaDuThau = this.model.parseVND(tr.querySelector('.mt-gia-du-thau')?.value || '');
                const tyLeRaw = tr.querySelector('.mt-ty-le-giam-gia')?.value || '0';
                bid.tyLeGiamGia = parseFloat(tyLeRaw.replace(/,/g, '.')) || 0;
                bid.giaSauGiamGia = this.model.parseVND(tr.querySelector('.mt-gia-sau-giam-gia')?.value || '');
                bid.hieuLucHsdt = parseInt(tr.querySelector('.mt-hieu-luc-hsdt')?.value || '0', 10);
                bid.giaTriDamBao = this.model.parseVND(tr.querySelector('.mt-gia-tri-dam-bao')?.value || '');
                bid.hieuLucBaoDamNgay = parseInt(tr.querySelector('.mt-hieu-luc-bao-dam-ngay')?.value || '0', 10);
                bid.thoiGianThucHien = tr.querySelector('.mt-thoi-gian-thuc-hien')?.value.trim() || '';
                bid.danhGiaTaiChinh = tr.querySelector('.mt-dg-tai-chinh')?.value.trim() || '';
                bid.lamRoTaiChinh = tr.querySelector('.mt-lam-ro-tai-chinh')?.value.trim() || '';
            } else {
                // Save Technical / Unified ratings
                bid.danhGiaHopLe = tr.querySelector('.mt-dg-hop-le')?.value.trim() || '';
                bid.danhGiaNangLuc = tr.querySelector('.mt-dg-nang-luc')?.value.trim() || '';
                bid.danhGiaKyThuat = tr.querySelector('.mt-dg-ky-thuat')?.value.trim() || '';
                const selectKetLuan = tr.querySelector('.mt-dg-ketluan');
                if (selectKetLuan) {
                    bid.danhGiaKetLuan = selectKetLuan.value;
                }

                const inpLamRoHopLe = tr.querySelector('.mt-lam-ro-hop-le');
                if (inpLamRoHopLe) bid.lamRoHopLe = inpLamRoHopLe.value.trim();

                const inpLamRoNangLuc = tr.querySelector('.mt-lam-ro-nang-luc');
                if (inpLamRoNangLuc) bid.lamRoNangLuc = inpLamRoNangLuc.value.trim();

                const inpLamRoKyThuat = tr.querySelector('.mt-lam-ro-ky-thuat');
                if (inpLamRoKyThuat) bid.lamRoKyThuat = inpLamRoKyThuat.value.trim();

                const inpLamRoTaiChinh = tr.querySelector('.mt-lam-ro-tai-chinh');
                if (inpLamRoTaiChinh) bid.lamRoTaiChinh = inpLamRoTaiChinh.value.trim();
            }
        }
    });

    this.model.persistData('thongtinmothau');
    this.view.renderGoiThauTable();
    this.autoSync();

    await this.view.customAlert('Lưu thành công', `Đã lưu toàn bộ thông tin báo cáo đánh giá của gói thầu "${gt.tenGoiThau}" thành công!`, 'check-circle');
    if (is1G2T) {
        if (this.currentDanhGiaTab === 'technical') {
            this.view._currentWorkflowTab = 'qualified';
        } else {
            this.view._currentWorkflowTab = 'result';
        }
    } else {
        this.view._currentWorkflowTab = 'result';
    }
    this.view.showPackageDetails(gtId);
}


