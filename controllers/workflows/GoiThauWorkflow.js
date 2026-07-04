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
    const rootId = targetPackage.rootId || targetPackage.id;

    // Get all related packages sharing the same rootId across ALL plan versions
    const allRelatedGts = this.model.state.goithau.filter(gt => (gt.rootId || gt.id) === rootId);
    const uniqueVersionsCount = new Set(allRelatedGts.map(g => g.phienBan || '00')).size;
    const allRelatedIds = allRelatedGts.map(gt => gt.id);

    let deleteConfirmed = false;
    let deleteChoice = null;

    if (uniqueVersionsCount >= 2) {
        deleteChoice = await this.view.customVersionDeleteChoice(
            'Xác nhận xóa',
            `Gói thầu "${targetPackage.tenGoiThau}" có ${uniqueVersionsCount} phiên bản. Vui lòng chọn cách thức xóa:`,
            'Xóa phiên bản gần nhất',
            'Xóa toàn bộ'
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
        const maxVer = Math.max(...allRelatedGts.map(g => parseInt(g.phienBan) || 0));
        const latestGts = allRelatedGts.filter(g => (parseInt(g.phienBan) || 0) === maxVer);
        const latestIds = latestGts.map(g => g.id);

        this.model.state.goithau = this.model.state.goithau.filter(gt => !latestIds.includes(gt.id));
        this.model.markDeleted('goithau', latestIds);
        const latestBidIds = (this.model.state.thongtinmothau || [])
            .filter(b => latestIds.includes(String(b.goiThauId)))
            .map(b => b.id);
        this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => !latestIds.includes(String(b.goiThauId)));
        this.model.markDeleted('thongtinmothau', latestBidIds);

        // Update isLatest for remaining versions in each plan version
        const remainingRelated = allRelatedGts.filter(gt => !latestIds.includes(gt.id));
        const planIds = [...new Set(allRelatedGts.map(gt => gt.keHoachId))];
        planIds.forEach(pId => {
            const planRemaining = remainingRelated.filter(gt => gt.keHoachId === pId);
            if (planRemaining.length > 0) {
                const nextMaxVer = Math.max(...planRemaining.map(g => parseInt(g.phienBan) || 0));
                planRemaining.forEach(gt => {
                    if ((parseInt(gt.phienBan) || 0) === nextMaxVer) {
                        gt.isLatest = 1;
                        gt.is_latest = 1;
                    } else {
                        gt.isLatest = 0;
                        gt.is_latest = 0;
                    }
                });
            }
        });

        await this.model.persistData('goithau');
        await this.model.persistData('thongtinmothau');

        // Recalculate plan totals for all affected plan versions
        planIds.forEach(pId => {
            if (pId) {
                this.recalculatePlanTotal(pId);
            }
        });

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
        this.model.state.goithau = this.model.state.goithau.filter(gt => (gt.rootId || gt.id) !== rootId);
        this.model.markDeleted('goithau', allRelatedIds);
        const relatedBidIds = (this.model.state.thongtinmothau || [])
            .filter(b => allRelatedIds.includes(String(b.goiThauId)))
            .map(b => b.id);
        this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(b => !allRelatedIds.includes(String(b.goiThauId)));
        this.model.markDeleted('thongtinmothau', relatedBidIds);

        await this.model.persistData('goithau');
        await this.model.persistData('thongtinmothau');

        const planIds = [...new Set(allRelatedGts.map(gt => gt.keHoachId))];
        planIds.forEach(pId => {
            if (pId) {
                this.recalculatePlanTotal(pId);
            }
        });

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
        btn.style.display = '';
    });
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.style.display = '';

    const setSubTableActionVisibility = (visible) => {
        const display = visible ? '' : 'none';
        [
            'btn-them-giahan',
            'btn-them-yeucaulamro',
            'btn-them-traloilamro'
        ].forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) btn.style.display = display;
        });

        document.querySelectorAll(
            '#giahan-table .col-action, #yeucaulamro-table .col-action, #traloilamro-table .col-action'
        ).forEach(cell => {
            cell.style.display = display;
        });

        document.querySelectorAll(
            '#gt-giahan-tbody .remove-gh-row-btn, #gt-yeucaulamro-tbody .remove-yc-row-btn, #gt-traloilamro-tbody .remove-tl-row-btn'
        ).forEach(btn => {
            const cell = btn.closest('td');
            if (cell) cell.style.display = display;
            btn.style.display = display;
        });
    };
    setSubTableActionVisibility(true);

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
                    this.enforceSingleLeader(tbodyId, roleName, roleSelect);

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
                        roleSelect.disabled = false;
                    } else {
                        roleSelect.value = 'Tổ viên';
                        roleSelect.disabled = true;
                    }
                }
                if (jobInput) {
                    jobInput.disabled = !newChecked;
                    if (newChecked) {
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

                this.enforceSingleLeader(tbodyId, roleName, roleSelect);
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
        const latestPlan = this.model.getLatestPlan(gt.keHoachId);
        khSelect.value = latestPlan ? latestPlan.id : gt.keHoachId;
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
        document.getElementById('gt-tylebaodamhopdong').value = gt.tyLeBaoDamHopDong !== undefined && gt.tyLeBaoDamHopDong !== null ? gt.tyLeBaoDamHopDong : '';

        this.updatePackageFieldsVisibility(isReadOnly);

        // Trigger change event to initialize conditional fields and their disabled states
        const gtHinhThucEl = document.getElementById('gt-hinhthuc');
        if (gtHinhThucEl) {
            gtHinhThucEl.dispatchEvent(new Event('change'));
        }

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
        document.getElementById('gt-ngayquyetdinh').value = gt.ngayQuyetDinh ? this.model.formatForDateInput(gt.ngayQuyetDinh) : '';
        document.getElementById('gt-thoigiandangtai').value = gt.thoiGianDangTai ? this.model.formatForDatetimeLocal(gt.thoiGianDangTai) : '';
        document.getElementById('gt-thoigiandongthau').value = gt.thoiGianDongThau ? this.model.formatForDatetimeLocal(gt.thoiGianDongThau) : '';
        document.getElementById('gt-thoigianmothau').value = gt.thoiGianMoThau ? this.model.formatForDatetimeLocal(gt.thoiGianMoThau) : '';
        
        const inputMoEhsdxtc = document.getElementById('gt-thoigianmoehsdxtc');
        if (inputMoEhsdxtc) {
            inputMoEhsdxtc.value = gt.thoiGianMoEhsdxtc ? this.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : '';
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
        document.getElementById('gt-ngayquyetdinh').value = '';
        document.getElementById('gt-thoigiandangtai').value = '';
        document.getElementById('gt-thoigiandongthau').value = '';
        document.getElementById('gt-thoigianmothau').value = '';
        document.getElementById('gt-thoigianmoehsdxtc').value = '';
        
        const inputMoEhsdxtc = document.getElementById('gt-thoigianmoehsdxtc');
        if (inputMoEhsdxtc) inputMoEhsdxtc.value = '';


        document.getElementById('modal-goithau-title').textContent = isReadOnly ? 'Chi tiết Gói thầu' : 'Thêm Gói thầu mới';
        form.reset();
        if (this.updatePhuongPhapDanhGiaOptions) {
            this.updatePhuongPhapDanhGiaOptions();
        }
        if (this.updateTrongSoKyThuatVisibility) {
            this.updateTrongSoKyThuatVisibility();
        }
        form.removeAttribute('data-original-status');
        form.removeAttribute('data-rebid-from');
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
        document.getElementById('gt-tylebaodamhopdong').value = '';

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

    // Khóa/mở khóa native date inputs trực tiếp
    ['gt-ngayquyetdinh', 'gt-thoigiandangtai', 'gt-thoigiandongthau', 'gt-thoigianmothau'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !!isOpenedOrLater;
        }
    });

    // Khóa/mở khóa tổ chuyên gia và tổ thẩm định
    if (isOpenedOrLater) {
        // Khi gói thầu đã phát hành → khóa tất cả
        document.querySelectorAll('#to-chuyengia-tbody input, #to-chuyengia-tbody select, #to-thamdinh-tbody input, #to-thamdinh-tbody select').forEach(el => {
            el.disabled = true;
        });
    } else {
        // Khi đang chỉnh sửa → chỉ cho phép checkbox; select/input phải đợi checkbox được tích
        // 1. Chỉ enable checkbox
        document.querySelectorAll('#to-chuyengia-tbody input[type="checkbox"], #to-thamdinh-tbody input[type="checkbox"]').forEach(cb => {
            cb.disabled = false;
        });
        // 2. Giữ nguyên select và input theo trạng thái checkbox — enforceSingleLeader sẽ xử lý
        document.querySelectorAll('#to-chuyengia-tbody select, #to-chuyengia-tbody input[type="text"], #to-thamdinh-tbody select, #to-thamdinh-tbody input[type="text"]').forEach(el => {
            const row = el.closest('tr');
            const cb = row ? row.querySelector('input[type="checkbox"]') : null;
            el.disabled = !(cb && cb.checked);
        });
    }

    if (!isReadOnly && !isOpenedOrLater) {
        this.enforceSingleLeader('to-chuyengia-tbody', 'tochuyengia-chucvu');
        this.enforceSingleLeader('to-thamdinh-tbody', 'tothamdinh-chucvu');
    }


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

    // ✅ FIX: Tái áp dụng logic khóa theo "Hình thức lựa chọn" SAU khi preOpeningFields đã chạy.
    // Lý do: preOpeningFields vô điều kiện set disabled = !!isOpenedOrLater cho gt-phuongthuc và gt-quatmang,
    // điều này xóa trắng trạng thái khóa mà handleHinhThucChange đã thiết lập trước đó.
    // Gọi lại handleHinhThucChange ở đây để đảm bảo logic khóa theo hình thức luôn thắng.
    if (!isReadOnly && !isOpenedOrLater && this.handleHinhThucChange) {
        this.handleHinhThucChange();
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
            if (btn) {
                btn.disabled = true;
                btn.style.display = 'none';
            }
        });
        setSubTableActionVisibility(false);
    }

    lucide.createIcons();
    this.view.openModal('modal-goithau');
}


export async function handleGoiThauSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-goithau');
    if (!this.view.validateForm(form)) return;

    const formVals = this.view.getGoiThauFormInputValues(this.model);
    if (formVals.giaGoiThau < 0) {
        await this.view.customAlert('Dữ liệu không hợp lệ', 'Giá gói thầu không được nhỏ hơn 0.', 'alert-triangle', document.getElementById('gt-giagoithau'));
        return;
    }
    // Custom validation for extensions
    const mainDongThauStr = formVals.thoiGianDongThau;

    // Helper function to parse Date from Vietnamese dd/MM/yyyy HH:mm or ISO format
    const parseDMYHM = (str) => {
        if (!str) return null;
        let cleaned = str.trim();
        if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(cleaned)) {
            return new Date(cleaned.replace(' ', 'T'));
        }
        const parts = cleaned.split(/\s+/);
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

    const id = formVals.id;
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
            inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => inputEl.focus({ preventScroll: true }), 300);
            return;
        }
    }

    const valueDate1 = document.getElementById('gt-thoigiandangtai').value;
    const valueDate2 = document.getElementById('gt-thoigiandongthau').value;
    const valueDate3 = document.getElementById('gt-thoigianmothau').value;
    const valueDate4 = document.getElementById('gt-ngayquyetdinh').value;
    const inputMoEhsdxtc = document.getElementById('gt-thoigianmoehsdxtc');
    const valueDate5 = inputMoEhsdxtc ? inputMoEhsdxtc.value : '';

    const formattedDate1 = valueDate1 ? this.model.convertDMYHMSToYMDHMS(valueDate1) : '';
    const formattedDate2 = valueDate2 ? this.model.convertDMYHMSToYMDHMS(valueDate2) : '';
    const formattedDate3 = valueDate3 ? this.model.convertDMYHMSToYMDHMS(valueDate3) : '';
    const formattedDate4 = valueDate4 ? this.model.convertDMYToYMD(valueDate4) : '';
    const formattedDate5 = valueDate5 ? this.model.convertDMYHMSToYMDHMS(valueDate5) : '';

    if (formattedDate1 && formattedDate2) {
        const dangTai = new Date(formattedDate1);
        const dongThau = new Date(formattedDate2);
        if (!isNaN(dangTai.getTime()) && !isNaN(dongThau.getTime()) && dongThau <= dangTai) {
            await this.view.customAlert('Dữ liệu không hợp lệ', 'Thời gian đóng thầu phải sau thời gian đăng tải.', 'alert-triangle', document.getElementById('gt-thoigiandongthau'));
            return;
        }
    }
    if (formattedDate2 && formattedDate3) {
        const dongThau = new Date(formattedDate2);
        const moThau = new Date(formattedDate3);
        if (!isNaN(dongThau.getTime()) && !isNaN(moThau.getTime()) && moThau < dongThau) {
            await this.view.customAlert('Dữ liệu không hợp lệ', 'Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu.', 'alert-triangle', document.getElementById('gt-thoigianmothau'));
            return;
        }
    }


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
        // Kiểm tra trùng mã phần lô
        const codes = collectedPhanLoList.map(item => item.maPhanLo ? item.maPhanLo.trim().toLowerCase() : '');
        const duplicateCodes = codes.filter((code, idx) => code !== '' && codes.indexOf(code) !== idx);
        if (duplicateCodes.length > 0) {
            let duplicateInput = null;
            const duplicateCodeValue = duplicateCodes[0];
            document.querySelectorAll('#phanlo-tbody tr').forEach(tr => {
                const inp = tr.querySelector('.pl-code-input');
                if (inp && inp.value.trim().toLowerCase() === duplicateCodeValue) {
                    duplicateInput = inp;
                }
            });

            if (duplicateInput) {
                duplicateInput.style.borderColor = 'var(--danger)';
                const clearError = () => {
                    duplicateInput.style.borderColor = '';
                    duplicateInput.removeEventListener('input', clearError);
                    duplicateInput.removeEventListener('change', clearError);
                };
                duplicateInput.addEventListener('input', clearError);
                duplicateInput.addEventListener('change', clearError);
            }

            await this.view.customAlert(
                'Mã phần lô trùng lặp',
                `Mã phần lô "${duplicateCodes[0].toUpperCase()}" bị trùng lặp. Vui lòng nhập các mã phần lô khác nhau!`,
                'alert-triangle',
                duplicateInput
            );
            return;
        }

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
        const giaGoiThau = formVals.giaGoiThau || 0;
        const totalPhanLoVal = collectedPhanLoList.reduce((sum, item) => sum + (item.giaTriPhanLo || 0), 0);
        if (giaGoiThau !== totalPhanLoVal) {
            const confirmed = await this.view.customConfirm(
                'Cảnh báo chênh lệch giá',
                `Giá gói thầu (${this.model.formatVND(giaGoiThau)} VND) khác với tổng giá trị của các phần lô (${this.model.formatVND(totalPhanLoVal)} VND).\n\nBạn có chắc chắn muốn tiếp tục lưu không?`,
                'alert-triangle'
            );
            if (!confirmed) {
                return;
            }
        }
    }

    const phuongPhapDanhGia = formVals.phuongPhapDanhGia;
    const trongSoKyThuat = formVals.trongSoKyThuat;
    const phuongThucLuaChon = formVals.phuongThucLuaChon;

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

    const selectedPlanId = formVals.keHoachId;
    const latestPlan = this.model.getLatestPlan(selectedPlanId);
    const planIdToSave = latestPlan ? latestPlan.id : selectedPlanId;

    const gtData = {
        keHoachId: planIdToSave,
        tenGoiThau: formVals.tenGoiThau,
        giaGoiThau: formVals.giaGoiThau,
        thoiGianThucHien: formVals.thoiGianThucHien,
        hinhThucLuaChon: formVals.hinhThucLuaChon,
        phuongThucLuaChon: phuongThucLuaChon,
        phuongPhapDanhGia: phuongPhapDanhGia,
        trongSoKyThuat: trongSoKyThuat,
        trangThai: formVals.trangThai,
        linhVuc: linhVuc,
        isThuoc: (linhVuc === 'Hàng hóa') ? formVals.isThuoc : 0,
        tuyChonMuaThem: formVals.tuyChonMuaThem,
        nguonVon: formVals.nguonVon,
        loaiHopDong: formVals.loaiHopDong,
        thoiGianToChuc: formVals.thoiGianToChuc,
        thoiGianBatDauToChuc: formVals.thoiGianBatDauToChuc,
        quaMang: formVals.quaMang,
        trongNuocQuocTe: formVals.trongNuocQuocTe,
        phanLo: formVals.phanLo,
        phanLoList: collectedPhanLoList,
        tuyChonMuaThemList: collectedTuyChonList,
        giaHanList: this._collectGiaHanRows(),
        yeuCauLamRoList: this._collectYeuCauLamRoRows(),
        traLoiLamRoList: this._collectTraLoiLamRoRows(),
        soQuyetDinh: formVals.soQuyetDinh,
        ngayQuyetDinh: formattedDate4,
        thoiGianDangTai: formattedDate1,
        thoiGianDongThau: formattedDate2,
        thoiGianMoThau: formattedDate3,
        thoiGianMoEhsdxtc: formattedDate5,
        toChuyenGia: toChuyenGia,
        toThamDinh: toThamDinh,
        giaTriDamBaoDuThau: (linhVuc === 'Tư vấn') ? 0 : (isPhanLo ? collectedPhanLoList.reduce((sum, item) => sum + (item.baoDamDuThau || 0), 0) : this.model.parseVND(formVals.giaTriDamBaoDuThau || '0')),
        hieuLucHsdt: formVals.hieuLucHsdt,
        hieuLucDamBaoDuThau: formVals.hieuLucDamBaoDuThau,
        tyLeBaoDamHopDong: formVals.tyLeBaoDamHopDong
    };

    if (gtData.trangThai === 'Đã có kết quả') {
        if (!isPhanLo) {
            gtData.nhaThauTrungThauId = formVals.nhaThauTrungThauId;
            gtData.giaTrungThau = formVals.giaTrungThau;
            gtData.thoiGianGoiThau = formVals.thoiGianGoiThau;
            gtData.thoiGianHopDong = formVals.thoiGianHopDong;
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

        const oldTimeDang = (oldGt && oldGt.thoiGianDangTai) ? String(oldGt.thoiGianDangTai).trim() : '';
        const newTimeDang = String(gtData.thoiGianDangTai || '').trim();

        const oldTimeDong = (oldGt && oldGt.thoiGianDongThau) ? String(oldGt.thoiGianDongThau).trim() : '';
        const newTimeDong = String(gtData.thoiGianDongThau || '').trim();

        const oldTimeMo = (oldGt && oldGt.thoiGianMoThau) ? String(oldGt.thoiGianMoThau).trim() : '';
        const newTimeMo = String(gtData.thoiGianMoThau || '').trim();

        let saveAsNewVersion = false;
        if (oldGt && oldTimeDang !== '') {
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

        if (saveAsNewVersion) {
            const rootId = oldGt.rootId || oldGt.id;
            const relatedGts = this.model.state.goithau.filter(g => (g.rootId || g.id) === rootId);
            const maxVersion = Math.max(...relatedGts.map(g => parseInt(g.phienBan) || 0));
            const nextVersion = String(maxVersion + 1).padStart(2, '0');

            relatedGts.forEach(g => { g.isLatest = 0; g.is_latest = 0; });
            const newGtId = window.generateUUID();
            finalGtId = newGtId;

            if (!this.model.state.selectedPackageVersion) {
                this.model.state.selectedPackageVersion = {};
            }
            this.model.state.selectedPackageVersion[rootId] = newGtId;

            this.model.state.goithau.push({
                id: newGtId,
                maGoiThau: inputCode,
                phienBan: nextVersion,
                isLatest: 1,
                is_latest: 1,
                rootId: rootId,
                createdAt: oldGt.createdAt || this.model.getCurrentDateTimeString(),
                created_at: oldGt.created_at || this.model.getCurrentDateTimeString(),
                updatedAt: this.model.getCurrentDateTimeString(),
                updated_at: this.model.getCurrentDateTimeString(),
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
            oldGt.updatedAt = this.model.getCurrentDateTimeString();
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
        const formEl = document.getElementById('form-goithau');
        const rebidFrom = formEl ? formEl.getAttribute('data-rebid-from') : null;
        this.model.state.goithau.push({
            id: newGtId,
            maGoiThau: inputCode,
            phienBan: '00',
            isLatest: 1,
            is_latest: 1,
            rootId: newGtId,
            createdAt: this.model.getCurrentDateTimeString(),
            created_at: this.model.getCurrentDateTimeString(),
            updatedAt: this.model.getCurrentDateTimeString(),
            updated_at: this.model.getCurrentDateTimeString(),
            isRebid: !!rebidFrom,
            rebidFromPackageId: rebidFrom || null,
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
    } else {
        await this.view.customAlert("Thành công", "Đã lưu thông tin gói thầu thành công!", "check-circle");
    }
}

export async function restoreCanceledPackage(id) {
    const gt = this.model.state.goithau.find(g => g.id === id);
    if (!gt) return;
    
    let previousState = 'Đang chấm thầu';
    if (gt.danhGiaHsdtMetadata) {
        try {
            const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
            if (parsed.cancelDetails && parsed.cancelDetails.trangThaiTruocHuy) {
                previousState = parsed.cancelDetails.trangThaiTruocHuy;
            }
        } catch(e) {}
    }
    
    const confirmed = await this.view.customConfirm(
        'Khôi phục hủy thầu',
        `Bạn có chắc chắn muốn khôi phục gói thầu "${gt.tenGoiThau}"? Trạng thái sẽ được chuyển về "${previousState}".`,
        'rotate-ccw'
    );
    if (!confirmed) return;
    
    gt.trangThai = previousState;
    this.model.persistData('goithau');
    this.view.renderGoiThauTable();
    this.autoSync();
    
    await this.view.customAlert('Thành công', 'Đã khôi phục trạng thái gói thầu thành công.', 'check-circle');
}

export async function checkAndInheritCanceledPackage(planId) {
    if (!planId) return;

    const canceledPackages = this.model.state.goithau.filter(g => 
        String(g.keHoachId) === String(planId) && 
        g.trangThai === 'Hủy thầu' && 
        g.isLatest === 1
    );

    if (canceledPackages.length === 0) return;

    let selectedCanceled = null;
    if (canceledPackages.length === 1) {
        const confirmed = await this.view.customConfirm(
            'Phát hiện gói thầu hủy',
            `Kế hoạch này chứa gói thầu đã bị hủy: "${canceledPackages[0].tenGoiThau}". Bạn có muốn lấy thông tin từ gói thầu này để đấu thầu lại không?`,
            'help-circle'
        );
        if (confirmed) {
            selectedCanceled = canceledPackages[0];
        }
    } else {
        const options = canceledPackages.map(g => ({
            value: g.id,
            label: `${this.model.getPackageBaseCode(g.maGoiThau) || ''} - ${g.tenGoiThau}`
        }));
        const selectedId = await this.view.customSelectConfirm(
            'Đấu thầu lại',
            'Kế hoạch này có nhiều gói thầu đã bị hủy. Bạn có muốn đấu thầu lại bằng cách kế thừa thông tin từ một trong các gói thầu sau không?',
            options
        );
        if (selectedId) {
            selectedCanceled = canceledPackages.find(g => g.id === selectedId);
        }
    }

    if (selectedCanceled) {
        const form = document.getElementById('form-goithau');
        if (form) {
            form.setAttribute('data-rebid-from', selectedCanceled.id);
        }

        document.getElementById('gt-ten').value = selectedCanceled.tenGoiThau || '';
        document.getElementById('gt-gia').value = this.model.formatVND(selectedCanceled.giaGoiThau);
        document.getElementById('gt-thoigian').value = selectedCanceled.thoiGianThucHien || '';
        document.getElementById('gt-hinhthuc').value = selectedCanceled.hinhThucLuaChon || '';
        document.getElementById('gt-phuongthuc').value = selectedCanceled.phuongThucLuaChon || '';
        document.getElementById('gt-linhvuc').value = selectedCanceled.linhVuc || '';

        const isThuocVal = (selectedCanceled.isThuoc === 1 || selectedCanceled.isThuoc === '1') ? '1' : '0';
        const radioToCheck = document.querySelector(`input[name="gt-goithauthuoc"][value="${isThuocVal}"]`);
        if (radioToCheck) radioToCheck.checked = true;

        document.getElementById('gt-tuychonmuathem').value = selectedCanceled.tuyChonMuaThem || 'Không';
        document.getElementById('gt-nguonvon').value = selectedCanceled.nguonVon || 'Ngân sách nhà nước';
        document.getElementById('gt-loaihopdong').value = selectedCanceled.loaiHopDong || 'Trọn gói';
        document.getElementById('gt-thoigiantochuc').value = selectedCanceled.thoiGianToChuc || '';
        document.getElementById('gt-thoigianbatdautochuc').value = selectedCanceled.thoiGianBatDauToChuc || '';
        document.getElementById('gt-quatmang').value = selectedCanceled.quaMang || 'Qua mạng';
        document.getElementById('gt-trongnuocquocte').value = selectedCanceled.trongNuocQuocTe || 'Trong nước';
        document.getElementById('gt-phanlo').value = selectedCanceled.phanLo || 'Không';

        if (typeof this._loadPhanLoRows === 'function') {
            this._loadPhanLoRows(selectedCanceled.phanLoList || []);
        }
        if (typeof this._loadTuyChonMuaThemRows === 'function') {
            this._loadTuyChonMuaThemRows(selectedCanceled.tuyChonMuaThemList || []);
        }

        const savedToChuyenGia = selectedCanceled.toChuyenGia || [];
        document.querySelectorAll('#to-chuyengia-tbody tr').forEach(row => {
            const cb = row.querySelector('input[name="tochuyengia-select"]');
            if (cb) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
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

        const savedToThamDinh = selectedCanceled.toThamDinh || [];
        document.querySelectorAll('#to-thamdinh-tbody tr').forEach(row => {
            const cb = row.querySelector('input[name="tothamdinh-select"]');
            if (cb) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        });
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
        document.getElementById('gt-phuongphapdanhgia').value = selectedCanceled.phuongPhapDanhGia || '';
        if (this.updateTrongSoKyThuatVisibility) {
            this.updateTrongSoKyThuatVisibility();
        }
        document.getElementById('gt-trongsokythuat').value = (selectedCanceled.trongSoKyThuat !== undefined && selectedCanceled.trongSoKyThuat !== null) ? selectedCanceled.trongSoKyThuat : '';

        if (this.handleLinhVucChange) this.handleLinhVucChange();
        if (this.handleHinhThucChange) this.handleHinhThucChange();
        if (this.handleQuaMangChange) this.handleQuaMangChange();
        if (this.handlePhanLoChange) this.handlePhanLoChange();
        if (this.handleTuyChonMuaThemChange) this.handleTuyChonMuaThemChange();

        this.updatePackageFieldsVisibility(false);
    }
}

export function unifyTableInputsHeight(container) {
    const parent = container || document;
    const elements = parent.querySelectorAll('.data-table .form-control, #mothau-table .form-control, #danhgiahsdt-table .form-control');
    elements.forEach(el => {
        el.style.setProperty('height', '38px', 'important');
        el.style.setProperty('box-sizing', 'border-box', 'important');
        el.style.setProperty('padding', '6px 12px', 'important');
        el.style.setProperty('font-size', '0.85rem', 'important');
        el.style.setProperty('border-radius', 'var(--radius-md)', 'important');
    });
}
