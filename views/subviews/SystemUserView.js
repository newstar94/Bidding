/* ==========================================================================
   BiddingFlow - SystemUserView (Part of View split)
   ========================================================================== */

export function updateActiveUserProfileDisplay() {
    const avatar = document.getElementById('header-profile-avatar');
    const h4 = document.getElementById('header-profile-name');
    const p = document.getElementById('header-profile-role');
    
    if (avatar && h4 && p) {
        const user = this.model.state.activeuser || { name: 'Khách', title: 'Khách', id: '' };
        h4.textContent = user.name;
        const orgs = user.organization_name ? user.organization_name.split(',').map(o => o.trim()).filter(Boolean) : [];
        let activeOrg = localStorage.getItem('bf_active_org');
        if (!activeOrg || !orgs.includes(activeOrg)) {
            activeOrg = orgs[0] || '';
            if (activeOrg) {
                localStorage.setItem('bf_active_org', activeOrg);
            } else {
                localStorage.removeItem('bf_active_org');
            }
        }
        p.textContent = `Chế độ: ${user.title}`;

        const orgPill = document.getElementById('header-active-org-pill');
        const orgPillName = document.getElementById('header-active-org-name');
        if (orgPill && orgPillName) {
            if (activeOrg) {
                orgPillName.textContent = activeOrg;
                orgPill.style.display = 'flex';
                orgPill.style.cursor = 'default';
            } else {
                orgPill.style.display = 'none';
            }
        }

        if (window.appController && typeof window.appController.renderWorkspaceSwitcher === 'function') {
            window.appController.renderWorkspaceSwitcher();
        }

        if (user.avatar) {
            avatar.innerHTML = `<img src="${user.avatar}" alt="Avatar">`;
            avatar.style.background = 'none';
        } else {
            avatar.textContent = user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            
            // Set gradient color for avatar based on role
            if (this.model.state.activerole === 'super_admin') {
                avatar.style.background = 'linear-gradient(135deg, #a855f7 0%, #4f46e5 100%)';
            } else if (this.model.state.activerole === 'manager') {
                avatar.style.background = 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)';
            } else {
                avatar.style.background = 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)';
            }
        }

        // Show or hide Super Admin/Manager role switch section inside the dropdown
        const saSwitchSection = document.getElementById('sa-role-switch-section');
        if (saSwitchSection) {
            if (user.dbRole === 'super_admin' || user.dbRole === 'manager') {
                saSwitchSection.style.display = 'block';
                
                const superAdminBtn = document.querySelector('.dropdown-role-btn[data-switch-role="super_admin"]');
                const managerBtn = document.querySelector('.dropdown-role-btn[data-switch-role="manager"]');
                const employeeBtn = document.querySelector('.dropdown-role-btn[data-switch-role="employee"]');
                
                if (user.dbRole === 'super_admin') {
                    if (superAdminBtn) superAdminBtn.style.display = 'flex';
                    if (managerBtn) managerBtn.style.display = 'flex';
                    if (employeeBtn) employeeBtn.style.display = 'flex';
                } else if (user.dbRole === 'manager') {
                    if (superAdminBtn) superAdminBtn.style.display = 'none';
                    if (managerBtn) managerBtn.style.display = 'flex';
                    if (employeeBtn) employeeBtn.style.display = 'flex';
                }
            } else {
                saSwitchSection.style.display = 'none';
            }
            
            // Highlight current active role in the dropdown
            document.querySelectorAll('.dropdown-role-btn').forEach(btn => {
                const role = btn.getAttribute('data-switch-role');
                if (role === this.model.state.activerole) {
                    btn.style.background = 'rgba(147, 51, 234, 0.08)';
                    btn.style.color = '#a855f7';
                } else {
                    btn.style.background = 'transparent';
                    btn.style.color = 'var(--text-main)';
                }
            });
        }
    }

    // Conditionally show/hide Super Admin, Manager and Client sidebar items
    const saItems = document.querySelectorAll('.role-menu-superadmin');
    const managerItems = document.querySelectorAll('.role-menu-manager');
    const clientItems = document.querySelectorAll('.role-menu-client');

    saItems.forEach(item => {
        item.style.display = this.model.state.activerole === 'super_admin' ? 'block' : 'none';
    });

    managerItems.forEach(item => {
        item.style.display = this.model.state.activerole === 'manager' ? 'block' : 'none';
    });

    clientItems.forEach(item => {
        item.style.display = this.model.state.activerole === 'super_admin' ? 'none' : 'block';
    });

    // Dynamic locking of financial stats if role is employee
    this.applySecurityLockOverlay();
    
    // Update thau/contracts select inputs with employees of active unit
    this.populateNhanVienPhuTrachDropdowns();
}

export function applySecurityLockOverlay() {
    // Remove old locks
    document.querySelectorAll('.security-lock-overlay').forEach(el => el.remove());
}

export function populateNhanVienPhuTrachDropdowns() {
    const gtDropdown = document.getElementById('gt-nhanvienphutrach');
    const hdDropdown = document.getElementById('hd-nhanvienphutrach');
    
    // All users can be assigned (role inheritance: super_admin ⊇ manager ⊇ employee)
    let employees = Array.isArray(this.model.state.employees) ? this.model.state.employees : [];
    
    // Nếu không phải super_admin, chỉ hiển thị nhân viên thuộc tổ chức hiện tại
    if (this.model.state.activerole !== 'super_admin') {
        const activeOrg = localStorage.getItem('bf_active_org');
        if (activeOrg) {
            employees = employees.filter(e => {
                const orgs = e.organization_name ? e.organization_name.split(',').map(o => o.trim()).filter(Boolean) : [];
                return orgs.includes(activeOrg);
            });
        }
    }

    const roleLabelMap = {
        super_admin: 'Super Admin / Quản lý / Chuyên viên',
        manager: 'Quản lý / Chuyên viên',
        employee: 'Chuyên viên'
    };
    const optionsHtml = employees.map(e => {
        const roleLabel = roleLabelMap[e.role] || e.role;
        return `<option value="${escapeHTML(e.id)}">${escapeHTML(e.name)} — ${escapeHTML(roleLabel)}${e.email ? ' (' + escapeHTML(e.email) + ')' : ''}</option>`;
    }).join('');
    
    if (gtDropdown) {
        gtDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optionsHtml;
    }
    
    if (hdDropdown) {
        hdDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optionsHtml;
    }
}

export function renderSuperAdminPanel() {
    // Render Subscription Packages Cards dynamically
    const pricingGrid = document.getElementById('sa-pricing-grid');
    if (pricingGrid && this.model.state.systempackages) {
        pricingGrid.innerHTML = this.model.state.systempackages.map(pkg => {
            const badgeLabel = pkg.id === 'silver' ? 'Silver' : (pkg.id === 'gold' ? 'Bán chạy' : 'Diamond');
            const badgeClass = pkg.id === 'gold' ? 'badge-popular' : '';
            const cardClass = pkg.id === 'silver' ? 'silver-card' : (pkg.id === 'gold' ? 'gold-card popular' : 'diamond-card');
            
            const formattedPrice = this.model.formatCurrency(pkg.price);
            const quotaText = pkg.quota >= 999 ? 'Không giới hạn' : `Tối đa ${pkg.quota} Nhân sự`;
            const isLocked = pkg.isLocked || false;
            const lockBtnText = isLocked ? 'Đã khóa' : 'Hoạt động';
            const lockBtnClass = isLocked ? 'btn-danger' : 'btn-emerald';
            
            return `
                <div class="pricing-card ${cardClass}">
                    <div class="pricing-badge ${badgeClass}">${badgeLabel}</div>
                    <h4 class="package-name">${pkg.name}</h4>
                    <div class="package-price">${formattedPrice}<span>/năm</span></div>
                    <p class="package-desc">${pkg.description || ''}</p>
                    <ul class="package-features">
                        <li><i data-lucide="check"></i> Hạn mức nhân sự: <strong>${quotaText}</strong></li>
                        <li><i data-lucide="check"></i> Lập ma trận phân quyền</li>
                        <li><i data-lucide="check"></i> Đồng bộ dữ liệu SQLite động</li>
                        <li><i data-lucide="check"></i> Nhập dữ liệu thầu từ Excel</li>
                    </ul>
                    <div class="package-action-btn-group">
                        <button class="btn btn-outline btn-full-width mb-2"
                            onclick="window.editSystemPackage('${pkg.id}')">Chỉnh sửa Gói</button>
                        <button class="btn ${lockBtnClass} btn-full-width" id="btn-lock-${pkg.id}"
                            onclick="window.togglePackageLock('${pkg.id}')">${lockBtnText}</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    fetch('/api/auth/users')
        .then(r => r.ok ? r.json() : [])
        .then(users => {
            // Build organizations list from users
            const orgMap = {};
            users.forEach(u => {
                const orgs = u.organization_name ? u.organization_name.split(',').map(o => o.trim()).filter(Boolean) : [];
                orgs.forEach(orgName => {
                    if (!orgMap[orgName]) {
                        orgMap[orgName] = {
                            id: u.id,
                            name: orgName,
                            contact: '',
                            phone: '',
                            packageId: 'none',
                            regDate: u.package_start_date || '',
                            expDate: u.package_end_date || '',
                            status: 'Hoạt động'
                        };
                    }
                    if (u.role === 'manager' || !orgMap[orgName].contact) {
                        orgMap[orgName].contact = u.name;
                        orgMap[orgName].packageId = u.package_id || 'none';
                        orgMap[orgName].regDate = u.package_start_date || '';
                        orgMap[orgName].expDate = u.package_end_date || '';
                    }
                });
            });
            this.model.state.organizations = Object.values(orgMap);

            // Build employees list
            this.model.state.employees = users.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email || '',
                phone: '',
                role: u.role,
                username: u.username,
                package_id: u.package_id,
                package_start_date: u.package_start_date,
                package_end_date: u.package_end_date,
                organization_name: u.organization_name
            }));

            // Calculate revenue
            const activeOrgs = this.model.state.organizations.filter(o => o.status === 'Hoạt động');
            const lockedOrgs = this.model.state.organizations.filter(o => o.status === 'Đã khóa');
            
            let calculatedRevenue = 0;
            this.model.state.organizations.forEach(org => {
                if (org.status === 'Hoạt động') {
                    const pkg = this.model.state.systempackages.find(p => p.id === org.packageId);
                    if (pkg) calculatedRevenue += pkg.price;
                }
            });

            // Set YTD Revenue
            const revEl = document.getElementById('sa-stat-revenue');
            if (revEl) revEl.textContent = this.model.formatCurrency(calculatedRevenue);

            // Set Orgs count
            const orgsEl = document.getElementById('sa-stat-orgs');
            if (orgsEl) orgsEl.textContent = `${this.model.state.organizations.length} Đơn vị`;

            const orgActiveEl = document.querySelector('#sa-stat-orgs + .stat-trend');
            if (orgActiveEl) {
                orgActiveEl.textContent = `Đang hoạt động: ${activeOrgs.length}`;
            }

            // Set Employees count
            const empsEl = document.getElementById('sa-stat-employees');
            if (empsEl) empsEl.textContent = `${this.model.state.employees.length} Nhân sự`;

            // Render Organizations Table
            const tbody = document.getElementById('sa-organizations-tbody');
            if (tbody) {
                tbody.innerHTML = this.model.state.organizations.map(org => {
                    const pkg = this.model.state.systempackages.find(p => p.id === org.packageId);
                    const pkgLabel = pkg ? `<span class="badge ${org.packageId === 'diamond' ? 'badge-warning' : (org.packageId === 'gold' ? 'badge-info' : 'badge-neutral')}">${pkg.name}</span>` : '--';
                    
                    const statusBadge = org.status === 'Hoạt động' ? 
                        '<span class="badge badge-success"><i data-lucide="check-circle"></i> Hoạt động</span>' : 
                        '<span class="badge badge-danger"><i data-lucide="lock"></i> Đã khóa</span>';
                        
                    const toggleLockBtn = org.status === 'Hoạt động' ?
                        `<button class="action-btn btn-delete" onclick="window.toggleOrgLock('${org.id}')" title="Khóa Đơn vị"><i data-lucide="lock"></i></button>` :
                        `<button class="action-btn btn-edit" style="color:var(--success); background:rgba(16,185,129,0.1);" onclick="window.toggleOrgLock('${org.id}')" title="Mở khóa Đơn vị"><i data-lucide="unlock"></i></button>`;

                    return `
                        <tr>
                            <td class="fw-bold">${escapeHTML(org.name)}</td>
                            <td><span class="fw-bold">${escapeHTML(org.contact)}</span></td>
                            <td>${escapeHTML(org.phone) || '--'}</td>
                            <td>${pkgLabel}</td>
                            <td>${this.model.formatDate(org.regDate)}</td>
                            <td><small class="fw-bold">${this.model.formatDate(org.expDate)}</small></td>
                            <td>${statusBadge}</td>
                            <td class="text-right">
                                <div class="action-btn-group" style="justify-content: flex-end;">
                                    <button class="action-btn btn-view" onclick="window.renewOrgSubscription('${org.id}')" title="Gia hạn 1 năm"><i data-lucide="calendar-plus"></i></button>
                                    ${toggleLockBtn}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
            
            lucide.createIcons();
        });
}

export function renderManagerNhanVienPanel() {
    const currentUsername = sessionStorage.getItem('bf_username');
    const currentUser = this.model.state.employees.find(e => e.username === currentUsername);
    
    // Manager's list of packages
    const managerPkgs = currentUser && currentUser.package_id ? currentUser.package_id.split(',').filter(p => p && p !== 'none') : ['silver'];
    
    // Find their highest package for quota display
    let activePkgId = 'silver';
    if (managerPkgs.includes('diamond')) activePkgId = 'diamond';
    else if (managerPkgs.includes('gold')) activePkgId = 'gold';
    
    const pkg = this.model.state.systempackages.find(p => p.id === activePkgId);
    const quotaLimit = pkg ? pkg.quota : 5;
    
    // Filter specialists belonging to the organization
    const activeOrg = localStorage.getItem('bf_active_org');
    const orgEmployees = this.model.state.employees.filter(e => {
        if (e.role !== 'employee') return false;
        if (!activeOrg) return true;
        const orgs = e.organization_name ? e.organization_name.split(',').map(o => o.trim()).filter(Boolean) : [];
        return orgs.includes(activeOrg);
    });
    
    // Render Quota progress
    const quotaLabel = document.getElementById('manager-quota-label');
    if (quotaLabel) quotaLabel.textContent = `${orgEmployees.length} / ${quotaLimit === 999 ? 'Không giới hạn' : quotaLimit} Nhân sự`;
    
    const progressFill = document.getElementById('manager-quota-progress-fill');
    if (progressFill) {
        const percent = quotaLimit === 999 ? 20 : (orgEmployees.length / quotaLimit) * 100;
        progressFill.style.width = `${Math.min(percent, 100)}%`;
        if (percent >= 90) {
            progressFill.style.background = 'var(--danger)';
        } else if (percent >= 70) {
            progressFill.style.background = 'var(--warning)';
        } else {
            progressFill.style.background = 'linear-gradient(90deg, var(--primary) 0%, #1d4ed8 100%)';
        }
    }

    const pkgNameSpan = document.getElementById('manager-package-name');
    if (pkgNameSpan) pkgNameSpan.textContent = pkg ? pkg.name : '--';

    // Render Employees Table
    const tbody = document.getElementById('manager-employees-tbody');
    if (tbody) {
        tbody.innerHTML = orgEmployees.map(emp => {
            const empAssignments = this.model.state.assignments.filter(a => a.empId === emp.id);
            const assignedTasks = empAssignments.map(a => {
                if (a.type === 'goithau') {
                    const gt = this.model.state.goithau.find(g => g.id === a.targetId);
                    return gt ? `<span class="badge badge-neutral" style="margin:2px;">GT: ${gt.maGoiThau}</span>` : '';
                } else if (a.type === 'hopdong') {
                    const hd = this.model.state.hopdong.find(h => h.id === a.targetId);
                    return hd ? `<span class="badge badge-info" style="margin:2px;">HD: ${hd.soHopDong}</span>` : '';
                }
                return '';
            }).filter(Boolean).join(' ');

            return `
                <tr>
                    <td class="fw-bold" style="text-align: center; vertical-align: middle;">${escapeHTML(emp.name)}</td>
                    <td style="text-align: center; vertical-align: middle;">${escapeHTML(emp.email)}</td>
                    <td style="text-align: center; vertical-align: middle;">${escapeHTML(emp.phone)}</td>
                    <td style="max-width: 250px; text-align: center; vertical-align: middle;">${assignedTasks || '<span class="text-muted">Chưa giao thầu</span>'}</td>
                    <td style="text-align: center; vertical-align: middle;">
                        <div class="action-btn-group" style="justify-content: center; display: inline-flex;">
                            <button class="action-btn btn-edit" onclick="window.editEmployee('${emp.id}')" title="Sửa"><i data-lucide="edit-2"></i></button>
                            <button class="action-btn btn-delete" onclick="window.deleteEmployee('${emp.id}')" title="Xóa"><i data-lucide="trash-2"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Render Permission Matrix Table
    const matrixTbody = document.getElementById('manager-matrix-tbody');
    if (matrixTbody) {
        matrixTbody.innerHTML = orgEmployees.map(emp => {
            const matrix = this.model.state.permissionmatrix.find(m => m.empId === emp.id) || {
                kehoach: 'view', goithau: 'view', hopdong: 'view', chudautu: 'view', nhathau: 'view', chuyengia: 'view'
            };

            const getCellHtml = (moduleName) => {
                const mode = matrix[moduleName] || 'view';
                return `
                    <td class="matrix-checkbox-cell">
                        <select class="form-control matrix-select" data-emp-id="${emp.id}" data-module="${moduleName}" style="width: 100px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.82rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
                            <option value="view" ${mode === 'view' ? 'selected' : ''}>Xem</option>
                            <option value="edit" ${mode === 'edit' ? 'selected' : ''}>Sửa đổi</option>
                        </select>
                    </td>
                `;
            };

            return `
                <tr>
                    <td class="fw-bold">${emp.name}</td>
                    ${getCellHtml('kehoach')}
                    ${getCellHtml('goithau')}
                    ${getCellHtml('hopdong')}
                    ${getCellHtml('chudautu')}
                    ${getCellHtml('nhathau')}
                    ${getCellHtml('chuyengia')}
                </tr>
            `;
        }).join('');
    }

    lucide.createIcons();
}

export function renderManagerHoSoGiayPanel() {
    const orgId = '1'; // VinaCorp
    const orgStatuses = this.model.state.custompaperstatuses.filter(s => s.orgId === orgId);
    
    const tbody = document.getElementById('manager-hosogiay-tbody');
    if (tbody) {
        if (orgStatuses.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Chưa cấu hình trạng thái hồ sơ giấy nào.</td></tr>`;
        } else {
            tbody.innerHTML = orgStatuses.map(status => `
                <tr>
                    <td class="fw-bold">${status.name}</td>
                    <td><span class="status-pill" style="background-color: ${status.color};">${status.name}</span></td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            <button class="action-btn btn-edit" onclick="window.editHoSoGiayStatus('${status.id}')" title="Sửa"><i data-lucide="edit-2"></i></button>
                            <button class="action-btn btn-delete" onclick="window.deleteHoSoGiayStatus('${status.id}')" title="Xóa"><i data-lucide="trash-2"></i></button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    }
    lucide.createIcons();
}

export function renderProfileTab(user) {
    if (!user) return;
    const usernameInput = document.getElementById('profile-username');
    const fullnameInput = document.getElementById('profile-fullname');
    const emailInput = document.getElementById('profile-email');
    
    if (usernameInput) usernameInput.value = user.username || sessionStorage.getItem('bf_username') || '';
    if (fullnameInput) fullnameInput.value = user.name || '';
    if (emailInput) emailInput.value = user.email || '';
    
    // Render organization name if user has package or has organization name
    const orgInput = document.getElementById('profile-organization');
    const orgContainer = document.getElementById('profile-org-container');
    if (orgContainer && orgInput) {
        if (user.organization_name || (user.package_id && user.package_id !== 'none')) {
            orgContainer.style.display = 'block';
            orgInput.value = user.organization_name || '';
        } else {
            orgContainer.style.display = 'none';
            orgInput.value = '';
        }
    }

    // Render avatar preview
    const avatarPreview = document.getElementById('profile-avatar-preview');
    const avatarFallback = document.getElementById('profile-avatar-fallback');
    
    if (user.avatar) {
        if (avatarPreview) {
            avatarPreview.src = user.avatar;
            avatarPreview.style.display = 'block';
        }
        if (avatarFallback) avatarFallback.style.display = 'none';
    } else {
        if (avatarPreview) {
            avatarPreview.src = '';
            avatarPreview.style.display = 'none';
        }
        if (avatarFallback) {
            avatarFallback.textContent = (user.name || 'AD').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            avatarFallback.style.display = 'flex';
        }
    }
}

export function renderSystemUsersTable(usersList, currentUsername) {
    const tbody = document.getElementById('sa-users-tbody');
    if (!tbody) return;
    
    if (!usersList || usersList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Không có người dùng nào.</td></tr>`;
        return;
    }

    const calculateRemainingDays = (endDateStr) => {
        if (!endDateStr) return '<span class="text-muted" style="font-size:0.8rem;">Chưa kích hoạt</span>';
        const endDate = new Date(endDateStr);
        const today = new Date();
        endDate.setHours(0,0,0,0);
        today.setHours(0,0,0,0);
        
        const diffTime = endDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            return `<span class="badge badge-danger" style="background-color: rgba(239,68,68,0.1); color: var(--danger); font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-circle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hết hạn (${Math.abs(diffDays)} ngày trước)</span>`;
        } else if (diffDays === 0) {
            return `<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-triangle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hôm nay hết hạn</span>`;
        } else if (diffDays <= 30) {
            return `<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;">Còn ${diffDays} ngày</span>`;
        } else {
            return `<span class="badge badge-success" style="background-color: rgba(16,185,129,0.1); color: var(--success); font-size: 0.8rem; font-weight: 600;">Còn ${diffDays} ngày</span>`;
        }
    };

    const getRoleBadge = (role) => {
        const map = {
            super_admin: '<span class="badge badge-purple" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield-alert" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Super Admin</span>',
            manager: '<span class="badge badge-info" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Quản lý</span>',
            employee: '<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600;"><i data-lucide="user" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Chuyên viên</span>'
        };
        return map[role] || `<span class="badge badge-neutral">${role}</span>`;
    };

    const getPackageBadge = (pkgId) => {
        const map = {
            silver: '<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600; background:rgba(148,163,184,0.1); color:#475569; border:1px solid rgba(148,163,184,0.2);">Gói Bạc (Silver)</span>',
            gold: '<span class="badge badge-warning" style="font-size:0.8rem; font-weight:600; background:rgba(245,158,11,0.1); color:#b45309; border:1px solid rgba(245,158,11,0.2);">Gói Vàng (Gold)</span>',
            diamond: '<span class="badge badge-info" style="font-size:0.8rem; font-weight:600; background:rgba(14,165,233,0.1); color:#0284c7; border:1px solid rgba(14,165,233,0.2);">Gói Kim Cương (Diamond)</span>',
            none: '<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>'
        };
        return map[pkgId] || '<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>';
    };
    
    tbody.innerHTML = usersList.map(user => {
        const isSelf = user.username === currentUsername;
        const deleteBtn = isSelf ? 
            `<span class="text-muted" style="font-size:0.8rem; font-style:italic;">(Tài khoản hiện tại)</span>` : 
            `<button class="action-btn btn-delete" onclick="window.deleteSystemUser('${user.id}', '${user.username}')" title="Xóa tài khoản"><i data-lucide="trash-2"></i></button>`;
        
        const detailBtn = `<button class="action-btn btn-edit" onclick="window.showSystemUserDetail('${user.id}')" title="Xem chi tiết & Cấu hình"><i data-lucide="user-cog"></i></button>`;

        return `
            <tr style="cursor: pointer;" onclick="window.showSystemUserDetail('${user.id}')">
                <td class="fw-bold" style="color: var(--text-main);">${escapeHTML(user.username)}</td>
                <td style="font-weight: 600;">${escapeHTML(user.name)}</td>
                <td>${escapeHTML(user.email) || '--'}</td>
                <td>${getRoleBadge(user.role)}</td>
                <td>${getPackageBadge(user.package_id)}</td>
                <td>${calculateRemainingDays(user.package_end_date)}</td>
                <td class="text-right" onclick="event.stopPropagation()">
                    <div class="action-btn-group" style="justify-content: flex-end;">
                        ${detailBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    lucide.createIcons();
}
