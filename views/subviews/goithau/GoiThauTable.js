import { initCustomSelect } from '../view_helpers.js';

export function parseYearMonth(dateStr) {
    if (!dateStr) return { year: null, month: null };
    let cleaned = String(dateStr).replace(/\s*-\s*/, ' ').trim();
    if (cleaned.match(/^\d{4}-\d{2}-\d{2}/)) {
        const y = cleaned.substring(0, 4);
        const m = parseInt(cleaned.substring(5, 7), 10).toString();
        return { year: y, month: m };
    } else if (cleaned.match(/^\d{2}\/\d{2}\/\d{4}/)) {
        const parts = cleaned.split(' ')[0].split('/');
        const y = parts[2];
        const m = parseInt(parts[1], 10).toString();
        return { year: y, month: m };
    }
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
        return {
            year: d.getFullYear().toString(),
            month: (d.getMonth() + 1).toString()
        };
    }
    return { year: null, month: null };
}

export async function renderGoiThauTable() {
    const tableBody = document.getElementById('goithau-table').querySelector('tbody');
    const searchVal = document.getElementById('search-goithau').value.toLowerCase();
    const filterTrangThai = document.getElementById('filter-goithau-trangthai').value;
    const filterHinhThuc = document.getElementById('filter-goithau-hinhthuc').value;

    const yearSelect = document.getElementById('filter-goithau-nam');
    const monthSelect = document.getElementById('filter-goithau-thang');
    const allPackages = this.model.getLatestPackages();
    if (yearSelect && monthSelect) {
        const prevYear = yearSelect.value;
        const prevMonth = monthSelect.value;

        const years = new Set();
        const months = new Set();
        allPackages.forEach(gt => {
            const dateVal = gt.ngayQuyetDinh;
            if (dateVal) {
                const parsed = parseYearMonth(dateVal);
                if (parsed.year) years.add(parsed.year);
                if (parsed.month) months.add(parsed.month);
            }
        });

        const sortedYears = Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
        const sortedMonths = Array.from(months).sort((a, b) => parseInt(b) - parseInt(a));

        yearSelect.innerHTML = '<option value="">Năm</option>' + sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
        monthSelect.innerHTML = '<option value="">Tháng</option>' + sortedMonths.map(m => `<option value="${m}">Tháng ${m}</option>`).join('');

        if (sortedYears.includes(prevYear)) yearSelect.value = prevYear;
        if (sortedMonths.includes(prevMonth)) monthSelect.value = prevMonth;

        initCustomSelect('filter-goithau-trangthai');
        initCustomSelect('filter-goithau-hinhthuc');
        initCustomSelect('filter-goithau-nam');
        initCustomSelect('filter-goithau-thang');
    }

    const filterNam = yearSelect ? yearSelect.value : '';
    const filterThang = monthSelect ? monthSelect.value : '';

    let slicedData = [];
    let totalItems = 0;
    const currentPage = this.model.currentPage.goithau || 1;
    const pageSize = this.model.pageSize || 10;

    const sortState = this.model.sortState.goithau || {};
    const sortBy = sortState.field || '';
    const sortOrder = sortState.order || 'asc';

    if (this.model.useServerSidePagination) {
        if (!tableBody.querySelector('.empty-state') && tableBody.children.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
        }
        try {
            const res = await fetch(`/api/paginate?table=goithau&page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(searchVal)}&trangThai=${encodeURIComponent(filterTrangThai)}&hinhThuc=${encodeURIComponent(filterHinhThuc)}&sortBy=${sortBy}&sortOrder=${sortOrder}&nam=${encodeURIComponent(filterNam)}&thang=${encodeURIComponent(filterThang)}`);
            if (res.ok) {
                const data = await res.json();
                slicedData = data.items;
                totalItems = data.totalItems;
            }
        } catch (e) {
            console.error("Failed to fetch paginated packages", e);
        }
    } else {
        const latestPackages = this.model.getFilteredGoiThau();
        const filtered = latestPackages.filter(gt => {
            const matchesSearch = gt.maGoiThau.toLowerCase().includes(searchVal) ||
                gt.tenGoiThau.toLowerCase().includes(searchVal);
            const matchesTrangThai = !filterTrangThai || gt.trangThai === filterTrangThai;
            const matchesHinhThuc = !filterHinhThuc || gt.hinhThucLuaChon === filterHinhThuc;

            let matchesYear = true;
            let matchesMonth = true;
            const dateVal = gt.ngayQuyetDinh;
            if (dateVal) {
                const parsed = parseYearMonth(dateVal);
                if (filterNam) {
                    matchesYear = parsed.year === filterNam;
                }
                if (filterThang) {
                    matchesMonth = parsed.month === filterThang;
                }
            } else {
                if (filterNam || filterThang) {
                    matchesYear = false;
                    matchesMonth = false;
                }
            }

            return matchesSearch && matchesTrangThai && matchesHinhThuc && matchesYear && matchesMonth;
        });

        if (sortBy) {
            filtered.sort((a, b) => {
                let valA = a[sortBy] || '';
                let valB = b[sortBy] || '';
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }

        totalItems = filtered.length;
        const startIndex = (currentPage - 1) * pageSize;
        slicedData = filtered.slice(startIndex, startIndex + pageSize);
    }

    if (totalItems === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="archive"></i>
                        <p>Không tìm thấy Gói thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
        const pag = document.getElementById('goithau-pagination');
        if (pag) pag.innerHTML = '';
    } else {
        window._jvDataMap = window._jvDataMap || {};

        const esc = window.escapeHTML || ((value) => String(value ?? ''));
        tableBody.innerHTML = slicedData.map(gt => {
            const root = gt.rootId || gt.id;
            const allRelated = this.model.state.goithau.filter(g => (g.rootId || g.id) === root);

            const verMap = {};
            allRelated.forEach(g => {
                const ver = g.phienBan || '00';
                if (!verMap[ver]) {
                    verMap[ver] = g;
                } else {
                    const p1 = (this.model.state.kehoach || []).find(k => String(k.id) === String(g.keHoachId));
                    const p2 = (this.model.state.kehoach || []).find(k => String(k.id) === String(verMap[ver].keHoachId));
                    const v1 = p1 ? (parseInt(p1.phienBan) || 0) : 0;
                    const v2 = p2 ? (parseInt(p2.phienBan) || 0) : 0;
                    if (v1 > v2) {
                        verMap[ver] = g;
                    }
                }
            });
            const uniqueVersions = Object.values(verMap);
            uniqueVersions.sort((a, b) => parseInt(b.phienBan || 0) - parseInt(a.phienBan || 0));

            if (!this.model.state.selectedPackageVersion) {
                this.model.state.selectedPackageVersion = {};
            }
            const selectedId = this.model.state.selectedPackageVersion[root] || uniqueVersions[0]?.id || gt.id;
            const displayedGt = this.model.state.goithau.find(g => g.id === selectedId) || gt;

            const kh = this.model.getLatestPlan(displayedGt.keHoachId);
            const nt = displayedGt.nhaThauTrungThauId ? this.model.state.nhathau.find(n => n.id === displayedGt.nhaThauTrungThauId) : null;
            const matchBid = displayedGt.nhaThauTrungThauId ? this.model.state.thongtinmothau.find(b => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(displayedGt.nhaThauTrungThauId)) : null;
            const ntDisplayName = matchBid ? matchBid.tenNhaThau : (nt ? nt.tenNhaThau : '--');
            const isWinnerJV = matchBid && matchBid.loaiNhaThau === 'Liên danh';
            let ntLink;
            if (isWinnerJV) {
                const allJvMembers = matchBid.thanhVienLienDanh || [];
                const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                const leadName = leadMember?.tenNhaThau || ntDisplayName;
                const leadCode = leadMember?.maSoThue || nt?.maSoThue || nt?.maNhaThau || matchBid.maDinhDanh || matchBid.maNhaThau || '';
                const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');
                window._jvDataMap[displayedGt.id] = {
                    members: subMembers,
                    leadName,
                    leadCode
                };
                ntLink = `<a href="#" data-bf-action="show-jv" data-id="${esc(displayedGt.id)}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${esc(ntDisplayName)}</a>`;
            } else if (nt) {
                ntLink = `<a href="#" data-bf-action="show-contractor" data-id="${esc(nt.id)}" class="text-blue fw-bold link-hover">${esc(ntDisplayName)}</a>`;
            } else {
                ntLink = `<span class="fw-bold text-success">${esc(ntDisplayName)}</span>`;
            }

            let winnerInfoHtml = '--';
            if (displayedGt.trangThai === 'Đã có kết quả') {
                if (displayedGt.phanLo === 'Có') {
                    const plList = typeof displayedGt.phanLoList === 'string' ? JSON.parse(displayedGt.phanLoList || '[]') : (displayedGt.phanLoList || []);
                    const winningLots = plList.filter(pl => pl.nhaThauTrungThauId);
                    const uniqueWinnerIds = [...new Set(winningLots.map(pl => String(pl.nhaThauTrungThauId)).filter(Boolean))];

                    if (uniqueWinnerIds.length > 1) {
                        window._lotWinnersMap = window._lotWinnersMap || {};
                        window._lotWinnersMap[displayedGt.id] = winningLots.map(pl => {
                            const bidderInfo = this.model.state.thongtinmothau.find(b => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(pl.nhaThauTrungThauId));
                            const ntInfo = this.model.state.nhathau.find(n => n.id === pl.nhaThauTrungThauId);
                            const ntName = bidderInfo ? bidderInfo.tenNhaThau : (ntInfo ? ntInfo.tenNhaThau : 'Nhà thầu #' + pl.nhaThauTrungThauId);
                            const isJV = bidderInfo && bidderInfo.loaiNhaThau === 'Liên danh';
                            let jvData = null;
                            if (isJV) {
                                const allJvMembers = bidderInfo.thanhVienLienDanh || [];
                                const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                                const leadName = leadMember?.tenNhaThau || ntName;
                                const leadCode = leadMember?.maSoThue || ntInfo?.maSoThue || ntInfo?.maNhaThau || bidderInfo.maDinhDanh || bidderInfo.maNhaThau || '';
                                const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');
                                jvData = { members: subMembers, leadName, leadCode };
                            }
                            return {
                                maPhanLo: pl.maPhanLo,
                                tenPhanLo: pl.tenPhanLo,
                                nhaThauTrungThauId: pl.nhaThauTrungThauId,
                                tenNhaThau: ntName,
                                giaTrungThau: pl.giaTrungThau,
                                isJV,
                                jvData
                            };
                        });
                        const totalGiaTrung = winningLots.reduce((sum, pl) => sum + (parseFloat(pl.giaTrungThau) || 0), 0);
                        winnerInfoHtml = `<a href="#" data-bf-action="show-lot-winners" data-id="${esc(displayedGt.id)}" class="text-blue fw-bold link-hover" style="text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a><br><small class="text-muted">Tổng giá: ${this.model.formatCurrency(totalGiaTrung)}</small>`;
                    } else if (uniqueWinnerIds.length === 1) {
                        const singleWinnerId = uniqueWinnerIds[0];
                        const singleWinnerNt = this.model.state.nhathau.find(n => String(n.id) === String(singleWinnerId));
                        const singleWinnerBid = this.model.state.thongtinmothau.find(b => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(singleWinnerId));
                        const name = singleWinnerBid ? singleWinnerBid.tenNhaThau : (singleWinnerNt ? singleWinnerNt.tenNhaThau : 'Nhà thầu #' + singleWinnerId);
                        const totalGiaTrung = winningLots.reduce((sum, pl) => sum + (parseFloat(pl.giaTrungThau) || 0), 0);

                        let link;
                        if (singleWinnerBid && singleWinnerBid.loaiNhaThau === 'Liên danh') {
                            const allJvMembers = singleWinnerBid.thanhVienLienDanh || [];
                            const leadMember = allJvMembers.find(m => m.vaiTro === 'Đứng đầu liên danh');
                            const leadName = leadMember?.tenNhaThau || name;
                            const leadCode = leadMember?.maSoThue || singleWinnerNt?.maSoThue || singleWinnerNt?.maNhaThau || singleWinnerBid.maDinhDanh || singleWinnerBid.maNhaThau || '';
                            const subMembers = allJvMembers.filter(m => m.vaiTro !== 'Đứng đầu liên danh');
                            window._jvDataMap[displayedGt.id] = { members: subMembers, leadName, leadCode };
                            link = `<a href="#" data-bf-action="show-jv" data-id="${esc(displayedGt.id)}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${esc(name)}</a>`;
                        } else if (singleWinnerNt) {
                            link = `<a href="#" data-bf-action="show-contractor" data-id="${esc(singleWinnerNt.id)}" class="text-blue fw-bold link-hover">${esc(name)}</a>`;
                        } else {
                            link = `<span class="fw-bold text-success">${esc(name)}</span>`;
                        }
                        winnerInfoHtml = `${link}<br><small class="text-muted">Giá: ${this.model.formatCurrency(totalGiaTrung)}</small>`;
                    } else {
                        winnerInfoHtml = '--';
                    }
                } else {
                    winnerInfoHtml = displayedGt.nhaThauTrungThauId ? (ntLink + '<br><small class="text-muted">Giá: ' + this.model.formatCurrency(displayedGt.giaTrungThau) + '</small>') : '--';
                }
            } else {
                winnerInfoHtml = '--';
            }

            const optionsHtml = uniqueVersions.map(v => {
                const label = String(parseInt(v.phienBan || 0)).padStart(2, '0');
                const isSel = v.id === displayedGt.id ? 'selected' : '';
                return `<option value="${esc(v.id)}" ${isSel}>${esc(label)}</option>`;
            }).join('');

            const dropdownHtml = `
                <select class="form-control version-droplist" data-bf-change="change-package-version" data-root="${esc(root)}" style="width: 52px; display: inline-block; padding: 2px; height: 22px; font-size: 0.8rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main); text-align-last: center; cursor: pointer; margin: 0; outline: none; vertical-align: middle;">
                    ${optionsHtml}
                </select>
            `;

            const isCanceledPackage = displayedGt.trangThai === '\u0048\u1ee7\u0079\u0020\u0074\u0068\u1ea7\u0075';
            const isCompletedPackage = displayedGt.trangThai === '\u0110\u00e3\u0020\u0063\u00f3\u0020\u006b\u1ebf\u0074\u0020\u0071\u0075\u1ea3';

            return `
            <tr class="${isCanceledPackage ? 'cancelled-package' : ''}">
                <td>
                    <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                        <a href="#" data-bf-action="show-package" data-id="${esc(displayedGt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${this.model.getPackageBaseCode(displayedGt.maGoiThau) ? esc(this.model.getPackageBaseCode(displayedGt.maGoiThau)) : '<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                        <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                        ${dropdownHtml}
                    </div>
                </td>
                <td style="min-width: 240px; max-width: 320px;" class="text-wrap"><a href="#" data-bf-action="show-package" data-id="${esc(displayedGt.id)}" class="text-blue fw-bold link-hover">${esc(displayedGt.tenGoiThau)}</a></td>
                <td style="min-width: 240px; max-width: 320px;" class="text-wrap">${kh ? '<a href="#" data-bf-action="show-plan" data-id="' + esc(kh.id) + '" class="text-blue fw-bold link-hover">' + esc(kh.tenKeHoach) + '</a>' : '<span class="text-danger">Không liên kết</span>'}</td>
                <td class="fw-bold">${this.model.formatCurrency(displayedGt.giaGoiThau)}</td>
                <td>${esc(displayedGt.hinhThucLuaChon || '--')}</td>
                <td>${this.getStatusBadge(displayedGt.trangThai)}</td>
                <td style="min-width: 200px; max-width: 300px;" class="text-wrap">${winnerInfoHtml}</td>
                <td class="text-right">
                    <div class="action-btn-group">
                        ${displayedGt.id === gt.id ? ((isCanceledPackage || isCompletedPackage) ? `
                            ${isCanceledPackage ? `<button class="action-btn btn-restore" data-bf-action="restore-package" data-id="${esc(displayedGt.id)}" title="Khôi phục hủy thầu" style="color: var(--success, #10b981);">
                                <i data-lucide="rotate-ccw"></i>
                            </button>` : ''}
                            <button class="action-btn btn-view" data-bf-action="view-package" data-id="${esc(displayedGt.id)}" title="Xem chi tiết Gói thầu">
                                <i data-lucide="eye"></i>
                            </button>
                            <button class="action-btn btn-delete" data-bf-action="delete-package" data-id="${esc(displayedGt.id)}" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        ` : `
                            <button class="action-btn btn-edit" data-bf-action="edit-package" data-id="${esc(displayedGt.id)}" title="Sửa">
                                <i data-lucide="edit-2"></i>
                            </button>
                            <button class="action-btn btn-delete" data-bf-action="delete-package" data-id="${esc(displayedGt.id)}" title="Xóa">
                                <i data-lucide="trash-2"></i>
                            </button>
                        `) : `
                            <button class="action-btn btn-view" data-bf-action="show-package" data-id="${esc(displayedGt.id)}" title="Xem chi tiết Gói thầu">
                                <i data-lucide="eye"></i>
                            </button>
                        `}
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        if (window.renderTablePagination) {
            window.renderTablePagination('goithau-pagination', totalItems, currentPage, pageSize);
        }
    }
    lucide.createIcons({ root: tableBody });
    this.enhanceTableHeaders('goithau-table', 'goithau');
}
