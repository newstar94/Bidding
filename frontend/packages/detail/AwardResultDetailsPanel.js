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
import { getHolidays, getLotWinnersStore } from "../../shared/runtimeState.js";
import { generateRecordId, generateUUID } from "../../shared/idUtils.js";
import { appendExportSnapshotVersion } from "../../shared/exportSnapshot.js";
import { calculateRankings } from "../../shared/BiddingCalculations.js";

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
      const soBctdResult = metadata.result.soBctdKetQua || "";
      const ngayBctdResult = metadata.result.ngayBctdKetQua || "";
      const resultBindings = new Map((metadata.result.contractorBindings || []).map((item) => [String(item.bidId || ""), item]));
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
      const allBidsForResult = view.model.state.thongtinmothau.filter(
        (b) => String(b.goiThauId) === String(gt.id) && checkBidQualified(b)
      ).map(bindResultVersion);
      const isAwarded = gt.trangThai === "Đã có kết quả";
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
        const kh2 = view.model.getLatestPlan(gt.keHoachId);
        const cdt = kh2 ? view.model.state.chudautu.find((c) => c.id === kh2.chuDauTuId) : null;
        const tenCdt = cdt ? cdt.tenChuDauTu : "Không rõ";
        const tenKhStr = kh2 ? kh2.tenKeHoach : "Không rõ";
        const allBids = view.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gt.id));
        allBids.sort((x, y) => {
          const lotX = String(x.maPhanLo || "").trim();
          const lotY = String(y.maPhanLo || "").trim();
          return lotX.localeCompare(lotY, "vi", { numeric: true });
        });
        const isDirectOrSpecial = gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
        const danhGiaNangLuc = metadata.result.danhGiaNangLuc || "Không";
        const addWorkingDays = (startDateStr, days) => {
          if (!startDateStr) return "";
          let date = new Date(startDateStr);
          if (isNaN(date.getTime())) return "";
          const holidaysData = getHolidays();
          let direction = days < 0 ? -1 : 1;
          let remainingDays = Math.abs(days);
          while (remainingDays > 0) {
            date.setDate(date.getDate() + direction);
            let dayOfWeek = date.getDay();
            let dateStr = date.toISOString().split("T")[0];
            let yearStr = String(date.getFullYear());
            let isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const yearWorkingWeekends = holidaysData[yearStr]?.working_weekends || [];
            if (isWeekend && yearWorkingWeekends.includes(dateStr)) {
              isWeekend = false;
            }
            const yearHolidays = holidaysData[yearStr]?.holidays || [];
            const isHoliday = yearHolidays.includes(dateStr);
            if (!isWeekend && !isHoliday) {
              remainingDays--;
            }
          }
          return date.toISOString().split("T")[0];
        };
        let defaultYcbgi = "";
        let defaultGbgi = "";
        let defaultBcdg = "";
        let defaultMtt = "";
        let defaultTt = "";
        let defaultTkq = "";
        let defaultPdkq = "";
        if (kh2) {
          const isPheDuyetKeHoach = kh2.pheDuyet === "Kế hoạch";
          const anchorDate = isPheDuyetKeHoach ? kh2.ngayTrinhDuToan : kh2.ngayTrinhKeHoach;
          const approvalDate = kh2.ngayPheDuyet || "";
          defaultYcbgi = addWorkingDays(anchorDate, -5);
          defaultGbgi = addWorkingDays(anchorDate, -1);
          defaultBcdg = approvalDate;
          defaultMtt = approvalDate;
          defaultTt = addWorkingDays(approvalDate, 1);
          defaultTkq = defaultTt;
          defaultPdkq = defaultTkq;
        }
        const ngayYeuCauBaoGia = metadata.result.ngayYeuCauBaoGia ? view.model.formatForDateInput(metadata.result.ngayYeuCauBaoGia) : defaultYcbgi ? view.model.formatForDateInput(defaultYcbgi) : "";
        const ngayGuiBaoGia = metadata.result.ngayGuiBaoGia ? view.model.formatForDateInput(metadata.result.ngayGuiBaoGia) : defaultGbgi ? view.model.formatForDateInput(defaultGbgi) : "";
        const ngayBaoCaoDanhGiaNhaThau = metadata.result.ngayBaoCaoDanhGiaNhaThau ? view.model.formatForDateInput(metadata.result.ngayBaoCaoDanhGiaNhaThau) : defaultBcdg ? view.model.formatForDateInput(defaultBcdg) : "";
        const ngayMoiThuongThao = metadata.result.ngayMoiThuongThao ? view.model.formatForDateInput(metadata.result.ngayMoiThuongThao) : defaultMtt ? view.model.formatForDateInput(defaultMtt) : "";
        const ngayThuongThao = metadata.result.ngayThuongThao ? view.model.formatForDateInput(metadata.result.ngayThuongThao) : defaultTt ? view.model.formatForDateInput(defaultTt) : "";
        const ngayTrinhKetQua = metadata.result.ngayTrinhKetQua ? view.model.formatForDateInput(metadata.result.ngayTrinhKetQua) : defaultTkq ? view.model.formatForDateInput(defaultTkq) : "";
        const defaultDecDate = gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : defaultPdkq ? view.model.formatForDateInput(defaultPdkq) : "";
        const { rankings, scores } = calculateRankings(gt, allBids);
        const isCombinedMethod = gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá";
        const getIsQualified = (bidItem) => {
          return checkBidQualified(bidItem);
        };
        const lots = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
        let allBiddersHtml = "";
        if (isDirectOrSpecial && allBids.length === 0) {
          allBiddersHtml = `
                        <tr>
                            <td colspan="100%" class="bf-s-31769e5aab">
                                <i data-lucide="info" class="bf-s-26c21ccd54"></i>
                                Vui lòng nhập và lưu danh sách nhà thầu tại tab "Biên bản mở thầu" trước.
                            </td>
                        </tr>
                    `;
        } else {
          allBiddersHtml = allBids.map((b, idx) => {
            const isQualified = getIsQualified(b);
            let defaultReason = "";
            if (gt.quyTrinhDanhGia === "quytrinh2" && b.danhGiaKetLuan === "Không đánh giá") {
              defaultReason = "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu";
            } else if (!isQualified) {
              const hl = String(b.danhGiaHopLe || "").trim().toLowerCase();
              const nl = String(b.danhGiaNangLuc || "").trim().toLowerCase();
              if (hl !== "đạt") {
                defaultReason = "Không đạt yêu cầu về tính hợp lệ";
              } else if (nl !== "đạt") {
                defaultReason = "Không đạt yêu cầu về năng lực, kinh nghiệm";
              } else {
                defaultReason = "Không đạt yêu cầu kỹ thuật";
              }
            } else {
              defaultReason = "Nhà thầu xếp hạng 1 trúng thầu";
            }
            const standardReasons = [
              "Không đạt yêu cầu về tính hợp lệ",
              "Không đạt yêu cầu về năng lực, kinh nghiệm",
              "Không đạt yêu cầu kỹ thuật",
              "Nhà thầu xếp hạng 1 trúng thầu",
              "Đánh giá theo quy trình 2. Nhà thầu giá thấp hơn trúng thầu",
              ""
            ];
            const isStaleOrEmpty = !b.lyDoTruot || standardReasons.includes(b.lyDoTruot.trim());
            const displayReason = isStaleOrEmpty ? defaultReason : b.lyDoTruot;
            const defaultPrice = view.model.formatVND(b.giaSauGiamGia || b.giaDuThau || "") || "";
            const defaultDurationPkg = b.thoiGianThucHien || gt.thoiGianThucHien || "";
            const defaultDurationCtr = b.thoiGianThucHienHopDong || (defaultDurationPkg ? defaultDurationPkg + " + Thời gian thực hiện các nghĩa vụ theo hợp đồng" : "");
            const rank = rankings[b.id];
            const score = scores[b.id];
            const rankDisplay = rank ? `Xếp hạng ${rank}` : isQualified ? "--" : "Không xếp hạng";
            let isRowWinner = false;
            if (isDirectOrSpecial) {
              isRowWinner = true;
            } else if (isQualified) {
              if (gt.phanLo === "Có") {
                const plList = lots;
                const currentLotCode = b.maPhanLo;
                const pl = plList.find((p) => p.maPhanLo === currentLotCode);
                if (pl && pl.nhaThauTrungThauId) {
                  isRowWinner = String(pl.nhaThauTrungThauId) === String(b.nhaThauId || b.id);
                } else {
                  isRowWinner = rank === 1;
                }
              } else {
                if (gt.nhaThauTrungThauId) {
                  isRowWinner = String(gt.nhaThauTrungThauId) === String(b.nhaThauId || b.id);
                } else {
                  isRowWinner = rank === 1;
                }
              }
            }
            return `
                            <tr data-approve-bid-id="${safeAttr(b.id)}" data-is-qualified="${isQualified}" data-nt-id="${safeAttr(b.nhaThauId || b.id)}"
                                data-default-price="${safeAttr(defaultPrice)}" data-default-duration-pkg="${safeAttr(defaultDurationPkg)}" data-default-duration-ctr="${safeAttr(defaultDurationCtr)}"
                                data-default-reason="${safeAttr(defaultReason)}">
                                ${gt.phanLo === "Có" ? `
                                    <td>
                                        ${escapeHtml(b.maPhanLo || "--")}
                                    </td>
                                    <td>
                                        ${escapeHtml(b.tenPhanLo || "--")}
                                    </td>
                                ` : ""}
                                ${isDirectOrSpecial ? `
                                     <td>
                                         ${escapeHtml(b.loaiNhaThau || "Độc lập")}
                                     </td>
                                 ` : ""}
                                <td>
                                ${escapeHtml(formatPartnerIdentityCode(b.maNhaThau || b.maDinhDanh, "--"))}
                                </td>
                                <td>
                                    ${escapeHtml(b.tenNhaThau || "--")}
                                    ${b.loaiNhaThau === "Liên danh" ? `
                                         <div class="row-jv-members-container bf-s-597bc8fb90">
                                              <button type="button" class="btn btn-outline btn-xs row-btn-manage-members bf-s-b87f5b7f7c">
                                                  <i data-lucide="users" class="bf-s-38e6fd7439"></i>
                                                  <span class="row-jv-btn-text">Xem thành viên liên danh (${(b.thanhVienLienDanh || []).filter((m) => m.vaiTro !== "Đứng đầu liên danh" && m.maSoThue !== b.maNhaThau).length})</span>
                                              </button>
                                         </div>
                                    ` : ""}
                                </td>
                                ${isCombinedMethod ? `
                                    <td class="bf-s-1742e3af74">${score !== void 0 && score !== null && !isNaN(score) && score > 0 ? score.toFixed(2) : "--"}</td>
                                ` : ""}
                                ${!isDirectOrSpecial ? `
                                    <td class="bf-s-81cfd3850c">${escapeHtml(rankDisplay)}</td>
                                    <td>
                                        <select class="form-control row-status-select bf-s-707df30c7a" ${!isQualified ? "disabled" : ""}>
                                            <option value="truot" ${!isRowWinner ? "selected" : ""}>Trượt thầu</option>
                                            ${isQualified ? `<option value="trung" ${isRowWinner ? "selected" : ""}>Trúng thầu</option>` : ""}
                                        </select>
                                    </td>
                                    <td>
                                        <input type="text" class="form-control row-ly-do-truot bf-s-aa4eecce78" value="${safeAttr(!isRowWinner ? displayReason : "")}" placeholder="Lý do trượt..." ${isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                    </td>
                                ` : ""}
                                <td>
                                    <input type="text" class="form-control row-gia-trung bf-s-aa4eecce78" value="${safeAttr(isRowWinner ? defaultPrice : "")}" placeholder="Giá trúng..." ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-goithau bf-s-aa4eecce78" value="${safeAttr(isRowWinner ? defaultDurationPkg : "")}" placeholder="Thời gian gói..." ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-hopdong bf-s-aa4eecce78" value="${safeAttr(isRowWinner ? defaultDurationCtr : "")}" placeholder="Thời gian HĐ..." ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                            </tr>
                        `;
          }).join("");
        }
        contentWrapper.innerHTML = `
                    <div class="bf-s-8bd3eb473c">
                        <div class="bf-s-5d398becec">Thông số Gói thầu</div>
                        <div class="bf-s-13b5590e90">
                            <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${escapeHtml(tenCdt)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${escapeHtml(tenKhStr)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${escapeHtml(gt.linhVuc || "Hàng hóa")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${escapeHtml(gt.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${gt.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${view.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${escapeHtml(gt.hinhThucLuaChon || "--")}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${escapeHtml(gt.phuongPhapDanhGia)}${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat ? ` (${escapeHtml(gt.trongSoKyThuat)}%)` : ""}</div>` : ""}
                            <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${escapeHtml(gt.loaiHopDong || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${escapeHtml(gt.thoiGianThucHien || "--")}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${escapeHtml(gt.nguonVon || "--")}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? view.model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
                            <div>• <strong class="bf-s-fcb5ddef65">${is1G2T2 ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong> ${gt.thoiGianMoThau ? view.model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</div>
                            ${is1G2T2 ? `<div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong> ${gt.thoiGianMoEhsdxtc ? view.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : "Chưa mở"}</div>` : ""}
                            ` : ""}
                        </div>
                    </div>

                    <div class="bf-s-95b5643dd9">
                        <div>
                            <h4 class="bf-s-ff3bca23d8">
                                Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)
                            </h4>
                            <p class="text-muted bf-s-2089b6623a">
                                ${gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt" ? "Kiểm tra danh sách nhà thầu trúng thầu, điền QĐ phê duyệt và nhấn Phê duyệt &amp; Hoàn thành LCNT." : "Vui lòng nhập QĐ phê duyệt và chọn kết quả trúng thầu/trượt thầu cho từng nhà thầu bên dưới."}
                            </p>
                        </div>
                        <div class="bf-s-c896deef0d">
                            ${!isDirectOrSpecial ? `
                                <button class="btn-excel-action btn-sm bf-s-5a83b4877e" id="btn-result-export-excel-template">
                                    <i data-lucide="download"></i> Tải Excel Mẫu
                                </button>
                                <button class="btn-excel-action btn-sm bf-s-5a83b4877e" id="btn-result-import-excel">
                                    <i data-lucide="upload"></i> Nhập từ Excel
                                </button>
                            ` : ""}
                        </div>
                    </div>

                    ${isDirectOrSpecial ? `
                    <div class="bf-s-203e309e90">
                        <div class="bf-s-c9a9faa1a8">
                            <i data-lucide="check-circle" class="bf-s-c1f1f4a417"></i> Quyết định phê duyệt:
                        </div>
                        <div class="bf-s-342dc0e30b">
                            <div class="form-group bf-s-7f27e3bd8d">
                                <input type="text" id="award-decision-no" class="form-control bf-s-b3e44dc6d9" value="${safeAttr(gt.soQuyetDinhKetQua || "")}" placeholder="Số QĐ phê duyệt *">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group bf-s-7f27e3bd8d">
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date bf-s-b3e44dc6d9" value="${safeAttr(gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : defaultDecDate ? defaultDecDate : "")}" placeholder="Ngày ký QĐ * (dd/MM/yyyy)">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>

                    <div class="bf-s-c12ee1fe89">
                        <div class="bf-s-72451a63ba">
                            <span class="bf-s-ae2dc20bdc">
                                <i data-lucide="shield-check" class="bf-s-c1f1f4a417"></i> Đánh giá năng lực nhà thầu:
                            </span>
                            <label class="bf-s-95a4734e91">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Có" ${danhGiaNangLuc === "Có" ? "checked" : ""}> Có
                            </label>
                            <label class="bf-s-95a4734e91">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Không" ${danhGiaNangLuc === "Không" ? "checked" : ""}> Không
                            </label>
                        </div>

                        <div id="result-dates-grid" class="bf-s-d131bccf20">
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày yêu cầu báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-yeu-cau-bao-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayYeuCauBaoGia)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày yêu cầu báo giá!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày gửi báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-gui-bao-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayGuiBaoGia)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày gửi báo giá!</span>
                            </div>
                            <div class="form-group" id="container-date-bao-cao-danh-gia" style="margin-bottom: 0; display: ${danhGiaNangLuc === "Có" ? "block" : "none"};">
                                <label class="compact-field-label">Ngày báo cáo đánh giá nhà thầu <span class="text-danger">*</span></label>
                                <input type="text" id="date-bao-cao-danh-gia" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayBaoCaoDanhGiaNhaThau)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày báo cáo đánh giá nhà thầu!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày mời thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-moi-thuong-thao" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayMoiThuongThao)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày mời thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-thuong-thao" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayThuongThao)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày trình kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="date-trinh-ket-qua" class="form-control flatpickr-date bf-s-64f2570670" value="${safeAttr(ngayTrinhKetQua)}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-xs">Vui lòng nhập Ngày trình kết quả!</span>
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div class="bf-s-098565a16e">
                        <div class="bf-s-5d398becec">Quyết định phê duyệt Kết quả LCNT</div>
                        <div class="bf-s-ed07f78f34">
                            ${gt.hinhThucLuaChon !== "Chào hàng cạnh tranh" ? `
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-so-bctd" class="form-control bf-s-20e5983dc7" value="${safeAttr(soBctdResult)}" placeholder="Nhập số báo cáo thẩm định...">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số BCTĐ kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-ngay-bctd" class="form-control flatpickr-date bf-s-20e5983dc7" value="${safeAttr(ngayBctdResult ? view.model.formatForDateInput(ngayBctdResult) : "")}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày BCTĐ kết quả!</span>
                            </div>
                            ` : ""}
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control bf-s-20e5983dc7" value="${safeAttr(gt.soQuyetDinhKetQua || "")}" placeholder="Số QĐ Kết quả...">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày ký QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date bf-s-20e5983dc7" value="${safeAttr(gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : "")}" placeholder="dd/MM/yyyy">
                                <span class="error-text bf-s-65d1f1c3d7" class="field-error field-error-sm">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>
                    `}

                    <div class="bf-s-dd5fcc126c">
                        <h5 class="bf-s-a3c20b1dcc">
                            <i data-lucide="list"></i> ${isDirectOrSpecial ? "Danh sách nhà thầu trúng thầu" : "Danh sách nhà thầu tham dự &amp; Kết quả LCNT"}
                        </h5>
                    </div>

                    <div class="table-container bf-s-674afada30">
                        <table class="data-table bf-s-448ca2b6ae">
                            <thead>
                                <tr>
                                    ${gt.phanLo === "Có" ? `
                                        <th class="bf-s-ae54075f01">Mã phần lô</th>
                                        <th class="bf-s-ae54075f01">Tên phần lô</th>
                                    ` : ""}
                                    ${isDirectOrSpecial ? `<th class="bf-s-2811ee8f01">Loại nhà thầu</th>` : ""}
                                    <th class="bf-s-2811ee8f01">Mã nhà thầu</th>
                                    <th class="bf-s-a01153c965">Tên nhà thầu</th>
                                    ${isCombinedMethod ? `
                                        <th class="bf-s-59052b934c">Điểm tổng hợp</th>
                                    ` : ""}
                                    ${!isDirectOrSpecial ? `
                                        <th class="bf-s-59052b934c">Xếp hạng nhà thầu</th>
                                        <th class="bf-s-ae54075f01">Trúng thầu/trượt thầu</th>
                                        <th class="bf-s-c83ebbe56b">Lý do trượt</th>
                                    ` : ""}
                                    <th class="bf-s-2811ee8f01">Giá trúng thầu</th>
                                    <th class="bf-s-c83ebbe56b">Thời gian thực hiện gói thầu</th>
                                    <th class="bf-s-fa210469db">Thời gian thực hiện hợp đồng</th>
                                </tr>
                            </thead>
                            <tbody id="approve-bidders-tbody">
                                ${allBiddersHtml}
                            </tbody>
                        </table>
                    </div>

                    <div class="bf-s-004d08f0e5">
                        <button class="btn btn-primary bf-s-a9f6996ecf" id="btn-approve-award">
                            <i data-lucide="check-circle2"></i> Phê duyệt & Hoàn thành LCNT
                        </button>
                    </div>
                `;
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
          tr.innerHTML = `
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
                    `;
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
                  giaDuThau: giaTrung || gt.giaGoiThau,
                  giaSauGiamGia: giaTrung || gt.giaGoiThau,
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
            let hasWinner = winnerRows.length > 0;
            let winnerIdStr = "none";
            if (gt.phanLo === "Có") {
              const plList = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
              plList.forEach((pl) => {
                const lotWinnerTr = winnerRows.find((tr) => {
                  if (isDirectOrSpecial) {
                    return tr.querySelector(".row-ma-phan-lo")?.value === pl.maPhanLo;
                  } else {
                    return tr.cells[0]?.textContent.trim() === pl.maPhanLo;
                  }
                });
                if (lotWinnerTr) {
                  let wId = lotWinnerTr.getAttribute("data-nt-id");
                  if (isDirectOrSpecial) {
                    const wMa = lotWinnerTr.querySelector(".row-ma-nha-thau")?.value.trim() || "";
                    const wTen = lotWinnerTr.querySelector(".row-ten-nha-thau")?.value.trim() || "";
                    const foundWinnerNt = resolveApprovalContractor(lotWinnerTr, wMa, wTen);
                    wId = foundWinnerNt ? foundWinnerNt.id : lotWinnerTr.getAttribute("data-approve-bid-id");
                  }
                  wId = resolveResultContractorId(wId);
                  pl.nhaThauTrungThauId = wId ? isNaN(wId) ? wId : parseInt(wId) : "";
                  pl.giaTrungThau = view.model.parseVND(lotWinnerTr.querySelector(".row-gia-trung")?.value || "0");
                  pl.thoiGianGoiThau = lotWinnerTr.querySelector(".row-tg-goithau")?.value.trim() || "";
                  pl.thoiGianHopDong = lotWinnerTr.querySelector(".row-tg-hopdong")?.value.trim() || "";
                } else {
                  pl.nhaThauTrungThauId = "";
                  pl.giaTrungThau = 0;
                  pl.thoiGianGoiThau = "";
                  pl.thoiGianHopDong = "";
                }
              });
              gt.phanLoList = plList;
              const firstWinner = winnerRows[0];
              if (firstWinner) {
                let wId = firstWinner.getAttribute("data-nt-id");
                if (isDirectOrSpecial) {
                  const wMa = firstWinner.querySelector(".row-ma-nha-thau")?.value.trim() || "";
                  const wTen = firstWinner.querySelector(".row-ten-nha-thau")?.value.trim() || "";
                  const foundWinnerNt = resolveApprovalContractor(firstWinner, wMa, wTen);
                  wId = foundWinnerNt ? foundWinnerNt.id : firstWinner.getAttribute("data-approve-bid-id");
                }
                wId = resolveResultContractorId(wId);
                gt.nhaThauTrungThauId = wId ? isNaN(wId) ? wId : parseInt(wId) : "";
                gt.giaTrungThau = view.model.sumVND(winnerRows.map((tr) => tr.querySelector(".row-gia-trung")?.value || "0"));
                winnerIdStr = wId || "none";
              } else {
                gt.nhaThauTrungThauId = "";
                gt.giaTrungThau = 0;
              }
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
            if (!meta.result) meta.result = {};
            meta.result.soBctdKetQua = soBctdResultVal;
            meta.result.ngayBctdKetQua = ngayBctdResultVal;
            meta.result.contractorBindings = winnerRows.map((row) => {
              const bidId = row.getAttribute("data-approve-bid-id") || "";
              const bid = view.model.state.thongtinmothau.find((item) => String(item.id) === String(bidId));
              return {
                bidId,
                jointVentureName: bid?.loaiNhaThau === "Liên danh" ? bid.tenNhaThau || "" : "",
                contractorVersionId: resolveResultContractorId(row.getAttribute("data-nt-id") || bid?.nhaThauId || ""),
                memberVersionIds: (bid?.thanhVienLienDanh || []).map((member) => resolveResultContractorId(member.thanhVienNhaThauId)).filter(Boolean)
              };
            });
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
              await commitPackageAwardDecision(appController || view, {
                afterPersist: () => view.renderGoiThauTable()
              });
              view._currentWorkflowTab = "cancel";
              await view.customAlert("Không có nhà thầu trúng thầu", "Không có nhà thầu nào đạt yêu cầu. Hệ thống đã tự động điền các thông tin hủy thầu tương ứng và chuyển bạn sang tab Hủy thầu để xem lại hoặc điều chỉnh trước khi xác nhận hủy thầu chính thức.", "info");
              view.showPackageDetails(gt.id);
              return;
            }
            gt.danhGiaHsdtMetadata = JSON.stringify(meta);
            clearCompetitiveQuotationAppraisal(gt);
            gt.soQuyetDinhKetQua = decNo;
            gt.ngayQuyetDinhKetQua = decDate;
            gt.trangThai = "Đã có kết quả";
            await commitPackageAwardDecision(appController || view, {
              afterPersist: () => view.renderGoiThauTable()
            });
            await view.customAlert("Chúc mừng", `Đã phê duyệt kết quả trúng thầu cho gói thầu "${gt.tenGoiThau}" thành công!`, "check-circle");
            view.showPackageDetails(id);
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
          tr.innerHTML = `
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
                            <button class="action-btn btn-delete row-remove-bidder bf-s-2e8164f9a4"><i data-lucide="trash-2" class="bf-s-3e32597019"></i></button>
                        </td>
                    `;
          tbody.appendChild(tr);
          if (window.lucide) {
            window.lucide.createIcons();
          }
          initRowListeners2(tr);
        };
      }
}
