// eslint-disable-next-line complexity -- Legacy import validation is isolated for a dedicated refactor.
export function getExcelPreviewFieldError(type, key, val) {
  let apiType = type;
  if (apiType === "plan") apiType = "kehoach";
  if (apiType === "package") apiType = "goithau";
  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const cccdPattern = /^\d{12}$/;
  const taxPattern = /^\d{10}$|^\d{13}$|^\d{10}-\d{3}$/;
  const phonePattern = /^[0-9\s+\-()]{9,15}$/;
  const strVal = val !== void 0 && val !== null ? String(val).trim() : "";
  if (apiType === "kehoach") {
    if (key === "maKeHoach" && !strVal) return "Mã kế hoạch không được để trống";
    if (key === "tenKeHoach" && !strVal) return "Tên kế hoạch không được để trống";
    if (key === "tongMucDauTu" && val !== void 0 && val !== null && val !== "") {
      const num = parseFloat(val);
      if (Number.isNaN(num)) return "Tổng mức đầu tư phải là số";
      if (num < 0) return "Tổng mức đầu tư không được nhỏ hơn 0";
    }
  } else if (apiType === "goithau") {
    if (key === "maGoiThau" && !strVal) return "Mã gói thầu không được để trống";
    if (key === "tenGoiThau" && !strVal) return "Tên gói thầu không được để trống";
    if (key === "giaGoiThau" && val !== void 0 && val !== null && val !== "") {
      const num = parseFloat(val);
      if (Number.isNaN(num)) return "Giá gói thầu phải là số";
      if (num < 0) return "Giá gói thầu không được nhỏ hơn 0";
    }
    if (key === "thoiGianThucHien" && val !== void 0 && val !== null && val !== "") {
      const num = parseInt(val, 10);
      if (Number.isNaN(num)) return "Thời gian thực hiện phải là số nguyên";
      if (num <= 0) return "Thời gian thực hiện phải lớn hơn 0";
    }
  } else if (apiType === "chudautu") {
    if (key === "maChuDauTu" && !strVal) return "Mã chủ đầu tư không được để trống";
    if (key === "tenChuDauTu" && !strVal) return "Tên chủ đầu tư không được để trống";
    if (key === "maSoThue" && strVal && !taxPattern.test(strVal)) return "Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)";
    if (key === "email" && strVal && !emailPattern.test(strVal)) return "Email không đúng định dạng";
    if (key === "soDienThoai" && strVal && !phonePattern.test(strVal)) return "Số điện thoại không hợp lệ";
  } else if (apiType === "nhathau") {
    if (key === "maNhaThau" && !strVal) return "Mã nhà thầu không được để trống";
    if (key === "tenNhaThau" && !strVal) return "Tên nhà thầu không được để trống";
    if (key === "maSoThue" && strVal && !taxPattern.test(strVal)) return "Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)";
    if (key === "email" && strVal && !emailPattern.test(strVal)) return "Email không đúng định dạng";
    if (key === "soDienThoai" && strVal && !phonePattern.test(strVal)) return "Số điện thoại không hợp lệ";
  } else if (apiType === "chuyengia") {
    if (key === "hoTen" && !strVal) return "Họ và tên không được để trống";
    if (key === "soChungChi" && !strVal) return "Số chứng chỉ không được để trống";
    if (key === "soCCCD") {
      if (!strVal) return "Số CCCD không được để trống";
      if (!cccdPattern.test(strVal)) return "Số Căn cước công dân phải gồm đúng 12 chữ số";
    }
    if (key === "email" && strVal && !emailPattern.test(strVal)) return "Email không đúng định dạng";
  } else if (apiType === "hopdong") {
    if (key === "soHopDong" && !strVal) return "Số hợp đồng không được để trống";
    if (key === "tenHopDong" && !strVal) return "Tên hợp đồng không được để trống";
    if (key === "giaTri" && val !== void 0 && val !== null && val !== "") {
      const num = parseFloat(val);
      if (Number.isNaN(num)) return "Giá trị hợp đồng phải là số";
      if (num < 0) return "Giá trị hợp đồng không được nhỏ hơn 0";
    }
  } else if (apiType === "phanlo") {
    if (key === "tenPhanLo" && !strVal) return "Tên phần lô không được để trống";
  } else if (apiType === "tuychonmuathem") {
    if (key === "hangMuc" && !strVal) return "Hạng mục không được để trống";
  } else if (["mothau", "opening_fin", "danhgiahsdt", "ketquaqd"].includes(apiType)) {
    if (key === "id" && !strVal) return "Không tìm thấy nhà thầu tương ứng!";
  }
  return null;
}
