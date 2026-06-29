/**
 * Common helpers for Plan View
 */
export function getAuthDownloadUrl(url) {
    const token = sessionStorage.getItem('bf_session_token') || '';
    const username = sessionStorage.getItem('bf_username') || '';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}&username=${encodeURIComponent(username)}`;
}

export function authFetchDownload(url, filename) {
    return fetch(url, {
        headers: {
            'X-Session-Token': sessionStorage.getItem('bf_session_token') || '',
            'X-Username': sessionStorage.getItem('bf_username') || ''
        }
    })
        .then(async res => {
            if (!res.ok) {
                let errMsg = 'Lỗi tải file';
                try {
                    const contentType = res.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const d = await res.json();
                        errMsg = d.error || errMsg;
                    } else {
                        const text = await res.text();
                        errMsg = text || `${res.status} ${res.statusText}`;
                    }
                } catch (e) {
                    errMsg = `${res.status} ${res.statusText}`;
                }
                throw new Error(errMsg);
            }
            return res.blob();
        })
        .then(blob => {
            const a = document.createElement('a');
            const objectUrl = URL.createObjectURL(blob);
            a.href = objectUrl;
            a.download = filename || 'download';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
        });
}

export function formatCurrency(value) {
    if (value === null || value === undefined) return '--';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

export function formatDate(dateStr) {
    if (!dateStr) return '--';

    let year = null, month = null, day = null, hours = '00', minutes = '00';
    let hasTime = false;

    if (dateStr instanceof Date) {
        const d = dateStr;
        day = String(d.getDate()).padStart(2, '0');
        month = String(d.getMonth() + 1).padStart(2, '0');
        year = d.getFullYear();
        hours = String(d.getHours()).padStart(2, '0');
        minutes = String(d.getMinutes()).padStart(2, '0');
        hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    } else {
        const str = String(dateStr).replace(/\s*-\s*/, ' ').trim();
        const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
        const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);

        if (ymdMatch) {
            year = ymdMatch[1];
            month = ymdMatch[2];
            day = ymdMatch[3];
            if (ymdMatch[4] !== undefined) {
                hours = ymdMatch[4];
                minutes = ymdMatch[5];
                hasTime = true;
            }
        } else if (dmyMatch) {
            day = dmyMatch[1];
            month = dmyMatch[2];
            year = dmyMatch[3];
            if (dmyMatch[4] !== undefined) {
                hours = dmyMatch[4];
                minutes = dmyMatch[5];
                hasTime = true;
            }
        } else {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            day = String(d.getDate()).padStart(2, '0');
            month = String(d.getMonth() + 1).padStart(2, '0');
            year = d.getFullYear();
            hours = String(d.getHours()).padStart(2, '0');
            minutes = String(d.getMinutes()).padStart(2, '0');
            hasTime = /[T\s]\d{1,2}:\d{2}/.test(dateStr);
        }
    }

    if (hasTime) {
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    return `${day}/${month}/${year}`;
}

export function initCustomSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Kiểm tra xem đây có phải là Dropdown chọn Phiên bản không
    const isVersion = select.classList.contains('version-droplist');
    const isCompact = select.classList.contains('page-version-select') || select.classList.contains('modal-version-select');

    // =========================================================================
    // PHẦN 1: DÀNH RIÊNG CHO DROPDOWN PHIÊN BẢN (Sử dụng cơ chế Position: Fixed)
    // =========================================================================
    if (isVersion || isCompact) {
        select.style.display = 'none';

        let wrapper = select.parentElement.querySelector(`.custom-select-container[data-target="${selectId}"]`);
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'custom-select-container' + (isVersion ? ' version-select-container' : ' compact-version-select-container');
            wrapper.setAttribute('data-target', selectId);
            select.parentNode.insertBefore(wrapper, select.nextSibling);

            wrapper.style.display = 'inline-block';
            wrapper.style.verticalAlign = 'middle';
            wrapper.style.margin = '0';

            if (isVersion) {
                wrapper.style.width = '52px';
                wrapper.style.height = '22px';
            } else {
                wrapper.style.width = '70px';
                wrapper.style.minWidth = '70px';
            }

            // Bộ lắng nghe sự kiện đóng dropdown phiên bản
            if (!window._customSelectClickListenerRegistered) {
                document.addEventListener('click', (e) => {
                    document.querySelectorAll('.custom-select-container.open').forEach(w => {
                        const targetId = w.getAttribute('data-target');
                        const dropdownEl = document.querySelector(`.custom-select-dropdown[data-target="${targetId}"]`);
                        if (!w.contains(e.target) && (!dropdownEl || !dropdownEl.contains(e.target))) {
                            w.classList.remove('open');
                            if (dropdownEl && dropdownEl.parentElement === document.body) {
                                w.appendChild(dropdownEl);
                                dropdownEl.style.opacity = '0';
                                dropdownEl.style.visibility = 'hidden';
                            }
                        }
                    });
                });
                window._customSelectClickListenerRegistered = true;
            }

            if (!window._customSelectGlobalScrollListenerRegistered) {
                document.addEventListener('scroll', (e) => {
                    if (e.target && e.target.classList && e.target.classList.contains('custom-select-dropdown')) return;
                    document.querySelectorAll('.custom-select-container.open').forEach(w => {
                        w.classList.remove('open');
                        const targetId = w.getAttribute('data-target');
                        const dropdownEl = document.querySelector(`.custom-select-dropdown[data-target="${targetId}"]`);
                        if (dropdownEl && dropdownEl.parentElement === document.body) {
                            w.appendChild(dropdownEl);
                            dropdownEl.style.opacity = '0';
                            dropdownEl.style.visibility = 'hidden';
                        }
                    });
                }, { capture: true, passive: true });
                window._customSelectGlobalScrollListenerRegistered = true;
            }
        }

        const options = Array.from(select.options);
        const selectedOption = select.options[select.selectedIndex] || select.options[0] || { text: '', value: '' };

        const oldDropdownOnBody = document.body.querySelector(`.custom-select-dropdown[data-target="${selectId}"]`);
        if (oldDropdownOnBody) oldDropdownOnBody.remove();

        wrapper.innerHTML = `
            <div class="custom-select-trigger">
                <span>${selectedOption.text.trim()}</span>
            </div>
            <div class="custom-select-dropdown${isVersion ? ' version-select-dropdown' : ' compact-version-select-dropdown'}" data-target="${selectId}">
                ${options.map(opt => `
                    <div class="custom-select-option ${opt.selected ? 'selected' : ''}" data-value="${opt.value}">
                        <span>${opt.text}</span>
                    </div>
                `).join('')}
            </div>
        `;

        const trigger = wrapper.querySelector('.custom-select-trigger');
        const dropdown = wrapper.querySelector('.custom-select-dropdown');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-select-container').forEach(w => {
                if (w !== wrapper) {
                    w.classList.remove('open');
                    const targetId = w.getAttribute('data-target');
                    const otherDropdown = document.querySelector(`.custom-select-dropdown[data-target="${targetId}"]`);
                    if (otherDropdown && otherDropdown.parentElement === document.body) {
                        w.appendChild(otherDropdown);
                        otherDropdown.style.opacity = '0';
                        otherDropdown.style.visibility = 'hidden';
                    }
                }
            });

            if (wrapper.classList.toggle('open')) {
                document.body.appendChild(dropdown);
                dropdown.style.opacity = '0';
                dropdown.style.visibility = 'hidden';
                dropdown.style.display = 'block';

                const rect = wrapper.getBoundingClientRect();
                dropdown.style.position = 'fixed';
                dropdown.style.top = (rect.bottom + 4) + 'px';
                dropdown.style.left = rect.left + 'px';
                dropdown.style.minWidth = isVersion ? '52px' : '70px';
                dropdown.style.width = 'max-content';

                const maxAvailableHeight = window.innerHeight - rect.bottom - 15;
                dropdown.style.maxHeight = Math.max(140, maxAvailableHeight) + 'px';
                dropdown.style.overflowY = 'auto';
                dropdown.style.zIndex = '999999';
                dropdown.style.margin = '0';
                dropdown.style.transform = 'none';

                dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
                    opt.style.whiteSpace = 'nowrap';
                });

                dropdown.style.opacity = '1';
                dropdown.style.visibility = 'visible';
            } else {
                dropdown.style.opacity = '0';
                dropdown.style.visibility = 'hidden';
                wrapper.appendChild(dropdown);
            }
        });

        wrapper.querySelectorAll('.custom-select-option').forEach(optEl => {
            optEl.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = optEl.getAttribute('data-value');
                select.dispatchEvent(new Event('change', { bubbles: true }));
                wrapper.classList.remove('open');
                if (dropdown.parentElement === document.body) {
                    wrapper.appendChild(dropdown);
                    dropdown.style.opacity = '0';
                    dropdown.style.visibility = 'hidden';
                }
                initCustomSelect(selectId);
            });
        });
    }
    // =========================================================================
    // PHẦN 2: DÀNH CHO TOÀN BỘ DROPDOWN CÒN LẠI (Dùng cấu trúc custom-select-search)
    // =========================================================================
    else {
        select.style.display = 'none';
        let wrapper = select.parentElement.querySelector(`.custom-select-wrapper[data-target="${selectId}"]`);

        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'custom-select-wrapper';
            wrapper.setAttribute('data-target', selectId);
            select.parentNode.insertBefore(wrapper, select.nextSibling);

            // Bắt sự kiện click toàn cục để thu gọn menu kiểu mới
            if (!window._relativeSelectClickListenerRegistered) {
                document.addEventListener('click', (e) => {
                    document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
                        if (!w.contains(e.target)) {
                            w.classList.remove('open');
                        }
                    });
                });
                window._relativeSelectClickListenerRegistered = true;
            }
        }

        const options = Array.from(select.options);
        const selectedOption = select.options[select.selectedIndex] || select.options[0] || { text: '', value: '' };
        let triggerText = selectedOption.text.trim();

        if (triggerText.startsWith('Tháng ')) {
            let coreText = triggerText.substring(6).trim();
            const monthMap = { 'một': '1', 'hai': '2', 'ba': '3', 'bốn': '4', 'năm': '5', 'sáu': '6', 'bảy': '7', 'tám': '8', 'chín': '9', 'mười': '10', 'mười một': '11', 'mười hai': '12' };
            if (monthMap[coreText.toLowerCase()]) coreText = monthMap[coreText.toLowerCase()];
            triggerText = 'Th' + coreText;
        }

        // Vẽ HTML mô phỏng chính xác giao diện của custom-select-search
        wrapper.innerHTML = `
            <div class="custom-select-search" style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select:none;">${triggerText}</span>
                <i data-lucide="chevron-down" class="custom-select-arrow" style="width:16px; height:16px; flex-shrink:0;"></i>
            </div>
            <ul class="custom-select-options">
                ${options.map(opt => `
                    <li data-value="${opt.value}" class="${opt.selected ? 'selected' : ''}">${opt.text}</li>
                `).join('')}
            </ul>
        `;

        const trigger = wrapper.querySelector('.custom-select-search');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();

            // Đóng tất cả các menu loại mới đang mở
            document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
                if (w !== wrapper) w.classList.remove('open');
            });

            // Đóng tất cả các menu loại cũ (phiên bản) đang mở để dọn dẹp giao diện
            document.querySelectorAll('.custom-select-container.open').forEach(w => {
                w.classList.remove('open');
                const tId = w.getAttribute('data-target');
                const oDrop = document.querySelector(`.custom-select-dropdown[data-target="${tId}"]`);
                if (oDrop && oDrop.parentElement === document.body) {
                    w.appendChild(oDrop);
                    oDrop.style.opacity = '0';
                    oDrop.style.visibility = 'hidden';
                }
            });

            wrapper.classList.toggle('open');
        });

        // Xử lý sự kiện khi người dùng chọn một mục trong danh sách
        wrapper.querySelectorAll('.custom-select-options li').forEach(li => {
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = li.getAttribute('data-value');
                select.dispatchEvent(new Event('change', { bubbles: true })); // Kích hoạt sự kiện change cho hệ thống
                wrapper.classList.remove('open');
                initCustomSelect(selectId); // Vẽ lại giao diện sau khi chọn
            });
        });

        // Cập nhật icon mũi tên
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }
}

