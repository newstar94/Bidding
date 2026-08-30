import{r}from"./runtimeStyles-DWYSnTnQ.js";import{n as m}from"./view_helpers-CdPIbaii.js";import{ct as b}from"./app-RPlYyKwL.js";import{n as L,o as v}from"./MutationService-DkIl1rmN.js";import{t as g}from"./commandArgs-CPcYF9sW.js";import{t as p}from"./packageValidation-a1oj_CJk.js";import{t as w}from"./PackageSummary-C22V5dxg.js";async function x(t,a,{extensions:i=[],clarificationRequests:n=[],clarificationResponses:o=[],convertDateTime:e}={}){a.giaHanList=i,a.yeuCauLamRoList=n,a.traLoiLamRoList=o;const l=i[i.length-1];if(l?.thoiGianDongThau){const d=e(l.thoiGianDongThau);a.thoiGianDongThau=d,a.thoiGianMoThau=d}return v(t.model,"goithau",a),(await L(t,"goithau",{changes:{upserts:{goithau:[a]}}}))?.ok===!1||typeof t?.fetchRecordByLookup!="function"?a:await t.fetchRecordByLookup("goithau",a.id)||a}var $=Object.freeze({"width: 120px; text-align: center;":"col-number text-center","width: 80px; text-align: center;":"col-index text-center","width: 250px;":"col-datetime"});function h({title:t,addButtonId:a,addLabel:i,tableId:n,bodyId:o,headers:e,editMode:l}){const d=l?"":"is-hidden";return`
    <div class="card package-section-card">
      <div class="package-section-header">
        <h4 class="package-section-title">${t}</h4>
        <button type="button" id="${a}" class="btn btn-outline btn-sm compact-action ${d}">
          <i data-lucide="plus" class="icon-sm"></i> ${i}
        </button>
      </div>
      <div class="table-container package-table-frame">
        <table class="data-table table-full-width" id="${n}" data-row-pagination="true" aria-label="Danh sách phát hành hồ sơ mời thầu">
          <thead><tr>${e.map(u=>`<th class="${$[u.style]||""}">${u.label}</th>`).join("")}<th class="col-actions-sm ${d}"></th></tr></thead>
          <tbody id="${o}"></tbody>
        </table>
      </div>
    </div>
  `}function R(t,a,{summaryHtml:i="",editMode:n=!1}={}){if(!t)return;const o=g([String(a?.id||"")]),e='<span class="required-marker">*</span>';t.innerHTML=b(`
    ${i}
    ${h({title:"Gia hạn thời điểm đóng thầu",addButtonId:"btn-them-giahan",addLabel:"Thêm gia hạn",tableId:"giahan-table",bodyId:"gt-giahan-tbody",editMode:n,headers:[{label:"Lần gia hạn",style:"width: 120px; text-align: center;"},{label:`Thời gian đóng thầu ${e}`},{label:`Lý do gia hạn ${e}`}]})}
    ${h({title:"Yêu cầu làm rõ HSMT",addButtonId:"btn-them-yeucaulamro",addLabel:"Thêm yêu cầu",tableId:"yeucaulamro-table",bodyId:"gt-yeucaulamro-tbody",editMode:n,headers:[{label:"STT",style:"width: 80px; text-align: center;"},{label:`Thời gian yêu cầu làm rõ ${e}`,style:"width: 250px;"},{label:`Nội dung yêu cầu ${e}`}]})}
    ${h({title:"Trả lời làm rõ",addButtonId:"btn-them-traloilamro",addLabel:"Thêm trả lời",tableId:"traloilamro-table",bodyId:"gt-traloilamro-tbody",editMode:n,headers:[{label:"STT",style:"width: 80px; text-align: center;"},{label:`Thời gian trả lời làm rõ ${e}`,style:"width: 250px;"},{label:`Nội dung trả lời ${e}`}]})}
    <div class="workflow-action-row is-spread with-divider">
      <button class="btn btn-primary workflow-primary-action" data-bf-action="call" data-fn="moThauGoiThau" data-arg-key="${o}">
        <i data-lucide="unlock"></i> Tiến hành Mở thầu
      </button>
      <button class="btn btn-primary workflow-primary-action ${n?"is-success":""}" id="btn-luu-thongtinmoithau">
        <i data-lucide="${n?"save":"edit-3"}"></i> ${n?"Lưu thông tin mời thầu":"Chỉnh sửa"}
      </button>
    </div>
  `)}function I(t,a,{isDirectOrSpecial:i=!1}={}){t&&(t.innerHTML=b(`
    <select id="mothau-goithau-select" class="is-hidden"><option value="${m(a?.id||"")}" selected>${m(a?.tenGoiThau||"")}</option></select>
    <div id="mothau-goithau-summary" class="is-hidden"></div>
    <div id="mothau-bid-container" class="is-hidden">
      <div class="package-section-header">
        <h4 id="mothau-table-title" class="package-section-title is-neutral">${i?"Danh sách Nhà thầu":"Danh sách Nhà thầu tham dự &amp; Nộp hồ sơ"}</h4>
        <div class="compact-action-group mothau-opening-actions">
          <button class="btn-excel-action" id="btn-mothau-import-msc" type="button"><i data-lucide="cloud-download"></i> Lấy dữ liệu mở thầu tự động</button>
          <button class="btn-excel-action btn-download-excel-template-direct" data-type="mothau" id="btn-mothau-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
          <button class="btn-excel-action btn-import-excel-direct" data-type="mothau" id="btn-mothau-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
          <button class="btn btn-outline btn-sm compact-action" id="btn-mothau-add-bid"><i data-lucide="plus"></i> ${i?"Thêm nhà thầu":"Thêm Nhà thầu nộp hồ sơ"}</button>
        </div>
      </div>
      <div class="table-container package-table-frame has-bottom-space">
        <table class="data-table table-full-width" id="mothau-table" data-row-pagination="true" aria-label="Biên bản mở thầu">
          <thead id="mothau-table-thead"></thead>
          <tbody id="mothau-table-tbody"></tbody>
        </table>
      </div>
      <div class="workflow-action-row">
        <button class="btn btn-primary workflow-primary-action" id="btn-mothau-save"><i data-lucide="save"></i> ${i?"Lưu thông tin":"Lưu thông tin mở thầu"}</button>
      </div>
    </div>
    <div id="mothau-empty-state" class="is-hidden"></div>
  `))}function f(t){return t?.hinhThucLuaChon==="Chỉ định thầu rút gọn"||t?.hinhThucLuaChon==="Lựa chọn nhà thầu trong trường hợp đặc biệt"}function S(t){return f(t)?"opening":t?.trangThai==="Chuẩn bị"?"preparation":t?.trangThai==="Đang mời thầu"?"invitation":"opening"}function y(t,a,{timeIds:i=!1}={}){const n=t.model.getLatestPlan(a.keHoachId),o=n?t.model.state.chudautu.find(e=>e.id===n.chuDauTuId):null;return w({pkg:a,planName:n?.tenKeHoach||"Không rõ",investorName:o?.tenChuDauTu||"Không rõ",formatCurrency:e=>t.model.formatCurrency(e),formatDateTime:e=>t.model.formatDateWithTime(e),timeIds:i})}function H(t,a,i){const n=g([String(i.id||"")]);a.innerHTML=b(`
    ${y(t,i)}
    <div class="bf-s-4cee5cb79b">
      <div class="bf-s-dca86ff56c"><i data-lucide="settings" class="bf-s-f5c02a2822"></i></div>
      <h4 class="bf-s-4c428a6a8c">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
      <p class="bf-s-ed725428b7">Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.</p>
      <button class="btn btn-primary bf-s-43ee718714" data-bf-action="call" data-fn="phatHanhHsmtGoiThau" data-arg-key="${m(n)}">
        <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
      </button>
    </div>`)}function D(t){t.querySelectorAll("#gt-giahan-tbody input, #gt-yeucaulamro-tbody input, #gt-traloilamro-tbody input").forEach(a=>{a.disabled=!0,r(a,"background","var(--neutral-soft)"),r(a,"cursor","not-allowed")}),t.querySelectorAll("#gt-giahan-tbody td:last-child, #gt-yeucaulamro-tbody td:last-child, #gt-traloilamro-tbody td:last-child").forEach(a=>r(a,"display","none"))}function M(t,a,i,n){[["#btn-them-giahan","addGiaHanRow"],["#btn-them-yeucaulamro","addYeuCauLamRoRow"],["#btn-them-traloilamro","addTraLoiLamRoRow"]].forEach(([e,l])=>{const d=a.querySelector(e);d&&(d.onclick=()=>n?.[l]?.())});const o=a.querySelector("#btn-luu-thongtinmoithau");o&&(o.onclick=async()=>{if(!t._biddingInfoEditMode){t._biddingInfoEditMode=!0,t.showPackageDetails(i.id);return}const e=n?._collectGiaHanRows()||[],l=n?._collectYeuCauLamRoRows()||[],d=n?._collectTraLoiLamRoRows()||[],u=Array.from(a.querySelectorAll("#gt-giahan-tbody tr")),c=p(i.thoiGianDongThau||"",u.map(s=>({timeStr:s.querySelector(".gh-time-input")?.value.trim()||"",reason:s.querySelector(".gh-reason-input")?.value.trim()||""})));if(!c.valid){const s=u[c.rowIndex]?.querySelector(c.field==="reason"?".gh-reason-input":".gh-time-input");await t.customAlert("Dữ liệu không hợp lệ",c.error,"alert-triangle",s),n?.validateGiaHanRealtime?.();return}const T=await x(n||t,i,{extensions:e,clarificationRequests:l,clarificationResponses:d,convertDateTime:s=>t.model.convertDMYHMSToYMDHMS(s)});t._biddingInfoEditMode=!1,await t.showPackageDetails(T.id),await t.customAlert("Thành công","Lưu thông tin mời thầu thành công!","check-circle")})}function P(t,a,i,n){R(a,i,{summaryHtml:y(t,i,{timeIds:!0}),editMode:t._biddingInfoEditMode}),n?._loadGiaHanRows(i.giaHanList||[]),n?._loadYeuCauLamRoRows(i.yeuCauLamRoList||[]),n?._loadTraLoiLamRoRows(i.traLoiLamRoList||[]),t._biddingInfoEditMode||D(a),M(t,a,i,n)}function N(t,{contentWrapper:a,pkg:i,appController:n}={}){const o=S(i);return o==="preparation"?H(t,a,i):o==="invitation"?P(t,a,i,n):(I(a,i,{isDirectOrSpecial:f(i)}),n?.renderMoThauPanel?.()),window.lucide?.createIcons({root:a}),o}export{N as renderPackageOpeningPanel};
