/* ==========================================================================
   BiddingFlow - BiddingWorkflowController (Part of Controller split)
   ========================================================================== */

function getAuthDownloadUrl(url) {
    const token = sessionStorage.getItem('bf_session_token') || '';
    const username = sessionStorage.getItem('bf_username') || '';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}&username=${encodeURIComponent(username)}`;
}

/**
 * Tải file từ API có xác thực qua fetch (auth headers đúng chuẩn).
 * Thay thế window.location.href để tránh lỗi thiếu session khi browser GET.
 */
function authFetchDownload(url, filename) {
    return fetch(url, {
        headers: {
            'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
            'X-Username': sessionStorage.getItem('bf_username') || ''
        }
    })
        .then(res => {
            if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Lỗi tải file'); });
            return res.blob();
        })
        .then(blob => {
            const a = document.createElement('a');
            const objectUrl = URL.createObjectURL(blob);
            a.href = objectUrl;
            a.download = filename || 'download';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
        });
    // Lỗi được re-throw cho caller xử lý (không dùng alert() vì đây là standalone utility)
}

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
        await this.model.persistData('kehoach');
        this.view.renderKeHoachTable();
        await this.autoSync();
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
        const tmInput = document.getElementById('kh-tongmuc');
        tmInput.value = kh.tongMucDauTu ? this.model.formatVND(kh.tongMucDauTu) : "";
        tmInput.placeholder = (kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu) ? "Tự động tính toán..." : "Nhập số tiền";
        tmInput.setAttribute('data-initial-val', tmInput.value);
        tmInput.setAttribute('data-was-auto', (kh.isTongMucTuDong === true || kh.isTongMucTuDong === 1 || !kh.tongMucDauTu) ? 'true' : 'false');
        tmInput.disabled = false;

        document.getElementById('kh-pheduyet').value = kh.pheDuyet || '';
        togglePheDuyetFields();

        if (this.view.fpNgayTrinhKeHoach) {
            this.view.fpNgayTrinhKeHoach.setDate(kh.ngayTrinhKeHoach ? new Date(kh.ngayTrinhKeHoach) : '');
        } else {
            document.getElementById('kh-ngaytrinhkehoach').value = this.model.formatDate(kh.ngayTrinhKeHoach);
        }

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

        const tmInput = document.getElementById('kh-tongmuc');
        tmInput.value = "";
        tmInput.placeholder = "Tự động tính toán...";
        tmInput.removeAttribute('data-initial-val');
        tmInput.removeAttribute('data-was-auto');
        tmInput.disabled = false;

        document.getElementById('kh-pheduyet').value = '';
        togglePheDuyetFields();
        if (this.view.fpNgayTrinhKeHoach) this.view.fpNgayTrinhKeHoach.clear();
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
            this.view.fpThoiGianDang.clear();
        } else {
            document.getElementById('kh-thoigiandang').value = '';
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
            oldKh.updatedAt = Math.floor(Date.now() / 1000);
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
            createdAt: Math.floor(Date.now() / 1000),
            created_at: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
            ...this.tempPlanData
        });
    }

    if (isTongMucTuDong) {
        this.recalculatePlanTotal(targetPlanId);
    }

    this.view.closeModal('modal-kehoach');
    this.openPlanBreakdownModal(targetPlanId);
}

export function openPackageWizardStep() {
    if (!this.packageWizard.active) return;

    this.editGoiThau(null);

    const titleEl = document.getElementById('modal-goithau-title');
    if (titleEl) {
        titleEl.innerHTML = `Thêm Gói thầu <span style="font-size: 0.85rem; color: var(--primary); font-weight: normal; margin-left: 8px;">(Gói thầu số ${this.packageWizard.currentCount} trên tổng số ${this.packageWizard.totalCount})</span>`;
    }

    const planSelect = document.getElementById('gt-kehoachid');
    if (planSelect) {
        planSelect.value = this.packageWizard.planId;
        planSelect.disabled = true;
        planSelect.dispatchEvent(new Event('change'));
    }
}

export async function deleteGoiThau(id) {
    const targetPackage = this.model.state.goithau.find(g => g.id === id);
    if (!targetPackage) return;
    const baseCode = this.model.getPackageBaseCode(targetPackage.maGoiThau);

    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa',
        'Bạn có chắc muốn xóa gói thầu này? Mọi phiên bản lịch sử liên quan sẽ bị xóa bỏ.',
        'trash-2'
    );
    if (confirmed) {
        if (baseCode) {
            this.model.state.goithau = this.model.state.goithau.filter(gt => this.model.getPackageBaseCode(gt.maGoiThau) !== baseCode);
        } else {
            this.model.state.goithau = this.model.state.goithau.filter(gt => gt.id !== id);
        }
        // Also remove related thongtinmothau entries
        this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) !== String(id));
        await this.model.persistData('goithau');
        await this.model.persistData('thongtinmothau');

        const planId = targetPackage.keHoachId;
        if (planId) {
            this.recalculatePlanTotal(planId);
        }

        // Recalculate and update Breakdown modal if open
        const breakdownPlanId = document.getElementById('breakdown-plan-id')?.value;
        const modalBreakdown = document.getElementById('modal-plan-breakdown');
        if (modalBreakdown && modalBreakdown.classList.contains('active') && breakdownPlanId) {
            this.renderBreakdownPackagesList(breakdownPlanId);
            this.updateBreakdownTotal(breakdownPlanId);
        }

        this.view.renderGoiThauTable();

        // Await sync to ensure DB is updated; alert on failure
        try {
            const syncRes = await fetch('/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                    'X-Username': sessionStorage.getItem('bf_username') || ''
                },
                body: JSON.stringify(this.model.state)
            });
            if (!syncRes.ok) {
                const err = await syncRes.json().catch(() => ({}));
                await this.view.customAlert('Lỗi đồng bộ', `Gói thầu đã xóa khỏi giao diện nhưng có lỗi khi lưu vào cơ sở dữ liệu: ${err.error || syncRes.status}. Vui lòng tải lại trang.`, 'x-circle');
            }
        } catch (e) {
            await this.view.customAlert('Lỗi kết nối', 'Gói thầu đã xóa khỏi giao diện nhưng không thể đồng bộ với cơ sở dữ liệu do lỗi kết nối. Vui lòng tải lại trang để kiểm tra.', 'x-circle');
        }
    }
}

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

    // Flatpickr luôn trả về định dạng dd/MM/yyyy HH:mm, không cần validate thêm
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

export function editGoiThau(id) {
    const modal = document.getElementById('modal-goithau');
    const form = document.getElementById('form-goithau');
    const gt = id ? this.model.state.goithau.find(g => g.id === id) : null;

    form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

    const khSelect = document.getElementById('gt-kehoachid');
    khSelect.innerHTML = '<option value="">-- Chọn Kế hoạch --</option>' +
        this.model.getLatestPlans().map(k => `<option value="${k.id}" data-search="${k.maKeHoach || ''} ${k.tenKeHoach || ''}">${k.tenKeHoach}</option>`).join('');
    khSelect.disabled = false;
    this.makeSearchableSelect(khSelect, 'Tìm kiếm Kế hoạch LCNT...');

    const ntSelect = document.getElementById('gt-nhathautrungthauid');
    let filteredBids = [];
    if (id) {
        filteredBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(id));
    }

    if (filteredBids.length > 0) {
        ntSelect.innerHTML = '<option value="">-- Chọn Nhà thầu trúng thầu --</option>' +
            filteredBids.map(b => `<option value="${b.nhaThauId}" data-search="${b.maNhaThau || ''} ${b.tenNhaThau || ''}">${b.tenNhaThau}</option>`).join('');
    } else {
        ntSelect.innerHTML = '<option value="">-- (Chưa có nhà thầu tham gia mở thầu) --</option>';
    }
    this.makeSearchableSelect(ntSelect, 'Tìm kiếm Nhà thầu trúng thầu...');

    // Populate assignment dropdown - fetch fresh if empty
    const roleLabelMap = { super_admin: 'Super Admin / Quản lý / Chuyên viên', manager: 'Quản lý / Chuyên viên', employee: 'Chuyên viên' };
    const restoreEmpValue = () => {
        const empSelect = document.getElementById('gt-nhanvienphutrach');
        if (empSelect) {
            if (id) {
                const assignment = this.model.state.assignments.find(a => a.targetId === gt.id && a.type === 'goithau');
                empSelect.value = assignment ? assignment.empId : '';
            } else {
                if (this.model.state.activerole === 'employee') {
                    const currentUserId = sessionStorage.getItem('bf_user_id');
                    empSelect.value = currentUserId ? 'user-' + currentUserId : '';
                } else {
                    empSelect.value = '';
                }
            }
            if (this.model.state.activerole === 'employee') {
                empSelect.disabled = true;
            } else {
                empSelect.disabled = false;
            }
            this.makeSearchableSelect(empSelect, 'Tìm kiếm Chuyên viên phụ trách...');
        }
    };

    const _populateEmpDropdown = () => {
        const empDropdown = document.getElementById('gt-nhanvienphutrach');
        if (!empDropdown) return;
        const employees = Array.isArray(this.model.state.employees) ? this.model.state.employees : [];
        const optHtml = employees.map(e => {
            const roleLabel = roleLabelMap[e.role] || e.role;
            const matchedExpert = this.model.state.chuyengia.find(cg => cg.hoTen.toLowerCase().trim() === e.name.toLowerCase().trim());
            const extraSearch = matchedExpert ? `${matchedExpert.soCCCD || ''} ${matchedExpert.soChungChi || ''}` : '';
            return `<option value="${e.id}" data-search="${e.name} ${roleLabel} ${e.email || ''} ${extraSearch}">${e.name} — ${roleLabel}${e.email ? ' (' + e.email + ')' : ''}</option>`;
        }).join('');
        empDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optHtml;
        restoreEmpValue();
    };

    if (!this.model.state.employees || this.model.state.employees.length === 0) {
        fetch('/api/auth/users')
            .then(r => r.json())
            .then(users => {
                this.model.state.employees = users.map(u => ({
                    id: `user-${u.id}`, name: u.name, email: u.email || '', phone: '', role: u.role
                }));
                _populateEmpDropdown();
            })
            .catch(err => { console.error('Failed to load users:', err); _populateEmpDropdown(); });
    } else {
        _populateEmpDropdown();
    }

    const toChuyenGiaTbody = document.getElementById('to-chuyengia-tbody');
    toChuyenGiaTbody.innerHTML = this.model.state.chuyengia.map(cg => `
        <tr data-expert-id="${cg.id}">
            <td style="text-align: center; vertical-align: middle;">
                <input type="checkbox" name="tochuyengia-select" value="${cg.id}" style="width: 18px; height: 18px; min-width: auto; cursor: pointer; display: inline-block;">
            </td>
            <td style="font-weight: 600; padding: 10px 14px; vertical-align: middle; color: var(--text-main); text-align: left !important;">${cg.hoTen} <small class="text-muted" style="display: block;">Số CC: ${cg.soChungChi}</small></td>
            <td style="vertical-align: middle;">
                <select name="tochuyengia-chucvu" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;" disabled>
                    <option value="Tổ viên">Tổ viên</option>
                    <option value="Tổ trưởng">Tổ trưởng</option>
                </select>
            </td>
            <td style="vertical-align: middle;">
                <input type="text" name="tochuyengia-congviec" placeholder="Nhập công việc..." disabled style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;">
            </td>
        </tr>
    `).join('');

    const toThamDinhTbody = document.getElementById('to-thamdinh-tbody');
    toThamDinhTbody.innerHTML = this.model.state.chuyengia.map(cg => `
        <tr data-expert-id="${cg.id}">
            <td style="text-align: center; vertical-align: middle;">
                <input type="checkbox" name="tothamdinh-select" value="${cg.id}" style="width: 18px; height: 18px; min-width: auto; cursor: pointer; display: inline-block;">
            </td>
            <td style="font-weight: 600; padding: 10px 14px; vertical-align: middle; color: var(--text-main); text-align: left !important;">${cg.hoTen} <small class="text-muted" style="display: block;">Số CC: ${cg.soChungChi}</small></td>
            <td style="vertical-align: middle;">
                <select name="tothamdinh-chucvu" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;" disabled>
                    <option value="Tổ viên">Tổ viên</option>
                    <option value="Tổ trưởng">Tổ trưởng</option>
                </select>
            </td>
            <td style="vertical-align: middle;">
                <input type="text" name="tothamdinh-congviec" placeholder="Nhập công việc..." disabled style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-family: var(--font-primary); font-size: 0.84rem; font-weight: 600;">
            </td>
        </tr>
    `).join('');

    const setupCheckboxListeners = (tbodyId, selectName, roleName, jobName, otherTbodyId) => {
        const tbody = document.getElementById(tbodyId);
        const checkboxes = tbody.querySelectorAll(`input[name="${selectName}"]`);
        checkboxes.forEach(cb => {
            // Enforce single leader in each team on role change
            const row = cb.closest('tr');
            const roleSelect = row.querySelector(`select[name="${roleName}"]`);
            if (roleSelect) {
                roleSelect.addEventListener('change', () => {
                    this.enforceSingleLeader(tbodyId, roleName);

                    const jobInput = row.querySelector(`input[name="${jobName}"]`);
                    if (jobInput) {
                        if (tbodyId === 'to-chuyengia-tbody') {
                            jobInput.value = roleSelect.value === 'Tổ trưởng' ? 'Tổng hợp, lập HSMT, đánh giá HSDT' : 'Lập HSMT, đánh giá HSDT';
                        } else if (tbodyId === 'to-thamdinh-tbody') {
                            jobInput.value = roleSelect.value === 'Tổ trưởng' ? 'Tổng hợp, thẩm định HSMT, thẩm định KQLCNT' : 'Thẩm định HSMT, thẩm định KQLCNT';
                        }
                    }
                });
            }

            cb.addEventListener('change', (e) => {
                const newChecked = cb.checked;
                const expertId = cb.value;
                const roleSelect = row.querySelector(`select[name="${roleName}"]`);
                const jobInput = row.querySelector(`input[name="${jobName}"]`);

                if (roleSelect) {
                    if (newChecked) {
                        // Check if a leader already exists in the team
                        const currentLeader = tbody.querySelector(`select[name="${roleName}"]:not([disabled])[value="Tổ trưởng"]`);
                        if (currentLeader) {
                            roleSelect.value = 'Tổ viên';
                            roleSelect.disabled = true;
                        } else {
                            roleSelect.disabled = false;
                        }
                    } else {
                        roleSelect.value = 'Tổ viên';
                        roleSelect.disabled = true;
                    }
                }
                if (jobInput) {
                    jobInput.disabled = !newChecked;
                    if (newChecked) {
                        // Auto fill on check
                        if (tbodyId === 'to-chuyengia-tbody') {
                            jobInput.value = roleSelect.value === 'Tổ trưởng' ? 'Tổng hợp, lập HSMT, đánh giá HSDT' : 'Lập HSMT, đánh giá HSDT';
                        } else if (tbodyId === 'to-thamdinh-tbody') {
                            jobInput.value = roleSelect.value === 'Tổ trưởng' ? 'Tổng hợp, thẩm định HSMT, thẩm định KQLCNT' : 'Thẩm định HSMT, thẩm định KQLCNT';
                        }
                    } else {
                        jobInput.value = '';
                    }
                }

                const otherRow = document.querySelector(`#${otherTbodyId} tr[data-expert-id="${expertId}"]`);
                if (otherRow) {
                    otherRow.style.display = newChecked ? 'none' : '';
                }

                this.enforceSingleLeader(tbodyId, roleName);
            });
        });
    };

    setupCheckboxListeners('to-chuyengia-tbody', 'tochuyengia-select', 'tochuyengia-chucvu', 'tochuyengia-congviec', 'to-thamdinh-tbody');
    setupCheckboxListeners('to-thamdinh-tbody', 'tothamdinh-select', 'tothamdinh-chucvu', 'tothamdinh-congviec', 'to-chuyengia-tbody');

    if (id) {
        this.switchTab('goithau', 'chinhsua', true);
        document.getElementById('modal-goithau-title').textContent = 'Cập nhật Gói thầu';
        // Using the gt variable declared at the top of the function

        document.getElementById('form-goithau').setAttribute('data-original-status', gt.trangThai);
        document.getElementById('form-goithau-id').value = gt.id;
        const existingGtCode = this.model.getPackageBaseCode(gt.maGoiThau);
        document.getElementById('gt-ma').value = existingGtCode;
        const gtMaInput = document.getElementById('gt-ma');
        if (gtMaInput) {
            if (existingGtCode && existingGtCode.trim() !== '') {
                gtMaInput.setAttribute('readonly', 'true');
            } else {
                gtMaInput.removeAttribute('readonly');
            }
        }
        document.getElementById('gt-kehoachid').value = gt.keHoachId;
        document.getElementById('gt-ten').value = gt.tenGoiThau;
        document.getElementById('gt-gia').value = this.model.formatVND(gt.giaGoiThau);
        document.getElementById('gt-thoigian').value = gt.thoiGianThucHien;
        document.getElementById('gt-hinhthuc').value = gt.hinhThucLuaChon;
        document.getElementById('gt-phuongthuc').value = gt.phuongThucLuaChon;
        document.getElementById('gt-trangthai').value = gt.trangThai;



        document.getElementById('gt-linhvuc').value = gt.linhVuc || '';
        document.getElementById('gt-tuychonmuathem').value = gt.tuyChonMuaThem || 'Không';
        document.getElementById('gt-nguonvon').value = gt.nguonVon || 'Ngân sách nhà nước';
        document.getElementById('gt-loaihopdong').value = gt.loaiHopDong || 'Trọn gói';
        document.getElementById('gt-thoigiantochuc').value = gt.thoiGianToChuc || '';
        document.getElementById('gt-thoigianbatdautochuc').value = gt.thoiGianBatDauToChuc || '';
        document.getElementById('gt-quatmang').value = gt.quaMang || 'Qua mạng';
        document.getElementById('gt-trongnuocquocte').value = gt.trongNuocQuocTe || 'Trong nước';
        // Load phân lô
        document.getElementById('gt-phanlo').value = gt.phanLo || 'Không';

        document.getElementById('gt-giatribaomothau').value = gt.giaTriDamBaoDuThau ? this.model.formatVND(gt.giaTriDamBaoDuThau) : '';
        document.getElementById('gt-hieuluchsdt').value = gt.hieuLucHsdt || '';
        document.getElementById('gt-hieuluchbaomothau').value = gt.hieuLucDamBaoDuThau || '';

        this.updatePackageFieldsVisibility();

        this._isEditMode = true;
        this._loadPhanLoRows(gt.phanLoList || []);
        this._loadTuyChonMuaThemRows(gt.tuyChonMuaThemList || []);
        this._loadGiaHanRows(gt.giaHanList || []);
        this._loadYeuCauLamRoRows(gt.yeuCauLamRoList || []);
        this._loadTraLoiLamRoRows(gt.traLoiLamRoList || []);

        if (gt.trangThai === 'Đã có kết quả') {
            if (gt.phanLo !== 'Có') {
                document.getElementById('gt-nhathautrungthauid').value = gt.nhaThauTrungThauId || '';
                document.getElementById('gt-giatrungthau').value = gt.giaTrungThau ? this.model.formatVND(gt.giaTrungThau) : '';
                document.getElementById('gt-thoigian-goithau').value = gt.thoiGianGoiThau || '';
                document.getElementById('gt-thoigian-hopdong').value = gt.thoiGianHopDong || '';
            }
        }
        this.updateAwardedContractorUI(gt.awardedPhanLoList || []);

        // Load decision fields
        document.getElementById('gt-soquyetdinh').value = gt.soQuyetDinh || '';
        if (this.view.fpNgayQuyetDinh) {
            this.view.fpNgayQuyetDinh.setDate(gt.ngayQuyetDinh ? new Date(gt.ngayQuyetDinh) : '');
        } else {
            document.getElementById('gt-ngayquyetdinh').value = gt.ngayQuyetDinh ? this.model.formatDate(gt.ngayQuyetDinh) : '';
        }

        // Load 3 new date fields
        if (this.view.fpThoiGianDangTai) {
            this.view.fpThoiGianDangTai.setDate(gt.thoiGianDangTai ? new Date(gt.thoiGianDangTai) : '');
        } else {
            document.getElementById('gt-thoigiandangtai').value = gt.thoiGianDangTai ? this.model.formatDateWithTime(gt.thoiGianDangTai) : '';
        }
        if (this.view.fpThoiGianDongThau) {
            this.view.fpThoiGianDongThau.setDate(gt.thoiGianDongThau ? new Date(gt.thoiGianDongThau) : '');
        } else {
            document.getElementById('gt-thoigiandongthau').value = gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : '';
        }
        if (this.view.fpThoiGianMoThau) {
            this.view.fpThoiGianMoThau.setDate(gt.thoiGianMoThau ? new Date(gt.thoiGianMoThau) : '');
        } else {
            document.getElementById('gt-thoigianmothau').value = gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : '';
        }

        // Load saved experts for Tổ chuyên gia
        const savedToChuyenGia = gt.toChuyenGia || [];
        savedToChuyenGia.forEach(item => {
            const row = document.querySelector(`#to-chuyengia-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
            if (row) {
                const cb = row.querySelector('input[name="tochuyengia-select"]');
                if (cb) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change'));
                }
                const roleSelect = row.querySelector('select[name="tochuyengia-chucvu"]');
                const jobInput = row.querySelector('input[name="tochuyengia-congviec"]');
                if (roleSelect) roleSelect.value = item.chucVu || 'Tổ viên';
                if (jobInput) jobInput.value = item.congViec || '';
            }
        });

        // Load saved experts for Tổ thẩm định
        const savedToThamDinh = gt.toThamDinh || [];
        savedToThamDinh.forEach(item => {
            const row = document.querySelector(`#to-thamdinh-tbody tr[data-expert-id="${item.chuyenGiaId}"]`);
            if (row) {
                const cb = row.querySelector('input[name="tothamdinh-select"]');
                if (cb) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change'));
                }
                const roleSelect = row.querySelector('select[name="tothamdinh-chucvu"]');
                const jobInput = row.querySelector('input[name="tothamdinh-congviec"]');
                if (roleSelect) roleSelect.value = item.chucVu || 'Tổ viên';
                if (jobInput) jobInput.value = item.congViec || '';
            }
        });
        this.enforceSingleLeader('to-chuyengia-tbody', 'tochuyengia-chucvu');
        this.enforceSingleLeader('to-thamdinh-tbody', 'tothamdinh-chucvu');
    } else {
        this.switchTab('goithau', 'taomoi', true);
        if (this.view.fpNgayQuyetDinh) this.view.fpNgayQuyetDinh.clear();
        if (this.view.fpThoiGianDangTai) this.view.fpThoiGianDangTai.clear();
        if (this.view.fpThoiGianDongThau) this.view.fpThoiGianDongThau.clear();
        if (this.view.fpThoiGianMoThau) this.view.fpThoiGianMoThau.clear();

        document.getElementById('modal-goithau-title').textContent = 'Thêm Gói thầu mới';
        form.reset();
        form.removeAttribute('data-original-status');
        document.getElementById('form-goithau-id').value = '';
        document.getElementById('gt-linhvuc').value = 'Hàng hóa';
        document.getElementById('gt-tuychonmuathem').value = 'Không';
        document.getElementById('gt-nguonvon').value = '';
        document.getElementById('gt-loaihopdong').value = 'Trọn gói';
        document.getElementById('gt-thoigiantochuc').value = '';
        document.getElementById('gt-thoigianbatdautochuc').value = '';
        document.getElementById('gt-quatmang').value = 'Qua mạng';
        document.getElementById('gt-trongnuocquocte').value = 'Trong nước';
        // Reset phân lô và tùy chọn mua thêm
        document.getElementById('gt-phanlo').value = 'Không';

        document.getElementById('gt-giatribaomothau').value = '';
        document.getElementById('gt-hieuluchsdt').value = '';
        document.getElementById('gt-hieuluchbaomothau').value = '';

        // Explicitly reset status dropdown to 'Chuẩn bị' and clear all disabled options
        const statusSelectReset = document.getElementById('gt-trangthai');
        if (statusSelectReset) {
            statusSelectReset.querySelectorAll('option').forEach(opt => { opt.disabled = false; });
            statusSelectReset.value = 'Chuẩn bị';
        }

        this.updatePackageFieldsVisibility();

        this._isEditMode = false;
        this._loadPhanLoRows([]);
        this._loadTuyChonMuaThemRows([]);
        this._loadGiaHanRows([]);
        this._loadYeuCauLamRoRows([]);
        this._loadTraLoiLamRoRows([]);

        document.getElementById('gt-nhathautrungthauid').value = '';
        document.getElementById('gt-giatrungthau').value = '';
        document.getElementById('gt-thoigian-goithau').value = '';
        document.getElementById('gt-thoigian-hopdong').value = '';
        this.updateAwardedContractorUI([]);
        const gtMaInput = document.getElementById('gt-ma');
        if (gtMaInput) {
            gtMaInput.removeAttribute('readonly');
        }
    }

    if (this.handleLinhVucChange) {
        this.handleLinhVucChange();
    } else if (this.handleHinhThucChange) {
        this.handleHinhThucChange();
    }
    if (this.handleQuaMangChange) {
        this.handleQuaMangChange();
    }
    if (this.handlePhanLoChange) {
        this.handlePhanLoChange();
    }
    if (this.handleTuyChonMuaThemChange) {
        this.handleTuyChonMuaThemChange();
    }
    const selectedPlanId = document.getElementById('gt-kehoachid').value;
    this.updateNguonVonFieldState(selectedPlanId);
    this.updatePackageFieldsVisibility();

    // Khóa các trường thông tin trước mở thầu nếu gói thầu đã ở trạng thái đã mở thầu hoặc muộn hơn
    const isOpenedOrLater = gt && ['Đã mở thầu', 'Đang chấm thầu', 'Đã có kết quả'].includes(gt.trangThai);
    const preOpeningFields = [
        'gt-ma', 'gt-kehoachid', 'gt-ten', 'gt-gia', 'gt-thoigian', 'gt-hinhthuc',
        'gt-phuongthuc', 'gt-quatmang', 'gt-trongnuocquocte',
        'gt-tuychonmuathem', 'gt-phanlo', 'gt-nguonvon', 'gt-loaihopdong',
        'gt-thoigiantochuc', 'gt-thoigianbatdautochuc', 'gt-soquyetdinh',
        'gt-ngayquyetdinh', 'gt-thoigiandangtai', 'gt-thoigiandongthau',
        'gt-thoigianmothau', 'gt-nhanvienphutrach', 'gt-giatribaomothau', 'gt-hieuluchsdt',
        'gt-hieuluchbaomothau'
    ];

    preOpeningFields.forEach(fieldId => {
        const el = document.getElementById(fieldId);
        if (el) {
            el.disabled = !!isOpenedOrLater;
            // Xử lý searchable select
            const wrapper = el.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${fieldId}"]`);
            if (wrapper) {
                const searchInput = wrapper.querySelector('.custom-select-search');
                if (searchInput) {
                    searchInput.disabled = !!isOpenedOrLater;
                }
            }
        }
    });

    // Khóa/mở khóa flatpickr date inputs
    ['fpNgayQuyetDinh', 'fpThoiGianDangTai', 'fpThoiGianDongThau', 'fpThoiGianMoThau'].forEach(fpKey => {
        const fp = this.view[fpKey];
        if (fp) {
            fp.input.disabled = !!isOpenedOrLater;
            fp.set('clickOpens', !isOpenedOrLater);
        }
    });

    // Khóa/mở khóa tổ chuyên gia và tổ thẩm định
    document.querySelectorAll('#to-chuyengia-tbody input, #to-chuyengia-tbody select, #to-thamdinh-tbody input, #to-thamdinh-tbody select').forEach(el => {
        el.disabled = !!isOpenedOrLater;
    });

    // Khóa/mở khóa phân lô và tùy chọn mua thêm (inputs, selects, buttons xóa dòng)
    document.querySelectorAll('#phanlo-tbody input, #phanlo-tbody select, #phanlo-tbody button, #tuychonmuathem-tbody input, #tuychonmuathem-tbody select, #tuychonmuathem-tbody button').forEach(el => {
        el.disabled = !!isOpenedOrLater;
    });

    // Khóa/mở khóa các nút thao tác thêm dòng, import excel của phân lô và tùy chọn mua thêm
    ['btn-them-phanlo', 'btn-template-phanlo', 'btn-import-excel-phanlo', 'btn-them-tuychonmuathem', 'btn-template-tuychonmuathem', 'btn-import-excel-tuychonmuathem'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = !!isOpenedOrLater;
        }
    });

    // Áp dụng giới hạn quyền cho vai trò Chuyên viên (employee) ở cuối hàm
    if (this.model.state.activerole === 'employee') {
        const empSelect = document.getElementById('gt-nhanvienphutrach');
        if (empSelect) {
            empSelect.disabled = true;
            const wrapper = empSelect.parentNode.querySelector(`.custom-select-wrapper[data-select-id="gt-nhanvienphutrach"]`);
            if (wrapper) {
                const searchInput = wrapper.querySelector('.custom-select-search');
                if (searchInput) {
                    searchInput.disabled = true;
                }
            }
        }
    }

    lucide.createIcons();
    this.view.openModal('modal-goithau');
}

export async function handleGoiThauSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-goithau');
    if (!this.view.validateForm(form)) return;

    // Custom validation for extensions
    const mainDongThauStr = document.getElementById('gt-thoigiandongthau').value;

    // Helper function to parse Date from Vietnamese dd/MM/yyyy HH:mm
    const parseDMYHM = (str) => {
        if (!str) return null;
        const parts = str.trim().split(/\s+/);
        if (parts.length < 2) return null;
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');
        if (dateParts.length < 3 || timeParts.length < 2) return null;
        return new Date(
            parseInt(dateParts[2]),
            parseInt(dateParts[1]) - 1,
            parseInt(dateParts[0]),
            parseInt(timeParts[0]),
            parseInt(timeParts[1])
        );
    };

    const mainDongThauDate = parseDMYHM(mainDongThauStr);
    const ghRows = [];
    let validationError = null;

    document.querySelectorAll('#gt-giahan-tbody tr').forEach((tr, index) => {
        if (validationError) return;
        const timeInput = tr.querySelector('.gh-time-input').value.trim();
        const reasonInput = tr.querySelector('.gh-reason-input').value.trim();

        if (!timeInput || !reasonInput) {
            validationError = `Vui lòng nhập đầy đủ thông tin gia hạn ở dòng Lần ${index + 1}!`;
            return;
        }

        const currentGiaHanDate = parseDMYHM(timeInput);
        if (!currentGiaHanDate) {
            validationError = `Thời gian gia hạn Lần ${index + 1} không hợp lệ!`;
            return;
        }

        if (index === 0) {
            if (mainDongThauDate && currentGiaHanDate <= mainDongThauDate) {
                validationError = `Thời gian gia hạn Lần 1 (${timeInput}) phải lớn hơn thời gian đóng thầu gốc (${mainDongThauStr})!`;
            }
        } else {
            const prevTimeStr = ghRows[index - 1].timeStr;
            const prevGiaHanDate = parseDMYHM(prevTimeStr);
            if (prevGiaHanDate && currentGiaHanDate <= prevGiaHanDate) {
                validationError = `Thời gian gia hạn Lần ${index + 1} (${timeInput}) phải lớn hơn thời gian gia hạn Lần ${index} (${prevTimeStr})!`;
            }
        }

        ghRows.push({ timeStr: timeInput, reason: reasonInput });
    });

    if (validationError) {
        await this.view.customAlert('Dữ liệu không hợp lệ', validationError, 'alert-triangle');
        return;
    }

    const id = document.getElementById('form-goithau-id').value;
    let oldPlanId = null;
    if (id) {
        const oldGt = this.model.state.goithau.find(g => g.id === id);
        if (oldGt) {
            oldPlanId = oldGt.keHoachId;
        }
    }
    const now = new Date();
    const formattedTime = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

    let inputCode = document.getElementById('gt-ma').value.trim();

    if (inputCode) {
        let isDuplicate = false;

        if (id) {
            const oldGt = this.model.state.goithau.find(g => g.id === id);
            const root = oldGt.rootId || oldGt.id;
            isDuplicate = this.model.state.goithau.some(g =>
                g.maGoiThau.toLowerCase() === inputCode.toLowerCase() &&
                (g.rootId || g.id) !== root
            );
        } else {
            isDuplicate = this.model.state.goithau.some(g => g.maGoiThau.toLowerCase() === inputCode.toLowerCase());
        }

        if (isDuplicate) {
            const inputEl = document.getElementById('gt-ma');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Mã gói thầu đã tồn tại ở một gói thầu khác. Vui lòng nhập mã duy nhất!';
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

    const valueDate1 = document.getElementById('gt-thoigiandangtai').value;
    const valueDate2 = document.getElementById('gt-thoigiandongthau').value;
    const valueDate3 = document.getElementById('gt-thoigianmothau').value;
    const valueDate4 = document.getElementById('gt-ngayquyetdinh').value;

    const formattedDate1 = valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : '';
    const formattedDate2 = valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : '';
    const formattedDate3 = valueDate3 ? this.model.convertDMYHMSToYMDHMS(valueDate3) : '';
    const formattedDate4 = valueDate4 ? this.model.convertDMYToYMD(valueDate4) : '';

    const toChuyenGia = [];
    document.querySelectorAll('#to-chuyengia-tbody tr').forEach(row => {
        const cb = row.querySelector('input[name="tochuyengia-select"]');
        if (cb && cb.checked) {
            const roleSelect = row.querySelector('select[name="tochuyengia-chucvu"]');
            const jobInput = row.querySelector('input[name="tochuyengia-congviec"]');
            toChuyenGia.push({
                chuyenGiaId: cb.value,
                chucVu: roleSelect ? roleSelect.value : 'Tổ viên',
                congViec: jobInput ? jobInput.value.trim() : ''
            });
        }
    });

    const toThamDinh = [];
    document.querySelectorAll('#to-thamdinh-tbody tr').forEach(row => {
        const cb = row.querySelector('input[name="tothamdinh-select"]');
        if (cb && cb.checked) {
            const roleSelect = row.querySelector('select[name="tothamdinh-chucvu"]');
            const jobInput = row.querySelector('input[name="tothamdinh-congviec"]');
            toThamDinh.push({
                chuyenGiaId: cb.value,
                chucVu: roleSelect ? roleSelect.value : 'Tổ viên',
                congViec: jobInput ? jobInput.value.trim() : ''
            });
        }
    });

    const toChuyenGiaSection = document.getElementById('to-chuyengia-section');
    const isChuyenGiaVisible = toChuyenGiaSection && toChuyenGiaSection.style.display !== 'none';
    if (isChuyenGiaVisible) {
        const hasLeaderChuyenGia = toChuyenGia.some(cg => cg.chucVu === 'Tổ trưởng');
        if (!hasLeaderChuyenGia) {
            await this.view.customAlert('Lỗi kiểm tra', 'Tổ chuyên gia chấm thầu bắt buộc phải có 1 Tổ trưởng!', 'x-circle');
            return;
        }
    }

    const toThamDinhSection = document.getElementById('to-thamdinh-section');
    const isThamDinhVisible = toThamDinhSection && toThamDinhSection.style.display !== 'none';
    if (isThamDinhVisible) {
        const hasLeaderThamDinh = toThamDinh.some(cg => cg.chucVu === 'Tổ trưởng');
        if (!hasLeaderThamDinh) {
            await this.view.customAlert('Lỗi kiểm tra', 'Tổ thẩm định bắt buộc phải có 1 Tổ trưởng!', 'x-circle');
            return;
        }
    }

    if (id) {
        const originalPackage = this.model.state.goithau.find(g => g.id === id);
        if (originalPackage && originalPackage.trangThai && originalPackage.trangThai !== 'Chuẩn bị') {
            const isTeamChanged = (newTeam, oldTeam) => {
                const oldT = oldTeam || [];
                if (newTeam.length !== oldT.length) return true;
                for (const item of newTeam) {
                    const match = oldT.find(x => x.chuyenGiaId === item.chuyenGiaId);
                    if (!match) return true;
                    if (match.chucVu !== item.chucVu || match.congViec !== item.congViec) return true;
                }
                return false;
            };

            if (isTeamChanged(toChuyenGia, originalPackage.toChuyenGia) || isTeamChanged(toThamDinh, originalPackage.toThamDinh)) {
                const confirmed = await this.view.customConfirm(
                    'Xác nhận thay đổi',
                    'Bạn có chắc chắn muốn thay đổi trạng thái tham gia của chuyên gia này trong tổ không?',
                    'help-circle'
                );
                if (!confirmed) {
                    return;
                }
            }
        }
    }


    const targetStatus = document.getElementById('gt-trangthai').value;
    const linhVuc = document.getElementById('gt-linhvuc').value;
    const isPhanLo = document.getElementById('gt-phanlo').value === 'Có';

    if (targetStatus !== 'Chuẩn bị') {
        const hieuLucHsdtVal = parseInt(document.getElementById('gt-hieuluchsdt')?.value) || 0;
        if (hieuLucHsdtVal <= 0) {
            const inputEl = document.getElementById('gt-hieuluchsdt');
            const formGroup = inputEl ? inputEl.closest('.form-group') : null;
            if (formGroup) formGroup.classList.add('invalid');
            await this.view.customAlert('Thiếu thông tin', 'Gói thầu bắt buộc phải có Thời gian hiệu lực hồ sơ dự thầu lớn hơn 0 khi ở trạng thái Đang mời thầu hoặc muộn hơn!', 'alert-triangle', inputEl);
            return;
        }

        if (linhVuc !== 'Tư vấn' && !isPhanLo) {
            const giaTriDbVal = this.model.parseVND(document.getElementById('gt-giatribaomothau')?.value || '0');
            if (giaTriDbVal <= 0) {
                const inputEl = document.getElementById('gt-giatribaomothau');
                const formGroup = inputEl ? inputEl.closest('.form-group') : null;
                if (formGroup) formGroup.classList.add('invalid');
                await this.view.customAlert('Thiếu thông tin', 'Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 khi ở trạng thái Đang mời thầu hoặc muộn hơn (trừ gói tư vấn)!', 'alert-triangle', inputEl);
                return;
            }
        }
    }

    const collectedPhanLoList = this._collectPhanLoRows();
    const collectedTuyChonList = this._collectTuyChonMuaThemRows();

    if (isPhanLo) {
        if (targetStatus !== 'Chuẩn bị') {
            let emptyInput = null;
            let invalidBaoDamInput = null;
            document.querySelectorAll('#phanlo-tbody tr').forEach(tr => {
                const inp = tr.querySelector('.pl-code-input');
                if (inp && !inp.value.trim() && !emptyInput) {
                    emptyInput = inp;
                }
                const bdInp = tr.querySelector('.pl-baodam-input');
                if (bdInp && linhVuc !== 'Tư vấn') {
                    const bdVal = this.model.parseVND(bdInp.value) || 0;
                    if (bdVal <= 0 && !invalidBaoDamInput) {
                        invalidBaoDamInput = bdInp;
                    }
                }
            });

            if (emptyInput) {
                this.view.customAlert('Thiếu dữ liệu', 'Vui lòng nhập đầy đủ tên phần lô!', 'alert-triangle', emptyInput);
                return;
            }

            if (invalidBaoDamInput) {
                this.view.customAlert('Thiếu dữ liệu', 'Vui lòng nhập đầy đủ giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô!', 'alert-triangle', invalidBaoDamInput);
                return;
            }
        }

        // Kiểm tra giá gói thầu với tổng giá trị của các phần lô
        const giaGoiThau = this.model.parseVND(document.getElementById('gt-gia').value) || 0;
        const totalPhanLoVal = collectedPhanLoList.reduce((sum, item) => sum + (item.giaTriPhanLo || 0), 0);
        if (giaGoiThau !== totalPhanLoVal) {
            const confirmed = await this.view.customConfirm(
                'Cảnh báo chênh lệch giá',
                `Giá gói thầu (${this.model.formatVND(giaGoiThau)} VNĐ) khác với tổng giá trị của các phần lô (${this.model.formatVND(totalPhanLoVal)} VNĐ).\n\nBạn có chắc chắn muốn tiếp tục lưu không?`,
                'alert-triangle'
            );
            if (!confirmed) {
                return;
            }
        }
    }

    const gtData = {
        keHoachId: document.getElementById('gt-kehoachid').value,
        tenGoiThau: document.getElementById('gt-ten').value.trim(),
        giaGoiThau: this.model.parseVND(document.getElementById('gt-gia').value),
        thoiGianThucHien: document.getElementById('gt-thoigian').value.trim(),
        hinhThucLuaChon: document.getElementById('gt-hinhthuc').value,
        phuongThucLuaChon: document.getElementById('gt-phuongthuc').value,
        trangThai: document.getElementById('gt-trangthai').value,
        linhVuc: document.getElementById('gt-linhvuc').value,
        tuyChonMuaThem: document.getElementById('gt-tuychonmuathem').value,
        nguonVon: document.getElementById('gt-nguonvon').value,
        loaiHopDong: document.getElementById('gt-loaihopdong').value,
        thoiGianToChuc: document.getElementById('gt-thoigiantochuc').value.trim(),
        thoiGianBatDauToChuc: document.getElementById('gt-thoigianbatdautochuc').value.trim(),
        quaMang: document.getElementById('gt-quatmang').value,
        trongNuocQuocTe: document.getElementById('gt-trongnuocquocte').value,
        phanLo: document.getElementById('gt-phanlo').value,
        phanLoList: collectedPhanLoList,
        tuyChonMuaThemList: collectedTuyChonList,
        giaHanList: this._collectGiaHanRows(),
        yeuCauLamRoList: this._collectYeuCauLamRoRows(),
        traLoiLamRoList: this._collectTraLoiLamRoRows(),
        soQuyetDinh: document.getElementById('gt-soquyetdinh').value.trim(),
        ngayQuyetDinh: formattedDate4,
        thoiGianDangTai: formattedDate1,
        thoiGianDongThau: formattedDate2,
        thoiGianMoThau: formattedDate3,
        toChuyenGia: toChuyenGia,
        toThamDinh: toThamDinh,
        giaTriDamBaoDuThau: (linhVuc === 'Tư vấn') ? 0 : (isPhanLo ? collectedPhanLoList.reduce((sum, item) => sum + (item.baoDamDuThau || 0), 0) : this.model.parseVND(document.getElementById('gt-giatribaomothau')?.value || '0')),
        hieuLucHsdt: parseInt(document.getElementById('gt-hieuluchsdt')?.value) || null,
        hieuLucDamBaoDuThau: parseInt(document.getElementById('gt-hieuluchbaomothau')?.value) || null
    };

    if (gtData.trangThai === 'Đã có kết quả') {
        if (!isPhanLo) {
            gtData.nhaThauTrungThauId = document.getElementById('gt-nhathautrungthauid').value;
            gtData.giaTrungThau = this.model.parseVND(document.getElementById('gt-giatrungthau').value);
            gtData.thoiGianGoiThau = document.getElementById('gt-thoigian-goithau').value.trim();
            gtData.thoiGianHopDong = document.getElementById('gt-thoigian-hopdong').value.trim();
            gtData.awardedPhanLoList = [];
        } else {
            gtData.awardedPhanLoList = this._collectAwardedPhanLoRows();
            gtData.nhaThauTrungThauId = '';
            gtData.giaTrungThau = null;
        }
    } else {
        gtData.nhaThauTrungThauId = '';
        gtData.giaTrungThau = null;
        gtData.thoiGianGoiThau = '';
        gtData.thoiGianHopDong = '';
        gtData.awardedPhanLoList = [];
    }

    if (id) {
        const oldGt = this.model.state.goithau.find(g => g.id === id);
        const newTen = gtData.tenGoiThau;

        const saveAsNewVersion = await this.view.customConfirm(
            "Lưu phiên bản mới?",
            "Bạn có muốn lưu các thay đổi này thành một phiên bản mới không?\n\n• Chọn Xác nhận để lưu thành phiên bản mới.\n• Chọn Hủy để ghi đè lên phiên bản hiện tại.",
            "help-circle"
        );

        if (saveAsNewVersion === null) {
            return;
        }

        if (saveAsNewVersion) {
            const rootId = oldGt.rootId || oldGt.id;
            const relatedGts = this.model.state.goithau.filter(g => (g.rootId || g.id) === rootId);
            const maxVersion = Math.max(...relatedGts.map(g => parseInt(g.phienBan) || 0));
            const nextVersion = String(maxVersion + 1).padStart(2, '0');

            relatedGts.forEach(g => { g.isLatest = 0; g.is_latest = 0; });
            const newGtId = window.generateUUID();
            this.model.state.goithau.push({
                id: newGtId,
                maGoiThau: inputCode,
                phienBan: nextVersion,
                isLatest: 1,
                is_latest: 1,
                rootId: rootId,
                createdAt: oldGt.createdAt || Math.floor(Date.now() / 1000),
                created_at: oldGt.created_at || Math.floor(Date.now() / 1000),
                updatedAt: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
                ...gtData
            });

            // Chuyển giao liên kết hợp đồng từ phiên bản cũ sang phiên bản mới
            if (Array.isArray(this.model.state.hopdong)) {
                this.model.state.hopdong = this.model.state.hopdong.map(h => {
                    if (h.goiThauIds && h.goiThauIds.includes(id)) {
                        return {
                            ...h,
                            goiThauIds: h.goiThauIds.map(gid => gid === id ? newGtId : gid)
                        };
                    }
                    return h;
                });
                this.model.persistData('hopdong');
            }

            // Chuyển giao thông tin mở thầu (thongtinmothau) từ phiên bản cũ sang phiên bản mới
            if (Array.isArray(this.model.state.thongtinmothau)) {
                this.model.state.thongtinmothau = this.model.state.thongtinmothau.map(b => {
                    if (String(b.goiThauId) === String(id)) {
                        return { ...b, goiThauId: newGtId };
                    }
                    return b;
                });
                this.model.persistData('thongtinmothau');
            }

            const assignedEmpId = document.getElementById('gt-nhanvienphutrach').value;
            if (assignedEmpId) {
                await this.model.addRecord('assignments', { id: window.generateUUID(), empId: assignedEmpId, targetId: newGtId, type: 'goithau' });
            }
        } else {
            oldGt.maGoiThau = inputCode;
            Object.assign(oldGt, gtData);
            oldGt.updatedAt = Math.floor(Date.now() / 1000);
            oldGt.updated_at = oldGt.updatedAt;

            // Cập nhật/Xóa phân công chuyên viên cho gói thầu hiện tại khi ghi đè
            const assignedEmpId = document.getElementById('gt-nhanvienphutrach').value;
            const oldAssignments = this.model.state.assignments.filter(a => a.targetId === id && a.type === 'goithau');
            for (const oldA of oldAssignments) {
                await this.model.deleteRecord('assignments', oldA.id);
            }
            if (assignedEmpId) {
                await this.model.addRecord('assignments', { id: window.generateUUID(), empId: assignedEmpId, targetId: id, type: 'goithau' });
            }
        }
    } else {
        const newGtId = window.generateUUID();
        this.model.state.goithau.push({
            id: newGtId,
            maGoiThau: inputCode,
            phienBan: '00',
            isLatest: 1,
            is_latest: 1,
            rootId: newGtId,
            createdAt: Math.floor(Date.now() / 1000),
            created_at: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            updated_at: Math.floor(Date.now() / 1000),
            ...gtData
        });

        const assignedEmpId = document.getElementById('gt-nhanvienphutrach').value;
        if (assignedEmpId) {
            await this.model.addRecord('assignments', { id: window.generateUUID(), empId: assignedEmpId, targetId: newGtId, type: 'goithau' });
        }
    }

    this.model.persistData('goithau');

    if (oldPlanId) {
        this.recalculatePlanTotal(oldPlanId);
    }
    if (gtData.keHoachId && gtData.keHoachId !== oldPlanId) {
        this.recalculatePlanTotal(gtData.keHoachId);
    }

    // Recalculate and update Breakdown modal if open
    const breakdownPlanId = document.getElementById('breakdown-plan-id')?.value;
    const modalBreakdown = document.getElementById('modal-plan-breakdown');
    if (modalBreakdown && modalBreakdown.classList.contains('active') && breakdownPlanId) {
        this.renderBreakdownPackagesList(breakdownPlanId);
        this.updateBreakdownTotal(breakdownPlanId);
    }

    this.view.closeModal('modal-goithau');
    this.view.renderGoiThauTable();
    this.autoSync();

    if (this.packageWizard.active) {
        if (this.packageWizard.currentCount < this.packageWizard.totalCount) {
            this.packageWizard.currentCount++;
            setTimeout(() => { this.openPackageWizardStep(); }, 300);
        } else {
            this.packageWizard.active = false;
            this.packageWizard.planId = null;
            this.packageWizard.totalCount = 0;
            this.packageWizard.currentCount = 0;
            await this.view.customAlert("Thành công", "Đã thêm toàn bộ các gói thầu theo kế hoạch thành công!", "check-circle");
        }
    }
}

export function setupExcelImportEvents() {
    // Bind all main tab import buttons
    document.querySelectorAll('.btn-import-excel').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-type');
            this.openExcelImportModal(type);
        });
    });

    const fileInput = document.getElementById('excel-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleExcelUpload(file);
        });
    }

    const dragDropZone = document.getElementById('excel-drag-drop-zone');
    if (dragDropZone && fileInput) {
        dragDropZone.addEventListener('click', () => fileInput.click());
        dragDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dragDropZone.classList.add('dragover');
        });
        dragDropZone.addEventListener('dragleave', () => {
            dragDropZone.classList.remove('dragover');
        });
        dragDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDropZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) {
                fileInput.files = e.dataTransfer.files;
                this.handleExcelUpload(file);
            }
        });
    }

    const saveImportBtn = document.getElementById('btn-save-excel-import');
    if (saveImportBtn) {
        saveImportBtn.addEventListener('click', () => this.saveExcelImport());
    }

    const downloadTemplateBtn = document.getElementById('btn-download-excel-template');
    if (downloadTemplateBtn) {
        downloadTemplateBtn.addEventListener('click', () => {
            const type = this._excelImportType || 'kehoach';
            authFetchDownload(`/api/export-excel-template/${type}`, `Mau_nhap_lieu_${type}.xlsx`);

        });
    }
}

export function openExcelImportModal(type) {
    this._excelImportType = type; // 'kehoach', 'goithau', 'chudautu', 'nhathau', 'chuyengia', 'hopdong', 'mothau'

    const fileInput = document.getElementById('excel-file-input');
    if (fileInput) fileInput.value = '';

    const fileInfo = document.getElementById('excel-file-info');
    if (fileInfo) fileInfo.style.display = 'none';

    const previewContainer = document.getElementById('excel-preview-container');
    if (previewContainer) previewContainer.style.display = 'none';

    const saveBtn = document.getElementById('btn-save-excel-import');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.style.display = 'none';
    }

    const modalTitle = document.getElementById('modal-excel-import-title');
    if (modalTitle) {
        let typeText = 'Kế hoạch LCNT';
        if (type === 'goithau' || type === 'package') typeText = 'Gói thầu';
        else if (type === 'chudautu') typeText = 'Chủ đầu tư';
        else if (type === 'nhathau') typeText = 'Nhà thầu';
        else if (type === 'chuyengia') typeText = 'Chuyên gia';
        else if (type === 'hopdong') typeText = 'Hợp đồng';
        else if (type === 'mothau') typeText = 'Thông tin Mở thầu';
        else if (type === 'danhgiahsdt') typeText = 'Đánh giá HSDT';
        else if (type === 'ketquaqd') typeText = 'Kết quả phê duyệt LCNT';

        modalTitle.textContent = `Nhập khẩu ${typeText} từ Excel`;
    }

    // Configure Excel modal template download to dynamically match mothau packages if chosen
    const downloadTemplateBtn = document.getElementById('btn-download-excel-template');
    if (downloadTemplateBtn) {
        // Clear all previous listeners
        const clone = downloadTemplateBtn.cloneNode(true);
        downloadTemplateBtn.parentNode.replaceChild(clone, downloadTemplateBtn);

        clone.onclick = (e) => {
            e.preventDefault();
            if (this._excelImportType === 'mothau') {
                // Dynamically trigger the Excel template download
                const select = document.getElementById('mothau-goithau-select');
                if (!select || !select.value) {
                    this.view.customAlert('Chưa chọn Gói thầu', 'Vui lòng chọn gói thầu ở màn hình nhập mở thầu trước để tải file mẫu tương ứng!', 'alert-triangle');
                    return;
                }
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

                const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                const lotCodes = (gt.phanLoList || []).map(l => l.maPhanLo).join(',');

                // Redirect to backend API for downloading the strictly validated template
                authFetchDownload(`/api/export-mothau-template?case_type=${caseType}&package_name=${encodeURIComponent(safeCode)}&lot_codes=${encodeURIComponent(lotCodes)}`, `Mau_Mo_Thau_${caseType}_${safeCode}.xlsx`);
            } else if (this._excelImportType === 'danhgiahsdt') {
                const select = document.getElementById('danhgiahsdt-goithau-select');
                if (!select || !select.value) {
                    this.view.customAlert('Chưa chọn Gói thầu', 'Vui lòng chọn gói thầu ở màn hình đánh giá HSDT trước để tải file mẫu tương ứng!', 'alert-triangle');
                    return;
                }
                const gtId = select.value;
                const gt = this.model.state.goithau.find(g => g.id === gtId);
                if (!gt) return;
                const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                authFetchDownload(`/api/export-danhgiahsdt-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`, `DanhGia_HSDT_${safeCode}.xlsx`);
            } else if (this._excelImportType === 'ketquaqd') {
                const gtId = this._currentResultPackageId;
                if (!gtId) {
                    this.view.customAlert('Chưa chọn Gói thầu', 'Không tìm thấy thông tin gói thầu hiện tại!', 'alert-triangle');
                    return;
                }
                const gt = this.model.state.goithau.find(g => g.id === gtId);
                if (!gt) return;
                const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                authFetchDownload(`/api/export-ketquaqd-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`, `KetQua_QD_${safeCode}.xlsx`);
            } else {
                const type = this._excelImportType || 'kehoach';
                authFetchDownload(`/api/export-excel-template/${type}`, `Mau_nhap_lieu_${type}.xlsx`);
            }
        };
    }

    this.view.openModal('modal-excel-preview');
}

export async function handleExcelUpload(file) {
    const fileInfo = document.getElementById('excel-file-info');
    if (fileInfo) {
        document.getElementById('excel-filename').textContent = file.name;
        document.getElementById('excel-filesize').textContent = (file.size / 1024).toFixed(2) + ' KB';
        fileInfo.style.display = 'flex';
    }

    if (this._excelImportType === 'danhgiahsdt') {
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = evt.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(sheet);

                if (!json || json.length === 0) {
                    await this.view.customAlert('Thất bại', 'File Excel không có dữ liệu đánh giá HSDT!', 'alert-triangle');
                    return;
                }

                const select = document.getElementById('danhgiahsdt-goithau-select');
                const gtId = select ? select.value : '';
                const gt = this.model.state.goithau.find(g => g.id === gtId);
                if (!gt) {
                    await this.view.customAlert('Thất bại', 'Vui lòng chọn gói thầu trước khi nhập Excel!', 'alert-triangle');
                    return;
                }

                const hasPhanLo = gt.phanLo === 'Có';

                const parsedBids = json.map(row => {
                    const maNhaThau = String(row['Mã nhà thầu'] || row['Mã định danh'] || row['Mã số thuế'] || row['Mã'] || '').trim();
                    const tenNhaThau = String(row['Tên nhà thầu'] || row['Nhà thầu'] || '').trim();
                    const maPhanLo = String(row['Mã phần lô'] || row['Phần lô'] || row['Mã lô'] || '').trim();
                    const danhGiaHopLe = String(row['Đánh giá hợp lệ'] || row['Đánh giá tính hợp lệ'] || row['Hợp lệ'] || '').trim();
                    const danhGiaNangLuc = String(row['Đánh giá năng lực'] || row['Đánh giá năng lực kinh nghiệm'] || row['Năng lực'] || '').trim();
                    const danhGiaKyThuat = String(row['Đánh giá kỹ thuật'] || row['Kỹ thuật'] || '').trim();
                    const danhGiaKetLuan = String(row['Kết luận'] || row['Kết quả'] || '').trim();
                    const lamRoHopLe = String(row['Làm rõ hợp lệ'] || row['Làm rõ tính hợp lệ'] || '').trim();
                    const lamRoNangLuc = String(row['Làm rõ năng lực'] || row['Làm rõ năng lực kinh nghiệm'] || '').trim();
                    const lamRoKyThuat = String(row['Làm rõ kỹ thuật'] || '').trim();
                    const lamRoTaiChinh = String(row['Làm rõ tài chính'] || '').trim();

                    const existingBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId));
                    let foundBid = existingBids.find(b => {
                        const matchNt = (b.maNhaThau && maNhaThau && b.maNhaThau.toLowerCase() === maNhaThau.toLowerCase()) ||
                            (b.tenNhaThau && tenNhaThau && b.tenNhaThau.toLowerCase() === tenNhaThau.toLowerCase());
                        if (hasPhanLo) {
                            return matchNt && b.maPhanLo === maPhanLo;
                        }
                        return matchNt;
                    });

                    let isValid = true;
                    let comment = 'Hợp lệ';

                    if (!foundBid) {
                        isValid = false;
                        comment = `Không tìm thấy nhà thầu/lô tương ứng trong thông tin mở thầu của gói thầu này!`;
                    }

                    const rec = {
                        _valid: isValid,
                        _comment: comment,
                        id: foundBid ? foundBid.id : '',
                        maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
                        tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
                        danhGiaHopLe,
                        danhGiaNangLuc,
                        danhGiaKyThuat,
                        danhGiaKetLuan,
                        lamRoHopLe,
                        lamRoNangLuc,
                        lamRoKyThuat,
                        lamRoTaiChinh
                    };
                    if (hasPhanLo) {
                        rec.maPhanLo = foundBid ? foundBid.maPhanLo : maPhanLo;
                        rec.tenPhanLo = foundBid ? foundBid.tenPhanLo : '';
                    }
                    return rec;
                });

                this._excelImportData = parsedBids;
                this.view.renderExcelPreview(this._excelImportData, this._excelImportType);

                const saveBtn = document.getElementById('btn-save-excel-import');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.style.display = 'inline-flex';
                }
            } catch (err) {
                console.error(err);
                await this.view.customAlert('Lỗi', 'Không thể đọc tệp tin Excel này. Vui lòng kiểm tra lại!', 'alert-triangle');
            }
        };
        reader.readAsBinaryString(file);
        return;
    }

    if (this._excelImportType === 'ketquaqd') {
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = evt.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(sheet);

                if (!json || json.length === 0) {
                    await this.view.customAlert('Thất bại', 'File Excel không có dữ liệu kết quả phê duyệt LCNT!', 'alert-triangle');
                    return;
                }

                const gtId = this._currentResultPackageId;
                const gt = this.model.state.goithau.find(g => g.id === gtId);
                if (!gt) {
                    await this.view.customAlert('Thất bại', 'Vui lòng chọn gói thầu trước khi nhập Excel!', 'alert-triangle');
                    return;
                }

                const parsedBids = json.map(row => {
                    const maNhaThau = String(row['Mã nhà thầu'] || row['Mã định danh'] || row['Mã số thuế'] || row['Mã'] || '').trim();
                    const tenNhaThau = String(row['Tên nhà thầu'] || row['Nhà thầu'] || '').trim();
                    const trangThai = String(row['Trúng thầu/Trượt thầu'] || row['Trúng thầu/trượt thầu'] || row['Trạng thái'] || row['Kết quả'] || '').trim();
                    const lyDoTruot = String(row['Lý do trượt'] || row['Lý do trượt thầu'] || '').trim();
                    const giaTrungThauRaw = String(row['Giá trúng thầu'] || row['Giá trúng'] || row['Giá trúng thầu (VND)'] || '').trim();
                    const thoiGianGoiThau = String(row['Thời gian thực hiện gói thầu'] || row['Thời gian gói'] || '').trim();
                    const thoiGianHopDong = String(row['Thời gian thực hiện hợp đồng'] || row['Thời gian hợp đồng'] || '').trim();

                    const existingBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId));
                    let foundBid = existingBids.find(b => {
                        const bMa = b.maNhaThau || b.maDinhDanh || '';
                        return (bMa && maNhaThau && bMa.toLowerCase() === maNhaThau.toLowerCase()) ||
                            (b.tenNhaThau && tenNhaThau && b.tenNhaThau.toLowerCase() === tenNhaThau.toLowerCase());
                    });

                    let isValid = true;
                    let comment = 'Hợp lệ';

                    if (!foundBid) {
                        isValid = false;
                        comment = `Không tìm thấy nhà thầu tương ứng trong thông tin mở thầu của gói thầu này!`;
                    }

                    return {
                        _valid: isValid,
                        _comment: comment,
                        id: foundBid ? foundBid.id : '',
                        nhaThauId: foundBid ? foundBid.nhaThauId : '',
                        maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
                        tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
                        trangThai,
                        lyDoTruot,
                        giaTrungThau: this.model.parseVND(giaTrungThauRaw) || 0,
                        thoiGianGoiThau,
                        thoiGianHopDong
                    };
                });

                this._excelImportData = parsedBids;
                this.view.renderExcelPreview(this._excelImportData, this._excelImportType);

                const saveBtn = document.getElementById('btn-save-excel-import');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.style.display = 'inline-flex';
                }
            } catch (err) {
                console.error(err);
                await this.view.customAlert('Lỗi', 'Không thể đọc tệp tin Excel này. Vui lòng kiểm tra lại!', 'alert-triangle');
            }
        };
        reader.readAsBinaryString(file);
        return;
    }

    if (this._excelImportType === 'mothau') {
        // Parse 'mothau' type client-side using SheetJS (no backend endpoint required)
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = evt.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(sheet);

                if (!json || json.length === 0) {
                    await this.view.customAlert('Thất bại', 'File Excel không có dữ liệu nhập mở thầu!', 'alert-triangle');
                    return;
                }

                const select = document.getElementById('mothau-goithau-select');
                const gtId = select ? select.value : '';
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

                const parsedBids = json.map(row => {
                    const maNhaThau = String(row['Mã nhà thầu'] || row['Mã định danh'] || row['Mã nhà thầu'] || row['Mã số thuế'] || row['Mã'] || '').trim();
                    const maDinhDanh = maNhaThau; // Merged
                    const rawNhaThau = String(row['Tên nhà thầu (Nhập chính xác)'] || row['Tên nhà thầu'] || row['Nhà thầu'] || '').trim();
                    const loaiNhaThau = String(row['Loại nhà thầu'] || 'Độc lập').trim();

                    let foundNhaThau = this.model.state.nhathau.find(n =>
                        (n.maNhaThau && maNhaThau && n.maNhaThau.toLowerCase() === maNhaThau.toLowerCase()) ||
                        (n.tenNhaThau && rawNhaThau && n.tenNhaThau.toLowerCase() === rawNhaThau.toLowerCase())
                    );

                    const nhaThauId = foundNhaThau ? foundNhaThau.id : window.generateUUID();

                    const maPhanLo = String(row['Mã phần lô'] || row['Phần lô'] || row['Mã lô'] || '').trim();
                    let tenPhanLo = String(row['Tên phần lô (Tự động điền)'] || row['Tên phần lô'] || row['Tên lô'] || '').trim();
                    if (maPhanLo && !tenPhanLo && gt.phanLoList) {
                        const matchedLot = gt.phanLoList.find(l => l.maPhanLo === maPhanLo);
                        if (matchedLot) tenPhanLo = matchedLot.tenPhanLo;
                    }

                    const giaDuThau = row['Giá dự thầu (VND)'] || row['Giá dự thầu'] || row['Giá'] || '';
                    const damBaoDuThau = row['Đảm bảo dự thầu (VND)'] || row['Đảm bảo dự thầu'] || row['Đảm bảo'] || '';
                    const giaTriDamBao = row['Giá trị ĐB DT (VND)'] || row['Giá trị ĐB'] || row['Giá trị ĐB DT'] || '';

                    const hieuLucDamBao = String(row['Hiệu lực đảm bảo (ngày)'] || row['Hiệu lực đảm bảo'] || row['Hiệu lực bảo đảm'] || '').trim();
                    const hieuLucHsdxt = String(row['Hiệu lực E-HSĐXKT (ngày)'] || row['Hiệu lực E-HSĐXKT'] || '').trim();
                    const hieuLucHsdt = parseInt(row['Hiệu lực E-HSDT (ngày)'] || row['Hiệu lực E-HSDT'] || '90', 10);
                    const thoiGianThucHien = String(row['Thời gian thực hiện (ngày)'] || row['Thời gian thực hiện'] || '').trim();
                    const tyLeGiamGia = parseFloat(row['Tỷ lệ giảm giá (%)'] || row['Tỷ lệ giảm (%)'] || row['Tỷ lệ giảm'] || '0');
                    const giaSauGiamGia = row['Giá sau giảm giá (nếu có)'] || row['Giá sau giảm giá'] || '';
                    const hieuLucBaoDamNgay = parseInt(row['Hiệu lực ĐB (ngày)'] || row['Hiệu lực ĐB'] || '120', 10);

                    // Client validation
                    let isValid = true;
                    let comment = 'Hợp lệ';

                    if (!rawNhaThau) {
                        isValid = false;
                        comment = 'Tên nhà thầu không được để trống!';
                    } else if (!maNhaThau) {
                        isValid = false;
                        comment = 'Mã nhà thầu không được để trống!';
                    }
                    if (hasPhanLo && !maPhanLo) {
                        isValid = false;
                        comment = 'Mã phần lô không được để trống!';
                    }

                    const record = {
                        _valid: isValid,
                        _comment: comment,
                        maDinhDanh,
                        nhaThauId,
                        maNhaThau,
                        tenNhaThau: rawNhaThau,
                        loaiNhaThau,
                        damBaoDuThau: this.model.parseVND(damBaoDuThau),
                        hieuLucDamBao,
                        hieuLucHsdxt,
                        giaDuThau: this.model.parseVND(giaDuThau),
                        tyLeGiamGia,
                        giaSauGiamGia: this.model.parseVND(giaSauGiamGia),
                        hieuLucHsdt,
                        giaTriDamBao: this.model.parseVND(giaTriDamBao),
                        hieuLucBaoDamNgay,
                        thoiGianThucHien
                    };

                    if (hasPhanLo) {
                        record.maPhanLo = maPhanLo;
                        record.tenPhanLo = tenPhanLo;
                    }

                    return record;
                });

                this._excelImportData = parsedBids;

                // Render preview table via BiddingView
                this.view.renderExcelPreview(this._excelImportData, this._excelImportType);

                const saveBtn = document.getElementById('btn-save-excel-import');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.style.display = 'inline-flex';
                }
            } catch (err) {
                console.error(err);
                await this.view.customAlert('Lỗi', 'Không thể đọc tệp tin Excel này. Vui lòng kiểm tra lại!', 'alert-triangle');
            }
        };
        reader.readAsBinaryString(file);
        return;
    }

    // Convert internal compatibility names to backend route expectations
    let apiType = this._excelImportType;
    if (apiType === 'plan') apiType = 'kehoach';
    if (apiType === 'package') apiType = 'goithau';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', apiType);

    try {
        const res = await fetch('/api/import-excel', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (res.ok && data.success) {
            this._excelImportData = data.rows || data.data || [];

            // Render preview table via our dynamic PlanView function
            this.view.renderExcelPreview(this._excelImportData, this._excelImportType);

            const saveBtn = document.getElementById('btn-save-excel-import');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.display = 'inline-flex';
            }
        } else {
            await this.view.customAlert('Thất bại', data.error || 'Không thể đọc tệp tin Excel này.', 'alert-triangle');
        }
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
    }
}

export async function saveExcelImport() {
    if (!this._excelImportData || this._excelImportData.length === 0) return;

    const type = this._excelImportType;
    let count = 0;

    if (type === 'plan' || type === 'kehoach') {
        const mappedData = this._excelImportData.map(row => {
            const planId = window.generateUUID();
            return {
                id: planId,
                maKeHoach: row.maKeHoach || '',
                phienBan: '00',
                isLatest: 1,
                is_latest: 1,
                rootId: planId,
                tenKeHoach: row.tenKeHoach || '',
                tenDuAnDuToan: row.tenDuAnDuToan || '',
                chuDauTuId: '',
                tongMucDauTu: parseFloat(row.tongMucDauTu) || 0,
                ngayPheDuyet: row.ngayPheDuyet ? this.model.convertDMYToYMD(row.ngayPheDuyet) : '',
                quyetDinhPheDuyet: row.quyetDinhPheDuyet || '',
                thoiGianDangMa: row.thoiGianDangMa ? this.model.convertDMYToYMD(row.thoiGianDangMa) + ' 00:00:00' : ''
            };
        });
        this.model.state.kehoach.push(...mappedData);
        this.model.persistData('kehoach');
        this.view.renderKeHoachTable();
        count = mappedData.length;
    } else if (type === 'package' || type === 'goithau') {
        const latestPlans = this.model.getLatestPlans();
        const mappedData = this._excelImportData.map(row => {
            const matchedPlan = latestPlans.find(p => p.maKeHoach.toLowerCase() === (row.keHoachId || row.maKeHoach || '').toLowerCase());
            const gtId = window.generateUUID();
            return {
                id: gtId,
                maGoiThau: row.maGoiThau || '',
                phienBan: '00',
                isLatest: 1,
                is_latest: 1,
                rootId: gtId,
                keHoachId: matchedPlan ? matchedPlan.id : '',
                tenGoiThau: row.tenGoiThau || '',
                giaGoiThau: isNaN(parseFloat(row.giaGoiThau)) ? null : parseFloat(row.giaGoiThau),
                thoiGianThucHien: parseInt(row.thoiGianThucHien) || 0,
                hinhThucLuaChon: row.hinhThucLuaChon || 'Đấu thầu rộng rãi',
                phuongThucLuaChon: row.phuongThucLuaChon || 'Một giai đoạn một túi hồ sơ',
                trangThai: row.trangThai || 'Chưa thực hiện',
                linhVuc: row.linhVuc || 'Xây lắp',
                tuyChonMuaThem: 'Không',
                nguonVon: 'Ngân sách nhà nước',
                loaiHopDong: 'Trọn gói',
                thoiGianToChuc: '',
                thoiGianBatDauToChuc: '',
                quaMang: 'Qua mạng',
                trongNuocQuocTe: 'Trong nước',
                phanLo: 'Không',
                phanLoList: [],
                tuyChonMuaThemList: [],
                soQuyetDinh: '',
                ngayQuyetDinh: '',
                thoiGianDangTai: '',
                thoiGianDongThau: '',
                thoiGianMoThau: '',
                toChuyenGia: [],
                toThamDinh: []
            };
        });
        this.model.state.goithau.push(...mappedData);
        this.model.persistData('goithau');

        // Recalculate plan totals for imported packages
        const importedPlanIds = [...new Set(mappedData.map(gt => gt.keHoachId).filter(Boolean))];
        importedPlanIds.forEach(pid => this.recalculatePlanTotal(pid));

        this.view.renderGoiThauTable();
        count = mappedData.length;
    } else if (type === 'chudautu') {
        const mappedData = this._excelImportData.map(row => {
            const newId = window.generateUUID();
            return {
                id: newId,
                rootId: newId,
                phienBan: '00',
                phien_ban: '00',
                isLatest: 1,
                is_latest: 1,
                maChuDauTu: row.maChuDauTu || '',
                maSoThue: row.maSoThue || '',
                tenChuDauTu: row.tenChuDauTu || '',
                chucVuNguoiDungDau: row.chucVuNguoiDungDau || '',
                nguoiKyQuyetDinh: row.nguoiKyQuyetDinh || '',
                chucVuNguoiKy: row.chucVuNguoiKy || '',
                danhXung: row.danhXung || 'Ông',
                diaChi: row.diaChi || '',
                soDienThoai: row.soDienThoai || '',
                soTaiKhoan: row.soTaiKhoan || '',
                noiMoTaiKhoan: row.noiMoTaiKhoan || '',
                email: row.email || '',
                maQHNS: row.maQHNS || ''
            };
        });
        this.model.state.chudautu.push(...mappedData);
        this.model.persistData('chudautu');
        this.view.renderChuDauTuTable();
        count = mappedData.length;
    } else if (type === 'nhathau') {
        const mappedData = this._excelImportData.map(row => {
            const newId = window.generateUUID();
            return {
                id: newId,
                rootId: newId,
                phienBan: '00',
                phien_ban: '00',
                isLatest: 1,
                is_latest: 1,
                maNhaThau: row.maNhaThau || '',
                tenNhaThau: row.tenNhaThau || '',
                loaiNhaThau: row.loaiNhaThau || 'Độc lập',
                maSoThue: row.maSoThue || '',
                nguoiDaiDien: row.nguoiDaiDien || '',
                danhXung: row.danhXung || 'Ông',
                soDienThoai: row.soDienThoai || '',
                email: row.email || '',
                diaChi: row.diaChi || '',
                soTaiKhoan: row.soTaiKhoan || '',
                noiMoTaiKhoan: row.noiMoTaiKhoan || '',
                maNganHang: row.maNganHang || '',
                thanhVienLienDanh: []
            };
        });
        this.model.state.nhathau.push(...mappedData);
        this.model.persistData('nhathau');
        this.view.renderNhaThauTable();
        count = mappedData.length;
    } else if (type === 'chuyengia') {
        const mappedData = this._excelImportData.map(row => {
            const newId = window.generateUUID();
            return {
                id: newId,
                rootId: newId,
                phienBan: '00',
                phien_ban: '00',
                isLatest: 1,
                is_latest: 1,
                hoTen: row.hoTen || '',
                soCCCD: row.soCCCD || '',
                ngayCapCCCD: row.ngayCapCCCD ? this.model.convertDMYToYMD(row.ngayCapCCCD) : '',
                noiCapCCCD: row.noiCapCCCD || '',
                soChungChi: row.soChungChi || '',
                ngayCapChungChi: row.ngayCapChungChi ? this.model.convertDMYToYMD(row.ngayCapChungChi) : '',
                donViCapChungChi: row.donViCapChungChi || '',
                anhChungChi: '',
                tenAnhChungChi: '',
                anhChuKy: '',
                tenAnhChuKy: ''
            };
        });
        this.model.state.chuyengia.push(...mappedData);
        this.model.persistData('chuyengia');
        this.view.renderChuyenGiaTable();
        count = mappedData.length;
    } else if (type === 'hopdong') {
        const mappedData = this._excelImportData.map(row => {
            const cdt = this.model.state.chudautu.find(c => c.maChuDauTu.toLowerCase() === (row.chuDauTuId || '').toLowerCase());
            const nt = this.model.state.nhathau.find(n => n.maNhaThau.toLowerCase() === (row.nhaThauId || '').toLowerCase());

            const newId = window.generateUUID();
            return {
                id: newId,
                rootId: newId,
                phienBan: '00',
                phien_ban: '00',
                isLatest: 1,
                is_latest: 1,
                tenHopDong: row.tenHopDong || '',
                soHopDong: row.soHopDong || '',
                ngayKy: row.ngayKy ? this.model.convertDMYToYMD(row.ngayKy) : '',
                chuDauTuId: cdt ? cdt.id : '',
                nhaThauId: nt ? nt.id : '',
                giaTri: parseFloat(row.giaTri) || 0,
                loaiHopDong: row.loaiHopDong || 'Trọn gói',
                soNgayThucHien: row.soNgayThucHien ? String(row.soNgayThucHien).trim() : '',
                goiThauIds: []
            };
        });
        this.model.state.hopdong.push(...mappedData);
        this.model.persistData('hopdong');
        this.view.renderHopDongTable();
        count = mappedData.length;
    } else if (type === 'mothau') {
        const select = document.getElementById('mothau-goithau-select');
        const gtId = select ? select.value : '';
        if (gtId) {
            // Remove existing bids for this package before saving new ones
            this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) !== String(gtId));

            const validRows = this._excelImportData.filter(r => r._valid);
            validRows.forEach(row => {
                // Ensure Contractor is registered in DB during Excel save
                let foundNt = this.model.state.nhathau.find(n =>
                    (n.maNhaThau && row.maNhaThau && n.maNhaThau.toLowerCase() === row.maNhaThau.toLowerCase()) ||
                    (n.tenNhaThau && row.tenNhaThau && n.tenNhaThau.toLowerCase() === row.tenNhaThau.toLowerCase())
                );

                if (!foundNt && row.tenNhaThau) {
                    const newId = window.generateUUID();
                    foundNt = {
                        id: newId,
                        rootId: newId,
                        phienBan: '00',
                        phien_ban: '00',
                        isLatest: 1,
                        is_latest: 1,
                        maNhaThau: row.maNhaThau || 'NT-' + window.generateUUID().toString().substr(8),
                        tenNhaThau: row.tenNhaThau,
                        loaiNhaThau: row.loaiNhaThau || 'Độc lập',
                        maSoThue: '',
                        nguoiDaiDien: '',
                        danhXung: 'Ông',
                        soDienThoai: '',
                        email: '',
                        diaChi: '',
                        soTaiKhoan: '',
                        noiMoTaiKhoan: '',
                        maNganHang: '',
                        thanhVienLienDanh: []
                    };
                    this.model.state.nhathau.push(foundNt);
                    this.model.persistData('nhathau');
                } else if (foundNt && row.loaiNhaThau && foundNt.loaiNhaThau !== row.loaiNhaThau) {
                    foundNt.loaiNhaThau = row.loaiNhaThau;
                    this.model.persistData('nhathau');
                }

                const nhaThauId = foundNt ? foundNt.id : row.nhaThauId;

                this.model.state.thongtinmothau.push({
                    id: row.id || window.generateUUID(),
                    goiThauId: gtId,
                    nhaThauId: nhaThauId,
                    maPhanLo: row.maPhanLo || '',
                    tenPhanLo: row.tenPhanLo || '',
                    maDinhDanh: row.maDinhDanh || '',
                    giaDuThau: row.giaDuThau || 0,
                    damBaoDuThau: row.damBaoDuThau || 0,
                    hieuLucDamBao: row.hieuLucDamBao || '',
                    hieuLucHsdxt: row.hieuLucHsdxt || '',
                    tyLeGiamGia: row.tyLeGiamGia || 0,
                    giaSauGiamGia: row.giaSauGiamGia || 0,
                    hieuLucHsdt: row.hieuLucHsdt || '',
                    giaTriDamBao: row.giaTriDamBao || 0,
                    hieuLucBaoDamNgay: row.hieuLucBaoDamNgay || 0,
                    thoiGianThucHien: row.thoiGianThucHien || '',
                    maNhaThau: foundNt ? foundNt.maNhaThau : row.maNhaThau,
                    // Với liên danh: giữ tên liên danh từ file Excel, không ghi đè bằng tên CSDL
                    tenNhaThau: (row.loaiNhaThau === 'Liên danh') ? row.tenNhaThau : (foundNt ? foundNt.tenNhaThau : row.tenNhaThau),
                    loaiNhaThau: foundNt ? foundNt.loaiNhaThau : row.loaiNhaThau
                });
            });

            this.model.persistData('thongtinmothau');

            // Re-render the Bid opening table rows with the new data
            const gt = this.model.state.goithau.find(g => g.id === gtId);
            if (gt) {
                const tbody = document.getElementById('mothau-table-tbody');
                if (tbody) tbody.innerHTML = '';

                const isTuVan = gt.linhVuc === 'Tư vấn';
                const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
                const is1G1T = gt.phuongThucLuaChon === 'Một giai đoạn một túi hồ sơ';
                const hasPhanLo = gt.phanLo === 'Có';

                let caseType = '1G1T_NO_LOT';
                if (isTuVan) caseType = 'TU_VAN';
                else if (!isTuVan && is1G2T) caseType = hasPhanLo ? '1G2T_WITH_LOT' : '1G2T_NO_LOT';
                else if (is1G1T) caseType = hasPhanLo ? '1G1T_WITH_LOT' : '1G1T_NO_LOT';

                const newBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(gtId));
                if (newBids.length === 0) {
                    this.addMoThauRow(caseType, gt);
                } else {
                    newBids.forEach(bid => this.addMoThauRow(caseType, gt, bid));
                }
                lucide.createIcons();
            }
            count = validRows.length;
        }
    } else if (type === 'danhgiahsdt') {
        const select = document.getElementById('danhgiahsdt-goithau-select');
        const gtId = select ? select.value : '';
        if (gtId) {
            const validRows = this._excelImportData.filter(r => r._valid);
            validRows.forEach(row => {
                const bid = this.model.state.thongtinmothau.find(b => b.id === row.id);
                if (bid) {
                    bid.danhGiaHopLe = row.danhGiaHopLe || '';
                    bid.danhGiaNangLuc = row.danhGiaNangLuc || '';
                    bid.danhGiaKyThuat = row.danhGiaKyThuat || '';
                    if (row.danhGiaKetLuan) {
                        bid.danhGiaKetLuan = row.danhGiaKetLuan || '';
                    }
                    bid.lamRoHopLe = row.lamRoHopLe || '';
                    bid.lamRoNangLuc = row.lamRoNangLuc || '';
                    bid.lamRoKyThuat = row.lamRoKyThuat || '';
                    bid.lamRoTaiChinh = row.lamRoTaiChinh || '';
                }
            });
            this.model.persistData('thongtinmothau');
            this.renderDanhGiaHsdtPanel();
            count = validRows.length;
        }
    } else if (type === 'ketquaqd') {
        const gtId = this._currentResultPackageId;
        if (gtId) {
            const gt = this.model.state.goithau.find(g => g.id === gtId);
            if (gt) {
                const validRows = this._excelImportData.filter(r => r._valid);
                let winnerRow = validRows.find(r => r.trangThai === 'Trúng thầu' || r.trangThai === 'trung');

                validRows.forEach(row => {
                    const bid = this.model.state.thongtinmothau.find(b => b.id === row.id);
                    if (bid) {
                        if (row.trangThai === 'Trúng thầu' || row.trangThai === 'trung') {
                            bid.lyDoTruot = '';
                        } else {
                            bid.lyDoTruot = row.lyDoTruot || 'Đạt yêu cầu kỹ thuật nhưng giá dự thầu xếp sau';
                        }
                    }
                });

                if (winnerRow) {
                    let wId = winnerRow.nhaThauId;
                    if (!wId) {
                        const matchedBid = this.model.state.thongtinmothau.find(b =>
                            String(b.goiThauId) === String(gtId) &&
                            ((winnerRow.maNhaThau && String(b.maNhaThau || b.maDinhDanh || '').toLowerCase() === String(winnerRow.maNhaThau).toLowerCase()) ||
                                (winnerRow.tenNhaThau && String(b.tenNhaThau || '').toLowerCase() === String(winnerRow.tenNhaThau).toLowerCase()))
                        );
                        if (matchedBid) {
                            wId = matchedBid.nhaThauId;
                        }
                    }
                    gt.nhaThauTrungThauId = wId ? (isNaN(wId) ? wId : parseInt(wId)) : '';
                    gt.giaTrungThau = (winnerRow.giaTrungThau !== undefined && winnerRow.giaTrungThau !== null) ? winnerRow.giaTrungThau : null;
                    gt.thoiGianGoiThau = winnerRow.thoiGianGoiThau || '';
                    gt.thoiGianHopDong = winnerRow.thoiGianHopDong || '';
                    gt.trangThai = 'Đã có kết quả';
                } else {
                    gt.nhaThauTrungThauId = '';
                    gt.giaTrungThau = null;
                    gt.thoiGianGoiThau = '';
                    gt.thoiGianHopDong = '';
                    gt.trangThai = 'Hủy thầu';
                }

                this.model.persistData('goithau');
                this.model.persistData('thongtinmothau');
                this.view.showPackageDetails(gtId);
                count = validRows.length;
            }
        }
    }

    this.view.closeModal('modal-excel-preview');
    await this.view.customAlert('Nhập khẩu thành công', `Đã nhập khẩu thành công ${count} dòng dữ liệu vào hệ thống!`, 'check-circle');
    this.autoSync();
}

export function addPhanLoRow(data = {}) {
    const tbody = document.getElementById('phanlo-tbody');
    if (!tbody) return;

    const rowId = data.id || window.generateUUID();
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', rowId);

    const code = data.code || data.maPhanLo || '';
    const name = data.name || data.tenPhanLo || '';
    const price = data.price || data.giaTriPhanLo || 0;
    const duration = data.duration || data.thoiGianThucHien || '';
    const baoDamVal = data.baoDamDuThau || '';

    const isMoiThauOrLater = (document.getElementById('gt-trangthai')?.value !== 'Chuẩn bị');
    const linhVuc = document.getElementById('gt-linhvuc')?.value || '';
    const isBaoDamRequired = isMoiThauOrLater && (linhVuc !== 'Tư vấn');
    const displayStyle = (linhVuc !== 'Tư vấn') ? '' : 'display: none;';
    const requiredAttr = isBaoDamRequired ? 'required' : '';

    tr.innerHTML = `
        <td><input type="text" class="pl-code-input" value="${code}" placeholder="Mã phần lô..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="pl-name-input" value="${name}" placeholder="Nhập tên Lô/Phần..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="pl-price-input" value="${price ? this.model.formatVND(price) : ''}" placeholder="Nhập giá trị Lô (VND)..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td class="col-baodam-phanlo-cell" style="${displayStyle}"><input type="text" class="pl-baodam-input mt-format-vnd" ${requiredAttr} value="${baoDamVal ? this.model.formatVND(baoDamVal) : ''}" placeholder="Bảo đảm dự thầu..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="pl-duration-input" value="${duration}" placeholder="Ví dụ: 90 ngày..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-pl-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;

    const priceInput = tr.querySelector('.pl-price-input');
    priceInput.addEventListener('input', (e) => {
        const parsed = this.model.parseVND(e.target.value);
        e.target.value = this.model.formatVND(parsed);
    });

    const baodamInput = tr.querySelector('.pl-baodam-input');
    if (baodamInput) {
        baodamInput.addEventListener('input', (e) => {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;

            const parsed = this.model.parseVND(e.target.value);
            e.target.value = this.model.formatVND(parsed);

            const newLength = e.target.value.length;
            e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));

            this.recalculateTotalLotSecurities();
        });
    }

    tr.querySelector('.remove-pl-row-btn').addEventListener('click', () => {
        tr.remove();
        this.recalculateTotalLotSecurities();
    });

    tbody.appendChild(tr);
    lucide.createIcons();
}

export function _loadPhanLoRows(list) {
    const tbody = document.getElementById('phanlo-tbody');
    if (tbody) tbody.innerHTML = '';
    list.forEach(item => this.addPhanLoRow(item));
}

export function _collectPhanLoRows() {
    const list = [];
    document.querySelectorAll('#phanlo-tbody tr').forEach(tr => {
        const id = tr.getAttribute('data-id');
        const codeInput = tr.querySelector('.pl-code-input');
        const code = codeInput ? codeInput.value.trim() : '';
        const nameInput = tr.querySelector('.pl-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        const priceInput = tr.querySelector('.pl-price-input');
        const priceVal = priceInput ? priceInput.value : '';
        const price = this.model.parseVND(priceVal);
        const baodamInput = tr.querySelector('.pl-baodam-input');
        const baodamVal = baodamInput ? baodamInput.value : '';
        const baoDamDuThau = this.model.parseVND(baodamVal);
        const durationInput = tr.querySelector('.pl-duration-input');
        const duration = durationInput ? durationInput.value.trim() : '';

        if (name) {
            list.push({
                id,
                maPhanLo: code,
                tenPhanLo: name,
                giaTriPhanLo: price,
                baoDamDuThau: baoDamDuThau,
                thoiGianThucHien: duration
            });
        }
    });
    return list;
}

export function addTuyChonMuaThemRow(data = {}) {
    const tbody = document.getElementById('tuychonmuathem-tbody');
    if (!tbody) return;

    const rowId = data.id || window.generateUUID();
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', rowId);

    const hangMuc = data.hangMuc || data.name || '';
    const donVi = data.donVi || data.unit || '';
    const soLuong = data.soLuong || data.quantity || '';
    const tyLe = data.tyLe || data.percent || '';
    const giaTriUocTinh = data.giaTriUocTinh || data.price || 0;

    tr.innerHTML = `
        <td><input type="text" class="tc-name-input" value="${hangMuc}" placeholder="Tên tùy chọn mua thêm..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="tc-unit-input" value="${donVi}" placeholder="Ví dụ: Cái, Bộ..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="number" class="tc-quantity-input" value="${soLuong}" placeholder="Khối lượng..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="number" class="tc-percent-input" value="${tyLe}" placeholder="Tỷ lệ %..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="tc-price-input" value="${giaTriUocTinh ? this.model.formatVND(giaTriUocTinh) : ''}" placeholder="Giá trị (VNĐ)..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-tc-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;

    const priceInput = tr.querySelector('.tc-price-input');
    priceInput.addEventListener('input', (e) => {
        const parsed = this.model.parseVND(e.target.value);
        e.target.value = this.model.formatVND(parsed);
    });

    tr.querySelector('.remove-tc-row-btn').addEventListener('click', () => {
        tr.remove();
    });

    tbody.appendChild(tr);
    lucide.createIcons();
}

export function _loadTuyChonMuaThemRows(list) {
    const tbody = document.getElementById('tuychonmuathem-tbody');
    if (tbody) tbody.innerHTML = '';
    list.forEach(item => this.addTuyChonMuaThemRow(item));
}

export function _collectTuyChonMuaThemRows() {
    const list = [];
    document.querySelectorAll('#tuychonmuathem-tbody tr').forEach(tr => {
        const id = tr.getAttribute('data-id');
        const nameInput = tr.querySelector('.tc-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        const unitInput = tr.querySelector('.tc-unit-input');
        const unit = unitInput ? unitInput.value.trim() : '';
        const quantityInput = tr.querySelector('.tc-quantity-input');
        const quantity = quantityInput ? parseFloat(quantityInput.value) || 0 : 0;
        const percentInput = tr.querySelector('.tc-percent-input');
        const percent = percentInput ? parseFloat(percentInput.value) || 0 : 0;
        const priceInput = tr.querySelector('.tc-price-input');
        const priceVal = priceInput ? priceInput.value : '';
        const price = this.model.parseVND(priceVal);

        if (name) {
            list.push({
                id,
                hangMuc: name,
                donVi: unit,
                soLuong: quantity,
                tyLe: percent,
                giaTriUocTinh: price
            });
        }
    });
    return list;
}

export function updateGiaHanIndices() {
    const tbody = document.getElementById('gt-giahan-tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((tr, index) => {
        const indexCell = tr.querySelector('.gh-index-cell');
        if (indexCell) {
            indexCell.textContent = `Lần ${index + 1}`;
        }
    });
    this.validateGiaHanRealtime();
}

export function validateGiaHanRealtime() {
    const mainDongThauStr = document.getElementById('gt-thoigiandongthau')?.value || '';

    const parseDMYHM = (str) => {
        if (!str) return null;
        const parts = str.trim().split(/\s+/);
        if (parts.length < 2) return null;
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');
        if (dateParts.length < 3 || timeParts.length < 2) return null;
        return new Date(
            parseInt(dateParts[2]),
            parseInt(dateParts[1]) - 1,
            parseInt(dateParts[0]),
            parseInt(timeParts[0]),
            parseInt(timeParts[1])
        );
    };

    const mainDongThauDate = parseDMYHM(mainDongThauStr);
    const rows = document.querySelectorAll('#gt-giahan-tbody tr');
    const ghRowsData = [];

    rows.forEach((tr, index) => {
        const timeInput = tr.querySelector('.gh-time-input');
        if (!timeInput) return;

        // Clear previous error styles/elements in this td
        timeInput.style.borderColor = '';
        const oldErr = tr.querySelector('.gh-row-error');
        if (oldErr) oldErr.remove();

        const timeStr = timeInput.value.trim();
        if (!timeStr) return;

        const currentGiaHanDate = parseDMYHM(timeStr);
        if (!currentGiaHanDate) {
            showRowError(tr, timeInput, 'Thời gian không hợp lệ');
            return;
        }

        if (index === 0) {
            if (mainDongThauDate && currentGiaHanDate <= mainDongThauDate) {
                showRowError(tr, timeInput, `Phải lớn hơn đóng thầu gốc (${mainDongThauStr})`);
            }
        } else {
            const prevTimeStr = ghRowsData[index - 1]?.timeStr;
            const prevGiaHanDate = parseDMYHM(prevTimeStr);
            if (prevGiaHanDate && currentGiaHanDate <= prevGiaHanDate) {
                showRowError(tr, timeInput, `Phải lớn hơn lần trước (${prevTimeStr})`);
            }
        }

        ghRowsData.push({ timeStr, date: currentGiaHanDate });
    });

    function showRowError(row, input, message) {
        input.style.borderColor = 'var(--danger)';
        const errSpan = document.createElement('span');
        errSpan.className = 'gh-row-error';
        errSpan.style.cssText = 'display:block;color:var(--danger);font-size:0.75rem;margin-top:4px;font-weight:600;';
        errSpan.textContent = message;
        input.parentNode.appendChild(errSpan);
    }
}

export function addGiaHanRow(data = {}) {
    const tbody = document.getElementById('gt-giahan-tbody');
    if (!tbody) return;

    const rowId = data.id || window.generateUUID();
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', rowId);

    tr.innerHTML = `
        <td class="gh-index-cell" style="font-weight: bold; text-align: center; vertical-align: middle; color: var(--text-main);">Lần ...</td>
        <td><input type="text" class="gh-time-input" value="${data.thoiGianDongThau || ''}" placeholder="Chọn ngày giờ (dd/MM/yyyy HH:mm)" style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td><input type="text" class="gh-reason-input" value="${data.lyDoGiaHan || ''}" placeholder="Nhập lý do gia hạn..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);"></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-gh-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;

    const timeInput = tr.querySelector('.gh-time-input');
    if (typeof flatpickr !== 'undefined') {
        flatpickr(timeInput, {
            locale: "vn",
            enableTime: true,
            enableSeconds: false,
            time_24hr: true,
            dateFormat: "d/m/Y H:i",
            allowInput: true,
            position: "auto",
            onChange: () => this.validateGiaHanRealtime()
        });
    }

    timeInput.addEventListener('input', () => this.validateGiaHanRealtime());

    tr.querySelector('.remove-gh-row-btn').addEventListener('click', () => {
        tr.remove();
        this.updateGiaHanIndices();
    });

    tbody.appendChild(tr);
    this.updateGiaHanIndices();
    lucide.createIcons();
}

export function _loadGiaHanRows(list) {
    const tbody = document.getElementById('gt-giahan-tbody');
    if (tbody) tbody.innerHTML = '';
    list.forEach(item => this.addGiaHanRow(item));
}

export function _collectGiaHanRows() {
    const list = [];
    document.querySelectorAll('#gt-giahan-tbody tr').forEach(tr => {
        const id = tr.getAttribute('data-id');
        const timeInput = tr.querySelector('.gh-time-input').value.trim();
        const reasonInput = tr.querySelector('.gh-reason-input').value.trim();

        if (timeInput && reasonInput) {
            list.push({ id, thoiGianDongThau: timeInput, lyDoGiaHan: reasonInput });
        }
    });
    return list;
}

export function updateYeuCauLamRoIndices() {
    const tbody = document.getElementById('gt-yeucaulamro-tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((tr, index) => {
        const indexCell = tr.querySelector('.yc-index-cell');
        if (indexCell) {
            indexCell.textContent = index + 1;
        }
    });
}

export function addYeuCauLamRoRow(data = {}) {
    const tbody = document.getElementById('gt-yeucaulamro-tbody');
    if (!tbody) return;

    const rowId = data.id || window.generateUUID();
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', rowId);

    tr.innerHTML = `
        <td class="yc-index-cell" style="font-weight: bold; text-align: center; vertical-align: middle; color: var(--text-main);">...</td>
        <td><input type="text" class="yc-time-input" value="${data.thoiGianYeuCau || ''}" placeholder="Chọn ngày giờ (dd/MM/yyyy HH:mm)" style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td><input type="text" class="yc-content-input" value="${data.noiDungYeuCau || ''}" placeholder="Nhập nội dung yêu cầu làm rõ..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-yc-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;

    const timeInput = tr.querySelector('.yc-time-input');
    if (typeof flatpickr !== 'undefined') {
        flatpickr(timeInput, {
            locale: "vn",
            enableTime: true,
            enableSeconds: false,
            time_24hr: true,
            dateFormat: "d/m/Y H:i",
            allowInput: true,
            position: "auto"
        });
    }

    tr.querySelector('.remove-yc-row-btn').addEventListener('click', () => {
        tr.remove();
        this.updateYeuCauLamRoIndices();
    });

    tbody.appendChild(tr);
    this.updateYeuCauLamRoIndices();
    lucide.createIcons();
}

export function _loadYeuCauLamRoRows(list) {
    const tbody = document.getElementById('gt-yeucaulamro-tbody');
    if (tbody) tbody.innerHTML = '';
    list.forEach(item => this.addYeuCauLamRoRow(item));
}

export function _collectYeuCauLamRoRows() {
    const list = [];
    document.querySelectorAll('#gt-yeucaulamro-tbody tr').forEach(tr => {
        const id = tr.getAttribute('data-id');
        const timeInput = tr.querySelector('.yc-time-input').value.trim();
        const contentInput = tr.querySelector('.yc-content-input').value.trim();

        if (timeInput && contentInput) {
            list.push({ id, thoiGianYeuCau: timeInput, noiDungYeuCau: contentInput });
        }
    });
    return list;
}

export function updateTraLoiLamRoIndices() {
    const tbody = document.getElementById('gt-traloilamro-tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((tr, index) => {
        const indexCell = tr.querySelector('.tl-index-cell');
        if (indexCell) {
            indexCell.textContent = index + 1;
        }
    });
}

export function addTraLoiLamRoRow(data = {}) {
    const tbody = document.getElementById('gt-traloilamro-tbody');
    if (!tbody) return;

    const rowId = data.id || window.generateUUID();
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', rowId);

    tr.innerHTML = `
        <td class="tl-index-cell" style="font-weight: bold; text-align: center; vertical-align: middle; color: var(--text-main);">...</td>
        <td><input type="text" class="tl-time-input" value="${data.thoiGianTraLoi || ''}" placeholder="Chọn ngày giờ (dd/MM/yyyy HH:mm)" style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td><input type="text" class="tl-content-input" value="${data.noiDungTraLoi || ''}" placeholder="Nhập nội dung trả lời làm rõ..." style="width: 100%; border: 1px solid var(--border-color); padding: 5px 8px; border-radius: var(--radius-sm);" required></td>
        <td style="text-align: center;"><button type="button" class="btn btn-icon btn-danger remove-tl-row-btn" style="padding: 4px; border-radius: 4px;"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button></td>
    `;

    const timeInput = tr.querySelector('.tl-time-input');
    if (typeof flatpickr !== 'undefined') {
        flatpickr(timeInput, {
            locale: "vn",
            enableTime: true,
            enableSeconds: false,
            time_24hr: true,
            dateFormat: "d/m/Y H:i",
            allowInput: true,
            position: "auto"
        });
    }

    tr.querySelector('.remove-tl-row-btn').addEventListener('click', () => {
        tr.remove();
        this.updateTraLoiLamRoIndices();
    });

    tbody.appendChild(tr);
    this.updateTraLoiLamRoIndices();
    lucide.createIcons();
}

export function _loadTraLoiLamRoRows(list) {
    const tbody = document.getElementById('gt-traloilamro-tbody');
    if (tbody) tbody.innerHTML = '';
    list.forEach(item => this.addTraLoiLamRoRow(item));
}

export function _collectTraLoiLamRoRows() {
    const list = [];
    document.querySelectorAll('#gt-traloilamro-tbody tr').forEach(tr => {
        const id = tr.getAttribute('data-id');
        const timeInput = tr.querySelector('.tl-time-input').value.trim();
        const contentInput = tr.querySelector('.tl-content-input').value.trim();

        if (timeInput && contentInput) {
            list.push({ id, thoiGianTraLoi: timeInput, noiDungTraLoi: contentInput });
        }
    });
    return list;
}

export function enforceSingleLeader(tbodyId, roleName) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    // Find if there is any select set to 'Tổ trưởng' that is not disabled
    const selects = tbody.querySelectorAll(`select[name="${roleName}"]`);
    let leaderSelect = null;
    selects.forEach(sel => {
        if (!sel.disabled && sel.value === 'Tổ trưởng') {
            leaderSelect = sel;
        }
    });

    selects.forEach(sel => {
        const row = sel.closest('tr');
        const cb = row.querySelector('input[type="checkbox"]');
        if (leaderSelect) {
            if (sel !== leaderSelect) {
                sel.value = 'Tổ viên';
                sel.disabled = true;
            }
        } else {
            // Enable if the checkbox is checked
            if (cb && cb.checked) {
                sel.disabled = false;
            } else {
                sel.disabled = true;
            }
        }
    });
}

export function setupWordTemplatesEvents() {
    const templateInput = document.getElementById('word-file-input') || document.getElementById('word-template-file-input');
    if (templateInput) {
        templateInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleWordTemplateUpload(file);
        });
    }

    const dragDropZone = document.getElementById('word-drag-drop-zone');
    if (dragDropZone && templateInput) {
        dragDropZone.addEventListener('click', () => templateInput.click());
        dragDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dragDropZone.classList.add('dragover');
        });
        dragDropZone.addEventListener('dragleave', () => {
            dragDropZone.classList.remove('dragover');
        });
        dragDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDropZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) {
                templateInput.files = e.dataTransfer.files;
                this.handleWordTemplateUpload(file);
            }
        });
    }

    // Set up dictionary group select change event
    const dictionarySelect = document.getElementById('dictionary-group-select');
    if (dictionarySelect) {
        dictionarySelect.addEventListener('change', (e) => {
            const group = e.target.value;
            this.view.renderDictionary(group);
            this.setupCopyVariableEvents();
        });
    }

    // --- CUSTOM WORD MAPPINGS INTERACTIVE LOGIC ---
    const MAPPING_COLUMNS = {
        'chu_dau_tu': [
            { value: 'ma_chu_dau_tu', label: 'Mã chủ đầu tư' },
            { value: 'ten_chu_dau_tu', label: 'Tên chủ đầu tư' },
            { value: 'ma_so_thue', label: 'Mã số thuế' },
            { value: 'chuc_vu_nguoi_dung_dau', label: 'Chức vụ người đứng đầu' },
            { value: 'nguoi_ky_quyet_dinh', label: 'Người ký QĐ' },
            { value: 'chuc_vu_nguoi_ky', label: 'Chức vụ người ký' },
            { value: 'danh_xung', label: 'Danh xưng' },
            { value: 'dia_chi', label: 'Địa chỉ đầy đủ' },
            { value: 'so_dien_thoai', label: 'Số điện thoại' },
            { value: 'so_tai_khoan', label: 'Số tài khoản' },
            { value: 'noi_mo_tai_khoan', label: 'Nơi mở tài khoản' },
            { value: 'email', label: 'Email' },
            { value: 'ma_qhns', label: 'Mã QHNS' },
            { value: 'co_quan_chu_quan', label: 'Cơ quan chủ quản' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'ke_hoach_lcnt': [
            { value: 'ma_ke_hoach', label: 'Mã kế hoạch LCNT' },
            { value: 'ma_du_an', label: 'Mã dự án' },
            { value: 'ten_ke_hoach', label: 'Tên kế hoạch LCNT' },
            { value: 'ten_du_an_du_toan', label: 'Tên dự án / Dự toán' },
            { value: 'loai_hinh_mua_sam', label: 'Loại hình mua sắm' },
            { value: 'tong_muc_dau_tu', label: 'Tổng mức đầu tư' },
            { value: 'is_tong_muc_tu_dong', label: 'Tự động tính tổng mức (0/1)' },
            { value: 'ngay_phe_duyet', label: 'Ngày phê duyệt' },
            { value: 'quyet_dinh_phe_duyet', label: 'QĐ phê duyệt' },
            { value: 'thoi_gian_dang_tai', label: 'Thời gian đăng tải' },
            { value: 'nguon_von', label: 'Nguồn vốn' },
            { value: 'thoi_gian_du_an', label: 'Thời gian dự án' },
            { value: 'dia_diem_quy_mo', label: 'Địa điểm quy mô' },
            { value: 'thong_tin_khac', label: 'Thông tin khác' },
            { value: 'so_qd_phe_duyet_du_an', label: 'Số QĐ phê duyệt dự án' },
            { value: 'ngay_qd_phe_duyet_du_an', label: 'Ngày QĐ phê duyệt dự án' },
            { value: 'co_quan_phe_duyet_du_an', label: 'Cơ quan phê duyệt dự án' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'goi_thau': [
            { value: 'ma_goi_thau', label: 'Mã gói thầu (Mã TBMT)' },
            { value: 'ten_goi_thau', label: 'Tên gói thầu' },
            { value: 'gia_goi_thau', label: 'Giá dự toán gói thầu' },
            { value: 'hinh_thuc_lua_chon', label: 'Hình thức LCNT' },
            { value: 'phuong_thuc_lua_chon', label: 'Phương thức LCNT' },
            { value: 'loai_hop_dong', label: 'Loại hợp đồng' },
            { value: 'thoi_gian_thuc_hien', label: 'Thời gian thực hiện' },
            { value: 'nguon_von', label: 'Nguồn vốn' },
            { value: 'gia_trung_thau', label: 'Giá trúng thầu' },
            { value: 'linh_vuc', label: 'Lĩnh vực' },
            { value: 'tuy_chon_mua_them', label: 'Tùy chọn mua thêm' },
            { value: 'thoi_gian_to_chuc', label: 'Thời gian tổ chức' },
            { value: 'thoi_gian_bat_dau_to_chuc', label: 'Thời gian bắt đầu tổ chức' },
            { value: 'phan_lo', label: 'Phân lô' },
            { value: 'thoi_gian_dang_tai', label: 'Thời gian đăng tải' },
            { value: 'thoi_gian_dong_thau', label: 'Thời gian đóng thầu' },
            { value: 'thoi_gian_mo_thau', label: 'Thời gian mở thầu' },
            { value: 'so_quyet_dinh', label: 'Số QĐ phê duyệt' },
            { value: 'ngay_quyet_dinh', label: 'Ngày QĐ phê duyệt' },
            { value: 'so_quyet_dinh_ket_qua', label: 'Số QĐ kết quả' },
            { value: 'ngay_quyet_dinh_ket_qua', label: 'Ngày QĐ kết quả' },
            { value: 'thoi_gian_goi_thau', label: 'Thời gian gói thầu' },
            { value: 'thoi_gian_hop_dong', label: 'Thời gian hợp đồng' },
            { value: 'gia_tri_dam_bao_du_thau', label: 'Giá trị bảo đảm dự thầu' },
            { value: 'hieu_luc_hsdt', label: 'Hiệu lực HSDT' },
            { value: 'hieu_luc_dam_bao_du_thau', label: 'Hiệu lực bảo đảm dự thầu' },
            { value: 'gia_han_list', label: 'Gia hạn thời gian mở thầu / đóng thầu' },
            { value: 'yeu_cau_lam_ro_list', label: 'Làm rõ hồ sơ mời thầu (Yêu cầu)' },
            { value: 'tra_loi_lam_ro_list', label: 'Trả lời làm rõ hồ sơ mời thầu' },
            { value: 'trang_thai', label: 'Trạng thái' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'nha_thau': [
            { value: 'ma_nha_thau', label: 'Mã nhà thầu' },
            { value: 'ten_nha_thau', label: 'Tên nhà thầu' },
            { value: 'loai_nha_thau', label: 'Loại nhà thầu (Độc lập/Liên danh)' },
            { value: 'ma_so_thue', label: 'Mã số thuế' },
            { value: 'nguoi_dai_dien', label: 'Người đại diện' },
            { value: 'danh_xung', label: 'Danh xưng' },
            { value: 'so_dien_thoai', label: 'Số điện thoại' },
            { value: 'email', label: 'Email' },
            { value: 'dia_chi', label: 'Địa chỉ' },
            { value: 'so_tai_khoan', label: 'Số tài khoản' },
            { value: 'noi_mo_tai_khoan', label: 'Nơi mở tài khoản' },
            { value: 'ma_ngan_hang', label: 'Mã ngân hàng' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'hop_dong': [
            { value: 'ten_hop_dong', label: 'Tên hợp đồng' },
            { value: 'so_hop_dong', label: 'Số hợp đồng' },
            { value: 'ngay_ky', label: 'Ngày ký' },
            { value: 'gia_tri', label: 'Giá trị hợp đồng' },
            { value: 'loai_hop_dong', label: 'Loại hợp đồng' },
            { value: 'thoi_gian_thuc_hien', label: 'Thời gian thực hiện' },
            { value: 'trang_thai_ho_so', label: 'Trạng thái hồ sơ' }
        ],
        'chuyen_gia': [
            { value: 'ho_ten', label: 'Họ tên chuyên gia' },
            { value: 'so_cccd', label: 'Số CCCD' },
            { value: 'ngay_cap_cccd', label: 'Ngày cấp CCCD' },
            { value: 'noi_cap_cccd', label: 'Nơi cấp CCCD' },
            { value: 'so_chung_chi', label: 'Số chứng chỉ' },
            { value: 'ngay_cap_chung_chi', label: 'Ngày cấp chứng chỉ' },
            { value: 'don_vi_cap_chung_chi', label: 'Đơn vị cấp chứng chỉ' },
            { value: 'chuc_vu', label: 'Chức vụ trong tổ' },
            { value: 'cong_viec', label: 'Nhiệm vụ phân công' }
        ],
        'thong_tin_mo_thau': [
            { value: 'ma_phan_lo', label: 'Mã phân lô' },
            { value: 'ten_phan_lo', label: 'Tên phân lô' },
            { value: 'ma_dinh_danh', label: 'Mã định danh' },
            { value: 'gia_du_thau', label: 'Giá dự thầu' },
            { value: 'dam_bao_du_thau', label: 'Bảo đảm dự thầu' },
            { value: 'hieu_luc_dam_bao', label: 'Hiệu lực bảo đảm' },
            { value: 'hieu_luc_hsdxt', label: 'Hiệu lực HSDXT' },
            { value: 'ty_le_giam_gia', label: 'Tỷ lệ giảm giá' },
            { value: 'gia_sau_giam_gia', label: 'Giá sau giảm giá' },
            { value: 'hieu_luc_hsdt', label: 'Hiệu lực HSDT' },
            { value: 'gia_tri_dam_bao', label: 'Giá trị bảo đảm' },
            { value: 'hieu_luc_bao_dam_ngay', label: 'Hiệu lực bảo đảm (ngày)' },
            { value: 'thoi_gian_thuc_hien', label: 'Thời gian thực hiện' },
            { value: 'ten_nha_thau', label: 'Tên nhà thầu' },
            { value: 'loai_nha_thau', label: 'Loại nhà thầu' },
            { value: 'danh_gia_hop_le', label: 'Đánh giá hợp lệ' },
            { value: 'danh_gia_nang_luc', label: 'Đánh giá năng lực' },
            { value: 'danh_gia_ky_thuat', label: 'Đánh giá kỹ thuật' },
            { value: 'danh_gia_tai_chinh', label: 'Đánh giá tài chính' },
            { value: 'danh_gia_ket_luan', label: 'Đánh giá kết luận' },
            { value: 'ly_do_truot', label: 'Lý do trượt' },
            { value: 'lam_ro_hop_le', label: 'Làm rõ hợp lệ' },
            { value: 'lam_ro_nang_luc', label: 'Làm rõ năng lực' },
            { value: 'lam_ro_ky_thuat', label: 'Làm rõ kỹ thuật' },
            { value: 'lam_ro_tai_chinh', label: 'Làm rõ tài chính' }
        ],
        'tai_khoan': [
            { value: 'ten_dang_nhap', label: 'Tên đăng nhập' },
            { value: 'ho_ten', label: 'Họ tên người dùng' },
            { value: 'vai_tro', label: 'Vai trò tài khoản' },
            { value: 'email', label: 'Email tài khoản' },
            { value: 'ngay_bat_dau_goi', label: 'Ngày bắt đầu gói' },
            { value: 'ngay_het_han_goi', label: 'Ngày hết hạn gói' },
            { value: 'da_xac_minh', label: 'Đã xác minh (0/1)' }
        ],
        'to_chuc': [
            { value: 'ten_to_chuc', label: 'Tên tổ chức / Doanh nghiệp' }
        ],
        'goi_dich_vu': [
            { value: 'ten_goi', label: 'Tên gói dịch vụ' },
            { value: 'gia_ca', label: 'Giá gói dịch vụ' },
            { value: 'han_muc_nhan_su', label: 'Hạn mức nhân sự tối đa' },
            { value: 'mo_ta', label: 'Mô tả chi tiết gói' }
        ]
    };

    const tableSelect = document.getElementById('wm-source-table');
    const columnSelect = document.getElementById('wm-source-column');
    const formWm = document.getElementById('form-word-mapping');
    const cancelWmBtn = document.getElementById('btn-wm-cancel');

    if (tableSelect && columnSelect) {
        tableSelect.addEventListener('change', (e) => {
            const table = e.target.value;
            columnSelect.innerHTML = '<option value="">-- Chọn cột --</option>';
            if (table && MAPPING_COLUMNS[table]) {
                columnSelect.disabled = false;
                MAPPING_COLUMNS[table].forEach(col => {
                    const opt = document.createElement('option');
                    opt.value = col.value;
                    opt.textContent = col.label;
                    columnSelect.appendChild(opt);
                });
            } else {
                columnSelect.disabled = true;
            }
        });
    }

    const resetWmForm = () => {
        if (formWm) {
            formWm.reset();
            document.getElementById('wm-id').value = '';
            if (columnSelect) columnSelect.disabled = true;
            if (cancelWmBtn) cancelWmBtn.style.display = 'none';
            const submitBtn = formWm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Lưu biến';
                lucide.createIcons({ root: submitBtn });
            }
        }
    };

    if (cancelWmBtn) {
        cancelWmBtn.addEventListener('click', resetWmForm);
    }

    if (formWm) {
        formWm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('wm-id').value;
            const tenBien = document.getElementById('wm-ten-bien').value.trim();
            const sourceTable = tableSelect.value;
            const sourceColumn = columnSelect.value;

            if (!tenBien || !sourceTable || !sourceColumn) return;

            try {
                const res = await fetch('/api/word-mappings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, tenBien, sourceTable, sourceColumn })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    resetWmForm();
                    await this.loadWordMappings();
                } else {
                    await this.view.customAlert('Lỗi lưu biến', data.error || 'Lỗi khi lưu biến ánh xạ.', 'x-circle');
                }
            } catch (err) {
                console.error(err);
                await this.view.customAlert('Lỗi kết nối', 'Không thể kết nối máy chủ.', 'x-circle');
            }
        });
    }

    // Register global edit/delete handlers on window for HTML onclick compatibility
    window.editWordMapping = (id) => {
        const m = (this.model.state.wordMappings || []).find(x => x.id === id);
        if (!m) return;

        document.getElementById('wm-id').value = m.id;
        document.getElementById('wm-ten-bien').value = m.tenBien;

        tableSelect.value = m.sourceTable;
        tableSelect.dispatchEvent(new Event('change'));

        columnSelect.value = m.sourceColumn;

        if (cancelWmBtn) cancelWmBtn.style.display = 'inline-block';

        const submitBtn = formWm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Cập nhật';
            lucide.createIcons({ root: submitBtn });
        }
    };

    window.deleteWordMapping = async (id) => {
        if (!confirm('Bạn có chắc chắn muốn xóa biến ánh xạ này không?')) return;
        try {
            const res = await fetch(`/api/word-mappings/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                await this.loadWordMappings();
            } else {
                const data = await res.json();
                await this.view.customAlert('Lỗi xóa', data.error || 'Có lỗi xảy ra khi xóa biến ánh xạ.', 'x-circle');
            }
        } catch (err) {
            console.error(err);
        }
    };
}

export function setupCopyVariableEvents() {
    document.querySelectorAll('.btn-copy-var, .copy-var-btn').forEach(btn => {
        btn.onclick = (e) => {
            const button = e.target.closest('button');
            const text = button.getAttribute('data-copy') || button.getAttribute('data-var');
            if (text) {
                navigator.clipboard.writeText(text).then(() => {
                    if (this.view.customAlert) {
                        this.view.customAlert('Sao chép thành công', `Đã sao chép mã biến: <strong>${text}</strong>`, 'check-circle');
                    } else {
                        // Show inline toast instead of blocking alert
                        const btn = document.querySelector(`.btn-copy-var[data-copy="${text}"]`);
                        if (btn) {
                            const orig = btn.innerHTML;
                            btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;"></i> Đã sao chép!';
                            btn.style.color = 'var(--success)';
                            lucide.createIcons({ root: btn });
                            setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; lucide.createIcons({ root: btn }); }, 1500);
                        }
                    }
                });
            }
        };
    });
}

export async function loadWordTemplates() {
    try {
        const res = await fetch('/api/templates');
        if (res.ok) {
            const templates = await res.json();
            this.view.renderWordTemplates(templates);
            this.setupTemplateActivationEvents();
        }
        // Load the custom mappings concurrently
        await this.loadWordMappings();
    } catch (err) {
        console.error("Failed to load templates:", err);
    }
}

export async function loadWordMappings() {
    try {
        const res = await fetch('/api/word-mappings');
        if (res.ok) {
            const mappings = await res.json();
            if (!this.model.state) this.model.state = {};
            this.model.state.wordMappings = mappings;

            // Render the mappings list table
            if (this.view.renderWordMappingsTable) {
                this.view.renderWordMappingsTable(mappings);
            }

            // Re-render the dictionary to include the custom mappings
            const dictionarySelect = document.getElementById('dictionary-group-select');
            const group = dictionarySelect ? dictionarySelect.value : 'global';
            this.view.renderDictionary(group);
            this.setupCopyVariableEvents();
        }
    } catch (err) {
        console.error("Failed to load word mappings:", err);
    }
}

export function setupTemplateActivationEvents() {
    document.querySelectorAll('.btn-activate-template').forEach(btn => {
        btn.onclick = async (e) => {
            const targetEl = e.target.closest('.btn-activate-template');
            if (!targetEl) return;
            const filename = targetEl.getAttribute('data-filename');
            try {
                const res = await fetch('/api/templates/active', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename })
                });
                if (res.ok) {
                    await this.loadWordTemplates();
                }
            } catch (err) {
                console.error("Failed to set active template:", err);
            }
        };
    });
}

export async function handleWordTemplateUpload(file) {
    if (!file.name.endsWith('.docx')) {
        await this.view.customAlert('Lỗi định dạng', 'Hệ thống chỉ hỗ trợ biểu mẫu tệp tin Microsoft Word (.docx)!', 'alert-triangle');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/templates/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            await this.view.customAlert('Thành công', 'Đã tải lên biểu mẫu QĐ phê duyệt thành công!', 'check-circle');
            await this.loadWordTemplates();
        } else {
            await this.view.customAlert('Thất bại', data.error || 'Không thể tải lên biểu mẫu này.', 'alert-triangle');
        }
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
    }
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

export function recalculatePlanTotal(planId) {
    const kh = this.model.state.kehoach.find(k => k.id === planId);
    if (!kh) return;

    if (kh.tongMucDauTu && kh.tongMucDauTu > 1 && kh.isTongMucTuDong !== true) {
        return;
    }

    const sumI = (kh.cvDaThucHienList || []).reduce((acc, curr) => acc + (curr.giaTri || 0), 0);
    const sumII = (kh.cvKhongApDungList || []).reduce((acc, curr) => acc + (curr.giaTri || 0), 0);
    const sumIII = (kh.cvChuaDuDieuKienList || []).reduce((acc, curr) => acc + (curr.giaTri || 0), 0);

    const latestPackages = this.model.getLatestPackages();
    const rootId = kh.rootId || kh.id;
    const planVersionIds = this.model.state.kehoach
        .filter(k => k.rootId === rootId || k.id === rootId)
        .map(k => k.id);

    const pkgs = latestPackages.filter(g => planVersionIds.includes(g.keHoachId));
    const sumIV = pkgs.reduce((acc, curr) => acc + (curr.giaGoiThau || 0), 0);

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
        const saveAsNewVersion = await this.view.customConfirm(
            "Lưu phiên bản mới?",
            "Bạn có muốn lưu các thay đổi này thành một phiên bản mới không?\n\n• Chọn Xác nhận để lưu thành phiên bản mới.\n• Chọn Hủy để ghi đè lên phiên bản hiện tại.",
            "help-circle"
        );

        if (saveAsNewVersion === null) {
            return; // Cancel the save, stay on modal
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

            this.model.state.kehoach.push({
                ...this.tempPlanData,
                id: newId,
                phienBan: nextVersion,
                isLatest: 1,
                is_latest: 1,
                rootId: rootId,
                createdAt: oldKh.createdAt || Math.floor(Date.now() / 1000),
                created_at: oldKh.created_at || Math.floor(Date.now() / 1000),
                updatedAt: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
                cvDaThucHienList: cvDaThucHien,
                cvKhongApDungList: cvKhongApDung,
                cvChuaDuDieuKienList: cvChuaDuDieuKien
            });

            // Update packages created/edited during this session to point to the new version ID
            this.model.state.goithau.forEach(gt => {
                if (gt.keHoachId === this.tempPlanData.id) {
                    gt.keHoachId = newId;
                }
            });
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

    this.view.closeModal('modal-plan-breakdown');
    this.view.renderKeHoachTable();
    this.view.renderGoiThauTable();
    await this.view.customAlert('Thành công', 'Đã lưu kế hoạch và cấu trúc phân chia chi tiết công việc thành công!', 'check-circle');
    this.autoSync();
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

        const kh = this.model.state.kehoach.find(k => k.id === gt.keHoachId);
        const cdt = kh ? this.model.state.chudautu.find(c => c.id === kh.chuDauTuId) : null;
        const tenCdt = cdt ? cdt.tenChuDauTu : 'Không rõ';

        // Kiểm tra trạng thái gói thầu — chỉ cho phép chỉnh sửa khi đang mời thầu hoặc đã mở thầu
        const isEditable = gt.trangThai === 'Đang mời thầu' || gt.trangThai === 'Đã mở thầu';
        const isReadOnly = gt.trangThai === 'Đang chấm thầu';
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
        if (addBidBtn) addBidBtn.style.display = isEditable ? '' : 'none';
        if (importExcelBtnTop) importExcelBtnTop.style.display = isEditable ? '' : 'none';
        if (saveBtn2) saveBtn2.style.display = isEditable ? '' : 'none';

        // 2. Identify the dynamic fields case
        const isTuVan = gt.linhVuc === 'Tư vấn';
        const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
        const is1G1T = gt.phuongThucLuaChon === 'Một giai đoạn một túi hồ sơ';
        const hasPhanLo = gt.phanLo === 'Có';

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
                    <th style="width: 10%;">Loại nhà thầu</th>
                    <th style="width: 10%;">Mã phần lô</th>
                    <th style="width: 10%;">Tên phần lô</th>
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
                    <th style="width: 8%;">Loại nhà thầu</th>
                    <th style="width: 8%;">Mã phần lô</th>
                    <th style="width: 8%;">Tên phần lô</th>
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

        if (bids.length === 0) {
            // Add a default row (only when editable)
            if (isEditable) this.addMoThauRow(caseType, gt);
        } else {
            bids.forEach(bid => this.addMoThauRow(caseType, gt, bid, isLocked));
        }
        lucide.createIcons();
    };

    select.onchange = handlePackageSelection;
    handlePackageSelection();

    // Excel Export and Import Functionality
    const downloadTemplateBtn = document.getElementById('btn-mothau-download-template');
    if (downloadTemplateBtn) {
        downloadTemplateBtn.onclick = (e) => {
            e.preventDefault();
            const gtId = select.value;
            const gt = this.model.state.goithau.find(g => g.id === gtId);
            if (!gt) {
                this.view.customAlert('Chưa chọn gói thầu', 'Vui lòng chọn một gói thầu trước để tải file mẫu tương ứng!', 'alert-triangle');
                return;
            }

            const isTuVan = gt.linhVuc === 'Tư vấn';
            const is1G2T = gt.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
            const is1G1T = gt.phuongThucLuaChon === 'Một giai đoạn một túi hồ sơ';
            const hasPhanLo = gt.phanLo === 'Có';

            let caseType = '1G1T_NO_LOT';
            if (isTuVan) caseType = 'TU_VAN';
            else if (!isTuVan && is1G2T) caseType = hasPhanLo ? '1G2T_WITH_LOT' : '1G2T_NO_LOT';
            else if (is1G1T) caseType = hasPhanLo ? '1G1T_WITH_LOT' : '1G1T_NO_LOT';

            const safeName = gt.tenGoiThau.replace(/[^a-zA-Z0-9ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơƯĂÂĐỔỨỨỰửữựỳỵỷỹ\s]/g, '').trim().substring(0, 30);
            const lotCodes = (gt.phanLoList || []).map(l => l.maPhanLo).join(',');

            // Redirect to backend API for downloading the strictly validated template
            authFetchDownload(`/api/export-mothau-template?case_type=${caseType}&package_name=${encodeURIComponent(safeName)}&lot_codes=${encodeURIComponent(lotCodes)}`, `Mau_Mo_Thau_${caseType}_${safeName}.xlsx`);
        };
    }

    const importExcelBtn = document.getElementById('btn-mothau-import-excel');
    const excelFileInput = document.getElementById('mothau-excel-file-input');
    if (importExcelBtn) {
        importExcelBtn.onclick = () => {
            const gtId = select.value;
            if (!gtId) {
                this.view.customAlert('Chưa chọn gói thầu', 'Vui lòng chọn một gói thầu trước khi nhập file Excel!', 'alert-triangle');
                return;
            }
            this.openExcelImportModal('mothau');
        };
    }

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

    const saveBtn = document.getElementById('btn-mothau-save');
    if (saveBtn) {
        saveBtn.onclick = () => this.saveThongTinMoThau();
    }
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
            <td>${typeSelectHtml}</td>
            <td>${bidData.maPhanLo || '--'}</td>
            <td>${bidData.tenPhanLo || '--'}</td>
            <td><span class="mt-ma-nha-thau">${ntCode || bidData.maDinhDanh || '--'}</span></td>
            <td><span class="mt-ten-nha-thau">${ntName || '--'}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.damBaoDuThau) || defaultLotBaoDam || '--'}</td>
            <td>${bidData.hieuLucDamBao || (gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + ' ngày' : '120 ngày')}</td>
            <td>${bidData.hieuLucHsdxt || (gt.hieuLucHsdt ? gt.hieuLucHsdt + ' ngày' : '90 ngày')}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${bidData.tenPhanLo || ''}" readonly placeholder="Tên lot"></td>
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
            <td>${typeSelectHtml}</td>
            <td>${bidData.maPhanLo || '--'}</td>
            <td>${bidData.tenPhanLo || '--'}</td>
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
            <td>${typeSelectHtml}</td>
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${bidData.tenPhanLo || ''}" readonly placeholder="Tên lot"></td>
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

    // Bảo vệ: chỉ cho lưu khi gói đang ở trạng thái đang mời thầu hoặc đã mở thầu
    if (gt.trangThai !== 'Đang mời thầu' && gt.trangThai !== 'Đã mở thầu') {
        await this.view.customAlert(
            'Không thể lưu',
            `Không thể chỉnh sửa biên bản mở thầu của gói thầu này vì trạng thái hiện tại là "${gt.trangThai}". Biên bản mở thầu chỉ có thể lưu khi gói thầu đang ở trạng thái Đang mời thầu hoặc Đã mở thầu.`,
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
                <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || 'Hàng hóa'}</div>
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

export function exportPhatHanhPhanLoExcel(gt) {
    const rows = [];
    document.querySelectorAll('#phathanh-phanlo-baodam-tbody tr').forEach(tr => {
        const ma = tr.querySelector('.phathanh-pl-code-input')?.value || '';
        const ten = tr.querySelector('.phathanh-pl-name-input')?.value || '';
        const gia = tr.querySelector('.phathanh-pl-price-input')?.value || '';
        const baodam = tr.querySelector('.phathanh-pl-baodam-input')?.value || '';
        const duration = tr.querySelector('.phathanh-pl-duration-input')?.value || '';
        rows.push({
            maPhanLo: ma,
            tenPhanLo: ten,
            giaTriPhanLo: this.model.parseVND(gia),
            baoDamDuThau: this.model.parseVND(baodam),
            thoiGianThucHien: duration
        });
    });

    const headers = {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
        'X-Username': sessionStorage.getItem('bf_username') || ''
    };

    fetch('/api/export-phanlo-excel', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            package_name: gt.maGoiThau || 'GoiThau',
            rows: rows
        })
    })
    .then(res => {
        if (!res.ok) throw new Error('Không thể xuất Excel');
        return res.blob();
    })
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Mau_nhap_lieu_phan_lo_${gt.maGoiThau || 'GoiThau'}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    })
    .catch(err => this.view.customAlert('Lỗi xuất Excel', 'Không thể xuất Excel: ' + err.message, 'x-circle'));
}

export function exportEditPhanLoExcel() {
    const list = this._collectPhanLoRows();
    const pkgCodeInput = document.getElementById('gt-ma');
    const packageCode = pkgCodeInput ? pkgCodeInput.value.trim() : '';
    const finalName = packageCode || 'GoiThau';

    const headers = {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
        'X-Username': sessionStorage.getItem('bf_username') || ''
    };

    fetch('/api/export-phanlo-excel', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            package_name: finalName,
            rows: list
        })
    })
    .then(res => {
        if (!res.ok) throw new Error('Không thể tải Excel mẫu');
        return res.blob();
    })
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Mau_nhap_lieu_phan_lo_${finalName}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    })
    .catch(err => this.view.customAlert('Lỗi tải mẫu', 'Không thể tải Excel mẫu: ' + err.message, 'x-circle'));
}

export function exportEditTuyChonMuaThemExcel() {
    const list = this._collectTuyChonMuaThemRows();
    const pkgCodeInput = document.getElementById('gt-ma');
    const packageCode = pkgCodeInput ? pkgCodeInput.value.trim() : '';
    const finalName = packageCode || 'GoiThau';

    const headers = {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
        'X-Username': sessionStorage.getItem('bf_username') || ''
    };

    fetch('/api/export-tuychonmuathem-excel', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            package_name: finalName,
            rows: list
        })
    })
    .then(res => {
        if (!res.ok) throw new Error('Không thể tải Excel mẫu');
        return res.blob();
    })
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Mau_nhap_lieu_tuy_chon_mua_them_${finalName}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    })
    .catch(err => this.view.customAlert('Lỗi tải mẫu', 'Không thể tải Excel mẫu: ' + err.message, 'x-circle'));
}

export function importPhatHanhPhanLoExcel(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = e.target.result;
            const workbook = XLSX.read(data, { type: 'binary' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(sheet);
            
            let count = 0;
            const trList = document.querySelectorAll('#phathanh-phanlo-baodam-tbody tr');
            json.forEach((row, rowIndex) => {
                const maPhanLoExcel = String(row['Mã phần lô'] || row['Mã lô'] || '').trim();
                const tenPhanLoExcel = String(row['Tên phần lô'] || row['Tên lô'] || '').trim();
                const giaTriPhanLoExcelRaw = row['Giá trị phần lô (VNĐ)'] || row['Giá trị phần lô'] || '';
                const baoDamExcelRaw = row['Bảo đảm dự thầu (VNĐ)'] || row['Bảo đảm dự thầu'] || row['Giá trị bảo đảm'] || '';
                const thoiGianThucHienExcel = String(row['Thời gian thực hiện'] || row['Thời gian'] || '').trim();
                
                let matchedTr = null;
                
                // 1. Tìm theo Mã hoặc Tên phần lô trước
                for (let tr of trList) {
                    const maInp = tr.querySelector('.phathanh-pl-code-input');
                    const tenInp = tr.querySelector('.phathanh-pl-name-input');
                    const maTr = maInp ? maInp.value.trim().toLowerCase() : '';
                    const tenTr = tenInp ? tenInp.value.trim().toLowerCase() : '';
                    if ((maPhanLoExcel && maPhanLoExcel.toLowerCase() === maTr) || (tenPhanLoExcel && tenPhanLoExcel.toLowerCase() === tenTr)) {
                        matchedTr = tr;
                        break;
                    }
                }
                
                // 2. Nếu không tìm thấy, ghi đè theo thứ tự dòng (Index)
                if (!matchedTr && rowIndex < trList.length) {
                    matchedTr = trList[rowIndex];
                }
                
                if (matchedTr) {
                    // Ghi đè trực tiếp các ô input trên giao diện modal
                    const codeInp = matchedTr.querySelector('.phathanh-pl-code-input');
                    if (codeInp && maPhanLoExcel) codeInp.value = maPhanLoExcel;
                    
                    const nameInp = matchedTr.querySelector('.phathanh-pl-name-input');
                    if (nameInp && tenPhanLoExcel) nameInp.value = tenPhanLoExcel;
                    
                    const parsedGiaTri = this.model.parseVND(String(giaTriPhanLoExcelRaw));
                    const priceInp = matchedTr.querySelector('.phathanh-pl-price-input');
                    if (priceInp && parsedGiaTri !== undefined) {
                        priceInp.value = this.model.formatVND(parsedGiaTri);
                    }
                    
                    const inp = matchedTr.querySelector('.phathanh-pl-baodam-input');
                    if (inp) {
                        const parsedVal = this.model.parseVND(String(baoDamExcelRaw));
                        inp.value = this.model.formatVND(parsedVal);
                    }
                    
                    const durationInp = matchedTr.querySelector('.phathanh-pl-duration-input');
                    if (durationInp && thoiGianThucHienExcel) durationInp.value = thoiGianThucHienExcel;
                    count++;
                }
            });
            
            if (count > 0) {
                this.view.customAlert('Nhập thành công', `Đã cập nhật/ghi đè giá trị bảo đảm cho ${count} phần lô từ file Excel!`, 'check-circle');
            } else {
                this.view.customAlert('Không nhập được dữ liệu', 'Không thể đồng bộ dữ liệu phần lô nào từ file Excel!', 'alert-triangle');
            }
        } catch (err) {
            this.view.customAlert('Lỗi đọc file', 'Không thể đọc file Excel: ' + err.message, 'x-circle');
        }
    };
    reader.readAsBinaryString(file);
}


