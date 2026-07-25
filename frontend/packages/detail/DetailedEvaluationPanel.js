import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";

const GROUP_LABELS = Object.freeze({
  validity: "Tính hợp lệ",
  capacity: "Năng lực và kinh nghiệm",
  technical: "Kỹ thuật",
  financial: "Tài chính",
});

const ROUND_LABELS = Object.freeze({
  single: "Một túi hồ sơ",
  technical: "Kỹ thuật",
  financial: "Tài chính",
});

function documentSection(context = {}, group) {
  const source = context.templateSource || "14A";
  const consulting = source === "14D";
  const documentType = consulting || source === "14C" ? "E-HSĐXKT" : "E-HSDT";
  const sections = {
    validity: {
      number: consulting ? "Mẫu số 01" : "Mẫu số 01",
      title: `ĐÁNH GIÁ TÍNH HỢP LỆ CỦA ${documentType}`,
      columns: ["STT", `Nội dung đánh giá trong ${documentType}`, "Kết quả tự động từ Hệ thống", "Kết quả của chuyên gia", "Điểm", "Nhận xét của chuyên gia (nếu có)"],
    },
    capacity: {
      number: "Mẫu số 02",
      title: "ĐÁNH GIÁ VỀ NĂNG LỰC VÀ KINH NGHIỆM",
      columns: ["STT", "Các tiêu chí năng lực và kinh nghiệm trong E-HSMT", "Thông tin trong E-HSDT", "Kết quả của chuyên gia", "Điểm", "Nhận xét của chuyên gia (nếu có)"],
    },
    technical: {
      number: consulting ? "Mẫu số 02" : "Mẫu số 03A/03B",
      title: "ĐÁNH GIÁ VỀ KỸ THUẬT",
      subtitle: consulting ? "(Sử dụng phương pháp chấm điểm)" : "(Theo phương pháp đánh giá trong E-HSMT)",
      columns: ["STT", "Nội dung đánh giá", "Mức điểm quy định trong E-HSMT", "Kết quả đánh giá của chuyên gia", "Điểm đánh giá", "Nhận xét của chuyên gia"],
    },
    financial: {
      number: consulting ? "Mẫu số 02/02B" : source === "14C" ? "Mẫu số 06A/06B/06C" : "Mẫu số 07A/07B",
      title: "TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ VỀ TÀI CHÍNH",
      columns: ["STT", "Nội dung", "Giá trị/Thông tin", "Kết quả đánh giá", "Điểm", "Nhận xét"],
    },
  };
  return sections[group] || sections.validity;
}

function resultOptions(selected) {
  return [
    ["pending", "Chưa đánh giá"],
    ["pass", "Đạt"],
    ["fail", "Không đạt"],
    ["not_applicable", "Không áp dụng"],
  ].map(([value, label]) => (
    `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
  )).join("");
}

function renderResultControl(criterion, row, disabled) {
  const attributes = disabled ? "disabled" : "";
  const label = escapeHtml(criterion.name || criterion.code || "Tiêu chí");
  if (criterion.resultType === "text") {
    return `<textarea class="form-control" data-detailed-field="nhanXet" aria-label="Kết quả ${label}" ${attributes}>${escapeHtml(row.nhanXet || "")}</textarea>`;
  }
  if (criterion.resultType === "number") {
    return `<input type="number" min="0" class="form-control" data-detailed-field="diem" aria-label="Giá trị ${label}" value="${escapeHtml(row.diem ?? "")}" ${attributes}>`;
  }
  const score = criterion.resultType === "score"
    ? `<input type="number" min="0" ${criterion.maxScore != null ? `max="${escapeHtml(criterion.maxScore)}"` : ""} class="form-control" data-detailed-field="diem" aria-label="Điểm ${label}" value="${escapeHtml(row.diem ?? "")}" ${attributes} placeholder="Điểm">`
    : "";
  return `<select class="form-control" data-detailed-field="ketQua" aria-label="Kết quả ${label}" ${attributes}>${resultOptions(row.ketQua || "pending")}</select>${score}`;
}

export function renderDetailedEvaluationPanel(container, {
  pkg,
  bids = [],
  selectedBidId = "",
  context,
  activeGroup = "validity",
  criteria = [],
  report = null,
  progress = { completed: 0, total: 0 },
  readOnly = false,
  canReopen = false,
  warning = "",
} = {}) {
  if (!container) return;
  const rows = new Map(
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  const selectedBid = bids.find((bid) => String(bid.id) === String(selectedBidId));
  const section = documentSection(context, activeGroup);
  const tabs = (context?.visibleGroups || []).map((group) => {
    const active = group === activeGroup;
    return `
      <button type="button" id="detailed-evaluation-tab-${group}" role="tab"
        aria-selected="${active ? "true" : "false"}"
        aria-controls="detailed-evaluation-tab-panel"
        tabindex="${active ? "0" : "-1"}"
        class="btn package-workflow-tab ${active ? "active" : ""}"
        data-no-icon
        data-detailed-evaluation-group="${group}">${GROUP_LABELS[group] || group}</button>
    `;
  }).join("");
  const criterionRows = criteria.map((criterion, index) => {
    const row = rows.get(String(criterion.id)) || {
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pending",
    };
    const disabled = readOnly || !(context?.editableGroups || []).includes(activeGroup);
    const attributes = disabled ? "disabled" : "";
    return `
      <tr data-detailed-criterion-id="${escapeHtml(criterion.id)}">
        <td><strong class="detailed-evaluation-stt">${index + 1}</strong></td>
        <td class="text-wrap">${escapeHtml(criterion.name || "")}${criterion.required !== false ? ' <span class="required" aria-label="Bắt buộc">*</span>' : ""}</td>
        <td><textarea class="form-control" data-detailed-field="noiDungHsdt" aria-label="Nội dung HSDT cho ${escapeHtml(criterion.name || criterion.code || "tiêu chí")}" ${attributes}>${escapeHtml(row.noiDungHsdt || "")}</textarea></td>
        <td><div class="detailed-evaluation-field-stack detailed-evaluation-result-stack">${renderResultControl(criterion, row, disabled)}</div></td>
        <td class="detailed-evaluation-score">${criterion.resultType === "score" ? escapeHtml(criterion.maxScore ?? "--") : escapeHtml(row.diem ?? "--")}</td>
        <td>
          <div class="detailed-evaluation-field-stack">
            <textarea class="form-control" data-detailed-field="nhanXet" aria-label="Nhận xét đánh giá" ${attributes} placeholder="Nhận xét đánh giá">${escapeHtml(row.nhanXet || "")}</textarea>
            <textarea class="form-control" data-detailed-field="lyDoKhongDat" aria-label="Lý do không đạt" ${attributes} placeholder="Lý do không đạt">${escapeHtml(row.lyDoKhongDat || "")}</textarea>
          </div>
        </td>
        <td>
          <div class="detailed-evaluation-field-stack">
            <textarea class="form-control" data-detailed-field="yeuCauLamRo" aria-label="Yêu cầu làm rõ" ${attributes} placeholder="Yêu cầu làm rõ">${escapeHtml(row.yeuCauLamRo || "")}</textarea>
            <textarea class="form-control" data-detailed-field="ketQuaLamRo" aria-label="Kết quả làm rõ" ${attributes} placeholder="Kết quả làm rõ">${escapeHtml(row.ketQuaLamRo || "")}</textarea>
            <input type="text" class="form-control" data-detailed-field="taiLieuThamChieu" aria-label="Tài liệu tham chiếu" value="${escapeHtml(row.taiLieuThamChieu || "")}" ${attributes} placeholder="Tài liệu tham chiếu">
          </div>
        </td>
      </tr>`;
  }).join("");
  const status = report?.trangThai === "completed"
    ? "Hoàn thành"
    : report ? "Bản nháp" : "Chưa đánh giá";
  const statusClass = report?.trangThai === "completed" ? "badge-success" : "badge-warning";
  const progressTotal = Math.max(Number(progress.total) || 0, 1);
  const progressCompleted = Math.min(Number(progress.completed) || 0, progressTotal);
  const roundLabel = ROUND_LABELS[context?.roundType] || context?.roundType || "--";
  const selectedIndex = bids.findIndex((bid) => String(bid.id) === String(selectedBidId));
  const bidderNavigation = bids.length > 1 ? `
    <div class="detailed-evaluation-navigation" aria-label="Điều hướng hồ sơ dự thầu">
      <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-previous" ${selectedIndex <= 0 ? "disabled" : ""}>
        <i data-lucide="chevron-left" aria-hidden="true"></i> Nhà thầu trước
      </button>
      <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-next" ${selectedIndex < 0 || selectedIndex >= bids.length - 1 ? "disabled" : ""}>
        Nhà thầu tiếp theo <i data-lucide="chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  ` : "";
  const actionButtons = !selectedBid
    ? ""
    : readOnly
      ? report?.trangThai === "completed" && canReopen
        ? '<button type="button" class="btn btn-primary" id="btn-detailed-evaluation-reopen">Chỉnh sửa báo cáo chi tiết</button>'
        : ""
      : '<button type="button" class="btn btn-secondary" id="btn-detailed-evaluation-save-draft">Lưu bản nháp</button><button type="button" class="btn btn-secondary" id="btn-detailed-evaluation-complete-group">Hoàn thành tab</button><button type="button" class="btn btn-primary" id="btn-detailed-evaluation-complete-report">Hoàn thành đánh giá nhà thầu</button>';
  container.innerHTML = trustedHTML(`
    <section class="detailed-evaluation-panel" aria-labelledby="detailed-evaluation-title">
      <div class="detailed-evaluation-topbar">
        <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-back"><i data-lucide="arrow-left" aria-hidden="true"></i> Quay lại báo cáo tổng quát</button>
      </div>
      <header class="detailed-evaluation-hero">
        <span class="detailed-evaluation-eyebrow">Báo cáo đánh giá chi tiết</span>
        <h3 id="detailed-evaluation-title">${escapeHtml(pkg?.tenGoiThau || "")}</h3>
        <p>Phương thức: ${escapeHtml(pkg?.phuongThucLuaChon || "--")} <span aria-hidden="true">·</span> Vòng đánh giá: ${escapeHtml(roundLabel)} <span aria-hidden="true">·</span> Lĩnh vực: ${escapeHtml(pkg?.linhVuc || "--")}</p>
      </header>
      ${warning ? `<div class="alert alert-warning" role="status">${escapeHtml(warning)}</div>` : ""}
      <div class="detailed-evaluation-overview">
        <div class="form-group detailed-evaluation-bid-field">
          <label for="detailed-evaluation-bid-select">Nhà thầu/Hồ sơ dự thầu</label>
          <select id="detailed-evaluation-bid-select" class="form-control">
            ${bids.map((bid) => `<option value="${escapeHtml(bid.id)}" ${String(bid.id) === String(selectedBidId) ? "selected" : ""}>${escapeHtml(bid.label)}</option>`).join("")}
          </select>
        </div>
        <div class="detailed-evaluation-metric">
          <span class="detailed-evaluation-metric-label">Trạng thái</span>
          <strong id="detailed-evaluation-status" class="badge ${statusClass}">${status}</strong>
        </div>
        <div class="detailed-evaluation-metric">
          <span class="detailed-evaluation-metric-label">Tiến độ</span>
          <strong id="detailed-evaluation-progress">${progress.completed}/${progress.total} tiêu chí</strong>
          <progress class="detailed-evaluation-progress" max="${progressTotal}" value="${progressCompleted}" aria-label="Tiến độ đánh giá"></progress>
        </div>
      </div>
      ${selectedBid ? bidderNavigation : '<div class="package-panel-empty">Chưa có hồ sơ dự thầu phù hợp.</div>'}
      <div class="detailed-evaluation-tabs" role="tablist" aria-label="Nhóm đánh giá">${tabs}</div>
      <div id="detailed-evaluation-tab-panel" class="detailed-evaluation-tab-panel" role="tabpanel" aria-labelledby="detailed-evaluation-tab-${escapeHtml(activeGroup)}">
        <div class="table-container package-table-frame has-bottom-space detailed-evaluation-table-frame">
        <table class="data-table detailed-evaluation-table" data-no-sort="true" data-density="comfortable">
          <colgroup>
            <col class="detailed-evaluation-col-stt">
            <col class="detailed-evaluation-col-criterion">
            <col class="detailed-evaluation-col-content">
            <col class="detailed-evaluation-col-result">
            <col class="detailed-evaluation-col-score">
            <col class="detailed-evaluation-col-comment">
            <col class="detailed-evaluation-col-clarification">
          </colgroup>
          <thead>
            <tr class="detailed-evaluation-header-group">
              <th rowspan="2">${escapeHtml(section.columns[0])}</th>
              <th rowspan="2">${escapeHtml(section.columns[1])}</th>
              <th rowspan="2">${escapeHtml(section.columns[2])}</th>
              <th colspan="2">${escapeHtml(section.columns[3])}</th>
              <th rowspan="2">${escapeHtml(section.columns[5] || "Nhận xét")}</th>
              <th rowspan="2">Làm rõ</th>
            </tr>
            <tr class="detailed-evaluation-header-subgroup">
              <th>Đạt / Không đạt</th><th>${escapeHtml(section.columns[4] || "Điểm")}</th>
            </tr>
          </thead>
          <tbody id="detailed-evaluation-criteria-body">${criterionRows || '<tr><td colspan="7">Chưa có tiêu chí trong nhóm này.</td></tr>'}</tbody>
        </table>
        </div>
      </div>
      ${actionButtons ? `<div class="workflow-action-row detailed-evaluation-actions with-divider">${actionButtons}</div>` : ""}
    </section>
  `);
}
