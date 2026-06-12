/* ==========================================================================
   BiddingFlow - DashboardView (Part of View split)
   ========================================================================== */

export function renderDashboard() {
    const latestPackages = this.model.getFilteredGoiThau();

    document.getElementById('stat-count-kehoach').textContent = this.model.getFilteredKeHoach().length;
    document.getElementById('stat-count-goithau').textContent = latestPackages.length;
    document.getElementById('stat-count-chudautu').textContent = this.model.getLatestChuDauTu().length;
    document.getElementById('stat-count-nhathau').textContent = this.model.getLatestNhaThau().length;
    document.getElementById('stat-count-chuyengia').textContent = this.model.state.chuyengia.length;
    const statCountHopDong = document.getElementById('stat-count-hopdong');
    if (statCountHopDong) {
        statCountHopDong.textContent = this.model.getFilteredHopDong().length;
    }

    // Calculate contract statistics
    const filteredContracts = this.model.getFilteredHopDong();
    let totalContractValue = 0;
    filteredContracts.forEach(hd => {
        totalContractValue += (hd.giaTri || 0);
    });

    let activePackages = 0;
    latestPackages.forEach(gt => {
        if (gt.trangThai === 'Đang mời thầu') {
            activePackages++;
        }
    });

    document.getElementById('stat-active-goithau').textContent = `${activePackages} gói đang mời thầu`;
    document.getElementById('stat-total-budget').textContent = this.model.formatCurrency(totalContractValue);
    document.getElementById('stat-savings-value').textContent = `${filteredContracts.length} Hợp đồng`;
    document.getElementById('stat-savings-percent').textContent = `Đang thực hiện`;

    const statusCounts = {
        'Chuẩn bị': 0,
        'Đang mời thầu': 0,
        'Đã mở thầu': 0,
        'Đang chấm thầu': 0,
        'Đã có kết quả': 0,
        'Hủy thầu': 0
    };
    latestPackages.forEach(gt => {
        if (statusCounts[gt.trangThai] !== undefined) {
            statusCounts[gt.trangThai]++;
        }
    });

    const total = latestPackages.length || 1;
    document.getElementById('donut-total-count').textContent = latestPackages.length;

    const colors = {
        'Chuẩn bị': 'var(--text-light)',
        'Đang mời thầu': 'var(--primary)',
        'Đã mở thầu': '#f59e0b',
        'Đang chấm thầu': '#9333ea',
        'Đã có kết quả': 'var(--success)',
        'Hủy thầu': 'var(--danger)'
    };

    let accum = 0;
    const gradientParts = [];
    let legendHTML = '';

    Object.keys(statusCounts).forEach(status => {
        const count = statusCounts[status];
        const pct = (count / total) * 100;
        
        if (count > 0) {
            gradientParts.push(`${colors[status]} ${accum}% ${accum + pct}%`);
            accum += pct;
        }

        legendHTML += `
            <div class="legend-item">
                <div class="legend-info">
                    <span class="legend-dot" style="background-color: ${colors[status]}"></span>
                    <span>${status}</span>
                </div>
                <span class="legend-val">${count} (${pct.toFixed(0)}%)</span>
            </div>
        `;
    });

    const donutElement = document.querySelector('.status-donut-chart');
    if (donutElement) {
        if (gradientParts.length > 0) {
            donutElement.style.background = `conic-gradient(${gradientParts.join(', ')})`;
        } else {
            donutElement.style.background = 'var(--neutral-soft)';
        }
    }
    document.getElementById('status-legend-list').innerHTML = legendHTML;

    const recentTableBody = document.getElementById('recent-packages-table').querySelector('tbody');
    const recentList = [...latestPackages].reverse().slice(0, 4);

    if (recentList.length === 0) {
        recentTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Chưa có gói thầu nào</td></tr>`;
    } else {
        recentTableBody.innerHTML = recentList.map(gt => `
            <tr>
                <td><a href="#" onclick="event.preventDefault(); window.showPackageDetails('${gt.id}')" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu"><span class="detail-code">${gt.maGoiThau}</span></a></td>
                <td><a href="#" class="view-package-link" data-id="${gt.id}">${gt.tenGoiThau}</a></td>
                <td>${this.model.formatCurrency(gt.giaGoiThau)}</td>
                <td>${gt.hinhThucLuaChon}</td>
                <td>${this.getStatusBadge(gt.trangThai)}</td>
            </tr>
        `).join('');

        recentTableBody.querySelectorAll('.view-package-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                window.showPackageDetails(link.getAttribute('data-id'));
            });
        });
    }
    lucide.createIcons();
}

export function renderSuperAdminDashboard() {
    fetch('/api/auth/users')
        .then(r => r.ok ? r.json() : [])
        .then(users => {
            const orgCount = new Set(users.map(u => u.organization_name).filter(Boolean)).size;
            const saStatOrgs = document.getElementById('sad-stat-orgs');
            if (saStatOrgs) saStatOrgs.textContent = `${orgCount} Đơn vị`;
            
            const saStatUsers = document.getElementById('sad-stat-users');
            if (saStatUsers) saStatUsers.textContent = `${users.length} Người dùng`;

            const activeOrgs = users.filter(u => u.package_id && u.package_id !== 'none').map(u => u.organization_name).filter(Boolean);
            const activeOrgsCount = new Set(activeOrgs).size;
            const saStatActiveOrgs = document.getElementById('sad-stat-active-orgs');
            if (saStatActiveOrgs) saStatActiveOrgs.textContent = `Đang hoạt động: ${activeOrgsCount}`;

            // Render organizations tables
            const orgListContainer = document.getElementById('sa-org-list-tbody');
            if (orgListContainer) {
                const orgMap = {};
                users.forEach(u => {
                    if (u.organization_name) {
                        if (!orgMap[u.organization_name]) {
                            orgMap[u.organization_name] = {
                                name: u.organization_name,
                                manager: '',
                                email: '',
                                package_id: 'none',
                                start: '',
                                end: '',
                                userCount: 0
                            };
                        }
                        orgMap[u.organization_name].userCount++;
                        if (u.role === 'manager') {
                            orgMap[u.organization_name].manager = u.name;
                            orgMap[u.organization_name].email = u.email;
                            orgMap[u.organization_name].package_id = u.package_id || 'none';
                            orgMap[u.organization_name].start = u.package_start_date ? this.model.formatDate(u.package_start_date) : '';
                            orgMap[u.organization_name].end = u.package_end_date ? this.model.formatDate(u.package_end_date) : '';
                        }
                    }
                });

                const list = Object.values(orgMap);
                if (list.length === 0) {
                    orgListContainer.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Chưa có tổ chức nào đăng ký thầu</td></tr>`;
                } else {
                    orgListContainer.innerHTML = list.map(org => {
                        const pkgName = org.package_id === 'diamond' ? 'Gói Kim Cương' : (org.package_id === 'gold' ? 'Gói Vàng' : (org.package_id === 'silver' ? 'Gói Bạc' : 'Chưa đăng ký'));
                        const pkgClass = org.package_id === 'diamond' ? 'badge-primary' : (org.package_id === 'gold' ? 'badge-warning' : (org.package_id === 'silver' ? 'badge-success' : 'badge-neutral'));
                        return `
                            <tr>
                                <td style="font-weight:700; color:var(--text-main);">${org.name}</td>
                                <td>${org.manager || '<span class="text-muted">Chưa cấu hình</span>'}</td>
                                <td>${org.email || '<span class="text-muted">Chưa có</span>'}</td>
                                <td><span class="badge ${pkgClass}">${pkgName}</span></td>
                                <td style="font-weight:600;">${org.end || '<span class="text-muted">Vô thời hạn</span>'}</td>
                                <td style="font-weight:700; text-align:center;">${org.userCount}</td>
                                <td class="text-right">
                                    <div class="actions-group">
                                        <button class="btn btn-icon btn-neutral" onclick="window.switchTab('superadmin')" title="Quản lý chi tiết"><i data-lucide="edit"></i></button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('');
                }
            }
            lucide.createIcons();
        });
}
