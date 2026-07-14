import { authFetchDownload } from "../../shared/view_helpers.js";
import { bindCurrencyElement } from "../../app/domUtils.js";
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
                        <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                            <a href="#" data-bf-action="show-lot-winners" data-id="${gt.id}" class="link-hover" style="color:var(--primary); text-decoration: none;" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a>
                        </h5>
                    `;
        } else {
          const finalWinnerId = uniqueWinnerIds.length === 1 ? uniqueWinnerIds[0] : gt.nhaThauTrungThauId || (winnerBid ? winnerBid.nhaThauId || winnerBid.id : null);
          const currentWinnerBid = allBidsForResult.find((b) => String(b.nhaThauId) === String(finalWinnerId)) || winnerBid;
          if (currentWinnerBid) {
            if (currentWinnerBid.loaiNhaThau === "Liên danh") {
              setJvData(gt.id, buildAwardJointVentureViewData(view.model, currentWinnerBid));
              winnerDisplayHtml = `
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                        <a href="#" data-bf-action="show-jv" data-id="${gt.id}" class="link-hover" title="Xem chi tiết liên danh" style="color:var(--primary);">👥 ${resolveBidContractorName(view.model, currentWinnerBid)}</a>
                                    </h5>
                                </div>
                            `;
            } else {
              const winnerNt = view.model.state.nhathau.find((n) => String(n.id) === String(currentWinnerBid.nhaThauId));
              const winnerMst = winnerNt ? winnerNt.maSoThue || winnerNt.maNhaThau : currentWinnerBid.maDinhDanh || currentWinnerBid.maNhaThau;
              winnerDisplayHtml = `
                                <h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">
                                    <a href="#" data-bf-action="show-contractor" data-id="${currentWinnerBid.nhaThauId}" class="link-hover" style="color:var(--primary);">${resolveBidContractorName(view.model, currentWinnerBid)}</a>
                                </h5>
                                <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                                    MST: <strong>${winnerMst || "Chưa có"}</strong>
                                </div>
                            `;
            }
          } else {
            winnerDisplayHtml = `<h5 style="margin:4px 0 0; font-size:1.1rem; font-weight:800; color:var(--primary);">Chưa xác định</h5>`;
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
          const badge = bidIsWinner ? `<span class="badge badge-success" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(16, 185, 129, 0.08); color: #059669; border: 1px solid rgba(16, 185, 129, 0.25);">Trúng thầu</span>` : `<span class="badge badge-danger" style="font-size:0.75rem; padding: 4px 10px; background-color: rgba(239,68,68,0.08); color: #dc2626; border: 1px solid rgba(239,68,68,0.25);">Trượt thầu</span>`;
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
            contractorHtml = `<a href="#" data-bf-action="show-jv" data-id="${jvKey}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${b.tenNhaThau || "--"}</a>`;
          } else {
            contractorHtml = renderBidContractorLink(view.model, b, `${gt.id}_result_contractor_${idx}`);
          }
          if (isPhanLo) {
            return `
                            <tr>
                                <td>${b.maPhanLo || "—"}</td>
                                <td>${b.tenPhanLo || "—"}</td>
                                <td>${b.maNhaThau || b.maDinhDanh || "--"}</td>
                                <td>${contractorHtml}</td>
                                <td class="fw-bold text-success">${giaTrungHtml}</td>
                                <td>${thoiGianThucHienHtml}</td>
                                <td style="text-align: center;">${badge}</td>
                                <td class="text-muted">${lyDo}</td>
                            </tr>
                        `;
          } else {
            return `
                            <tr>
                                <td>${b.maNhaThau || b.maDinhDanh || "--"}</td>
                                <td>${contractorHtml}</td>
                                <td class="fw-bold text-success">${giaTrungHtml}</td>
                                <td>${thoiGianThucHienHtml}</td>
                                <td style="text-align: center;">${badge}</td>
                                <td class="text-muted">${lyDo}</td>
                            </tr>
                        `;
          }
        }).join("");
        let tableHeaderHtml = "";
        if (isPhanLo) {
          tableHeaderHtml = `
                        <tr>
                            <th style="width: 10%;">Mã phần lô</th>
                            <th style="width: 12%;">Tên phần lô</th>
                            <th style="width: 10%;">Mã nhà thầu</th>
                            <th style="width: 20%;">Tên nhà thầu</th>
                            <th style="width: 13%;">Giá trị trúng thầu</th>
                            <th style="width: 15%;">Thời gian thực hiện</th>
                            <th style="width: 10%; text-align: center;">Trạng thái</th>
                            <th style="width: 10%;">Lý do trượt thầu</th>
                        </tr>
                    `;
        } else {
          tableHeaderHtml = `
                        <tr>
                            <th style="width: 15%;">Mã nhà thầu</th>
                            <th style="width: 35%;">Tên nhà thầu</th>
                            <th style="width: 15%;">Giá trị trúng thầu</th>
                            <th style="width: 15%;">Thời gian thực hiện</th>
                            <th style="width: 10%; text-align: center;">Trạng thái</th>
                            <th style="width: 10%;">Lý do trượt thầu</th>
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
        const { rankings, scores } = appController.calculateRankings(gt, allBids);
        const isCombinedMethod = gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá";
        const getIsQualified = (bidItem) => {
          return checkBidQualified(bidItem);
        };
        const lots = typeof gt.phanLoList === "string" ? JSON.parse(gt.phanLoList || "[]") : gt.phanLoList || [];
        let allBiddersHtml = "";
        if (isDirectOrSpecial && allBids.length === 0) {
          allBiddersHtml = `
                        <tr>
                            <td colspan="100%" style="text-align: center; padding: 24px; color: var(--danger); font-weight: 600;">
                                <i data-lucide="info" style="width: 18px; height: 18px; display: inline-block; vertical-align: middle; margin-right: 6px;"></i>
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
                            <tr data-approve-bid-id="${b.id}" data-is-qualified="${isQualified}" data-nt-id="${b.nhaThauId || b.id}"
                                data-default-price="${defaultPrice}" data-default-duration-pkg="${defaultDurationPkg}" data-default-duration-ctr="${defaultDurationCtr}"
                                data-default-reason="${defaultReason}">
                                ${gt.phanLo === "Có" ? `
                                    <td>
                                        ${b.maPhanLo || "--"}
                                    </td>
                                    <td>
                                        ${b.tenPhanLo || "--"}
                                    </td>
                                ` : ""}
                                ${isDirectOrSpecial ? `
                                     <td>
                                         ${b.loaiNhaThau || "Độc lập"}
                                     </td>
                                 ` : ""}
                                <td>
                                ${b.maNhaThau || b.maDinhDanh || "--"}
                                </td>
                                <td>
                                    ${b.tenNhaThau || "--"}
                                    ${b.loaiNhaThau === "Liên danh" ? `
                                         <div class="row-jv-members-container" style="margin-top: 4px;">
                                              <button type="button" class="btn btn-outline btn-xs row-btn-manage-members" style="padding: 2px 6px; font-size: 0.72rem; font-weight: 700; border-style: dashed; display: inline-flex; align-items: center; gap: 4px; color: var(--primary); border-color: var(--primary-soft);">
                                                  <i data-lucide="users" style="width: 12px; height: 12px;"></i>
                                                  <span class="row-jv-btn-text">Xem thành viên liên danh (${(b.thanhVienLienDanh || []).filter((m) => m.vaiTro !== "Đứng đầu liên danh" && m.maSoThue !== b.maNhaThau).length})</span>
                                              </button>
                                         </div>
                                    ` : ""}
                                </td>
                                ${isCombinedMethod ? `
                                    <td style="text-align: center; color: var(--primary);">${score !== void 0 && score !== null && !isNaN(score) && score > 0 ? score.toFixed(2) : "--"}</td>
                                ` : ""}
                                ${!isDirectOrSpecial ? `
                                    <td style="text-align: center; font-weight: bold; color: var(--primary);">${rankDisplay}</td>
                                    <td>
                                        <select class="form-control row-status-select" style="padding:4px 8px; font-size:0.8rem; font-weight:600;" ${!isQualified ? "disabled" : ""}>
                                            <option value="truot" ${!isRowWinner ? "selected" : ""}>Trượt thầu</option>
                                            ${isQualified ? `<option value="trung" ${isRowWinner ? "selected" : ""}>Trúng thầu</option>` : ""}
                                        </select>
                                    </td>
                                    <td>
                                        <input type="text" class="form-control row-ly-do-truot" value="${!isRowWinner ? displayReason : ""}" placeholder="Lý do trượt..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                    </td>
                                ` : ""}
                                <td>
                                    <input type="text" class="form-control row-gia-trung" value="${isRowWinner ? defaultPrice : ""}" placeholder="Giá trúng..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-goithau" value="${isRowWinner ? defaultDurationPkg : ""}" placeholder="Thời gian gói..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                                <td>
                                    <input type="text" class="form-control row-tg-hopdong" value="${isRowWinner ? defaultDurationCtr : ""}" placeholder="Thời gian HĐ..." style="padding:4px 8px; font-size:0.8rem; width:100%;" ${!isRowWinner ? 'disabled style="background:#f1f5f9;"' : ""}>
                                </td>
                            </tr>
                        `;
          }).join("");
        }
        contentWrapper.innerHTML = `
                    <div style="padding: 12px 16px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: var(--radius-md); font-size: 0.85rem; color: var(--text-main); line-height: 1.6; margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem;">
                            <div>• <strong style="color: var(--primary);">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdt}</span></div>
                            <div>• <strong style="color: var(--primary);">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${tenKhStr}</span></div>
                            <div>• <strong style="color: var(--primary);">Lĩnh vực:</strong> ${gt.linhVuc || "Hàng hóa"}</div>
                            <div>• <strong style="color: var(--primary);">Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ"}</div>
                            <div>• <strong style="color: var(--primary);">Phân lô:</strong> ${gt.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
                            <div>• <strong style="color: var(--primary);">Giá gói thầu:</strong> <span class="text-dark fw-bold">${view.model.formatCurrency(gt.giaGoiThau)}</span></div>
                            <div>• <strong style="color: var(--primary);">Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || "--"}</div>
                            ${gt.phuongPhapDanhGia ? `<div>• <strong style="color: var(--primary);">Phương pháp đánh giá:</strong> ${gt.phuongPhapDanhGia}${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat ? ` (${gt.trongSoKyThuat}%)` : ""}</div>` : ""}
                            <div>• <strong style="color: var(--primary);">Loại hợp đồng:</strong> ${gt.loaiHopDong || "--"}</div>
                            <div>• <strong style="color: var(--primary);">Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || "--"}</div>
                            <div>• <strong style="color: var(--primary);">Nguồn vốn:</strong> ${gt.nguonVon || "--"}</div>
                            ${!isDirectOrSpecial ? `
                            <div>• <strong style="color: var(--primary);">Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? view.model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
                            <div>• <strong style="color: var(--primary);">${is1G2T2 ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong> ${gt.thoiGianMoThau ? view.model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</div>
                            ${is1G2T2 ? `<div>• <strong style="color: var(--primary);">Thời gian mở E-HSĐXTC:</strong> ${gt.thoiGianMoEhsdxtc ? view.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : "Chưa mở"}</div>` : ""}
                            ` : ""}
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin: 0;">
                                Phê duyệt kết quả Lựa chọn Nhà thầu (LCNT)
                            </h4>
                            <p class="text-muted" style="font-size:0.82rem; margin: 4px 0 0 0;">
                                ${gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt" ? "Kiểm tra danh sách nhà thầu trúng thầu, điền QĐ phê duyệt và nhấn Phê duyệt &amp; Hoàn thành LCNT." : "Vui lòng nhập QĐ phê duyệt và chọn kết quả trúng thầu/trượt thầu cho từng nhà thầu bên dưới."}
                            </p>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            ${!isDirectOrSpecial ? `
                                <button class="btn-excel-action btn-sm" id="btn-result-export-excel-template" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; height: 32px;">
                                    <i data-lucide="download"></i> Tải Excel Mẫu
                                </button>
                                <button class="btn-excel-action btn-sm" id="btn-result-import-excel" style="padding: 6px 12px; font-size: 0.82rem; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; height: 32px;">
                                    <i data-lucide="upload"></i> Nhập từ Excel
                                </button>
                            ` : ""}
                        </div>
                    </div>

                    ${isDirectOrSpecial ? `
                    <div style="background: var(--neutral-soft); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
                        <div style="font-weight: 700; color: var(--primary); font-size: 0.85rem; min-width: 140px; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="check-circle" style="width: 16px; height: 16px;"></i> Quyết định phê duyệt:
                        </div>
                        <div style="display: flex; gap: 16px; flex-grow: 1; flex-wrap: wrap;">
                            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
                                <input type="text" id="award-decision-no" class="form-control" value="${gt.soQuyetDinhKetQua || ""}" placeholder="Số QĐ phê duyệt *" style="width: 100%; height: 36px; font-size: 0.85rem;">
                                <span class="error-text" class="field-error field-error-sm" style="display: none;">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group" style="margin-bottom: 0; flex: 1; min-width: 200px;">
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date" value="${gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : defaultDecDate ? defaultDecDate : ""}" style="width: 100%; height: 36px; font-size: 0.85rem;" placeholder="Ngày ký QĐ * (dd/MM/yyyy)">
                                <span class="error-text" class="field-error field-error-sm" style="display: none;">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>

                    <div style="background: var(--neutral-soft); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 16px;">
                        <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 12px; flex-wrap: wrap;">
                            <span style="font-weight: 700; color: var(--primary); font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                                <i data-lucide="shield-check" style="width: 16px; height: 16px;"></i> Đánh giá năng lực nhà thầu:
                            </span>
                            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.85rem; cursor: pointer; margin-bottom: 0;">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Có" ${danhGiaNangLuc === "Có" ? "checked" : ""}> Có
                            </label>
                            <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.85rem; cursor: pointer; margin-bottom: 0;">
                                <input type="radio" name="result-danh-gia-nang-luc" value="Không" ${danhGiaNangLuc === "Không" ? "checked" : ""}> Không
                            </label>
                        </div>

                        <div id="result-dates-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày yêu cầu báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-yeu-cau-bao-gia" class="form-control flatpickr-date" value="${ngayYeuCauBaoGia}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" class="field-error field-error-xs" style="display: none;">Vui lòng nhập Ngày yêu cầu báo giá!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày gửi báo giá <span class="text-danger">*</span></label>
                                <input type="text" id="date-gui-bao-gia" class="form-control flatpickr-date" value="${ngayGuiBaoGia}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" class="field-error field-error-xs" style="display: none;">Vui lòng nhập Ngày gửi báo giá!</span>
                            </div>
                            <div class="form-group" id="container-date-bao-cao-danh-gia" style="margin-bottom: 0; display: ${danhGiaNangLuc === "Có" ? "block" : "none"};">
                                <label class="compact-field-label">Ngày báo cáo đánh giá nhà thầu <span class="text-danger">*</span></label>
                                <input type="text" id="date-bao-cao-danh-gia" class="form-control flatpickr-date" value="${ngayBaoCaoDanhGiaNhaThau}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" class="field-error field-error-xs" style="display: none;">Vui lòng nhập Ngày báo cáo đánh giá nhà thầu!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày mời thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-moi-thuong-thao" class="form-control flatpickr-date" value="${ngayMoiThuongThao}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" class="field-error field-error-xs" style="display: none;">Vui lòng nhập Ngày mời thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày thương thảo <span class="text-danger">*</span></label>
                                <input type="text" id="date-thuong-thao" class="form-control flatpickr-date" value="${ngayThuongThao}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" class="field-error field-error-xs" style="display: none;">Vui lòng nhập Ngày thương thảo!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="compact-field-label">Ngày trình kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="date-trinh-ket-qua" class="form-control flatpickr-date" value="${ngayTrinhKetQua}" placeholder="dd/MM/yyyy" style="height: 32px; font-size: 0.8rem; width: 100%;">
                                <span class="error-text" class="field-error field-error-xs" style="display: none;">Vui lòng nhập Ngày trình kết quả!</span>
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div style="background: var(--neutral-soft); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 24px;">
                        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Quyết định phê duyệt Kết quả LCNT</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px;">
                            ${gt.hinhThucLuaChon !== "Chào hàng cạnh tranh" ? `
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-so-bctd" class="form-control" value="${soBctdResult}" placeholder="Nhập số báo cáo thẩm định..." style="width: 100%;">
                                <span class="error-text" class="field-error field-error-sm" style="display: none;">Vui lòng nhập Số BCTĐ kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày BCTĐ kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-ngay-bctd" class="form-control flatpickr-date" value="${ngayBctdResult ? view.model.formatForDateInput(ngayBctdResult) : ""}" style="width: 100%;" placeholder="dd/MM/yyyy">
                                <span class="error-text" class="field-error field-error-sm" style="display: none;">Vui lòng chọn Ngày BCTĐ kết quả!</span>
                            </div>
                            ` : ""}
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Số QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-no" class="form-control" value="${gt.soQuyetDinhKetQua || ""}" placeholder="Số QĐ Kết quả..." style="width: 100%;">
                                <span class="error-text" class="field-error field-error-sm" style="display: none;">Vui lòng nhập Số QĐ phê duyệt Kết quả!</span>
                            </div>
                            <div class="form-group form-group-compact">
                                <label class="field-label-strong">Ngày ký QĐ phê duyệt Kết quả <span class="text-danger">*</span></label>
                                <input type="text" id="award-decision-date" class="form-control flatpickr-date" value="${gt.ngayQuyetDinhKetQua ? view.model.formatForDateInput(gt.ngayQuyetDinhKetQua) : ""}" style="width: 100%;" placeholder="dd/MM/yyyy">
                                <span class="error-text" class="field-error field-error-sm" style="display: none;">Vui lòng chọn Ngày ký QĐ phê duyệt Kết quả!</span>
                            </div>
                        </div>
                    </div>
                    `}

                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; margin-bottom: 12px;">
                        <h5 style="font-weight:700; font-size:0.9rem; color:var(--text-main); display:flex; align-items:center; gap:6px; margin: 0;">
                            <i data-lucide="list"></i> ${isDirectOrSpecial ? "Danh sách nhà thầu trúng thầu" : "Danh sách nhà thầu tham dự &amp; Kết quả LCNT"}
                        </h5>
                    </div>

                    <div class="table-container" style="border:1px solid var(--border-color); border-radius:var(--radius-md); overflow-x:auto; margin-bottom:24px; background:var(--bg-card);">
                        <table class="data-table" style="min-width: 100%;">
                            <thead>
                                <tr>
                                    ${gt.phanLo === "Có" ? `
                                        <th style="width: 10%;">Mã phần lô</th>
                                        <th style="width: 10%;">Tên phần lô</th>
                                    ` : ""}
                                    ${isDirectOrSpecial ? `<th style="width: 12%;">Loại nhà thầu</th>` : ""}
                                    <th style="width: 12%;">Mã nhà thầu</th>
                                    <th style="width: 20%;">Tên nhà thầu</th>
                                    ${isCombinedMethod ? `
                                        <th style="width: 10%; text-align: center;">Điểm tổng hợp</th>
                                    ` : ""}
                                    ${!isDirectOrSpecial ? `
                                        <th style="width: 10%; text-align: center;">Xếp hạng nhà thầu</th>
                                        <th style="width: 10%;">Trúng thầu/trượt thầu</th>
                                        <th style="width: 14%;">Lý do trượt</th>
                                    ` : ""}
                                    <th style="width: 12%;">Giá trúng thầu</th>
                                    <th style="width: 14%;">Thời gian thực hiện gói thầu</th>
                                    <th style="width: 18%;">Thời gian thực hiện hợp đồng</th>
                                </tr>
                            </thead>
                            <tbody id="approve-bidders-tbody">
                                ${allBiddersHtml}
                            </tbody>
                        </table>
                    </div>

                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-primary" id="btn-approve-award" style="padding:12px 24px; font-weight:700; display:flex; align-items:center; gap:8px;">
                            <i data-lucide="check-circle2"></i> Phê duyệt & Hoàn thành LCNT
                        </button>
                    </div>
                `;
        const rads = contentWrapper.querySelectorAll('input[name="result-danh-gia-nang-luc"]');
        const dgContainer = contentWrapper.querySelector("#container-date-bao-cao-danh-gia");
        rads.forEach((rad) => {
          rad.addEventListener("change", () => {
            if (dgContainer) {
              dgContainer.style.display = rad.value === "Có" ? "block" : "none";
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
                jvContainer.style.display = selectLoai.value === "Liên danh" ? "block" : "none";
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
                        otherLyDo.style.background = "";
                        if (!otherLyDo.value) {
                          otherLyDo.value = otherTr.getAttribute("data-default-reason") || "Nhà thầu xếp hạng 1 trúng thầu";
                        }
                      }
                      const otherGia = otherTr.querySelector(".row-gia-trung");
                      if (otherGia) {
                        otherGia.disabled = true;
                        otherGia.style.background = "#f1f5f9";
                        otherGia.value = "";
                      }
                      const otherDurationPkg = otherTr.querySelector(".row-tg-goithau");
                      if (otherDurationPkg) {
                        otherDurationPkg.disabled = true;
                        otherDurationPkg.style.background = "#f1f5f9";
                        otherDurationPkg.value = "";
                      }
                      const otherDurationCtr = otherTr.querySelector(".row-tg-hopdong");
                      if (otherDurationCtr) {
                        otherDurationCtr.disabled = true;
                        otherDurationCtr.style.background = "#f1f5f9";
                        otherDurationCtr.value = "";
                      }
                    }
                  });
                  const inpGia = tr.querySelector(".row-gia-trung");
                  if (inpGia) {
                    inpGia.disabled = false;
                    inpGia.style.background = "";
                    inpGia.value = tr.getAttribute("data-default-price") || "";
                  }
                  const inpDurationPkg = tr.querySelector(".row-tg-goithau");
                  if (inpDurationPkg) {
                    inpDurationPkg.disabled = false;
                    inpDurationPkg.style.background = "";
                    inpDurationPkg.value = tr.getAttribute("data-default-duration-pkg") || "";
                  }
                  const inpDurationCtr = tr.querySelector(".row-tg-hopdong");
                  if (inpDurationCtr) {
                    inpDurationCtr.disabled = false;
                    inpDurationCtr.style.background = "";
                    inpDurationCtr.value = tr.getAttribute("data-default-duration-ctr") || "";
                  }
                  const inpLyDo = tr.querySelector(".row-ly-do-truot");
                  if (inpLyDo) {
                    inpLyDo.disabled = true;
                    inpLyDo.style.background = "#f1f5f9";
                    inpLyDo.value = "";
                  }
                } else {
                  const inpGia = tr.querySelector(".row-gia-trung");
                  if (inpGia) {
                    inpGia.disabled = true;
                    inpGia.style.background = "#f1f5f9";
                    inpGia.value = "";
                  }
                  const inpDurationPkg = tr.querySelector(".row-tg-goithau");
                  if (inpDurationPkg) {
                    inpDurationPkg.disabled = true;
                    inpDurationPkg.style.background = "#f1f5f9";
                    inpDurationPkg.value = "";
                  }
                  const inpDurationCtr = tr.querySelector(".row-tg-hopdong");
                  if (inpDurationCtr) {
                    inpDurationCtr.disabled = true;
                    inpDurationCtr.style.background = "#f1f5f9";
                    inpDurationCtr.value = "";
                  }
                  const inpLyDo = tr.querySelector(".row-ly-do-truot");
                  if (inpLyDo) {
                    inpLyDo.disabled = false;
                    inpLyDo.style.background = "";
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
          const lotOptions = (Array.isArray(lotList) ? lotList : typeof lotList === "string" ? JSON.parse(lotList || "[]") : []).map((l) => `<option value="${l.maPhanLo}" data-name="${l.tenPhanLo}" ${bidData.maPhanLo === l.maPhanLo ? "selected" : ""}>${l.maPhanLo}</option>`).join("");
          const ntCode = bidData.maNhaThau || bidData.maDinhDanh || "";
          const ntName = bidData.tenNhaThau || "";
          const ntType = bidData.loaiNhaThau || "Độc lập";
          const tr = document.createElement("tr");
          tr.setAttribute("data-cdtrug-id", rowId);
          tr.innerHTML = `
                        ${hasPhanLo ? `
                            <td><select class="form-control cdtrug-ma-phan-lo" style="padding:4px 6px;font-size:0.8rem;">
                                <option value="">-- Chọn --</option>${lotOptions}
                            </select></td>
                            <td><input type="text" class="form-control cdtrug-ten-phan-lo" value="${bidData.tenPhanLo || ""}" readonly placeholder="Tên lô" style="padding:4px 6px;font-size:0.8rem;"></td>
                        ` : ""}
                        <td><select class="form-control cdtrug-loai-nha-thau" style="padding:4px 6px;font-size:0.8rem;">
                            <option value="Độc lập" ${ntType === "Độc lập" ? "selected" : ""}>Độc lập</option>
                            <option value="Liên danh" ${ntType === "Liên danh" ? "selected" : ""}>Liên danh</option>
                        </select></td>
                        <td><input type="text" class="form-control cdtrug-ma-nha-thau" value="${ntCode}" required placeholder="Mã NT" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-ten-nha-thau" value="${ntName}" required placeholder="Tên nhà thầu" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-gia-du-thau cdtrug-format-vnd" value="${bidData.giaDuThau ? view.model.formatVND(bidData.giaDuThau) : ""}" placeholder="Giá dự thầu" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-ty-le-giam-gia" value="${bidData.tyLeGiamGia !== void 0 ? (bidData.tyLeGiamGia || 0).toString().replace(".", ",") : "0"}" style="padding:4px 6px;font-size:0.8rem;text-align:right;"></td>
                        <td><input type="text" class="form-control cdtrug-gia-sau-giam-gia cdtrug-format-vnd" value="${bidData.giaSauGiamGia ? view.model.formatVND(bidData.giaSauGiamGia) : ""}" readonly placeholder="..." style="padding:4px 6px;font-size:0.8rem;background:var(--bg-input-disabled,#f1f5f9);cursor:not-allowed;"></td>
                        <td><input type="text" class="form-control cdtrug-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-gia-tri-dam-bao cdtrug-format-vnd" value="${bidData.giaTriDamBao ? view.model.formatVND(bidData.giaTriDamBao) : ""}" placeholder="Giá trị ĐB" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-hieu-luc-bao-dam-ngay" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td><input type="text" class="form-control cdtrug-thoi-gian-thuc-hien" value="${bidData.thoiGianThucHien || gt.thoiGianThucHien || ""}" placeholder="Thực hiện" style="padding:4px 6px;font-size:0.8rem;"></td>
                        <td style="text-align:center;">
                            <button type="button" class="action-btn btn-delete cdtrug-remove-row" title="Xóa hàng">
                                <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
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
                    f.el.style.border = "1px solid var(--danger)";
                    const clearInvalid = () => {
                      f.el.style.border = "";
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
            const optionsHtml = lots.map((l) => `<option value="${l.maPhanLo}" data-name="${l.tenPhanLo}">${l.maPhanLo}</option>`).join("");
            const firstLotName = lots[0] ? lots[0].tenPhanLo : "";
            lotCells = `
                            <td>
                                <select class="form-control row-ma-phan-lo" style="padding:4px 8px; font-size:0.8rem;">
                                    ${optionsHtml}
                                </select>
                            </td>
                            <td>
                                <input type="text" class="form-control row-ten-phan-lo" value="${firstLotName}" readonly style="padding:4px 8px; font-size:0.8rem; background:#f1f5f9;">
                            </td>
                        `;
          }
          tr._thanhVienLienDanh = [];
          tr._leadMemberName = "";
          tr._jointVentureViewData = { members: [], leadName: "", leadCode: "", leadContractorVersionId: "" };
          tr.innerHTML = `
                        ${lotCells}
                        <td>
                            <select class="form-control row-loai-nha-thau" style="padding:4px 8px; font-size:0.8rem;">
                                <option value="Độc lập" selected>Độc lập</option>
                                <option value="Liên danh">Liên danh</option>
                            </select>
                        </td>
                        <td>
                            <input type="text" class="form-control row-ma-nha-thau" value="" placeholder="Mã nhà thầu" style="padding:4px 8px; font-size:0.8rem;">
                        </td>
                        <td>
                            <input type="text" class="form-control row-ten-nha-thau" value="" placeholder="Tên nhà thầu" style="padding:4px 8px; font-size:0.8rem;">
                            <div class="row-jv-members-container" style="margin-top: 4px; display: none;">
                                <button type="button" class="btn btn-outline btn-xs row-btn-manage-members" style="padding: 2px 6px; font-size: 0.72rem; font-weight: 700; border-style: dashed; width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; color: var(--primary); border-color: var(--primary-soft);">
                                    <i data-lucide="users" style="width: 12px; height: 12px;"></i>
                                    <span class="row-jv-btn-text">Xem thành viên liên danh (0)</span>
                                </button>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="form-control row-gia-trung" value="" placeholder="Giá trúng..." style="padding:4px 8px; font-size:0.8rem; width:100%;">
                        </td>
                        <td>
                            <input type="text" class="form-control row-tg-goithau" value="${gt.thoiGianThucHien || ""}" placeholder="Thời gian gói..." style="padding:4px 8px; font-size:0.8rem; width:100%;">
                        </td>
                        <td>
                            <input type="text" class="form-control row-tg-hopdong" value="${gt.thoiGianThucHien ? gt.thoiGianThucHien + " + Thời gian thực hiện các nghĩa vụ theo hợp đồng" : ""}" placeholder="Thời gian HĐ..." style="padding:4px 8px; font-size:0.8rem; width:100%;">
                        </td>
                        <td style="text-align: center;">
                            <button class="action-btn btn-delete row-remove-bidder" style="border:none; background:none; cursor:pointer; color:var(--danger);"><i data-lucide="trash-2" style="width:16px; height:16px;"></i></button>
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
