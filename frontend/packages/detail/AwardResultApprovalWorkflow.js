import { apiFetch } from "../../shared/apiClient.js";
import { generateRecordId, generateUUID } from "../../shared/idUtils.js";
import {
  getExactContractorVersion,
  selectContractorVersionForDate,
} from "../../partners/contractorVersionBinding.js";
import { clearCompetitiveQuotationAppraisal } from "../packageAppraisal.js";
import {
  commitPackageAwardDecision,
  commitPackageAwardDependencies,
} from "../packageEvaluationProgress.js";
import {
  finalizeEvaluationLotBatch,
  finalizeEvaluationScopeMetadata,
} from "../lotEvaluationScope.js";
import { mergeScopedAwardLotResults } from "../lotAwardResultScope.js";
import { selectPackageDetailTab } from "./PackageDetailState.js";

const CANCEL_REASON = "Tất cả các hồ sơ dự thầu không đáp ứng yêu cầu của hồ sơ mời thầu. Hủy thầu theo quy định tại Điểm a Khoản 1 Điều 17 Luật Đấu thầu số 22/2023/QH15 ngày 23 tháng 6 năm 2023, sửa đổi, bổ sung tại Luật số 57/2024/QH15, Luật số 90/2025/QH15.";

const productionPorts = Object.freeze({
  commitDependencies: (controller) => commitPackageAwardDependencies(controller),
  commitDecision: (controller, options) => commitPackageAwardDecision(controller, options),
  finalizeLotBatch: (input) => finalizeEvaluationLotBatch({ ...input, fetcher: apiFetch }),
});

function parseMetadata(value) {
  if (!value) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseLots(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStoredId(value) {
  if (!value) return "";
  return isNaN(value) ? value : parseInt(value);
}

function resolveApprovalContractor(model, row) {
  const bound = getExactContractorVersion(model, row.contractorId);
  if (bound) return bound;
  return model.getLatestNhaThau().find((contractor) => (
    contractor.maNhaThau
      && row.contractorCode
      && contractor.maNhaThau.toLowerCase() === row.contractorCode.toLowerCase()
  ) || (
    contractor.tenNhaThau
      && row.contractorName
      && contractor.tenNhaThau.toLowerCase() === row.contractorName.toLowerCase()
  )) || null;
}

function createDirectAwardContractor(model, row, decisionDate) {
  const contractorId = generateRecordId("nhathau");
  const contractor = {
    id: contractorId,
    rootId: contractorId,
    phienBan: "00",
    isLatest: 1,
    ngayApDung: decisionDate,
    maNhaThau: row.contractorCode || `NT-${generateUUID().toString().substr(8)}`,
    tenNhaThau: row.contractorName,
    loaiNhaThau: row.contractorType,
    maSoThue: row.contractorCode || "",
    nguoiDaiDien: "",
    danhXung: "Ông",
    soDienThoai: "",
    email: "",
    diaChi: "",
    soTaiKhoan: "",
    noiMoTaiKhoan: "",
    maNganHang: "",
    thanhVienLienDanh: row.contractorType === "Liên danh"
      ? row.jointVentureMembers.map((member) => ({
        tenNhaThau: member.tenNhaThau,
        maSoThue: member.maSoThue,
        vaiTro: "Thành viên liên danh",
      }))
      : [],
  };
  model.state.nhathau.push(contractor);
  return contractor;
}

function buildJointVentureMembers(row, leadContractor) {
  if (row.contractorType !== "Liên danh") return [];
  return [
    {
      thanhVienNhaThauId: leadContractor?.id || row.leadMemberContractorId,
      tenNhaThau: leadContractor?.tenNhaThau || row.leadMemberName || row.contractorName,
      maNhaThau: leadContractor?.maNhaThau || row.contractorCode,
      maSoThue: leadContractor?.maSoThue || row.contractorCode,
      vaiTro: "Đứng đầu liên danh",
    },
    ...row.jointVentureMembers.map((member) => ({
      thanhVienNhaThauId: member.thanhVienNhaThauId || "",
      tenNhaThau: member.tenNhaThau,
      maNhaThau: member.maNhaThau || member.maSoThue,
      maSoThue: member.maSoThue,
      vaiTro: "Thành viên liên danh",
    })),
  ];
}

function applyBidRows(model, pkg, command, decisionDate) {
  if (command.isDirectOrSpecial) {
    model.state.thongtinmothau = model.state.thongtinmothau.filter(
      (bid) => String(bid.goiThauId) !== String(pkg.id),
    );
  }
  command.rows.forEach((row) => {
    let bid = model.state.thongtinmothau.find((item) => item.id === row.bidId);
    if (command.isDirectOrSpecial) {
      let contractor = resolveApprovalContractor(model, row);
      if (!contractor && row.contractorName) {
        contractor = createDirectAwardContractor(model, row, decisionDate);
      }
      bid = {
        id: row.bidId,
        goiThauId: pkg.id,
        nhaThauId: contractor?.id || row.bidId,
        maNhaThau: row.contractorCode,
        tenNhaThau: row.contractorName,
        loaiNhaThau: row.contractorType,
        thanhVienLienDanh: buildJointVentureMembers(row, contractor),
        giaDuThau: row.awardPrice || 0,
        giaSauGiamGia: row.awardPrice || 0,
        giaXepHang: row.awardPrice || 0,
        giaDeNghiTrungThau: row.awardPrice || 0,
        danhGiaHopLe: "Đạt",
        danhGiaNangLuc: "Đạt",
        danhGiaKyThuat: "Đạt",
        danhGiaTaiChinh: "Đạt",
        danhGiaKetLuan: "Đạt",
        thoiGianThucHien: row.packageDuration,
        lyDoTruot: "",
      };
      if (pkg.phanLo === "Có") {
        bid.maPhanLo = row.lotCode;
        bid.tenPhanLo = row.lotName;
      }
      model.state.thongtinmothau.push(bid);
    } else if (bid) {
      bid.lyDoTruot = row.isWinner ? "" : row.rejectionReason;
      if (row.isWinner) bid.giaDeNghiTrungThau = row.awardPrice || bid.giaDeNghiTrungThau || 0;
    }
  });
}

function resolveResultContractorId(model, versionId, decisionDate) {
  return selectContractorVersionForDate(model, versionId, decisionDate)?.id
    || versionId
    || "";
}

function applyPackageAward(model, pkg, command, activeScope, decisionDate) {
  let winnerId = "none";
  if (pkg.phanLo === "Có") {
    const lots = parseLots(pkg.phanLoList);
    const scopedLotResults = command.winnerRows.map((row) => {
      const lot = lots.find((item) => String(item.maPhanLo || "") === String(row.lotCode));
      let contractorId = row.contractorId;
      if (command.isDirectOrSpecial) {
        contractorId = resolveApprovalContractor(model, row)?.id || row.bidId;
      }
      contractorId = resolveResultContractorId(model, contractorId, decisionDate);
      return {
        id: lot?.id || "",
        maPhanLo: row.lotCode,
        nhaThauTrungThauId: normalizeStoredId(contractorId),
        giaTrungThau: row.awardPrice,
        thoiGianGoiThau: row.packageDuration,
        thoiGianHopDong: row.contractDuration,
      };
    });
    const completeScope = {
      lotIds: lots.map((lot) => String(lot.id || "")).filter(Boolean),
      lotCodes: lots.map((lot) => String(lot.maPhanLo || "")).filter(Boolean),
    };
    const merged = mergeScopedAwardLotResults({
      phanLoList: lots,
      scope: activeScope || completeScope,
      scopedLotResults,
    });
    pkg.phanLoList = merged.phanLoList;
    pkg.nhaThauTrungThauId = merged.nhaThauTrungThauId;
    pkg.giaTrungThau = merged.giaTrungThau;
    pkg.thoiGianGoiThau = "";
    pkg.thoiGianHopDong = "";
    winnerId = merged.nhaThauTrungThauId || "none";
  } else {
    const winner = command.winnerRows[0];
    let finalPrice = 0;
    let packageDuration = "";
    let contractDuration = "";
    if (winner) {
      winnerId = command.isDirectOrSpecial
        ? resolveApprovalContractor(model, winner)?.id || winner.bidId
        : winner.contractorId;
      finalPrice = winner.awardPrice;
      packageDuration = winner.packageDuration;
      contractDuration = winner.contractDuration;
    }
    winnerId = winnerId === "none"
      ? winnerId
      : resolveResultContractorId(model, winnerId, decisionDate);
    pkg.nhaThauTrungThauId = winnerId === "none" ? "" : normalizeStoredId(winnerId);
    pkg.giaTrungThau = finalPrice;
    pkg.thoiGianGoiThau = winnerId === "none" ? "" : packageDuration;
    pkg.thoiGianHopDong = winnerId === "none" ? "" : contractDuration;
  }
  return winnerId;
}

function resolveResultMetadata(pkg, activeScope, isTwoEnvelope, decision) {
  const metadata = parseMetadata(pkg.danhGiaHsdtMetadata);
  let target;
  if (activeScope) {
    const store = isTwoEnvelope ? metadata.technical : metadata;
    const batch = store?.lotBatches?.[activeScope.batchId];
    if (!batch) return { metadata, target: null };
    if (!batch.result || typeof batch.result !== "object") batch.result = {};
    target = batch.result;
    target.saved = true;
  } else {
    if (!metadata.result || typeof metadata.result !== "object") metadata.result = {};
    target = metadata.result;
  }
  target.soQuyetDinhKetQua = decision.number;
  target.ngayQuyetDinhKetQua = decision.date;
  target.soBctdKetQua = decision.appraisalNumber;
  target.ngayBctdKetQua = decision.appraisalDate;
  return { metadata, target };
}

function buildContractorBindings(model, command, decisionDate) {
  return command.winnerRows.map((row) => {
    const bid = model.state.thongtinmothau.find(
      (item) => String(item.id) === String(row.bidId),
    );
    return {
      bidId: row.bidId,
      jointVentureName: bid?.loaiNhaThau === "Liên danh" ? bid.tenNhaThau || "" : "",
      contractorVersionId: resolveResultContractorId(
        model,
        row.contractorId || bid?.nhaThauId || "",
        decisionDate,
      ),
      memberVersionIds: (bid?.thanhVienLienDanh || [])
        .map((member) => resolveResultContractorId(
          model,
          member.thanhVienNhaThauId,
          decisionDate,
        ))
        .filter(Boolean),
    };
  });
}

function clearResultEditState(metadata) {
  delete metadata.resultEdit;
  if (metadata.technical && typeof metadata.technical === "object") {
    delete metadata.technical.resultEdit;
  }
}

export function shouldFinalizeOfficialResultLifecycle(batch, isEditingOfficialResult) {
  if (!isEditingOfficialResult) return true;
  return !String(batch?.status || "").trim();
}

async function showResult(view, pkg, tab) {
  const packageId = selectPackageDetailTab(view, tab, pkg, view.model);
  await view.showPackageDetails(packageId);
}

export function createAwardResultApprovalWorkflow(ports = productionPorts) {
  for (const name of ["commitDependencies", "commitDecision", "finalizeLotBatch"]) {
    if (typeof ports?.[name] !== "function") {
      throw new TypeError(`Award approval port ${name} is required.`);
    }
  }
  return Object.freeze({
    async execute({ view, pkg, command, appController, viewModel } = {}) {
      if (!view?.model || !pkg || !command?.ok || !viewModel) {
        throw new TypeError("Award approval workflow received an invalid context.");
      }
      const controller = appController || view;
      const {
        activeScopedEvaluation: activeScope,
        isTwoEnvelope,
        officialLotState,
        isEditingOfficialResult,
      } = viewModel;
      const { decision } = command;

      applyBidRows(view.model, pkg, command, decision.date);
      const winnerId = applyPackageAward(
        view.model,
        pkg,
        command,
        activeScope,
        decision.date,
      );
      let { metadata, target } = resolveResultMetadata(
        pkg,
        activeScope,
        isTwoEnvelope,
        decision,
      );
      if (!target) {
        await view.customAlert(
          "Không thể lưu kết quả",
          "Không tìm thấy đợt phần lô đang xử lý. Vui lòng tải lại gói thầu và thử lại.",
          "alert-triangle",
        );
        return { ok: false, kind: "missing_scope" };
      }
      target.contractorBindings = buildContractorBindings(
        view.model,
        command,
        decision.date,
      );

      if (activeScope) {
        const winnerCodes = new Set(command.winnerRows.map((row) => row.lotCode));
        const outcomes = {};
        activeScope.lotIds.forEach((lotId, index) => {
          const lotCode = activeScope.lotCodes[index] || "";
          outcomes[lotId] = winnerCodes.has(lotCode) ? "AWARDED" : "NO_RESPONSIVE_BID";
        });
        const shouldFinalize = shouldFinalizeOfficialResultLifecycle(
          activeScope.batch,
          isEditingOfficialResult,
        );
        const officialResult = {
          ...target,
          soQuyetDinhKetQua: decision.number,
          ngayQuyetDinhKetQua: decision.date,
        };
        if (isTwoEnvelope) {
          metadata.technical = finalizeEvaluationScopeMetadata(
            metadata.technical || {},
            activeScope.batchId,
            officialResult,
          );
          if (metadata.financial?.lotBatches?.[activeScope.batchId]) {
            metadata.financial = finalizeEvaluationScopeMetadata(
              metadata.financial,
              activeScope.batchId,
              officialResult,
            );
          }
        } else {
          metadata = finalizeEvaluationScopeMetadata(
            metadata,
            activeScope.batchId,
            officialResult,
          );
        }
        clearResultEditState(metadata);
        pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);

        let lifecycle = null;
        if (shouldFinalize) {
          try {
            const dependencySync = await ports.commitDependencies(controller);
            if (!dependencySync?.ok) return { ok: false, kind: "sync_failed" };
            const lots = parseLots(pkg.phanLoList);
            const lotsById = new Map(lots.map((lot) => [String(lot.id || ""), lot]));
            lifecycle = await ports.finalizeLotBatch({
              packageId: pkg.id,
              batchId: activeScope.batchId,
              outcomes,
              packageAward: {
                expectedVersion: Number.isInteger(pkg.rowVersion) ? pkg.rowVersion : 1,
                decisionNumber: decision.number,
                decisionDate: decision.date,
                metadata,
                lotResults: activeScope.lotIds.map((lotId) => {
                  const lot = lotsById.get(String(lotId)) || {};
                  return {
                    lotId,
                    winnerId: lot.nhaThauTrungThauId || "",
                    awardPrice: Number(lot.giaTrungThau) || 0,
                    packageDuration: lot.thoiGianGoiThau || "",
                    contractDuration: lot.thoiGianHopDong || "",
                  };
                }),
              },
            });
          } catch (error) {
            await view.customAlert(
              isEditingOfficialResult
                ? "Không thể cập nhật kết quả đợt"
                : "Không thể phê duyệt kết quả đợt",
              error?.message || (isEditingOfficialResult
                ? "Không thể đồng bộ trạng thái của đợt kết quả cũ."
                : "Không thể đóng đợt đánh giá chính thức."),
              "alert-triangle",
            );
            return { ok: false, kind: "lifecycle_failed" };
          }
        }
        const isPackageCompleted = isEditingOfficialResult
          ? officialLotState.isComplete
          : lifecycle?.packageStatus === "COMPLETED";
        if (pkg.trangThai !== "Hủy thầu") {
          pkg.trangThai = isPackageCompleted
            ? "Đã có kết quả"
            : "Đã có kết quả một phần";
        }
        if (!isEditingOfficialResult) {
          pkg.soQuyetDinhKetQua = decision.number;
          pkg.ngayQuyetDinhKetQua = decision.date;
        }
        if (shouldFinalize) {
          pkg.rowVersion = lifecycle.packageRowVersion;
          await view.model.applyCommittedRowVersions?.([{
            table: "goithau",
            id: pkg.id,
            rowVersion: lifecycle.packageRowVersion,
          }]);
          await view.renderGoiThauTable();
        } else {
          const syncResult = await ports.commitDecision(controller, {
            packageRecord: pkg,
            afterPersist: () => view.renderGoiThauTable(),
          });
          if (!syncResult?.ok) return { ok: false, kind: "sync_failed" };
        }
        view._continueOfficialLotEvaluation = view._continueOfficialLotEvaluation || {};
        view._continueOfficialLotEvaluation[pkg.id] = false;
        view._editingOfficialResultLotBatchId = "";
        view._currentResultLotBatchId = "";
        await showResult(view, pkg, "result");
        await view.customAlert(
          isEditingOfficialResult
            ? `Đã cập nhật kết quả Lần ${activeScope.batch?.sequenceNo || ""}`.trim()
            : `Đã phê duyệt kết quả Lần ${activeScope.batch?.sequenceNo || ""}`.trim(),
          isEditingOfficialResult
            ? `Kết quả chính thức của ${activeScope.lotCodes.join(", ")} đã được cập nhật. Các đợt khác được giữ nguyên.`
            : isPackageCompleted
              ? `Đã có kết quả chính thức cho ${activeScope.lotCodes.join(", ")}. Toàn bộ phần lô của gói thầu đã hoàn tất.`
              : `Đã có kết quả chính thức cho ${activeScope.lotCodes.join(", ")}. Còn ${lifecycle?.counts?.pendingLots ?? "các"} phần lô chưa đánh giá.`,
          "check-circle",
        );
        return { ok: true, kind: "scoped_awarded" };
      }

      const hasActualWinner = pkg.phanLo === "Có"
        ? parseLots(pkg.phanLoList).some((lot) => lot.nhaThauTrungThauId)
        : winnerId !== "none" && Boolean(pkg.nhaThauTrungThauId);
      if (!hasActualWinner) {
        clearResultEditState(metadata);
        metadata.cancelDetails = metadata.cancelDetails || {};
        metadata.cancelDetails.soQuyetDinhHuyThau = decision.number;
        metadata.cancelDetails.ngayQuyetDinhHuyThau = decision.date;
        metadata.cancelDetails.lyDoHuyThau = CANCEL_REASON;
        pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
        clearCompetitiveQuotationAppraisal(pkg);
        pkg.soQuyetDinhKetQua = decision.number;
        pkg.ngayQuyetDinhKetQua = decision.date;
        const syncResult = await ports.commitDecision(controller, {
          packageRecord: pkg,
          afterPersist: () => view.renderGoiThauTable(),
        });
        if (!syncResult?.ok) return { ok: false, kind: "sync_failed" };
        await showResult(view, pkg, "cancel");
        await view.customAlert(
          "Không có nhà thầu trúng thầu",
          "Không có nhà thầu nào đạt yêu cầu. Hệ thống đã tự động điền các thông tin hủy thầu tương ứng và chuyển bạn sang tab Hủy thầu để xem lại hoặc điều chỉnh trước khi xác nhận hủy thầu chính thức.",
          "info",
        );
        return { ok: true, kind: "cancelled" };
      }

      target.saved = true;
      clearResultEditState(metadata);
      pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
      clearCompetitiveQuotationAppraisal(pkg);
      pkg.soQuyetDinhKetQua = decision.number;
      pkg.ngayQuyetDinhKetQua = decision.date;
      pkg.trangThai = "Đã có kết quả";
      const syncResult = await ports.commitDecision(controller, {
        packageRecord: pkg,
        afterPersist: () => view.renderGoiThauTable(),
      });
      if (!syncResult?.ok) return { ok: false, kind: "sync_failed" };
      view._editingWholePackageResult = false;
      view._editingWholePackageResultPackageId = "";
      await showResult(view, pkg, "result");
      await view.customAlert(
        "Chúc mừng",
        `Đã phê duyệt kết quả trúng thầu cho gói thầu "${pkg.tenGoiThau}" thành công!`,
        "check-circle",
      );
      return { ok: true, kind: "awarded" };
    },
  });
}

export const awardResultApprovalWorkflow = createAwardResultApprovalWorkflow();
