export function resetPackageFormEditableState(form) {
    if (!form) return;

    form.querySelectorAll('.form-group').forEach(group => group.classList.remove('invalid'));
    form.querySelectorAll('input, select, textarea').forEach(element => {
        element.disabled = false;
        const wrapper = element.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${element.id}"]`);
        const searchInput = wrapper?.querySelector('.custom-select-search');
        if (searchInput) searchInput.disabled = false;
    });
    form.querySelectorAll('button').forEach(button => {
        button.disabled = false;
        button.style.display = '';
    });
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.style.display = '';
}

export function setPackageSubTableActionsVisible(visible) {
    const display = visible ? '' : 'none';
    [
        'btn-them-giahan',
        'btn-them-yeucaulamro',
        'btn-them-traloilamro'
    ].forEach(buttonId => {
        const button = document.getElementById(buttonId);
        if (button) button.style.display = display;
    });

    document.querySelectorAll(
        '#giahan-table .col-action, #yeucaulamro-table .col-action, #traloilamro-table .col-action'
    ).forEach(cell => {
        cell.style.display = display;
    });

    document.querySelectorAll(
        '#gt-giahan-tbody .remove-gh-row-btn, #gt-yeucaulamro-tbody .remove-yc-row-btn, #gt-traloilamro-tbody .remove-tl-row-btn'
    ).forEach(button => {
        const cell = button.closest('td');
        if (cell) cell.style.display = display;
        button.style.display = display;
    });
}
