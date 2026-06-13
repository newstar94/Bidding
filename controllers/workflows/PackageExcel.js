/* ==========================================================================
   BiddingFlow - PackageExcel Workflow Component
   ========================================================================== */

export function setupExcelImportEvents() {
    // Bind all main tab import buttons
    document.querySelectorAll('.btn-import-excel').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-type');
            this.openExcelImportModal(type);
        });
    });

    const fileInput = document.getElementById('excel-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleExcelUpload(file);
        });
    }

    const dragDropZone = document.getElementById('excel-drag-drop-zone');
    if (dragDropZone && fileInput) {
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
    if (saveImportBtn) {
        saveImportBtn.addEventListener('click', () => this.saveExcelImport());
    }

    const downloadTemplateBtn = document.getElementById('btn-download-excel-template');
    if (downloadTemplateBtn) {
        downloadTemplateBtn.addEventListener('click', () => {
            const type = this._excelImportType || 'kehoach';
            window.location.href = `/api/export-excel-template/${type}`;
        });
    }
}

export function openExcelImportModal(type) {
    this._excelImportType = type; // 'kehoach', 'goithau', 'chudautu', 'nhathau', 'chuyengia', 'hopdong', 'mothau'

    const fileInput = document.getElementById('excel-file-input');
    if (fileInput) fileInput.value = '';

    const fileInfo = document.getElementById('excel-file-info');
    if (fileInfo) fileInfo.style.display = 'none';

    const previewContainer = document.getElementById('excel-preview-container');
    if (previewContainer) previewContainer.style.display = 'none';

    const saveBtn = document.getElementById('btn-save-excel-import');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.style.display = 'none';
    }

    const modalTitle = document.getElementById('modal-excel-import-title');
    if (modalTitle) {
        let typeText = 'Kế hoạch LCNT';
        if (type === 'goithau' || type === 'package') typeText = 'Gói thầu';
        else if (type === 'chudautu') typeText = 'Chủ đầu tư';
        else if (type === 'nhathau') typeText = 'Nhà thầu';
        else if (type === 'chuyengia') typeText = 'Chuyên gia';
        else if (type === 'hopdong') typeText = 'Hợp đồng';
        else if (type === 'mothau') typeText = 'Thông tin Mở thầu';
        else if (type === 'danhgiahsdt') typeText = 'Đánh giá HSDT';
        else if (type === 'ketquaqd') typeText = 'Kết quả phê duyệt LCNT';

        modalTitle.textContent = `Nhập khẩu ${typeText} từ Excel`;
    }

    // Configure Excel modal template download to dynamically match mothau packages if chosen
    const downloadTemplateBtn = document.getElementById('btn-download-excel-template');
    if (downloadTemplateBtn) {
        // Clear all previous listeners
        const clone = downloadTemplateBtn.cloneNode(true);
        downloadTemplateBtn.parentNode.replaceChild(clone, downloadTemplateBtn);

        clone.onclick = (e) => {
            e.preventDefault();
            if (this._excelImportType === 'mothau') {
                // Dynamically trigger the Excel template download
                const select = document.getElementById('mothau-goithau-select');
                if (!select || !select.value) {
                    this.view.customAlert('Chưa chọn Gói thầu', 'Vui lòng chọn gói thầu ở màn hình nhập mở thầu trước để tải file mẫu tương ứng!', 'alert-triangle');
                    return;
                }
                const gtId = select.value;
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

                const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                const lotCodes = (gt.phanLoList || []).map(l => l.maPhanLo).join(',');

                // Redirect to backend API for downloading the strictly validated template
                window.location.href = `/api/export-mothau-template?case_type=${caseType}&package_name=${encodeURIComponent(safeCode)}&lot_codes=${encodeURIComponent(lotCodes)}`;
            } else if (this._excelImportType === 'danhgiahsdt') {
                const select = document.getElementById('danhgiahsdt-goithau-select');
                if (!select || !select.value) {
                    this.view.customAlert('Chưa chọn Gói thầu', 'Vui lòng chọn gói thầu ở màn hình đánh giá HSDT trước để tải file mẫu tương ứng!', 'alert-triangle');
                    return;
                }
                const gtId = select.value;
                const gt = this.model.state.goithau.find(g => g.id === gtId);
                if (!gt) return;
                const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                window.location.href = `/api/export-danhgiahsdt-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`;
            } else if (this._excelImportType === 'ketquaqd') {
                const gtId = this._currentResultPackageId;
                if (!gtId) {
                    this.view.customAlert('Chưa chọn Gói thầu', 'Không tìm thấy thông tin gói thầu hiện tại!', 'alert-triangle');
                    return;
                }
                const gt = this.model.state.goithau.find(g => g.id === gtId);
                if (!gt) return;
                const safeCode = (gt.maGoiThau || 'GoiThau').replace(/[^a-zA-Z0-9_-]/g, '').trim().substring(0, 30);
                window.location.href = `/api/export-ketquaqd-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`;
            } else {
                const type = this._excelImportType || 'kehoach';
                window.location.href = `/api/export-excel-template/${type}`;
            }
        };
    }

    this.view.openModal('modal-excel-preview');
}

export async function handleExcelUpload(file) {
    const fileInfo = document.getElementById('excel-file-info');
    if (fileInfo) {
        document.getElementById('excel-filename').textContent = file.name;
        document.getElementById('excel-filesize').textContent = (file.size / 1024).toFixed(2) + ' KB';
        fileInfo.style.display = 'flex';
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
                    const danhGiaHopLe = String(row['Đánh giá hợp lệ'] || row['Đánh giá tính hợp lệ'] || row['Hợp lệ'] || '').trim();
                    const danhGiaNangLuc = String(row['Đánh giá năng lực'] || row['Đánh giá năng lực kinh nghiệm'] || row['Năng lực'] || '').trim();
                    const danhGiaKyThuat = String(row['Đánh giá kỹ thuật'] || row['Kỹ thuật'] || '').trim();
                    const danhGiaKetLuan = String(row['Kết luận'] || row['Kết quả'] || '').trim();
                    const lamRoHopLe = String(row['Làm rõ hợp lệ'] || row['Làm rõ tính hợp lệ'] || '').trim();
                    const lamRoNangLuc = String(row['Làm rõ năng lực'] || row['Làm rõ năng lực kinh nghiệm'] || '').trim();
                    const lamRoKyThuat = String(row['Làm rõ kỹ thuật'] || '').trim();
                    const lamRoTaiChinh = String(row['Làm rõ tài chính'] || '').trim();

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
                        lamRoTaiChinh
                    };
                    if (hasPhanLo) {
                        rec.maPhanLo = foundBid ? foundBid.maPhanLo : maPhanLo;
                        rec.tenPhanLo = foundBid ? foundBid.tenPhanLo : '';
                    }
                    return rec;
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
                        isValid = false;
                        comment = `Không tìm thấy nhà thầu tương ứng trong thông tin mở thầu của gói thầu này!`;
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

                    const nhaThauId = foundNhaThau ? foundNhaThau.id : 'temp-' + window.generateUUID();

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

                // Render preview table via BiddingView
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
            this._excelImportData = data.rows || data.data || [];

            // Render preview table via our dynamic PlanView function
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

    if (type === 'plan' || type === 'kehoach') {
        const mappedData = this._excelImportData.map(row => {
            const planId = 'kh-' + window.generateUUID();
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
                ngayPheDuyet: row.ngayPheDuyet ? this.model.convertDMYToYMD(row.ngayPheDuyet) : '',
                quyetDinhPheDuyet: row.quyetDinhPheDuyet || '',
                thoiGianDangMa: row.thoiGianDangMa ? this.model.convertDMYToYMD(row.thoiGianDangMa) + ' 00:00:00' : ''
            };
        });
        this.model.state.kehoach.push(...mappedData);
        this.model.persistData('kehoach');
        this.view.renderKeHoachTable();
        count = mappedData.length;
    } else if (type === 'package' || type === 'goithau') {
        const latestPlans = this.model.getLatestPlans();
        const mappedData = this._excelImportData.map(row => {
            const matchedPlan = latestPlans.find(p => p.maKeHoach.toLowerCase() === (row.keHoachId || row.maKeHoach || '').toLowerCase());
            const gtId = 'gt-' + window.generateUUID();
            return {
                id: gtId,
                maGoiThau: row.maGoiThau || '',
                phienBan: '00',
                isLatest: 1,
                is_latest: 1,
                rootId: gtId,
                keHoachId: matchedPlan ? matchedPlan.id : '',
                tenGoiThau: row.tenGoiThau || '',
                giaGoiThau: parseFloat(row.giaGoiThau) || 0,
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
                soQuyetDinh: '',
                ngayQuyetDinh: '',
                thoiGianDangTai: '',
                thoiGianDongThau: '',
                thoiGianMoThau: '',
                toChuyenGia: [],
                toThamDinh: []
            };
        });
        this.model.state.goithau.push(...mappedData);
        this.model.persistData('goithau');
        this.view.renderGoiThauTable();
        count = mappedData.length;
    } else if (type === 'chudautu') {
        const mappedData = this._excelImportData.map(row => {
            return {
                id: 'cdt-' + window.generateUUID(),
                maChuDauTu: row.maChuDauTu || '',
                maSoThue: row.maSoThue || '',
                tenChuDauTu: row.tenChuDauTu || '',
                chucVuNguoiDungDau: row.chucVuNguoiDungDau || '',
                nguoiKyQuyetDinh: row.nguoiKyQuyetDinh || '',
                chucVuNguoiKy: row.chucVuNguoiKy || '',
                danhXung: row.danhXung || 'Ông',
                diaChi: row.diaChi || '',
                soDienThoai: row.soDienThoai || '',
                soTaiKhoan: row.soTaiKhoan || '',
                noiMoTaiKhoan: row.noiMoTaiKhoan || '',
                email: row.email || '',
                maQHNS: row.maQHNS || ''
            };
        });
        this.model.state.chudautu.push(...mappedData);
        this.model.persistData('chudautu');
        this.view.renderChuDauTuTable();
        count = mappedData.length;
    } else if (type === 'nhathau') {
        const mappedData = this._excelImportData.map(row => {
            return {
                id: 'nt-' + window.generateUUID(),
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
                thanhVienLienDanh: []
            };
        });
        this.model.state.nhathau.push(...mappedData);
        this.model.persistData('nhathau');
        this.view.renderNhaThauTable();
        count = mappedData.length;
    } else if (type === 'chuyengia') {
        const mappedData = this._excelImportData.map(row => {
            return {
                id: 'cg-' + window.generateUUID(),
                hoTen: row.hoTen || '',
                soCCCD: row.soCCCD || '',
                ngayCapCCCD: row.ngayCapCCCD ? this.model.convertDMYToYMD(row.ngayCapCCCD) : '',
                noiCapCCCD: row.noiCapCCCD || '',
                soChungChi: row.soChungChi || '',
                ngayCapChungChi: row.ngayCapChungChi ? this.model.convertDMYToYMD(row.ngayCapChungChi) : '',
                donViCapChungChi: row.donViCapChungChi || '',
                anhChungChi: '',
                tenAnhChungChi: '',
                anhChuKy: '',
                tenAnhChuKy: ''
            };
        });
        this.model.state.chuyengia.push(...mappedData);
        this.model.persistData('chuyengia');
        this.view.renderChuyenGiaTable();
        count = mappedData.length;
    } else if (type === 'hopdong') {
        const mappedData = this._excelImportData.map(row => {
            const cdt = this.model.state.chudautu.find(c => c.maChuDauTu.toLowerCase() === (row.chuDauTuId || '').toLowerCase());
            const nt = this.model.state.nhathau.find(n => n.maNhaThau.toLowerCase() === (row.nhaThauId || '').toLowerCase());

            const newId = 'hd-' + window.generateUUID();
            return {
                id: newId,
                tenHopDong: row.tenHopDong || '',
                soHopDong: row.soHopDong || '',
                ngayKy: row.ngayKy ? this.model.convertDMYToYMD(row.ngayKy) : '',
                chuDauTuId: cdt ? cdt.id : '',
                nhaThauId: nt ? nt.id : '',
                giaTri: parseFloat(row.giaTri) || 0,
                loaiHopDong: row.loaiHopDong || 'Trọn gói',
                soNgayThucHien: row.soNgayThucHien ? String(row.soNgayThucHien).trim() : '',
                goiThauIds: []
            };
        });
        this.model.state.hopdong.push(...mappedData);
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
                    const newId = 'nt-' + window.generateUUID();
                    foundNt = {
                        id: newId,
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
                    id: row.id || ('tm-' + window.generateUUID()),
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
                    const bid = this.model.state.thongtinmothau.find(b => b.id === row.id);
                    if (bid) {
                        if (row.trangThai === 'Trúng thầu' || row.trangThai === 'trung') {
                            bid.lyDoTruot = '';
                        } else {
                            bid.lyDoTruot = row.lyDoTruot || 'Đạt yêu cầu kỹ thuật nhưng giá dự thầu xếp sau';
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
                    gt.giaTrungThau = winnerRow.giaTrungThau || 0;
                    gt.thoiGianGoiThau = winnerRow.thoiGianGoiThau || '';
                    gt.thoiGianHopDong = winnerRow.thoiGianHopDong || '';
                    gt.trangThai = 'Đã có kết quả';
                } else {
                    gt.nhaThauTrungThauId = '';
                    gt.giaTrungThau = 0;
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
    }

    this.view.closeModal('modal-excel-preview');
    await this.view.customAlert('Nhập khẩu thành công', `Đã nhập khẩu thành công ${count} dòng dữ liệu vào hệ thống!`, 'check-circle');
    this.autoSync();
}
