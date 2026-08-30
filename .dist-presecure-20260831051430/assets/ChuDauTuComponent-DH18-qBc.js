import{r as f}from"./runtimeStyles-DWYSnTnQ.js";import{l as p,n as d,s as y}from"./view_helpers-CdPIbaii.js";import{a as S,ct as w}from"./app-RPlYyKwL.js";import{i as g}from"./domUtils-ByCXOQ5o.js";import{t as m}from"./commandBus-CHqMiCNa.js";import{l as V,u as E}from"./versionResolver-C4iQLmXG.js";import{t as H}from"./perfDiagnostics-rZdUYj0C.js";import{d as I,g as B,l as Q,r as x}from"./tableDataUtils-jcjOH8y4.js";import{a as L,i as P,n as R,o as A,r as N,s as K,t as b}from"./virtualTable-HKeI84Ao.js";import{n as M,t as k}from"./VersionSelector-CtR_Sh95.js";async function Y(){const l=H("chudautu","chudautu"),e=document.getElementById("chudautu-table").querySelector("tbody"),s=document.getElementById("search-chudautu").value.toLowerCase();let c=[],n=0;const u=this.model.currentPage.chudautu||1,r=this.model.pageSize||10,v=this.model.sortState.chudautu||{},h=v.field||"",o=v.order||"asc";if(this.model.useServerSidePagination){const i={page:u,pageSize:r,search:s,sortBy:h,sortOrder:o};x(this.model,"chudautu",i)||K(e,8);try{const t=await Q(this.model,"chudautu",i,{cancellationOwner:"ui:investor-list"});c=t.items,n=t.totalItems,l.dataComplete(t)}catch(t){if(t?.name==="AbortError")return;console.error("Failed to fetch paginated investors",t),b(e),A(e,{colspan:8,message:"Không thể tải danh sách chủ đầu tư. Vui lòng thử lại.",onRetry:()=>this.renderChuDauTuTable()});return}}else{const i=this.model.getLatestChuDauTu().filter(t=>(t.maChuDauTu||"").toLowerCase().includes(s)||(t.tenChuDauTu||"").toLowerCase().includes(s)||(t.tenVietTat||"").toLowerCase().includes(s)||t.maSoThue&&t.maSoThue.includes(s));B(i,h,o),n=i.length,c=I(i,u,r),l.dataComplete({cacheHit:!0,localSnapshot:!0})}return n===0?(b(e),L(e,{colspan:8,message:"Không tìm thấy Chủ đầu tư nào phù hợp",icon:"building",pagination:document.getElementById("chudautu-pagination")})):(R(e,c,i=>{const t=d;this.model.state.selectedChuDauTuVersion||(this.model.state.selectedChuDauTuVersion={});const{rootId:T,versions:C,displayed:a}=M(this.model.state.chudautu,i,this.model.state.selectedChuDauTuVersion),$=k({versions:C,selectedId:a.id,rootId:T,changeAction:"change-investor-version"}),D=N(P({id:a.id,editCommand:"edit-investor",deleteCommand:"delete-investor",allowDelete:this.model.state.activerole!=="employee"}),{visible:a.id===i.id&&a.canEdit!==!1});return`
            <tr>
                <td>
                    <div class="bf-s-8c8dc52ed7">
                        <a href="#" data-bf-action="show-investor" data-id="${p(a.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Chủ đầu tư"><span class="detail-code partner-identity-code bf-s-dc5de304c3">${t(g(a.maChuDauTu))}</span></a>
                        <span class="bf-s-db1d8f859f">-</span>
                        ${$}
                    </div>
                </td>
                <td class="fw-bold text-wrap bf-s-2281f122ad">
                    ${t(a.tenChuDauTu||"")}
                    ${a.tenVietTat?`<div class="bf-s-92c49ab355">Tên viết tắt: ${t(a.tenVietTat)}</div>`:""}
                    ${a.coQuanChuQuan?`<div class="bf-s-92c49ab355">CQ chủ quản: ${t(a.coQuanChuQuan)}</div>`:""}
                </td>
                <td>${t(a.maSoThue||"--")}</td>
                <td><span class="fw-bold">${t(a.danhXung||"Ông")} ${t(a.daiDienCdt||"--")}</span></td>
                <td class="text-wrap bf-s-e7d9f0dfa1">
                    <div class="fw-bold bf-s-6bcb39735e">${t((a.diaChi||"").replace(/\s*\|\s*/g,", "))}</div>
                    <div class="bf-s-06f7fa3856">${t(a.soDienThoai||"")}${a.email?" | "+t(a.email):""}</div>
                </td>
                <td>
                    <div class="fw-bold bf-s-6bcb39735e">${t(a.soTaiKhoan||"--")}</div>
                    <div class="bf-s-06f7fa3856">${t(a.noiMoTaiKhoan||"--")}${a.maQHNS?" | QHNS: "+t(a.maQHNS):""}</div>
                </td>
                <td class="text-right">
                    ${D}
                </td>
            </tr>
            `},{colSpan:7,rowHeight:82,onRender:()=>lucide.createIcons({root:e})}),m("renderTablePagination","chudautu-pagination",n,u,r)),lucide.createIcons({root:e}),this.enhanceTableHeaders("chudautu-table","chudautu"),{performance:l.complete()}}function Z(l){const e=document.getElementById("tab-chudautu-detail");if(!e||!e.classList.contains("active")){m("switchTab","chudautu-detail",l);return}this.model.state.chudautu.find(s=>s.id===l)&&this.renderChuDauTuVersionDetails(l)}function _(l){const e=this.model.state.chudautu.find(i=>i.id===l);if(!e)return;const s=V(E(this.model.state.chudautu,e)),c=s[0]&&s[0].id===l,n=document.getElementById("btn-edit-chudautu-fullpage");n&&(c&&e.canEdit!==!1?(f(n,"display","flex"),n.onclick=()=>{m("editChuDauTu",l)}):f(n,"display","none"));const u=s.map(i=>{const t=String(parseInt(i.phienBan||0)).padStart(2,"0");return`<option value="${p(i.id)}" ${i.id===l?"selected":""}>${d(t)}</option>`}).join(""),r=`
        <select id="fullpage-cdt-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;" ${s.length<2?"disabled":""}>
            ${u}
        </select>
    `,v=(e.diaChi||"").split(" | ").filter(Boolean).join(", "),h=`
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code partner-identity-code bf-s-018b1c91c7">${d(g(e.maChuDauTu,"--"))}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        ${r}
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${d(e.tenChuDauTu||"Chủ đầu tư chưa có tên")}</h4>
            </div>

            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Ngày áp dụng</div>
                    <div class="detail-value fw-bold">${d(e.ngayApDung?this.model.formatDate(e.ngayApDung):"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã số thuế</div>
                    <div class="detail-value fw-bold">${d(e.maSoThue||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt</div>
                    <div class="detail-value fw-bold">${d(e.tenVietTat||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Đại diện CĐT</div>
                    <div class="detail-value">${d(e.daiDienCdt?`${e.danhXung||""} ${e.daiDienCdt}`.trim():"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đại diện</div>
                    <div class="detail-value">${d(e.chucVuDaiDien||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đứng đầu</div>
                    <div class="detail-value">${d(e.chucVuNguoiDungDau||"--")}</div>
                </div>
                <div class="detail-item bf-s-6d00fde401">
                    <div class="detail-label">Địa chỉ</div>
                    <div class="detail-value">${d(v||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số điện thoại</div>
                    <div class="detail-value">${d(e.soDienThoai||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Email liên hệ</div>
                    <div class="detail-value">${d(e.email||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số tài khoản</div>
                    <div class="detail-value fw-bold text-blue">${d(e.soTaiKhoan||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Nơi mở tài khoản</div>
                    <div class="detail-value">${d(e.noiMoTaiKhoan||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã QHNS</div>
                    <div class="detail-value">${d(e.maQHNS||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Cơ quan chủ quản</div>
                    <div class="detail-value">${d(e.coQuanChuQuan||"--")}</div>
                </div>
            </div>
        </div>
    `,o=document.getElementById("fullpage-chudautu-content");if(o){o.innerHTML=w(h);const i=document.getElementById("fullpage-cdt-version-select");i&&(s.length>=2?i.onchange=t=>{this.renderChuDauTuVersionDetails(t.target.value)}:i.onchange=null,y("fullpage-cdt-version-select")),S(o,lucide)}}export{Y as renderChuDauTuTable,_ as renderChuDauTuVersionDetails,Z as showChuDauTuDetails};
