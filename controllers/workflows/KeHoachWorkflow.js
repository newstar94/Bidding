export async function deleteKeHoach(id) {
    const targetPlan = this.model.state.kehoach.find(k => k.id === id);
    if (!targetPlan) return;
    const rootId = targetPlan.rootId || targetPlan.id;

    const relatedPlans = this.model.state.kehoach.filter(kh => (kh.rootId || kh.id) === rootId);
    const relatedIds = relatedPlans.map(kh => kh.id);

    if (relatedPlans.length >= 2) {
        const choice = await this.view.customVersionDeleteChoice(
            'Xác nhận xóa',
            `Kế hoạch "${targetPlan.tenKeHoach}" có ${relatedPlans.length} phiên bản. Vui lòng chọn cách thức xóa:`,
            'Xóa phiên bản gần nhất',
            'Xóa toàn bộ'
        );
        if (choice === null) return;

        if (choice === 1) {
            const maxVer = Math.max(...relatedPlans.map(k => parseInt(k.phienBan) || 0));
            const latestKh = relatedPlans.find(k => (parseInt(k.phienBan) || 0) === maxVer);
            if (!latestKh) return;

            const hasPkgLatest = this.model.state.goithau.some(gt => gt.keHoachId === latestKh.id);
            if (hasPkgLatest) {
                await this.view.customAlert(
                    'Không thể xóa',
                    'Không thể xóa phiên bản gần nhất này vì có các Gói thầu đang liên kết trực tiếp với phiên bản này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.',
                    'x-circle'
                );
                return;
            }

            this.model.state.kehoach = this.model.state.kehoach.filter(kh => kh.id !== latestKh.id);
            this.model.markDeleted('kehoach', latestKh.id);

            const remainingRelated = relatedPlans.filter(kh => kh.id !== latestKh.id);
            if (remainingRelated.length > 0) {
                const nextMaxVer = Math.max(...remainingRelated.map(k => parseInt(k.phienBan) || 0));
                remainingRelated.forEach(kh => {
                    if ((parseInt(kh.phienBan) || 0) === nextMaxVer) {
                        kh.isLatest = 1;
                        kh.is_latest = 1;
                    } else {
                        kh.isLatest = 0;
                        kh.is_latest = 0;
                    }
                });
            }

            await this.model.persistData('kehoach');
            this.view.renderKeHoachTable();
            await this.autoSync();
            await this.view.customAlert('Thành công', 'Đã xóa phiên bản kế hoạch gần nhất!', 'check-circle');
            return;
        } else if (choice === 2) {
            const hasPkgAny = this.model.state.goithau.some(gt => relatedIds.includes(gt.keHoachId));
            if (hasPkgAny) {
                await this.view.customAlert(
                    'Không thể xóa',
                    'Không thể xóa kế hoạch này vì có các Gói thầu đang liên kết trực tiếp với các phiên bản của kế hoạch này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.',
                    'x-circle'
                );
                return;
            }

            this.model.state.kehoach = this.model.state.kehoach.filter(kh => (kh.rootId || kh.id) !== rootId);
            this.model.markDeleted('kehoach', relatedIds);
            await this.model.persistData('kehoach');
            this.view.renderKeHoachTable();
            await this.autoSync();
            await this.view.customAlert('Thành công', 'Đã xóa toàn bộ các phiên bản của kế hoạch!', 'check-circle');
            return;
        }
    } else {
        const hasPackage = this.model.state.goithau.some(gt => relatedIds.includes(gt.keHoachId));
        if (hasPackage) {
            await this.view.customAlert(
                'Không thể xóa',
                'Không thể xóa kế hoạch này vì có các Gói thầu đang liên kết trực tiếp với kế hoạch này. Vui lòng chuyển hướng hoặc xóa các gói thầu trước.',
                'x-circle'
            );
            return;
        }

        const confirmed = await this.view.customConfirm(
            'Xác nhận xóa',
            `Bạn có chắc chắn muốn xóa kế hoạch "${targetPlan.tenKeHoach}"? Dữ liệu sẽ mất vĩnh viễn.`,
            'trash-2'
        );
        if (confirmed) {
            this.model.state.kehoach = this.model.state.kehoach.filter(kh => kh.id !== id);
            this.model.markDeleted('kehoach', id);
            await this.model.persistData('kehoach');
            this.view.renderKeHoachTable();
            await this.autoSync();
        }
    }
}


export function editKeHoach(id) {
    const modal = document.getElementById('modal-kehoach');
    const form = document.getElementById('form-kehoach');

    form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

    const cdtSelect = document.getElementById('kh-chudautuid');
    const latestCDTs = this.model.getLatestChuDauTu() || [];
    cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' +
        latestCDTs.map(c => `<option value="${c.id}" data-search="${c.maChuDauTu || ''} ${c.tenChuDauTu || ''}">${c.tenChuDauTu}</option>`).join('') +
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
        const container = document.getElementById('kh-ngaytrinhkehoach-container');
        const label = document.getElementById('lbl-ngaytrinhkehoach');
        const labelPheDuyet = document.getElementById('lbl-ngaypheduyet');
        const labelQuyetDinh = document.getElementById('lbl-quyetdinh');
        if (pheDuyetSelect.value === 'Kế hoạch') {
            pheDuyetFields.style.display = 'block';
            if (container) container.style.display = 'block';
            if (label) label.textContent = 'Ngày trình kế hoạch';
            if (labelPheDuyet) labelPheDuyet.textContent = 'Ngày phê duyệt kế hoạch';
            if (labelQuyetDinh) labelQuyetDinh.textContent = 'Số QĐ phê duyệt kế hoạch';
        } else if (pheDuyetSelect.value === 'Dự toán và kế hoạch') {
            pheDuyetFields.style.display = 'none';
            if (container) container.style.display = 'block';
            if (label) label.textContent = 'Ngày trình dự toán và kế hoạch';
            if (labelPheDuyet) labelPheDuyet.textContent = 'Ngày phê duyệt dự toán và kế hoạch';
            if (labelQuyetDinh) labelQuyetDinh.textContent = 'Số QĐ phê duyệt dự toán và kế hoạch';
        } else {
            pheDuyetFields.style.display = 'none';
            if (container) container.style.display = 'none';
            if (labelPheDuyet) labelPheDuyet.textContent = 'Ngày phê duyệt';
            if (labelQuyetDinh) labelQuyetDinh.textContent = 'Số QĐ phê duyệt';
        }
    };
    pheDuyetSelect.onchange = togglePheDuyetFields;

    if (id) {
        if (!window._preModalTab) {
            window._preModalTab = this.model.state.activetab || 'kehoach';
            window._preModalAction = this.model.state.activeaction || null;
        }
        this.switchTab('kehoach', 'chinhsua', true);
        document.getElementById('modal-kehoach-title').textContent = 'Cập nhật Kế hoạch LCNT';
        const kh = this.model.state.kehoach.find(k => String(k.id) === String(id));
        const existingCode = this.model.getPlanBaseCode(kh.maKeHoach);

        document.getElementById('form-kehoach-id').value = kh.id;
        document.getElementById('kh-ma').value = existingCode;
        const khMaInput = document.getElementById('kh-ma');
        if (khMaInput) {
            if (existingCode && existingCode.trim() !== '' && kh.thoiGianDangMa) {
                khMaInput.setAttribute('readonly', 'true');
            } else {
                khMaInput.removeAttribute('readonly');
            }
        }
        document.getElementById('kh-ten').value = kh.tenKeHoach;
        document.getElementById('kh-loaihinh').value = kh.loaiHinhMuaSam || '';
        document.getElementById('kh-duan').value = kh.tenDuAnDuToan || '';
        document.getElementById('kh-chudautuid').value = kh.chuDauTuId;
        const tmInput = document.getElementById('kh-tongmuc');
        tmInput.value = kh.tongMucDauTu ? this.model.formatVND(kh.tongMucDauTu) : "";
        tmInput.placeholder = (kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu) ? "Tổng Dự toán/Tổng mức đầu tư" : "Nhập số tiền";
        tmInput.setAttribute('data-initial-val', tmInput.value);
        tmInput.setAttribute('data-was-auto', (kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu) ? 'true' : 'false');
        tmInput.disabled = false;

        document.getElementById('kh-pheduyet').value = kh.pheDuyet || '';
        togglePheDuyetFields();

        document.getElementById('kh-ngaytrinhkehoach').value = this.model.formatForDateInput(kh.ngayTrinhKeHoach);
        document.getElementById('kh-ngaytrinhdutoan').value = this.model.formatForDateInput(kh.ngayTrinhDuToan);
        document.getElementById('kh-ngaypheduyetdutoan').value = this.model.formatForDateInput(kh.ngayPheDuyetDuToan);

        document.getElementById('kh-quyetdinhpheduyetdutoan').value = kh.soQdPheDuyetDuToan || '';

        // Populate additional Project fields
        document.getElementById('kh-maduan').value = kh.maDuan || '';
        document.getElementById('kh-nguonvon').value = kh.nguonVon || '';
        document.getElementById('kh-thoigian-duan').value = kh.thoigianDuan || '';
        document.getElementById('kh-soqdpheduyetduan').value = kh.soQdPheDuyetDuAn || '';
        document.getElementById('kh-ngayqdpheduyetduan').value = this.model.formatForDateInput(kh.ngayQdPheDuyetDuAn);
        document.getElementById('kh-coquanpheduyetduan').value = kh.coQuanPheDuyetDuAn || '';
        document.getElementById('kh-diadiem-quymo').value = kh.diadiemQuymo || '';
        document.getElementById('kh-thongtinkhac').value = kh.thongtinKhac || '';
        toggleProjectFields();

        document.getElementById('kh-ngaypheduyet').value = this.model.formatForDateInput(kh.ngayPheDuyet);

        document.getElementById('kh-quyetdinh').value = kh.quyetDinhPheDuyet;

        document.getElementById('kh-thoigiandang').value = kh.thoiGianDangMa ? this.model.formatForDatetimeLocal(kh.thoiGianDangMa) : '';

    } else {
        if (!window._preModalTab) {
            window._preModalTab = this.model.state.activetab || 'kehoach';
            window._preModalAction = this.model.state.activeaction || null;
        }
        this.switchTab('kehoach', 'taomoi', true);
        document.getElementById('modal-kehoach-title').textContent = 'Thêm Kế hoạch LCNT mới';
        form.reset();
        document.getElementById('form-kehoach-id').value = '';

        const tmInput = document.getElementById('kh-tongmuc');
        tmInput.value = "";
        tmInput.placeholder = "Tổng Dự toán/Tổng mức đầu tư";
        tmInput.removeAttribute('data-initial-val');
        tmInput.removeAttribute('data-was-auto');
        tmInput.disabled = false;

        document.getElementById('kh-pheduyet').value = '';
        togglePheDuyetFields();
        document.getElementById('kh-ngaytrinhkehoach').value = '';
        document.getElementById('kh-ngaytrinhdutoan').value = '';
        document.getElementById('kh-ngaypheduyetdutoan').value = '';
        document.getElementById('kh-quyetdinhpheduyetdutoan').value = '';

        // Reset additional Project fields
        document.getElementById('kh-maduan').value = '';
        document.getElementById('kh-nguonvon').value = '';
        document.getElementById('kh-thoigian-duan').value = '';
        document.getElementById('kh-soqdpheduyetduan').value = '';
        document.getElementById('kh-ngayqdpheduyetduan').value = '';
        document.getElementById('kh-coquanpheduyetduan').value = '';
        document.getElementById('kh-diadiem-quymo').value = '';
        document.getElementById('kh-thongtinkhac').value = '';
        toggleProjectFields();

        document.getElementById('kh-ngaypheduyet').value = '';
        document.getElementById('kh-thoigiandang').value = '';
        const khMaInput = document.getElementById('kh-ma');
        if (khMaInput) {
            khMaInput.removeAttribute('readonly');
        }
    }

    lucide.createIcons();
    this.view.openModal('modal-kehoach');

    // Auto-calculate dates based on user rules and working days
    const addWorkingDays = (startDateStr, days) => {
        if (!startDateStr) return '';
        const parts = startDateStr.split('/');
        if (parts.length !== 3) return '';
        let date = new Date(parts[2], parts[1] - 1, parts[0]);
        if (isNaN(date.getTime())) return '';

        const holidaysData = window._vietnameseHolidays || {};
        let direction = days < 0 ? -1 : 1;
        let remainingDays = Math.abs(days);
        while (remainingDays > 0) {
            date.setDate(date.getDate() + direction);
            let dayOfWeek = date.getDay();
            let dateStr = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
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
        return String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0') + '/' + date.getFullYear();
    };

    const trinhDuToanInp = document.getElementById('kh-ngaytrinhdutoan');
    const pheDuyetDuToanInp = document.getElementById('kh-ngaypheduyetdutoan');
    const trinhKeHoachInp = document.getElementById('kh-ngaytrinhkehoach');
    const pheDuyetKeHoachInp = document.getElementById('kh-ngaypheduyet');
    const pheDuyetSel = document.getElementById('kh-pheduyet');

    const updateFlatpickrValue = (inputEl, val) => {
        if (!inputEl) return;
        inputEl.value = val;
        if (inputEl._flatpickr) {
            inputEl._flatpickr.setDate(val, false);
        }
        inputEl.dispatchEvent(new Event('change'));
    };

    if (trinhDuToanInp && !trinhDuToanInp.dataset.hasDateListeners) {
        trinhDuToanInp.dataset.hasDateListeners = 'true';
        trinhDuToanInp.addEventListener('change', () => {
            if (pheDuyetSel.value === 'Kế hoạch') {
                const nextDate = addWorkingDays(trinhDuToanInp.value, 1);
                updateFlatpickrValue(pheDuyetDuToanInp, nextDate);
            }
        });
    }

    if (pheDuyetDuToanInp && !pheDuyetDuToanInp.dataset.hasDateListeners) {
        pheDuyetDuToanInp.dataset.hasDateListeners = 'true';
        pheDuyetDuToanInp.addEventListener('change', () => {
            if (pheDuyetSel.value === 'Kế hoạch') {
                updateFlatpickrValue(trinhKeHoachInp, pheDuyetDuToanInp.value);
            }
        });
    }

    if (trinhKeHoachInp && !trinhKeHoachInp.dataset.hasDateListeners) {
        trinhKeHoachInp.dataset.hasDateListeners = 'true';
        trinhKeHoachInp.addEventListener('change', () => {
            const nextDate = addWorkingDays(trinhKeHoachInp.value, 1);
            updateFlatpickrValue(pheDuyetKeHoachInp, nextDate);
        });
    }
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
            inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => inputEl.focus({ preventScroll: true }), 300);
            return;
        }
    }

    const publishTimeVal = document.getElementById('kh-thoigiandang').value;
    const finalPublishTime = publishTimeVal ? this.model.convertDMYHMSToYMDHMS(publishTimeVal) : null;

    const ngayPheDuyetRaw = document.getElementById('kh-ngaypheduyet').value;
    const ngayPheDuyetYMD = this.model.convertDMYToYMD(ngayPheDuyetRaw);

    const pheDuyet = document.getElementById('kh-pheduyet').value;
    const ngayTrinhKeHoachRaw = document.getElementById('kh-ngaytrinhkehoach').value;
    const ngayTrinhKeHoachYMD = this.model.convertDMYToYMD(ngayTrinhKeHoachRaw);
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

    const tmInput = document.getElementById('kh-tongmuc');
    const currentVal = tmInput.value.trim();
    const initialVal = tmInput.getAttribute('data-initial-val') || "";
    const wasAuto = tmInput.getAttribute('data-was-auto') === 'true';

    let isTongMucTuDong = false;
    if (!currentVal) {
        isTongMucTuDong = true;
    } else if (wasAuto && currentVal === initialVal) {
        isTongMucTuDong = true;
    }

    // Capture state backups for potential rollback on close/cancel
    this.backupKeHoachState = JSON.parse(JSON.stringify(this.model.state.kehoach));
    this.backupGoiThauState = JSON.parse(JSON.stringify(this.model.state.goithau));

    const loaiHinhVal = document.getElementById('kh-loaihinh').value;
    this.tempPlanData = {
        maKeHoach: inputCode,
        tenKeHoach: document.getElementById('kh-ten').value.trim(),
        loaiHinhMuaSam: loaiHinhVal,
        tenDuAnDuToan: document.getElementById('kh-duan').value.trim(),
        chuDauTuId: document.getElementById('kh-chudautuid').value,
        tongMucDauTu: isTongMucTuDong ? 0 : this.model.parseVND(currentVal),
        isTongMucTuDong: isTongMucTuDong,
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
        ngayTrinhKeHoach: ngayTrinhKeHoachYMD,
        ngayTrinhDuToan: pheDuyet === 'Kế hoạch' ? ngayTrinhDuToanYMD : '',
        ngayPheDuyetDuToan: pheDuyet === 'Kế hoạch' ? ngayPheDuyetDuToanYMD : '',
        soQdPheDuyetDuToan: pheDuyet === 'Kế hoạch' ? soQdPheDuyetDuToan : ''
    };

    if (id) {
        this.tempPlanAction = 'edit';
        this.tempPlanData.id = id;

        // Apply changes in memory temporarily so they are visible in breakdown/package wizard
        const oldKh = this.model.state.kehoach.find(k => k.id === id);
        if (oldKh) {
            Object.assign(oldKh, this.tempPlanData);
            oldKh.updatedAt = this.model.getCurrentDateTimeString();
            oldKh.updated_at = oldKh.updatedAt;
        }
    } else {
        this.tempPlanAction = 'create';
        const planId = window.generateUUID();
        targetPlanId = planId;
        this.tempPlanData.id = planId;

        // Push new plan to in-memory state temporarily
        this.model.state.kehoach.push({
            id: planId,
            phienBan: '00',
            isLatest: 1,
            is_latest: 1,
            rootId: planId,
            createdAt: this.model.getCurrentDateTimeString(),
            created_at: this.model.getCurrentDateTimeString(),
            updatedAt: this.model.getCurrentDateTimeString(),
            updated_at: this.model.getCurrentDateTimeString(),
            ...this.tempPlanData
        });
    }

    if (isTongMucTuDong) {
        this.recalculatePlanTotal(targetPlanId);
    }

    this.view.closeModal('modal-kehoach');
    this.openPlanBreakdownModal(targetPlanId);
}


export function openPlanBreakdownModal(planId) {
    const kh = this.model.state.kehoach.find(k => k.id === planId);
    if (!kh) return;

    document.getElementById('breakdown-plan-id').value = planId;
    document.getElementById('breakdown-modal-subtitle').innerHTML = `
        <strong>Kế hoạch:</strong> ${kh.tenKeHoach} <span class="badge badge-info" style="margin-left:8px;">${this.model.getVersionLabel(kh.phienBan)}</span><br>
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

    const pkgs = this.model.getLatestPackagesForPlan(planId);

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
                    ${(gt.trangThai === 'Đã có kết quả' || gt.trangThai === 'Hủy thầu')
                ? `<button type="button" class="btn btn-outline btn-sm" data-bf-action="show-package" data-id="${gt.id}" style="padding: 4px 8px; font-size: 0.78rem;">Xem</button>`
                : `<button type="button" class="btn btn-outline btn-sm" data-bf-action="edit-package" data-id="${gt.id}" style="padding: 4px 8px; font-size: 0.78rem;">Sửa</button>`
            }
                </td>
            </tr>
        `;
    }).join('');
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
            <td style="padding: 6px 10px; text-align: center;"><button type="button" class="btn-delete-row" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"dathuchien"]' style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;">&times;</button></td>
        `;
    } else if (type === 'khongapdung') {
        row.innerHTML = `
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-name" required value="${data?.tenCongViec || ''}" placeholder="Nhập tên phần công việc..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-value text-right" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ''}" placeholder="Nhập giá trị..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem; font-weight: 700;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-unit" value="${data?.donViThucHien || ''}" placeholder="Đơn vị thực hiện..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px; text-align: center;"><button type="button" class="btn-delete-row" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"khongapdung"]' style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;">&times;</button></td>
        `;
    } else if (type === 'chuadudieuKien') {
        row.innerHTML = `
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-name" required value="${data?.tenCongViec || ''}" placeholder="Nhập tên phần công việc..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem;"></td>
            <td style="padding: 6px 10px;"><input type="text" class="breakdown-value text-right" value="${data?.giaTri ? this.model.formatVND(data.giaTri) : ''}" placeholder="Nhập giá trị..." style="width: 100%; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-size: 0.84rem; font-weight: 700;"></td>
            <td style="padding: 6px 10px; text-align: center;"><button type="button" class="btn-delete-row" data-bf-action="call" data-fn="removeBreakdownRow" data-args='[null,"chuadudieuKien"]' style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;">&times;</button></td>
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
    const pkgs = this.model.getLatestPackagesForPlan(planId);
    const sumIV = pkgs.reduce((acc, curr) => {
        if (curr.isRebid) return acc;
        return acc + (curr.giaGoiThau || 0);
    }, 0);

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


export function recalculatePlanTotal(planId) {
    const kh = this.model.state.kehoach.find(k => k.id === planId);
    if (!kh) return;

    if (kh.tongMucDauTu && kh.tongMucDauTu > 1 && kh.isTongMucTuDong !== true) {
        return;
    }

    const sumI = (kh.cvDaThucHienList || []).reduce((acc, curr) => acc + (curr.giaTri || 0), 0);
    const sumII = (kh.cvKhongApDungList || []).reduce((acc, curr) => acc + (curr.giaTri || 0), 0);
    const sumIII = (kh.cvChuaDuDieuKienList || []).reduce((acc, curr) => acc + (curr.giaTri || 0), 0);

    const pkgs = this.model.getLatestPackagesForPlan(planId);
    const sumIV = pkgs.reduce((acc, curr) => {
        if (curr.isRebid) return acc;
        return acc + (curr.giaGoiThau || 0);
    }, 0);

    const isProject = kh.loaiHinhMuaSam === 'Dự án';
    kh.tongMucDauTu = isProject ? (sumI + sumII + sumIII + sumIV) : (sumII + sumIII + sumIV);
    kh.isTongMucTuDong = true;

    this.model.persistData('kehoach');
    this.view.renderKeHoachTable();
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

    const cvDaThucHien = parseRows('dathuchien');
    const cvKhongApDung = parseRows('khongapdung');
    const cvChuaDuDieuKien = parseRows('chuadudieuKien');

    let finalPlanId = planId;

    if (this.tempPlanAction === 'edit') {
        const backupKh = this.backupKeHoachState.find(k => k.id === this.tempPlanData.id);
        let saveAsNewVersion = false;
        if (backupKh) {
            const oldTime = backupKh.thoiGianDangMa ? String(backupKh.thoiGianDangMa).trim() : '';
            const newTime = this.tempPlanData.thoiGianDangMa ? String(this.tempPlanData.thoiGianDangMa).trim() : '';
            if (oldTime !== '') {
                const oldDate = new Date(oldTime);
                const newDate = new Date(newTime);
                if (isNaN(oldDate.getTime()) || isNaN(newDate.getTime())) {
                    saveAsNewVersion = (oldTime !== newTime);
                } else {
                    saveAsNewVersion = (oldDate.getTime() !== newDate.getTime());
                }
            }
        }

        if (saveAsNewVersion) {
            // Restore kehoach state from backup so the original version isn't overwritten
            this.model.state.kehoach = JSON.parse(JSON.stringify(this.backupKeHoachState));

            const oldKh = this.model.state.kehoach.find(k => k.id === this.tempPlanData.id);
            const rootId = oldKh.rootId || oldKh.id;
            const relatedPlans = this.model.state.kehoach.filter(k => (k.rootId || k.id) === rootId);
            const maxVersion = Math.max(...relatedPlans.map(k => parseInt(k.phienBan) || 0));
            const nextVersion = String(maxVersion + 1).padStart(2, '0');
            const newId = window.generateUUID();
            finalPlanId = newId;

            relatedPlans.forEach(k => { k.isLatest = 0; k.is_latest = 0; });

            if (!this.model.state.selectedPlanVersion) {
                this.model.state.selectedPlanVersion = {};
            }
            this.model.state.selectedPlanVersion[rootId] = newId;

            this.model.state.kehoach.push({
                ...this.tempPlanData,
                id: newId,
                phienBan: nextVersion,
                isLatest: 1,
                is_latest: 1,
                rootId: rootId,
                createdAt: oldKh.createdAt || this.model.getCurrentDateTimeString(),
                created_at: oldKh.created_at || this.model.getCurrentDateTimeString(),
                updatedAt: this.model.getCurrentDateTimeString(),
                updated_at: this.model.getCurrentDateTimeString(),
                cvDaThucHienList: cvDaThucHien,
                cvKhongApDungList: cvKhongApDung,
                cvChuaDuDieuKienList: cvChuaDuDieuKien
            });

            // Tự động phân công phiên bản kế hoạch mới cho chuyên viên đang thao tác
            const activeUserId = this.model.state.activeuser.id;
            if (activeUserId) {
                await this.model.addRecord('assignments', {
                    id: window.generateUUID(),
                    empId: activeUserId,
                    targetId: newId,
                    type: 'kehoach'
                });
            }

            // Duplicate packages and bids from the old plan version to the new plan version
            const oldPackages = this.model.state.goithau.filter(gt => gt.keHoachId === oldKh.id);
            oldPackages.forEach(gt => {
                const newGtId = window.generateUUID();
                this.model.state.goithau.push({
                    ...gt,
                    id: newGtId,
                    keHoachId: newId
                });

                // Duplicate related bids (thongtinmothau)
                if (Array.isArray(this.model.state.thongtinmothau)) {
                    const relatedBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gt.id));
                    relatedBids.forEach(b => {
                        this.model.state.thongtinmothau.push({
                            ...b,
                            id: window.generateUUID(),
                            goiThauId: newGtId
                        });
                    });
                }
            });
            this.model.persistData('goithau');
            this.model.persistData('thongtinmothau');
        } else {
            // Overwrite current version
            const currentKh = this.model.state.kehoach.find(k => k.id === planId);
            if (currentKh) {
                currentKh.cvDaThucHienList = cvDaThucHien;
                currentKh.cvKhongApDungList = cvKhongApDung;
                currentKh.cvChuaDuDieuKienList = cvChuaDuDieuKien;
            }
        }
    } else {
        // Creating a new plan
        const currentKh = this.model.state.kehoach.find(k => k.id === planId);
        if (currentKh) {
            currentKh.cvDaThucHienList = cvDaThucHien;
            currentKh.cvKhongApDungList = cvKhongApDung;
            currentKh.cvChuaDuDieuKienList = cvChuaDuDieuKien;
        }

        // Tự động phân công kế hoạch mới tạo cho chính chuyên viên tạo
        const activeUserId = this.model.state.activeuser.id;
        if (activeUserId) {
            await this.model.addRecord('assignments', {
                id: window.generateUUID(),
                empId: activeUserId,
                targetId: finalPlanId,
                type: 'kehoach'
            });
        }
    }

    // Recalculate totals
    const targetKh = this.model.state.kehoach.find(k => k.id === finalPlanId);
    if (targetKh && targetKh.isTongMucTuDong) {
        this.recalculatePlanTotal(finalPlanId);
    }
    this.updateBreakdownTotal(finalPlanId);

    // Save states to local storage
    this.model.persistData('kehoach');
    this.model.persistData('goithau');

    // Reset backups and temporary transaction states
    this.backupKeHoachState = null;
    this.backupGoiThauState = null;
    this.tempPlanData = null;
    this.tempPlanAction = null;

    if (window._preModalTab === 'kehoach-detail' && finalPlanId) {
        window._preModalAction = finalPlanId;
    }
    this.closeModal('modal-plan-breakdown');
    this.view.renderKeHoachTable();
    this.view.renderGoiThauTable();
    await this.view.customAlert('Thành công', 'Đã lưu kế hoạch và cấu trúc phân chia chi tiết công việc thành công!', 'check-circle');
    this.autoSync();
}
