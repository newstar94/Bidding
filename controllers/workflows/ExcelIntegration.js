import { authFetchDownload } from '../utils/workflow_helpers.js';
export function setupExcelImportEvents() {
    // Bind all direct download buttons
    document.querySelectorAll('.btn-download-excel-template-direct').forEach(btn => {
        if (btn._hasExcelListener) return;
        btn._hasExcelListener = true;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const type = btn.getAttribute('data-type');
            this.triggerExcelTemplateDownload(type);
        });
    });

    // Bind all direct import buttons
    document.querySelectorAll('.btn-import-excel-direct').forEach(btn => {
        if (btn._hasExcelListener) return;
        btn._hasExcelListener = true;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const type = btn.getAttribute('data-type');
            this.triggerExcelImport(type);
        });
    });

    // Bind all main tab import buttons
    document.querySelectorAll('.btn-import-excel').forEach(btn => {
        if (btn._hasExcelListener) return;
        btn._hasExcelListener = true;
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-type');
            this.triggerExcelImport(type);
        });
    });

    const fileInput = document.getElementById('excel-file-input');
    if (fileInput && !fileInput._hasExcelListener) {
        fileInput._hasExcelListener = true;
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleExcelUpload(file);
        });
    }

    const dragDropZone = document.getElementById('excel-drag-drop-zone');
    if (dragDropZone && !dragDropZone._hasExcelListener && fileInput) {
        dragDropZone._hasExcelListener = true;
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
    if (saveImportBtn && !saveImportBtn._hasExcelListener) {
        saveImportBtn._hasExcelListener = true;
        saveImportBtn.addEventListener('click', () => this.saveExcelImport());
    }

    const downloadTemplateBtn = document.getElementById('btn-download-excel-template');
    if (downloadTemplateBtn && !downloadTemplateBtn._hasExcelListener) {
        downloadTemplateBtn._hasExcelListener = true;
        downloadTemplateBtn.addEventListener('click', () => {
            const type = this._excelImportType || 'kehoach';
            authFetchDownload(`/api/export-excel-template/${type}`, `Mau_nhap_lieu_${type}.xlsx`);
        });
    }
}


export function triggerExcelImport(type) {
    if (type === 'mothau' || type === 'danhgiahsdt') {
        const select = document.getElementById(type + '-goithau-select');
        if (!select || !select.value) {
            this.view.customAlert('Chưa chọn gói thầu', 'Vui lòng chọn một gói thầu trước khi nhập file Excel!', 'alert-triangle');
            return;
        }
    }
    if (type === 'ketquaqd') {
        const select = document.getElementById('result-goithau-select') || document.getElementById('danhgiahsdt-goithau-select') || document.getElementById('mothau-goithau-select');
        this._currentResultPackageId = select ? select.value : '';
    }
    this._excelImportType = type;
    let fileInput = document.getElementById('excel-file-input-temp');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.id = 'excel-file-input-temp';
        fileInput.type = 'file';
        fileInput.accept = '.xlsx, .xls';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleExcelUpload(file);
            }
        });
    }
    fileInput.value = '';
    fileInput.click();
}


export function triggerExcelTemplateDownload(type) {
    this._excelImportType = type;
    if (type === 'mothau') {
        const select = document.getElementById('mothau-goithau-select') || document.getElementById('danhgiahsdt-goithau-select');
        const gtId = select ? select.value : '';
        if (!gtId) {
            this.view.customAlert('Chưa chọn Gói thầu', 'Vui lòng chọn gói thầu trước khi tải file mẫu!', 'alert-triangle');
            return;
        }
        const gt = this.model.state.goithau.find(g => String(g.id) === String(gtId));
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

        authFetchDownload(`/api/export-mothau-template?case_type=${caseType}&package_name=${encodeURIComponent(safeCode)}&lot_codes=${encodeURIComponent(lotCodes)}`, `Mau_Mo_Thau_${caseType}_${safeCode}.xlsx`);
    } else if (type === 'danhgiahsdt') {
        const select = document.getElementById('danhgiahsdt-goithau-select');
        const gtId = select ? select.value : '';
        if (!gtId) {
            this.view.customAlert('Chưa chọn Gói thầu', 'Vui lòng chọn gói thầu trước khi tải file mẫu!', 'alert-triangle');
            return;
        }
        const gt = this.model.state.goithau.find(g => String(g.id) === String(gtId));
        if (!gt) return;
        const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
        authFetchDownload(`/api/export-danhgiahsdt-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}&eval_type=${this.currentDanhGiaTab || 'technical'}`, `DanhGia_HSDT_${safeCode}.xlsx`);
    } else if (type === 'ketquaqd') {
        const select = document.getElementById('result-goithau-select') || document.getElementById('danhgiahsdt-goithau-select') || document.getElementById('mothau-goithau-select');
        const gtId = select ? select.value : this._currentResultPackageId;
        if (!gtId) {
            this.view.customAlert('Chưa chọn Gói thầu', 'Không tìm thấy thông tin gói thầu hiện tại!', 'alert-triangle');
            return;
        }
        const gt = this.model.state.goithau.find(g => String(g.id) === String(gtId));
        if (!gt) return;
        const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
        authFetchDownload(`/api/export-ketquaqd-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`, `KetQua_QD_${safeCode}.xlsx`);
    } else if (type === 'opening_fin') {
        const select = document.getElementById('mothau-goithau-select') || document.getElementById('danhgiahsdt-goithau-select');
        const gtId = select ? select.value : (this._currentPackageId || '');
        const gt = this.model.state.goithau.find(g => String(g.id) === String(gtId));
        if (!gt) {
            this.view.customAlert('Chưa chọn Gói thầu', 'Không tìm thấy thông tin gói thầu hiện tại!', 'alert-triangle');
            return;
        }
        const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
        authFetchDownload(`/api/export-opening-fin-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`, `Mau_Mo_Tai_Chinh_${safeCode}.xlsx`);
    } else {
        authFetchDownload(`/api/export-excel-template/${type}`, `Mau_nhap_lieu_${type}.xlsx`);
    }
}


export function openExcelImportModal(type) {
    // This modal has been removed. Do nothing.
}


export async function handleExcelUpload(file) {
    const fileInfo = document.getElementById('excel-file-info');
    if (fileInfo) {
        document.getElementById('excel-filename').textContent = file.name;
        document.getElementById('excel-filesize').textContent = (file.size / 1024).toFixed(2) + ' KB';
        fileInfo.style.display = 'flex';
    }

    if (this._excelImportType === 'opening_fin') {
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = evt.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(sheet);

                if (!json || json.length === 0) {
                    await this.view.customAlert('Thất bại', 'File Excel không có dữ liệu mở thầu tài chính!', 'alert-triangle');
                    return;
                }

                const select = document.getElementById('mothau-goithau-select') || document.getElementById('danhgiahsdt-goithau-select');
                const gtId = select ? select.value : (this._currentPackageId || '');
                const gt = this.model.state.goithau.find(g => g.id === gtId);
                if (!gt) {
                    await this.view.customAlert('Thất bại', 'Vui lòng chọn gói thầu trước khi nhập Excel!', 'alert-triangle');
                    return;
                }

                const parsedBids = json.map(row => {
                    const maNhaThau = String(row['Mã nhà thầu'] || row['Mã định danh'] || row['Mã số thuế'] || row['Mã'] || '').trim();
                    const tenNhaThau = String(row['Tên nhà thầu'] || row['Nhà thầu'] || '').trim();
                    const giaDuThauRaw = String(row['Giá dự thầu (VND)'] || row['Giá dự thầu'] || row['Giá'] || '').trim();
                    const tyLeGiamRaw = String(row['Tỷ lệ %'] || row['Tỷ lệ giảm giá (%)'] || row['Tỷ lệ'] || '0').trim();
                    const hieuLucHsdtRaw = String(row['Hiệu lực HSDT'] || row['Hiệu lực HSDT (ngày)'] || '').trim();
                    const thoiGianThucHien = String(row['Thời gian thực hiện'] || row['Thời gian TH'] || '').trim();

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
                        comment = `Không tìm thấy nhà thầu tương ứng trong danh sách mở thầu!`;
                    }

                    const giaDuThau = this.model.parseVND(giaDuThauRaw) || 0;
                    const tyLeGiamGia = parseFloat(tyLeGiamRaw.replace(/,/g, '.')) || 0;
                    const giaSauGiamGia = giaDuThau * (1 - tyLeGiamGia / 100);

                    return {
                        _valid: isValid,
                        _comment: comment,
                        id: foundBid ? foundBid.id : '',
                        maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
                        tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
                        giaDuThau,
                        tyLeGiamGia,
                        giaSauGiamGia,
                        hieuLucHsdt: parseInt(hieuLucHsdtRaw, 10) || 0,
                        thoiGianThucHien
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

                    if (this.currentDanhGiaTab === 'financial') {
                        const giaDuThauRaw = String(row['Giá dự thầu (VND)'] || row['Giá dự thầu (VND)'] || row['Giá dự thầu'] || row['Giá'] || '0').trim();
                        const tyLeGiamRaw = String(row['Tỷ lệ %'] || row['Tỷ lệ giảm giá (%)'] || row['Tỷ lệ'] || '0').trim();
                        const hieuLucHsdtRaw = String(row['Hiệu lực HSDT'] || row['Hiệu lực HSDT (ngày)'] || '').trim();
                        const thoiGianThucHien = String(row['Thời gian thực hiện'] || row['Thời gian thực hiện (ngày)'] || row['Thời gian TH'] || '').trim();
                        const lamRoTaiChinh = String(row['Làm rõ tài chính'] || '').trim();
                        const danhGiaTaiChinh = String(row['Đánh giá tài chính'] || row['Xếp hạng'] || '').trim();

                        const giaDuThau = this.model.parseVND(giaDuThauRaw) || 0;
                        const tyLeGiamGia = parseFloat(tyLeGiamRaw.replace(/,/g, '.')) || 0;
                        const giaSauGiamGia = giaDuThau * (1 - tyLeGiamGia / 100);

                        const rec = {
                            _valid: isValid,
                            _comment: comment,
                            id: foundBid ? foundBid.id : '',
                            maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
                            tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
                            giaDuThau,
                            tyLeGiamGia,
                            giaSauGiamGia,
                            hieuLucHsdt: parseInt(hieuLucHsdtRaw, 10) || 0,
                            thoiGianThucHien,
                            lamRoTaiChinh,
                            danhGiaTaiChinh
                        };
                        if (hasPhanLo) {
                            rec.maPhanLo = foundBid ? foundBid.maPhanLo : maPhanLo;
                            rec.tenPhanLo = foundBid ? foundBid.tenPhanLo : '';
                        }
                        return rec;
                    } else {
                        const danhGiaHopLe = String(row['Đánh giá hợp lệ'] || row['Đánh giá tính hợp lệ'] || row['Hợp lệ'] || '').trim();
                        const danhGiaNangLuc = String(row['Đánh giá năng lực'] || row['Đánh giá năng lực kinh nghiệm'] || row['Năng lực'] || '').trim();
                        const danhGiaKyThuat = String(row['Đánh giá kỹ thuật'] || row['Kỹ thuật'] || '').trim();
                        const danhGiaKetLuan = String(row['Kết luận'] || row['Kết quả'] || '').trim();
                        const lamRoHopLe = String(row['Làm rõ hợp lệ'] || row['Làm rõ tính hợp lệ'] || '').trim();
                        const lamRoNangLuc = String(row['Làm rõ năng lực'] || row['Làm rõ năng lực kinh nghiệm'] || '').trim();
                        const lamRoKyThuat = String(row['Làm rõ kỹ thuật'] || '').trim();
                        const lamRoTaiChinh = String(row['Làm rõ tài chính'] || '').trim();

                        const nguyenNhanKhongDatHopLe = String(row['Lý do không đạt hợp lệ'] || '').trim();
                        const nguyenNhanKhongDatNangLuc = String(row['Lý do không đạt năng lực'] || '').trim();
                        const nguyenNhanKhongDatKyThuat = String(row['Lý do không đạt kỹ thuật'] || '').trim();

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
                            lamRoTaiChinh,
                            nguyenNhanKhongDatHopLe,
                            nguyenNhanKhongDatNangLuc,
                            nguyenNhanKhongDatKyThuat
                        };
                        if (hasPhanLo) {
                            rec.maPhanLo = foundBid ? foundBid.maPhanLo : maPhanLo;
                            rec.tenPhanLo = foundBid ? foundBid.tenPhanLo : '';
                        }
                        return rec;
                    }
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
                        if (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                            const foundNt = this.model.getLatestNhaThau().find(n => 
                                (n.maNhaThau && maNhaThau && n.maNhaThau.toLowerCase() === maNhaThau.toLowerCase()) ||
                                (n.tenNhaThau && tenNhaThau && n.tenNhaThau.toLowerCase() === tenNhaThau.toLowerCase())
                            );
                            if (foundNt) {
                                isValid = true;
                                comment = 'Hợp lệ (Nhà thầu mới sẽ được thêm vào danh sách)';
                                foundBid = {
                                    id: window.generateUUID(),
                                    nhaThauId: foundNt.id,
                                    maNhaThau: foundNt.maNhaThau || foundNt.maSoThue || '',
                                    tenNhaThau: foundNt.tenNhaThau,
                                    loaiNhaThau: foundNt.loaiNhaThau || 'Độc lập',
                                    thanhVienLienDanh: foundNt.thanhVienLienDanh || []
                                };
                            } else {
                                isValid = false;
                                comment = 'Không tìm thấy nhà thầu này trong danh sách Nhà thầu của hệ thống. Vui lòng thêm nhà thầu này trước!';
                            }
                        } else {
                            isValid = false;
                            comment = `Không tìm thấy nhà thầu tương ứng trong thông tin mở thầu của gói thầu này!`;
                        }
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
            const rawRows = data.rows || data.data || [];
            const seenKeys = new Set();
            this._excelImportData = rawRows.map(row => {
                const item = row.data || row;
                let isValid = true;
                let comment = 'Hợp lệ';

                if (apiType === 'kehoach') {
                    if (!item.maKeHoach) { isValid = false; comment = 'Mã kế hoạch không được để trống'; }
                    else if (!item.tenKeHoach) { isValid = false; comment = 'Tên kế hoạch không được để trống'; }
                } else if (apiType === 'goithau') {
                    if (!item.maGoiThau) { isValid = false; comment = 'Mã gói thầu không được để trống'; }
                    else if (!item.tenGoiThau) { isValid = false; comment = 'Tên gói thầu không được để trống'; }
                } else if (apiType === 'chudautu') {
                    if (!item.maChuDauTu) { isValid = false; comment = 'Mã chủ đầu tư không được để trống'; }
                    else if (!item.tenChuDauTu) { isValid = false; comment = 'Tên chủ đầu tư không được để trống'; }
                    else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) { isValid = false; comment = 'Email không hợp lệ'; }
                } else if (apiType === 'nhathau') {
                    if (!item.maNhaThau) { isValid = false; comment = 'Mã nhà thầu không được để trống'; }
                    else if (!item.tenNhaThau) { isValid = false; comment = 'Tên nhà thầu không được để trống'; }
                    else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) { isValid = false; comment = 'Email không hợp lệ'; }
                } else if (apiType === 'chuyengia') {
                    if (!item.hoTen) { isValid = false; comment = 'Họ tên không được để trống'; }
                    else if (item.soCCCD && !/^\d{12}$/.test(String(item.soCCCD).trim())) { isValid = false; comment = 'Số CCCD phải gồm đúng 12 chữ số'; }
                    else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) { isValid = false; comment = 'Email không hợp lệ'; }
                } else if (apiType === 'hopdong') {
                    if (!item.soHopDong) { isValid = false; comment = 'Số hợp đồng không được để trống'; }
                    else if (!item.tenHopDong) { isValid = false; comment = 'Tên hợp đồng không được để trống'; }
                }

                // Tiến hành kiểm tra trùng lặp nếu định dạng cơ bản đã hợp lệ
                if (isValid) {
                    let uniqueKey = '';
                    let dbExists = false;
                    let fileDuplicate = false;

                    if (apiType === 'kehoach') {
                        uniqueKey = String(item.maKeHoach || '').trim().toLowerCase();
                        if (uniqueKey) {
                            fileDuplicate = seenKeys.has('kehoach_' + uniqueKey);
                            seenKeys.add('kehoach_' + uniqueKey);
                            dbExists = (this.model.state.kehoach || []).some(k => 
                                (k.isLatest === 1 || k.is_latest === 1) && 
                                String(k.maKeHoach || '').trim().toLowerCase() === uniqueKey
                            );
                        }
                    } else if (apiType === 'goithau') {
                        uniqueKey = String(item.maGoiThau || '').trim().toLowerCase();
                        if (uniqueKey) {
                            fileDuplicate = seenKeys.has('goithau_' + uniqueKey);
                            seenKeys.add('goithau_' + uniqueKey);
                            dbExists = (this.model.state.goithau || []).some(g => 
                                (g.isLatest === 1 || g.is_latest === 1) && 
                                String(g.maGoiThau || '').trim().toLowerCase() === uniqueKey
                            );
                        }
                    } else if (apiType === 'chudautu') {
                        const maCDT = String(item.maChuDauTu || '').trim().toLowerCase();
                        const mst = String(item.maSoThue || '').trim().toLowerCase();
                        if (maCDT) {
                            fileDuplicate = seenKeys.has('cdt_ma_' + maCDT);
                            seenKeys.add('cdt_ma_' + maCDT);
                            dbExists = (this.model.state.chudautu || []).some(c => 
                                (c.isLatest === 1 || c.is_latest === 1) && 
                                String(c.maChuDauTu || '').trim().toLowerCase() === maCDT
                            );
                        }
                        if (!fileDuplicate && !dbExists && mst) {
                            fileDuplicate = seenKeys.has('cdt_mst_' + mst);
                            seenKeys.add('cdt_mst_' + mst);
                            dbExists = (this.model.state.chudautu || []).some(c => 
                                (c.isLatest === 1 || c.is_latest === 1) && 
                                String(c.maSoThue || '').trim().toLowerCase() === mst
                            );
                        }
                    } else if (apiType === 'nhathau') {
                        const maNT = String(item.maNhaThau || '').trim().toLowerCase();
                        const mst = String(item.maSoThue || '').trim().toLowerCase();
                        if (maNT) {
                            fileDuplicate = seenKeys.has('nt_ma_' + maNT);
                            seenKeys.add('nt_ma_' + maNT);
                            dbExists = (this.model.state.nhathau || []).some(n => 
                                (n.isLatest === 1 || n.is_latest === 1) && 
                                String(n.maNhaThau || '').trim().toLowerCase() === maNT
                            );
                        }
                        if (!fileDuplicate && !dbExists && mst) {
                            fileDuplicate = seenKeys.has('nt_mst_' + mst);
                            seenKeys.add('nt_mst_' + mst);
                            dbExists = (this.model.state.nhathau || []).some(n => 
                                (n.isLatest === 1 || n.is_latest === 1) && 
                                String(n.maSoThue || '').trim().toLowerCase() === mst
                            );
                        }
                    } else if (apiType === 'chuyengia') {
                        const cccd = String(item.soCCCD || '').trim().toLowerCase();
                        const cc = String(item.soChungChi || '').trim().toLowerCase();
                        if (cccd) {
                            fileDuplicate = seenKeys.has('cg_cccd_' + cccd);
                            seenKeys.add('cg_cccd_' + cccd);
                            dbExists = (this.model.state.chuyengia || []).some(c => 
                                (c.isLatest == 1 || c.is_latest == 1 || c.isLatest === true || c.is_latest === true) &&
                                String(c.soCCCD || '').trim().toLowerCase() === cccd
                            );
                        }
                        if (!fileDuplicate && !dbExists && cc) {
                            fileDuplicate = seenKeys.has('cg_cc_' + cc);
                            seenKeys.add('cg_cc_' + cc);
                            dbExists = (this.model.state.chuyengia || []).some(c => 
                                (c.isLatest == 1 || c.is_latest == 1 || c.isLatest === true || c.is_latest === true) &&
                                String(c.soChungChi || '').trim().toLowerCase() === cc
                            );
                        }
                    } else if (apiType === 'hopdong') {
                        uniqueKey = String(item.soHopDong || '').trim().toLowerCase();
                        if (uniqueKey) {
                            fileDuplicate = seenKeys.has('hd_' + uniqueKey);
                            seenKeys.add('hd_' + uniqueKey);
                            dbExists = (this.model.state.hopdong || []).some(h => 
                                (h.isLatest === 1 || h.is_latest === 1) && 
                                String(h.soHopDong || '').trim().toLowerCase() === uniqueKey
                            );
                        }
                    }

                    if (fileDuplicate) {
                        isValid = false;
                        comment = 'Dòng trùng lặp trong file Excel đang nhập';
                    } else if (dbExists) {
                        isValid = false;
                        comment = 'Dòng đã tồn tại trong hệ thống (trùng mã định danh/CCCD/số hợp đồng)';
                    }
                }

                return {
                    ...item,
                    _valid: isValid,
                    _comment: comment
                };
            });

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

    const ensureYMD = (dateStr) => {
        if (!dateStr) return '';
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) return dateStr.substring(0, 10);
        return this.model.convertDMYToYMD ? this.model.convertDMYToYMD(dateStr) : dateStr;
    };
    const ensureYMDHMS = (dateStr) => {
        if (!dateStr) return '';
        if (dateStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)) return dateStr;
        return this.model.convertDMYHMSToYMDHMS ? this.model.convertDMYHMSToYMDHMS(dateStr) : dateStr;
    };

    const validRows = this._excelImportData.filter(r => r._valid);
    if (validRows.length === 0 && ['plan', 'kehoach', 'package', 'goithau', 'chudautu', 'nhathau', 'chuyengia', 'hopdong'].includes(type)) {
        await this.view.customAlert('Thông báo', 'Không có dòng dữ liệu nào hợp lệ để lưu vào hệ thống!', 'warning');
        return;
    }

    const invalidCount = this._excelImportData.length - validRows.length;
    if (invalidCount > 0 && validRows.length > 0) {
        const proceed = await this.view.customConfirm(
            'Phát hiện dòng lỗi / trùng lặp',
            `Có ${invalidCount} dòng dữ liệu bị lỗi hoặc đã tồn tại trong hệ thống. Bạn có muốn bỏ qua các dòng này và tiếp tục lưu ${validRows.length} dòng hợp lệ không?`,
            'alert-triangle'
        );
        if (!proceed) return;
    }

    if (type === 'plan' || type === 'kehoach') {
        const mappedData = validRows.map(row => {
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
                ngayPheDuyet: ensureYMD(row.ngayPheDuyet),
                quyetDinhPheDuyet: row.quyetDinhPheDuyet || '',
                thoiGianDangMa: row.thoiGianDangMa ? ensureYMDHMS(row.thoiGianDangMa) : ''
            };
        });
        this.model.state.kehoach.push(...mappedData);
        this.model.persistData('kehoach');
        this.view.renderKeHoachTable();
        count = mappedData.length;
    } else if (type === 'package' || type === 'goithau') {
        const latestPlans = this.model.getLatestPlans();
        const mappedData = validRows.map(row => {
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
                soQuyetDinh: row.soQuyetDinh || '',
                ngayQuyetDinh: ensureYMD(row.ngayQuyetDinh),
                thoiGianDangTai: row.thoiGianDangTai ? ensureYMDHMS(row.thoiGianDangTai) : '',
                thoiGianDongThau: row.thoiGianDongThau ? ensureYMDHMS(row.thoiGianDongThau) : '',
                thoiGianMoThau: row.thoiGianMoThau ? ensureYMDHMS(row.thoiGianMoThau) : '',
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
        const mappedData = validRows.map(row => {
            const mst = (row.maSoThue || '').trim();
            const maCdt = (row.maChuDauTu || '').trim().toLowerCase();
            const existing = this.model.state.chudautu.find(c => 
                (mst && c.maSoThue && c.maSoThue.trim() === mst) ||
                (maCdt && c.maChuDauTu && c.maChuDauTu.trim().toLowerCase() === maCdt)
            );
            const targetId = existing ? existing.id : window.generateUUID();
            return {
                id: targetId,
                rootId: targetId,
                phienBan: '00',
                phien_ban: '00',
                isLatest: 1,
                is_latest: 1,
                maChuDauTu: row.maChuDauTu || '',
                maSoThue: row.maSoThue || '',
                tenChuDauTu: row.tenChuDauTu || '',
                chucVuNguoiDungDau: row.chucVuNguoiDungDau || '',
                daiDienCdt: row.daiDienCdt || '',
                chucVuDaiDien: row.chucVuDaiDien || '',
                danhXung: row.danhXung || 'Ông',
                diaChi: row.diaChi || '',
                soDienThoai: row.soDienThoai || '',
                soTaiKhoan: row.soTaiKhoan || '',
                noiMoTaiKhoan: row.noiMoTaiKhoan || '',
                email: row.email || '',
                maQHNS: row.maQHNS || ''
            };
        });
        mappedData.forEach(item => {
            const idx = this.model.state.chudautu.findIndex(c => c.id === item.id);
            if (idx !== -1) {
                this.model.state.chudautu[idx] = item;
            } else {
                this.model.state.chudautu.push(item);
            }
        });
        this.model.persistData('chudautu');
        this.view.renderChuDauTuTable();
        count = mappedData.length;
    } else if (type === 'nhathau') {
        const mappedData = validRows.map(row => {
            const mst = (row.maSoThue || '').trim();
            const maNt = (row.maNhaThau || '').trim().toLowerCase();
            const existing = this.model.state.nhathau.find(n => 
                (mst && n.maSoThue && n.maSoThue.trim() === mst) ||
                (maNt && n.maNhaThau && n.maNhaThau.trim().toLowerCase() === maNt)
            );
            const targetId = existing ? existing.id : window.generateUUID();
            return {
                id: targetId,
                rootId: targetId,
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
                thanhVienLienDanh: existing ? existing.thanhVienLienDanh : []
            };
        });
        mappedData.forEach(item => {
            const idx = this.model.state.nhathau.findIndex(n => n.id === item.id);
            if (idx !== -1) {
                this.model.state.nhathau[idx] = item;
            } else {
                this.model.state.nhathau.push(item);
            }
        });
        this.model.persistData('nhathau');
        this.view.renderNhaThauTable();
        count = mappedData.length;
    } else if (type === 'chuyengia') {
        const mappedData = validRows.map(row => {
            const cccd = (row.soCCCD || '').trim();
            const soChungChi = (row.soChungChi || '').trim().toLowerCase();
            const existing = this.model.state.chuyengia.find(cg => 
                (cccd && cg.soCCCD && cg.soCCCD.trim() === cccd) ||
                (soChungChi && cg.soChungChi && cg.soChungChi.trim().toLowerCase() === soChungChi)
            );
            const targetId = existing ? existing.id : window.generateUUID();
            return {
                id: targetId,
                rootId: targetId,
                phienBan: '00',
                phien_ban: '00',
                isLatest: 1,
                is_latest: 1,
                hoTen: row.hoTen || '',
                soCCCD: row.soCCCD || '',
                ngayCapCCCD: ensureYMD(row.ngayCapCCCD),
                noiCapCCCD: row.noiCapCCCD || '',
                soChungChi: row.soChungChi || '',
                ngayCapChungChi: ensureYMD(row.ngayCapChungChi),
                donViCapChungChi: row.donViCapChungChi || '',
                anhChungChi: existing ? existing.anhChungChi : '',
                tenAnhChungChi: existing ? existing.tenAnhChungChi : '',
                anhChuKy: existing ? existing.anhChuKy : '',
                tenAnhChuKy: existing ? existing.tenAnhChuKy : ''
            };
        });
        mappedData.forEach(item => {
            const idx = this.model.state.chuyengia.findIndex(cg => cg.id === item.id);
            if (idx !== -1) {
                this.model.state.chuyengia[idx] = item;
            } else {
                this.model.state.chuyengia.push(item);
            }
        });
        this.model.persistData('chuyengia');
        this.view.renderChuyenGiaTable();
        count = mappedData.length;
    } else if (type === 'hopdong') {
        const mappedData = validRows.map(row => {
            const cdt = this.model.state.chudautu.find(c => c.maChuDauTu.toLowerCase() === (row.chuDauTuId || '').toLowerCase());
            const nt = this.model.state.nhathau.find(n => n.maNhaThau.toLowerCase() === (row.nhaThauId || '').toLowerCase());
            const soHd = (row.soHopDong || '').trim().toLowerCase();
            const existing = this.model.state.hopdong.find(h => h.soHopDong && h.soHopDong.trim().toLowerCase() === soHd);
            const targetId = existing ? existing.id : window.generateUUID();
            return {
                id: targetId,
                rootId: targetId,
                phienBan: '00',
                phien_ban: '00',
                isLatest: 1,
                is_latest: 1,
                tenHopDong: row.tenHopDong || '',
                soHopDong: row.soHopDong || '',
                ngayKy: ensureYMD(row.ngayKy),
                chuDauTuId: cdt ? cdt.id : '',
                nhaThauId: nt ? nt.id : '',
                giaTri: parseFloat(row.giaTri) || 0,
                loaiHopDong: row.loaiHopDong || 'Trọn gói',
                phanLoai: row.phanLoai || 'Tư vấn',
                coQdChiDinh: (row.coQdChiDinh === 'Có' || row.coQdChiDinh === 1 || row.coQdChiDinh === '1') ? 1 : 0,
                soQdChiDinh: row.soQdChiDinh || '',
                ngayQdChiDinh: ensureYMD(row.ngayQdChiDinh),
                soNgayThucHien: row.soNgayThucHien ? String(row.soNgayThucHien).trim() : '',
                goiThauIds: existing ? existing.goiThauIds : []
            };
        });
        mappedData.forEach(item => {
            const idx = this.model.state.hopdong.findIndex(h => h.id === item.id);
            if (idx !== -1) {
                this.model.state.hopdong[idx] = item;
            } else {
                this.model.state.hopdong.push(item);
            }
        });
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
                    if (this.currentDanhGiaTab === 'financial') {
                        bid.giaDuThau = row.giaDuThau || 0;
                        bid.tyLeGiamGia = row.tyLeGiamGia || 0;
                        bid.giaSauGiamGia = row.giaSauGiamGia || 0;
                        bid.hieuLucHsdt = row.hieuLucHsdt || 0;
                        bid.thoiGianThucHien = row.thoiGianThucHien || bid.thoiGianThucHien || '';
                        bid.lamRoTaiChinh = row.lamRoTaiChinh || '';
                        bid.danhGiaTaiChinh = row.danhGiaTaiChinh || '';
                    } else {
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

                        bid.nguyenNhanKhongDatHopLe = bid.danhGiaHopLe === 'Không đạt' ? (row.nguyenNhanKhongDatHopLe || '') : '';
                        bid.nguyenNhanKhongDatNangLuc = bid.danhGiaNangLuc === 'Không đạt' ? (row.nguyenNhanKhongDatNangLuc || '') : '';
                        bid.nguyenNhanKhongDatKyThuat = bid.danhGiaKyThuat === 'Không đạt' ? (row.nguyenNhanKhongDatKyThuat || '') : '';
                    }
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
                    let bid = this.model.state.thongtinmothau.find(b => b.id === row.id);
                    if (!bid && (gt.hinhThucLuaChon === 'Chỉ định thầu rút gọn' || gt.hinhThucLuaChon === 'Lựa chọn nhà thầu trong trường hợp đặc biệt')) {
                        const ntId = row.nhaThauId;
                        const latestNhaThauList = this.model.getLatestNhaThau();
                        const foundNt = latestNhaThauList.find(n => n.id === ntId);
                        
                        bid = {
                            id: row.id || window.generateUUID(),
                            goiThauId: gtId,
                            nhaThauId: ntId,
                            maNhaThau: row.maNhaThau || (foundNt ? foundNt.maNhaThau : ''),
                            tenNhaThau: row.tenNhaThau || (foundNt ? foundNt.tenNhaThau : ''),
                            loaiNhaThau: (foundNt ? foundNt.loaiNhaThau : 'Độc lập'),
                            thanhVienLienDanh: (foundNt ? foundNt.thanhVienLienDanh : []),
                            giaDuThau: gt.giaGoiThau,
                            giaSauGiamGia: gt.giaGoiThau,
                            danhGiaHopLe: 'Đạt',
                            danhGiaNangLuc: 'Đạt',
                            danhGiaKyThuat: 'Đạt',
                            danhGiaTaiChinh: 'Đạt',
                            danhGiaKetLuan: 'Đạt',
                            thoiGianThucHien: gt.thoiGianThucHien,
                            lyDoTruot: ''
                        };
                        this.model.state.thongtinmothau.push(bid);
                    }
                    if (bid) {
                        if (row.trangThai === 'Trúng thầu' || row.trangThai === 'trung') {
                            bid.lyDoTruot = '';
                        } else {
                            bid.lyDoTruot = row.lyDoTruot || 'Nhà thầu xếp hạng 1 trúng thầu';
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
    } else if (type === 'opening_fin') {
        const select = document.getElementById('mothau-goithau-select') || document.getElementById('danhgiahsdt-goithau-select');
        const gtId = select ? select.value : (this._currentPackageId || '');
        if (gtId) {
            const validRows = this._excelImportData.filter(r => r._valid);
            validRows.forEach(row => {
                const bid = this.model.state.thongtinmothau.find(b => b.id === row.id);
                if (bid) {
                    bid.giaDuThau = row.giaDuThau || 0;
                    bid.tyLeGiamGia = row.tyLeGiamGia || 0;
                    bid.giaSauGiamGia = row.giaSauGiamGia || 0;
                    bid.hieuLucHsdt = row.hieuLucHsdt || 0;
                    const gt = this.model.state.goithau.find(g => g.id === gtId);
                    const defaultDuration = gt ? (gt.thoiGianThucHien || '') : '';
                    bid.thoiGianThucHien = row.thoiGianThucHien || bid.thoiGianThucHien || defaultDuration || '';
                }
            });
            this.model.persistData('thongtinmothau');
            this.model.persistData('goithau');
            this.view.showPackageDetails(gtId);
            count = validRows.length;
        }
    }

    this.view.closeModal('modal-excel-preview');
    await this.view.customAlert('Nhập khẩu thành công', `Đã nhập khẩu thành công ${count} dòng dữ liệu vào hệ thống!`, 'check-circle');
    this.autoSync();
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
        'Content-Type': 'application/json'
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
        'Content-Type': 'application/json'
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
        'Content-Type': 'application/json'
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
                const giaTriPhanLoExcelRaw = row['Giá trị phần lô (VND)'] || row['Giá trị phần lô'] || '';
                const baoDamExcelRaw = row['Bảo đảm dự thầu (VND)'] || row['Bảo đảm dự thầu'] || row['Giá trị bảo đảm'] || '';
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


export function revalidateExcelImportData() {
    const apiType = this._excelImportType;
    if (!this._excelImportData || this._excelImportData.length === 0) return;

    const seenKeys = new Set();
    this._excelImportData.forEach(item => {
        let isValid = true;
        let comment = 'Hợp lệ';

        if (apiType === 'kehoach') {
            if (!item.maKeHoach) { isValid = false; comment = 'Mã kế hoạch không được để trống'; }
            else if (!item.tenKeHoach) { isValid = false; comment = 'Tên kế hoạch không được để trống'; }
        } else if (apiType === 'goithau') {
            if (!item.maGoiThau) { isValid = false; comment = 'Mã gói thầu không được để trống'; }
            else if (!item.tenGoiThau) { isValid = false; comment = 'Tên gói thầu không được để trống'; }
        } else if (apiType === 'chudautu') {
            if (!item.maChuDauTu) { isValid = false; comment = 'Mã chủ đầu tư không được để trống'; }
            else if (!item.tenChuDauTu) { isValid = false; comment = 'Tên chủ đầu tư không được để trống'; }
            else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) { isValid = false; comment = 'Email không hợp lệ'; }
        } else if (apiType === 'nhathau') {
            if (!item.maNhaThau) { isValid = false; comment = 'Mã nhà thầu không được để trống'; }
            else if (!item.tenNhaThau) { isValid = false; comment = 'Tên nhà thầu không được để trống'; }
            else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) { isValid = false; comment = 'Email không hợp lệ'; }
        } else if (apiType === 'chuyengia') {
            if (!item.hoTen) { isValid = false; comment = 'Họ tên không được để trống'; }
            else if (item.soCCCD && !/^\d{12}$/.test(String(item.soCCCD).trim())) { isValid = false; comment = 'Số CCCD phải gồm đúng 12 chữ số'; }
            else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) { isValid = false; comment = 'Email không hợp lệ'; }
        } else if (apiType === 'hopdong') {
            if (!item.soHopDong) { isValid = false; comment = 'Số hợp đồng không được để trống'; }
            else if (!item.tenHopDong) { isValid = false; comment = 'Tên hợp đồng không được để trống'; }
        }

        // Tiến hành kiểm tra trùng lặp nếu định dạng cơ bản đã hợp lệ
        if (isValid) {
            let uniqueKey = '';
            let dbExists = false;
            let fileDuplicate = false;

            if (apiType === 'kehoach') {
                uniqueKey = String(item.maKeHoach || '').trim().toLowerCase();
                if (uniqueKey) {
                    fileDuplicate = seenKeys.has('kehoach_' + uniqueKey);
                    seenKeys.add('kehoach_' + uniqueKey);
                    dbExists = (this.model.state.kehoach || []).some(k => 
                        (k.isLatest === 1 || k.is_latest === 1) && 
                        String(k.maKeHoach || '').trim().toLowerCase() === uniqueKey
                    );
                }
            } else if (apiType === 'goithau') {
                uniqueKey = String(item.maGoiThau || '').trim().toLowerCase();
                if (uniqueKey) {
                    fileDuplicate = seenKeys.has('goithau_' + uniqueKey);
                    seenKeys.add('goithau_' + uniqueKey);
                    dbExists = (this.model.state.goithau || []).some(g => 
                        (g.isLatest === 1 || g.is_latest === 1) && 
                        String(g.maGoiThau || '').trim().toLowerCase() === uniqueKey
                    );
                }
            } else if (apiType === 'chudautu') {
                const maCDT = String(item.maChuDauTu || '').trim().toLowerCase();
                const mst = String(item.maSoThue || '').trim().toLowerCase();
                if (maCDT) {
                    fileDuplicate = seenKeys.has('cdt_ma_' + maCDT);
                    seenKeys.add('cdt_ma_' + maCDT);
                    dbExists = (this.model.state.chudautu || []).some(c => 
                        (c.isLatest === 1 || c.is_latest === 1) && 
                        String(c.maChuDauTu || '').trim().toLowerCase() === maCDT
                    );
                }
                if (!fileDuplicate && !dbExists && mst) {
                    fileDuplicate = seenKeys.has('cdt_mst_' + mst);
                    seenKeys.add('cdt_mst_' + mst);
                    dbExists = (this.model.state.chudautu || []).some(c => 
                        (c.isLatest === 1 || c.is_latest === 1) && 
                        String(c.maSoThue || '').trim().toLowerCase() === mst
                    );
                }
            } else if (apiType === 'nhathau') {
                const maNT = String(item.maNhaThau || '').trim().toLowerCase();
                const mst = String(item.maSoThue || '').trim().toLowerCase();
                if (maNT) {
                    fileDuplicate = seenKeys.has('nt_ma_' + maNT);
                    seenKeys.add('nt_ma_' + maNT);
                    dbExists = (this.model.state.nhathau || []).some(n => 
                        (n.isLatest === 1 || n.is_latest === 1) && 
                        String(n.maNhaThau || '').trim().toLowerCase() === maNT
                    );
                }
                if (!fileDuplicate && !dbExists && mst) {
                    fileDuplicate = seenKeys.has('nt_mst_' + mst);
                    seenKeys.add('nt_mst_' + mst);
                    dbExists = (this.model.state.nhathau || []).some(n => 
                        (n.isLatest === 1 || n.is_latest === 1) && 
                        String(n.maSoThue || '').trim().toLowerCase() === mst
                    );
                }
            } else if (apiType === 'chuyengia') {
                const cccd = String(item.soCCCD || '').trim().toLowerCase();
                const cc = String(item.soChungChi || '').trim().toLowerCase();
                if (cccd) {
                    fileDuplicate = seenKeys.has('cg_cccd_' + cccd);
                    seenKeys.add('cg_cccd_' + cccd);
                    dbExists = (this.model.state.chuyengia || []).some(c => 
                        (c.isLatest === 1 || c.is_latest === 1) && 
                        String(c.soCCCD || '').trim().toLowerCase() === cccd
                    );
                }
                if (!fileDuplicate && !dbExists && cc) {
                    fileDuplicate = seenKeys.has('cg_cc_' + cc);
                    seenKeys.add('cg_cc_' + cc);
                    dbExists = (this.model.state.chuyengia || []).some(c => 
                        (c.isLatest === 1 || c.is_latest === 1) && 
                        String(c.soChungChi || '').trim().toLowerCase() === cc
                    );
                }
            } else if (apiType === 'hopdong') {
                uniqueKey = String(item.soHopDong || '').trim().toLowerCase();
                if (uniqueKey) {
                    fileDuplicate = seenKeys.has('hd_' + uniqueKey);
                    seenKeys.add('hd_' + uniqueKey);
                    dbExists = (this.model.state.hopdong || []).some(h => 
                        (h.isLatest === 1 || h.is_latest === 1) && 
                        String(h.soHopDong || '').trim().toLowerCase() === uniqueKey
                    );
                }
            }

            if (fileDuplicate) {
                isValid = false;
                comment = 'Dòng trùng lặp trong file Excel đang nhập';
            } else if (dbExists) {
                isValid = false;
                comment = 'Dòng đã tồn tại trong hệ thống (trùng mã định danh/CCCD/số hợp đồng)';
            }
        }

        item._valid = isValid;
        item._comment = comment;
    });
}
