import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { normalizeProcurementPartnerName } from "./partnerNameCase.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";
import { enhanceTableRowPagination } from "../shared/TablePagination.js";
import { getOpeningElement } from "../packages/openingPanelDom.js";

const openingButtonOperations = new WeakMap();


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
    tenNhaThau: normalizeProcurementPartnerName((isJointVenture && jointVentureName)
      ? jointVentureName
      : (bidder?.contractorName || "")),
    loaiNhaThau: isJointVenture ? "Liên danh" : "Độc lập",
    // Thành viên liên danh do người dùng nhập và xác nhận thủ công.
    thanhVienLienDanh: [],
    giaDuThau: bidder?.bidPrice ?? null,
    tyLeGiamGia: bidder?.discountRate
      ?? bidder?.discountPercent
      ?? bidder?.discountPercentage
      ?? bidder?.bidDiscountRate
      ?? bidder?.bidPriceDiscountPercent
      ?? bidder?.tyLeGiamGia
      ?? null,
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
  return opening?.financialOpeningAt ?? null;
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
    const packageRows = this.model?.state?.goithau;
    const current = Array.isArray(packageRows)
      ? packageRows.find((item) => String(item.id) === String(pkg.id))
      : null;
    if (
      !isWorkspaceLeaseCurrent(this.model, lease)
      || this.model?.workspaceStorage !== storage
      || (Array.isArray(packageRows) && (
        String(current?.rootId || current?.id || "") !== String(pkg.rootId || pkg.id)
        || Number(current?.rowVersion || 1) !== Number(pkg.rowVersion || 1)
      ))
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
  const tbody = getOpeningElement("mothau-table-tbody");
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
  if (bidders.length === 0) throw new Error("OPENING_SOURCE_NO_TECHNICAL_BIDDERS");
  if (action === "OVERWRITE") tbody.replaceChildren();
  const additions = action === "MERGE"
    ? bidders.filter((bidder) => !currentIdentities.has(openingBidIdentity(bidder)))
    : bidders;
  additions.forEach((bidder) => this.addMoThauRow(openingCaseType(pkg), pkg, bidder));
  const openingInput = getOpeningElement("op-thoigianmothau");
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
  const table = getOpeningElement("mothau-table");
  if (table) enhanceTableRowPagination(table);
  this.view?.createIconsScoped?.(tbody);
  return { added: additions.length };
}


export async function importOpeningFromMuasamcong({
  client = new ProcurementImportClient(),
} = {}) {
  const select = getOpeningElement("mothau-goithau-select");
  const button = getOpeningElement("btn-mothau-import-msc");
  const pkg = this.model.state.goithau.find(
    (item) => String(item.id) === String(select?.value || ""),
  );
  if (!pkg || !button || button.dataset.loading === "true") return;
  const originalLabel = button.innerHTML;
  button.dataset.loading = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const busyLabel = "Đang lấy dữ liệu…";
  button.textContent = busyLabel;
  const operationIdentity = Object.freeze({});
  openingButtonOperations.set(button, operationIdentity);
  const lease = captureWorkspaceLease(this.model);
  const workspaceToken = lease.token;
  const storage = this.model?.workspaceStorage;
  const openingPane = select.closest?.(".tab-pane");
  const isOwnedOperation = () => {
    return isWorkspaceLeaseCurrent(this.model, lease)
      && this.model?.workspaceStorage === storage
      && (openingPane
        ? openingPane.querySelector("#mothau-goithau-select") === select
          && openingPane.querySelector("#btn-mothau-import-msc") === button
        : getOpeningElement("mothau-goithau-select") === select
          && getOpeningElement("btn-mothau-import-msc") === button)
      && openingButtonOperations.get(button) === operationIdentity;
  };
  const isCurrentOperation = () => {
    const current = this.model?.state?.goithau?.find((item) => String(item.id) === String(pkg.id));
    return isOwnedOperation()
      && getOpeningElement("mothau-goithau-select") === select
      && getOpeningElement("btn-mothau-import-msc") === button
      && String(select?.value || "") === String(pkg.id)
      && String(current?.rootId || current?.id || "") === String(pkg.rootId || pkg.id);
  };
  const assertCurrentWorkspace = () => {
    if (!isCurrentOperation()) throw workspaceChangedError();
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
    if (!isCurrentOperation()) return;
    if (error?.code === "WORKSPACE_CHANGED" || error?.name === "AbortError") return;
    if (error?.message === "OPENING_SOURCE_NO_TECHNICAL_BIDDERS") {
      await this.view.customAlert(
        "Chưa có dữ liệu mở thầu kỹ thuật",
        "Nguồn chưa có nhà thầu cho biên bản mở thầu này. Dữ liệu đang nhập được giữ lại; hãy kiểm tra lại biên bản nguồn.",
        "alert-triangle",
      );
      return;
    }
    const stale = String(error?.message || error).includes("PROCUREMENT_PREVIEW_STALE");
    await this.view.customAlert(
      stale ? "Preview đã cũ" : "Không thể lấy dữ liệu mở thầu",
      stale
        ? "Gói thầu đã thay đổi. Hãy lấy lại preview trước khi áp dụng."
        : "Không thể lấy dữ liệu tự động. Vui lòng thử lại.",
      "alert-triangle",
    );
  } finally {
    if (isOwnedOperation() && button.textContent === busyLabel) {
      openingButtonOperations.delete(button);
      delete button.dataset.loading;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = trustedHTML(originalLabel);
      this.view?.createIconsScoped?.(button);
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
  const saveButton = contentWrapper?.querySelector?.("#btn-save-opening-fin");
  if (!button || button.dataset.loading === "true" || saveButton?.disabled) return false;
  const draftFingerprint = () => JSON.stringify([
    contentWrapper.querySelector("#op-fin-thoigianmothau")?.value || "",
    ...Array.from(contentWrapper.querySelectorAll("#opening-fin-table tbody tr"), (row) => [
      row.dataset.openingBidId,
      ...[".op-gia-du-thau", ".op-ty-le-giam", ".op-gia-sau-giam", ".op-hieu-luc-hsdt"]
        .map((selector) => row.querySelector(selector)?.value || ""),
    ]),
  ]);
  const initialDraft = draftFingerprint();
  if (saveButton) saveButton.disabled = true;
  const originalLabel = button.innerHTML;
  button.dataset.loading = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Đang lấy dữ liệu…";
  const operationIdentity = Object.freeze({});
  openingButtonOperations.set(button, operationIdentity);
  const lease = captureWorkspaceLease(view.model);
  const workspaceToken = lease.token;
  const storage = view.model?.workspaceStorage;
  const isCurrentOperation = () => {
    const current = view.model?.state?.goithau?.find((item) => String(item.id) === String(pkg.id));
    const ownerDocument = contentWrapper?.ownerDocument || globalThis.document;
    const currentWrapper = ownerDocument?.getElementById?.("detail-workflow-content-wrapper");
    return isWorkspaceLeaseCurrent(view.model, lease)
      && view.model?.workspaceStorage === storage
      && (!currentWrapper || currentWrapper === contentWrapper)
      && contentWrapper?.querySelector?.("#btn-opening-fin-import-msc") === button
      && openingButtonOperations.get(button) === operationIdentity
      && String(current?.rootId || current?.id || "") === String(pkg.rootId || pkg.id);
  };
  const assertCurrentWorkspace = () => {
    if (!isCurrentOperation()) throw workspaceChangedError();
  };
  try {
    const possibleNotice = /^IB\d{10}(?:-\d{2})?$/i.test(String(pkg.maGoiThau || ""))
      ? String(pkg.maGoiThau).slice(0, 12)
      : null;
    const preview = await client.prepareOpening({
      packageId: pkg.id,
      noticeNo: possibleNotice,
      workspaceLease: workspaceToken || null,
      openingPhase: "FINANCIAL",
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
    const current = view.model.state.goithau.find((item) => String(item.id) === String(pkg.id));
    if (applied.package?.id !== current?.id
      || Number(current?.rowVersion || 1) !== Number(applied.package?.rowVersion)) {
      throw new Error("PROCUREMENT_PREVIEW_STALE");
    }
    if (draftFingerprint() !== initialDraft) throw new Error("FINANCIAL_DRAFT_CHANGED");
    if (applied.opening?.partial) throw new Error("PROCUREMENT_PARTIAL_DATA");
    const byIdentity = new Map();
    for (const bidder of applied.opening?.bidders || []) {
      if (bidder.phase !== "FINANCIAL") continue;
      const key = openingBidKey(bidder.contractorCode, bidder.lotNo);
      if (!bidder.contractorCode || byIdentity.has(key)) throw new Error("FINANCIAL_SOURCE_AMBIGUOUS");
      for (const field of ["bidPrice", "discountRate", "priceAfterDiscount", "bidValidityDays"]) {
        if (bidder[field] != null && (bidder[field] === "" || !Number.isFinite(Number(bidder[field]))
          || Number(bidder[field]) < 0 || (field === "discountRate" && Number(bidder[field]) > 100)
          || (field === "bidPrice" && Number(bidder[field]) === 0)
          || (field === "bidValidityDays" && (!Number.isInteger(Number(bidder[field])) || Number(bidder[field]) === 0)))) {
          throw new Error("PROCUREMENT_SCHEMA_CHANGED");
        }
      }
      byIdentity.set(key, bidder);
    }
    const updates = [];
    const rows = Array.from(contentWrapper.querySelectorAll("#opening-fin-table tbody tr"));
    rows.forEach((row) => {
      const bid = view.model.state.thongtinmothau.find(
        (item) => String(item.id) === String(row.dataset.openingBidId || ""),
      );
      if (String(bid?.goiThauId || "") !== String(pkg.id)) return;
      const source = byIdentity.get(
        openingBidKey(bid?.maNhaThau || bid?.maDinhDanh, bid?.maPhanLo),
      );
      if (!source || source.bidPrice == null) return;
      updates.push({ row, source });
    });
    if (!updates.length) throw new Error("FINANCIAL_SOURCE_NO_MATCH");
    const openingTime = contentWrapper.querySelector("#op-fin-thoigianmothau");
    const financialOpeningAt = financialOpeningTimestamp(applied.opening);
    const formattedOpeningTime = financialOpeningAt
      ? view.model.formatForDatetimeLocal(financialOpeningAt) : "";
    if (financialOpeningAt && !formattedOpeningTime) throw new Error("PROCUREMENT_SCHEMA_CHANGED");
    // Validate the entire plan before changing any draft control.
    updates.forEach(({ row, source }) => {
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
      const finalPrice = row.querySelector(".op-gia-sau-giam");
      if (finalPrice && source.priceAfterDiscount != null) {
        finalPrice.value = view.model.formatVND(source.priceAfterDiscount);
        finalPrice.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const validity = row.querySelector(".op-hieu-luc-hsdt");
      if (validity && source.bidValidityDays != null) {
        validity.value = `${source.bidValidityDays} ngày`;
        validity.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    if (openingTime && financialOpeningAt) {
      openingTime.value = formattedOpeningTime;
      openingTime._flatpickr?.setDate(openingTime.value, false, "d/m/Y H:i");
      openingTime.dispatchEvent(new Event("change", { bubbles: true }));
    }
    view.showToast?.("Đã lấy dữ liệu tài chính", `Đã điền ${updates.length}/${rows.length} dòng. Kiểm tra thông tin và bấm Lưu Biên bản mở E-HSĐXTC.`, "success");
    return true;
  } catch (error) {
    if (!isCurrentOperation()) return false;
    if (error?.code === "WORKSPACE_CHANGED" || error?.name === "AbortError") return false;
    const stale = String(error?.message || error).includes("PROCUREMENT_PREVIEW_STALE");
    const draftChanged = error?.message === "FINANCIAL_DRAFT_CHANGED";
    const noMatch = error?.message === "FINANCIAL_SOURCE_NO_MATCH";
    await view.customAlert(
      stale ? "Preview đã cũ" : "Không thể lấy dữ liệu tài chính",
      stale
        ? "Gói thầu đã thay đổi. Hãy lấy lại preview."
        : draftChanged
          ? "Bạn đã thay đổi nội dung trong khi lấy dữ liệu. Nội dung đang nhập được giữ lại; hãy lấy lại khi hoàn tất chỉnh sửa."
          : noMatch
            ? "Nguồn chưa có dữ liệu tài chính khớp mã nhà thầu và phần lô trong danh sách này. Nội dung đang nhập được giữ lại."
            : "Không thể lấy biên bản mở E-HSĐXTC tự động. Nội dung đang nhập được giữ lại; hãy kiểm tra nguồn và thử lại.",
      "alert-triangle",
    );
    return false;
  } finally {
    if (isCurrentOperation()) {
      if (saveButton && contentWrapper.querySelector("#btn-save-opening-fin") === saveButton) saveButton.disabled = false;
      openingButtonOperations.delete(button);
      delete button.dataset.loading;
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = trustedHTML(originalLabel);
      view.createIconsScoped?.(button);
    }
  }
}
