/* ==========================================================================
   BiddingFlow - PartnerWorkflowController (Part of Controller split)
   ========================================================================== */

export async function deleteChuDauTu(id) {
    const hasPlans = this.model.state.kehoach.some(k => k.chuDauTuId === id);
    if (hasPlans) {
        await this.view.customAlert(
            'Không thể xóa',
            'Không thể xóa chủ đầu tư này vì có Kế hoạch Lựa chọn nhà thầu đang thuộc quyền quản lý của họ.',
            'x-circle'
        );
        return;
    }

    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa',
        'Bạn có chắc chắn muốn xóa chủ đầu tư này?',
        'trash-2'
    );
    if (confirmed) {
        this.model.state.chudautu = this.model.state.chudautu.filter(c => c.id !== id);
        this.model.persistData('chudautu');
        this.view.renderChuDauTuTable();
        this.autoSync();
    }
}

export function editChuDauTu(id) {
    const form = document.getElementById('form-chudautu');
    form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

    const verSelect = document.getElementById('cdt-version-select');
    const verContainer = document.getElementById('cdt-version-select-container');

    if (id) {
        this.switchTab('chudautu', 'chinhsua', true);
        document.getElementById('modal-chudautu-title').textContent = 'Cập nhật Chủ đầu tư';
        const cdt = this.model.state.chudautu.find(c => c.id === id);
        document.getElementById('form-chudautu-id').value = cdt.id;
        document.getElementById('cdt-ma').value = cdt.maChuDauTu;
        document.getElementById('cdt-mst').value = cdt.maSoThue || '';
        document.getElementById('cdt-ten').value = cdt.tenChuDauTu;
        document.getElementById('cdt-chucvunguoidungdau').value = cdt.chucVuNguoiDungDau || '';
        document.getElementById('cdt-nguoikyquyetdinh').value = cdt.nguoiKyQuyetDinh || '';
        document.getElementById('cdt-chucvunguoiky').value = cdt.chucVuNguoiKy || '';
        document.getElementById('cdt-danhxung').value = cdt.danhXung || 'Ông';
        
        // Split Address
        const parts = (cdt.diaChi || '').split(' | ');
        const details = parts[0] || '';
        const huyen = parts[1] || '';
        const tinh = parts[2] || '';
        document.getElementById('cdt-diachichitiet').value = details;
        this.initAddressDropdowns('cdt-tinh', 'cdt-xa', tinh, huyen);

        document.getElementById('cdt-sdt').value = cdt.soDienThoai;
        document.getElementById('cdt-sotaikhoan').value = cdt.soTaiKhoan || '';
        document.getElementById('cdt-noimotaikhoan').value = cdt.noiMoTaiKhoan || '';
        document.getElementById('cdt-email').value = cdt.email || '';
        document.getElementById('cdt-maqhns').value = cdt.maQHNS || '';
        document.getElementById('cdt-coquanchuquan').value = cdt.coQuanChuQuan || '';

        // Setup version history dropdown
        if (verSelect && verContainer) {
            verContainer.style.display = 'flex';
            const rootId = cdt.rootId || cdt.id;
            const versions = this.model.state.chudautu.filter(c => c.rootId === rootId || c.id === rootId);
            versions.sort((a, b) => (parseInt(a.phienBan || a.phien_ban || 0) - parseInt(b.phienBan || b.phien_ban || 0)));
            
            verSelect.innerHTML = versions.map(v => {
                const label = this.model.getChuDauTuVersionLabel(v.phienBan || v.phien_ban || '00');
                return `<option value="${v.id}" ${v.id === cdt.id ? 'selected' : ''}>${label}</option>`;
            }).join('');

            verSelect.onchange = (e) => {
                this.editChuDauTu(e.target.value);
            };
        }
    } else {
        this.switchTab('chudautu', 'taomoi', true);
        document.getElementById('modal-chudautu-title').textContent = 'Thêm Chủ đầu tư mới';
        form.reset();
        document.getElementById('form-chudautu-id').value = '';
        document.getElementById('cdt-coquanchuquan').value = '';
        document.getElementById('cdt-diachichitiet').value = '';
        this.initAddressDropdowns('cdt-tinh', 'cdt-xa', '', '');

        if (verContainer) {
            verContainer.style.display = 'none';
        }
    }
    this.view.openModal('modal-chudautu');
}

export async function handleChuDauTuSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-chudautu');
    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('form-chudautu-id').value;
    const maSoThue = document.getElementById('cdt-mst').value.trim();

    if (maSoThue) {
        const latestChuDauTu = this.model.getLatestChuDauTu();
        const isDuplicate = latestChuDauTu.some(c => c.maSoThue === maSoThue && (c.id !== id && c.rootId !== id && (c.rootId || c.id) !== (this.model.state.chudautu.find(orig => orig.id === id)?.rootId || id)));
        if (isDuplicate) {
            const inputEl = document.getElementById('cdt-mst');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Mã số thuế này đã tồn tại trong hệ thống. Vui lòng nhập mã số thuế khác!';
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

    const tinhSelect = document.getElementById('cdt-tinh');
    const huyenSelect = document.getElementById('cdt-xa');
    const tinhName = tinhSelect.options[tinhSelect.selectedIndex]?.getAttribute('data-name') || '';
    const huyenName = huyenSelect.options[huyenSelect.selectedIndex]?.getAttribute('data-name') || '';
    const diachichitiet = document.getElementById('cdt-diachichitiet').value.trim();
    const diaChiCombined = `${diachichitiet} | ${huyenName} | ${tinhName}`;

    let data = {
        maChuDauTu: document.getElementById('cdt-ma').value.trim(),
        maSoThue: maSoThue,
        tenChuDauTu: document.getElementById('cdt-ten').value.trim(),
        chucVuNguoiDungDau: document.getElementById('cdt-chucvunguoidungdau').value.trim(),
        nguoiKyQuyetDinh: document.getElementById('cdt-nguoikyquyetdinh').value.trim(),
        chucVuNguoiKy: document.getElementById('cdt-chucvunguoiky').value.trim(),
        danhXung: document.getElementById('cdt-danhxung').value,
        diaChi: diaChiCombined,
        soDienThoai: document.getElementById('cdt-sdt').value.trim(),
        soTaiKhoan: document.getElementById('cdt-sotaikhoan').value.trim(),
        noiMoTaiKhoan: document.getElementById('cdt-noimotaikhoan').value.trim(),
        email: document.getElementById('cdt-email').value.trim(),
        maQHNS: document.getElementById('cdt-maqhns').value.trim(),
        coQuanChuQuan: document.getElementById('cdt-coquanchuquan').value.trim()
    };

    if (id) {
        const currentCdt = this.model.state.chudautu.find(c => c.id === id);
        const rootId = currentCdt.rootId || currentCdt.id;
        const versions = this.model.state.chudautu.filter(c => c.rootId === rootId || c.id === rootId);
        const maxVerNum = Math.max(...versions.map(v => parseInt(v.phienBan || v.phien_ban || 0)));
        const nextVerStr = String(maxVerNum + 1).padStart(2, '0');

        const isNewVersion = await this.view.customConfirm(
            'Lưu Chủ đầu tư',
            `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentCdt.phienBan || currentCdt.phien_ban || 0)})`,
            'save'
        );

        if (isNewVersion) {
            versions.forEach(c => { c.isLatest = 0; c.is_latest = 0; });
            data.id = window.generateUUID();
            data.rootId = rootId;
            data.phienBan = nextVerStr;
            data.phien_ban = nextVerStr;
            data.isLatest = 1;
            data.is_latest = 1;
            data.createdAt = currentCdt.createdAt || Math.floor(Date.now() / 1000);
            data.created_at = data.createdAt;
            data.updatedAt = Math.floor(Date.now() / 1000);
            data.updated_at = data.updatedAt;
            this.model.state.chudautu.push(data);
        } else {
            data.id = id;
            data.rootId = currentCdt.rootId || currentCdt.id;
            data.phienBan = currentCdt.phienBan || currentCdt.phien_ban || '00';
            data.phien_ban = currentCdt.phienBan || currentCdt.phien_ban || '00';
            data.isLatest = currentCdt.isLatest !== undefined ? currentCdt.isLatest : 1;
            data.is_latest = currentCdt.is_latest !== undefined ? currentCdt.is_latest : 1;
            data.createdAt = currentCdt.createdAt || Math.floor(Date.now() / 1000);
            data.created_at = data.createdAt;
            data.updatedAt = Math.floor(Date.now() / 1000);
            data.updated_at = data.updatedAt;
            const idx = this.model.state.chudautu.findIndex(c => c.id === id);
            this.model.state.chudautu[idx] = data;
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
        this.model.state.chudautu.push(data);
    }

    this.model.persistData('chudautu');
    this.view.closeModal('modal-chudautu');
    this.view.renderChuDauTuTable();
    this.autoSync();

    const planModal = document.getElementById('modal-kehoach');
    if (planModal && planModal.classList.contains('active')) {
        const cdtSelect = document.getElementById('kh-chudautuid');
        if (cdtSelect) {
            cdtSelect.innerHTML = '<option value="">-- Chọn Chủ đầu tư --</option>' +
                this.model.getLatestChuDauTu().map(c => `<option value="${c.id}">${c.tenChuDauTu}</option>`).join('') +
                '<option value="__NEW_INVESTOR__" style="color: var(--primary); font-weight: 700;">+ Thêm chủ đầu tư mới</option>';
            cdtSelect.value = data.id;
        }
    }
}

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
        this.model.persistData('nhathau');
        this.view.renderNhaThauTable();
        this.autoSync();
    }
}

export function editNhaThau(id) {
    try {
        const form = document.getElementById('form-nhathau');
        if (!form) throw new Error("Không tìm thấy form nhập nhà thầu (form-nhathau)");
        
        form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

        const verSelect = document.getElementById('nt-version-select');
        const verContainer = document.getElementById('nt-version-select-container');

        if (id) {
            this.switchTab('nhathau', 'chinhsua', true);
            const titleEl = document.getElementById('modal-nhathau-title');
            if (titleEl) titleEl.textContent = 'Cập nhật Nhà thầu';
            
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
            this.initAddressDropdowns('nt-tinh', 'nt-xa', tinh, huyen);

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
                    const label = this.model.getNhaThauVersionLabel(v.phienBan || v.phien_ban || '00');
                    return `<option value="${v.id}" ${v.id === nt.id ? 'selected' : ''}>${label}</option>`;
                }).join('');

                verSelect.onchange = (e) => {
                    this.editNhaThau(e.target.value);
                };
            }
        } else {
            this.switchTab('nhathau', 'taomoi', true);
            const titleEl = document.getElementById('modal-nhathau-title');
            if (titleEl) titleEl.textContent = 'Thêm Nhà thầu mới';
            
            form.reset();
            if (document.getElementById('nt-diachichitiet')) document.getElementById('nt-diachichitiet').value = '';
            this.initAddressDropdowns('nt-tinh', 'nt-xa', '', '');
            
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

export async function deleteChuyenGia(id) {
    if (this.model.state.activerole === 'employee') {
        await this.view.customAlert('Từ chối truy cập', 'Tài khoản Chuyên viên không được phép xóa Chuyên gia khỏi hệ thống!', 'lock');
        return;
    }
    // Kiểm tra chuyên gia có trong Tổ chuyên gia hoặc Tổ thẩm định của bất kỳ gói thầu nào
    const assignedPackages = this.model.state.goithau.filter(gt => {
        const inChuyenGia = (gt.toChuyenGia || []).some(item => item.chuyenGiaId === id);
        const inThamDinh = (gt.toThamDinh || []).some(item => item.chuyenGiaId === id);
        return inChuyenGia || inThamDinh;
    });
    if (assignedPackages.length > 0) {
        const details = assignedPackages.map(gt => {
            const roles = [];
            if ((gt.toChuyenGia || []).some(item => item.chuyenGiaId === id)) roles.push('Tổ chuyên gia');
            if ((gt.toThamDinh || []).some(item => item.chuyenGiaId === id)) roles.push('Tổ thẩm định');
            return `${gt.maGoiThau || gt.tenGoiThau} (${roles.join(', ')})`;
        }).join('; ');
        await this.view.customAlert(
            'Không thể xóa',
            `Không thể xóa chuyên gia này vì họ đang tham gia: ${details}`,
            'x-circle'
        );
        return;
    }

    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa',
        'Bạn có chắc muốn xóa chuyên gia đấu thầu này khỏi hệ thống?',
        'trash-2'
    );
    if (confirmed) {
        this.model.state.chuyengia = this.model.state.chuyengia.filter(cg => cg.id !== id);
        this.model.persistData('chuyengia');
        this.view.renderChuyenGiaTable();
        this.autoSync();
    }
}

export function editChuyenGia(id) {
    if (this.model.state.activerole === 'employee') {
        this.view.customAlert('Từ chối truy cập', 'Tài khoản Chuyên viên không được phép thêm hoặc chỉnh sửa thông tin Chuyên gia!', 'lock');
        return;
    }
    const form = document.getElementById('form-chuyengia');
    form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

    const uploadZone = document.getElementById('cg-upload-zone');
    const previewContainer = document.getElementById('cg-preview-container');
    const previewImg = document.getElementById('cg-anh-preview');

    const uploadZoneChuky = document.getElementById('cg-upload-zone-chuky');
    const previewContainerChuky = document.getElementById('cg-preview-container-chuky');
    const previewImgChuky = document.getElementById('cg-anh-preview-chuky');

    previewImg.onerror = () => {
        previewContainer.style.display = 'none';
        uploadZone.style.display = 'flex';
    };

    previewImgChuky.onerror = () => {
        previewContainerChuky.style.display = 'none';
        uploadZoneChuky.style.display = 'flex';
    };

    if (id) {
        this.switchTab('chuyengia', 'chinhsua', true);
        document.getElementById('modal-chuyengia-title').textContent = 'Cập nhật Chuyên gia';
        const cg = this.model.state.chuyengia.find(c => c.id === id);
        document.getElementById('form-chuyengia-id').value = cg.id;
        document.getElementById('cg-hoten').value = cg.hoTen;

        document.getElementById('cg-socccd').value = cg.soCCCD || '';
        document.getElementById('cg-noicapcccd').value = cg.noiCapCCCD || '';
        if (this.view.fpNgayCapCCCD) {
            this.view.fpNgayCapCCCD.setDate(cg.ngayCapCCCD ? new Date(cg.ngayCapCCCD) : '');
        } else {
            document.getElementById('cg-ngaycapcccd').value = this.model.formatDate(cg.ngayCapCCCD);
        }

        document.getElementById('cg-sochungchi').value = cg.soChungChi;
        document.getElementById('cg-donvicapchungchi').value = cg.donViCapChungChi || '';
        if (this.view.fpNgayCapChungChi) {
            this.view.fpNgayCapChungChi.setDate(cg.ngayCapChungChi ? new Date(cg.ngayCapChungChi) : '');
        } else {
            document.getElementById('cg-ngaycapchungchi').value = this.model.formatDate(cg.ngayCapChungChi);
        }

        if (cg.anhChungChi) {
            this.tempChuyenGiaImageBase64 = cg.anhChungChi;
            previewImg.src = cg.anhChungChi;
            previewContainer.style.display = 'flex';
            uploadZone.style.display = 'none';
        } else {
            this.tempChuyenGiaImageBase64 = '';
            previewImg.src = '';
            previewContainer.style.display = 'none';
            uploadZone.style.display = 'flex';
        }

        if (cg.anhChuKy) {
            this.tempChuyenGiaSignatureBase64 = cg.anhChuKy;
            previewImgChuky.src = cg.anhChuKy;
            previewContainerChuky.style.display = 'flex';
            uploadZoneChuky.style.display = 'none';
        } else {
            this.tempChuyenGiaSignatureBase64 = '';
            previewImgChuky.src = '';
            previewContainerChuky.style.display = 'none';
            uploadZoneChuky.style.display = 'flex';
        }
    } else {
        this.switchTab('chuyengia', 'taomoi', true);
        document.getElementById('modal-chuyengia-title').textContent = 'Thêm Chuyên gia mới';
        form.reset();
        document.getElementById('form-chuyengia-id').value = '';

        if (this.view.fpNgayCapCCCD) this.view.fpNgayCapCCCD.clear();
        if (this.view.fpNgayCapChungChi) this.view.fpNgayCapChungChi.clear();

        this.tempChuyenGiaImageBase64 = '';
        previewImg.src = '';
        previewContainer.style.display = 'none';
        uploadZone.style.display = 'flex';

        this.tempChuyenGiaSignatureBase64 = '';
        previewImgChuky.src = '';
        previewContainerChuky.style.display = 'none';
        uploadZoneChuky.style.display = 'flex';
    }
    this.view.openModal('modal-chuyengia');
}

export function handleChuyenGiaSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-chuyengia');
    const cccdVal = document.getElementById('cg-socccd').value.trim();

    // Kiểm tra định dạng CCCD
    if (cccdVal !== '' && !/^\d{12}$/.test(cccdVal)) {
        const inputEl = document.getElementById('cg-socccd');
        const formGroup = inputEl.closest('.form-group');
        if (formGroup) {
            formGroup.classList.add('invalid');
            const errText = formGroup.querySelector('.error-text');
            if (errText) {
                const originalErr = errText.textContent;
                errText.textContent = 'Số Căn cước công dân phải gồm đúng 12 chữ số.';
                inputEl.addEventListener('input', () => {
                    formGroup.classList.remove('invalid');
                    errText.textContent = originalErr;
                }, { once: true });
            }
        }
        inputEl.focus();
        return;
    }

    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('form-chuyengia-id').value;
    const soChungChiVal = document.getElementById('cg-sochungchi').value.trim();

    // Kiểm tra trùng số CCCD
    if (cccdVal) {
        const dupCCCD = this.model.state.chuyengia.some(cg =>
            cg.id !== id &&
            cg.soCCCD &&
            cg.soCCCD.trim() === cccdVal
        );
        if (dupCCCD) {
            const inputEl = document.getElementById('cg-socccd');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Số Căn cước công dân này đã được đăng ký cho một chuyên gia khác!';
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

    // Kiểm tra trùng số chứng chỉ hành nghề
    if (soChungChiVal) {
        const dupCC = this.model.state.chuyengia.some(cg =>
            cg.id !== id &&
            cg.soChungChi &&
            cg.soChungChi.trim().toLowerCase() === soChungChiVal.toLowerCase()
        );
        if (dupCC) {
            const inputEl = document.getElementById('cg-sochungchi');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Số chứng chỉ hành nghề này đã được đăng ký cho một chuyên gia khác!';
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

    const ngayCapCCCDYMD = this.model.convertDMYToYMD(document.getElementById('cg-ngaycapcccd').value);
    const ngayCapChungChiYMD = this.model.convertDMYToYMD(document.getElementById('cg-ngaycapchungchi').value);

    const certExt = this.model.getFileExtensionFromBase64(this.tempChuyenGiaImageBase64);
    const sigExt = this.model.getFileExtensionFromBase64(this.tempChuyenGiaSignatureBase64);

    const data = {
        id: id || window.generateUUID(),
        hoTen: document.getElementById('cg-hoten').value.trim(),

        soCCCD: cccdVal,
        ngayCapCCCD: ngayCapCCCDYMD,
        noiCapCCCD: document.getElementById('cg-noicapcccd').value.trim(),

        soChungChi: soChungChiVal,
        ngayCapChungChi: ngayCapChungChiYMD,
        donViCapChungChi: document.getElementById('cg-donvicapchungchi').value.trim(),
        anhChungChi: this.tempChuyenGiaImageBase64,
        tenAnhChungChi: this.tempChuyenGiaImageBase64 ? `CC_${cccdVal}.${certExt}` : '',

        anhChuKy: this.tempChuyenGiaSignatureBase64,
        tenAnhChuKy: this.tempChuyenGiaSignatureBase64 ? `CK_${cccdVal}.${sigExt}` : ''
    };

    if (id) {
        const idx = this.model.state.chuyengia.findIndex(c => c.id === id);
        this.model.state.chuyengia[idx] = data;
    } else {
        this.model.state.chuyengia.push(data);
    }

    this.model.persistData('chuyengia');
    this.view.closeModal('modal-chuyengia');
    this.view.renderChuyenGiaTable();
    this.autoSync();
}

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
            const orgId = '1'; // VinaCorp
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
        const newId = window.generateUUID();
        this.model.state.hopdong.push({ id: newId, tenHopDong, soHopDong, ngayKy, chuDauTuId, nhaThauId, giaTri, loaiHopDong, soNgayThucHien, goiThauIds, trangThaiHoSo });
        finalHdId = newId;
    }

    if (finalHdId) {
        this.model.state.assignments = this.model.state.assignments.filter(a => a.targetId !== finalHdId || a.type !== 'hopdong');
        if (assignedEmpId) {
            this.model.state.assignments.push({ id: window.generateUUID(), empId: assignedEmpId, targetId: finalHdId, type: 'hopdong' });
        }
        this.model.persistData('assignments');
    }

    this.model.persistData('hopdong');
    this.view.closeModal('modal-hopdong');
    this.view.renderHopDongTable();
    this.autoSync();
}

export async function initAddressDropdowns(tinhSelectId, xaSelectId, currentTinhName = '', currentXaName = '') {
    const tinhSelect = document.getElementById(tinhSelectId);
    const xaSelect = document.getElementById(xaSelectId);
    if (!tinhSelect || !xaSelect) return;

    // Reset xa select and disable it
    xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
    xaSelect.disabled = true;

    // Fetch provinces if not already cached
    if (!window._vietnamProvinces) {
        try {
            const res = await fetch('https://provinces.open-api.vn/api/v2/p/');
            if (res.ok) {
                window._vietnamProvinces = await res.json();
            } else {
                console.error("Failed to fetch provinces");
                return;
            }
        } catch (err) {
            console.error("Error loading provinces:", err);
            return;
        }
    }

    // Populate Tinh dropdown
    tinhSelect.innerHTML = '<option value="">-- Chọn Tỉnh/Thành phố --</option>' +
        window._vietnamProvinces.map(p => `<option value="${p.code}" data-name="${p.name}">${p.name}</option>`).join('');

    // Select current Province if matching
    if (currentTinhName) {
        const foundProvince = window._vietnamProvinces.find(p => p.name === currentTinhName);
        if (foundProvince) {
            tinhSelect.value = foundProvince.code;
        }
    }

    const loadWards = async (provinceCode, selectWardName = '') => {
        if (!provinceCode) {
            xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
            xaSelect.disabled = true;
            return;
        }

        xaSelect.innerHTML = '<option value="">Đang tải...</option>';
        xaSelect.disabled = true;

        window._vietnamWards = window._vietnamWards || {};
        if (!window._vietnamWards[provinceCode]) {
            try {
                const res = await fetch(`https://provinces.open-api.vn/api/v2/p/${provinceCode}?depth=2`);
                if (res.ok) {
                    const data = await res.json();
                    window._vietnamWards[provinceCode] = data.wards || [];
                } else {
                    xaSelect.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
                    return;
                }
            } catch (err) {
                xaSelect.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
                return;
            }
        }

        const wards = window._vietnamWards[provinceCode];
        xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>' +
            wards.map(w => `<option value="${w.code}" data-name="${w.name}">${w.name}</option>`).join('');
        xaSelect.disabled = false;

        if (selectWardName) {
            const foundWard = wards.find(w => w.name === selectWardName);
            if (foundWard) {
                xaSelect.value = foundWard.code;
            }
        }
    };

    // Change listener
    tinhSelect.onchange = (e) => {
        loadWards(e.target.value);
    };

    // If province is already selected, trigger load of wards
    if (tinhSelect.value) {
        await loadWards(tinhSelect.value, currentXaName);
    }

    // Wrap elements into searchable dropdowns
    makeSearchableSelect(tinhSelect, 'Tìm kiếm Tỉnh/Thành phố...');
    makeSearchableSelect(xaSelect, 'Tìm kiếm Xã/Phường...');
}

/**
 * Transforms a native select into a beautiful searchable combobox
 */
export function makeSearchableSelect(select, placeholder) {
    if (!select) return;

    // Check if already initialized
    let wrapper = select.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]`);
    if (wrapper) {
        // Just refresh options
        refreshCustomOptions(select, wrapper);
        return;
    }

    // Create wrapper
    wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    wrapper.setAttribute('data-select-id', select.id);

    // Hide original select
    select.style.display = 'none';

    // Insert wrapper right after select
    select.parentNode.insertBefore(wrapper, select.nextSibling);

    // Create search input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-select-search';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.disabled = select.disabled;

    // Create toggle arrow
    const arrow = document.createElement('div');
    arrow.className = 'custom-select-arrow';
    arrow.innerHTML = '▼';

    // Create options container
    const optionsList = document.createElement('ul');
    optionsList.className = 'custom-select-options';

    wrapper.appendChild(input);
    wrapper.appendChild(arrow);
    wrapper.appendChild(optionsList);

    // Populate initial options
    refreshCustomOptions(select, wrapper);

    // Toggle dropdown visibility
    const toggleDropdown = (show) => {
        if (input.disabled) return;
        if (show === undefined) {
            wrapper.classList.toggle('open');
        } else if (show) {
            wrapper.classList.add('open');
        } else {
            wrapper.classList.remove('open');
        }

        if (wrapper.classList.contains('open')) {
            // Scroll to the selected item if any
            const selectedItem = optionsList.querySelector('.selected');
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: 'nearest' });
            }
        }
    };

    input.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown(true);
    });

    input.addEventListener('focus', () => {
        toggleDropdown(true);
        input.select();
    });

    arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    // Filtering when typing
    input.addEventListener('input', () => {
        const query = input.value.toLowerCase().trim();
        const items = optionsList.querySelectorAll('li:not(.custom-select-no-results)');
        let hasResults = false;

        items.forEach(item => {
            const val = item.getAttribute('data-value');
            const opt = Array.from(select.options).find(o => o.value === val);
            const searchAttr = opt ? opt.getAttribute('data-search') || '' : '';
            const text = (item.textContent + ' ' + searchAttr).toLowerCase();
            if (text.includes(query)) {
                item.style.display = '';
                hasResults = true;
            } else {
                item.style.display = 'none';
            }
        });

        let noResultsMsg = optionsList.querySelector('.custom-select-no-results');
        if (!hasResults) {
            if (!noResultsMsg) {
                noResultsMsg = document.createElement('li');
                noResultsMsg.className = 'custom-select-no-results';
                noResultsMsg.textContent = 'Không tìm thấy kết quả';
                optionsList.appendChild(noResultsMsg);
            }
        } else if (noResultsMsg) {
            noResultsMsg.remove();
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            toggleDropdown(false);
            // Reset input text to current selection name
            const selectedOpt = select.options[select.selectedIndex];
            input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : '';
            // Reset item list state
            optionsList.querySelectorAll('li').forEach(item => item.style.display = '');
            const noResultsMsg = optionsList.querySelector('.custom-select-no-results');
            if (noResultsMsg) noResultsMsg.remove();
        }
    });

    // Keep custom input & selection highlighted state in sync with programmatic value modifications
    select.addEventListener('change', () => {
        const selectedOpt = select.options[select.selectedIndex];
        input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : '';
        optionsList.querySelectorAll('li').forEach(li => {
            if (li.getAttribute('data-value') === select.value) {
                li.className = 'selected';
            } else {
                li.className = '';
            }
        });
    });

    // Listen to form reset events
    const parentForm = select.closest('form');
    if (parentForm) {
        parentForm.addEventListener('reset', () => {
            setTimeout(() => {
                const selectedOpt = select.options[select.selectedIndex];
                input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : '';
                optionsList.querySelectorAll('li').forEach(li => {
                    if (li.getAttribute('data-value') === (select.value || '')) {
                        li.className = 'selected';
                    } else {
                        li.className = '';
                    }
                });
            }, 0);
        });
    }

    // Observe changes inside original select (e.g. innerHTML changed or disabled status modified)
    const observer = new MutationObserver(() => {
        refreshCustomOptions(select, wrapper);
    });
    observer.observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
}

function refreshCustomOptions(select, wrapper) {
    const input = wrapper.querySelector('.custom-select-search');
    const optionsList = wrapper.querySelector('.custom-select-options');

    input.disabled = select.disabled;

    // Clear options
    optionsList.innerHTML = '';

    const options = Array.from(select.options);
    options.forEach(opt => {
        const li = document.createElement('li');
        li.textContent = opt.text;
        li.setAttribute('data-value', opt.value);

        if (opt.selected) {
            li.className = 'selected';
            input.value = opt.value ? opt.text : '';
        }

        li.addEventListener('click', (e) => {
            e.stopPropagation();
            select.value = opt.value;
            // Trigger native change event so listeners fire
            select.dispatchEvent(new Event('change', { bubbles: true }));

            // Update highlighted
            optionsList.querySelectorAll('li').forEach(item => item.classList.remove('selected'));
            li.classList.add('selected');
            input.value = opt.value ? opt.text : '';

            wrapper.classList.remove('open');
        });

        optionsList.appendChild(li);
    });
}

