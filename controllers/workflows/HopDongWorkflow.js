export async function deleteHopDong(id) {
    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa',
        'Bạn có chắc chắn muốn xóa hợp đồng này không?',
        'trash-2'
    );
    if (confirmed) {
        this.model.state.hopdong = this.model.state.hopdong.filter(h => h.id !== id);
        await this.model.persistData('hopdong');
        this.view.renderHopDongTable();
        await this.autoSync();
    }
}


export function editHopDong(id) {
    try {
        const form = document.getElementById('form-hopdong');
        form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

        const coQdSelect = document.getElementById('hd-coqdchidinh');
        const qdFieldsContainer = document.getElementById('hd-qdchidinh-fields');
        const soQdInput = document.getElementById('hd-soqdchidinh');
        const ngayQdInput = document.getElementById('hd-ngayqdchidinh');

        const toggleQdFields = () => {
            if (coQdSelect.value === '1') {
                qdFieldsContainer.style.display = 'block';
                soQdInput.setAttribute('required', 'required');
                ngayQdInput.setAttribute('required', 'required');
            } else {
                qdFieldsContainer.style.display = 'none';
                soQdInput.removeAttribute('required');
                ngayQdInput.removeAttribute('required');
                soQdInput.closest('.form-group')?.classList.remove('invalid');
                ngayQdInput.closest('.form-group')?.classList.remove('invalid');
            }
        };

        coQdSelect.onchange = toggleQdFields;

        const cdtSelect = document.getElementById('hd-chudautuid');
        const chudautuList = this.model.getLatestChuDauTu();
        cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' +
            chudautuList.map(c => `<option value="${c.id}" data-search="${c.maChuDauTu || ''} ${c.tenChuDauTu || ''}">${c.tenChuDauTu || ''}</option>`).join('');
        this.makeSearchableSelect(cdtSelect, 'Tìm kiếm Chủ đầu tư...');

        const ntSelect = document.getElementById('hd-nhathauid');
        const nhathauList = this.model.getLatestNhaThau();
        ntSelect.innerHTML = '<option value="">-- Chọn Nhà thầu --</option>' +
            nhathauList.map(n => `<option value="${n.id}" data-search="${n.maNhaThau || ''} ${n.tenNhaThau || ''}">${n.tenNhaThau || ''}</option>`).join('');
        this.makeSearchableSelect(ntSelect, 'Tìm kiếm Nhà thầu...');

        const khSelect = document.getElementById('hd-kehoachid');
        const planList = typeof this.model.getLatestPlans === 'function' ? this.model.getLatestPlans() : (Array.isArray(this.model.state.kehoach) ? this.model.state.kehoach : []);
        khSelect.innerHTML = '<option value="">-- Chọn Kế hoạch LCNT --</option>' +
            planList.map(kh => `<option value="${kh.id}" data-search="${kh.maKeHoach || ''} ${kh.tenKeHoach || ''}">${kh.tenKeHoach || ''}</option>`).join('');
        this.makeSearchableSelect(khSelect, 'Tìm kiếm Kế hoạch...');

        const getPlanVersionIds = (selectedPlanId) => {
            if (!selectedPlanId) return [];
            const plan = this.model.state.kehoach.find(kh => kh.id === selectedPlanId);
            if (!plan) return [];
            const rootId = plan.rootId || plan.id;
            return this.model.state.kehoach
                .filter(kh => kh.rootId === rootId || kh.id === rootId)
                .map(kh => kh.id);
        };

        const renderPackagesForPlan = (selectedPlanId, checkedIds = []) => {
            const planVersionIds = getPlanVersionIds(selectedPlanId);
            const gtContainer = document.getElementById('hd-goithau-list');
            if (!selectedPlanId) {
                gtContainer.innerHTML = '<p class="text-muted" style="font-size:0.85rem; padding: 8px 0;">Vui lòng chọn Kế hoạch LCNT để hiển thị gói thầu</p>';
                return;
            }
            const goithauList = typeof this.model.getLatestPackages === 'function' ? this.model.getLatestPackages() : (Array.isArray(this.model.state.goithau) ? this.model.state.goithau : []);
            const filteredGoithau = goithauList.filter(g => planVersionIds.includes(g.keHoachId));
            if (filteredGoithau.length === 0) {
                gtContainer.innerHTML = '<p class="text-muted" style="font-size:0.85rem; padding: 8px 0;">Kế hoạch được chọn không có gói thầu nào</p>';
            } else {
                gtContainer.innerHTML = filteredGoithau.map(g => `
                    <label class="checkbox-item" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer; font-size:0.85rem;">
                         <input type="checkbox" name="hd-goithau-checkbox" value="${g.id}" ${checkedIds.includes(g.id) ? 'checked' : ''}>
                         <span><strong>${g.maGoiThau || ''}</strong> - ${g.tenGoiThau || ''}</span>
                    </label>
                `).join('');
            }
        };

        khSelect.onchange = (e) => {
            renderPackagesForPlan(e.target.value, []);
        };

        // Setup changes handlers for versions & confirmations
        const handleCdtChange = (selectedCdtId, selectVersionId = null) => {
            const versionGroup = document.getElementById('hd-chudautu-version-group');
            const versionSelect = document.getElementById('hd-chudautu-version-select');
            const confirmContainer = document.getElementById('hd-chudautu-confirm-container');
            const confirmInfo = document.getElementById('hd-chudautu-confirm-info');

            if (!selectedCdtId) {
                if (versionGroup) versionGroup.style.display = 'none';
                if (confirmContainer) confirmContainer.style.display = 'none';
                return;
            }

            const cdt = this.model.state.chudautu.find(c => c.id === selectedCdtId);
            if (!cdt) return;

            const rootId = cdt.rootId || cdt.id;
            const versions = this.model.state.chudautu.filter(c => c.rootId === rootId || c.id === rootId);
            versions.sort((a, b) => (parseInt(b.phienBan || b.phien_ban || 0) - parseInt(a.phienBan || a.phien_ban || 0)));

            if (versionSelect && versionGroup) {
                versionSelect.innerHTML = versions.map(v => {
                    const label = this.model.getVersionLabel(v.phienBan || v.phien_ban || '00');
                    return `<option value="${v.id}">${label}</option>`;
                }).join('');
                versionGroup.style.display = 'block';

                versionSelect.onchange = (e) => {
                    const selectedVerCdt = this.model.state.chudautu.find(c => c.id === e.target.value);
                    if (selectedVerCdt && confirmContainer && confirmInfo) {
                        confirmContainer.style.display = 'block';
                        confirmInfo.innerHTML = `
                            <strong>Mã:</strong> ${selectedVerCdt.maChuDauTu || '--'}<br>
                            <strong>Tên:</strong> ${selectedVerCdt.tenChuDauTu || '--'}<br>
                            <strong>MST:</strong> ${selectedVerCdt.maSoThue || '--'}<br>
                            <strong>Người ký:</strong> ${selectedVerCdt.danhXung || 'Ông'} ${selectedVerCdt.nguoiKyQuyetDinh || '--'} (${selectedVerCdt.chucVuNguoiKy || '--'})<br>
                            <strong>Địa chỉ:</strong> ${(selectedVerCdt.diaChi || '').replace(/\s*\|\s*/g, ', ')}<br>
                            <strong>Tài khoản:</strong> ${selectedVerCdt.soTaiKhoan || '--'} tại ${selectedVerCdt.noiMoTaiKhoan || '--'}
                        `;
                    }
                };

                versionSelect.value = selectVersionId || selectedCdtId;
                versionSelect.dispatchEvent(new Event('change'));
            }
        };

        cdtSelect.onchange = (e) => {
            handleCdtChange(e.target.value);
        };

        const handleNtChange = (selectedNtId, selectVersionId = null) => {
            const versionGroup = document.getElementById('hd-nhathau-version-group');
            const versionSelect = document.getElementById('hd-nhathau-version-select');
            const confirmContainer = document.getElementById('hd-nhathau-confirm-container');
            const confirmInfo = document.getElementById('hd-nhathau-confirm-info');

            if (!selectedNtId) {
                if (versionGroup) versionGroup.style.display = 'none';
                if (confirmContainer) confirmContainer.style.display = 'none';
                return;
            }

            const nt = this.model.state.nhathau.find(n => n.id === selectedNtId);
            if (!nt) return;

            const rootId = nt.rootId || nt.id;
            const versions = this.model.state.nhathau.filter(n => n.rootId === rootId || n.id === rootId);
            versions.sort((a, b) => (parseInt(b.phienBan || b.phien_ban || 0) - parseInt(a.phienBan || a.phien_ban || 0)));

            if (versionSelect && versionGroup) {
                versionSelect.innerHTML = versions.map(v => {
                    const label = this.model.getVersionLabel(v.phienBan || v.phien_ban || '00');
                    return `<option value="${v.id}">${label}</option>`;
                }).join('');
                versionGroup.style.display = 'block';

                versionSelect.onchange = (e) => {
                    const selectedVerNt = this.model.state.nhathau.find(n => n.id === e.target.value);
                    if (selectedVerNt && confirmContainer && confirmInfo) {
                        confirmContainer.style.display = 'block';
                        const isJV = selectedVerNt.loaiNhaThau === 'Liên danh';
                        let detailsHtml = `
                            <strong>Mã:</strong> ${selectedVerNt.maNhaThau || '--'}<br>
                            <strong>Tên:</strong> ${selectedVerNt.tenNhaThau || '--'}<br>
                            <strong>MST:</strong> ${selectedVerNt.maSoThue || '--'}<br>
                            <strong>Người đại diện:</strong> ${selectedVerNt.danhXung || 'Ông'} ${selectedVerNt.nguoiDaiDien || '--'}<br>
                            <strong>Địa chỉ:</strong> ${(selectedVerNt.diaChi || '').replace(/\s*\|\s*/g, ', ')}<br>
                            <strong>Tài khoản:</strong> ${selectedVerNt.soTaiKhoan || '--'} tại ${selectedVerNt.noiMoTaiKhoan || '--'}
                        `;
                        if (isJV) {
                            const members = selectedVerNt.thanhVienLienDanh || [];
                            const memberDetails = members.map((m, idx) => `
                                <div>+ TV ${idx + 1}: ${m.tenNhaThau || '--'} (MST: ${m.maSoThue || '--'}, Đại diện: ${m.danhXung || 'Ông'} ${m.nguoiDaiDien || '--'})</div>
                            `).join('');
                            detailsHtml += `<div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
                                <strong>Thành viên Liên danh (${members.length}):</strong>
                                ${memberDetails}
                            </div>`;
                        }
                        confirmInfo.innerHTML = detailsHtml;
                    }
                };

                versionSelect.value = selectVersionId || selectedNtId;
                versionSelect.dispatchEvent(new Event('change'));
            }
        };

        ntSelect.onchange = (e) => {
            handleNtChange(e.target.value);
        };

        // Populate Chuyên viên phụ trách dropdown
        const _roleLabelMap = { super_admin: 'Super Admin / Quản lý / Chuyên viên', manager: 'Quản lý / Chuyên viên', employee: 'Chuyên viên' };
        const restoreHdEmpValue = () => {
            const empSelect = document.getElementById('hd-nhanvienphutrach');
            if (empSelect) {
                if (id) {
                    const assignment = this.model.state.assignments.find(a => a.targetId === id && a.type === 'hopdong');
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

        const _populateHdEmpDropdown = () => {
            const empDropdown = document.getElementById('hd-nhanvienphutrach');
            if (!empDropdown) return;
            const employees = Array.isArray(this.model.state.employees) ? this.model.state.employees : [];
            const optHtml = employees.map(e => {
                const roleLabel = _roleLabelMap[e.role] || e.role;
                const matchedExpert = this.model.state.chuyengia.find(cg => cg.hoTen.toLowerCase().trim() === e.name.toLowerCase().trim());
                const extraSearch = matchedExpert ? `${matchedExpert.soCCCD || ''} ${matchedExpert.soChungChi || ''}` : '';
                return `<option value="${e.id}" data-search="${e.name} ${roleLabel} ${e.email || ''} ${extraSearch}">${e.name} — ${roleLabel}${e.email ? ' (' + e.email + ')' : ''}</option>`;
            }).join('');
            empDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optHtml;
            restoreHdEmpValue();
        };

        if (!this.model.state.employees || this.model.state.employees.length === 0) {
            fetch('/api/auth/users')
                .then(r => r.json())
                .then(users => {
                    this.model.state.employees = users.map(u => ({
                        id: `user-${u.id}`, name: u.name, email: u.email || '', phone: '', role: u.role
                    }));
                    _populateHdEmpDropdown();
                })
                .catch(err => { console.error('Failed to load users:', err); _populateHdEmpDropdown(); });
        } else {
            _populateHdEmpDropdown();
        }

        // Populate Trạng thái hồ sơ giấy dropdown
        const statusSelect = document.getElementById('hd-trangthai');
        if (statusSelect) {
            const orgId = '1'; // VinaCorp
            const orgStatuses = Array.isArray(this.model.state.custompaperstatuses)
                ? this.model.state.custompaperstatuses.filter(s => s.orgId === orgId)
                : [];
            statusSelect.innerHTML = '<option value="">-- Chọn Trạng thái --</option>' +
                orgStatuses.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
        }

        if (id) {
            if (!window._preModalTab) {
                window._preModalTab = this.model.state.activetab || 'hopdong';
                window._preModalAction = this.model.state.activeaction || null;
            }
            this.switchTab('hopdong', 'chinhsua', true);
            document.getElementById('modal-hopdong-title').textContent = 'Cập nhật Hợp đồng';
            const hd = this.model.state.hopdong.find(h => h.id === id);
            document.getElementById('form-hopdong-id').value = hd.id;
            document.getElementById('hd-ten').value = hd.tenHopDong;
            document.getElementById('hd-so').value = hd.soHopDong;
            document.getElementById('hd-ngayky').value = hd.ngayKy || '';
            if (this.view.fpNgayKy) {
                this.view.fpNgayKy.setDate(hd.ngayKy || '');
            }

            // Set select values and dispatch events for searchable select and load versions
            const currentCdt = this.model.state.chudautu.find(c => c.id === hd.chuDauTuId);
            if (currentCdt) {
                const rootId = currentCdt.rootId || currentCdt.id;
                const latestCdt = chudautuList.find(c => (c.rootId || c.id) === rootId);
                if (latestCdt) {
                    cdtSelect.value = latestCdt.id;
                    cdtSelect.dispatchEvent(new Event('change'));
                    handleCdtChange(latestCdt.id, hd.chuDauTuId);
                }
            } else {
                cdtSelect.value = '';
                cdtSelect.dispatchEvent(new Event('change'));
                handleCdtChange('');
            }

            const currentNt = this.model.state.nhathau.find(n => n.id === hd.nhaThauId);
            if (currentNt) {
                const rootId = currentNt.rootId || currentNt.id;
                const latestNt = nhathauList.find(n => (n.rootId || n.id) === rootId);
                if (latestNt) {
                    ntSelect.value = latestNt.id;
                    ntSelect.dispatchEvent(new Event('change'));
                    handleNtChange(latestNt.id, hd.nhaThauId);
                }
            } else {
                ntSelect.value = '';
                ntSelect.dispatchEvent(new Event('change'));
                handleNtChange('');
            }

            document.getElementById('hd-giatri').value = this.model.formatVND(hd.giaTri);
            document.getElementById('hd-loai').value = hd.loaiHopDong || 'Trọn gói';
            document.getElementById('hd-phanloai').value = hd.phanLoai || 'Tư vấn';
            
            coQdSelect.value = hd.coQdChiDinh ? String(hd.coQdChiDinh) : '0';
            soQdInput.value = hd.soQdChiDinh || '';
            if (this.view.fpNgayQdChiDinh) {
                this.view.fpNgayQdChiDinh.setDate(hd.ngayQdChiDinh || '');
            } else {
                ngayQdInput.value = hd.ngayQdChiDinh || '';
            }
            toggleQdFields();
            
            document.getElementById('hd-songay').value = hd.soNgayThucHien || '';

            // Set Trạng thái hồ sơ giấy value
            if (statusSelect) {
                statusSelect.value = hd.trangThaiHoSo || '';
            }

            if (hd.keHoachId) {
                khSelect.value = hd.keHoachId;
                khSelect.dispatchEvent(new Event('change'));
                renderPackagesForPlan(hd.keHoachId, hd.goiThauIds || []);
            } else {
                khSelect.value = '';
                khSelect.dispatchEvent(new Event('change'));
                renderPackagesForPlan('', []);
            }

            // Setup version history dropdown
            const verSelect = document.getElementById('hd-version-select');
            const verContainer = document.getElementById('hd-version-select-container');
            if (verSelect && verContainer) {
                verContainer.style.display = 'flex';
                const rootId = hd.rootId || hd.id;
                const versions = this.model.state.hopdong.filter(h => h.rootId === rootId || h.id === rootId);
                versions.sort((a, b) => (parseInt(a.phienBan || a.phien_ban || 0) - parseInt(b.phienBan || b.phien_ban || 0)));
                verSelect.innerHTML = versions.map(v => {
                    const label = this.model.getVersionLabel(v.phienBan || v.phien_ban || '00');
                    return `<option value="${v.id}" ${v.id === hd.id ? 'selected' : ''}>${label}</option>`;
                }).join('');
                verSelect.onchange = (e) => {
                    this.editHopDong(e.target.value);
                };
            }
        } else {
            if (!window._preModalTab) {
                window._preModalTab = this.model.state.activetab || 'hopdong';
                window._preModalAction = this.model.state.activeaction || null;
            }
            this.switchTab('hopdong', 'taomoi', true);
            document.getElementById('modal-hopdong-title').textContent = 'Thêm Hợp đồng mới';
            form.reset();
            document.getElementById('hd-phanloai').value = 'Tư vấn';
            
            coQdSelect.value = '0';
            soQdInput.value = '';
            if (this.view.fpNgayQdChiDinh) {
                this.view.fpNgayQdChiDinh.clear();
            } else {
                ngayQdInput.value = '';
            }
            toggleQdFields();
            
            document.getElementById('form-hopdong-id').value = '';
            if (this.view.fpNgayKy) {
                this.view.fpNgayKy.clear();
            }
            cdtSelect.value = '';
            cdtSelect.dispatchEvent(new Event('change'));
            handleCdtChange('');

            ntSelect.value = '';
            ntSelect.dispatchEvent(new Event('change'));
            handleNtChange('');

            khSelect.value = '';
            khSelect.dispatchEvent(new Event('change'));
            renderPackagesForPlan('', []);

            const verContainer = document.getElementById('hd-version-select-container');
            if (verContainer) {
                verContainer.style.display = 'none';
            }
        }

        if (this.model.state.activerole === 'employee') {
            const empSelect = document.getElementById('hd-nhanvienphutrach');
            if (empSelect) {
                empSelect.disabled = true;
                const wrapper = empSelect.parentNode.querySelector(`.custom-select-wrapper[data-select-id="hd-nhanvienphutrach"]`);
                if (wrapper) {
                    const searchInput = wrapper.querySelector('.custom-select-search');
                    if (searchInput) {
                        searchInput.disabled = true;
                    }
                }
            }
        }

        this.view.openModal('modal-hopdong');
    } catch (err) {
        this.view.customAlert('Lỗi mở form', 'Lỗi mở modal Hợp đồng: ' + err.message, 'x-circle');
        console.error("editHopDong error:", err);
    }
}


export async function handleHopDongSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-hopdong');
    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('form-hopdong-id').value;
    const tenHopDong = document.getElementById('hd-ten').value.trim();
    const soHopDong = document.getElementById('hd-so').value.trim();
    const ngayKy = document.getElementById('hd-ngayky').value;
    const chuDauTuId = document.getElementById('hd-chudautu-version-select').value || document.getElementById('hd-chudautuid').value;
    const nhaThauId = document.getElementById('hd-nhathau-version-select').value || document.getElementById('hd-nhathauid').value;
    const keHoachId = document.getElementById('hd-kehoachid').value;
    const giaTri = this.model.parseVND(document.getElementById('hd-giatri').value);
    const loaiHopDong = document.getElementById('hd-loai').value;
    const phanLoai = document.getElementById('hd-phanloai').value;
    
    const coQdChiDinh = parseInt(document.getElementById('hd-coqdchidinh').value) || 0;
    const soQdChiDinh = coQdChiDinh ? document.getElementById('hd-soqdchidinh').value.trim() : '';
    const ngayQdChiDinh = coQdChiDinh ? document.getElementById('hd-ngayqdchidinh').value : '';
    
    const soNgayThucHien = document.getElementById('hd-songay').value.trim();
    const trangThaiHoSo = document.getElementById('hd-trangthai').value;

    // Kiểm tra trùng số hợp đồng
    if (soHopDong) {
        const dupSoHD = (this.model.state.hopdong || []).some(h =>
            h.id !== id &&
            h.soHopDong &&
            h.soHopDong.trim().toLowerCase() === soHopDong.toLowerCase()
        );
        if (dupSoHD) {
            const inputEl = document.getElementById('hd-so');
            const formGroup = inputEl?.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Số hợp đồng này đã tồn tại trong hệ thống. Vui lòng nhập số hợp đồng khác!';
                    inputEl.addEventListener('input', () => {
                        formGroup.classList.remove('invalid');
                        errText.textContent = originalErr;
                    }, { once: true });
                }
            }
            inputEl?.focus();
            return;
        }
    }

    const checkboxes = document.querySelectorAll('input[name="hd-goithau-checkbox"]:checked');
    const goiThauIds = Array.from(checkboxes).map(cb => cb.value);

    if (!Array.isArray(this.model.state.hopdong)) {
        this.model.state.hopdong = [];
    }

    let finalHdId = id;
    const assignedEmpId = document.getElementById('hd-nhanvienphutrach').value;

    let data = {
        tenHopDong,
        soHopDong,
        ngayKy,
        chuDauTuId,
        nhaThauId,
        keHoachId,
        giaTri,
        loaiHopDong,
        phanLoai,
        coQdChiDinh,
        soQdChiDinh,
        ngayQdChiDinh,
        soNgayThucHien,
        goiThauIds,
        trangThaiHoSo
    };

    if (id) {
        const currentHd = this.model.state.hopdong.find(h => h.id === id);
        const rootId = currentHd.rootId || currentHd.id;
        const versions = this.model.state.hopdong.filter(h => h.rootId === rootId || h.id === rootId);
        const maxVerNum = Math.max(...versions.map(v => parseInt(v.phienBan || v.phien_ban || 0)));
        const nextVerStr = String(maxVerNum + 1).padStart(2, '0');

        const isNewVersion = await this.view.customConfirm(
            'Lưu Hợp đồng',
            `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentHd.phienBan || currentHd.phien_ban || 0)})`,
            'save'
        );

        if (isNewVersion) {
            versions.forEach(h => { h.isLatest = 0; h.is_latest = 0; });
            data.id = window.generateUUID();
            data.rootId = rootId;
            data.phienBan = nextVerStr;
            data.phien_ban = nextVerStr;
            data.isLatest = 1;
            data.is_latest = 1;
            data.createdAt = currentHd.createdAt || Math.floor(Date.now() / 1000);
            data.created_at = data.createdAt;
            data.updatedAt = Math.floor(Date.now() / 1000);
            data.updated_at = data.updatedAt;
            this.model.state.hopdong.push(data);
            finalHdId = data.id;
        } else {
            data.id = id;
            data.rootId = currentHd.rootId || currentHd.id;
            data.phienBan = currentHd.phienBan || currentHd.phien_ban || '00';
            data.phien_ban = currentHd.phienBan || currentHd.phien_ban || '00';
            data.isLatest = currentHd.isLatest !== undefined ? currentHd.isLatest : 1;
            data.is_latest = currentHd.is_latest !== undefined ? currentHd.is_latest : 1;
            data.createdAt = currentHd.createdAt || Math.floor(Date.now() / 1000);
            data.created_at = data.createdAt;
            data.updatedAt = Math.floor(Date.now() / 1000);
            data.updated_at = data.updatedAt;
            const idx = this.model.state.hopdong.findIndex(h => h.id === id);
            this.model.state.hopdong[idx] = data;
        }
    } else {
        const newId = window.generateUUID();
        data.id = newId;
        data.rootId = newId;
        data.phienBan = '00';
        data.phien_ban = '00';
        data.isLatest = 1;
        data.is_latest = 1;
        data.createdAt = Math.floor(Date.now() / 1000);
        data.created_at = data.createdAt;
        data.updatedAt = Math.floor(Date.now() / 1000);
        data.updated_at = data.updatedAt;
        this.model.state.hopdong.push(data);
        finalHdId = newId;
    }

    if (finalHdId) {
        const oldAssignments = this.model.state.assignments.filter(a => a.targetId === finalHdId && a.type === 'hopdong');
        for (const oldA of oldAssignments) {
            await this.model.deleteRecord('assignments', oldA.id);
        }
        if (assignedEmpId) {
            await this.model.addRecord('assignments', { id: window.generateUUID(), empId: assignedEmpId, targetId: finalHdId, type: 'hopdong' });
        }
    }

    this.model.persistData('hopdong');
    if (window._preModalTab === 'hopdong-detail' && finalHdId) {
        window._preModalAction = finalHdId;
    }
    this.closeModal('modal-hopdong');
    this.view.renderHopDongTable();
    this.autoSync();
}
