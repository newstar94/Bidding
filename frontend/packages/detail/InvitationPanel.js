import { trustedHTML } from "../../shared/trustedTypes.js";
import { registerCommandArgs } from "../../shared/commandArgs.js";

const HEADER_CLASS_BY_STYLE = Object.freeze({
  "width: 120px; text-align: center;": "col-number text-center",
  "width: 80px; text-align: center;": "col-index text-center",
  "width: 250px;": "col-datetime"
});

function renderListCard({ title, addButtonId, addLabel, tableId, bodyId, headers, editMode }) {
  const editClass = editMode ? "" : "is-hidden";
  return `
    <div class="card package-section-card">
      <div class="package-section-header">
        <h4 class="package-section-title">${title}</h4>
        <button type="button" id="${addButtonId}" class="btn btn-outline btn-sm compact-action ${editClass}">
          <i data-lucide="plus" class="icon-sm"></i> ${addLabel}
        </button>
      </div>
      <div class="table-container package-table-frame">
        <table class="data-table table-full-width" id="${tableId}" data-row-pagination="true" aria-label="Danh sách phát hành hồ sơ mời thầu">
          <thead><tr>${headers.map((header) => `<th class="${HEADER_CLASS_BY_STYLE[header.style] || ""}">${header.label}</th>`).join("")}<th class="col-actions-sm ${editClass}"></th></tr></thead>
          <tbody id="${bodyId}"></tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderInvitationPanel(container, pkg, { summaryHtml = "", editMode = false } = {}) {
  if (!container) return;
  const packageArgsKey = registerCommandArgs([String(pkg?.id || "")]);
  const required = '<span class="required-marker">*</span>';
  const extensionCard = renderListCard({
    title: "Gia hạn thời điểm đóng thầu",
    addButtonId: "btn-them-giahan",
    addLabel: "Thêm gia hạn",
    tableId: "giahan-table",
    bodyId: "gt-giahan-tbody",
    editMode,
    headers: [
      { label: "Lần gia hạn", style: "width: 120px; text-align: center;" },
      { label: `Thời gian đóng thầu ${required}` },
      { label: `Lý do gia hạn ${required}` }
    ]
  });
  const requestCard = renderListCard({
    title: "Yêu cầu làm rõ HSMT",
    addButtonId: "btn-them-yeucaulamro",
    addLabel: "Thêm yêu cầu",
    tableId: "yeucaulamro-table",
    bodyId: "gt-yeucaulamro-tbody",
    editMode,
    headers: [
      { label: "STT", style: "width: 80px; text-align: center;" },
      { label: `Thời gian yêu cầu làm rõ ${required}`, style: "width: 250px;" },
      { label: `Nội dung yêu cầu ${required}` }
    ]
  });
  const responseCard = renderListCard({
    title: "Trả lời làm rõ",
    addButtonId: "btn-them-traloilamro",
    addLabel: "Thêm trả lời",
    tableId: "traloilamro-table",
    bodyId: "gt-traloilamro-tbody",
    editMode,
    headers: [
      { label: "STT", style: "width: 80px; text-align: center;" },
      { label: `Thời gian trả lời làm rõ ${required}`, style: "width: 250px;" },
      { label: `Nội dung trả lời ${required}` }
    ]
  });
  container.innerHTML = trustedHTML(`
    ${summaryHtml}
    ${extensionCard}
    ${requestCard}
    ${responseCard}
    <div class="workflow-action-row is-spread with-divider">
      <button class="btn btn-primary workflow-primary-action" data-bf-action="call" data-fn="moThauGoiThau" data-arg-key="${packageArgsKey}">
        <i data-lucide="unlock"></i> Tiến hành Mở thầu
      </button>
      <button class="btn btn-primary workflow-primary-action ${editMode ? "is-success" : ""}" id="btn-luu-thongtinmoithau">
        <i data-lucide="${editMode ? "save" : "edit-3"}"></i> ${editMode ? "Lưu thông tin mời thầu" : "Chỉnh sửa"}
      </button>
    </div>
  `);
}
