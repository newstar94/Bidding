export function renderWorkflowActions(container, { canCancel = false, onCancel } = {}) {
  if (!container) return;
  container.innerHTML = `
    <button class="btn btn-outline bf-s-884f09ff2f" data-bf-action="switch-tab" data-tab="goithau"
     >
      <i data-lucide="arrow-left" class="bf-s-c1f1f4a417"></i> Quay lại danh sách
    </button>
    ${canCancel ? `
      <button id="btn-workflow-cancel-package" class="btn btn-danger bf-s-6fa7fd987d"
       >
        <i data-lucide="x-circle" class="bf-s-c1f1f4a417"></i> Hủy thầu
      </button>
    ` : ""}
  `;
  const cancelButton = container.querySelector?.("#btn-workflow-cancel-package");
  if (cancelButton) cancelButton.onclick = () => onCancel?.();
}
