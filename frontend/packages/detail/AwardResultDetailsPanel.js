import { trustedHTML } from "../../shared/trustedTypes.js";
import { authFetchDownload } from "../../shared/view_helpers.js";
import { bindAwardResultPanel, renderAwardedResultPanel } from "./AwardResultPanel.js";
import { buildAwardResultViewModel } from "./AwardResultViewModel.js";
import {
  commitPackageResultEditState,
} from "../packageEvaluationProgress.js";
import { executeAppCommand } from "../../app/commandBus.js";
import { appendExportSnapshotVersion } from "../../shared/exportSnapshot.js";
import { buildAwardResultApprovalMarkup } from "./AwardResultApprovalMarkup.js";
import { buildOfficialResultHistoryMarkup } from "./AwardResultHistoryMarkup.js";
import { buildAwardResultSummaryPresentation } from "./AwardResultSummaryPresentation.js";
export { shouldFinalizeOfficialResultLifecycle } from "./AwardResultApprovalWorkflow.js";
import { bindAwardResultPanelController } from "./AwardResultPanelController.js";
export {
  initializeAwardResultBidderRow,
  buildAwardJointVentureViewData,
} from "./AwardResultPanelController.js";
export { buildOfficialResultHistoryMarkup } from "./AwardResultHistoryMarkup.js";
import {
  resolvePackageResultStatus,
  setPackageResultEditState
} from "../lotEvaluationScope.js";


export function beginOfficialResultBatchEdit(view, pkg, batchId, rerender) {
  const normalizedBatchId = String(batchId || "").trim();
  if (!view || !pkg || !normalizedBatchId) return false;
  if (!setPackageResultEditState(pkg, { type: "batch", batchId: normalizedBatchId })) return false;
  view._editingOfficialResultLotBatchId = normalizedBatchId;
  view._currentResultLotBatchId = normalizedBatchId;
  rerender?.();
  return true;
}

export function beginWholePackageResultEdit(view, pkg, rerender) {
  if (!view || !pkg) return false;
  if (!setPackageResultEditState(pkg, { type: "whole" })) return false;
  view._editingWholePackageResult = true;
  view._editingWholePackageResultPackageId = String(pkg.id || "");
  rerender?.();
  return true;
}

export function renderAwardResultDetailsPanel(view, { contentWrapper, gt, id, isEditable, appController }) {
      const awardResultViewModel = buildAwardResultViewModel({
        pkg: gt,
        bids: view.model.state.thongtinmothau,
        isEditable,
        editState: {
          officialBatchId: view._editingOfficialResultLotBatchId,
          currentBatchId: view._currentResultLotBatchId,
          wholePackage: view._editingWholePackageResult === true,
          wholePackageId: view._editingWholePackageResultPackageId,
        },
      });
      const {
        metadata,
        isTwoEnvelope: is1G2T2,
        officialLotState,
        effectiveEditState,
        isEditingOfficialResult,
        isEditingWholePackageResult,
        activeScopedEvaluation,
        resultMetadata,
        soBctdResult,
        ngayBctdResult,
        scopedBidsForResult,
        allBidsForResult,
        summary,
      } = awardResultViewModel;
      view._editingOfficialResultLotBatchId = effectiveEditState.officialBatchId;
      view._currentResultLotBatchId = effectiveEditState.currentBatchId;
      view._editingWholePackageResult = effectiveEditState.wholePackage;
      view._editingWholePackageResultPackageId = effectiveEditState.wholePackageId;
      const resultHistoryMarkup = buildOfficialResultHistoryMarkup(
        view,
        gt,
        officialLotState,
        metadata,
        { isEditable },
      );
      const rerenderResultPanel = () => {
        const statusBadge = document.getElementById("detail-workflow-status-badge");
        if (statusBadge && typeof view.getStatusBadge === "function") {
          const editingStatus = resolvePackageResultStatus(gt, {
            editingBatchId: view._editingOfficialResultLotBatchId,
            editingWholePackage: view._editingWholePackageResult === true
              && (!view._editingWholePackageResultPackageId
                || String(view._editingWholePackageResultPackageId) === String(gt.id)),
          });
          statusBadge.innerHTML = trustedHTML(view.getStatusBadge(editingStatus));
          if (window.lucide) window.lucide.createIcons({ root: statusBadge });
        }
        renderAwardResultDetailsPanel(view, {
          contentWrapper,
          gt,
          id,
          isEditable,
          appController,
        });
      };
      const persistResultEditState = async () => {
        try {
          const syncResult = await commitPackageResultEditState(appController || view, {
            packageRecord: gt,
            afterPersist: () => view.renderGoiThauTable?.(),
          });
          if (syncResult?.ok === false) return false;
          return true;
        } catch (error) {
          await view.customAlert?.(
            "Không thể cập nhật trạng thái",
            error?.message || "Không thể đồng bộ trạng thái chỉnh sửa kết quả với máy chủ.",
            "alert-triangle",
          );
          return false;
        }
      };
      const bindOfficialResultEditActions = () => {
        contentWrapper.querySelectorAll("[data-edit-official-result-batch]").forEach((button) => {
          button.addEventListener("click", async () => {
            const didBeginEdit = beginOfficialResultBatchEdit(
              view,
              gt,
              button.getAttribute("data-edit-official-result-batch"),
              rerenderResultPanel,
            );
            if (didBeginEdit) await persistResultEditState();
          });
        });
      };
      if (awardResultViewModel.mode === "history") {
        contentWrapper.innerHTML = trustedHTML(resultHistoryMarkup);
        bindOfficialResultEditActions();
        if (window.lucide) window.lucide.createIcons({ root: contentWrapper });
        return;
      }
      if (awardResultViewModel.mode === "summary") {
        const {
          winnerHtml,
          bidderRowsHtml,
          tableHeaderHtml,
        } = buildAwardResultSummaryPresentation({
          model: view.model,
          pkg: gt,
          summary,
          allBids: allBidsForResult,
        });
        renderAwardedResultPanel(contentWrapper, {
          pkg: gt,
          winnerHtml,
          bidderRowsHtml,
          tableHeaderHtml,
          resultHistoryHtml: resultHistoryMarkup,
          appraisalNumber: soBctdResult,
          appraisalDate: ngayBctdResult,
          isEditable,
          wordExportEnabled: Boolean(view.model.state.activeuser?.wordExportEnabled),
          formatCurrency: (value) => view.model.formatCurrency(value),
          formatDate: (value) => view.model.formatDate(value)
        });
        bindOfficialResultEditActions();
        bindAwardResultPanel(contentWrapper, {
          onEdit: async () => {
            const didBeginEdit = beginWholePackageResultEdit(view, gt, rerenderResultPanel);
            if (didBeginEdit) await persistResultEditState();
          },
          onExport: async () => {
            const snapshotVersion = appController?.prepareExportSnapshot
              ? await appController.prepareExportSnapshot()
              : await executeAppCommand("prepareExportSnapshot");
            return authFetchDownload(
              appendExportSnapshotVersion(`/api/export-report/${id}?type=result`, snapshotVersion),
              `Bao_cao_ket_qua_danh_gia_ho_so_du_thau_${gt.maGoiThau}.docx`
            );
          },
          onExportError: (error) => view.customAlert("Lỗi", "Lỗi xuất báo cáo: " + error.message, "x-circle"),
          refreshIcons: () => lucide.createIcons()
        });
      } else {
        const scopedResultPackage = activeScopedEvaluation
          ? {
            ...gt,
            soQuyetDinhKetQua: resultMetadata.soQuyetDinhKetQua || "",
            ngayQuyetDinhKetQua: resultMetadata.ngayQuyetDinhKetQua || ""
          }
          : gt;
        const approvalPanel = buildAwardResultApprovalMarkup(view, {
          gt: scopedResultPackage,
          metadata: activeScopedEvaluation ? { ...metadata, result: resultMetadata } : metadata,
          soBctdResult,
          ngayBctdResult,
          is1G2T2,
          bids: scopedBidsForResult,
          scopedDraft: activeScopedEvaluation ? {
            label: `đợt ${activeScopedEvaluation.lotCodes.join(", ")}`,
            lotCodes: activeScopedEvaluation.lotCodes,
            sequenceNo: activeScopedEvaluation.batch?.sequenceNo || "",
            isEditingOfficialResult
          } : isEditingWholePackageResult ? {
            isEditingOfficialResult: true,
            isWholePackage: true,
            lotCodes: []
          } : null
        });
        contentWrapper.innerHTML = trustedHTML(approvalPanel.html);
        if (resultHistoryMarkup && !isEditingOfficialResult) {
          contentWrapper.innerHTML = trustedHTML(resultHistoryMarkup + contentWrapper.innerHTML);
        }
        if (window.lucide) window.lucide.createIcons({ root: contentWrapper });
        bindOfficialResultEditActions();
        bindAwardResultPanelController({
          view,
          root: contentWrapper,
          pkg: gt,
          appController,
          viewModel: awardResultViewModel,
          approvalPanel,
          rerender: rerenderResultPanel,
          persistEditState: persistResultEditState,
        });
      }
}
