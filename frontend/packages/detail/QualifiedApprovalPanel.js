import { formatPartnerIdentityCode } from "../../app/domUtils.js";
import { setFieldFeedback } from "../../app/formStateUtils.js";
import { trustedHTML } from "../../shared/trustedTypes.js";
import { beginWorkspaceRender } from "../../shared/workspaceRenderCache.js";
import { escapeHtml } from "../../shared/view_helpers.js";
import { isCompetitiveQuotationPackage } from "../packageAppraisal.js";
import { saveQualifiedApproval } from "../packageEvaluationProgress.js";
import {
  isBidWithinEvaluationLotDetails,
  resolveActiveSavedEvaluationScope,
} from "../lotEvaluationScope.js";
import { renderBidContractorLink } from "./BidderTable.js";
import { checkBidQualified } from "./PackageTabs.js";
import {
  resolveWorkflowActionMode,
  WORKFLOW_ACTION_MODE,
} from "../workflowActionState.js";
import {
  evaluationMethodDisplay,
  evaluationMethodUsesTechnicalScore,
} from "../evaluationMethodRules.js";
import { parseEvaluationMetadataForDisplay } from "../evaluationMetadata.js";

const qualifiedApprovalCacheOwner = (pkg) => `qualified-approval:${pkg?.id || "unknown"}`;

function parseMetadata(pkg) {
  const parsed = parseEvaluationMetadataForDisplay(
    pkg?.danhGiaHsdtMetadata,
  ).metadata;
  if (parsed?.is1G2T) return parsed;
  return {
    is1G2T: true,
    technical: parsed?.soBaoCao ? parsed : { saved: false },
    financial: { saved: false },
  };
}

function hasTechnicalScore(pkg, bids) {
  return bids.some((bid) => {
    const normalized = String(bid?.danhGiaKyThuat || "").trim().replace(/,/g, ".");
    return normalized !== "" && Number.isFinite(Number.parseFloat(normalized));
  }) || evaluationMethodUsesTechnicalScore(pkg);
}

export function buildQualifiedApprovalState({
  view,
  pkg,
  isTechEvalSaved = false,
  effectiveStatus = pkg?.trangThai || "",
} = {}) {
  const metadata = parseMetadata(pkg);
  metadata.technical = metadata.technical || { saved: true };
  const activeScope = resolveActiveSavedEvaluationScope(pkg, metadata.technical);
  const bids = (view?.model?.state?.thongtinmothau || [])
    .filter((bid) => String(bid?.goiThauId || "") === String(pkg?.id || ""))
    .filter((bid) => !activeScope || isBidWithinEvaluationLotDetails(bid, activeScope));
  const qualifiedBids = bids.filter((bid) => checkBidQualified(bid, pkg));
  const target = activeScope?.batch || metadata.technical;
  const isCompleted = target.qualifiedSaved === true;
  const isEditing = Boolean(view?._editingState?.qualified);
  const isFinal = effectiveStatus === "Đã có kết quả" || effectiveStatus === "Hủy thầu";
  const isNextStepSaved = Boolean(
    pkg?.thoiGianMoEhsdxtc
    || activeScope?.batch?.financialOpening?.saved
    || qualifiedBids.some((bid) => Number(bid?.giaDuThau) > 0),
  );
  const actionMode = resolveWorkflowActionMode({
    isCompleted,
    isEditing,
    isNextStepSaved,
    isFinal,
  });
  const isReadOnly = actionMode !== WORKFLOW_ACTION_MODE.SAVE;

  return {
    pkg,
    metadata,
    activeScope,
    target,
    qualifiedBids,
    hasTechnicalScore: hasTechnicalScore(pkg, qualifiedBids),
    isTechEvalSaved,
    actionMode,
    isNextStepSaved,
    isReadOnly,
    canEdit: actionMode === WORKFLOW_ACTION_MODE.EDIT,
  };
}

function renderPackageFacts(view, state) {
  const { pkg } = state;
  const plan = view.model.getLatestPlan(pkg.keHoachId);
  const investor = plan
    ? view.model.state.chudautu.find((item) => item.id === plan.chuDauTuId)
    : null;
  const directOrSpecial = pkg.hinhThucLuaChon === "Chỉ định thầu rút gọn"
    || pkg.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const twoEnvelope = pkg.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  return `
    <div class="bf-s-8bd3eb473c">
      <div class="bf-s-5d398becec">Thông số Gói thầu</div>
      <div class="bf-s-13b5590e90">
        <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${escapeHtml(investor?.tenChuDauTu || "Không rõ")}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${escapeHtml(plan?.tenKeHoach || "Không rõ")}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${escapeHtml(pkg.linhVuc || "Hàng hóa")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${escapeHtml(pkg.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${pkg.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${escapeHtml(view.model.formatCurrency(pkg.giaGoiThau))}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${escapeHtml(pkg.hinhThucLuaChon || "--")}</div>
        ${pkg.phuongPhapDanhGia ? `<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${escapeHtml(evaluationMethodDisplay(pkg))}</div>` : ""}
        <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${escapeHtml(pkg.loaiHopDong || "--")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${escapeHtml(pkg.thoiGianThucHien || "--")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${escapeHtml(pkg.nguonVon || "--")}</div>
        ${directOrSpecial ? "" : `
          <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${pkg.thoiGianDongThau ? escapeHtml(view.model.formatDateWithTime(pkg.thoiGianDongThau)) : "--"}</div>
          <div>• <strong class="bf-s-fcb5ddef65">${twoEnvelope ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong> ${pkg.thoiGianMoThau ? escapeHtml(view.model.formatDateWithTime(pkg.thoiGianMoThau)) : "--"}</div>
          ${twoEnvelope ? `<div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong> ${pkg.thoiGianMoEhsdxtc ? escapeHtml(view.model.formatDateWithTime(pkg.thoiGianMoEhsdxtc)) : "Chưa mở"}</div>` : ""}
        `}
      </div>
    </div>`;
}

function renderDecisionForm(view, state) {
  const { pkg, target, isReadOnly } = state;
  const appraisalFields = isCompetitiveQuotationPackage(pkg) ? "" : `
    <div class="form-group bf-s-4bbf3df076">
      <label class="bf-s-997cdefbc9">Số BCTĐ kỹ thuật <span class="text-danger">*</span></label>
      <input type="text" id="qualified-so-bctd" class="form-control bf-s-20e5983dc7" value="${escapeHtml(target.soBctdKt || "")}" placeholder="Nhập số báo cáo thẩm định..." ${isReadOnly ? "readonly" : ""}>
      <span class="error-text bf-s-35a8ff27ff">Vui lòng nhập Số BCTĐ kỹ thuật!</span>
    </div>
    <div class="form-group bf-s-4bbf3df076">
      <label class="bf-s-997cdefbc9">Ngày BCTĐ kỹ thuật <span class="text-danger">*</span></label>
      <input type="text" id="qualified-ngay-bctd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${escapeHtml(target.ngayBctdKt ? view.model.formatForDateInput(target.ngayBctdKt) : "")}" ${isReadOnly ? "readonly" : ""} placeholder="dd/MM/yyyy">
      <span class="error-text bf-s-35a8ff27ff">Vui lòng chọn Ngày BCTĐ kỹ thuật!</span>
    </div>`;
  return `
    <div class="bf-s-098565a16e">
      <div class="bf-s-5d398becec">QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
      <div class="bf-s-ed07f78f34">
        ${appraisalFields}
        <div class="form-group bf-s-4bbf3df076">
          <label class="bf-s-997cdefbc9">Số QĐ phê duyệt nhà thầu đạt kỹ thuật <span class="text-danger">*</span></label>
          <input type="text" id="qualified-so-qd" class="form-control bf-s-20e5983dc7" value="${escapeHtml(target.soQdPheDuyetKt || "")}" placeholder="Ví dụ: 120/QĐ-CDT" ${isReadOnly ? "readonly" : ""}>
          <span class="error-text bf-s-35a8ff27ff">Vui lòng nhập Số QĐ phê duyệt!</span>
        </div>
        <div class="form-group bf-s-4bbf3df076">
          <label class="bf-s-997cdefbc9">Ngày QĐ phê duyệt <span class="text-danger">*</span></label>
          <input type="text" id="qualified-ngay-qd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${escapeHtml(target.ngayQdPheDuyetKt ? view.model.formatForDateInput(target.ngayQdPheDuyetKt) : "")}" ${isReadOnly ? "readonly" : ""} placeholder="dd/MM/yyyy">
          <span class="error-text bf-s-35a8ff27ff">Vui lòng chọn Ngày QĐ phê duyệt!</span>
        </div>
      </div>
    </div>`;
}

function renderQualifiedTable(view, state) {
  const { pkg, qualifiedBids, hasTechnicalScore } = state;
  if (!qualifiedBids.length) {
    return `<div class="table-container bf-s-674afada30"><div class="bf-s-5835c40555"><i data-lucide="info" class="bf-s-ea6824d1aa"></i> Không có nhà thầu nào đạt yêu cầu kỹ thuật. Vui lòng nhập số quyết định phê duyệt và ngày quyết định phía trên để lưu danh sách đạt kỹ thuật trống và chuyển sang bước Hủy thầu.</div></div>`;
  }
  return `
    <div class="table-container bf-s-674afada30">
      <table class="data-table bf-s-448ca2b6ae">
        <thead><tr>
          ${pkg.phanLo === "Có" ? '<th class="bf-s-ad8c93e5fe">Mã phần lô</th><th class="bf-s-a01153c965">Tên phần lô</th>' : ""}
          <th class="bf-s-ad8c93e5fe">Mã nhà thầu</th>
          <th style="width: ${pkg.phanLo === "Có" ? "25%" : "40%"};">Tên nhà thầu</th>
          ${hasTechnicalScore ? '<th class="bf-s-1a457d1503">Điểm kỹ thuật</th>' : ""}
          <th class="bf-s-1a457d1503">Kết quả</th>
        </tr></thead>
        <tbody>${qualifiedBids.map((bid) => `
          <tr>
            ${pkg.phanLo === "Có" ? `<td>${escapeHtml(bid.maPhanLo || "--")}</td><td>${escapeHtml(bid.tenPhanLo || "--")}</td>` : ""}
            <td>${escapeHtml(formatPartnerIdentityCode(bid.maNhaThau || bid.maDinhDanh, "--"))}</td>
            <td>${renderBidContractorLink(
              view.model,
              bid,
              `${pkg.id}_qualified_${bid.id}`,
              { owner: qualifiedApprovalCacheOwner(pkg) },
            )}</td>
            ${hasTechnicalScore ? `<td class="bf-s-63dbf5319a">${escapeHtml(bid.danhGiaKyThuat || "--")}</td>` : ""}
            <td class="bf-s-63dbf5319a"><span class="badge badge-success bf-s-391321b535">Đạt kỹ thuật</span></td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function validateRequiredInput(input, invalidInputs) {
  if (input?.value?.trim()) {
    setFieldFeedback(input);
    return true;
  }
  if (input) {
    invalidInputs.push(input);
    setFieldFeedback(input, {
      state: "invalid",
      message: input.closest(".form-group")?.querySelector(".error-text")?.textContent || "",
    });
  }
  return false;
}

function bindPanel(view, contentWrapper, state, appController) {
  const editButton = contentWrapper.querySelector("#btn-edit-qualified-decision");
  if (editButton) {
    editButton.onclick = () => {
      view._editingState = view._editingState || {};
      view._editingState.qualified = true;
      view.showPackageDetails(state.pkg.id);
    };
  }
  if (state.isReadOnly) return;

  const saveButton = contentWrapper.querySelector("#btn-save-qualified-decision");
  if (!saveButton) return;
  saveButton.onclick = async () => {
    const decisionNumber = contentWrapper.querySelector("#qualified-so-qd");
    const decisionDate = contentWrapper.querySelector("#qualified-ngay-qd");
    const appraisalNumber = contentWrapper.querySelector("#qualified-so-bctd");
    const appraisalDate = contentWrapper.querySelector("#qualified-ngay-bctd");
    const invalidInputs = [];
    [decisionNumber, decisionDate, appraisalNumber, appraisalDate]
      .filter(Boolean)
      .forEach((input) => validateRequiredInput(input, invalidInputs));
    if (invalidInputs.length) {
      view.focusInvalidControl(invalidInputs[0]);
      return;
    }

    state.target.soQdPheDuyetKt = decisionNumber.value.trim();
    state.target.ngayQdPheDuyetKt = view.model.convertDMYToYMD(decisionDate.value.trim());
    if (appraisalNumber) state.target.soBctdKt = appraisalNumber.value.trim();
    if (appraisalDate) state.target.ngayBctdKt = view.model.convertDMYToYMD(appraisalDate.value.trim());
    if (isCompetitiveQuotationPackage(state.pkg)) {
      delete state.target.soBctdKt;
      delete state.target.ngayBctdKt;
    }
    state.target.qualifiedSaved = true;
    await saveQualifiedApproval(appController || view, state.pkg, state.metadata);
    if (view._editingState) view._editingState.qualified = false;
    await view.customAlert("Thành công", "Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!", "check-circle");
    view._currentWorkflowTab = state.qualifiedBids.length ? "opening_fin" : "result";
    await view.showPackageDetails(state.pkg.id);
  };
}

export function renderQualifiedApprovalPanel(view, {
  contentWrapper,
  pkg,
  isTechEvalSaved,
  effectiveStatus,
  appController,
} = {}) {
  beginWorkspaceRender(view?.model, qualifiedApprovalCacheOwner(pkg));
  const state = buildQualifiedApprovalState({ view, pkg, isTechEvalSaved, effectiveStatus });
  if (!state.isTechEvalSaved) {
    contentWrapper.innerHTML = trustedHTML(`
      <div class="bf-s-71ff99332d">
        <i data-lucide="shield-alert" class="bf-s-106d10c68d"></i>
        <h4 class="bf-s-01dd0d67e8">Chưa có Nhà thầu đạt kỹ thuật</h4>
        <p class="bf-s-85ddf1c3bf">Vui lòng hoàn thành và Lưu Báo cáo đánh giá E-HSĐXKT trước.</p>
      </div>`);
    return state;
  }

  const action = state.actionMode === WORKFLOW_ACTION_MODE.SAVE
    ? '<button class="btn btn-primary bf-s-b69e3fa20a" id="btn-save-qualified-decision"><i data-lucide="save"></i> Lưu QĐ phê duyệt</button>'
    : state.actionMode === WORKFLOW_ACTION_MODE.EDIT
      ? '<button class="btn btn-primary bf-s-b69e3fa20a" id="btn-edit-qualified-decision"><i data-lucide="edit-3"></i> Chỉnh sửa</button>'
      : "";
  contentWrapper.innerHTML = trustedHTML(`
    ${renderPackageFacts(view, state)}
    ${renderDecisionForm(view, state)}
    ${renderQualifiedTable(view, state)}
    <div class="bf-s-54e8112b47">${action}</div>`);
  view.initFlatpickr?.(contentWrapper);
  bindPanel(view, contentWrapper, state, appController);
  return state;
}
