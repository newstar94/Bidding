import{r as g}from"./runtimeStyles-DWYSnTnQ.js";import{l as B,n as o}from"./view_helpers-CdPIbaii.js";import{ct as F}from"./app-RPlYyKwL.js";import{n as W,o as R}from"./MutationService-DkIl1rmN.js";import{t as q}from"./idUtils-BXB1QuPt.js";import{t as j}from"./commandBus-CHqMiCNa.js";import{l as U}from"./tableDataUtils-jcjOH8y4.js";import{i as z,s as X}from"./evaluationMethodRules-CW6GTI60.js";import{n as J}from"./MultiAssigneeSelect-BBMZi3Wq.js";import{t as N}from"./packageAppraisal-CP92vlFS.js";import{a as Z,l as V,o as aa}from"./VersionedEntityService-Bvs3ObLs.js";import{n as na,r as ea}from"./packagePlanApprovals-Rd0v7KFP.js";import{t as ta}from"./packageAggregateSnapshot-DUJk9Zai.js";import{t as oa}from"./AggregateVersionClient-D7Mb0H-o.js";var Q=Object.freeze(["assignments","goithauhanghoa","thongtinmothau","hanghoaduthaunhathau"]);function Y(n,e){return`${n?.getWorkspaceToken?.()||"workspace"}:${String(e||"")}`}function ia(n,e){n._completePackageAggregateCaches||=new Set,n._completePackageAggregateCaches.add(Y(n,e))}function sa(n,e){return n?.useServerSidePagination?n._completePackageAggregateCaches?.has(Y(n,e))===!0:typeof n?.getStorageHydrationStatus!="function"?!1:Q.every(a=>n.getStorageHydrationStatus(a)?.state==="ready")}function ca(){const n=new Error("Cần kết nối mạng và tải đầy đủ dữ liệu liên quan trước khi tạo phiên bản gói thầu.");return n.code="OFFLINE_PACKAGE_AGGREGATE_INCOMPLETE",n}async function ha(n,e){const a=n.model,i=String(e?.id||"");if(!i)return e;let c=e;if(e?.referenceOnly===!0&&typeof n.fetchRecordByLookup=="function"&&(c=await n.fetchRecordByLookup("goithau",i)||e),!a?.useServerSidePagination)return c;const t=String(c?.keHoachId||e?.keHoachId||"");return t?(await Promise.all(Q.map(async h=>{let l="";do{const T=await U(a,h,{pageSize:200,pagination:"cursor",sortBy:"id",sortOrder:"asc",keHoachId:t,...l?{cursor:l}:{}}),b=String(T?.nextCursor||"");if(!T?.hasMore||!b||b===l)break;l=b}while(l)})),ia(a,i),a.state.goithau.find(h=>String(h.id)===i)||c):c}function la(n,e){const a=String(n||"").trim(),i=String(e||"").trim();if(!a&&!i)return!1;if(!a||!i)return!0;const c=new Date(a),t=new Date(i);return Number.isNaN(c.getTime())||Number.isNaN(t.getTime())?a!==i:c.getTime()!==t.getTime()}function _(n,e){return String(n?.thoiGianDangTai||"").trim()?["thoiGianDangTai","thoiGianDongThau","thoiGianMoThau"].some(a=>la(n?.[a],e?.[a])):!1}function ra(n,e,a,{targetPackageId:i,targetPlanId:c,timestamp:t,createId:h}={}){if(!i||!e?.id)throw new Error("Không đủ dữ liệu để tạo snapshot gói thầu.");return ta(n,e,{targetPackageId:i,targetPlanId:c||e.keHoachId,packageVersion:aa(n.goithau,e),timestamp:t,overrides:a,createId:h})}function da(n){return n?.getWorkspaceToken?.()||""}function H(n,e){if(!e||n?.isWorkspaceCurrent?.(e)!==!1)return;const a=new Error("Workspace changed while saving package preparation");throw a.name="AbortError",a.code="WORKSPACE_CHANGED",a}function ua(n){const e=new Error(`Package ${n} is no longer available after authoritative refresh`);return e.code="AUTHORITATIVE_PACKAGE_UNAVAILABLE",e}async function pa(n,e,a,{generateRecordId:i=q,createAggregateVersion:c=oa}={}){const{model:t}=n,h={...a};N(h);const l=da(t),T=typeof n?.awaitAuthoritativeMutationBoundary=="function",b=T?await n.awaitAuthoritativeMutationBoundary():null;H(t,l);const M=String(e?.id||""),E=t.state.goithau.find(d=>String(d.id)===M)||null;e=b?.authoritative===!0?E:E||e;const k=b?.authoritative===!0,$=!T&&e?.referenceOnly===!0&&_(e,h),L=k||$;if((k||$)&&typeof n.fetchRecordByLookup=="function"){const d=await n.fetchRecordByLookup("goithau",M);H(t,l),e=d||t.state.goithau.find(m=>String(m.id)===M)||e}if(k&&!e)throw ua(M);let p=_(e,h);if(p&&b?.offline===!0&&!sa(t,e?.id))throw ca();if(p&&b?.offline!==!0&&Number(e?.rowVersion)>0){const d=await c(n,{kind:"package",sourceId:e.id,expectedRowVersion:Number(e.rowVersion),changes:h,clientMutationId:i("version-command")});if(H(t,l),d?.authoritative){const m=String(e.rootId||e.id),u=t.state.goithau.find(y=>String(y.rootId||y.id)===m&&String(y.keHoachId)===String(e.keHoachId)&&y.isLatest==1&&String(y.id)!==String(e.id));if(!u)throw new Error("Máy chủ đã tạo phiên bản nhưng dữ liệu mới chưa được tải về.");return V(t.state,"selectedPackageVersion",u),u}}p&&L&&(e=await ha(n,e),H(t,l),p=_(e,h));let v=["goithau"],r=e,P=[];if(p){H(t,l);const d=t.getCurrentDateTimeString(),m=i("goithau"),u=t.getLatestPlan(e.keHoachId),y=String(e.rootId||e.id);P=t.state.goithau.filter(s=>String(s.rootId||s.id)===y).filter(s=>String(s.keHoachId)===String(u?.id||e.keHoachId)).filter(s=>s.isLatest==1);const I=ra(t.state,e,{...h,keHoachId:u?.id||e.keHoachId},{targetPackageId:m,targetPlanId:u?.id||e.keHoachId,timestamp:d,createId:i});t.state.goithau.filter(s=>String(s.rootId||s.id)===y).filter(s=>String(s.keHoachId)===String(u?.id||e.keHoachId)).forEach(s=>{s.isLatest=0}),r=I.packageRecord,Z(r),N(r),t.state.goithau.push(r),["goithauhanghoa","thongtinmothau","hanghoaduthaunhathau","assignments"].forEach(s=>{t.state[s]||=[],t.state[s].push(...I[s])}),V(t.state,"selectedPackageVersion",r),v=["goithau","goithauhanghoa","hanghoaduthaunhathau","thongtinmothau","assignments"]}else{H(t,l);const d=t.getLatestPlan(e.keHoachId);Object.assign(e,h,{keHoachId:d?.id||e.keHoachId,updatedAt:t.getCurrentDateTimeString()}),N(e)}const D={goithau:p?[...P,r]:[r]};return R(t,"goithau",D.goithau),p&&["goithauhanghoa","thongtinmothau","hanghoaduthaunhathau","assignments"].forEach(d=>{const m=d==="assignments"?t.state.assignments.filter(u=>String(u.targetId)===String(r.id)&&u.type==="goithau"):t.state[d].filter(u=>String(u.goiThauId)===String(r.id));D[d]=m,R(t,d,m)}),await W(n,v,{authoritativeBoundaryChecked:T,changes:{upserts:D}}),r}function fa(n,e,a){const i=ea(n.model,e);return i.length===0?`
      <div class="package-info-row">
        <span class="package-info-label">${o(a?.pheDuyet==="Kế hoạch"?"Phê duyệt kế hoạch":"Phê duyệt dự toán và kế hoạch")}</span>
        <span class="package-info-value">--</span>
      </div>`:i.map(c=>{const t=c.planVersions.length>0?` (KH phiên bản ${c.planVersions.join(", ")})`:"",h=c.approvalDate?n.model.formatDate(c.approvalDate):"",l=[c.decisionNumber,h].filter(Boolean).join(" · ")||"--";return`
      <div class="package-info-row">
        <span class="package-info-label">${o(c.approvalType+t)}</span>
        <span class="package-info-value">${o(l)}</span>
      </div>`}).join("")}function Pa(n,{contentWrapper:e,gt:a,id:i,isEditable:c,appController:t}){{const h=na(n.model,a),l=h?n.model.state.chudautu.find(k=>k.id===h.chuDauTuId):null,T=l?l.tenChuDauTu:"Không rõ",b=h?h.tenKeHoach:"Không rõ",M=J(n.model,a.id,"goithau");e.innerHTML=F(`
                    <div class="bf-s-95f6f7a8cf">
                        <!-- Cột 1: Thông tin chung -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="info" class="bf-s-ea6824d1aa"></i> Thông tin chung
                                </h4>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Mã TBMT</span>
                                        <span class="package-info-value">${o(a.maGoiThau||"--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Tên gói thầu</span>
                                        <span class="bf-s-0b49a26b79">${o(a.tenGoiThau||"--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Chủ đầu tư</span>
                                        <span class="bf-s-a231830f9a">${o(T)}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Kế hoạch LCNT</span>
                                        <span class="bf-s-a231830f9a">${o(b)}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Lĩnh vực</span>
                                        <span class="package-info-value">${o(a.linhVuc||"--")}${a.linhVuc==="Hàng hóa"?a.isThuoc==1?" (Thuốc)":" (Không phải thuốc)":""}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Giá gói thầu</span>
                                        <span class="bf-s-a1e9afc7db">${n.model.formatCurrency(a.giaGoiThau)||"--"}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Người phụ trách</span>
                                        <span class="package-info-value">${o(M.join(", ")||"Chưa phân công")}</span>
                                    </div>
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Nguồn vốn</span>
                                        <span class="bf-s-a231830f9a">${o(a.nguonVon||"--")}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 2: Hình thức & Phương thức -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="layers" class="bf-s-ea6824d1aa"></i> Hình thức & Phương thức
                                </h4>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Hình thức LCNT</span>
                                        <span class="package-info-value">${o(a.hinhThucLuaChon||"--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Phương thức LCNT</span>
                                        <span class="package-info-value">${o(a.phuongThucLuaChon||"--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Phương pháp đánh giá</span>
                                        <span class="package-info-value">${o(z(a)||"--")}</span>
                                    </div>
                                    ${X(a)&&a.trongSoKyThuat!=null?`
                                    <div class="package-info-row">
                                        <span class="package-info-label">Trọng số kỹ thuật (%)</span>
                                        <span class="package-info-value">${o(a.trongSoKyThuat)}%</span>
                                    </div>`:""}
                                    <div class="package-info-row">
                                        <span class="package-info-label">Đấu thầu qua mạng</span>
                                        <span class="package-info-value">${o(a.quaMang||"Qua mạng")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Phân lô</span>
                                        <span class="package-info-value">${o(a.phanLo||"Không")}</span>
                                    </div>
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Tùy chọn mua thêm</span>
                                        <span class="package-info-value">${o(a.tuyChonMuaThem||"Không")}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 3: Thời gian & Tiến độ -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="calendar" class="bf-s-ea6824d1aa"></i> Thời gian & Tiến độ
                                </h4>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Thời gian thực hiện</span>
                                        <span class="package-info-value">${o(a.thoiGianThucHien||"--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Bắt đầu tổ chức</span>
                                        <span class="package-info-value">${o(a.thoiGianBatDauToChuc||"--")}</span>
                                    </div>
                                    ${fa(n,a,h)}
                                    ${a.hinhThucLuaChon!=="Chỉ định thầu rút gọn"&&a.hinhThucLuaChon!=="Lựa chọn nhà thầu trong trường hợp đặc biệt"?`
                                    <div class="package-info-row">
                                        <span class="package-info-label">Thời gian đăng tải</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-dangtai" class="form-control flatpickr-datetime bf-s-a77124f253" value="${a.thoiGianDangTai?n.model.formatForDatetimeLocal(a.thoiGianDangTai):""}" placeholder="dd/MM/yyyy HH:mm">
                                        `:`
                                            <span class="package-info-value">${a.thoiGianDangTai?n.model.formatDateWithTime(a.thoiGianDangTai):"--"}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Thời gian đóng thầu</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-dongthau" class="form-control flatpickr-datetime bf-s-a77124f253" value="${a.thoiGianDongThau?n.model.formatForDatetimeLocal(a.thoiGianDongThau):""}" placeholder="dd/MM/yyyy HH:mm">
                                        `:`
                                            <span class="package-info-value">${a.thoiGianDongThau?n.model.formatDateWithTime(a.thoiGianDongThau):"--"}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: ${a.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ"?"1px solid rgba(226, 232, 240, 0.5)":"none"}; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">${a.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ"?"Thời gian mở E-HSĐXKT":"Thời gian mở thầu"}</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-mothau" class="form-control flatpickr-datetime bf-s-a77124f253" value="${a.thoiGianMoThau?n.model.formatForDatetimeLocal(a.thoiGianMoThau):""}" placeholder="dd/MM/yyyy HH:mm">
                                        `:`
                                            <span class="package-info-value">${a.thoiGianMoThau?n.model.formatDateWithTime(a.thoiGianMoThau):"--"}</span>
                                        `}
                                    </div>
                                    ${a.phuongThucLuaChon==="Một giai đoạn hai túi hồ sơ"?`
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Thời gian mở E-HSĐXTC</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-moehsdxtc" class="form-control flatpickr-datetime bf-s-a77124f253" value="${a.thoiGianMoEhsdxtc?n.model.formatForDatetimeLocal(a.thoiGianMoEhsdxtc):""}" placeholder="dd/MM/yyyy HH:mm">
                                        `:`
                                            <span class="package-info-value">${a.thoiGianMoEhsdxtc?n.model.formatDateWithTime(a.thoiGianMoEhsdxtc):"--"}</span>
                                        `}
                                    </div>
                                    `:""}
                                    `:""}
                                </div>
                            </div>
                        </div>

                        ${a.hinhThucLuaChon==="Chào hàng cạnh tranh"?`
                        <!-- Cột 4: Quyết định phê duyệt HSMT (Dành riêng cho Chào hàng cạnh tranh ở dạng cột) -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="file-text" class="bf-s-ea6824d1aa"></i> Quyết định phê duyệt HSMT
                                </h4>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số quyết định phê duyệt HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-soquyetdinh" class="form-control bf-s-2c034cb5e7" value="${B(a.soQuyetDinh||"")}" placeholder="Nhập số quyết định">
                                        `:`
                                            <span class="package-info-value">${o(a.soQuyetDinh||"--")}</span>
                                        `}
                                    </div>
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Ngày quyết định phê duyệt HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${a.ngayQuyetDinh?n.model.formatForDateInput(a.ngayQuyetDinh):""}" placeholder="dd/MM/yyyy">
                                        `:`
                                            <span class="package-info-value">${a.ngayQuyetDinh?n.model.formatDate(a.ngayQuyetDinh):"--"}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                        `:""}
                    </div>

                    ${a.hinhThucLuaChon!=="Chào hàng cạnh tranh"&&a.hinhThucLuaChon!=="Chỉ định thầu rút gọn"&&a.hinhThucLuaChon!=="Lựa chọn nhà thầu trong trường hợp đặc biệt"?`
                    <!-- Cột 4: Phê duyệt HSMT (Trải ngang full chiều rộng) -->
                    <div class="card bf-s-79d810df56">
                            <h4 class="package-info-heading">
                                <i data-lucide="file-text" class="bf-s-ea6824d1aa"></i> Phê duyệt HSMT
                            </h4>
                            <div class="bf-s-09162b0891">
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số tờ trình HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-sototrinh" class="form-control bf-s-2c034cb5e7" value="${B(a.soToTrinhHsmt||"")}" placeholder="Nhập số tờ trình">
                                        `:`
                                            <span class="package-info-value">${o(a.soToTrinhHsmt||"--")}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Ngày trình HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-ngaytrinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${a.ngayTrinhHsmt?n.model.formatForDateInput(a.ngayTrinhHsmt):""}" placeholder="dd/MM/yyyy">
                                        `:`
                                            <span class="package-info-value">${a.ngayTrinhHsmt?n.model.formatDate(a.ngayTrinhHsmt):"--"}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số quyết định phê duyệt HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-soquyetdinh" class="form-control bf-s-2c034cb5e7" value="${B(a.soQuyetDinh||"")}" placeholder="Nhập số quyết định">
                                        `:`
                                            <span class="package-info-value">${o(a.soQuyetDinh||"--")}</span>
                                        `}
                                    </div>
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Ngày quyết định phê duyệt HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${a.ngayQuyetDinh?n.model.formatForDateInput(a.ngayQuyetDinh):""}" placeholder="dd/MM/yyyy">
                                        `:`
                                            <span class="package-info-value">${a.ngayQuyetDinh?n.model.formatDate(a.ngayQuyetDinh):"--"}</span>
                                        `}
                                    </div>
                                </div>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="bf-s-c733ba5cc7">
                                        <span class="package-info-label">Yêu cầu thẩm định HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <div class="bf-s-f87b7dd318">
                                                <label class="bf-s-b3a13cfc23">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Có" ${a.yeuCauThamDinhHsmt==="Có"?"checked":""} class="bf-s-6a453d398f"> Có
                                                </label>
                                                <label class="bf-s-b3a13cfc23">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Không" ${a.yeuCauThamDinhHsmt==="Không"||!a.yeuCauThamDinhHsmt?"checked":""} class="bf-s-6a453d398f"> Không
                                                </label>
                                            </div>
                                        `:`
                                            <span class="package-info-value">${o(a.yeuCauThamDinhHsmt||"Không")}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-sobaocaothamdinh" class="bf-s-c733ba5cc7 appraisal-report-row" ${n._inPlaceEditMode||a.yeuCauThamDinhHsmt==="Có"?"":"hidden"}>
                                        <span class="package-info-label">Số BCTĐ HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <div class="bf-s-be718f4a76">
                                                <input type="text" id="ip-sobaocaothamdinh" class="form-control bf-s-2c034cb5e7" value="${B(a.soBaoCaoThamDinhHsmt||"")}" placeholder="Nhập số báo cáo">
                                                <span class="error-msg-inline bf-s-17b31d44f2" id="err-sobaocao">Vui lòng nhập số báo cáo</span>
                                            </div>
                                        `:`
                                            <span class="package-info-value">${o(a.soBaoCaoThamDinhHsmt||"--")}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-ngaybaocaothamdinh" class="bf-s-c733ba5cc7 appraisal-report-row appraisal-report-row--last" ${n._inPlaceEditMode||a.yeuCauThamDinhHsmt==="Có"?"":"hidden"}>
                                        <span class="package-info-label">Ngày BCTĐ HSMT</span>
                                        ${n._inPlaceEditMode?`
                                            <div class="bf-s-be718f4a76">
                                                <input type="text" id="ip-ngaybaocaothamdinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${a.ngayBaoCaoThamDinhHsmt?n.model.formatForDateInput(a.ngayBaoCaoThamDinhHsmt):""}" placeholder="dd/MM/yyyy">
                                                <span class="error-msg-inline bf-s-17b31d44f2" id="err-ngaybaocao">Vui lòng chọn ngày báo cáo</span>
                                            </div>
                                        `:`
                                            <span class="package-info-value">${a.ngayBaoCaoThamDinhHsmt?n.model.formatDate(a.ngayBaoCaoThamDinhHsmt):"--"}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                        `:""}
                     ${n._inPlaceEditMode?`
                        <div class="bf-s-404d922254">
                            <button id="btn-cancel-inplace" class="btn btn-outline bf-s-62c1ff7ddc">Hủy</button>
                            <button id="btn-save-inplace" class="btn btn-primary bf-s-62c1ff7ddc">Lưu</button>
                        </div>
                    `:`
                        ${c&&a.trangThai!=="Đang chấm thầu"&&a.trangThai!=="Đã có kết quả một phần"&&a.trangThai!=="Đã có kết quả"&&a.trangThai!=="Hủy thầu"?`
                            <div class="bf-s-d6f1b866d4">
                                <button id="btn-edit-goithau-bottom" class="btn btn-primary bf-s-62c1ff7ddc">
                                    <i data-lucide="edit"></i> Sửa gói thầu
                                </button>
                            </div>
                        `:""}
                    `}
                `),n.createIconsScoped?.(e);const E=document.getElementById("btn-edit-goithau-bottom");if(E&&(E.onclick=()=>{a.hinhThucLuaChon==="Chỉ định thầu rút gọn"||a.hinhThucLuaChon==="Lựa chọn nhà thầu trong trường hợp đặc biệt"?j("editGoiThau",i):(n._inPlaceEditMode=!0,n.showPackageDetails(i))}),n._inPlaceEditMode){const k=document.querySelectorAll('input[name="ip-yeucauthamdinh"]');if(k.length>0){const p=()=>{const v=document.querySelector('input[name="ip-yeucauthamdinh"]:checked'),r=v&&v.value==="Có";document.getElementById("wrapper-sobaocaothamdinh")?.toggleAttribute("hidden",!r),document.getElementById("wrapper-ngaybaocaothamdinh")?.toggleAttribute("hidden",!r)};k.forEach(v=>{v.onchange=p}),p()}const $=document.getElementById("btn-save-inplace");$&&($.onclick=async()=>{const p=document.getElementById("ip-dangtai").value,v=document.getElementById("ip-dongthau").value,r=document.getElementById("ip-mothau").value,P=document.getElementById("ip-moehsdxtc"),D=P?P.value:"",d=document.getElementById("ip-soquyetdinh").value,m=document.getElementById("ip-ngayquyetdinh").value,u=document.getElementById("ip-sototrinh")?.value||"",y=document.getElementById("ip-ngaytrinh")?.value||"",I=document.querySelector('input[name="ip-yeucauthamdinh"]:checked'),s=I?I.value:"Không",K=document.getElementById("ip-sobaocaothamdinh")?.value||"",A=document.getElementById("ip-ngaybaocaothamdinh")?.value||"";if(s==="Có"){let G=!1;const x=[],C=document.getElementById("ip-sobaocaothamdinh"),S=document.getElementById("ip-ngaybaocaothamdinh");if(C){const f=document.getElementById("err-sobaocao");K.trim()?(g(C,"border",""),f&&g(f,"display","none")):(g(C,"border","1px solid #ef4444"),f&&g(f,"display","block"),G=!0,x.push(C)),C.oninput=()=>{g(C,"border",""),f&&g(f,"display","none")}}if(S){const f=document.getElementById("err-ngaybaocao");A.trim()?(g(S,"border",""),f&&g(f,"display","none")):(g(S,"border","1px solid #ef4444"),f&&g(f,"display","block"),G=!0,x.push(S)),S.onchange=()=>{g(S,"border",""),f&&g(f,"display","none")}}if(G){n.focusInvalidControl(x[0]);return}}const w={hinhThucLuaChon:a.hinhThucLuaChon,thoiGianDangTai:p?n.model.convertDMYHMSToYMDHMS(p):"",thoiGianDongThau:v?n.model.convertDMYHMSToYMDHMS(v):"",thoiGianMoThau:r?n.model.convertDMYHMSToYMDHMS(r):"",thoiGianMoEhsdxtc:D?n.model.convertDMYHMSToYMDHMS(D):"",soQuyetDinh:d,ngayQuyetDinh:m?n.model.convertDMYToYMD(m):"",soToTrinhHsmt:u,ngayTrinhHsmt:y?n.model.convertDMYToYMD(y):"",yeuCauThamDinhHsmt:s,soBaoCaoThamDinhHsmt:s==="Không"?"":K,ngayBaoCaoThamDinhHsmt:s==="Không"||!A?"":n.model.convertDMYToYMD(A)},O=await pa(t||n,a,w,{generateRecordId:q});n._inPlaceEditMode=!1,n.showPackageDetails(O.id),await n.customAlert("Thành công","Cập nhật thông tin gói thầu thành công!","check-circle")});const L=document.getElementById("btn-cancel-inplace");L&&(L.onclick=()=>{n._inPlaceEditMode=!1,n.showPackageDetails(i)})}}}export{Pa as renderPreparationDetailsPanel};
