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
    // Clean up any orphaned dropdowns on document.body

    const select = document.getElementById(selectId);
    if (!select) return;

    const isVersion = select.classList.contains('version-droplist');
    // Compact mode: version selects in modal headers or detail pages
    const isCompact = select.classList.contains('page-version-select') || select.classList.contains('modal-version-select');
    const hasArrow = !isVersion && !isCompact;

    select.style.display = 'none';

    let wrapper = select.parentElement.querySelector(`.custom-select-container[data-target="${selectId}"]`);
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'custom-select-container' + (isVersion ? ' version-select-container' : '') + (isCompact ? ' compact-version-select-container' : '');
        wrapper.setAttribute('data-target', selectId);
        select.parentNode.insertBefore(wrapper, select.nextSibling);

        // Copy width and layout properties from select if it is inline-block (like version-droplist)
        if (isVersion) {
            wrapper.style.display = 'inline-block';
            wrapper.style.verticalAlign = 'middle';
            wrapper.style.width = '52px';
            wrapper.style.height = '22px';
            wrapper.style.margin = '0';
        } else if (isCompact) {
            wrapper.style.display = 'inline-block';
            wrapper.style.verticalAlign = 'middle';
            wrapper.style.margin = '0';
            wrapper.style.width = '70px';
            wrapper.style.minWidth = '70px';
        } else if (select.style.width) {
            wrapper.style.width = select.style.width;
        }

        if (!window._customSelectClickListenerRegistered) {
            document.addEventListener('click', (e) => {
                document.querySelectorAll('.custom-select-container.open').forEach(w => {
                    const targetId = w.getAttribute('data-target');
                    const dropdownEl = document.querySelector(`.custom-select-dropdown[data-target="${targetId}"]`);

                    const clickedInsideWrapper = w.contains(e.target);
                    const clickedInsideDropdown = dropdownEl && dropdownEl.contains(e.target);

                    if (!clickedInsideWrapper && !clickedInsideDropdown) {
                        w.classList.remove('open');
                        if (dropdownEl && dropdownEl.parentElement === document.body) {
                            w.appendChild(dropdownEl); // Trả lại về wrapper gốc
                            dropdownEl.style.opacity = '';
                            dropdownEl.style.visibility = '';
                            dropdownEl.style.transform = '';
                            dropdownEl.style.top = '';
                            dropdownEl.style.left = '';
                        }
                    }
                });

                // Periodic GC of any orphaned dropdown elements left on the body
                document.querySelectorAll('body > .custom-select-dropdown').forEach(dropdown => {
                    const targetId = dropdown.getAttribute('data-target');
                    const selectEl = document.getElementById(targetId);
                    const wrapperEl = document.querySelector(`.custom-select-container[data-target="${targetId}"]`);
                    if (!selectEl || !wrapperEl || (wrapperEl.offsetWidth === 0 && wrapperEl.offsetHeight === 0)) {
                        dropdown.remove();
                    }
                });
            });
            window._customSelectClickListenerRegistered = true;
        }

        // Register a global scroll listener once to close dropdowns and return them when scrolling
        if (!window._customSelectScrollListenerRegistered) {
            window.addEventListener('scroll', () => {
                document.querySelectorAll('.custom-select-container').forEach(w => {
                    w.classList.remove('open');
                    const targetId = w.getAttribute('data-target');
                    const dropdownEl = document.querySelector(`.custom-select-dropdown[data-target="${targetId}"]`);
                    if (dropdownEl && dropdownEl.parentElement === document.body) {
                        w.appendChild(dropdownEl);
                        dropdownEl.style.opacity = '';
                        dropdownEl.style.visibility = '';
                        dropdownEl.style.transform = '';
                    }
                });
            }, { passive: true });
            window._customSelectScrollListenerRegistered = true;
        }
    }
    // Đăng ký thêm trình lắng nghe sự kiện cuộn cho riêng bảng dữ liệu (overflow-x: auto)
    if (!window._customSelectTableScrollListenerRegistered) {
        document.addEventListener('scroll', (e) => {
            // Nếu phần tử đang cuộn chính là container chứa bảng dữ liệu của bạn
            if (e.target && e.target.classList && e.target.classList.contains('table-container')) {
                document.querySelectorAll('.custom-select-container.open').forEach(w => {
                    w.classList.remove('open');
                    const targetId = w.getAttribute('data-target');
                    const dropdownEl = document.querySelector(`.custom-select-dropdown[data-target="${targetId}"]`);
                    if (dropdownEl && dropdownEl.parentElement === document.body) {
                        w.appendChild(dropdownEl);
                        dropdownEl.style.opacity = '';
                        dropdownEl.style.visibility = '';
                        dropdownEl.style.transform = '';
                    }
                });
            }
        }, { capture: true, passive: true }); // Dùng capture: true để bắt được sự kiện cuộn từ các thẻ con bên trong
        window._customSelectTableScrollListenerRegistered = true;
    }
    const options = Array.from(select.options);
    const selectedOption = select.options[select.selectedIndex] || select.options[0] || { text: '', value: '' };

    let triggerText = selectedOption.text.trim();

    // Chuẩn hóa hiển thị viết tắt cho bộ lọc Tháng để giao diện gọn gàng
    if (triggerText.startsWith('Tháng ')) {
        // Loại bỏ chữ "Tháng " để lấy phần lõi dữ liệu phía sau
        let coreText = triggerText.substring(6).trim();

        // Bản đồ chuẩn hóa chữ thành số nếu dữ liệu trả về dạng chữ tiếng Việt
        const monthMap = {
            'một': '1', 'hai': '2', 'ba': '3', 'bốn': '4', 'năm': '5', 'sáu': '6',
            'bảy': '7', 'tám': '8', 'chín': '9', 'mười': '10', 'mười một': '11', 'mười hai': '12'
        };

        if (monthMap[coreText.toLowerCase()]) {
            coreText = monthMap[coreText.toLowerCase()];
        }

        triggerText = 'Th' + coreText;
    }

    // Check if the current custom markup is already up-to-date
    const triggerTextEl = wrapper.querySelector('.custom-select-trigger span');
    const existingOptions = Array.from(wrapper.querySelectorAll('.custom-select-option'));

    let needsUpdate = false;
    if (!triggerTextEl || triggerTextEl.textContent !== triggerText) {
        needsUpdate = true;
    } else if (existingOptions.length !== options.length) {
        needsUpdate = true;
    } else {
        for (let i = 0; i < options.length; i++) {
            const optEl = existingOptions[i];
            const opt = options[i];
            if (optEl.getAttribute('data-value') !== opt.value ||
                optEl.querySelector('span').textContent !== opt.text ||
                optEl.classList.contains('selected') !== opt.selected) {
                needsUpdate = true;
                break;
            }
        }
    }

    if (needsUpdate) {
        // Clean up any old dropdown with the same target currently on body before replacing innerHTML
        const oldDropdownOnBody = document.body.querySelector(`.custom-select-dropdown[data-target="${selectId}"]`);
        if (oldDropdownOnBody) {
            oldDropdownOnBody.remove();
        }

        wrapper.innerHTML = `
            <div class="custom-select-trigger">
                <span>${triggerText}</span>
                ${hasArrow ? `
                <div class="custom-select-trigger-arrow">
                    <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                </div>
                ` : ''}
            </div>
            <div class="custom-select-dropdown${isVersion ? ' version-select-dropdown' : ''}${isCompact ? ' compact-version-select-dropdown' : ''}" data-target="${selectId}">
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

            // Close all other dropdowns first and return them to their wrappers
            document.querySelectorAll('.custom-select-container').forEach(w => {
                if (w !== wrapper) {
                    w.classList.remove('open');
                    const targetId = w.getAttribute('data-target');
                    const otherDropdown = document.querySelector(`.custom-select-dropdown[data-target="${targetId}"]`);
                    if (otherDropdown && otherDropdown.parentElement === document.body) {
                        w.appendChild(otherDropdown);
                        otherDropdown.style.opacity = '';
                        otherDropdown.style.visibility = '';
                        otherDropdown.style.transform = '';
                    }
                }
            });

            const isOpen = wrapper.classList.toggle('open');
            if (isOpen) {
                // 1. Lấy tọa độ tuyệt đối trên màn hình
                const rect = trigger.getBoundingClientRect();

                // 2. Đưa Dropdown ra hẳn thẻ body để không bao giờ bị bảng che khuất
                document.body.appendChild(dropdown);

                // 3. Neo tọa độ chính xác từng pixel (KHÔNG cộng thêm window.scroll)
                dropdown.style.position = 'fixed';
                dropdown.style.top = (rect.bottom + 4) + 'px';
                dropdown.style.left = rect.left + 'px';
                dropdown.style.right = 'auto';
                dropdown.style.bottom = 'auto';

                // Xóa bỏ các thuộc tính gây lệch
                dropdown.style.margin = '0';
                dropdown.style.transform = 'none';

                // 4. Định hình kích thước
                if (isVersion) {
                    dropdown.style.width = '52px';
                    dropdown.style.minWidth = '52px';
                } else if (isCompact) {
                    dropdown.style.width = '70px';
                    dropdown.style.minWidth = '70px';
                } else {
                    dropdown.style.minWidth = rect.width + 'px';
                    dropdown.style.width = 'max-content';
                }

                dropdown.style.zIndex = '999999';

                // 5. Hiển thị Dropdown
                dropdown.style.opacity = '1';
                dropdown.style.visibility = 'visible';

            } else {
                // Khi đóng lại, ẩn Dropdown và đưa nó về lại vị trí nằm trong bảng
                dropdown.style.opacity = '0';
                dropdown.style.visibility = 'hidden';
                wrapper.appendChild(dropdown);
            }
        });

        wrapper.querySelectorAll('.custom-select-option').forEach(optEl => {
            optEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = optEl.getAttribute('data-value');
                select.value = val;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                wrapper.classList.remove('open');

                // Return dropdown to wrapper
                if (dropdown.parentElement === document.body) {
                    wrapper.appendChild(dropdown);
                    dropdown.style.opacity = '';
                    dropdown.style.visibility = '';
                    dropdown.style.transform = '';
                }

                initCustomSelect(selectId);
            });
        });

        if (hasArrow && window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }
}

