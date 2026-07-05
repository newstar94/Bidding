function findLatestContractorByCode(latestNhaThauList, code) {
    return latestNhaThauList.find(n =>
        n.maNhaThau && n.maNhaThau.trim().toLowerCase() === String(code || '').trim().toLowerCase()
    );
}

function createIndependentContractor({ id, maNhaThau, tenNhaThau, member = {} }) {
    return {
        id,
        maNhaThau,
        tenNhaThau,
        loaiNhaThau: 'Độc lập',
        maSoThue: member.maSoThue || maNhaThau,
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
}

function ensureContractor({ model, latestNhaThauList, maNhaThau, tenNhaThau, loaiNhaThau, row }) {
    let foundNt = findLatestContractorByCode(latestNhaThauList, maNhaThau);

    if (loaiNhaThau === 'Độc lập') {
        if (!foundNt) {
            foundNt = createIndependentContractor({
                id: window.generateUUID(),
                maNhaThau,
                tenNhaThau
            });
            model.state.nhathau.push(foundNt);
            model.persistData('nhathau');
            latestNhaThauList.push(foundNt);
        } else if (foundNt.loaiNhaThau !== 'Độc lập') {
            const dbNt = model.state.nhathau.find(n => n.id === foundNt.id);
            if (dbNt) {
                dbNt.loaiNhaThau = 'Độc lập';
                model.persistData('nhathau');
            }
        }
        return foundNt;
    }

    if (!foundNt) {
        foundNt = createIndependentContractor({
            id: window.generateUUID(),
            maNhaThau,
            tenNhaThau: row._leadMemberName || (`Thành viên đứng đầu ${maNhaThau}`)
        });
        model.state.nhathau.push(foundNt);
        model.persistData('nhathau');
        latestNhaThauList.push(foundNt);
    } else if (row._leadMemberName) {
        const dbNt = model.state.nhathau.find(n => n.id === foundNt.id);
        if (dbNt) {
            dbNt.tenNhaThau = row._leadMemberName;
            model.persistData('nhathau');
        }
    }

    (row._thanhVienLienDanh || []).forEach(member => {
        if (!member.maSoThue) return;
        let subNt = findLatestContractorByCode(latestNhaThauList, member.maSoThue);
        if (!subNt) {
            subNt = createIndependentContractor({
                id: window.generateUUID(),
                maNhaThau: member.maSoThue,
                tenNhaThau: member.tenNhaThau,
                member
            });
            model.state.nhathau.push(subNt);
            model.persistData('nhathau');
            latestNhaThauList.push(subNt);
        }
    });

    return foundNt;
}

function collectJvMembers(row, foundNt, maNhaThau) {
    const bidJvMembers = [{
        tenNhaThau: row._leadMemberName || foundNt.tenNhaThau || `Thành viên đứng đầu ${maNhaThau}`,
        maSoThue: foundNt ? (foundNt.maSoThue || '') : '',
        vaiTro: 'Đứng đầu liên danh'
    }];

    const subMembers = (row._thanhVienLienDanh || []).filter(m =>
        String(m.maSoThue).toLowerCase().trim() !== String(maNhaThau).toLowerCase().trim()
        && m.vaiTro !== 'Đứng đầu liên danh'
    );
    subMembers.forEach(m => {
        bidJvMembers.push({
            tenNhaThau: m.tenNhaThau,
            maSoThue: m.maSoThue,
            vaiTro: 'Thành viên liên danh'
        });
    });

    return bidJvMembers;
}

export function validateOpeningRows(rows) {
    const invalidInputs = [];
    let hasInvalid = false;

    rows.forEach(row => {
        const inputMa = row.querySelector('.mt-ma-nha-thau');
        const inputTen = row.querySelector('.mt-ten-nha-thau');
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
            row.classList.add('invalid');
        } else {
            row.classList.remove('invalid');
        }
    });

    return { valid: !hasInvalid, invalidInputs };
}

export function collectOpeningBidsFromRows({ rows, gtId, model, isDirectOrSpecial }) {
    const latestNhaThauList = model.getLatestNhaThau();

    return rows.map(row => {
        const id = row.getAttribute('data-id');
        const maNhaThau = row.querySelector('.mt-ma-nha-thau')?.value.trim() || '';
        const tenNhaThau = row.querySelector('.mt-ten-nha-thau')?.value.trim() || '';
        const loaiNhaThau = row.querySelector('.mt-loai-nha-thau')?.value || 'Độc lập';
        const foundNt = ensureContractor({ model, latestNhaThauList, maNhaThau, tenNhaThau, loaiNhaThau, row });
        const resolvedTenNhaThau = loaiNhaThau === 'Liên danh'
            ? tenNhaThau
            : (foundNt ? foundNt.tenNhaThau : tenNhaThau);
        const tyLeGiamGiaRaw = row.querySelector('.mt-ty-le-giam-gia')?.value || '0';
        const bidJvMembers = loaiNhaThau === 'Liên danh'
            ? collectJvMembers(row, foundNt, maNhaThau)
            : [];

        return {
            id,
            goiThauId: gtId,
            nhaThauId: foundNt.id,
            maPhanLo: row.querySelector('.mt-ma-phan-lo')?.value || '',
            tenPhanLo: row.querySelector('.mt-ten-phan-lo')?.value.trim() || '',
            maDinhDanh: row.querySelector('.mt-ma-dinh-danh')?.value.trim() || '',
            giaDuThau: model.parseVND(row.querySelector('.mt-gia-du-thau')?.value || ''),
            damBaoDuThau: model.parseVND(row.querySelector('.mt-dam-bao-du-thau')?.value || ''),
            hieuLucDamBao: row.querySelector('.mt-hieu-luc-dam-bao')?.value.trim() || '',
            hieuLucHsdxt: row.querySelector('.mt-hieu-luc-hsdxt')?.value.trim() || '',
            tyLeGiamGia: parseFloat(tyLeGiamGiaRaw.replace(/,/g, '.')) || 0,
            giaSauGiamGia: model.parseVND(row.querySelector('.mt-gia-sau-giam-gia')?.value || ''),
            hieuLucHsdt: parseInt(row.querySelector('.mt-hieu-luc-hsdt')?.value || '0', 10),
            giaTriDamBao: model.parseVND(row.querySelector('.mt-gia-tri-dam-bao')?.value || ''),
            hieuLucBaoDamNgay: parseInt(row.querySelector('.mt-hieu-luc-bao-dam-ngay')?.value || '0', 10),
            thoiGianThucHien: row.querySelector('.mt-thoi-gian-thuc-hien')?.value.trim() || '',
            thoiGianThucHienHopDong: row.querySelector('.mt-thoi-gian-thuc-hien-hop-dong')?.value.trim() || '',
            tenNhaThau: resolvedTenNhaThau,
            loaiNhaThau,
            thanhVienLienDanh: bidJvMembers,
            danhGiaHopLe: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaNangLuc: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaKyThuat: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaKetLuan: isDirectOrSpecial ? 'Đạt' : '',
            danhGiaTaiChinh: isDirectOrSpecial ? 'Xếp hạng 1' : ''
        };
    });
}
