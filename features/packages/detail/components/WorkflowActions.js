export function renderWorkflowActions(container, { canCancel = false, onCancel } = {}) {
  if (!container) return;
  container.innerHTML = `
    <button class="btn btn-outline" data-bf-action="switch-tab" data-tab="goithau"
      style="padding: 10px 20px; font-weight: 600; display: flex; align-items: center; gap: 6px; height: 38px;">
      <i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> Quay lại danh sách
    </button>
    ${canCancel ? `
      <button id="btn-workflow-cancel-package" class="btn btn-danger"
        style="padding: 10px 20px; font-weight: 600; display: flex; align-items: center; gap: 6px; height: 38px; background-color: var(--danger, #ef4444); color: white; border: none; border-radius: var(--radius-md); cursor: pointer;">
        <i data-lucide="x-circle" style="width: 16px; height: 16px;"></i> Hủy thầu
      </button>
    ` : ""}
  `;
  const cancelButton = container.querySelector?.("#btn-workflow-cancel-package");
  if (cancelButton) cancelButton.onclick = () => onCancel?.();
}
