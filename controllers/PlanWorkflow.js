/* ==========================================================================
   BiddingFlow - PlanWorkflow (Split Workflow Controller Component)
   ========================================================================== */

export async function deleteKeHoach(id) {
    const targetPlan = this.model.state.kehoach.find(k => k.id === id);
    if (!targetPlan) return;
    const baseCode = this.model.getPlanBaseCode(targetPlan.maKeHoach);

    const relatedPlans = this.model.state.kehoach.filter(kh => this.model.getPlanBaseCode(kh.maKeHoach) === baseCode);
    const relatedIds = relatedPlans.map(kh => kh.id);

    const hasPackage = this.model.state.goithau.some(gt => relatedIds.includes(gt.keHoachId));
    if (hasPackage) {
        await this.view.customAlert(
            'Không thể xóa',
            'Không thể xóa kế hoạch này vì có các Gói thầu đang liên kết trực tiếp với các phiên bản của kế hoạch này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.',
            'x-circle'
        );
        return;
    }

    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa',
        `Bạn có chắc chắn muốn xóa toàn bộ kế hoạch "${targetPlan.tenKeHoach}" (bao gồm tất cả ${relatedPlans.length} phiên bản điều chỉnh của kế hoạch này)? Dữ liệu sẽ mất vĩnh viễn.`,
        'trash-2'
    );
    if (confirmed) {
        this.model.state.kehoach = this.model.state.kehoach.filter(kh => this.model.getPlanBaseCode(kh.maKeHoach) !== baseCode);
        this.model.persistData('kehoach');
        this.view.renderKeHoachTable();
        this.autoSync();
    }
}

export function editKeHoach(id) {
    const modal = document.getElementById('modal-kehoach');
    const form = document.getElementById('form-kehoach');

    form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

    const cdtSelect = document.getElementById('kh-chudautuid');
    cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' +
        this.model.state.chudautu.map(c => `<option value="${c.id}" data-search="${c.maChuDauTu || ''} ${c.tenChuDauTu || ''}">${c.tenChuDauTu}</option>`).join('') +
        '<option value="__NEW_INVESTOR__" style="color: var(--primary); font-weight: 700;">+ Thêm chủ đầu tư mới</option>';
    this.makeSearchableSelect(cdtSelect, 'Tìm kiếm Chủ đầu tư...');

    const loaiHinhSelect = document.getElementById('kh-loaihinh');
    const projectFields = document.getElementById('kh-project-fields');

    const toggleProjectFields = () => {
        if (loaiHinhSelect.value === 'Dự án') {
            projectFields.style.display = 'block';
        } else {
            projectFields.style.display = 'none';
        }
    };

    // Remove existing event listener if any (overwrite it safely)
    loaiHinhSelect.onchange = toggleProjectFields;

    const pheDuyetSelect = document.getElementById('kh-pheduyet');
    const pheDuyetFields = document.getElementById('kh-pheduyet-kehoach-fields');
    const togglePheDuyetFields = () => {
        if (pheDuyetSelect.value === 'Kế hoạch') {
            pheDuyetFields.style.display = 'block';
        } else {
            pheDuyetFields.style.display = 'none';
        }
    };
    pheDuyetSelect.onchange = togglePheDuyetFields;

    if (id) {
        this.switchTab('kehoach', 'chinhsua', true);
        document.getElementById('modal-kehoach-title').textContent = 'Cập nhật Kế hoạch LCNT';
        const kh = this.model.state.kehoach.find(k => k.id === id);
        const existingCode = this.model.getPlanBaseCode(kh.maKeHoach);

        document.getElementById('form-kehoach-id').value = kh.id;
        document.getElementById('kh-ma').value = existingCode;
        const khMaInput = document.getElementById('kh-ma');
        if (khMaInput) {
            if (existingCode && existingCode.trim() !== '') {
                khMaInput.setAttribute('readonly', 'true');
            } else {
                khMaInput.removeAttribute('readonly');
            }
        }
        document.getElementById('kh-ten').value = kh.tenKeHoach;
        document.getElementById('kh-loaihinh').value = kh.loaiHinhMuaSam || '';
        document.getElementById('kh-duan').value = kh.tenDuAnDuToan || '';
        document.getElementById('kh-chudautuid').value = kh.chuDauTuId;
        document.getElementById('kh-tongmuc').value = this.model.formatVND(kh.tongMucDauTu);

        document.getElementById('kh-pheduyet').value = kh.pheDuyet || '';
        togglePheDuyetFields();

        if (this.view.fpNgayTrinhDuToan) {
            this.view.fpNgayTrinhDuToan.setDate(kh.ngayTrinhDuToan ? new Date(kh.ngayTrinhDuToan) : '');
        } else {
            document.getElementById('kh-ngaytrinhdutoan').value = this.model.formatDate(kh.ngayTrinhDuToan);
        }

        if (this.view.fpNgayPheDuyetDuToan) {
            this.view.fpNgayPheDuyetDuToan.setDate(kh.ngayPheDuyetDuToan ? new Date(kh.ngayPheDuyetDuToan) : '');
        } else {
            document.getElementById('kh-ngaypheduyetdutoan').value = this.model.formatDate(kh.ngayPheDuyetDuToan);
        }

        document.getElementById('kh-quyetdinhpheduyetdutoan').value = kh.soQdPheDuyetDuToan || '';

        // Populate additional Project fields
        document.getElementById('kh-maduan').value = kh.maDuan || '';
        document.getElementById('kh-nguonvon').value = kh.nguonVon || '';
        document.getElementById('kh-thoigian-duan').value = kh.thoigianDuan || '';
        document.getElementById('kh-soqdpheduyetduan').value = kh.soQdPheDuyetDuAn || '';
        if (this.view.fpNgayQdPheDuyetDuAn) {
            this.view.fpNgayQdPheDuyetDuAn.setDate(kh.ngayQdPheDuyetDuAn ? new Date(kh.ngayQdPheDuyetDuAn) : '');
        } else {
            document.getElementById('kh-ngayqdpheduyetduan').value = this.model.formatDate(kh.ngayQdPheDuyetDuAn);
        }
        document.getElementById('kh-coquanpheduyetduan').value = kh.coQuanPheDuyetDuAn || '';
        document.getElementById('kh-diadiem-quymo').value = kh.diadiemQuymo || '';
        document.getElementById('kh-thongtinkhac').value = kh.thongtinKhac || '';
        toggleProjectFields();

        if (this.view.fpNgayPheDuyet) {
            this.view.fpNgayPheDuyet.setDate(kh.ngayPheDuyet ? new Date(kh.ngayPheDuyet) : '');
        } else {
            document.getElementById('kh-ngaypheduyet').value = this.model.formatDate(kh.ngayPheDuyet);
        }

        document.getElementById('kh-quyetdinh').value = kh.quyetDinhPheDuyet;

        if (this.view.fpThoiGianDang) {
            this.view.fpThoiGianDang.setDate(kh.thoiGianDangMa ? new Date(kh.thoiGianDangMa) : '');
        } else {
            document.getElementById('kh-thoigiandang').value = kh.thoiGianDangMa ? this.model.formatDateWithTime(kh.thoiGianDangMa) : '';
        }

    } else {
        this.switchTab('kehoach', 'taomoi', true);
        document.getElementById('modal-kehoach-title').textContent = 'Thêm Kế hoạch LCNT mới';
        form.reset();
        document.getElementById('form-kehoach-id').value = '';

        document.getElementById('kh-pheduyet').value = '';
        togglePheDuyetFields();
        if (this.view.fpNgayTrinhDuToan) this.view.fpNgayTrinhDuToan.clear();
        if (this.view.fpNgayPheDuyetDuToan) this.view.fpNgayPheDuyetDuToan.clear();
        document.getElementById('kh-quyetdinhpheduyetdutoan').value = '';

        // Reset additional Project fields
        document.getElementById('kh-maduan').value = '';
        document.getElementById('kh-nguonvon').value = '';
        document.getElementById('kh-thoigian-duan').value = '';
        document.getElementById('kh-soqdpheduyetduan').value = '';
        if (this.view.fpNgayQdPheDuyetDuAn) this.view.fpNgayQdPheDuyetDuAn.clear();
        document.getElementById('kh-coquanpheduyetduan').value = '';
        document.getElementById('kh-diadiem-quymo').value = '';
        document.getElementById('kh-thongtinkhac').value = '';
        toggleProjectFields();

        if (this.view.fpNgayPheDuyet) this.view.fpNgayPheDuyet.clear();
        if (this.view.fpThoiGianDang) {
            this.view.fpThoiGianDang.setDate(new Date());
        } else {
            document.getElementById('kh-thoigiandang').value = this.model.formatDateWithTime(new Date());
        }
        const khMaInput = document.getElementById('kh-ma');
        if (khMaInput) {
            khMaInput.removeAttribute('readonly');
        }
    }

    lucide.createIcons();
    this.view.openModal('modal-kehoach');
}

export async function handleKeHoachSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-kehoach');
    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('form-kehoach-id').value;
    let targetPlanId = id;
    const now = new Date();
    const formattedTime = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

    let inputCode = document.getElementById('kh-ma').value.trim();

    if (inputCode) {
        let isDuplicate = false;

        if (id) {
            const oldKh = this.model.state.kehoach.find(k => k.id === id);
            const root = oldKh.rootId || oldKh.id;
            isDuplicate = this.model.state.kehoach.some(k =>
                k.maKeHoach.toLowerCase() === inputCode.toLowerCase() &&
                (k.rootId || k.id) !== root
            );
        } else {
            isDuplicate = this.model.state.kehoach.some(k => k.maKeHoach.toLowerCase() === inputCode.toLowerCase());
        }

        if (isDuplicate) {
            const inputEl = document.getElementById('kh-ma');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Mã kế hoạch đã tồn tại ở một kế hoạch khác. Vui lòng nhập mã duy nhất!';
                    inputEl.addEventListener('input', () => {
                        formGroup.classList.remove('invalid');
                        errText.textContent = originalErr;
                    }, { once: true });
                }
            }
            inputEl.focus();
            return;
        }
    }

    const publishTimeVal = document.getElementById('kh-thoigiandang').value;
    const finalPublishTime = publishTimeVal ? this.model.convertDMYHMSToYMDHMS(publishTimeVal) : formattedTime;

    const ngayPheDuyetRaw = document.getElementById('kh-ngaypheduyet').value;
    const ngayPheDuyetYMD = this.model.convertDMYToYMD(ngayPheDuyetRaw);

    const pheDuyet = document.getElementById('kh-pheduyet').value;
    const ngayTrinhDuToanRaw = document.getElementById('kh-ngaytrinhdutoan').value;
    const ngayTrinhDuToanYMD = this.model.convertDMYToYMD(ngayTrinhDuToanRaw);
    const ngayPheDuyetDuToanRaw = document.getElementById('kh-ngaypheduyetdutoan').value;
    const ngayPheDuyetDuToanYMD = this.model.convertDMYToYMD(ngayPheDuyetDuToanRaw);
    const soQdPheDuyetDuToan = document.getElementById('kh-quyetdinhpheduyetdutoan').value.trim();

    const maDuan = document.getElementById('kh-maduan').value.trim();
    const nguonVon = document.getElementById('kh-nguonvon').value.trim();
    const thoigianDuan = document.getElementById('kh-thoigian-duan').value.trim();
    const soQdPheDuyetDuAn = document.getElementById('kh-soqdpheduyetduan').value.trim();
    const ngayQdPheDuyetDuAnRaw = document.getElementById('kh-ngayqdpheduyetduan').value;
    const ngayQdPheDuyetDuAnYMD = this.model.convertDMYToYMD(ngayQdPheDuyetDuAnRaw);
    const coQuanPheDuyetDuAn = document.getElementById('kh-coquanpheduyetduan').value.trim();
    const diadiemQuymo = document.getElementById('kh-diadiem-quymo').value.trim();
    const thongtinKhac = document.getElementById('kh-thongtinkhac').value.trim();

    if (id) {
        const oldKh = this.model.state.kehoach.find(k => k.id === id);
        const newTen = document.getElementById('kh-ten').value.trim();
        const newLoaiHinh = document.getElementById('kh-loaihinh').value;
        const newDuAn = document.getElementById('kh-duan').value.trim();
        const newChuDauTuId = document.getElementById('kh-chudautuid').value;
        const newTongMuc = this.model.parseVND(document.getElementById('kh-tongmuc').value);
        const newNgayPheDuyet = ngayPheDuyetYMD;
        const newQuyetDinh = document.getElementById('kh-quyetdinh').value.trim();
        const newThoiGianDang = finalPublishTime;

        const saveAsNewVersion = await this.view.customConfirm(
            "Lưu phiên bản mới?",
            "Bạn có muốn lưu các thay đổi này thành một phiên bản mới không?\n\n• Chọn Xác nhận để lưu thành phiên bản mới.\n• Chọn Hủy để ghi đè lên phiên bản hiện tại.",
            "help-circle"
        );

        if (saveAsNewVersion === null) {
            return;
        }

        if (saveAsNewVersion) {
            const rootId = oldKh.rootId || oldKh.id;
            const relatedPlans = this.model.state.kehoach.filter(k => (k.rootId || k.id) === rootId);
            const maxVersion = Math.max(...relatedPlans.map(k => parseInt(k.phienBan) || 0));
            const nextVersion = String(maxVersion + 1).padStart(2, '0');
            const newId = 'kh-' + window.generateUUID();

            relatedPlans.forEach(k => { k.isLatest = 0; k.is_latest = 0; });

            this.model.state.kehoach.push({
                id: newId,
                maKeHoach: inputCode,
                phienBan: nextVersion,
                isLatest: 1,
                is_latest: 1,
                rootId: rootId,
                createdAt: oldKh.createdAt || Math.floor(Date.now() / 1000),
                created_at: oldKh.created_at || Math.floor(Date.now() / 1000),
                updatedAt: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
                tenKeHoach: newTen,
                loaiHinhMuaSam: newLoaiHinh,
                tenDuAnDuToan: newDuAn,
                chuDauTuId: newChuDauTuId,
                tongMucDauTu: newTongMuc,
                isTongMucTuDong: !document.getElementById('kh-tongmuc').value.trim(),
                ngayPheDuyet: newNgayPheDuyet,
                quyetDinhPheDuyet: newQuyetDinh,
                thoiGianDangMa: newThoiGianDang,
                nguonVon: nguonVon,
                thoigianDuan: thoigianDuan,
                maDuan: newLoaiHinh === 'Dự án' ? maDuan : '',
                soQdPheDuyetDuAn: newLoaiHinh === 'Dự án' ? soQdPheDuyetDuAn : '',
                ngayQdPheDuyetDuAn: newLoaiHinh === 'Dự án' ? ngayQdPheDuyetDuAnYMD : '',
                coQuanPheDuyetDuAn: newLoaiHinh === 'Dự án' ? coQuanPheDuyetDuAn : '',
                diadiemQuymo: diadiemQuymo,
                thongtinKhac: thongtinKhac,
                pheDuyet: pheDuyet,
                ngayTrinhDuToan: pheDuyet === 'Kế hoạch' ? ngayTrinhDuToanYMD : '',
                ngayPheDuyetDuToan: pheDuyet === 'Kế hoạch' ? ngayPheDuyetDuToanYMD : '',
                soQdPheDuyetDuToan: pheDuyet === 'Kế hoạch' ? soQdPheDuyetDuToan : ''
            });

            this.model.state.goithau.forEach(gt => {
                if (gt.keHoachId === id) {
                    gt.keHoachId = newId;
                }
            });
            this.model.persistData('goithau');
        } else {
            oldKh.maKeHoach = inputCode;
            oldKh.tenKeHoach = newTen;
            oldKh.updatedAt = Math.floor(Date.now() / 1000);
            oldKh.updated_at = oldKh.updatedAt;
            oldKh.loaiHinhMuaSam = newLoaiHinh;
            oldKh.tenDuAnDuToan = newDuAn;
            oldKh.chuDauTuId = newChuDauTuId;
            oldKh.tongMucDauTu = newTongMuc;
            oldKh.isTongMucTuDong = !document.getElementById('kh-tongmuc').value.trim();
            oldKh.ngayPheDuyet = newNgayPheDuyet;
            oldKh.quyetDinhPheDuyet = newQuyetDinh;
            oldKh.thoiGianDangMa = newThoiGianDang;
            oldKh.nguonVon = nguonVon;
            oldKh.thoigianDuan = thoigianDuan;
            oldKh.maDuan = newLoaiHinh === 'Dự án' ? maDuan : '';
            oldKh.soQdPheDuyetDuAn = newLoaiHinh === 'Dự án' ? soQdPheDuyetDuAn : '';
            oldKh.ngayQdPheDuyetDuAn = newLoaiHinh === 'Dự án' ? ngayQdPheDuyetDuAnYMD : '';
            oldKh.coQuanPheDuyetDuAn = newLoaiHinh === 'Dự án' ? coQuanPheDuyetDuAn : '';
            oldKh.diadiemQuymo = diadiemQuymo;
            oldKh.thongtinKhac = thongtinKhac;
            oldKh.pheDuyet = pheDuyet;
            oldKh.ngayTrinhDuToan = pheDuyet === 'Kế hoạch' ? ngayTrinhDuToanYMD : '';
            oldKh.ngayPheDuyetDuToan = pheDuyet === 'Kế hoạch' ? ngayPheDuyetDuToanYMD : '';
            oldKh.soQdPheDuyetDuToan = pheDuyet === 'Kế hoạch' ? soQdPheDuyetDuToan : '';
        }
    } else {
        const planId = 'kh-' + window.generateUUID();
        targetPlanId = planId;
        const loaiHinhVal = document.getElementById('kh-loaihinh').value;
        this.model.state.kehoach.push({
            id: planId,
            maKeHoach: inputCode,
            phienBan: '00',
            isLatest: 1,
            is_latest: 1,
            rootId: planId,
            createdAt: Math.floor(Date.now() / 1000),
            created_at: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
            tenKeHoach: document.getElementById('kh-ten').value.trim(),
            loaiHinhMuaSam: loaiHinhVal,
            tenDuAnDuToan: document.getElementById('kh-duan').value.trim(),
            chuDauTuId: document.getElementById('kh-chudautuid').value,
            tongMucDauTu: this.model.parseVND(document.getElementById('kh-tongmuc').value),
            isTongMucTuDong: !document.getElementById('kh-tongmuc').value.trim(),
            ngayPheDuyet: ngayPheDuyetYMD,
            quyetDinhPheDuyet: document.getElementById('kh-quyetdinh').value.trim(),
            thoiGianDangMa: finalPublishTime,
            nguonVon: nguonVon,
            thoigianDuan: thoigianDuan,
            maDuan: loaiHinhVal === 'Dự án' ? maDuan : '',
            soQdPheDuyetDuAn: loaiHinhVal === 'Dự án' ? soQdPheDuyetDuAn : '',
            ngayQdPheDuyetDuAn: loaiHinhVal === 'Dự án' ? ngayQdPheDuyetDuAnYMD : '',
            coQuanPheDuyetDuAn: loaiHinhVal === 'Dự án' ? coQuanPheDuyetDuAn : '',
            diadiemQuymo: diadiemQuymo,
            thongtinKhac: thongtinKhac,
            pheDuyet: pheDuyet,
            ngayTrinhDuToan: pheDuyet === 'Kế hoạch' ? ngayTrinhDuToanYMD : '',
            ngayPheDuyetDuToan: pheDuyet === 'Kế hoạch' ? ngayPheDuyetDuToanYMD : '',
            soQdPheDuyetDuToan: pheDuyet === 'Kế hoạch' ? soQdPheDuyetDuToan : ''
        });
    }

    this.model.persistData('kehoach');
    this.view.closeModal('modal-kehoach');
    this.view.renderKeHoachTable();
    this.autoSync();

    this.openPlanBreakdownModal(targetPlanId);
}

export function openPlanBreakdownModal(planId) {
    const kh = this.model.state.kehoach.find(k => k.id === planId);
    if (!kh) return;

    document.getElementById('breakdown-plan-id').value = planId;
    document.getElementById('breakdown-modal-subtitle').innerHTML = `
        <strong>Kế hoạch:</strong> ${kh.tenKeHoach} <span class="badge badge-info" style="margin-left:8px;">${this.model.getPlanVersionLabel(kh.phienBan)}</span><br>
        <span style="display:inline-block; margin-top:4px;"><strong>Mã:</strong> ${this.model.getPlanBaseCode(kh.maKeHoach) || '(Chưa có)'} | <span id="breakdown-total-display"></span></span>
    `;

    // Render Tab 1: Đã thực hiện
    const tbody1 = document.getElementById('tbody-breakdown-dathuchien');
    tbody1.innerHTML = '';
    const list1 = kh.cvDaThucHienList || [];
    if (list1.length === 0) {
        this.addBreakdownRow('dathuchien');
    } else {
        list1.forEach(item => this.addBreakdownRow('dathuchien', item));
    }

    // Render Tab 2: Không áp dụng LCNT
    const tbody2 = document.getElementById('tbody-breakdown-khongapdung');
    tbody2.innerHTML = '';
    const list2 = kh.cvKhongApDungList || [];
    if (list2.length === 0) {
        this.addBreakdownRow('khongapdung');
    } else {
        list2.forEach(item => this.addBreakdownRow('khongapdung', item));
    }

    // Render Tab 3: Chưa đủ điều kiện
    const tbody3 = document.getElementById('tbody-breakdown-chuadudieuKien');
    tbody3.innerHTML = '';
    const list3 = kh.cvChuaDuDieuKienList || [];
    if (list3.length === 0) {
        this.addBreakdownRow('chuadudieuKien');
    } else {
        list3.forEach(item => this.addBreakdownRow('chuadudieuKien', item));
    }

    // Render Tab 4: Các gói thầu
    this.renderBreakdownPackagesList(planId);

    // Bind Add Package Button in breakdown wizard
    const btnAddPkg = document.getElementById('btn-breakdown-add-package');
    if (btnAddPkg) {
        btnAddPkg.onclick = () => {
            this.editGoiThau(null);
            // Autofill keHoachId
            setTimeout(() => {
                const planSelect = document.getElementById('gt-kehoachid');
                if (planSelect) {
                    planSelect.value = planId;
                    planSelect.setAttribute('readonly', 'true');
                    // Hide option selector or disable it
                    planSelect.style.pointerEvents = 'none';
                    planSelect.style.background = 'var(--neutral-soft)';
                    planSelect.dispatchEvent(new Event('change'));
                }
            }, 100);

            // Hook into form-goithau submit to reload breakdown packages when completed
            const formGt = document.getElementById('form-goithau');
            if (formGt) {
                const breakdownPkgReload = () => {
                    this.renderBreakdownPackagesList(planId);
                    formGt.removeEventListener('submit', breakdownPkgReload);
                };
                formGt.addEventListener('submit', breakdownPkgReload);
            }
        };
    }

    // Bind save button
    const btnSave = document.getElementById('btn-save-plan-breakdown');
    btnSave.onclick = () => this.savePlanBreakdown();

    // Bind Tabs Switching
    const tabBtns = document.querySelectorAll('.breakdown-tab-btn');
    const panes = document.querySelectorAll('.breakdown-pane');

    tabBtns.forEach(btn => {
        btn.onclick = () => {
            tabBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderBottomColor = 'transparent';
                b.style.color = 'var(--text-muted)';
            });
            panes.forEach(p => p.style.display = 'none');

            btn.classList.add('active');
            btn.style.borderBottomColor = 'var(--primary)';
            btn.style.color = 'var(--primary)';

            const targetTab = btn.getAttribute('data-breakdown-tab');
            document.getElementById(`pane-${targetTab}`).style.display = 'block';
        };
    });

    // Reset tabs to default (first tab active)
    tabBtns[0].click();

    this.updateBreakdownTotal(planId);

    this.view.openModal('modal-plan-breakdown');
    lucide.createIcons();
}

export function renderBreakdownPackagesList(planId) {
    const tbody = document.getElementById('tbody-breakdown-goithau');
    if (!tbody) return;

    const latestPackages = this.model.getLatestPackages();
    const pkgs = latestPackages.filter(g => g.keHoachId === planId);

    if (pkgs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;"><small>Chưa có gói thầu nào được tạo cho kế hoạch này.</small></td></tr>`;
        return;
    }

    tbody.innerHTML = pkgs.map(gt => {
        const hinhThuc = gt.hinhThucLuaChon || '--';
        const trangThaiBadge = this.getStatusBadge ? this.getStatusBadge(gt.trangThai) : gt.trangThai;
        return `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 10px 14px; font-weight: 700; color: var(--text-muted);">${this.model.getPackageBaseCode(gt.maGoiThau) || '--'}</td>
                <td style="padding: 10px 14px; font-weight: 600; color: var(--text-main);">${gt.tenGoiThau}</td>
                <td style="padding: 10px 14px; font-weight: 700; text-align: right; color: var(--primary);">${this.model.formatCurrency(gt.giaGoiThau)}</td>
                <td style="padding: 10px 14px; font-weight: 500; color: var(--text-muted);">${hinhThuc}</td>
                <td style="padding: 10px 14px;">${trangThaiBadge}</td>
                <td style="padding: 10px 14px; text-align: center;">
                    <button type="button" class="btn btn-outline btn-sm" onclick="window.editGoiThau('${gt.id}')" style="padding: 4px 8px; font-size: 0.78rem;">Sửa</button>
                </td>
            </tr>
        `;
    }).join('');

    // Re-bind package form edit hooks to update breakdown packages table
    const formGt = document.getElementById('form-goithau');
    if (formGt) {
        const reloadOnSubmit = () => {
            this.renderBreakdownPackagesList(planId);
        };
        formGt.addEventListener('submit', reloadOnSubmit);
    }
}

export function addBreakdownRow(type, data = null) {
    const tbody = document.getElementById(`tbody-breakdown-${type}`);
    if (!tbody) return;

    const planId = document.getElementById('breakdown-plan-id').value;
    const row = document.createElement('tr');
    row.style.borderBottom = '1px solid var(--border-color)';

    if (type === 'dathuchien') {
        row.innerHTML = `
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-name" required value="${data?.tenCongViec || ''}" placeholder="Nhập tên phần công việc..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-value text-right" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ''}" placeholder="Nhập giá trị..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem; font-weight: 700;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-unit" value="${data?.donViThucHien || ''}" placeholder="Đơn vị thực hiện..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-doc" value="${data?.vanBanPheDuyet || ''}" placeholder="Văn bản phê duyệt..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px; text-align: center;"><button type="button" class="btn-delete-row" onclick="window.removeBreakdownRow(this, 'dathuchien')" style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;">&times;</button></td>
        `;
    } else if (type === 'khongapdung') {
        row.innerHTML = `
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-name" required value="${data?.tenCongViec || ''}" placeholder="Nhập tên phần công việc..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-value text-right" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ''}" placeholder="Nhập giá trị..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem; font-weight: 700;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-unit" value="${data?.donViThucHien || ''}" placeholder="Đơn vị thực hiện..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px; text-align: center;"><button type="button" class="btn-delete-row" onclick="window.removeBreakdownRow(this, 'khongapdung')" style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;">&times;</button></td>
        `;
    } else if (type === 'chuadudieuKien') {
        row.innerHTML = `
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-name" required value="${data?.tenCongViec || ''}" placeholder="Nhập tên phần công việc..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-value text-right" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ''}" placeholder="Nhập giá trị..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem; font-weight: 700;"></td>
            <td style="padding: 6px 10px; text-align: center;"><button type="button" class="btn-delete-row" onclick="window.removeBreakdownRow(this, 'chuadudieuKien')" style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;">&times;</button></td>
        `;
    }

    const priceInput = row.querySelector('.breakdown-value');
    if (priceInput) {
        priceInput.addEventListener('input', (e) => {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;
            e.target.value = this.model.formatVND(e.target.value);
            const newLength = e.target.value.length;
            e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));

            if (planId) {
                this.updateBreakdownTotal(planId);
            }
        });
    }

    tbody.appendChild(row);
}

export function removeBreakdownRow(btn, type) {
    const planId = document.getElementById('breakdown-plan-id').value;
    const row = btn.closest('tr');
    if (row) {
        row.remove();
        if (planId) {
            this.updateBreakdownTotal(planId);
        }
    }
}

export function updateBreakdownTotal(planId) {
    const kh = this.model.state.kehoach.find(k => k.id === planId);
    if (!kh) return;

    const parseInputsVal = (type) => {
        const tbody = document.getElementById(`tbody-breakdown-${type}`);
        if (!tbody) return 0;
        let sum = 0;
        tbody.querySelectorAll('.breakdown-value').forEach(input => {
            sum += this.model.parseVND(input.value);
        });
        return sum;
    };

    const sumI = parseInputsVal('dathuchien');
    const sumII = parseInputsVal('khongapdung');
    const sumIII = parseInputsVal('chuadudieuKien');

    // Sum IV: Các gói thầu
    const latestPackages = this.model.getLatestPackages();
    const pkgs = latestPackages.filter(g => g.keHoachId === planId);
    const sumIV = pkgs.reduce((acc, curr) => acc + curr.giaGoiThau, 0);

    const isProject = kh.loaiHinhMuaSam === 'Dự án';
    const total = isProject ? (sumI + sumII + sumIII + sumIV) : (sumII + sumIII + sumIV);

    if (kh.tongMucDauTu && kh.tongMucDauTu > 1 && kh.isTongMucTuDong !== true) {
        // Keep manually entered value
    } else {
        kh.tongMucDauTu = total;
        kh.isTongMucTuDong = true;
    }

    // Save to local storage
    this.model.persistData('kehoach');
    this.view.renderKeHoachTable();

    // Render in modal header
    const labelTitle = isProject ? 'Tổng mức đầu tư' : 'Tổng dự toán';
    const totalSpan = document.getElementById('breakdown-total-display');
    if (totalSpan) {
        totalSpan.innerHTML = `<strong>${labelTitle}:</strong> <span class="text-blue" style="font-size:1.05rem; font-weight: 700;">${this.model.formatCurrency(kh.tongMucDauTu)}</span>`;
    }
}

export async function savePlanBreakdown() {
    const planId = document.getElementById('breakdown-plan-id').value;
    const kh = this.model.state.kehoach.find(k => k.id === planId);
    if (!kh) return;

    const parseRows = (type) => {
        const tbody = document.getElementById(`tbody-breakdown-${type}`);
        if (!tbody) return [];

        const rows = [];
        tbody.querySelectorAll('tr').forEach(tr => {
            const name = tr.querySelector('.breakdown-name')?.value.trim();
            const valStr = tr.querySelector('.breakdown-value')?.value || '0';
            const value = this.model.parseVND(valStr);

            if (!name) return; // Skip empty rows

            if (type === 'dathuchien') {
                const donViThucHien = tr.querySelector('.breakdown-unit')?.value.trim() || '';
                const vanBanPheDuyet = tr.querySelector('.breakdown-doc')?.value.trim() || '';
                rows.push({ tenCongViec: name, giaTri: value, donViThucHien, vanBanPheDuyet });
            } else if (type === 'khongapdung') {
                const donViThucHien = tr.querySelector('.breakdown-unit')?.value.trim() || '';
                rows.push({ tenCongViec: name, giaTri: value, donViThucHien });
            } else {
                rows.push({ tenCongViec: name, giaTri: value });
            }
        });
        return rows;
    };

    kh.cvDaThucHienList = parseRows('dathuchien');
    kh.cvKhongApDungList = parseRows('khongapdung');
    kh.cvChuaDuDieuKienList = parseRows('chuadudieuKien');

    // Trigger one final recalculation to be safe
    this.updateBreakdownTotal(planId);

    this.model.persistData('kehoach');
    this.view.closeModal('modal-plan-breakdown');
    this.view.renderKeHoachTable();
    await this.view.customAlert('Thành công', 'Đã lưu cấu trúc phân chia chi tiết phần công việc và cập nhật tổng giá trị kế hoạch!', 'check-circle');
    this.autoSync();
}

