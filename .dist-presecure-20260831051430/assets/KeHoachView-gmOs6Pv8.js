import{r as ae}from"./runtimeStyles-DWYSnTnQ.js";import{a as ce,i as $e}from"./apiClient-CeM1mzJZ.js";import{s as Q}from"./formatters-BTdVYNR8.js";import{i as H,l as x,n as o,r as _,s as Y}from"./view_helpers-CdPIbaii.js";import{a as W,at as de,ct as q,it as he}from"./app-RPlYyKwL.js";import{i as Ce}from"./domUtils-ByCXOQ5o.js";import{r as ue}from"./externalAssets-BneNgGyG.js";import{t as X}from"./commandBus-CHqMiCNa.js";import{t as Ee}from"./controllerRef-BPg74dXx.js";import{t as Ae}from"./VersionFamilyLoader-wx7GpB-n.js";import{c as pe,f as U}from"./versionResolver-C4iQLmXG.js";import{t as Le}from"./perfDiagnostics-rZdUYj0C.js";import{d as De,g as Se,l as ge,r as Ie,u as ke}from"./tableDataUtils-jcjOH8y4.js";import{t as Ne}from"./YearMonthFilter-BSoomVCy.js";import{a as we,i as Ve,n as Pe,o as He,r as xe,s as Be,t as ne}from"./virtualTable-HKeI84Ao.js";import{t as ie}from"./VersionSelector-CtR_Sh95.js";function F(t){return String(t||"tab").replace(/[^a-zA-Z0-9_-]+/g,"-")}function Re({key:t,index:e,count:a,orientation:n="horizontal"}){if(!Number.isInteger(a)||a<=0)return null;if(t==="Home")return 0;if(t==="End")return a-1;const s=n==="vertical"?"ArrowUp":"ArrowLeft",r=n==="vertical"?"ArrowDown":"ArrowRight";return t===s?(e-1+a)%a:t===r?(e+1)%a:null}function _e(t,e,a,n=""){const s=F(t?.id),r=F(a),y=n?F(n):`${r}-panel-${s}`;return`<button type="button" role="tab" id="${r}-tab-${s}" aria-selected="${e?"true":"false"}" aria-controls="${y}" tabindex="${e?"0":"-1"}" ${t?.disabled?'aria-disabled="true" disabled':""} class="btn package-workflow-tab ${e?"active":""}" data-workflow-tab="${o(t?.id||"")}"><i data-lucide="${o(t?.icon||"circle-dot")}" aria-hidden="true"></i><span>${o(t?.label||"")}</span></button>`}function Me(t,e,a,n,{groupId:s="package-workflow",panelId:r="",orientation:y="horizontal",ariaLabel:L="Các bước xử lý gói thầu"}={}){if(!t)return()=>{};t.__bfAccessibleTabsCleanup?.(),t.setAttribute("role","tablist"),t.setAttribute("aria-orientation",y),t.setAttribute("aria-label",L),t.innerHTML=q((e||[]).map(l=>_e(l,a===l.id,s,r)).join(""));const g=()=>[...t.querySelectorAll('[role="tab"]:not([disabled])')],u=(l,{focus:$=!1}={})=>{l&&($&&l.focus(),n?.(l.getAttribute("data-workflow-tab")))},C=l=>u(l.target.closest?.('[role="tab"]')),p=l=>{const $=l.target.closest?.('[role="tab"]'),h=g(),c=h.indexOf($);if(c<0)return;const T=Re({key:l.key,index:c,count:h.length,orientation:y});T!==null&&(l.preventDefault(),u(h[T],{focus:!0}))};t.addEventListener("click",C),t.addEventListener("keydown",p);const v=()=>{t.removeEventListener("click",C),t.removeEventListener("keydown",p),t.__bfAccessibleTabsCleanup===v&&delete t.__bfAccessibleTabsCleanup};return t.__bfAccessibleTabsCleanup=v,v}var be=new URL("/dist/assets/VersionComparisonPanel-BHscaLDV.css",""+import.meta.url).pathname,me=Object.freeze({ADDED:"Được thêm",REMOVED:"Bị xóa",MODIFIED:"Bị sửa",UNCHANGED:"Không thay đổi"}),Ge=Object.freeze({CONFIRMED:"Đã xác nhận ảnh hưởng",POTENTIAL:"Có thể bị ảnh hưởng",NOT_EVALUATED:"Chưa đủ dữ liệu để đánh giá"}),M=Object.freeze({"package.bidClosingTime":"Thời gian đóng thầu","package.price":"Giá gói thầu","package.status":"Trạng thái gói thầu","package.code":"Mã gói thầu","package.name":"Tên gói thầu","plan.code":"Mã kế hoạch","plan.name":"Tên kế hoạch",thoiGianDongThau:"Thời gian đóng thầu",giaGoiThau:"Giá gói thầu",trangThai:"Trạng thái gói thầu",maGoiThau:"Mã gói thầu",tenGoiThau:"Tên gói thầu",maKeHoach:"Mã kế hoạch",tenKeHoach:"Tên kế hoạch",thoiGianDangMa:"Thời gian đăng mã",thoiGianDangTai:"Thời gian đăng tải",thoiGianMoThau:"Thời gian mở thầu",ngayPheDuyet:"Ngày phê duyệt",quyetDinhPheDuyet:"Quyết định phê duyệt",nguonVon:"Nguồn vốn",empId:"Nhân sự",type:"Loại đối tượng",targetId:"Đối tượng được phân công",soTaiKhoan:"Số tài khoản"}),ve=Object.freeze({assignments:"Phân công nhân sự",packages:"Các gói thầu",timelineItems:"Các mốc tiến độ",yeuCauLamRoList:"Yêu cầu làm rõ",traLoiLamRoList:"Phản hồi làm rõ",giaHanList:"Các lần gia hạn",toChuyenGia:"Tổ chuyên gia",toThamDinh:"Tổ thẩm định"}),Oe=Object.freeze({TIMELINE:"Tiến độ",ASSIGNMENT:"Phân công nhân sự",LEGAL_RULES:"Quy định pháp lý",GENERATED_WORD:"Tài liệu Word đã tạo",PROGRESS:"Tiến trình thực hiện",WORKFLOW:"Quy trình xử lý",DOCUMENT:"Tài liệu",EVALUATION:"Đánh giá hồ sơ dự thầu",CONTRACT:"Hợp đồng",NOTIFICATION:"Thông báo",COMPLIANCE:"Tuân thủ"}),Ke=Object.freeze({SOURCE_FIELD_CHANGED:"Dữ liệu nguồn đã thay đổi",AUTHORITATIVE_PROVIDER_NOT_AVAILABLE:"Chưa có nguồn dữ liệu thẩm quyền",TIMELINE_PROJECTION_CHANGED:"Các mốc tiến độ đã thay đổi",NO_TIMELINE_CHANGE:"Không phát hiện thay đổi tiến độ",ASSIGNMENT_MEMBERSHIP_CHANGED:"Thành viên được phân công đã thay đổi",NO_ASSIGNMENT_CHANGE:"Không phát hiện thay đổi phân công",LEGAL_VERSIONING_DISABLED:"Chức năng phiên bản pháp lý đang tắt",LEGAL_BINDING_UNAVAILABLE:"Chưa có căn cứ pháp lý để đối chiếu",LEGAL_BINDING_NOT_RESOLVED:"Căn cứ pháp lý chưa được xác định đầy đủ",EXACT_LEGAL_BINDING_CHANGED:"Căn cứ pháp lý áp dụng đã thay đổi",NO_LEGAL_BINDING_CHANGE:"Không phát hiện thay đổi căn cứ pháp lý",NO_GENERATED_DOCUMENT_PROVENANCE:"Chưa có nguồn gốc tài liệu đã tạo",NO_BUSINESS_CHANGE:"Không phát hiện thay đổi dữ liệu nghiệp vụ",GENERATED_DOCUMENT_SOURCE_VERSION_CHANGED:"Phiên bản nguồn của tài liệu đã thay đổi",UNREGISTERED_RELATION_POLICY:"Chưa có quy tắc ghép bản ghi liên quan",MISSING_BUSINESS_IDENTITY:"Bản ghi liên quan thiếu định danh nghiệp vụ",DUPLICATE_BUSINESS_IDENTITY:"Có nhiều bản ghi cùng định danh nghiệp vụ"}),qe=Object.freeze({goithau:"Gói thầu",kehoach:"Kế hoạch lựa chọn nhà thầu",hopdong:"Hợp đồng",LEFT:"Phiên bản trái",RIGHT:"Phiên bản phải"});function Ue(t=globalThis.document){return t?.querySelector?.('meta[name="bf-version-comparison-enabled"]')?.content==="true"}function se({entityType:t,leftVersionId:e,rightVersionId:a,includeUnchanged:n=!1,relationPage:s=null}={}){const r={entityType:String(t||""),leftVersionId:String(e||""),rightVersionId:String(a||""),includeUnchanged:n===!0};return s?.path&&s?.cursor&&(r.relationPage={path:String(s.path),cursor:String(s.cursor),limit:Math.min(500,Math.max(1,Number(s.limit)||100))}),r}function oe(t){return t==null||t===""?"—":typeof t=="object"?JSON.stringify(t,null,2):String(t)}function B(t){return String(t||"").replace(/([a-zà-ỹ])([A-Z])/gu,"$1 $2").replace(/[._-]+/gu," ").replace(/\s+/gu," ").trim().toLocaleLowerCase("vi")}function le(t,e=""){const a=String(t||"").split(".").at(-1);return M[e]||M[t]||M[a]||""}function fe(t){return t==null||t===""?"—":typeof t=="boolean"?t?"Có":"Không":qe[t]||String(t)}function V(t){return Array.isArray(t)?t.length?`<ol class="version-comparison-value-list">${t.map(e=>`<li>${V(e)}</li>`).join("")}</ol>`:'<span class="version-comparison-value-empty">—</span>':t&&typeof t=="object"?`<dl class="version-comparison-value-fields">${Object.entries(t).map(([e,a])=>`<div><dt>${o(M[e]||B(e))}</dt><dd>${V(a)}</dd></div>`).join("")}</dl>`:`<span>${o(fe(t))}</span>`}function je(t){return!t||typeof t!="object"?V(t):`<div class="version-comparison-identity">${Object.entries(t).map(([e,a])=>`<span><strong>${o(M[e]||B(e))}:</strong> ${o(fe(a))}</span>`).join("")}</div>`}function ye(t={}){return`<div class="version-comparison-summary" role="status" aria-live="polite">
    <span><strong>${Number(t.added||0)}</strong> được thêm</span>
    <span><strong>${Number(t.removed||0)}</strong> bị xóa</span>
    <span><strong>${Number(t.modified||0)}</strong> bị sửa</span>
    <span><strong>${Number(t.unchanged||0)}</strong> không đổi</span>
  </div>`}function J(t=[],e="ALL"){return t.filter(a=>e==="ALL"?a?.change!=="UNCHANGED":a?.change===e).length}function Z(t=[],e="ALL"){const a=e==="ALL"?["added","removed","modified"]:[String(e||"").toLocaleLowerCase("en")];return t.reduce((n,s)=>n+a.reduce((r,y)=>r+Number(s?.summary?.[y]||0),0),0)}function ze(t={}){return`<div class="version-comparison-scope-summary">
    <p>Tổng hợp trường dữ liệu và dữ liệu liên quan.</p>
    <span><strong>${J(t.fields)}</strong> thay đổi trường dữ liệu</span>
    <span aria-hidden="true">·</span>
    <span><strong>${Z(t.relations)}</strong> thay đổi dữ liệu liên quan</span>
  </div>`}function Te(t,e){return e==="ALL"||t?.change===e}function Fe(t=[],e="ALL"){const a=t.filter(n=>Te(n,e));return a.length?`<div class="version-comparison-table-wrap"><table class="version-comparison-table">
    <thead><tr><th scope="col">Trường</th><th scope="col">Phân loại</th><th scope="col">Phiên bản trước</th><th scope="col">Phiên bản sau</th></tr></thead>
    <tbody>${a.map(n=>`<tr>
      <th scope="row">${le(n.path,n.labelKey)?`<span>${o(le(n.path,n.labelKey))}</span>`:`<span>${o(B(n.path)||"Trường dữ liệu")}</span>`}</th>
      <td><span class="version-comparison-change" data-change="${x(n.change||"")}">${o(me[n.change]||n.change||"")}</span></td>
      <td data-version-side="before"><pre>${o(oe(n.oldValue))}</pre></td>
      <td data-version-side="after"><pre>${o(oe(n.newValue))}</pre></td>
    </tr>`).join("")}</tbody>
  </table></div>`:'<p class="version-comparison-empty">Không có thay đổi trường dữ liệu trong bộ lọc hiện tại.</p>'}function Qe(t){const e=Array.isArray(t?.oldValues)?t.oldValues:[],a=Array.isArray(t?.newValues)?t.newValues:[];return`<details><summary>Xem giá trị chưa thể ghép</summary>
    <div class="version-comparison-relation-values"><div>${V(e)}</div><span aria-hidden="true">→</span><div>${V(a)}</div></div>
  </details>`}function Ye(t=[],e="ALL"){return t.length?t.map(a=>{const n=(a.changes||[]).filter(s=>Te(s,e));return`<article class="version-comparison-relation">
    <h4>${o(ve[a.path]||B(a.path)||"Dữ liệu liên quan")}</h4>
    ${ye(a.summary)}
    ${a.ambiguousMatches?.length?`<div class="version-comparison-warning"><p>${a.ambiguousMatches.length} bản ghi chưa xác định được quan hệ; hệ thống không tự đoán ghép.</p>${a.ambiguousMatches.map(Qe).join("")}</div>`:""}
    ${n.length?`<ul class="version-comparison-relation-changes">${n.map(s=>`<li>
      <span class="version-comparison-change" data-change="${x(s.change||"")}">${o(me[s.change]||s.change||"")}</span>
      ${je(s.identity)}
      <details><summary>Xem chi tiết thay đổi</summary><div class="version-comparison-relation-values"><div>${V(s.oldValue)}</div><span aria-hidden="true">→</span><div>${V(s.newValue)}</div></div></details>
    </li>`).join("")}</ul>`:'<p class="version-comparison-empty">Không có thay đổi dữ liệu liên quan trong trang này.</p>'}
    ${a.nextCursor?`<button type="button" class="btn btn-outline" data-load-relation-path="${x(a.path||"")}" data-load-relation-cursor="${x(a.nextCursor)}">Tải trang tiếp theo</button>`:""}
  </article>`}).join(""):'<p class="version-comparison-empty">Không có dữ liệu liên quan để so sánh.</p>'}function We(t=[]){return`<div class="version-comparison-impact-grid">${t.map(e=>`<article class="version-comparison-impact" data-assessment="${x(e.assessment||"")}">
    <h4>${o(Oe[e.category]||B(e.category))}</h4>
    <p><strong>${o(Ge[e.assessment]||e.assessment||"")}</strong></p>
    <p class="version-comparison-impact-reason">${o(Ke[e.reasonCode]||B(e.reasonCode))}</p>
    ${e.references?.length?`<details><summary>Nguồn đối chiếu</summary>${V(e.references)}</details>`:""}
  </article>`).join("")}</div>`}function Xe(t={},e="ALL"){const a=J(t.fields,e),n=Z(t.relations,e);return`<div class="version-comparison-tabs"></div>
    <section data-comparison-panel="overview" aria-labelledby="version-comparison-overview-heading">
      <h3 id="version-comparison-overview-heading">Tổng quan</h3>
      ${ye(t.summary)}
      ${ze(t)}
    </section>
    <section data-comparison-panel="fields" aria-labelledby="version-comparison-fields-heading" hidden>
      <h3 id="version-comparison-fields-heading">Chi tiết trường dữ liệu (${a})</h3>
      ${Fe(t.fields,e)}
    </section>
    <section data-comparison-panel="relations" aria-labelledby="version-comparison-relations-heading" hidden>
      <h3 id="version-comparison-relations-heading">Dữ liệu liên quan (${n})</h3>
      ${Ye(t.relations,e)}
    </section>
    <section data-comparison-panel="impacts" aria-labelledby="version-comparison-impacts-heading" hidden>
      <h3 id="version-comparison-impacts-heading">Phân tích tác động</h3>
      ${We(t.impacts)}
    </section>`}function Je(t,e="overview",a={},n="ALL"){const s=t?.querySelector?.(".version-comparison-tabs");if(!s)return()=>{};const r=[...t.querySelectorAll("[data-comparison-panel]")],y=g=>{r.forEach(u=>{u.hidden=u.getAttribute("data-comparison-panel")!==g}),s.querySelectorAll('[role="tab"]').forEach(u=>{const C=u.getAttribute("data-workflow-tab")===g;u.setAttribute("aria-selected",C?"true":"false"),u.setAttribute("tabindex",C?"0":"-1"),u.classList.toggle("active",C)})},L=Me(s,[{id:"overview",label:"Tổng quan",icon:"layout-dashboard"},{id:"fields",label:`Trường dữ liệu (${J(a.fields,n)})`,icon:"list-tree"},{id:"relations",label:`Dữ liệu liên quan (${Z(a.relations,n)})`,icon:"git-compare"},{id:"impacts",label:"Tác động",icon:"circle-alert"}],e,y,{groupId:"version-comparison",ariaLabel:"Các phần kết quả so sánh"});return r.forEach(g=>{const u=g.getAttribute("data-comparison-panel");g.id=`version-comparison-panel-${u}`,g.setAttribute("role","tabpanel"),g.setAttribute("aria-labelledby",`version-comparison-tab-${u}`)}),y(e),L}function Ze(t){return[...t].map((e,a)=>{const n=Number.parseInt(e.phienBan??e.label??a+1,10);return{...e,phienBan:Number.isFinite(n)?n:a+1}}).sort((e,a)=>Number(a.phienBan)-Number(e.phienBan))}function et(t,e){const a=Ze(t),n=Math.max(0,a.findIndex(r=>String(r.id)===String(e))),s=a[n]||a[0];return{left:a[n+1]||a[n-1]||a.find(r=>String(r.id)!==String(s?.id)),normalized:a,right:s}}function tt({versions:t=[],selectedId:e="",entityType:a="goithau",trigger:n=null,request:s=ce,root:r=globalThis.document}={}){if(!r?.body||t.length<2)return()=>{};ue(be),r.getElementById?.("version-comparison-modal")?.remove?.();const{left:y,normalized:L,right:g}=et(t,e),u=ie({versions:L,selectedId:y.id,rootId:"comparison-left",changeAction:"version-comparison-left",className:"version-comparison-native-select",ariaLabel:"Chọn phiên bản trước",name:"leftVersionId"}),C=ie({versions:L,selectedId:g.id,rootId:"comparison-right",changeAction:"version-comparison-right",className:"version-comparison-native-select",ariaLabel:"Chọn phiên bản sau",name:"rightVersionId"}),p=r.createElement("div");p.id="version-comparison-modal",p.className="modal-overlay active version-comparison-modal",p.innerHTML=q(`<div class="modal-card version-comparison-card" role="dialog" aria-modal="true" aria-labelledby="version-comparison-title">
    <header class="version-comparison-header">
      <div class="version-comparison-header-copy">
        <p class="version-comparison-eyebrow">DÒNG PHIÊN BẢN</p>
        <h2 id="version-comparison-title">So sánh phiên bản</h2>
        <p class="version-comparison-description">Đối chiếu dữ liệu nghiệp vụ và phạm vi tác động giữa hai snapshot.</p>
      </div>
      <button type="button" class="btn btn-outline" data-close aria-label="Đóng so sánh phiên bản">Đóng</button>
    </header>
    <form class="version-comparison-controls">
      <fieldset class="version-comparison-pair">
        <legend>Chọn mốc so sánh</legend>
        <div class="version-comparison-pair-grid">
          <label class="version-comparison-version-choice">
            <span class="version-comparison-control-label">Phiên bản trước</span>
            <span class="version-comparison-select-shell">${u}<span class="version-comparison-select-chevron" aria-hidden="true"></span></span>
            <small>Mốc gốc</small>
          </label>
          <span class="version-comparison-direction" aria-hidden="true"><span>so với</span><b>→</b></span>
          <label class="version-comparison-version-choice">
            <span class="version-comparison-control-label">Phiên bản sau</span>
            <span class="version-comparison-select-shell">${C}<span class="version-comparison-select-chevron" aria-hidden="true"></span></span>
            <small>Mốc đối chiếu</small>
          </label>
        </div>
      </fieldset>
      <div class="version-comparison-settings">
        <label class="version-comparison-filter">
          <span class="version-comparison-control-label">Loại thay đổi</span>
          <span class="version-comparison-select-shell"><select class="version-comparison-native-select" name="changeFilter">
            <option value="ALL">Tất cả thay đổi</option>
            <option value="ADDED">Được thêm</option>
            <option value="REMOVED">Bị xóa</option>
            <option value="MODIFIED">Bị sửa</option>
            <option value="UNCHANGED">Không thay đổi</option>
          </select><span class="version-comparison-select-chevron" aria-hidden="true"></span></span>
        </label>
        <label class="version-comparison-checkbox"><input type="checkbox" name="includeUnchanged"><span>Hiện trường không đổi</span></label>
        <button type="submit" class="btn btn-primary version-comparison-submit">So sánh</button>
      </div>
    </form>
    <p class="version-comparison-live" role="status" aria-live="polite"></p>
    <div class="version-comparison-result"></div>
  </div>`),p.querySelectorAll(".version-comparison-controls select").forEach(f=>{f.setAttribute("data-no-custom","true")}),r.body.append(p),he(p,n);const v=p.querySelector("form"),l=p.querySelector(".version-comparison-live"),$=p.querySelector(".version-comparison-result"),h=v.elements.leftVersionId,c=v.elements.rightVersionId;let T={left:h.value,right:c.value},A=null,k=null,d=null,E=0,N=()=>{};const i=()=>$.querySelector?.('[role="tab"][aria-selected="true"]')?.getAttribute("data-workflow-tab")||"overview",D=(f=i())=>{N(),$.innerHTML=q(Xe(d,v.elements.changeFilter.value)),N=Je($,f,d,v.elements.changeFilter.value)},m=()=>{E+=1,A?.abort?.(),N(),de(p),p.remove()};p.querySelector("[data-close]").addEventListener("click",m),p.addEventListener("click",f=>{f.target===p&&m()});const w=async()=>{if(h.value===c.value){l.textContent="Hãy chọn hai phiên bản khác nhau để so sánh.",l.setAttribute("role","alert");return}A?.abort?.(),A=new AbortController;const f=++E;l.textContent="Đang so sánh hai snapshot…",l.setAttribute("role","status"),$.replaceChildren();const I=se({entityType:a,leftVersionId:v.elements.leftVersionId.value,rightVersionId:v.elements.rightVersionId.value,includeUnchanged:v.elements.includeUnchanged.checked});k=I;try{const P=await s("/api/version-comparisons/query",I,{signal:A.signal,retries:0});if(f!==E)return;l.textContent="Đã cập nhật kết quả so sánh.",d=P,D("overview")}catch(P){if(P?.name==="AbortError"||f!==E)return;l.textContent=P?.message||"Không thể so sánh phiên bản.",l.setAttribute("role","alert")}},S=async f=>{if(!d||!k)return;const I=f.getAttribute("data-load-relation-path"),P=f.getAttribute("data-load-relation-cursor");if(!I||!P)return;A?.abort?.(),A=new AbortController;const ee=++E;f.disabled=!0;const te=ve[I]||B(I)||"dữ liệu liên quan";l.textContent=`Đang tải trang tiếp theo của ${te}…`,l.setAttribute("role","status");try{const O=await s("/api/version-comparisons/query",se({...k,relationPage:{path:I,cursor:P,limit:100}}),{signal:A.signal,retries:0});if(ee!==E)return;const j=(O.relations||[]).find(z=>z.path===I),K=(d.relations||[]).find(z=>z.path===I);if(!j||!K)throw new Error("Trang dữ liệu liên quan không hợp lệ.");K.changes=[...K.changes||[],...j.changes||[]],K.nextCursor=j.nextCursor||null,D("relations"),l.textContent=`Đã tải thêm ${te}.`}catch(O){if(O?.name==="AbortError"||ee!==E)return;f.disabled=!1,l.textContent=O?.message||"Không thể tải trang dữ liệu liên quan tiếp theo.",l.setAttribute("role","alert")}};v.addEventListener("submit",f=>{f.preventDefault(),w()});const G=f=>{if(h.value===c.value){const I=f==="left"?c:h;I.value=f==="left"?T.left:T.right,I.__bfAccessibleCombobox?.refresh?.()}T={left:h.value,right:c.value}};return h.addEventListener("change",()=>G("left")),c.addEventListener("change",()=>G("right")),v.elements.changeFilter.addEventListener("change",()=>{d&&D()}),$.addEventListener("click",f=>{const I=f.target.closest?.("[data-load-relation-cursor]");I&&S(I)}),w(),m}function at(t,e,a=globalThis.document){if(!t||!Ue(a)||e?.versions?.length<2)return()=>{};ue(be);const n=a.createElement("button");return n.type="button",n.id="btn-version-comparison",n.className="btn btn-outline",n.textContent="So sánh phiên bản",n.addEventListener("click",()=>tt({versions:e.versions,selectedId:e.selectedId||e.packageId,entityType:e.entityType||"goithau",trigger:n,root:a})),t.append(n),()=>n.remove()}var nt=Object.freeze({RESOLVED:"Đã xác định",AMBIGUOUS:"Có nhiều hồ sơ phù hợp",UNRESOLVED:"Chưa xác định",MANUAL_REVIEW_REQUIRED:"Cần rà soát thủ công"});function it(t=globalThis.document){return t?.querySelector?.('meta[name="bf-legal-versioning-enabled"]')?.content==="true"}function b(t,e="",a=""){const n=document.createElement(t);return e&&(n.className=e),a!==""&&(n.textContent=String(a)),n}function st(t){if(t.querySelector('link[data-legal-binding-styles="true"]'))return;const e=t.createElement("link");e.rel="stylesheet",e.href="/frontend/legal-versioning/LegalBindingPanel.css",e.dataset.legalBindingStyles="true",t.head.appendChild(e)}function R(t,e){return[b("dt","",t),b("dd","",e||"—")]}function ot(t){try{const e=new URL(String(t||""),globalThis.location?.origin);return["http:","https:"].includes(e.protocol)?e.href:""}catch{return""}}function re(t,e){t.replaceChildren();const a=b("span","legal-binding-status",nt[e.status]||e.status||"Chưa xác định");a.dataset.status=e.status||"UNRESOLVED";const n=b("dl");n.append(...R("Lý do",e.reason),...R("Ngày neo",e.anchorDate),...R("Nguồn ngày neo",e.anchorSource),...R("Phiên bản profile",e.profileVersionId),...R("Binding revision",e.bindingRevision),...R("Target rowVersion",e.targetRowVersion)),t.append(a,n)}function lt(t,e){t.replaceChildren(),(e.sources||[]).forEach(a=>{const n=b("article","legal-binding-source");n.append(b("h3","",`${a.documentType} ${a.documentNumber}`),b("p","",a.title),b("p","",`Hiệu lực: ${a.effectiveFrom}${a.effectiveTo?` – ${a.effectiveTo}`:" trở đi"}`),b("code","",`SHA-256: ${a.contentSha256}`));const s=ot(a.sourceUri);if(s){const r=b("a","","Mở nguồn chính thức");r.href=s,r.target="_blank",r.rel="noopener noreferrer",n.appendChild(r)}else n.appendChild(b("p","","Nguồn liên kết không hợp lệ"));t.appendChild(n)})}function rt({targetType:t,targetId:e,targetRowVersion:a,canResolve:n=!1,trigger:s=null,root:r=document,read:y=$e,write:L=ce}={}){if(!r?.body||!e)return()=>{};st(r),r.getElementById("legal-binding-modal")?.remove();const g=b("div","modal-overlay active legal-binding-modal");g.id="legal-binding-modal";const u=b("div","modal-card legal-binding-card");u.setAttribute("role","dialog"),u.setAttribute("aria-modal","true"),u.setAttribute("aria-labelledby","legal-binding-title");const C=b("header","legal-binding-header"),p=b("div");p.append(b("p","legal-binding-eyebrow","PHIÊN BẢN PHÁP LÝ"),b("h2","","Ràng buộc pháp lý lịch sử")),p.querySelector("h2").id="legal-binding-title";const v=b("button","btn btn-outline","Đóng");v.type="button",v.setAttribute("data-close",""),C.append(p,v);const l=b("p","legal-binding-live","Đang tải binding…");l.setAttribute("role","status"),l.setAttribute("aria-live","polite");const $=b("section","legal-binding-summary"),h=b("div","legal-binding-actions"),c=b("button","btn btn-outline","Xem nguồn chính xác");c.type="button",c.hidden=!0;const T=b("button","btn btn-primary","Resolve và ghi binding");T.type="button",T.hidden=!n;const A=b("button","btn btn-outline","Hỏi trợ lý về tuân thủ");A.type="button",A.addEventListener("click",()=>{globalThis.dispatchEvent(new CustomEvent("bf:assistant-target",{detail:{targetType:t==="package"?"goithau":"kehoach",targetId:e,versionId:e}}))}),h.append(c,T,A);const k=b("section","legal-binding-sources");u.append(C,l,$,h,k),g.appendChild(u),r.body.appendChild(g),he(g,s);let d=null,E=!1;const N=`/api/legal-versioning/${encodeURIComponent(t)}/${encodeURIComponent(e)}/binding`,i=async()=>{try{if(d=await y(N,{retries:0}),E)return;re($,d),c.hidden=!d.profileVersionId,l.textContent="Đã tải binding pháp lý hiện hành của phiên bản này."}catch(m){if(E)return;l.textContent=m?.message||"Không thể tải binding pháp lý.",l.setAttribute("role","alert")}};c.addEventListener("click",async()=>{if(d?.profileVersionId){c.disabled=!0,l.textContent="Đang kiểm tra hash và tải nguồn chính xác…";try{const m=await y(`/api/legal-versioning/profiles/${encodeURIComponent(d.profileVersionId)}/sources`,{retries:0});E||(lt(k,m),l.textContent=`Đã tải ${m.sources?.length||0} nguồn pháp lý.`)}catch(m){l.textContent=m?.message||"Không thể tải nguồn pháp lý."}finally{c.disabled=!1}}}),T.addEventListener("click",async()=>{T.disabled=!0,l.textContent="Đang resolve theo facts của đúng phiên bản…";try{d=await L(`${N}/resolve`,{expectedBindingRevision:Number(d?.bindingRevision||0),expectedTargetRowVersion:Number(a||1)}),E||(re($,d),c.hidden=!d.profileVersionId,l.textContent="Đã ghi binding bất biến mới.")}catch(m){l.textContent=m?.status===409?"Facts hoặc binding đã thay đổi. Hãy đóng và tải lại phiên bản.":m?.message||"Không thể resolve binding.",l.setAttribute("role","alert")}finally{T.disabled=!1}});const D=()=>{E=!0,de(g),g.remove()};return v.addEventListener("click",D),g.addEventListener("click",m=>{m.target===g&&D()}),i(),D}function ct(t,e={},a=document){if(!t||!it(a))return()=>{};const n=b("button","btn btn-outline","Pháp lý");return n.type="button",n.addEventListener("click",()=>rt({...e,trigger:n,root:a})),t.appendChild(n),()=>n.remove()}async function St(){const t=Le("kehoach","kehoach"),e=document.getElementById("kehoach-table").querySelector("tbody"),a=document.getElementById("search-kehoach").value.toLowerCase(),n=document.getElementById("filter-kehoach-nam"),s=document.getElementById("filter-kehoach-thang"),r=this.model.state.kehoach||[];n&&s&&(Ne({records:r,getDate:h=>h.ngayPheDuyet,yearSelect:n,monthSelect:s}),Y("filter-kehoach-nam"),Y("filter-kehoach-thang"));const y=n?n.value:"",L=s?s.value:"";let g=[],u=0;const C=this.model.currentPage.kehoach||1,p=this.model.pageSize||10,v=this.model.sortState.kehoach||{},l=v.field||"",$=v.order||"asc";if(this.model.useServerSidePagination){const h={page:C,pageSize:p,search:a,sortBy:l,sortOrder:$,nam:y,thang:L};Ie(this.model,"kehoach",h)||Be(e,10);try{const c=await ge(this.model,"kehoach",h,{cancellationOwner:"ui:plan-list"});g=c.items,u=c.totalItems,t.dataComplete(c)}catch(c){if(c?.name==="AbortError")return;console.error("Failed to fetch paginated plans",c),ne(e),He(e,{colspan:10,message:"Không thể tải danh sách kế hoạch. Vui lòng thử lại.",onRetry:()=>this.renderKeHoachTable()});return}}else{const h=this.model.getFilteredKeHoach().filter(c=>(c.maKeHoach.toLowerCase().includes(a)||c.tenKeHoach.toLowerCase().includes(a)||c.tenDuAnDuToan&&c.tenDuAnDuToan.toLowerCase().includes(a))&&ke(c.ngayPheDuyet,y,L));Se(h,l,$),u=h.length,g=De(h,C,p),t.dataComplete({cacheHit:!0,localSnapshot:!0})}if(u===0)ne(e),we(e,{colspan:10,message:"Không tìm thấy Kế hoạch lựa chọn nhà thầu nào phù hợp",icon:"file-warning",pagination:document.getElementById("kehoach-pagination")});else{const h=o;Pe(e,g,c=>{const T=U(c),A=pe(c.allVersions||this.model.state.kehoach.filter(S=>U(S)===T));this.model.state.selectedPlanVersion||(this.model.state.selectedPlanVersion={});const k=this.model.state.selectedPlanVersion[T]||A[0]?.id||c.id,d=this.model.state.kehoach.find(S=>S.id===k)||c,E=this.model.state.chudautu.find(S=>S.id===d.chuDauTuId),N=A.map(S=>{const G=Q(S.phienBan),f=S.id===d.id?"selected":"";return`<option value="${h(S.id)}" ${f}>${h(G)}</option>`}).join(""),i=`
                <select class="form-control version-droplist bf-s-b41ce2ea44" data-bf-change="change-plan-version" data-root="${h(T)}" aria-label="Chọn phiên bản kế hoạch ${h(d.maKeHoach||d.tenKeHoach||"")}">
                    ${N}
                </select>
            `,D=d.id===c.id,m=Ve({id:d.id,editCommand:"edit-plan",deleteCommand:"delete-plan",allowDelete:this.model.state.activerole!=="employee"});D||m.shift();const w=xe(m);return`
                <tr>
                    <td>
                        <div class="bf-s-8c8dc52ed7">
                            <a href="#" data-bf-action="show-plan" data-id="${h(d.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d"><span class="detail-code bf-s-dc5de304c3">${this.model.getPlanBaseCode(d.maKeHoach)?h(this.model.getPlanBaseCode(d.maKeHoach)):'<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                            <span class="bf-s-db1d8f859f">-</span>
                            ${i}
                        </div>
                    </td>
                    <td class="fw-bold text-wrap bf-s-861d2aedee">${h(d.tenKeHoach)}</td>
                    <td>${d.loaiHinhMuaSam?`<span class="badge ${d.loaiHinhMuaSam==="Dự án"?"badge-info":"badge-warning"}">${h(d.loaiHinhMuaSam)}</span>`:'<span class="text-muted">--</span>'}</td>
                    <td class="text-muted text-wrap bf-s-0569d2208a">${h(d.tenDuAnDuToan||"--")}</td>
                    <td class="text-wrap bf-s-3ce088a59b">${E?h(E.tenChuDauTu):'<span class="text-danger">Không rõ</span>'}</td>
                    <td class="text-blue fw-bold">${_(d.tongMucDauTu)}</td>
                    <td>${H(d.ngayPheDuyet)}</td>
                    <td>${h(d.quyetDinhPheDuyet)}</td>
                    <td><span class="fw-bold text-muted">${d.thoiGianDangMa?this.model.formatDateWithTime(d.thoiGianDangMa):"--"}</span></td>
                    <td class="text-right">
                        ${w}
                    </td>
                </tr>
            `},{colSpan:10,rowHeight:82,onRender:()=>lucide.createIcons({root:e})}),X("renderTablePagination","kehoach-pagination",u,C,p)}return W(e,lucide),W(document.getElementById("kehoach-pagination"),lucide),this.enhanceTableHeaders("kehoach-table","kehoach"),{performance:t.complete()}}function It(t,e=!1){let a=t;if(!e){const s=this.model.getLatestPlan(t);s&&(a=s.id)}t=a;const n=document.getElementById("tab-kehoach-detail");if(!n||!n.classList.contains("active")){X("switchTab","kehoach-detail",t);return}this.model.state.kehoach.find(s=>s.id===t)&&this.renderPlanVersionDetails(t)}async function dt(t){if(!t)return[];const e=200;let a=null;const n=[];do{const s=await ge(this.model,"goithau",{pagination:"cursor",cursor:a||"",pageSize:e,keHoachId:t}),r=s.items;if(n.push(...r),a=s.nextCursor,!s.hasMore||r.length===0)break}while(a);return n}async function kt(t){const e=this.model.state.kehoach.find(i=>i.id===t);if(!e)return;await Ae(Ee(),"kehoach",e);const a=document.getElementById("btn-edit-kehoach-fullpage");if(a){const i=this.model.getLatestPlan(t);i&&i.id===t?(ae(a,"display","flex"),a.onclick=()=>{X("editKeHoach",t)}):ae(a,"display","none")}const n=U(e),s=pe(this.model.state.kehoach.filter(i=>U(i)===n)).reverse(),r=this.model.state.chudautu.find(i=>i.id===e.chuDauTuId);let y=this.model.getLatestPackagesForPlan(e.id);this.model.useServerSidePagination&&y.length===0&&(await dt.call(this,e.id),y=this.model.getLatestPackagesForPlan(e.id));const L=[],g=new Set,u=new Set,C=new Set;y.forEach(i=>{const D=i.rootId,m=i.maGoiThau?i.maGoiThau.trim().toLowerCase():"",w=i.tenGoiThau?i.tenGoiThau.trim().toLowerCase():"";let S=!1;D&&g.has(D)&&(S=!0),m&&m!=="(chưa nhập)"&&u.has(m)&&(S=!0),w&&C.has(w)&&(S=!0),S||(D&&g.add(D),m&&m!=="(chưa nhập)"&&u.add(m),w&&C.add(w),L.push(i))});const p=e.cvDaThucHienList||[],v=e.cvKhongApDungList||[],l=e.cvChuaDuDieuKienList||[];let $="";p.length>0&&($=`
            <div class="detail-sub-section bf-s-2e21a57cf0">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">I. Phần công việc đã thực hiện</h5>
                <div class="phanlo-table-wrap bf-s-d49e7f30b4">
                    <table class="phanlo-table bf-s-a2e921d929" data-row-pagination="true" aria-label="Danh sách gói thầu trong kế hoạch">
                        <thead>
                            <tr class="bf-s-b2b45352a8">
                                <th class="bf-s-c3fc104bea">Tên phần công việc</th>
                                <th class="bf-s-c7351276e7">Giá trị (VND)</th>
                                <th class="bf-s-369f705937">Đơn vị thực hiện</th>
                                <th class="bf-s-369f705937">Văn bản phê duyệt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${p.map(i=>`
                                <tr class="bf-s-ddc4ced4b2">
                                    <td class="bf-s-8cebed82f0">${o(i.tenCongViec)}</td>
                                    <td class="bf-s-c1b2008170">${_(i.giaTri)}</td>
                                    <td class="bf-s-8e0dc07fff">${o(i.donViThucHien||"--")}</td>
                                    <td class="bf-s-8e0dc07fff">${o(i.vanBanPheDuyet||"--")}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let h="";v.length>0&&(h=`
            <div class="detail-sub-section bf-s-93688d4ac4">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">II. Phần công việc không áp dụng được hình thức LCNT</h5>
                <div class="phanlo-table-wrap bf-s-d49e7f30b4">
                    <table class="phanlo-table bf-s-a2e921d929" data-row-pagination="true" aria-label="Danh sách phần công việc">
                        <thead>
                            <tr class="bf-s-b2b45352a8">
                                <th class="bf-s-c3fc104bea">Tên phần công việc</th>
                                <th class="bf-s-c7351276e7">Giá trị (VND)</th>
                                <th class="bf-s-e8c0087267">Đơn vị thực hiện</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${v.map(i=>`
                                <tr class="bf-s-ddc4ced4b2">
                                    <td class="bf-s-8cebed82f0">${o(i.tenCongViec)}</td>
                                    <td class="bf-s-c1b2008170">${_(i.giaTri)}</td>
                                    <td class="bf-s-8e0dc07fff">${o(i.donViThucHien||"--")}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let c="";l.length>0&&(c=`
            <div class="detail-sub-section bf-s-93688d4ac4">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">III. Phần công việc chưa đủ điều kiện lập kế hoạch LCNT</h5>
                <div class="phanlo-table-wrap bf-s-d49e7f30b4">
                    <table class="phanlo-table bf-s-a2e921d929" data-row-pagination="true" aria-label="Danh sách dự phòng kế hoạch">
                        <thead>
                            <tr class="bf-s-b2b45352a8">
                                <th class="bf-s-c3fc104bea">Tên phần công việc</th>
                                <th class="bf-s-c7351276e7">Giá trị (VND)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${l.map(i=>`
                                <tr class="bf-s-ddc4ced4b2">
                                    <td class="bf-s-8cebed82f0">${o(i.tenCongViec)}</td>
                                    <td class="bf-s-c1b2008170">${_(i.giaTri)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `);let T="";e.pheDuyet==="Kế hoạch"?T=`
            <div class="detail-item">
                <div class="detail-label">Số tờ trình dự toán</div>
                <div class="detail-value">${o(e.soToTrinhDuToan||"--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày trình dự toán</div>
                <div class="detail-value">${H(e.ngayTrinhDuToan)||"--"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày phê duyệt dự toán</div>
                <div class="detail-value">${H(e.ngayPheDuyetDuToan)||"--"}</div>
            </div>
            <div class="detail-item bf-s-6d00fde401">
                <div class="detail-label">Số QĐ phê duyệt dự toán</div>
                <div class="detail-value">${o(e.soQdPheDuyetDuToan||"--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Số tờ trình kế hoạch</div>
                <div class="detail-value">${o(e.soToTrinhKeHoach||"--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày trình kế hoạch</div>
                <div class="detail-value">${H(e.ngayTrinhKeHoach)||"--"}</div>
            </div>
        `:e.pheDuyet==="Dự toán và kế hoạch"&&(T=`
            <div class="detail-item">
                <div class="detail-label">Số tờ trình dự toán và kế hoạch</div>
                <div class="detail-value">${o(e.soToTrinhDuToanKeHoach||"--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày trình dự toán và kế hoạch</div>
                <div class="detail-value">${H(e.ngayTrinhKeHoach)||"--"}</div>
            </div>
        `);let A="";e.loaiHinhMuaSam==="Dự án"&&(A=`
            <div class="detail-item bf-s-6d00fde401">
                <div class="detail-label">Mã dự án</div>
                <div class="detail-value">${o(e.maDuan||"--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Số QĐ phê duyệt dự án</div>
                <div class="detail-value">${o(e.soQdPheDuyetDuAn||"--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày QĐ phê duyệt dự án</div>
                <div class="detail-value">${H(e.ngayQdPheDuyetDuAn)||"--"}</div>
            </div>
            <div class="detail-item bf-s-6d00fde401">
                <div class="detail-label">Cơ quan phê duyệt dự án</div>
                <div class="detail-value">${o(e.coQuanPheDuyetDuAn||"--")}</div>
            </div>
        `);const k=Array.isArray(e.canCuLapKeHoachList)?e.canCuLapKeHoachList:[],d=`
    <div class="detail-sub-section">
      <h5 class="detail-sub-title">Căn cứ lập kế hoạch (${k.length})</h5>
      <div class="associated-list">
        ${k.length?k.map((i,D)=>`
          <article class="associated-item plan-basis-detail-item">
            <div>
              <strong>${D+1}. ${o(i.tenCanCu||"Chưa tách được tên căn cứ")}</strong>
              <p>${o(i.noiDungGoc||"")}</p>
              <small class="text-muted">Tên văn bản: ${o(i.tenVanBan||"--")} · Số: ${o(i.soVanBan||"--")} · Ngày: ${o(i.ngayBanHanh||"--")} · Đơn vị ban hành: ${o(i.donViBanHanh||"--")} · Trích yếu: ${o(i.trichYeu||"--")}</small>
            </div>
            <span class="badge ${i.parseStatus==="PARSED"?"badge-success":"badge-warning"}">${o(i.parseStatus||"UNPARSED")}</span>
          </article>
        `).join(""):'<div class="text-muted"><small>Kế hoạch chưa có căn cứ.</small></div>'}
      </div>
    </div>`,E=`
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code bf-s-4ec19854c0">${this.model.getPlanBaseCode(e.maKeHoach)?o(this.model.getPlanBaseCode(e.maKeHoach)):'<span class="text-muted">(Chưa nhập)</span>'}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        <select id="fullpage-kh-version-select" class="page-version-select" data-dropdown-fit-content="true" ${s.length<2?"disabled":""}>
                            ${s.map(i=>`<option value="${x(i.id)}" ${i.id===t?"selected":""}>${o(Q(i.phienBan))}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${o(e.tenKeHoach)}</h4>
                <div id="fullpage-kh-version-actions"></div>
            </div>

            <div class="detail-grid">
                <div class="detail-item bf-s-6d00fde401">
                    <div class="detail-label">Tên Dự án / Dự toán</div>
                    <div class="detail-value text-blue bf-s-fb9381027e">${o(e.tenDuAnDuToan||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Hình thức</div>
                    <div class="detail-value">${e.loaiHinhMuaSam?`<span class="badge ${e.loaiHinhMuaSam==="Dự án"?"badge-info":"badge-warning"}">${o(e.loaiHinhMuaSam)}</span>`:'<span class="text-muted">Chưa xác định</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phê duyệt</div>
                    <div class="detail-value">${e.pheDuyet?`<span class="badge ${e.pheDuyet==="Kế hoạch"?"badge-info":"badge-success"}">${o(e.pheDuyet)}</span>`:'<span class="text-muted">--</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Đơn vị trình của chủ đầu tư</div>
                    <div class="detail-value">${o(e.donViTrinhCdt||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt đơn vị trình</div>
                    <div class="detail-value">${o(e.tenVietTatDonViTrinh||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tổng Giá Trị Kế Hoạch</div>
                    <div class="detail-value text-blue bf-s-61f44adbb8">${_(e.tongMucDauTu)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian đăng mã kế hoạch</div>
                    <div class="detail-value">${e.thoiGianDangMa?this.model.formatDateWithTime(e.thoiGianDangMa):"--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số QĐ phê duyệt</div>
                    <div class="detail-value">${o(e.quyetDinhPheDuyet||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày QĐ phê duyệt</div>
                    <div class="detail-value">${H(e.ngayPheDuyet)}</div>
                </div>
                ${T}
                ${A}
            </div>

            <div class="detail-sub-section">
                <h5 class="detail-sub-title">Thông tin Chủ đầu tư</h5>
                ${r?`
                    <div class="associated-item">
                        <div>
                            <strong class="bf-s-a91dac6c9e">${o(r.tenChuDauTu)}</strong><br>
                            <small class="text-muted">Mã số thuế: ${o(r.maSoThue||"--")} | Địa chỉ: ${o((r.diaChi||"").replace(/\s*\|\s*/g,", "))}</small>
                        </div>
                        <span class="associated-badge partner-identity-code">${o(Ce(r.maChuDauTu,"--"))}</span>
                    </div>
                `:'<div class="text-muted"><small>Không tìm thấy thông tin chủ đầu tư.</small></div>'}
            </div>

            ${d}

            ${$}
            ${h}
            ${c}

            <div class="detail-sub-section bf-s-93688d4ac4">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">IV. Phần công việc thuộc kế hoạch lựa chọn nhà thầu (Các gói thầu - ${L.length})</h5>
                <div class="associated-list">
                    ${L.length>0?L.map(i=>`
                        <div class="associated-item bf-s-ecfbb78629" data-bf-action="show-package-snapshot" data-id="${x(i.id)}" title="Xem snapshot gói thầu tại phiên bản kế hoạch này">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue bf-s-0f88141c20"></i>
                                <span><strong>${o(i.maGoiThau||"--")}</strong> - ${o(i.tenGoiThau||"--")}${i.isRebid?' <span class="badge badge-warning">Đấu thầu lại</span>':""}</span>
                            </div>
                            <span class="badge badge-success">${_(i.giaGoiThau)}</span>
                        </div>
                    `).join(""):'<div class="text-muted"><small>Phiên bản kế hoạch này hiện chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;document.getElementById("fullpage-kehoach-content").innerHTML=q(E);const N=document.getElementById("fullpage-kh-version-select");N&&(N.onchange=i=>{this.renderPlanVersionDetails(i.target.value)},Y("fullpage-kh-version-select")),at(document.getElementById("fullpage-kh-version-actions"),{entityType:"kehoach",selectedId:t,versions:s.map(i=>({id:i.id,label:Q(i.phienBan)}))}),ct(document.getElementById("fullpage-kh-version-actions"),{targetType:"plan",targetId:t,targetRowVersion:e.rowVersion||1,canResolve:this.model.state.activerole==="super_admin"}),W(document.getElementById("fullpage-kehoach-content"),lucide)}export{at as n,Me as r,St as renderKeHoachTable,kt as renderPlanVersionDetails,It as showKeHoachDetails,ct as t};
