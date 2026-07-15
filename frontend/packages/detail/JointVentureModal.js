export function renderJointVentureModalHeader() {
  return `
    <h3>Thành viên liên danh</h3>
    <button class="modal-close" id="btn-close-mothau-jv-view">&times;</button>
  `;
}

export function renderJointVentureModalBody({ leadCodeHtml, leadNameHtml, membersHtml }) {
  return `
    <div class="bf-s-8df25cd500">
      <div class="bf-s-7f07b6bbca">Thành viên đứng đầu liên danh</div>
      <div class="bf-s-16fbb6e0cf">
        <div>
          <div class="bf-s-68d41663ac">Mã/MST thành viên đứng đầu</div>
          <div class="bf-s-00e10034b0">${leadCodeHtml}</div>
        </div>
        <div>
          <div class="bf-s-68d41663ac">Tên thành viên đứng đầu</div>
          <div class="bf-s-00e10034b0">${leadNameHtml}</div>
        </div>
      </div>
    </div>
    <h4 class="bf-s-7931d119ba">Danh sách Thành viên liên danh</h4>
    <div class="bf-s-3bd1b07b13">${membersHtml}</div>
  `;
}

export function renderJointVentureModalFooter() {
  return '<button type="button" class="btn btn-primary" id="btn-ok-mothau-jv-view">Đóng</button>';
}
