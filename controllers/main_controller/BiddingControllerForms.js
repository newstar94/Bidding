export function updateNguonVonFieldState(planId) {
    const gtNguonVon = document.getElementById('gt-nguonvon');
    if (!gtNguonVon) return;

    if (planId) {
        const kh = this.model.getLatestPlan(planId);
        if (kh && kh.loaiHinhMuaSam === 'Dự án') {
            if (kh.nguonVon) {
                gtNguonVon.value = kh.nguonVon;
            }
            gtNguonVon.setAttribute('readonly', 'true');
            gtNguonVon.style.pointerEvents = 'none';
            gtNguonVon.style.background = 'var(--neutral-soft)';
            gtNguonVon.style.cursor = 'not-allowed';
            return;
        }
    }
    gtNguonVon.removeAttribute('readonly');
    gtNguonVon.style.pointerEvents = 'auto';
    gtNguonVon.style.background = '';
    gtNguonVon.style.cursor = 'auto';
}


export function setupConditionalUI() {
    const statusSelect = document.getElementById('gt-trangthai');
    const phanLoSelect = document.getElementById('gt-phanlo');

    if (statusSelect) {
        statusSelect.addEventListener('change', () => {
            this.updateAwardedContractorUI();
            this.updatePackageFieldsVisibility();
        });
    }
    if (phanLoSelect) {
        phanLoSelect.addEventListener('change', () => {
            this.updateAwardedContractorUI();
            this.updatePackageFieldsVisibility();
        });
    }
    const linhVucSelect = document.getElementById('gt-linhvuc');
    if (linhVucSelect) {
        linhVucSelect.addEventListener('change', () => {
            this.updatePackageFieldsVisibility();
        });
    }
    const hinhThucSelect = document.getElementById('gt-hinhthuc');
    if (hinhThucSelect) {
        hinhThucSelect.addEventListener('change', () => {
            this.updatePackageFieldsVisibility();
        });
    }

    const khCdtSelect = document.getElementById('kh-chudautuid');
    if (khCdtSelect) {
        khCdtSelect.addEventListener('change', (e) => {
            if (e.target.value === '__NEW_INVESTOR__') {
                this.editChuDauTu(null);
                e.target.value = '';
            }
        });
    }

    const gtKeHoachSelect = document.getElementById('gt-kehoachid');
    if (gtKeHoachSelect) {
        gtKeHoachSelect.addEventListener('change', async (e) => {
            this.updateNguonVonFieldState(e.target.value);

            const idInput = document.getElementById('form-goithau-id');
            const isNewPackage = !idInput || !idInput.value;
            if (isNewPackage && e.target.value) {
                if (typeof this.checkAndInheritCanceledPackage === 'function') {
                    await this.checkAndInheritCanceledPackage(e.target.value);
                }
            }
        });
    }

    const ntLoaiSelect = document.getElementById('nt-loai');
    if (ntLoaiSelect) {
        ntLoaiSelect.addEventListener('change', () => {
            const singleSection = document.getElementById('nt-single-details');
            const jvSection = document.getElementById('nt-joint-venture-details');
            if (ntLoaiSelect.value === 'Liên danh') {
                singleSection.style.display = 'none';
                jvSection.style.display = 'block';
                const membersList = document.getElementById('nt-joint-venture-members-list');
                if (membersList && membersList.children.length === 0) {
                    this.addJointVentureMemberCard();
                    this.addJointVentureMemberCard();
                }
            } else {
                singleSection.style.display = 'grid';
                jvSection.style.display = 'none';
            }
        });
    }
}


export function setupFileUploads() {
    const handleChuyenGiaFile = (file, type) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            this.view.customAlert('Tệp không hợp lệ', 'Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, WEBP).', 'alert-triangle');
            return;
        }
        if (file.size > 3 * 1024 * 1024) {
            this.view.customAlert('Tệp quá lớn', 'Dung lượng ảnh quá lớn. Vui lòng tải lên ảnh dưới 3MB để hệ thống lưu trữ tối ưu.', 'alert-triangle');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            if (type === 'cert') {
                this.tempChuyenGiaImageBase64 = e.target.result;
                const previewContainer = document.getElementById('cg-preview-container');
                const previewImg = document.getElementById('cg-anh-preview');
                const uploadZone = document.getElementById('cg-upload-zone');

                previewImg.src = e.target.result;
                previewContainer.style.display = 'flex';
                uploadZone.style.display = 'none';
            } else if (type === 'signature') {
                this.tempChuyenGiaSignatureBase64 = e.target.result;
                const previewContainer = document.getElementById('cg-preview-container-chuky');
                const previewImg = document.getElementById('cg-anh-preview-chuky');
                const uploadZone = document.getElementById('cg-upload-zone-chuky');

                previewImg.src = e.target.result;
                previewContainer.style.display = 'flex';
                uploadZone.style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    };

    const uploadZone = document.getElementById('cg-upload-zone');
    const fileInput = document.getElementById('cg-anhchungchi');
    const previewContainer = document.getElementById('cg-preview-container');
    const previewImg = document.getElementById('cg-anh-preview');
    const removeBtn = document.getElementById('btn-cg-remove-file');

    if (uploadZone && fileInput) {
        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleChuyenGiaFile(e.dataTransfer.files[0], 'cert');
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleChuyenGiaFile(e.target.files[0], 'cert');
            }
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.tempChuyenGiaImageBase64 = '';
            fileInput.value = '';
            previewImg.src = '';
            previewContainer.style.display = 'none';
            uploadZone.style.display = 'flex';
        });
    }

    const uploadZoneChuky = document.getElementById('cg-upload-zone-chuky');
    const fileInputChuky = document.getElementById('cg-anhchuky');
    const previewContainerChuky = document.getElementById('cg-preview-container-chuky');
    const previewImgChuky = document.getElementById('cg-anh-preview-chuky');
    const removeBtnChuky = document.getElementById('btn-cg-remove-file-chuky');

    if (uploadZoneChuky && fileInputChuky) {
        uploadZoneChuky.addEventListener('click', () => fileInputChuky.click());
        uploadZoneChuky.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZoneChuky.classList.add('dragover');
        });
        uploadZoneChuky.addEventListener('dragleave', () => {
            uploadZoneChuky.classList.remove('dragover');
        });
        uploadZoneChuky.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZoneChuky.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleChuyenGiaFile(e.dataTransfer.files[0], 'signature');
            }
        });
        fileInputChuky.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleChuyenGiaFile(e.target.files[0], 'signature');
            }
        });
    }

    if (removeBtnChuky) {
        removeBtnChuky.addEventListener('click', (e) => {
            e.stopPropagation();
            this.tempChuyenGiaSignatureBase64 = '';
            fileInputChuky.value = '';
            previewImgChuky.src = '';
            previewContainerChuky.style.display = 'none';
            uploadZoneChuky.style.display = 'flex';
        });
    }
}


export function setupActionListeners() {
    // Debounce helper — tránh re-render bảng mỗi lần gõ phím, chỉ render sau 300ms dừng gõ
    const debounce = (fn, ms = 300) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    };

    document.getElementById('search-kehoach').addEventListener('input', debounce(() => {
        this.model.currentPage.kehoach = 1;
        this.view.renderKeHoachTable();
    }));
    document.getElementById('search-goithau').addEventListener('input', debounce(() => {
        this.model.currentPage.goithau = 1;
        this.view.renderGoiThauTable();
    }));
    document.getElementById('search-chudautu').addEventListener('input', debounce(() => {
        this.model.currentPage.chudautu = 1;
        this.view.renderChuDauTuTable();
    }));
    document.getElementById('search-nhathau').addEventListener('input', debounce(() => {
        this.model.currentPage.nhathau = 1;
        this.view.renderNhaThauTable();
    }));
    document.getElementById('search-chuyengia').addEventListener('input', debounce(() => {
        this.model.currentPage.chuyengia = 1;
        this.view.renderChuyenGiaTable();
    }));
    const searchHopdong = document.getElementById('search-hopdong');
    if (searchHopdong) searchHopdong.addEventListener('input', debounce(() => {
        this.model.currentPage.hopdong = 1;
        this.view.renderHopDongTable();
    }));

    document.getElementById('filter-goithau-trangthai').addEventListener('change', () => {
        this.model.currentPage.goithau = 1;
        this.view.renderGoiThauTable();
    });
    document.getElementById('filter-goithau-hinhthuc').addEventListener('change', () => {
        this.model.currentPage.goithau = 1;
        this.view.renderGoiThauTable();
    });
    document.getElementById('filter-goithau-nam').addEventListener('change', () => {
        this.model.currentPage.goithau = 1;
        this.view.renderGoiThauTable();
    });
    document.getElementById('filter-goithau-thang').addEventListener('change', () => {
        this.model.currentPage.goithau = 1;
        this.view.renderGoiThauTable();
    });

    const filterKehoachNam = document.getElementById('filter-kehoach-nam');
    if (filterKehoachNam) filterKehoachNam.addEventListener('change', () => {
        this.model.currentPage.kehoach = 1;
        this.view.renderKeHoachTable();
    });
    const filterKehoachThang = document.getElementById('filter-kehoach-thang');
    if (filterKehoachThang) filterKehoachThang.addEventListener('change', () => {
        this.model.currentPage.kehoach = 1;
        this.view.renderKeHoachTable();
    });

    const filterHopdongNam = document.getElementById('filter-hopdong-nam');
    if (filterHopdongNam) filterHopdongNam.addEventListener('change', () => {
        this.model.currentPage.hopdong = 1;
        this.view.renderHopDongTable();
    });
    const filterHopdongThang = document.getElementById('filter-hopdong-thang');
    if (filterHopdongThang) filterHopdongThang.addEventListener('change', () => {
        this.model.currentPage.hopdong = 1;
        this.view.renderHopDongTable();
    });



    document.getElementById('btn-add-kehoach').addEventListener('click', () => this.editKeHoach(null));
    document.getElementById('btn-add-goithau').addEventListener('click', () => this.editGoiThau(null));
    document.getElementById('btn-add-chudautu').addEventListener('click', () => this.editChuDauTu(null));
    document.getElementById('btn-add-nhathau').addEventListener('click', () => this.editNhaThau(null));
    document.getElementById('btn-add-chuyengia').addEventListener('click', () => this.editChuyenGia(null));

    const btnAddHopdong = document.getElementById('btn-add-hopdong');
    if (btnAddHopdong) btnAddHopdong.addEventListener('click', () => this.editHopDong(null));

    const setupNumberAutoFormat = (inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;

            const formatted = this.model.formatVND(e.target.value);
            e.target.value = formatted;

            const newLength = formatted.length;
            const newPosition = cursorPosition + (newLength - originalLength);
            e.target.setSelectionRange(newPosition, newPosition);
        });
    };

    setupNumberAutoFormat('kh-tongmuc');
    setupNumberAutoFormat('gt-gia');
    setupNumberAutoFormat('gt-giatrungthau');
    setupNumberAutoFormat('gt-giatribaomothau');
    setupNumberAutoFormat('hd-giatri');
    setupNumberAutoFormat('edit-pkg-price');

    const hsdthInput = document.getElementById('gt-hieuluchsdt');
    if (hsdthInput) {
        hsdthInput.addEventListener('input', () => {
            const hsdthVal = parseInt(hsdthInput.value) || 0;
            const bdmInput = document.getElementById('gt-hieuluchbaomothau');
            if (bdmInput) {
                bdmInput.value = hsdthVal > 0 ? (hsdthVal + 30) : '';
            }
        });
    }

    const gtThoiGianDongThau = document.getElementById('gt-thoigiandongthau');
    if (gtThoiGianDongThau) {
        gtThoiGianDongThau.addEventListener('change', () => this.validateGiaHanRealtime());
        gtThoiGianDongThau.addEventListener('input', () => this.validateGiaHanRealtime());
    }

    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-close');
            this.closeModal(modalId);
        });
    });

    // Set up forms submits
    document.getElementById('form-kehoach').addEventListener('submit', (e) => this.handleKeHoachSubmit(e));
    document.getElementById('form-goithau').addEventListener('submit', (e) => this.handleGoiThauSubmit(e));
    const formPhathanh = document.getElementById('form-phathanh-hsmt');
    if (formPhathanh) {
        formPhathanh.addEventListener('submit', (e) => this.handlePhatHanhHsmtSubmit(e));
    }

    const btnPhathanhExport = document.getElementById('btn-phathanh-export-excel');
    const btnPhathanhImport = document.getElementById('btn-phathanh-import-excel');
    const inputPhathanhImport = document.getElementById('phathanh-excel-file-input');

    if (btnPhathanhExport) {
        btnPhathanhExport.addEventListener('click', () => {
            const id = document.getElementById('phathanh-gt-id').value;
            const gt = this.model.state.goithau.find(g => g.id === id);
            if (gt) {
                this.exportPhatHanhPhanLoExcel(gt);
            }
        });
    }

    if (btnPhathanhImport && inputPhathanhImport) {
        btnPhathanhImport.addEventListener('click', () => inputPhathanhImport.click());
        inputPhathanhImport.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.importPhatHanhPhanLoExcel(e.target.files[0]);
                inputPhathanhImport.value = '';
            }
        });
    }

    const phathanhGiatribaomothau = document.getElementById('phathanh-giatribaomothau');
    if (phathanhGiatribaomothau) {
        phathanhGiatribaomothau.addEventListener('input', (e) => {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;
            e.target.value = this.model.formatVND(e.target.value);
            const newLength = e.target.value.length;
            e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));
        });
    }

    document.querySelectorAll('input[name="phathanh-yeucauthamdinh"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const show = e.target.value === 'Có';
            const soBaoCaoContainer = document.getElementById('phathanh-sobaocao-container');
            const ngayBaoCaoContainer = document.getElementById('phathanh-ngaybaocao-container');
            const soBaoCaoInp = document.getElementById('phathanh-sobaocaothamdinh');
            const ngayBaoCaoInp = document.getElementById('phathanh-ngaybaocaothamdinh');
            
            if (soBaoCaoContainer) soBaoCaoContainer.style.display = show ? 'block' : 'none';
            if (ngayBaoCaoContainer) ngayBaoCaoContainer.style.display = show ? 'block' : 'none';
            
            if (show) {
                if (soBaoCaoInp) soBaoCaoInp.setAttribute('required', 'true');
                if (ngayBaoCaoInp) ngayBaoCaoInp.setAttribute('required', 'true');
            } else {
                if (soBaoCaoInp) {
                    soBaoCaoInp.removeAttribute('required');
                    soBaoCaoInp.value = '';
                }
                if (ngayBaoCaoInp) {
                    ngayBaoCaoInp.removeAttribute('required');
                    ngayBaoCaoInp.value = '';
                    if (ngayBaoCaoInp._flatpickr) {
                        ngayBaoCaoInp._flatpickr.clear();
                    }
                }
            }
        });
    });

    const gtHinhThucSelect = document.getElementById('gt-hinhthuc');
    const gtPhuongThucSelect = document.getElementById('gt-phuongthuc');
    const gtPhuongThucContainer = document.getElementById('gt-phuongthuc-container');
    const gtLinhVucSelect = document.getElementById('gt-linhvuc');
    const gtPhuongPhapDanhGiaSelect = document.getElementById('gt-phuongphapdanhgia');
    const gtPhuongPhapDanhGiaContainer = document.getElementById('gt-phuongphapdanhgia-container');
    const gtTrongSoKyThuatContainer = document.getElementById('gt-trongsokythuat-container');
    const gtTrongSoKyThuatInput = document.getElementById('gt-trongsokythuat');

    const validateTrongSoKyThuat = (showEmptyError = false) => {
        if (!gtTrongSoKyThuatInput || !gtTrongSoKyThuatContainer) return true;

        const valRaw = gtTrongSoKyThuatInput.value;
        const fg = gtTrongSoKyThuatInput.closest('.form-group');
        const errorEl = document.getElementById('gt-trongsokythuat-error');

        if (gtPhuongPhapDanhGiaSelect.value !== 'Kết hợp giữa kỹ thuật và giá') {
            if (fg) fg.classList.remove('invalid', 'warning');
            return true;
        }

        if (valRaw === '') {
            if (showEmptyError) {
                if (fg) fg.classList.add('invalid');
                if (errorEl) {
                    errorEl.textContent = 'Vui lòng nhập trọng số kỹ thuật';
                    errorEl.style.color = 'var(--danger)';
                    errorEl.style.display = 'block';
                }
            } else {
                if (fg) fg.classList.remove('invalid', 'warning');
                if (errorEl) {
                    errorEl.textContent = '';
                    errorEl.style.display = '';
                }
            }
            return false;
        }

        const val = parseInt(valRaw);
        const linhVucVal = gtLinhVucSelect ? gtLinhVucSelect.value : '';
        const phuongThucVal = gtPhuongThucSelect ? gtPhuongThucSelect.value : '';

        if (linhVucVal === 'Tư vấn') {
            if (val < 70 || val > 80) {
                if (fg) fg.classList.add('invalid');
                if (errorEl) {
                    errorEl.textContent = 'Đối với gói thầu tư vấn, trọng số kỹ thuật phải nằm trong khoảng 70% - 80%';
                    errorEl.style.color = 'var(--danger)';
                    errorEl.style.display = 'block';
                }
                return false;
            }
        } else {
            if (phuongThucVal === 'Một giai đoạn hai túi hồ sơ') {
                if (val < 10) {
                    if (fg) fg.classList.add('invalid');
                    if (errorEl) {
                        errorEl.textContent = 'Trọng số kỹ thuật tối thiểu là 10%';
                        errorEl.style.color = 'var(--danger)';
                        errorEl.style.display = 'block';
                    }
                    return false;
                }
                if (val > 50) {
                    if (fg) fg.classList.add('invalid');
                    if (errorEl) {
                        errorEl.textContent = 'Không cho phép nhập trọng số kỹ thuật lớn hơn 50%';
                        errorEl.style.color = 'var(--danger)';
                        errorEl.style.display = 'block';
                    }
                    return false;
                }
                if (val > 30 && val <= 50) {
                    if (fg) fg.classList.remove('invalid');
                    if (errorEl) {
                        errorEl.textContent = 'Lưu ý: Trọng số kỹ thuật lớn hơn 30% (mức khuyến nghị thông thường là 10% - 30%)';
                        errorEl.style.color = '#d97706';
                        errorEl.style.display = 'block';
                    }
                    return true;
                }
            }
        }

        if (fg) fg.classList.remove('invalid');
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = '';
        }
        return true;
    };

    const updateTrongSoKyThuatVisibility = () => {
        if (!gtTrongSoKyThuatContainer || !gtPhuongPhapDanhGiaSelect) return;
        if (gtPhuongPhapDanhGiaSelect.value === 'Kết hợp giữa kỹ thuật và giá') {
            gtTrongSoKyThuatContainer.style.display = 'flex';
            if (gtTrongSoKyThuatInput) gtTrongSoKyThuatInput.setAttribute('required', 'true');
            validateTrongSoKyThuat();
        } else {
            gtTrongSoKyThuatContainer.style.display = 'none';
            if (gtTrongSoKyThuatInput) {
                gtTrongSoKyThuatInput.removeAttribute('required');
            }
            const fg = gtTrongSoKyThuatInput?.closest('.form-group');
            if (fg) fg.classList.remove('invalid');
            const errorEl = document.getElementById('gt-trongsokythuat-error');
            if (errorEl) {
                errorEl.textContent = '';
                errorEl.style.display = '';
            }
        }
    };

    const updatePhuongPhapDanhGiaOptions = (forceDefault = false) => {
        if (!gtPhuongPhapDanhGiaSelect || !gtPhuongPhapDanhGiaContainer) return;

        const linhVucVal = gtLinhVucSelect ? gtLinhVucSelect.value : '';
        const phuongThucVal = gtPhuongThucSelect ? gtPhuongThucSelect.value : '';
        const hinhThucVal = gtHinhThucSelect ? gtHinhThucSelect.value : '';

        if (!hinhThucVal || hinhThucVal === 'Chỉ định thầu rút gọn' || hinhThucVal === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
            gtPhuongPhapDanhGiaContainer.style.display = 'none';
            gtPhuongPhapDanhGiaSelect.removeAttribute('required');
            gtPhuongPhapDanhGiaSelect.value = '';
            gtTrongSoKyThuatContainer.style.display = 'none';
            return;
        }

        gtPhuongPhapDanhGiaContainer.style.display = 'flex';
        gtPhuongPhapDanhGiaSelect.setAttribute('required', 'true');

        const currentVal = gtPhuongPhapDanhGiaSelect.value;
        let optionsHtml = '';

        if (linhVucVal === 'Tư vấn') {
            optionsHtml += `
                <option value="Kết hợp giữa kỹ thuật và giá">Kết hợp giữa kỹ thuật và giá</option>
                <option value="Giá thấp nhất">Giá thấp nhất</option>
                <option value="Giá cố định">Giá cố định</option>
                <option value="Dựa trên kỹ thuật">Dựa trên kỹ thuật</option>
            `;
        } else {
            if (phuongThucVal === 'Một giai đoạn hai túi hồ sơ') {
                optionsHtml += `
                    <option value="Giá thấp nhất">Giá thấp nhất</option>
                    <option value="Giá đánh giá">Giá đánh giá</option>
                    <option value="Kết hợp giữa kỹ thuật và giá">Kết hợp giữa kỹ thuật và giá</option>
                `;
            } else {
                optionsHtml += `
                    <option value="Giá thấp nhất">Giá thấp nhất</option>
                    <option value="Giá đánh giá">Giá đánh giá</option>
                `;
            }
        }

        gtPhuongPhapDanhGiaSelect.innerHTML = optionsHtml;

        const validOptions = Array.from(gtPhuongPhapDanhGiaSelect.options).map(o => o.value);
        if (!forceDefault && currentVal && validOptions.includes(currentVal)) {
            gtPhuongPhapDanhGiaSelect.value = currentVal;
        } else {
            if (linhVucVal === 'Tư vấn') {
                gtPhuongPhapDanhGiaSelect.value = 'Kết hợp giữa kỹ thuật và giá';
            } else {
                gtPhuongPhapDanhGiaSelect.value = 'Giá thấp nhất';
            }
        }

        updateTrongSoKyThuatVisibility();
    };

    if (gtPhuongPhapDanhGiaSelect) {
        gtPhuongPhapDanhGiaSelect.addEventListener('change', updateTrongSoKyThuatVisibility);
        this.updateTrongSoKyThuatVisibility = updateTrongSoKyThuatVisibility;
        this.updatePhuongPhapDanhGiaOptions = updatePhuongPhapDanhGiaOptions;
    }

    if (gtTrongSoKyThuatInput) {
        gtTrongSoKyThuatInput.addEventListener('input', validateTrongSoKyThuat);
        gtTrongSoKyThuatInput.addEventListener('change', validateTrongSoKyThuat);
        this.validateTrongSoKyThuat = validateTrongSoKyThuat;
    }

    if (gtPhuongThucSelect) {
        gtPhuongThucSelect.addEventListener('change', () => {
            updatePhuongPhapDanhGiaOptions();
        });
    }

    if (gtHinhThucSelect && gtPhuongThucSelect && gtPhuongThucContainer) {
        const handleHinhThucChange = () => {
            const val = gtHinhThucSelect.value;
            const linhVucVal = gtLinhVucSelect ? gtLinhVucSelect.value : '';
            const gtQuaMangSelect = document.getElementById('gt-quatmang');

            if (!val) {
                gtPhuongThucContainer.style.display = 'none';
                gtPhuongThucSelect.removeAttribute('required');
            } else {
                gtPhuongThucContainer.style.display = 'flex';
                gtPhuongThucSelect.setAttribute('required', 'true');

                if (linhVucVal === 'Tư vấn') {
                    if (val === 'Chỉ định thầu rút gọn' || val === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                        gtPhuongThucSelect.value = 'Không có';
                        gtPhuongThucSelect.disabled = true;
                    } else {
                        gtPhuongThucSelect.value = 'Một giai đoạn hai túi hồ sơ';
                        gtPhuongThucSelect.disabled = true;
                    }
                } else {
                    if (val === 'Chào hàng cạnh tranh') {
                        gtPhuongThucSelect.value = 'Một giai đoạn một túi hồ sơ';
                        gtPhuongThucSelect.disabled = true;
                    } else if (val === 'Chỉ định thầu rút gọn' || val === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                        gtPhuongThucSelect.value = 'Không có';
                        gtPhuongThucSelect.disabled = true;
                    } else {
                        gtPhuongThucSelect.disabled = false;
                    }
                }
            }

            if (gtQuaMangSelect) {
                if (val === 'Chỉ định thầu rút gọn' || val === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                    gtQuaMangSelect.value = 'Không qua mạng';
                    gtQuaMangSelect.disabled = true;
                } else {
                    gtQuaMangSelect.disabled = false;
                }
                if (this.handleQuaMangChange) {
                    this.handleQuaMangChange();
                }
            }

            if (window.initCustomSelect) {
                window.initCustomSelect('gt-phuongthuc');
                window.initCustomSelect('gt-quatmang');
            }

            // Cập nhật phương pháp đánh giá khi hình thức thay đổi
            updatePhuongPhapDanhGiaOptions();

            // Toggle Tổ chuyên gia và Tổ thẩm định theo Hình thức
            const toChuyenGiaSection = document.getElementById('to-chuyengia-section');
            const toThamDinhSection = document.getElementById('to-thamdinh-section');
            if (toChuyenGiaSection && toThamDinhSection) {
                if (val === 'Chào hàng cạnh tranh') {
                    toChuyenGiaSection.style.display = 'flex';
                    toThamDinhSection.style.display = 'none';
                } else if (val === 'Đấu thầu rộng rãi' || val === 'Đấu thầu hạn chế' || val === 'Chỉ định thầu') {
                    toChuyenGiaSection.style.display = 'flex';
                    toThamDinhSection.style.display = 'flex';
                } else if (val === 'Chỉ định thầu rút gọn' || val === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                    toChuyenGiaSection.style.display = 'none';
                    toThamDinhSection.style.display = 'none';
                } else {
                    toChuyenGiaSection.style.display = 'flex';
                    toThamDinhSection.style.display = 'none';
                }
            }
        };
        gtHinhThucSelect.addEventListener('change', handleHinhThucChange);
        this.handleHinhThucChange = handleHinhThucChange;
    }

    const gtTuyChonContainer = document.getElementById('gt-tuychonmuathem-container');
    const gtPhanLoContainer = document.getElementById('gt-phanlo-container');
    const gtPhanLoTableContainer = document.getElementById('gt-phanlo-table-container');

    if (gtLinhVucSelect && gtHinhThucSelect && gtPhuongThucSelect && gtPhuongThucContainer) {
        const handleLinhVucChange = () => {
            const val = gtLinhVucSelect.value;
            const options = gtHinhThucSelect.querySelectorAll('option');
            if (val === 'Tư vấn') {
                options.forEach(opt => {
                    const optVal = opt.value;
                    if (optVal === 'Đấu thầu rộng rãi' || optVal === 'Chỉ định thầu' || optVal === 'Chỉ định thầu rút gọn' || optVal === '' || optVal === 'Tất cả hình thức') {
                        opt.style.display = '';
                    } else {
                        opt.style.display = 'none';
                    }
                });

                if (gtHinhThucSelect.value !== 'Đấu thầu rộng rãi' && gtHinhThucSelect.value !== 'Chỉ định thầu' && gtHinhThucSelect.value !== 'Chỉ định thầu rút gọn') {
                    gtHinhThucSelect.value = 'Đấu thầu rộng rãi';
                }
                gtHinhThucSelect.disabled = false;
            } else {
                options.forEach(opt => opt.style.display = '');
                gtHinhThucSelect.disabled = false;
            }

            if (this.handleHinhThucChange) {
                this.handleHinhThucChange();
            }

            // Cập nhật phương pháp đánh giá khi lĩnh vực thay đổi
            updatePhuongPhapDanhGiaOptions(true);

            if (gtTuyChonContainer) {
                gtTuyChonContainer.style.display = 'flex';
                if (this.handleTuyChonMuaThemChange) this.handleTuyChonMuaThemChange();
            }
            if (gtPhanLoContainer) {
                gtPhanLoContainer.style.display = 'flex';
                if (this.handlePhanLoChange) this.handlePhanLoChange();
            }

            const gtGoiThauThuocContainer = document.getElementById('gt-goithauthuoc-container');
            if (gtGoiThauThuocContainer) {
                if (val === 'Hàng hóa') {
                    gtGoiThauThuocContainer.style.display = '';
                } else {
                    gtGoiThauThuocContainer.style.display = 'none';
                    const radioNo = document.querySelector('input[name="gt-goithauthuoc"][value="0"]');
                    if (radioNo) radioNo.checked = true;
                }
            }
        };
        gtLinhVucSelect.addEventListener('change', handleLinhVucChange);
        this.handleLinhVucChange = handleLinhVucChange;
    }

    const gtTuyChonMuaThemSelect = document.getElementById('gt-tuychonmuathem');
    const gtTuyChonMuaThemTableContainer = document.getElementById('gt-tuychonmuathem-table-container');
    if (gtTuyChonMuaThemSelect && gtTuyChonMuaThemTableContainer) {
        const handleTuyChonMuaThemChange = () => {
            if (gtTuyChonMuaThemSelect.value === 'Có') {
                gtTuyChonMuaThemTableContainer.style.display = 'block';
                const tbody = document.getElementById('tuychonmuathem-tbody');
                if (tbody && tbody.children.length === 0) {
                    this.addTuyChonMuaThemRow();
                }
            } else {
                gtTuyChonMuaThemTableContainer.style.display = 'none';
            }
        };
        gtTuyChonMuaThemSelect.addEventListener('change', handleTuyChonMuaThemChange);
        this.handleTuyChonMuaThemChange = handleTuyChonMuaThemChange;
    }

    const btnThemTuyChon = document.getElementById('btn-them-tuychonmuathem');
    if (btnThemTuyChon) {
        btnThemTuyChon.addEventListener('click', () => this.addTuyChonMuaThemRow());
    }

    const gtPhanLoSelect = document.getElementById('gt-phanlo');
    if (gtPhanLoSelect && gtPhanLoTableContainer) {
        const handlePhanLoChange = () => {
            if (gtPhanLoSelect.value === 'Có') {
                gtPhanLoTableContainer.style.display = 'block';
                const tbody = document.getElementById('phanlo-tbody');
                if (tbody && tbody.children.length === 0) {
                    this.addPhanLoRow();
                }
            } else {
                gtPhanLoTableContainer.style.display = 'none';
            }
        };
        gtPhanLoSelect.addEventListener('change', handlePhanLoChange);
        this.handlePhanLoChange = handlePhanLoChange;
    }

    const btnThemPhanLo = document.getElementById('btn-them-phanlo');
    if (btnThemPhanLo) {
        btnThemPhanLo.addEventListener('click', () => this.addPhanLoRow());
    }

    const btnThemGiaHan = document.getElementById('btn-them-giahan');
    if (btnThemGiaHan) {
        btnThemGiaHan.addEventListener('click', () => this.addGiaHanRow());
    }

    const btnThemYeuCau = document.getElementById('btn-them-yeucaulamro');
    if (btnThemYeuCau) {
        btnThemYeuCau.addEventListener('click', () => this.addYeuCauLamRoRow());
    }

    const btnThemTraLoi = document.getElementById('btn-them-traloilamro');
    if (btnThemTraLoi) {
        btnThemTraLoi.addEventListener('click', () => this.addTraLoiLamRoRow());
    }

    const btnTemplatePhanLo = document.getElementById('btn-template-phanlo');
    const btnImportPhanLo = document.getElementById('btn-import-excel-phanlo');
    const inputImportPhanLo = document.getElementById('excel-file-input-phanlo');

    const downloadInlineTemplate = (type, btn) => {
        if (!type || !btn) return;
        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Đang tải...';

        fetch(`/api/export-excel-template/${type}`, {
            headers: {
                'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
                'X-Username': sessionStorage.getItem('bf_username') || ''
            }
        })
            .then(res => {
                if (!res.ok) throw new Error('Không thể tải tệp mẫu');
                return res.blob();
            })
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Mau_nhap_lieu_${type}.xlsx`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            })
            .catch(err => this.view.customAlert('Lỗi tải mẫu', 'Lỗi tải Excel mẫu: ' + err.message, 'x-circle'))
            .finally(() => {
                btn.disabled = false;
                btn.innerHTML = originalText;
            });
    };

    if (btnTemplatePhanLo) {
        btnTemplatePhanLo.addEventListener('click', () => this.exportEditPhanLoExcel());
    }

    if (btnImportPhanLo && inputImportPhanLo) {
        btnImportPhanLo.addEventListener('click', () => inputImportPhanLo.click());
        inputImportPhanLo.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleInlineExcelUpload(e.target.files[0], 'phanlo');
                inputImportPhanLo.value = '';
            }
        });
    }

    const btnTemplateTuyChon = document.getElementById('btn-template-tuychonmuathem');
    const btnImportTuyChon = document.getElementById('btn-import-excel-tuychonmuathem');
    const inputImportTuyChon = document.getElementById('excel-file-input-tuychonmuathem');

    if (btnTemplateTuyChon) {
        btnTemplateTuyChon.addEventListener('click', () => this.exportEditTuyChonMuaThemExcel());
    }

    if (btnImportTuyChon && inputImportTuyChon) {
        btnImportTuyChon.addEventListener('click', () => inputImportTuyChon.click());
        inputImportTuyChon.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleInlineExcelUpload(e.target.files[0], 'tuychonmuathem');
                inputImportTuyChon.value = '';
            }
        });
    }

    const gtQuaMangSelect = document.getElementById('gt-quatmang');
    const gtTrongNuocSelect = document.getElementById('gt-trongnuocquocte');
    if (gtQuaMangSelect && gtTrongNuocSelect) {
        const handleQuaMangChange = () => {
            if (gtQuaMangSelect.value === 'Qua mạng') {
                gtTrongNuocSelect.value = 'Trong nước';
                gtTrongNuocSelect.disabled = true;
            } else {
                gtTrongNuocSelect.disabled = false;
            }
        };
        gtQuaMangSelect.addEventListener('change', handleQuaMangChange);
        this.handleQuaMangChange = handleQuaMangChange;
    }

    document.getElementById('form-chudautu').addEventListener('submit', (e) => this.handleChuDauTuSubmit(e));
    document.getElementById('form-nhathau').addEventListener('submit', (e) => this.handleNhaThauSubmit(e));
    document.getElementById('form-chuyengia').addEventListener('submit', (e) => this.handleChuyenGiaSubmit(e));

    const formHopDong = document.getElementById('form-hopdong');
    if (formHopDong) {
        formHopDong.addEventListener('submit', (e) => this.handleHopDongSubmit(e));
    }

    document.querySelectorAll('.btn-import-excel').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-type');
            this.triggerExcelImport(type);
        });
    });
}


export function handleInlineExcelUpload(file, type) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);

    const tbody = document.getElementById(`${type}-tbody`);
    const originalHTML = tbody.innerHTML;
    tbody.innerHTML = `<tr><td colspan="${type === 'phanlo' ? 5 : 6}" style="text-align: center; padding: 20px; font-weight: bold; color: var(--primary);">
        Đang tải dữ liệu và phân tích file Excel...
    </td></tr>`;

    fetch('/api/import-excel', {
        method: 'POST',
        body: fd
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                tbody.innerHTML = '';
                const validRows = data.rows.filter(r => r._valid);
                if (validRows.length === 0) {
                    this.view.customAlert('Không có dữ liệu', 'Không tìm thấy dòng dữ liệu hợp lệ nào trong tệp Excel!', 'alert-triangle');
                    tbody.innerHTML = originalHTML;
                    return;
                }

                validRows.forEach(row => {
                    delete row._valid;
                    delete row._comment;
                    if (type === 'phanlo') {
                        this.addPhanLoRow(row);
                    } else if (type === 'tuychonmuathem') {
                        this.addTuyChonMuaThemRow(row);
                    }
                });
                this.view.customAlert('Nhập thành công', `Đã nhập thành công ${validRows.length} dòng dữ liệu từ Excel vào bảng!`, 'check-circle');
            } else {
                this.view.customAlert('Lỗi phân tích', 'Lỗi phân tích Excel: ' + (data.error || 'Không rõ nguyên nhân'), 'x-circle');
                tbody.innerHTML = originalHTML;
            }
        })
        .catch(err => {
            this.view.customAlert('Lỗi kết nối', 'Lỗi kết nối: ' + err.message, 'x-circle');
            tbody.innerHTML = originalHTML;
        });
}


export function updatePackageFieldsVisibility(isReadOnly = false) {
    const trangThai = document.getElementById('gt-trangthai')?.value;
    const formGoiThau = document.getElementById('form-goithau');
    const originalStatus = formGoiThau?.getAttribute('data-original-status') || '';
    const htVal = document.getElementById('gt-hinhthuc')?.value || '';

    // Hide/show status select based on hình thức
    const gtTrangThai = document.getElementById('gt-trangthai');
    if (gtTrangThai) {
        const formGroup = gtTrangThai.closest('.form-group');
        if (htVal === 'Chỉ định thầu rút gọn' || htVal === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
            if (formGroup) formGroup.style.display = 'none';
            gtTrangThai.removeAttribute('required');
        } else {
            if (formGroup) formGroup.style.display = 'flex';
            gtTrangThai.setAttribute('required', 'true');
        }
    }

    const statusOrder = ['Chuẩn bị', 'Đang mời thầu', 'Đã mở thầu', 'Đang chấm thầu', 'Đã có kết quả', 'Hủy thầu'];
    const currentIdx = statusOrder.indexOf(trangThai);
    const originalIdx = statusOrder.indexOf(originalStatus);

    // Disable status options earlier than originalStatus to enforce unidirectional progression
    // When adding new (originalIdx < 0), always reset all options to enabled
    const statusSelect = document.getElementById('gt-trangthai');
    if (statusSelect) {
        statusSelect.querySelectorAll('option').forEach(opt => {
            const optVal = opt.value;
            const optIdx = statusOrder.indexOf(optVal);
            if (originalIdx >= 0 && optIdx >= 0 && optIdx < originalIdx) {
                // Edit mode: disable options that are earlier than current status
                opt.disabled = true;
            } else {
                // New mode (originalIdx < 0): enable all options
                // Edit mode: enable options at or after current status
                opt.disabled = false;
            }
        });
    }

    // The 15 core fields that cannot be edited and are hidden/disabled in Đang mời thầu and later statuses
    const lockedFields = [
        'gt-kehoachid',
        'gt-ten',
        'gt-gia',
        'gt-thoigian',
        'gt-linhvuc',
        'gt-hinhthuc',
        'gt-phuongthuc',
        'gt-quatmang',
        'gt-trongnuocquocte',
        'gt-tuychonmuathem',
        'gt-phanlo',
        'gt-nguonvon',
        'gt-loaihopdong',
        'gt-thoigiantochuc',
        'gt-thoigianbatdautochuc'
    ];

    const isLocked = isReadOnly ? false : (originalIdx >= 1); // Transitioned to Đang mời thầu or later
    lockedFields.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const formGroup = input.closest('.form-group');
        if (isLocked) {
            if (formGroup) formGroup.style.display = 'none';
            input.disabled = true;
        } else {
            input.disabled = false;
            // Re-enforce disabled rules for gt-phuongthuc if needed
            if (id === 'gt-phuongthuc') {
                const lv = document.getElementById('gt-linhvuc')?.value;
                const ht = document.getElementById('gt-hinhthuc')?.value;
                if (lv === 'Tư vấn' || ht === 'Chào hàng cạnh tranh' || ht === 'Chỉ định thầu rút gọn' || ht === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                    input.disabled = true;
                }
                if (window.initCustomSelect) initCustomSelect(id);
            }
            if (id === 'gt-quatmang') {
                const ht = document.getElementById('gt-hinhthuc')?.value;
                if (ht === 'Chỉ định thầu rút gọn' || ht === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
                    input.disabled = true;
                }
                if (window.initCustomSelect) initCustomSelect(id);
            }
            // Restore visibility for non-conditional fields if unlocked
            const nonConditional = [
                'gt-kehoachid', 'gt-ten', 'gt-gia', 'gt-thoigian', 'gt-linhvuc', 'gt-hinhthuc',
                'gt-quatmang', 'gt-trongnuocquocte', 'gt-nguonvon', 'gt-loaihopdong', 'gt-thoigiantochuc', 'gt-thoigianbatdautochuc',
                'gt-tuychonmuathem', 'gt-phanlo'
            ];
            if (nonConditional.includes(id) && formGroup) {
                formGroup.style.display = 'flex';
            }
        }
    });

    // Hide table containers if locked
    const tuyChonTable = document.getElementById('gt-tuychonmuathem-table-container');
    const phanLoTable = document.getElementById('gt-phanlo-table-container');
    if (isLocked) {
        if (tuyChonTable) tuyChonTable.style.display = 'none';
        if (phanLoTable) phanLoTable.style.display = 'none';
    }

    const phuongThuc = document.getElementById('gt-phuongthuc')?.value || '';
    const is1G2T = phuongThuc === 'Một giai đoạn hai túi hồ sơ';
    const isOpenedOrLaterStatus = (trangThai === 'Đã mở thầu' || trangThai === 'Đang chấm thầu' || trangThai === 'Đã có kết quả' || trangThai === 'Hủy thầu');

    const fields = [
        { id: 'gt-soquyetdinh', required: true, label: 'Số QĐ phê duyệt' },
        { id: 'gt-ngayquyetdinh', required: true, label: 'Ngày QĐ phê duyệt' },
        { id: 'gt-thoigiandangtai', required: true, label: 'Thời gian đăng tải thông báo' },
        { id: 'gt-thoigiandongthau', required: true, label: 'Thời gian đóng thầu' },
        { id: 'gt-thoigianmothau', required: isOpenedOrLaterStatus, label: is1G2T ? 'Thời gian mở E-HSĐXKT' : 'Thời gian mở thầu' },
        { id: 'gt-thoigianmoehsdxtc', required: (is1G2T && isOpenedOrLaterStatus), label: 'Thời gian mở E-HSĐXTC' }
    ];

    fields.forEach(f => {
        const input = document.getElementById(f.id);
        if (!input) return;
        const formGroup = input.closest('.form-group');
        if (!formGroup) return;

        const label = formGroup.querySelector('label');

        if (htVal === 'Chỉ định thầu rút gọn' || htVal === 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
            if (['gt-soquyetdinh', 'gt-ngayquyetdinh', 'gt-thoigiandangtai', 'gt-thoigiandongthau', 'gt-thoigianmothau', 'gt-thoigianmoehsdxtc'].includes(f.id)) {
                formGroup.style.display = 'none';
                input.removeAttribute('required');
                return;
            }
        }

        if (trangThai === 'Chuẩn bị') {
            formGroup.style.display = 'none';
            input.removeAttribute('required');
            if (label) {
                label.innerHTML = f.label;
            }
        } else if (trangThai === 'Đang mời thầu' && (f.id === 'gt-thoigianmothau' || f.id === 'gt-thoigianmoehsdxtc')) {
            formGroup.style.display = 'none';
            input.removeAttribute('required');
        } else if (f.id === 'gt-thoigianmoehsdxtc' && !is1G2T) {
            formGroup.style.display = 'none';
            input.removeAttribute('required');
        } else {
            formGroup.style.display = 'flex';
            if (f.required) {
                input.setAttribute('required', 'true');
                if (label && !label.querySelector('.required')) {
                    label.innerHTML = `${f.label} <span class="required">*</span>`;
                } else if (label) {
                    label.innerHTML = `${f.label} <span class="required">*</span>`;
                }
            } else {
                input.removeAttribute('required');
                if (label) {
                    label.innerHTML = f.label;
                }
            }
        }
    });

    const maInput = document.getElementById('gt-ma');
    if (maInput) {
        const formGroup = maInput.closest('.form-group');
        const label = formGroup?.querySelector('label');
        if (trangThai === 'Chuẩn bị') {
            maInput.removeAttribute('required');
            if (label) label.innerHTML = 'Mã thông báo mời thầu';
        } else {
            maInput.setAttribute('required', 'true');
            if (label && !label.querySelector('.required')) {
                label.innerHTML = 'Mã thông báo mời thầu <span class="required">*</span>';
            }
        }
    }

    const giaHanContainer = document.getElementById('gt-giahan-container');
    if (giaHanContainer) {
        giaHanContainer.style.display = (trangThai !== 'Chuẩn bị') ? 'flex' : 'none';
    }

    const yeuCauLamRoContainer = document.getElementById('gt-yeucaulamro-container');
    const traLoiLamRoContainer = document.getElementById('gt-traloilamro-container');
    const showClarifications = trangThai !== 'Chuẩn bị';

    if (yeuCauLamRoContainer) {
        yeuCauLamRoContainer.style.display = showClarifications ? 'flex' : 'none';
    }
    if (traLoiLamRoContainer) {
        traLoiLamRoContainer.style.display = showClarifications ? 'flex' : 'none';
    }

    // Logic ẩn/hiện và thuộc tính required/readonly cho 3 trường mới
    const linhVuc = document.getElementById('gt-linhvuc')?.value || '';
    const phanLo = document.getElementById('gt-phanlo')?.value || '';
    const mainBaoDamInput = document.getElementById('gt-giatribaomothau');
    const hieulucHsdtInput = document.getElementById('gt-hieuluchsdt');
    const hieulucBaoDamInput = document.getElementById('gt-hieuluchbaomothau');

    const containerBaoDam = document.getElementById('gt-giatribaomothau-container');
    const containerHsdt = document.getElementById('gt-hieuluchsdt-container');
    const containerHlBaoDam = document.getElementById('gt-hieuluchbaomothau-container');

    const thBaoDam = document.getElementById('th-baodam-phanlo');

    // Lĩnh vực tư vấn không yêu cầu bảo đảm dự thầu, tất cả lĩnh vực khác đều yêu cầu (hiển thị để nhập)
    const ht = document.getElementById('gt-hinhthuc')?.value || '';
    const noBidSecurity = (linhVuc === 'Tư vấn' || ht === 'Chỉ định thầu rút gọn' || ht === 'Lựa chọn nhà thầu trong trường hợp đặc biệt');
    if (noBidSecurity) {
        if (containerBaoDam) containerBaoDam.style.display = 'none';
        if (containerHlBaoDam) containerHlBaoDam.style.display = 'none';

        if (mainBaoDamInput) mainBaoDamInput.removeAttribute('required');

        if (thBaoDam) thBaoDam.style.display = 'none';
        document.querySelectorAll('.col-baodam-phanlo-cell').forEach(cell => {
            cell.style.display = 'none';
            const input = cell.querySelector('input');
            if (input) input.removeAttribute('required');
        });
    } else {
        if (containerBaoDam) containerBaoDam.style.display = 'flex';
        if (containerHlBaoDam) {
            if (trangThai === 'Chuẩn bị') {
                containerHlBaoDam.style.display = 'none';
            } else {
                containerHlBaoDam.style.display = 'flex';
            }
        }

        const isMoiThauOrLater = (trangThai !== 'Chuẩn bị');
        if (mainBaoDamInput) {
            if (isMoiThauOrLater) {
                mainBaoDamInput.setAttribute('required', 'true');
            } else {
                mainBaoDamInput.removeAttribute('required');
            }
        }

        if (phanLo === 'Có') {
            if (mainBaoDamInput) {
                mainBaoDamInput.setAttribute('readonly', 'true');
                mainBaoDamInput.style.background = 'var(--neutral-soft)';
                mainBaoDamInput.style.cursor = 'not-allowed';
                mainBaoDamInput.removeAttribute('required');
            }

            if (thBaoDam) thBaoDam.style.display = '';
            document.querySelectorAll('.col-baodam-phanlo-cell').forEach(cell => {
                cell.style.display = '';
                const input = cell.querySelector('input');
                if (input) {
                    if (isMoiThauOrLater) {
                        input.setAttribute('required', 'true');
                    } else {
                        input.removeAttribute('required');
                    }
                }
            });
            this.recalculateTotalLotSecurities();
        } else {
            if (mainBaoDamInput) {
                mainBaoDamInput.removeAttribute('readonly');
                mainBaoDamInput.style.background = '';
                mainBaoDamInput.style.cursor = 'auto';
            }

            if (thBaoDam) thBaoDam.style.display = 'none';
            document.querySelectorAll('.col-baodam-phanlo-cell').forEach(cell => {
                cell.style.display = 'none';
                const input = cell.querySelector('input');
                if (input) input.removeAttribute('required');
            });
        }
    }

    // Thời gian hiệu lực hồ sơ dự thầu chỉ hiện khi ở trạng thái Đang mời thầu hoặc muộn hơn
    if (trangThai === 'Chuẩn bị') {
        if (containerHsdt) containerHsdt.style.display = 'none';
        if (hieulucHsdtInput) hieulucHsdtInput.removeAttribute('required');
    } else {
        if (containerHsdt) containerHsdt.style.display = 'flex';
        if (hieulucHsdtInput) hieulucHsdtInput.setAttribute('required', 'true');
    }

    const gtGoiThauThuocContainer = document.getElementById('gt-goithauthuoc-container');
    if (gtGoiThauThuocContainer) {
        if (isLocked) {
            gtGoiThauThuocContainer.style.display = 'none';
            gtGoiThauThuocContainer.querySelectorAll('input[name="gt-goithauthuoc"]').forEach(r => r.disabled = true);
        } else {
            gtGoiThauThuocContainer.style.display = (linhVuc === 'Hàng hóa') ? '' : 'none';
            gtGoiThauThuocContainer.querySelectorAll('input[name="gt-goithauthuoc"]').forEach(r => r.disabled = isReadOnly);
        }
    }
}


export function recalculateTotalLotSecurities() {
    const phanLo = document.getElementById('gt-phanlo')?.value;
    const linhVuc = document.getElementById('gt-linhvuc')?.value;
    const ht = document.getElementById('gt-hinhthuc')?.value;
    if (phanLo === 'Có' && linhVuc !== 'Tư vấn' && ht !== 'Chỉ định thầu rút gọn' && ht !== 'Lựa chọn nhà thầu trong trường hợp đặc biệt') {
        let sum = 0;
        document.querySelectorAll('#phanlo-tbody tr').forEach(tr => {
            const baodamInput = tr.querySelector('.pl-baodam-input');
            if (baodamInput) {
                sum += this.model.parseVND(baodamInput.value);
            }
        });
        const mainBaoDamInput = document.getElementById('gt-giatribaomothau');
        if (mainBaoDamInput) {
            mainBaoDamInput.value = this.model.formatVND(sum);
        }
    }
}


export function updateAwardedContractorUI(defaultDataList = null) {
    const trangThai = document.getElementById('gt-trangthai')?.value;
    const phanLo = document.getElementById('gt-phanlo')?.value;
    const condBlock = document.getElementById('conditional-awarded-contractor');
    const singleContainer = document.getElementById('awarded-single-container');
    const multiContainer = document.getElementById('awarded-multi-container');

    if (!condBlock) return;

    if (trangThai !== 'Đã có kết quả') {
        condBlock.style.display = 'none';
        document.getElementById('gt-nhathautrungthauid')?.removeAttribute('required');
        document.getElementById('gt-giatrungthau')?.removeAttribute('required');
        document.getElementById('gt-thoigian-goithau')?.removeAttribute('required');
        document.getElementById('gt-thoigian-hopdong')?.removeAttribute('required');
        return;
    }

    condBlock.style.display = 'block';

    if (phanLo === 'Có') {
        singleContainer.style.display = 'none';
        multiContainer.style.display = 'block';

        document.getElementById('gt-nhathautrungthauid')?.removeAttribute('required');
        document.getElementById('gt-giatrungthau')?.removeAttribute('required');
        document.getElementById('gt-thoigian-goithau')?.removeAttribute('required');
        document.getElementById('gt-thoigian-hopdong')?.removeAttribute('required');

        const tbody = document.getElementById('awarded-phanlo-tbody');
        if (tbody) {
            const phanLoList = this._collectPhanLoRows();
            const currentInputsMap = {};
            tbody.querySelectorAll('tr').forEach(tr => {
                const ten = tr.cells[0]?.textContent;
                if (ten) {
                    currentInputsMap[ten] = {
                        nhaThauTrungThauId: tr.querySelector('.awarded-pl-nhathau')?.value || '',
                        giaTrungThau: this.model.parseVND(tr.querySelector('.awarded-pl-gia')?.value || ''),
                        thoiGianGoiThau: tr.querySelector('.awarded-pl-tggoithau')?.value || '',
                        thoiGianHopDong: tr.querySelector('.awarded-pl-tghopdong')?.value || ''
                    };
                }
            });

            tbody.innerHTML = '';

            if (phanLoList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 16px; color: var(--text-muted); font-weight: 600;">Vui lòng thêm danh sách phần lô ở trên trước.</td></tr>`;
                return;
            }

            const goiThauId = document.getElementById('form-goithau-id')?.value;
            let filteredBids = [];
            if (goiThauId) {
                filteredBids = this.model.state.thongtinmothau.filter(b => String(b.goiThauId) === String(goiThauId));
            }

            phanLoList.forEach((pl) => {
                // Find bids that match both goiThauId AND the specific Lot (pl.maPhanLo or pl.tenPhanLo)
                let lotBids = filteredBids.filter(b => String(b.maPhanLo) === String(pl.maPhanLo) || String(b.tenPhanLo) === String(pl.tenPhanLo));
                if (lotBids.length === 0) {
                    lotBids = filteredBids;
                }

                const uniqueBiddersMap = new Map();
                lotBids.forEach(b => {
                    if (b.nhaThauId) {
                        const key = String(b.nhaThauId);
                        if (!uniqueBiddersMap.has(key) || (b.tenNhaThau && !uniqueBiddersMap.get(key).tenNhaThau)) {
                            uniqueBiddersMap.set(key, b);
                        }
                    }
                });
                const uniqueBidders = Array.from(uniqueBiddersMap.values());

                const nhathauOptions = uniqueBidders.length > 0
                    ? uniqueBidders.map(b => `<option value="${b.nhaThauId}">${b.tenNhaThau}</option>`).join('')
                    : this.model.state.nhathau.map(n => `<option value="${n.id}">${n.tenNhaThau}</option>`).join('');

                const row = document.createElement('tr');
                let matchedData = null;
                if (defaultDataList && defaultDataList.length > 0) {
                    matchedData = defaultDataList.find(d => d.tenPhanLo === pl.tenPhanLo);
                }
                if (!matchedData && currentInputsMap[pl.tenPhanLo]) {
                    matchedData = currentInputsMap[pl.tenPhanLo];
                }

                const selectedNt = matchedData?.nhaThauTrungThauId || '';
                const giaTri = matchedData?.giaTrungThau ? this.model.formatVND(matchedData.giaTrungThau) : '';
                const tgGoiThau = matchedData?.thoiGianGoiThau || '';
                const tgHopDong = matchedData?.thoiGianHopDong || '';

                row.innerHTML = `
                    <td style="font-weight: 600; font-size: 0.84rem; color: var(--text-main);">${pl.tenPhanLo}</td>
                    <td>
                        <select class="awarded-pl-nhathau" required style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                            <option value="">-- Chọn Nhà thầu --</option>
                            ${nhathauOptions}
                        </select>
                    </td>
                    <td>
                        <input type="text" class="awarded-pl-gia input-gia" required value="${giaTri}" placeholder="Nhập giá trúng" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                    </td>
                    <td>
                        <input type="text" class="awarded-pl-tggoithau" required value="${tgGoiThau}" placeholder="Ví dụ: 90 ngày" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                    </td>
                    <td>
                        <input type="text" class="awarded-pl-tghopdong" required value="${tgHopDong}" placeholder="Ví dụ: 90 ngày" style="width: 100%; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-main); font-weight: 600;">
                    </td>
                `;

                const sel = row.querySelector('.awarded-pl-nhathau');
                if (sel) sel.value = selectedNt;

                const giaInput = row.querySelector('.awarded-pl-gia');
                if (giaInput) {
                    giaInput.addEventListener('input', (e) => {
                        const cursorPosition = e.target.selectionStart;
                        const originalLength = e.target.value.length;
                        e.target.value = this.model.formatVND(e.target.value);
                        const newLength = e.target.value.length;
                        e.target.setSelectionRange(cursorPosition + (newLength - originalLength), cursorPosition + (newLength - originalLength));
                    });
                }

                tbody.appendChild(row);
            });
        }
    } else {
        singleContainer.style.display = 'block';
        multiContainer.style.display = 'none';

        document.getElementById('gt-nhathautrungthauid')?.setAttribute('required', 'true');
        document.getElementById('gt-giatrungthau')?.setAttribute('required', 'true');
        document.getElementById('gt-thoigian-goithau')?.setAttribute('required', 'true');
        document.getElementById('gt-thoigian-hopdong')?.setAttribute('required', 'true');
    }
}


export function _collectAwardedPhanLoRows() {
    const phanLo = document.getElementById('gt-phanlo')?.value;
    const trangThai = document.getElementById('gt-trangthai')?.value;
    if (phanLo !== 'Có' || trangThai !== 'Đã có kết quả') return [];

    const tbody = document.getElementById('awarded-phanlo-tbody');
    if (!tbody) return [];

    const rows = [];
    tbody.querySelectorAll('tr').forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 2) return;

        const tenPhanLo = cells[0].textContent;
        const nhaThauTrungThauId = tr.querySelector('.awarded-pl-nhathau')?.value || '';
        const giaTrungThau = this.model.parseVND(tr.querySelector('.awarded-pl-gia')?.value || '');
        const thoiGianGoiThau = tr.querySelector('.awarded-pl-tggoithau')?.value.trim() || '';
        const thoiGianHopDong = tr.querySelector('.awarded-pl-tghopdong')?.value.trim() || '';

        if (nhaThauTrungThauId || giaTrungThau > 0 || thoiGianGoiThau || thoiGianHopDong) {
            rows.push({
                tenPhanLo,
                nhaThauTrungThauId,
                giaTrungThau,
                thoiGianGoiThau,
                thoiGianHopDong
            });
        }
    });
    return rows;
}
