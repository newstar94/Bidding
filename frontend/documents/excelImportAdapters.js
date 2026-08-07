import {
  getActiveEvaluationLotScope,
  isBidWithinEvaluationLotDetails,
  isPartialEvaluationLotScope
} from "../packages/lotEvaluationScope.js";
import { normalizeLowPriceAcceptance } from "../packages/bidEvaluationLowPriceRules.js";
import {
  requiresTechnicalScoreInput,
  validateTechnicalScore,
} from "../packages/evaluationMethodRules.js";

function findOpeningPackage(controller, context = {}) {
  const select = context.packageId
    ? null
    : document.getElementById("mothau-goithau-select") || document.getElementById("danhgiahsdt-goithau-select");
  const gtId = context.packageId || (select ? select.value : controller._currentPackageId || "");
  const goiThau = controller.model.state.goithau.find((g) => g.id === gtId);
  return { gtId, goiThau };
}
function findOpeningBid(controller, gtId, maNhaThau, tenNhaThau) {
  const existingBids = controller.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
  return existingBids.find((b) => {
    const bMa = b.maNhaThau || b.maDinhDanh || "";
    return bMa && maNhaThau && bMa.toLowerCase() === maNhaThau.toLowerCase() || b.tenNhaThau && tenNhaThau && b.tenNhaThau.toLowerCase() === tenNhaThau.toLowerCase();
  });
}
function findEvaluationBid(controller, gtId, maNhaThau, tenNhaThau, maPhanLo, hasPhanLo) {
  const existingBids = controller.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
  return existingBids.find((b) => {
    const matchNt = b.maNhaThau && maNhaThau && b.maNhaThau.toLowerCase() === maNhaThau.toLowerCase() || b.tenNhaThau && tenNhaThau && b.tenNhaThau.toLowerCase() === tenNhaThau.toLowerCase();
    if (hasPhanLo) {
      return matchNt && b.maPhanLo === maPhanLo;
    }
    return matchNt;
  });
}
export async function parseOpeningFinancialImport(controller, rows, context = {}) {
  if (!rows || rows.length === 0) {
    await controller.view.customAlert("Thất bại", "File Excel không có dữ liệu mở thầu tài chính!", "alert-triangle");
    return null;
  }
  const { gtId, goiThau } = findOpeningPackage(controller, context);
  if (!goiThau) {
    const select = document.getElementById("mothau-goithau-select") || document.getElementById("danhgiahsdt-goithau-select");
    await controller.view.customAlert("Thất bại", "Vui lòng chọn gói thầu trước khi nhập Excel!", "alert-triangle", select);
    return null;
  }
  return rows.map((row) => {
    const maNhaThau = String(row["Mã nhà thầu"] || row["Mã định danh"] || row["Mã số thuế"] || row["Mã"] || "").trim();
    const tenNhaThau = String(row["Tên nhà thầu"] || row["Nhà thầu"] || "").trim();
    const giaDuThauRaw = String(row["Giá dự thầu (VND)"] || row["Giá dự thầu"] || row["Giá"] || "").trim();
    const tyLeGiamRaw = String(row["Tỷ lệ %"] || row["Tỷ lệ giảm giá (%)"] || row["Tỷ lệ"] || "0").trim();
    const hieuLucHsdtRaw = String(row["Hiệu lực HSDT"] || row["Hiệu lực HSDT (ngày)"] || "").trim();
    const thoiGianThucHien = String(row["Thời gian thực hiện"] || row["Thời gian TH"] || "").trim();
    const foundBid = findOpeningBid(controller, gtId, maNhaThau, tenNhaThau);
    const isValid = Boolean(foundBid);
    const comment = isValid ? "Hợp lệ" : "Không tìm thấy nhà thầu tương ứng trong danh sách mở thầu!";
    const giaDuThau = controller.model.parseVND(giaDuThauRaw) || 0;
    const tyLeGiamGia = parseFloat(tyLeGiamRaw.replace(/,/g, ".")) || 0;
    const giaSauGiamGia = giaDuThau * (1 - tyLeGiamGia / 100);
    return {
      _valid: isValid,
      _comment: comment,
      id: foundBid ? foundBid.id : "",
      maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
      tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
      giaDuThau,
      tyLeGiamGia,
      giaSauGiamGia,
      hieuLucHsdt: parseInt(hieuLucHsdtRaw, 10) || 0,
      thoiGianThucHien
    };
  });
}
export async function parseBidEvaluationImport(controller, rows, context = {}) {
  if (!rows || rows.length === 0) {
    await controller.view.customAlert("Thất bại", "File Excel không có dữ liệu đánh giá HSDT!", "alert-triangle");
    return null;
  }
  const select = context.packageId ? null : document.getElementById("danhgiahsdt-goithau-select");
  const gtId = context.packageId || (select ? select.value : "");
  const goiThau = controller.model.state.goithau.find((g) => g.id === gtId);
  if (!goiThau) {
    await controller.view.customAlert("Thất bại", "Vui lòng chọn gói thầu trước khi nhập Excel!", "alert-triangle", select);
    return null;
  }
  const hasPhanLo = goiThau.phanLo === "Có";
  const activeLotDetails = getActiveEvaluationLotScope(controller, goiThau);
  const isPartialScope = isPartialEvaluationLotScope(activeLotDetails);
  const evaluationTab = context.evaluationTab || controller.currentDanhGiaTab || "technical";
  const technicalScoreRequired = requiresTechnicalScoreInput(goiThau)
    && evaluationTab === "technical";
  return rows.map((row) => {
    const maNhaThau = String(row["Mã nhà thầu"] || row["Mã định danh"] || row["Mã số thuế"] || row["Mã"] || "").trim();
    const tenNhaThau = String(row["Tên nhà thầu"] || row["Nhà thầu"] || "").trim();
    const maPhanLo = String(row["Mã phần lô"] || row["Phần lô"] || row["Mã lô"] || "").trim();
    const foundBid = findEvaluationBid(controller, gtId, maNhaThau, tenNhaThau, maPhanLo, hasPhanLo);
    const inSelectedScope = !isPartialScope || isBidWithinEvaluationLotDetails(foundBid, activeLotDetails);
    const technicalScore = String(row["Đánh giá kỹ thuật"] || row["Kỹ thuật"] || "").trim();
    const technicalValidation = technicalScoreRequired
      ? validateTechnicalScore(technicalScore, { required: true })
      : { valid: true };
    const isValid = Boolean(foundBid && inSelectedScope && technicalValidation.valid);
    const comment = isValid
      ? "Hợp lệ"
      : foundBid && !inSelectedScope
        ? "Dòng này thuộc phần lô ngoài phạm vi đợt đánh giá đang chọn."
        : foundBid && !technicalValidation.valid
          ? `${technicalValidation.message} Không được nhập Đạt/Không đạt.`
        : "Không tìm thấy nhà thầu/lô tương ứng trong thông tin mở thầu của gói thầu này!";
    if (["financial", "unified"].includes(context.evaluationTab || controller.currentDanhGiaTab)) {
      const giaDuThauRaw = String(row["Giá dự thầu (VND)"] || row["Giá dự thầu (VND)"] || row["Giá dự thầu"] || row["Giá"] || "0").trim();
      const tyLeGiamRaw = String(row["Tỷ lệ %"] || row["Tỷ lệ giảm giá (%)"] || row["Tỷ lệ"] || "0").trim();
      const hieuLucHsdtRaw = String(row["Hiệu lực HSDT"] || row["Hiệu lực HSDT (ngày)"] || "").trim();
      const thoiGianThucHien = String(row["Thời gian thực hiện"] || row["Thời gian thực hiện (ngày)"] || row["Thời gian TH"] || "").trim();
      const lamRoTaiChinh = String(row["Làm rõ tài chính"] || "").trim();
      const giaXepHang = controller.model.parseVND(row["Giá xếp hạng (VND)"] || row["Giá xếp hạng"] || "") || 0;
      const giaDeNghiTrungThau = controller.model.parseVND(
        row["Giá đề nghị trúng thầu (VND)"] || row["Giá đề nghị trúng thầu"] || "",
      ) || 0;
      const chapThuanGiaDeNghiTrungThauDuoi50 = normalizeLowPriceAcceptance(
        row["Xử lý giá đề nghị trúng thầu dưới 50%"]
          || row["Chấp thuận giá đề nghị trúng thầu dưới 50%"]
          || "",
      );
      const giaDuThau = controller.model.parseVND(giaDuThauRaw) || 0;
      const tyLeGiamGia = parseFloat(tyLeGiamRaw.replace(/,/g, ".")) || 0;
      const giaSauGiamGia = giaDuThau * (1 - tyLeGiamGia / 100);
      const rec2 = {
        _valid: isValid,
        _comment: comment,
        id: foundBid ? foundBid.id : "",
        maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
        tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
        giaDuThau,
        tyLeGiamGia,
        giaSauGiamGia,
        giaXepHang,
        giaDeNghiTrungThau,
        chapThuanGiaDeNghiTrungThauDuoi50,
        hieuLucHsdt: parseInt(hieuLucHsdtRaw, 10) || 0,
        thoiGianThucHien,
        lamRoTaiChinh
      };
      if (hasPhanLo) {
        rec2.maPhanLo = foundBid ? foundBid.maPhanLo : maPhanLo;
        rec2.tenPhanLo = foundBid ? foundBid.tenPhanLo : "";
      }
      return rec2;
    }
    const rec = {
      _valid: isValid,
      _comment: comment,
      id: foundBid ? foundBid.id : "",
      maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
      tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
      danhGiaHopLe: String(row["Đánh giá hợp lệ"] || row["Đánh giá tính hợp lệ"] || row["Hợp lệ"] || "").trim(),
      danhGiaNangLuc: String(row["Đánh giá năng lực"] || row["Đánh giá năng lực kinh nghiệm"] || row["Năng lực"] || "").trim(),
      danhGiaKyThuat: technicalScore,
      danhGiaKetLuan: String(row["Kết luận"] || row["Kết quả"] || "").trim(),
      lamRoHopLe: String(row["Làm rõ hợp lệ"] || row["Làm rõ tính hợp lệ"] || "").trim(),
      lamRoNangLuc: String(row["Làm rõ năng lực"] || row["Làm rõ năng lực kinh nghiệm"] || "").trim(),
      lamRoKyThuat: String(row["Làm rõ kỹ thuật"] || "").trim(),
      lamRoTaiChinh: String(row["Làm rõ tài chính"] || "").trim(),
      nguyenNhanKhongDatHopLe: String(row["Lý do không đạt hợp lệ"] || "").trim(),
      nguyenNhanKhongDatNangLuc: String(row["Lý do không đạt năng lực"] || "").trim(),
      nguyenNhanKhongDatKyThuat: String(row["Lý do không đạt kỹ thuật"] || "").trim()
    };
    if (hasPhanLo) {
      rec.maPhanLo = foundBid ? foundBid.maPhanLo : maPhanLo;
      rec.tenPhanLo = foundBid ? foundBid.tenPhanLo : "";
    }
    return rec;
  });
}
export async function parseAwardResultImport(controller, rows, context = {}) {
  if (!rows || rows.length === 0) {
    await controller.view.customAlert("Thất bại", "File Excel không có dữ liệu kết quả phê duyệt LCNT!", "alert-triangle");
    return null;
  }
  const gtId = context.packageId || controller._currentResultPackageId;
  const goiThau = controller.model.state.goithau.find((g) => g.id === gtId);
  if (!goiThau) {
    const select = document.getElementById("result-goithau-select") || document.getElementById("danhgiahsdt-goithau-select") || document.getElementById("mothau-goithau-select");
    await controller.view.customAlert("Thất bại", "Vui lòng chọn gói thầu trước khi nhập Excel!", "alert-triangle", select);
    return null;
  }
  return rows.map((row) => {
    const maNhaThau = String(row["Mã nhà thầu"] || row["Mã định danh"] || row["Mã số thuế"] || row["Mã"] || "").trim();
    const tenNhaThau = String(row["Tên nhà thầu"] || row["Nhà thầu"] || "").trim();
    const trangThai = String(row["Trúng thầu/Trượt thầu"] || row["Trúng thầu/trượt thầu"] || row["Trạng thái"] || row["Kết quả"] || "").trim();
    const lyDoTruot = String(row["Lý do trượt"] || row["Lý do trượt thầu"] || "").trim();
    const giaTrungThauRaw = String(row["Giá trúng thầu"] || row["Giá trúng"] || row["Giá trúng thầu (VND)"] || "").trim();
    const thoiGianGoiThau = String(row["Thời gian thực hiện gói thầu"] || row["Thời gian gói"] || "").trim();
    const thoiGianHopDong = String(row["Thời gian thực hiện hợp đồng"] || row["Thời gian hợp đồng"] || "").trim();
    let foundBid = findOpeningBid(controller, gtId, maNhaThau, tenNhaThau);
    let isValid = true;
    let comment = "Hợp lệ";
    if (!foundBid) {
      if (goiThau.hinhThucLuaChon === "Chỉ định thầu rút gọn" || goiThau.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
        const foundNt = controller.model.getLatestNhaThau().find(
          (n) => n.maNhaThau && maNhaThau && n.maNhaThau.toLowerCase() === maNhaThau.toLowerCase() || n.tenNhaThau && tenNhaThau && n.tenNhaThau.toLowerCase() === tenNhaThau.toLowerCase()
        );
        if (foundNt) {
          comment = "Hợp lệ (Nhà thầu mới sẽ được thêm vào danh sách)";
          foundBid = {
            id: generateRecordId("thongtinmothau"),
            nhaThauId: foundNt.id,
            maNhaThau: foundNt.maNhaThau || foundNt.maSoThue || "",
            tenNhaThau: foundNt.tenNhaThau,
            loaiNhaThau: foundNt.loaiNhaThau || "Độc lập",
            thanhVienLienDanh: foundNt.thanhVienLienDanh || []
          };
        } else {
          isValid = false;
          comment = "Không tìm thấy nhà thầu này trong danh sách Nhà thầu của hệ thống. Vui lòng thêm nhà thầu này trước!";
        }
      } else {
        isValid = false;
        comment = "Không tìm thấy nhà thầu tương ứng trong thông tin mở thầu của gói thầu này!";
      }
    }
    return {
      _valid: isValid,
      _comment: comment,
      id: foundBid ? foundBid.id : "",
      nhaThauId: foundBid ? foundBid.nhaThauId : "",
      maNhaThau: foundBid ? foundBid.maNhaThau : maNhaThau,
      tenNhaThau: foundBid ? foundBid.tenNhaThau : tenNhaThau,
      trangThai,
      lyDoTruot,
      giaTrungThau: controller.model.parseVND(giaTrungThauRaw) || 0,
      thoiGianGoiThau,
      thoiGianHopDong
    };
  });
}
export async function parseOpeningImport(controller, rows, context = {}) {
  if (!rows || rows.length === 0) {
    await controller.view.customAlert("Thất bại", "File Excel không có dữ liệu nhập mở thầu!", "alert-triangle");
    return null;
  }
  const select = context.packageId ? null : document.getElementById("mothau-goithau-select");
  const gtId = context.packageId || (select ? select.value : "");
  const goiThau = controller.model.state.goithau.find((g) => g.id === gtId);
  if (!goiThau) {
    await controller.view.customAlert("Thất bại", "Vui lòng chọn gói thầu trước khi nhập Excel!", "alert-triangle", select);
    return null;
  }
  const hasPhanLo = goiThau.phanLo === "Có";
  return rows.map((row) => {
    const maNhaThau = String(row["Mã nhà thầu"] || row["Mã định danh"] || row["Mã nhà thầu"] || row["Mã số thuế"] || row["Mã"] || "").trim();
    const maDinhDanh = maNhaThau;
    const rawNhaThau = String(row["Tên nhà thầu (Nhập chính xác)"] || row["Tên nhà thầu"] || row["Nhà thầu"] || "").trim();
    const loaiNhaThau = String(row["Loại nhà thầu"] || "Độc lập").trim();
    const foundNhaThau = controller.model.state.nhathau.find(
      (n) => n.maNhaThau && maNhaThau && n.maNhaThau.toLowerCase() === maNhaThau.toLowerCase() || n.tenNhaThau && rawNhaThau && n.tenNhaThau.toLowerCase() === rawNhaThau.toLowerCase()
    );
    const nhaThauId = foundNhaThau ? foundNhaThau.id : generateRecordId("nhathau");
    const maPhanLo = String(row["Mã phần lô"] || row["Phần lô"] || row["Mã lô"] || "").trim();
    let tenPhanLo = String(row["Tên phần lô (Tự động điền)"] || row["Tên phần lô"] || row["Tên lô"] || "").trim();
    if (maPhanLo && !tenPhanLo && goiThau.phanLoList) {
      const matchedLot = goiThau.phanLoList.find((l) => l.maPhanLo === maPhanLo);
      if (matchedLot) tenPhanLo = matchedLot.tenPhanLo;
    }
    let isValid = true;
    let comment = "Hợp lệ";
    if (!rawNhaThau) {
      isValid = false;
      comment = "Tên nhà thầu không được để trống!";
    } else if (!maNhaThau) {
      isValid = false;
      comment = "Mã nhà thầu không được để trống!";
    }
    if (hasPhanLo && !maPhanLo) {
      isValid = false;
      comment = "Mã phần lô không được để trống!";
    }
    const record = {
      _valid: isValid,
      _comment: comment,
      maDinhDanh,
      nhaThauId,
      maNhaThau,
      tenNhaThau: rawNhaThau,
      loaiNhaThau,
      giaDuThau: controller.model.parseVND(row["Giá dự thầu (VND)"] || row["Giá dự thầu"] || row["Giá"] || ""),
      tyLeGiamGia: parseFloat(row["Tỷ lệ giảm giá (%)"] || row["Tỷ lệ giảm (%)"] || row["Tỷ lệ giảm"] || "0"),
      giaSauGiamGia: controller.model.parseVND(row["Giá sau giảm giá (nếu có)"] || row["Giá sau giảm giá"] || ""),
      hieuLucHsdt: parseInt(row["Hiệu lực E-HSDT (ngày)"] || row["Hiệu lực E-HSDT"] || row["Hiệu lực E-HSĐXKT (ngày)"] || row["Hiệu lực E-HSĐXKT"] || "90", 10),
      giaTriDamBao: controller.model.parseVND(row["Giá trị ĐB DT (VND)"] || row["Giá trị ĐB"] || row["Giá trị ĐB DT"] || row["Đảm bảo dự thầu (VND)"] || row["Đảm bảo dự thầu"] || row["Đảm bảo"] || ""),
      hieuLucBaoDamNgay: parseInt(row["Hiệu lực ĐB (ngày)"] || row["Hiệu lực ĐB"] || row["Hiệu lực đảm bảo (ngày)"] || row["Hiệu lực đảm bảo"] || row["Hiệu lực bảo đảm"] || "120", 10),
      thoiGianThucHien: String(row["Thời gian thực hiện (ngày)"] || row["Thời gian thực hiện"] || "").trim()
    };
    if (hasPhanLo) {
      record.maPhanLo = maPhanLo;
      record.tenPhanLo = tenPhanLo;
    }
    return record;
  });
}
import { generateRecordId } from "../shared/idUtils.js";
