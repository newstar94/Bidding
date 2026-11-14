import { trustedHTML } from "../../shared/trustedTypes.js";
import { buttonMarkup } from "../../shared/Button.js";
export function renderWorkflowActions(container, { canCancel = false, onCancel } = {}) {
  if (!container) return;
  // The back action lives beside the title (tab_goithau_detail.html).
  container.innerHTML = trustedHTML(`
    ${canCancel ? buttonMarkup({
      id: "btn-workflow-cancel-package",
      variant: "danger",
      icon: "x-circle",
      label: "Hủy thầu",
      ariaLabel: "Hủy gói thầu",
      className: "bf-s-6fa7fd987d",
    }) : ""}
  `);
  const cancelButton = container.querySelector?.("#btn-workflow-cancel-package");
  if (cancelButton) cancelButton.onclick = () => onCancel?.();
}
