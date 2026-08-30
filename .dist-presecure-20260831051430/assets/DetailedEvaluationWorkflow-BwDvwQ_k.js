const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/app-BHg72QWe.css"])))=>i.map(i=>d[i]);
import{r as M}from"./runtimeStyles-DWYSnTnQ.js";import{n as i}from"./view_helpers-CdPIbaii.js";import{ct as z,t as $}from"./app-RPlYyKwL.js";import{l as gt}from"./lotEvaluationScope-CB0bwEDI.js";import{a as bt,i as ft}from"./bidEvaluationLowPriceRules-CAgsJS5M.js";import{a as $t,r as yt}from"./technicalEvaluationMethod-BTCDObLP.js";import{a as Et,s as kt}from"./PackageTabs-eENmioVZ.js";import{n as Tt}from"./BidEvaluationProgressView-c8njqYha.js";import"./bidderGoodsSelectors-BFBU6Jqx.js";import{d as wt,f as Dt,i as ha,l as xt,n as ma,s as R,t as va,u as Ct}from"./DetailedEvaluationState-BT-sLqLq.js";import{a as ga,i as St,o as ba,r as _t,s as Nt,t as Ht}from"./DetailedEvaluationCriteriaController-C96RYwTb.js";var U=Object.freeze({validity:"Tính hợp lệ",capacity:"Năng lực và kinh nghiệm",technical:"Kỹ thuật",financial:"Tài chính",bidder_goods:"Danh mục hàng hóa dự thầu"}),F=25,Kt=Object.freeze({single:"Vòng đánh giá chung",technical:"Vòng kỹ thuật",financial:"Vòng tài chính"}),Mt=Object.freeze({pass_fail:"Kỹ thuật: Đạt/Không đạt",score:"Kỹ thuật: Chấm điểm"});function Q(t){return t.map(a=>String(a||"").trim()).filter(Boolean).join(" — ")}function Rt(t,a,e){if(t?.phanLo!=="Có")return"Không phân lô";const l=gt(t,e);return l?.selectedLots?.length?l.selectedLots.map(n=>Q([n.code,n.name])).join(", "):Q([a?.maPhanLo||a?.ma_phan_lo,a?.tenPhanLo||a?.ten_phan_lo])||"Toàn bộ phần lô"}function Lt({pkg:t=null,selectedBid:a=null,lotScope:e=null,roundType:l="single",context:n={},activeGroup:o="validity",status:c="Chưa đánh giá"}={}){const d=Mt[n?.technicalEvaluationMethod];return[{key:"package",label:"Gói thầu",value:Q([t?.maGoiThau,t?.tenGoiThau])||"Chưa xác định"},{key:"lot",label:"Phần lô",value:Rt(t,a,e)},{key:"contractor",label:"Nhà thầu/HSDT",value:String(a?.label||a?.tenNhaThau||"").trim()||"Chưa chọn hồ sơ dự thầu"},{key:"round",label:"Vòng",value:Kt[l]||String(l||"").trim()||"Chưa xác định"},{key:"group",label:"Nhóm",value:U[o]||String(o||"").trim()||"Chưa xác định"},{key:"method",label:"Phương pháp",value:d||String(t?.phuongPhapDanhGia||t?.phuongThucLuaChon||"").trim()||"Chưa cấu hình"},{key:"status",label:"Trạng thái",value:String(c||"").trim()||"Chưa đánh giá"}]}function qt(t=[]){return`
    <aside class="detailed-evaluation-sticky-context" aria-label="Ngữ cảnh đánh giá đang hiển thị">
      <dl class="detailed-evaluation-context-list">
        ${t.map(({key:a,label:e,value:l})=>`
          <div class="detailed-evaluation-context-item" data-context-key="${i(a)}">
            <dt>${i(e)}</dt>
            <dd>${i(l)}</dd>
          </div>`).join("")}
      </dl>
    </aside>`}function Pt({pkg:t,bid:a}={}){if(!ft(t,a))return"";const e=bt(a?.chapThuanGiaDeNghiTrungThauDuoi50);return`
    <div class="detailed-evaluation-metric detailed-evaluation-low-price-decision">
      <span class="detailed-evaluation-metric-label">Xử lý giá đề nghị trúng thầu dưới 50%</span>
      <strong class="badge ${e===!0?"badge-success":e===!1?"badge-danger":"badge-warning"}">${i(e===!0?"Chấp thuận":e===!1?"Không chấp thuận":"Chưa quyết định")}</strong>
    </div>`}function At(t={},a){const e=t.templateSource||"14A",l=e==="14D",n={validity:{number:"Mẫu số 01",title:"ĐÁNH GIÁ TÍNH HỢP LỆ",columns:["STT","Nội dung đánh giá trong E-HSMT","Kết quả đánh giá tự động từ Hệ thống","Kết quả của chuyên gia","Điểm","Nhận xét của chuyên gia (nếu có)"]},capacity:{number:"Mẫu số 02",title:"ĐÁNH GIÁ VỀ NĂNG LỰC VÀ KINH NGHIỆM",columns:["STT","Các tiêu chí năng lực và kinh nghiệm trong E-HSMT","Thông tin trong E-HSDT","Kết quả của chuyên gia","Điểm","Nhận xét của chuyên gia (nếu có)"]},technical:{number:l?"Mẫu số 02":"Mẫu số 03A/03B",title:"ĐÁNH GIÁ VỀ KỸ THUẬT",subtitle:l?"(Sử dụng phương pháp chấm điểm)":"(Theo phương pháp đánh giá trong E-HSMT)",columns:["STT","Nội dung đánh giá","Mức điểm quy định trong E-HSMT","Kết quả đánh giá của chuyên gia","Điểm đánh giá","Nhận xét của chuyên gia"]},financial:{number:l?"Mẫu số 02/02B":e==="14C"?"Mẫu số 06A/06B/06C":"Mẫu số 07A/07B",title:"TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ VỀ TÀI CHÍNH",columns:["STT","Nội dung","Giá trị"]}};return n[a]||n.validity}function Bt(t){return[["pending","Chưa đánh giá"],["pass","Đạt"],["fail","Không đạt"],["not_applicable","Không áp dụng"]].map(([a,e])=>`<option value="${a}" ${t===a?"selected":""}>${e}</option>`).join("")}function It(t,a,e){const l=e?"disabled":"",n=i(t.name||t.code||"Tiêu chí");if(t.resultType==="text")return`<textarea class="form-control" data-detailed-field="nhanXet" aria-label="Kết quả ${n}" ${l}>${i(a.nhanXet||"")}</textarea>`;if(t.resultType==="number")return`<input type="number" min="0" class="form-control" data-detailed-field="diem" aria-label="Giá trị ${n}" value="${i(a.diem??"")}" ${l}>`;const o=t.resultType==="score"?`<input type="number" min="0" ${t.maxScore!=null?`max="${i(t.maxScore)}"`:""} class="form-control" data-detailed-field="diem" aria-label="Điểm ${n}" value="${i(a.diem??"")}" ${l} placeholder="Điểm">`:"";return`<select class="form-control" data-detailed-field="ketQua" aria-label="Kết quả ${n}" ${l}>${Bt(a.ketQua||"pending")}</select>${o}`}function w({field:t,value:a,selected:e,label:l,disabled:n}){return`
    <label class="detailed-evaluation-mark" title="${i(l)}">
      <input type="checkbox"
        data-detailed-field="${t}"
        data-detailed-result-value="${a}"
        aria-label="${i(l)}"
        ${e===a?"checked":""}
        ${n?"disabled":""}>
      <span class="detailed-evaluation-mark-symbol" aria-hidden="true"></span>
    </label>`}function b({field:t,value:a,selected:e,label:l}){const n=e===a;return`<span class="detailed-evaluation-derived-mark ${n?"is-marked":""}"
    role="img"
    data-detailed-derived-field="${t}"
    data-detailed-derived-value="${a}"
    data-detailed-derived-label="${i(l)}"
    aria-label="${i(l)}: ${n?"có":"không"}"
    title="Kết quả tự tính từ các tiêu chí con">${n?"x":"-"}</span>`}function G(t){return`<span class="badge ${t==="Đạt"?"badge-success":t==="Không đạt"?"badge-danger":"badge-warning"}" data-detailed-conclusion-badge>${i(t||"Chưa kết luận")}</span>`}function Qt({activeGroup:t="validity",criteria:a=[],report:e=null}={}){if(t==="financial")return"";const l=t==="validity"||t==="capacity",n=wt({report:e||{},criteria:a,group:t}),o=n.status||e?.extension?.groupResults?.[t]||"";if(l){const d=Dt({report:e||{},criteria:a,group:t}),r=d==="Đạt"?"pass":d==="Không đạt"?"fail":"pending",u=o==="Đạt"?"pass":o==="Không đạt"?"fail":"pending";return`
      <tfoot>
        <tr class="detailed-evaluation-conclusion-row" data-detailed-conclusion-row>
          <th scope="row" colspan="${t==="capacity"?3:2}">Kết luận</th>
          <td class="detailed-evaluation-mark-cell">${b({field:"ketQuaTuDong",value:"pass",selected:r,label:"Kết luận tự động: Đạt"})}</td>
          <td class="detailed-evaluation-mark-cell">${b({field:"ketQuaTuDong",value:"fail",selected:r,label:"Kết luận tự động: Không đạt"})}</td>
          <td class="detailed-evaluation-mark-cell">${b({field:"ketQua",value:"pass",selected:u,label:"Kết luận chuyên gia: Đạt"})}</td>
          <td class="detailed-evaluation-mark-cell">${b({field:"ketQua",value:"fail",selected:u,label:"Kết luận chuyên gia: Không đạt"})}</td>
          <td class="detailed-evaluation-conclusion-summary">${G(o)}</td>
        </tr>
      </tfoot>`}const c=n.score!==null?`<span class="detailed-evaluation-conclusion-score">Tổng điểm: ${i(n.score)}</span>`:"";return`
    <tfoot>
      <tr class="detailed-evaluation-conclusion-row" data-detailed-conclusion-row>
        <th scope="row" colspan="2">Kết luận</th>
        <td colspan="4">
          <div class="detailed-evaluation-conclusion-value">${G(o)}${c}</div>
        </td>
      </tr>
    </tfoot>`}function L(t,a){return`
    <td>
      <div class="detailed-evaluation-field-stack">
        <textarea class="form-control" data-detailed-field="nhanXet" aria-label="Nhận xét đánh giá" ${a} placeholder="Nhận xét đánh giá">${i(t.nhanXet||"")}</textarea>
      </div>
    </td>`}function D(t,a,e){return t.isCustom!==!0?`<strong class="detailed-evaluation-stt">${i(t.stt||a+1)}</strong>`:`<input type="text" class="form-control detailed-evaluation-config-stt"
    data-detailed-config-field="stt"
    aria-label="Số thứ tự tiêu chí"
    value="${i(t.stt||a+1)}"
    ${e?"disabled":""}>`}function x(t,a=!1,{showRequirement:e=!0}={}){const l=t.source==="muasamcong"||t.required===!1?"":' <span class="required" aria-label="Bắt buộc">*</span>';return t.isCustom===!0?`
      <div class="detailed-evaluation-config-criterion">
        <textarea class="form-control" data-detailed-config-field="name"
          aria-label="Nội dung tiêu chí đánh giá" placeholder="Nhập nội dung tiêu chí đánh giá"
          ${a?"disabled":""}>${i(t.name||"")}</textarea>
        ${a?"":`<button type="button" class="btn btn-text detailed-evaluation-remove-criterion"
          data-detailed-remove-criterion="${i(t.id)}"
          aria-label="Xóa tiêu chí" title="Xóa dòng"><i data-lucide="trash-2" aria-hidden="true"></i></button>`}
      </div>
      ${e?`<textarea class="form-control detailed-evaluation-config-requirement"
        data-detailed-config-field="requirement" aria-label="Yêu cầu của tiêu chí"
        placeholder="Yêu cầu của tiêu chí (nếu có)" ${a?"disabled":""}>${i(t.requirement||"")}</textarea>`:""}`:`
    <div>${i(t.name||"")}${l}</div>
    ${t.requirement?`<div class="detailed-evaluation-requirement"><strong>Yêu cầu:</strong> ${i(t.requirement)}</div>`:""}`}function Ot({criterion:t,row:a,index:e,activeGroup:l,disabled:n}){const o=a?.extension?.ketQuaTuDong||a?.ketQuaTuDong||"pending",c=a.ketQua||"pending",d=t.isSection===!0,r=t.hasChildren===!0,u=n||d,v=n?"disabled":"",f=r?`
      <td class="detailed-evaluation-mark-cell">${b({field:"ketQuaTuDong",value:"pass",selected:o,label:`Hệ thống tự tính đạt: ${t.name}`})}</td>
      <td class="detailed-evaluation-mark-cell">${b({field:"ketQuaTuDong",value:"fail",selected:o,label:`Hệ thống tự tính không đạt: ${t.name}`})}</td>`:d?'<td class="detailed-evaluation-mark-cell">-</td><td class="detailed-evaluation-mark-cell">-</td>':`
      <td class="detailed-evaluation-mark-cell">${w({field:"ketQuaTuDong",value:"pass",selected:o,label:`Hệ thống đánh giá đạt: ${t.name}`,disabled:u})}</td>
      <td class="detailed-evaluation-mark-cell">${w({field:"ketQuaTuDong",value:"fail",selected:o,label:`Hệ thống đánh giá không đạt: ${t.name}`,disabled:u})}</td>`,q=r?`
      <td class="detailed-evaluation-mark-cell">${b({field:"ketQua",value:"pass",selected:c,label:`Chuyên gia tự tính đạt: ${t.name}`})}</td>
      <td class="detailed-evaluation-mark-cell">${b({field:"ketQua",value:"fail",selected:c,label:`Chuyên gia tự tính không đạt: ${t.name}`})}</td>`:d?'<td class="detailed-evaluation-mark-cell"></td><td class="detailed-evaluation-mark-cell"></td>':`
      <td class="detailed-evaluation-mark-cell">${w({field:"ketQua",value:"pass",selected:c,label:`Chuyên gia đánh giá đạt: ${t.name}`,disabled:u})}</td>
      <td class="detailed-evaluation-mark-cell">${w({field:"ketQua",value:"fail",selected:c,label:`Chuyên gia đánh giá không đạt: ${t.name}`,disabled:u})}</td>`,C=l==="capacity"?`<td><textarea class="form-control" data-detailed-field="noiDungHsdt" aria-label="Nội dung HSDT cho ${i(t.name||t.code||"tiêu chí")}" ${v}>${i(a.noiDungHsdt||"")}</textarea></td>`:"",P=d?"<td></td>":L(a,v);return`
    <tr class="${d?"detailed-evaluation-section-row":""} ${r?"detailed-evaluation-parent-row":""}" data-detailed-criterion-id="${i(t.id)}">
      <td>${D(t,e,n)}</td>
      <td class="text-wrap">${x(t,n)}</td>
      ${C}
      ${f}
      ${q}
      ${P}
    </tr>`}function Vt({criterion:t,row:a,index:e,disabled:l}){const n=a.ketQua||"pending",o=t.isSection===!0,c=t.hasChildren===!0,d=l||o,r=c?["pass","acceptable","fail"].map(u=>`<td class="detailed-evaluation-mark-cell">${b({field:"ketQua",value:u,selected:n,label:`Chuyên gia tự tính ${u==="pass"?"Đạt":u==="acceptable"?"Chấp nhận được":"Không đạt"}: ${t.name}`})}</td>`).join(""):o?'<td class="detailed-evaluation-mark-cell"></td>'.repeat(3):[["pass","Đạt"],["acceptable","Chấp nhận được"],["fail","Không đạt"]].map(([u,v])=>`<td class="detailed-evaluation-mark-cell">${w({field:"ketQua",value:u,selected:n,label:`${v}: ${t.name}`,disabled:d})}</td>`).join("");return`
    <tr class="${o?"detailed-evaluation-section-row":""} ${c?"detailed-evaluation-parent-row":""}" data-detailed-criterion-id="${i(t.id)}">
      <td>${D(t,e,l)}</td>
      <td class="text-wrap">${x(t,l)}</td>
      ${r}
      ${o?"<td></td>":L(a,l?"disabled":"")}
    </tr>`}function X(t,a,e,l){const n=t[a];return`<input type="number" min="0" step="any" inputmode="decimal" class="form-control detailed-evaluation-score-limit"
    data-detailed-config-field="${a}"
    aria-label="${i(`${e}: ${t.name||t.code||"tiêu chí"}`)}"
    value="${i(n??"")}" ${l?"disabled":""} placeholder="0">`}function jt({criterion:t,row:a,index:e,disabled:l}){const n=l?"disabled":"";return`
    <tr data-detailed-criterion-id="${i(t.id)}">
      <td>${D(t,e,l)}</td>
      <td class="text-wrap">${x(t,l)}</td>
      <td>${X(t,"maxScore","Điểm tối đa",l)}</td>
      <td>${X(t,"minScore","Điểm tối thiểu",l)}</td>
      <td><input type="number" min="0" step="any" inputmode="decimal" ${t.maxScore!=null?`max="${i(t.maxScore)}"`:""}
        class="form-control detailed-evaluation-score-input" data-detailed-field="diem"
        aria-label="Điểm đánh giá: ${i(t.name||t.code||"tiêu chí")}"
        value="${i(a.diem??"")}" ${n} placeholder="Điểm"></td>
      ${L(a,n)}
    </tr>`}function zt(t){return t==="pass_fail"?`
      <thead>
        <tr class="detailed-evaluation-header-group">
          <th rowspan="2">STT</th>
          <th rowspan="2">Nội dung đánh giá</th>
          <th colspan="3">Kết quả đánh giá của chuyên gia</th>
          <th rowspan="2">Nhận xét của chuyên gia</th>
        </tr>
        <tr class="detailed-evaluation-header-subgroup">
          <th>Đạt</th><th>Chấp nhận được</th><th>Không đạt</th>
        </tr>
      </thead>`:t==="score"?`
      <thead>
        <tr class="detailed-evaluation-header-group">
          <th rowspan="2">STT</th>
          <th rowspan="2">Nội dung đánh giá</th>
          <th colspan="2">Mức điểm quy định trong E-HSMT</th>
          <th colspan="2">Kết quả đánh giá của chuyên gia</th>
        </tr>
        <tr class="detailed-evaluation-header-subgroup">
          <th>Điểm tối đa</th><th>Điểm tối thiểu</th><th>Điểm đánh giá</th><th>Nhận xét của chuyên gia</th>
        </tr>
      </thead>`:""}function Ft({method:t="",readOnly:a=!1}={}){return t?"":a?'<div class="alert alert-warning" role="status">Chưa xác định phương pháp đánh giá kỹ thuật.</div>':`<fieldset class="detailed-technical-method-selector" aria-describedby="detailed-technical-method-help">
    <legend>Phương pháp đánh giá kỹ thuật</legend>
    <div class="detailed-technical-method-options">
      <label class="radio-option"><input type="radio" name="detailed-technical-evaluation-method" value="pass_fail" class="radio-option-input"> Đạt/Không đạt</label>
      <label class="radio-option"><input type="radio" name="detailed-technical-evaluation-method" value="score" class="radio-option-input"> Chấm điểm</label>
    </div>
    <p id="detailed-technical-method-help">Chọn phương pháp quy định trong E-HSMT. Lựa chọn sẽ áp dụng cho toàn bộ nhà thầu trong vòng đánh giá này.</p>
  </fieldset>`}function Gt(t){if(typeof requestAnimationFrame=="function"){requestAnimationFrame(t);return}setTimeout(t,0)}function Xt({rowHtml:t,startIndex:a=0,chunkSize:e=50,appendBatch:l,scheduleFrame:n=Gt,shouldContinue:o=()=>!0}={}){if(!Array.isArray(t)||typeof l!="function")throw new TypeError("Detailed evaluation row batching requires row HTML and an append adapter.");const c=Math.max(1,Number(e)||50);let d=Math.max(0,Number(a)||0);return new Promise(r=>{const u=()=>{if(!o()){r(!1);return}const v=t.slice(d,d+c);if(!v.length){r(!0);return}if(l(v,d),d+=v.length,d>=t.length){r(!0);return}n(u)};if(d>=t.length){r(!0);return}n(u)})}function Ut(t,{pkg:a=null,bids:e=[],selectedBidId:l="",lotScope:n=null,roundType:o="single",context:c,activeGroup:d="validity",criteria:r=[],report:u=null,progress:v={completed:0,total:0},readOnly:f=!1,canReopen:q=!1,warning:C="",bidderGoodsMarkup:P=""}={}){if(!t)return;const W=new Map((u?.chiTietList||[]).map(s=>[String(s.tieuChiDanhGiaId),s])),y=e.find(s=>String(s.id)===String(l)),Y=Pt({pkg:a,bid:y}),m=At(c,d),Z=(c?.visibleGroups||[]).map(s=>{const p=s===d;return`
      <button type="button" id="detailed-evaluation-tab-${s}" role="tab"
        aria-selected="${p?"true":"false"}"
        aria-controls="detailed-evaluation-tab-panel"
        tabindex="${p?"0":"-1"}"
        class="btn package-workflow-tab ${p?"active":""}"
        data-no-icon
        data-detailed-evaluation-group="${s}">${U[s]||s}</button>
    `}).join(""),S=d==="validity"||d==="capacity",_=d==="financial",N=d==="bidder_goods",E=c?.technicalEvaluationMethod||"",A=d==="technical"&&!E,H=d==="technical"&&E==="pass_fail",K=d==="technical"&&E==="score",k=r.map((s,p)=>{const g=W.get(String(s.id))||{tieuChiDanhGiaId:s.id,ketQua:"pending"},h=f||!(c?.editableGroups||[]).includes(d);if(S)return Ot({criterion:s,row:g,index:p,activeGroup:d,disabled:h});if(H)return Vt({criterion:s,row:g,index:p,disabled:h});if(K)return jt({criterion:s,row:g,index:p,disabled:h});if(_){const pt=h?"disabled":"";return`
        <tr data-detailed-criterion-id="${i(s.id)}">
          <td>${D(s,p,h)}</td>
          <td class="text-wrap">${x(s,h,{showRequirement:!1})}</td>
          <td><textarea class="form-control detailed-evaluation-financial-value"
            data-detailed-field="noiDungHsdt"
            aria-label="Giá trị cho ${i(s.name||s.code||"nội dung tài chính")}"
            placeholder="Nhập giá trị" ${pt}>${i(g.noiDungHsdt||"")}</textarea></td>
        </tr>`}const T=h?"disabled":"";return`
      <tr data-detailed-criterion-id="${i(s.id)}">
        <td>${D(s,p,h)}</td>
        <td class="text-wrap">${x(s,h)}</td>
        <td><textarea class="form-control" data-detailed-field="noiDungHsdt" aria-label="Nội dung HSDT cho ${i(s.name||s.code||"tiêu chí")}" ${T}>${i(g.noiDungHsdt||"")}</textarea></td>
        <td><div class="detailed-evaluation-field-stack detailed-evaluation-result-stack">${It(s,g,h)}</div></td>
        <td class="detailed-evaluation-score">${s.resultType==="score"?`<span>Tối đa: ${i(s.maxScore??"--")}</span>${s.minScore!=null?`<span>Tối thiểu: ${i(s.minScore)}</span>`:""}`:i(g.diem??"--")}</td>
        ${L(g,T)}
      </tr>`}),B=k.length>100?F:k.length,J=k.slice(0,B).join(""),O=u?.trangThai==="completed"?"Hoàn thành":u?"Bản nháp":"Chưa đánh giá",tt=u?.trangThai==="completed"?"badge-success":"badge-warning",at=qt(Lt({pkg:a,selectedBid:y,lotScope:n,roundType:o,context:c,activeGroup:d,status:O})),I=e.findIndex(s=>String(s.id)===String(l)),et=e.length>1?`
    <div class="detailed-evaluation-navigation" aria-label="Điều hướng hồ sơ dự thầu">
      <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-previous" ${I<=0?"disabled":""}>
        <i data-lucide="chevron-left" aria-hidden="true"></i> Nhà thầu trước
      </button>
      <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-next" ${I<0||I>=e.length-1?"disabled":""}>
        Nhà thầu tiếp theo <i data-lucide="chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  `:"",V=N||A?"":y?f?u?.trangThai==="completed"&&q?'<button type="button" class="btn btn-primary" id="btn-detailed-evaluation-reopen">Chỉnh sửa báo cáo chi tiết</button>':"":'<button type="button" class="btn btn-secondary" id="btn-detailed-evaluation-save-draft" data-no-icon>Lưu bản nháp</button><button type="button" class="btn btn-secondary" id="btn-detailed-evaluation-complete-group" data-no-icon>Hoàn thành tab</button><button type="button" class="btn btn-primary" id="btn-detailed-evaluation-complete-report" data-no-icon>Hoàn thành đánh giá nhà thầu</button>':"",it=!N&&y&&!f?`<div class="detailed-evaluation-tab-actions">${A?"":'<button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-add-row"><i data-lucide="plus" aria-hidden="true"></i> Thêm dòng</button>'}<input type="file" id="detailed-evaluation-excel-input" accept=".xlsx,.xls" hidden><button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-import-excel"><i data-lucide="upload" aria-hidden="true"></i> Nhập từ Excel</button></div>`:"",lt=`
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      ${d==="capacity"?'<col class="detailed-evaluation-col-content">':""}
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-comment">
    </colgroup>`,nt=`
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      <col class="detailed-evaluation-col-content">
      <col class="detailed-evaluation-col-result">
      <col class="detailed-evaluation-col-score">
      <col class="detailed-evaluation-col-comment">
    </colgroup>`,dt=`
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-financial-content">
      <col class="detailed-evaluation-col-financial-value">
    </colgroup>`,ot=`
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      <col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-comment">
    </colgroup>`,st=`
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      <col class="detailed-evaluation-col-score-max"><col class="detailed-evaluation-col-score-min">
      <col class="detailed-evaluation-col-score"><col class="detailed-evaluation-col-comment">
    </colgroup>`,ct=`
    <thead>
      <tr class="detailed-evaluation-header-group">
        <th rowspan="2">${i(m.columns[0])}</th>
        <th rowspan="2">${i(m.columns[1])}</th>
        ${d==="capacity"?`<th rowspan="2">${i(m.columns[2])}</th>`:""}
        <th colspan="2">Kết quả đánh giá tự động từ Hệ thống</th>
        <th colspan="2">Kết quả đánh giá của chuyên gia</th>
        <th rowspan="2">${i(m.columns[5]||"Nhận xét của chuyên gia (nếu có)")}</th>
      </tr>
      <tr class="detailed-evaluation-header-subgroup">
        <th>Đạt</th><th>Không đạt</th><th>Đạt</th><th>Không đạt</th>
      </tr>
    </thead>`,rt=`
    <thead>
      <tr class="detailed-evaluation-header-group">
        <th rowspan="2">${i(m.columns[0])}</th>
        <th rowspan="2">${i(m.columns[1])}</th>
        <th rowspan="2">${i(m.columns[2])}</th>
        <th colspan="2">${i(m.columns[3])}</th>
        <th rowspan="2">${i(m.columns[5]||"Nhận xét")}</th>
      </tr>
      <tr class="detailed-evaluation-header-subgroup">
        <th>Đạt / Không đạt</th><th>${i(m.columns[4]||"Điểm")}</th>
      </tr>
    </thead>`,ut=`
    <thead>
      <tr class="detailed-evaluation-header-group">
        <th>${i(m.columns[0])}</th>
        <th>${i(m.columns[1])}</th>
        <th>${i(m.columns[2])}</th>
      </tr>
    </thead>`,ht=zt(E),mt=d==="technical"?Ft({method:E,readOnly:f}):"",vt=Qt({activeGroup:d,criteria:r,report:u});t.innerHTML=z(`
    <section class="detailed-evaluation-panel" aria-label="Báo cáo đánh giá chi tiết">
      <div class="detailed-evaluation-topbar">
        <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-back"><i data-lucide="arrow-left" aria-hidden="true"></i> Quay lại báo cáo tổng quát</button>
      </div>
      ${C?`<div class="alert alert-warning" role="status">${i(C)}</div>`:""}
      <div class="detailed-evaluation-overview">
        <div class="form-group detailed-evaluation-bid-field">
          <label for="detailed-evaluation-bid-select">Nhà thầu/Hồ sơ dự thầu</label>
          <select id="detailed-evaluation-bid-select" class="form-control">
            ${e.map(s=>`<option value="${i(s.id)}" ${String(s.id)===String(l)?"selected":""}>${i(s.label)}</option>`).join("")}
          </select>
        </div>
        <div class="detailed-evaluation-metric">
          <span class="detailed-evaluation-metric-label">Trạng thái</span>
          <strong id="detailed-evaluation-status" class="badge ${tt}">${O}</strong>
        </div>
        <div class="detailed-evaluation-metric">
          <div id="detailed-evaluation-progress" class="detailed-evaluation-progress-host"></div>
        </div>
        ${Y}
      </div>
      ${at}
      ${y?et:'<div class="package-panel-empty">Chưa có hồ sơ dự thầu phù hợp.</div>'}
      <div class="detailed-evaluation-tabs-toolbar">
        <div class="detailed-evaluation-tabs" role="tablist" aria-label="Nhóm đánh giá">${Z}</div>
        ${it}
      </div>
      <div id="detailed-evaluation-tab-panel" class="detailed-evaluation-tab-panel" role="tabpanel" aria-labelledby="detailed-evaluation-tab-${i(d)}">
        ${mt}
        ${N?P:`
        ${A?'<div class="package-panel-empty detailed-technical-method-empty">Chọn phương pháp đánh giá kỹ thuật hoặc nhập file Excel để tiếp tục.</div>':`
        <div class="table-container package-table-frame has-bottom-space detailed-evaluation-table-frame">
        <table class="data-table detailed-evaluation-table ${S?`detailed-evaluation-table-binary detailed-evaluation-table-${d}`:_?"detailed-evaluation-table-financial":H?"detailed-evaluation-table-technical-pass-fail":K?"detailed-evaluation-table-technical-score":""}" data-no-sort="true" data-density="comfortable" data-row-pagination="true" aria-label="Báo cáo đánh giá chi tiết">
          ${S?lt:_?dt:H?ot:K?st:nt}
          ${S?ct:_?ut:H||K?ht:rt}
          <tbody id="detailed-evaluation-criteria-body">${J}</tbody>
          ${vt}
        </table>
        </div>
        `}
        `}
      </div>
      ${V?`<div class="workflow-action-row detailed-evaluation-actions with-divider">${V}</div>`:""}
    </section>
  `),Tt(t.querySelector?.("#detailed-evaluation-progress"),{percent:v.percent,stages:[{label:"Tiêu chí",completed:v.requiredCompleted,applicable:v.requiredTotal}]},{title:"Tiến độ tiêu chí bắt buộc"}),t._detailedEvaluationRowRenderRevision=(t._detailedEvaluationRowRenderRevision||0)+1;const j=t._detailedEvaluationRowRenderRevision;if(!N&&B<k.length&&t.querySelector){const s=t.querySelector("#detailed-evaluation-criteria-body");if(!s)return;s.setAttribute("aria-busy","true");const p=["#btn-detailed-evaluation-save-draft","#btn-detailed-evaluation-complete-group","#btn-detailed-evaluation-complete-report","#btn-detailed-evaluation-import-excel","#btn-detailed-evaluation-add-row"].map(h=>t.querySelector(h)).filter(Boolean);p.forEach(h=>{h.disabled=!0});const g=s.ownerDocument||document;t._detailedEvaluationRowsReady=Xt({rowHtml:k,startIndex:B,chunkSize:F,shouldContinue:()=>t._detailedEvaluationRowRenderRevision===j,appendBatch:h=>{const T=g.createElement("template");T.innerHTML=z(h.join("")),s.appendChild(T.content)}}).finally(()=>{t._detailedEvaluationRowRenderRevision===j&&(s.removeAttribute("aria-busy"),p.forEach(h=>{h.disabled=!1}),t.dispatchEvent?.(new CustomEvent("detailed-evaluation-rows-ready")))})}}async function Wt(){return Ht(this)}async function Yt(t){const a=R(this),e=$t(t);return!a?.report||a.readOnly||this.selectedDetailedEvaluationTab!=="technical"||!e||yt(a.pkg)?!1:(this._technicalEvaluationMethodDrafts=this._technicalEvaluationMethodDrafts||new Map,this._technicalEvaluationMethodDrafts.set(a.criteriaKey,e),this._detailedEvaluationDrafts.set(a.draftKey,{...a.report,extension:{...a.report.extension||{},technicalEvaluationMethod:e}}),this._detailedEvaluationDirty=!0,await this.renderDetailedEvaluation(),!0)}async function fa(){return this.currentEvaluationView="contractor-detail",this.selectedDetailedEvaluationTab=this.selectedDetailedEvaluationTab||"validity",this._detailedEvaluationDirty=!1,this.renderDetailedEvaluation()}async function $a(){if(!await Nt(this))return!1;this.currentEvaluationView="summary",this._detailedEvaluationDirty=!1,Et();const t=this.view.getActiveElement("danhgiahsdt-summary-view"),a=this.view.getActiveElement("danhgiahsdt-detail-view");return t?.classList.remove("is-hidden"),a?.classList.add("is-hidden"),M(t,"display","block"),M(a,"display","none"),!0}async function ya(){const t=R(this),a=this.view.getActiveElement("danhgiahsdt-summary-view"),e=this.view.getActiveElement("danhgiahsdt-detail-view");if(!t||!e)return;a?.classList.add("is-hidden"),e.classList.remove("is-hidden"),M(a,"display","none"),M(e,"display","block");const l=t.criteria.filter(r=>r.group===this.selectedDetailedEvaluationTab),n=xt(t.report,t.criteria),o=t.report?.trangThai==="draft"&&Ct(t.report)?"Báo cáo chi tiết đang được chỉnh sửa. Kết quả tổng hợp chưa được cập nhật.":"";let c=null,d="";this.selectedDetailedEvaluationTab==="bidder_goods"&&(c=await $(()=>import("./BidderGoodsWorkflow-ed8AOAOS.js"),__vite__mapDeps([0])),c.initializeBidderGoodsFromRequirements(this,t),d=c.renderBidderGoodsPanelMarkup(c.buildBidderGoodsPanelState(this,t))),Ut(e,{...t,activeGroup:this.selectedDetailedEvaluationTab,criteria:l,progress:n,warning:o,bidderGoodsMarkup:d}),St({appController:this,root:e,state:t,commands:{close:()=>this.closeDetailedEvaluation(),render:()=>this.renderDetailedEvaluation(),save:r=>this.saveDetailedEvaluation(r),importExcel:r=>Zt.call(this,r),addCriterion:()=>Wt.call(this),removeCriterion:r=>_t(this,r),setTechnicalMethod:r=>Yt.call(this,r)}}),c?.bindBidderGoodsPanel(this,t,e),kt(this,t.pkg.id)}async function Zt(t){const a=R(this);if(!a?.bid||!a.report||a.readOnly)return!1;try{const[{readExcelWorkbookSheets:e},{analyzeDetailedEvaluationWorkbook:l}]=await Promise.all([$(()=>import("./excelFileReader-BQNu4vr_.js"),__vite__mapDeps([0])),$(()=>import("./DetailedEvaluationImport-DhB3lY5H.js"),__vite__mapDeps([0]))]),n=await e(t),o=l({state:a,sheets:n,activeGroup:this.selectedDetailedEvaluationTab,currentCriteriaOverride:this._detailedEvaluationCriteriaOverrides.get(a.criteriaKey)});if(o.isMuasamcong&&!await Jt(this,a,n))return!1;if(!o.report)return await this.view.customAlert("Không tìm thấy tiêu chí phù hợp","Excel cần có cột STT, Mã tiêu chí hoặc Tiêu chí/Yêu cầu trùng với tab đang mở.","alert-triangle"),!1;if(o.criteriaOverride&&this._detailedEvaluationCriteriaOverrides.set(a.criteriaKey,o.criteriaOverride),this._detailedEvaluationDrafts.set(a.draftKey,o.report),this._detailedEvaluationDirty=!0,this.renderDetailedEvaluation(),!await ta.call(this,{notify:!1}))return!1;const{matched:c,skipped:d,warnings:r,sheetNames:u}=o.stats;return await this.view.customAlert("Đã nhập dữ liệu Excel",`Đã tự điền và lưu nháp ${c} tiêu chí${u?` từ các sheet: ${u}`:" trong tab hiện tại"}.${d?` Bỏ qua ${d} dòng không khớp.`:""}${r?` Có ${r} kết quả cần kiểm tra lại.`:""}`,r||d?"alert-triangle":"check-circle"),!0}catch(e){return console.error(e),await this.view.customAlert("Không thể đọc Excel",e?.message||"Vui lòng kiểm tra lại định dạng tệp Excel.","alert-triangle"),!1}}async function Jt(t,a,e){const[{validateMuasamcongContractorIdentity:l},{resolveBidContractorName:n}]=await Promise.all([$(()=>import("./detailedEvaluationExcel-CwB4XeoM.js"),[]),$(()=>import("./contractorVersionBinding-CLPoZrqc.js").then(d=>d.t),[])]),o=l(e,n(t.model,a.bid)||String(a.bid?.tenNhaThau||"").trim());if(o.valid)return!0;const c=o.reason==="mismatch"?`Tên nhà thầu trong Excel: "${o.actualNames[0]}". Nhà thầu đang chọn: "${o.expectedName}". Hãy kiểm tra kỹ trước khi tiếp tục.`:o.reason==="conflicting-workbook-names"?`File Excel chứa nhiều tên nhà thầu: ${o.actualNames.join("; ")}. Nhà thầu đang chọn: "${o.expectedName||"Không xác định"}". Hãy kiểm tra kỹ trước khi tiếp tục.`:o.reason==="missing-selected-name"?`Tên nhà thầu trong Excel: "${o.actualNames.join("; ")||"Không xác định"}". Không xác định được tên nhà thầu đang chọn để đối chiếu. Hãy kiểm tra kỹ trước khi tiếp tục.`:`Không tìm thấy tên nhà thầu trong file Excel. Nhà thầu đang chọn: "${o.expectedName||"Không xác định"}". Hãy kiểm tra kỹ trước khi tiếp tục.`;return await t.view.customConfirm(o.reason==="mismatch"?"Sai nhà thầu trong file Excel":"Không thể xác minh nhà thầu",c,"alert-triangle",{confirmLabel:"Vẫn nhập",cancelLabel:"Hủy"})===!0}async function ta({completeGroup:t=!1,completeReport:a=!1,notify:e=!0}={}){const l=R(this),n=this.view.getActiveElement("danhgiahsdt-detail-view"),{executeDetailedEvaluationSave:o}=await $(async()=>{const{executeDetailedEvaluationSave:c}=await import("./DetailedEvaluationSaveWorkflow-BkoIha_S.js");return{executeDetailedEvaluationSave:c}},__vite__mapDeps([0]));return o({appController:this,state:l,root:n,activeGroup:this.selectedDetailedEvaluationTab,completeGroup:t,completeReport:a,notify:e})}export{Wt as addDetailedEvaluationCriterion,va as applyDetailedEvaluationProjection,ma as buildDetailedEvaluationDraft,ha as buildReopenedDetailedEvaluationReport,$a as closeDetailedEvaluation,ga as collectActiveGroupRows,ba as collectConfiguredDetailedEvaluationCriteria,Zt as importDetailedEvaluationExcel,fa as openDetailedEvaluation,ya as renderDetailedEvaluation,ta as saveDetailedEvaluation,Yt as setDetailedTechnicalEvaluationMethod,Jt as verifyMuasamcongDetailedEvaluationContractor};
