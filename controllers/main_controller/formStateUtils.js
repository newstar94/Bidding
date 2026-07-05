export function setVisible(element, visible, display = 'flex') {
    if (!element) return;
    element.style.display = visible ? display : 'none';
}

export function setRequired(element, required) {
    if (!element) return;
    if (required) {
        element.setAttribute('required', 'true');
    } else {
        element.removeAttribute('required');
    }
}

export function setDisabled(element, disabled) {
    if (!element) return;
    element.disabled = Boolean(disabled);
    if (typeof window !== 'undefined' && typeof window.syncCustomSelectDisabled === 'function' && element.id) {
        window.syncCustomSelectDisabled(element.id);
    }
}

export function setReadonlyVisual(element, readonly) {
    if (!element) return;
    if (readonly) {
        element.setAttribute('readonly', 'true');
        element.style.pointerEvents = 'none';
        element.style.background = 'var(--neutral-soft)';
        element.style.cursor = 'not-allowed';
    } else {
        element.removeAttribute('readonly');
        element.style.pointerEvents = 'auto';
        element.style.background = '';
        element.style.cursor = 'auto';
    }
}

export function setFieldFeedback(input, { state = 'clear', message = '', color = '' } = {}) {
    const formGroup = input?.closest?.('.form-group') || null;
    const errorEl = (input?.id ? document.getElementById(`${input.id}-error`) : null)
        || formGroup?.querySelector?.('.error-text')
        || null;

    if (formGroup) {
        formGroup.classList.remove('invalid', 'warning');
        if (state === 'invalid') formGroup.classList.add('invalid');
        if (state === 'warning') formGroup.classList.add('warning');
    }

    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.color = color || '';
        errorEl.style.display = message ? 'block' : '';
    }
}
