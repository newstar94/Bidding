export async function moThauGoiThau(id) {
    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;

    const thoiGianMoThauStr = await this.view.customPrompt(
        'Chọn thời gian mở thầu',
        `Chọn Thời gian mở thầu cho gói thầu "${gt.tenGoiThau}":`,
        '',
        'Chọn ngày và giờ...',
        true  // kích hoạt date/time picker
    );
    if (thoiGianMoThauStr === null) {
        return; // User canceled the prompt
    }
    const cleanStr = thoiGianMoThauStr.trim();
    if (!cleanStr) {
        await this.view.customAlert('Lỗi', 'Vui lòng chọn thời gian mở thầu!', 'x-circle');
        return;
    }

    // Thử phân tích theo định dạng "HH:mm ngày dd/MM/yyyy" trước
    let d, m, y, hh = 0, mm = 0;
    const newFormatMatch = cleanStr.match(/^(\d{2}):(\d{2})\s+ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i);

    if (newFormatMatch) {
        hh = parseInt(newFormatMatch[1], 10);
        mm = parseInt(newFormatMatch[2], 10);
        d = parseInt(newFormatMatch[3], 10);
        m = parseInt(newFormatMatch[4], 10);
        y = parseInt(newFormatMatch[5], 10);
    } else {
        // Fallback lại cách parse cũ "dd/MM/yyyy HH:mm"
        const parts = cleanStr.split(' ');
        if (parts.length >= 2) {
            const dateParts = parts[0].split('/');
            const timeParts = parts[1].split(':');
            d = parseInt(dateParts[0], 10);
            m = parseInt(dateParts[1], 10);
            y = parseInt(dateParts[2], 10);
            hh = parseInt(timeParts[0] || 0, 10);
            mm = parseInt(timeParts[1] || 0, 10);
        }
    }

    if (isNaN(d) || isNaN(m) || isNaN(y) || isNaN(hh) || isNaN(mm)) {
        await this.view.customAlert('Lỗi', 'Thời gian mở thầu không hợp lệ. Vui lòng chọn lại!', 'x-circle');
        return;
    }


    const confirmed = await this.view.customConfirm(
        'Mở thầu gói thầu',
        `Bạn có chắc chắn muốn tiến hành mở thầu cho gói thầu "${gt.tenGoiThau}" lúc ${cleanStr}? Trạng thái sẽ được chuyển sang "Đã mở thầu".`,
        'unlock'
    );

    if (confirmed) {
        // Convert dd/MM/yyyy HH:mm to ISO date string format
        const ymdStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
        gt.thoiGianMoThau = ymdStr;
        gt.trangThai = 'Đã mở thầu';
        this.model.persistData('goithau');
        this.view.renderGoiThauTable();
        this.autoSync();
        await this.view.customAlert(
            'Thành công',
            `Đã tiến hành mở thầu thành công cho gói thầu "${gt.tenGoiThau}". Trạng thái hiện tại: Đã mở thầu. Hãy tiến hành điền thông tin mở thầu và lưu lại!`,
            'check-circle'
        );
        this.switchTab('goithau-detail', id);
    }
}


export async function phatHanhHsmtGoiThau(id) {
    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;

    this.view.populatePhathanhHsmtForm(gt, this.model);
    this.view.openModal('modal-phathanh-hsmt');
}


export async function handlePhatHanhHsmtSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-phathanh-hsmt');
    if (!this.view.validateForm(form)) return;

    const data = this.view.getPhathanhHsmtFormData(this.model);
    const { id, maGoiThauVal, hieuLucHsdtVal, giaTriDamBaoVal, soQuyetDinh, thoiGianDangTai, thoiGianDongThau, ngayQuyetDinh, soToTrinhHsmt, ngayTrinhHsmt, yeuCauThamDinhHsmt, soBaoCaoThamDinhHsmt, ngayBaoCaoThamDinhHsmt, phanLoRows } = data;

    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;

    const isTuVan = gt.linhVuc === 'Tư vấn';
    const isPhanLo = gt.phanLo === 'Có';

    if (!maGoiThauVal) {
        await this.view.customAlert('Thiếu thông tin', 'Mã gói thầu là bắt buộc khi chuyển sang trạng thái Đang mời thầu!', 'alert-triangle', document.getElementById('phathanh-magoithau'));
        return;
    }

    if (hieuLucHsdtVal <= 0) {
        await this.view.customAlert('Thiếu thông tin', 'Thời gian hiệu lực hồ sơ dự thầu phải lớn hơn 0!', 'alert-triangle', document.getElementById('phathanh-hieuluchsdt'));
        return;
    }



    if (!isTuVan && !isPhanLo) {
        if (giaTriDamBaoVal <= 0) {
            await this.view.customAlert('Thiếu thông tin', 'Giá trị bảo đảm dự thầu phải lớn hơn 0 (trừ gói tư vấn)!', 'alert-triangle', document.getElementById('phathanh-giatribaomothau'));
            return;
        }
    }

    if (isPhanLo && !isTuVan) {
        let invalidInput = null;
        let exceedsInput = null;
        let exceedsMsg = '';

        for (const row of phanLoRows) {
            if (row.baoDamDuThau <= 0 && !invalidInput) {
                const tr = document.querySelector(`#phathanh-phanlo-baodam-tbody tr[data-id="${row.id}"]`);
                invalidInput = tr ? tr.querySelector('.phathanh-pl-baodam-input') : null;
            }
            if (row.giaTriPhanLo > 0 && row.baoDamDuThau > row.giaTriPhanLo && !exceedsInput) {
                const tr = document.querySelector(`#phathanh-phanlo-baodam-tbody tr[data-id="${row.id}"]`);
                exceedsInput = tr ? tr.querySelector('.phathanh-pl-baodam-input') : null;
                exceedsMsg = `Giá trị bảo đảm dự thầu (${this.model.formatVND(row.baoDamDuThau)}) không được lớn hơn giá trị phần lô (${this.model.formatVND(row.giaTriPhanLo)})!`;
            }
        }

        if (invalidInput || phanLoRows.length === 0) {
            await this.view.customAlert('Thiếu thông tin', 'Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô (trừ gói tư vấn)!', 'alert-triangle', invalidInput);
            return;
        }

        if (exceedsInput) {
            await this.view.customAlert('Dữ liệu không hợp lệ', exceedsMsg, 'alert-triangle', exceedsInput);
            return;
        }
    }

    const confirmed = await this.view.customConfirm(
        'Xác nhận phát hành',
        `Bạn có chắc chắn muốn phát hành HSMT và chuyển gói thầu "${gt.tenGoiThau}" sang trạng thái "Đang mời thầu" không?`,
        'send'
    );

    if (confirmed) {
        gt.maGoiThau = maGoiThauVal;
        gt.soToTrinhHsmt = soToTrinhHsmt;
        gt.ngayTrinhHsmt = ngayTrinhHsmt ? this.model.convertDMYToYMD(ngayTrinhHsmt) : '';
        gt.soQuyetDinh = soQuyetDinh;
        gt.ngayQuyetDinh = ngayQuyetDinh ? this.model.convertDMYToYMD(ngayQuyetDinh) : '';
        gt.thoiGianDangTai = thoiGianDangTai ? this.model.convertDMYHMSToYMDHMS(thoiGianDangTai) : '';
        gt.thoiGianDongThau = thoiGianDongThau ? this.model.convertDMYHMSToYMDHMS(thoiGianDongThau) : '';
        gt.yeuCauThamDinhHsmt = yeuCauThamDinhHsmt;
        gt.soBaoCaoThamDinhHsmt = soBaoCaoThamDinhHsmt;
        gt.ngayBaoCaoThamDinhHsmt = ngayBaoCaoThamDinhHsmt ? this.model.convertDMYToYMD(ngayBaoCaoThamDinhHsmt) : '';

        gt.thoiGianMoThau = '';

        gt.hieuLucHsdt = hieuLucHsdtVal;
        gt.hieuLucDamBaoDuThau = hieuLucHsdtVal + 30;

        if (isPhanLo && !isTuVan && gt.phanLoList) {
            phanLoRows.forEach(row => {
                const pl = gt.phanLoList.find(p => p.id === row.id);
                if (pl) {
                    pl.maPhanLo = row.maPhanLo;
                    pl.tenPhanLo = row.tenPhanLo;
                    pl.giaTriPhanLo = row.giaTriPhanLo;
                    pl.baoDamDuThau = row.baoDamDuThau;
                    pl.thoiGianThucHien = row.thoiGianThucHien;
                }
            });
            gt.giaTriDamBaoDuThau = gt.phanLoList.reduce((sum, item) => sum + (item.baoDamDuThau || 0), 0);
        } else if (!isTuVan && !isPhanLo) {
            gt.giaTriDamBaoDuThau = giaTriDamBaoVal;
        } else {
            gt.giaTriDamBaoDuThau = 0;
        }

        gt.trangThai = 'Đang mời thầu';

        this.model.persistData('goithau');
        this.view.closeModal('modal-phathanh-hsmt');
        this.view.showPackageDetails(id);
        this.autoSync();
        await this.view.customAlert('Thành công', 'Đã phát hành HSMT và chuyển gói thầu sang trạng thái Đang mời thầu!', 'check-circle');
    }
}


export function renderMoThauPanel() {
    const select = document.getElementById('mothau-goithau-select');
    if (!select) return;

    // 1. Populate packages dropdown — hiện gói đang mời thầu (đã qua hạn nộp), đã mở thầu hoặc đang chấm thầu
    const now = new Date();
    const selectedVal = select.value;
    const targetPackages = this.model.state.goithau.filter(g => {
        if (g.id === selectedVal) return true;
        const isDirectOrSpecial = (g.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || g.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
        if (isDirectOrSpecial) return true;
        if (g.trangThai !== 'Đang mời thầu' && g.trangThai !== 'Đã mở thầu' && g.trangThai !== 'Đang chấm thầu' && g.trangThai !== 'Đã có kết quả') return false;
        if (g.trangThai === 'Đang mời thầu') {
            if (!g.thoiGianDongThau) return false;
            const dongThau = new Date(g.thoiGianDongThau);
            if (dongThau >= now) return false;
        }
        return true;
    });
    select.innerHTML = '<option value="">-- Chọn Gói thầu (Đang mời thầu / Đã mở thầu / Đang chấm thầu / Đã có kết quả) --</option>' +
        targetPackages.map(g => `<option value="${g.id}" data-search="${g.maGoiThau || ''} ${g.tenGoiThau || ''}">${g.tenGoiThau} (${g.maGoiThau || 'Chưa có mã'})</option>`).join('');

    if (selectedVal && targetPackages.some(g => g.id === selectedVal)) {
        select.value = selectedVal;
    } else {
        select.value = '';
    }
    this.makeSearchableSelect(select, 'Tìm kiếm Gói thầu...');

    const summaryContainer = document.getElementById('mothau-goithau-summary');
    const bidContainer = document.getElementById('mothau-bid-container');
    const emptyState = document.getElementById('mothau-empty-state');
    const thead = document.getElementById('mothau-table-thead');
    const tbody = document.getElementById('mothau-table-tbody');

    const handlePackageSelection = () => {
        const gtId = select.value;
        if (!gtId) {
            summaryContainer.style.display = 'none';
            bidContainer.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        const gt = this.model.state.goithau.find(g => g.id === gtId);
        if (!gt) return;

        const kh = this.model.getLatestPlan(gt.keHoachId);
        const cdt = kh ? this.model.state.chudautu.find(c => c.id === kh.chuDauTuId) : null;
        const tenCdt = cdt ? cdt.tenChuDauTu : 'Không rõ';
        const tenKhStr = kh ? kh.tenKeHoach : 'Không rõ';

        const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
        const isTuVan = gt.linhVuc === 'Tư vấn';
        const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
        const is1G1T = gt.phuongThucLuaChon === 'Một giai đoạn một túi hồ sơ';
        const hasPhanLo = gt.phanLo === 'Có';

        const stepKey = is1G2T ? 'opening_tech' : 'opening';

        // Calculate if Step 2 (Evaluation HSĐXKT / HSDT) is already completed
        let isNextStepSaved = false;
        if (gt.danhGiaHsdtMetadata) {
            try {
                const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
                if (is1G2T) {
                    isNextStepSaved = !!(parsed.is1G2T && parsed.technical && parsed.technical.saved);
                } else {
                    isNextStepSaved = !!parsed.saved;
                }
            } catch (e) { }
        }

        // Step 1 (Mo thau) is completed only if it is not in mời/mở thầu status AND the next step is saved OR the opening data has been saved
        const hasSavedOpeningData = this.model.state.thongtinmothau.some(b => String(b.goiThauId) === String(gt.id));
        const isCompleted = ((gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu') && isNextStepSaved) || hasSavedOpeningData;
        const isEditingThisStep = this.view._editingState && this.view._editingState[stepKey];
        const lockedStatuses = ['Đã có kết quả', 'Hủy thầu'];
        const isLocked = lockedStatuses.includes(gt.trangThai);
        const isReadOnly = (isCompleted && !isEditingThisStep) || isLocked;
        const isEditable = !isReadOnly;

        // Render Summary Card
        summaryContainer.style.display = 'block';
        summaryContainer.innerHTML = `
            <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem; margin-bottom: 12px;">
                <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdt}</span></div>
                <div>• <strong>Tên kế hoạch:</strong> <span class="text-dark fw-bold">${tenKhStr}</span></div>
                <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}</div>
                <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ'}</div>
                <div>• <strong>Phân lô:</strong> ${gt.phanLo === 'Có' ? 'Có chia phần lô' : 'Không chia phần lô'}</div>
                <div>• <strong>Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || '--'}</div>
                ${gt.phuongPhapDanhGia ? `<div>• <strong>Phương pháp đánh giá:</strong> ${gt.phuongPhapDanhGia}${gt.phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá' && gt.trongSoKyThuat ? ` (${gt.trongSoKyThuat}%)` : ''}</div>` : ''}
                <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || '--'}</div>
                <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || '--'}</div>
                <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || '--'}</div>
                ${!isDirectOrSpecial ? `
                <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '--'}</div>
                <div style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;">• <strong>${is1G2T ? 'Thời gian mở E-HSĐXKT' : 'Thời gian mở thầu'}:</strong> 
                    ${isEditable ? `
                        <input type="text" id="op-thoigianmothau" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: left; display: inline-block; vertical-align: middle; margin-left: 4px;" value="${gt.thoiGianMoThau ? this.model.formatDate(gt.thoiGianMoThau) : ''}" placeholder="dd/MM/yyyy HH:mm">
                    ` : `
                        <span class="text-dark fw-bold" style="margin-left: 4px;">${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : 'Chưa mở'}</span>
                    `}
                </div>
                ` : ''}
            </div>

            ${((isLocked || isReadOnly) && !isDirectOrSpecial) ? `<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                 ${is1G2T ? 'Biên bản mở E-HSĐXKT' : 'Biên bản mở thầu'} đã được khóa
            </div>` : ''}
        `;

        if (isEditable) {
            this.view.initFlatpickr(summaryContainer);
        }

        emptyState.style.display = 'none';
        bidContainer.style.display = 'block';

        // Ẩn/hiện nút thêm và khóa/mở nút lưu theo trạng thái
        const titleEl = document.getElementById('mothau-table-title');
        if (titleEl) {
            titleEl.textContent = isDirectOrSpecial ? 'Danh sách Nhà thầu' : 'Danh sách Nhà thầu tham dự & Nộp hồ sơ';
        }
        const addBidBtn = document.getElementById('btn-mothau-add-bid');
        const saveBtn2 = document.getElementById('btn-mothau-save');
        const importExcelBtnTop = document.getElementById('btn-mothau-import-excel');
        const downloadExcelBtnTop = document.getElementById('btn-mothau-download-excel');
        if (addBidBtn) {
            addBidBtn.style.display = isEditable ? '' : 'none';
            addBidBtn.innerHTML = `<i data-lucide="plus"></i> ${isDirectOrSpecial ? 'Thêm nhà thầu' : 'Thêm Nhà thầu nộp hồ sơ'}`;
        }
        if (importExcelBtnTop) importExcelBtnTop.style.display = isEditable ? '' : 'none';
        if (downloadExcelBtnTop) downloadExcelBtnTop.style.display = isEditable ? '' : 'none';
        if (saveBtn2) {
            if (isReadOnly) {
                if (isNextStepSaved || isLocked) {
                    saveBtn2.style.display = 'none';
                } else {
                    saveBtn2.style.display = '';
                    saveBtn2.innerHTML = '<i data-lucide="edit"></i> Chỉnh sửa';
                    saveBtn2.className = 'btn btn-primary';
                    saveBtn2.onclick = () => {
                        this.view._editingState = this.view._editingState || {};
                        this.view._editingState[stepKey] = true;
                        this.renderMoThauPanel();
                    };
                }
            } else {
                saveBtn2.style.display = '';
                saveBtn2.innerHTML = `<i data-lucide="save"></i> ${isDirectOrSpecial ? 'Lưu thông tin' : 'Lưu thông tin mở thầu'}`;
                saveBtn2.className = 'btn btn-primary';
                saveBtn2.onclick = () => this.saveThongTinMoThau();
            }
        }

        // 2. Identify the dynamic fields case
        let caseType = '1G1T_NO_LOT';
        if (isDirectOrSpecial) {
            caseType = hasPhanLo ? 'DIRECT_SPECIAL_WITH_LOT' : 'DIRECT_SPECIAL_NO_LOT';
        } else if (isTuVan) {
            caseType = 'TU_VAN';
        } else if (!isTuVan && is1G2T) {
            caseType = hasPhanLo ? '1G2T_WITH_LOT' : '1G2T_NO_LOT';
        } else if (is1G1T) {
            caseType = hasPhanLo ? '1G1T_WITH_LOT' : '1G1T_NO_LOT';
        }

        // Render appropriate header
        let theadHtml = '';
        if (caseType === 'TU_VAN') {
            theadHtml = `
                <tr>
                    <th style="width: 15%;">Loại nhà thầu</th>
                    <th style="width: 20%;">Mã nhà thầu</th>
                    <th style="width: 30%;">Tên nhà thầu</th>
                    <th style="width: 15%;">Hiệu lực E-HSĐXKT</th>
                    <th style="width: 12%;">Thời gian thực hiện</th>
                    ${isEditable ? '<th style="width: 8%; text-align: center;">Thao tác</th>' : ''}
                </tr>
            `;
        } else if (caseType === '1G2T_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 12%;">Loại nhà thầu</th>
                    <th style="width: 18%;">Mã nhà thầu</th>
                    <th style="width: 25%;">Tên nhà thầu</th>
                    <th style="width: 12%;">Đảm bảo dự thầu</th>
                    <th style="width: 12%;">Hiệu lực đảm bảo</th>
                    <th style="width: 13%;">Hiệu lực E-HSĐXKT</th>
                    ${isEditable ? '<th style="width: 8%; text-align: center;">Thao tác</th>' : ''}
                </tr>
            `;
        } else if (caseType === '1G2T_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 10%;">Mã phần lô</th>
                    <th style="width: 10%;">Tên phần lô</th>
                    <th style="width: 10%;">Loại nhà thầu</th>
                    <th style="width: 15%;">Mã nhà thầu</th>
                    <th style="width: 20%;">Tên nhà thầu</th>
                    <th style="width: 9%;">Đảm bảo</th>
                    <th style="width: 9%;">Hiệu lực ĐB</th>
                    <th style="width: 11%;">Hiệu lực E-HSĐXKT</th>
                    ${isEditable ? '<th style="width: 6%; text-align: center;">Thao tác</th>' : ''}
                </tr>
            `;
        } else if (caseType === '1G1T_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 10%;">Loại nhà thầu</th>
                    <th style="width: 14%;">Mã nhà thầu</th>
                    <th style="width: 20%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Giá dự thầu</th>
                    <th style="width: 7%;">Tỷ lệ giảm (%)</th>
                    <th style="width: 11%;">Giá sau giảm</th>
                    <th style="width: 9%;">Hiệu lực E-HSDT</th>
                    <th style="width: 9%;">Giá trị ĐB DT</th>
                    <th style="width: 6%;">Hiệu lực ĐB</th>
                    <th style="width: 6%;">Thời gian TH</th>
                    ${isEditable ? '<th style="width: 4%; text-align: center;">Thao tác</th>' : ''}
                </tr>
            `;
        } else if (caseType === '1G1T_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 8%;">Mã phần lô</th>
                    <th style="width: 8%;">Tên phần lô</th>
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 12%;">Mã nhà thầu</th>
                    <th style="width: 16%;">Tên nhà thầu</th>
                    <th style="width: 8%;">Giá dự thầu</th>
                    <th style="width: 6%;">Tỷ lệ giảm (%)</th>
                    <th style="width: 10%;">Giá sau giảm</th>
                    <th style="width: 8%;">Hiệu lực E-HSDT</th>
                    <th style="width: 8%;">Giá trị ĐB</th>
                    <th style="width: 6%;">Hiệu lực ĐB</th>
                    <th style="width: 6%;">Thời gian TH</th>
                    ${isEditable ? '<th style="width: 4%; text-align: center;">Thao tác</th>' : ''}
                </tr>
            `;
        } else if (caseType === 'DIRECT_SPECIAL_NO_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 12%;">Loại nhà thầu</th>
                    <th style="width: 15%;">Mã nhà thầu</th>
                    <th style="width: 25%;">Tên nhà thầu</th>
                    <th style="width: 15%;">Giá dự thầu</th>
                    <th style="width: 25%;">Thời gian thực hiện gói thầu</th>
                    ${isEditable ? '<th style="width: 8%; text-align: center;">Thao tác</th>' : ''}
                </tr>
            `;
        } else if (caseType === 'DIRECT_SPECIAL_WITH_LOT') {
            theadHtml = `
                <tr>
                    <th style="width: 10%;">Mã phần lô</th>
                    <th style="width: 10%;">Tên phần lô</th>
                    <th style="width: 10%;">Loại nhà thầu</th>
                    <th style="width: 12%;">Mã nhà thầu</th>
                    <th style="width: 18%;">Tên nhà thầu</th>
                    <th style="width: 10%;">Giá dự thầu</th>
                    <th style="width: 20%;">Thời gian thực hiện gói thầu</th>
                    ${isEditable ? '<th style="width: 10%; text-align: center;">Thao tác</th>' : ''}
                </tr>
            `;
        }
        thead.innerHTML = theadHtml;

        // 3. Render rows from model state
        tbody.innerHTML = '';
        const bids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId));
        bids.sort((a, b) => {
            const codeA = String(a.maPhanLo || '').toLowerCase();
            const codeB = String(b.maPhanLo || '').toLowerCase();
            return codeA.localeCompare(codeB, 'vi', { numeric: true });
        });

        if (bids.length === 0) {
            // Add a default row (only when editable)
            if (isEditable) this.addMoThauRow(caseType, gt);
        } else {
            bids.forEach(bid => this.addMoThauRow(caseType, gt, bid, isReadOnly));
        }
        lucide.createIcons();
    };

    select.onchange = handlePackageSelection;
    handlePackageSelection();
    this.setupExcelImportEvents();

    const addBidBtn = document.getElementById('btn-mothau-add-bid');
    if (addBidBtn) {
        addBidBtn.onclick = () => {
            const gtId = select.value;
            const gt = this.model.state.goithau.find(g => g.id === gtId);
            if (!gt) return;

            const isTuVan = gt.linhVuc === 'Tư vấn';
            const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
            const is1G1T = gt.phuongThucLuaChon === 'Một giai đoạn một túi hồ sơ';
            const hasPhanLo = gt.phanLo === 'Có';

            const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
            let caseType = '1G1T_NO_LOT';
            if (isDirectOrSpecial) caseType = hasPhanLo ? 'DIRECT_SPECIAL_WITH_LOT' : 'DIRECT_SPECIAL_NO_LOT';
            else if (isTuVan) caseType = 'TU_VAN';
            else if (!isTuVan && is1G2T) caseType = hasPhanLo ? '1G2T_WITH_LOT' : '1G2T_NO_LOT';
            else if (is1G1T) caseType = hasPhanLo ? '1G1T_WITH_LOT' : '1G1T_NO_LOT';

            this.addMoThauRow(caseType, gt);
            lucide.createIcons();
        };
    }

    // saveBtn listener is now dynamically handled inside handlePackageSelection
}


window.openMoThauJVManager = (tr) => {
    const leadCode = (tr.querySelector('.mt-ma-nha-thau') || tr.querySelector('.row-ma-nha-thau'))?.value.trim() || '';
    const members = (tr._thanhVienLienDanh || []).filter(m =>
        String(m.maSoThue).toLowerCase().trim() !== String(leadCode).toLowerCase().trim() &&
        m.vaiTro !== "Đứng đầu liên danh"
    );
    const modalId = 'modal-mothau-jv-manager';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay active';
    modal.style.zIndex = '2000';

    const card = document.createElement('div');
    card.className = 'modal-card';
    card.style.maxWidth = '600px';
    card.style.width = '95%';
    card.style.margin = '20px auto';

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv">&times;</button>
    `;

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.padding = '20px';

    // Tự động tra cứu tên thành viên đứng đầu từ CSDL theo mã
    const latestNhaThauListJV = window.appController.model.getLatestNhaThau();
    const foundLeadNt = leadCode
        ? latestNhaThauListJV.find(n => n.maNhaThau && n.maNhaThau.trim().toLowerCase() === leadCode.trim().toLowerCase())
        : null;
    const leadName = tr._leadMemberName || (foundLeadNt ? foundLeadNt.tenNhaThau : '');
    const displayLeadCode = leadCode || 'Chưa nhập';

    body.innerHTML = `
        <div style="background: var(--primary-soft); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">Thành viên đứng đầu liên danh</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-light); margin-bottom: 4px; display: block;">Mã/MST thành viên đứng đầu</label>
                    <input type="text" class="form-control" value="${displayLeadCode}" readonly style="padding: 6px 10px; font-size: 0.85rem; width:100%; background: rgba(0,0,0,0.05); cursor: not-allowed;">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-light); margin-bottom: 4px; display: block;">Tên thành viên đứng đầu</label>
                    <input type="text" id="jv-input-lead-name" class="form-control" required placeholder="Tên thành viên đứng đầu" value="${leadName}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
                </div>
            </div>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 0.88rem; font-weight: 800;">Danh sách Thành viên liên danh</h4>
            <button type="button" class="btn btn-primary btn-sm" id="btn-add-mothau-jv-member" style="padding: 4px 10px; font-size: 0.75rem;">
                + Thêm thành viên
            </button>
        </div>
        
        <div id="mothau-jv-members-list" style="display: flex; flex-direction: column; gap: 12px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
            <!-- Member inputs dynamic list -->
        </div>
    `;

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = `
        <button type="button" class="btn btn-outline" id="btn-cancel-mothau-jv">Hủy</button>
        <button type="button" class="btn btn-primary" id="btn-save-mothau-jv">Xác nhận</button>
    `;

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    modal.appendChild(card);
    document.body.appendChild(modal);

    const listContainer = document.getElementById('mothau-jv-members-list');

    const addMemberRow = (member = { tenNhaThau: '', maSoThue: '' }) => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'mothau-jv-member-row';
        rowDiv.style.display = 'grid';
        rowDiv.style.gridTemplateColumns = '1fr 1fr auto';
        rowDiv.style.gap = '10px';
        rowDiv.style.alignItems = 'center';
        rowDiv.style.padding = '8px';
        rowDiv.style.border = '1px solid var(--border-color)';
        rowDiv.style.borderRadius = 'var(--radius-sm)';
        rowDiv.style.background = 'var(--bg-nested, rgba(0,0,0,0.02))';

        rowDiv.innerHTML = `
            <div class="form-group" style="margin-bottom: 0;">
                <input type="text" class="jv-input-mst" required placeholder="Mã số thuế / Mã nhà thầu" value="${member.maSoThue || ''}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <input type="text" class="jv-input-ten" required placeholder="Tên nhà thầu thành viên" value="${member.tenNhaThau || ''}" style="padding: 6px 10px; font-size: 0.85rem; width:100%;">
            </div>
            <button type="button" class="action-btn btn-delete btn-remove-jv-row" style="padding: 6px; border:none; background:none;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
        `;

        rowDiv.querySelector('.btn-remove-jv-row').onclick = () => {
            rowDiv.remove();
        };

        // Tự động tra cứu tên khi nhập mã thành viên
        const mstInput = rowDiv.querySelector('.jv-input-mst');
        const tenInput = rowDiv.querySelector('.jv-input-ten');
        mstInput.addEventListener('blur', () => {
            const code = mstInput.value.trim();
            if (!code || tenInput.value.trim()) return; // Không ghi đè nếu đã có tên
            const found = latestNhaThauListJV.find(n =>
                n.maNhaThau && n.maNhaThau.trim().toLowerCase() === code.toLowerCase()
            );
            if (found) tenInput.value = found.tenNhaThau;
        });

        listContainer.appendChild(rowDiv);
        lucide.createIcons({ root: rowDiv });
    };

    if (members.length > 0) {
        members.forEach(m => addMemberRow(m));
    } else {
        addMemberRow();
    }

    document.getElementById('btn-add-mothau-jv-member').onclick = () => addMemberRow();

    const closeModal = () => modal.remove();
    document.getElementById('btn-close-mothau-jv').onclick = closeModal;
    document.getElementById('btn-cancel-mothau-jv').onclick = closeModal;

    document.getElementById('btn-save-mothau-jv').onclick = () => {
        const leadNameInput = document.getElementById('jv-input-lead-name').value.trim();
        if (!leadNameInput) {
            window.appController.view.customAlert('Thiếu thông tin', 'Vui lòng nhập tên thành viên đứng đầu liên danh!', 'alert-triangle', '#jv-input-lead-name');
            return;
        }

        const rows = listContainer.querySelectorAll('.mothau-jv-member-row');
        const updatedMembers = [];
        const invalidInputs = [];
        let valid = true;

        rows.forEach(r => {
            const inputTen = r.querySelector('.jv-input-ten');
            const inputMst = r.querySelector('.jv-input-mst');
            const ten = inputTen?.value.trim() || '';
            const mst = inputMst?.value.trim() || '';

            if (ten && mst) {
                updatedMembers.push({ tenNhaThau: ten, maSoThue: mst });
            } else if (ten || mst) {
                valid = false;
                if (!ten && inputTen) invalidInputs.push(inputTen);
                if (!mst && inputMst) invalidInputs.push(inputMst);
            }
        });

        if (!valid) {
            window.appController.view.customAlert('Thiếu thông tin', 'Vui lòng điền đầy đủ cả Tên nhà thầu và Mã số thuế của Thành viên liên danh!', 'alert-triangle', invalidInputs);
            return;
        }

        tr._leadMemberName = leadNameInput;
        tr._thanhVienLienDanh = updatedMembers;

        const labelSpan = tr.querySelector('.mt-jv-btn-text') || tr.querySelector('.row-jv-btn-text');
        if (labelSpan) {
            labelSpan.textContent = `Thành viên liên danh (${updatedMembers.length})`;
        }

        closeModal();
    };

    lucide.createIcons({ root: modal });
};


window.showNhaThauDetailsAndCloseJV = (ntId) => {
    const jvModal = document.getElementById('modal-mothau-jv-view');
    if (jvModal) jvModal.remove();
    if (window.showNhaThauDetails) {
        window.showNhaThauDetails(ntId);
    }
};

window.openMoThauJVViewModal = (members, leadName, leadCode) => {
    const modalId = 'modal-mothau-jv-view';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay active';
    modal.style.zIndex = '2000';

    const card = document.createElement('div');
    card.className = 'modal-card';
    card.style.maxWidth = '600px';
    card.style.width = '95%';
    card.style.margin = '20px auto';

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv-view">&times;</button>
    `;

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.padding = '20px';

    const displayLeadName = leadName || 'Chưa cập nhật';
    const displayLeadCode = leadCode || 'Chưa cập nhật';

    // Helper function to resolve contractor ID
    const findNhaThauId = (code, name) => {
        const list = window.appController?.model?.state?.nhathau || [];
        let found = null;
        if (code && code !== 'Chưa cập nhật') {
            found = list.find(n => (n.maNhaThau && n.maNhaThau.trim().toLowerCase() === code.trim().toLowerCase()) || 
                                 (n.maSoThue && n.maSoThue.trim().toLowerCase() === code.trim().toLowerCase()));
        }
        if (!found && name && name !== 'Chưa cập nhật') {
            found = list.find(n => n.tenNhaThau && n.tenNhaThau.trim().toLowerCase() === name.trim().toLowerCase());
        }
        return found ? found.id : null;
    };

    const leadNtId = findNhaThauId(displayLeadCode, displayLeadName);
    const leadCodeHtml = leadNtId 
        ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${leadNtId}" class="text-blue fw-bold link-hover" style="text-decoration: none;">${displayLeadCode}</a>` 
        : displayLeadCode;
    const leadNameHtml = leadNtId 
        ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${leadNtId}" class="text-blue fw-bold link-hover" style="text-decoration: none;">${displayLeadName}</a>` 
        : displayLeadName;

    let membersHtml = '';
    if (members.length === 0) {
        membersHtml = `<div style="text-align: center; color: var(--text-muted); padding: 12px;"><small>Không có Thành viên liên danh</small></div>`;
    } else {
        membersHtml = members.map((m, idx) => {
            const memberNtId = findNhaThauId(m.maSoThue, m.tenNhaThau);
            const mCodeHtml = memberNtId 
                ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${memberNtId}" class="text-blue fw-bold link-hover" style="text-decoration: none;">${m.maSoThue || '--'}</a>` 
                : (m.maSoThue || '--');
            const mNameHtml = memberNtId 
                ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${memberNtId}" class="text-blue fw-bold link-hover" style="text-decoration: none;">${m.tenNhaThau || '--'}</a>` 
                : (m.tenNhaThau || '--');

            return `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-nested, rgba(0,0,0,0.01)); margin-bottom: 8px;">
                    <div>
                        <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Mã số thuế / Mã nhà thầu</div>
                        <div style="font-size: 0.85rem; font-weight: 600;">${mCodeHtml}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Tên thành viên ${idx + 2}</div>
                        <div style="font-size: 0.85rem; font-weight: 600;">${mNameHtml}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    body.innerHTML = `
        <div style="background: var(--primary-soft); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">Thành viên đứng đầu liên danh</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Mã/MST thành viên đứng đầu</div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${leadCodeHtml}</div>
                </div>
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Tên thành viên đứng đầu</div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${leadNameHtml}</div>
                </div>
            </div>
        </div>
        
        <h4 style="margin: 0 0 12px 0; font-size: 0.88rem; font-weight: 800;">Danh sách Thành viên liên danh</h4>
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto; padding-right: 4px;">
            ${membersHtml}
        </div>
    `;

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = `
        <button type="button" class="btn btn-primary" id="btn-ok-mothau-jv-view">Đóng</button>
    `;

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    modal.appendChild(card);
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    document.getElementById('btn-close-mothau-jv-view').onclick = closeModal;
    document.getElementById('btn-ok-mothau-jv-view').onclick = closeModal;
};


export function addMoThauRow(caseType, gt, bidData = {}, readOnly = false) {
    const tbody = document.getElementById('mothau-table-tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.setAttribute('data-id', bidData.id || window.generateUUID());
    let ntCode = bidData.maNhaThau || '';
    let ntName = bidData.tenNhaThau || '';
    let ntType = bidData.loaiNhaThau || 'Độc lập';
    let jvMembers = bidData.thanhVienLienDanh || [];

    const latestNhaThauList = this.model.getLatestNhaThau();
    let foundNt = null;
    if (bidData.nhaThauId) {
        foundNt = latestNhaThauList.find(n => n.id === bidData.nhaThauId || n.rootId === bidData.nhaThauId);
    }
    if (!foundNt && ntCode) {
        foundNt = latestNhaThauList.find(n => n.maNhaThau && n.maNhaThau.trim().toLowerCase() === ntCode.trim().toLowerCase());
    }

    if (foundNt) {
        if (!ntCode) ntCode = foundNt.maNhaThau || '';
        // Với liên danh: giữ nguyên tên liên danh đã lưu (bidData.tenNhaThau),
        // không ghi đè bằng tên thành viên đứng đầu từ CSDL.
        if (ntType !== 'Liên danh') {
            ntName = foundNt.tenNhaThau || bidData.tenNhaThau || '';
        }
        if (bidData.loaiNhaThau === undefined && foundNt.loaiNhaThau) {
            ntType = foundNt.loaiNhaThau;
        }
        if (jvMembers.length === 0 && foundNt.thanhVienLienDanh) {
            jvMembers = foundNt.thanhVienLienDanh;
        }
    }

    // tr._thanhVienLienDanh chỉ lưu trữ các Thành viên liên danh (lọc bỏ thành viên đứng đầu)
    tr._thanhVienLienDanh = (jvMembers || []).filter(m => m.vaiTro !== "Đứng đầu liên danh" && m.maSoThue !== ntCode);

    const leadM = (jvMembers || []).find(m => m.vaiTro === "Đứng đầu liên danh" || (m.maSoThue && String(m.maSoThue).toLowerCase().trim() === String(ntCode).toLowerCase().trim()));
    tr._leadMemberName = leadM ? leadM.tenNhaThau : '';
    if (!tr._leadMemberName && ntCode) {
        const foundLeadNt = latestNhaThauList.find(n => n.maNhaThau && String(n.maNhaThau).toLowerCase().trim() === String(ntCode).toLowerCase().trim());
        if (foundLeadNt) {
            tr._leadMemberName = foundLeadNt.tenNhaThau;
        }
    }

    const typeSelectHtml = readOnly
        ? `<span style="font-size:0.9rem;">${ntType}</span>`
        : `<select class="form-control mt-loai-nha-thau" required>
            <option value="Độc lập" ${ntType === 'Độc lập' ? 'selected' : ''}>Độc lập</option>
            <option value="Liên danh" ${ntType === 'Liên danh' ? 'selected' : ''}>Liên danh</option>
        </select>`;

    // lot selection options if available
    const lotList = gt.phanLoList || [];
    const lotOptions = lotList.map(l => `<option value="${l.maPhanLo}" data-name="${l.tenPhanLo}">${l.maPhanLo}</option>`).join('');

    let cellHtml = '';

    const jvBtnCount = (bidData.thanhVienLienDanh || []).length;
    // In read-only mode show JV member count as a clickable link that opens a view-only modal
    const jvDetailsHtml = readOnly
        ? (ntType === 'Liên danh' ? `<div style="margin-top:4px; font-size:0.78rem;"><a href="#" class="mt-jv-view-link" style="color:var(--primary); text-decoration:none; font-weight:600; display:inline-flex; align-items:center; gap:4px;">👥 Liên danh ${jvBtnCount} thành viên</a></div>` : '')
        : `<div class="mt-jv-members-container" style="margin-top: 4px; display: ${ntType === 'Liên danh' ? 'block' : 'none'};">
            <button type="button" class="btn btn-outline btn-xs mt-btn-manage-members" style="padding: 2px 6px; font-size: 0.72rem; font-weight: 700; border-style: dashed; width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--primary); border-color: var(--primary-soft);">
                <i data-lucide="users" style="width: 12px; height: 12px;"></i>
                <span class="mt-jv-btn-text">Thành viên liên danh (${jvBtnCount})</span>
            </button>
        </div>`;

    if (caseType === 'TU_VAN') {
        cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${bidData.hieuLucHsdxt || (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}</td>
            <td>${bidData.thoiGianThucHien || gt.thoiGianThucHien || '--'}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${ntCode || bidData.maDinhDanh || ''}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${bidData.hieuLucHsdxt || (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${bidData.thoiGianThucHien || gt.thoiGianThucHien || ''}" required placeholder="Ví dụ: 120 ngày"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
    } else if (caseType === '1G2T_NO_LOT') {
        cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.damBaoDuThau) || this.model.formatVND(gt.giaTriDamBaoDuThau) || '--'}</td>
            <td>${bidData.hieuLucDamBao || (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}</td>
            <td>${bidData.hieuLucHsdxt || (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${ntCode || bidData.maDinhDanh || ''}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.damBaoDuThau) || this.model.formatVND(gt.giaTriDamBaoDuThau) || ''}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${bidData.hieuLucDamBao || (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}" placeholder="Hiệu lực bảo đảm"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${bidData.hieuLucHsdxt || (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" required placeholder="Hiệu lực"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;

    } else if (caseType === '1G2T_WITH_LOT') {
        let defaultLotBaoDam = '';
        if (bidData.maPhanLo) {
            const foundLot = lotList.find(l => l.maPhanLo === bidData.maPhanLo);
            if (foundLot) defaultLotBaoDam = this.model.formatVND(foundLot.baoDamDuThau) || '';
        }
        cellHtml = readOnly ? `
            <td>${bidData.maPhanLo || '--'}</td>
            <td>${bidData.tenPhanLo || '--'}</td>
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.damBaoDuThau) || defaultLotBaoDam || '--'}</td>
            <td>${bidData.hieuLucDamBao || (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}</td>
            <td>${bidData.hieuLucHsdxt || (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${bidData.tenPhanLo || ''}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${ntCode || bidData.maDinhDanh || ''}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.damBaoDuThau) || defaultLotBaoDam}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${bidData.hieuLucDamBao || (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}" placeholder="Hiệu lực ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${bidData.hieuLucHsdxt || (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" required placeholder="Hiệu lực"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
    } else if (caseType === '1G1T_NO_LOT') {
        cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || '--'}</td>
            <td style="text-align:right;">${(bidData.tyLeGiamGia || 0).toString().replace('.', ',')}</td>
            <td>${this.model.formatVND(bidData.giaSauGiamGia) || '--'}</td>
            <td>${(bidData.hieuLucHsdt || gt.hieuLucHsdt || 90) ? (bidData.hieuLucHsdt || gt.hieuLucHsdt || 90) + ' ngày' : '--'}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || this.model.formatVND(gt.giaTriDamBaoDuThau) || '--'}</td>
            <td style="text-align:right;">${(bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120) ? (bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120) + ' ngày' : '--'}</td>
            <td>${bidData.thoiGianThucHien || gt.thoiGianThucHien || '--'}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${ntCode || bidData.maDinhDanh || ''}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || ''}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${(bidData.tyLeGiamGia || 0).toString().replace('.', ',')}" required style="text-align: right;" placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(bidData.giaSauGiamGia) || ''}" readonly placeholder="Tự tính" style="background: var(--bg-input-disabled, #f1f5f9); cursor: not-allowed;"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + ' ngày' : (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" required placeholder="Hiực lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || this.model.formatVND(gt.giaTriDamBaoDuThau) || ''}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + ' ngày' : (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}" required style="text-align: right;"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${bidData.thoiGianThucHien || gt.thoiGianThucHien || ''}" required placeholder="Thực hiện"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
    } else if (caseType === '1G1T_WITH_LOT') {
        let defaultLotBaoDam = '';
        if (bidData.maPhanLo) {
            const foundLot = lotList.find(l => l.maPhanLo === bidData.maPhanLo);
            if (foundLot) defaultLotBaoDam = this.model.formatVND(foundLot.baoDamDuThau) || '';
        }
        cellHtml = readOnly ? `
            <td>${bidData.maPhanLo || '--'}</td>
            <td>${bidData.tenPhanLo || '--'}</td>
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || '--'}</td>
            <td style="text-align:right;">${(bidData.tyLeGiamGia || 0).toString().replace('.', ',')}</td>
            <td>${this.model.formatVND(bidData.giaSauGiamGia) || '--'}</td>
            <td>${(bidData.hieuLucHsdt || gt.hieuLucHsdt || 90) ? (bidData.hieuLucHsdt || gt.hieuLucHsdt || 90) + ' ngày' : '--'}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || defaultLotBaoDam || '--'}</td>
            <td style="text-align:right;">${(bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120) ? (bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120) + ' ngày' : '--'}</td>
            <td>${bidData.thoiGianThucHien || gt.thoiGianThucHien || '--'}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${bidData.tenPhanLo || ''}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${ntCode || bidData.maDinhDanh || ''}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || ''}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia" value="${(bidData.tyLeGiamGia || 0).toString().replace('.', ',')}" required style="text-align: right;" placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(bidData.giaSauGiamGia) || ''}" readonly placeholder="Tự tính" style="background: var(--bg-input-disabled, #f1f5f9); cursor: not-allowed;"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + ' ngày' : (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || defaultLotBaoDam}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + ' ngày' : (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}" required style="text-align: right;"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${bidData.thoiGianThucHien || gt.thoiGianThucHien || ''}" required placeholder="Thực hiện"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
    } else if (caseType === 'DIRECT_SPECIAL_NO_LOT') {
        const defaultDurationPkg = bidData.thoiGianThucHien || gt.thoiGianThucHien || '';

        cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau || gt.giaGoiThau) || '--'}</td>
            <td>${defaultDurationPkg}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${ntCode || bidData.maDinhDanh || ''}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau || gt.giaGoiThau) || ''}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${defaultDurationPkg}" required placeholder="Thời gian gói"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
    } else if (caseType === 'DIRECT_SPECIAL_WITH_LOT') {
        const defaultDurationPkg = bidData.thoiGianThucHien || gt.thoiGianThucHien || '';
        let defaultLotPrice = '';
        if (bidData.maPhanLo) {
            const foundLot = lotList.find(l => l.maPhanLo === bidData.maPhanLo);
            if (foundLot) defaultLotPrice = this.model.formatVND(foundLot.giaTriPhanLo) || '';
        }

        cellHtml = readOnly ? `
            <td>${bidData.maPhanLo || '--'}</td>
            <td>${bidData.tenPhanLo || '--'}</td>
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || defaultLotPrice || '--'}</td>
            <td>${defaultDurationPkg}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${bidData.tenPhanLo || ''}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${ntCode || bidData.maDinhDanh || ''}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || defaultLotPrice}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${defaultDurationPkg}" required placeholder="Thời gian gói"></td>
            <td style="text-align: center;"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
    }

    tr.innerHTML = cellHtml;

    const rowLotSelect = tr.querySelector('.mt-ma-phan-lo');
    if (rowLotSelect) {
        if (bidData.maPhanLo) rowLotSelect.value = bidData.maPhanLo;
        rowLotSelect.addEventListener('change', () => {
            const selectedOpt = rowLotSelect.options[rowLotSelect.selectedIndex];
            const nameInput = tr.querySelector('.mt-ten-phan-lo');
            if (nameInput) {
                nameInput.value = selectedOpt ? (selectedOpt.getAttribute('data-name') || '') : '';
            }

            // Autofill lot-level bid security & bid price
            const selectedLotCode = rowLotSelect.value;
            const chosenLot = lotList.find(l => l.maPhanLo === selectedLotCode);
            if (chosenLot) {
                const dbInput = tr.querySelector('.mt-dam-bao-du-thau');
                if (dbInput) dbInput.value = this.model.formatVND(chosenLot.baoDamDuThau) || '';

                const gtDbInput = tr.querySelector('.mt-gia-tri-dam-bao');
                if (gtDbInput) gtDbInput.value = this.model.formatVND(chosenLot.baoDamDuThau) || '';

                const giaInput = tr.querySelector('.mt-gia-du-thau');
                if (giaInput && !giaInput.value.trim()) {
                    giaInput.value = this.model.formatVND(chosenLot.giaTriPhanLo) || '';
                }
            }
        });
    }

    // Toggle Joint Venture elements based on type dropdown selection
    const selectLoai = tr.querySelector('.mt-loai-nha-thau');
    const jvContainer = tr.querySelector('.mt-jv-members-container');
    if (selectLoai && jvContainer) {
        selectLoai.addEventListener('change', () => {
            jvContainer.style.display = selectLoai.value === 'Liên danh' ? 'block' : 'none';
        });
    }

    const btnManage = tr.querySelector('.mt-btn-manage-members');
    if (btnManage) {
        btnManage.addEventListener('click', (e) => {
            e.preventDefault();
            window.openMoThauJVManager(tr);
        });
    }

    // Auto fill contractor name if code matches one in the database
    const inputMa = tr.querySelector('.mt-ma-nha-thau');
    const inputTen = tr.querySelector('.mt-ten-nha-thau');
    if (inputMa && inputTen) {
        const handleCodeChange = () => {
            const code = inputMa.value.trim();
            if (!code) return;
            const latestList = this.model.getLatestNhaThau();
            const matched = latestList.find(n => n.maNhaThau && n.maNhaThau.trim().toLowerCase() === code.toLowerCase());
            if (matched) {
                inputTen.value = matched.tenNhaThau || '';
                if (tr.querySelector('.mt-loai-nha-thau')?.value === 'Liên danh') {
                    tr._leadMemberName = matched.tenNhaThau || '';
                }
            }
        };
        inputMa.addEventListener('input', handleCodeChange);
        inputMa.addEventListener('change', handleCodeChange);
    }

    // Auto populate contract execution duration based on package execution duration
    const inputPkgDuration = tr.querySelector('.mt-thoi-gian-thuc-hien');
    const inputCtrDuration = tr.querySelector('.mt-thoi-gian-thuc-hien-hop-dong');
    if (inputPkgDuration && inputCtrDuration) {
        inputPkgDuration.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            inputCtrDuration.value = val ? (val + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '';
        });
    }

    // Bind focus/blur listeners for ' ngày' suffix on validity inputs
    tr.querySelectorAll('.mt-hieu-luc-hsdt, .mt-hieu-luc-hsdxt, .mt-hieu-luc-dam-bao, .mt-hieu-luc-bao-dam-ngay').forEach(input => {
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

    // Bind currency auto formatters
    tr.querySelectorAll('.mt-format-vnd').forEach(input => {
        input.addEventListener('input', (e) => {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;
            e.target.value = this.model.formatVND(e.target.value);
            const newLength = e.target.value.length;
            e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));
        });
    });

    // Auto calculate final price after discount
    const recalculateDiscountPrice = () => {
        const inputGia = tr.querySelector('.mt-gia-du-thau');
        const inputTyLe = tr.querySelector('.mt-ty-le-giam-gia');
        const inputSauGiam = tr.querySelector('.mt-gia-sau-giam-gia');
        if (inputGia && inputTyLe && inputSauGiam) {
            const price = this.model.parseVND(inputGia.value);
            const discountPercentStr = (inputTyLe.value || '0').replace(/,/g, '.');
            const discountPercent = parseFloat(discountPercentStr) || 0;
            const finalPrice = price * (1 - discountPercent / 100);
            inputSauGiam.value = this.model.formatVND(finalPrice);
        }
    };

    const inputGia = tr.querySelector('.mt-gia-du-thau');
    const inputTyLe = tr.querySelector('.mt-ty-le-giam-gia');
    if (inputGia) inputGia.addEventListener('input', recalculateDiscountPrice);
    if (inputTyLe) {
        inputTyLe.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\./g, ',');
            const parts = val.split(',');
            if (parts.length > 2) {
                val = parts[0] + ',' + parts.slice(1).join('').replace(/,/g, '');
            }
            val = val.replace(/[^0-9,]/g, '');
            if (e.target.value !== val) {
                const cursorPosition = e.target.selectionStart;
                e.target.value = val;
                e.target.setSelectionRange(cursorPosition, cursorPosition);
            }
            recalculateDiscountPrice();
        });
        inputTyLe.addEventListener('change', recalculateDiscountPrice);
    }

    // Remove row event listener — only bind when not read-only
    const removeBtn = tr.querySelector('.mt-remove-row');
    if (removeBtn) {
        removeBtn.onclick = async () => {
            const confirmed = await this.view.customConfirm('Xác nhận xóa', 'Bạn có chắc chắn muốn gỡ nhà thầu này khỏi danh sách nộp hồ sơ?', 'trash-2');
            if (confirmed) {
                tr.remove();
                if (tbody.children.length === 0) {
                    this.addMoThauRow(caseType, gt);
                    lucide.createIcons();
                }
            }
        };
    }

    tbody.appendChild(tr);

    // Bind read-only JV view link
    const jvViewLink = tr.querySelector('.mt-jv-view-link');
    if (jvViewLink) {
        jvViewLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.openMoThauJVViewModal(tr._thanhVienLienDanh || [], tr._leadMemberName || ntName, ntCode);
        });
    }
    if (typeof this.unifyTableInputsHeight === 'function') {
        this.unifyTableInputsHeight(document);
    }
}


export async function saveThongTinMoThau() {
    const select = document.getElementById('mothau-goithau-select');
    if (!select) return;
    const gtId = select.value;
    if (!gtId) {
        await this.view.customAlert('Chưa chọn gói thầu', 'Vui lòng chọn một gói thầu để lưu!', 'alert-triangle');
        return;
    }

    const gt = this.model.state.goithau.find(g => g.id === gtId);
    if (!gt) return;

    // Calculate if Step 2 (Evaluation HSĐXKT / HSDT) is already completed
    const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
    let isNextStepSaved = false;
    if (gt.danhGiaHsdtMetadata) {
        try {
            const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
            if (is1G2T) {
                isNextStepSaved = !!(parsed.is1G2T && parsed.technical && parsed.technical.saved);
            } else {
                isNextStepSaved = !!parsed.saved;
            }
        } catch (e) { }
    }

    const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
    const isAllowedToSave = isDirectOrSpecial
        ? (gt.trangThai !== 'Đã có kết quả')
        : (gt.trangThai === 'Đang mời thầu' || gt.trangThai === 'Đã mở thầu' || (gt.trangThai === 'Đang chấm thầu' && !isNextStepSaved));

    if (!isAllowedToSave) {
        await this.view.customAlert(
            'Không thể lưu',
            `Không thể chỉnh sửa biên bản mở thầu của gói thầu này vì trạng thái hiện tại là "${gt.trangThai}" và giai đoạn tiếp theo đã hoàn tất.`,
            'x-circle'
        );
        return;
    }

    if (isDirectOrSpecial) {
        if (!gt.thoiGianMoThau) {
            gt.thoiGianMoThau = this.model.getCurrentDateTimeString();
        }
        if (!gt.thoiGianDongThau) {
            gt.thoiGianDongThau = gt.thoiGianMoThau;
        }
    } else {
        const inputOpTime = document.getElementById('op-thoigianmothau');
        if (inputOpTime && inputOpTime.value) {
            gt.thoiGianMoThau = this.model.convertDMYHMSToYMDHMS(inputOpTime.value);
        } else if (!gt.thoiGianMoThau) {
            gt.thoiGianMoThau = this.model.getCurrentDateTimeString();
        }
    }

    const rows = document.querySelectorAll('#mothau-table-tbody tr');
    let hasInvalid = false;
    const invalidInputs = [];

    rows.forEach(tr => {
        const inputMa = tr.querySelector('.mt-ma-nha-thau');
        const inputTen = tr.querySelector('.mt-ten-nha-thau');
        const maNhaThau = inputMa ? inputMa.value.trim() : '';
        const tenNhaThau = inputTen ? inputTen.value.trim() : '';

        let rowInvalid = false;
        if (!maNhaThau) {
            rowInvalid = true;
            if (inputMa) invalidInputs.push(inputMa);
        }
        if (!tenNhaThau) {
            rowInvalid = true;
            if (inputTen) invalidInputs.push(inputTen);
        }

        if (rowInvalid) {
            hasInvalid = true;
            tr.classList.add('invalid');
        } else {
            tr.classList.remove('invalid');
        }
    });

    if (hasInvalid) {
        await this.view.customAlert('Thiếu dữ liệu', 'Vui lòng nhập đầy đủ Mã nhà thầu và Tên nhà thầu cho tất cả các dòng!', 'alert-triangle', invalidInputs);
        return;
    }

    const tempBids = [];
    const latestNhaThauList = this.model.getLatestNhaThau();

    rows.forEach(tr => {
        const id = tr.getAttribute('data-id');
        const inputMa = tr.querySelector('.mt-ma-nha-thau');
        const inputTen = tr.querySelector('.mt-ten-nha-thau');
        const selectLoai = tr.querySelector('.mt-loai-nha-thau');

        const maNhaThau = inputMa ? inputMa.value.trim() : '';
        const tenNhaThau = inputTen ? inputTen.value.trim() : '';
        const loaiNhaThau = selectLoai ? selectLoai.value : 'Độc lập';

        // Look up by Contractor Code in latest version of Database
        let foundNt = latestNhaThauList.find(n =>
            n.maNhaThau && n.maNhaThau.trim().toLowerCase() === maNhaThau.trim().toLowerCase()
        );

        if (loaiNhaThau === 'Độc lập') {
            if (!foundNt) {
                // Register new Independent Contractor in Database!
                const newId = window.generateUUID();
                foundNt = {
                    id: newId,
                    maNhaThau: maNhaThau,
                    tenNhaThau: tenNhaThau,
                    loaiNhaThau: 'Độc lập',
                    maSoThue: maNhaThau,
                    nguoiDaiDien: '',
                    danhXung: 'Ông',
                    soDienThoai: '',
                    email: '',
                    diaChi: '',
                    soTaiKhoan: '',
                    noiMoTaiKhoan: '',
                    maNganHang: '',
                    thanhVienLienDanh: [],
                    phienBan: 0
                };
                this.model.state.nhathau.push(foundNt);
                this.model.persistData('nhathau');

                // Add to temporary list to ensure it can be found in subsequent rows of the same save operation
                latestNhaThauList.push(foundNt);
            } else {
                if (foundNt.loaiNhaThau !== 'Độc lập') {
                    const dbNt = this.model.state.nhathau.find(n => n.id === foundNt.id);
                    if (dbNt) {
                        dbNt.loaiNhaThau = 'Độc lập';
                        this.model.persistData('nhathau');
                    }
                }
            }
        } else {
            // JV: The leading member is treated as an independent contractor
            if (!foundNt) {
                const newId = window.generateUUID();
                foundNt = {
                    id: newId,
                    maNhaThau: maNhaThau,
                    tenNhaThau: tr._leadMemberName || ("Thành viên đứng đầu " + maNhaThau),
                    loaiNhaThau: 'Độc lập',
                    maSoThue: maNhaThau,
                    nguoiDaiDien: '',
                    danhXung: 'Ông',
                    soDienThoai: '',
                    email: '',
                    diaChi: '',
                    soTaiKhoan: '',
                    noiMoTaiKhoan: '',
                    maNganHang: '',
                    thanhVienLienDanh: [],
                    phienBan: 0
                };
                this.model.state.nhathau.push(foundNt);
                this.model.persistData('nhathau');
                latestNhaThauList.push(foundNt);
            } else {
                if (tr._leadMemberName) {
                    const dbNt = this.model.state.nhathau.find(n => n.id === foundNt.id);
                    if (dbNt) {
                        dbNt.tenNhaThau = tr._leadMemberName;
                        this.model.persistData('nhathau');
                    }
                }
            }

            // Loop through all JV sub-members and add them as Independent Contractors if not exist
            const subMembers = tr._thanhVienLienDanh || [];
            subMembers.forEach(member => {
                if (!member.maSoThue) return;
                let subNt = latestNhaThauList.find(n =>
                    n.maNhaThau && n.maNhaThau.trim().toLowerCase() === member.maSoThue.trim().toLowerCase()
                );
                if (!subNt) {
                    const newSubId = window.generateUUID();
                    subNt = {
                        id: newSubId,
                        maNhaThau: member.maSoThue,
                        tenNhaThau: member.tenNhaThau,
                        loaiNhaThau: 'Độc lập',
                        maSoThue: member.maSoThue,
                        nguoiDaiDien: member.nguoiDaiDien || '',
                        danhXung: member.danhXung || 'Ông',
                        soDienThoai: member.soDienThoai || '',
                        email: member.email || '',
                        diaChi: member.diaChi || '',
                        soTaiKhoan: member.soTaiKhoan || '',
                        noiMoTaiKhoan: member.noiMoTaiKhoan || '',
                        maNganHang: member.maNganHang || '',
                        thanhVienLienDanh: [],
                        phienBan: 0
                    };
                    this.model.state.nhathau.push(subNt);
                    this.model.persistData('nhathau');
                    latestNhaThauList.push(subNt);
                }
            });
        }

        // Đối với liên danh: giữ nguyên tên người dùng nhập (tên liên danh),
        // vì mã nhà thầu liên danh là mã của thành viên đứng đầu nhưng tên phải là tên liên danh.
        // Đối với độc lập: ưu tiên tên trong CSDL nếu tìm thấy.
        const resolvedTenNhaThau = (loaiNhaThau === 'Liên danh')
            ? tenNhaThau
            : (foundNt ? foundNt.tenNhaThau : tenNhaThau);

        const nhaThauId = foundNt.id;
        const maDinhDanh = tr.querySelector('.mt-ma-dinh-danh')?.value.trim() || '';
        const maPhanLo = tr.querySelector('.mt-ma-phan-lo')?.value || '';
        const tenPhanLo = tr.querySelector('.mt-ten-phan-lo')?.value.trim() || '';
        const giaDuThau = this.model.parseVND(tr.querySelector('.mt-gia-du-thau')?.value || '');
        const damBaoDuThau = this.model.parseVND(tr.querySelector('.mt-dam-bao-du-thau')?.value || '');
        const hieuLucDamBao = tr.querySelector('.mt-hieu-luc-dam-bao')?.value.trim() || '';
        const hieuLucHsdxt = tr.querySelector('.mt-hieu-luc-hsdxt')?.value.trim() || '';
        const tyLeGiamGiaRaw = tr.querySelector('.mt-ty-le-giam-gia')?.value || '0';
        const tyLeGiamGia = parseFloat(tyLeGiamGiaRaw.replace(/,/g, '.')) || 0;
        const giaSauGiamGia = this.model.parseVND(tr.querySelector('.mt-gia-sau-giam-gia')?.value || '');
        const hieuLucHsdt = parseInt(tr.querySelector('.mt-hieu-luc-hsdt')?.value || '0', 10);
        const giaTriDamBao = this.model.parseVND(tr.querySelector('.mt-gia-tri-dam-bao')?.value || '');
        const hieuLucBaoDamNgay = parseInt(tr.querySelector('.mt-hieu-luc-bao-dam-ngay')?.value || '0', 10);
        const thoiGianThucHien = tr.querySelector('.mt-thoi-gian-thuc-hien')?.value.trim() || '';
        const thoiGianThucHienHopDong = tr.querySelector('.mt-thoi-gian-thuc-hien-hop-dong')?.value.trim() || '';

        let bidJvMembers = [];
        if (loaiNhaThau === 'Liên danh') {
            bidJvMembers.push({
                tenNhaThau: tr._leadMemberName || foundNt.tenNhaThau || "Thành viên đứng đầu " + maNhaThau,
                maSoThue: foundNt ? (foundNt.maSoThue || '') : '',
                vaiTro: "Đứng đầu liên danh"
            });
            const subMembers = (tr._thanhVienLienDanh || []).filter(m =>
                String(m.maSoThue).toLowerCase().trim() !== String(maNhaThau).toLowerCase().trim() &&
                m.vaiTro !== "Đứng đầu liên danh"
            );
            subMembers.forEach(m => {
                bidJvMembers.push({
                    tenNhaThau: m.tenNhaThau,
                    maSoThue: m.maSoThue,
                    vaiTro: "Thành viên liên danh"
                });
            });
        }

        tempBids.push({
            id,
            goiThauId: gtId,
            nhaThauId,
            maPhanLo,
            tenPhanLo,
            maDinhDanh,
            giaDuThau,
            damBaoDuThau,
            hieuLucDamBao,
            hieuLucHsdxt,
            tyLeGiamGia,
            giaSauGiamGia,
            hieuLucHsdt,
            giaTriDamBao,
            hieuLucBaoDamNgay,
            thoiGianThucHien,
            thoiGianThucHienHopDong,
            tenNhaThau: resolvedTenNhaThau,
            loaiNhaThau: loaiNhaThau,
            thanhVienLienDanh: bidJvMembers,
            danhGiaHopLe: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaNangLuc: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaKyThuat: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaKetLuan: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaTaiChinh: isDirectOrSpecial ? 'Xếp hạng 1' : ''
        });
    });


    // Replace old bids with newly validated set
    this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) !== String(gtId));
    this.model.state.thongtinmothau.push(...tempBids);

    this.model.persistData('thongtinmothau');

    // Tự động chuyển trạng thái gói thầu sang "Đang chấm thầu" sau khi lưu mở thầu
    gt.trangThai = 'Đang chấm thầu';
    this.model.persistData('goithau');
    const stepKey = is1G2T ? 'opening_tech' : 'opening';
    if (this.view._editingState) {
        this.view._editingState[stepKey] = false;
    }
    this.view.renderGoiThauTable();

    this.autoSync();
    const successMsg = isDirectOrSpecial
        ? 'Đã lưu thành công dữ liệu nhà thầu'
        : `Đã lưu toàn bộ thông tin mở thầu (E-HSDT / E-HSĐXKT) của gói thầu "${gt.tenGoiThau}" thành công! Trạng thái gói thầu đã được chuyển sang Đang chấm thầu.`;
    await this.view.customAlert('Lưu thành công', successMsg, 'check-circle');

    // Làm mới dropdown mở thầu để loại bỏ gói vừa lưu
    this.renderMoThauPanel();

    // Tự động reload detail workflow và chuyển sang tab tương ứng
    const detailPane = document.getElementById('tab-goithau-detail');
    if (detailPane && detailPane.classList.contains('active')) {
        this.view._currentWorkflowTab = isDirectOrSpecial ? 'result' : 'eval_tech';
        this.view.showPackageDetails(gtId);
    }
}


/* ==========================================================================
   saveKetQuaChiDinhThau — Lưu kết quả LCNT cho Chỉ định thầu rút gọn
   và Lựa chọn nhà thầu trong trường hợp đặc biệt.
   Thực hiện 3 bước chạy ngầm:
     Bước 1: Ghi Biên bản mở thầu (thongtinmothau)
     Bước 2: Tự động đặt đánh giá "Đạt" (danhGiaHsdtMetadata)
     Bước 3: Lưu chính thức kết quả LCNT (goithau)
   Nếu bất kỳ bước nào thất bại → rollback toàn bộ.
   ========================================================================== */
export async function saveKetQuaChiDinhThau(gtId) {
    const gt = this.model.state.goithau.find(g => g.id === gtId);
    if (!gt) return;

    // ── Snapshot để rollback ──────────────────────────────────────────────────
    const snapshotGt = JSON.parse(JSON.stringify(gt));
    const snapshotBids = JSON.parse(JSON.stringify(
        this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId))
    ));

    // ── Đọc thông tin quyết định từ form ─────────────────────────────────────
    const decNo     = document.getElementById('award-decision-no')?.value.trim() || '';
    const decDateRaw= document.getElementById('award-decision-date')?.value || '';
    const decDate   = this.model.convertDMYToYMD(decDateRaw);

    const soBctdVal  = document.getElementById('award-so-bctd')?.value.trim() || '';
    const ngayBctdRaw= document.getElementById('award-ngay-bctd')?.value || '';
    const ngayBctdVal= this.model.convertDMYToYMD(ngayBctdRaw);

    // Đọc các trường ngày đánh giá năng lực nhà thầu
    const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
    let danhGiaNangLucVal = 'Không';
    let dateYcbgiRaw = '';
    let dateGbgiRaw = '';
    let dateBcdgRaw = '';
    let dateMttRaw = '';
    let dateTtRaw = '';
    let dateTkqRaw = '';

    if (isDirectOrSpecial) {
        const radChecked = document.querySelector('input[name="result-danh-gia-nang-luc"]:checked');
        if (radChecked) danhGiaNangLucVal = radChecked.value;

        dateYcbgiRaw = document.getElementById('date-yeu-cau-bao-gia')?.value || '';
        dateGbgiRaw  = document.getElementById('date-gui-bao-gia')?.value || '';
        if (danhGiaNangLucVal === 'Có') {
            dateBcdgRaw = document.getElementById('date-bao-cao-danh-gia')?.value || '';
        }
        dateMttRaw   = document.getElementById('date-moi-thuong-thao')?.value || '';
        dateTtRaw    = document.getElementById('date-thuong-thao')?.value || '';
        dateTkqRaw   = document.getElementById('date-trinh-ket-qua')?.value || '';
    }

    // ── Validate bắt buộc: số QĐ + ngày QĐ ──────────────────────────────────
    let hasError = false;
    const errorInputs = [];
    const validateField = (elId, val) => {
        const el = document.getElementById(elId);
        if (!val && el) {
            hasError = true;
            errorInputs.push(el);
            el.closest('.form-group')?.querySelector('.error-text') &&
                (el.closest('.form-group').querySelector('.error-text').style.display = 'block');
            el.closest('.form-group')?.classList.add('invalid');
            const clear = () => {
                el.closest('.form-group')?.querySelector('.error-text') &&
                    (el.closest('.form-group').querySelector('.error-text').style.display = 'none');
                el.closest('.form-group')?.classList.remove('invalid');
            };
            el.addEventListener('input', clear, { once: true });
            el.addEventListener('change', clear, { once: true });
        }
    };
    validateField('award-decision-no', decNo);
    validateField('award-decision-date', decDateRaw);
    if (document.getElementById('award-so-bctd'))  validateField('award-so-bctd', soBctdVal);
    if (document.getElementById('award-ngay-bctd')) validateField('award-ngay-bctd', ngayBctdRaw);

    if (isDirectOrSpecial) {
        validateField('date-yeu-cau-bao-gia', dateYcbgiRaw);
        validateField('date-gui-bao-gia', dateGbgiRaw);
        if (danhGiaNangLucVal === 'Có') {
            validateField('date-bao-cao-danh-gia', dateBcdgRaw);
        }
        validateField('date-moi-thuong-thao', dateMttRaw);
        validateField('date-thuong-thao', dateTtRaw);
        validateField('date-trinh-ket-qua', dateTkqRaw);
    }

    if (hasError) {
        if (errorInputs[0]) {
            errorInputs[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => errorInputs[0].focus({ preventScroll: true }), 300);
        }
        return;
    }

    // ── Đọc danh sách nhà thầu từ state model đã lưu ở tab Biên bản mở thầu ─
    const tempBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId));
    if (tempBids.length === 0) {
        await this.view.customAlert('Thiếu dữ liệu', 'Vui lòng nhập và lưu danh sách Nhà thầu tham dự tại tab "Biên bản mở thầu" trước!', 'alert-triangle');
        return;
    }

    // ── Kiểm tra có ít nhất 1 nhà thầu trúng thầu ───────────────────────────
    const tbodyResult = document.getElementById('approve-bidders-tbody');
    let winnerRows = [];
    if (tbodyResult) {
        tbodyResult.querySelectorAll('tr').forEach(tr => {
            const isDirectOrSpecial = (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
            if (isDirectOrSpecial) {
                winnerRows.push(tr);
            } else if (tr.querySelector('.row-status-select')?.value === 'trung') {
                winnerRows.push(tr);
            }
        });
    }

    try {
        // Đặt thời gian mở thầu nếu chưa có
        if (!gt.thoiGianMoThau) {
            gt.thoiGianMoThau = this.model.getCurrentDateTimeString();
        }
        gt.trangThai = 'Đang chấm thầu';
        this.model.persistData('goithau');

        // ════════════════════════════════════════════════════════════════════
        // BƯỚC 2 — Tự động đặt đánh giá "Đạt" cho tất cả nhà thầu
        // ════════════════════════════════════════════════════════════════════
        tempBids.forEach((bid, idx) => {
            const bidInState = this.model.state.thongtinmothau.find(b => b.id === bid.id);
            if (bidInState) {
                bidInState.danhGiaHopLe    = 'Đạt';
                bidInState.danhGiaNangLuc  = 'Đạt';
                bidInState.danhGiaKyThuat  = 'Đạt';
                bidInState.danhGiaKetLuan  = 'Đạt';
                bidInState.danhGiaTaiChinh = 'Xếp hạng 1';
            }
        });

        // Lưu metadata đánh giá tự động (không ghi đè nếu đã có saved = true)
        let existingMeta = {};
        try { existingMeta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {}; } catch (e) {}
        if (!existingMeta.saved) {
            const today = new Date().toISOString().split('T')[0];
            gt.danhGiaHsdtMetadata = JSON.stringify({
                ...existingMeta,
                soBaoCao: 'Tự động',
                ngayBaoCao: today,
                saved: true
            });
        }
        this.model.persistData('thongtinmothau');
        this.model.persistData('goithau');

        // ════════════════════════════════════════════════════════════════════
        // BƯỚC 3 — Commit kết quả LCNT chính thức
        // ════════════════════════════════════════════════════════════════════
        // Lấy thông tin thắng/thua từ bảng kết quả (approve-bidders-tbody)
        // Nếu chưa có bảng kết quả (winnerRows rỗng), mặc định hàng đầu tiên trúng thầu
        if (tbodyResult) {
            tbodyResult.querySelectorAll('tr').forEach(tr => {
                const bidId = tr.getAttribute('data-approve-bid-id');
                const bid   = this.model.state.thongtinmothau.find(b => b.id === bidId);
                if (bid) {
                    const status = tr.querySelector('.row-status-select')?.value;
                    if (status === 'trung') {
                        bid.lyDoTruot = '';
                    } else {
                        bid.lyDoTruot = tr.querySelector('.row-ly-do-truot')?.value.trim() || 'Nhà thầu xếp hạng 1 trúng thầu';
                    }
                }
            });
        }

        // Xác định nhà thầu trúng thầu
        let winnerId     = '';
        let winnerPrice  = 0;
        let winnerDurPkg = '';
        let winnerDurCtr = '';

        if (winnerRows.length > 0) {
            const wTr = winnerRows[0];
            winnerId     = wTr.getAttribute('data-nt-id') || '';
            winnerPrice  = this.model.parseVND(wTr.querySelector('.row-gia-trung')?.value || '0');
            winnerDurPkg = wTr.querySelector('.row-tg-goithau')?.value.trim() || '';
            winnerDurCtr = wTr.querySelector('.row-tg-hopdong')?.value.trim() || '';
        } else {
            // Fallback: nhà thầu đầu tiên trong danh sách trúng thầu
            const firstBid = tempBids[0];
            if (firstBid) {
                const foundNtForWinner = this.model.state.thongtinmothau.find(b => b.id === firstBid.id);
                if (foundNtForWinner) {
                    winnerId     = foundNtForWinner.nhaThauId || foundNtForWinner.id;
                    winnerPrice  = foundNtForWinner.giaSauGiamGia || foundNtForWinner.giaDuThau || 0;
                    winnerDurPkg = foundNtForWinner.thoiGianThucHien || gt.thoiGianThucHien || '';
                    winnerDurCtr = winnerDurPkg ? (winnerDurPkg + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '';
                }
            }
        }

        // Xử lý phân lô
        if (gt.phanLo === 'Có') {
            const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
            if (tbodyResult) {
                plList.forEach(pl => {
                    const lotWinnerTr = winnerRows.find(tr => tr.cells[0]?.textContent.trim() === pl.maPhanLo);
                    if (lotWinnerTr) {
                        const wId = lotWinnerTr.getAttribute('data-nt-id');
                        pl.nhaThauTrungThauId = wId ? (isNaN(wId) ? wId : parseInt(wId)) : '';
                        pl.giaTrungThau   = this.model.parseVND(lotWinnerTr.querySelector('.row-gia-trung')?.value || '0');
                        pl.thoiGianGoiThau= lotWinnerTr.querySelector('.row-tg-goithau')?.value.trim() || '';
                        pl.thoiGianHopDong= lotWinnerTr.querySelector('.row-tg-hopdong')?.value.trim() || '';
                    } else {
                        // Fallback: nhà thầu đầu tiên trong lô
                        const firstLotBid = tempBids.find(b => b.maPhanLo === pl.maPhanLo);
                        if (firstLotBid) {
                            const bidState = this.model.state.thongtinmothau.find(b => b.id === firstLotBid.id);
                            pl.nhaThauTrungThauId = bidState?.nhaThauId || '';
                            pl.giaTrungThau       = bidState?.giaSauGiamGia || bidState?.giaDuThau || 0;
                            pl.thoiGianGoiThau    = bidState?.thoiGianThucHien || gt.thoiGianThucHien || '';
                            pl.thoiGianHopDong    = pl.thoiGianGoiThau ? (pl.thoiGianGoiThau + ' + Thời gian thực hiện các nghĩa vụ theo hợp đồng') : '';
                        }
                    }
                });
                gt.phanLoList = plList;
            }
            if (winnerId) gt.nhaThauTrungThauId = isNaN(winnerId) ? winnerId : parseInt(winnerId);
            gt.giaTrungThau  = winnerRows.reduce((sum, tr) => sum + this.model.parseVND(tr.querySelector('.row-gia-trung')?.value || '0'), 0)
                               || (tempBids.reduce((sum, b) => {
                                   const bs = this.model.state.thongtinmothau.find(x => x.id === b.id);
                                   return sum + (bs?.giaSauGiamGia || bs?.giaDuThau || 0);
                               }, 0));
        } else {
            gt.nhaThauTrungThauId = winnerId ? (isNaN(winnerId) ? winnerId : parseInt(winnerId)) : '';
            gt.giaTrungThau  = winnerPrice;
            gt.thoiGianGoiThau = winnerDurPkg;
            gt.thoiGianHopDong = winnerDurCtr;
        }

        // Lưu metadata kết quả
        let metaFinal = {};
        try { metaFinal = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {}; } catch (e) {}
        if (!metaFinal.result) metaFinal.result = {};
        if (soBctdVal)  metaFinal.result.soBctdKetQua  = soBctdVal;
        if (ngayBctdVal)metaFinal.result.ngayBctdKetQua = ngayBctdVal;

        if (isDirectOrSpecial) {
            metaFinal.result.danhGiaNangLuc = danhGiaNangLucVal;
            metaFinal.result.ngayYeuCauBaoGia = this.model.convertDMYToYMD(dateYcbgiRaw);
            metaFinal.result.ngayGuiBaoGia = this.model.convertDMYToYMD(dateGbgiRaw);
            metaFinal.result.ngayBaoCaoDanhGiaNhaThau = dateBcdgRaw ? this.model.convertDMYToYMD(dateBcdgRaw) : '';
            metaFinal.result.ngayMoiThuongThao = this.model.convertDMYToYMD(dateMttRaw);
            metaFinal.result.ngayThuongThao = this.model.convertDMYToYMD(dateTtRaw);
            metaFinal.result.ngayTrinhKetQua = this.model.convertDMYToYMD(dateTkqRaw);
            metaFinal.result.ngayPheDuyetKetQua = decDate; // Trùng với Ngày ký quyết định
        }
        gt.danhGiaHsdtMetadata = JSON.stringify(metaFinal);

        gt.soQuyetDinhKetQua  = decNo;
        gt.ngayQuyetDinhKetQua= decDate;
        gt.trangThai          = 'Đã có kết quả';

        this.model.persistData('goithau');
        this.model.persistData('thongtinmothau');
        this.view.renderGoiThauTable();
        this.autoSync();

        await this.view.customAlert(
            'Chúc mừng',
            `Đã lưu và phê duyệt kết quả lựa chọn nhà thầu cho gói thầu "${gt.tenGoiThau}" thành công!`,
            'check-circle'
        );
        this.view._currentWorkflowTab = 'result';
        this.view.showPackageDetails(gtId);

    } catch (err) {
        // ── ROLLBACK ────────────────────────────────────────────────────────
        console.error('[saveKetQuaChiDinhThau] Lỗi trong chuỗi chạy ngầm, đang rollback...', err);

        // Khôi phục goithau
        const gtIndex = this.model.state.goithau.findIndex(g => g.id === gtId);
        if (gtIndex !== -1) {
            this.model.state.goithau[gtIndex] = snapshotGt;
        }

        // Khôi phục thongtinmothau
        this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(
            b => String(b.goiThauId) !== String(gtId)
        );
        this.model.state.thongtinmothau.push(...snapshotBids);

        try {
            this.model.persistData('goithau');
            this.model.persistData('thongtinmothau');
        } catch (rollbackErr) {
            console.error('[saveKetQuaChiDinhThau] Lỗi khi rollback:', rollbackErr);
        }

        await this.view.customAlert(
            'Lỗi hệ thống',
            `Đã xảy ra lỗi trong quá trình xử lý ngầm và hệ thống đã tự động hoàn tác toàn bộ thay đổi.\n\nChi tiết lỗi: ${err.message || String(err)}\n\nVui lòng thử lại hoặc liên hệ hỗ trợ.`,
            'x-circle'
        );
    }
}
