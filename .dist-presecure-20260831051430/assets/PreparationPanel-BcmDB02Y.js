import{n as s}from"./view_helpers-CdPIbaii.js";import{ct as c}from"./app-RPlYyKwL.js";import{t as e}from"./commandArgs-CPcYF9sW.js";function u(a,t){if(!a)return;const i=t?.trangThai==="Chuẩn bị",n=s(t?.trangThai||"--"),h=e([String(t?.id||"")]);a.innerHTML=c(`
    <div class="package-panel-empty">
      ${i?`
    <div class="package-state-icon is-warning">
      <i data-lucide="settings"></i>
    </div>
    <h4 class="package-state-title">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
    <p class="package-state-description">
      Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
    </p>
    <button class="btn btn-primary workflow-primary-action" data-bf-action="call" data-fn="phatHanhHsmtGoiThau" data-arg-key="${h}">
      <i data-lucide="send"></i> Phát hành HSMT &amp; Mời thầu
    </button>
  `:`
    <div class="package-state-icon is-success">
      <i data-lucide="check-circle"></i>
    </div>
    <h4 class="package-state-title">Gói thầu đã phát hành HSMT</h4>
    <p class="package-state-description">
      Gói thầu này đã hoàn thành bước chuẩn bị và đã phát hành hồ sơ mời thầu (Trạng thái hiện tại: <strong class="text-primary">${n}</strong>). Bạn có thể chuyển sang các tab tiếp theo để xem/nhập thông tin mở thầu và chấm thầu.
    </p>
  `}
    </div>
  `)}export{u as renderPreparationActionPanel};
