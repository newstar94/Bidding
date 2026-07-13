export function renderJointVentureModalHeader() {
  return `
    <h3>Thành viên liên danh</h3>
    <button class="modal-close" id="btn-close-mothau-jv-view">&times;</button>
  `;
}

export function renderJointVentureModalBody({ leadCodeHtml, leadNameHtml, membersHtml }) {
  return `
    <div style="background: var(--primary-soft); padding: 12px 16px; border-radius: var(--radius-md); margin-bottom: 20px;">
      <div style="font-size: 0.78rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 8px;">Thành viên đứng đầu liên danh</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div>
          <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Mã/MST thành viên đứng đầu</div>
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${leadCodeHtml}</div>
        </div>
        <div>
          <div style="font-size: 0.72rem; color: var(--text-light); margin-bottom: 2px;">Tên thành viên đứng đầu</div>
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary);">${leadNameHtml}</div>
        </div>
      </div>
    </div>
    <h4 style="margin: 0 0 12px 0; font-size: 0.88rem; font-weight: 800;">Danh sách Thành viên liên danh</h4>
    <div style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto; padding-right: 4px;">${membersHtml}</div>
  `;
}

export function renderJointVentureModalFooter() {
  return '<button type="button" class="btn btn-primary" id="btn-ok-mothau-jv-view">Đóng</button>';
}
