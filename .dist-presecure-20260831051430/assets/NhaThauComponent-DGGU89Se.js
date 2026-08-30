import{r as V}from"./runtimeStyles-DWYSnTnQ.js";import{l as C,n as i,s as E,u as A}from"./view_helpers-CdPIbaii.js";import{a as H,ct as I}from"./app-RPlYyKwL.js";import{i as D}from"./domUtils-ByCXOQ5o.js";import{t as L}from"./commandBus-CHqMiCNa.js";import{i as k,l as B,u as P}from"./versionResolver-C4iQLmXG.js";import{t as R}from"./perfDiagnostics-rZdUYj0C.js";import{d as K,g as M,l as X,r as j}from"./tableDataUtils-jcjOH8y4.js";import{a as F,i as O,n as z,o as q,r as _,s as G,t as x}from"./virtualTable-HKeI84Ao.js";import{n as J,t as Q}from"./VersionSelector-CtR_Sh95.js";import{o as U}from"./contractorVersionBinding-CLPoZrqc.js";function W(c,e){const s=Array.isArray(c?.state?.nhathau)?c.state.nhathau:[],h=s.find(l=>String(l.id)===String(e));return h&&k(s,h)?.id||e}async function ha(){const c=R("nhathau","nhathau"),e=document.getElementById("nhathau-table").querySelector("tbody"),s=document.getElementById("search-nhathau").value.toLowerCase();let h=[],l=0;const u=this.model.currentPage.nhathau||1,b=this.model.pageSize||10,$=this.model.sortState.nhathau||{},m=$.field||"",g=$.order||"asc";if(this.model.useServerSidePagination){const t={page:u,pageSize:b,search:s,sortBy:m,sortOrder:g};j(this.model,"nhathau",t)||G(e,8);try{const d=await X(this.model,"nhathau",t,{cancellationOwner:"ui:contractor-list"});h=d.items,l=d.totalItems,c.dataComplete(d)}catch(d){if(d?.name==="AbortError")return;console.error("Failed to fetch paginated contractors",d),x(e),q(e,{colspan:8,message:"Không thể tải danh sách nhà thầu. Vui lòng thử lại.",onRetry:()=>this.renderNhaThauTable()});return}}else{const t=this.model.getLatestNhaThau().filter(d=>(d.maNhaThau||"").toLowerCase().includes(s)||(d.tenNhaThau||"").toLowerCase().includes(s)||(d.tenVietTat||"").toLowerCase().includes(s)||d.maSoThue&&d.maSoThue.includes(s)||d.loaiNhaThau==="Liên danh"&&d.thanhVienLienDanh&&d.thanhVienLienDanh.some(r=>(r.tenNhaThau||"").toLowerCase().includes(s)||(r.maSoThue||"").includes(s)));M(t,m,g),l=t.length,h=K(t,u,b),c.dataComplete({cacheHit:!0,localSnapshot:!0})}if(l===0)x(e),F(e,{colspan:8,message:"Không tìm thấy Nhà thầu nào phù hợp",icon:"shield-alert",pagination:document.getElementById("nhathau-pagination")});else{const t=i;z(e,h,d=>{this.model.state.selectedNhaThauVersion||(this.model.state.selectedNhaThauVersion={});const{rootId:r,versions:o,displayed:a}=J(this.model.state.nhathau,d,this.model.state.selectedNhaThauVersion),p=Q({versions:o,selectedId:a.id,rootId:r,changeAction:"change-contractor-version"}),T=_(O({id:a.id,editCommand:"edit-contractor",deleteCommand:"delete-contractor",allowDelete:this.model.state.activerole!=="employee"}),{visible:a.id===d.id&&a.canEdit!==!1});if(a.loaiNhaThau==="Liên danh"){const n=a.thanhVienLienDanh||[],v=n.map(S=>t(S.tenNhaThau||"")).join("<br>+ "),f=n.map(S=>t(S.maSoThue||"")).join(", "),N=n.length>0?`${t(n[0].danhXung||"Ông")} ${t(n[0].nguoiDaiDien||"--")} (Trưởng LD)`:"--",y=n.length>0?`<small>SĐT: ${t(n[0].soDienThoai||"--")}</small><br><small>Email: ${t(n[0].email||"--")}</small>`:"--",w=n.length>0?`<div class="fw-bold bf-s-6bcb39735e">${t(n[0].soTaiKhoan||"--")}</div><div class="bf-s-06f7fa3856">${t(n[0].noiMoTaiKhoan||"--")} (+${n.length-1} TV)</div>`:"--";return`
                    <tr>
                        <td>
                            <div class="bf-s-8c8dc52ed7">
                                <a href="#" data-bf-action="show-contractor" data-id="${t(a.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Nhà thầu"><span class="detail-code partner-identity-code bf-s-dc5de304c3">${t(D(a.maNhaThau))}</span></a>
                                <span class="bf-s-db1d8f859f">-</span>
                                ${p}
                            </div>
                        </td>
                        <td class="fw-bold text-wrap bf-s-e7d9f0dfa1">
                            <a href="#" data-bf-action="show-contractor" data-id="${t(a.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${t(a.tenNhaThau||"")}</a>
                            ${a.tenVietTat?`<div class="bf-s-92c49ab355">Tên viết tắt: ${t(a.tenVietTat)}</div>`:""}
                            <div class="bf-s-597bc8fb90"><span class="badge badge-info">Liên danh (${n.length} TV)</span></div>
                            <div class="bf-s-77e56bd1c2">
                                + ${v}
                            </div>
                        </td>
                        <td><small>${f}</small></td>
                        <td>${N}</td>
                        <td>${y}</td>
                        <td>${w}</td>
                        <td class="text-right">
                            ${T}
                        </td>
                    </tr>
                `}else{const n=`${t(a.danhXung||"Ông")} ${t(a.nguoiDaiDien||"--")}`,v=`<small>SĐT: ${t(a.soDienThoai||"--")}</small><br><small>Email: ${t(a.email||"--")}</small>`,f=`<div class="fw-bold bf-s-6bcb39735e">${t(a.soTaiKhoan||"--")}</div><div class="bf-s-06f7fa3856">${t(a.noiMoTaiKhoan||"--")}${a.maNganHang?" ("+t(a.maNganHang)+")":""}</div>`;return`
                    <tr>
                        <td>
                            <div class="bf-s-8c8dc52ed7">
                                <a href="#" data-bf-action="show-contractor" data-id="${t(a.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Nhà thầu"><span class="detail-code partner-identity-code bf-s-dc5de304c3">${t(D(a.maNhaThau))}</span></a>
                                <span class="bf-s-db1d8f859f">-</span>
                                ${p}
                            </div>
                        </td>
                        <td class="fw-bold text-wrap bf-s-e7d9f0dfa1">
                            <a href="#" data-bf-action="show-contractor" data-id="${t(a.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${t(a.tenNhaThau||"")}</a>
                            ${a.tenVietTat?`<div class="bf-s-92c49ab355">Tên viết tắt: ${t(a.tenVietTat)}</div>`:""}
                        </td>
                        <td>${t(a.maSoThue||"--")}</td>
                        <td>${n}</td>
                        <td>${v}</td>
                        <td>${f}</td>
                        <td class="text-right">
                            ${T}
                        </td>
                    </tr>
                `}},{colSpan:7,rowHeight:92,onRender:()=>lucide.createIcons({root:e})}),L("renderTablePagination","nhathau-pagination",l,u,b)}return lucide.createIcons({root:e}),this.enhanceTableHeaders("nhathau-table","nhathau"),{performance:c.complete()}}function Y(c,{skipDetailLoad:e=!1}={}){const s=W(this.model,c);if(!e&&typeof this.ensureDetailRecordLoaded=="function"){const l=this.ensureDetailRecordLoaded("nhathau-detail",s);if(l)return l.then(u=>Y.call(this,u?.id||s,{skipDetailLoad:!0}))}const h=document.getElementById("tab-nhathau-detail");if(!h||!h.classList.contains("active")){L("switchTab","nhathau-detail",s);return}this.model.state.nhathau.find(l=>l.id===s)&&this.renderNhaThauVersionDetails(s)}function ra(c){const e=this.model.state.nhathau.find(o=>o.id===c);if(!e)return;const s=B(P(this.model.state.nhathau,e)),h=s[0]&&s[0].id===c,l=document.getElementById("btn-edit-nhathau-fullpage");l&&(h&&e.canEdit!==!1?(V(l,"display","flex"),l.onclick=()=>{L("editNhaThau",c)}):V(l,"display","none"));const u=s.map(o=>{const a=String(parseInt(o.phienBan||0)).padStart(2,"0");return`<option value="${C(o.id)}" ${o.id===c?"selected":""}>${i(a)}</option>`}).join(""),b=`
        <select id="fullpage-nt-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;" ${s.length<2?"disabled":""}>
            ${u}
        </select>
    `,$=(e.diaChi||"").split(" | ").filter(Boolean).join(", "),m=A(e.anhDau,e.updatedAt||e.createdAt),g=i(e.tenAnhDau||"Ảnh dấu nhà thầu");let t="";if(e.loaiNhaThau==="Liên danh"){const o=e.thanhVienLienDanh||[];t=`
            <div class="detail-grid bf-s-6f7f7fd51b">
                <div class="detail-item">
                    <div class="detail-label">Ngày áp dụng</div>
                    <div class="detail-value fw-bold">${i(e.ngayApDung?this.model.formatDate(e.ngayApDung):"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại nhà thầu</div>
                    <div class="detail-value"><span class="badge badge-info">Liên danh (${o.length} thành viên)</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số thành viên</div>
                    <div class="detail-value fw-bold">${o.length} TV</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt</div>
                    <div class="detail-value fw-bold">${i(e.tenVietTat||"--")}</div>
                </div>
            </div>

            <h5 class="detail-sub-title bf-s-e677e891f7">Danh sách thành viên liên danh</h5>
            <div class="associated-list">
                ${o.map((a,p)=>{const T=(a.diaChi||"").split(" | ").filter(Boolean).join(", "),n=U(this.model,a),v=i(n?.id||""),f=i(n?.tenNhaThau||a.tenNhaThau||"--"),N=i(D(n?.maNhaThau||n?.maSoThue||a.maNhaThau||a.maSoThue,"--")),y=v?`<a href="#" data-bf-action="show-contractor" data-id="${v}" class="text-blue link-hover">${f}</a>`:f,w=v?`<a href="#" data-bf-action="show-contractor" data-id="${v}" class="text-blue link-hover">${N}</a>`:N;return`
                        <div class="associated-item bf-s-cbe87aeaba">
                            <div class="bf-s-d21628051b">
                                <strong class="bf-s-81227e2dc7">${p+1}. ${y} ${p===0?'<span class="badge badge-primary bf-s-cef2961f3b">Trưởng Liên danh</span>':""}</strong>
                                <span class="badge badge-secondary bf-s-01d9db4be2">Mã/MST: ${w}</span>
                            </div>
                            <div class="bf-s-b373b969d2">
                                <div><span class="text-muted">Đại diện:</span> ${i(a.danhXung||"Ông")} ${i(a.nguoiDaiDien||"--")} (${i(a.chucVu||"--")})</div>
                                <div><span class="text-muted">Liên hệ:</span> SĐT: ${i(a.soDienThoai||"--")} | Email: ${i(a.email||"--")}</div>
                                <div class="bf-s-6d00fde401"><span class="text-muted">Tài khoản ngân hàng:</span> <strong>${i(a.soTaiKhoan||"--")}</strong> tại ${i(a.noiMoTaiKhoan||"--")} ${a.maNganHang?`(${i(a.maNganHang)})`:""}</div>
                                <div class="bf-s-6d00fde401"><span class="text-muted">Địa chỉ:</span> ${i(T||"--")}</div>
                            </div>
                        </div>
                    `}).join("")}
            </div>
        `}else t=`
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Ngày áp dụng</div>
                    <div class="detail-value fw-bold">${i(e.ngayApDung?this.model.formatDate(e.ngayApDung):"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại nhà thầu</div>
                    <div class="detail-value"><span class="badge badge-secondary bf-s-f9ecd915ac">Độc lập</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã số thuế</div>
                    <div class="detail-value fw-bold">${i(e.maSoThue||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt</div>
                    <div class="detail-value fw-bold">${i(e.tenVietTat||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Người đại diện</div>
                    <div class="detail-value">${i(e.nguoiDaiDien?`${e.danhXung||""} ${e.nguoiDaiDien}`.trim():"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đại diện</div>
                    <div class="detail-value">${i(e.chucVuDaiDien||"--")}</div>
                </div>
                <div class="detail-item bf-s-6d00fde401">
                    <div class="detail-label">Địa chỉ</div>
                    <div class="detail-value">${i($||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số điện thoại</div>
                    <div class="detail-value">${i(e.soDienThoai||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Email liên hệ</div>
                    <div class="detail-value">${i(e.email||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số tài khoản</div>
                    <div class="detail-value fw-bold text-blue">${i(e.soTaiKhoan||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Nơi mở tài khoản</div>
                    <div class="detail-value">${i(e.noiMoTaiKhoan||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã ngân hàng</div>
                    <div class="detail-value">${i(e.maNganHang||"--")}</div>
                </div>
            </div>
        `;const d=`
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code partner-identity-code bf-s-018b1c91c7">${i(D(e.maNhaThau,"--"))}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        ${b}
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${i(e.tenNhaThau||"Nhà thầu chưa có tên")}</h4>
            </div>
            ${t}
            ${m?`
              <div class="bf-s-a005516828">
                <h5 class="detail-sub-title">Ảnh dấu nhà thầu</h5>
                <div class="file-preview-container bf-s-a66ba50765">
                  <a href="${m}" target="_blank" rel="noopener noreferrer" title="Xem ảnh dấu">
                    <img src="${m}" alt="${g}" class="bf-s-fefe4d57e7">
                  </a>
                  <div class="text-muted bf-s-56af3282d2">${g}</div>
                </div>
              </div>
            `:""}
        </div>
    `,r=document.getElementById("fullpage-nhathau-content");if(r){r.innerHTML=I(d);const o=document.getElementById("fullpage-nt-version-select");o&&(s.length>=2?o.onchange=a=>{this.renderNhaThauVersionDetails(a.target.value)}:o.onchange=null,E("fullpage-nt-version-select")),H(r,lucide)}}export{ha as renderNhaThauTable,ra as renderNhaThauVersionDetails,W as resolveLatestNhaThauVersionId,Y as showNhaThauDetails};
