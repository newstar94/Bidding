import{n as h}from"./view_helpers-CdPIbaii.js";import{r as v}from"./evaluationMethodRules-CW6GTI60.js";function f({pkg:n,planName:e,investorName:r,formatCurrency:d,formatDateTime:a,timeIds:o=!1,lockedMessage:t=""}){const i=(g,u,$=!1)=>`<div>• <strong class="bf-s-fcb5ddef65">${g}:</strong> ${$?`<span class="text-dark fw-bold">${u}</span>`:u}</div>`,l=n.linhVuc==="Hàng hóa"?n.isThuoc===1||n.isThuoc==="1"?" (Thuốc)":" (Không phải thuốc)":"",s=n.thoiGianDongThau?a(n.thoiGianDongThau):"--",c=n.thoiGianMoThau?a(n.thoiGianMoThau):"--";return`<div class="bf-s-8bd3eb473c">
    <div class="bf-s-5d398becec">Thông số Gói thầu</div>
    <div class="bf-s-13b5590e90">
      ${i("Chủ đầu tư",h(r||"Không rõ"),!0)}
      ${i("Tên kế hoạch",h(e||"Không rõ"),!0)}
      ${i("Lĩnh vực",`${h(n.linhVuc||"Hàng hóa")}${l}`)}
      ${i("Phương thức LCNT",h(n.phuongThucLuaChon||"Một giai đoạn một túi hồ sơ"))}
      ${i("Phân lô",n.phanLo==="Có"?"Có chia phần lô":"Không chia phần lô")}
      ${i("Giá gói thầu",h(d(n.giaGoiThau)),!0)}
      ${i("Hình thức LCNT",h(n.hinhThucLuaChon||"--"))}
      ${n.phuongPhapDanhGia?i("Phương pháp đánh giá",h(v(n))):""}
      ${i("Loại hợp đồng",h(n.loaiHopDong||"--"))}
      ${i("Thời gian thực hiện",h(n.thoiGianThucHien||"--"))}
      ${i("Nguồn vốn",h(n.nguonVon||"--"))}
      ${i("Thời gian đóng thầu",o?`<span id="display-thoigiandongthau" class="fw-bold">${h(s)}</span>`:h(s))}
      ${i("Thời gian mở thầu",o?`<span id="display-thoigianmothau" class="fw-bold">${h(c)}</span>`:h(c))}
    </div>
    ${t?`<div class="package-lock-notice" role="status">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
      <span>${h(t)}</span>
    </div>`:""}
  </div>`}export{f as t};
