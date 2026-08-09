import { formatPartnerIdentityCode } from "../../app/domUtils.js";
import { resolveBidContractorName } from "../../partners/contractorVersionBinding.js";
import { setLotWinners } from "../../shared/runtimeState.js";
import { escapeHtml, safeAttr } from "../../shared/view_helpers.js";
import { beginWorkspaceRender } from "../../shared/workspaceRenderCache.js";
import { setJvData } from "../jvDataStore.js";
import { renderBidContractorLink } from "./BidderTable.js";
import { buildAwardJointVentureViewData } from "./AwardResultPanelController.js";

function buildWinnerPresentation(model, pkg, summary, allBids, owner) {
  if (summary.hasMultipleWinners) {
    const winners = summary.winningLots.map((lot) => {
      const bidder = allBids.find(
        (bid) => String(bid.nhaThauId) === String(lot.nhaThauTrungThauId),
      );
      const contractor = (model.state.nhathau || []).find(
        (item) => String(item.id) === String(lot.nhaThauTrungThauId),
      );
      const isJointVenture = bidder?.loaiNhaThau === "Liên danh";
      return {
        maPhanLo: lot.maPhanLo,
        tenPhanLo: lot.tenPhanLo,
        nhaThauTrungThauId: lot.nhaThauTrungThauId,
        tenNhaThau: bidder
          ? resolveBidContractorName(model, bidder)
          : contractor?.tenNhaThau || `Nhà thầu #${lot.nhaThauTrungThauId}`,
        giaTrungThau: lot.giaTrungThau,
        isJV: isJointVenture,
        jvData: isJointVenture
          ? buildAwardJointVentureViewData(model, bidder)
          : null,
      };
    });
    setLotWinners(model, pkg.id, winners, { owner });
    return `
      <h5 class="bf-s-f3bfd10216">
        <a href="#" data-bf-action="show-lot-winners" data-id="${safeAttr(pkg.id)}" class="link-hover bf-s-9be517fbf0" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</a>
      </h5>
    `;
  }

  const winnerBid = summary.currentWinnerBid;
  if (!winnerBid) {
    return '<h5 class="bf-s-f3bfd10216">Chưa xác định</h5>';
  }
  if (winnerBid.loaiNhaThau === "Liên danh") {
    setJvData(model, pkg.id, buildAwardJointVentureViewData(model, winnerBid), { owner });
    return `
      <div class="bf-s-7d5173b171">
        <h5 class="bf-s-f3bfd10216">
          <a href="#" data-bf-action="show-jv" data-id="${safeAttr(pkg.id)}" class="link-hover bf-s-b0e08465c2" title="Xem chi tiết liên danh">👥 ${escapeHtml(resolveBidContractorName(model, winnerBid))}</a>
        </h5>
      </div>
    `;
  }

  const contractor = (model.state.nhathau || []).find(
    (item) => String(item.id) === String(winnerBid.nhaThauId),
  );
  const identityCode = contractor
    ? contractor.maSoThue || contractor.maNhaThau
    : winnerBid.maDinhDanh || winnerBid.maNhaThau;
  return `
    <h5 class="bf-s-f3bfd10216">
      <a href="#" data-bf-action="show-contractor-modal" data-id="${safeAttr(winnerBid.nhaThauId)}" class="link-hover bf-s-b0e08465c2">${escapeHtml(resolveBidContractorName(model, winnerBid))}</a>
    </h5>
    <div class="bf-s-dfd82ca088">
      MST: <strong>${escapeHtml(formatPartnerIdentityCode(identityCode, "Chưa có"))}</strong>
    </div>
  `;
}

function buildBidderRows(model, pkg, summary, owner) {
  return summary.bidderRows.map((row) => {
    const bid = row.bid;
    const awardPrice = row.isWinner
      ? model.formatCurrency(row.awardPrice || 0)
      : "—";
    const badge = row.isWinner
      ? '<span class="badge badge-success bf-s-3b94095234">Trúng thầu</span>'
      : '<span class="badge badge-danger bf-s-514590f0cd">Trượt thầu</span>';
    let contractorMarkup;
    if (bid.loaiNhaThau === "Liên danh") {
      const jointVentureKey = `${pkg.id}_result_bidder_${row.index}`;
      setJvData(model, jointVentureKey, buildAwardJointVentureViewData(model, bid), { owner });
      contractorMarkup = `<a href="#" data-bf-action="show-jv" data-id="${safeAttr(jointVentureKey)}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${escapeHtml(bid.tenNhaThau || "--")}</a>`;
    } else {
      contractorMarkup = renderBidContractorLink(
        model,
        bid,
        `${pkg.id}_result_contractor_${row.index}`,
        { owner },
      );
    }
    if (summary.isLotPackage) {
      return `
        <tr>
          <td>${escapeHtml(bid.maPhanLo || "—")}</td>
          <td>${escapeHtml(bid.tenPhanLo || "—")}</td>
          <td>${escapeHtml(formatPartnerIdentityCode(bid.maNhaThau || bid.maDinhDanh, "--"))}</td>
          <td>${contractorMarkup}</td>
          <td class="fw-bold text-success">${awardPrice}</td>
          <td>${escapeHtml(row.packageDuration)}</td>
          <td class="bf-s-63dbf5319a">${badge}</td>
          <td class="text-muted">${escapeHtml(row.rejectionReason)}</td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${escapeHtml(formatPartnerIdentityCode(bid.maNhaThau || bid.maDinhDanh, "--"))}</td>
        <td>${contractorMarkup}</td>
        <td class="fw-bold text-success">${awardPrice}</td>
        <td>${escapeHtml(row.packageDuration)}</td>
        <td class="bf-s-63dbf5319a">${badge}</td>
        <td class="text-muted">${escapeHtml(row.rejectionReason)}</td>
      </tr>
    `;
  }).join("");
}

function buildTableHeader(isLotPackage) {
  if (isLotPackage) {
    return `
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
  }
  return `
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

export function buildAwardResultSummaryPresentation({
  model,
  pkg,
  summary,
  allBids = [],
} = {}) {
  if (!model?.state || !pkg || !summary || !Array.isArray(summary.bidderRows)) {
    throw new TypeError("Award result summary presentation received an invalid context.");
  }
  const owner = `award-result:${pkg.id}`;
  beginWorkspaceRender(model, owner);
  if (!pkg.nhaThauTrungThauId && summary.inferredPackageWinnerId) {
    pkg.nhaThauTrungThauId = summary.inferredPackageWinnerId;
  }
  return {
    winnerHtml: buildWinnerPresentation(model, pkg, summary, allBids, owner),
    bidderRowsHtml: buildBidderRows(model, pkg, summary, owner),
    tableHeaderHtml: buildTableHeader(summary.isLotPackage),
  };
}
