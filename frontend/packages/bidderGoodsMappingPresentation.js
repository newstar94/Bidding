import { escapeHtml } from "../shared/view_helpers.js";

export function buildBidderGoodsMappingModalMarkup(row, requirements = []) {
  return `
    <div class="modal-card bidder-goods-mapping-modal">
      <div class="modal-header">
        <div><h3>Đối chiếu danh mục yêu cầu</h3><p>Chỉ cần chọn khi hệ thống không thể tự ghép chính xác.</p></div>
        <button type="button" class="modal-close" data-bidder-goods-mapping-close aria-label="Đóng"><i data-lucide="x" aria-hidden="true"></i></button>
      </div>
      <div class="modal-body">
        <div class="bidder-goods-mapping-subject"><span>Hàng hóa dự thầu</span><strong>${escapeHtml(row.danhMucHangHoa || "—")}</strong><small>${escapeHtml([row.kyMaHieu, row.nhanHieu].filter(Boolean).join(" · ") || "Chưa có ký mã hiệu, nhãn hiệu")}</small></div>
        ${requirements.length ? `
          <div class="form-group">
            <label for="bidder-goods-mapping-choice">Danh mục hàng hóa trong E-HSMT</label>
            <select id="bidder-goods-mapping-choice" class="form-control">
              <option value="">— Chọn danh mục tương ứng —</option>
              ${requirements.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(row.goiThauHangHoaId || "") ? "selected" : ""}>${escapeHtml(`${item.maHangHoa ? `${item.maHangHoa} – ` : ""}${item.tenHangHoa || "Chưa có tên"}`)}</option>`).join("")}
            </select>
            <small class="form-hint">Danh sách đã được giới hạn theo phần lô đang đánh giá.</small>
          </div>`
          : '<div class="alert alert-warning" role="alert">Không có danh mục yêu cầu phù hợp trong phần lô đang đánh giá.</div>'}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-bidder-goods-mapping-close>Hủy</button>
        <button type="button" class="btn btn-primary" id="btn-bidder-goods-mapping-confirm" ${requirements.length ? "" : "disabled"}>Xác nhận đối chiếu</button>
      </div>
    </div>`;
}
