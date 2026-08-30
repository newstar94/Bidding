import{i as S,n as A,o as k}from"./apiClient-CeM1mzJZ.js";import{n as l}from"./view_helpers-CdPIbaii.js";import{ct as y}from"./app-RPlYyKwL.js";import{t as T}from"./PackageSummary-C22V5dxg.js";var C=25*1024*1024,L=new Set(["pdf","docx","xlsx"]),p=new Map;function v(t,e,n){const c=`${t}:${h(e)}:${n}`;return p.has(c)||p.set(c,globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`),{identity:c,value:p.get(c)}}var D=Object.freeze({ACTIVE:"Đang đánh giá",CLOSED:"Đã có kết quả",DRAFT:"Bản nháp",VOID:"Đã hủy",LEGACY:"Tài liệu lịch sử"});function w(t){const e=Math.max(0,Number(t)||0);return e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}function E(t){const e=new Date(t);return!t||Number.isNaN(e.getTime())?"Không rõ thời gian":new Intl.DateTimeFormat("vi-VN",{dateStyle:"short",timeStyle:"short"}).format(e)}function h(t={}){return`${String(t.evaluationBatchId||"package").trim()||"package"}::${String(t.type||"").trim()}`}function f(t,e,n=""){const c=`/api/packages/${encodeURIComponent(t)}/documents/${encodeURIComponent(e.type)}${n}`,a=String(e.evaluationBatchId||"").trim();return a?`${c}?evaluationBatchId=${encodeURIComponent(a)}`:c}function M(t){const e=l(h(t)),n=l(t?.label||"Tài liệu"),c=l(t?.icon||"file-text"),a=t?.document,i=t?.canUpload===!0,r=t?.canDelete===!0,o=a?`
      <div class="package-document-file">
        <div class="package-document-file-icon" aria-hidden="true">
          <i data-lucide="file-check-2"></i>
        </div>
        <div class="package-document-file-copy">
          <strong title="${l(a.originalFilename||"")}">${l(a.originalFilename||"Tài liệu")}</strong>
          <span>${w(a.sizeBytes)} · ${l(a.uploadedByName||"Người dùng")} · ${l(E(a.uploadedAt))}</span>
        </div>
      </div>`:`
      <div class="package-document-empty">
        <span>Chưa có tài liệu</span>
        <small>PDF, DOCX hoặc XLSX · tối đa 25 MB</small>
      </div>`,s=a?"Thay file":"Chọn file";return`
    <article class="package-document-card" data-document-card="${e}" role="row">
      <div class="package-document-type-cell" role="cell">
        <span class="package-document-cell-label">Loại tài liệu</span>
        <div class="package-document-card-header">
          <span class="package-document-type-icon" aria-hidden="true"><i data-lucide="${c}"></i></span>
          <div>
            <h4>${n}</h4>
            <span class="package-document-status ${a?"is-ready":""}">${a?"Đã tải lên":"Chưa đính kèm"}</span>
          </div>
        </div>
      </div>
      <div class="package-document-card-body" role="cell">
        <span class="package-document-cell-label">Tài liệu</span>
        ${o}
      </div>
      <div class="package-document-action-cell" role="cell">
        <span class="package-document-cell-label">Thao tác</span>
        <footer class="package-document-actions">
          ${a?`<button type="button" class="btn btn-outline" data-document-download="${e}"><i data-lucide="download"></i> Tải xuống</button>`:""}
          ${i?`
            <input class="package-document-input" type="file" id="package-document-${e}" data-document-input="${e}" accept=".pdf,.docx,.xlsx" hidden>
            <button type="button" class="btn ${a?"btn-outline-primary":"btn-primary"}" data-document-upload="${e}">
              <i data-lucide="${a?"refresh-cw":"upload-cloud"}"></i> ${s}
            </button>`:""}
          ${a&&r?`<button type="button" class="btn package-document-delete" data-document-delete="${e}" aria-label="Xóa ${n}"><i data-lucide="trash-2"></i> Xóa</button>`:""}
        </footer>
        <p class="package-document-live-status" data-document-status="${e}" aria-live="polite"></p>
      </div>
    </article>`}function K(t){const e=Array.isArray(t?.slots)?t.slots:[],n=l(t?.title||"Tài liệu gói thầu"),c=l(t?.description||""),a=Number(t?.sequenceNo)||0,i=Array.isArray(t?.lotCodes)?t.lotCodes.filter(Boolean):[],r=String(t?.status||"").trim().toUpperCase(),o=D[r]||r,s=l(t?.scopeKey||"package"),u=i.length?`<p class="package-document-section-lots"><strong>Phần lô:</strong> ${l(i.join(", "))}</p>`:"";return`
    <section class="package-document-section" data-document-section="${s}" aria-label="${n}">
      <header class="package-document-section-header">
        <div class="package-document-section-heading">
          <span class="package-document-section-icon" aria-hidden="true"><i data-lucide="${a?"layers-3":"folder-open"}"></i></span>
          <div>
            ${a?`<span class="package-document-section-index">Lần ${a}</span>`:""}
            <h3>${n}</h3>
            ${c?`<p>${c}</p>`:""}
            ${u}
          </div>
        </div>
        ${o?`<span class="package-document-section-status is-${l(r.toLowerCase())}">${l(o)}</span>`:""}
      </header>
      <div class="package-documents-table" role="table" aria-label="${n}">
        <div class="package-documents-table-head" role="rowgroup">
          <div class="package-documents-table-header" role="row">
            <span role="columnheader">Loại tài liệu</span>
            <span role="columnheader">Tài liệu</span>
            <span class="package-document-action-heading" role="columnheader">Thao tác</span>
          </div>
        </div>
        <div class="package-documents-table-body" role="rowgroup">
          ${e.map(M).join("")}
        </div>
      </div>
    </section>`}function x(t,e){if(!e)return"";const n=t?.model?.getLatestPlan?.(e.keHoachId)||null,c=n?(t?.model?.state?.chudautu||[]).find(a=>String(a.id)===String(n.chuDauTuId)):null;return T({pkg:e,planName:n?.tenKeHoach||"Không rõ",investorName:c?.tenChuDauTu||"Không rõ",formatCurrency:a=>t?.model?.formatCurrency?.(a)||"--",formatDateTime:a=>t?.model?.formatDateWithTime?.(a)||"--"})}function B(t,{summaryMarkup:e=""}={}){const n=Array.isArray(t?.sections)?t.sections.filter(c=>Array.isArray(c?.slots)&&c.slots.length):Array.isArray(t?.slots)&&t.slots.length?[{scopeKey:"package",title:"Tài liệu gói thầu",slots:t.slots}]:[];return`
    <section class="package-documents-panel" aria-label="Tài liệu gói thầu">
      ${e}
      ${n.length?`<div class="package-document-sections">${n.map(K).join("")}</div>`:`
      <div class="package-documents-empty-state">
        <span aria-hidden="true"><i data-lucide="folder-open"></i></span>
        <h4>Chưa có tài liệu ở bước này</h4>
        <p>Các tài liệu đã tải sẽ tiếp tục hiển thị tại đây khi gói thầu chuyển bước.</p>
      </div>`}
    </section>`}function U(){return`
    <div class="package-documents-loading" role="status">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>Đang tải danh sách tài liệu...</span>
    </div>`}function q(t){return`
    <div class="package-documents-error" role="alert">
      <i data-lucide="circle-alert" aria-hidden="true"></i>
      <div><strong>Không tải được tài liệu</strong><p>${l(t||"Vui lòng thử lại.")}</p></div>
      <button type="button" class="btn btn-outline" data-document-retry><i data-lucide="refresh-cw"></i> Thử lại</button>
    </div>`}function $(t,e){return String(t?._currentWorkflowPackageId||"")===String(e)&&t?._currentWorkflowTab==="documents"}async function N(t,e,n){const c=h(n),a=document.querySelector(`[data-document-status="${CSS.escape(c)}"]`);a&&(a.textContent="Đang chuẩn bị file tải xuống...");try{const i=await A(f(e,n,"/download"),{timeoutMs:12e4,retries:0});if(!i.ok){const u=await i.json().catch(()=>null);throw new Error(u?.error||"Không thể tải tài liệu.")}const r=await i.blob(),o=URL.createObjectURL(r),s=document.createElement("a");s.href=o,s.download=n.document?.originalFilename||"tai-lieu",s.hidden=!0,document.body.appendChild(s),s.click(),s.remove(),URL.revokeObjectURL(o),a&&(a.textContent="")}catch(i){a&&(a.textContent=""),await t.customAlert("Không thể tải file",i?.message||"Vui lòng thử lại.","circle-alert")}}async function P(t,e,n,c,a,i){const r=String(c?.name||"").split(".").pop()?.toLowerCase();if(!c||!L.has(r)){await t.customAlert("Tệp không hợp lệ","Chỉ hỗ trợ tệp PDF, DOCX hoặc XLSX.","alert-triangle");return}if(c.size<=0||c.size>C){await t.customAlert("Tệp không hợp lệ","Dung lượng tệp phải lớn hơn 0 và không vượt quá 25 MB.","alert-triangle");return}const o=h(n),s=a.querySelector(`[data-document-card="${CSS.escape(o)}"]`),u=s?.querySelector("[data-document-status]"),m=s?.querySelectorAll("button");m?.forEach(d=>{d.disabled=!0}),u&&(u.textContent="Đang tải lên và kiểm tra tệp...");try{const d=new FormData;d.append("file",c,c.name);const g=v(e,n,"upload");await k(f(e,n),{method:"PUT",body:d,retries:0,timeoutMs:12e4,headers:{"Idempotency-Key":g.value}}),p.delete(g.identity),await t.customAlert("Thành công",n.document?"Đã thay file tài liệu.":"Đã tải tài liệu lên.","check-circle"),await b(t,{contentWrapper:a,packageId:e,pkg:i})}catch(d){m?.forEach(g=>{g.disabled=!1}),u&&(u.textContent=""),await t.customAlert("Không thể tải file",d?.message||"Vui lòng thử lại.","circle-alert")}}async function F(t,e,n,c,a){if(await t.customConfirm("Xóa tài liệu",`Bạn có chắc chắn muốn xóa "${n.label}"?`,"trash-2"))try{const i=v(e,n,"delete");await k(f(e,n),{method:"DELETE",retries:0,headers:{"Idempotency-Key":i.value}}),p.delete(i.identity),await t.customAlert("Thành công","Đã xóa tài liệu.","check-circle"),await b(t,{contentWrapper:c,packageId:e,pkg:a})}catch(i){await t.customAlert("Không thể xóa",i?.message||"Vui lòng thử lại.","circle-alert")}}function I(t,e,n,c,a){const i=Array.isArray(n.sections)?n.sections.flatMap(o=>o?.slots||[]):n.slots||[],r=new Map(i.map(o=>[h(o),o]));c.querySelectorAll("[data-document-upload]").forEach(o=>{o.addEventListener("click",()=>{const s=o.getAttribute("data-document-upload");c.querySelector(`[data-document-input="${CSS.escape(s)}"]`)?.click()})}),c.querySelectorAll("[data-document-input]").forEach(o=>{o.addEventListener("change",async()=>{const s=o.getAttribute("data-document-input"),u=r.get(s),m=o.files?.[0];u&&m&&await P(t,e,u,m,c,a),o.value=""})}),c.querySelectorAll("[data-document-download]").forEach(o=>{o.addEventListener("click",async()=>{const s=r.get(o.getAttribute("data-document-download"));s&&await N(t,e,s)})}),c.querySelectorAll("[data-document-delete]").forEach(o=>{o.addEventListener("click",async()=>{const s=r.get(o.getAttribute("data-document-delete"));s&&await F(t,e,s,c,a)})})}async function b(t,{contentWrapper:e,packageId:n,pkg:c}){const a=x(t,c);e.innerHTML=y(`
    <section class="package-documents-panel" aria-label="Tài liệu gói thầu">
      ${a}
      ${U()}
    </section>`);try{const i=await S(`/api/packages/${encodeURIComponent(n)}/documents`,{retries:0});if(!$(t,n))return;e.innerHTML=y(B(i,{summaryMarkup:a})),I(t,n,i,e,c),t.createIconsScoped?.(e)}catch(i){if(!$(t,n))return;e.innerHTML=y(`
      <section class="package-documents-panel" aria-label="Tài liệu gói thầu">
        ${a}
        ${q(i?.message)}
      </section>`),e.querySelector("[data-document-retry]")?.addEventListener("click",()=>{b(t,{contentWrapper:e,packageId:n,pkg:c})}),t.createIconsScoped?.(e)}}export{b as renderPackageDocumentsPanel};
