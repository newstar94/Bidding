export async function initAddressDropdowns(tinhSelectId, xaSelectId, currentTinhName = '', currentXaName = '', isDisabled = false) {
    const tinhSelect = document.getElementById(tinhSelectId);
    const xaSelect = document.getElementById(xaSelectId);
    if (!tinhSelect || !xaSelect) return;

    // Reset xa select and disable it
    xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
    xaSelect.disabled = true;
    tinhSelect.disabled = isDisabled;

    // Fetch provinces if not already cached (qua proxy nội bộ, tránh bị chặn CSP)
    if (!window._vietnamProvinces || !Array.isArray(window._vietnamProvinces) || window._vietnamProvinces.length === 0) {
        window._vietnamProvinces = null;
        try {
            const res = await fetch('/api/address/provinces');
            if (res.ok) {
                const data = await res.json();
                window._vietnamProvinces = Array.isArray(data) ? data : null;
                if (!window._vietnamProvinces || window._vietnamProvinces.length === 0) {
                    console.error("Provinces API returned empty data");
                    tinhSelect.innerHTML = '<option value="">Lỗi: Dữ liệu tỉnh thành trống</option>';
                    return;
                }
            } else {
                console.error("Failed to fetch provinces, status:", res.status);
                tinhSelect.innerHTML = '<option value="">Lỗi tải danh sách tỉnh thành</option>';
                return;
            }
        } catch (err) {
            console.error("Error loading provinces:", err);
            tinhSelect.innerHTML = '<option value="">Không thể tải danh sách tỉnh thành</option>';
            return;
        }
    }

    // Populate Tinh dropdown
    tinhSelect.innerHTML = '<option value="">-- Chọn Tỉnh/Thành phố --</option>' +
        window._vietnamProvinces.map(p => `<option value="${p.code}" data-name="${p.name}">${p.name}</option>`).join('');

    // Select current Province if matching
    if (currentTinhName) {
        const foundProvince = window._vietnamProvinces.find(p => p.name === currentTinhName);
        if (foundProvince) {
            tinhSelect.value = foundProvince.code;
        }
    }

    const loadWards = async (provinceCode, selectWardName = '') => {
        if (!provinceCode) {
            xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>';
            xaSelect.disabled = true;
            return;
        }

        xaSelect.innerHTML = '<option value="">Đang tải...</option>';
        xaSelect.disabled = true;

        window._vietnamWards = window._vietnamWards || {};
        if (!window._vietnamWards[provinceCode] || !Array.isArray(window._vietnamWards[provinceCode])) {
            try {
                // Proxy nội bộ: server gọi API v2 và trả về danh sách xã/phường trực tiếp
                const res = await fetch(`/api/address/wards/${provinceCode}`);
                if (res.ok) {
                    const data = await res.json();
                    window._vietnamWards[provinceCode] = Array.isArray(data) ? data : [];
                } else {
                    xaSelect.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
                    return;
                }
            } catch (err) {
                xaSelect.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
                return;
            }
        }

        const wards = window._vietnamWards[provinceCode];
        xaSelect.innerHTML = '<option value="">-- Chọn Xã/Phường --</option>' +
            wards.map(w => `<option value="${w.code}" data-name="${w.name}">${w.name}</option>`).join('');
        xaSelect.disabled = isDisabled;

        if (selectWardName) {
            const foundWard = wards.find(w => w.name === selectWardName);
            if (foundWard) {
                xaSelect.value = foundWard.code;
            }
        }
    };

    // Change listener
    tinhSelect.onchange = (e) => {
        loadWards(e.target.value);
    };

    // If province is already selected, trigger load of wards
    if (tinhSelect.value) {
        await loadWards(tinhSelect.value, currentXaName);
    }

    // Wrap elements into searchable dropdowns
    makeSearchableSelect(tinhSelect, 'Tìm kiếm Tỉnh/Thành phố...');
    makeSearchableSelect(xaSelect, 'Tìm kiếm Xã/Phường...');
}


export function makeSearchableSelect(select, placeholder) {
    if (!select) return;

    // Mark this select to prevent it from being converted to custom-select-container
    select.setAttribute('data-no-custom', 'true');

    // Check if already initialized
    let wrapper = select.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${select.id}"]`);
    if (wrapper) {
        // Just refresh options
        refreshCustomOptions(select, wrapper);
        return;
    }

    // Create wrapper
    wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    wrapper.setAttribute('data-select-id', select.id);

    // Hide original select
    select.style.display = 'none';

    // Insert wrapper right after select
    select.parentNode.insertBefore(wrapper, select.nextSibling);

    // Create search input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-select-search';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.disabled = select.disabled;

    // Create toggle arrow
    const arrow = document.createElement('div');
    arrow.className = 'custom-select-arrow';
    arrow.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" style="display: block;"><path d="m6 9 6 6 6-6"/></svg>`;

    // Create options container
    const optionsList = document.createElement('ul');
    optionsList.className = 'custom-select-options';

    wrapper.appendChild(input);
    wrapper.appendChild(arrow);
    wrapper.appendChild(optionsList);

    // Populate initial options
    refreshCustomOptions(select, wrapper);

    // Toggle dropdown visibility
    const toggleDropdown = (show) => {
        if (input.disabled) return;
        if (show === undefined) {
            wrapper.classList.toggle('open');
        } else if (show) {
            wrapper.classList.add('open');
        } else {
            wrapper.classList.remove('open');
        }

        if (wrapper.classList.contains('open')) {
            // Scroll to the selected item if any
            const selectedItem = optionsList.querySelector('.selected');
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: 'nearest' });
            }
        }
    };

    input.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown(true);
    });

    input.addEventListener('focus', () => {
        toggleDropdown(true);
        input.select();
    });

    arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    // Filtering when typing
    input.addEventListener('input', () => {
        const query = input.value.toLowerCase().trim();
        const items = optionsList.querySelectorAll('li:not(.custom-select-no-results)');
        let hasResults = false;

        items.forEach(item => {
            const val = item.getAttribute('data-value');
            const opt = Array.from(select.options).find(o => o.value === val);
            const searchAttr = opt ? opt.getAttribute('data-search') || '' : '';
            const text = (item.textContent + ' ' + searchAttr).toLowerCase();
            if (text.includes(query)) {
                item.style.display = '';
                hasResults = true;
            } else {
                item.style.display = 'none';
            }
        });

        let noResultsMsg = optionsList.querySelector('.custom-select-no-results');
        if (!hasResults) {
            if (!noResultsMsg) {
                noResultsMsg = document.createElement('li');
                noResultsMsg.className = 'custom-select-no-results';
                noResultsMsg.textContent = 'Không tìm thấy kết quả';
                optionsList.appendChild(noResultsMsg);
            }
        } else if (noResultsMsg) {
            noResultsMsg.remove();
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            toggleDropdown(false);
            // Reset input text to current selection name
            const selectedOpt = select.options[select.selectedIndex];
            input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : '';
            // Reset item list state
            optionsList.querySelectorAll('li').forEach(item => item.style.display = '');
            const noResultsMsg = optionsList.querySelector('.custom-select-no-results');
            if (noResultsMsg) noResultsMsg.remove();
        }
    });

    // Keep custom input & selection highlighted state in sync with programmatic value modifications
    select.addEventListener('change', () => {
        const selectedOpt = select.options[select.selectedIndex];
        input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : '';
        optionsList.querySelectorAll('li').forEach(li => {
            if (li.getAttribute('data-value') === select.value) {
                li.className = 'selected';
            } else {
                li.className = '';
            }
        });
    });

    // Listen to form reset events
    const parentForm = select.closest('form');
    if (parentForm) {
        parentForm.addEventListener('reset', () => {
            setTimeout(() => {
                const selectedOpt = select.options[select.selectedIndex];
                input.value = selectedOpt && selectedOpt.value ? selectedOpt.text : '';
                optionsList.querySelectorAll('li').forEach(li => {
                    if (li.getAttribute('data-value') === (select.value || '')) {
                        li.className = 'selected';
                    } else {
                        li.className = '';
                    }
                });
            }, 0);
        });
    }

    // Observe changes inside original select (e.g. innerHTML changed or disabled status modified)
    const observer = new MutationObserver(() => {
        refreshCustomOptions(select, wrapper);
    });
    observer.observe(select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
}


function refreshCustomOptions(select, wrapper) {
    const input = wrapper.querySelector('.custom-select-search');
    const optionsList = wrapper.querySelector('.custom-select-options');

    input.disabled = select.disabled;

    // Clear options
    optionsList.innerHTML = '';

    const options = Array.from(select.options);
    options.forEach(opt => {
        const li = document.createElement('li');
        li.textContent = opt.text;
        li.setAttribute('data-value', opt.value);

        if (opt.selected) {
            li.className = 'selected';
            input.value = opt.value ? opt.text : '';
        }

        li.addEventListener('click', (e) => {
            e.stopPropagation();
            select.value = opt.value;
            // Trigger native change event so listeners fire
            select.dispatchEvent(new Event('change', { bubbles: true }));

            // Update highlighted
            optionsList.querySelectorAll('li').forEach(item => item.classList.remove('selected'));
            li.classList.add('selected');
            input.value = opt.value ? opt.text : '';

            wrapper.classList.remove('open');
        });

        optionsList.appendChild(li);
    });
}
