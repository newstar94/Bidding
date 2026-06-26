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

    const relatedGts = baseCode ? this.model.state.goithau.filter(gt => this.model.getPackageBaseCode(gt.maGoiThau) === baseCode) : [targetPackage];
    const relatedIds = relatedGts.map(gt => gt.id);

    let deleteConfirmed = false;
    let deleteChoice = null;

    if (relatedGts.length >= 2) {
        deleteChoice = await this.view.customVersionDeleteChoice(
            'Xác nhận xóa',
            `Gói thầu "${targetPackage.tenGoiThau}" có ${relatedGts.length} phiên bản. Vui lòng chọn cách thức xóa:`,
            'Xóa phiên bản gần nhất',
            'Xóa toàn bộ các phiên bản'
        );
        if (deleteChoice === null) return;
    } else {
        const confirmed = await this.view.customConfirm(
            'Xác nhận xóa',
            'Bạn có chắc muốn xóa gói thầu này? Mọi phiên bản lịch sử liên quan sẽ bị xóa bỏ.',
            'trash-2'
        );
        if (!confirmed) return;
        deleteConfirmed = true;
    }

    if (deleteChoice === 1) {
        const maxVer = Math.max(...relatedGts.map(g => parseInt(g.phienBan) || 0));
        const latestGt = relatedGts.find(g => (parseInt(g.phienBan) || 0) === maxVer);
        if (!latestGt) return;

        this.model.state.goithau = this.model.state.goithau.filter(gt => gt.id !== latestGt.id);
        this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) !== String(latestGt.id));

        const remainingRelated = relatedGts.filter(gt => gt.id !== latestGt.id);
        if (remainingRelated.length > 0) {
            const nextMaxVer = Math.max(...remainingRelated.map(g => parseInt(g.phienBan) || 0));
            remainingRelated.forEach(gt => {
                if ((parseInt(gt.phienBan) || 0) === nextMaxVer) {
                    gt.isLatest = 1;
                    gt.is_latest = 1;
                } else {
                    gt.isLatest = 0;
                    gt.is_latest = 0;
                }
            });
        }

        await this.model.persistData('goithau');
        await this.model.persistData('thongtinmothau');

        const planId = latestGt.keHoachId;
        if (planId) {
            this.recalculatePlanTotal(planId);
        }

        const breakdownPlanId = document.getElementById('breakdown-plan-id')?.value;
        const modalBreakdown = document.getElementById('modal-plan-breakdown');
        if (modalBreakdown && modalBreakdown.classList.contains('active') && breakdownPlanId) {
            this.renderBreakdownPackagesList(breakdownPlanId);
            this.updateBreakdownTotal(breakdownPlanId);
        }

        this.view.renderGoiThauTable();

        try {
            await this.autoSync();
        } catch (e) {
            await this.view.customAlert('Lỗi đồng bộ', 'Gói thầu đã xóa khỏi giao diện nhưng có lỗi khi đồng bộ với cơ sở dữ liệu. Vui lòng tải lại trang.', 'x-circle');
        }

        await this.view.customAlert('Thành công', 'Đã xóa phiên bản gói thầu gần nhất!', 'check-circle');
    } else if (deleteChoice === 2 || deleteConfirmed) {
        if (baseCode) {
            this.model.state.goithau = this.model.state.goithau.filter(gt => this.model.getPackageBaseCode(gt.maGoiThau) !== baseCode);
            this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => !relatedIds.includes(String(b.goiThauId)));
        } else {
            this.model.state.goithau = this.model.state.goithau.filter(gt => gt.id !== id);
            this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) !== String(id));
        }

        await this.model.persistData('goithau');
        await this.model.persistData('thongtinmothau');

        const planId = targetPackage.keHoachId;
        if (planId) {
            this.recalculatePlanTotal(planId);
        }

        const breakdownPlanId = document.getElementById('breakdown-plan-id')?.value;
        const modalBreakdown = document.getElementById('modal-plan-breakdown');
        if (modalBreakdown && modalBreakdown.classList.contains('active') && breakdownPlanId) {
            this.renderBreakdownPackagesList(breakdownPlanId);
            this.updateBreakdownTotal(breakdownPlanId);
        }

        this.view.renderGoiThauTable();

        try {
            await this.autoSync();
        } catch (e) {
            await this.view.customAlert('Lỗi đồng bộ', 'Gói thầu đã xóa khỏi giao diện nhưng có lỗi khi đồng bộ với cơ sở dữ liệu. Vui lòng tải lại trang.', 'x-circle');
        }

        if (deleteChoice === 2) {
            await this.view.customAlert('Thành công', 'Đã xóa toàn bộ các phiên bản của gói thầu!', 'check-circle');
        }
    }
}


export function editGoiThau(id, isReadOnly = false) {
    const modal = document.getElementById('modal-goithau');
    const form = document.getElementById('form-goithau');
    const gt = id ? this.model.state.goithau.find(g => String(g.id) === String(id)) : null;

    form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

    // Reset editable state first
    form.querySelectorAll('input, select, textarea').forEach(el => {
        el.disabled = false;
        const wrapper = el.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${el.id}"]`);
        if (wrapper) {
            const searchInput = wrapper.querySelector('.custom-select-search');
            if (searchInput) searchInput.disabled = false;
        }
    });
    form.querySelectorAll('button').forEach(btn => {
        btn.disabled = false;
    });
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.style.display = '';

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
        if (!window._preModalTab) {
            window._preModalTab = this.model.state.activetab || 'goithau';
            window._preModalAction = this.model.state.activeaction || null;
        }
        this.switchTab('goithau', 'chinhsua', true);
        document.getElementById('modal-goithau-title').textContent = isReadOnly ? 'Chi tiết Gói thầu' : 'Cập nhật Gói thầu';
        // Using the gt variable declared at the top of the function

        document.getElementById('form-goithau').setAttribute('data-original-status', gt.trangThai);
        document.getElementById('form-goithau-id').value = gt.id;
        const existingGtCode = this.model.getPackageBaseCode(gt.maGoiThau);
        document.getElementById('gt-ma').value = existingGtCode;
        const gtMaInput = document.getElementById('gt-ma');
        if (gtMaInput) {
            if (existingGtCode && existingGtCode.trim() !== '' && gt.trangThai !== 'Chuẩn bị') {
                gtMaInput.setAttribute('readonly', 'true');
            } else {
                gtMaInput.removeAttribute('readonly');
            }
        }
        const khSelect = document.getElementById('gt-kehoachid');
        khSelect.value = gt.keHoachId;
        khSelect.dispatchEvent(new Event('change'));
        document.getElementById('gt-ten').value = gt.tenGoiThau;
        document.getElementById('gt-gia').value = this.model.formatVND(gt.giaGoiThau);
        document.getElementById('gt-thoigian').value = gt.thoiGianThucHien;
        document.getElementById('gt-hinhthuc').value = gt.hinhThucLuaChon;
        document.getElementById('gt-phuongthuc').value = gt.phuongThucLuaChon;
        document.getElementById('gt-trangthai').value = gt.trangThai;



        document.getElementById('gt-linhvuc').value = gt.linhVuc || '';
        const isThuocVal = (gt.isThuoc === 1 || gt.isThuoc === '1') ? '1' : '0';
        const radioToCheck = document.querySelector(`input[name="gt-goithauthuoc"][value="${isThuocVal}"]`);
        if (radioToCheck) radioToCheck.checked = true;
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

        this.updatePackageFieldsVisibility(isReadOnly);

        this._isEditMode = true;
        this._loadPhanLoRows(gt.phanLoList || []);
        this._loadTuyChonMuaThemRows(gt.tuyChonMuaThemList || []);
        this._loadGiaHanRows(gt.giaHanList || []);
        this._loadYeuCauLamRoRows(gt.yeuCauLamRoList || []);
        this._loadTraLoiLamRoRows(gt.traLoiLamRoList || []);

        if (gt.trangThai === 'Đã có kết quả') {
            if (gt.phanLo !== 'Có') {
                const ntSelectVal = document.getElementById('gt-nhathautrungthauid');
                ntSelectVal.value = gt.nhaThauTrungThauId || '';
                ntSelectVal.dispatchEvent(new Event('change'));
                document.getElementById('gt-giatrungthau').value = gt.giaTrungThau ? this.model.formatVND(gt.giaTrungThau) : '';
                document.getElementById('gt-thoigian-goithau').value = gt.thoiGianGoiThau || '';
                document.getElementById('gt-thoigian-hopdong').value = gt.thoiGianHopDong || '';
            }
        }
        let defaultAwardedList = typeof gt.awardedPhanLoList === 'string' ? JSON.parse(gt.awardedPhanLoList || '[]') : (gt.awardedPhanLoList || []);
        if ((!defaultAwardedList || defaultAwardedList.length === 0) && gt.phanLoList) {
            const plList = typeof gt.phanLoList === 'string' ? JSON.parse(gt.phanLoList || '[]') : (gt.phanLoList || []);
            defaultAwardedList = plList.map(pl => ({
                tenPhanLo: pl.tenPhanLo,
                nhaThauTrungThauId: pl.nhaThauTrungThauId,
                giaTrungThau: pl.giaTrungThau,
                thoiGianGoiThau: pl.thoiGianGoiThau,
                thoiGianHopDong: pl.thoiGianHopDong
            }));
        }
        this.updateAwardedContractorUI(defaultAwardedList || []);

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

        if (this.updatePhuongPhapDanhGiaOptions) {
            this.updatePhuongPhapDanhGiaOptions();
        }
        document.getElementById('gt-phuongphapdanhgia').value = gt.phuongPhapDanhGia || '';
        if (this.updateTrongSoKyThuatVisibility) {
            this.updateTrongSoKyThuatVisibility();
        }
        document.getElementById('gt-trongsokythuat').value = (gt.trongSoKyThuat !== undefined && gt.trongSoKyThuat !== null) ? gt.trongSoKyThuat : '';
    } else {
        if (!window._preModalTab) {
            window._preModalTab = this.model.state.activetab || 'goithau';
            window._preModalAction = this.model.state.activeaction || null;
        }
        this.switchTab('goithau', 'taomoi', true);
        if (this.view.fpNgayQuyetDinh) this.view.fpNgayQuyetDinh.clear();
        if (this.view.fpThoiGianDangTai) this.view.fpThoiGianDangTai.clear();
        if (this.view.fpThoiGianDongThau) this.view.fpThoiGianDongThau.clear();
        if (this.view.fpThoiGianMoThau) this.view.fpThoiGianMoThau.clear();

        document.getElementById('modal-goithau-title').textContent = isReadOnly ? 'Chi tiết Gói thầu' : 'Thêm Gói thầu mới';
        form.reset();
        if (this.updatePhuongPhapDanhGiaOptions) {
            this.updatePhuongPhapDanhGiaOptions();
        }
        if (this.updateTrongSoKyThuatVisibility) {
            this.updateTrongSoKyThuatVisibility();
        }
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

        this.updatePackageFieldsVisibility(isReadOnly);

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
    this.updatePackageFieldsVisibility(isReadOnly);

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

    // Force read-only override for all elements if isReadOnly is true
    if (isReadOnly) {
        form.querySelectorAll('input, select, textarea').forEach(el => {
            el.disabled = true;
            const wrapper = el.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${el.id}"]`);
            if (wrapper) {
                const searchInput = wrapper.querySelector('.custom-select-search');
                if (searchInput) searchInput.disabled = true;
            }
        });

        form.querySelectorAll('button:not([data-close])').forEach(btn => {
            btn.disabled = true;
        });

        if (submitBtn) submitBtn.style.display = 'none';

        ['fpNgayQuyetDinh', 'fpThoiGianDangTai', 'fpThoiGianDongThau', 'fpThoiGianMoThau'].forEach(fpKey => {
            const fp = this.view[fpKey];
            if (fp) {
                fp.input.disabled = true;
                fp.set('clickOpens', false);
            }
        });

        document.querySelectorAll('#phanlo-tbody input, #phanlo-tbody select, #phanlo-tbody button, #tuychonmuathem-tbody input, #tuychonmuathem-tbody select, #tuychonmuathem-tbody button').forEach(el => {
            el.disabled = true;
        });
        document.querySelectorAll('#to-chuyengia-tbody input, #to-chuyengia-tbody select, #to-thamdinh-tbody input, #to-thamdinh-tbody select').forEach(el => {
            el.disabled = true;
        });
        document.querySelectorAll('#gt-giahan-tbody input, #gt-giahan-tbody select, #gt-giahan-tbody button').forEach(el => {
            el.disabled = true;
        });
        document.querySelectorAll('#gt-yeucaulamro-tbody input, #gt-yeucaulamro-tbody select, #gt-yeucaulamro-tbody button').forEach(el => {
            el.disabled = true;
        });
        document.querySelectorAll('#gt-traloilamro-tbody input, #gt-traloilamro-tbody select, #gt-traloilamro-tbody button').forEach(el => {
            el.disabled = true;
        });
        document.querySelectorAll('#awarded-phanlo-tbody input, #awarded-phanlo-tbody select, #awarded-phanlo-tbody button').forEach(el => {
            el.disabled = true;
        });

        const addButtons = [
            'btn-them-phanlo', 'btn-template-phanlo', 'btn-import-excel-phanlo',
            'btn-them-tuychonmuathem', 'btn-template-tuychonmuathem', 'btn-import-excel-tuychonmuathem',
            'btn-them-giahan', 'btn-them-yeucaulamro', 'btn-them-traloilamro'
        ];
        addButtons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) btn.disabled = true;
        });
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
    let finalGtId = id;
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

    const phuongPhapDanhGia = document.getElementById('gt-phuongphapdanhgia')?.value || '';
    const trongSoKyThuatRaw = document.getElementById('gt-trongsokythuat')?.value || '';
    const trongSoKyThuat = trongSoKyThuatRaw !== '' ? parseInt(trongSoKyThuatRaw) : null;
    const phuongThucLuaChon = document.getElementById('gt-phuongthuc')?.value || '';

    if (this.validateTrongSoKyThuat) {
        if (!this.validateTrongSoKyThuat(true)) {
            const inputEl = document.getElementById('gt-trongsokythuat');
            await this.view.customAlert('Lỗi kiểm tra', 'Giá trị trọng số kỹ thuật không hợp lệ, vui lòng kiểm tra lại thông tin lỗi bên dưới trường nhập liệu!', 'x-circle', inputEl);
            return;
        }
        if (phuongPhapDanhGia === 'Kết hợp giữa kỹ thuật và giá' && linhVuc !== 'Tư vấn' && phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ') {
            if (trongSoKyThuat > 30 && trongSoKyThuat <= 50) {
                await this.view.customAlert('Cảnh báo', 'Cảnh báo: Trọng số kỹ thuật lớn hơn 30% (mức khuyến nghị thông thường là 10% - 30%).', 'alert-triangle');
            }
        }
    }

    const gtData = {
        keHoachId: document.getElementById('gt-kehoachid').value,
        tenGoiThau: document.getElementById('gt-ten').value.trim(),
        giaGoiThau: this.model.parseVND(document.getElementById('gt-gia').value),
        thoiGianThucHien: document.getElementById('gt-thoigian').value.trim(),
        hinhThucLuaChon: document.getElementById('gt-hinhthuc').value,
        phuongThucLuaChon: phuongThucLuaChon,
        phuongPhapDanhGia: phuongPhapDanhGia,
        trongSoKyThuat: trongSoKyThuat,
        trangThai: document.getElementById('gt-trangthai').value,
        linhVuc: linhVuc,
        isThuoc: (linhVuc === 'Hàng hóa') ? (document.querySelector('input[name="gt-goithauthuoc"]:checked')?.value === '1' ? 1 : 0) : 0,
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

        let saveAsNewVersion = !!(oldGt && oldGt.thoiGianDangTai && String(gtData.thoiGianDangTai || '') !== String(oldGt.thoiGianDangTai || ''));

        if (saveAsNewVersion) {
            const rootId = oldGt.rootId || oldGt.id;
            const relatedGts = this.model.state.goithau.filter(g => (g.rootId || g.id) === rootId);
            const maxVersion = Math.max(...relatedGts.map(g => parseInt(g.phienBan) || 0));
            const nextVersion = String(maxVersion + 1).padStart(2, '0');

            relatedGts.forEach(g => { g.isLatest = 0; g.is_latest = 0; });
            const newGtId = window.generateUUID();
            finalGtId = newGtId;
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

            // Thêm liên kết hợp đồng mới bên cạnh liên kết cũ thay vì thay thế
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

            // Sao chép thông tin mở thầu (thongtinmothau) từ phiên bản cũ sang phiên bản mới thay vì di chuyển
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
        finalGtId = newGtId;
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

    if (window._preModalTab === 'goithau-detail' && finalGtId) {
        window._preModalAction = finalGtId;
    }
    this.closeModal('modal-goithau');
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
