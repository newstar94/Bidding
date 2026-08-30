import{n as s,t as g}from"./view_helpers-CdPIbaii.js";import{ct as b}from"./app-RPlYyKwL.js";import{t as f}from"./workspaceRenderCache-BIPtUnPy.js";import{n as $}from"./jvDataStore-DLAlVQzK.js";import{r as v}from"./runtimeState-DuFYp7S3.js";var d="modal-lot-winners";function m(t){return Array.isArray(t)?t.filter(Boolean):[]}function c(t,o){const n=Number(o||0);return typeof t=="function"?t(n):`${n.toLocaleString("vi-VN")} đ`}function y(t){const o=String(t.tenNhaThau||"Chưa xác định"),n=String(t.nhaThauTrungThauId||"").trim(),r=!!(t.isJV&&t.jvKey);return!n&&!r?`<span>${s(o)}</span>`:`
    <button
      type="button"
      class="lot-winner-contractor-button"
      data-bf-action="${r?"show-jv":"show-contractor-modal"}"
      data-id="${g(r?t.jvKey:n)}"
      data-close-before="${d}"
      aria-haspopup="dialog"
      aria-label="Xem thông tin nhà thầu ${g(o)}"
    >
      <span>${s(o)}</span>
      ${r?'<span class="lot-winner-jv-badge">Liên danh</span>':""}
    </button>
  `}function T({packageCode:t="",packageName:o="",winners:n=[],formatCurrency:r}={}){const i=m(n),h=i.reduce((l,a)=>l+Number(a.giaTrungThau||0),0),e=i.map(l=>`
    <tr>
      <td data-label="Mã phần lô"><strong>${s(l.maPhanLo||"--")}</strong></td>
      <td data-label="Tên phần lô">${s(l.tenPhanLo||"--")}</td>
      <td data-label="Nhà thầu trúng thầu">${y(l)}</td>
      <td data-label="Giá trúng thầu" class="text-right fw-bold">${s(c(r,l.giaTrungThau))}</td>
    </tr>
  `).join("");return`
    <div class="modal-card lot-winners-modal-card" role="dialog" aria-modal="true" aria-labelledby="lot-winners-title">
      <div class="modal-header lot-winners-modal-header">
        <div>
          <h3 id="lot-winners-title">Nhà thầu trúng thầu theo phần lô</h3>
          <p class="text-muted lot-winners-package-title">
            ${t?`<strong>${s(t)}</strong>${o?" · ":""}`:""}${s(o)}
          </p>
        </div>
        <button type="button" class="modal-close" data-bf-action="close-modal" data-modal-id="${d}" aria-label="Đóng"></button>
      </div>
      <div class="modal-body lot-winners-modal-body">
        <div class="phanlo-table-wrap">
          <table class="phanlo-table lot-winners-table" data-mobile-layout="cards" data-no-sort="true" data-row-pagination="true" aria-label="Danh sách nhà thầu trúng thầu theo phần lô">
            <thead>
              <tr>
                <th>Mã phần lô</th>
                <th>Tên phần lô</th>
                <th>Nhà thầu trúng thầu</th>
                <th class="text-right">Giá trúng thầu (VND)</th>
              </tr>
            </thead>
            <tbody>
              ${e||'<tr data-table-state="empty"><td colspan="4" class="text-center text-muted">Chưa có thông tin nhà thầu trúng thầu theo phần lô.</td></tr>'}
            </tbody>
            ${i.length?`
              <tfoot>
                <tr>
                  <td colspan="3" class="text-right"><strong>Tổng giá trúng thầu</strong></td>
                  <td class="text-right"><strong>${s(c(r,h))}</strong></td>
                </tr>
              </tfoot>
            `:""}
          </table>
        </div>
      </div>
    </div>
  `}function M({model:t,view:o}={},n){const r="lot-winners-modal";f(t,r);const i=m(v(t,n));if(!i.length)return o?.showToast?.("Chưa có thông tin","Không tìm thấy dữ liệu nhà thầu trúng thầu theo phần lô.","warning"),!1;const h=t?.state?.goithau?.find(a=>String(a.id)===String(n));let e=document.getElementById(d);e||(e=document.createElement("div"),e.id=d,e.className="modal-overlay",document.body.appendChild(e));const l=i.map((a,p)=>{if(!a.isJV||!a.jvData)return a;const u=`lot-winner:${n}:${a.maPhanLo||p}`;return $(t,u,a.jvData,{owner:r}),{...a,jvKey:u}});return e.innerHTML=b(T({packageCode:h?.maGoiThau||"",packageName:h?.tenGoiThau||"",winners:l,formatCurrency:a=>t?.formatCurrency?.(a)||c(null,a)})),e.dataset.packageId=String(n||""),o?.openModal?.(d),!0}export{M as t};
