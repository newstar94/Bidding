import{r as H}from"./runtimeStyles-DWYSnTnQ.js";import{n as qt,o as jt}from"./apiClient-CeM1mzJZ.js";import{n as Wt,t as Ft}from"./workflow_helpers-D7V1aW71.js";import{l as y,n as d}from"./view_helpers-CdPIbaii.js";import{W as yt,ct as A}from"./app-RPlYyKwL.js";import{i as at,t as gt}from"./domUtils-ByCXOQ5o.js";import{t as Rt}from"./idUtils-BXB1QuPt.js";import{t as zt}from"./workspaceRenderCache-BIPtUnPy.js";import{n as Et}from"./jvDataStore-DLAlVQzK.js";import{t as Pt}from"./commandBus-CHqMiCNa.js";import{n as Ut,s as Xt}from"./runtimeState-DuFYp7S3.js";import{n as Yt,t as J}from"./lotJsonParser-NcMWQnCj.js";import{r as Jt,s as Zt}from"./evaluationMethodRules-CW6GTI60.js";import{n as te,r as lt,t as ee}from"./evaluationMetadata-CL3Bxm_v.js";import"./TablePagination-BSo1CB_l.js";import{_ as Bt,a as ae,g as Tt,m as _t,n as ne,o as dt,u as ie,y as Mt}from"./lotEvaluationScope-CB0bwEDI.js";import{a as re,i as et,n as oe,r as se}from"./contractorVersionBinding-CLPoZrqc.js";import{t as vt}from"./packageAppraisal-CP92vlFS.js";import{n as Kt,t as Gt}from"./bidEvaluationLowPriceRules-CAgsJS5M.js";import{n as ce}from"./BiddingCalculations-qjk9jtSF.js";import{r as le}from"./PackageDetailState-0rDxsHWO.js";import{i as de,n as At}from"./PackageTabs-eENmioVZ.js";import{n as ue,r as he,t as fe}from"./packageEvaluationProgress-BAo0uxvU.js";import{t as ge}from"./BidderTable-q50inijJ.js";var pe="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",me=10*1024*1024;function be(t=!1){return`
    <button class="btn btn-outline action-strong" id="btn-export-award-result-excel"
      ${t?"":"disabled"}
      title="${t?"Điền kết quả vào file Excel mẫu tương thích":"Cần quyền truy cập và gói trả phí đang hoạt động để xuất Excel"}">
      <i data-lucide="sheet"></i> Xuất file nhập kết quả
    </button>`}function ye(){return`
    <section class="award-result-excel-panel" id="award-result-excel-panel" hidden
      aria-labelledby="award-result-excel-title">
      <div class="award-result-excel-panel-header">
        <div>
          <h5 id="award-result-excel-title">Điền file kết quả</h5>
          <p class="text-muted">Chọn file .xlsx, kiểm tra đối chiếu rồi xác nhận tải file đã điền.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-award-excel-close
          aria-label="Đóng khu vực xuất Excel"><i data-lucide="x"></i></button>
      </div>
      <div class="award-result-excel-file-row">
        <label class="btn btn-outline" for="award-result-excel-file">
          <i data-lucide="upload"></i> Chọn file .xlsx
        </label>
        <input id="award-result-excel-file" type="file" accept=".xlsx,${pe}" hidden>
        <span class="award-result-excel-file-name" data-award-excel-file-name>Chưa chọn file</span>
        <button type="button" class="btn btn-primary" data-award-excel-validate disabled>
          Tải lên và kiểm tra
        </button>
      </div>
      <div class="award-result-excel-status" data-award-excel-status role="status" aria-live="polite"></div>
      <div data-award-excel-summary></div>
      <div class="award-result-excel-actions">
        <button type="button" class="btn btn-outline" data-award-excel-reconciliation disabled>
          <i data-lucide="list-checks"></i> Tải báo cáo đối chiếu
        </button>
        <button type="button" class="btn btn-primary" data-award-excel-confirm disabled>
          <i data-lucide="download"></i> Xác nhận và tải file kết quả
        </button>
      </div>
    </section>`}function wt(t,e,a){return!Array.isArray(e)||e.length===0?"":`
    <div class="award-result-excel-issues is-${a}">
      <h6>${d(t)} (${e.length})</h6>
      <ul>${e.map(r=>`
        <li>${r?.excelRow?`<strong>Dòng ${d(r.excelRow)}:</strong> `:""}${d(r?.message||r?.code||"Lỗi không xác định")}</li>
      `).join("")}</ul>
    </div>`}function Te(t){const e=Array.isArray(t?.rows)?t.rows:[],a=t?.previewFilters||{},r=o=>o==null||o===""?"-":typeof o=="object"?JSON.stringify(o):String(o),n=(o,s)=>String(o??"")===s?" selected":"",i=e.flatMap(o=>(Array.isArray(o.changes)&&o.changes.length?o.changes:[{field:"-",oldValue:null,newValue:null,source:"-"}]).map(s=>`<tr>
      <td>${d(o.excelRow??"")}</td>
      <td>${d(o.lotCode||"")}</td>
      <td>${d(o.bidderName||"")}</td>
      <td>${d(o.matchMethod||"-")}</td>
      <td>${d(s.field||"-")}</td>
      <td>${d(r(s.oldValue))}</td>
      <td>${d(r(s.newValue))}</td>
      <td>${d(s.source||"-")}</td>
      <td>${d((o.warnings||[]).map(l=>l.code).join(", ")||"-")}</td>
    </tr>`)).join("");return`
    <div class="award-result-excel-preview">
      <div class="award-result-excel-preview-filters" aria-label="Bộ lọc đối chiếu">
        <label>Trạng thái
          <select data-award-preview-filter="status">
            <option value="">Tất cả</option>
            <option value="matched"${n(a.status,"matched")}>Đã khớp</option>
            <option value="unmatched"${n(a.status,"unmatched")}>Chưa khớp</option>
          </select>
        </label>
        <label>Phương pháp khớp
          <select data-award-preview-filter="matchMethod">
            <option value="">Tất cả</option>
            <option value="lot_code_and_bidder_identifier"${n(a.matchMethod,"lot_code_and_bidder_identifier")}>Mã định danh</option>
            <option value="lot_code_and_tax_code"${n(a.matchMethod,"lot_code_and_tax_code")}>Mã số thuế</option>
          </select>
        </label>
        <label>Dòng sẽ ghi
          <select data-award-preview-filter="writable">
            <option value="">Tất cả</option>
            <option value="true"${n(a.writable,"true")}>Có</option>
            <option value="false"${n(a.writable,"false")}>Không</option>
          </select>
        </label>
        <label>Mã cảnh báo
          <input data-award-preview-filter="warning" value="${d(a.warning||"")}" maxlength="100" placeholder="Ví dụ RESULT_NOT_FOUND">
        </label>
      </div>
      <table>
        <thead><tr>
          <th>Dòng</th><th>Phần/lô</th><th>Nhà thầu</th><th>Match</th>
          <th>Cột</th><th>Giá trị cũ</th><th>Giá trị mới</th><th>Nguồn</th><th>Cảnh báo</th>
        </tr></thead>
        <tbody>${i||'<tr><td colspan="9">Không có dòng phù hợp bộ lọc.</td></tr>'}</tbody>
      </table>
      <div class="award-result-excel-pagination" aria-label="Phân trang đối chiếu">
        <button type="button" class="btn btn-outline btn-sm" data-award-preview-page="previous"
          ${t.hasPreviousPage?"":"disabled"}>Trang trước</button>
        <span>Trang ${d(t.page||1)} / ${d(t.totalPages||1)} · ${d(t.filteredRows??e.length)} dòng</span>
        <button type="button" class="btn btn-outline btn-sm" data-award-preview-page="next"
          ${t.hasNextPage?"":"disabled"}>Trang sau</button>
      </div>
      ${Number(t.remainingRows)>0?`<p class="text-muted">Còn ${d(t.remainingRows)} dòng.</p>`:""}
    </div>`}function Lt(t={}){return`
    <div class="award-result-excel-summary" aria-label="Báo cáo đối chiếu Excel">
      ${[["Tổng dòng",t.totalRows],["Đã đối chiếu",t.matchedRows],["Đã phê duyệt",t.approvedRows],["Sẽ cập nhật",t.writableRows],["Khớp mã định danh",t.exactMatches],["Khớp mã số thuế",t.fallbackMatches],["Không tìm thấy",t.unmatchedRows],["Trùng khóa",t.duplicateRows],["Xung đột",t.conflictRows],["Thiếu mã phần/lô",t.missingLotRows],["Thiếu định danh",t.missingBidderIdentityRows],["Đã có dữ liệu kết quả",t.existingResultRows]].map(([e,a])=>`
        <div><span>${d(e)}</span><strong>${d(a??0)}</strong></div>
      `).join("")}
    </div>
    ${Te(t)}
    ${wt("Lỗi chặn xuất file",t.blockingErrors,"error")}
    ${wt("Cảnh báo",t.warnings,"warning")}
  `}function ve(t){const e=Number(t)||0;return e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}function xt(t,e){const a=t?.headers?.get?.("content-disposition")||"",r=a.match(/filename\*=UTF-8''([^;]+)/i)?.[1];if(r)try{return decodeURIComponent(r)}catch{}return a.match(/filename="?([^";]+)"?/i)?.[1]||e}async function St(t){try{const e=await t.json();return new Error(e?.error||e?.message||"Không thể xuất file Excel.")}catch{return new Error("Không thể xuất file Excel.")}}function we(t,e){t.innerHTML=A(e)}function Le(t,{packageId:e,packageCode:a="GoiThau",requestJsonImpl:r=jt,apiFetchImpl:n=qt,setMarkupImpl:i=we,onError:o,refreshIcons:s}={}){if(!t||!e)return null;const l=t.querySelector?.("#btn-export-award-result-excel"),c=t.querySelector?.("#award-result-excel-panel");if(!l||!c)return null;const u=c.querySelector("#award-result-excel-file"),f=c.querySelector("[data-award-excel-file-name]"),T=c.querySelector("[data-award-excel-validate]"),g=c.querySelector("[data-award-excel-confirm]"),m=c.querySelector("[data-award-excel-reconciliation]"),h=c.querySelector("[data-award-excel-status]"),p=c.querySelector("[data-award-excel-summary]");let w="",L=null,D=!1,C=null,N={status:"",warning:"",matchMethod:"",writable:""};const x=(v,S="")=>{D=v,u.disabled=v,T.disabled=v||!L,g.disabled=v||!w,m&&(m.disabled=v||!w),h.textContent=S},k=({cancel:v=!0}={})=>{const S=w;w="",C=null,N={status:"",warning:"",matchMethod:"",writable:""},g.disabled=!0,m&&(m.disabled=!0),i(p,""),v&&S&&n(`/api/packages/${encodeURIComponent(e)}/award-result-excel/validation`,{method:"DELETE",body:JSON.stringify({validationToken:S}),headers:{"Content-Type":"application/json"},retries:0}).catch(()=>{})},$=async()=>{if(!L||D)return null;k(),x(!0,"Đang tải lên và kiểm tra file...");try{const v=new FormData;v.append("file",L,L.name);const S=await r(`/api/packages/${encodeURIComponent(e)}/award-result-excel/validate`,{method:"POST",body:v,retries:0,timeoutMs:12e4});C={...S,previewFilters:N},i(p,Lt(C));const P=Array.isArray(S?.blockingErrors)&&S.blockingErrors.length>0,I=Number(S?.writableRows)===0;return w=P||I?"":String(S?.validationToken||""),h.textContent=P?"File có lỗi chặn xuất. Vui lòng sửa các dòng được nêu bên dưới.":I?"Không có dòng kết quả đã phê duyệt có thể ghi vào file.":"Đã kiểm tra xong. Hãy xem cảnh báo trước khi xác nhận xuất file.",S}catch(v){return h.textContent="Không thể kiểm tra file Excel.",await o?.(v),null}finally{x(!1,h.textContent),s?.()}},E=async({page:v,...S}={})=>{if(!w||D)return null;N={...N,...S};const P=Math.max(1,Number(v||1)),I=new URLSearchParams({validationToken:w,page:String(P),pageSize:String(10)});for(const[K,z]of Object.entries(N))z!==""&&z!==null&&z!==void 0&&I.set(K,String(z));x(!0,"Đang tải trang đối chiếu...");try{const K=await r(`/api/packages/${encodeURIComponent(e)}/award-result-excel/preview?${I}`,{method:"GET",retries:0,timeoutMs:12e4});return C={...K,previewFilters:N},i(p,Lt(C)),h.textContent=`Đang xem trang ${K.page||1}/${K.totalPages||1}; ${K.filteredRows||0} dòng phù hợp.`,K}catch(K){return h.textContent="Không thể tải trang đối chiếu.",await o?.(K),null}finally{x(!1,h.textContent),s?.()}},F=async()=>{if(!w||D)return!1;x(!0,"Đang điền dữ liệu và tạo file kết quả...");try{const v=await n(`/api/packages/${encodeURIComponent(e)}/award-result-excel/export`,{method:"POST",body:JSON.stringify({validationToken:w}),headers:{"Content-Type":"application/json"},retries:0,timeoutMs:12e4});if(!v.ok)throw await St(v);const S=await v.blob(),P=URL.createObjectURL(S),I=document.createElement("a");return I.href=P,I.download=xt(v,`${a}_da_dien_ket_qua.xlsx`),I.hidden=!0,document.body.appendChild(I),I.click(),I.remove(),setTimeout(()=>URL.revokeObjectURL(P),0),k({cancel:!1}),h.textContent="Đã tạo và tải file Excel kết quả.",!0}catch(v){return h.textContent="Không thể tạo file Excel kết quả.",await o?.(v),!1}finally{x(!1,h.textContent),s?.()}},M=async()=>{if(!w||D)return!1;x(!0,"Đang tạo báo cáo đối chiếu...");try{const v=await n(`/api/packages/${encodeURIComponent(e)}/award-result-excel/reconciliation`,{method:"POST",body:JSON.stringify({validationToken:w}),headers:{"Content-Type":"application/json"},retries:0,timeoutMs:12e4});if(!v.ok)throw await St(v);const S=await v.blob(),P=URL.createObjectURL(S),I=document.createElement("a");return I.href=P,I.download=xt(v,`${a}_bao_cao_doi_chieu.xlsx`),I.hidden=!0,document.body.appendChild(I),I.click(),I.remove(),setTimeout(()=>URL.revokeObjectURL(P),0),h.textContent="Đã tạo và tải báo cáo đối chiếu.",!0}catch(v){return h.textContent="Không thể tạo báo cáo đối chiếu.",await o?.(v),!1}finally{x(!1,h.textContent),s?.()}};return l.addEventListener("click",()=>{c.hidden=!c.hidden,c.hidden||u.focus?.(),s?.()}),c.querySelector("[data-award-excel-close]")?.addEventListener("click",()=>{k(),c.hidden=!0,l.focus?.()}),u.addEventListener("change",()=>{if(L=u.files?.[0]||null,k(),!L){f.textContent="Chưa chọn file",T.disabled=!0;return}f.textContent=`${L.name} · ${ve(L.size)}`;const v=L.name.toLocaleLowerCase("vi-VN").endsWith(".xlsx")&&L.size>0&&L.size<=me;T.disabled=!v,h.textContent=v?"File đã sẵn sàng để kiểm tra.":"Chỉ chấp nhận file .xlsx có dung lượng từ 1 byte đến 10 MB."}),T.addEventListener("click",$),g.addEventListener("click",F),m?.addEventListener("click",M),p.addEventListener?.("click",v=>{const S=v.target?.closest?.("[data-award-preview-page]");if(!S||S.disabled)return;const P=S.dataset.awardPreviewPage,I=Number(C?.page||1);E({page:P==="previous"?I-1:I+1})}),p.addEventListener?.("change",v=>{const S=v.target?.closest?.("[data-award-preview-filter]");S&&E({page:1,[S.dataset.awardPreviewFilter]:S.value})}),{validateSelectedFile:$,loadPreview:E,downloadReconciliation:M,exportValidatedFile:F}}function xe({pkg:t,winnerHtml:e,bidderRowsHtml:a,tableHeaderHtml:r,resultHistoryHtml:n="",appraisalNumber:i="",appraisalDate:o="",isEditable:s=!1,awardResultExcelExportEnabled:l=!1,winningGoodsExportEnabled:c=!1,formatCurrency:u,formatDate:f}={}){const T=t?.hinhThucLuaChon!=="Chào hàng cạnh tranh",g=!!String(n||"").trim();return`
    <div class="card award-result-card">
      <div class="award-result-header">
        <div class="award-result-heading">
          <i data-lucide="check-circle" class="text-success award-result-icon"></i>
          <div><h4 class="award-result-title">Gói thầu đã hoàn thành LCNT</h4><p class="text-muted award-result-description">Đã phê duyệt kết quả lựa chọn nhà thầu chính thức.</p></div>
        </div>
        <div class="compact-action-group">
          ${be(l)}
          ${c?'<button class="btn btn-outline action-strong" id="btn-export-winning-goods"><i data-lucide="file-spreadsheet"></i> Xuất danh sách hàng hóa trúng thầu</button>':""}
        </div>
      </div>
      ${ye()}
      <div class="award-result-grid">
        <div><span class="text-muted award-result-label">Nhà thầu trúng thầu</span>${e}</div>
        <div><span class="text-muted award-result-label">Giá trúng thầu</span><h5 class="award-result-value">${d(u(t?.giaTrungThau))}</h5></div>
        <div><span class="text-muted award-result-label">Thời gian thực hiện</span><h5 class="award-result-value">${d(t?.thoiGianGoiThau||"--")}</h5></div>
        ${T&&i?`<div><span class="text-muted award-result-label">Số BCTĐ kết quả</span><h5 class="award-result-value">${d(i)}</h5></div>`:""}
        ${T&&o?`<div><span class="text-muted award-result-label">Ngày BCTĐ kết quả</span><h5 class="award-result-value">${d(f(o))}</h5></div>`:""}
        <div><span class="text-muted award-result-label">Số QĐ phê duyệt Kết quả</span><h5 class="award-result-value">${d(t?.soQuyetDinhKetQua||"--")}</h5></div>
        <div><span class="text-muted award-result-label">Ngày ký QĐ phê duyệt Kết quả</span><h5 class="award-result-value">${d(t?.ngayQuyetDinhKetQua?f(t.ngayQuyetDinhKetQua):"--")}</h5></div>
      </div>
    </div>
    <h5 class="package-list-heading"><i data-lucide="list"></i> Danh sách Nhà thầu tham dự và kết quả đánh giá</h5>
    <div class="table-container package-table-frame has-bottom-space table-card-bg">
      <table class="data-table table-full-width" data-row-pagination="true" aria-label="Kết quả lựa chọn nhà thầu"><thead>${r}</thead><tbody>${a}</tbody></table>
    </div>
    ${s&&!g?'<div class="workflow-action-row with-top-space"><button class="btn btn-primary action-strong" id="btn-edit-result-bottom"><i data-lucide="edit-3"></i> Sửa kết quả</button></div>':""}
    ${n}
  `}function Se(t,e={}){t&&(t.innerHTML=A(xe(e)))}function $e(t,{onEdit:e,onExportWinningGoods:a,onExportError:r,onWinningGoodsExportError:n,refreshIcons:i}={}){if(!t)return;const o=t.querySelector?.("#btn-edit-result-bottom");o&&(o.onclick=()=>e?.()),((l,c,u,f=r)=>{l&&(l.onclick=async()=>{const T=l.innerHTML;l.disabled=!0,l.innerHTML=A(`<i data-lucide="loader-2" class="animate-spin icon-md"></i> ${u}`),i?.();try{await c?.()}catch(g){await f?.(g)}finally{l.disabled=!1,l.innerHTML=A(T),i?.()}})})(t.querySelector?.("#btn-export-winning-goods"),a,"Đang xuất Excel...",n||r)}var Ce="Một giai đoạn hai túi hồ sơ",Ie="Đã có kết quả";function ke(t){const e=ee(t).metadata;return!e||typeof e!="object"||Array.isArray(e)?{technical:{},result:{}}:{...e,technical:e.technical&&typeof e.technical=="object"?e.technical:{},result:e.result&&typeof e.result=="object"?e.result:{}}}function De(t,e,a,r={}){const n={officialBatchId:String(r.officialBatchId||"").trim(),currentBatchId:String(r.currentBatchId||"").trim(),wholePackage:r.wholePackage===!0,wholePackageId:String(r.wholePackageId||"").trim()};if(!a)return n;const i=e.resultEdit||e.technical?.resultEdit||{};return i.type==="batch"&&i.batchId?(n.officialBatchId=String(i.batchId).trim(),n.currentBatchId=n.officialBatchId):i.type==="whole"&&(n.wholePackage=!0,n.wholePackageId=String(t?.id||"")),n}function $t(t,e){const a=new Map((Array.isArray(e?.contractorBindings)?e.contractorBindings:[]).map(r=>[String(r?.bidId||""),r]));return t.map(r=>{const n=a.get(String(r?.id||""));if(!n)return r;const i=Array.isArray(n.memberVersionIds)?n.memberVersionIds:[];return{...r,nhaThauId:n.contractorVersionId||r.nhaThauId,tenNhaThau:r.loaiNhaThau==="Liên danh"&&n.jointVentureName||r.tenNhaThau,thanhVienLienDanh:(Array.isArray(r.thanhVienLienDanh)?r.thanhVienLienDanh:[]).map((o,s)=>({...o,thanhVienNhaThauId:i[s]||o.thanhVienNhaThauId}))}})}function Ne(t){return J(t?.phanLoList,{context:"award_view_model"})}function qe(t,e,a){if(a)return"—";if(Kt(t,e))return Gt(t,e);if(e?.lyDoTruot)return e.lyDoTruot;if(t?.quyTrinhDanhGia==="quytrinh2"&&e?.danhGiaKetLuan==="Không đánh giá")return"Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";const r=String(e?.danhGiaKetLuan||"");if(r==="Không đạt"||r.startsWith("Không đạt")){const n=[];return e.danhGiaHopLe==="Không đạt"&&n.push("Đánh giá hợp lệ"),e.danhGiaNangLuc==="Không đạt"&&n.push("Đánh giá năng lực"),(e.danhGiaKyThuat==="Không đạt"||String(e.danhGiaKyThuat||"").toLocaleLowerCase("vi-VN").includes("không đạt"))&&n.push("Đánh giá kỹ thuật"),(e.danhGiaTaiChinh==="Không đạt"||String(e.danhGiaTaiChinh||"").toLocaleLowerCase("vi-VN").includes("không đạt"))&&n.push("Đánh giá tài chính"),n.length>0?`Không đạt ở bước: ${n.join(", ")}`:"Không đạt đánh giá chi tiết"}return"Nhà thầu xếp hạng 1 trúng thầu"}function Re(t,e,a){const r=t?.phanLo==="Có",n=r?Ne(t):[],i=n.filter(g=>g?.nhaThauTrungThauId),o=[...new Set(i.map(g=>String(g.nhaThauTrungThauId||"")).filter(Boolean))],s=!t?.nhaThauTrungThauId&&a.length===1?a[0].nhaThauId||a[0].id:"",l=t?.nhaThauTrungThauId||s,c=a.find(g=>String(g.nhaThauId||"")===String(l||""))||a[0]||null,u=o.length===1?o[0]:l||c?.nhaThauId||c?.id||"",f=a.find(g=>String(g.nhaThauId||"")===String(u||""))||c,T=[...e].sort((g,m)=>{const h=String(g?.maPhanLo||"").toLocaleLowerCase("vi-VN"),p=String(m?.maPhanLo||"").toLocaleLowerCase("vi-VN");return h.localeCompare(p,"vi",{numeric:!0})}).map((g,m)=>{let h=!1,p=null,w=g.thoiGianThucHien||g.thoiGianGoiThau||"—";if(r){const L=n.find(D=>String(D?.maPhanLo||"")===String(g?.maPhanLo||"")&&String(D?.nhaThauTrungThauId||"")===String(g?.nhaThauId||""));L&&(h=!0,p=L.giaTrungThau||0,w=L.thoiGianGoiThau||"—")}else l&&String(l)===String(g?.nhaThauId||"")&&(h=!0,p=t?.giaTrungThau||0,w=t?.thoiGianGoiThau||"—");return{bid:g,index:m,isWinner:h,awardPrice:p,packageDuration:w,rejectionReason:qe(t,g,h)}});return{isLotPackage:r,lots:n,winningLots:i,uniqueWinnerIds:o,hasMultipleWinners:o.length>1,inferredPackageWinnerId:s,effectivePackageWinnerId:l,winnerBid:c,finalWinnerId:u,currentWinnerBid:f,bidderRows:T}}function Ee({pkg:t,bids:e=[],isEditable:a=!1,editState:r={}}={}){const n=ke(t?.danhGiaHsdtMetadata),i=t?.phuongThucLuaChon===Ce,o=i?n.technical:n,s=ie(t,o),l=De(t,n,a,r),c=Bt(t)===Ie,u=a?l.officialBatchId:"",f=s.history.find(k=>String(k.batchId||"")===u)||null,T=f?{batchId:f.batchId,lotIds:f.lotIds||[],lotCodes:f.lotCodes||[],isWholePackage:f.isWholePackage===!0,batch:f}:null,g=!!T,m=!!(a&&l.wholePackage&&(!l.wholePackageId||l.wholePackageId===String(t?.id||""))),h=T||(c?null:Tt(t,o,l.currentBatchId)||Tt(t,o));h&&(l.currentBatchId=h.batchId);const p=h?h.batch?.result||{}:n.result,w=(Array.isArray(e)?e:[]).filter(k=>String(k?.goiThauId||"")===String(t?.id||"")),L=$t(w,p),D=h?w.filter(k=>_t(k,h)):w,C=$t(D.filter(k=>At(k,t)),p),N=Re(t,L,C);let x="approval";return!c&&!h&&s.history.length>0?x="history":c&&!g&&!m&&(x="summary"),{mode:x,metadata:n,isTwoEnvelope:i,isAwarded:c,lifecycleMetadata:o,officialLotState:s,effectiveEditState:l,editingOfficialScope:T,isEditingOfficialResult:g,isEditingWholePackageResult:m,activeScopedEvaluation:h,resultMetadata:p,soBctdResult:p.soBctdKetQua||"",ngayBctdResult:p.ngayBctdKetQua||"",packageBidsForResult:w,boundPackageBidsForResult:L,scopedBidsForResult:D,allBidsForResult:C,summary:N}}function Pe(t,{gt:e,metadata:a,soBctdResult:r,ngayBctdResult:n,is1G2T2:i,bids:o=null,scopedDraft:s=null}){const l=t.model.getLatestPlan(e.keHoachId),c=l?t.model.state.chudautu.find(b=>b.id===l.chuDauTuId):null,u=c?c.tenChuDauTu:"Không rõ",f=l?l.tenKeHoach:"Không rõ",T=Array.isArray(o)?[...o]:t.model.state.thongtinmothau.filter(b=>String(b.goiThauId)===String(e.id));T.sort((b,q)=>{const G=String(b.maPhanLo||"").trim(),B=String(q.maPhanLo||"").trim();return G.localeCompare(B,"vi",{numeric:!0})});const g=e.hinhThucLuaChon==="Chỉ định thầu rút gọn"||e.hinhThucLuaChon==="Lựa chọn nhà thầu trong trường hợp đặc biệt",m=a.result.danhGiaNangLuc||"Không",h=(b,q)=>{if(!b)return"";let G=new Date(b);if(isNaN(G.getTime()))return"";const B=Ut();let rt=q<0?-1:1,Z=Math.abs(q);for(;Z>0;){G.setDate(G.getDate()+rt);let X=G.getDay(),O=G.toISOString().split("T")[0],Y=String(G.getFullYear()),Q=X===0||X===6;const j=B[Y]?.working_weekends||[];Q&&j.includes(O)&&(Q=!1);const ot=(B[Y]?.holidays||[]).includes(O);!Q&&!ot&&Z--}return G.toISOString().split("T")[0]};let p="",w="",L="",D="",C="",N="",x="";if(l){const b=l.pheDuyet==="Kế hoạch"?l.ngayTrinhDuToan:l.ngayTrinhKeHoach,q=l.ngayPheDuyet||"";p=h(b,-5),w=h(b,-1),L=q,D=q,C=h(q,1),N=C,x=N}const k=a.result.ngayYeuCauBaoGia?t.model.formatForDateInput(a.result.ngayYeuCauBaoGia):p?t.model.formatForDateInput(p):"",$=a.result.ngayGuiBaoGia?t.model.formatForDateInput(a.result.ngayGuiBaoGia):w?t.model.formatForDateInput(w):"",E=a.result.ngayBaoCaoDanhGiaNhaThau?t.model.formatForDateInput(a.result.ngayBaoCaoDanhGiaNhaThau):L?t.model.formatForDateInput(L):"",F=a.result.ngayMoiThuongThao?t.model.formatForDateInput(a.result.ngayMoiThuongThao):D?t.model.formatForDateInput(D):"",M=a.result.ngayThuongThao?t.model.formatForDateInput(a.result.ngayThuongThao):C?t.model.formatForDateInput(C):"",v=a.result.ngayTrinhKetQua?t.model.formatForDateInput(a.result.ngayTrinhKetQua):N?t.model.formatForDateInput(N):"",S=e.ngayQuyetDinhKetQua?t.model.formatForDateInput(e.ngayQuyetDinhKetQua):x?t.model.formatForDateInput(x):"",{rankings:P,scores:I}=ce(e,T),K=Zt(e),z=b=>At(b,e),Ht=J(e.phanLoList,{context:"award_approval_markup"});let it="";return g&&T.length===0?it=`
                        <tr>
                            <td colspan="100%" class="bf-s-31769e5aab">
                                <i data-lucide="info" class="bf-s-26c21ccd54"></i>
                                Vui lòng nhập và lưu danh sách nhà thầu tại tab "Biên bản mở thầu" trước.
                            </td>
                        </tr>
                    `:it=T.map(b=>{const q=z(b),G=Kt(e,b);let B="";if(G)B=Gt(e,b);else if(e.quyTrinhDanhGia==="quytrinh2"&&b.danhGiaKetLuan==="Không đánh giá")B="Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";else if(q)B="Nhà thầu xếp hạng 1 trúng thầu";else{const U=String(b.danhGiaHopLe||"").trim().toLowerCase(),st=String(b.danhGiaNangLuc||"").trim().toLowerCase();U!=="đạt"?B="Không đạt yêu cầu về tính hợp lệ":st!=="đạt"?B="Không đạt yêu cầu về năng lực, kinh nghiệm":B="Không đạt yêu cầu kỹ thuật"}const rt=!b.lyDoTruot||["Không đạt yêu cầu về tính hợp lệ","Không đạt yêu cầu về năng lực, kinh nghiệm","Không đạt yêu cầu kỹ thuật","Nhà thầu xếp hạng 1 trúng thầu","Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",""].includes(b.lyDoTruot.trim()),Z=G||rt?B:b.lyDoTruot,X=t.model.formatVND(b.giaDeNghiTrungThau||b.giaSauGiamGia||b.giaDuThau||"")||"",O=b.thoiGianThucHien||e.thoiGianThucHien||"",Y=b.thoiGianThucHienHopDong||(O?O+" + Thời gian thực hiện các nghĩa vụ theo hợp đồng":""),Q=P[b.id],j=I[b.id],ot=Q?`Xếp hạng ${Q}`:q?"--":"Không xếp hạng";let R=!1;if(g)R=!0;else if(q)if(e.phanLo==="Có"){const U=Ht,st=b.maPhanLo,ct=U.find(Ot=>Ot.maPhanLo===st);ct&&ct.nhaThauTrungThauId?R=String(ct.nhaThauTrungThauId)===String(b.nhaThauId||b.id):R=Q===1}else e.nhaThauTrungThauId?R=String(e.nhaThauTrungThauId)===String(b.nhaThauId||b.id):R=Q===1;return`
                            <tr data-approve-bid-id="${y(b.id)}" data-is-qualified="${q}" data-nt-id="${y(b.nhaThauId||b.id)}"
                                data-default-price="${y(X)}" data-default-duration-pkg="${y(O)}" data-default-duration-ctr="${y(Y)}"
                                data-default-reason="${y(B)}">
                                ${e.phanLo==="Có"?`
                                    <td>
                                        ${d(b.maPhanLo||"--")}
                                    </td>
                                    <td>
                                        ${d(b.tenPhanLo||"--")}
                                    </td>
                                `:""}
                                ${g?`
                                     <td>
                                         ${d(b.loaiNhaThau||"Độc lập")}
                                     </td>
                                 `:""}
                                <td>
                                ${d(at(b.maNhaThau||b.maDinhDanh,"--"))}
                                </td>
                                <td>
                                    ${d(b.tenNhaThau||"--")}
                                    ${b.loaiNhaThau==="Liên danh"?`
                                         <div class="row-jv-members-container bf-s-597bc8fb90">
                                              <button type="button" class="btn btn-outline btn-xs row-btn-manage-members bf-s-b87f5b7f7c">
                                                  <i data-lucide="users" class="bf-s-38e6fd7439"></i>
                                                  <span class="row-jv-btn-text">Xem thành viên liên danh (${(b.thanhVienLienDanh||[]).filter(U=>U.vaiTro!=="Đứng đầu liên danh"&&U.maSoThue!==b.maNhaThau).length})</span>
                                              </button>
                                         </div>
                                    `:""}
                                </td>
                                ${K?`
                                    <td class="bf-s-1742e3af74">${j!=null&&!isNaN(j)&&j>0?j.toFixed(2):"--"}</td>
                                `:""}
                                ${g?"":`
                                    <td class="bf-s-81cfd3850c">${d(ot)}</td>
                                    <td>
                                        <select class="form-control row-status-select bf-s-707df30c7a" ${q?"":"disabled"}>
                                            <option value="truot" ${R?"":"selected"}>Trượt thầu</option>
                                            ${q?`<option value="trung" ${R?"selected":""}>Trúng thầu</option>`:""}
                                        </select>
                                    </td>
                                    <td>
                                        <input type="text" class="form-control row-ly-do-truot bf-s-aa4eecce78" value="${y(R?"":Z)}" placeholder="Lý do trượt..." ${R?'disabled style="background:#f1f5f9;"':""}>
                                    </td>
                                `}
                                <td>
                                    <input type="text" class="form-control row-gia-trung bf-s-aa4eecce78" value="${y(R?X:"")}" placeholder="Giá trúng..." ${R?"":'disabled style="background:#f1f5f9;"'}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-goithau bf-s-aa4eecce78" value="${y(R?O:"")}" placeholder="Thời gian gói..." ${R?"":'disabled style="background:#f1f5f9;"'}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-hopdong bf-s-aa4eecce78" value="${y(R?Y:"")}" placeholder="Thời gian HĐ..." ${R?"":'disabled style="background:#f1f5f9;"'}>
                                </td>
                            </tr>
                        `}).join(""),{html:`
                    <div class="bf-s-8bd3eb473c">
                        <div class="bf-s-5d398becec">Thông số Gói thầu</div>
                        <div class="bf-s-13b5590e90">
                            <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${d(u)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${d(f)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${d(e.linhVuc||"Hàng hóa")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${d(e.phuongThucLuaChon||"Một giai đoạn một túi hồ sơ")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${e.phanLo==="Có"?"Có chia phần lô":"Không chia phần lô"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${t.model.formatCurrency(e.giaGoiThau)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${d(e.hinhThucLuaChon||"--")}</div>
                            ${e.phuongPhapDanhGia?`<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${d(Jt(e))}</div>`:""}
                            <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${d(e.loaiHopDong||"--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${d(e.thoiGianThucHien||"--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${d(e.nguonVon||"--")}</div>
                            ${g?"":`
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${e.thoiGianDongThau?t.model.formatDateWithTime(e.thoiGianDongThau):"--"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">${i?"Thời gian mở E-HSĐXKT":"Thời gian mở thầu"}:</strong> ${e.thoiGianMoThau?t.model.formatDateWithTime(e.thoiGianMoThau):"--"}</div>
                            ${i?`<div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong> ${e.thoiGianMoEhsdxtc?t.model.formatDateWithTime(e.thoiGianMoEhsdxtc):"Chưa mở"}</div>`:""}
                            `}
                        </div>
                    </div>

                    ${s?`
                    <div class="alert alert-info scoped-result-context" role="status">
                        <div>
                            <strong>${s.isWholePackage?"Chỉnh sửa kết quả toàn gói thầu":s.isEditingOfficialResult?`Chỉnh sửa kết quả Lần ${d(s.sequenceNo||"")}`:`Kết quả theo ${d(s.label||"đợt phần lô")}`}</strong>
                            <div>${s.isWholePackage?"Cập nhật kết quả chính thức đã phê duyệt của gói thầu.":`Chỉ hiển thị và lưu dữ liệu của ${d(s.lotCodes?.join(", ")||"các phần lô đã chọn")}. Các phần lô khác được giữ nguyên.`}</div>
                        </div>
                    </div>
                    `:""}

                    <div class="bf-s-95b5643dd9">
                        <div>
                            <h4 class="bf-s-ff3bca23d8">
                                ${s?.isWholePackage?"Chỉnh sửa kết quả LCNT":s?.isEditingOfficialResult?`Chỉnh sửa kết quả LCNT Lần ${d(s.sequenceNo||"")}`:s?"Kết quả LCNT theo đợt phần lô":"Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)"}
                            </h4>
                            <p class="text-muted bf-s-2089b6623a">
                                ${s?s.isWholePackage?"Cập nhật kết quả chính thức của gói thầu và lưu lại các thay đổi.":s.isEditingOfficialResult?"Cập nhật kết quả chính thức của đợt này. Kết quả các đợt và phần lô khác được giữ nguyên.":"Phê duyệt kết quả chính thức cho đúng các phần lô trong đợt hiện tại. Các phần lô còn lại sẽ được xử lý ở đợt sau.":e.hinhThucLuaChon==="Chỉ định thầu rút gọn"||e.hinhThucLuaChon==="Lựa chọn nhà thầu trong trường hợp đặc biệt"?"Kiểm tra danh sách nhà thầu trúng thầu, điền QĐ phê duyệt và nhấn Phê duyệt &amp; Hoàn thành LCNT.":"Vui lòng nhập QĐ phê duyệt và chọn kết quả trúng thầu/trượt thầu cho từng nhà thầu bên dưới."}
                            </p>
                        </div>
                        <div class="bf-s-c896deef0d">
                            ${!g&&!s?`
                                <button class="btn-excel-action btn-sm bf-s-5a83b4877e" id="btn-result-export-excel-template">
                                    <i data-lucide="download"></i> Tải Excel Mẫu
                                </button>
                                <button class="btn-excel-action btn-sm bf-s-5a83b4877e" id="btn-result-import-excel">
                                    <i data-lucide="upload"></i> Nhập từ Excel
                                </button>
                            `:""}
                        </div>
                    </div>

                    ${g?`
                    <div class="bf-s-203e309e90">
                        <div class="bf-s-c9a9faa1a8">
                            <i data-lucide="check-circle" class="bf-s-c1f1f4a417"></i> Quyết định phê duyệt:
                        </div>
                        <div class="bf-s-342dc0e30b">
                            <div class="form-group bf-s-7f27e3bd8d">
                                <input type="text" id="award-decision-no" class="form-control bf-s-b3e44dc6d9" value="${y(e.soQuyetDinhKetQua||"")}" placeholder="Số QĐ phê duyệt *">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group bf-s-7f27e3bd8d">
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date bf-s-b3e44dc6d9" value="${y(e.ngayQuyetDinhKetQua?t.model.formatForDateInput(e.ngayQuyetDinhKetQua):S||"")}" placeholder="Ngày ký QĐ * (dd/MM/yyyy)">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>

                    <div class="bf-s-c12ee1fe89">
                        <div class="bf-s-72451a63ba">
                            <span class="bf-s-ae2dc20bdc">
                                <i data-lucide="shield-check" class="bf-s-c1f1f4a417"></i> Đánh giá năng lực nhà thầu:
                            </span>
                            <label class="bf-s-95a4734e91">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Có" ${m==="Có"?"checked":""}> Có
                            </label>
                            <label class="bf-s-95a4734e91">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Không" ${m==="Không"?"checked":""}> Không
                            </label>
                        </div>

                        <div id="result-dates-grid" class="bf-s-d131bccf20">
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày yêu cầu báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-yeu-cau-bao-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${y(k)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày yêu cầu báo giá!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày gửi báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-gui-bao-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${y($)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày gửi báo giá!</span>
                            </div>
                            <div class="form-group" id="container-date-bao-cao-danh-gia" style="margin-bottom: 0; display: ${m==="Có"?"block":"none"};">
                                <label class="compact-field-label">Ngày báo cáo đánh giá nhà thầu <span class="text-danger">*</span></label>
                                <input type="text" id="date-bao-cao-danh-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${y(E)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày báo cáo đánh giá nhà thầu!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày mời thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-moi-thuong-thao" class="form-control flatpickr-date bf-s-64f2570670" value="${y(F)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày mời thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-thuong-thao" class="form-control flatpickr-date bf-s-64f2570670" value="${y(M)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày trình kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="date-trinh-ket-qua" class="form-control flatpickr-date bf-s-64f2570670" value="${y(v)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày trình kết quả!</span>
                            </div>
                        </div>
                    </div>
                    `:`
                    <div class="bf-s-098565a16e">
                        <div class="bf-s-5d398becec">Quyết định phê duyệt Kết quả LCNT</div>
                        <div class="bf-s-ed07f78f34">
                            ${e.hinhThucLuaChon!=="Chào hàng cạnh tranh"?`
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-so-bctd" class="form-control bf-s-20e5983dc7" value="${y(r)}" placeholder="Nhập số báo cáo thẩm định...">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số BCTĐ kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-ngay-bctd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${y(n?t.model.formatForDateInput(n):"")}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày BCTĐ kết quả!</span>
                            </div>
                            `:""}
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control bf-s-20e5983dc7" value="${y(e.soQuyetDinhKetQua||"")}" placeholder="Số QĐ Kết quả...">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày ký QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date bf-s-20e5983dc7" value="${y(e.ngayQuyetDinhKetQua?t.model.formatForDateInput(e.ngayQuyetDinhKetQua):"")}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>
                    `}

                    <div class="bf-s-dd5fcc126c">
                        <h5 class="bf-s-a3c20b1dcc">
                            <i data-lucide="list"></i> ${g?"Danh sách nhà thầu trúng thầu":"Danh sách nhà thầu tham dự &amp; Kết quả LCNT"}
                        </h5>
                    </div>

                    <div class="table-container bf-s-674afada30">
                        <table class="data-table bf-s-448ca2b6ae" data-row-pagination="true" aria-label="Danh sách phê duyệt kết quả lựa chọn nhà thầu">
                            <thead>
                                <tr>
                                    ${e.phanLo==="Có"?`
                                        <th class="bf-s-ae54075f01">Mã phần lô</th>
                                        <th class="bf-s-ae54075f01">Tên phần lô</th>
                                    `:""}
                                    ${g?'<th class="bf-s-2811ee8f01">Loại nhà thầu</th>':""}
                                    <th class="bf-s-2811ee8f01">Mã nhà thầu</th>
                                    <th class="bf-s-a01153c965">Tên nhà thầu</th>
                                    ${K?`
                                        <th class="bf-s-59052b934c">Điểm tổng hợp</th>
                                    `:""}
                                    ${g?"":`
                                        <th class="bf-s-59052b934c">Xếp hạng nhà thầu</th>
                                        <th class="bf-s-ae54075f01">Trúng thầu/trượt thầu</th>
                                        <th class="bf-s-c83ebbe56b">Lý do trượt</th>
                                    `}
                                    <th class="bf-s-2811ee8f01">Giá trúng thầu</th>
                                    <th class="bf-s-c83ebbe56b">Thời gian thực hiện gói thầu</th>
                                    <th class="bf-s-fa210469db">Thời gian thực hiện hợp đồng</th>
                                </tr>
                            </thead>
                            <tbody id="approve-bidders-tbody">
                                ${it}
                            </tbody>
                        </table>
                    </div>

                    <div class="bf-s-004d08f0e5 official-result-form-actions">
                        ${s?.isEditingOfficialResult?'<button type="button" class="btn btn-outline-secondary bf-s-a9f6996ecf scoped-result-cancel-button" id="btn-cancel-official-result-edit">Hủy chỉnh sửa</button>':""}
                        <button type="button" class="btn btn-primary bf-s-a9f6996ecf" id="btn-approve-award">
                            <i data-lucide="${s?.isEditingOfficialResult?"save":"check-circle2"}"></i> ${s?.isEditingOfficialResult?"Lưu thay đổi":s?"Phê duyệt kết quả đợt":"Phê duyệt & Hoàn thành LCNT"}
                        </button>
                    </div>
                `,allBids:T,isDirectOrSpecial:g}}var Be="Một giai đoạn hai túi hồ sơ";function _e(t,e,a,r={},n={}){if(!a?.history?.length)return"";const i=n?.isEditable===!0,o=(t?.model?.state?.thongtinmothau||[]).filter(c=>String(c.goiThauId)===String(e?.id)),s=J(e?.phanLoList,{context:"award_history"}),l=Array.isArray(a.pendingLots)?a.pendingLots:[];return`<div class="official-result-history">
    ${a.history.map(c=>{const u=e.phuongThucLuaChon===Be,f=u&&r.technical?.lotBatches?.[c.batchId]||c,T=u?r.financial?.lotBatches?.[c.batchId]||{}:{},g=f.result||T.result||c.result||{},m=o.filter(h=>_t(h,c)).map(h=>{const p=s.find(L=>String(L.id||"")===String(h.lotId||h.lot_id||"")||String(L.maPhanLo||"")===String(h.maPhanLo||"")),w=p?.nhaThauTrungThauId&&String(p.nhaThauTrungThauId)===String(h.nhaThauId||h.id||"");return`<tr><td>${d(h.maPhanLo||"--")}</td><td>${d(h.tenNhaThau||"--")}</td>
          <td><span class="badge ${w?"badge-success":"badge-danger"}">${w?"Trúng thầu":"Trượt thầu"}</span></td>
          <td>${d(w?t.model.formatCurrency(p?.giaTrungThau||0):h.lyDoTruot||"--")}</td></tr>`}).join("");return`<article class="evaluation-round-card official-result-round">
        <header class="evaluation-round-card-header"><div><span class="evaluation-round-index">Lần ${c.sequenceNo}</span>
          <h4>Kết quả ${d((c.lotCodes||[]).join(", ")||"các phần lô")}</h4></div>
          <div class="evaluation-round-card-actions">
            <span class="evaluation-round-status"><i data-lucide="badge-check"></i> Chính thức</span>
          </div></header>
        <div class="evaluation-round-fields">
          ${u?`
          <div><span>BC đánh giá kỹ thuật</span><strong>${d(f.soBaoCao||"--")}</strong></div>
          <div><span>BCTĐ kỹ thuật</span><strong>${d(f.soBctdKt||"--")}</strong></div>
          <div><span>QĐ đạt kỹ thuật</span><strong>${d(f.soQdPheDuyetKt||"--")}</strong></div>
          <div><span>Mở E-HSĐXTC</span><strong>${d(f.financialOpening?.openingTime?t.model.formatDateWithTime(f.financialOpening.openingTime):"--")}</strong></div>
          <div><span>BC đánh giá tài chính</span><strong>${d(T.soBaoCao||"--")}</strong></div>`:`
          <div><span>Số báo cáo đánh giá</span><strong>${d(c.soBaoCao||"--")}</strong></div>`}
          <div><span>Số BCTĐ kết quả</span><strong>${d(g.soBctdKetQua||"--")}</strong></div>
          <div><span>Ngày BCTĐ kết quả</span><strong>${d(g.ngayBctdKetQua?t.model.formatDate(g.ngayBctdKetQua):"--")}</strong></div>
          <div><span>Số QĐ phê duyệt</span><strong>${d(g.soQuyetDinhKetQua||"--")}</strong></div>
          <div><span>Ngày QĐ phê duyệt</span><strong>${d(g.ngayQuyetDinhKetQua?t.model.formatDate(g.ngayQuyetDinhKetQua):"--")}</strong></div>
          <div><span>Phạm vi</span><strong>${d((c.lotCodes||[]).join(", ")||"--")}</strong></div>
        </div>
        <div class="table-container package-table-frame evaluation-round-table"><table class="data-table" data-row-pagination="true" aria-label="Lịch sử kết quả lựa chọn nhà thầu"><thead><tr><th>Phần lô</th><th>Nhà thầu</th><th>Kết quả</th><th>Giá/Lý do</th></tr></thead>
          <tbody>${m||'<tr><td colspan="4" class="text-muted">Không có hồ sơ trong đợt.</td></tr>'}</tbody></table></div>
        ${i?`<div class="workflow-action-row evaluation-round-action-row">
          <button type="button" class="btn btn-primary action-strong evaluation-round-edit-button" data-edit-official-result-batch="${y(c.batchId)}" aria-label="Chỉnh sửa kết quả Lần ${c.sequenceNo}">
            <i data-lucide="edit-3"></i> Chỉnh sửa
          </button>
        </div>`:""}
      </article>`}).join("")}
    ${l.length?`<div class="evaluation-round-continuation"><div><strong>Còn ${l.length} phần lô chưa có kết quả</strong><p>${d(l.map(c=>c.code).join(", "))}. Hãy sang tab báo cáo đánh giá để tiếp tục.</p></div></div>`:""}
  </div>`}function _(t,{trim:e=!0}={}){const a=String(t?.value||"");return e?a.trim():a}function Me(t,{pkg:e,model:a,isDirectOrSpecial:r}){const n=_(t.querySelector(".row-status-select"))||(r?"trung":"truot"),i=_(t.querySelector(".row-gia-trung"),{trim:!1});return{element:t,bidId:String(t.getAttribute("data-approve-bid-id")||""),contractorId:String(t.getAttribute("data-nt-id")||""),status:n,isWinner:n==="trung",contractorCode:_(t.querySelector(".row-ma-nha-thau")),contractorName:_(t.querySelector(".row-ten-nha-thau")),contractorType:_(t.querySelector(".row-loai-nha-thau"))||"Độc lập",jointVentureMembers:Array.isArray(t._thanhVienLienDanh)?t._thanhVienLienDanh:[],leadMemberContractorId:String(t._leadMemberContractorId||""),leadMemberName:String(t._leadMemberName||""),lotCode:e?.phanLo==="Có"?_(t.querySelector(".row-ma-phan-lo"))||String(t.cells?.[0]?.textContent||"").trim():"",lotName:e?.phanLo==="Có"?_(t.querySelector(".row-ten-phan-lo"))||String(t.cells?.[1]?.textContent||"").trim():"",awardPriceRaw:i,awardPrice:a.parseVND(i),packageDuration:_(t.querySelector(".row-tg-goithau")),contractDuration:_(t.querySelector(".row-tg-hopdong")),rejectionReason:_(t.querySelector(".row-ly-do-truot"))}}function V(t,e,a="field"){return{code:t,element:e,kind:a}}function Ke({root:t,pkg:e,model:a,isDirectOrSpecial:r=!1}={}){if(!t?.querySelector||!a)throw new TypeError("Award approval requires a rendered root and model.");const n=t.querySelector("#award-so-bctd"),i=t.querySelector("#award-ngay-bctd"),o=t.querySelector("#award-decision-no"),s=t.querySelector("#award-decision-date"),l=_(n),c=_(i,{trim:!1}),u=_(o),f=_(s,{trim:!1}),T=t.querySelector("#approve-bidders-tbody"),g=Array.from(T?.querySelectorAll?.("tr")||[]).map(p=>Me(p,{pkg:e,model:a,isDirectOrSpecial:r})),m=g.filter(p=>p.isWinner),h=[];return n&&!l&&h.push(V("appraisal_number_required",n)),i&&!c&&h.push(V("appraisal_date_required",i)),u||h.push(V("decision_number_required",o)),f||h.push(V("decision_date_required",s)),m.forEach(p=>{r&&!p.contractorCode&&h.push(V("contractor_code_required",p.element.querySelector(".row-ma-nha-thau"),"winner")),r&&!p.contractorName&&h.push(V("contractor_name_required",p.element.querySelector(".row-ten-nha-thau"),"winner")),p.awardPriceRaw||h.push(V("award_price_required",p.element.querySelector(".row-gia-trung"),"winner")),p.packageDuration||h.push(V("package_duration_required",p.element.querySelector(".row-tg-goithau"),"winner")),p.contractDuration||h.push(V("contract_duration_required",p.element.querySelector(".row-tg-hopdong"),"winner"))}),{ok:h.length===0,isDirectOrSpecial:r,decision:{number:u,date:a.convertDMYToYMD(f),rawDate:f,appraisalNumber:l,appraisalDate:a.convertDMYToYMD(c),appraisalRawDate:c},rows:g,winnerRows:m,errors:h}}var Ge=Object.freeze({nhaThauTrungThauId:"",giaTrungThau:0,thoiGianGoiThau:"",thoiGianHopDong:""});function W(t){return String(t??"").trim()}function Vt(t){return W(t).toLocaleLowerCase("vi-VN").replace(/\s+/g," ")}function pt(t){return W(t?.id??t?.lotId??t?.lot_id)}function mt(t){return Vt(t?.maPhanLo??t?.ma_phan_lo??t?.code)}function Ae(t,e){const a=pt(t);if(a)return new Set((e?.lotIds||[]).map(W).filter(Boolean)).has(a);const r=mt(t),n=new Set((e?.lotCodes||[]).map(Vt).filter(Boolean));return!!(r&&n.has(r))}function Ve(t,e){const a=pt(t);if(a)return e.find(n=>pt(n)===a);const r=mt(t);return r?e.find(n=>mt(n)===r):void 0}function Qe(t){if(typeof t=="number")return Number.isFinite(t)?t:0;const e=W(t);if(!/^-?\d+(?:\.\d+)?$/.test(e))return 0;const a=Number(e);return Number.isFinite(a)?a:0}function He(t){const e=t.filter(r=>W(r?.nhaThauTrungThauId)),a=new Map;return e.forEach(r=>{const n=r.nhaThauTrungThauId,i=W(n);a.has(i)||a.set(i,n)}),{nhaThauTrungThauId:a.size===1?a.values().next().value:"",giaTrungThau:e.reduce((r,n)=>r+Qe(n.giaTrungThau),0)}}function Oe({phanLoList:t=[],scope:e={},scopedLotResults:a=[]}={}){const r=Array.isArray(t)?t:[],n=Array.isArray(a)?a:[],i=r.map(o=>{if(!Ae(o,e))return o;const s=Ve(o,n);return!s||!W(s.nhaThauTrungThauId)?{...o,...s||{},...Ge}:{...o,...s}});return{phanLoList:i,...He(i)}}var je="Tất cả các hồ sơ dự thầu không đáp ứng yêu cầu của hồ sơ mời thầu. Hủy thầu theo quy định tại Điểm a Khoản 1 Điều 17 Luật Đấu thầu số 22/2023/QH15 ngày 23 tháng 6 năm 2023, sửa đổi, bổ sung tại Luật số 57/2024/QH15, Luật số 90/2025/QH15.",We=Object.freeze({commitDependencies:(t,e)=>ue(t,e),commitDecision:(t,e)=>fe(t,e),finalizeLotBatch:t=>ae({...t,fetcher:qt})});function Fe(t){return te(t)}var bt=t=>Yt(t,{context:"award_command"});function Ct(t){return t?isNaN(t)?t:parseInt(t):""}function ze(t,e){return e.rows.forEach(a=>{const r=t.state.thongtinmothau.find(n=>n.id===a.bidId);r&&(r.lyDoTruot=a.isWinner?"":a.rejectionReason,a.isWinner&&(r.giaDeNghiTrungThau=a.awardPrice||r.giaDeNghiTrungThau||0))}),[]}function It(t,e){return t.state.thongtinmothau.find(a=>String(a.id)===String(e.bidId))?.nhaThauId||e.contractorId||e.bidId||""}function Ue(t,e,a,r){let n="none";if(e.phanLo==="Có"){const i=bt(e.phanLoList),o=a.winnerRows.map(c=>{const u=i.find(T=>String(T.maPhanLo||"")===String(c.lotCode)),f=It(t,c);return{id:u?.id||"",maPhanLo:c.lotCode,nhaThauTrungThauId:Ct(f),giaTrungThau:c.awardPrice,thoiGianGoiThau:c.packageDuration,thoiGianHopDong:c.contractDuration}}),s={lotIds:i.map(c=>String(c.id||"")).filter(Boolean),lotCodes:i.map(c=>String(c.maPhanLo||"")).filter(Boolean)},l=Oe({phanLoList:i,scope:r||s,scopedLotResults:o});e.phanLoList=l.phanLoList,e.nhaThauTrungThauId=l.nhaThauTrungThauId,e.giaTrungThau=l.giaTrungThau,e.thoiGianGoiThau="",e.thoiGianHopDong="",n=l.nhaThauTrungThauId||"none"}else{const i=a.winnerRows[0];let o=0,s="",l="";i&&(n=It(t,i),o=i.awardPrice,s=i.packageDuration,l=i.contractDuration),e.nhaThauTrungThauId=n==="none"?"":Ct(n),e.giaTrungThau=o,e.thoiGianGoiThau=n==="none"?"":s,e.thoiGianHopDong=n==="none"?"":l}return n}function Xe(t,e,a,r){const n=Fe(t.danhGiaHsdtMetadata);let i;if(e){const o=(a?n.technical:n)?.lotBatches?.[e.batchId];if(!o)return{metadata:n,target:null};(!o.result||typeof o.result!="object")&&(o.result={}),i=o.result,i.saved=!0}else(!n.result||typeof n.result!="object")&&(n.result={}),i=n.result;return i.soQuyetDinhKetQua=r.number,i.ngayQuyetDinhKetQua=r.date,i.soBctdKetQua=r.appraisalNumber,i.ngayBctdKetQua=r.appraisalDate,{metadata:n,target:i}}function Ye(t,e){return e.winnerRows.map(a=>{const r=t.state.thongtinmothau.find(n=>String(n.id)===String(a.bidId));return{bidId:a.bidId,jointVentureName:r?.loaiNhaThau==="Liên danh"&&r.tenNhaThau||"",contractorVersionId:r?.nhaThauId||a.contractorId||"",memberVersionIds:(r?.thanhVienLienDanh||[]).map(n=>n.thanhVienNhaThauId).filter(Boolean)}})}function ut(t){delete t.resultEdit,t.technical&&typeof t.technical=="object"&&delete t.technical.resultEdit}function Je(t,e){return e?!String(t?.status||"").trim():!0}async function ht(t,e,a){const r=le(t,a,e,t.model);await t.showPackageDetails(r)}function Ze(t=We){for(const e of["commitDependencies","commitDecision","finalizeLotBatch"])if(typeof t?.[e]!="function")throw new TypeError(`Award approval port ${e} is required.`);return Object.freeze({async execute({view:e,pkg:a,command:r,appController:n,viewModel:i}={}){if(!e?.model||!a||!r?.ok||!i)throw new TypeError("Award approval workflow received an invalid context.");if(r.isDirectOrSpecial)throw new TypeError("Award approval workflow cannot execute the legacy direct/special award path.");const o=n||e,{activeScopedEvaluation:s,isTwoEnvelope:l,officialLotState:c,isEditingOfficialResult:u}=i,{decision:f}=r,T=ze(e.model,r),g=Ue(e.model,a,r,s);let{metadata:m,target:h}=Xe(a,s,l,f);if(!h)return await e.customAlert("Không thể lưu kết quả","Không tìm thấy đợt phần lô đang xử lý. Vui lòng tải lại gói thầu và thử lại.","alert-triangle"),{ok:!1,kind:"missing_scope"};if(h.contractorBindings=Ye(e.model,r),s){const p=new Set(r.winnerRows.map(x=>x.lotCode)),w={};s.lotIds.forEach((x,k)=>{const $=s.lotCodes[k]||"";w[x]=p.has($)?"AWARDED":"NO_RESPONSIVE_BID"});const L=Je(s.batch,u),D={...h,soQuyetDinhKetQua:f.number,ngayQuyetDinhKetQua:f.date};l?(m.technical=dt(m.technical||{},s.batchId,D),m.financial?.lotBatches?.[s.batchId]&&(m.financial=dt(m.financial,s.batchId,D))):m=dt(m,s.batchId,D),ut(m),a.danhGiaHsdtMetadata=lt(m);let C=null;if(L)try{if(!(await t.commitDependencies(o,{contractorRecords:T,packageRecord:a}))?.ok)return{ok:!1,kind:"sync_failed"};const x=bt(a.phanLoList),k=new Map(x.map($=>[String($.id||""),$]));C=await t.finalizeLotBatch({packageId:a.id,batchId:s.batchId,outcomes:w,packageAward:{expectedVersion:Number.isInteger(a.rowVersion)?a.rowVersion:1,decisionNumber:f.number,decisionDate:f.date,metadata:m,lotResults:s.lotIds.map($=>{const E=k.get(String($))||{};return{lotId:$,winnerId:E.nhaThauTrungThauId||"",awardPrice:Number(E.giaTrungThau)||0,packageDuration:E.thoiGianGoiThau||"",contractDuration:E.thoiGianHopDong||""}})}})}catch(x){return await e.customAlert(u?"Không thể cập nhật kết quả đợt":"Không thể phê duyệt kết quả đợt",x?.message||(u?"Không thể đồng bộ trạng thái của đợt kết quả cũ.":"Không thể đóng đợt đánh giá chính thức."),"alert-triangle"),{ok:!1,kind:"lifecycle_failed"}}const N=u?c.isComplete:C?.packageStatus==="COMPLETED";if(a.trangThai!=="Hủy thầu"&&(a.trangThai=N?"Đã có kết quả":"Đã có kết quả một phần"),u||(a.soQuyetDinhKetQua=f.number,a.ngayQuyetDinhKetQua=f.date),L)a.rowVersion=C.packageRowVersion,await e.model.applyCommittedRowVersions?.([{table:"goithau",id:a.id,rowVersion:C.packageRowVersion}]),await e.renderGoiThauTable();else if(!(await t.commitDecision(o,{contractorRecords:T,packageRecord:a,afterPersist:()=>e.renderGoiThauTable()}))?.ok)return{ok:!1,kind:"sync_failed"};return e._continueOfficialLotEvaluation=e._continueOfficialLotEvaluation||{},e._continueOfficialLotEvaluation[a.id]=!1,e._editingOfficialResultLotBatchId="",e._currentResultLotBatchId="",await ht(e,a,"result"),await e.customAlert(u?`Đã cập nhật kết quả Lần ${s.batch?.sequenceNo||""}`.trim():`Đã phê duyệt kết quả Lần ${s.batch?.sequenceNo||""}`.trim(),u?`Kết quả chính thức của ${s.lotCodes.join(", ")} đã được cập nhật. Các đợt khác được giữ nguyên.`:N?`Đã có kết quả chính thức cho ${s.lotCodes.join(", ")}. Toàn bộ phần lô của gói thầu đã hoàn tất.`:`Đã có kết quả chính thức cho ${s.lotCodes.join(", ")}. Còn ${C?.counts?.pendingLots??"các"} phần lô chưa đánh giá.`,"check-circle"),{ok:!0,kind:"scoped_awarded"}}return(a.phanLo==="Có"?bt(a.phanLoList).some(p=>p.nhaThauTrungThauId):g!=="none"&&a.nhaThauTrungThauId)?(h.saved=!0,ut(m),a.danhGiaHsdtMetadata=lt(m),vt(a),a.soQuyetDinhKetQua=f.number,a.ngayQuyetDinhKetQua=f.date,a.trangThai="Đã có kết quả",(await t.commitDecision(o,{contractorRecords:T,packageRecord:a,afterPersist:()=>e.renderGoiThauTable()}))?.ok?(e._editingWholePackageResult=!1,e._editingWholePackageResultPackageId="",await ht(e,a,"result"),await e.customAlert("Chúc mừng",`Đã phê duyệt kết quả trúng thầu cho gói thầu "${a.tenGoiThau}" thành công!`,"check-circle"),{ok:!0,kind:"awarded"}):{ok:!1,kind:"sync_failed"}):(ut(m),m.cancelDetails=m.cancelDetails||{},m.cancelDetails.soQuyetDinhHuyThau=f.number,m.cancelDetails.ngayQuyetDinhHuyThau=f.date,m.cancelDetails.lyDoHuyThau=je,a.danhGiaHsdtMetadata=lt(m),vt(a),a.soQuyetDinhKetQua=f.number,a.ngayQuyetDinhKetQua=f.date,(await t.commitDecision(o,{contractorRecords:T,packageRecord:a,afterPersist:()=>e.renderGoiThauTable()}))?.ok?(await ht(e,a,"cancel"),await e.customAlert("Không có nhà thầu trúng thầu","Không có nhà thầu nào đạt yêu cầu. Hệ thống đã tự động điền các thông tin hủy thầu tương ứng và chuyển bạn sang tab Hủy thầu để xem lại hoặc điều chỉnh trước khi xác nhận hủy thầu chính thức.","info"),{ok:!0,kind:"cancelled"}):{ok:!1,kind:"sync_failed"})}})}var ta=Ze();function kt(t){return String(t?.vaiTro||"").trim().toLocaleLowerCase("vi-VN")==="đứng đầu liên danh"}function tt(t){return String(t||"").trim().toLocaleLowerCase("vi-VN")}function Qt(t,e){e.querySelectorAll(".row-gia-trung").forEach(s=>{gt(s,l=>t.model.formatVND(l))}),e.querySelectorAll(".row-tg-goithau").forEach(s=>{s.addEventListener("input",l=>{const c=e.querySelector(".row-tg-hopdong");if(c){const u=l.target.value.trim();c.value=u?`${u} + Thời gian thực hiện các nghĩa vụ theo hợp đồng`:""}})});const a=e.querySelector(".row-loai-nha-thau"),r=e.querySelector(".row-jv-members-container");a&&r&&a.addEventListener("change",()=>{H(r,"display",a.value==="Liên danh"?"block":"none")});const n=e.querySelector(".row-btn-manage-members");n&&n.addEventListener("click",s=>{s.preventDefault();const l=e._jointVentureViewData||{},c={members:l.members||e._thanhVienLienDanh||[],leadName:l.leadName||e._leadMemberName||e.querySelector(".row-ten-nha-thau")?.value.trim()||"",leadCode:l.leadCode||e.querySelector(".row-ma-nha-thau")?.value.trim()||"",leadContractorVersionId:l.leadContractorVersionId||e._leadMemberContractorId||""};Pt("openMoThauJVViewModal",c.members,c.leadName,c.leadCode,c.leadContractorVersionId)});const i=e.querySelector(".row-ma-nha-thau"),o=e.querySelector(".row-ten-nha-thau");if(i&&o){const s=()=>{const l=i.value.trim();if(!l)return;const c=t.model.getLatestNhaThau().find(u=>u.maNhaThau&&u.maNhaThau.trim().toLowerCase()===l.toLowerCase());c&&(o.value=c.tenNhaThau||"")};i.addEventListener("input",s),i.addEventListener("change",s)}}function nt(t,e={}){const a=re(t,e),r=tt(e.maNhaThau||e.maDinhDanh),n=String(e.nhaThauId||""),i=a.find(kt)||a.find(f=>String(f.thanhVienNhaThauId||"")===n)||a.find(f=>tt(f.maNhaThau||f.maSoThue||f.maDinhDanh)===r),o=se(t,i?.thanhVienNhaThauId||e.nhaThauId||"")||oe(t,i?.maNhaThau||i?.maSoThue||e.maNhaThau||e.maDinhDanh),s=i?.thanhVienNhaThauId||o?.id||e.nhaThauId||"",l=i?.maNhaThau||i?.maSoThue||i?.maDinhDanh||o?.maNhaThau||o?.maSoThue||e.maNhaThau||e.maDinhDanh||"",c=i?.tenNhaThau||o?.tenNhaThau||(e.loaiNhaThau==="Liên danh"?"":et(t,e))||"",u=tt(l);return{members:a.filter(f=>{if(f===i||kt(f))return!1;const T=tt(f.maNhaThau||f.maSoThue||f.maDinhDanh);return!u||T!==u}),leadName:c,leadCode:l,leadContractorVersionId:s}}function Dt(t){const e=t.querySelector(".row-ly-do-truot");e&&(e.disabled=!1,H(e,"background",""),e.value||(e.value=t.getAttribute("data-default-reason")||"Nhà thầu xếp hạng 1 trúng thầu"));for(const a of[".row-gia-trung",".row-tg-goithau",".row-tg-hopdong"]){const r=t.querySelector(a);r&&(r.disabled=!0,H(r,"background","#f1f5f9"),r.value="")}}function ea(t){new Map([[".row-gia-trung","data-default-price"],[".row-tg-goithau","data-default-duration-pkg"],[".row-tg-hopdong","data-default-duration-ctr"]]).forEach((a,r)=>{const n=t.querySelector(r);n&&(n.disabled=!1,H(n,"background",""),n.value=t.getAttribute(a)||"")});const e=t.querySelector(".row-ly-do-truot");e&&(e.disabled=!0,H(e,"background","#f1f5f9"),e.value="")}function aa(t,e,a,r){const n=e.querySelector("#approve-bidders-tbody");if(n){if(r.allBids.forEach(i=>{const o=n.querySelector(`tr[data-approve-bid-id="${i.id}"]`);if(!o)return;const s=nt(t.model,i);o._jointVentureViewData=s,o._thanhVienLienDanh=s.members,o._leadMemberName=s.leadName,o._leadMemberContractorId=s.leadContractorVersionId}),n.querySelectorAll("tr").forEach(i=>Qt(t,i)),r.isDirectOrSpecial){n.addEventListener("click",async i=>{const o=i.target.closest(".row-remove-bidder")?.closest("tr");o&&await t.customConfirm("Xác nhận xóa","Bạn có chắc chắn muốn xóa dòng nhà thầu này?","trash-2")&&o.remove()}),n.addEventListener("change",i=>{if(!i.target.classList.contains("row-ma-phan-lo"))return;const o=i.target.closest("tr")?.querySelector(".row-ten-phan-lo"),s=i.target.options[i.target.selectedIndex];o&&(o.value=s?.getAttribute("data-name")||"")});return}n.querySelectorAll(".row-status-select").forEach(i=>{i.addEventListener("change",o=>{const s=o.target.closest("tr");if(s)if(o.target.value==="trung"){const l=s.cells[0]?.textContent.trim();n.querySelectorAll("tr").forEach(c=>{if(c===s||a.phanLo==="Có"&&c.cells[0]?.textContent.trim()!==l)return;const u=c.querySelector(".row-status-select");u&&!u.disabled&&(u.value="truot"),Dt(c)}),ea(s)}else Dt(s)})})}}function na(t){const e=t.querySelectorAll('input[name="result-danh-gia-nang-luc"]'),a=t.querySelector("#container-date-bao-cao-danh-gia");e.forEach(o=>{o.addEventListener("change",()=>{a&&H(a,"display",o.value==="Có"?"block":"none")})});const r=t.querySelector("#date-thuong-thao"),n=t.querySelector("#date-trinh-ket-qua"),i=t.querySelector("#award-decision-date");r?.addEventListener("change",()=>{n&&(n.value=r.value,n._flatpickr?.setDate(r.value),i&&(i.value=r.value,i._flatpickr?.setDate(r.value)))}),n?.addEventListener("change",()=>{i&&(i.value=n.value,i._flatpickr?.setDate(n.value))})}function Nt(t,e,a,r,n={}){const i=n.id||Rt("thongtinmothau"),o=J(a.phanLoList,{context:"award_panel"}).map(p=>`<option value="${y(p.maPhanLo)}" data-name="${y(p.tenPhanLo)}" ${n.maPhanLo===p.maPhanLo?"selected":""}>${d(p.maPhanLo)}</option>`).join(""),s=n.maNhaThau||n.maDinhDanh||"",l=n.tenNhaThau||"",c=n.loaiNhaThau||"Độc lập",u=(e.ownerDocument||document).createElement("tr");u.setAttribute("data-cdtrug-id",i),u.innerHTML=A(`
    ${a.phanLo==="Có"?`
      <td><select class="form-control cdtrug-ma-phan-lo bf-s-1c5ec6d115"><option value="">-- Chọn --</option>${o}</select></td>
      <td><input type="text" class="form-control cdtrug-ten-phan-lo bf-s-1c5ec6d115" value="${y(n.tenPhanLo||"")}" readonly placeholder="Tên lô"></td>
    `:""}
    <td><select class="form-control cdtrug-loai-nha-thau bf-s-1c5ec6d115">
      <option value="Độc lập" ${c==="Độc lập"?"selected":""}>Độc lập</option>
      <option value="Liên danh" ${c==="Liên danh"?"selected":""}>Liên danh</option>
    </select></td>
    <td><input type="text" class="form-control cdtrug-ma-nha-thau bf-s-1c5ec6d115" value="${y(s)}" required placeholder="Mã NT"></td>
    <td><input type="text" class="form-control cdtrug-ten-nha-thau bf-s-1c5ec6d115" value="${y(l)}" required placeholder="Tên nhà thầu"></td>
    <td><input type="text" class="form-control cdtrug-gia-du-thau cdtrug-format-vnd bf-s-1c5ec6d115" value="${y(n.giaDuThau?t.model.formatVND(n.giaDuThau):"")}" placeholder="Giá dự thầu"></td>
    <td><input type="text" class="form-control cdtrug-ty-le-giam-gia bf-s-f2b3f12563" value="${y(n.tyLeGiamGia!==void 0?(n.tyLeGiamGia||0).toString().replace(".",","):"0")}"></td>
    <td><input type="text" class="form-control cdtrug-gia-sau-giam-gia cdtrug-format-vnd bf-s-67c231a219" value="${y(n.giaSauGiamGia?t.model.formatVND(n.giaSauGiamGia):"")}" readonly></td>
    <td><input type="text" class="form-control cdtrug-hieu-luc-hsdt bf-s-1c5ec6d115" value="${y(n.hieuLucHsdt?`${n.hieuLucHsdt} ngày`:a.hieuLucHsdt?`${a.hieuLucHsdt} ngày`:"90 ngày")}"></td>
    <td><input type="text" class="form-control cdtrug-gia-tri-dam-bao cdtrug-format-vnd bf-s-1c5ec6d115" value="${y(n.giaTriDamBao?t.model.formatVND(n.giaTriDamBao):"")}" placeholder="Giá trị ĐB"></td>
    <td><input type="text" class="form-control cdtrug-hieu-luc-bao-dam-ngay bf-s-1c5ec6d115" value="${y(n.hieuLucBaoDamNgay?`${n.hieuLucBaoDamNgay} ngày`:a.hieuLucDamBaoDuThau?`${a.hieuLucDamBaoDuThau} ngày`:"120 ngày")}"></td>
    <td><input type="text" class="form-control cdtrug-thoi-gian-thuc-hien bf-s-1c5ec6d115" value="${y(n.thoiGianThucHien||a.thoiGianThucHien||"")}" placeholder="Thực hiện"></td>
    <td class="bf-s-905008530c"><button type="button" class="action-btn btn-delete cdtrug-remove-row" title="Xóa hàng"><i data-lucide="trash-2" class="bf-s-641778be2c"></i></button></td>
  `);const f=u.querySelector(".cdtrug-gia-du-thau"),T=u.querySelector(".cdtrug-ty-le-giam-gia"),g=u.querySelector(".cdtrug-gia-sau-giam-gia"),m=()=>{const p=(t.model.parseVND(f?.value)||0)*(1-(parseFloat((T?.value||"0").replace(/,/g,"."))||0)/100);g&&(g.value=p>0?t.model.formatVND(p):"")};f?.addEventListener("input",m),T?.addEventListener("input",m),gt(f,p=>t.model.formatVND(p)),gt(u.querySelector(".cdtrug-gia-tri-dam-bao"),p=>t.model.formatVND(p)),[f,u.querySelector(".cdtrug-gia-tri-dam-bao")].forEach(p=>{p?.addEventListener("blur",()=>{p.value=t.model.formatVND(t.model.parseVND(p.value))||""})});const h=u.querySelector(".cdtrug-ma-phan-lo");h?.addEventListener("change",()=>{const p=h.options[h.selectedIndex],w=u.querySelector(".cdtrug-ten-phan-lo");w&&(w.value=p?.getAttribute("data-name")||"")}),u.querySelector(".cdtrug-remove-row")?.addEventListener("click",()=>u.remove()),r.appendChild(u),globalThis.window?.lucide?.createIcons({root:u})}function ia(t,e,a){const r=a.hinhThucLuaChon==="Chỉ định thầu rút gọn"||a.hinhThucLuaChon==="Lựa chọn nhà thầu trong trường hợp đặc biệt",n=e.querySelector("#cdtrug-mothau-tbody");if(!r||!n)return;const i=t.model.state.thongtinmothau.filter(o=>String(o.goiThauId)===String(a.id));(i.length>0?i:[{}]).forEach(o=>Nt(t,e,a,n,o)),e.querySelector("#btn-cdtrug-add-bidder")?.addEventListener("click",()=>{Nt(t,e,a,n)})}function ra(t,e,a){const r=e.querySelector("#approve-bidders-tbody");if(!r)return;const n=Rt("thongtinmothau"),i=(e.ownerDocument||document).createElement("tr");i.setAttribute("data-approve-bid-id",n),i.setAttribute("data-is-qualified","true"),i.setAttribute("data-nt-id",n);const o=a.phanLo==="Có"?J(a.phanLoList,{context:"award_panel"}):[],s=a.phanLo==="Có"?`
    <td><select class="form-control row-ma-phan-lo bf-s-3f107fe5ee">${o.map(l=>`<option value="${y(l.maPhanLo)}" data-name="${y(l.tenPhanLo)}">${d(l.maPhanLo)}</option>`).join("")}</select></td>
    <td><input type="text" class="form-control row-ten-phan-lo bf-s-97e02f4332" value="${y(o[0]?.tenPhanLo||"")}" readonly></td>
  `:"";i._thanhVienLienDanh=[],i._leadMemberName="",i._jointVentureViewData={members:[],leadName:"",leadCode:"",leadContractorVersionId:""},i.innerHTML=A(`
    ${s}
    <td><select class="form-control row-loai-nha-thau bf-s-3f107fe5ee"><option value="Độc lập" selected>Độc lập</option><option value="Liên danh">Liên danh</option></select></td>
    <td><input type="text" class="form-control row-ma-nha-thau bf-s-3f107fe5ee" value="" placeholder="Mã nhà thầu"></td>
    <td><input type="text" class="form-control row-ten-nha-thau bf-s-3f107fe5ee" value="" placeholder="Tên nhà thầu"><div class="row-jv-members-container bf-s-e9ebaa0dab"><button type="button" class="btn btn-outline btn-xs row-btn-manage-members bf-s-32804fa5c4"><i data-lucide="users" class="bf-s-38e6fd7439"></i><span class="row-jv-btn-text">Xem thành viên liên danh (0)</span></button></div></td>
    <td><input type="text" class="form-control row-gia-trung bf-s-aa4eecce78" value="" placeholder="Giá trúng..."></td>
    <td><input type="text" class="form-control row-tg-goithau bf-s-aa4eecce78" value="${y(a.thoiGianThucHien||"")}" placeholder="Thời gian gói..."></td>
    <td><input type="text" class="form-control row-tg-hopdong bf-s-aa4eecce78" value="${y(a.thoiGianThucHien?`${a.thoiGianThucHien} + Thời gian thực hiện các nghĩa vụ theo hợp đồng`:"")}" placeholder="Thời gian HĐ..."></td>
    <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete row-remove-bidder bf-s-2e8164f9a4" aria-label="Xóa nhà thầu"><i data-lucide="trash-2" class="bf-s-3e32597019"></i></button></td>
  `),r.appendChild(i),t.createIconsScoped?.(i),Qt(t,i)}function oa({view:t,root:e,pkg:a,appController:r,viewModel:n,approvalPanel:i}){const o=e.querySelector("#btn-approve-award");o&&(o.onclick=async()=>{if(i.isDirectOrSpecial){await Pt("saveKetQuaChiDinhThau",a.id);return}const s=Ke({root:e,pkg:a,model:t.model,isDirectOrSpecial:i.isDirectOrSpecial});if(s.errors.forEach(l=>{const c=l.element;if(c)if(l.kind==="field"){yt(c,{state:"invalid",message:c.closest(".form-group")?.querySelector(".error-text")?.textContent||""});const u=()=>yt(c);c.addEventListener("input",u),c.addEventListener("change",u)}else H(c,"border","1px solid var(--danger)"),c.addEventListener("input",()=>H(c,"border",""))}),!s.ok){const l=s.errors.find(c=>c.element)?.element;l&&t.focusInvalidControl(l);return}await ta.execute({view:t,pkg:a,command:s,appController:r,viewModel:n})})}function sa(t,e,a,r){const n=e.querySelector("#btn-result-export-excel-template");n&&(n.onclick=()=>{const o=(a.tenGoiThau||"GoiThau").replace(/[^a-zA-Z0-9]/g,"_");Wt(t,`/api/export-ketquaqd-template?package_id=${a.id}&package_name=${encodeURIComponent(o)}`,`KetQua_QD_${o}.xlsx`)});const i=e.querySelector("#btn-result-import-excel");i&&r&&(i.onclick=()=>{r._currentResultPackageId=a.id,r.triggerExcelImport("ketquaqd")})}function ca({view:t,root:e,pkg:a,appController:r,viewModel:n,approvalPanel:i={allBids:[],isDirectOrSpecial:!1},rerender:o,persistEditState:s}={}){if(!t?.model||!e?.querySelector||!a)throw new TypeError("Award result panel controller received an invalid context.");e.querySelector("#btn-cancel-official-result-edit")?.addEventListener("click",async()=>{ne(a),t._editingOfficialResultLotBatchId="",t._currentResultLotBatchId="",t._editingWholePackageResult=!1,t._editingWholePackageResultPackageId="",o?.(),await s?.()}),na(e),aa(t,e,a,i),ia(t,e,a),oa({view:t,root:e,pkg:a,appController:r,viewModel:n,approvalPanel:i}),sa(t,e,a,r),e.querySelector("#btn-result-add-bidder")?.addEventListener("click",()=>{ra(t,e,a)})}function la(t,e,a,r,n){if(a.hasMultipleWinners){const l=a.winningLots.map(c=>{const u=r.find(g=>String(g.nhaThauId)===String(c.nhaThauTrungThauId)),f=(t.state.nhathau||[]).find(g=>String(g.id)===String(c.nhaThauTrungThauId)),T=u?.loaiNhaThau==="Liên danh";return{maPhanLo:c.maPhanLo,tenPhanLo:c.tenPhanLo,nhaThauTrungThauId:c.nhaThauTrungThauId,tenNhaThau:u?et(t,u):f?.tenNhaThau||`Nhà thầu #${c.nhaThauTrungThauId}`,giaTrungThau:c.giaTrungThau,isJV:T,jvData:T?nt(t,u):null}});return Xt(t,e.id,l,{owner:n}),`
      <h5 class="bf-s-f3bfd10216">
        <a href="#" data-bf-action="show-lot-winners" data-id="${y(e.id)}" class="link-hover bf-s-9be517fbf0" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a>
      </h5>
    `}const i=a.currentWinnerBid;if(!i)return'<h5 class="bf-s-f3bfd10216">Chưa xác định</h5>';if(i.loaiNhaThau==="Liên danh")return Et(t,e.id,nt(t,i),{owner:n}),`
      <div class="bf-s-7d5173b171">
        <h5 class="bf-s-f3bfd10216">
          <a href="#" data-bf-action="show-jv" data-id="${y(e.id)}" class="link-hover bf-s-b0e08465c2" title="Xem chi tiết liên danh">👥 ${d(et(t,i))}</a>
        </h5>
      </div>
    `;const o=(t.state.nhathau||[]).find(l=>String(l.id)===String(i.nhaThauId)),s=o?o.maSoThue||o.maNhaThau:i.maDinhDanh||i.maNhaThau;return`
    <h5 class="bf-s-f3bfd10216">
      <a href="#" data-bf-action="show-contractor-modal" data-id="${y(i.nhaThauId)}" class="link-hover bf-s-b0e08465c2">${d(et(t,i))}</a>
    </h5>
    <div class="bf-s-dfd82ca088">
      MST: <strong>${d(at(s,"Chưa có"))}</strong>
    </div>
  `}function da(t,e,a,r){return a.bidderRows.map(n=>{const i=n.bid,o=n.isWinner?t.formatCurrency(n.awardPrice||0):"—",s=n.isWinner?'<span class="badge badge-success bf-s-3b94095234">Trúng thầu</span>':'<span class="badge badge-danger bf-s-514590f0cd">Trượt thầu</span>';let l;if(i.loaiNhaThau==="Liên danh"){const c=`${e.id}_result_bidder_${n.index}`;Et(t,c,nt(t,i),{owner:r}),l=`<a href="#" data-bf-action="show-jv" data-id="${y(c)}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${d(i.tenNhaThau||"--")}</a>`}else l=ge(t,i,`${e.id}_result_contractor_${n.index}`,{owner:r});return a.isLotPackage?`
        <tr>
          <td>${d(i.maPhanLo||"—")}</td>
          <td class="package-lot-name-cell">${d(i.tenPhanLo||"—")}</td>
          <td>${d(at(i.maNhaThau||i.maDinhDanh,"--"))}</td>
          <td>${l}</td>
          <td class="fw-bold text-success">${o}</td>
          <td>${d(n.packageDuration)}</td>
          <td class="bf-s-63dbf5319a">${s}</td>
          <td class="text-muted">${d(n.rejectionReason)}</td>
        </tr>
      `:`
      <tr>
        <td>${d(at(i.maNhaThau||i.maDinhDanh,"--"))}</td>
        <td>${l}</td>
        <td class="fw-bold text-success">${o}</td>
        <td>${d(n.packageDuration)}</td>
        <td class="bf-s-63dbf5319a">${s}</td>
        <td class="text-muted">${d(n.rejectionReason)}</td>
      </tr>
    `}).join("")}function ua(t){return t?`
      <tr>
        <th class="bf-s-ae54075f01">Mã phần lô</th>
        <th class="bf-s-2811ee8f01">Tên phần lô</th>
        <th class="bf-s-ae54075f01">Mã nhà thầu</th>
        <th class="bf-s-a01153c965">Tên nhà thầu</th>
        <th class="bf-s-1e5172f548">Giá trị trúng thầu</th>
        <th class="bf-s-ad8c93e5fe">Thời gian thực hiện</th>
        <th class="bf-s-59052b934c">Trạng thái</th>
        <th class="bf-s-ae54075f01">Lý do trượt thầu</th>
      </tr>
    `:`
    <tr>
      <th class="bf-s-ad8c93e5fe">Mã nhà thầu</th>
      <th class="bf-s-8fd95f72da">Tên nhà thầu</th>
      <th class="bf-s-ad8c93e5fe">Giá trị trúng thầu</th>
      <th class="bf-s-ad8c93e5fe">Thời gian thực hiện</th>
      <th class="bf-s-59052b934c">Trạng thái</th>
      <th class="bf-s-ae54075f01">Lý do trượt thầu</th>
    </tr>
  `}function ha({model:t,pkg:e,summary:a,allBids:r=[]}={}){if(!t?.state||!e||!a||!Array.isArray(a.bidderRows))throw new TypeError("Award result summary presentation received an invalid context.");const n=`award-result:${e.id}`;return zt(t,n),!e.nhaThauTrungThauId&&a.inferredPackageWinnerId&&(e.nhaThauTrungThauId=a.inferredPackageWinnerId),{winnerHtml:la(t,e,a,r,n),bidderRowsHtml:da(t,e,a,n),tableHeaderHtml:ua(a.isLotPackage)}}function ft(t){return String(t??"").trim()}function fa(t){return de(t)?ft(t?.phanLo)==="Có"?(t?.phanLoList||[]).some(e=>ft(e?.nhaThauTrungThauId)):!!ft(t?.nhaThauTrungThauId):!1}function ga(t){return String(t||"goi_thau").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g,"_").replace(/[. ]+$/g,"").slice(0,120)||"goi_thau"}async function pa({packageId:t,packageCode:e="goi_thau",expectedRevision:a,downloadImpl:r=Ft}={}){const n=String(t||"").trim(),i=Number(a);if(!n)throw new TypeError("Thiếu gói thầu cần xuất.");if(!Number.isInteger(i)||i<1)throw new TypeError("Thiếu phiên bản gói thầu hợp lệ để xuất.");const o=`/api/packages/${encodeURIComponent(n)}/winning-goods.xlsx?expectedRevision=${i}`,s=`Danh_sach_hang_hoa_trung_thau_${ga(e)}.xlsx`;return await r(o,s),{filename:s}}function ma(t,e,a,r){const n=String(a||"").trim();return!t||!e||!n||!Mt(e,{type:"batch",batchId:n})?!1:(t._editingOfficialResultLotBatchId=n,t._currentResultLotBatchId=n,r?.(),!0)}function ba(t,e,a){return!t||!e||!Mt(e,{type:"whole"})?!1:(t._editingWholePackageResult=!0,t._editingWholePackageResultPackageId=String(e.id||""),a?.(),!0)}function ya(t,{contentWrapper:e,gt:a,id:r,isEditable:n,appController:i}){const o=Ee({pkg:a,bids:t.model.state.thongtinmothau,isEditable:n,editState:{officialBatchId:t._editingOfficialResultLotBatchId,currentBatchId:t._currentResultLotBatchId,wholePackage:t._editingWholePackageResult===!0,wholePackageId:t._editingWholePackageResultPackageId}}),{metadata:s,isTwoEnvelope:l,officialLotState:c,effectiveEditState:u,isEditingOfficialResult:f,isEditingWholePackageResult:T,activeScopedEvaluation:g,resultMetadata:m,soBctdResult:h,ngayBctdResult:p,scopedBidsForResult:w,allBidsForResult:L,summary:D}=o;t._editingOfficialResultLotBatchId=u.officialBatchId,t._currentResultLotBatchId=u.currentBatchId,t._editingWholePackageResult=u.wholePackage,t._editingWholePackageResultPackageId=u.wholePackageId;const C=_e(t,a,c,s,{isEditable:n}),N=()=>{const $=document.getElementById("detail-workflow-status-badge");if($&&typeof t.getStatusBadge=="function"){const E=Bt(a,{editingBatchId:t._editingOfficialResultLotBatchId,editingWholePackage:t._editingWholePackageResult===!0&&(!t._editingWholePackageResultPackageId||String(t._editingWholePackageResultPackageId)===String(a.id))});$.innerHTML=A(t.getStatusBadge(E)),window.lucide&&window.lucide.createIcons({root:$})}ya(t,{contentWrapper:e,gt:a,id:r,isEditable:n,appController:i})},x=async()=>{try{return(await he(i||t,{packageRecord:a,afterPersist:()=>t.renderGoiThauTable?.()}))?.ok!==!1}catch($){return await t.customAlert?.("Không thể cập nhật trạng thái",$?.message||"Không thể đồng bộ trạng thái chỉnh sửa kết quả với máy chủ.","alert-triangle"),!1}},k=()=>{e.querySelectorAll("[data-edit-official-result-batch]").forEach($=>{$.addEventListener("click",async()=>{ma(t,a,$.getAttribute("data-edit-official-result-batch"),N)&&await x()})})};if(o.mode==="history"){e.innerHTML=A(C),k(),window.lucide&&window.lucide.createIcons({root:e});return}if(o.mode==="summary"){const{winnerHtml:$,bidderRowsHtml:E,tableHeaderHtml:F}=ha({model:t.model,pkg:a,summary:D,allBids:L});Se(e,{pkg:a,winnerHtml:$,bidderRowsHtml:E,tableHeaderHtml:F,resultHistoryHtml:C,appraisalNumber:h,appraisalDate:p,isEditable:n,awardResultExcelExportEnabled:!!t.model.state.activeuser?.awardResultExcelExportEnabled,winningGoodsExportEnabled:!!t.model.state.activeuser?.excelExportEnabled&&fa(a),formatCurrency:M=>t.model.formatCurrency(M),formatDate:M=>t.model.formatDate(M)}),k(),$e(e,{onEdit:async()=>{ba(t,a,N)&&await x()},onExportWinningGoods:async()=>{await pa({packageId:a.id,packageCode:a.maGoiThau,expectedRevision:a.rowVersion})},onWinningGoodsExportError:M=>t.customAlert("Không thể xuất hàng hóa trúng thầu",M.message,"alert-triangle"),refreshIcons:()=>t.createIconsScoped?.(e)}),Le(e,{packageId:r,packageCode:a.maGoiThau||"GoiThau",onError:M=>t.customAlert("Không thể xuất file kết quả",M?.message||"Vui lòng thử lại.","alert-triangle"),refreshIcons:()=>t.createIconsScoped?.(e)})}else{const $=Pe(t,{gt:g?{...a,soQuyetDinhKetQua:m.soQuyetDinhKetQua||"",ngayQuyetDinhKetQua:m.ngayQuyetDinhKetQua||""}:a,metadata:g?{...s,result:m}:s,soBctdResult:h,ngayBctdResult:p,is1G2T2:l,bids:w,scopedDraft:g?{label:`đợt ${g.lotCodes.join(", ")}`,lotCodes:g.lotCodes,sequenceNo:g.batch?.sequenceNo||"",isEditingOfficialResult:f}:T?{isEditingOfficialResult:!0,isWholePackage:!0,lotCodes:[]}:null});e.innerHTML=A($.html),C&&!f&&(e.innerHTML=A(C+e.innerHTML)),window.lucide&&window.lucide.createIcons({root:e}),k(),ca({view:t,root:e,pkg:a,appController:i,viewModel:o,approvalPanel:$,rerender:N,persistEditState:x})}}export{ya as renderAwardResultDetailsPanel};
