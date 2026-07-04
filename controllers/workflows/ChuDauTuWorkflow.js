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
        this.model.markDeleted('chudautu', id);
        await this.model.persistData('chudautu');
        this.view.renderChuDauTuTable();
        await this.autoSync();
    }
}


export async function editChuDauTu(id) {
    const form = document.getElementById('form-chudautu');
    form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));

    if (id) {
        this.switchTab('chudautu', 'chinhsua', true);
        document.getElementById('modal-chudautu-title').textContent = 'Cập nhật Chủ đầu tư';
        const cdt = this.model.state.chudautu.find(c => c.id === id);
        document.getElementById('form-chudautu-id').value = cdt.id;
        document.getElementById('cdt-ma').value = cdt.maChuDauTu;
        document.getElementById('cdt-mst').value = cdt.maSoThue || '';
        document.getElementById('cdt-ten').value = cdt.tenChuDauTu;
        document.getElementById('cdt-chucvunguoidungdau').value = cdt.chucVuNguoiDungDau || '';
        document.getElementById('cdt-daidiencdt').value = cdt.daiDienCdt || '';
        document.getElementById('cdt-chucvudaidien').value = cdt.chucVuDaiDien || '';
        document.getElementById('cdt-danhxung').value = cdt.danhXung || 'Ông';
        
        // Split Address
        const parts = (cdt.diaChi || '').split(' | ');
        const details = parts[0] || '';
        const huyen = parts[1] || '';
        const tinh = parts[2] || '';
        document.getElementById('cdt-diachichitiet').value = details;
        await this.initAddressDropdowns('cdt-tinh', 'cdt-xa', tinh, huyen);

        document.getElementById('cdt-sdt').value = cdt.soDienThoai;
        document.getElementById('cdt-sotaikhoan').value = cdt.soTaiKhoan || '';
        document.getElementById('cdt-noimotaikhoan').value = cdt.noiMoTaiKhoan || '';
        document.getElementById('cdt-email').value = cdt.email || '';
        document.getElementById('cdt-maqhns').value = cdt.maQHNS || '';
        document.getElementById('cdt-coquanchuquan').value = cdt.coQuanChuQuan || '';
    } else {
        this.switchTab('chudautu', 'taomoi', true);
        document.getElementById('modal-chudautu-title').textContent = 'Thêm Chủ đầu tư mới';
        form.reset();
        document.getElementById('form-chudautu-id').value = '';
        document.getElementById('cdt-coquanchuquan').value = '';
        document.getElementById('cdt-diachichitiet').value = '';
        await this.initAddressDropdowns('cdt-tinh', 'cdt-xa', '', '');
    }
    this.view.openModal('modal-chudautu');
}


export async function handleChuDauTuSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('form-chudautu');
    if (!this.view.validateForm(form)) return;

    const id = document.getElementById('form-chudautu-id').value;
    const maChuDauTu = document.getElementById('cdt-ma').value.trim();
    const maSoThue = document.getElementById('cdt-mst').value.trim();

    if (maChuDauTu) {
        const latestChuDauTu = this.model.getLatestChuDauTu();
        const isDuplicate = latestChuDauTu.some(c => c.maChuDauTu === maChuDauTu && (c.id !== id && c.rootId !== id && (c.rootId || c.id) !== (this.model.state.chudautu.find(orig => orig.id === id)?.rootId || id)));
        if (isDuplicate) {
            const inputEl = document.getElementById('cdt-ma');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Mã chủ đầu tư này đã tồn tại trong hệ thống. Vui lòng nhập mã khác!';
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

    if (maSoThue) {
        const mstRegex = /^\d{10}$|^\d{13}$|^\d{10}-\d{3}$/;
        if (!mstRegex.test(maSoThue)) {
            const inputEl = document.getElementById('cdt-mst');
            const formGroup = inputEl.closest('.form-group');
            if (formGroup) {
                formGroup.classList.add('invalid');
                const errText = formGroup.querySelector('.error-text');
                if (errText) {
                    const originalErr = errText.textContent;
                    errText.textContent = 'Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số).';
                    inputEl.addEventListener('input', () => {
                        formGroup.classList.remove('invalid');
                        errText.textContent = originalErr;
                    }, { once: true });
                }
            }
            inputEl.focus();
            return;
        }

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

    const phone = document.getElementById('cdt-sdt').value.trim();
    if (phone && !/^[0-9\s+\-()]{9,15}$/.test(phone)) {
        const inputEl = document.getElementById('cdt-sdt');
        const formGroup = inputEl.closest('.form-group');
        if (formGroup) {
            formGroup.classList.add('invalid');
            const errText = formGroup.querySelector('.error-text');
            if (errText) {
                const originalErr = errText.textContent;
                errText.textContent = 'Số điện thoại không đúng định dạng (từ 9 đến 15 chữ số).';
                inputEl.addEventListener('input', () => {
                    formGroup.classList.remove('invalid');
                    errText.textContent = originalErr;
                }, { once: true });
            }
        }
        inputEl.focus();
        return;
    }

    const email = document.getElementById('cdt-email').value.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        const inputEl = document.getElementById('cdt-email');
        const formGroup = inputEl.closest('.form-group');
        if (formGroup) {
            formGroup.classList.add('invalid');
            const errText = formGroup.querySelector('.error-text');
            if (errText) {
                const originalErr = errText.textContent;
                errText.textContent = 'Email không đúng định dạng.';
                inputEl.addEventListener('input', () => {
                    formGroup.classList.remove('invalid');
                    errText.textContent = originalErr;
                }, { once: true });
            }
        }
        inputEl.focus();
        return;
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
        daiDienCdt: document.getElementById('cdt-daidiencdt').value.trim(),
        chucVuDaiDien: document.getElementById('cdt-chucvudaidien').value.trim(),
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
        const maxVerNum = Math.max(...versions.map(v => parseInt(v.phienBan || 0)));
        const nextVerStr = String(maxVerNum + 1).padStart(2, '0');

        const isNewVersion = await this.view.customConfirm(
            'Lưu Chủ đầu tư',
            `Bạn có muốn lưu các thay đổi này thành một phiên bản mới (V${maxVerNum + 1}) không? (Đồng ý để tạo phiên bản mới, Hủy để ghi đè lên phiên bản hiện tại V${parseInt(currentCdt.phienBan || 0)})`,
            'save'
        );

        if (isNewVersion) {
            versions.forEach(c => { c.isLatest = 0; });
            data.id = window.generateUUID();
            data.rootId = rootId;
            data.phienBan = nextVerStr;
            data.phienBan = nextVerStr;
            data.isLatest = 1;
            data.createdAt = currentCdt.createdAt || this.model.getCurrentDateTimeString();            data.updatedAt = this.model.getCurrentDateTimeString();            this.model.state.chudautu.push(data);
        } else {
            data.id = id;
            data.rootId = currentCdt.rootId || currentCdt.id;
            data.phienBan = currentCdt.phienBan || '00';
            data.phienBan = currentCdt.phienBan || '00';
            data.isLatest = currentCdt.isLatest !== undefined ? currentCdt.isLatest : 1;
            data.createdAt = currentCdt.createdAt || this.model.getCurrentDateTimeString();            data.updatedAt = this.model.getCurrentDateTimeString();            const idx = this.model.state.chudautu.findIndex(c => c.id === id);
            this.model.state.chudautu[idx] = data;
        }
    } else {
        const newId = window.generateUUID();
        data.id = newId;
        data.rootId = newId;
        data.phienBan = '00';
        data.phienBan = '00';
        data.isLatest = 1;
        data.createdAt = this.model.getCurrentDateTimeString();        data.updatedAt = this.model.getCurrentDateTimeString();        this.model.state.chudautu.push(data);
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
