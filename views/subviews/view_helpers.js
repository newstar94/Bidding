/**
 * Common helpers for Plan View
 */
export { getAuthDownloadUrl, authFetchDownload } from '../../controllers/utils/workflow_helpers.js';

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

export function safeAttr(value) {
    return escapeHtml(value);
}

export function htmlIcon(name, attrs = '') {
    const iconName = String(name || '').trim();
    if (!/^[A-Za-z0-9_-]+$/.test(iconName)) return '';
    const extraAttrs = attrs ? ` ${String(attrs).trim()}` : '';
    return `<i data-lucide="${iconName}"${extraAttrs}></i>`;
}

export function textCell(value, attrs = '') {
    const extraAttrs = attrs ? ` ${String(attrs).trim()}` : '';
    return `<td${extraAttrs}>${escapeHtml(value ?? '')}</td>`;
}

export function renderEmptyRow(colspan, message, icon = 'inbox') {
    const safeColspan = Math.max(1, parseInt(colspan, 10) || 1);
    return `
        <tr>
            <td colspan="${safeColspan}">
                <div class="empty-state">
                    ${htmlIcon(icon)}
                    <p>${escapeHtml(message)}</p>
                </div>
            </td>
        </tr>
    `;
}

export function safeImageSrc(value) {
    const src = String(value || '').trim();
    if (/^\/uploads\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/.test(src)) return src;
    if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src;
    return '';
}

export function formatCurrency(value) {
    if (value === null || value === undefined || value === '') return '--';
    const num = Number(value);
    if (isNaN(num)) return value;
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
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
        const str = String(dateStr).trim();
        const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
        let dmyMatch = null;
        if (!ymdMatch) {
            const resolvedDmy = str.replace(/\s*-\s*/, ' ').trim();
            dmyMatch = resolvedDmy.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
        }


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
            hasTime = /[T\s]\d{1,2}:\d{2}/.test(String(dateStr));
        }
    }

    if (hasTime) {
        return `${hours}:${minutes} ngày ${day}/${month}/${year}`;
    }
    return `${day}/${month}/${year}`;
}

export function initCustomSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.setAttribute('style', 'display: none !important;');

    // 1. TRÌNH QUẢN LÝ SỰ KIỆN TOÀN CỤC
    if (!window._unifiedSelectClickListenerRegistered) {
        // Đóng menu khi nhấp chuột ra ngoài
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.custom-select-container.open').forEach(w => {
                const targetId = w.getAttribute('data-target');
                // Tìm dropdown có thể đang nằm trong body
                const absoluteDropdown = document.querySelector(`.custom-select-options[data-parent="${targetId}"]`) || w.querySelector('.custom-select-options');

                if (!w.contains(e.target) && !(absoluteDropdown && absoluteDropdown.contains(e.target))) {
                    w.classList.remove('open');
                    if (absoluteDropdown) {
                        absoluteDropdown.style.display = 'none';
                        w.appendChild(absoluteDropdown); // Thu hồi lại vào container
                    }
                }
            });
        });

        // Đóng menu khi cuộn chuột để tránh menu lơ lửng sai vị trí
        document.addEventListener('scroll', (e) => {
            if (e.target && e.target.classList && e.target.classList.contains('custom-select-options')) return;
            document.querySelectorAll('.custom-select-container.open').forEach(w => {
                const targetId = w.getAttribute('data-target');
                const absoluteDropdown = document.querySelector(`.custom-select-options[data-parent="${targetId}"]`);
                w.classList.remove('open');
                if (absoluteDropdown) {
                    absoluteDropdown.style.display = 'none';
                    w.appendChild(absoluteDropdown); // Thu hồi lại
                }
            });
        }, { capture: true, passive: true });

        window._unifiedSelectClickListenerRegistered = true;
    }

    // 2. KHỞI TẠO KHUNG BAO BỌC
    let wrapper = select.parentElement.querySelector(`.custom-select-container[data-target="${selectId}"]`);
    const options = Array.from(select.options);
    const selectedOption = select.options[select.selectedIndex] || select.options[0] || { text: '', value: '' };
    let triggerText = selectedOption.text.trim();

    if (triggerText.startsWith('Tháng ')) {
        let coreText = triggerText.substring(6).trim();
        const monthMap = { 'một': '1', 'hai': '2', 'ba': '3', 'bốn': '4', 'năm': '5', 'sáu': '6', 'bảy': '7', 'tám': '8', 'chín': '9', 'mười': '10', 'mười một': '11', 'mười hai': '12' };
        if (monthMap[coreText.toLowerCase()]) coreText = monthMap[coreText.toLowerCase()];
        triggerText = 'Th' + coreText;
    }

    const isVersionSelect = select.classList.contains('page-version-select') || select.classList.contains('version-select') || select.classList.contains('phienban-select') || select.classList.contains('modal-version-select') || select.classList.contains('version-droplist');
    const safeSelectId = escapeHtml(selectId);
    const safeTriggerText = escapeHtml(triggerText);

    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'custom-select-container';
        if (select.closest('table')) wrapper.classList.add('table-select');
        if (isVersionSelect) wrapper.classList.add('version-select-container');
        if (select.classList.contains('page-version-select')) wrapper.classList.add('page-version-select');
        wrapper.setAttribute('data-target', selectId);
        wrapper.style.position = 'relative';

        select.parentNode.insertBefore(wrapper, select.nextSibling);

        wrapper.innerHTML = `
            <div class="custom-select-trigger">
                <span>${safeTriggerText}</span>
                ${isVersionSelect ? '' : `
                <div class="custom-select-trigger-arrow">
                    <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </div>
                `}
            </div>
            <ul class="custom-select-options" data-parent="${safeSelectId}" style="display: none; background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: ${isVersionSelect ? '4px' : 'var(--radius-md)'}; box-shadow: var(--shadow-lg); z-index: 999999; list-style: none; padding: 6px 0; margin: 0; max-height: 220px; overflow-y: auto;">
                ${options.map(opt => `
                    <li data-value="${escapeHtml(opt.value)}" class="custom-option-item ${opt.selected ? 'selected' : ''}" style="padding: ${isVersionSelect ? '4px 14px' : '8px 14px'}; font-size: 0.85rem; cursor: pointer; white-space: nowrap; color: var(--text-main);">${escapeHtml(opt.text)}</li>
                `).join('')}
            </ul>
        `;

        // Sync disabled state ngay khi khởi tạo
        if (select.disabled) {
            wrapper.classList.add('disabled');
        }

        const trigger = wrapper.querySelector('.custom-select-trigger');

        // SỰ KIỆN MỞ DROPDOWN VÀ ĐẨY RA BODY
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // Không mở nếu select đang bị disabled
            if (select.disabled || wrapper.classList.contains('disabled')) return;
            const wasOpen = wrapper.classList.contains('open');
            const optionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector('.custom-select-options');

            document.dispatchEvent(new Event('click')); // Đóng các menu khác

            if (!wasOpen && optionsList) {
                wrapper.classList.add('open');

                // Đưa menu ra ngoài <body>
                document.body.appendChild(optionsList);
                optionsList.style.display = 'block';

                // Lấy tọa độ nút bấm và gắn vị trí absolute
                const rect = trigger.getBoundingClientRect();
                const scrollX = window.scrollX || window.pageXOffset;
                const scrollY = window.scrollY || window.pageYOffset;

                optionsList.style.position = 'absolute';
                optionsList.style.minWidth = rect.width + 'px';
                optionsList.style.left = (rect.left + scrollX) + 'px';

                // Tự động kiểm tra khoảng không bên dưới để drop-up/drop-down
                const dropdownHeight = optionsList.offsetHeight || 200;
                const spaceBelow = window.innerHeight - rect.bottom;

                if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
                    wrapper.classList.add('drop-up');
                    optionsList.style.top = (rect.top + scrollY - dropdownHeight - 4) + 'px';
                } else {
                    wrapper.classList.remove('drop-up');
                    optionsList.style.top = (rect.bottom + scrollY + 4) + 'px';
                }
            }
        });

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    } else {
        // Cập nhật lại HTML nếu cấu trúc thay đổi
        if (isVersionSelect && !wrapper.classList.contains('version-select-container')) wrapper.classList.add('version-select-container');
        if (select.classList.contains('page-version-select') && !wrapper.classList.contains('page-version-select')) wrapper.classList.add('page-version-select');

        // Sync disabled class khi cập nhật
        wrapper.classList.toggle('disabled', !!select.disabled);

        const optionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector('.custom-select-options');
        if (optionsList) {
            optionsList.innerHTML = options.map(opt => `
                <li data-value="${escapeHtml(opt.value)}" class="custom-option-item ${opt.selected ? 'selected' : ''}" style="padding: ${isVersionSelect ? '4px 14px' : '8px 14px'}; font-size: 0.85rem; cursor: pointer; white-space: nowrap; color: var(--text-main);">${escapeHtml(opt.text)}</li>
            `).join('');
        }

        // Luôn cập nhật lại text hiển thị trên trigger dựa trên option được chọn mới nhất
        const activeSelectedOption = select.options[select.selectedIndex] || select.options[0] || { text: '', value: '' };
        let activeTriggerText = activeSelectedOption.text.trim();
        if (activeTriggerText.startsWith('Tháng ')) {
            let coreText = activeTriggerText.substring(6).trim();
            const monthMap = { 'một': '1', 'hai': '2', 'ba': '3', 'bốn': '4', 'năm': '5', 'sáu': '6', 'bảy': '7', 'tám': '8', 'chín': '9', 'mười': '10', 'mười một': '11', 'mười hai': '12' };
            if (monthMap[coreText.toLowerCase()]) coreText = monthMap[coreText.toLowerCase()];
            activeTriggerText = 'Th' + coreText;
        }
        const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
        if (triggerSpan) triggerSpan.textContent = activeTriggerText;
    }


    // Gắn sự kiện chọn cho các option (cho cả khởi tạo mới và cập nhật lại)
    const activeOptionsList = document.querySelector(`.custom-select-options[data-parent="${selectId}"]`) || wrapper.querySelector('.custom-select-options');
    if (activeOptionsList) {
        activeOptionsList.querySelectorAll('.custom-option-item').forEach(li => {
            // Hover states
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

            // Click action
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = li.getAttribute('data-value');
                select.dispatchEvent(new Event('change', { bubbles: true }));

                // Thu hồi dropdown về thẻ mẹ
                wrapper.classList.remove('open');
                activeOptionsList.style.display = 'none';
                wrapper.appendChild(activeOptionsList);

                initCustomSelect(selectId);
            });
        });
    }
}

/**
 * Sync trạng thái disabled từ native select lên custom-select-container wrapper.
 * Gọi sau khi thay đổi select.disabled để wrapper hiển thị đúng.
 * @param {HTMLSelectElement} selectEl - Native select element
 */
export function syncCustomSelectDisabled(selectEl) {
    if (!selectEl || !selectEl.id) return;
    const wrapper = selectEl.closest('.custom-select-container') ||
        (selectEl.parentNode && selectEl.parentNode.querySelector(`.custom-select-container[data-target="${selectEl.id}"]`));
    if (!wrapper) return;
    wrapper.classList.toggle('disabled', !!selectEl.disabled);
    // Đóng dropdown nếu đang mở
    if (selectEl.disabled && wrapper.classList.contains('open')) {
        wrapper.classList.remove('open');
        const optionsList = document.body.querySelector(`.custom-select-options[data-parent="${selectEl.id}"]`) ||
            wrapper.querySelector('.custom-select-options');
        if (optionsList) {
            optionsList.style.display = 'none';
            wrapper.appendChild(optionsList);
        }
    }
}
