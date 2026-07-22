import { trustedHTML } from "../../shared/trustedTypes.js";
import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { authFetchDownload, escapeHtml, safeAttr } from "../../shared/view_helpers.js";
import { bindCurrencyElement, formatPartnerIdentityCode } from "../../app/domUtils.js";
import { setFieldFeedback } from "../../app/formStateUtils.js";
import { findContractorVersionByCode, getExactContractorVersion, resolveBidContractorName, resolveBidJointVentureMembers, selectContractorVersionForDate } from "../../partners/contractorVersionBinding.js";
import { setJvData } from "../jvDataStore.js";
import { clearCompetitiveQuotationAppraisal } from "../packageAppraisal.js";
import { checkBidQualified } from "./PackageTabs.js";
import { renderBidContractorLink } from "./BidderTable.js";
import { bindAwardResultPanel, renderAwardedResultPanel } from "./AwardResultPanel.js";
import { commitPackageAwardDecision } from "../packageEvaluationProgress.js";
import { reopenPackageAwardResult } from "../packageAwardResult.js";
import { executeAppCommand } from "../../app/commandBus.js";
import { getLotWinnersStore } from "../../shared/runtimeState.js";
import { generateRecordId, generateUUID } from "../../shared/idUtils.js";
import { appendExportSnapshotVersion } from "../../shared/exportSnapshot.js";
import { buildAwardResultApprovalMarkup } from "./AwardResultApprovalMarkup.js";
import {
  isBidWithinEvaluationLotDetails,
  resolveActiveSavedEvaluationScope
} from "../lotEvaluationScope.js";
import { mergeScopedAwardLotResults } from "../lotAwardResultScope.js";
import { selectPackageDetailTab } from "./PackageDetailState.js";

function isLeadJointVentureMember(member) {
  return String(member?.vaiTro || "").trim().toLocaleLowerCase("vi-VN") === "đứng đầu liên danh";
}

function normalizeContractorCode(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

export function buildAwardJointVentureViewData(model, bid = {}) {
  const resolvedMembers = resolveBidJointVentureMembers(model, bid);
  const bidCode = normalizeContractorCode(bid.maNhaThau || bid.maDinhDanh);
  const bidContractorId = String(bid.nhaThauId || "");
  const leadMember = resolvedMembers.find(isLeadJointVentureMember)
    || resolvedMembers.find((member) => String(member.thanhVienNhaThauId || "") === bidContractorId)
    || resolvedMembers.find((member) => normalizeContractorCode(member.maNhaThau || member.maSoThue || member.maDinhDanh) === bidCode);
  const requestedLeadContractorId = leadMember?.thanhVienNhaThauId || bid.nhaThauId || "";
  const leadContractor = getExactContractorVersion(model, requestedLeadContractorId)
    || findContractorVersionByCode(model, leadMember?.maNhaThau || leadMember?.maSoThue || bid.maNhaThau || bid.maDinhDanh);
  const leadContractorVersionId = leadMember?.thanhVienNhaThauId || leadContractor?.id || bid.nhaThauId || "";
  const leadCode = leadMember?.maNhaThau
    || leadMember?.maSoThue
    || leadMember?.maDinhDanh
    || leadContractor?.maNhaThau
    || leadContractor?.maSoThue
    || bid.maNhaThau
    || bid.maDinhDanh
    || "";
  const leadName = leadMember?.tenNhaThau
    || leadContractor?.tenNhaThau
    || (bid.loaiNhaThau === "Liên danh" ? "" : resolveBidContractorName(model, bid))
    || "";
  const leadCodeNormalized = normalizeContractorCode(leadCode);
  const members = resolvedMembers.filter((member) => {
    if (member === leadMember || isLeadJointVentureMember(member)) return false;
    const memberCode = normalizeContractorCode(member.maNhaThau || member.maSoThue || member.maDinhDanh);
    return !leadCodeNormalized || memberCode !== leadCodeNormalized;
  });
  return { members, leadName, leadCode, leadContractorVersionId };
}

export function renderAwardResultDetailsPanel(view, { contentWrapper, gt, id, isEditable, appController }) {
      const is1G2T2 = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
      let metadata = { technical: {}, result: {} };
      if (gt.danhGiaHsdtMetadata) {
        try {
          metadata = JSON.parse(gt.danhGiaHsdtMetadata);
          if (!metadata.technical) metadata.technical = {};
          if (!metadata.result) metadata.result = {};
        } catch (e) {
          console.error(e);
        }
      }
      const isAwarded = gt.trangThai === "Đã có kết quả";
      const preferredResultBatchId = String(view._currentResultLotBatchId || "");
      const activeScopedEvaluation = !is1G2T2 && !isAwarded
        ? resolveActiveSavedEvaluationScope(gt, metadata, preferredResultBatchId)
          || resolveActiveSavedEvaluationScope(gt, metadata)
        : null;
      if (activeScopedEvaluation) {
        view._currentResultLotBatchId = activeScopedEvaluation.batchId;
      }
      const resultMetadata = activeScopedEvaluation
        ? activeScopedEvaluation.batch?.result || {}
        : metadata.result;
      const soBctdResult = resultMetadata.soBctdKetQua || "";
      const ngayBctdResult = resultMetadata.ngayBctdKetQua || "";
      const resultBindings = new Map((resultMetadata.contractorBindings || []).map((item) => [String(item.bidId || ""), item]));
      const bindResultVersion = (bid) => {
        const binding = resultBindings.get(String(bid.id || ""));
        if (!binding) return bid;
        const memberIds = binding.memberVersionIds || [];
        return {
          ...bid,
          nhaThauId: binding.contractorVersionId || bid.nhaThauId,
          tenNhaThau: bid.loaiNhaThau === "Liên danh" ? binding.jointVentureName || bid.tenNhaThau : bid.tenNhaThau,
          thanhVienLienDanh: (bid.thanhVienLienDanh || []).map((member, index) => ({
            ...member,
            thanhVienNhaThauId: memberIds[index] || member.thanhVienNhaThauId
          }))
        };
      };
      const packageBidsForResult = view.model.state.thongtinmothau.filter(
        (b) => String(b.goiThauId) === String(gt.id)
      );
      const scopedBidsForResult = activeScopedEvaluation
        ? packageBidsForResult.filter((bid) => isBidWithinEvaluationLotDetails(bid, activeScopedEvaluation))
        : packageBidsForResult;
      const allBidsForResult = scopedBidsForResult.filter(checkBidQualified).map(bindResultVersion);
      if (isAwarded) {
        if (!gt.nhaThauTrungThauId && allBidsForResult.length === 1) {
          gt.nhaThauTrungThauId = allBidsForResult[0].nhaThauId || allBidsForResult[0].id;
        }
        const winnerBid = allBidsForResult.find((b) => String(b.nhaThauId) === String(gt.nhaThauTrungThauId)) || allBidsForResult[0];
        let winnerDisplayHtml = "";
        let hasMultipleWinners = false;
        let winningLots = [];
        let uniqueWinnerIds = [];
        if (gt.phanLo === "Có") {
          const plList = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
          winningLots = plList.filter((pl) => pl.nhaThauTrungThauId);
          uniqueWinnerIds = [...new Set(winningLots.map((pl) => String(pl.nhaThauTrungThauId)).filter(Boolean))];
          if (uniqueWinnerIds.length > 1) {
            hasMultipleWinners = true;
          }
        }
        if (hasMultipleWinners) {
          getLotWinnersStore()[gt.id] = winningLots.map((pl) => {
            const bidderInfo = allBidsForResult.find((b) => String(b.nhaThauId) === String(pl.nhaThauTrungThauId));
            const ntInfo = view.model.state.nhathau.find((n) => n.id === pl.nhaThauTrungThauId);
            const ntName = bidderInfo ? resolveBidContractorName(view.model, bidderInfo) : ntInfo ? ntInfo.tenNhaThau : "Nhà thầu #" + pl.nhaThauTrungThauId;
            const isJV = bidderInfo && bidderInfo.loaiNhaThau === "Liên danh";
            let jvData = null;
            if (isJV) {
              jvData = buildAwardJointVentureViewData(view.model, bidderInfo);
            }
            return {
              maPhanLo: pl.maPhanLo,
              tenPhanLo: pl.tenPhanLo,
              nhaThauTrungThauId: pl.nhaThauTrungThauId,
              tenNhaThau: ntName,
              giaTrungThau: pl.giaTrungThau,
              isJV,
              jvData
            };
          });
          winnerDisplayHtml = `
                        <h5 class="bf-s-f3bfd10216">
                            <a href="#" data-bf-action="show-lot-winners" data-id="${gt.id}" class="link-hover bf-s-9be517fbf0" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a>
                        </h5>
                    `;
        } else {
          const finalWinnerId = uniqueWinnerIds.length === 1 ? uniqueWinnerIds[0] : gt.nhaThauTrungThauId || (winnerBid ? winnerBid.nhaThauId || winnerBid.id : null);
          const currentWinnerBid = allBidsForResult.find((b) => String(b.nhaThauId) === String(finalWinnerId)) || winnerBid;
          if (currentWinnerBid) {
            if (currentWinnerBid.loaiNhaThau === "Liên danh") {
              setJvData(gt.id, buildAwardJointVentureViewData(view.model, currentWinnerBid));
              winnerDisplayHtml = `
                                <div class="bf-s-7d5173b171">
                                    <h5 class="bf-s-f3bfd10216">
                                        <a href="#" data-bf-action="show-jv" data-id="${gt.id}" class="link-hover bf-s-b0e08465c2" title="Xem chi tiết liên danh">👥 ${resolveBidContractorName(view.model, currentWinnerBid)}</a>
                                    </h5>
                                </div>
                            `;
            } else {
              const winnerNt = view.model.state.nhathau.find((n) => String(n.id) === String(currentWinnerBid.nhaThauId));
              const winnerMst = winnerNt ? winnerNt.maSoThue || winnerNt.maNhaThau : currentWinnerBid.maDinhDanh || currentWinnerBid.maNhaThau;
              winnerDisplayHtml = `
                                <h5 class="bf-s-f3bfd10216">
                                    <a href="#" data-bf-action="show-contractor" data-id="${currentWinnerBid.nhaThauId}" class="link-hover bf-s-b0e08465c2">${resolveBidContractorName(view.model, currentWinnerBid)}</a>
                                </h5>
                                <div class="bf-s-dfd82ca088">
                                    MST: <strong>${escapeHtml(formatPartnerIdentityCode(winnerMst, "Chưa có"))}</strong>
                                </div>
                            `;
            }
          } else {
            winnerDisplayHtml = `<h5 class="bf-s-f3bfd10216">Chưa xác định</h5>`;
          }
        }
        const allBids = view.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id)).map(bindResultVersion);
        allBids.sort((a, b) => {
          const codeA = String(a.maPhanLo || "").toLowerCase();
          const codeB = String(b.maPhanLo || "").toLowerCase();
          return codeA.localeCompare(codeB, "vi", { numeric: true });
        });
        const winningIds = /* @__PURE__ */ new Set();
        if (gt.nhaThauTrungThauId) {
          winningIds.add(String(gt.nhaThauTrungThauId));
        }
        if (gt.phanLo === "Có" && gt.phanLoList) {
          try {
            const plList = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList) : gt.phanLoList;
            plList.forEach((pl) => {
              if (pl.nhaThauTrungThauId) winningIds.add(String(pl.nhaThauTrungThauId));
            });
          } catch (e) {
            console.error(e);
          }
        }
        const bidsByNt = {};
        allBids.forEach((b) => {
          const ntId = String(b.nhaThauId || b.id || "");
          if (!ntId) return;
          if (!bidsByNt[ntId]) bidsByNt[ntId] = [];
          bidsByNt[ntId].push(b);
        });
        const isPhanLo = gt.phanLo === "Có";
        const allBiddersHtml = allBids.map((b, idx) => {
          const ntId = String(b.nhaThauId || b.id);
          let bidIsWinner = false;
          let giaTrungHtml = "—";
          let thoiGianThucHienHtml = "—";
          if (isPhanLo) {
            const plList = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
            const matchedPl = plList.find((pl) => String(pl.maPhanLo) === String(b.maPhanLo) && String(pl.nhaThauTrungThauId) === String(b.nhaThauId));
            if (matchedPl) {
              bidIsWinner = true;
              giaTrungHtml = view.model.formatCurrency(matchedPl.giaTrungThau || 0);
              thoiGianThucHienHtml = matchedPl.thoiGianGoiThau || "—";
            } else {
              thoiGianThucHienHtml = b.thoiGianThucHien || b.thoiGianGoiThau || "—";
            }
          } else {
            if (gt.nhaThauTrungThauId && String(gt.nhaThauTrungThauId) === String(b.nhaThauId)) {
              bidIsWinner = true;
              giaTrungHtml = view.model.formatCurrency(gt.giaTrungThau || 0);
              thoiGianThucHienHtml = gt.thoiGianGoiThau || "—";
            } else {
              thoiGianThucHienHtml = b.thoiGianThucHien || b.thoiGianGoiThau || "—";
            }
          }
          const badge = bidIsWinner ? `<span class="badge badge-success bf-s-3b94095234">Trúng thầu</span>` : `<span class="badge badge-danger bf-s-514590f0cd">Trượt thầu</span>`;
          let lyDo = "";
          if (bidIsWinner) {
            lyDo = "—";
          } else {
            lyDo = b.lyDoTruot || "";
            if (!lyDo) {
              if (gt.quyTrinhDanhGia === "quytrinh2" && b.danhGiaKetLuan === "Không đánh giá") {
                lyDo = "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";
              } else {
                const ketLuan = b.danhGiaKetLuan;
                if (ketLuan === "Không đạt" || ketLuan && ketLuan.startsWith("Không đạt")) {
                  const failedSteps = [];
                  if (b.danhGiaHopLe === "Không đạt") failedSteps.push("Đánh giá hợp lệ");
                  if (b.danhGiaNangLuc === "Không đạt") failedSteps.push("Đánh giá năng lực");
                  if (b.danhGiaKyThuat === "Không đạt" || b.danhGiaKyThuat && String(b.danhGiaKyThuat).toLowerCase().includes("không đạt")) failedSteps.push("Đánh giá kỹ thuật");
                  if (b.danhGiaTaiChinh === "Không đạt" || b.danhGiaTaiChinh && String(b.danhGiaTaiChinh).toLowerCase().includes("không đạt")) failedSteps.push("Đánh giá tài chính");
                  if (failedSteps.length > 0) {
                    lyDo = `Không đạt ở bước: ${failedSteps.join(", ")}`;
                  } else {
                    lyDo = "Không đạt đánh giá chi tiết";
                  }
                } else {
                  lyDo = "Nhà thầu xếp hạng 1 trúng thầu";
                }
              }
            }
          }
          const isJV = b.loaiNhaThau === "Liên danh";
          let contractorHtml = "";
          if (isJV) {
            const jvKey = `${gt.id}_result_bidder_${idx}`;
            setJvData(jvKey, buildAwardJointVentureViewData(view.model, b));
            contractorHtml = `<a href="#" data-bf-action="show-jv" data-id="${safeAttr(jvKey)}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${escapeHtml(b.tenNhaThau || "--")}</a>`;
          } else {
            contractorHtml = renderBidContractorLink(view.model, b, `${gt.id}_result_contractor_${idx}`);
          }
          if (isPhanLo) {
            return `
                            <tr>
                                <td>${escapeHtml(b.maPhanLo || "—")}</td>
                                <td>${escapeHtml(b.tenPhanLo || "—")}</td>
                                <td>${escapeHtml(formatPartnerIdentityCode(b.maNhaThau || b.maDinhDanh, "--"))}</td>
                                <td>${contractorHtml}</td>
                                <td class="fw-bold text-success">${giaTrungHtml}</td>
                                <td>${escapeHtml(thoiGianThucHienHtml)}</td>
                                <td class="bf-s-63dbf5319a">${badge}</td>
                                <td class="text-muted">${escapeHtml(lyDo)}</td>
                            </tr>
                        `;
          } else {
            return `
                            <tr>
                                <td>${escapeHtml(formatPartnerIdentityCode(b.maNhaThau || b.maDinhDanh, "--"))}</td>
                                <td>${contractorHtml}</td>
                                <td class="fw-bold text-success">${giaTrungHtml}</td>
                                <td>${escapeHtml(thoiGianThucHienHtml)}</td>
                                <td class="bf-s-63dbf5319a">${badge}</td>
                                <td class="text-muted">${escapeHtml(lyDo)}</td>
                            </tr>
                        `;
          }
        }).join("");
        let tableHeaderHtml = "";
        if (isPhanLo) {
          tableHeaderHtml = `
                        <tr>
                            <th class="bf-s-ae54075f01">Mã phần lô</th>
                            <th class="bf-s-2811ee8f01">Tên phần lô</th>
                            <th class="bf-s-ae54075f01">Mã nhà thầu</th>
                            <th class="bf-s-a01153c965">Tên nhà thầu</th>
                            <th class="bf-s-1e5172f548">Giá trị trúng thầu</th>
                            <th class="bf-s-ad8c93e5fe">Thời gian thực hiện</th>
                            <th class="bf-s-59052b934c">Trạng thái</th>
                            <th class="bf-s-ae54075f01">Lý do trượt thầu</th>
                        </tr>
                    `;
        } else {
          tableHeaderHtml = `
                        <tr>
                            <th class="bf-s-ad8c93e5fe">Mã nhà thầu</th>
                            <th class="bf-s-8fd95f72da">Tên nhà thầu</th>
                            <th class="bf-s-ad8c93e5fe">Giá trị trúng thầu</th>
                            <th class="bf-s-ad8c93e5fe">Thời gian thực hiện</th>
                            <th class="bf-s-59052b934c">Trạng thái</th>
                            <th class="bf-s-ae54075f01">Lý do trượt thầu</th>
                        </tr>
                    `;
        }
        renderAwardedResultPanel(contentWrapper, {
          pkg: gt,
          winnerHtml: winnerDisplayHtml,
          bidderRowsHtml: allBiddersHtml,
          tableHeaderHtml,
          appraisalNumber: soBctdResult,
          appraisalDate: ngayBctdResult,
          isEditable,
          wordExportEnabled: Boolean(view.model.state.activeuser?.wordExportEnabled),
          formatCurrency: (value) => view.model.formatCurrency(value),
          formatDate: (value) => view.model.formatDate(value)
        });
        bindAwardResultPanel(contentWrapper, {
          onEdit: async () => {
            await reopenPackageAwardResult(appController || view, gt);
            view.showPackageDetails(id);
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
            lotCodes: activeScopedEvaluation.lotCodes
          } : null
        });
        const { allBids, isDirectOrSpecial } = approvalPanel;
        contentWrapper.innerHTML = trustedHTML(approvalPanel.html);
        const rads = contentWrapper.querySelectorAll('input[name="result-danh-gia-nang-luc"]');
        const dgContainer = contentWrapper.querySelector("#container-date-bao-cao-danh-gia");
        rads.forEach((rad) => {
          rad.addEventListener("change", () => {
            if (dgContainer) {
              setRuntimeStyle(dgContainer, "display", rad.value === "Có" ? "block" : "none");
            }
          });
        });
        const inpThuongThao = contentWrapper.querySelector("#date-thuong-thao");
        const inpTrinhkq = contentWrapper.querySelector("#date-trinh-ket-qua");
        const inpDecDate = contentWrapper.querySelector("#award-decision-date");
        if (inpThuongThao && inpTrinhkq) {
          inpThuongThao.addEventListener("change", () => {
            inpTrinhkq.value = inpThuongThao.value;
            if (inpTrinhkq._flatpickr) inpTrinhkq._flatpickr.setDate(inpThuongThao.value);
            if (inpDecDate) {
              inpDecDate.value = inpThuongThao.value;
              if (inpDecDate._flatpickr) inpDecDate._flatpickr.setDate(inpThuongThao.value);
            }
          });
        }
        if (inpTrinhkq && inpDecDate) {
          inpTrinhkq.addEventListener("change", () => {
            inpDecDate.value = inpTrinhkq.value;
            if (inpDecDate._flatpickr) inpDecDate._flatpickr.setDate(inpTrinhkq.value);
          });
        }
        const tbodyApprove = document.getElementById("approve-bidders-tbody");
        if (tbodyApprove) {
          allBids.forEach((b) => {
            const tr = tbodyApprove.querySelector(`tr[data-approve-bid-id="${b.id}"]`);
            if (tr) {
              const jvViewData = buildAwardJointVentureViewData(view.model, b);
              tr._jointVentureViewData = jvViewData;
              tr._thanhVienLienDanh = jvViewData.members;
              tr._leadMemberName = jvViewData.leadName;
              tr._leadMemberContractorId = jvViewData.leadContractorVersionId;
            }
          });
          const initRowListeners2 = (tr) => {
            tr.querySelectorAll(".row-gia-trung").forEach((inp) => {
              bindCurrencyElement(inp, (value) => view.model.formatVND(value));
            });
            tr.querySelectorAll(".row-tg-goithau").forEach((inp) => {
              inp.addEventListener("input", (e) => {
                const inpDurationCtr = tr.querySelector(".row-tg-hopdong");
                if (inpDurationCtr) {
                  const val = e.target.value.trim();
                  inpDurationCtr.value = val ? val + " + Thời gian thực hiện các nghĩa vụ theo hợp đồng" : "";
                }
              });
            });
            const selectLoai = tr.querySelector(".row-loai-nha-thau");
            const jvContainer = tr.querySelector(".row-jv-members-container");
            if (selectLoai && jvContainer) {
              selectLoai.addEventListener("change", () => {
                setRuntimeStyle(jvContainer, "display", selectLoai.value === "Liên danh" ? "block" : "none");
              });
            }
            const btnManage = tr.querySelector(".row-btn-manage-members");
            if (btnManage) {
              btnManage.addEventListener("click", (e) => {
                e.preventDefault();
                const storedViewData = tr._jointVentureViewData || {};
                const viewData = {
                  members: storedViewData.members || tr._thanhVienLienDanh || [],
                  leadName: storedViewData.leadName || tr._leadMemberName || tr.querySelector(".row-ten-nha-thau")?.value.trim() || "",
                  leadCode: storedViewData.leadCode || tr.querySelector(".row-ma-nha-thau")?.value.trim() || "",
                  leadContractorVersionId: storedViewData.leadContractorVersionId || tr._leadMemberContractorId || ""
                };
                executeAppCommand(
                  "openMoThauJVViewModal",
                  viewData.members,
                  viewData.leadName,
                  viewData.leadCode,
                  viewData.leadContractorVersionId
                );
              });
            }
            const inputMa = tr.querySelector(".row-ma-nha-thau");
            const inputTen = tr.querySelector(".row-ten-nha-thau");
            if (inputMa && inputTen) {
              const handleCodeChange = () => {
                const code = inputMa.value.trim();
                if (!code) return;
                const latestList = view.model.getLatestNhaThau();
                const matched = latestList.find((n) => n.maNhaThau && n.maNhaThau.trim().toLowerCase() === code.toLowerCase());
                if (matched) {
                  inputTen.value = matched.tenNhaThau || "";
                }
              };
              inputMa.addEventListener("input", handleCodeChange);
              inputMa.addEventListener("change", handleCodeChange);
            }
          };
          tbodyApprove.querySelectorAll("tr").forEach(initRowListeners2);
          if (isDirectOrSpecial) {
            tbodyApprove.addEventListener("click", async (e) => {
              const btnRemove = e.target.closest(".row-remove-bidder");
              if (btnRemove) {
                const tr = btnRemove.closest("tr");
                if (tr) {
                  const confirmed = await view.customConfirm("Xác nhận xóa", "Bạn có chắc chắn muốn xóa dòng nhà thầu này?", "trash-2");
                  if (confirmed) {
                    tr.remove();
                  }
                }
              }
            });
            tbodyApprove.addEventListener("change", (e) => {
              if (e.target.classList.contains("row-ma-phan-lo")) {
                const selectEl = e.target;
                const tr = selectEl.closest("tr");
                const tenPhanLoInput = tr.querySelector(".row-ten-phan-lo");
                if (tenPhanLoInput) {
                  const selectedOption = selectEl.options[selectEl.selectedIndex];
                  const tenPhanLo = selectedOption ? selectedOption.getAttribute("data-name") : "";
                  tenPhanLoInput.value = tenPhanLo || "";
                }
              }
            });
          } else {
            tbodyApprove.querySelectorAll(".row-status-select").forEach((selectEl) => {
              selectEl.addEventListener("change", (e) => {
                const tr = e.target.closest("tr");
                const val = e.target.value;
                if (val === "trung") {
                  const currentLot = tr.cells[0]?.textContent.trim();
                  tbodyApprove.querySelectorAll("tr").forEach((otherTr) => {
                    if (otherTr !== tr) {
                      if (gt.phanLo === "Có") {
                        const otherLot = otherTr.cells[0]?.textContent.trim();
                        if (otherLot !== currentLot) return;
                      }
                      const otherSelect = otherTr.querySelector(".row-status-select");
                      if (otherSelect && !otherSelect.disabled) {
                        otherSelect.value = "truot";
                      }
                      const otherLyDo = otherTr.querySelector(".row-ly-do-truot");
                      if (otherLyDo) {
                        otherLyDo.disabled = false;
                        setRuntimeStyle(otherLyDo, "background", "");
                        if (!otherLyDo.value) {
                          otherLyDo.value = otherTr.getAttribute("data-default-reason") || "Nhà thầu xếp hạng 1 trúng thầu";
                        }
                      }
                      const otherGia = otherTr.querySelector(".row-gia-trung");
                      if (otherGia) {
                        otherGia.disabled = true;
                        setRuntimeStyle(otherGia, "background", "#f1f5f9");
                        otherGia.value = "";
                      }
                      const otherDurationPkg = otherTr.querySelector(".row-tg-goithau");
                      if (otherDurationPkg) {
                        otherDurationPkg.disabled = true;
                        setRuntimeStyle(otherDurationPkg, "background", "#f1f5f9");
                        otherDurationPkg.value = "";
                      }
                      const otherDurationCtr = otherTr.querySelector(".row-tg-hopdong");
                      if (otherDurationCtr) {
                        otherDurationCtr.disabled = true;
                        setRuntimeStyle(otherDurationCtr, "background", "#f1f5f9");
                        otherDurationCtr.value = "";
                      }
                    }
                  });
                  const inpGia = tr.querySelector(".row-gia-trung");
                  if (inpGia) {
                    inpGia.disabled = false;
                    setRuntimeStyle(inpGia, "background", "");
                    inpGia.value = tr.getAttribute("data-default-price") || "";
                  }
                  const inpDurationPkg = tr.querySelector(".row-tg-goithau");
                  if (inpDurationPkg) {
                    inpDurationPkg.disabled = false;
                    setRuntimeStyle(inpDurationPkg, "background", "");
                    inpDurationPkg.value = tr.getAttribute("data-default-duration-pkg") || "";
                  }
                  const inpDurationCtr = tr.querySelector(".row-tg-hopdong");
                  if (inpDurationCtr) {
                    inpDurationCtr.disabled = false;
                    setRuntimeStyle(inpDurationCtr, "background", "");
                    inpDurationCtr.value = tr.getAttribute("data-default-duration-ctr") || "";
                  }
                  const inpLyDo = tr.querySelector(".row-ly-do-truot");
                  if (inpLyDo) {
                    inpLyDo.disabled = true;
                    setRuntimeStyle(inpLyDo, "background", "#f1f5f9");
                    inpLyDo.value = "";
                  }
                } else {
                  const inpGia = tr.querySelector(".row-gia-trung");
                  if (inpGia) {
                    inpGia.disabled = true;
                    setRuntimeStyle(inpGia, "background", "#f1f5f9");
                    inpGia.value = "";
                  }
                  const inpDurationPkg = tr.querySelector(".row-tg-goithau");
                  if (inpDurationPkg) {
                    inpDurationPkg.disabled = true;
                    setRuntimeStyle(inpDurationPkg, "background", "#f1f5f9");
                    inpDurationPkg.value = "";
                  }
                  const inpDurationCtr = tr.querySelector(".row-tg-hopdong");
                  if (inpDurationCtr) {
                    inpDurationCtr.disabled = true;
                    setRuntimeStyle(inpDurationCtr, "background", "#f1f5f9");
                    inpDurationCtr.value = "";
                  }
                  const inpLyDo = tr.querySelector(".row-ly-do-truot");
                  if (inpLyDo) {
                    inpLyDo.disabled = false;
                    setRuntimeStyle(inpLyDo, "background", "");
                    inpLyDo.value = tr.getAttribute("data-default-reason") || "Nhà thầu xếp hạng 1 trúng thầu";
                  }
                }
              });
            });
          }
        }
        const isSpecialBiddingType = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
        const cdtrugTbody = document.getElementById("cdtrug-mothau-tbody");
        const addCdtrugRow = (bidData = {}) => {
          if (!cdtrugTbody) return;
          const rowId = bidData.id || generateRecordId("thongtinmothau");
          const hasPhanLo = gt.phanLo === "Có";
          const lotList = gt.phanLoList || [];
          const lotOptions = (Array.isArray(lotList) ? lotList : typeof lotList === "string" ? JSON.parse(lotList || "[]") : []).map((l) => `<option value="${safeAttr(l.maPhanLo)}" data-name="${safeAttr(l.tenPhanLo)}" ${bidData.maPhanLo === l.maPhanLo ? "selected" : ""}>${escapeHtml(l.maPhanLo)}</option>`).join("");
          const ntCode = bidData.maNhaThau || bidData.maDinhDanh || "";
          const ntName = bidData.tenNhaThau || "";
          const ntType = bidData.loaiNhaThau || "Độc lập";
          const tr = document.createElement("tr");
          tr.setAttribute("data-cdtrug-id", rowId);
          tr.innerHTML = trustedHTML(`
                        ${hasPhanLo ? `
                            <td><select class="form-control cdtrug-ma-phan-lo bf-s-1c5ec6d115">
                                <option value="">-- Chọn --</option>${lotOptions}
                            </select></td>
                            <td><input type="text" class="form-control cdtrug-ten-phan-lo bf-s-1c5ec6d115" value="${safeAttr(bidData.tenPhanLo || "")}" readonly placeholder="Tên lô"></td>
                        ` : ""}
                        <td><select class="form-control cdtrug-loai-nha-thau bf-s-1c5ec6d115">
                            <option value="Độc lập" ${ntType === "Độc lập" ? "selected" : ""}>Độc lập</option>
                            <option value="Liên danh" ${ntType === "Liên danh" ? "selected" : ""}>Liên danh</option>
                        </select></td>
                        <td><input type="text" class="form-control cdtrug-ma-nha-thau bf-s-1c5ec6d115" value="${safeAttr(ntCode)}" required placeholder="Mã NT"></td>
                        <td><input type="text" class="form-control cdtrug-ten-nha-thau bf-s-1c5ec6d115" value="${safeAttr(ntName)}" required placeholder="Tên nhà thầu"></td>
                        <td><input type="text" class="form-control cdtrug-gia-du-thau cdtrug-format-vnd bf-s-1c5ec6d115" value="${safeAttr(bidData.giaDuThau ? view.model.formatVND(bidData.giaDuThau) : "")}" placeholder="Giá dự thầu"></td>
                        <td><input type="text" class="form-control cdtrug-ty-le-giam-gia bf-s-f2b3f12563" value="${safeAttr(bidData.tyLeGiamGia !== void 0 ? (bidData.tyLeGiamGia || 0).toString().replace(".", ",") : "0")}"></td>
                        <td><input type="text" class="form-control cdtrug-gia-sau-giam-gia cdtrug-format-vnd bf-s-67c231a219" value="${safeAttr(bidData.giaSauGiamGia ? view.model.formatVND(bidData.giaSauGiamGia) : "")}" readonly placeholder="..."></td>
                        <td><input type="text" class="form-control cdtrug-hieu-luc-hsdt bf-s-1c5ec6d115" value="${safeAttr(bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày")}"></td>
                        <td><input type="text" class="form-control cdtrug-gia-tri-dam-bao cdtrug-format-vnd bf-s-1c5ec6d115" value="${safeAttr(bidData.giaTriDamBao ? view.model.formatVND(bidData.giaTriDamBao) : "")}" placeholder="Giá trị ĐB"></td>
                        <td><input type="text" class="form-control cdtrug-hieu-luc-bao-dam-ngay bf-s-1c5ec6d115" value="${safeAttr(bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày")}"></td>
                        <td><input type="text" class="form-control cdtrug-thoi-gian-thuc-hien bf-s-1c5ec6d115" value="${safeAttr(bidData.thoiGianThucHien || gt.thoiGianThucHien || "")}" placeholder="Thực hiện"></td>
                        <td class="bf-s-905008530c">
                            <button type="button" class="action-btn btn-delete cdtrug-remove-row" title="Xóa hàng">
                                <i data-lucide="trash-2" class="bf-s-641778be2c"></i>
                            </button>
                        </td>
                    `);
          const inpGia = tr.querySelector(".cdtrug-gia-du-thau");
          const inpTL = tr.querySelector(".cdtrug-ty-le-giam-gia");
          const inpGSG = tr.querySelector(".cdtrug-gia-sau-giam-gia");
          const calcGSG = () => {
            const g = view.model.parseVND(inpGia.value) || 0;
            const t = parseFloat((inpTL.value || "0").replace(/,/g, ".")) || 0;
            const gsg = g * (1 - t / 100);
            inpGSG.value = gsg > 0 ? view.model.formatVND(gsg) : "";
          };
          if (inpGia) inpGia.addEventListener("input", calcGSG);
          if (inpTL) inpTL.addEventListener("input", calcGSG);
          bindCurrencyElement(inpGia, (value) => view.model.formatVND(value));
          bindCurrencyElement(tr.querySelector(".cdtrug-gia-tri-dam-bao"), (value) => view.model.formatVND(value));
          [".cdtrug-gia-du-thau", ".cdtrug-gia-tri-dam-bao"].forEach((cls) => {
            const el = tr.querySelector(cls);
            if (el) el.addEventListener("blur", () => {
              el.value = view.model.formatVND(view.model.parseVND(el.value)) || "";
            });
          });
          const lotSel = tr.querySelector(".cdtrug-ma-phan-lo");
          if (lotSel) {
            lotSel.addEventListener("change", () => {
              const opt = lotSel.options[lotSel.selectedIndex];
              const tenPhanLoEl = tr.querySelector(".cdtrug-ten-phan-lo");
              if (tenPhanLoEl) tenPhanLoEl.value = opt?.getAttribute("data-name") || "";
            });
          }
          tr.querySelector(".cdtrug-remove-row").addEventListener("click", () => tr.remove());
          cdtrugTbody.appendChild(tr);
          if (window.lucide) window.lucide.createIcons({ root: tr });
        };
        if (isSpecialBiddingType && cdtrugTbody) {
          const existingBids = view.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
          if (existingBids.length > 0) {
            existingBids.forEach((b) => addCdtrugRow(b));
          } else {
            addCdtrugRow();
          }
          const btnAddCdtrug = document.getElementById("btn-cdtrug-add-bidder");
          if (btnAddCdtrug) {
            btnAddCdtrug.addEventListener("click", () => {
              addCdtrugRow();
              if (window.lucide) window.lucide.createIcons();
            });
          }
        }
        const approveBtn = document.getElementById("btn-approve-award");
        if (approveBtn) {
          approveBtn.onclick = async () => {
            if (gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
              await executeAppCommand("saveKetQuaChiDinhThau", gt.id);
              return;
            }
            const decNo = document.getElementById("award-decision-no")?.value.trim() || "";
            const decDateRaw = document.getElementById("award-decision-date")?.value || "";
            const decDate = view.model.convertDMYToYMD(decDateRaw);
            const soBctdResultVal = document.getElementById("award-so-bctd")?.value.trim() || "";
            const ngayBctdResultRaw = document.getElementById("award-ngay-bctd")?.value || "";
            const ngayBctdResultVal = view.model.convertDMYToYMD(ngayBctdResultRaw);
            let hasError = false;
            const errorInputs = [];
            const fields = [];
            if (document.getElementById("award-so-bctd")) {
              fields.push({ el: document.getElementById("award-so-bctd"), val: soBctdResultVal });
            }
            if (document.getElementById("award-ngay-bctd")) {
              fields.push({ el: document.getElementById("award-ngay-bctd"), val: ngayBctdResultRaw });
            }
            fields.push(
              { el: document.getElementById("award-decision-no"), val: decNo },
              { el: document.getElementById("award-decision-date"), val: decDateRaw }
            );
            fields.forEach((f) => {
              if (!f.val) {
                hasError = true;
                if (f.el) {
                  errorInputs.push(f.el);
                  setFieldFeedback(f.el, { state: "invalid", message: f.el.closest(".form-group")?.querySelector(".error-text")?.textContent || "" });
                  const clearInvalid = () => {
                    setFieldFeedback(f.el);
                  };
                  f.el.addEventListener("input", clearInvalid);
                  f.el.addEventListener("change", clearInvalid);
                }
              }
            });
            const winnerRows = [];
            tbodyApprove.querySelectorAll("tr").forEach((tr) => {
              const status = tr.querySelector(".row-status-select")?.value || (isDirectOrSpecial ? "trung" : "truot");
              if (status === "trung") {
                winnerRows.push(tr);
              }
            });
            winnerRows.forEach((wTr) => {
              const finalPriceRaw = wTr.querySelector(".row-gia-trung")?.value || "";
              const durPkg = wTr.querySelector(".row-tg-goithau")?.value.trim() || "";
              const durCtr = wTr.querySelector(".row-tg-hopdong")?.value.trim() || "";
              const rowInputs = [];
              if (isDirectOrSpecial) {
                rowInputs.push(
                  { el: wTr.querySelector(".row-ma-nha-thau"), val: wTr.querySelector(".row-ma-nha-thau")?.value.trim() },
                  { el: wTr.querySelector(".row-ten-nha-thau"), val: wTr.querySelector(".row-ten-nha-thau")?.value.trim() }
                );
              }
              rowInputs.push(
                { el: wTr.querySelector(".row-gia-trung"), val: finalPriceRaw },
                { el: wTr.querySelector(".row-tg-goithau"), val: durPkg },
                { el: wTr.querySelector(".row-tg-hopdong"), val: durCtr }
              );
              rowInputs.forEach((f) => {
                if (!f.val) {
                  hasError = true;
                  if (f.el) {
                    errorInputs.push(f.el);
                    setRuntimeStyle(f.el, "border", "1px solid var(--danger)");
                    const clearInvalid = () => {
                      setRuntimeStyle(f.el, "border", "");
                    };
                    f.el.addEventListener("input", clearInvalid);
                  }
                }
              });
            });
            if (hasError) {
              if (errorInputs.length > 0) {
                const first = errorInputs[0];
                view.focusInvalidControl(first);
              }
              return;
            }
            if (isDirectOrSpecial) {
              view.model.state.thongtinmothau = view.model.state.thongtinmothau.filter((b) => String(b.goiThauId) !== String(gt.id));
            }
            const resolveApprovalContractor = (tr, code, name) => {
              const boundId = tr.getAttribute("data-nt-id") || "";
              const bound = getExactContractorVersion(view.model, boundId);
              if (bound) return bound;
              return view.model.getLatestNhaThau().find(
                (n) => n.maNhaThau && code && n.maNhaThau.toLowerCase() === code.toLowerCase() || n.tenNhaThau && name && n.tenNhaThau.toLowerCase() === name.toLowerCase()
              ) || null;
            };
            const resolveResultContractorId = (versionId) => selectContractorVersionForDate(view.model, versionId, decDate)?.id || versionId || "";
            tbodyApprove.querySelectorAll("tr").forEach((tr) => {
              const bidId = tr.getAttribute("data-approve-bid-id");
              let bid = view.model.state.thongtinmothau.find((b) => b.id === bidId);
              const maNhaThau = tr.querySelector(".row-ma-nha-thau")?.value.trim() || "";
              const tenNhaThau = tr.querySelector(".row-ten-nha-thau")?.value.trim() || "";
              const giaTrungRaw = tr.querySelector(".row-gia-trung")?.value || "";
              const giaTrung = view.model.parseVND(giaTrungRaw);
              const durPkg = tr.querySelector(".row-tg-goithau")?.value.trim() || "";
              const durCtr = tr.querySelector(".row-tg-hopdong")?.value.trim() || "";
              let maPhanLo = "";
              let tenPhanLo = "";
              if (gt.phanLo === "Có") {
                maPhanLo = tr.querySelector(".row-ma-phan-lo")?.value || "";
                tenPhanLo = tr.querySelector(".row-ten-phan-lo")?.value || "";
              }
              if (isDirectOrSpecial) {
                const loaiNt = tr.querySelector(".row-loai-nha-thau")?.value || "Độc lập";
                const tvLd = tr._thanhVienLienDanh || [];
                let foundNt = resolveApprovalContractor(tr, maNhaThau, tenNhaThau);
                if (!foundNt && tenNhaThau) {
                  const newNtId = generateRecordId("nhathau");
                  foundNt = {
                    id: newNtId,
                    rootId: newNtId,
                    phienBan: "00",
                    isLatest: 1,
                    ngayApDung: decDate,
                    maNhaThau: maNhaThau || "NT-" + generateUUID().toString().substr(8),
                    tenNhaThau,
                    loaiNhaThau: loaiNt,
                    maSoThue: maNhaThau || "",
                    nguoiDaiDien: "",
                    danhXung: "Ông",
                    soDienThoai: "",
                    email: "",
                    diaChi: "",
                    soTaiKhoan: "",
                    noiMoTaiKhoan: "",
                    maNganHang: "",
                    thanhVienLienDanh: loaiNt === "Liên danh" ? tvLd.map((m) => ({
                      tenNhaThau: m.tenNhaThau,
                      maSoThue: m.maSoThue,
                      vaiTro: "Thành viên liên danh"
                    })) : []
                  };
                  view.model.state.nhathau.push(foundNt);
                }
                const nhaThauId = foundNt ? foundNt.id : bidId;
                const fullJvList = [];
                if (loaiNt === "Liên danh") {
                  fullJvList.push({
                    thanhVienNhaThauId: foundNt?.id || tr._leadMemberContractorId || "",
                    tenNhaThau: foundNt?.tenNhaThau || tr._leadMemberName || tenNhaThau,
                    maNhaThau: foundNt?.maNhaThau || maNhaThau,
                    maSoThue: foundNt?.maSoThue || maNhaThau,
                    vaiTro: "Đứng đầu liên danh"
                  });
                  tvLd.forEach((m) => {
                    fullJvList.push({
                      thanhVienNhaThauId: m.thanhVienNhaThauId || "",
                      tenNhaThau: m.tenNhaThau,
                      maNhaThau: m.maNhaThau || m.maSoThue,
                      maSoThue: m.maSoThue,
                      vaiTro: "Thành viên liên danh"
                    });
                  });
                }
                bid = {
                  id: bidId,
                  goiThauId: gt.id,
                  nhaThauId,
                  maNhaThau,
                  tenNhaThau,
                  loaiNhaThau: loaiNt,
                  thanhVienLienDanh: fullJvList,
                  giaDuThau: giaTrung || 0,
                  giaSauGiamGia: giaTrung || 0,
                  danhGiaHopLe: "Đạt",
                  danhGiaNangLuc: "Đạt",
                  danhGiaKyThuat: "Đạt",
                  danhGiaTaiChinh: "Đạt",
                  danhGiaKetLuan: "Đạt",
                  thoiGianThucHien: durPkg,
                  lyDoTruot: ""
                };
                if (gt.phanLo === "Có") {
                  bid.maPhanLo = maPhanLo;
                  bid.tenPhanLo = tenPhanLo;
                }
                view.model.state.thongtinmothau.push(bid);
              } else {
                if (bid) {
                  const status = tr.querySelector(".row-status-select")?.value || (isDirectOrSpecial ? "trung" : "truot");
                  if (status === "trung") {
                    bid.lyDoTruot = "";
                  } else {
                    bid.lyDoTruot = tr.querySelector(".row-ly-do-truot")?.value.trim() || "";
                  }
                }
              }
            });
            let winnerIdStr = "none";
            if (gt.phanLo === "Có") {
              const plList = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
              const scopedLotResults = winnerRows.map((winnerRow) => {
                const code = isDirectOrSpecial
                  ? winnerRow.querySelector(".row-ma-phan-lo")?.value || ""
                  : winnerRow.cells[0]?.textContent.trim() || "";
                const lot = plList.find((item) => String(item.maPhanLo || "") === String(code));
                let winnerId = winnerRow.getAttribute("data-nt-id");
                if (isDirectOrSpecial) {
                  const winnerCode = winnerRow.querySelector(".row-ma-nha-thau")?.value.trim() || "";
                  const winnerName = winnerRow.querySelector(".row-ten-nha-thau")?.value.trim() || "";
                  const foundWinner = resolveApprovalContractor(winnerRow, winnerCode, winnerName);
                  winnerId = foundWinner ? foundWinner.id : winnerRow.getAttribute("data-approve-bid-id");
                }
                winnerId = resolveResultContractorId(winnerId);
                return {
                  id: lot?.id || "",
                  maPhanLo: code,
                  nhaThauTrungThauId: winnerId ? isNaN(winnerId) ? winnerId : parseInt(winnerId) : "",
                  giaTrungThau: view.model.parseVND(winnerRow.querySelector(".row-gia-trung")?.value || "0"),
                  thoiGianGoiThau: winnerRow.querySelector(".row-tg-goithau")?.value.trim() || "",
                  thoiGianHopDong: winnerRow.querySelector(".row-tg-hopdong")?.value.trim() || ""
                };
              });
              const completeScope = {
                lotIds: plList.map((lot) => String(lot.id || "")).filter(Boolean),
                lotCodes: plList.map((lot) => String(lot.maPhanLo || "")).filter(Boolean)
              };
              const mergedAward = mergeScopedAwardLotResults({
                phanLoList: plList,
                scope: activeScopedEvaluation || completeScope,
                scopedLotResults
              });
              gt.phanLoList = mergedAward.phanLoList;
              gt.nhaThauTrungThauId = mergedAward.nhaThauTrungThauId;
              gt.giaTrungThau = mergedAward.giaTrungThau;
              winnerIdStr = mergedAward.nhaThauTrungThauId || "none";
              gt.thoiGianGoiThau = "";
              gt.thoiGianHopDong = "";
            } else {
              const winnerTr = winnerRows[0];
              let finalPrice = 0;
              let durPkg = "";
              let durCtr = "";
              if (winnerTr) {
                if (isDirectOrSpecial) {
                  const wMa = winnerTr.querySelector(".row-ma-nha-thau")?.value.trim() || "";
                  const wTen = winnerTr.querySelector(".row-ten-nha-thau")?.value.trim() || "";
                  const foundWinnerNt = resolveApprovalContractor(winnerTr, wMa, wTen);
                  winnerIdStr = foundWinnerNt ? foundWinnerNt.id : winnerTr.getAttribute("data-approve-bid-id");
                } else {
                  winnerIdStr = winnerTr.getAttribute("data-nt-id");
                }
                finalPrice = view.model.parseVND(winnerTr.querySelector(".row-gia-trung")?.value || "0");
                durPkg = winnerTr.querySelector(".row-tg-goithau")?.value.trim() || "";
                durCtr = winnerTr.querySelector(".row-tg-hopdong")?.value.trim() || "";
              }
              winnerIdStr = winnerIdStr === "none" ? winnerIdStr : resolveResultContractorId(winnerIdStr);
              gt.nhaThauTrungThauId = winnerIdStr === "none" ? "" : isNaN(winnerIdStr) ? winnerIdStr : parseInt(winnerIdStr);
              gt.giaTrungThau = finalPrice;
              gt.thoiGianGoiThau = winnerIdStr === "none" ? "" : durPkg;
              gt.thoiGianHopDong = winnerIdStr === "none" ? "" : durCtr;
            }
            let meta = {};
            try {
              meta = gt.danhGiaHsdtMetadata ? JSON.parse(gt.danhGiaHsdtMetadata) : {};
            } catch (e) {
            }
            let resultMetadataTarget;
            if (activeScopedEvaluation) {
              const scopedBatch = meta.lotBatches?.[activeScopedEvaluation.batchId];
              if (!scopedBatch) {
                await view.customAlert(
                  "Không thể lưu kết quả",
                  "Không tìm thấy đợt phần lô đang xử lý. Vui lòng tải lại gói thầu và thử lại.",
                  "alert-triangle"
                );
                return;
              }
              if (!scopedBatch.result || typeof scopedBatch.result !== "object") scopedBatch.result = {};
              resultMetadataTarget = scopedBatch.result;
              resultMetadataTarget.soQuyetDinhKetQua = decNo;
              resultMetadataTarget.ngayQuyetDinhKetQua = decDate;
              resultMetadataTarget.saved = true;
            } else {
              if (!meta.result) meta.result = {};
              resultMetadataTarget = meta.result;
            }
            resultMetadataTarget.soBctdKetQua = soBctdResultVal;
            resultMetadataTarget.ngayBctdKetQua = ngayBctdResultVal;
            resultMetadataTarget.contractorBindings = winnerRows.map((row) => {
              const bidId = row.getAttribute("data-approve-bid-id") || "";
              const bid = view.model.state.thongtinmothau.find((item) => String(item.id) === String(bidId));
              return {
                bidId,
                jointVentureName: bid?.loaiNhaThau === "Liên danh" ? bid.tenNhaThau || "" : "",
                contractorVersionId: resolveResultContractorId(row.getAttribute("data-nt-id") || bid?.nhaThauId || ""),
                memberVersionIds: (bid?.thanhVienLienDanh || []).map((member) => resolveResultContractorId(member.thanhVienNhaThauId)).filter(Boolean)
              };
            });
            if (activeScopedEvaluation) {
              gt.danhGiaHsdtMetadata = JSON.stringify(meta);
              const syncResult = await commitPackageAwardDecision(appController || view, {
                afterPersist: () => view.renderGoiThauTable()
              });
              if (!syncResult?.ok) return;
              await view.customAlert(
                "Đã lưu nháp kết quả đợt phần lô",
                `Đã lưu kết quả cho ${activeScopedEvaluation.lotCodes.join(", ")}. Các phần lô ngoài phạm vi được giữ nguyên.`,
                "check-circle"
              );
              const detailPackageId = selectPackageDetailTab(view, "result", gt, view.model);
              await view.showPackageDetails(detailPackageId);
              return;
            }
            const hasActualWinner = gt.phanLo === "Có" ? (typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || []).some((pl) => pl.nhaThauTrungThauId) : winnerIdStr !== "none" && !!gt.nhaThauTrungThauId;
            if (!hasActualWinner) {
              if (!meta.cancelDetails) meta.cancelDetails = {};
              meta.cancelDetails.soQuyetDinhHuyThau = decNo;
              meta.cancelDetails.ngayQuyetDinhHuyThau = decDate;
              meta.cancelDetails.lyDoHuyThau = "Tất cả các hồ sơ dự thầu không đáp ứng yêu cầu của hồ sơ mời thầu. Hủy thầu theo quy định tại Điểm a Khoản 1 Điều 17 Luật Đấu thầu số 22/2023/QH15 ngày 23 tháng 6 năm 2023, sửa đổi, bổ sung tại Luật số 57/2024/QH15, Luật số 90/2025/QH15.";
              gt.danhGiaHsdtMetadata = JSON.stringify(meta);
              clearCompetitiveQuotationAppraisal(gt);
              gt.soQuyetDinhKetQua = decNo;
              gt.ngayQuyetDinhKetQua = decDate;
              const syncResult = await commitPackageAwardDecision(appController || view, {
                afterPersist: () => view.renderGoiThauTable()
              });
              if (!syncResult?.ok) return;
              await view.customAlert("Không có nhà thầu trúng thầu", "Không có nhà thầu nào đạt yêu cầu. Hệ thống đã tự động điền các thông tin hủy thầu tương ứng và chuyển bạn sang tab Hủy thầu để xem lại hoặc điều chỉnh trước khi xác nhận hủy thầu chính thức.", "info");
              const detailPackageId = selectPackageDetailTab(view, "cancel", gt, view.model);
              await view.showPackageDetails(detailPackageId);
              return;
            }
            gt.danhGiaHsdtMetadata = JSON.stringify(meta);
            clearCompetitiveQuotationAppraisal(gt);
            gt.soQuyetDinhKetQua = decNo;
            gt.ngayQuyetDinhKetQua = decDate;
            gt.trangThai = "Đã có kết quả";
            const syncResult = await commitPackageAwardDecision(appController || view, {
              afterPersist: () => view.renderGoiThauTable()
            });
            if (!syncResult?.ok) return;
            await view.customAlert("Chúc mừng", `Đã phê duyệt kết quả trúng thầu cho gói thầu "${gt.tenGoiThau}" thành công!`, "check-circle");
            const detailPackageId = selectPackageDetailTab(view, "result", gt, view.model);
            await view.showPackageDetails(detailPackageId);
          };
        }
      }
      const resultExportBtn = document.getElementById("btn-result-export-excel-template");
      if (resultExportBtn) {
        resultExportBtn.onclick = () => {
          const safeCode = (gt.tenGoiThau || "GoiThau").replace(/[^a-zA-Z0-9]/g, "_");
          authFetchDownload(`/api/export-ketquaqd-template?package_id=${gt.id}&package_name=${encodeURIComponent(safeCode)}`, `KetQua_QD_${safeCode}.xlsx`);
        };
      }
      const resultImportBtn = document.getElementById("btn-result-import-excel");
      if (resultImportBtn) {
        resultImportBtn.onclick = () => {
          if (appController) {
            appController._currentResultPackageId = gt.id;
            appController.triggerExcelImport("ketquaqd");
          }
        };
      }
      const btnAddBidder = document.getElementById("btn-result-add-bidder");
      if (btnAddBidder) {
        btnAddBidder.onclick = () => {
          const tbody = document.getElementById("approve-bidders-tbody");
          if (!tbody) return;
          const newId = generateRecordId("thongtinmothau");
          const tr = document.createElement("tr");
          tr.setAttribute("data-approve-bid-id", newId);
          tr.setAttribute("data-is-qualified", "true");
          tr.setAttribute("data-nt-id", newId);
          let lotCells = "";
          if (gt.phanLo === "Có") {
            const lots = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
            const optionsHtml = lots.map((l) => `<option value="${safeAttr(l.maPhanLo)}" data-name="${safeAttr(l.tenPhanLo)}">${escapeHtml(l.maPhanLo)}</option>`).join("");
            const firstLotName = lots[0] ? lots[0].tenPhanLo : "";
            lotCells = `
                            <td>
                                <select class="form-control row-ma-phan-lo bf-s-3f107fe5ee">
                                    ${optionsHtml}
                                </select>
                            </td>
                            <td>
                                <input type="text" class="form-control row-ten-phan-lo bf-s-97e02f4332" value="${safeAttr(firstLotName)}" readonly>
                            </td>
                        `;
          }
          tr._thanhVienLienDanh = [];
          tr._leadMemberName = "";
          tr._jointVentureViewData = { members: [], leadName: "", leadCode: "", leadContractorVersionId: "" };
          tr.innerHTML = trustedHTML(`
                        ${lotCells}
                        <td>
                            <select class="form-control row-loai-nha-thau bf-s-3f107fe5ee">
                                <option value="Độc lập" selected>Độc lập</option>
                                <option value="Liên danh">Liên danh</option>
                            </select>
                        </td>
                        <td>
                            <input type="text" class="form-control row-ma-nha-thau bf-s-3f107fe5ee" value="" placeholder="Mã nhà thầu">
                        </td>
                        <td>
                            <input type="text" class="form-control row-ten-nha-thau bf-s-3f107fe5ee" value="" placeholder="Tên nhà thầu">
                            <div class="row-jv-members-container bf-s-e9ebaa0dab">
                                <button type="button" class="btn btn-outline btn-xs row-btn-manage-members bf-s-32804fa5c4">
                                    <i data-lucide="users" class="bf-s-38e6fd7439"></i>
                                    <span class="row-jv-btn-text">Xem thành viên liên danh (0)</span>
                                </button>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="form-control row-gia-trung bf-s-aa4eecce78" value="" placeholder="Giá trúng...">
                        </td>
                        <td>
                            <input type="text" class="form-control row-tg-goithau bf-s-aa4eecce78" value="${safeAttr(gt.thoiGianThucHien || "")}" placeholder="Thời gian gói...">
                        </td>
                        <td>
                            <input type="text" class="form-control row-tg-hopdong bf-s-aa4eecce78" value="${safeAttr(gt.thoiGianThucHien ? gt.thoiGianThucHien + " + Thời gian thực hiện các nghĩa vụ theo hợp đồng" : "")}" placeholder="Thời gian HĐ...">
                        </td>
                        <td class="bf-s-63dbf5319a">
                            <button type="button" class="action-btn btn-delete row-remove-bidder bf-s-2e8164f9a4" aria-label="Xóa nhà thầu"><i data-lucide="trash-2" class="bf-s-3e32597019"></i></button>
                        </td>
                    `);
          tbody.appendChild(tr);
          if (window.lucide) {
            window.lucide.createIcons();
          }
          initRowListeners2(tr);
        };
      }
}
