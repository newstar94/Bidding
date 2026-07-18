import { clearCompetitiveQuotationAppraisal } from "./packageAppraisal.js";

export async function moThauGoiThau(id) {
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  const thoiGianMoThauStr = await this.view.customPrompt(
    "Chọn thời gian mở thầu",
    `Chọn Thời gian mở thầu cho gói thầu "${gt.tenGoiThau}":`,
    "",
    "Chọn ngày và giờ...",
    true,
    // kích hoạt date/time picker
    (val) => {
      if (!val || !val.trim()) {
        return "Vui lòng chọn thời gian mở thầu!";
      }
      const cleanVal = val.trim();
      let d2, m2, y2, hh2 = 0, mm2 = 0;
      const formatMatch = cleanVal.match(/^(\d{2}):(\d{2})\s+ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i);
      if (formatMatch) {
        hh2 = parseInt(formatMatch[1], 10);
        mm2 = parseInt(formatMatch[2], 10);
        d2 = parseInt(formatMatch[3], 10);
        m2 = parseInt(formatMatch[4], 10);
        y2 = parseInt(formatMatch[5], 10);
      } else {
        const parts = cleanVal.split(" ");
        if (parts.length >= 2) {
          const dateParts = parts[0].split("/");
          const timeParts = parts[1].split(":");
          d2 = parseInt(dateParts[0], 10);
          m2 = parseInt(dateParts[1], 10);
          y2 = parseInt(dateParts[2], 10);
          hh2 = parseInt(timeParts[0] || 0, 10);
          mm2 = parseInt(timeParts[1] || 0, 10);
        }
      }
      if (isNaN(d2) || isNaN(m2) || isNaN(y2) || isNaN(hh2) || isNaN(mm2)) {
        return "Thời gian mở thầu không hợp lệ. Vui lòng chọn lại!";
      }
      if (gt.thoiGianDongThau) {
        const dongThauDate = new Date(gt.thoiGianDongThau);
        const moThauDate = new Date(y2, m2 - 1, d2, hh2, mm2);
        if (!isNaN(dongThauDate.getTime()) && !isNaN(moThauDate.getTime()) && moThauDate < dongThauDate) {
          return `Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu (${this.model.formatDateWithTime(gt.thoiGianDongThau)})!`;
        }
      }
      return null;
    }
  );
  if (thoiGianMoThauStr === null) {
    return;
  }
  const cleanStr = thoiGianMoThauStr.trim();
  if (!cleanStr) {
    await this.view.customAlert("Lỗi", "Vui lòng chọn thời gian mở thầu!", "x-circle");
    return;
  }
  let d, m, y, hh = 0, mm = 0;
  const newFormatMatch = cleanStr.match(/^(\d{2}):(\d{2})\s+ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (newFormatMatch) {
    hh = parseInt(newFormatMatch[1], 10);
    mm = parseInt(newFormatMatch[2], 10);
    d = parseInt(newFormatMatch[3], 10);
    m = parseInt(newFormatMatch[4], 10);
    y = parseInt(newFormatMatch[5], 10);
  } else {
    const parts = cleanStr.split(" ");
    if (parts.length >= 2) {
      const dateParts = parts[0].split("/");
      const timeParts = parts[1].split(":");
      d = parseInt(dateParts[0], 10);
      m = parseInt(dateParts[1], 10);
      y = parseInt(dateParts[2], 10);
      hh = parseInt(timeParts[0] || 0, 10);
      mm = parseInt(timeParts[1] || 0, 10);
    }
  }
  if (isNaN(d) || isNaN(m) || isNaN(y) || isNaN(hh) || isNaN(mm)) {
    await this.view.customAlert("Lỗi", "Thời gian mở thầu không hợp lệ. Vui lòng chọn lại!", "x-circle");
    return;
  }
  const ymdStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  gt.thoiGianMoThau = ymdStr;
  gt.trangThai = "Đã mở thầu";
  await this.model.persistData("goithau");
  this.view.renderGoiThauTable();
  const syncResult = await this.autoSync();
  if (!syncResult?.ok) return;
  await this.view.customAlert(
    "Thành công",
    `Đã tiến hành mở thầu thành công cho gói thầu "${gt.tenGoiThau}". Trạng thái hiện tại: Đã mở thầu. Hãy tiến hành điền thông tin mở thầu và lưu lại!`,
    "check-circle"
  );
  this.switchTab("goithau-detail", id);
}
export async function phatHanhHsmtGoiThau(id) {
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  if (!document.getElementById("modal-phathanh-hsmt")) {
    await this.ensureLazyModal?.("modal-phathanh-hsmt");
  }
  this.view.populatePhathanhHsmtForm(gt, this.model);
  this.view.openModal("modal-phathanh-hsmt");
}
export async function handlePhatHanhHsmtSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-phathanh-hsmt");
  if (!this.view.validateForm(form)) return;
  const data = this.view.getPhathanhHsmtFormData(this.model);
  const { id, maGoiThauVal, hieuLucHsdtVal, giaTriDamBaoVal, soQuyetDinh, thoiGianDangTai, thoiGianDongThau, ngayQuyetDinh, soToTrinhHsmt, ngayTrinhHsmt, yeuCauThamDinhHsmt, soBaoCaoThamDinhHsmt, ngayBaoCaoThamDinhHsmt, phanLoRows } = data;
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  const isTuVan = gt.linhVuc === "Tư vấn";
  const isPhanLo = gt.phanLo === "Có";
  if (!maGoiThauVal) {
    await this.view.customAlert("Thiếu thông tin", "Mã gói thầu là bắt buộc khi chuyển sang trạng thái Đang mời thầu!", "alert-triangle", document.getElementById("phathanh-magoithau"));
    return;
  }
  if (hieuLucHsdtVal <= 0) {
    await this.view.customAlert("Thiếu thông tin", "Thời gian hiệu lực hồ sơ dự thầu phải lớn hơn 0!", "alert-triangle", document.getElementById("phathanh-hieuluchsdt"));
    return;
  }
  if (!isTuVan && !isPhanLo) {
    if (giaTriDamBaoVal <= 0) {
      await this.view.customAlert("Thiếu thông tin", "Giá trị bảo đảm dự thầu phải lớn hơn 0 (trừ gói tư vấn)!", "alert-triangle", document.getElementById("phathanh-giatribaomothau"));
      return;
    }
  }
  if (isPhanLo && !isTuVan) {
    let invalidInput = null;
    let exceedsInput = null;
    let exceedsMsg = "";
    for (const row of phanLoRows) {
      if (row.baoDamDuThau <= 0 && !invalidInput) {
        const tr = document.querySelector(`#phathanh-phanlo-baodam-tbody tr[data-id="${row.id}"]`);
        invalidInput = tr ? tr.querySelector(".phathanh-pl-baodam-input") : null;
      }
      if (row.giaTriPhanLo > 0 && row.baoDamDuThau > row.giaTriPhanLo && !exceedsInput) {
        const tr = document.querySelector(`#phathanh-phanlo-baodam-tbody tr[data-id="${row.id}"]`);
        exceedsInput = tr ? tr.querySelector(".phathanh-pl-baodam-input") : null;
        exceedsMsg = `Giá trị bảo đảm dự thầu (${this.model.formatVND(row.baoDamDuThau)}) không được lớn hơn giá trị phần lô (${this.model.formatVND(row.giaTriPhanLo)})!`;
      }
    }
    if (invalidInput || phanLoRows.length === 0) {
      await this.view.customAlert("Thiếu thông tin", "Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô (trừ gói tư vấn)!", "alert-triangle", invalidInput);
      return;
    }
    if (exceedsInput) {
      await this.view.customAlert("Dữ liệu không hợp lệ", exceedsMsg, "alert-triangle", exceedsInput);
      return;
    }
  }
  const confirmed = await this.view.customConfirm(
    "Xác nhận phát hành",
    `Bạn có chắc chắn muốn phát hành HSMT và chuyển gói thầu "${gt.tenGoiThau}" sang trạng thái "Đang mời thầu" không?`,
    "send"
  );
  if (confirmed) {
    gt.maGoiThau = maGoiThauVal;
    gt.soToTrinhHsmt = soToTrinhHsmt;
    gt.ngayTrinhHsmt = ngayTrinhHsmt ? this.model.convertDMYToYMD(ngayTrinhHsmt) : "";
    gt.soQuyetDinh = soQuyetDinh;
    gt.ngayQuyetDinh = ngayQuyetDinh ? this.model.convertDMYToYMD(ngayQuyetDinh) : "";
    gt.thoiGianDangTai = thoiGianDangTai ? this.model.convertDMYHMSToYMDHMS(thoiGianDangTai) : "";
    gt.thoiGianDongThau = thoiGianDongThau ? this.model.convertDMYHMSToYMDHMS(thoiGianDongThau) : "";
    gt.yeuCauThamDinhHsmt = yeuCauThamDinhHsmt;
    gt.soBaoCaoThamDinhHsmt = soBaoCaoThamDinhHsmt;
    gt.ngayBaoCaoThamDinhHsmt = ngayBaoCaoThamDinhHsmt ? this.model.convertDMYToYMD(ngayBaoCaoThamDinhHsmt) : "";
    clearCompetitiveQuotationAppraisal(gt);
    gt.thoiGianMoThau = "";
    gt.hieuLucHsdt = hieuLucHsdtVal;
    gt.hieuLucDamBaoDuThau = hieuLucHsdtVal + 30;
    if (isPhanLo && !isTuVan && gt.phanLoList) {
      phanLoRows.forEach((row) => {
        const pl = gt.phanLoList.find((p) => p.id === row.id);
        if (pl) {
          pl.maPhanLo = row.maPhanLo;
          pl.tenPhanLo = row.tenPhanLo;
          pl.giaTriPhanLo = row.giaTriPhanLo;
          pl.baoDamDuThau = row.baoDamDuThau;
          pl.thoiGianThucHien = row.thoiGianThucHien;
        }
      });
      gt.giaTriDamBaoDuThau = this.model.sumVND(gt.phanLoList.map((item) => item.baoDamDuThau));
    } else if (!isTuVan && !isPhanLo) {
      gt.giaTriDamBaoDuThau = giaTriDamBaoVal;
    } else {
      gt.giaTriDamBaoDuThau = 0;
    }
    gt.trangThai = "Đang mời thầu";
    await this.model.persistData("goithau");
    this.view.closeModal("modal-phathanh-hsmt");
    this.view.showPackageDetails(id);
    const syncResult = await this.autoSync();
    if (!syncResult?.ok) return;
    await this.view.customAlert("Thành công", "Đã phát hành HSMT và chuyển gói thầu sang trạng thái Đang mời thầu!", "check-circle");
  }
}
