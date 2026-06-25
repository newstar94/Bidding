export function setupTheme() {
    const isDarkMode = localStorage.getItem(this.model.STORAGE_KEYS.THEME) === 'true';
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        this.view.elements.sunIcon.style.display = 'none';
        this.view.elements.moonIcon.style.display = 'block';
    }

    this.view.elements.themeToggle.addEventListener('click', () => {
        const active = document.body.classList.toggle('dark-mode');
        localStorage.setItem(this.model.STORAGE_KEYS.THEME, active);
        if (active) {
            this.view.elements.sunIcon.style.display = 'none';
            this.view.elements.moonIcon.style.display = 'block';
        } else {
            this.view.elements.sunIcon.style.display = 'block';
            this.view.elements.moonIcon.style.display = 'none';
        }
    });
}


export function setupSidebar() {
    const appContainer = document.querySelector('.app-container');
    const sidebar = this.view.elements.sidebar;

    // Restore collapse state from localStorage
    const isCollapsed = localStorage.getItem('bf_sidebar_collapsed') === 'true';
    if (isCollapsed) appContainer.classList.add('sidebar-collapsed');

    // Toggle collapse button (inside sidebar brand)
    const btnCollapse = document.getElementById('btn-sidebar-collapse');
    if (btnCollapse) {
        btnCollapse.addEventListener('click', () => {
            appContainer.classList.toggle('sidebar-collapsed');
            const collapsed = appContainer.classList.contains('sidebar-collapsed');
            localStorage.setItem('bf_sidebar_collapsed', collapsed);
            lucide.createIcons();
        });
    }

    // Brand icon: click to EXPAND when sidebar is collapsed
    const brandIcon = document.querySelector('.brand-icon');
    if (brandIcon) {
        brandIcon.addEventListener('click', () => {
            if (appContainer.classList.contains('sidebar-collapsed')) {
                appContainer.classList.remove('sidebar-collapsed');
                localStorage.setItem('bf_sidebar_collapsed', 'false');
                lucide.createIcons();
            }
        });
    }



    // Mobile toggle (existing menu-toggle-btn in header)
    this.view.elements.sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('active');
    });

    this.view.elements.navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            sidebar.classList.remove('active');
        });
    });

    const options = { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' };
    this.view.elements.currentDateSpan.textContent = new Date().toLocaleDateString('vi-VN', options);

    const profileCard = document.querySelector('.profile-card');
    if (profileCard) {
        profileCard.style.cursor = 'pointer';
        profileCard.addEventListener('click', () => {
            this.switchTab('profile');
            sidebar.classList.remove('active');
        });
    }
}


export function setupTabs() {
    this.view.elements.navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            this.switchTab(targetTab);
        });
    });

    const viewAllPackagesBtn = document.getElementById('btn-view-all-packages');
    if (viewAllPackagesBtn) {
        viewAllPackagesBtn.addEventListener('click', () => {
            this.switchTab('goithau');
        });
    }
}


export function handlePathRouting(pathname, updateState = true, isInit = false) {
    const cleanPath = pathname.startsWith('/') ? pathname.substring(1) : pathname;
    const parts = cleanPath.split('/').filter(Boolean);

    // Dịch URL Kebab-Case sang TabName nội bộ
    const urlTab = parts[0] || '';
    let tabName = '';
    for (const [key, val] of Object.entries(this.routeMap)) {
        if (val === urlTab) {
            tabName = key;
            break;
        }
    }
    if (!tabName) {
        tabName = this.model.state.activerole === 'super_admin' ? 'superadmin-dashboard' : 'dashboard';
    }

    let action = parts[1] || null;
    let urlAction = parts[1] || null;
    if (!action && urlAction) {
        action = urlAction;
    }

    // Map package code/plan code/contract number back to internal ID
    if (tabName === 'goithau-detail' && action) {
        const gt = this.model.state.goithau.find(g =>
            (g.maGoiThau && g.maGoiThau.toLowerCase() === action.toLowerCase()) ||
            (g.id && g.id.toLowerCase() === action.toLowerCase())
        );
        if (gt) {
            action = gt.id;
        }
    }
    if (tabName === 'kehoach-detail' && action) {
        let targetId = null;
        if (action.includes('_')) {
            const parts = action.split('_');
            const idSuffix = parts[parts.length - 1].toLowerCase();
            const kh = this.model.state.kehoach.find(k => k.id.toLowerCase().startsWith(idSuffix));
            if (kh) targetId = kh.id;
        }
        if (!targetId) {
            const kh = this.model.state.kehoach.find(k =>
                (k.maKeHoach && encodeURIComponent(k.maKeHoach).toLowerCase() === action.toLowerCase()) ||
                (k.id && k.id.toLowerCase() === action.toLowerCase())
            );
            if (kh) targetId = kh.id;
        }
        if (targetId) action = targetId;
    }
    if (tabName === 'hopdong-detail' && action) {
        let targetId = null;
        if (action.includes('_')) {
            const parts = action.split('_');
            const idSuffix = parts[parts.length - 1].toLowerCase();
            const hd = this.model.state.hopdong.find(h => h.id.toLowerCase().startsWith(idSuffix));
            if (hd) targetId = hd.id;
        }
        if (!targetId) {
            const cleanAction = decodeURIComponent(action).toLowerCase().replace(/[\/-]/g, '');
            const hd = this.model.state.hopdong.find(h => {
                const cleanSo = h.soHopDong ? h.soHopDong.toLowerCase().replace(/[\/-]/g, '') : '';
                return cleanSo === cleanAction || (h.id && h.id.toLowerCase() === action.toLowerCase());
            });
            if (hd) targetId = hd.id;
        }
        if (targetId) action = targetId;
    }

    if (isInit) {
        const finalUrlTab = this.routeMap[tabName] || tabName;
        let finalUrlAction = action ? (this.actionMap[action] || action) : null;
        if (tabName === 'goithau-detail' && action) {
            const gt = this.model.state.goithau.find(g => g.id === action);
            if (gt && gt.maGoiThau) {
                finalUrlAction = gt.maGoiThau;
            }
        }
        if (tabName === 'kehoach-detail' && action) {
            const kh = this.model.state.kehoach.find(k => k.id === action);
            if (kh && kh.maKeHoach) {
                const duplicates = this.model.state.kehoach.filter(k => k.maKeHoach === kh.maKeHoach);
                const isUnique = duplicates.length <= 1;
                finalUrlAction = encodeURIComponent(kh.maKeHoach) + (isUnique ? '' : '_' + kh.id.substring(0, 8));
            }
        }
        if (tabName === 'hopdong-detail' && action) {
            const hd = this.model.state.hopdong.find(h => h.id === action);
            if (hd && hd.soHopDong) {
                const duplicates = this.model.state.hopdong.filter(h => h.soHopDong === hd.soHopDong);
                const isUnique = duplicates.length <= 1;
                finalUrlAction = encodeURIComponent(hd.soHopDong.replace(/\//g, '-')) + (isUnique ? '' : '_' + hd.id.substring(0, 8));
            }
        }
        const path = '/' + finalUrlTab + (finalUrlAction ? '/' + finalUrlAction : '');
        if (window.location.pathname !== path) {
            history.replaceState({ tab: tabName, action: action }, '', path);
        }
    }

    this.switchTab(tabName, action, updateState);
}


export function switchTab(tabName, action = null, updateState = true) {
    this.model.state.activetab = tabName;
    this.model.state.activeaction = action;
    if (updateState) {
        const urlTab = this.routeMap[tabName] || tabName;
        let urlAction = action ? (this.actionMap[action] || action) : null;
        if (tabName === 'goithau-detail' && action) {
            const gt = this.model.state.goithau.find(g => g.id === action);
            if (gt && gt.maGoiThau) {
                urlAction = gt.maGoiThau;
            }
        }
        if (tabName === 'kehoach-detail' && action) {
            const kh = this.model.state.kehoach.find(k => k.id === action);
            if (kh && kh.maKeHoach) {
                const duplicates = this.model.state.kehoach.filter(k => k.maKeHoach === kh.maKeHoach);
                const isUnique = duplicates.length <= 1;
                urlAction = encodeURIComponent(kh.maKeHoach) + (isUnique ? '' : '_' + kh.id.substring(0, 8));
            }
        }
        if (tabName === 'hopdong-detail' && action) {
            const hd = this.model.state.hopdong.find(h => h.id === action);
            if (hd && hd.soHopDong) {
                const duplicates = this.model.state.hopdong.filter(h => h.soHopDong === hd.soHopDong);
                const isUnique = duplicates.length <= 1;
                urlAction = encodeURIComponent(hd.soHopDong.replace(/\//g, '-')) + (isUnique ? '' : '_' + hd.id.substring(0, 8));
            }
        }
        const path = '/' + urlTab + (urlAction ? '/' + urlAction : '');
        history.pushState({ tab: tabName, action: action }, '', path);
    }

    this.view.elements.navButtons.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    this.view.elements.tabPanes.forEach(pane => {
        if (pane.id === `tab-${tabName}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    const titleMap = {
        dashboard: 'Tổng quan hệ thống',
        kehoach: 'Kế hoạch lựa chọn nhà thầu',
        goithau: 'Danh sách Gói thầu',
        chudautu: 'Danh mục Chủ đầu tư',
        nhathau: 'Danh mục Nhà thầu',
        chuyengia: 'Tổ Chuyên gia Đấu thầu',
        hopdong: 'Danh sách Hợp đồng',
        bieumau: 'Quản lý Biểu mẫu & Từ điển',
        'superadmin-dashboard': 'Bảng điều khiển Super Admin BiddingFlow',
        superadmin: 'Quản lý Đơn vị & Tài khoản Thành viên',
        managernhanvien: 'Quản lý Chuyên viên & Phân quyền Matrix',
        managerhosogiay: 'Cấu hình Danh mục Trạng thái Hồ sơ giấy',
        mothau: 'Nhập thông tin Mở thầu (E-HSDT / E-HSĐXKT)',
        danhgiahsdt: 'Đánh giá Hồ sơ dự thầu (E-HSDT)',
        'goithau-detail': 'Chi tiết Quy trình Gói thầu',
        'kehoach-detail': 'Chi tiết Kế hoạch Lựa chọn Nhà thầu',
        'hopdong-detail': 'Chi tiết Hợp đồng',
        profile: 'Thông tin tài khoản cá nhân'
    };
    this.view.elements.pageTitle.textContent = titleMap[tabName] || 'Hệ thống Quản lý';

    this.renderTabData(tabName, action);

    // Handle Clean URL modal mappings
    if (action === 'taomoi') {
        setTimeout(() => {
            if (tabName === 'kehoach') {
                const modal = document.getElementById('modal-kehoach');
                if (modal && !modal.classList.contains('active')) this.editKeHoach(null);
            } else if (tabName === 'goithau') {
                const modal = document.getElementById('modal-goithau');
                if (modal && !modal.classList.contains('active')) this.editGoiThau(null);
            } else if (tabName === 'hopdong') {
                const modal = document.getElementById('modal-hopdong');
                if (modal && !modal.classList.contains('active')) this.editHopDong(null);
            } else if (tabName === 'chudautu') {
                const modal = document.getElementById('modal-chudautu');
                if (modal && !modal.classList.contains('active')) this.editChuDauTu(null);
            } else if (tabName === 'nhathau') {
                const modal = document.getElementById('modal-nhathau');
                if (modal && !modal.classList.contains('active')) this.editNhaThau(null);
            } else if (tabName === 'chuyengia') {
                const modal = document.getElementById('modal-chuyengia');
                if (modal && !modal.classList.contains('active')) this.editChuyenGia(null);
            }
        }, 100);
    } else if (!action) {
        // Auto close modal if we navigate back to parent route
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
        document.body.style.overflow = '';
    }
}


export function renderTabData(tabName, action = null) {
    lucide.createIcons();
    switch (tabName) {
        case 'dashboard':
            this.view.renderDashboard();
            break;
        case 'kehoach':
            this.view.renderKeHoachTable();
            break;
        case 'goithau':
            this.view.renderGoiThauTable();
            break;
        case 'chudautu':
            this.view.renderChuDauTuTable();
            break;
        case 'nhathau':
            this.view.renderNhaThauTable();
            break;
        case 'chuyengia':
            this.view.renderChuyenGiaTable();
            break;
        case 'hopdong':
            this.view.renderHopDongTable();
            break;
        case 'bieumau':
            this.loadWordTemplates();
            this.view.renderDictionary('global');
            this.setupCopyVariableEvents();
            break;
        case 'xuatword':
            this.initXuatWordTab();
            break;
        case 'superadmin-dashboard':
            this.view.renderSuperAdminDashboard();
            break;
        case 'superadmin':
            this.view.renderSuperAdminPanel();
            this.loadSystemUsers();
            break;
        case 'managernhanvien':
            this.reloadEmployeesFromDatabase().then(() => {
                this.view.renderManagerNhanVienPanel();
            });
            break;
        case 'managerhosogiay':
            this.view.renderManagerHoSoGiayPanel();
            break;
        case 'profile':
            this.view.renderProfileTab(this.model.state.activeuser);
            break;
        case 'mothau':
            this.renderMoThauPanel();
            break;
        case 'danhgiahsdt':
            this.renderDanhGiaHsdtPanel();
            break;
        case 'goithau-detail':
            const activeId = action || (history.state ? history.state.action : null);
            if (activeId) {
                this.view.showPackageDetails(activeId);
            } else {
                this.switchTab('goithau');
            }
            break;
        case 'kehoach-detail':
            const khId = action || (history.state ? history.state.action : null);
            if (khId) {
                this.view.showKeHoachDetails(khId);
            } else {
                this.switchTab('kehoach');
            }
            break;
        case 'hopdong-detail':
            const hdId = action || (history.state ? history.state.action : null);
            if (hdId) {
                this.view.showHopDongDetails(hdId);
            } else {
                this.switchTab('hopdong');
            }
            break;
    }
}


export async function closeModal(modalId) {
    if (modalId === 'modal-goithau' && this.packageWizard.active) {
        const confirmed = await this.view.customConfirm(
            'Xác nhận hủy',
            'Hệ thống đang trong quá trình thiết lập các gói thầu cho kế hoạch mới. Bạn có chắc chắn muốn hủy bỏ? Các gói thầu đã nhập trước đó vẫn được lưu lại.'
        );
        if (!confirmed) {
            return;
        }
        this.packageWizard.active = false;
        const planSelect = document.getElementById('gt-kehoachid');
        if (planSelect) planSelect.disabled = false;
    }

    if (modalId === 'modal-plan-breakdown') {
        // Rollback changes because they closed/cancelled the breakdown modal without saving
        if (this.backupKeHoachState) {
            this.model.state.kehoach = this.backupKeHoachState;
            this.backupKeHoachState = null;
        }
        if (this.backupGoiThauState) {
            this.model.state.goithau = this.backupGoiThauState;
            this.backupGoiThauState = null;
        }
        this.tempPlanData = null;
        this.tempPlanAction = null;

        this.model.persistData('kehoach');
        this.model.persistData('goithau');

        this.view.renderKeHoachTable();
        this.view.renderGoiThauTable();
        this.autoSync();
    }

    this.view.closeModal(modalId);

    // Sync URL when modal closes
    if (modalId === 'modal-kehoach') {
        const destTab = window._preModalTab || 'kehoach';
        const destAction = window._preModalAction || null;
        window._preModalTab = null;
        window._preModalAction = null;
        this.switchTab(destTab, destAction, true);
    } else if (modalId === 'modal-goithau') {
        const destTab = window._preModalTab || 'goithau';
        const destAction = window._preModalAction || null;
        window._preModalTab = null;
        window._preModalAction = null;
        this.switchTab(destTab, destAction, true);
    } else if (modalId === 'modal-chudautu') {
        this.switchTab('chudautu', null, true);
    } else if (modalId === 'modal-nhathau') {
        if (window._nhaThauViewOnly) {
            window._nhaThauViewOnly = false;
        } else {
            this.switchTab('nhathau', null, true);
        }
    } else if (modalId === 'modal-chuyengia') {
        this.switchTab('chuyengia', null, true);
    } else if (modalId === 'modal-hopdong') {
        const destTab = window._preModalTab || 'hopdong';
        const destAction = window._preModalAction || null;
        window._preModalTab = null;
        window._preModalAction = null;
        this.switchTab(destTab, destAction, true);
    } else if (modalId === 'modal-plan-breakdown') {
        const destTab = window._preModalTab || 'kehoach';
        const destAction = window._preModalAction || null;
        window._preModalTab = null;
        window._preModalAction = null;
        this.switchTab(destTab, destAction, true);
    }
}

export function initXuatWordTab() {
    const planSelect = document.getElementById('xw-plan-select');
    const packageSelect = document.getElementById('xw-package-select');
    const packageGroup = document.getElementById('xw-package-group');
    const planActionsCard = document.getElementById('xw-plan-actions-card');
    const packageActionsCard = document.getElementById('xw-package-actions-card');
    const packageInfoBadge = document.getElementById('xw-package-info-badge');
    const container1G1T = document.getElementById('xw-container-1g1t');
    const container1G2T = document.getElementById('xw-container-1g2t');
    const btnExportPlan = document.getElementById('btn-xw-export-plan');

    if (!planSelect) return;

    // Populate plans
    const plans = this.model.state.kehoach || [];
    planSelect.innerHTML = '<option value="">-- Chọn kế hoạch LCNT --</option>' + 
        plans.map(p => `<option value="${p.id}" data-search="${p.maKeHoach || ''} ${p.tenKeHoach || ''}">${p.tenKeHoach || p.maKeHoach}</option>`).join('');
    this.makeSearchableSelect(planSelect, 'Tìm kiếm kế hoạch LCNT...');

    planSelect.onchange = () => {
        const planId = planSelect.value;
        if (!planId) {
            packageGroup.style.display = 'none';
            planActionsCard.style.display = 'none';
            packageActionsCard.style.display = 'none';
            return;
        }

        // Show plan actions
        planActionsCard.style.display = 'block';

        // Populate plan details in card
        const selectedPlan = plans.find(p => String(p.id) === String(planId));
        if (selectedPlan) {
            document.getElementById('xw-plan-code').textContent = selectedPlan.maKeHoach || '--';
            
            // Cập nhật nhãn động theo loại hình
            const isDuToan = (selectedPlan.loaiHinhMuaSam || '').includes('Dự toán');
            document.getElementById('xw-plan-total-label').textContent = isDuToan ? 'Tổng dự toán:' : 'Tổng mức đầu tư:';
            
            const rawTotal = selectedPlan.tongMucDauTu;
            document.getElementById('xw-plan-total').textContent = rawTotal ? Number(rawTotal).toLocaleString('vi-VN') + ' VND' : '--';
            
            // Tìm chủ đầu tư liên kết
            const investor = (this.model.state.chudautu || []).find(c => String(c.id) === String(selectedPlan.chuDauTuId));
            document.getElementById('xw-plan-investor').textContent = investor ? investor.tenChuDauTu : '--';
        }

        // Filter and populate packages
        const packages = (this.model.state.goithau || []).filter(g => String(g.keHoachId) === String(planId));
        packageSelect.innerHTML = '<option value="">-- Chọn gói thầu --</option>' + 
            packages.map(g => `<option value="${g.id}" data-search="${g.maGoiThau || ''} ${g.tenGoiThau || ''}">${g.tenGoiThau || g.maGoiThau}</option>`).join('');
        this.makeSearchableSelect(packageSelect, 'Tìm kiếm gói thầu...');

        packageGroup.style.display = 'block';
        packageActionsCard.style.display = 'none';
    };

    packageSelect.onchange = () => {
        const packageId = packageSelect.value;
        if (!packageId) {
            packageActionsCard.style.display = 'none';
            return;
        }

        const pkg = (this.model.state.goithau || []).find(g => String(g.id) === String(packageId));
        if (!pkg) return;

        packageActionsCard.style.display = 'block';
        packageInfoBadge.textContent = `${pkg.tenGoiThau} (${pkg.maGoiThau})`;

        // Hiển thị thông tin cơ bản gói thầu
        document.getElementById('xw-pkg-code').textContent = pkg.maGoiThau || '--';
        document.getElementById('xw-pkg-hinhthuc').textContent = pkg.hinhThucLuaChon || '--';
        document.getElementById('xw-pkg-phuongthuc').textContent = pkg.phuongThucLuaChon || '--';
        document.getElementById('xw-pkg-price').textContent = this.model.formatCurrency(pkg.giaGoiThau);

        // Kiểm tra hình thức Chào hàng cạnh tranh
        const isCHCT = pkg.hinhThucLuaChon === 'Chào hàng cạnh tranh';
        const configArea = document.getElementById('xw-pkg-thamdinh-config');
        const detailsArea = document.getElementById('xw-pkg-thamdinh-details');
        
        if (isCHCT) {
            configArea.style.display = 'none';
        } else {
            configArea.style.display = 'flex';
            
            // Set value radio
            const isRequired = pkg.yeuCauThamDinhHsmt === 'Có';
            const radios = document.getElementsByName('xw-require-thamdinh');
            radios.forEach(r => {
                if (r.value === 'co') r.checked = isRequired;
                if (r.value === 'khong') r.checked = !isRequired;
            });
            
            // Show/Hide details panel
            detailsArea.style.display = isRequired ? 'flex' : 'none';
            
            // Set values for inputs
            document.getElementById('xw-pkg-so-bc-td').value = pkg.soBaoCaoThamDinhHsmt || '';
            document.getElementById('xw-pkg-ngay-bc-td').value = pkg.ngayBaoCaoThamDinhHsmt || '';
        }

        // Determine 1G1T or 1G2T
        const is1G2T = pkg.phuongThucLuaChon === 'Một giai đoạn hai túi hồ sơ';
        if (is1G2T) {
            container1G1T.style.display = 'none';
            container1G2T.style.display = 'grid';
        } else {
            container1G1T.style.display = 'grid';
            container1G2T.style.display = 'none';
        }
        lucide.createIcons();
    };

    // Xử lý sự kiện thay đổi radio button thẩm định HSMT
    document.querySelectorAll('input[name="xw-require-thamdinh"]').forEach(radio => {
        radio.onchange = async () => {
            const packageId = packageSelect.value;
            if (!packageId) return;
            const pkg = (this.model.state.goithau || []).find(g => String(g.id) === String(packageId));
            if (!pkg) return;
            
            const isCo = radio.value === 'co';
            pkg.yeuCauThamDinhHsmt = isCo ? 'Có' : 'Không';
            
            // Show/hide details
            document.getElementById('xw-pkg-thamdinh-details').style.display = isCo ? 'flex' : 'none';
            
            await this.model.persistData('goithau');
            this.autoSync();
        };
    });

    // Xử lý sự kiện thay đổi số báo cáo thẩm định
    const inputSoBc = document.getElementById('xw-pkg-so-bc-td');
    if (inputSoBc) {
        inputSoBc.onchange = async () => {
            const packageId = packageSelect.value;
            if (!packageId) return;
            const pkg = (this.model.state.goithau || []).find(g => String(g.id) === String(packageId));
            if (!pkg) return;
            
            pkg.soBaoCaoThamDinhHsmt = inputSoBc.value;
            await this.model.persistData('goithau');
            this.autoSync();
        };
    }

    // Xử lý sự kiện thay đổi ngày báo cáo thẩm định
    const inputNgayBc = document.getElementById('xw-pkg-ngay-bc-td');
    if (inputNgayBc) {
        inputNgayBc.onchange = async () => {
            const packageId = packageSelect.value;
            if (!packageId) return;
            const pkg = (this.model.state.goithau || []).find(g => String(g.id) === String(packageId));
            if (!pkg) return;
            
            pkg.ngayBaoCaoThamDinhHsmt = inputNgayBc.value;
            await this.model.persistData('goithau');
            this.autoSync();
        };
    }

    // Plan export click
    if (btnExportPlan) {
        btnExportPlan.onclick = () => {
            const planId = planSelect.value;
            if (!planId) return;

            const selectedPlan = plans.find(p => String(p.id) === String(planId));
            const planName = selectedPlan ? (selectedPlan.tenKeHoach || selectedPlan.maKeHoach) : 'LCNT';

            btnExportPlan.disabled = true;
            const origHTML = btnExportPlan.innerHTML;
            btnExportPlan.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width: 14px; height: 14px; margin-right: 6px;"></i> Đang xuất...';
            lucide.createIcons({ root: btnExportPlan });

            fetch(`/api/export-plan/${planId}`)
                .then(res => {
                    if (!res.ok) throw new Error('Lỗi xuất file kế hoạch');
                    return res.blob();
                })
                .then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Ke_hoach_LCNT_${planName.replace(/\s+/g, '_')}.docx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                })
                .catch(err => {
                    this.view.customAlert('Lỗi', err.message, 'x-circle');
                })
                .finally(() => {
                    btnExportPlan.disabled = false;
                    btnExportPlan.innerHTML = origHTML;
                    lucide.createIcons({ root: btnExportPlan });
                });
        };
    }

    // Package exports click
    document.querySelectorAll('.xw-pkg-btn').forEach(btn => {
        btn.onclick = () => {
            const packageId = packageSelect.value;
            const type = btn.getAttribute('data-type');
            if (!packageId || !type) return;

            const pkg = (this.model.state.goithau || []).find(g => String(g.id) === String(packageId));
            const pkgName = pkg ? (pkg.maGoiThau || 'GoiThau') : 'GoiThau';

            btn.disabled = true;
            const origHTML = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width: 14px; height: 14px; margin-right: 6px;"></i> Đang xuất...';
            lucide.createIcons({ root: btn });

            fetch(`/api/export-report/${packageId}?type=${type}`)
                .then(res => {
                    if (!res.ok) throw new Error('Lỗi xuất file');
                    return res.blob();
                })
                .then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${type.toUpperCase()}_${pkgName}.docx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                })
                .catch(err => {
                    this.view.customAlert('Lỗi', err.message, 'x-circle');
                })
                .finally(() => {
                    btn.disabled = false;
                    btn.innerHTML = origHTML;
                    lucide.createIcons({ root: btn });
                });
        };
    });

    lucide.createIcons();
}
