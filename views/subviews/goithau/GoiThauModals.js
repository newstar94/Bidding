export function renderExcelPreview(rows, importType) {
    const formatDateToDMY = (str) => {
        if (!str) return '';
        if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
            const parts = str.substring(0, 10).split('-');
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return str;
    };
    const formatDatetimeToDMYHM = (str) => {
        if (!str) return '';
        if (str.match(/^\d{4}-\d{2}-\d{2}/)) {
            const datePart = str.substring(0, 10);
            const timePart = str.substring(11, 16) || '00:00';
            const parts = datePart.split('-');
            return `${parts[2]}/${parts[1]}/${parts[0]} ${timePart}`;
        }
        return str;
    };

    const getFieldError = (type, key, val, row) => {
        let apiType = type;
        if (apiType === 'plan') apiType = 'kehoach';
        if (apiType === 'package') apiType = 'goithau';

        const email_pattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        const cccd_pattern = /^\d{12}$/;
        const tax_pattern = /^\d{10}$|^\d{13}$|^\d{10}-\d{3}$/;
        const phone_pattern = /^[0-9\s+\-()]{9,15}$/;

        const strVal = (val !== undefined && val !== null) ? String(val).trim() : '';

        if (apiType === 'kehoach') {
            if (key === 'maKeHoach' && !strVal) return 'Mã kế hoạch không được để trống';
            if (key === 'tenKeHoach' && !strVal) return 'Tên kế hoạch không được để trống';
            if (key === 'tongMucDauTu' && val !== undefined && val !== null && val !== '') {
                const num = parseFloat(val);
                if (isNaN(num)) return 'Tổng mức đầu tư phải là số';
                if (num < 0) return 'Tổng mức đầu tư không được nhỏ hơn 0';
            }
        } else if (apiType === 'goithau') {
            if (key === 'maGoiThau' && !strVal) return 'Mã gói thầu không được để trống';
            if (key === 'tenGoiThau' && !strVal) return 'Tên gói thầu không được để trống';
            if (key === 'giaGoiThau' && val !== undefined && val !== null && val !== '') {
                const num = parseFloat(val);
                if (isNaN(num)) return 'Giá gói thầu phải là số';
                if (num < 0) return 'Giá gói thầu không được nhỏ hơn 0';
            }
            if (key === 'thoiGianThucHien' && val !== undefined && val !== null && val !== '') {
                const num = parseInt(val);
                if (isNaN(num)) return 'Thời gian thực hiện phải là số nguyên';
                if (num <= 0) return 'Thời gian thực hiện phải lớn hơn 0';
            }
        } else if (apiType === 'chudautu') {
            if (key === 'maChuDauTu' && !strVal) return 'Mã chủ đầu tư không được để trống';
            if (key === 'tenChuDauTu' && !strVal) return 'Tên chủ đầu tư không được để trống';
            if (key === 'maSoThue' && strVal && !tax_pattern.test(strVal)) return 'Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)';
            if (key === 'email' && strVal && !email_pattern.test(strVal)) return 'Email không đúng định dạng';
            if (key === 'soDienThoai' && strVal && !phone_pattern.test(strVal)) return 'Số điện thoại không hợp lệ';
        } else if (apiType === 'nhathau') {
            if (key === 'maNhaThau' && !strVal) return 'Mã nhà thầu không được để trống';
            if (key === 'tenNhaThau' && !strVal) return 'Tên nhà thầu không được để trống';
            if (key === 'maSoThue') {
                if (!strVal) return 'Mã số thuế không được để trống';
                if (!tax_pattern.test(strVal)) return 'Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)';
            }
            if (key === 'email' && strVal && !email_pattern.test(strVal)) return 'Email không đúng định dạng';
            if (key === 'soDienThoai' && strVal && !phone_pattern.test(strVal)) return 'Số điện thoại không hợp lệ';
        } else if (apiType === 'chuyengia') {
            if (key === 'hoTen' && !strVal) return 'Họ và tên không được để trống';
            if (key === 'soChungChi' && !strVal) return 'Số chứng chỉ không được để trống';
            if (key === 'soCCCD') {
                if (!strVal) return 'Số CCCD không được để trống';
                if (!cccd_pattern.test(strVal)) return 'Số Căn cước công dân phải gồm đúng 12 chữ số';
            }
            if (key === 'email' && strVal && !email_pattern.test(strVal)) return 'Email không đúng định dạng';
        } else if (apiType === 'hopdong') {
            if (key === 'soHopDong' && !strVal) return 'Số hợp đồng không được để trống';
            if (key === 'tenHopDong' && !strVal) return 'Tên hợp đồng không được để trống';
            if (key === 'giaTri' && val !== undefined && val !== null && val !== '') {
                const num = parseFloat(val);
                if (isNaN(num)) return 'Giá trị hợp đồng phải là số';
                if (num < 0) return 'Giá trị hợp đồng không được nhỏ hơn 0';
            }
        } else if (apiType === 'phanlo') {
            if (key === 'tenPhanLo' && !strVal) return 'Tên phần lô không được để trống';
        } else if (apiType === 'tuychonmuathem') {
            if (key === 'hangMuc' && !strVal) return 'Hạng mục không được để trống';
        } else if (['mothau', 'opening_fin', 'danhgiahsdt', 'ketquaqd'].includes(apiType)) {
            if (key === 'id' && !strVal) return 'Không tìm thấy nhà thầu tương ứng!';
        }
        return null;
    };

    let modal = document.getElementById('modal-excel-preview');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-excel-preview';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <style>
                .excel-preview-input {
                    width: 100%;
                    border: 1px solid var(--border-color);
                    background-color: var(--bg-app);
                    color: var(--text-main);
                    font-size: 0.82rem;
                    font-family: var(--font-primary);
                    font-weight: 600;
                    padding: 6px 10px;
                    border-radius: 6px;
                    outline: none;
                    box-sizing: border-box;
                    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
                }
                .excel-preview-input:focus {
                    border-color: var(--primary);
                    box-shadow: 0 0 0 3px var(--primary-soft);
                    background-color: var(--bg-card);
                }
                .excel-preview-input.is-invalid {
                    border-color: #ef4444 !important;
                    background-color: rgba(239, 68, 68, 0.05) !important;
                }
                .excel-preview-input.is-invalid:focus {
                    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2) !important;
                }
            </style>
            <div class="modal-card" style="max-width: 95%; width: 1300px;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <h3 style="margin: 0;">Xem trước dữ liệu nhập từ Excel</h3>
                    <button type="button" class="modal-close" data-bf-action="close-modal" data-modal-id="modal-excel-preview">&times;</button>
                </div>
                <div class="modal-body" style="max-height: 70vh; overflow-y: auto; padding: 20px;">
                    <div id="excel-preview-container" style="display: none;">
                        <div class="table-container" style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-x: auto;">
                            <table class="data-table" style="min-width: 100%;">
                                <thead id="excel-preview-header"></thead>
                                <tbody id="excel-preview-tbody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end; padding: 15px 20px; border-top: 1px solid var(--border-color);">
                    <button type="button" class="btn btn-outline" id="btn-cancel-excel-import" data-bf-action="close-modal" data-modal-id="modal-excel-preview">Hủy bỏ</button>
                    <button type="button" class="btn btn-primary" id="btn-save-excel-import" style="display: none;">Lưu dữ liệu</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const saveBtn = modal.querySelector('#btn-save-excel-import');
        if (saveBtn) {
            saveBtn.onclick = () => {
                if (window.appController && typeof window.appController.saveExcelImport === 'function') {
                    window.appController.saveExcelImport();
                }
            };
        }
    }

    const previewContainer = document.getElementById('excel-preview-container');
    const tableHeader = document.getElementById('excel-preview-header');
    const tableBody = document.getElementById('excel-preview-tbody');

    if (!previewContainer || !tableBody || !tableHeader) return;

    modal.classList.add('active');

    if (rows.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Không tìm thấy dữ liệu hợp lệ trong file Excel</td></tr>`;
        previewContainer.style.display = 'block';
        return;
    }

    const labelMap = {
        maKeHoach: 'Mã kế hoạch',
        tenKeHoach: 'Tên kế hoạch',
        loaiHinhMuaSam: 'Loại hình',
        tenDuAnDuToan: 'Dự án / Dự toán',
        tongMucDauTu: 'Tổng mức đầu tư',
        ngayPheDuyet: 'Ngày phê duyệt',
        quyetDinhPheDuyet: 'QĐ phê duyệt',
        thoiGianDangMa: 'Thời gian đăng mã',

        maGoiThau: 'Mã gói thầu',
        tenGoiThau: 'Tên gói thầu',
        keHoachId: 'Mã Kế hoạch LCNT',
        giaGoiThau: 'Giá gói thầu',
        hinhThucLuaChon: 'Hình thức LCNT',
        phuongThucLuaChon: 'Phương thức LCNT',
        thoiGianThucHien: 'TG thực hiện (ngày)',
        trangThai: 'Trạng thái',
        loaiHopDong: 'Loại hợp đồng',
        nguonVon: 'Nguồn vốn',

        maChuDauTu: 'Mã CĐT',
        tenChuDauTu: 'Tên chủ đầu tư',
        maSoThue: 'Mã số thuế',
        diaChi: 'Địa chỉ',
        soDienThoai: 'Điện thoại',
        email: 'Email',
        chucVuNguoiDungDau: 'Chức vụ người đứng đầu',
        daiDienCdt: 'Đại diện CĐT',
        chucVuDaiDien: 'Chức vụ người đại diện',
        danhXung: 'Danh xưng',
        soTaiKhoan: 'Số tài khoản',
        noiMoTaiKhoan: 'Nơi mở tài khoản',
        maQHNS: 'Mã QHNS',

        maNhaThau: 'Mã nhà thầu',
        tenNhaThau: 'Tên nhà thầu',
        loaiNhaThau: 'Loại nhà thầu',
        nguoiDaiDien: 'Người đại diện',
        soTaiKhoan: 'Số tài khoản',
        noiMoTaiKhoan: 'Nơi mở tài khoản',

        hoTen: 'Họ và tên',
        soCCCD: 'Số CCCD',
        ngayCapCCCD: 'Ngày cấp CCCD',
        noiCapCCCD: 'Nơi cấp CCCD',
        soChungChi: 'Số chứng chỉ',
        ngayCapChungChi: 'Ngày cấp CC',
        donViCapChungChi: 'Đơn vị cấp CC',

        soHopDong: 'Số hợp đồng',
        tenHopDong: 'Tên hợp đồng',
        ngayKy: 'Ngày ký',
        giaTri: 'Giá trị hợp đồng',
        soNgayThucHien: 'Số ngày thực hiện',

        maDinhDanh: 'Mã nhà thầu',
        maNhaThau: 'Mã nhà thầu',
        nhaThauId: 'Nhà thầu',
        maPhanLo: 'Mã phần lô',
        tenPhanLo: 'Tên phần lô',
        damBaoDuThau: 'Đảm bảo dự thầu',
        hieuLucDamBao: 'Hiệu lực ĐB (ngày)',
        hieuLucHsdxt: 'Hiệu lực E-HSĐXKT',
        giaDuThau: 'Giá dự thầu',
        tyLeGiamGia: 'Tỷ lệ giảm (%)',
        giaSauGiamGia: 'Giá sau giảm giá',
        hieuLucHsdt: 'Hiệu lực E-HSDT',
        giaTriDamBao: 'Giá trị đảm bảo',
        hieuLucBaoDamNgay: 'Hiệu lực ĐB (ngày)',
        thoiGianThucHien: 'Thời gian thực hiện',

        danhGiaHopLe: 'Đánh giá hợp lệ',
        danhGiaNangLuc: 'Đánh giá năng lực',
        danhGiaKyThuat: 'Đánh giá kỹ thuật',
        danhGiaKetLuan: 'Kết luận',

        giaTrungThau: 'Giá trúng thầu',
        thoiGianGoiThau: 'Thời gian thực hiện gói thầu',
        thoiGianHopDong: 'Thời gian thực hiện hợp đồng',
        lyDoTruot: 'Lý do trượt thầu'
    };

    const firstRow = rows[0].data || rows[0];
    const keys = Object.keys(firstRow).filter(k => k !== '_valid' && k !== '_comment');

    let headerHtml = '<tr>';
    keys.forEach(k => {
        const label = labelMap[k] || k;
        let align = 'left';
        if (['tongMucDauTu', 'giaGoiThau', 'giaTri', 'giaTriPhanLo', 'giaTrungThau', 'damBaoDuThau', 'giaDuThau', 'giaSauGiamGia', 'giaTriDamBao'].includes(k)) {
            align = 'right';
        }
        headerHtml += `<th style="text-align: ${align} !important;">${label}</th>`;
    });
    headerHtml += '<th style="text-align: center !important;">Thông tin kiểm tra</th></tr>';
    tableHeader.innerHTML = headerHtml;

    tableBody.innerHTML = rows.map((r, rowIndex) => {
        const rowErrors = [];
        const fieldErrorMap = {};
        
        // Xác định dòng bị trùng lặp dữ liệu để bôi đỏ ô nhập liệu tương ứng
        const isDuplicateRow = (r._valid === false || r._valid === 'false') && 
                             (r._comment && (r._comment.includes('trùng lặp') || r._comment.includes('tồn tại')));

        keys.forEach(k => {
            const err = getFieldError(importType, k, r[k], r);
            if (err) {
                rowErrors.push(err);
                fieldErrorMap[k] = err;
            }

            if (isDuplicateRow) {
                const isDupField = 
                    (importType === 'chuyengia' && (k === 'soCCCD' || k === 'soChungChi')) ||
                    (importType === 'kehoach' && k === 'maKeHoach') ||
                    (importType === 'goithau' && k === 'maGoiThau') ||
                    (importType === 'chudautu' && (k === 'maChuDauTu' || k === 'maSoThue')) ||
                    (importType === 'nhathau' && (k === 'maNhaThau' || k === 'maSoThue')) ||
                    (importType === 'hopdong' && k === 'soHopDong');
                
                if (isDupField) {
                    fieldErrorMap[k] = r._comment || 'Trùng lặp dữ liệu';
                }
            }
        });
        // Bảo lưu lỗi đã kiểm tra trước đó (ví dụ như lỗi trùng lặp từ ExcelIntegration)
        if (r._valid === false || r._valid === 'false') {
            if (r._comment && r._comment !== 'Hợp lệ') {
                rowErrors.push(r._comment);
            }
        }
        r._valid = (rowErrors.length === 0);
        r._comment = rowErrors.length > 0 ? rowErrors.join("; ") : "Hợp lệ";

        const statusHtml = r._valid
            ? '<span class="badge badge-success"><i data-lucide="check"></i> Hợp lệ</span>'
            : `<span class="badge badge-danger" title="${r._comment}"><i data-lucide="alert-circle"></i> Lỗi dữ liệu</span>`;

        let rowHtml = `<tr data-row-index="${rowIndex}">`;
        keys.forEach(k => {
            let val = r[k];
            let align = 'left';
            let style = '';
            let inputType = 'text';
            let inputClass = 'excel-preview-input';

            const dateKeys = ['ngayPheDuyet', 'ngayQuyetDinh', 'ngayKy', 'ngayQdChiDinh', 'ngayTrinhDuToan', 'ngayPheDuyetDuToan', 'ngayCapCCCD', 'ngayCapChungChi'];
            const datetimeKeys = ['thoiGianDangMa', 'thoiGianDangTai', 'thoiGianDongThau', 'thoiGianMoThau'];
            const numberKeys = ['tongMucDauTu', 'giaGoiThau', 'giaTri', 'giaTriPhanLo', 'giaTrungThau', 'damBaoDuThau', 'giaDuThau', 'giaSauGiamGia', 'giaTriDamBao', 'thoiGianThucHien', 'hieuLucBaoDamNgay', 'hieuLucHsdt'];

            if (numberKeys.includes(k)) {
                inputType = 'number';
                align = 'right';
                style = 'font-weight:700; color:var(--primary);';
                val = (val !== undefined && val !== null && val !== '') ? parseFloat(String(val).replace(/[^0-9.-]/g, '')) : '';
            } else if (dateKeys.includes(k)) {
                inputType = 'text';
                inputClass += ' flatpickr-date';
                val = formatDateToDMY(val);
            } else if (datetimeKeys.includes(k)) {
                inputType = 'text';
                inputClass += ' flatpickr-datetime';
                val = formatDatetimeToDMYHM(val);
            } else if (k === 'nhaThauId') {
                const matchedNt = window.appController.model.state.nhathau.find(n => n.id === val);
                if (matchedNt) val = matchedNt.tenNhaThau;
            }

            if (k === 'maKeHoach' || k === 'maGoiThau' || k === 'maChuDauTu' || k === 'maNhaThau' || k === 'soHopDong' || k === 'soChungChi' || k === 'maDinhDanh') {
                style = 'font-weight:700;';
            }

            const errorText = fieldErrorMap[k];

            rowHtml += `<td style="text-align: ${align} !important; ${style}; padding: 4px; vertical-align: top;">
                <input type="${inputType}" class="${inputClass} ${errorText ? 'is-invalid' : ''}" data-key="${k}" value="${val !== undefined && val !== null && val !== '' ? val : ''}" style="text-align: ${align};">
                ${errorText ? `<div class="invalid-feedback" style="color: #ef4444; font-size: 0.7rem; margin-top: 2px; text-align: left; font-weight: 500;">${errorText}</div>` : ''}
            </td>`;
        });
        rowHtml += `<td style="text-align: center; vertical-align: middle;">${statusHtml}</td></tr>`;
        return rowHtml;
    }).join('');

    tableBody.onchange = (e) => {
        const input = e.target.closest('input.excel-preview-input');
        if (!input) return;
        const tr = input.closest('tr');
        const rowIndex = parseInt(tr.getAttribute('data-row-index'), 10);
        const key = input.getAttribute('data-key');
        let val = input.value.trim();

        if (window.appController && window.appController._excelImportData) {
            const importType = window.appController._excelImportType;
            const row = window.appController._excelImportData[rowIndex];
            
            const dateKeys = ['ngayPheDuyet', 'ngayQuyetDinh', 'ngayKy', 'ngayQdChiDinh', 'ngayTrinhDuToan', 'ngayPheDuyetDuToan', 'ngayCapCCCD', 'ngayCapChungChi'];
            const datetimeKeys = ['thoiGianDangMa', 'thoiGianDangTai', 'thoiGianDongThau', 'thoiGianMoThau'];
            const numberKeys = ['tongMucDauTu', 'giaGoiThau', 'giaTri', 'giaTriPhanLo', 'giaTrungThau', 'damBaoDuThau', 'giaDuThau', 'giaSauGiamGia', 'giaTriDamBao', 'thoiGianThucHien', 'hieuLucBaoDamNgay', 'hieuLucHsdt'];

            if (numberKeys.includes(key)) {
                row[key] = val !== '' ? parseFloat(val) : 0;
            } else if (dateKeys.includes(key)) {
                if (val.includes('/')) {
                    const parts = val.split('/');
                    row[key] = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                } else {
                    row[key] = val;
                }
            } else if (datetimeKeys.includes(key)) {
                if (val.includes('/')) {
                    const spaceParts = val.split(' ');
                    const dateParts = spaceParts[0].split('/');
                    const timePart = spaceParts[1] ? spaceParts[1] : '00:00';
                    row[key] = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')} ${timePart}:00`;
                } else {
                    row[key] = val;
                }
            } else {
                row[key] = val;
            }

            // Chạy lại bộ lọc trùng lặp cho toàn bộ dữ liệu Excel
            window.appController.revalidateExcelImportData();

            // Duyệt và cập nhật lại giao diện (viền đỏ, ghi chú lỗi, badge trạng thái) cho TẤT CẢ các hàng
            const trs = tableBody.querySelectorAll('tr[data-row-index]');
            trs.forEach(rowTr => {
                const rIndex = parseInt(rowTr.getAttribute('data-row-index'), 10);
                const rData = window.appController._excelImportData[rIndex];
                if (!rData) return;

                const rInputs = rowTr.querySelectorAll('input.excel-preview-input');
                const rErrors = [];
                const isDup = (rData._valid === false || rData._valid === 'false') && 
                             (rData._comment && (rData._comment.includes('trùng lặp') || rData._comment.includes('tồn tại')));

                rInputs.forEach(inp => {
                    const k = inp.getAttribute('data-key');
                    let err = getFieldError(importType, k, rData[k], rData);
                    const td = inp.closest('td');

                    // Nếu không có lỗi định dạng riêng nhưng hàng bị lỗi trùng lặp, bôi đỏ trường định danh
                    if (!err && isDup) {
                        const isDupField = 
                            (importType === 'chuyengia' && (k === 'soCCCD' || k === 'soChungChi')) ||
                            (importType === 'kehoach' && k === 'maKeHoach') ||
                            (importType === 'goithau' && k === 'maGoiThau') ||
                            (importType === 'chudautu' && (k === 'maChuDauTu' || k === 'maSoThue')) ||
                            (importType === 'nhathau' && (k === 'maNhaThau' || k === 'maSoThue')) ||
                            (importType === 'hopdong' && k === 'soHopDong');
                        
                        if (isDupField) {
                            err = rData._comment;
                        }
                    }

                    const existingFeedback = td.querySelector('.invalid-feedback');
                    if (existingFeedback) existingFeedback.remove();

                    if (err) {
                        rErrors.push(err);
                        inp.classList.add('is-invalid');
                        const feedback = document.createElement('div');
                        feedback.className = 'invalid-feedback';
                        feedback.style.color = '#ef4444';
                        feedback.style.fontSize = '0.7rem';
                        feedback.style.marginTop = '2px';
                        feedback.style.textAlign = 'left';
                        feedback.style.fontWeight = '500';
                        feedback.innerText = err;
                        td.appendChild(feedback);
                    } else {
                        inp.classList.remove('is-invalid');
                    }
                });

                // Nếu có phát sinh lỗi định dạng ô bổ sung (ví dụ: họ tên trống), cập nhật lại trạng thái dòng
                if (rErrors.length > 0) {
                    rData._valid = false;
                    rData._comment = rErrors.join("; ");
                }

                // Cập nhật lại cột Badge trạng thái cuối cùng của hàng
                const statusTd = rowTr.querySelector('td:last-child');
                if (statusTd) {
                    statusTd.innerHTML = rData._valid
                        ? '<span class="badge badge-success"><i data-lucide="check"></i> Hợp lệ</span>'
                        : `<span class="badge badge-danger" title="${rData._comment}"><i data-lucide="alert-circle"></i> Lỗi dữ liệu</span>`;
                    
                    if (window.lucide) {
                        window.lucide.createIcons({ root: statusTd });
                    }
                }
            });
        }
    };

    tableBody.onfocusin = (e) => {
        const input = e.target.closest('input.excel-preview-input');
        if (input) input.select();
    };

    previewContainer.style.display = 'block';
    
    if (window.appController && typeof window.appController.initFlatpickr === 'function') {
        window.appController.initFlatpickr(tableBody);
    }
    
    lucide.createIcons();
}

export function populatePhathanhHsmtForm(gt, model) {
    const form = document.getElementById('form-phathanh-hsmt');
    if (form) {
        form.querySelectorAll('.form-group').forEach(fg => fg.classList.remove('invalid'));
    }

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    setVal('phathanh-gt-id', gt.id);
    setVal('phathanh-magoithau', gt.maGoiThau || '');
    setVal('phathanh-sototrinh', gt.soToTrinhHsmt || '');
    setVal('phathanh-ngaytrinh', gt.ngayTrinhHsmt ? model.formatForDateInput(gt.ngayTrinhHsmt) : '');
    setVal('phathanh-soquyetdinh', gt.soQuyetDinh || '');
    setVal('phathanh-hieuluchsdt', gt.hieuLucHsdt || '');
    setVal('phathanh-giatribaomothau', gt.giaTriDamBaoDuThau ? model.formatVND(gt.giaTriDamBaoDuThau) : '');

    setVal('phathanh-ngayquyetdinh', gt.ngayQuyetDinh ? model.formatForDateInput(gt.ngayQuyetDinh) : '');
    setVal('phathanh-thoigiandangtai', gt.thoiGianDangTai ? model.formatForDatetimeLocal(gt.thoiGianDangTai) : '');
    setVal('phathanh-thoigiandongthau', gt.thoiGianDongThau ? model.formatForDatetimeLocal(gt.thoiGianDongThau) : '');

    const hasAudit = gt.yeuCauThamDinhHsmt === 'Có';
    const auditRadios = document.querySelectorAll('input[name="phathanh-yeucauthamdinh"]');
    auditRadios.forEach(radio => {
        radio.checked = (radio.value === 'Có' && hasAudit) || (radio.value === 'Không' && !hasAudit);
    });

    setVal('phathanh-sobaocaothamdinh', hasAudit ? (gt.soBaoCaoThamDinhHsmt || '') : '');
    setVal('phathanh-ngaybaocaothamdinh', hasAudit && gt.ngayBaoCaoThamDinhHsmt ? model.formatForDateInput(gt.ngayBaoCaoThamDinhHsmt) : '');

    const soBaoCaoContainer = document.getElementById('phathanh-sobaocao-container');
    const ngayBaoCaoContainer = document.getElementById('phathanh-ngaybaocao-container');
    const soBaoCaoInp = document.getElementById('phathanh-sobaocaothamdinh');
    const ngayBaoCaoInp = document.getElementById('phathanh-ngaybaocaothamdinh');

    if (soBaoCaoContainer) soBaoCaoContainer.style.display = hasAudit ? 'block' : 'none';
    if (ngayBaoCaoContainer) ngayBaoCaoContainer.style.display = hasAudit ? 'block' : 'none';

    if (hasAudit) {
        if (soBaoCaoInp) soBaoCaoInp.setAttribute('required', 'true');
        if (ngayBaoCaoInp) ngayBaoCaoInp.setAttribute('required', 'true');
    } else {
        if (soBaoCaoInp) soBaoCaoInp.removeAttribute('required');
        if (ngayBaoCaoInp) ngayBaoCaoInp.removeAttribute('required');
    }

    const isTuVan = gt.linhVuc === 'Tư vấn';
    const isPhanLo = gt.phanLo === 'Có';
    const baodamContainer = document.getElementById('phathanh-baodam-container');
    const baodamInput = document.getElementById('phathanh-giatribaomothau');
    const phanloBaodamContainer = document.getElementById('phathanh-phanlo-baodam-container');
    const phanloBaodamTbody = document.getElementById('phathanh-phanlo-baodam-tbody');

    if (baodamContainer && baodamInput && phanloBaodamContainer && phanloBaodamTbody) {
        if (isTuVan) {
            baodamContainer.style.display = 'none';
            baodamInput.removeAttribute('required');
            phanloBaodamContainer.style.display = 'none';
            phanloBaodamTbody.innerHTML = '';
        } else {
            if (isPhanLo) {
                baodamContainer.style.display = 'none';
                baodamInput.removeAttribute('required');

                phanloBaodamContainer.style.display = 'block';
                phanloBaodamTbody.innerHTML = '';

                const list = gt.phanLoList || [];
                list.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.setAttribute('data-id', item.id);
                    const baoDamVal = item.baoDamDuThau || '';
                    const giaTriVal = item.giaTriPhanLo || 0;
                    tr.innerHTML = `
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-code-input" value="${item.maPhanLo || ''}" placeholder="Mã..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-name-input" value="${item.tenPhanLo || ''}" placeholder="Tên..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-price-input mt-format-vnd" value="${giaTriVal ? model.formatVND(giaTriVal) : ''}" placeholder="Giá trị..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-baodam-input mt-format-vnd" required value="${baoDamVal ? model.formatVND(baoDamVal) : ''}" placeholder="Bảo đảm..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                        <td style="padding: 6px 8px;">
                            <input type="text" class="phathanh-pl-duration-input" value="${item.thoiGianThucHien || ''}" placeholder="Thời gian..." style="width: 100%; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; height: 32px; background: var(--bg-card); color: var(--text-main);">
                        </td>
                    `;
                    phanloBaodamTbody.appendChild(tr);

                    const setupInputFormat = (inp) => {
                        if (!inp) return;
                        inp.addEventListener('input', (e) => {
                            const cursorPosition = e.target.selectionStart;
                            const originalLength = e.target.value.length;
                            const parsed = model.parseVND(e.target.value);
                            e.target.value = model.formatVND(parsed);
                            const newLength = e.target.value.length;
                            e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));
                        });
                    };
                    setupInputFormat(tr.querySelector('.phathanh-pl-price-input'));
                    setupInputFormat(tr.querySelector('.phathanh-pl-baodam-input'));
                });
            } else {
                baodamContainer.style.display = 'block';
                baodamInput.setAttribute('required', '');
                baodamInput.setAttribute('required', 'true');
                baodamInput.value = gt.giaTriDamBaoDuThau ? model.formatVND(gt.giaTriDamBaoDuThau) : '';

                phanloBaodamContainer.style.display = 'none';
                phanloBaodamTbody.innerHTML = '';
            }
        }
    }
}

export function getPhathanhHsmtFormData(model) {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    const id = getVal('phathanh-gt-id');
    const maGoiThauVal = getVal('phathanh-magoithau');
    const hieuLucHsdtVal = parseInt(getVal('phathanh-hieuluchsdt')) || 0;
    const giaTriDamBaoVal = model.parseVND(getVal('phathanh-giatribaomothau'));
    const soQuyetDinh = getVal('phathanh-soquyetdinh');
    const thoiGianDangTai = getVal('phathanh-thoigiandangtai');
    const thoiGianDongThau = getVal('phathanh-thoigiandongthau');
    const ngayQuyetDinh = getVal('phathanh-ngayquyetdinh');
    const soToTrinhHsmt = getVal('phathanh-sototrinh');
    const ngayTrinhHsmt = getVal('phathanh-ngaytrinh');

    const phanLoRows = [];
    document.querySelectorAll('#phathanh-phanlo-baodam-tbody tr').forEach(tr => {
        const trId = tr.getAttribute('data-id');
        const codeInp = tr.querySelector('.phathanh-pl-code-input');
        const nameInp = tr.querySelector('.phathanh-pl-name-input');
        const priceInp = tr.querySelector('.phathanh-pl-price-input');
        const baodamInp = tr.querySelector('.phathanh-pl-baodam-input');
        const durationInp = tr.querySelector('.phathanh-pl-duration-input');

        phanLoRows.push({
            id: trId,
            maPhanLo: codeInp ? codeInp.value.trim() : '',
            tenPhanLo: nameInp ? nameInp.value.trim() : '',
            giaTriPhanLo: priceInp ? model.parseVND(priceInp.value) : 0,
            baoDamDuThau: baodamInp ? model.parseVND(baodamInp.value) : 0,
            thoiGianThucHien: durationInp ? durationInp.value.trim() : ''
        });
    });

    const auditRadioChecked = document.querySelector('input[name="phathanh-yeucauthamdinh"]:checked');
    const yeuCauThamDinhHsmt = auditRadioChecked ? auditRadioChecked.value : 'Không';
    const soBaoCaoThamDinhHsmt = yeuCauThamDinhHsmt === 'Có' ? getVal('phathanh-sobaocaothamdinh') : '';
    const ngayBaoCaoThamDinhHsmt = yeuCauThamDinhHsmt === 'Có' ? getVal('phathanh-ngaybaocaothamdinh') : '';

    return {
        id,
        maGoiThauVal,
        hieuLucHsdtVal,
        giaTriDamBaoVal,
        soQuyetDinh,
        thoiGianDangTai,
        thoiGianDongThau,
        ngayQuyetDinh,
        soToTrinhHsmt,
        ngayTrinhHsmt,
        yeuCauThamDinhHsmt,
        soBaoCaoThamDinhHsmt,
        ngayBaoCaoThamDinhHsmt,
        phanLoRows
    };
}

export function isGoiThauDetailTabActive() {
    const detailPane = document.getElementById('tab-goithau-detail');
    return !!(detailPane && detailPane.classList.contains('active'));
}

export function getGoiThauFormInputValues(model) {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    const getRawVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    return {
        id: getVal('form-goithau-id'),
        keHoachId: getVal('gt-kehoachid'),
        tenGoiThau: getVal('gt-ten'),
        giaGoiThau: model.parseVND(getVal('gt-gia')),
        thoiGianThucHien: getVal('gt-thoigian'),
        hinhThucLuaChon: getRawVal('gt-hinhthuc'),
        phuongThucLuaChon: getRawVal('gt-phuongthuc'),
        phuongPhapDanhGia: getRawVal('gt-phuongphapdanhgia'),
        trongSoKyThuat: getVal('gt-trongsokythuat') !== '' ? parseInt(getVal('gt-trongsokythuat')) : null,
        trangThai: getRawVal('gt-trangthai'),
        linhVuc: getRawVal('gt-linhvuc'),
        isThuoc: document.querySelector('input[name="gt-goithauthuoc"]:checked')?.value === '1' ? 1 : 0,
        tuyChonMuaThem: getRawVal('gt-tuychonmuathem'),
        nguonVon: getRawVal('gt-nguonvon'),
        loaiHopDong: getRawVal('gt-loaihopdong'),
        thoiGianToChuc: getVal('gt-thoigiantochuc'),
        thoiGianBatDauToChuc: getVal('gt-thoigianbatdautochuc'),
        quaMang: getRawVal('gt-quatmang'),
        trongNuocQuocTe: getRawVal('gt-trongnuocquocte'),
        phanLo: getRawVal('gt-phanlo'),
        soQuyetDinh: getVal('gt-soquyetdinh'),
        ngayQuyetDinh: getVal('gt-ngayquyetdinh'),
        thoiGianDangTai: getVal('gt-thoigiandangtai'),
        thoiGianDongThau: getVal('gt-thoigiandongthau'),
        thoiGianMoThau: getVal('gt-thoigianmothau'),
        thoiGianMoEhsdxtc: getVal('gt-thoigianmoehsdxtc'),
        giaTriDamBaoDuThau: getVal('gt-giatribaomothau'),
        hieuLucHsdt: getVal('gt-hieuluchsdt') !== '' ? parseInt(getVal('gt-hieuluchsdt')) : null,
        hieuLucDamBaoDuThau: getVal('gt-hieuluchbaomothau') !== '' ? parseInt(getVal('gt-hieuluchbaomothau')) : null,
        tyLeBaoDamHopDong: getVal('gt-tylebaodamhopdong') !== '' ? parseFloat(getVal('gt-tylebaodamhopdong')) : null,
        nhaThauTrungThauId: getRawVal('gt-nhathautrungthauid'),
        giaTrungThau: model.parseVND(getVal('gt-giatrungthau')),
        thoiGianGoiThau: getVal('gt-thoigian-goithau'),
        thoiGianHopDong: getVal('gt-thoigian-hopdong')
    };
}

