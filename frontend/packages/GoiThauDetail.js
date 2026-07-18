import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { authFetchDownload, escapeHtml, initCustomSelect } from "../shared/view_helpers.js";
import { getAppController } from "../app/controllerRef.js";
import { setFieldFeedback } from "../app/formStateUtils.js";
import { validateExtensionRows } from "./packageValidation.js";
import { isCompetitiveQuotationPackage } from "./packageAppraisal.js";
import { buildPackageTabs, checkBidQualified } from "./detail/PackageTabs.js";
import { renderCancellationPanel } from "./detail/CancellationPanel.js";
import { renderPreparationActionPanel } from "./detail/PreparationPanel.js";
import { apiFetch } from "../shared/apiClient.js";
import { renderPreparationDetailsPanel } from "./detail/PreparationDetailsPanel.js";
import { renderAwardResultDetailsPanel } from "./detail/AwardResultDetailsPanel.js";
import { formatPartnerIdentityCode } from "../app/domUtils.js";
import { executeAppCommand } from "../app/commandBus.js";
import { hasHolidays, setHolidays } from "../shared/runtimeState.js";
import { renderOpeningPanel } from "./detail/OpeningPanel.js";
import { renderInvitationPanel } from "./detail/InvitationPanel.js";
import { renderTechnicalEvaluationPanel } from "./detail/TechnicalEvaluationPanel.js";
import { renderFinancialEvaluationPanel } from "./detail/FinancialEvaluationPanel.js";
import { bindFinancialOpeningRows, collectFinancialOpeningRows, markFinancialOpeningInvalid, renderFinancialOpeningTable, validateFinancialOpeningRows } from "./detail/FinancialOpeningPanel.js";
import { savePackageCancellation } from "./packageCancellation.js";
import { savePackageInvitationInfo } from "./packageInvitation.js";
import { savePackageFinancialOpening, validateFinancialOpeningTime } from "./packageFinancialOpening.js";
import { saveQualifiedApproval } from "./packageEvaluationProgress.js";
import { resolvePackageDetailState, selectPackageDetailTab } from "./detail/PackageDetailState.js";
import { renderPackageTabHeaders } from "./detail/PackageDetailCoordinator.js";
import { renderPackageSummary } from "./detail/PackageSummary.js";
import { renderBidContractorLink } from "./detail/BidderTable.js";
import { renderWorkflowActions } from "./detail/WorkflowActions.js";
import { registerCommandArgs } from "../shared/commandArgs.js";
export { checkBidQualified };
export async function showPackageDetails(id, isSwitchingVersion = false) {
  const appController = getAppController();
  if (
    appController?.ensureWorkflowModules
    && (
      typeof appController.renderMoThauPanel !== "function"
      || typeof appController.renderDanhGiaHsdtPanel !== "function"
    )
  ) {
    try {
      await appController.ensureWorkflowModules("goithau-detail");
    } catch (error) {
      console.error("Failed to load package workflow modules:", error);
      appController.view?.showToast?.(
        "Không tải được nghiệp vụ gói thầu",
        "Vui lòng tải lại trang và thử lại.",
        "error"
      );
      return;
    }
  }
  if (!hasHolidays()) {
    apiFetch("/api/holidays").then((r) => r.json()).then((data) => {
      setHolidays(data);
      this.showPackageDetails(id, isSwitchingVersion);
    }).catch((e) => {
      console.error("Failed to load holidays:", e);
      setHolidays({});
      this.showPackageDetails(id, isSwitchingVersion);
    });
    return;
  }
  let targetId = id;
  if (!isSwitchingVersion) {
    const latestPkg2 = this.model.getLatestPackage(id);
    if (latestPkg2) {
      targetId = latestPkg2.id;
    }
  }
  id = targetId;
  const formEl = document.getElementById("form-goithau");
  const modalMCard = document.querySelector("#modal-goithau .modal-card");
  if (formEl && modalMCard && !modalMCard.contains(formEl)) {
    modalMCard.appendChild(formEl);
  }
  const tabHeaders = document.getElementById("detail-workflow-tabs-header");
  if (tabHeaders) setRuntimeStyle(tabHeaders, "display", "flex");
  const detailPane = document.getElementById("tab-goithau-detail");
  if (!detailPane || !detailPane.classList.contains("active")) {
    executeAppCommand("switchTab", "goithau-detail", id);
    return;
  }
  if (this._currentWorkflowPackageId !== id) {
    this._inPlaceEditMode = false;
    this._biddingInfoEditMode = false;
  }
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  const detailCard = document.getElementById("detail-workflow-card");
  if (detailCard) setRuntimeStyle(detailCard, "visibility", "visible");
  const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const inviteComparisonLabel = is1G2T ? "Ngày mời đối chiếu tài liệu/Thương thảo" : "Ngày mời đối chiếu tài liệu";
  const comparisonLabel = is1G2T ? "Ngày đối chiếu tài liệu/Thương thảo" : "Ngày đối chiếu tài liệu";
  const allBidsForOpening = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
  const workflowTabs = buildPackageTabs(gt, allBidsForOpening, { currentTab: this._currentWorkflowTab });
  const {
    tabs,
    qualifiedBids: qualifiedBidsForOpening,
    isTechEvalSaved,
    isFinEvalSaved,
    isSingleEnvelopeEvalSaved: isEvalSaved1G1T,
    isFinOpeningSaved
  } = workflowTabs;
  const detailState = resolvePackageDetailState({
    tabs,
    currentTab: this._currentWorkflowTab,
    currentPackageId: this._currentWorkflowPackageId,
    packageId: id
  });
  this._currentWorkflowTab = detailState.activeTab;
  this._currentWorkflowPackageId = detailState.packageId;
  const latestPlan = this.model.getLatestPlan(gt.keHoachId);
  const isPlanLatest = latestPlan && latestPlan.id === gt.keHoachId;
  const latestPkg = this.model.getLatestPackage(gt.id);
  const isPkgLatest = latestPkg && latestPkg.id === gt.id;
  const isEditable = isPkgLatest && gt.trangThai !== "Hủy thầu";
  const kh = this.model.getLatestPlan(gt.keHoachId);
  const codeEl = document.getElementById("detail-workflow-code");
  const badgeEl = document.getElementById("detail-workflow-status-badge");
  const titleEl = document.getElementById("detail-workflow-title");
  if (codeEl) codeEl.innerText = gt.maGoiThau || "Gói thầu";
  if (badgeEl) badgeEl.innerHTML = this.getStatusBadge(gt.trangThai);
  if (titleEl) titleEl.innerText = gt.tenGoiThau || "Chưa nhập tên";
  const actionsEl = document.getElementById("detail-workflow-actions");
  if (actionsEl) {
    const canCancel = !["Chuẩn bị", "Đang mời thầu", "Đã mở thầu", "Hủy thầu"].includes(gt.trangThai);
    renderWorkflowActions(actionsEl, {
      canCancel,
      onCancel: () => {
        this._currentWorkflowTab = "cancel";
        this.showPackageDetails(gt.id);
      }
    });
  }
  const verSelect = document.getElementById("detail-workflow-version-select");
  if (verSelect) {
    const staleWrapper = verSelect.parentElement ? verSelect.parentElement.querySelector('.custom-select-container[data-target="detail-workflow-version-select"]') : null;
    if (staleWrapper) staleWrapper.remove();
    const staleDropdown = document.body.querySelector('.custom-select-dropdown[data-target="detail-workflow-version-select"]');
    if (staleDropdown) staleDropdown.remove();
    setRuntimeStyle(verSelect, "display", "none");
    const rootId = gt.rootId || gt.id;
    const allRelated = this.model.state.goithau.filter((g) => (g.rootId || g.id) === rootId);
    const verMap = {};
    allRelated.forEach((g) => {
      const ver = g.phienBan || "00";
      if (!verMap[ver]) {
        verMap[ver] = g;
      } else {
        const p1 = this.model.getLatestPlan(g.keHoachId);
        const p2 = this.model.getLatestPlan(verMap[ver].keHoachId);
        const v1 = p1 ? parseInt(p1.phienBan) || 0 : 0;
        const v2 = p2 ? parseInt(p2.phienBan) || 0 : 0;
        if (v1 > v2) {
          verMap[ver] = g;
        }
      }
    });
    const relatedGts = Object.values(verMap);
    relatedGts.sort((a, b) => parseInt(a.phienBan || 0) - parseInt(b.phienBan || 0));
    const separator = document.getElementById("detail-workflow-version-separator");
    verSelect.innerHTML = relatedGts.map((g) => {
      const label = g.phienBan || "00";
      const isSelected = (g.phienBan || "00") === (gt.phienBan || "00");
      return `<option value="${g.id}" ${isSelected ? "selected" : ""}>${label}</option>`;
    }).join("");
    if (separator) setRuntimeStyle(separator, "display", "inline-block");
    setRuntimeStyle(verSelect, "display", "inline-block");
    if (relatedGts.length >= 2) {
      verSelect.disabled = false;
      verSelect.onchange = (e) => {
        this.showPackageDetails(e.target.value, true);
      };
    } else {
      verSelect.disabled = true;
      verSelect.onchange = null;
    }
    initCustomSelect("detail-workflow-version-select");
  }
  const tabHeadersEl = document.getElementById("detail-workflow-tabs-header");
  renderPackageTabHeaders(tabHeadersEl, tabs, this._currentWorkflowTab, (tabId) => {
    this._inPlaceEditMode = false;
    this._biddingInfoEditMode = false;
    selectPackageDetailTab(this, tabId, id);
    this.showPackageDetails(id);
  });
  const contentWrapper = document.getElementById("detail-workflow-content-wrapper");
  if (!contentWrapper) return;
  contentWrapper.innerHTML = "";
  switch (this._currentWorkflowTab) {
    case "preparation":
      renderPreparationDetailsPanel(this, { contentWrapper, gt, id, isEditable, appController });
      break;
    case "preparation_action":
      renderPreparationActionPanel(contentWrapper, gt);
      lucide.createIcons();
      break;
    case "opening":
    case "opening_tech":
      {
        const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
        if (gt.trangThai === "Chuẩn bị" && !isDirectOrSpecial) {
          const releaseArgsKey = registerCommandArgs([String(gt.id || "")]);
          const khObj = this.model.getLatestPlan(gt.keHoachId);
          const cdtObj = khObj ? this.model.state.chudautu.find((c) => c.id === khObj.chuDauTuId) : null;
          const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : "Không rõ";
          const tenKhStr = khObj ? khObj.tenKeHoach : "Không rõ";
          const packageSummaryHtml = renderPackageSummary({
            pkg: gt, planName: tenKhStr, investorName: tenCdtStr,
            formatCurrency: (value) => this.model.formatCurrency(value),
            formatDateTime: (value) => this.model.formatDateWithTime(value)
          });
          contentWrapper.innerHTML = `
                    ${packageSummaryHtml}

                    <div class="bf-s-4cee5cb79b">
                        <div class="bf-s-dca86ff56c">
                            <i data-lucide="settings" class="bf-s-f5c02a2822"></i>
                        </div>
                        <h4 class="bf-s-4c428a6a8c">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
                        <p class="bf-s-ed725428b7">
                            Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.
                        </p>
                        <button class="btn btn-primary bf-s-43ee718714" data-bf-action="call" data-fn="phatHanhHsmtGoiThau" data-arg-key="${escapeHtml(releaseArgsKey)}">
                            <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
                        </button>
                    </div>
                `;
          lucide.createIcons();
        } else if (gt.trangThai === "Đang mời thầu" && !isDirectOrSpecial) {
          const khObj = this.model.getLatestPlan(gt.keHoachId);
          const cdtObj = khObj ? this.model.state.chudautu.find((c) => c.id === khObj.chuDauTuId) : null;
          const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : "Không rõ";
          const tenKhStr = khObj ? khObj.tenKeHoach : "Không rõ";
          const packageSummaryHtml = renderPackageSummary({
            pkg: gt, planName: tenKhStr, investorName: tenCdtStr,
            formatCurrency: (value) => this.model.formatCurrency(value),
            formatDateTime: (value) => this.model.formatDateWithTime(value),
            timeIds: true
          });
          renderInvitationPanel(contentWrapper, gt, {
            summaryHtml: packageSummaryHtml,
            editMode: this._biddingInfoEditMode
          });
          if (appController) {
            appController._loadGiaHanRows(gt.giaHanList || []);
            appController._loadYeuCauLamRoRows(gt.yeuCauLamRoList || []);
            appController._loadTraLoiLamRoRows(gt.traLoiLamRoList || []);
          }
          if (!this._biddingInfoEditMode) {
            document.querySelectorAll("#gt-giahan-tbody input, #gt-yeucaulamro-tbody input, #gt-traloilamro-tbody input").forEach((input) => {
              input.disabled = true;
              setRuntimeStyle(input, "background", "var(--neutral-soft)");
              setRuntimeStyle(input, "cursor", "not-allowed");
            });
            document.querySelectorAll("#gt-giahan-tbody td:last-child, #gt-yeucaulamro-tbody td:last-child, #gt-traloilamro-tbody td:last-child").forEach((td) => {
              setRuntimeStyle(td, "display", "none");
            });
          }
          const btnThemGiaHan = document.getElementById("btn-them-giahan");
          if (btnThemGiaHan) {
            btnThemGiaHan.onclick = () => appController?.addGiaHanRow();
          }
          const btnThemYeuCau = document.getElementById("btn-them-yeucaulamro");
          if (btnThemYeuCau) {
            btnThemYeuCau.onclick = () => appController?.addYeuCauLamRoRow();
          }
          const btnThemTraLoi = document.getElementById("btn-them-traloilamro");
          if (btnThemTraLoi) {
            btnThemTraLoi.onclick = () => appController?.addTraLoiLamRoRow();
          }
          const btnLuuThongTinMoiThau = document.getElementById("btn-luu-thongtinmoithau");
          if (btnLuuThongTinMoiThau) {
            btnLuuThongTinMoiThau.onclick = async () => {
              if (!this._biddingInfoEditMode) {
                this._biddingInfoEditMode = true;
                this.showPackageDetails(id);
                return;
              }
              const giaHanList = appController?._collectGiaHanRows() || [];
              const yeuCauLamRoList = appController?._collectYeuCauLamRoRows() || [];
              const traLoiLamRoList = appController?._collectTraLoiLamRoRows() || [];
              const extensionInputRows = Array.from(document.querySelectorAll("#gt-giahan-tbody tr")).map((tr) => ({
                timeStr: tr.querySelector(".gh-time-input")?.value.trim() || "",
                reason: tr.querySelector(".gh-reason-input")?.value.trim() || ""
              }));
              const extensionValidation = validateExtensionRows(gt.thoiGianDongThau || "", extensionInputRows);
              if (!extensionValidation.valid) {
                const extensionRow = document.querySelectorAll("#gt-giahan-tbody tr")[extensionValidation.rowIndex];
                const extensionInput = extensionRow?.querySelector(extensionValidation.field === "reason" ? ".gh-reason-input" : ".gh-time-input");
                await this.customAlert("Dữ liệu không hợp lệ", extensionValidation.error, "alert-triangle", extensionInput);
                appController?.validateGiaHanRealtime?.();
                return;
              }
              await savePackageInvitationInfo(appController || this, gt, {
                extensions: giaHanList,
                clarificationRequests: yeuCauLamRoList,
                clarificationResponses: traLoiLamRoList,
                convertDateTime: (value) => this.model.convertDMYHMSToYMDHMS(value)
              });
              this._biddingInfoEditMode = false;
              this.showPackageDetails(id);
              await this.customAlert("Thành công", "Lưu thông tin mời thầu thành công!", "check-circle");
            };
          }
          lucide.createIcons();
        } else {
          renderOpeningPanel(contentWrapper, gt, { isDirectOrSpecial });
          appController?.renderMoThauPanel?.();
        }
      }
      break;
    case "eval_tech":
      renderTechnicalEvaluationPanel(contentWrapper, gt, { inviteComparisonLabel, comparisonLabel });
      if (appController) {
        appController.currentDanhGiaTab = "technical";
        appController.renderDanhGiaHsdtPanel?.();
      }
      break;
    case "eval_fin":
      renderFinancialEvaluationPanel(contentWrapper, gt, { inviteComparisonLabel, comparisonLabel });
      if (appController) {
        appController.currentDanhGiaTab = "financial";
        appController.renderDanhGiaHsdtPanel?.();
      }
      break;
    case "qualified": {
      const allBids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
      const qualifiedBids = allBids.filter(checkBidQualified);
      const hasTechScore = qualifiedBids.some((b) => {
        if (!b.danhGiaKyThuat) return false;
        const clean = String(b.danhGiaKyThuat).trim().replace(/,/g, ".");
        return !isNaN(parseFloat(clean)) && isFinite(clean);
      }) || ["Kết hợp giữa kỹ thuật và giá", "Giá cố định", "Dựa trên kỹ thuật"].includes(gt.phuongPhapDanhGia);
      if (!isTechEvalSaved) {
        contentWrapper.innerHTML = `
                    <div class="bf-s-71ff99332d">
                        <i data-lucide="shield-alert" class="bf-s-106d10c68d"></i>
                        <h4 class="bf-s-01dd0d67e8">Chưa có Nhà thầu đạt kỹ thuật</h4>
                        <p class="bf-s-85ddf1c3bf">Vui lòng hoàn thành và Lưu Báo cáo đánh giá E-HSĐXKT trước.</p>
                    </div>
                `;
      } else {
        const khObj = this.model.getLatestPlan(gt.keHoachId);
        const cdtObj = khObj ? this.model.state.chudautu.find((c) => c.id === khObj.chuDauTuId) : null;
        const tenCdt = cdtObj ? cdtObj.tenChuDauTu : "Không rõ";
        const tenKhStr = khObj ? khObj.tenKeHoach : "Không rõ";
        const is1G2T3 = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
        let metadata2 = { is1G2T: true, technical: { saved: false }, financial: { saved: false } };
        if (gt.danhGiaHsdtMetadata) {
          try {
            const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
            if (parsed.is1G2T) {
              metadata2 = parsed;
            } else {
              metadata2 = {
                is1G2T: true,
                technical: parsed.soBaoCao ? parsed : { saved: false },
                financial: { saved: false }
              };
            }
          } catch (e) {
            console.error("Failed to parse metadata", e);
          }
        }
        if (!metadata2.technical) {
          metadata2.technical = { saved: true };
        }
        const soQd = metadata2.technical.soQdPheDuyetKt || "";
        const ngayQd = metadata2.technical.ngayQdPheDuyetKt || "";
        const soBctd = metadata2.technical.soBctdKt || "";
        const ngayBctd = metadata2.technical.ngayBctdKt || "";
        const isCompleted = !!metadata2.technical.qualifiedSaved;
        const isEditingThisStep = this._editingState && this._editingState[this._currentWorkflowTab];
        const isFinOpened = !!gt.thoiGianMoEhsdxtc;
        const isReadOnly = isCompleted && !isEditingThisStep || gt.trangThai === "Đã có kết quả" || gt.trangThai === "Hủy thầu";
        const canEdit = isReadOnly && isCompleted && !isFinOpened && gt.trangThai !== "Đã có kết quả" && gt.trangThai !== "Hủy thầu";
        const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
        contentWrapper.innerHTML = `
                    <div class="bf-s-8bd3eb473c">
                        <div class="bf-s-5d398becec">Thông số Gói thầu</div>
                        <div class="bf-s-13b5590e90">
                            <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${escapeHtml(tenCdt)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${escapeHtml(tenKhStr)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${escapeHtml(gt.linhVuc || "Hàng hóa")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${escapeHtml(gt.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${gt.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${escapeHtml(gt.hinhThucLuaChon || "--")}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${escapeHtml(gt.phuongPhapDanhGia)}${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat ? ` (${escapeHtml(gt.trongSoKyThuat)}%)` : ""}</div>` : ""}
                            <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${escapeHtml(gt.loaiHopDong || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${escapeHtml(gt.thoiGianThucHien || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${escapeHtml(gt.nguonVon || "--")}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">${is1G2T3 ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong> ${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</div>
                            ${is1G2T3 ? `<div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong> ${gt.thoiGianMoEhsdxtc ? this.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : "Chưa mở"}</div>` : ""}
                            ` : ""}
                        </div>
                    </div>

                    <div class="bf-s-098565a16e">
                        <div class="bf-s-5d398becec">QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật</div>
                        <div class="bf-s-ed07f78f34">
                            ${gt.hinhThucLuaChon !== "Chào hàng cạnh tranh" ? `
                            <div class="form-group bf-s-4bbf3df076">
                                <label class="bf-s-997cdefbc9">Số BCTĐ kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-so-bctd" class="form-control bf-s-20e5983dc7" value="${soBctd}" placeholder="Nhập số báo cáo thẩm định..." ${isReadOnly ? "readonly" : ""}>
                                <span class="error-text bf-s-35a8ff27ff">Vui lòng nhập Số BCTĐ kỹ thuật!</span>
                            </div>
                            <div class="form-group bf-s-4bbf3df076">
                                <label class="bf-s-997cdefbc9">Ngày BCTĐ kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-ngay-bctd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${ngayBctd ? this.model.formatForDateInput(ngayBctd) : ""}" ${isReadOnly ? "readonly" : ""} placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-35a8ff27ff">Vui lòng chọn Ngày BCTĐ kỹ thuật!</span>
                            </div>
                            ` : ""}
                            <div class="form-group bf-s-4bbf3df076">
                                <label class="bf-s-997cdefbc9">Số QĐ phê duyệt nhà thầu đạt kỹ thuật <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-so-qd" class="form-control bf-s-20e5983dc7" value="${soQd}" placeholder="Ví dụ: 120/QĐ-CDT" ${isReadOnly ? "readonly" : ""}>
                                <span class="error-text bf-s-35a8ff27ff">Vui lòng nhập Số QĐ phê duyệt!</span>
                            </div>
                            <div class="form-group bf-s-4bbf3df076">
                                <label class="bf-s-997cdefbc9">Ngày QĐ phê duyệt <span class="text-danger">*</span></label>
                                <input type="text" id="qualified-ngay-qd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${ngayQd ? this.model.formatForDateInput(ngayQd) : ""}" ${isReadOnly ? "readonly" : ""} placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-35a8ff27ff">Vui lòng chọn Ngày QĐ phê duyệt!</span>
                            </div>
                        </div>
                    </div>

                     <div class="table-container bf-s-674afada30">
                         ${qualifiedBids.length === 0 ? `
                             <div class="bf-s-5835c40555">
                                 <i data-lucide="info" class="bf-s-ea6824d1aa"></i> Không có nhà thầu nào đạt yêu cầu kỹ thuật. Vui lòng nhập số quyết định phê duyệt và ngày quyết định phía trên để lưu danh sách đạt kỹ thuật trống và chuyển sang bước Hủy thầu.
                             </div>
                         ` : `
                         <table class="data-table bf-s-448ca2b6ae">
                              <thead>
                                  <tr>
                                      ${gt.phanLo === "Có" ? `
                                          <th class="bf-s-ad8c93e5fe">Mã phần lô</th>
                                          <th class="bf-s-a01153c965">Tên phần lô</th>
                                      ` : ""}
                                      <th class="bf-s-ad8c93e5fe">Mã nhà thầu</th>
                                      <th style="width: ${gt.phanLo === "Có" ? "25%" : "40%"};">Tên nhà thầu</th>
                                      ${hasTechScore ? `<th class="bf-s-1a457d1503">Điểm kỹ thuật</th>` : ""}
                                      <th class="bf-s-1a457d1503">Kết quả</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  ${qualifiedBids.map((b) => `
                                      <tr>
                                          ${gt.phanLo === "Có" ? `
                                              <td>${escapeHtml(b.maPhanLo || "--")}</td>
                                              <td>${escapeHtml(b.tenPhanLo || "--")}</td>
                                          ` : ""}
                                          <td>${escapeHtml(formatPartnerIdentityCode(b.maNhaThau || b.maDinhDanh, "--"))}</td>
                                          <td>${renderBidContractorLink(this.model, b, `${gt.id}_qualified_${b.id}`)}</td>
                                          ${hasTechScore ? `<td class="bf-s-63dbf5319a">${escapeHtml(b.danhGiaKyThuat || "--")}</td>` : ""}
                                          <td class="bf-s-63dbf5319a">
                                              <span class="badge badge-success bf-s-391321b535">Đạt kỹ thuật</span>
                                          </td>
                                      </tr>
                                  `).join("")}
                              </tbody>
                          </table>
                          `}
                     </div>
                    <div class="bf-s-54e8112b47">
                         ${!isReadOnly ? `
                             <button class="btn btn-primary bf-s-b69e3fa20a" id="btn-save-qualified-decision"><i data-lucide="save"></i> Lưu QĐ phê duyệt</button>
                         ` : canEdit ? `
                             <button class="btn btn-primary bf-s-b69e3fa20a" id="btn-edit-qualified-decision"><i data-lucide="edit-3"></i> Chỉnh sửa</button>
                         ` : ""}
                     </div>
                 `;
        if (typeof this.initFlatpickr === "function") {
          this.initFlatpickr(contentWrapper);
        }
        const btnEdit = contentWrapper.querySelector("#btn-edit-qualified-decision");
        if (btnEdit) {
          btnEdit.onclick = () => {
            this._editingState = this._editingState || {};
            this._editingState[this._currentWorkflowTab] = true;
            this.showPackageDetails(gt.id);
          };
        }
        if (!isReadOnly) {
          const btnSave = contentWrapper.querySelector("#btn-save-qualified-decision");
          if (btnSave) {
            btnSave.onclick = async () => {
              const inpSo = contentWrapper.querySelector("#qualified-so-qd");
              const inpNgay = contentWrapper.querySelector("#qualified-ngay-qd");
              const inpSoBctd = contentWrapper.querySelector("#qualified-so-bctd");
              const inpNgayBctd = contentWrapper.querySelector("#qualified-ngay-bctd");
              const valSo = inpSo.value.trim();
              const valNgayRaw = inpNgay.value.trim();
              const valSoBctd = inpSoBctd ? inpSoBctd.value.trim() : "";
              const valNgayBctdRaw = inpNgayBctd ? inpNgayBctd.value.trim() : "";
              let hasErr = false;
              const errorInputs = [];
              if (!valSo) {
                hasErr = true;
                errorInputs.push(inpSo);
                setFieldFeedback(inpSo, { state: "invalid", message: inpSo.closest(".form-group")?.querySelector(".error-text")?.textContent || "" });
              } else {
                setFieldFeedback(inpSo);
              }
              if (!valNgayRaw) {
                hasErr = true;
                errorInputs.push(inpNgay);
                setFieldFeedback(inpNgay, { state: "invalid", message: inpNgay.closest(".form-group")?.querySelector(".error-text")?.textContent || "" });
              } else {
                setFieldFeedback(inpNgay);
              }
              if (inpSoBctd) {
                if (!valSoBctd) {
                  hasErr = true;
                  errorInputs.push(inpSoBctd);
                  setFieldFeedback(inpSoBctd, { state: "invalid", message: inpSoBctd.closest(".form-group")?.querySelector(".error-text")?.textContent || "" });
                } else {
                  setFieldFeedback(inpSoBctd);
                }
              }
              if (inpNgayBctd) {
                if (!valNgayBctdRaw) {
                  hasErr = true;
                  errorInputs.push(inpNgayBctd);
                  setFieldFeedback(inpNgayBctd, { state: "invalid", message: inpNgayBctd.closest(".form-group")?.querySelector(".error-text")?.textContent || "" });
                } else {
                  setFieldFeedback(inpNgayBctd);
                }
              }
              if (hasErr) {
                this.focusInvalidControl(errorInputs[0]);
                return;
              }
              metadata2.technical.soQdPheDuyetKt = valSo;
              metadata2.technical.ngayQdPheDuyetKt = this.model.convertDMYToYMD(valNgayRaw);
              if (inpSoBctd) metadata2.technical.soBctdKt = valSoBctd;
              if (inpNgayBctd) metadata2.technical.ngayBctdKt = this.model.convertDMYToYMD(valNgayBctdRaw);
              if (isCompetitiveQuotationPackage(gt)) {
                delete metadata2.technical.soBctdKt;
                delete metadata2.technical.ngayBctdKt;
              }
              metadata2.technical.qualifiedSaved = true;
              await saveQualifiedApproval(appController || this, gt, metadata2);
              if (this._editingState) {
                this._editingState[this._currentWorkflowTab] = false;
              }
              await this.customAlert("Thành công", "Đã lưu QĐ phê duyệt danh sách nhà thầu đạt kỹ thuật thành công!", "check-circle");
              const allBids2 = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
              const qualifiedBids2 = allBids2.filter(checkBidQualified);
              this._currentWorkflowTab = qualifiedBids2.length > 0 ? "opening_fin" : "result";
              this.showPackageDetails(gt.id);
            };
          }
        }
      }
      break;
    }
    case "opening_fin": {
      const allBidsForOpening2 = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
      const qualifiedBidsForOpening2 = allBidsForOpening2.filter(checkBidQualified);
      qualifiedBidsForOpening2.sort((a, b) => {
        const lotA = String(a.maPhanLo || "").toLowerCase();
        const lotB = String(b.maPhanLo || "").toLowerCase();
        const lotCompare = lotA.localeCompare(lotB, "vi", { numeric: true });
        if (lotCompare !== 0) return lotCompare;
        const ntA = String(a.maNhaThau || a.maDinhDanh || "").toLowerCase();
        const ntB = String(b.maNhaThau || b.maDinhDanh || "").toLowerCase();
        return ntA.localeCompare(ntB, "vi", { numeric: true });
      });
      const hasTechScore = qualifiedBidsForOpening2.some((b) => {
        if (!b.danhGiaKyThuat) return false;
        const clean = String(b.danhGiaKyThuat).trim().replace(/,/g, ".");
        return !isNaN(parseFloat(clean)) && isFinite(clean);
      }) || ["Kết hợp giữa kỹ thuật và giá", "Giá cố định", "Dựa trên kỹ thuật"].includes(gt.phuongPhapDanhGia);
      if (qualifiedBidsForOpening2.length === 0) {
        contentWrapper.innerHTML = `
                    <div class="bf-s-71ff99332d">
                        <i data-lucide="lock" class="bf-s-5141e22887"></i>
                        <h4 class="bf-s-01dd0d67e8">Chưa mở túi hồ sơ Đề xuất Tài chính</h4>
                        <p class="bf-s-85ddf1c3bf">Vui lòng hoàn thành Đánh giá kỹ thuật để xác định danh sách nhà thầu đủ điều kiện mở túi HSĐXTC.</p>
                    </div>
                `;
      } else {
        const isFinOpeningSaved2 = qualifiedBidsForOpening2.some((b) => b.giaDuThau && b.giaDuThau > 0);
        const isCompleted = isFinOpeningSaved2;
        const isEditingThisStep = this._editingState && this._editingState[this._currentWorkflowTab];
        let isFinEvalSaved2 = false;
        if (gt.danhGiaHsdtMetadata) {
          try {
            const parsed = JSON.parse(gt.danhGiaHsdtMetadata);
            if (parsed.financial && parsed.financial.saved) {
              isFinEvalSaved2 = true;
            }
          } catch (e) {
          }
        }
        const isReadOnly = isCompleted && !isEditingThisStep || gt.trangThai === "Đã có kết quả" || gt.trangThai === "Hủy thầu" || isFinEvalSaved2;
        const canEdit = !isFinEvalSaved2 && gt.trangThai !== "Đã có kết quả" && gt.trangThai !== "Hủy thầu";
        const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
        contentWrapper.innerHTML = `
                    <div class="bf-s-175e7e1f51">
                        <h4 class="bf-s-ff3bca23d8">
                            Biên bản mở hồ sơ đề xuất tài chính (E-HSĐXTC)
                        </h4>
                        ${!isReadOnly ? `
                            <div class="bf-s-9c40389b4a">
                                <button class="btn-excel-action btn-download-excel-template-direct" data-type="opening_fin" id="btn-opening-fin-export-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
                                <button class="btn-excel-action btn-import-excel-direct" data-type="opening_fin" id="btn-opening-fin-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
                            </div>
                        ` : ""}
                    </div>
                    <div class="bf-s-8bd3eb473c">
                        <div class="bf-s-5d398becec">Thông số Gói thầu</div>
                        <div class="bf-s-13b5590e90">
                            <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${escapeHtml((() => {
          const khO = this.model.getLatestPlan(gt.keHoachId);
          const cdO = khO ? this.model.state.chudautu.find((c) => c.id === khO.chuDauTuId) : null;
          return cdO ? cdO.tenChuDauTu : "Không rõ";
        })())}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${escapeHtml((() => {
          const khO = this.model.getLatestPlan(gt.keHoachId);
          return khO ? khO.tenKeHoach : "Không rõ";
        })())}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${escapeHtml(gt.linhVuc || "Hàng hóa")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${escapeHtml(gt.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${gt.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${this.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${escapeHtml(gt.hinhThucLuaChon || "--")}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${escapeHtml(gt.phuongPhapDanhGia)}${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat ? ` (${escapeHtml(gt.trongSoKyThuat)}%)` : ""}</div>` : ""}
                            <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${escapeHtml(gt.loaiHopDong || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${escapeHtml(gt.thoiGianThucHien || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${escapeHtml(gt.nguonVon || "--")}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? this.model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXKT:</strong> <span class="text-dark fw-bold">${gt.thoiGianMoThau ? this.model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</span></div>
                            <div class="bf-s-ca978d48b2">
                                <span>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong></span>
                                ${isReadOnly ? `<span class="text-dark fw-bold">${escapeHtml(gt.thoiGianMoEhsdxtc ? this.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : "Chưa mở")}</span>` : `<input type="text" id="op-fin-thoigianmothau" class="form-control flatpickr-datetime bf-s-ab24ccb4e7" value="${escapeHtml(gt.thoiGianMoEhsdxtc ? this.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : "")}" placeholder="dd/MM/yyyy HH:mm">`}
                            </div>
                            ` : ""}
                        </div>
                        ${isReadOnly ? `
                        <div class="bf-s-d4b8c020d5">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                            Biên bản mở E-HSĐXTC đã được khóa
                        </div>
                        ` : ""}
                    </div>
                    ${renderFinancialOpeningTable({
                      model: this.model,
                      pkg: gt,
                      bids: qualifiedBidsForOpening2,
                      isReadOnly,
                      canEdit,
                      hasTechnicalScore: hasTechScore
                    })}
                `;
        if (!isReadOnly) {
          const rows = bindFinancialOpeningRows(contentWrapper, {
            parseVND: (value) => this.model.parseVND(value),
            formatVND: (value) => this.model.formatVND(value)
          });
          const importBtn = document.getElementById("btn-opening-fin-import-excel");
          if (importBtn) {
            importBtn.onclick = () => {
              appController?.triggerExcelImport("opening_fin");
            };
          }
          const saveBtn = document.getElementById("btn-save-opening-fin");
          if (saveBtn) {
            saveBtn.onclick = async () => {
              const inputOpFinTime = document.getElementById("op-fin-thoigianmothau");
              const openingTime = inputOpFinTime?.value
                ? this.model.convertDMYHMSToYMDHMS(inputOpFinTime.value)
                : "";
              inputOpFinTime?.classList.remove("field-invalid");
              inputOpFinTime?.removeAttribute("aria-invalid");
              inputOpFinTime?.addEventListener("input", () => {
                inputOpFinTime.classList.remove("field-invalid");
                inputOpFinTime.removeAttribute("aria-invalid");
              }, { once: true });
              const timeValidation = validateFinancialOpeningTime({
                required: Boolean(inputOpFinTime),
                rawValue: inputOpFinTime?.value || "",
                convertedValue: openingTime,
                technicalOpeningTime: gt.thoiGianMoThau || ""
              });
              const rowValidation = validateFinancialOpeningRows(rows, {
                parseVND: (value) => this.model.parseVND(value),
                isConsulting: gt.linhVuc === "Tư vấn"
              });
              const invalidInputs = [...(!timeValidation.valid && inputOpFinTime ? [inputOpFinTime] : []), ...rowValidation.invalidInputs];
              if (!timeValidation.valid || !rowValidation.valid) {
                markFinancialOpeningInvalid(invalidInputs);
                const messages = [timeValidation.message, ...rowValidation.errors].filter(Boolean);
                await this.customAlert("Dữ liệu không hợp lệ", messages.join("\n"), "alert-triangle", invalidInputs[0]);
                this.focusInvalidControl(invalidInputs[0]);
                return;
              }
              await savePackageFinancialOpening(
                appController || this,
                gt,
                collectFinancialOpeningRows(rows, { parseVND: (value) => this.model.parseVND(value) }),
                { openingTime }
              );
              if (this._editingState) {
                this._editingState[this._currentWorkflowTab] = false;
              }
              await this.customAlert("Thành công", "Đã lưu Biên bản mở thầu E-HSĐXTC thành công!", "check-circle");
              this._currentWorkflowTab = "eval_fin";
              this.showPackageDetails(id);
            };
          }
        }
        const exportBtn = document.getElementById("btn-opening-fin-export-excel");
        if (exportBtn) {
          exportBtn.onclick = () => {
            const safeCode = (gt.maGoiThau || "GoiThau").replace(/[^a-zA-Z0-9_-]/g, "").trim().substring(0, 30);
            authFetchDownload(`/api/export-opening-fin-template?package_id=${gt.id}&package_name=${encodeURIComponent(safeCode)}`, `Mau_Mo_Tai_Chinh_${safeCode}.xlsx`);
          };
        }
        const editBtn = document.getElementById("btn-edit-opening-fin");
        if (editBtn) {
          editBtn.onclick = () => {
            this._editingState = this._editingState || {};
            this._editingState[this._currentWorkflowTab] = true;
            this.showPackageDetails(gt.id);
          };
        }
      }
      break;
    }
    case "result":
      renderAwardResultDetailsPanel(this, { contentWrapper, gt, id, isEditable, appController });
      break;
    case "cancel": {
      renderCancellationPanel(contentWrapper, {
        pkg: gt,
        formatDate: (value) => this.model.formatForDateInput(value),
        initDatePicker: (root) => this.initFlatpickr?.(root),
        onSave: async ({ decisionNumber, decisionDate, reason, controls }) => {
          if (!decisionNumber || !decisionDate || !reason) {
            const firstInvalid = !decisionNumber ? controls.decisionNumber : !decisionDate ? controls.decisionDate : controls.reason;
            await this.customAlert("Thiếu thông tin", "Vui lòng điền đầy đủ Số quyết định, Ngày quyết định và Lý do hủy thầu.", "alert-triangle", firstInvalid);
            return;
          }
          const result = await savePackageCancellation(appController, gt, {
            decisionNumber,
            decisionDate: this.model.convertDMYToYMD(decisionDate),
            reason
          });
          if (!result?.ok) return;
          await this.customAlert("Thành công", "Đã lưu quyết định hủy thầu và cập nhật trạng thái gói thầu.", "check-circle");
          this.showPackageDetails(gt.id);
        }
      });
      break;
    }
  }
  lucide.createIcons();
  if (appController?.setupExcelImportEvents) {
    appController.setupExcelImportEvents();
  }
  ["mothau-goithau-select", "danhgiahsdt-goithau-select", "result-goithau-select"].forEach((selectId) => {
    const wrapper = document.querySelector(`.custom-select-wrapper[data-select-id="${selectId}"]`);
    if (wrapper) wrapper.remove();
    const container = document.querySelector(`.custom-select-container[data-target="${selectId}"]`);
    if (container) container.remove();
  });
  if (typeof appController?.unifyTableInputsHeight === "function") {
    appController.unifyTableInputsHeight(document);
  }
}
