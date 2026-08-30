import{r as K}from"./runtimeStyles-DWYSnTnQ.js";import{s as V}from"./formatters-BTdVYNR8.js";import{i as C,l as I,n as e,r as S,s as N}from"./view_helpers-CdPIbaii.js";import{a as F,ct as G}from"./app-RPlYyKwL.js";import{i as A}from"./domUtils-ByCXOQ5o.js";import{t as x}from"./commandBus-CHqMiCNa.js";import{t as O}from"./controllerRef-BPg74dXx.js";import{t as X}from"./VersionFamilyLoader-wx7GpB-n.js";import{t as z}from"./perfDiagnostics-rZdUYj0C.js";import{d as Y,g as W,l as _,r as J,u as U}from"./tableDataUtils-jcjOH8y4.js";import{t as M}from"./statusBadges-D3phV6l3.js";import{t as Z}from"./YearMonthFilter-BSoomVCy.js";import{a as tt,i as at,n as et,o as st,r as it,s as nt,t as P}from"./virtualTable-HKeI84Ao.js";import{n as dt,t as ot}from"./VersionSelector-CtR_Sh95.js";import{n as L}from"./MultiAssigneeSelect-BBMZi3Wq.js";import{n as lt}from"./ActivityTimeline-Oi4tX8mT.js";async function It(){const i=z("hopdong","hopdong"),t=document.getElementById("hopdong-table").querySelector("tbody"),r=document.getElementById("search-hopdong").value.toLowerCase(),o=document.getElementById("filter-hopdong-nam"),n=document.getElementById("filter-hopdong-thang"),p=this.model.state.hopdong||[];o&&n&&(Z({records:p,getDate:l=>l.ngayKy,yearSelect:o,monthSelect:n}),N("filter-hopdong-nam"),N("filter-hopdong-thang"));const u=o?o.value:"",h=n?n.value:"";let v=[],g=0;const b=this.model.currentPage.hopdong||1,f=this.model.pageSize||10,H=this.model.sortState.hopdong||{},m=H.field||"",y=H.order||"asc";if(this.model.useServerSidePagination){const l={page:b,pageSize:f,search:r,sortBy:m,sortOrder:y,nam:u,thang:h};J(this.model,"hopdong",l)||nt(t,11);try{const d=await _(this.model,"hopdong",l,{cancellationOwner:"ui:contract-list"});v=d.items,g=d.totalItems,i.dataComplete(d)}catch(d){if(d?.name==="AbortError")return;console.error("Failed to fetch paginated contracts",d),P(t),st(t,{colspan:11,message:"Không thể tải danh sách hợp đồng. Vui lòng thử lại.",onRetry:()=>this.renderHopDongTable()});return}}else{const l=this.model.getLatestHopDong().filter(d=>{const T=L(this.model,d.id,"hopdong").join(" ").toLowerCase();return((d.soHopDong||"").toLowerCase().includes(r)||(d.tenHopDong||"").toLowerCase().includes(r)||T.includes(r))&&U(d.ngayKy,u,h)});W(l,m,y),g=l.length,v=Y(l,b,f),i.dataComplete({cacheHit:!0,localSnapshot:!0})}return g===0?(P(t),tt(t,{colspan:11,message:"Không tìm thấy Hợp đồng nào phù hợp",icon:"file-check-2",pagination:document.getElementById("hopdong-pagination")})):(et(t,v,l=>{this.model.state.selectedHopDongVersion||(this.model.state.selectedHopDongVersion={});const{rootId:d,versions:T,displayed:s}=dt(this.model.state.hopdong,l,this.model.state.selectedHopDongVersion),a=ot({versions:T,selectedId:s.id,rootId:d,changeAction:"change-contract-version"}),c=(Array.isArray(this.model.state.chudautu)?this.model.state.chudautu:[]).find(w=>w.id===s.chuDauTuId),$=c?c.tenChuDauTu:"--",D=(Array.isArray(this.model.state.nhathau)?this.model.state.nhathau:[]).find(w=>w.id===s.nhaThauId),B=D?D.tenNhaThau:"--",R=D?.id?`<a href="#" data-bf-action="show-contractor" data-id="${e(D.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${e(B)}</a>`:e(B),q=M(s.trangThaiHopDong||"Đang thực hiện",this.model.state.customcontractstatuses),E=!!this.model.state.activeuser?.wordExportEnabled,k=s.goiThauIds?.length?[{id:s.goiThauIds[0],command:"export-contract",className:"btn-export",title:E?"Xuất hợp đồng":"Cần gói trả phí đang hoạt động để xuất Word",icon:"file-text",disabled:!E,style:"color: var(--emerald);",attributes:{"contract-no":s.soHopDong}}]:[];k.push(...at({id:s.id,editCommand:"edit-contract",deleteCommand:"delete-contract",allowDelete:this.model.state.activerole!=="employee"}));const j=it(k,{visible:s.id===l.id}),Q=L(this.model,s.id,"hopdong");return`
                <tr>
                    <td>
                        <div class="bf-s-8c8dc52ed7">
                            <a href="#" data-bf-action="show-contract" data-id="${I(s.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Hợp đồng"><span class="detail-code link-hover bf-s-dc5de304c3">${e(s.soHopDong)}</span></a>
                            <span class="bf-s-db1d8f859f">-</span>
                            ${a}
                        </div>
                    </td>
                    <td class="fw-bold text-wrap bf-s-0569d2208a">${e(s.tenHopDong)}<small class="assignee-summary">${e(Q.join(", ")||"Chưa phân công")}</small></td>
                    <td>${s.ngayKy?C(s.ngayKy):"--"}</td>
                    <td class="text-wrap bf-s-3ce088a59b">${e($)}</td>
                    <td class="text-wrap bf-s-3ce088a59b">${R}</td>
                    <td class="fw-bold text-blue">${S(s.giaTri)}</td>
                    <td><span class="badge badge-info">${e(s.loaiHopDong||"Trọn gói")}</span></td>
                    <td><span class="badge badge-secondary bf-s-f9ecd915ac">${e(s.phanLoai||"Tư vấn")}</span></td>
                    <td>${e(s.soNgayThucHien?isNaN(s.soNgayThucHien)?s.soNgayThucHien:`${s.soNgayThucHien} ngày`:"--")}</td>
                    <td>${q}</td>
                    <td class="text-right">
                        ${j}
                    </td>
                </tr>
            `},{colSpan:11,rowHeight:86,onRender:()=>lucide.createIcons({root:t})}),x("renderTablePagination","hopdong-pagination",g,b,f)),lucide.createIcons({root:t}),this.enhanceTableHeaders("hopdong-table","hopdong"),{performance:i.complete()}}function St(i,t=!1){let r=i;if(!t){const n=this.model.getLatestContract(i);n&&(r=n.id)}i=r;const o=document.getElementById("tab-hopdong-detail");if(!o||!o.classList.contains("active")){x("switchTab","hopdong-detail",i);return}this.model.state.hopdong.find(n=>n.id===i)&&this.renderContractVersionDetails(i)}async function wt(i){const t=this.model.state.hopdong.find(a=>a.id===i);if(!t)return;await X(O(),"hopdong",t);const r=document.getElementById("btn-edit-hopdong-fullpage");if(r){const a=this.model.getLatestContract(i);a&&a.id===i?(K(r,"display","flex"),r.onclick=()=>{x("editHopDong",i)}):K(r,"display","none")}const o=this.model.state.chudautu.find(a=>a.id===t.chuDauTuId),n=this.model.state.nhathau.find(a=>a.id===t.nhaThauId),p=this.model.state.chudautu.find(a=>a.id===t.chuDauTuThanhLyId),u=this.model.state.nhathau.find(a=>a.id===t.nhaThauThanhLyId),h=this.model.state.kehoach.find(a=>String(a.id)===String(t.keHoachId)),v=this.model.state.goithau||[],g=(t.goiThauIds||[]).map(a=>v.find(c=>String(c.id)===String(a))).filter(Boolean),b=M(t.trangThaiHopDong||"Đang thực hiện",this.model.state.customcontractstatuses),f=t.rootId||t.id,H=this.model.state.hopdong.filter(a=>(a.rootId||a.id)===f),m={};H.forEach(a=>{const c=a.phienBan||"00";(!m[c]||a.isLatest==1)&&(m[c]=a)});const y=Object.values(m),l=L(this.model,t.id,"hopdong");y.sort((a,c)=>{const $=parseInt(a.phienBan||0);return parseInt(c.phienBan||0)-$});const d=`
        <select id="fullpage-hd-version-select" class="page-version-select bf-s-0c44a9336a">
            ${y.map(a=>{const c=a.phienBan||"00",$=String(parseInt(c)).padStart(2,"0");return`<option value="${I(a.id)}" ${a.id===i?"selected":""}>${e($)}</option>`}).join("")}
        </select>
    `,T=`
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code bf-s-018b1c91c7">${e(t.soHopDong||"--")}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        ${d}
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${e(t.tenHopDong||"Hợp đồng không có tên")}</h4>
                <div class="bf-s-2d505736cb">
                    ${b}
                </div>
            </div>

            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Số hợp đồng</div>
                    <div class="detail-value fw-bold text-blue">${e(t.soHopDong||"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày ký hợp đồng</div>
                    <div class="detail-value">${t.ngayKy?C(t.ngayKy):"--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày thanh lý hợp đồng</div>
                    <div class="detail-value">${t.ngayThanhLy?C(t.ngayThanhLy):"Chưa thanh lý"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Giá trị hợp đồng</div>
                    <div class="detail-value text-blue fw-bold bf-s-61f44adbb8">${S(t.giaTri)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại hợp đồng</div>
                    <div class="detail-value"><span class="badge badge-info">${e(t.loaiHopDong||"Trọn gói")}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phân loại</div>
                    <div class="detail-value"><span class="badge badge-secondary bf-s-f9ecd915ac">${e(t.phanLoai||"Tư vấn")}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian thực hiện</div>
                    <div class="detail-value">${e(t.soNgayThucHien?isNaN(t.soNgayThucHien)?t.soNgayThucHien:`${t.soNgayThucHien} ngày`:"--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Người phụ trách</div>
                    <div class="detail-value">${e(l.join(", ")||"Chưa phân công")}</div>
                </div>
            </div>

            <div class="detail-grid bf-s-090b21d06a">
                <div class="detail-item">
                    <div class="detail-label">Quyết định chỉ định thầu</div>
                    <div class="detail-value">${t.coQdChiDinh===1?'<span class="badge badge-success">Có quyết định</span>':'<span class="badge badge-secondary">Không</span>'}</div>
                </div>
                ${t.coQdChiDinh===1?`
                    <div class="detail-item">
                        <div class="detail-label">Số quyết định chỉ định</div>
                        <div class="detail-value fw-bold">${e(t.soQdChiDinh||"--")}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Ngày quyết định chỉ định</div>
                        <div class="detail-value">${t.ngayQdChiDinh?C(t.ngayQdChiDinh):"--"}</div>
                    </div>
                `:""}
            </div>

            <div class="detail-sub-section bf-s-a005516828">
                <h5 class="detail-sub-title">Thông tin Chủ đầu tư</h5>
                ${o?`
                    <div class="associated-item">
                        <div>
                            <strong class="bf-s-a91dac6c9e">${e(o.tenChuDauTu)}</strong><br>
                            <small class="text-muted">Mã số thuế: ${e(o.maSoThue||"--")} | Địa chỉ: ${e((o.diaChi||"").replace(/\s*\|\s*/g,", "))}</small>
                        </div>
                        <span class="associated-badge partner-identity-code">${e(A(o.maChuDauTu,"--"))}</span>
                    </div>
                `:'<div class="text-muted"><small>Không tìm thấy thông tin chủ đầu tư.</small></div>'}
            </div>

            ${t.ngayThanhLy?`
            <div class="detail-sub-section bf-s-a005516828">
                <h5 class="detail-sub-title">Thông tin đối tác tại thời điểm thanh lý</h5>
                <div class="associated-item">
                    <div><strong>Chủ đầu tư:</strong> ${e(p?.tenChuDauTu||"--")} (phiên bản ${e(p?V(p.phienBan):"--")})</div>
                    <div><strong>Nhà thầu:</strong> ${e(u?.tenNhaThau||"--")} (phiên bản ${e(u?V(u.phienBan):"--")})</div>
                </div>
            </div>`:""}

            <div class="detail-sub-section bf-s-a005516828">
                <h5 class="detail-sub-title">Thông tin Nhà thầu trúng thầu</h5>
                ${n?`
                    <div class="associated-item">
                        <div>
                            <strong class="bf-s-a91dac6c9e">${e(n.tenNhaThau)}</strong><br>
                            <small class="text-muted">Mã số thuế: ${e(n.maSoThue||"--")} | Đại diện: ${e(n.nguoiDaiDien||"--")}</small>
                        </div>
                        <span class="associated-badge partner-identity-code">${e(A(n.maNhaThau,"nha_thau"))}</span>
                    </div>
                `:'<div class="text-muted"><small>Không tìm thấy thông tin nhà thầu.</small></div>'}
            </div>

            ${h?`
                <div class="detail-sub-section bf-s-a005516828">
                    <h5 class="detail-sub-title">Kế hoạch lựa chọn nhà thầu liên kết</h5>
                    <div class="associated-item bf-s-ecfbb78629" data-bf-action="show-plan" data-id="${I(h.id)}">
                        <div>
                            <strong class="bf-s-bafb444301">${e(h.tenKeHoach)}</strong><br>
                            <small class="text-muted">Mã KH: ${e(h.maKeHoach||"--")} | Tổng mức: ${S(h.tongMucDauTu)}</small>
                        </div>
                    </div>
                </div>
            `:""}

            <div class="detail-sub-section bf-s-a005516828">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">Các gói thầu thuộc hợp đồng (${g.length})</h5>
                <div class="associated-list">
                    ${g.length>0?g.map(a=>`
                        <div class="associated-item bf-s-ecfbb78629" data-bf-action="show-package" data-id="${I(a.id)}">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue bf-s-0f88141c20"></i>
                                <span><strong>${e(a.maGoiThau||"--")}</strong> - ${e(a.tenGoiThau||"--")}</span>
                            </div>
                            <span class="badge badge-success">${S(a.giaGoiThau)}</span>
                        </div>
                    `).join(""):'<div class="text-muted"><small>Hợp đồng này chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
            <section class="detail-sub-section activity-panel" aria-label="Lịch sử chỉnh sửa">
                <h5 class="detail-sub-title">Lịch sử chỉnh sửa</h5>
                <div data-contract-activity></div>
            </section>
        </div>
    `,s=document.getElementById("fullpage-hopdong-content");if(s){s.innerHTML=G(T);const a=document.getElementById("fullpage-hd-version-select");a&&(a.onchange=c=>{this.renderContractVersionDetails(c.target.value)},N("fullpage-hd-version-select")),F(s,lucide),lt(s.querySelector("[data-contract-activity]"),{targetType:"hopdong",targetId:t.id,isCurrent:()=>document.getElementById("fullpage-hd-version-select")?.value===t.id})}}export{wt as renderContractVersionDetails,It as renderHopDongTable,St as showHopDongDetails};
