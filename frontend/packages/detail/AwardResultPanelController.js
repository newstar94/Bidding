import { trustedHTML } from "../../shared/trustedTypes.js";
import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { authFetchDownloadWithAlert, escapeHtml, safeAttr } from "../../shared/view_helpers.js";
import { bindCurrencyElement } from "../../app/domUtils.js";
import { setFieldFeedback } from "../../app/formStateUtils.js";
import {
  findContractorVersionByCode,
  getExactContractorVersion,
  resolveBidContractorName,
  resolveBidJointVentureMembers,
} from "../../partners/contractorVersionBinding.js";
import { executeAppCommand } from "../../app/commandBus.js";
import { generateRecordId } from "../../shared/idUtils.js";
import { clearPackageResultEditState } from "../lotEvaluationScope.js";
import { prepareAwardApprovalCommand } from "./AwardResultApprovalCommand.js";
import { awardResultApprovalWorkflow } from "./AwardResultApprovalWorkflow.js";
import { parseLotListForDisplay } from "../lotJsonParser.js";

function isLeadJointVentureMember(member) {
  return String(member?.vaiTro || "").trim().toLocaleLowerCase("vi-VN") === "đứng đầu liên danh";
}

function normalizeContractorCode(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

export function initializeAwardResultBidderRow(view, tr) {
  tr.querySelectorAll(".row-gia-trung").forEach((input) => {
    bindCurrencyElement(input, (value) => view.model.formatVND(value));
  });
  tr.querySelectorAll(".row-tg-goithau").forEach((input) => {
    input.addEventListener("input", (event) => {
      const contractDurationInput = tr.querySelector(".row-tg-hopdong");
      if (contractDurationInput) {
        const value = event.target.value.trim();
        contractDurationInput.value = value
          ? `${value} + Thời gian thực hiện các nghĩa vụ theo hợp đồng`
          : "";
      }
    });
  });
  const contractorTypeSelect = tr.querySelector(".row-loai-nha-thau");
  const jointVentureContainer = tr.querySelector(".row-jv-members-container");
  if (contractorTypeSelect && jointVentureContainer) {
    contractorTypeSelect.addEventListener("change", () => {
      setRuntimeStyle(
        jointVentureContainer,
        "display",
        contractorTypeSelect.value === "Liên danh" ? "block" : "none",
      );
    });
  }
  const manageMembersButton = tr.querySelector(".row-btn-manage-members");
  if (manageMembersButton) {
    manageMembersButton.addEventListener("click", (event) => {
      event.preventDefault();
      const storedViewData = tr._jointVentureViewData || {};
      const viewData = {
        members: storedViewData.members || tr._thanhVienLienDanh || [],
        leadName:
          storedViewData.leadName
          || tr._leadMemberName
          || tr.querySelector(".row-ten-nha-thau")?.value.trim()
          || "",
        leadCode:
          storedViewData.leadCode
          || tr.querySelector(".row-ma-nha-thau")?.value.trim()
          || "",
        leadContractorVersionId:
          storedViewData.leadContractorVersionId
          || tr._leadMemberContractorId
          || "",
      };
      executeAppCommand(
        "openMoThauJVViewModal",
        viewData.members,
        viewData.leadName,
        viewData.leadCode,
        viewData.leadContractorVersionId,
      );
    });
  }
  const contractorCodeInput = tr.querySelector(".row-ma-nha-thau");
  const contractorNameInput = tr.querySelector(".row-ten-nha-thau");
  if (contractorCodeInput && contractorNameInput) {
    const handleCodeChange = () => {
      const code = contractorCodeInput.value.trim();
      if (!code) return;
      const matched = view.model
        .getLatestNhaThau()
        .find(
          (contractor) => contractor.maNhaThau
            && contractor.maNhaThau.trim().toLowerCase() === code.toLowerCase(),
        );
      if (matched) contractorNameInput.value = matched.tenNhaThau || "";
    };
    contractorCodeInput.addEventListener("input", handleCodeChange);
    contractorCodeInput.addEventListener("change", handleCodeChange);
  }
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

function setLoserControls(row) {
  const reason = row.querySelector(".row-ly-do-truot");
  if (reason) {
    reason.disabled = false;
    setRuntimeStyle(reason, "background", "");
    if (!reason.value) {
      reason.value = row.getAttribute("data-default-reason") || "Nhà thầu xếp hạng 1 trúng thầu";
    }
  }
  for (const selector of [".row-gia-trung", ".row-tg-goithau", ".row-tg-hopdong"]) {
    const input = row.querySelector(selector);
    if (!input) continue;
    input.disabled = true;
    setRuntimeStyle(input, "background", "#f1f5f9");
    input.value = "";
  }
}

function setWinnerControls(row) {
  const defaults = new Map([
    [".row-gia-trung", "data-default-price"],
    [".row-tg-goithau", "data-default-duration-pkg"],
    [".row-tg-hopdong", "data-default-duration-ctr"],
  ]);
  defaults.forEach((attribute, selector) => {
    const input = row.querySelector(selector);
    if (!input) return;
    input.disabled = false;
    setRuntimeStyle(input, "background", "");
    input.value = row.getAttribute(attribute) || "";
  });
  const reason = row.querySelector(".row-ly-do-truot");
  if (reason) {
    reason.disabled = true;
    setRuntimeStyle(reason, "background", "#f1f5f9");
    reason.value = "";
  }
}

function bindBidderRows(view, root, pkg, approvalPanel) {
  const tbody = root.querySelector("#approve-bidders-tbody");
  if (!tbody) return;
  approvalPanel.allBids.forEach((bid) => {
    const tr = tbody.querySelector(`tr[data-approve-bid-id="${bid.id}"]`);
    if (!tr) return;
    const data = buildAwardJointVentureViewData(view.model, bid);
    tr._jointVentureViewData = data;
    tr._thanhVienLienDanh = data.members;
    tr._leadMemberName = data.leadName;
    tr._leadMemberContractorId = data.leadContractorVersionId;
  });
  tbody.querySelectorAll("tr").forEach((row) => initializeAwardResultBidderRow(view, row));
  if (approvalPanel.isDirectOrSpecial) {
    tbody.addEventListener("click", async (event) => {
      const removeButton = event.target.closest(".row-remove-bidder");
      const tr = removeButton?.closest("tr");
      if (!tr) return;
      const confirmed = await view.customConfirm(
        "Xác nhận xóa",
        "Bạn có chắc chắn muốn xóa dòng nhà thầu này?",
        "trash-2",
      );
      if (confirmed) tr.remove();
    });
    tbody.addEventListener("change", (event) => {
      if (!event.target.classList.contains("row-ma-phan-lo")) return;
      const tr = event.target.closest("tr");
      const lotName = tr?.querySelector(".row-ten-phan-lo");
      const option = event.target.options[event.target.selectedIndex];
      if (lotName) lotName.value = option?.getAttribute("data-name") || "";
    });
    return;
  }
  tbody.querySelectorAll(".row-status-select").forEach((select) => {
    select.addEventListener("change", (event) => {
      const tr = event.target.closest("tr");
      if (!tr) return;
      if (event.target.value === "trung") {
        const currentLot = tr.cells[0]?.textContent.trim();
        tbody.querySelectorAll("tr").forEach((otherRow) => {
          if (otherRow === tr) return;
          if (pkg.phanLo === "Có") {
            const otherLot = otherRow.cells[0]?.textContent.trim();
            if (otherLot !== currentLot) return;
          }
          const otherSelect = otherRow.querySelector(".row-status-select");
          if (otherSelect && !otherSelect.disabled) otherSelect.value = "truot";
          setLoserControls(otherRow);
        });
        setWinnerControls(tr);
      } else {
        setLoserControls(tr);
      }
    });
  });
}

function bindDecisionFields(root) {
  const radios = root.querySelectorAll('input[name="result-danh-gia-nang-luc"]');
  const reportDateContainer = root.querySelector("#container-date-bao-cao-danh-gia");
  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (reportDateContainer) {
        setRuntimeStyle(reportDateContainer, "display", radio.value === "Có" ? "block" : "none");
      }
    });
  });
  const negotiationDate = root.querySelector("#date-thuong-thao");
  const submissionDate = root.querySelector("#date-trinh-ket-qua");
  const decisionDate = root.querySelector("#award-decision-date");
  negotiationDate?.addEventListener("change", () => {
    if (!submissionDate) return;
    submissionDate.value = negotiationDate.value;
    submissionDate._flatpickr?.setDate(negotiationDate.value);
    if (decisionDate) {
      decisionDate.value = negotiationDate.value;
      decisionDate._flatpickr?.setDate(negotiationDate.value);
    }
  });
  submissionDate?.addEventListener("change", () => {
    if (!decisionDate) return;
    decisionDate.value = submissionDate.value;
    decisionDate._flatpickr?.setDate(submissionDate.value);
  });
}

function appendDirectBidRow(view, root, pkg, tbody, bidData = {}) {
  const rowId = bidData.id || generateRecordId("thongtinmothau");
  const lots = parseLotListForDisplay(pkg.phanLoList, { context: "award_panel" });
  const lotOptions = lots.map((lot) => (
    `<option value="${safeAttr(lot.maPhanLo)}" data-name="${safeAttr(lot.tenPhanLo)}" ${bidData.maPhanLo === lot.maPhanLo ? "selected" : ""}>${escapeHtml(lot.maPhanLo)}</option>`
  )).join("");
  const contractorCode = bidData.maNhaThau || bidData.maDinhDanh || "";
  const contractorName = bidData.tenNhaThau || "";
  const contractorType = bidData.loaiNhaThau || "Độc lập";
  const doc = root.ownerDocument || document;
  const tr = doc.createElement("tr");
  tr.setAttribute("data-cdtrug-id", rowId);
  tr.innerHTML = trustedHTML(`
    ${pkg.phanLo === "Có" ? `
      <td><select class="form-control cdtrug-ma-phan-lo bf-s-1c5ec6d115"><option value="">-- Chọn --</option>${lotOptions}</select></td>
      <td><input type="text" class="form-control cdtrug-ten-phan-lo bf-s-1c5ec6d115" value="${safeAttr(bidData.tenPhanLo || "")}" readonly placeholder="Tên lô"></td>
    ` : ""}
    <td><select class="form-control cdtrug-loai-nha-thau bf-s-1c5ec6d115">
      <option value="Độc lập" ${contractorType === "Độc lập" ? "selected" : ""}>Độc lập</option>
      <option value="Liên danh" ${contractorType === "Liên danh" ? "selected" : ""}>Liên danh</option>
    </select></td>
    <td><input type="text" class="form-control cdtrug-ma-nha-thau bf-s-1c5ec6d115" value="${safeAttr(contractorCode)}" required placeholder="Mã NT"></td>
    <td><input type="text" class="form-control cdtrug-ten-nha-thau bf-s-1c5ec6d115" value="${safeAttr(contractorName)}" required placeholder="Tên nhà thầu"></td>
    <td><input type="text" class="form-control cdtrug-gia-du-thau cdtrug-format-vnd bf-s-1c5ec6d115" value="${safeAttr(bidData.giaDuThau ? view.model.formatVND(bidData.giaDuThau) : "")}" placeholder="Giá dự thầu"></td>
    <td><input type="text" class="form-control cdtrug-ty-le-giam-gia bf-s-f2b3f12563" value="${safeAttr(bidData.tyLeGiamGia !== undefined ? (bidData.tyLeGiamGia || 0).toString().replace(".", ",") : "0")}"></td>
    <td><input type="text" class="form-control cdtrug-gia-sau-giam-gia cdtrug-format-vnd bf-s-67c231a219" value="${safeAttr(bidData.giaSauGiamGia ? view.model.formatVND(bidData.giaSauGiamGia) : "")}" readonly></td>
    <td><input type="text" class="form-control cdtrug-hieu-luc-hsdt bf-s-1c5ec6d115" value="${safeAttr(bidData.hieuLucHsdt ? `${bidData.hieuLucHsdt} ngày` : pkg.hieuLucHsdt ? `${pkg.hieuLucHsdt} ngày` : "90 ngày")}"></td>
    <td><input type="text" class="form-control cdtrug-gia-tri-dam-bao cdtrug-format-vnd bf-s-1c5ec6d115" value="${safeAttr(bidData.giaTriDamBao ? view.model.formatVND(bidData.giaTriDamBao) : "")}" placeholder="Giá trị ĐB"></td>
    <td><input type="text" class="form-control cdtrug-hieu-luc-bao-dam-ngay bf-s-1c5ec6d115" value="${safeAttr(bidData.hieuLucBaoDamNgay ? `${bidData.hieuLucBaoDamNgay} ngày` : pkg.hieuLucDamBaoDuThau ? `${pkg.hieuLucDamBaoDuThau} ngày` : "120 ngày")}"></td>
    <td><input type="text" class="form-control cdtrug-thoi-gian-thuc-hien bf-s-1c5ec6d115" value="${safeAttr(bidData.thoiGianThucHien || pkg.thoiGianThucHien || "")}" placeholder="Thực hiện"></td>
    <td class="bf-s-905008530c"><button type="button" class="action-btn btn-delete cdtrug-remove-row" title="Xóa hàng"><i data-lucide="trash-2" class="bf-s-641778be2c"></i></button></td>
  `);
  const price = tr.querySelector(".cdtrug-gia-du-thau");
  const discount = tr.querySelector(".cdtrug-ty-le-giam-gia");
  const discountedPrice = tr.querySelector(".cdtrug-gia-sau-giam-gia");
  const calculateDiscount = () => {
    const value = view.model.parseVND(price?.value) || 0;
    const rate = parseFloat((discount?.value || "0").replace(/,/g, ".")) || 0;
    const result = value * (1 - rate / 100);
    if (discountedPrice) discountedPrice.value = result > 0 ? view.model.formatVND(result) : "";
  };
  price?.addEventListener("input", calculateDiscount);
  discount?.addEventListener("input", calculateDiscount);
  bindCurrencyElement(price, (value) => view.model.formatVND(value));
  bindCurrencyElement(tr.querySelector(".cdtrug-gia-tri-dam-bao"), (value) => view.model.formatVND(value));
  [price, tr.querySelector(".cdtrug-gia-tri-dam-bao")].forEach((input) => {
    input?.addEventListener("blur", () => {
      input.value = view.model.formatVND(view.model.parseVND(input.value)) || "";
    });
  });
  const lotSelect = tr.querySelector(".cdtrug-ma-phan-lo");
  lotSelect?.addEventListener("change", () => {
    const option = lotSelect.options[lotSelect.selectedIndex];
    const lotName = tr.querySelector(".cdtrug-ten-phan-lo");
    if (lotName) lotName.value = option?.getAttribute("data-name") || "";
  });
  tr.querySelector(".cdtrug-remove-row")?.addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
  globalThis.window?.lucide?.createIcons({ root: tr });
}

function bindDirectBidRows(view, root, pkg) {
  const isSpecial = pkg.hinhThucLuaChon === "Chỉ định thầu rút gọn"
    || pkg.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const tbody = root.querySelector("#cdtrug-mothau-tbody");
  if (!isSpecial || !tbody) return;
  const existing = view.model.state.thongtinmothau.filter(
    (bid) => String(bid.goiThauId) === String(pkg.id),
  );
  (existing.length > 0 ? existing : [{}]).forEach((bid) => appendDirectBidRow(view, root, pkg, tbody, bid));
  root.querySelector("#btn-cdtrug-add-bidder")?.addEventListener("click", () => {
    appendDirectBidRow(view, root, pkg, tbody);
  });
}

function appendApprovalBidderRow(view, root, pkg) {
  const tbody = root.querySelector("#approve-bidders-tbody");
  if (!tbody) return;
  const newId = generateRecordId("thongtinmothau");
  const doc = root.ownerDocument || document;
  const tr = doc.createElement("tr");
  tr.setAttribute("data-approve-bid-id", newId);
  tr.setAttribute("data-is-qualified", "true");
  tr.setAttribute("data-nt-id", newId);
  const lots = pkg.phanLo === "Có"
    ? parseLotListForDisplay(pkg.phanLoList, { context: "award_panel" })
    : [];
  const lotCells = pkg.phanLo === "Có" ? `
    <td><select class="form-control row-ma-phan-lo bf-s-3f107fe5ee">${lots.map((lot) => `<option value="${safeAttr(lot.maPhanLo)}" data-name="${safeAttr(lot.tenPhanLo)}">${escapeHtml(lot.maPhanLo)}</option>`).join("")}</select></td>
    <td><input type="text" class="form-control row-ten-phan-lo bf-s-97e02f4332" value="${safeAttr(lots[0]?.tenPhanLo || "")}" readonly></td>
  ` : "";
  tr._thanhVienLienDanh = [];
  tr._leadMemberName = "";
  tr._jointVentureViewData = { members: [], leadName: "", leadCode: "", leadContractorVersionId: "" };
  tr.innerHTML = trustedHTML(`
    ${lotCells}
    <td><select class="form-control row-loai-nha-thau bf-s-3f107fe5ee"><option value="Độc lập" selected>Độc lập</option><option value="Liên danh">Liên danh</option></select></td>
    <td><input type="text" class="form-control row-ma-nha-thau bf-s-3f107fe5ee" value="" placeholder="Mã nhà thầu"></td>
    <td><input type="text" class="form-control row-ten-nha-thau bf-s-3f107fe5ee" value="" placeholder="Tên nhà thầu"><div class="row-jv-members-container bf-s-e9ebaa0dab"><button type="button" class="btn btn-outline btn-xs row-btn-manage-members bf-s-32804fa5c4"><i data-lucide="users" class="bf-s-38e6fd7439"></i><span class="row-jv-btn-text">Xem thành viên liên danh (0)</span></button></div></td>
    <td><input type="text" class="form-control row-gia-trung bf-s-aa4eecce78" value="" placeholder="Giá trúng..."></td>
    <td><input type="text" class="form-control row-tg-goithau bf-s-aa4eecce78" value="${safeAttr(pkg.thoiGianThucHien || "")}" placeholder="Thời gian gói..."></td>
    <td><input type="text" class="form-control row-tg-hopdong bf-s-aa4eecce78" value="${safeAttr(pkg.thoiGianThucHien ? `${pkg.thoiGianThucHien} + Thời gian thực hiện các nghĩa vụ theo hợp đồng` : "")}" placeholder="Thời gian HĐ..."></td>
    <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete row-remove-bidder bf-s-2e8164f9a4" aria-label="Xóa nhà thầu"><i data-lucide="trash-2" class="bf-s-3e32597019"></i></button></td>
  `);
  tbody.appendChild(tr);
  view.createIconsScoped?.(tr);
  initializeAwardResultBidderRow(view, tr);
}

function bindApprovalSubmit({ view, root, pkg, appController, viewModel, approvalPanel }) {
  const approve = root.querySelector("#btn-approve-award");
  if (!approve) return;
  approve.onclick = async () => {
    if (approvalPanel.isDirectOrSpecial) {
      await executeAppCommand("saveKetQuaChiDinhThau", pkg.id);
      return;
    }
    const command = prepareAwardApprovalCommand({
      root,
      pkg,
      model: view.model,
      isDirectOrSpecial: approvalPanel.isDirectOrSpecial,
    });
    command.errors.forEach((error) => {
      const input = error.element;
      if (!input) return;
      if (error.kind === "field") {
        setFieldFeedback(input, {
          state: "invalid",
          message: input.closest(".form-group")?.querySelector(".error-text")?.textContent || "",
        });
        const clear = () => setFieldFeedback(input);
        input.addEventListener("input", clear);
        input.addEventListener("change", clear);
      } else {
        setRuntimeStyle(input, "border", "1px solid var(--danger)");
        input.addEventListener("input", () => setRuntimeStyle(input, "border", ""));
      }
    });
    if (!command.ok) {
      const first = command.errors.find((error) => error.element)?.element;
      if (first) view.focusInvalidControl(first);
      return;
    }
    await awardResultApprovalWorkflow.execute({
      view,
      pkg,
      command,
      appController,
      viewModel,
    });
  };
}

function bindExcelActions(view, root, pkg, appController) {
  const exportButton = root.querySelector("#btn-result-export-excel-template");
  if (exportButton) {
    exportButton.onclick = () => {
      const safeCode = (pkg.tenGoiThau || "GoiThau").replace(/[^a-zA-Z0-9]/g, "_");
      void authFetchDownloadWithAlert(
        view,
        `/api/export-ketquaqd-template?package_id=${pkg.id}&package_name=${encodeURIComponent(safeCode)}`,
        `KetQua_QD_${safeCode}.xlsx`,
      );
    };
  }
  const importButton = root.querySelector("#btn-result-import-excel");
  if (importButton && appController) {
    importButton.onclick = () => {
      appController._currentResultPackageId = pkg.id;
      appController.triggerExcelImport("ketquaqd");
    };
  }
}

export function bindAwardResultPanelController({
  view,
  root,
  pkg,
  appController,
  viewModel,
  approvalPanel = { allBids: [], isDirectOrSpecial: false },
  rerender,
  persistEditState,
} = {}) {
  if (!view?.model || !root?.querySelector || !pkg) {
    throw new TypeError("Award result panel controller received an invalid context.");
  }
  root.querySelector("#btn-cancel-official-result-edit")?.addEventListener("click", async () => {
    clearPackageResultEditState(pkg);
    view._editingOfficialResultLotBatchId = "";
    view._currentResultLotBatchId = "";
    view._editingWholePackageResult = false;
    view._editingWholePackageResultPackageId = "";
    rerender?.();
    await persistEditState?.();
  });
  bindDecisionFields(root);
  bindBidderRows(view, root, pkg, approvalPanel);
  bindDirectBidRows(view, root, pkg);
  bindApprovalSubmit({ view, root, pkg, appController, viewModel, approvalPanel });
  bindExcelActions(view, root, pkg, appController);
  root.querySelector("#btn-result-add-bidder")?.addEventListener("click", () => {
    appendApprovalBidderRow(view, root, pkg);
  });
}
