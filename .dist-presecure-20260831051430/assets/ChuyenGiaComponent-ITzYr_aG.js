import{a as y,n as a,u as b}from"./view_helpers-CdPIbaii.js";import{ct as G}from"./app-RPlYyKwL.js";import{t as P}from"./commandBus-CHqMiCNa.js";import{t as V}from"./controllerRef-BPg74dXx.js";import{t as E}from"./perfDiagnostics-rZdUYj0C.js";import{d as A,g as B,l as N,r as z}from"./tableDataUtils-jcjOH8y4.js";import{a as H,i as L,n as _,o as k,r as q,s as K,t as $}from"./virtualTable-HKeI84Ao.js";import{n as M,t as O}from"./VersionSelector-CtR_Sh95.js";async function Z({reuseCurrentPage:v=!1}={}){const e=E("chuyengia","chuyengia"),h=document.getElementById("chuyengia-table");if(!h)return;const i=h.querySelector("tbody"),o=document.getElementById("search-chuyengia").value.toLowerCase(),C=(this._chuyenGiaRenderRequestId||0)+1;this._chuyenGiaRenderRequestId=C;let n=[],c=0;const p=this.model.currentPage.chuyengia||1,l=this.model.pageSize||10,m=this.model.sortState.chuyengia||{},g=m.field||"",r=m.order||"asc",f=JSON.stringify([p,l,o,g,r]);if(this.model.useServerSidePagination){const s=this._chuyenGiaPageSnapshot,d={page:p,pageSize:l,search:o,sortBy:g,sortOrder:r},u=z(this.model,"chuyengia",d);if(v&&s?.key===f)n=s.items,c=s.totalItems,e.dataComplete({cacheHit:!0,prefetched:!!u?.prefetched});else{u||K(i,7);try{const t=await N(this.model,"chuyengia",d,{cancellationOwner:"ui:expert-list"});if(C!==this._chuyenGiaRenderRequestId||!h.isConnected)return;n=t.items,c=t.totalItems,e.dataComplete(t),this._chuyenGiaPageSnapshot={key:f,items:n,totalItems:c}}catch(t){if(t?.name==="AbortError"||(console.error("Failed to fetch paginated experts",t),C!==this._chuyenGiaRenderRequestId||!h.isConnected))return;$(i),k(i,{colspan:7,message:"Không thể tải danh sách chuyên gia. Vui lòng thử lại.",onRetry:()=>this.renderChuyenGiaTable()});return}}}else{const s=this.model.getLatestChuyenGia().filter(d=>(d.hoTen||"").toLowerCase().includes(o)||(d.soCCCD||"").includes(o)||(d.soChungChi||"").toLowerCase().includes(o));B(s,g,r),c=s.length,n=A(s,p,l),e.dataComplete({cacheHit:!0,localSnapshot:!0})}return c===0?($(i),H(i,{colspan:7,message:"Không tìm thấy Chuyên gia nào phù hợp",icon:"user-x",pagination:document.getElementById("chuyengia-pagination")})):(_(i,n,s=>{this.model.state.selectedChuyenGiaVersion||(this.model.state.selectedChuyenGiaVersion={});const{rootId:d,versions:u,displayed:t}=M(this.model.state.chuyengia,s,this.model.state.selectedChuyenGiaVersion),I=a(t.id),w=a(t.hoTen||""),x=q(L({id:t.id,editCommand:"edit-expert",deleteCommand:"delete-expert",allowDelete:this.model.state.activerole!=="employee"}),{visible:t.id===s.id}),D=a(t.soCCCD||""),S=a(t.soChungChi||""),T=a(t.donViCapChungChi||"--"),R=a(t.ngayCapChungChi?y(t.ngayCapChungChi):"--");return`
            <tr>
                <td class="fw-bold">
                    <div class="bf-s-8c8dc52ed7">
                        <a href="#" data-bf-action="show-expert" data-id="${I}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết lý lịch"><span class="bf-s-dc5de304c3">${w}</span></a>
                        <span class="bf-s-db1d8f859f">-</span>
                        ${O({versions:u,selectedId:t.id,rootId:d,changeAction:"change-expert-version"})}
                    </div>
                </td>
                <td>${D}</td>
                <td><span class="badge badge-info">${S}</span></td>
                <td class="text-muted text-wrap bf-s-0569d2208a">${T}</td>
                <td>${R}</td>
                <td class="text-right">
                    ${x}
                </td>
            </tr>
            `},{colSpan:7,rowHeight:76,onRender:()=>lucide.createIcons({root:i})}),P("renderTablePagination","chuyengia-pagination",c,p,l)),lucide.createIcons({root:i}),this.enhanceTableHeaders("chuyengia-table","chuyengia"),{performance:e.complete()}}function ee(v){if(!document.getElementById("modal-detail-chuyengia")){V()?.ensureLazyModal?.("modal-detail-chuyengia").then(()=>this.showChuyenGiaDetails(v));return}const e=this.model.state.chuyengia.find(t=>t.id===v);if(!e)return;const h=a(e.hoTen||""),i=a(e.soCCCD||"--"),o=a(e.ngayCapCCCD?y(e.ngayCapCCCD):"--"),C=a(e.noiCapCCCD||"--"),n=a(e.soChungChi||"--"),c=a(e.ngayCapChungChi?y(e.ngayCapChungChi):"--"),p=a(e.donViCapChungChi||"--"),l=a(e.id),m=e.updatedAt||e.createdAt,g=b(e.anhChuKy,m),r=b(e.anhChungChi,m),f=a(String(e.hoTen||"?").split(" ").map(t=>t[0]).pop().toUpperCase()),s=a(e.tenAnhChungChi||(e.soCCCD?`CC_${e.soCCCD}.png`:"--")),d=a(e.tenAnhChuKy||(e.soCCCD?`CK_${e.soCCCD}.png`:"--")),u=`
        <div class="expert-profile-grid">
            <div class="profile-passport-card">
                <div class="profile-passport-avatar">${f}</div>
                <div class="profile-passport-name">${h}</div>

                <div class="passport-details-list">
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Số CCCD</div>
                        <div class="passport-detail-val fw-bold">${i}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Ngày cấp CCCD</div>
                        <div class="passport-detail-val">${o}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Nơi cấp CCCD</div>
                        <div class="passport-detail-val">${C}</div>
                    </div>
                </div>

                <div class="bf-s-cfec463e2f">
                    <div class="passport-detail-label bf-s-06e0ec735a">Ảnh chữ ký chuyên gia</div>
                    <div class="signature-display-frame" data-bf-action="zoom-signature" data-id="${l}" title="Bấm để phóng to">
                        ${g?`<img src="${g}" alt="Chữ ký" loading="lazy" decoding="async" class="bf-s-bbda643b79">`:'<span class="text-muted bf-s-e0f1c448f7">Chưa có ảnh chữ ký</span>'}
                    </div>
                    <div class="bf-s-1dbc45152f">📁 ${d}</div>
                </div>
            </div>

            <div class="expert-profile-details">
                <div class="expert-cert-viewer">
                    <div class="expert-cert-title-bar">
                        <h5>Chứng chỉ Hành nghề Đấu thầu</h5>
                        <span class="badge badge-info">Số CC: ${n}</span>
                    </div>

                    <div class="passport-details-list bf-s-d75ff7bc6b">
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Số chứng chỉ</div>
                            <div class="passport-detail-val fw-bold text-blue">${n}</div>
                        </div>
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Ngày cấp</div>
                            <div class="passport-detail-val">${c}</div>
                        </div>
                        <div class="passport-detail-row bf-s-6d00fde401">
                            <div class="passport-detail-label">Đơn vị cấp chứng chỉ</div>
                            <div class="passport-detail-val fw-bold">${p}</div>
                        </div>
                    </div>

                    <div class="passport-detail-label bf-s-06e0ec735a">Ảnh chụp chứng chỉ thực tế</div>
                    <div class="cert-image-frame" data-bf-action="zoom-certificate" data-id="${l}">
                        ${r?`<img src="${r}" alt="Ảnh chứng chỉ" loading="lazy" decoding="async">`:'<div class="bf-s-ace9d4de5c">Chưa có ảnh chứng chỉ</div>'}
                        ${r?'<div class="cert-zoom-overlay"><i data-lucide="zoom-in"></i> Phóng to</div>':""}
                    </div>
                    <div class="bf-s-1dbc45152f">📁 ${s}</div>
                </div>
            </div>
        </div>
    `;document.getElementById("detail-chuyengia-content").innerHTML=G(u),this.openModal("modal-detail-chuyengia"),lucide.createIcons({root:document.getElementById("detail-chuyengia-content")})}export{Z as renderChuyenGiaTable,ee as showChuyenGiaDetails};
