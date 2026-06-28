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

    // Giá trị thoiGianMoThauStr trả về định dạng dd/MM/yyyy HH:mm
    const parts = cleanStr.split(' ');
    const dateParts = parts[0].split('/');
    const timeParts = (parts[1] || '').split(':');
    const d = parseInt(dateParts[0]), m = parseInt(dateParts[1]), y = parseInt(dateParts[2]);
    const hh = parseInt(timeParts[0] || 0), mm = parseInt(timeParts[1] || 0);

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

    // Reset validation state of form
    const form = document.getElementById('form-phathanh-hsmt');
    if (form) {
        form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));
    }

    // Populate the form fields
    document.getElementById('phathanh-gt-id').value = gt.id;
    document.getElementById('phathanh-magoithau').value = gt.maGoiThau || '';
    document.getElementById('phathanh-soquyetdinh').value = gt.soQuyetDinh || '';
    document.getElementById('phathanh-hieuluchsdt').value = gt.hieuLucHsdt || '';
    document.getElementById('phathanh-giatribaomothau').value = gt.giaTriDamBaoDuThau ? this.model.formatVND(gt.giaTriDamBaoDuThau) : '';

    if (this.view.fpPhathanhNgayQuyetDinh) {
        this.view.fpPhathanhNgayQuyetDinh.setDate(gt.ngayQuyetDinh ? new Date(gt.ngayQuyetDinh) : '');
    } else {
        document.getElementById('phathanh-ngayquyetdinh').value = gt.ngayQuyetDinh ? this.model.formatDate(gt.ngayQuyetDinh) : '';
    }

    if (this.view.fpPhathanhThoiGianDangTai) {
        this.view.fpPhathanhThoiGianDangTai.setDate(gt.thoiGianDangTai ? new Date(gt.thoiGianDangTai) : '');
    } else {
        document.getElementById('phathanh-thoigiandangtai').value = gt.thoiGianDangTai ? this.model.formatDateWithTime(gt.thoiGianDangTai) : '';
    }

    if (this.view.fpPhathanhThoiGianDongThau) {
        this.view.fpPhathanhThoiGianDongThau.setDate(gt.thoiGianDongThau ? new Date(gt.thoiGianDongThau) : '');
    } else {
        document.getElementById('phathanh-thoigiandongthau').value = gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '';
    }

    // Dynamically show/hide & set required status for single guarantee input based on package fields
    const isTuVan = gt.linhVuc === 'Tư vấn';
    const isPhanLo = gt.phanLo === 'Có';
    const baodamContainer = document.getElementById('phathanh-baodam-container');
    const baodamInput = document.getElementById('phathanh-giatribaomothau');
    const phanloBaodamContainer = document.getElementById('phathanh-phanlo-baodam-container');
    const phanloBaodamTbody = document.getElementById('phathanh-phanlo-baodam-tbody');

    if (baodamContainer && baodamInput && phanloBaodamContainer && phanloBaodamTbody) {
        if (isTuVan) {
            baodamContainer.style.display = 'none';
            baodamInput.removeAttribute('required');
            phanloBaodamContainer.style.display = 'none';
            phanloBaodamTbody.innerHTML = '';
        } else {
            if (isPhanLo) {
                baodamContainer.style.display = 'none';
                baodamInput.removeAttribute('required');

                phanloBaodamContainer.style.display = 'block';
                phanloBaodamTbody.innerHTML = '';

                const list = gt.phanLoList || [];
                list.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.setAttribute('data-id', item.id);
                    const baoDamVal = item.baoDamDuThau || '';
                    const giaTriVal = item.giaTriPhanLo || 0;
                    tr.innerHTML = `
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-code-input" value="${item.maPhanLo || ''}" placeholder="Mã..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-name-input" value="${item.tenPhanLo || ''}" placeholder="Tên..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-price-input mt-format-vnd" value="${giaTriVal ? this.model.formatVND(giaTriVal) : ''}" placeholder="Giá trị..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-baodam-input mt-format-vnd" required value="${baoDamVal ? this.model.formatVND(baoDamVal) : ''}" placeholder="Bảo đảm..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-duration-input" value="${item.thoiGianThucHien || ''}" placeholder="Thời gian..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                    `;
                    phanloBaodamTbody.appendChild(tr);

                    const setupInputFormat = (inp) => {
                        if (!inp) return;
                        inp.addEventListener('input', (e) => {
                            const cursorPosition = e.target.selectionStart;
                            const originalLength = e.target.value.length;
                            const parsed = this.model.parseVND(e.target.value);
                            e.target.value = this.model.formatVND(parsed);
                            const newLength = e.target.value.length;
                            e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));
                        });
                    };
                    setupInputFormat(tr.querySelector('.phathanh-pl-price-input'));
                    setupInputFormat(tr.querySelector('.phathanh-pl-baodam-input'));
                });
            } else {
                baodamContainer.style.display = 'block';
                baodamInput.setAttribute('required', '');
                baodamInput.setAttribute('required', 'true');
                baodamInput.value = gt.giaTriDamBaoDuThau ? this.model.formatVND(gt.giaTriDamBaoDuThau) : '';

                phanloBaodamContainer.style.display = 'none';
                phanloBaodamTbody.innerHTML = '';
            }
        }
    }

    this.view.openModal('modal-phathanh-hsmt');
}


export async function handlePhatHanhHsmtSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-phathanh-hsmt');
    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('phathanh-gt-id').value;
    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;

    const isTuVan = gt.linhVuc === 'Tư vấn';
    const isPhanLo = gt.phanLo === 'Có';

    // Validate inputs
    const maGoiThauVal = document.getElementById('phathanh-magoithau').value.trim();
    if (!maGoiThauVal) {
        await this.view.customAlert('Thiếu thông tin', 'Mã gói thầu là bắt buộc khi chuyển sang trạng thái Đang mời thầu!', 'alert-triangle', document.getElementById('phathanh-magoithau'));
        return;
    }

    const hieuLucHsdtVal = parseInt(document.getElementById('phathanh-hieuluchsdt').value) || 0;
    if (hieuLucHsdtVal <= 0) {
        await this.view.customAlert('Thiếu thông tin', 'Thời gian hiệu lực hồ sơ dự thầu phải lớn hơn 0!', 'alert-triangle', document.getElementById('phathanh-hieuluchsdt'));
        return;
    }

    let giaTriDamBaoVal = 0;
    let lotBaoDamMap = {};

    if (!isTuVan && !isPhanLo) {
        giaTriDamBaoVal = this.model.parseVND(document.getElementById('phathanh-giatribaomothau').value);
        if (giaTriDamBaoVal <= 0) {
            await this.view.customAlert('Thiếu thông tin', 'Giá trị bảo đảm dự thầu phải lớn hơn 0 (trừ gói tư vấn)!', 'alert-triangle', document.getElementById('phathanh-giatribaomothau'));
            return;
        }
    }

    // Check if lot guarantees are satisfied for multi-lot bidding
    if (isPhanLo && !isTuVan) {
        let invalidInput = null;
        let exceedsInput = null;
        let exceedsMsg = '';

        document.querySelectorAll('#phathanh-phanlo-baodam-tbody tr').forEach(tr => {
            const id = tr.getAttribute('data-id');
            const inp = tr.querySelector('.phathanh-pl-baodam-input');
            const val = inp ? this.model.parseVND(inp.value) : 0;

            const priceInp = tr.querySelector('.phathanh-pl-price-input');
            const priceVal = priceInp ? this.model.parseVND(priceInp.value) : 0;

            if (val <= 0 && !invalidInput) {
                invalidInput = inp;
            }
            if (priceVal > 0 && val > priceVal && !exceedsInput) {
                exceedsInput = inp;
                exceedsMsg = `Giá trị bảo đảm dự thầu (${this.model.formatVND(val)}) không được lớn hơn giá trị phần lô (${this.model.formatVND(priceVal)})!`;
            }
            if (id) {
                lotBaoDamMap[id] = val;
            }
        });

        if (invalidInput || !gt.phanLoList || gt.phanLoList.length === 0) {
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
        const valueDate1 = document.getElementById('phathanh-thoigiandangtai').value;
        const valueDate2 = document.getElementById('phathanh-thoigiandongthau').value;
        const valueDate4 = document.getElementById('phathanh-ngayquyetdinh').value;

        gt.maGoiThau = maGoiThauVal;
        gt.soQuyetDinh = document.getElementById('phathanh-soquyetdinh').value.trim();
        gt.ngayQuyetDinh = valueDate4 ? this.model.convertDMYToYMD(valueDate4) : '';
        gt.thoiGianDangTai = valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : '';
        gt.thoiGianDongThau = valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : '';

        // Auto-calculate thoiGianMoThau (equal to thoiGianDongThau)
        gt.thoiGianMoThau = gt.thoiGianDongThau;

        gt.hieuLucHsdt = hieuLucHsdtVal;
        gt.hieuLucDamBaoDuThau = hieuLucHsdtVal + 30; // Tự động tính toán = Thời gian hiệu lực HSDT + 30 ngày

        if (isPhanLo && !isTuVan && gt.phanLoList) {
            document.querySelectorAll('#phathanh-phanlo-baodam-tbody tr').forEach(tr => {
                const trId = tr.getAttribute('data-id');
                const pl = gt.phanLoList.find(p => p.id === trId);
                if (pl) {
                    const codeInp = tr.querySelector('.phathanh-pl-code-input');
                    const nameInp = tr.querySelector('.phathanh-pl-name-input');
                    const priceInp = tr.querySelector('.phathanh-pl-price-input');
                    const baodamInp = tr.querySelector('.phathanh-pl-baodam-input');
                    const durationInp = tr.querySelector('.phathanh-pl-duration-input');
                    pl.maPhanLo = codeInp ? codeInp.value.trim() : '';
                    pl.tenPhanLo = nameInp ? nameInp.value.trim() : '';
                    pl.giaTriPhanLo = priceInp ? this.model.parseVND(priceInp.value) : 0;
                    pl.baoDamDuThau = baodamInp ? this.model.parseVND(baodamInp.value) : 0;
                    pl.thoiGianThucHien = durationInp ? durationInp.value.trim() : '';
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
    const targetPackages = this.model.state.goithau.filter(g => {
        if (g.trangThai !== 'Đang mời thầu' && g.trangThai !== 'Đã mở thầu' && g.trangThai !== 'Đang chấm thầu' && g.trangThai !== 'Đã có kết quả') return false;
        if (g.trangThai === 'Đang mời thầu') {
            if (!g.thoiGianDongThau) return false;
            const dongThau = new Date(g.thoiGianDongThau);
            if (dongThau >= now) return false;
        }
        return true;
    });
    const selectedVal = select.value;
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
            } catch(e) {}
        }

        // Step 1 (Mo thau) is completed only if it is not in mời/mở thầu status AND the next step is saved
        const isCompleted = (gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu') && isNextStepSaved;
        const isEditingThisStep = this.view._editingState && this.view._editingState[stepKey];
        const isReadOnly = isCompleted && !isEditingThisStep;
        const isEditable = !isReadOnly;
        const lockedStatuses = ['Đã có kết quả', 'Hủy thầu'];
        const isLocked = lockedStatuses.includes(gt.trangThai);

        // Render Summary Card
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
            ${(isLocked || isReadOnly) ? `<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Biên bản mở thầu đã bị khóa — Gói thầu có trạng thái <strong style="margin-left:4px;">${gt.trangThai}</strong>
            </div>` : ''}
        `;

        emptyState.style.display = 'none';
        bidContainer.style.display = 'block';

        // Ẩn/hiện nút thêm và khóa/mở nút lưu theo trạng thái
        const addBidBtn = document.getElementById('btn-mothau-add-bid');
        const saveBtn2 = document.getElementById('btn-mothau-save');
        const importExcelBtnTop = document.getElementById('btn-mothau-import-excel');
        const downloadExcelBtnTop = document.getElementById('btn-mothau-download-excel');
        if (addBidBtn) addBidBtn.style.display = isEditable ? '' : 'none';
        if (importExcelBtnTop) importExcelBtnTop.style.display = isEditable ? '' : 'none';
        if (downloadExcelBtnTop) downloadExcelBtnTop.style.display = isEditable ? '' : 'none';
        if (saveBtn2) {
            if (isReadOnly) {
                saveBtn2.style.display = 'none';
            } else {
                saveBtn2.style.display = '';
                saveBtn2.innerHTML = '<i data-lucide="save"></i> Lưu thông tin mở thầu';
                saveBtn2.className = 'btn btn-primary';
                saveBtn2.onclick = () => this.saveThongTinMoThau();
            }
        }

        // 2. Identify the dynamic fields case
        let caseType = '1G1T_NO_LOT';
        if (isTuVan) {
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

            let caseType = '1G1T_NO_LOT';
            if (isTuVan) caseType = 'TU_VAN';
            else if (!isTuVan && is1G2T) caseType = hasPhanLo ? '1G2T_WITH_LOT' : '1G2T_NO_LOT';
            else if (is1G1T) caseType = hasPhanLo ? '1G1T_WITH_LOT' : '1G1T_NO_LOT';

            this.addMoThauRow(caseType, gt);
            lucide.createIcons();
        };
    }

    // saveBtn listener is now dynamically handled inside handlePackageSelection
}


window.openMoThauJVManager = (tr) => {
    const leadCode = tr.querySelector('.mt-ma-nha-thau')?.value.trim() || '';
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

        const labelSpan = tr.querySelector('.mt-jv-btn-text');
        if (labelSpan) {
            labelSpan.textContent = `Thành viên liên danh (${updatedMembers.length})`;
        }

        closeModal();
    };

    lucide.createIcons({ root: modal });
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

    let membersHtml = '';
    if (members.length === 0) {
        membersHtml = `<div style="text-align: center; color: var(--text-muted); padding: 12px;"><small>Không có Thành viên liên danh</small></div>`;
    } else {
        membersHtml = members.map((m, idx) => `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-nested, rgba(0,0,0,0.01)); margin-bottom: 8px;">
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Mã số thuế / Mã nhà thầu</div>
                    <div style="font-size: 0.85rem; font-weight: 600;">${m.maSoThue || '--'}</div>
                </div>
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Tên thành viên ${idx + 2}</div>
                    <div style="font-size: 0.85rem; font-weight: 600;">${m.tenNhaThau || '--'}</div>
                </div>
            </div>
        `).join('');
    }

    body.innerHTML = `
        <div style="background: var(--primary-soft); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <div style="font-size: 0.78rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">Thành viên đứng đầu liên danh</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Mã/MST thành viên đứng đầu</div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${displayLeadCode}</div>
                </div>
                <div>
                    <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Tên thành viên đứng đầu</div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${displayLeadName}</div>
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
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(bidData.giaSauGiamGia) || ''}" placeholder="Nhập giá"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + ' ngày' : (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" required placeholder="Hiệu lực"></td>
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
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd" value="${this.model.formatVND(bidData.giaSauGiamGia) || ''}" placeholder="Giá sau giảm"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + ' ngày' : (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || defaultLotBaoDam}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + ' ngày' : (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}" required style="text-align: right;"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${bidData.thoiGianThucHien || gt.thoiGianThucHien || ''}" required placeholder="Thực hiện"></td>
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

            // Autofill lot-level bid security
            const selectedLotCode = rowLotSelect.value;
            const chosenLot = lotList.find(l => l.maPhanLo === selectedLotCode);
            if (chosenLot) {
                const dbInput = tr.querySelector('.mt-dam-bao-du-thau');
                if (dbInput) dbInput.value = this.model.formatVND(chosenLot.baoDamDuThau) || '';

                const gtDbInput = tr.querySelector('.mt-gia-tri-dam-bao');
                if (gtDbInput) gtDbInput.value = this.model.formatVND(chosenLot.baoDamDuThau) || '';
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
        } catch(e) {}
    }

    const isAllowedToSave = gt.trangThai === 'Đang mời thầu' || gt.trangThai === 'Đã mở thầu' || (gt.trangThai === 'Đang chấm thầu' && !isNextStepSaved);

    if (!isAllowedToSave) {
        await this.view.customAlert(
            'Không thể lưu',
            `Không thể chỉnh sửa biên bản mở thầu của gói thầu này vì trạng thái hiện tại là "${gt.trangThai}" và giai đoạn tiếp theo đã hoàn tất.`,
            'x-circle'
        );
        return;
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
            tenNhaThau: resolvedTenNhaThau,
            loaiNhaThau: loaiNhaThau,
            thanhVienLienDanh: bidJvMembers
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
    await this.view.customAlert('Lưu thành công', `Đã lưu toàn bộ thông tin mở thầu (E-HSDT / E-HSĐXKT) của gói thầu "${gt.tenGoiThau}" thành công! Trạng thái gói thầu đã được chuyển sang Đang chấm thầu.`, 'check-circle');

    // Làm mới dropdown mở thầu để loại bỏ gói vừa lưu
    this.renderMoThauPanel();

    // Tự động reload detail workflow và chuyển sang tab Báo cáo đánh giá
    const detailPane = document.getElementById('tab-goithau-detail');
    if (detailPane && detailPane.classList.contains('active')) {
        this.view._currentWorkflowTab = 'eval_tech';
        this.view.showPackageDetails(gtId);
    }
}
