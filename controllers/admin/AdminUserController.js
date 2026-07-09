/* ==========================================================================
   BiddingFlow - AdminUserController (Part of Controller split)
   ========================================================================== */

import { bindCurrencyElement } from '../main_controller/domUtils.js';

export async function triggerUpgradePrompt() {
    await this.view.customAlert(
        'Hạn mức Đạt giới hạn!',
        '⚠️ Bạn đã sử dụng hết số lượng nhân viên tối đa của Gói Vàng (15 tài khoản).\n\nVui lòng nâng cấp lên Gói Kim Cương (Không giới hạn nhân viên) để tiếp tục mở rộng quy mô phòng thầu của đơn vị!\n\nLiên hệ Hotline BiddingFlow: 1900.8888 để được hỗ trợ nâng cấp gói cước VIP trong 5 phút.',
        'alert-triangle'
    );
}

export async function loadSystemUsers() {
    try {
        const res = await fetch('/api/auth/users');
        if (res.ok) {
            const users = await res.json();
            const currentUsername = sessionStorage.getItem('bf_username');
            this.view.renderSystemUsersTable(users, currentUsername);
        }
    } catch (err) {
        console.error('Failed to load system users:', err);
    }
}

export async function deleteSystemUser(userId, username) {
    const confirmed = await this.view.customConfirm('Xác nhận xóa tài khoản', `Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản "${username}" khỏi hệ thống?`, 'user-x');
    if (confirmed) {
        try {
            const res = await fetch(`/api/auth/users/${userId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (res.ok) {
                await this.view.customAlert('Thành công', 'Đã xóa tài khoản người dùng thành công!', 'check-circle');
                this.loadSystemUsers();
            } else {
                await this.view.customAlert('Thất bại', data.error || 'Không thể xóa tài khoản này.', 'alert-triangle');
            }
        } catch (err) {
            await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
        }
    }
}

export async function changeUserRole(userId, newRole) {
    try {
        const res = await fetch('/api/auth/users/update-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, role: newRole })
        });
        const data = await res.json();
        if (res.ok) {
            await this.view.customAlert('Thành công', 'Đã thay đổi vai trò người dùng thành công!', 'check-circle');
            this.loadSystemUsers();
        } else {
            await this.view.customAlert('Thất bại', data.error || 'Không thể thay đổi vai trò.', 'alert-triangle');
            this.loadSystemUsers(); // Reload to revert select state
        }
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
        this.loadSystemUsers(); // Reload to revert select state
    }
}

export async function changeUserPackage(userId, newPackage) {
    try {
        const res = await fetch('/api/auth/users/update-package', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, package_id: newPackage })
        });
        const data = await res.json();
        if (res.ok) {
            await this.view.customAlert('Thành công', 'Đã thay đổi gói đăng ký cho người dùng thành công!', 'check-circle');
            this.loadSystemUsers();
        } else {
            await this.view.customAlert('Thất bại', data.error || 'Không thể thay đổi gói đăng ký.', 'alert-triangle');
            this.loadSystemUsers(); // Reload to revert select state
        }
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
        this.loadSystemUsers(); // Reload to revert select state
    }
}

export async function toggleUserPackage(userId, packageId, isChecked) {
    const user = this.model.state.employees.find(e => String(e.id) === String(userId));
    if (!user) return;

    let userPkgs = user.package_id ? user.package_id.split(',').filter(p => p && p !== 'none') : [];
    if (isChecked) {
        if (!userPkgs.includes(packageId)) userPkgs.push(packageId);
    } else {
        userPkgs = userPkgs.filter(p => p !== packageId);
    }

    const newPackageIds = userPkgs.join(',');

    try {
        const res = await fetch('/api/auth/users/update-package', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, package_id: newPackageIds || 'none' })
        });
        if (res.ok) {
            user.package_id = newPackageIds;
            await this.reloadEmployeesFromDatabase();

            // If SA dashboard is active, reload SA table
            const currentUsername = sessionStorage.getItem('bf_username');
            fetch('/api/auth/users')
                .then(r => r.ok ? r.json() : [])
                .then(users => {
                    this.view.renderSystemUsersTable(users, currentUsername);
                });
        } else {
            const data = await res.json();
            await this.view.customAlert('Thất bại', data.error || 'Không thể cập nhật gói đăng ký.', 'alert-triangle');
            await this.reloadEmployeesFromDatabase();
        }
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
        await this.reloadEmployeesFromDatabase();
    }
}

export async function updateUserMetadata(userId, field, value) {
    try {
        const res = await fetch('/api/auth/users/update-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, field: field, value: value })
        });
        const data = await res.json();
        if (!res.ok) {
            await this.view.customAlert('Thất bại', data.error || 'Không thể cập nhật thông tin.', 'alert-triangle');
        }
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
    }
}

export async function showSystemUserDetail(userId) {
    try {
        const res = await fetch('/api/auth/users');
        if (!res.ok) throw new Error("Failed to fetch users");
        const users = await res.json();
        const user = users.find(u => String(u.id) === String(userId));
        if (!user) {
            await this.view.customAlert('Lỗi', 'Không tìm thấy người dùng này!', 'alert-triangle');
            return;
        }

        // Populate form fields
        document.getElementById('detail-su-id').value = user.id;
        document.getElementById('detail-su-username').value = user.username;
        document.getElementById('detail-su-name').value = user.name || '';
        document.getElementById('detail-su-email').value = user.email || '';
        document.getElementById('detail-su-organization').value = user.organization_name || '';
        document.getElementById('detail-su-role').value = user.role || 'employee';
        document.getElementById('detail-su-package').value = user.package_id || 'none';
        const orgContainer = document.getElementById('detail-su-org-container');
        if (orgContainer) {
            orgContainer.style.display = (user.package_id && user.package_id !== 'none') ? 'block' : 'none';
        }
        document.getElementById('detail-su-startdate').value = user.package_start_date ? this.model.formatForDateInput(user.package_start_date) : '';
        document.getElementById('detail-su-enddate').value = user.package_end_date ? this.model.formatForDateInput(user.package_end_date) : '';

        // Open Modal
        this.view.openModal('modal-detail-system-user');
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Không thể kết nối đến máy chủ: ' + err.message, 'alert-triangle');
    }
}

export function setupRBACEvents() {
    // Tự động render bộ chuyển đổi không gian làm việc
    this.renderWorkspaceSwitcher();

    const profileTrigger = document.querySelector('.header-profile-trigger');
    const profileDropdown = document.getElementById('profile-dropdown-menu');

    if (profileTrigger && profileDropdown) {
        const toggleDropdown = (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('active');
        };
        profileTrigger.addEventListener('click', toggleDropdown);

        // Click outside to close profile dropdown
        document.addEventListener('click', (e) => {
            if (!profileTrigger.contains(e.target) && !profileDropdown.contains(e.target)) {
                profileDropdown.classList.remove('active');
            }
        });
    }

    // Dropdown Profile info tab click listener
    const btnDropdownProfile = document.getElementById('btn-dropdown-profile');
    if (btnDropdownProfile) {
        btnDropdownProfile.addEventListener('click', () => {
            if (profileDropdown) profileDropdown.classList.remove('active');
            this.switchTab('profile');
        });
    }

    // Dropdown Role switcher listener
    document.querySelectorAll('.dropdown-role-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const val = btn.getAttribute('data-switch-role');
            const currentUser = this.model.state.activeuser;
            const userName = currentUser ? currentUser.name : 'Vy Tuấn Dương';

            if (val === 'super_admin') {
                this.model.switchActiveRole('super_admin', userName, 'sa-1');
            } else if (val === 'manager') {
                this.model.switchActiveRole('manager', userName, 'mgr-1');
            } else {
                // employee role - sử dụng ID thực tế của user để khớp với bảng phân công
                let realUserId = sessionStorage.getItem('bf_user_id') || '1';
                if (!realUserId.startsWith('user-') && !realUserId.startsWith('emp-')) {
                    realUserId = 'user-' + realUserId;
                }
                this.model.switchActiveRole('employee', userName, realUserId);
            }

            // Persist state & update profile visual card
            this.view.updateActiveUserProfileDisplay();

            // Clear any open modals (excluding global custom dialog)
            document.querySelectorAll('.modal-overlay:not(#modal-custom-dialog)').forEach(m => m.classList.remove('active'));
            if (profileDropdown) profileDropdown.classList.remove('active');

            // Return to dashboard to force data filtering!
            if (val === 'super_admin') {
                this.switchTab('superadmin-dashboard');
            } else {
                this.switchTab('dashboard');
            }
        });
    });


    // Open Add Employee Modal
    const btnAddEmp = document.getElementById('btn-manager-add-employee');
    if (btnAddEmp) {
        btnAddEmp.addEventListener('click', () => {
            document.getElementById('modal-employee-title').textContent = 'Thêm Nhân sự phòng thầu';
            document.getElementById('form-manager-employee').reset();
            document.getElementById('form-employee-id').value = '';
            this.view.openModal('modal-manager-employee');
        });
    }

    // Add / Edit Employee Form submit
    const formEmp = document.getElementById('form-manager-employee');
    if (formEmp) {
        formEmp.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.view.validateForm(formEmp)) return;

            const currentUsername = sessionStorage.getItem('bf_username');
            const currentUser = this.model.state.employees.find(e => e.username === currentUsername);
            const managerPkgs = currentUser && currentUser.package_id ? currentUser.package_id.split(',').filter(p => p && p !== 'none') : ['silver'];

            let activePkgId = 'silver';
            if (managerPkgs.includes('diamond')) activePkgId = 'diamond';
            else if (managerPkgs.includes('gold')) activePkgId = 'gold';

            const pkg = this.model.state.systempackages.find(p => p.id === activePkgId);
            const quotaLimit = pkg ? pkg.quota : 5;

            const activeOrg = localStorage.getItem('bf_active_org');
            const orgEmployees = this.model.state.employees.filter(em => {
                if (!this.model.hasEffectiveRole(em, 'employee')) return false;
                if (!activeOrg) return true;
                const orgs = em.organization_name ? em.organization_name.split(',').map(o => o.trim()).filter(Boolean) : [];
                return orgs.includes(activeOrg);
            });

            const id = document.getElementById('form-employee-id').value;

            // Quota validation for adding new staff
            if (!id && orgEmployees.length >= quotaLimit) {
                await this.triggerUpgradePrompt();
                return;
            }

            // Fetch system user by email to verify existence
            let foundUser = null;
            const emailInput = document.getElementById('emp-email').value.trim().toLowerCase();
            try {
                const res = await fetch(`/api/auth/users?email=${encodeURIComponent(emailInput)}`);
                if (res.ok) {
                    const matchedUsers = await res.json();
                    foundUser = matchedUsers.find(u => u.email && u.email.trim().toLowerCase() === emailInput);
                }
            } catch (err) {
                console.error("Lỗi khi tải thông tin tài khoản:", err);
            }

            if (!foundUser) {
                await this.view.customAlert('Thông báo', 'Nhân sự chưa có tài khoản trên hệ thống!', 'alert-triangle');
                return;
            }

            // If updating and email has changed to a different user, clean up the old one
            if (id) {
                const existingEmp = this.model.state.employees.find(em => em.id === id);
                if (existingEmp && existingEmp.email.trim().toLowerCase() !== emailInput) {
                    try {
                        const oldUserId = id;
                        await fetch('/api/auth/users/remove-from-org', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ user_id: oldUserId })
                        });
                    } catch (err) {
                        console.error("Lỗi khi gỡ nhân sự cũ khỏi tổ chức:", err);
                    }

                    // Remove old user locally
                    const localEmployees = JSON.parse(localStorage.getItem('bf_employees') || '[]');
                    const newLocal = localEmployees.filter(le => le.id !== id);
                    localStorage.setItem('bf_employees', JSON.stringify(newLocal));

                    // Swap IDs in permission matrix & assignments
                    const newEmpId = foundUser.id;
                    this.model.state.permissionmatrix.forEach(m => {
                        if (m.empId === id) m.empId = newEmpId;
                    });
                    this.model.state.assignments.forEach(a => {
                        if (a.empId === id) a.empId = newEmpId;
                    });
                    this.model.persistData('permissionmatrix');
                    this.model.persistData('assignments');
                }
            }

            // Call backend to add user to organization
            try {
                const resAdd = await fetch('/api/auth/users/add-to-org', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: foundUser.id })
                });

                if (!resAdd.ok) {
                    const errData = await resAdd.json();
                    await this.view.customAlert('Thất bại', errData.error || 'Không thể phân công nhân sự này.', 'alert-triangle');
                    return;
                }
            } catch (err) {
                await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
                return;
            }

            // Save custom name and phone locally so reloadEmployeesFromDatabase will preserve it
            const localEmployees = JSON.parse(localStorage.getItem('bf_employees') || '[]');
            const empIdInState = foundUser.id;
            const customEmp = {
                id: empIdInState,
                name: document.getElementById('emp-name').value.trim(),
                email: document.getElementById('emp-email').value.trim(),
                phone: document.getElementById('emp-phone').value.trim(),
                role: 'employee',
                package_id: foundUser.package_id
            };
            const existingIdx = localEmployees.findIndex(le => le.id === empIdInState);
            if (existingIdx !== -1) {
                localEmployees[existingIdx] = customEmp;
            } else {
                localEmployees.push(customEmp);
            }
            localStorage.setItem('bf_employees', JSON.stringify(localEmployees));

            // Reload employees from DB
            await this.reloadEmployeesFromDatabase();

            // Now, make sure they have a permission matrix row
            if (!this.model.state.permissionmatrix.some(m => m.empId === empIdInState)) {
                this.model.state.permissionmatrix.push({
                    id: window.generateRecordId('permissionmatrix'),
                    empId: empIdInState,
                    kehoach: 'view',
                    goithau: 'view',
                    hopdong: 'view',
                    chudautu: 'view',
                    nhathau: 'view',
                    chuyengia: 'view'
                });
                this.model.persistData('permissionmatrix');
            }

            this.view.closeModal('modal-manager-employee');
            this.view.renderManagerNhanVienPanel();

            await this.view.customAlert('Thành công', 'Thông tin nhân viên đã được cập nhật thành công!', 'check-circle');
            this.autoSync();
        });
    }

    // Save Permission Matrix Button
    const btnSaveMatrix = document.getElementById('btn-save-permission-matrix');
    if (btnSaveMatrix) {
        btnSaveMatrix.addEventListener('click', async () => {
            document.querySelectorAll('#manager-matrix-tbody tr').forEach(row => {
                const selects = row.querySelectorAll('.matrix-select');
                if (selects.length > 0) {
                    const empId = selects[0].getAttribute('data-emp-id');
                    const matrix = this.model.state.permissionmatrix.find(m => m.empId === empId);
                    if (matrix) {
                        selects.forEach(sel => {
                            const mod = sel.getAttribute('data-module');
                            matrix[mod] = sel.value;
                        });
                    }
                }
            });

            this.model.persistData('permissionmatrix');
            await this.view.customAlert('Lưu Ma trận thầu', 'Ma trận phân quyền chi tiết đã được áp dụng và đồng bộ hóa thành công!', 'check-circle');
            this.autoSync();
        });
    }

    // Custom Paper Status Form submit
    const formHsg = document.getElementById('form-manager-hosogiay');
    if (formHsg) {
        formHsg.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.view.validateForm(formHsg)) return;

            const orgId = '1'; // VinaCorp
            const id = document.getElementById('form-hosogiay-id').value;
            const name = document.getElementById('hsg-name').value.trim();
            const color = document.getElementById('hsg-color').value;

            const data = {
                orgId: orgId,
                id: id || window.generateRecordId('custompaperstatuses'),
                name: name,
                color: color
            };

            if (id) {
                const idx = this.model.state.custompaperstatuses.findIndex(s => s.id === id);
                if (idx !== -1) this.model.state.custompaperstatuses[idx] = data;
            } else {
                this.model.state.custompaperstatuses.push(data);
            }

            this.model.persistData('custompaperstatuses');
            formHsg.reset();
            document.getElementById('form-hosogiay-id').value = '';
            document.getElementById('btn-save-hosogiay').innerHTML = '<i data-lucide="plus"></i> Thêm trạng thái';
            lucide.createIcons();

            this.view.renderManagerHoSoGiayPanel();
            await this.view.customAlert('Thành công', 'Trạng thái hồ sơ giấy đã được cập nhật thành công!', 'check-circle');
            this.autoSync();
        });
    }



    // Handle dynamic visibility of Organization field in Admin User Detail modal
    const suPkgDropdown = document.getElementById('detail-su-package');
    if (suPkgDropdown) {
        suPkgDropdown.addEventListener('change', (e) => {
            const orgContainer = document.getElementById('detail-su-org-container');
            if (orgContainer) {
                orgContainer.style.display = e.target.value !== 'none' ? 'block' : 'none';
            }
        });
    }

    // Handle Detail System User Form Submit
    const formSu = document.getElementById('form-detail-system-user');
    if (formSu) {
        formSu.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.view.validateForm(formSu)) return;

            const userId = document.getElementById('detail-su-id').value;
            const role = document.getElementById('detail-su-role').value;
            const packageId = document.getElementById('detail-su-package').value;
            const startDateRaw = document.getElementById('detail-su-startdate').value;
            const endDateRaw = document.getElementById('detail-su-enddate').value;
            const startDate = startDateRaw ? this.model.convertDMYToYMD(startDateRaw) : '';
            const endDate = endDateRaw ? this.model.convertDMYToYMD(endDateRaw) : '';

            try {
                // Update metadata fields (Admin cannot modify name, email, organization_name, or username)
                const fields = [
                    { field: 'package_start_date', value: startDate },
                    { field: 'package_end_date', value: endDate }
                ];

                for (const f of fields) {
                    await fetch('/api/auth/users/update-metadata', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: userId, field: f.field, value: f.value })
                    });
                }

                // Update role
                await fetch('/api/auth/users/update-role', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, role: role })
                });

                // Update package
                await fetch('/api/auth/users/update-package', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, package_id: packageId })
                });

                this.view.closeModal('modal-detail-system-user');
                await this.view.customAlert('Thành công', 'Đã lưu thiết lập tài khoản thành công!', 'check-circle');
                this.loadSystemUsers();
            } catch (err) {
                await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
            }
        });
    }

    // Dynamic formatting for Package Edit Price input
    const editPkgPriceInput = document.getElementById('edit-pkg-price');
    if (editPkgPriceInput) {
        bindCurrencyElement(editPkgPriceInput, value => this.model.formatVND(value));
    }

    // Handle Edit System Package Form Submit
    const formEditPkg = document.getElementById('form-edit-package');
    if (formEditPkg) {
        formEditPkg.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.view.validateForm(formEditPkg)) return;

            const id = document.getElementById('edit-pkg-id').value;
            const name = document.getElementById('edit-pkg-name').value.trim();
            const price = this.model.parseVND(document.getElementById('edit-pkg-price').value);
            const quota = parseInt(document.getElementById('edit-pkg-quota').value, 10) || 0;
            const description = document.getElementById('edit-pkg-desc').value.trim();

            try {
                const res = await fetch('/api/system-packages/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, name, price, quota, description })
                });
                const data = await res.json();
                if (res.ok) {
                    // Update locally
                    const localPkg = this.model.state.systempackages.find(p => p.id === id);
                    if (localPkg) {
                        Object.assign(localPkg, { name, price, quota, description });
                    }
                    this.model.persistData('systempackages');
                    this.view.closeModal('modal-edit-package');
                    this.view.renderSuperAdminPanel();
                    await this.view.customAlert('Thành công', 'Đã cập nhật thông tin gói cước thành công!', 'check-circle');
                    this.autoSync();
                } else {
                    await this.view.customAlert('Thất bại', data.error || 'Không thể cập nhật gói cước.', 'alert-triangle');
                }
            } catch (err) {
                await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
            }
        });
    }

    // Avatar upload selection
    this.tempProfileAvatarBase64 = '';
    const profileAvatarInput = document.getElementById('profile-avatar-input');
    const profileAvatarPreview = document.getElementById('profile-avatar-preview');
    const profileAvatarFallback = document.getElementById('profile-avatar-fallback');

    if (profileAvatarInput) {
        profileAvatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxW = 150;
                    const maxH = 150;
                    let w = img.width;
                    let h = img.height;
                    if (w > h) {
                        if (w > maxW) {
                            h = Math.round((h * maxW) / w);
                            w = maxW;
                        }
                    } else {
                        if (h > maxH) {
                            w = Math.round((w * maxH) / h);
                            h = maxH;
                        }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    ctx.drawImage(img, 0, 0, w, h);
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
                    this.tempProfileAvatarBase64 = compressedBase64;
                    if (profileAvatarPreview) {
                        profileAvatarPreview.src = compressedBase64;
                        profileAvatarPreview.style.display = 'block';
                    }
                    if (profileAvatarFallback) {
                        profileAvatarFallback.style.display = 'none';
                    }
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // Profile form submit
    const formProfileUpdate = document.getElementById('form-profile-update');
    if (formProfileUpdate) {
        formProfileUpdate.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.view.validateForm(formProfileUpdate)) return;

            const username = document.getElementById('profile-username').value;
            const name = document.getElementById('profile-fullname').value.trim();
            const email = document.getElementById('profile-email').value.trim();
            const organizationName = document.getElementById('profile-organization') ? document.getElementById('profile-organization').value.trim() : '';
            const avatar = this.tempProfileAvatarBase64 || this.model.state.activeuser.avatar || '';

            try {
                const res = await fetch('/api/auth/update-profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, name, email, organization_name: organizationName, avatar })
                });
                const data = await res.json();
                if (res.ok) {
                    // Update active user in local state
                    this.model.state.activeuser.name = name;
                    this.model.state.activeuser.email = email;
                    this.model.state.activeuser.organization_name = organizationName;
                    if (avatar) {
                        this.model.state.activeuser.avatar = avatar;
                    }

                    // Save to local storage & DB
                    localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(this.model.state.activeuser));

                    this.view.updateActiveUserProfileDisplay();
                    await this.view.customAlert('Thành công', 'Thông tin cá nhân đã được cập nhật thành công!', 'check-circle');

                    // Force a sync to push to database
                    this.autoSync();
                } else {
                    await this.view.customAlert('Thất bại', data.error || 'Không thể cập nhật hồ sơ.', 'alert-triangle');
                }
            } catch (err) {
                await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
            }
        });
    }

    // Password form submit
    const formProfilePassword = document.getElementById('form-profile-password');
    if (formProfilePassword) {
        formProfilePassword.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.view.validateForm(formProfilePassword)) return;

            const username = document.getElementById('profile-username').value;
            const oldPassword = document.getElementById('profile-old-password').value;
            const newPassword = document.getElementById('profile-new-password').value;
            const confirmPassword = document.getElementById('profile-confirm-password').value;

            if (newPassword.length < 6) {
                await this.view.customAlert('Lỗi mật khẩu', 'Mật khẩu mới cần tối thiểu 6 ký tự!', 'alert-triangle');
                return;
            }

            if (newPassword !== confirmPassword) {
                await this.view.customAlert('Lỗi mật khẩu', 'Xác nhận mật khẩu mới không trùng khớp!', 'alert-triangle');
                return;
            }

            try {
                const res = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, old_password: oldPassword, new_password: newPassword })
                });
                const data = await res.json();
                if (res.ok) {
                    await this.view.customAlert('Thành công', 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại.', 'check-circle');

                    // Logout
                    this.model.clearSessionData();
                    if (this._sessionInterval) clearInterval(this._sessionInterval);
                    const overlay = document.getElementById('auth-overlay');
                    if (overlay) {
                        overlay.style.display = 'flex';
                        document.querySelector('.app-container').style.filter = 'blur(10px)';
                        const formLogin = document.getElementById('form-auth-login');
                        const formRegister = document.getElementById('form-auth-register');
                        const formForgot = document.getElementById('form-auth-forgot');
                        formLogin.style.display = 'block';
                        formRegister.style.display = 'none';
                        formForgot.style.display = 'none';
                        document.getElementById('login-username').value = '';
                        document.getElementById('login-password').value = '';
                    }
                } else {
                    await this.view.customAlert('Thất bại', data.error || 'Không thể đổi mật khẩu.', 'alert-triangle');
                }
            } catch (err) {
                await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
            }
        });
    }
}

export function editEmployee(id) {
    const emp = this.model.state.employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('modal-employee-title').textContent = 'Cập nhật Nhân sự phòng thầu';
    document.getElementById('form-employee-id').value = emp.id;
    document.getElementById('emp-name').value = emp.name;
    document.getElementById('emp-email').value = emp.email;
    document.getElementById('emp-phone').value = emp.phone;

    this.view.openModal('modal-manager-employee');
}

export async function deleteEmployee(id) {
    const emp = this.model.state.employees.find(e => e.id === id);
    if (!emp) return;

    // Check if assigned to any thau/contracts
    const assignmentsCount = this.model.state.assignments.filter(a => a.empId === id).length;
    let warningText = `Bạn có chắc chắn muốn gỡ nhân sự "${emp.name}" khỏi đơn vị? Họ sẽ không còn quyền truy cập dữ liệu của đơn vị này nữa.`;
    if (assignmentsCount > 0) {
        warningText += `\n\n⚠️ CHÚ Ý: Nhân sự này hiện đang được phân công phụ trách ${assignmentsCount} gói thầu/hợp đồng. Nếu gỡ bỏ, các thầu này sẽ không có chuyên viên phụ trách!`;
    }

    const confirmed = await this.view.customConfirm('Xác nhận gỡ nhân sự', warningText, 'trash-2');
    if (confirmed) {
        try {
            const res = await fetch('/api/auth/users/remove-from-org', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: id })
            });

            if (res.ok) {
                // Clean up local alias storage
                const localEmployees = JSON.parse(localStorage.getItem('bf_employees') || '[]');
                const newLocalEmployees = localEmployees.filter(le => le.id !== id);
                localStorage.setItem('bf_employees', JSON.stringify(newLocalEmployees));

                await this.reloadEmployeesFromDatabase();

                this.model.state.permissionmatrix = this.model.state.permissionmatrix.filter(m => m.empId !== id);
                this.model.state.assignments = this.model.state.assignments.filter(a => a.empId !== id);

                await this.model.persistData('permissionmatrix');
                await this.model.persistData('assignments');

                this.view.renderManagerNhanVienPanel();
                await this.autoSync();
            } else {
                const data = await res.json();
                await this.view.customAlert('Thất bại', data.error || 'Không thể gỡ bỏ nhân sự này.', 'alert-triangle');
            }
        } catch (err) {
            await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
        }
    }
}

export async function reloadEmployeesFromDatabase() {
    try {
        const usersRes = await fetch('/api/auth/users');
        if (usersRes.ok) {
            const users = await usersRes.json();
            const localEmployees = JSON.parse(localStorage.getItem('bf_employees') || '[]');
            this.model.state.employees = users.map(u => {
                const localEmp = localEmployees.find(le => le.email && le.email.trim().toLowerCase() === (u.email || '').trim().toLowerCase());
                return {
                    id: u.id,
                    username: u.username,
                    name: localEmp ? localEmp.name : u.name,
                    email: u.email || '',
                    phone: localEmp ? localEmp.phone : '',
                    role: u.role,
                    package_id: u.package_id,
                    organization_name: u.organization_name
                };
            });
            this.model.persistData('employees');
            this.view.populateNhanVienPhuTrachDropdowns();
        }
    } catch (err) {
        console.error("Failed to reload employees:", err);
    }
}

export function editHoSoGiayStatus(id) {
    const status = this.model.state.custompaperstatuses.find(s => s.id === id);
    if (!status) return;

    document.getElementById('form-hosogiay-id').value = status.id;
    document.getElementById('hsg-name').value = status.name;
    document.getElementById('hsg-color').value = status.color;
    document.getElementById('btn-save-hosogiay').innerHTML = '<i data-lucide="save"></i> Cập nhật trạng thái';
    lucide.createIcons();
}

export async function deleteHoSoGiayStatus(id) {
    const status = this.model.state.custompaperstatuses.find(s => s.id === id);
    if (!status) return;

    const confirmed = await this.view.customConfirm(
        'Xác nhận xóa trạng thái',
        `Bạn có chắc chắn muốn xóa trạng thái hồ sơ "${status.name}"?`,
        'trash-2'
    );
    if (!confirmed) return;

    this.model.state.custompaperstatuses = this.model.state.custompaperstatuses.filter(s => s.id !== id);
    await this.model.persistData('custompaperstatuses');

    // Reset form in case we were editing this specific status
    const editingId = document.getElementById('form-hosogiay-id').value;
    if (editingId === id) {
        document.getElementById('form-manager-hosogiay').reset();
        document.getElementById('form-hosogiay-id').value = '';
        document.getElementById('btn-save-hosogiay').innerHTML = '<i data-lucide="plus"></i> Thêm trạng thái';
    }

    this.view.renderManagerHoSoGiayPanel();
    await this.view.customAlert('Thành công', 'Đã xóa trạng thái hồ sơ giấy thành công!', 'check-circle');
    await this.autoSync();
}

export function editSystemPackage(pkgId) {
    const pkg = this.model.state.systempackages.find(p => p.id === pkgId);
    if (!pkg) return;

    document.getElementById('edit-pkg-id').value = pkg.id;
    document.getElementById('edit-pkg-name').value = pkg.name;
    document.getElementById('edit-pkg-price').value = this.model.formatVND(pkg.price);
    document.getElementById('edit-pkg-quota').value = pkg.quota;
    document.getElementById('edit-pkg-desc').value = pkg.description || '';

    this.view.openModal('modal-edit-package');
}

export async function togglePackageLock(pkgId) {
    const pkg = this.model.state.systempackages.find(p => p.id === pkgId);
    if (!pkg) return;

    let lockedPkgs = JSON.parse(localStorage.getItem('bf_locked_system_packages') || '[]');
    const isCurrentlyLocked = lockedPkgs.includes(pkgId);

    const actionText = isCurrentlyLocked ? 'kích hoạt lại' : 'tạm khóa';
    const confirmed = await this.view.customConfirm(
        'Xác nhận thay đổi',
        `Bạn có chắc chắn muốn ${actionText} gói dịch vụ "${pkg.name}"?`,
        isCurrentlyLocked ? 'unlock' : 'lock'
    );

    if (confirmed) {
        if (isCurrentlyLocked) {
            lockedPkgs = lockedPkgs.filter(id => id !== pkgId);
        } else {
            lockedPkgs.push(pkgId);
        }
        localStorage.setItem('bf_locked_system_packages', JSON.stringify(lockedPkgs));

        // Update package's isLocked property in memory
        this.model.state.systempackages.forEach(p => {
            p.isLocked = lockedPkgs.includes(p.id);
        });

        this.view.renderSuperAdminPanel();
        await this.view.customAlert('Thành công', `Đã ${actionText} gói dịch vụ thành công!`, 'check-circle');
    }
}

export function renderWorkspaceSwitcher() {
    const orgSwitchSection = document.getElementById('org-switch-section');
    const orgSwitchList = document.getElementById('org-switch-list');

    const currentUser = this.model.state.activeuser;
    if (!currentUser || !currentUser.organization_name) {
        if (orgSwitchSection) orgSwitchSection.style.display = 'none';
        return;
    }

    const orgs = currentUser.organization_name.split(',').map(o => o.trim()).filter(Boolean);
    if (orgs.length <= 1) {
        if (orgSwitchSection) orgSwitchSection.style.display = 'none';
        return;
    }

    if (orgSwitchSection) orgSwitchSection.style.display = 'block';

    let activeOrg = localStorage.getItem('bf_active_org');
    if (!activeOrg || !orgs.includes(activeOrg)) {
        activeOrg = orgs[0];
        localStorage.setItem('bf_active_org', activeOrg);
    }

    const htmlContent = orgs.map(org => {
        const isActive = org === activeOrg;
        const initials = org.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const activeBg = isActive ? 'var(--primary-soft)' : 'transparent';
        return `
            <button class="dropdown-item dropdown-org-btn" data-org="${org}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border: none; background: ${activeBg}; width: 100%; text-align: left; padding: 8px 16px; cursor: pointer; transition: background 0.15s ease;">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                    <div style="width: 24px; height: 24px; border-radius: 6px; background: ${isActive ? 'var(--primary)' : 'var(--border-color)'}; color: ${isActive ? '#ffffff' : 'var(--text-muted)'}; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; transition: all 0.2s;">
                        ${initials}
                    </div>
                    <span style="font-size: 0.78rem; font-weight: ${isActive ? '700' : '500'}; color: ${isActive ? 'var(--primary)' : 'var(--text-main)'}; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: 1; min-width: 0;">
                        ${org}
                    </span>
                </div>
                ${isActive ? `<i data-lucide="check" style="width: 14px; height: 14px; color: var(--primary); flex-shrink: 0;"></i>` : ''}
            </button>
        `;
    }).join('');

    if (orgSwitchList) orgSwitchList.innerHTML = htmlContent;

    lucide.createIcons();

    // Đăng ký sự kiện click chọn tổ chức làm việc
    const registerClick = (listEl) => {
        if (!listEl) return;
        listEl.querySelectorAll('.dropdown-org-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const selectedOrg = btn.getAttribute('data-org');
                const currentActive = localStorage.getItem('bf_active_org');
                if (selectedOrg === currentActive) {
                    const profileDropdown = document.getElementById('profile-dropdown-menu');
                    if (profileDropdown) profileDropdown.classList.remove('active');
                    return;
                }

                localStorage.setItem('bf_active_org', selectedOrg);

                // Render lại danh sách
                this.renderWorkspaceSwitcher();

                // Gọi tải lại toàn bộ dữ liệu của tổ chức này từ máy chủ
                try {
                    const response = await fetch('/api/get-all-data');
                    if (response.ok) {
                        const dbData = await response.json();
                        Object.keys(dbData).forEach(key => {
                            this.model.state[key] = dbData[key];
                            this.model.persistData(key);
                        });

                        // Cập nhật lại giao diện người dùng
                        this.view.renderDashboard();
                        this.view.renderKeHoachTable();
                        this.view.renderGoiThauTable();
                        this.view.renderChuDauTuTable();
                        this.view.renderNhaThauTable();
                        this.view.renderChuyenGiaTable();
                        this.view.renderHopDongTable();

                        if (typeof this.switchTab === 'function') {
                            this.switchTab(this.model.state.activetab || 'dashboard', null, false);
                        }

                        // Cập nhật hiển thị vai trò/tổ chức trên thanh tiêu đề
                        this.view.updateActiveUserProfileDisplay();

                        // Tải lại danh sách nhân sự của tổ chức mới để cập nhật các dropdown phân công
                        await this.reloadEmployeesFromDatabase();

                        await this.view.customAlert('Chuyển đổi thành công', `Đã chuyển sang không gian làm việc của "${selectedOrg}"!`, 'check-circle');

                        const profileDropdown = document.getElementById('profile-dropdown-menu');
                        if (profileDropdown) profileDropdown.classList.remove('active');
                    } else {
                        await this.view.customAlert('Thất bại', 'Không thể tải dữ liệu của tổ chức này.', 'alert-triangle');
                    }
                } catch (err) {
                    await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
                }
            });
        });
    };

    registerClick(orgSwitchList);
}
