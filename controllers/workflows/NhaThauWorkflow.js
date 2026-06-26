export async function deleteNhaThau(id) {
    const nt = this.model.state.nhathau.find(n => n.id === id);
    if (!nt) return;

    // 1. Kiểm tra nhà thầu trúng thầu trực tiếp (nhà thầu độc lập hoặc tên liên danh)
    const wonPackages = this.model.state.goithau.filter(gt => gt.nhaThauTrungThauId === id);
    if (wonPackages.length > 0) {
        const codes = wonPackages.map(gt => gt.maGoiThau).join(', ');
        await this.view.customAlert(
            'Không thể xóa',
            `Không thể xóa nhà thầu này vì họ đã được công bố trúng thầu tại gói thầu: ${codes}.`,
            'x-circle'
        );
        return;
    }

    // 2. Kiểm tra nhà thầu là thành viên liên danh đã trúng thầu (trong thongtinmothau)
    const jvMemberIn = (this.model.state.thongtinmothau || []).filter(b => {
        const members = b.thanhVienLienDanh || [];
        return members.some(m =>
            (nt.maSoThue && String(m.maSoThue).toLowerCase().trim() === String(nt.maSoThue).toLowerCase().trim()) ||
            (nt.tenNhaThau && String(m.tenNhaThau).toLowerCase().trim() === String(nt.tenNhaThau).toLowerCase().trim())
        );
    });
    if (jvMemberIn.length > 0) {
        const wonJvPackages = [...new Set(jvMemberIn.map(b => {
            const gt = this.model.state.goithau.find(g => g.id === b.goiThauId);
            return gt ? (gt.maGoiThau || b.goiThauId) : b.goiThauId;
        }))].join(', ');
        await this.view.customAlert(
            'Không thể xóa',
            `Không thể xóa nhà thầu này vì họ là thành viên liên danh trong hồ sơ mở thầu của gói thầu: ${wonJvPackages}.`,
            'x-circle'
        );
        return;
    }

    // 3. Kiểm tra nhà thầu trong hợp đồng
    const inContracts = (this.model.state.hopdong || []).filter(h => h.nhaThauId === id);
    if (inContracts.length > 0) {
        const contractNos = inContracts.map(h => h.soHopDong || h.tenHopDong || h.id).join(', ');
        await this.view.customAlert(
            'Không thể xóa',
            `Không thể xóa nhà thầu này vì họ đang liên kết với hợp đồng: ${contractNos}.`,
            'x-circle'
        );
        return;
    }

    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa',
        'Bạn có chắc chắn muốn xóa thông tin nhà thầu này?',
        'trash-2'
    );
    if (confirmed) {
        this.model.state.nhathau = this.model.state.nhathau.filter(n => n.id !== id);
        await this.model.persistData('nhathau');
        this.view.renderNhaThauTable();
        await this.autoSync();
    }
}


export async function editNhaThau(id, isReadOnly = false) {
    try {
        const form = document.getElementById('form-nhathau');
        if (!form) throw new Error("Không tìm thấy form nhập nhà thầu (form-nhathau)");
        
        form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

        const verSelect = document.getElementById('nt-version-select');
        const verContainer = document.getElementById('nt-version-select-container');

        // Set form editability based on isReadOnly
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(inp => {
            if (inp.id === 'nt-version-select') {
                inp.disabled = false;
            } else {
                inp.disabled = isReadOnly;
                if (inp.tagName === 'INPUT') {
                    inp.readOnly = isReadOnly;
                }
            }
        });

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.style.display = isReadOnly ? 'none' : '';
        }
        const cancelBtn = form.querySelector('button[data-close="modal-nhathau"]');
        if (cancelBtn) {
            cancelBtn.textContent = isReadOnly ? 'Đóng' : 'Hủy';
        }

        if (id) {
            if (isReadOnly) {
                window._nhaThauViewOnly = true;
            } else {
                window._nhaThauViewOnly = false;
                this.switchTab('nhathau', 'chinhsua', true);
            }
            const titleEl = document.getElementById('modal-nhathau-title');
            if (titleEl) titleEl.textContent = isReadOnly ? 'Thông tin Nhà thầu (Chỉ xem)' : 'Cập nhật Nhà thầu';
            
            const nt = this.model.state.nhathau.find(n => n.id === id);
            if (!nt) throw new Error("Không tìm thấy dữ liệu nhà thầu với ID " + id);
            
            const idInput = document.getElementById('form-nhathau-id');
            if (idInput) idInput.value = nt.id;
            
            const maInput = document.getElementById('nt-ma');
            if (maInput) maInput.value = nt.maNhaThau || '';
            
            const tenInput = document.getElementById('nt-ten');
            if (tenInput) tenInput.value = nt.tenNhaThau || '';

            if (document.getElementById('nt-mst')) document.getElementById('nt-mst').value = nt.maSoThue || '';
            if (document.getElementById('nt-nguoidaidien')) document.getElementById('nt-nguoidaidien').value = nt.nguoiDaiDien || '';
            if (document.getElementById('nt-danhxung')) document.getElementById('nt-danhxung').value = nt.danhXung || 'Ông';
            if (document.getElementById('nt-sdt')) document.getElementById('nt-sdt').value = nt.soDienThoai || '';
            if (document.getElementById('nt-email')) document.getElementById('nt-email').value = nt.email || '';

            // Split Address
            const parts = (nt.diaChi || '').split(' | ');
            const details = parts[0] || '';
            const huyen = parts[1] || '';
            const tinh = parts[2] || '';
            if (document.getElementById('nt-diachichitiet')) document.getElementById('nt-diachichitiet').value = details;
            
            // Note: initAddressDropdowns will handle disabling appropriately if isReadOnly is true, but since we already disabled inputs above,
            // we should make sure that if it's read-only, it doesn't get re-enabled by initAddressDropdowns.
            await this.initAddressDropdowns('nt-tinh', 'nt-xa', tinh, huyen, isReadOnly);
            if (isReadOnly) {
                if (document.getElementById('nt-tinh')) document.getElementById('nt-tinh').disabled = true;
                if (document.getElementById('nt-xa')) document.getElementById('nt-xa').disabled = true;
            }

            if (document.getElementById('nt-sotaikhoan')) document.getElementById('nt-sotaikhoan').value = nt.soTaiKhoan || '';
            if (document.getElementById('nt-noimotaikhoan')) document.getElementById('nt-noimotaikhoan').value = nt.noiMoTaiKhoan || '';
            if (document.getElementById('nt-manganhang')) document.getElementById('nt-manganhang').value = nt.maNganHang || '';

            // Setup version history dropdown
            if (verSelect && verContainer) {
                verContainer.style.display = 'flex';
                const rootId = nt.rootId || nt.id;
                const versions = this.model.state.nhathau.filter(n => n.rootId === rootId || n.id === rootId);
                versions.sort((a, b) => (parseInt(a.phienBan || a.phien_ban || 0) - parseInt(b.phienBan || b.phien_ban || 0)));
                
                verSelect.innerHTML = versions.map(v => {
                    const label = this.model.getVersionLabel(v.phienBan || v.phien_ban || '00');
                    return `<option value="${v.id}" ${v.id === nt.id ? 'selected' : ''}>${label}</option>`;
                }).join('');

                verSelect.onchange = (e) => {
                    this.editNhaThau(e.target.value, isReadOnly);
                };
            }
        } else {
            window._nhaThauViewOnly = false;
            this.switchTab('nhathau', 'taomoi', true);
            const titleEl = document.getElementById('modal-nhathau-title');
            if (titleEl) titleEl.textContent = 'Thêm Nhà thầu mới';
            
            form.reset();
            if (document.getElementById('nt-diachichitiet')) document.getElementById('nt-diachichitiet').value = '';
            await this.initAddressDropdowns('nt-tinh', 'nt-xa', '', '', false);
            
            const idInput = document.getElementById('form-nhathau-id');
            if (idInput) idInput.value = '';

            if (verContainer) {
                verContainer.style.display = 'none';
            }
        }
        this.view.openModal('modal-nhathau');
    } catch (err) {
        console.error("Lỗi trong editNhaThau: ", err);
        if (this.view && typeof this.view.customAlert === 'function') {
            this.view.customAlert('Lỗi giao diện', 'Không thể mở khung nhập nhà thầu: ' + err.message, 'x-circle');
        } else {
            this.view.customAlert('Lỗi giao diện', 'Lỗi giao diện: ' + err.message, 'x-circle');
        }
    }
}


export async function handleNhaThauSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-nhathau');
    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('form-nhathau-id').value;
    const maNhaThau = document.getElementById('nt-ma').value.trim();
    const tenNhaThau = document.getElementById('nt-ten').value.trim();
    const maSoThue = document.getElementById('nt-mst').value.trim();

    // Kiểm tra trùng Mã nhà thầu (maNhaThau)
    if (maNhaThau) {
        const latestNhaThau = this.model.getLatestNhaThau();
        const dupMa = latestNhaThau.some(n =>
            n.id !== id &&
            n.rootId !== id &&
            (n.rootId || n.id) !== (this.model.state.nhathau.find(orig => orig.id === id)?.rootId || id) &&
            n.maNhaThau &&
            n.maNhaThau.trim().toLowerCase() === maNhaThau.toLowerCase()
        );
        if (dupMa) {
            const inputEl = document.getElementById('nt-ma');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Mã nhà thầu này đã tồn tại trong hệ thống. Vui lòng nhập mã khác!';
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

    // Kiểm tra trùng Mã số thuế (maSoThue)
    if (maSoThue) {
        const latestNhaThau = this.model.getLatestNhaThau();
        const dupMST = latestNhaThau.some(n =>
            n.id !== id &&
            n.rootId !== id &&
            (n.rootId || n.id) !== (this.model.state.nhathau.find(orig => orig.id === id)?.rootId || id) &&
            n.maSoThue &&
            n.maSoThue.trim().toLowerCase() === maSoThue.toLowerCase()
        );
        if (dupMST) {
            const inputEl = document.getElementById('nt-mst');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Mã số thuế này đã được đăng ký cho một nhà thầu khác trong hệ thống!';
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

    const tinhSelect = document.getElementById('nt-tinh');
    const huyenSelect = document.getElementById('nt-xa');
    const tinhName = tinhSelect.options[tinhSelect.selectedIndex]?.getAttribute('data-name') || '';
    const huyenName = huyenSelect.options[huyenSelect.selectedIndex]?.getAttribute('data-name') || '';
    const diachichitiet = document.getElementById('nt-diachichitiet').value.trim();
    const diaChiCombined = `${diachichitiet} | ${huyenName} | ${tinhName}`;

    let data = {
        maNhaThau: maNhaThau,
        tenNhaThau: tenNhaThau,
        loaiNhaThau: 'Độc lập',
        maSoThue: maSoThue,
        nguoiDaiDien: document.getElementById('nt-nguoidaidien').value.trim(),
        danhXung: document.getElementById('nt-danhxung').value,
        soDienThoai: document.getElementById('nt-sdt').value.trim(),
        email: document.getElementById('nt-email').value.trim(),
        diaChi: diaChiCombined,
        soTaiKhoan: document.getElementById('nt-sotaikhoan').value.trim(),
        noiMoTaiKhoan: document.getElementById('nt-noimotaikhoan').value.trim(),
        maNganHang: document.getElementById('nt-manganhang').value.trim()
    };

    if (id) {
        const currentNt = this.model.state.nhathau.find(n => n.id === id);
        const rootId = currentNt.rootId || currentNt.id;
        const versions = this.model.state.nhathau.filter(n => n.rootId === rootId || n.id === rootId);
        const maxVerNum = Math.max(...versions.map(v => parseInt(v.phienBan || v.phien_ban || 0)));
        const nextVerStr = String(maxVerNum + 1).padStart(2, '0');

        const isNewVersion = await this.view.customConfirm(
            'Lưu Nhà thầu',
            `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentNt.phienBan || currentNt.phien_ban || 0)})`,
            'save'
        );

        if (isNewVersion) {
            versions.forEach(n => { n.isLatest = 0; n.is_latest = 0; });
            data.id = window.generateUUID();
            data.rootId = rootId;
            data.phienBan = nextVerStr;
            data.phien_ban = nextVerStr;
            data.isLatest = 1;
            data.is_latest = 1;
            data.createdAt = currentNt.createdAt || Math.floor(Date.now() / 1000);
            data.created_at = data.createdAt;
            data.updatedAt = Math.floor(Date.now() / 1000);
            data.updated_at = data.updatedAt;
            this.model.state.nhathau.push(data);
        } else {
            data.id = id;
            data.rootId = currentNt.rootId || currentNt.id;
            data.phienBan = currentNt.phienBan || currentNt.phien_ban || '00';
            data.phien_ban = currentNt.phienBan || currentNt.phien_ban || '00';
            data.isLatest = currentNt.isLatest !== undefined ? currentNt.isLatest : 1;
            data.is_latest = currentNt.is_latest !== undefined ? currentNt.is_latest : 1;
            data.createdAt = currentNt.createdAt || Math.floor(Date.now() / 1000);
            data.created_at = data.createdAt;
            data.updatedAt = Math.floor(Date.now() / 1000);
            data.updated_at = data.updatedAt;
            const idx = this.model.state.nhathau.findIndex(n => n.id === id);
            this.model.state.nhathau[idx] = data;
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
        this.model.state.nhathau.push(data);
    }

    this.model.persistData('nhathau');
    this.view.closeModal('modal-nhathau');
    this.view.renderNhaThauTable();
    this.autoSync();
}
