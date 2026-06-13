/* ==========================================================================
   BiddingFlow - ContractWorkflow (Contract Business Logic)
   ========================================================================== */

import { makeSearchableSelect } from './PartnerWorkflow.js';

export async function deleteHopDong(id) {
    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa',
        'Bạn có chắc chắn muốn xóa hợp đồng này không?',
        'trash-2'
    );
    if (confirmed) {
        this.model.state.hopdong = this.model.state.hopdong.filter(h => h.id !== id);
        this.model.persistData('hopdong');
        this.view.renderHopDongTable();
        this.autoSync();
    }
}

export function editHopDong(id) {
    try {
        const form = document.getElementById('form-hopdong');
        form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

        const cdtSelect = document.getElementById('hd-chudautuid');
        const chudautuList = this.model.getLatestChuDauTu();
        cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' +
            chudautuList.map(c => `<option value="${c.id}" data-search="${c.maChuDauTu || ''} ${c.tenChuDauTu || ''}">${c.tenChuDauTu || ''}</option>`).join('');
        makeSearchableSelect(cdtSelect, 'Tìm kiếm Chủ đầu tư...');

        const ntSelect = document.getElementById('hd-nhathauid');
        const nhathauList = this.model.getLatestNhaThau();
        ntSelect.innerHTML = '<option value="">-- Chọn Nhà thầu --</option>' +
            nhathauList.map(n => `<option value="${n.id}" data-search="${n.maNhaThau || ''} ${n.tenNhaThau || ''}">${n.tenNhaThau || ''}</option>`).join('');
        makeSearchableSelect(ntSelect, 'Tìm kiếm Nhà thầu...');

        const gtContainer = document.getElementById('hd-goithau-list');
        const goithauList = typeof this.model.getLatestPackages === 'function' ? this.model.getLatestPackages() : (Array.isArray(this.model.state.goithau) ? this.model.state.goithau : []);
        if (goithauList.length === 0) {
            gtContainer.innerHTML = '<p class="text-muted" style="font-size:0.85rem; padding: 8px 0;">Chưa có gói thầu nào trong hệ thống</p>';
        } else {
            gtContainer.innerHTML = goithauList.map(g => `
                <label class="checkbox-item" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer; font-size:0.85rem;">
                     <input type="checkbox" name="hd-goithau-checkbox" value="${g.id}">
                     <span><strong>${g.maGoiThau || ''}</strong> - ${g.tenGoiThau || ''}</span>
                </label>
            `).join('');
        }

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
                    const label = this.model.getChuDauTuVersionLabel(v.phienBan || v.phien_ban || '00');
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
                    const label = this.model.getNhaThauVersionLabel(v.phienBan || v.phien_ban || '00');
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
                makeSearchableSelect(empSelect, 'Tìm kiếm Chuyên viên phụ trách...');
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
            const orgId = 'org-1'; // VinaCorp
            const orgStatuses = Array.isArray(this.model.state.custompaperstatuses)
                ? this.model.state.custompaperstatuses.filter(s => s.orgId === orgId)
                : [];
            statusSelect.innerHTML = '<option value="">-- Chọn Trạng thái --</option>' +
                orgStatuses.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
        }

        if (id) {
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
            document.getElementById('hd-songay').value = hd.soNgayThucHien || '';

            // Set Trạng thái hồ sơ giấy value
            if (statusSelect) {
                statusSelect.value = hd.trangThaiHoSo || '';
            }

            const checkboxes = document.querySelectorAll('input[name="hd-goithau-checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = (hd.goiThauIds || []).includes(cb.value);
            });
        } else {
            this.switchTab('hopdong', 'taomoi', true);
            document.getElementById('modal-hopdong-title').textContent = 'Thêm Hợp đồng mới';
            form.reset();
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

export function handleHopDongSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-hopdong');
    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('form-hopdong-id').value;
    const tenHopDong = document.getElementById('hd-ten').value.trim();
    const soHopDong = document.getElementById('hd-so').value.trim();
    const ngayKy = document.getElementById('hd-ngayky').value;
    const chuDauTuId = document.getElementById('hd-chudautu-version-select').value || document.getElementById('hd-chudautuid').value;
    const nhaThauId = document.getElementById('hd-nhathau-version-select').value || document.getElementById('hd-nhathauid').value;
    const giaTri = this.model.parseVND(document.getElementById('hd-giatri').value);
    const loaiHopDong = document.getElementById('hd-loai').value;
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

    if (id) {
        const idx = this.model.state.hopdong.findIndex(h => h.id === id);
        if (idx !== -1) {
            this.model.state.hopdong[idx] = { id, tenHopDong, soHopDong, ngayKy, chuDauTuId, nhaThauId, giaTri, loaiHopDong, soNgayThucHien, goiThauIds, trangThaiHoSo };
        }
    } else {
        const newId = 'hd-' + (this.model.state.hopdong.length > 0 ? (Math.max(...this.model.state.hopdong.map(h => parseInt(h.id.replace('hd-', '')) || 0)) + 1) : 1);
        this.model.state.hopdong.push({ id: newId, tenHopDong, soHopDong, ngayKy, chuDauTuId, nhaThauId, giaTri, loaiHopDong, soNgayThucHien, goiThauIds, trangThaiHoSo });
        finalHdId = newId;
    }

    if (finalHdId) {
        this.model.state.assignments = this.model.state.assignments.filter(a => a.targetId !== finalHdId || a.type !== 'hopdong');
        if (assignedEmpId) {
            this.model.state.assignments.push({ id: 'asm-' + window.generateUUID(), empId: assignedEmpId, targetId: finalHdId, type: 'hopdong' });
        }
        this.model.persistData('assignments');
    }

    this.model.persistData('hopdong');
    this.view.closeModal('modal-hopdong');
    this.view.renderHopDongTable();
    this.autoSync();
}
