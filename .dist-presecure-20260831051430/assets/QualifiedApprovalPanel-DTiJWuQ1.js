import{n as s}from"./view_helpers-CdPIbaii.js";import{W as p,ct as m}from"./app-RPlYyKwL.js";import{i as $}from"./domUtils-ByCXOQ5o.js";import{t as q}from"./workspaceRenderCache-BIPtUnPy.js";import{a as S,r as k}from"./evaluationMethodRules-CW6GTI60.js";import{t as D}from"./evaluationMetadata-CL3Bxm_v.js";import{g as C,m as M}from"./lotEvaluationScope-CB0bwEDI.js";import{n as v}from"./packageAppraisal-CP92vlFS.js";import{n as L}from"./PackageTabs-eENmioVZ.js";import{n as B,t as b}from"./workflowActionState-C8Wq0z73.js";import{i as K}from"./packageEvaluationProgress-BAo0uxvU.js";import{t as x}from"./BidderTable-q50inijJ.js";var y=a=>`qualified-approval:${a?.id||"unknown"}`;function E(a){const e=D(a?.danhGiaHsdtMetadata).metadata;return e?.is1G2T?e:{is1G2T:!0,technical:e?.soBaoCao?e:{saved:!1},financial:{saved:!1}}}function P(a,e){return e.some(t=>{const n=String(t?.danhGiaKyThuat||"").trim().replace(/,/g,".");return n!==""&&Number.isFinite(Number.parseFloat(n))})||S(a)}function Q({view:a,pkg:e,isTechEvalSaved:t=!1,effectiveStatus:n=e?.trangThai||""}={}){const i=E(e);i.technical=i.technical||{saved:!0};const d=C(e,i.technical),o=(a?.model?.state?.thongtinmothau||[]).filter(l=>String(l?.goiThauId||"")===String(e?.id||"")).filter(l=>!d||M(l,d)).filter(l=>L(l,e)),c=d?.batch||i.technical,r=c.qualifiedSaved===!0,h=!!a?._editingState?.qualified,f=n==="Đã có kết quả"||n==="Hủy thầu",u=!!(e?.thoiGianMoEhsdxtc||d?.batch?.financialOpening?.saved||o.some(l=>Number(l?.giaDuThau)>0)),g=B({isCompleted:r,isEditing:h,isNextStepSaved:u,isFinal:f}),T=g!==b.SAVE;return{pkg:e,metadata:i,activeScope:d,target:c,qualifiedBids:o,hasTechnicalScore:P(e,o),isTechEvalSaved:t,actionMode:g,isNextStepSaved:u,isReadOnly:T,canEdit:g===b.EDIT}}function G(a,e){const{pkg:t}=e,n=a.model.getLatestPlan(t.keHoachId),i=n?a.model.state.chudautu.find(c=>c.id===n.chuDauTuId):null,d=t.hinhThucLuaChon==="Chỉ định thầu rút gọn"||t.hinhThucLuaChon==="Lựa chọn nhà thầu trong trường hợp đặc biệt",o=t.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ";return`
    <div class="bf-s-8bd3eb473c">
      <div class="bf-s-5d398becec">Thông số Gói thầu</div>
      <div class="bf-s-13b5590e90">
        <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${s(i?.tenChuDauTu||"Không rõ")}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${s(n?.tenKeHoach||"Không rõ")}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${s(t.linhVuc||"Hàng hóa")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${s(t.phuongThucLuaChon||"Một giai đoạn một túi hồ sơ")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${t.phanLo==="Có"?"Có chia phần lô":"Không chia phần lô"}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${s(a.model.formatCurrency(t.giaGoiThau))}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${s(t.hinhThucLuaChon||"--")}</div>
        ${t.phuongPhapDanhGia?`<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${s(k(t))}</div>`:""}
        <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${s(t.loaiHopDong||"--")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${s(t.thoiGianThucHien||"--")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${s(t.nguonVon||"--")}</div>
        ${d?"":`
          <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${t.thoiGianDongThau?s(a.model.formatDateWithTime(t.thoiGianDongThau)):"--"}</div>
          <div>• <strong class="bf-s-fcb5ddef65">${o?"Thời gian mở E-HSĐXKT":"Thời gian mở thầu"}:</strong> ${t.thoiGianMoThau?s(a.model.formatDateWithTime(t.thoiGianMoThau)):"--"}</div>
          ${o?`<div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong> ${t.thoiGianMoEhsdxtc?s(a.model.formatDateWithTime(t.thoiGianMoEhsdxtc)):"Chưa mở"}</div>`:""}
        `}
      </div>
    </div>`}function N(a,e){const{pkg:t,target:n,isReadOnly:i}=e;return`
    <div class="bf-s-098565a16e">
      <div class="bf-s-5d398becec">QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
      <div class="bf-s-ed07f78f34">
        ${v(t)?"":`
    <div class="form-group bf-s-4bbf3df076">
      <label class="bf-s-997cdefbc9">Số BCTĐ kỹ thuật <span class="text-danger">*</span></label>
      <input type="text" id="qualified-so-bctd" class="form-control bf-s-20e5983dc7" value="${s(n.soBctdKt||"")}" placeholder="Nhập số báo cáo thẩm định..." ${i?"readonly":""}>
      <span class="error-text bf-s-35a8ff27ff">Vui lòng nhập Số BCTĐ kỹ thuật!</span>
    </div>
    <div class="form-group bf-s-4bbf3df076">
      <label class="bf-s-997cdefbc9">Ngày BCTĐ kỹ thuật <span class="text-danger">*</span></label>
      <input type="text" id="qualified-ngay-bctd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${s(n.ngayBctdKt?a.model.formatForDateInput(n.ngayBctdKt):"")}" ${i?"readonly":""} placeholder="dd/MM/yyyy">
      <span class="error-text bf-s-35a8ff27ff">Vui lòng chọn Ngày BCTĐ kỹ thuật!</span>
    </div>`}
        <div class="form-group bf-s-4bbf3df076">
          <label class="bf-s-997cdefbc9">Số QĐ phê duyệt nhà thầu đạt kỹ thuật <span class="text-danger">*</span></label>
          <input type="text" id="qualified-so-qd" class="form-control bf-s-20e5983dc7" value="${s(n.soQdPheDuyetKt||"")}" placeholder="Ví dụ: 120/QĐ-CDT" ${i?"readonly":""}>
          <span class="error-text bf-s-35a8ff27ff">Vui lòng nhập Số QĐ phê duyệt!</span>
        </div>
        <div class="form-group bf-s-4bbf3df076">
          <label class="bf-s-997cdefbc9">Ngày QĐ phê duyệt <span class="text-danger">*</span></label>
          <input type="text" id="qualified-ngay-qd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${s(n.ngayQdPheDuyetKt?a.model.formatForDateInput(n.ngayQdPheDuyetKt):"")}" ${i?"readonly":""} placeholder="dd/MM/yyyy">
          <span class="error-text bf-s-35a8ff27ff">Vui lòng chọn Ngày QĐ phê duyệt!</span>
        </div>
      </div>
    </div>`}function H(a,e){const{pkg:t,qualifiedBids:n,hasTechnicalScore:i}=e;return n.length?`
    <div class="table-container bf-s-674afada30">
      <table class="data-table bf-s-448ca2b6ae" data-row-pagination="true" aria-label="Danh sách nhà thầu đáp ứng kỹ thuật">
        <thead><tr>
          ${t.phanLo==="Có"?'<th class="bf-s-ad8c93e5fe">Mã phần lô</th><th class="bf-s-a01153c965">Tên phần lô</th>':""}
          <th class="bf-s-ad8c93e5fe">Mã nhà thầu</th>
          <th style="width: ${t.phanLo==="Có"?"25%":"40%"};">Tên nhà thầu</th>
          ${i?'<th class="bf-s-1a457d1503">Điểm kỹ thuật</th>':""}
          <th class="bf-s-1a457d1503">Kết quả</th>
        </tr></thead>
        <tbody>${n.map(d=>`
          <tr>
            ${t.phanLo==="Có"?`<td>${s(d.maPhanLo||"--")}</td><td class="package-lot-name-cell">${s(d.tenPhanLo||"--")}</td>`:""}
            <td>${s($(d.maNhaThau||d.maDinhDanh,"--"))}</td>
            <td>${x(a.model,d,`${t.id}_qualified_${d.id}`,{owner:y(t)})}</td>
            ${i?`<td class="bf-s-63dbf5319a">${s(d.danhGiaKyThuat||"--")}</td>`:""}
            <td class="bf-s-63dbf5319a"><span class="badge badge-success bf-s-391321b535">Đạt kỹ thuật</span></td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`:'<div class="table-container bf-s-674afada30"><div class="bf-s-5835c40555"><i data-lucide="info" class="bf-s-ea6824d1aa"></i> Không có nhà thầu nào đạt yêu cầu kỹ thuật. Vui lòng nhập số quyết định phê duyệt và ngày quyết định phía trên để lưu danh sách đạt kỹ thuật trống và chuyển sang bước Hủy thầu.</div></div>'}function F(a,e){return a?.value?.trim()?(p(a),!0):(a&&(e.push(a),p(a,{state:"invalid",message:a.closest(".form-group")?.querySelector(".error-text")?.textContent||""})),!1)}function I(a,e,t,n){const i=e.querySelector("#btn-edit-qualified-decision");if(i&&(i.onclick=()=>{a._editingState=a._editingState||{},a._editingState.qualified=!0,a.showPackageDetails(t.pkg.id)}),t.isReadOnly)return;const d=e.querySelector("#btn-save-qualified-decision");d&&(d.onclick=async()=>{const o=e.querySelector("#qualified-so-qd"),c=e.querySelector("#qualified-ngay-qd"),r=e.querySelector("#qualified-so-bctd"),h=e.querySelector("#qualified-ngay-bctd"),f=[];if([o,c,r,h].filter(Boolean).forEach(u=>F(u,f)),f.length){a.focusInvalidControl(f[0]);return}t.target.soQdPheDuyetKt=o.value.trim(),t.target.ngayQdPheDuyetKt=a.model.convertDMYToYMD(c.value.trim()),r&&(t.target.soBctdKt=r.value.trim()),h&&(t.target.ngayBctdKt=a.model.convertDMYToYMD(h.value.trim())),v(t.pkg)&&(delete t.target.soBctdKt,delete t.target.ngayBctdKt),t.target.qualifiedSaved=!0,await K(n||a,t.pkg,t.metadata),a._editingState&&(a._editingState.qualified=!1),await a.customAlert("Thành công","Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!","check-circle"),a._currentWorkflowTab=t.qualifiedBids.length?"opening_fin":"result",await a.showPackageDetails(t.pkg.id)})}function Z(a,{contentWrapper:e,pkg:t,isTechEvalSaved:n,effectiveStatus:i,appController:d}={}){q(a?.model,y(t));const o=Q({view:a,pkg:t,isTechEvalSaved:n,effectiveStatus:i});if(!o.isTechEvalSaved)return e.innerHTML=m(`
      <div class="bf-s-71ff99332d">
        <i data-lucide="shield-alert" class="bf-s-106d10c68d"></i>
        <h4 class="bf-s-01dd0d67e8">Chưa có Nhà thầu đạt kỹ thuật</h4>
        <p class="bf-s-85ddf1c3bf">Vui lòng hoàn thành và Lưu Báo cáo đánh giá E-HSĐXKT trước.</p>
      </div>`),o;const c=o.actionMode===b.SAVE?'<button class="btn btn-primary bf-s-b69e3fa20a" id="btn-save-qualified-decision"><i data-lucide="save"></i> Lưu QĐ phê duyệt</button>':o.actionMode===b.EDIT?'<button class="btn btn-primary bf-s-b69e3fa20a" id="btn-edit-qualified-decision"><i data-lucide="edit-3"></i> Chỉnh sửa</button>':"";return e.innerHTML=m(`
    ${G(a,o)}
    ${N(a,o)}
    ${H(a,o)}
    <div class="bf-s-54e8112b47">${c}</div>`),a.initFlatpickr?.(e),I(a,e,o,d),o}export{Z as renderQualifiedApprovalPanel};
