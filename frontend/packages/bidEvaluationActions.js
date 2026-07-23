import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { validateRequiredEvaluationReportFields } from "./bidEvaluationValidation.js";
import { apiFetch } from "../shared/apiClient.js";
import { resolveLatestPackage, selectPackageDetailTab } from "./detail/PackageDetailState.js";
import { persistAndSync } from "../shared/MutationService.js";
import {
  ensureEvaluationLotBatch,
  getEvaluationLotScopeDetails,
  getPackageEvaluationLots,
  initializeEvaluationLotScope,
  isPartialEvaluationLotScope,
  saveEvaluationScopeMetadata
} from "./lotEvaluationScope.js";

function parseEvaluationMetadata(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function resolvePostEvaluationTargetTab({
  isTwoEnvelope,
  currentEvaluationTab = "technical",
  savedPartialScope = false,
  qualifiedBidCount = 0
} = {}) {
  if (!isTwoEnvelope) return "result";
  if (currentEvaluationTab === "financial") return "result";
  return qualifiedBidCount > 0 ? "qualified" : "result";
}

export function updateRowConclusion(tr, savedKetLuan = null, isReadOnly = false) {
  const cell = tr.querySelector(".mt-ketluan-cell");
  if (!cell) return;
  const inpHopLe = tr.querySelector(".mt-dg-hop-le");
  const inpNangLuc = tr.querySelector(".mt-dg-nang-luc");
  const inpKyThuat = tr.querySelector(".mt-dg-ky-thuat");
  const valHopLe = (inpHopLe?.value || inpHopLe?.textContent || "").trim();
  const valNangLuc = (inpNangLuc?.value || inpNangLuc?.textContent || "").trim();
  const valKyThuat = (inpKyThuat?.value || inpKyThuat?.textContent || "").trim();
  if (!isReadOnly) {
    if (inpNangLuc) {
      if (valHopLe.toLowerCase() === "đạt") {
        inpNangLuc.removeAttribute("disabled");
        setRuntimeStyle(inpNangLuc, "background", "");
        setRuntimeStyle(inpNangLuc, "cursor", "auto");
      } else {
        inpNangLuc.setAttribute("disabled", "true");
        setRuntimeStyle(inpNangLuc, "background", "var(--neutral-soft)");
        setRuntimeStyle(inpNangLuc, "cursor", "not-allowed");
        inpNangLuc.value = "";
      }
    }
    if (inpKyThuat) {
      if (valHopLe.toLowerCase() === "đạt" && valNangLuc.toLowerCase() === "đạt") {
        inpKyThuat.removeAttribute("disabled");
        setRuntimeStyle(inpKyThuat, "background", "");
        setRuntimeStyle(inpKyThuat, "cursor", "auto");
      } else {
        inpKyThuat.setAttribute("disabled", "true");
        setRuntimeStyle(inpKyThuat, "background", "var(--neutral-soft)");
        setRuntimeStyle(inpKyThuat, "cursor", "not-allowed");
        inpKyThuat.value = "";
      }
    }
  }
  const valHopLeFinal = (inpHopLe?.value || inpHopLe?.textContent || "").trim();
  const valNangLucFinal = (inpNangLuc?.value || inpNangLuc?.textContent || "").trim();
  const valKyThuatFinal = (inpKyThuat?.value || inpKyThuat?.textContent || "").trim();
  const isNumeric = (val) => {
    if (!val) return false;
    const normalized = val.trim().replace(/,/g, ".");
    return !isNaN(normalized) && isFinite(normalized) && normalized !== "";
  };
  let conclusion = "";
  let status = "pending";
  if (!valHopLeFinal) {
    conclusion = "";
    status = "pending";
  } else if (valHopLeFinal.toLowerCase() !== "đạt") {
    conclusion = "Không đạt yêu cầu về tính hợp lệ";
    status = "fixed_fail";
  } else if (!valNangLucFinal) {
    conclusion = "";
    status = "pending";
  } else if (valNangLucFinal.toLowerCase() !== "đạt") {
    conclusion = "Không đạt yêu cầu về năng lực, kinh nghiệm";
    status = "fixed_fail";
  } else {
    if (!valKyThuatFinal) {
      conclusion = "";
      status = "pending";
    } else if (valKyThuatFinal.toLowerCase() === "không đạt") {
      conclusion = "Không đạt yêu cầu kỹ thuật";
      status = "fixed_fail";
    } else if (valKyThuatFinal.toLowerCase() === "đạt") {
      conclusion = "Đạt";
      status = "fixed_pass";
    } else if (isNumeric(valKyThuatFinal)) {
      status = "user_select";
      conclusion = savedKetLuan || "";
    } else {
      status = "user_select";
      conclusion = savedKetLuan || "";
    }
  }
  if (isReadOnly) {
    const finalConclusion = savedKetLuan || conclusion;
    if (finalConclusion === "Đạt" || finalConclusion === "Đạt (Xếp hạng 1)" || finalConclusion.startsWith("Đạt")) {
      cell.innerHTML = trustedHTML(`<span class="badge badge-success bf-s-c6fa01b3f1">Đạt</span>`);
    } else if (finalConclusion && finalConclusion.startsWith("Không đạt")) {
      cell.innerHTML = trustedHTML(`<span class="badge badge-danger bf-s-fc8cc31ae8">${escapeHtml(finalConclusion)}</span>`);
    } else {
      cell.innerHTML = trustedHTML(`<span>${escapeHtml(finalConclusion || "--")}</span>`);
    }
  } else {
    if (status === "fixed_pass") {
      if (cell.textContent.trim() !== "Đạt" || !cell.querySelector(".badge-success")) {
        cell.innerHTML = trustedHTML(`<span class="badge badge-success bf-s-a9d5133cd4">Đạt</span>`);
      }
    } else if (status === "fixed_fail") {
      if (cell.textContent.trim() !== conclusion || !cell.querySelector(".badge-danger")) {
        cell.innerHTML = trustedHTML(`<span class="badge badge-danger bf-s-18dd987272">${escapeHtml(conclusion)}</span>`);
      }
    } else if (status === "user_select") {
      const existingSelect = cell.querySelector(".mt-dg-ketluan");
      if (existingSelect) {
        if (existingSelect.value !== conclusion) {
          existingSelect.value = conclusion;
        }
      } else {
        cell.innerHTML = trustedHTML(`
                    <select class="form-control mt-dg-ketluan bf-s-9bdb7b6b47">
                        <option value="">-- Chọn --</option>
                        <option value="Đạt" ${conclusion === "Đạt" ? "selected" : ""}>Đạt</option>
                        <option value="Không đạt" ${conclusion === "Không đạt" ? "selected" : ""}>Không đạt</option>
                    </select>
                `);
      }
    } else {
      if (cell.textContent.trim() !== "Chờ đánh giá") {
        cell.innerHTML = trustedHTML(`<span class="bf-s-77eff41817">Chờ đánh giá</span>`);
      }
    }
  }
}
export async function saveDanhGiaHsdt() {
  const select = this.view.getActiveElement("danhgiahsdt-goithau-select");
  if (!select) return;
  let gtId = select.value;
  if (!gtId) {
    this.view.focusInvalidControl(select);
    return;
  }
  const requestedPackage = this.model.state.goithau.find((g) => g.id === gtId);
  const gt = resolveLatestPackage(this.model, requestedPackage || gtId);
  if (!gt) return;
  gtId = gt.id;
  const isPackageDetailContext = this.view.isGoiThauDetailTabActive();
  const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const inpSo = this.view.getActiveElement("danhgiahsdt-so-baocao");
  const inpNgay = this.view.getActiveElement("danhgiahsdt-ngay-baocao");
  const inpNgayMoiDoiChieu = this.view.getActiveElement("danhgiahsdt-ngay-moi-doichieu");
  const inpNgayDoiChieu = this.view.getActiveElement("danhgiahsdt-ngay-doichieu");
  const soBaoCao = inpSo?.value.trim() || "";
  const ngayBaoCaoRaw = inpNgay?.value.trim() || "";
  const ngayBaoCao = this.model.convertDMYToYMD(ngayBaoCaoRaw);
  const ngayMoiDoiChieuRaw = inpNgayMoiDoiChieu?.value.trim() || "";
  const ngayDoiChieuRaw = inpNgayDoiChieu?.value.trim() || "";
  const ngayMoiDoiChieu = ngayMoiDoiChieuRaw ? this.model.convertDMYToYMD(ngayMoiDoiChieuRaw) : "";
  const ngayDoiChieu = ngayDoiChieuRaw ? this.model.convertDMYToYMD(ngayDoiChieuRaw) : "";
  const reportValidation = validateRequiredEvaluationReportFields({
    reportNumberInput: inpSo,
    reportDateInput: inpNgay
  });
  if (!reportValidation.valid) {
    const first = reportValidation.errorInputs[0];
    this.view.focusInvalidControl(first);
    return;
  }
  let evaluationLotScope = null;
  let evaluationLotDetails = null;
  let evaluationBatch = null;
  const packageLots = getPackageEvaluationLots(gt);
  if (packageLots.length > 0) {
    const parsedMetadata = parseEvaluationMetadata(gt.danhGiaHsdtMetadata);
    const scopeBlock = is1G2T
      ? parsedMetadata.technical || {}
      : parsedMetadata;
    const scopeKey = `${String(gtId)}:${String(this.currentDanhGiaTab || "technical")}`;
    this._evaluationLotScopes = this._evaluationLotScopes || {};
    evaluationLotScope = initializeEvaluationLotScope(gt, scopeBlock, this._evaluationLotScopes[scopeKey]);
    this._evaluationLotScopes[scopeKey] = evaluationLotScope;
    evaluationLotDetails = getEvaluationLotScopeDetails(gt, evaluationLotScope);
    if (!evaluationLotDetails?.lotIds?.length) {
      const scopeControl = this.view.getActiveElement("danhgiahsdt-scope-container");
      await this.view.customAlert(
        "Chưa chọn phần lô",
        "Vui lòng chọn ít nhất một phần lô thuộc phạm vi đánh giá của đợt này.",
        "alert-triangle",
        scopeControl
      );
      return;
    }
    try {
      evaluationBatch = await ensureEvaluationLotBatch({
        packageId: gtId,
        lotIds: evaluationLotDetails.lotIds,
        fetcher: apiFetch
      });
      evaluationBatch.lotCodes = evaluationLotDetails.lotCodes;
      evaluationLotScope.batchId = evaluationBatch.id;
    } catch (error) {
      await this.view.customAlert(
        "Không thể tạo đợt đánh giá",
        error?.message || "Không thể xác lập phạm vi phần lô. Vui lòng thử lại.",
        "alert-triangle",
        this.view.getActiveElement("danhgiahsdt-scope-container")
      );
      return;
    }
  }
  const collectLetters = (containerId) => {
    const list = [];
    const container = this.view.getActiveElement(containerId);
    if (!container) return list;
    container.querySelectorAll(".letter-row").forEach((row) => {
      const soCv = row.querySelector(".letter-so-cv")?.value.trim() || "";
      const ngayCvRaw = row.querySelector(".letter-ngay-cv")?.value.trim() || "";
      const ngayCv = this.model.convertDMYToYMD(ngayCvRaw);
      if (soCv && ngayCv) {
        list.push({ soCv, ngayCv });
      }
    });
    return list;
  };
  const cvLamRo = collectLetters("list-cv-lamro");
  const cvTraLoi = collectLetters("list-cv-traloi");
  const cvGuiCdt = collectLetters("list-cv-guicdt");
  const quyTrinhContainer = this.view.getActiveElement("danhgiahsdt-quytrinh-container");
  if (quyTrinhContainer && getComputedStyle(quyTrinhContainer).display !== "none") {
    const radio2 = quyTrinhContainer.querySelector('input[value="quytrinh2"]');
    if (radio2) {
      gt.quyTrinhDanhGia = radio2.checked ? "quytrinh2" : "quytrinh1";
    }
  }
  const hasExtraFields = !isDirectOrSpecial && (!is1G2T || this.currentDanhGiaTab === "financial");
  const activeBlock = {
    soBaoCao,
    ngayBaoCao,
    cvLamRo,
    cvTraLoi,
    cvGuiCdt,
    quyTrinhDanhGia: gt.quyTrinhDanhGia || "quytrinh1",
    saved: true
  };
  if (evaluationLotDetails) {
    activeBlock.lotIds = evaluationLotDetails.lotIds;
    activeBlock.lotCodes = evaluationLotDetails.lotCodes;
    activeBlock.batchId = evaluationBatch?.id || evaluationLotScope?.batchId || "";
    activeBlock.isWholePackage = evaluationLotDetails.isWholePackage;
  }
  if (hasExtraFields) {
    activeBlock.ngayMoiDoiChieu = ngayMoiDoiChieu;
    activeBlock.ngayDoiChieu = ngayDoiChieu;
  }
  if (is1G2T) {
    let currentMetadata = { is1G2T: true, technical: { saved: false }, financial: { saved: false } };
    if (gt.danhGiaHsdtMetadata) {
      try {
        const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
        if (parsed.is1G2T) {
          currentMetadata = parsed;
        }
      } catch (e) {
        console.error("Error parsing existing metadata:", e);
      }
    }
    if (this.currentDanhGiaTab === "technical") {
      currentMetadata.technical = evaluationBatch
        ? saveEvaluationScopeMetadata(
          currentMetadata.technical || {},
          evaluationBatch,
          activeBlock,
          packageLots.map((lot) => lot.id)
        )
        : { ...currentMetadata.technical, ...activeBlock };
    } else {
      currentMetadata.financial = evaluationBatch
        ? saveEvaluationScopeMetadata(
          currentMetadata.financial || {},
          evaluationBatch,
          activeBlock,
          packageLots.map((lot) => lot.id)
        )
        : { ...currentMetadata.financial, ...activeBlock };
    }
    gt.danhGiaHsdtMetadata = JSON.stringify(currentMetadata);
  } else {
    gt.danhGiaHsdtMetadata = JSON.stringify(evaluationBatch
      ? saveEvaluationScopeMetadata(
        parseEvaluationMetadata(gt.danhGiaHsdtMetadata),
        evaluationBatch,
        activeBlock,
        packageLots.map((lot) => lot.id)
      )
      : activeBlock);
  }
  const rows = this.view.getActiveElement("danhgiahsdt-table-tbody").querySelectorAll("tr");
  const updatedBidsList = [];
  rows.forEach((tr) => {
    const bidId = tr.getAttribute("data-bid-id");
    const bid = this.model.state.thongtinmothau.find((b) => b.id === bidId);
    if (bid) {
      let giaDuThau = bid.giaDuThau;
      let tyLeGiamGia = bid.tyLeGiamGia;
      let giaSauGiamGia = bid.giaSauGiamGia;
      let danhGiaHopLe = bid.danhGiaHopLe;
      let danhGiaNangLuc = bid.danhGiaNangLuc;
      let danhGiaKyThuat = bid.danhGiaKyThuat;
      let danhGiaKetLuan = bid.danhGiaKetLuan;
      if (is1G2T && this.currentDanhGiaTab === "financial") {
        giaDuThau = this.model.parseVND(tr.querySelector(".mt-gia-du-thau")?.value || "");
        const tyLeRaw = tr.querySelector(".mt-ty-le-giam-gia")?.value || "0";
        tyLeGiamGia = parseFloat(tyLeRaw.replace(/,/g, ".")) || 0;
        giaSauGiamGia = this.model.parseVND(tr.querySelector(".mt-gia-sau-giam-gia")?.value || "");
      } else {
        danhGiaHopLe = tr.querySelector(".mt-dg-hop-le")?.value.trim() || "";
        danhGiaNangLuc = tr.querySelector(".mt-dg-nang-luc")?.value.trim() || "";
        danhGiaKyThuat = tr.querySelector(".mt-dg-ky-thuat")?.value.trim() || "";
        const selectKetLuan = tr.querySelector(".mt-dg-ketluan");
        if (selectKetLuan) {
          danhGiaKetLuan = selectKetLuan.value;
        } else {
          const cell = tr.querySelector(".mt-ketluan-cell");
          danhGiaKetLuan = cell ? cell.textContent.trim() : "";
        }
      }
      const nguyenNhanKhongDatHopLe = tr.querySelector(".mt-reason-fail-hople")?.value.trim() || "";
      const nguyenNhanKhongDatNangLuc = tr.querySelector(".mt-reason-fail-nangluc")?.value.trim() || "";
      const nguyenNhanKhongDatKyThuat = tr.querySelector(".mt-reason-fail-kythuat")?.value.trim() || "";
      updatedBidsList.push({
        ...bid,
        giaDuThau,
        tyLeGiamGia,
        giaSauGiamGia,
        danhGiaHopLe,
        danhGiaNangLuc,
        danhGiaKyThuat,
        danhGiaKetLuan,
        nguyenNhanKhongDatHopLe,
        nguyenNhanKhongDatNangLuc,
        nguyenNhanKhongDatKyThuat
      });
    }
  });
  const { rankings } = this.calculateRankings(gt, updatedBidsList);
  rows.forEach((tr) => {
    const bidId = tr.getAttribute("data-bid-id");
    if (!bidId) return;
    const bid = this.model.state.thongtinmothau.find((b) => b.id === bidId);
    if (bid) {
      const finalRank = rankings[bid.id];
      if (is1G2T && this.currentDanhGiaTab === "financial") {
        bid.giaDuThau = this.model.parseVND(tr.querySelector(".mt-gia-du-thau")?.value || "");
        const tyLeRaw = tr.querySelector(".mt-ty-le-giam-gia")?.value || "0";
        bid.tyLeGiamGia = parseFloat(tyLeRaw.replace(/,/g, ".")) || 0;
        bid.giaSauGiamGia = this.model.parseVND(tr.querySelector(".mt-gia-sau-giam-gia")?.value || "");
        bid.hieuLucHsdt = parseInt(tr.querySelector(".mt-hieu-luc-hsdt")?.value || "0", 10);
        const giaTriDamBaoEl = tr.querySelector(".mt-gia-tri-dam-bao");
        if (giaTriDamBaoEl) {
          bid.giaTriDamBao = this.model.parseVND(giaTriDamBaoEl.value || "");
        }
        const hieuLucBaoDamNgayEl = tr.querySelector(".mt-hieu-luc-bao-dam-ngay");
        if (hieuLucBaoDamNgayEl) {
          bid.hieuLucBaoDamNgay = parseInt(hieuLucBaoDamNgayEl.value || "0", 10);
        }
        const thoiGianThucHienEl = tr.querySelector(".mt-thoi-gian-thuc-hien");
        if (thoiGianThucHienEl) {
          bid.thoiGianThucHien = thoiGianThucHienEl.value.trim();
        }
        const isFailedFinancial = bid.danhGiaKetLuan && bid.danhGiaKetLuan.startsWith("Không đạt");
        bid.danhGiaTaiChinh = finalRank ? `Xếp hạng ${finalRank}` : isFailedFinancial ? "Không xếp hạng" : "--";
        bid.lamRoTaiChinh = tr.querySelector(".mt-lam-ro-tai-chinh")?.value.trim() || "";
      } else {
        bid.danhGiaHopLe = tr.querySelector(".mt-dg-hop-le")?.value.trim() || "";
        bid.danhGiaNangLuc = tr.querySelector(".mt-dg-nang-luc")?.value.trim() || "";
        bid.danhGiaKyThuat = tr.querySelector(".mt-dg-ky-thuat")?.value.trim() || "";
        const selectKetLuan = tr.querySelector(".mt-dg-ketluan");
        if (selectKetLuan) {
          bid.danhGiaKetLuan = selectKetLuan.value;
        } else {
          const cell = tr.querySelector(".mt-ketluan-cell");
          bid.danhGiaKetLuan = cell ? cell.textContent.trim() : "";
        }
        const isFailedTechnical = bid.danhGiaKetLuan && bid.danhGiaKetLuan.startsWith("Không đạt");
        bid.danhGiaTaiChinh = finalRank ? `Xếp hạng ${finalRank}` : isFailedTechnical ? "Không xếp hạng" : "--";
        const inpLamRoHopLe = tr.querySelector(".mt-lam-ro-hop-le");
        if (inpLamRoHopLe) bid.lamRoHopLe = inpLamRoHopLe.value.trim();
        const inpLamRoNangLuc = tr.querySelector(".mt-lam-ro-nang-luc");
        if (inpLamRoNangLuc) bid.lamRoNangLuc = inpLamRoNangLuc.value.trim();
        const inpLamRoKyThuat = tr.querySelector(".mt-lam-ro-ky-thuat");
        if (inpLamRoKyThuat) bid.lamRoKyThuat = inpLamRoKyThuat.value.trim();
        const inpLamRoTaiChinh = tr.querySelector(".mt-lam-ro-tai-chinh");
        if (inpLamRoTaiChinh) bid.lamRoTaiChinh = inpLamRoTaiChinh.value.trim();
        bid.nguyenNhanKhongDatHopLe = tr.querySelector(".mt-reason-fail-hople")?.value.trim() || "";
        bid.nguyenNhanKhongDatNangLuc = tr.querySelector(".mt-reason-fail-nangluc")?.value.trim() || "";
        bid.nguyenNhanKhongDatKyThuat = tr.querySelector(".mt-reason-fail-kythuat")?.value.trim() || "";
      }
    }
  });
  const syncResult = await persistAndSync(this, ["goithau", "thongtinmothau"]);
  if (!syncResult?.ok) return;
  this.view.renderGoiThauTable();
  const stepKey = this.currentDanhGiaTab === "financial" ? "eval_fin" : "eval_tech";
  if (this.view._editingState) {
    this.view._editingState[stepKey] = false;
  }
  const savedPartialScope = isPartialEvaluationLotScope(evaluationLotDetails);
  if (isPackageDetailContext) {
    const allBids = is1G2T && this.currentDanhGiaTab === "technical"
      ? this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId))
      : [];
    const qualifiedBidCount = allBids.filter((b) => {
      const conclusion = String(b.danhGiaKetLuan || "").trim().toLowerCase();
      return conclusion === "đạt" || conclusion.startsWith("đạt") || conclusion.includes("trúng thầu");
    }).length;
    const targetTab = resolvePostEvaluationTargetTab({
      isTwoEnvelope: is1G2T,
      currentEvaluationTab: this.currentDanhGiaTab,
      savedPartialScope,
      qualifiedBidCount
    });
    this.view._currentResultLotBatchId = evaluationBatch
      ? evaluationBatch?.id || evaluationLotScope?.batchId || ""
      : "";
    const detailPackageId = selectPackageDetailTab(this.view, targetTab, gt, this.model);
    await this.view.showPackageDetails(detailPackageId);
  }
  const scopeMessage = evaluationLotDetails
    ? ` cho ${evaluationLotDetails.lotCodes.join(", ")}`
    : "";
  await this.view.customAlert(
    evaluationBatch ? "Đã lưu báo cáo đánh giá của đợt" : "Lưu thành công",
    savedPartialScope
      ? `Đã lưu chính thức báo cáo đánh giá${scopeMessage}. Hãy tiếp tục các bước nghiệp vụ và phê duyệt kết quả của đợt này.`
      : `Đã lưu thông tin báo cáo đánh giá${scopeMessage} của gói thầu "${gt.tenGoiThau}" thành công!`,
    "check-circle"
  );
}
