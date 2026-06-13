/* ==========================================================================
   BiddingFlow - PackageWorkflow (Split Workflow Controller Component)
   ========================================================================== */

export * from '/controllers/workflows/PackageOpening.js?v=5.8';
export * from '/controllers/workflows/PackageExcel.js?v=5.8';
export * from '/controllers/workflows/PackageTemplates.js?v=5.8';

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
        this.model.persistData('goithau');
        this.model.persistData('thongtinmothau');
        this.view.renderGoiThauTable();

        // Await sync to ensure DB is updated; alert on failure
        try {
            const syncRes = await fetch('/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': localStorage.getItem('bf_session_token') || '',
                    'X-Username': localStorage.getItem('bf_username') || ''
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
    const isTuVan = gt.linhVuc === 'Tư văn' || gt.linhVuc === 'Tư vấn';
    const isPhanLo = gt.phanLo === 'Có';
    const baodamContainer = document.getElementById('phathanh-baodam-container');
    const baodamInput = document.getElementById('phathanh-giatribaomothau');
    if (baodamContainer && baodamInput) {
        if (isTuVan || isPhanLo) {
            baodamContainer.style.display = 'none';
            baodamInput.removeAttribute('required');
        } else {
            baodamContainer.style.display = 'block';
            baodamInput.setAttribute('required', 'true');
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

    const isTuVan = gt.linhVuc === 'Tư văn' || gt.linhVuc === 'Tư vấn';
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
    if (!isTuVan && !isPhanLo) {
        giaTriDamBaoVal = this.model.parseVND(document.getElementById('phathanh-giatribaomothau').value);
        if (giaTriDamBaoVal <= 0) {
            await this.view.customAlert('Thiếu thông tin', 'Giá trị bảo đảm dự thầu phải lớn hơn 0 (trừ gói tư vấn)!', 'alert-triangle', document.getElementById('phathanh-giatribaomothau'));
            return;
        }
    }

    // Check if lot guarantees are satisfied for multi-lot bidding
    if (isPhanLo && !isTuVan) {
        const incompleteLot = gt.phanLoList && gt.phanLoList.some(pl => !pl.baoDamDuThau || pl.baoDamDuThau <= 0);
        if (incompleteLot || !gt.phanLoList || gt.phanLoList.length === 0) {
            await this.view.customAlert('Thiếu thông tin', 'Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô (trừ gói tư vấn)!', 'alert-triangle');
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
        if (!isTuVan && !isPhanLo) {
            gt.giaTriDamBaoDuThau = giaTriDamBaoVal;
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
                    const currentUserId = localStorage.getItem('bf_user_id');
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

            cb.addEventListener('click', (e) => {
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
        document.getElementById('gt-linhvuc').value = '';
        document.getElementById('gt-tuychonmuathem').value = 'Không';
        document.getElementById('gt-nguonvon').value = 'Ngân sách nhà nước';
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
            }
            await this.view.customAlert('Trùng mã gói thầu', `Mã gói thầu "${inputCode}" đã được sử dụng ở một gói thầu khác. Vui lòng nhập mã mới!`, 'alert-triangle', inputEl);
            return;
        }
    }

    const valueDate1 = document.getElementById('gt-thoigiandangtai').value;
    const valueDate2 = document.getElementById('gt-thoigiandongthau').value;
    const valueDate3 = document.getElementById('gt-thoigianmothau').value;
    const valueDate4 = document.getElementById('gt-ngayquyetdinh').value;

    const currentStatus = document.getElementById('gt-trangthai').value;
    const originalStatus = form.getAttribute('data-original-status') || '';

    // Enforce expert validation
    const checkedExpertsCG = document.querySelectorAll('input[name="tochuyengia-select"]:checked');
    const checkedExpertsTD = document.querySelectorAll('input[name="tothamdinh-select"]:checked');
    if (checkedExpertsCG.length === 0 || checkedExpertsTD.length === 0) {
        await this.view.customAlert(
            'Thiếu nhân sự chuyên môn',
            'Gói thầu bắt buộc phải có ít nhất 1 thành viên trong Tổ chuyên gia và 1 thành viên trong Tổ thẩm định để quản lý hồ sơ!',
            'users'
        );
        return;
    }

    const hasLeaderCG = Array.from(document.querySelectorAll('#to-chuyengia-tbody tr')).some(tr => {
        const cb = tr.querySelector('input[name="tochuyengia-select"]');
        const select = tr.querySelector('select[name="tochuyengia-chucvu"]');
        return cb && cb.checked && select && select.value === 'Tổ trưởng';
    });
    const hasLeaderTD = Array.from(document.querySelectorAll('#to-thamdinh-tbody tr')).some(tr => {
        const cb = tr.querySelector('input[name="tothamdinh-select"]');
        const select = tr.querySelector('select[name="tothamdinh-chucvu"]');
        return cb && cb.checked && select && select.value === 'Tổ trưởng';
    });
    if (!hasLeaderCG || !hasLeaderTD) {
        await this.view.customAlert(
            'Thiếu Tổ trưởng',
            'Tổ chuyên gia và Tổ thẩm định bắt buộc phải bổ nhiệm 1 Tổ trưởng để phân công nhiệm vụ!',
            'award'
        );
        return;
    }

    // Collect experts data
    const toChuyenGia = [];
    document.querySelectorAll('#to-chuyengia-tbody tr').forEach(tr => {
        const cb = tr.querySelector('input[name="tochuyengia-select"]');
        if (cb && cb.checked) {
            const chucVu = tr.querySelector('select[name="tochuyengia-chucvu"]').value;
            const congViec = tr.querySelector('input[name="tochuyengia-congviec"]').value.trim();
            toChuyenGia.push({ chuyenGiaId: cb.value, chucVu, congViec });
        }
    });

    const toThamDinh = [];
    document.querySelectorAll('#to-thamdinh-tbody tr').forEach(tr => {
        const cb = tr.querySelector('input[name="tothamdinh-select"]');
        if (cb && cb.checked) {
            const chucVu = tr.querySelector('select[name="tothamdinh-chucvu"]').value;
            const congViec = tr.querySelector('input[name="tothamdinh-congviec"]').value.trim();
            toThamDinh.push({ chuyenGiaId: cb.value, chucVu, congViec });
        }
    });

    // Check plan assignment details if active user is employee
    let employeeId = document.getElementById('gt-nhanvienphutrach').value;
    if (!employeeId && this.model.state.activerole === 'employee') {
        const currentUserId = localStorage.getItem('bf_user_id');
        employeeId = currentUserId ? 'user-' + currentUserId : '';
    }

    if (id) {
        // Mode edit: create history version
        const oldGt = this.model.state.goithau.find(g => g.id === id);
        if (!oldGt) return;

        const nextVerNum = parseInt(oldGt.phienBan) + 1;
        const nextVer = String(nextVerNum).padStart(2, '0');

        // Check if version change actually has updates to avoid redundant entries
        const isVonChanged = oldGt.nguonVon !== document.getElementById('gt-nguonvon').value;
        const isLinVucChanged = oldGt.linhVuc !== document.getElementById('gt-linhvuc').value;
        const isTenChanged = oldGt.tenGoiThau !== document.getElementById('gt-ten').value.trim();
        const isGiaChanged = oldGt.giaGoiThau !== this.model.parseVND(document.getElementById('gt-gia').value);
        const isTimeChanged = oldGt.thoiGianThucHien !== parseInt(document.getElementById('gt-thoigian').value);
        const isHinhThucChanged = oldGt.hinhThucLuaChon !== document.getElementById('gt-hinhthuc').value;
        const isPhuongThucChanged = oldGt.phuongThucLuaChon !== document.getElementById('gt-phuongthuc').value;
        const isLoaiHopDongChanged = oldGt.loaiHopDong !== document.getElementById('gt-loaihopdong').value;
        const isTimeOrganizedChanged = oldGt.thoiGianToChuc !== document.getElementById('gt-thoigiantochuc').value;
        const isTimeStartOrganizedChanged = oldGt.thoiGianBatDauToChuc !== document.getElementById('gt-thoigianbatdautochuc').value;
        const isQuaMangChanged = oldGt.quaMang !== document.getElementById('gt-quatmang').value;
        const isTrongNuocQuocTeChanged = oldGt.trongNuocQuocTe !== document.getElementById('gt-trongnuocquocte').value;
        const isTuyChonChanged = oldGt.tuyChonMuaThem !== document.getElementById('gt-tuychonmuathem').value;
        const isPhanLoChanged = oldGt.phanLo !== document.getElementById('gt-phanlo').value;
        const isSoQDChanged = (oldGt.soQuyetDinh || '') !== document.getElementById('gt-soquyetdinh').value.trim();
        const isNgayQDChanged = (oldGt.ngayQuyetDinh || '') !== (valueDate4 ? this.model.convertDMYToYMD(valueDate4) : '');

        const isDangTaiChanged = (oldGt.thoiGianDangTai || '') !== (valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : '');
        const isDongThauChanged = (oldGt.thoiGianDongThau || '') !== (valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : '');
        const isMoThauChanged = (oldGt.thoiGianMoThau || '') !== (valueDate3 ? this.model.convertDMYHMSToYMDHMS(valueDate3) : '');

        const isGiaHanChanged = JSON.stringify(oldGt.giaHanList || []) !== JSON.stringify(this._collectGiaHanRows());
        const isYCLamRoChanged = JSON.stringify(oldGt.yeuCauLamRoList || []) !== JSON.stringify(this._collectYeuCauLamRoRows());
        const isTLLamRoChanged = JSON.stringify(oldGt.traLoiLamRoList || []) !== JSON.stringify(this._collectTraLoiLamRoRows());

        const isPhanLoListChanged = JSON.stringify(oldGt.phanLoList || []) !== JSON.stringify(this._collectPhanLoRows());
        const isTuyChonListChanged = JSON.stringify(oldGt.tuyChonMuaThemList || []) !== JSON.stringify(this._collectTuyChonMuaThemRows());
        const isExpertsCGChanged = JSON.stringify(oldGt.toChuyenGia || []) !== JSON.stringify(toChuyenGia);
        const isExpertsTDChanged = JSON.stringify(oldGt.toThamDinh || []) !== JSON.stringify(toThamDinh);

        const isAssignmentChanged = (() => {
            const assignment = this.model.state.assignments.find(a => a.targetId === oldGt.id && a.type === 'goithau');
            const currentEmpId = assignment ? assignment.empId : '';
            return currentEmpId !== employeeId;
        })();

        const isAwardedChanged = (() => {
            if (oldGt.phanLo === 'Có') {
                const currentAwarded = this._collectAwardedContractors();
                return JSON.stringify(oldGt.awardedPhanLoList || []) !== JSON.stringify(currentAwarded);
            } else {
                const isWinnerChanged = (oldGt.nhaThauTrungThauId || '') !== document.getElementById('gt-nhathautrungthauid').value;
                const isWinnerPriceChanged = (oldGt.giaTrungThau || 0) !== this.model.parseVND(document.getElementById('gt-giatrungthau').value);
                const isGtTimeChanged = (oldGt.thoiGianGoiThau || '') !== document.getElementById('gt-thoigian-goithau').value.trim();
                const isHdTimeChanged = (oldGt.thoiGianHopDong || '') !== document.getElementById('gt-thoigian-hopdong').value.trim();
                return isWinnerChanged || isWinnerPriceChanged || isGtTimeChanged || isHdTimeChanged;
            }
        })();

        const hasAnyUpdate = isVonChanged || isLinVucChanged || isTenChanged || isGiaChanged || isTimeChanged ||
            isHinhThucChanged || isPhuongThucChanged || isLoaiHopDongChanged || isTimeOrganizedChanged ||
            isTimeStartOrganizedChanged || isQuaMangChanged || isTrongNuocQuocTeChanged ||
            isTuyChonChanged || isPhanLoChanged || isSoQDChanged || isNgayQDChanged ||
            isDangTaiChanged || isDongThauChanged || isMoThauChanged || isGiaHanChanged ||
            isYCLamRoChanged || isTLLamRoChanged || isPhanLoListChanged || isTuyChonListChanged ||
            isExpertsCGChanged || isExpertsTDChanged || isAssignmentChanged || isAwardedChanged ||
            (oldGt.trangThai !== currentStatus);

        if (!hasAnyUpdate) {
            this.view.closeModal('modal-goithau');
            await this.view.customAlert('Thông báo', 'Không có sự thay đổi nào được ghi nhận.', 'info');
            return;
        }

        // De-active the old version as latest
        oldGt.isLatest = 0;
        oldGt.is_latest = 0;

        const newGt = {
            ...oldGt,
            id: 'gt-' + window.generateUUID(),
            maGoiThau: inputCode,
            tenGoiThau: document.getElementById('gt-ten').value.trim(),
            giaGoiThau: this.model.parseVND(document.getElementById('gt-gia').value),
            thoiGianThucHien: parseInt(document.getElementById('gt-thoigian').value) || 0,
            hinhThucLuaChon: document.getElementById('gt-hinhthuc').value,
            phuongThucLuaChon: document.getElementById('gt-phuongthuc').value,
            trangThai: currentStatus,
            phienBan: nextVer,
            isLatest: 1,
            is_latest: 1,
            updatedAt: formattedTime,

            linhVuc: document.getElementById('gt-linhvuc').value,
            tuyChonMuaThem: document.getElementById('gt-tuychonmuathem').value,
            nguonVon: document.getElementById('gt-nguonvon').value,
            loaiHopDong: document.getElementById('gt-loaihopdong').value,
            thoiGianToChuc: document.getElementById('gt-thoigiantochuc').value,
            thoiGianBatDauToChuc: document.getElementById('gt-thoigianbatdautochuc').value,
            quaMang: document.getElementById('gt-quatmang').value,
            trongNuocQuocTe: document.getElementById('gt-trongnuocquocte').value,
            phanLo: document.getElementById('gt-phanlo').value,

            giaTriDamBaoDuThau: this.model.parseVND(document.getElementById('gt-giatribaomothau').value) || 0,
            hieuLucHsdt: parseInt(document.getElementById('gt-hieuluchsdt').value) || 0,
            hieuLucDamBaoDuThau: parseInt(document.getElementById('gt-hieuluchbaomothau').value) || 0,

            soQuyetDinh: document.getElementById('gt-soquyetdinh').value.trim(),
            ngayQuyetDinh: valueDate4 ? this.model.convertDMYToYMD(valueDate4) : '',

            thoiGianDangTai: valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : '',
            thoiGianDongThau: valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : '',
            thoiGianMoThau: valueDate3 ? this.model.convertDMYHMSToYMDHMS(valueDate3) : '',

            phanLoList: this._collectPhanLoRows(),
            tuyChonMuaThemList: this._collectTuyChonMuaThemRows(),
            giaHanList: this._collectGiaHanRows(),
            yeuCauLamRoList: this._collectYeuCauLamRoRows(),
            traLoiLamRoList: this._collectTraLoiLamRoRows(),
            toChuyenGia,
            toThamDinh
        };

        if (currentStatus === 'Đã có kết quả') {
            if (newGt.phanLo !== 'Có') {
                newGt.nhaThauTrungThauId = document.getElementById('gt-nhathautrungthauid').value;
                newGt.giaTrungThau = this.model.parseVND(document.getElementById('gt-giatrungthau').value) || 0;
                newGt.thoiGianGoiThau = document.getElementById('gt-thoigian-goithau').value.trim();
                newGt.thoiGianHopDong = document.getElementById('gt-thoigian-hopdong').value.trim();
            } else {
                newGt.awardedPhanLoList = this._collectAwardedContractors();
            }
        } else {
            newGt.nhaThauTrungThauId = '';
            newGt.giaTrungThau = 0;
            newGt.thoiGianGoiThau = '';
            newGt.thoiGianHopDong = '';
            newGt.awardedPhanLoList = [];
        }

        this.model.state.goithau.push(newGt);

        // Update active employee assignments
        this.model.state.assignments = this.model.state.assignments.filter(a => !(a.targetId === oldGt.id && a.type === 'goithau'));
        if (employeeId) {
            this.model.state.assignments.push({
                id: 'as-' + window.generateUUID(),
                empId: employeeId,
                targetId: newGt.id,
                type: 'goithau',
                assignedAt: formattedTime
            });
        }

        // Migrate other tables pointing to old package ID to reference new version package ID
        this.model.state.thongtinmothau.forEach(b => {
            if (String(b.goiThauId) === String(oldGt.id)) {
                b.goiThauId = newGt.id;
            }
        });

        this.model.persistData('goithau');
        this.model.persistData('assignments');
        this.model.persistData('thongtinmothau');

        // Check if packageWizard is active, update wizard state to point to new ID!
        if (this.packageWizard.active && this.packageWizard.planId) {
            // Update plan details to reference the new ID as latest
            this.packageWizard.currentCount++;
            this.view.closeModal('modal-goithau');
            if (this.packageWizard.currentCount <= this.packageWizard.totalCount) {
                this.openPackageWizardStep();
            } else {
                this.packageWizard.active = false;
                this.packageWizard.planId = null;
                await this.view.customAlert('Thành công', 'Đã lưu tất cả các gói thầu trong kế hoạch thành công!', 'check-circle');
            }
        } else {
            this.view.closeModal('modal-goithau');
        }

        this.view.renderGoiThauTable();
        this.autoSync();
        await this.view.customAlert('Thành công', `Cập nhật gói thầu thành công! Đã lưu phiên bản mới ${newGt.phienBan}.`, 'check-circle');
    } else {
        // Mode create
        const newId = 'gt-' + window.generateUUID();
        const newGt = {
            id: newId,
            rootId: newId,
            maGoiThau: inputCode,
            keHoachId: document.getElementById('gt-kehoachid').value,
            tenGoiThau: document.getElementById('gt-ten').value.trim(),
            giaGoiThau: this.model.parseVND(document.getElementById('gt-gia').value),
            thoiGianThucHien: parseInt(document.getElementById('gt-thoigian').value) || 0,
            hinhThucLuaChon: document.getElementById('gt-hinhthuc').value,
            phuongThucLuaChon: document.getElementById('gt-phuongthuc').value,
            trangThai: currentStatus,
            phienBan: '00',
            isLatest: 1,
            is_latest: 1,
            createdAt: formattedTime,
            updatedAt: formattedTime,

            linhVuc: document.getElementById('gt-linhvuc').value,
            tuyChonMuaThem: document.getElementById('gt-tuychonmuathem').value,
            nguonVon: document.getElementById('gt-nguonvon').value,
            loaiHopDong: document.getElementById('gt-loaihopdong').value,
            thoiGianToChuc: document.getElementById('gt-thoigiantochuc').value,
            thoiGianBatDauToChuc: document.getElementById('gt-thoigianbatdautochuc').value,
            quaMang: document.getElementById('gt-quatmang').value,
            trongNuocQuocTe: document.getElementById('gt-trongnuocquocte').value,
            phanLo: document.getElementById('gt-phanlo').value,

            giaTriDamBaoDuThau: this.model.parseVND(document.getElementById('gt-giatribaomothau').value) || 0,
            hieuLucHsdt: parseInt(document.getElementById('gt-hieuluchsdt').value) || 0,
            hieuLucDamBaoDuThau: parseInt(document.getElementById('gt-hieuluchbaomothau').value) || 0,

            soQuyetDinh: document.getElementById('gt-soquyetdinh').value.trim(),
            ngayQuyetDinh: valueDate4 ? this.model.convertDMYToYMD(valueDate4) : '',

            thoiGianDangTai: valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : '',
            thoiGianDongThau: valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : '',
            thoiGianMoThau: valueDate3 ? this.model.convertDMYHMSToYMDHMS(valueDate3) : '',

            phanLoList: this._collectPhanLoRows(),
            tuyChonMuaThemList: this._collectTuyChonMuaThemRows(),
            giaHanList: this._collectGiaHanRows(),
            yeuCauLamRoList: this._collectYeuCauLamRoRows(),
            traLoiLamRoList: this._collectTraLoiLamRoRows(),
            toChuyenGia,
            toThamDinh
        };

        if (currentStatus === 'Đã có kết quả') {
            if (newGt.phanLo !== 'Có') {
                newGt.nhaThauTrungThauId = document.getElementById('gt-nhathautrungthauid').value;
                newGt.giaTrungThau = this.model.parseVND(document.getElementById('gt-giatrungthau').value) || 0;
                newGt.thoiGianGoiThau = document.getElementById('gt-thoigian-goithau').value.trim();
                newGt.thoiGianHopDong = document.getElementById('gt-thoigian-hopdong').value.trim();
            } else {
                newGt.awardedPhanLoList = this._collectAwardedContractors();
            }
        } else {
            newGt.nhaThauTrungThauId = '';
            newGt.giaTrungThau = 0;
            newGt.thoiGianGoiThau = '';
            newGt.thoiGianHopDong = '';
            newGt.awardedPhanLoList = [];
        }

        this.model.state.goithau.push(newGt);

        if (employeeId) {
            this.model.state.assignments.push({
                id: 'as-' + window.generateUUID(),
                empId: employeeId,
                targetId: newGt.id,
                type: 'goithau',
                assignedAt: formattedTime
            });
        }

        this.model.persistData('goithau');
        this.model.persistData('assignments');

        // Check if packageWizard is active, update wizard state to point to new ID!
        if (this.packageWizard.active && this.packageWizard.planId) {
            // Update plan details to reference the new ID as latest
            this.packageWizard.currentCount++;
            this.view.closeModal('modal-goithau');
            if (this.packageWizard.currentCount <= this.packageWizard.totalCount) {
                this.openPackageWizardStep();
            } else {
                this.packageWizard.active = false;
                this.packageWizard.planId = null;
                await this.view.customAlert('Thành công', 'Đã lưu tất cả các gói thầu trong kế hoạch thành công!', 'check-circle');
            }
        } else {
            this.view.closeModal('modal-goithau');
        }

        this.view.renderGoiThauTable();
        this.autoSync();
        await this.view.customAlert('Thành công', 'Thêm mới gói thầu thành công!', 'check-circle');
    }
}

export function addPhanLoRow(data = {}) {
    const tbody = document.getElementById('phanlo-tbody');
    if (!tbody) return;

    const rowId = data.id || 'pl-' + window.generateUUID();
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', rowId);

    const code = data.code || data.maPhanLo || '';
    const name = data.name || data.tenPhanLo || '';
    const price = data.price || data.giaTriPhanLo || 0;
    const duration = data.duration || data.thoiGianThucHien || '';
    const baoDamVal = data.baoDamDuThau || '';

    const isMoiThauOrLater = (document.getElementById('gt-trangthai')?.value !== 'Chuẩn bị');
    const displayStyle = isMoiThauOrLater ? '' : 'display: none;';
    const requiredAttr = isMoiThauOrLater ? 'required' : '';

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

    const rowId = data.id || 'tc-' + window.generateUUID();
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

    const rowId = data.id || 'gh-' + window.generateUUID();
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

    const rowId = data.id || 'yc-' + window.generateUUID();
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

    const rowId = data.id || 'tl-' + window.generateUUID();
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
