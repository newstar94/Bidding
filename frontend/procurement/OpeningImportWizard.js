import { ProcurementImportClient } from "./ProcurementImportClient.js";
import { trustedHTML } from "../shared/trustedTypes.js";


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
    || /joint|liên danh/i.test(String(bidder?.contractorType || ""));
  return {
    maDinhDanh: bidder?.contractorCode || "",
    maNhaThau: bidder?.contractorCode || "",
    tenNhaThau: bidder?.contractorName || "",
    loaiNhaThau: isJointVenture ? "Liên danh" : "Độc lập",
    thanhVienLienDanh: members,
    giaDuThau: bidder?.bidPrice ?? null,
    tyLeGiamGia: bidder?.discountRate ?? null,
    giaSauGiamGia: bidder?.priceAfterDiscount ?? null,
    hieuLucHsdt: bidder?.bidValidityDays ?? null,
    giaTriDamBao: bidder?.bidGuarantee ?? null,
    hieuLucBaoDamNgay: bidder?.bidGuaranteeValidityDays ?? null,
    thoiGianThucHien: bidder?.executionPeriod || "",
    maPhanLo: bidder?.lotNo || "",
  };
}


export function canApplyOpeningPreview(preview, pkg) {
  return Boolean(
    preview?.previewId
    && preview.package?.id === pkg?.id
    && Number(preview.package?.rowVersion) === Number(pkg?.rowVersion || 1),
  );
}


export async function importOpeningFromMuasamcong() {
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
  try {
    const client = new ProcurementImportClient();
    const possibleNotice = /^IB\d{10}(?:-\d{2})?$/i.test(String(pkg.maGoiThau || ""))
      ? String(pkg.maGoiThau).slice(0, 12)
      : null;
    const preview = await client.prepareOpening({
      packageId: pkg.id,
      noticeNo: possibleNotice,
      workspaceLease: this.model.activeWorkspaceLease || null,
    });
    if (!canApplyOpeningPreview(preview, pkg)) {
      throw new Error("PROCUREMENT_PREVIEW_STALE");
    }
    const bidderCount = preview.opening?.bidders?.length || 0;
    const lotCount = preview.opening?.lots?.length || 0;
    const partial = (preview.warnings || []).length > 0
      ? " Một số nguồn phụ chưa trả dữ liệu; hãy kiểm tra kỹ preview."
      : "";
    const tbody = document.getElementById("mothau-table-tbody");
    const currentRows = Array.from(tbody?.querySelectorAll?.("tr") || []);
    const sourceTechnical = (preview.opening?.bidders || [])
      .filter((bidder) => bidder.phase !== "FINANCIAL");
    const currentIdentities = new Set(currentRows.map((row) => openingBidIdentity({
      maNhaThau: row.querySelector(".mt-ma-nha-thau, .mt-ma-dinh-danh")?.value,
      tenNhaThau: row.querySelector(".mt-ten-nha-thau")?.value,
      maPhanLo: row.querySelector(".mt-ma-phan-lo")?.value,
    })));
    const conflicts = sourceTechnical.filter(
      (bidder) => currentIdentities.has(openingBidIdentity(bidder)),
    ).length;
    const previewMessage = `TBMT ${preview.notice.noticeNo}-${preview.notice.selectedRevision}: ${bidderCount} nhà thầu${lotCount ? `, ${lotCount} phần lô` : ""}; ${conflicts} dòng trùng với draft.${partial}`;
    const action = currentRows.length
      ? await this.view.customSelectConfirm(
        "Preview dữ liệu mở thầu",
        `${previewMessage} Chọn cách áp dụng:`,
        [
          { value: "MERGE", label: "Gộp — giữ dữ liệu local" },
          { value: "OVERWRITE", label: "Ghi đè toàn bộ draft" },
        ],
      )
      : await this.view.customConfirm(
        "Preview dữ liệu mở thầu",
        `${previewMessage} Áp dụng vào bản nháp hiện tại?`,
        "download-cloud",
      ) ? "OVERWRITE" : null;
    if (!action) return;
    const applied = await client.applyOpening({
      previewId: preview.previewId,
      expectedPackageRowVersion: preview.package.rowVersion,
      workspaceLease: this.model.activeWorkspaceLease || null,
    });
    const current = this.model.state.goithau.find(
      (item) => String(item.id) === String(pkg.id),
    );
    if (Number(current?.rowVersion || 1) !== Number(applied.package.rowVersion)) {
      throw new Error("PROCUREMENT_PREVIEW_STALE");
    }
    const bidders = (applied.opening?.bidders || [])
      .filter((bidder) => bidder.phase !== "FINANCIAL")
      .map(mapOpeningBidder);
    if (action === "OVERWRITE") tbody?.replaceChildren();
    const additions = action === "MERGE"
      ? bidders.filter((bidder) => !currentIdentities.has(openingBidIdentity(bidder)))
      : bidders;
    additions.forEach((bidder) => this.addMoThauRow(openingCaseType(pkg), pkg, bidder));
    const openingInput = document.getElementById("op-thoigianmothau");
    if (
      openingInput
      && applied.opening?.openingAt
      && (action === "OVERWRITE" || !openingInput.value)
    ) {
      openingInput.value = this.model.formatForDatetimeLocal(
        applied.opening.openingAt,
      );
      openingInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    this._openingImportPreview = {
      previewId: preview.previewId,
      packageId: pkg.id,
      packageRowVersion: preview.package.rowVersion,
    };
    globalThis.lucide?.createIcons?.();
  } catch (error) {
    const stale = String(error?.message || error).includes("PROCUREMENT_PREVIEW_STALE");
    await this.view.customAlert(
      stale ? "Preview đã cũ" : "Không thể lấy dữ liệu mở thầu",
      stale
        ? "Gói thầu đã thay đổi. Hãy lấy lại preview trước khi áp dụng."
        : "Không thể lấy dữ liệu từ Mua Sắm Công. Vui lòng thử lại.",
      "alert-triangle",
    );
  } finally {
    delete button.dataset.loading;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = trustedHTML(originalLabel);
    globalThis.lucide?.createIcons?.();
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
  try {
    const possibleNotice = /^IB\d{10}(?:-\d{2})?$/i.test(String(pkg.maGoiThau || ""))
      ? String(pkg.maGoiThau).slice(0, 12)
      : null;
    const preview = await client.prepareOpening({
      packageId: pkg.id,
      noticeNo: possibleNotice,
      workspaceLease: view.model.activeWorkspaceLease || null,
    });
    if (!canApplyOpeningPreview(preview, pkg)) {
      throw new Error("PROCUREMENT_PREVIEW_STALE");
    }
    const financialBidders = (preview.opening?.bidders || []).filter(
      (bidder) => bidder.phase === "FINANCIAL",
    );
    const localPriceInputs = Array.from(
      contentWrapper.querySelectorAll("#opening-fin-table .op-gia-du-thau"),
    );
    const hasLocalValues = localPriceInputs.some(
      (input) => String(input.value || "").trim(),
    );
    const action = hasLocalValues
      ? await view.customSelectConfirm(
        "Preview mở E-HSĐXTC",
        `TBMT ${preview.notice.noticeNo}-${preview.notice.selectedRevision}: ${financialBidders.length} giá dự thầu. Chọn cách xử lý giá đã nhập:`,
        [
          { value: "MERGE", label: "Gộp — chỉ điền ô trống" },
          { value: "OVERWRITE", label: "Ghi đè giá từ nguồn" },
        ],
      )
      : await view.customConfirm(
        "Preview mở E-HSĐXTC",
        `TBMT ${preview.notice.noticeNo}-${preview.notice.selectedRevision}: ${financialBidders.length} giá dự thầu tài chính. Áp dụng vào bản nháp hiện tại?`,
        "download-cloud",
      ) ? "OVERWRITE" : null;
    if (!action) return false;
    const applied = await client.applyOpening({
      previewId: preview.previewId,
      expectedPackageRowVersion: preview.package.rowVersion,
      workspaceLease: view.model.activeWorkspaceLease || null,
    });
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
        && (action === "OVERWRITE" || !String(price.value || "").trim())
      ) {
        price.value = view.model.formatVND(source.bidPrice);
      }
      if (
        discount
        && source.discountRate != null
        && (action === "OVERWRITE" || !String(discount.value || "").trim())
      ) {
        discount.value = String(source.discountRate).replace(".", ",");
      }
      price?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const openingTime = contentWrapper.querySelector("#op-fin-thoigianmothau");
    if (
      openingTime
      && applied.opening?.openingAt
      && (action === "OVERWRITE" || !openingTime.value)
    ) {
      openingTime.value = view.model.formatForDatetimeLocal(
        applied.opening.openingAt,
      );
      openingTime.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  } catch (error) {
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
    delete button.dataset.loading;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = trustedHTML(originalLabel);
    globalThis.lucide?.createIcons?.();
  }
}
