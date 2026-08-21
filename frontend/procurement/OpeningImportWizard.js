import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";
import { enhanceTableRowPagination } from "../shared/TablePagination.js";


function openingCaseType(pkg) {
  const hasLots = pkg.phanLo === "Có";
  if (["Chỉ định thầu rút gọn", "Lựa chọn nhà thầu trong trường hợp đặc biệt"]
    .includes(pkg.hinhThucLuaChon)) {
    return hasLots ? "DIRECT_SPECIAL_WITH_LOT" : "DIRECT_SPECIAL_NO_LOT";
  }
  if (pkg.linhVuc === "Tư vấn") return "TU_VAN";
  if (pkg.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ") {
    return hasLots ? "1G2T_WITH_LOT" : "1G2T_NO_LOT";
  }
  return hasLots ? "1G1T_WITH_LOT" : "1G1T_NO_LOT";
}


function mapJointVentureMembers(members) {
  return (Array.isArray(members) ? members : [])
    .filter((member) => member && typeof member === "object")
    .map((member, index) => ({
      maNhaThau: member.contractorCode || member.maNhaThau || member.taxCode || "",
      maSoThue: member.taxCode || member.maSoThue || "",
      tenNhaThau: member.contractorName || member.tenNhaThau || member.name || "",
      vaiTro: member.isLeader || index === 0 ? "Đứng đầu liên danh" : "Thành viên liên danh",
      tyLeLienDanh: member.share || member.tyLeLienDanh || null,
    }));
}


export function openingBidIdentity(bidder) {
  const code = bidder?.contractorCode
    || bidder?.maNhaThau
    || bidder?.maDinhDanh
    || bidder?.contractorName
    || bidder?.tenNhaThau
    || "";
  const lot = bidder?.lotNo || bidder?.maPhanLo || "";
  return `${String(code).replace(/\s+/g, "").toUpperCase()}::${String(lot).trim().toUpperCase()}`;
}


export function countOpeningContractors(bidders) {
  const identities = new Set();
  (Array.isArray(bidders) ? bidders : []).forEach((bidder) => {
    const identity = bidder?.jointVentureCode
      || bidder?.ventureCode
      || bidder?.contractorCode
      || bidder?.maNhaThau
      || bidder?.maDinhDanh
      || bidder?.jointVentureName
      || bidder?.ventureName
      || bidder?.contractorName
      || bidder?.tenNhaThau
      || "";
    const normalized = String(identity).replace(/\s+/g, "").toUpperCase();
    if (normalized) identities.add(normalized);
  });
  return identities.size;
}


export function reconcileOpeningDrafts(existing, source, mode = "MERGE") {
  const mappedSource = (Array.isArray(source) ? source : []).map(mapOpeningBidder);
  if (mode === "OVERWRITE") {
    return { rows: mappedSource, added: mappedSource.length, conflicts: 0 };
  }
  const existingRows = Array.isArray(existing) ? existing : [];
  const identities = new Set(existingRows.map(openingBidIdentity));
  const additions = mappedSource.filter((row) => !identities.has(openingBidIdentity(row)));
  return {
    rows: [...existingRows, ...additions],
    added: additions.length,
    conflicts: mappedSource.length - additions.length,
  };
}


export function mapOpeningBidder(bidder) {
  const members = mapJointVentureMembers(bidder?.jointVentureMembers);
  const isJointVenture = members.length > 0
    || Boolean(
      bidder?.jointVentureCode
      || bidder?.ventureCode
      || bidder?.jointVentureName
      || bidder?.ventureName,
    )
    || /joint|liên danh/i.test(String(bidder?.contractorType || ""));
  const jointVentureName = bidder?.jointVentureName || bidder?.ventureName || "";
  return {
    maDinhDanh: bidder?.contractorCode || "",
    maNhaThau: bidder?.contractorCode || "",
    tenNhaThau: (isJointVenture && jointVentureName)
      ? jointVentureName
      : (bidder?.contractorName || ""),
    loaiNhaThau: isJointVenture ? "Liên danh" : "Độc lập",
    // Thành viên liên danh do người dùng nhập và xác nhận thủ công.
    thanhVienLienDanh: [],
    giaDuThau: bidder?.bidPrice ?? null,
    tyLeGiamGia: bidder?.discountRate ?? null,
    giaSauGiamGia: bidder?.priceAfterDiscount ?? null,
    hieuLucHsdt: bidder?.bidValidityDays ?? null,
    giaTriDamBao: bidder?.bidGuarantee ?? null,
    hieuLucBaoDamNgay: bidder?.bidGuaranteeValidityDays ?? null,
    thoiGianThucHien: bidder?.executionPeriod || "",
    maPhanLo: bidder?.lotNo || "",
    tenPhanLo: bidder?.lotName || "",
  };
}


export function financialOpeningTimestamp(opening) {
  return opening?.financialOpeningAt ?? opening?.openingAt ?? null;
}


export function canApplyOpeningPreview(preview, pkg) {
  return Boolean(
    preview?.previewId
    && preview.package?.id === pkg?.id
    && Number(preview.package?.rowVersion) === Number(pkg?.rowVersion || 1),
  );
}


function openingNoticeNo(pkg) {
  return /^IB\d{10}(?:-\d{2})?$/i.test(String(pkg?.maGoiThau || ""))
    ? String(pkg.maGoiThau).slice(0, 12)
    : null;
}


export async function prepareOpeningForLifecycle(
  pkg,
  { client = new ProcurementImportClient() } = {},
) {
  if (!pkg) throw new TypeError("Gói thầu không hợp lệ.");
  const lease = captureWorkspaceLease(this.model);
  const workspaceToken = lease.token;
  const storage = this.model?.workspaceStorage;
  const assertCurrentWorkspace = () => {
    if (
      !isWorkspaceLeaseCurrent(this.model, lease)
      || this.model?.workspaceStorage !== storage
    ) throw workspaceChangedError();
  };
  const preview = await client.prepareOpening({
    packageId: pkg.id,
    noticeNo: openingNoticeNo(pkg),
    workspaceLease: workspaceToken || null,
  });
  assertCurrentWorkspace();
  if (!preview?.previewId || String(preview.package?.id) !== String(pkg.id)) {
    throw new Error("PROCUREMENT_PREVIEW_STALE");
  }
  const applied = await client.applyOpening({
    previewId: preview.previewId,
    expectedPackageRowVersion: preview.package.rowVersion,
    workspaceLease: workspaceToken || null,
  });
  assertCurrentWorkspace();
  return { preview, applied };
}


export function applyOpeningImportToDraft({
  pkg,
  preview,
  applied,
  action = "MERGE",
} = {}) {
  const tbody = document.getElementById("mothau-table-tbody");
  if (!pkg || !tbody || !applied?.opening) return { added: 0 };
  const currentRows = Array.from(tbody.querySelectorAll("tr"));
  const currentIdentities = new Set(currentRows.map((row) => openingBidIdentity({
    maNhaThau: row.querySelector(".mt-ma-nha-thau, .mt-ma-dinh-danh")?.value,
    tenNhaThau: row.querySelector(".mt-ten-nha-thau")?.value,
    maPhanLo: row.querySelector(".mt-ma-phan-lo")?.value,
  })));
  const bidders = (applied.opening.bidders || [])
    .filter((bidder) => bidder.phase !== "FINANCIAL")
    .map(mapOpeningBidder);
  if (action === "OVERWRITE") tbody.replaceChildren();
  const additions = action === "MERGE"
    ? bidders.filter((bidder) => !currentIdentities.has(openingBidIdentity(bidder)))
    : bidders;
  additions.forEach((bidder) => this.addMoThauRow(openingCaseType(pkg), pkg, bidder));
  const openingInput = document.getElementById("op-thoigianmothau");
  if (
    openingInput
    && applied.opening.openingAt
    && (action === "OVERWRITE" || !openingInput.value)
  ) {
    openingInput.value = this.model.formatForDatetimeLocal(applied.opening.openingAt);
    openingInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  this._openingImportPreview = {
    previewId: preview?.previewId || "",
    packageId: pkg.id,
    packageRowVersion: preview?.package?.rowVersion || applied.package?.rowVersion || null,
  };
  const table = document.getElementById("mothau-table");
  if (table) enhanceTableRowPagination(table);
  globalThis.lucide?.createIcons?.();
  return { added: additions.length };
}


export async function importOpeningFromMuasamcong({
  client = new ProcurementImportClient(),
} = {}) {
  const select = document.getElementById("mothau-goithau-select");
  const button = document.getElementById("btn-mothau-import-msc");
  const pkg = this.model.state.goithau.find(
    (item) => String(item.id) === String(select?.value || ""),
  );
  if (!pkg || !button || button.dataset.loading === "true") return;
  const originalLabel = button.innerHTML;
  button.dataset.loading = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Đang lấy dữ liệu…";
  const lease = captureWorkspaceLease(this.model);
  const workspaceToken = lease.token;
  const storage = this.model?.workspaceStorage;
  const assertCurrentWorkspace = () => {
    const current = this.model?.state?.goithau?.find((item) => String(item.id) === String(pkg.id));
    if (
      !isWorkspaceLeaseCurrent(this.model, lease)
      || this.model?.workspaceStorage !== storage
      || String(select?.value || "") !== String(pkg.id)
      || String(current?.rootId || current?.id || "") !== String(pkg.rootId || pkg.id)
    ) throw workspaceChangedError();
  };
  try {
    const preview = await client.prepareOpening({
      packageId: pkg.id,
      noticeNo: openingNoticeNo(pkg),
      workspaceLease: workspaceToken || null,
    });
    assertCurrentWorkspace();
    if (!canApplyOpeningPreview(preview, pkg)) {
      throw new Error("PROCUREMENT_PREVIEW_STALE");
    }
    const applied = await client.applyOpening({
      previewId: preview.previewId,
      expectedPackageRowVersion: preview.package.rowVersion,
      workspaceLease: workspaceToken || null,
    });
    assertCurrentWorkspace();
    const current = this.model.state.goithau.find(
      (item) => String(item.id) === String(pkg.id),
    );
    if (Number(current?.rowVersion || 1) !== Number(applied.package.rowVersion)) {
      throw new Error("PROCUREMENT_PREVIEW_STALE");
    }
    applyOpeningImportToDraft.call(this, {
      pkg,
      preview,
      applied,
      action: "OVERWRITE",
    });
  } catch (error) {
    if (error?.code === "WORKSPACE_CHANGED" || error?.name === "AbortError") return;
    const stale = String(error?.message || error).includes("PROCUREMENT_PREVIEW_STALE");
    await this.view.customAlert(
      stale ? "Preview đã cũ" : "Không thể lấy dữ liệu mở thầu",
      stale
        ? "Gói thầu đã thay đổi. Hãy lấy lại preview trước khi áp dụng."
        : "Không thể lấy dữ liệu từ Mua Sắm Công. Vui lòng thử lại.",
      "alert-triangle",
    );
  } finally {
    if (isWorkspaceLeaseCurrent(this.model, lease) && this.model?.workspaceStorage === storage) {
      delete button.dataset.loading;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = trustedHTML(originalLabel);
      globalThis.lucide?.createIcons?.();
    }
  }
}


const openingBidKey = (code, lotNo) => openingBidIdentity({
  maNhaThau: code,
  maPhanLo: lotNo,
});


export async function importFinancialOpeningFromMuasamcong({
  view,
  pkg,
  contentWrapper,
  client = new ProcurementImportClient(),
}) {
  const button = contentWrapper?.querySelector?.("#btn-opening-fin-import-msc");
  if (!button || button.dataset.loading === "true") return false;
  const originalLabel = button.innerHTML;
  button.dataset.loading = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Đang lấy dữ liệu…";
  const lease = captureWorkspaceLease(view.model);
  const workspaceToken = lease.token;
  const storage = view.model?.workspaceStorage;
  const assertCurrentWorkspace = () => {
    const current = view.model?.state?.goithau?.find((item) => String(item.id) === String(pkg.id));
    if (
      !isWorkspaceLeaseCurrent(view.model, lease)
      || view.model?.workspaceStorage !== storage
      || String(current?.rootId || current?.id || "") !== String(pkg.rootId || pkg.id)
    ) throw workspaceChangedError();
  };
  try {
    const possibleNotice = /^IB\d{10}(?:-\d{2})?$/i.test(String(pkg.maGoiThau || ""))
      ? String(pkg.maGoiThau).slice(0, 12)
      : null;
    const preview = await client.prepareOpening({
      packageId: pkg.id,
      noticeNo: possibleNotice,
      workspaceLease: workspaceToken || null,
    });
    assertCurrentWorkspace();
    if (!canApplyOpeningPreview(preview, pkg)) {
      throw new Error("PROCUREMENT_PREVIEW_STALE");
    }
    const applied = await client.applyOpening({
      previewId: preview.previewId,
      expectedPackageRowVersion: preview.package.rowVersion,
      workspaceLease: workspaceToken || null,
    });
    assertCurrentWorkspace();
    const byIdentity = new Map(
      (applied.opening?.bidders || [])
        .filter((bidder) => bidder.phase === "FINANCIAL")
        .map((bidder) => [
          openingBidKey(bidder.contractorCode, bidder.lotNo),
          bidder,
        ]),
    );
    contentWrapper.querySelectorAll("#opening-fin-table tbody tr").forEach((row) => {
      const bid = view.model.state.thongtinmothau.find(
        (item) => String(item.id) === String(row.dataset.openingBidId || ""),
      );
      const source = byIdentity.get(
        openingBidKey(bid?.maNhaThau || bid?.maDinhDanh, bid?.maPhanLo),
      );
      if (!source) return;
      const price = row.querySelector(".op-gia-du-thau");
      const discount = row.querySelector(".op-ty-le-giam");
      if (
        price
        && source.bidPrice != null
      ) {
        price.value = view.model.formatVND(source.bidPrice);
      }
      if (
        discount
        && source.discountRate != null
      ) {
        discount.value = String(source.discountRate).replace(".", ",");
      }
      price?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const openingTime = contentWrapper.querySelector("#op-fin-thoigianmothau");
    const financialOpeningAt = financialOpeningTimestamp(applied.opening);
    if (openingTime && financialOpeningAt) {
      openingTime.value = view.model.formatForDatetimeLocal(
        financialOpeningAt,
      );
      openingTime.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  } catch (error) {
    if (error?.code === "WORKSPACE_CHANGED" || error?.name === "AbortError") return false;
    const stale = String(error?.message || error).includes("PROCUREMENT_PREVIEW_STALE");
    await view.customAlert(
      stale ? "Preview đã cũ" : "Không thể lấy dữ liệu tài chính",
      stale
        ? "Gói thầu đã thay đổi. Hãy lấy lại preview."
        : "Không thể lấy biên bản mở E-HSĐXTC từ Mua Sắm Công.",
      "alert-triangle",
    );
    return false;
  } finally {
    if (isWorkspaceLeaseCurrent(view.model, lease) && view.model?.workspaceStorage === storage) {
      delete button.dataset.loading;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = trustedHTML(originalLabel);
      globalThis.lucide?.createIcons?.();
    }
  }
}
