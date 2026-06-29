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

    // Đảm bảo thẻ select gốc bị ẩn hoàn toàn (sử dụng !important để tránh bị CSS hệ thống đè lên)
    select.setAttribute('style', 'display: none !important;');

    // =========================================================================
    // TRÌNH QUẢN LÝ SỰ KIỆN TOÀN CỤC (Chỉ cho Dropdown Absolute thông thường)
    // =========================================================================
    if (!window._unifiedSelectClickListenerRegistered) {
        // Đóng menu khi nhấp chuột ra ngoài
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.custom-select-container.open').forEach(w => {
                const absoluteDropdown = w.querySelector('.custom-select-options');

                if (!w.contains(e.target)) {
                    w.classList.remove('open');
                    if (absoluteDropdown) absoluteDropdown.style.display = 'none';
                }
            });
        });

        // Đóng menu khi cuộn trang (Đã tắt tính năng tự ẩn khi cuộn dọc theo yêu cầu)
        /*
        document.addEventListener('scroll', (e) => {
            // Bỏ qua nếu đang cuộn bên trong chính danh sách
            if (e.target && e.target.classList && e.target.classList.contains('custom-select-options')) return;

            document.querySelectorAll('.custom-select-container.open').forEach(w => {
                w.classList.remove('open');
                const absoluteDropdown = w.querySelector('.custom-select-options');
                if (absoluteDropdown) absoluteDropdown.style.display = 'none';
            });
        }, { capture: true, passive: true });
        */
        window._unifiedSelectClickListenerRegistered = true;
    }
    // =========================================================================
    // KHỞI TẠO KHUNG BAO BỌC (Container)
    // =========================================================================
    let wrapper = select.parentElement.querySelector(`.custom-select-container[data-target="${selectId}"]`);
    
    // Trích xuất dữ liệu
    const options = Array.from(select.options);
    const selectedOption = select.options[select.selectedIndex] || select.options[0] || { text: '', value: '' };
    let triggerText = selectedOption.text.trim();

    if (triggerText.startsWith('Tháng ')) {
        let coreText = triggerText.substring(6).trim();
        const monthMap = { 'một': '1', 'hai': '2', 'ba': '3', 'bốn': '4', 'năm': '5', 'sáu': '6', 'bảy': '7', 'tám': '8', 'chín': '9', 'mười': '10', 'mười một': '11', 'mười hai': '12' };
        if (monthMap[coreText.toLowerCase()]) coreText = monthMap[coreText.toLowerCase()];
        triggerText = 'Th' + coreText;
    }

    const isVersionSelect = select.classList.contains('page-version-select') || 
                            select.classList.contains('version-select') || 
                            select.classList.contains('phienban-select') || 
                            select.classList.contains('modal-version-select') ||
                            select.classList.contains('version-droplist');

    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'custom-select-container';
        wrapper.setAttribute('data-target', selectId);
        wrapper.style.position = 'relative';

        select.parentNode.insertBefore(wrapper, select.nextSibling);

        wrapper.innerHTML = `
            <div class="custom-select-trigger">
                <span>${triggerText}</span>
                ${isVersionSelect ? '' : `
                <div class="custom-select-trigger-arrow">
                    <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </div>
                `}
            </div>
            <ul class="custom-select-options" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; min-width: 100%; width: max-content; max-height: 220px; overflow-y: auto; background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 1000; list-style: none; padding: 6px 0; margin: 0;">
                ${options.map(opt => `
                    <li data-value="${opt.value}" class="custom-option-item ${opt.selected ? 'selected' : ''}" style="padding: 8px 14px; font-size: 0.85rem; cursor: pointer; white-space: nowrap; color: var(--text-main);">${opt.text}</li>
                `).join('')}
            </ul>
        `;

        const trigger = wrapper.querySelector('.custom-select-trigger');
        const optionsList = wrapper.querySelector('.custom-select-options');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = wrapper.classList.contains('open');

            // Đóng tất cả menu khác
            document.dispatchEvent(new Event('click'));

            if (!wasOpen) {
                wrapper.classList.add('open');
                optionsList.style.display = 'block';
            }
        });

        // Xử lý hiệu ứng di chuột và chọn mục
        wrapper.querySelectorAll('.custom-option-item').forEach(li => {
            li.addEventListener('mouseover', () => {
                if (!li.classList.contains('selected')) {
                    li.style.backgroundColor = 'var(--neutral-soft)';
                    li.style.color = 'var(--primary)';
                }
            });
            li.addEventListener('mouseout', () => {
                if (!li.classList.contains('selected')) {
                    li.style.backgroundColor = '';
                    li.style.color = 'var(--text-main)';
                }
            });

            li.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = li.getAttribute('data-value');
                select.dispatchEvent(new Event('change', { bubbles: true }));
                document.dispatchEvent(new Event('click')); // Đóng menu sau khi chọn
                initCustomSelect(selectId);
            });
        });

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    } else {
        // Đồng bộ lại danh sách options nếu danh sách options của select gốc thay đổi
        const optionsList = wrapper.querySelector('.custom-select-options');
        if (optionsList) {
            optionsList.innerHTML = options.map(opt => `
                <li data-value="${opt.value}" class="custom-option-item ${opt.selected ? 'selected' : ''}" style="padding: 8px 14px; font-size: 0.85rem; cursor: pointer; white-space: nowrap; color: var(--text-main);">${opt.text}</li>
            `).join('');

            // Gắn lại sự kiện hover và click cho các option mới
            optionsList.querySelectorAll('.custom-option-item').forEach(li => {
                li.addEventListener('mouseover', () => {
                    if (!li.classList.contains('selected')) {
                        li.style.backgroundColor = 'var(--neutral-soft)';
                        li.style.color = 'var(--primary)';
                    }
                });
                li.addEventListener('mouseout', () => {
                    if (!li.classList.contains('selected')) {
                        li.style.backgroundColor = '';
                        li.style.color = 'var(--text-main)';
                    }
                });

                li.addEventListener('click', (e) => {
                    e.stopPropagation();
                    select.value = li.getAttribute('data-value');
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    document.dispatchEvent(new Event('click'));
                    initCustomSelect(selectId);
                });
            });
        }

        // Chỉ cập nhật trạng thái đã chọn và text hiển thị của trigger mà không dựng lại DOM toàn bộ
        const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
        if (triggerSpan) {
            triggerSpan.textContent = triggerText;
        }

        wrapper.querySelectorAll('.custom-option-item').forEach(li => {
            const val = li.getAttribute('data-value');
            if (val === select.value) {
                li.classList.add('selected');
                li.style.backgroundColor = '';
                li.style.color = 'var(--primary)';
            } else {
                li.classList.remove('selected');
                li.style.backgroundColor = '';
                li.style.color = 'var(--text-main)';
            }
        });
    }
}