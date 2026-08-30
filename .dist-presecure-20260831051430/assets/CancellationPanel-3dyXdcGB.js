import{n as l}from"./view_helpers-CdPIbaii.js";import{ct as o}from"./app-RPlYyKwL.js";import{t as u}from"./evaluationMetadata-CL3Bxm_v.js";function y(a){return u(a).metadata}function m(a,{pkg:c,formatDate:d,initDatePicker:r,onSave:i}){const e=y(c.danhGiaHsdtMetadata).cancelDetails||{},n=c.trangThai==="Hủy thầu",t=n?"disabled":"";a.innerHTML=o(`
    <div class="card package-cancellation-panel">
      <h4 class="package-cancellation-title"><i data-lucide="x-circle"></i> Quyết định Hủy thầu</h4>
      <div class="package-cancellation-form">
        <div class="package-cancellation-grid">
          <div class="form-group"><label>Số quyết định hủy thầu <span class="text-danger">*</span></label><input type="text" id="cancel-dec-no" class="form-control" value="${l(e.soQuyetDinhHuyThau||"")}" placeholder="VD: 123/QĐ-CDT" ${t}></div>
          <div class="form-group"><label>Ngày quyết định hủy thầu <span class="text-danger">*</span></label><input type="text" id="cancel-dec-date" class="form-control flatpickr-date" value="${l(e.ngayQuyetDinhHuyThau?d(e.ngayQuyetDinhHuyThau):"")}" placeholder="dd/MM/yyyy" ${t}></div>
        </div>
        <div class="form-group"><label>Lý do hủy thầu <span class="text-danger">*</span></label><textarea id="cancel-reason" class="form-control" rows="5" placeholder="Nhập lý do hủy thầu..." ${t}>${l(e.lyDoHuyThau||"")}</textarea></div>
        ${n?"":'<div><button id="btn-save-cancel-details" class="btn btn-primary"><i data-lucide="check"></i> Xác nhận hủy thầu</button></div>'}
      </div>
    </div>`),r?.(a);const s=a.querySelector("#btn-save-cancel-details");s&&(s.onclick=()=>i?.({decisionNumber:a.querySelector("#cancel-dec-no")?.value.trim()||"",decisionDate:a.querySelector("#cancel-dec-date")?.value.trim()||"",reason:a.querySelector("#cancel-reason")?.value.trim()||"",controls:{decisionNumber:a.querySelector("#cancel-dec-no"),decisionDate:a.querySelector("#cancel-dec-date"),reason:a.querySelector("#cancel-reason")}}))}export{m as renderCancellationPanel};
