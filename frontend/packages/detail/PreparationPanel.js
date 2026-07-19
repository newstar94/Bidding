import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";
import { registerCommandArgs } from "../../shared/commandArgs.js";

export function renderPreparationActionPanel(container, pkg) {
  if (!container) return;
  const isPreparing = pkg?.trangThai === "Chuẩn bị";
  const status = escapeHtml(pkg?.trangThai || "--");
  const packageArgsKey = registerCommandArgs([String(pkg?.id || "")]);
  const content = isPreparing ? `
    <div class="package-state-icon is-warning">
      <i data-lucide="settings"></i>
    </div>
    <h4 class="package-state-title">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
    <p class="package-state-description">
      Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
    </p>
    <button class="btn btn-primary workflow-primary-action" data-bf-action="call" data-fn="phatHanhHsmtGoiThau" data-arg-key="${packageArgsKey}">
      <i data-lucide="send"></i> Phát hành HSMT &amp; Mời thầu
    </button>
  ` : `
    <div class="package-state-icon is-success">
      <i data-lucide="check-circle"></i>
    </div>
    <h4 class="package-state-title">Gói thầu đã phát hành HSMT</h4>
    <p class="package-state-description">
      Gói thầu này đã hoàn thành bước chuẩn bị và đã phát hành hồ sơ mời thầu (Trạng thái hiện tại: <strong class="text-primary">${status}</strong>). Bạn có thể chuyển sang các tab tiếp theo để xem/nhập thông tin mở thầu và chấm thầu.
    </p>
  `;
  container.innerHTML = trustedHTML(`
    <div class="package-panel-empty">
      ${content}
    </div>
  `);
}
