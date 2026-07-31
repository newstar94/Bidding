import { trustedHTML } from "../../shared/trustedTypes.js";
import { buttonMarkup } from "../../shared/Button.js";
export function renderWorkflowActions(container, { canCancel = false, onCancel } = {}) {
  if (!container) return;
  container.innerHTML = trustedHTML(`
    ${buttonMarkup({
      variant: "outline",
      icon: "arrow-left",
      label: "Quay lại danh sách",
      className: "bf-s-884f09ff2f",
      attributes: { "data-bf-action": "switch-tab", "data-tab": "goithau" },
    })}
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
