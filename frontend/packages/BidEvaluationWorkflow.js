import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { setVisible } from "../app/formStateUtils.js";
import { renderEvaluationSummary } from "./bidEvaluationRender.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { createBidEvaluationRankingController } from "./BidEvaluationRankingController.js";
import { renderBidEvaluationRoundHistory } from "./BidEvaluationRoundHistory.js";
import { renderBidEvaluationLotScope } from "./BidEvaluationLotScopeController.js";
import {
  renderBidEvaluationRows,
  renderBidEvaluationRowsBatched,
} from "./BidEvaluationRowRenderer.js";
import { buildBidEvaluationPanelState, evaluationScopeKey } from "./BidEvaluationPanelState.js";
import { bindBidEvaluationPanelController } from "./BidEvaluationPanelController.js";
import { buildBidEvaluationTablePresentation } from "./BidEvaluationTablePresentation.js";
import {
  filterBidsByEvaluationLotScope,
  resolvePackageResultStatus
} from "./lotEvaluationScope.js";
import { syncDetailedEvaluationNavigation } from "./detailedEvaluationNavigation.js";
import { checkBidQualified } from "./detail/PackageTabs.js";

function getEvaluationScopeStore(controller) {
  if (!controller._evaluationLotScopes) controller._evaluationLotScopes = {};
  return controller._evaluationLotScopes;
}

export function renderDanhGiaHsdtPanel() {
  this.currentEvaluationView = this.currentEvaluationView || "summary";
  this.selectedDetailedEvaluationTab = this.selectedDetailedEvaluationTab || "validity";
  const select = this.view.getActiveElement("danhgiahsdt-goithau-select");
  if (!select) return;
  const selectedVal = select.value;
  const targetPackages = this.model.state.goithau.filter((g) => {
    if (g.id === selectedVal) return true;
    return ["Đang chấm thầu", "Đã có kết quả một phần", "Đã có kết quả"].includes(resolvePackageResultStatus(g));
  });
  select.innerHTML = trustedHTML('<option value="">-- Chọn Gói thầu (Đang chấm thầu / Đã có kết quả một phần / Đã có kết quả) --</option>' + targetPackages.map((g) => `<option value="${escapeHtml(g.id)}" data-search="${escapeHtml(`${g.maGoiThau || ""} ${g.tenGoiThau || ""}`)}">${escapeHtml(g.tenGoiThau)} (${escapeHtml(g.maGoiThau || "Chưa có mã")})</option>`).join(""));
  if (selectedVal && targetPackages.some((g) => g.id === selectedVal)) {
    select.value = selectedVal;
  } else {
    select.value = "";
  }
  this.makeSearchableSelect(select, "Tìm kiếm Gói thầu...");
  const summaryContainer = this.view.getActiveElement("danhgiahsdt-goithau-summary");
  const evaluationContainer = this.view.getActiveElement("danhgiahsdt-container");
  const emptyState = this.view.getActiveElement("danhgiahsdt-empty-state");
  const thead = this.view.getActiveElement("danhgiahsdt-table-thead");
  const tbody = this.view.getActiveElement("danhgiahsdt-table-tbody");
  const handlePackageSelection = () => {
    const gtId = select.value;
    if (!gtId) {
      setRuntimeStyle(summaryContainer, "display", "none");
      setRuntimeStyle(evaluationContainer, "display", "none");
      setRuntimeStyle(emptyState, "display", "block");
      return;
    }
    const gt = this.model.state.goithau.find((g) => g.id === gtId);
    if (!gt) return;
    const kh = this.model.getLatestPlan(gt.keHoachId);
    const cdt = kh ? this.model.state.chudautu.find((c) => c.id === kh.chuDauTuId) : null;
    const tenCdt = cdt ? cdt.tenChuDauTu : "Không rõ";
    const tenKhStr = kh ? kh.tenKeHoach : "Không rõ";
    const scopeStore = getEvaluationScopeStore(this);
    const panelState = buildBidEvaluationPanelState({
      pkg: gt,
      requestedTab: this.currentDanhGiaTab,
      editingState: this.view._editingState,
      cachedScopes: scopeStore,
    });
    this.currentDanhGiaTab = panelState.currentTab;
    const {
      baseMeta: baseEvaluationMeta,
      isLocked,
      isReadOnly,
      isTwoEnvelope: is1G2T,
      lotScope,
      metadata,
      scopeKey,
    } = panelState;
    if (lotScope) scopeStore[scopeKey] = lotScope;
    renderEvaluationSummary({
      container: summaryContainer,
      gt,
      tenCdt,
      tenKhStr,
      model: this.model,
      is1G2T,
      isReadOnly,
      currentTab: this.currentDanhGiaTab
    });
    setRuntimeStyle(emptyState, "display", "none");
    setRuntimeStyle(evaluationContainer, "display", "block");
    if (metadata && metadata.quyTrinhDanhGia) gt.quyTrinhDanhGia = metadata.quyTrinhDanhGia;
    this._continueOfficialLotEvaluation = this._continueOfficialLotEvaluation || {};
    renderBidEvaluationRoundHistory({
      view: this.view,
      model: this.model,
      pkg: gt,
      metadataBlock: baseEvaluationMeta,
      twoEnvelopeMetadata: is1G2T ? metadata : null,
      continueRequested: this._continueOfficialLotEvaluation[gt.id] === true,
      onContinue: () => {
        this._continueOfficialLotEvaluation[gt.id] = true;
        delete scopeStore[scopeKey];
        handlePackageSelection();
      }
    });
    renderBidEvaluationLotScope({
      view: this.view,
      pkg: gt,
      scope: lotScope,
      isLocked,
      onChange: (nextScope) => {
        scopeStore[evaluationScopeKey(gtId, this.currentDanhGiaTab)] = nextScope;
        syncDetailedEvaluationNavigation(this, gtId);
        handlePackageSelection();
      }
    });
    bindBidEvaluationPanelController({
      appController: this,
      pkg: gt,
      panelState,
      onRerender: handlePackageSelection,
    });
    const tablePresentation = buildBidEvaluationTablePresentation({
      pkg: gt,
      isTwoEnvelope: is1G2T,
      currentTab: this.currentDanhGiaTab,
      lotScope,
    });
    const tableTitle = this.view.getActiveElement("danhgiahsdt-table-title");
    if (tableTitle) tableTitle.textContent = tablePresentation.title;
    thead.innerHTML = trustedHTML(tablePresentation.headerHtml);
    const rankingController = createBidEvaluationRankingController({
      root: tbody,
      pkg: gt,
      bids: this.model.state.thongtinmothau,
      isTwoEnvelope: is1G2T,
      isReadOnly,
    });
    const updateAllRankings = (dirtyRow) => rankingController.schedule(dirtyRow);
    let bids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
    if (lotScope) {
      bids = filterBidsByEvaluationLotScope(bids, gt, lotScope);
    }
    if (is1G2T && this.currentDanhGiaTab === "financial") {
      bids = bids.filter((bid) => checkBidQualified(bid, gt));
    }
    if (!is1G2T && gt.quyTrinhDanhGia === "quytrinh2") {
      bids.sort((a, b) => {
        const priceA = BigInt(this.model.parseVND(a.giaSauGiamGia || a.giaDuThau) || 0);
        const priceB = BigInt(this.model.parseVND(b.giaSauGiamGia || b.giaDuThau) || 0);
        return priceA < priceB ? -1 : priceA > priceB ? 1 : 0;
      });
    } else {
      bids.sort((a, b) => {
        const codeA = String(a.maPhanLo || "").toLowerCase();
        const codeB = String(b.maPhanLo || "").toLowerCase();
        return codeA.localeCompare(codeB, "vi", { numeric: true });
      });
    }
    const detailedReportButton = this.view.getActiveElement("btn-danhgiahsdt-detail");
    if (detailedReportButton) {
      setVisible(detailedReportButton, bids.length > 0, "inline-flex");
      detailedReportButton.onclick = () => this.openDetailedEvaluation?.();
    }
    const rowRenderContext = {
      root: tbody,
      pkg: gt,
      bids,
      model: this.model,
      presentation: tablePresentation,
      isReadOnly,
      onRankingChange: updateAllRankings,
    };
    const finalizeRowRender = () => {
      lucide.createIcons();
      if (typeof this.unifyTableInputsHeight === "function") {
        this.unifyTableInputsHeight(document);
      }
    };
    if (bids.length > 50) {
      renderBidEvaluationRowsBatched(rowRenderContext, { chunkSize: 50 }).then((rows) => {
        if (rows.length === bids.length) finalizeRowRender();
      }).catch((error) => {
        console.error("Failed to render bid evaluation rows", error);
      });
    } else {
      renderBidEvaluationRows(rowRenderContext);
      finalizeRowRender();
    }
    if (this.currentEvaluationView === "contractor-detail" && bids.length > 0) {
      this.renderDetailedEvaluation?.();
    }
  };
  select.onchange = handlePackageSelection;
  handlePackageSelection();
  this.setupExcelImportEvents();
}
export { saveDanhGiaHsdt, updateRowConclusion } from "./bidEvaluationActions.js";
