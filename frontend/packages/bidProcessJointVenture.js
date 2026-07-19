import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { getAppController } from "../app/controllerRef.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { formatPartnerIdentityCode } from "../app/domUtils.js";
import { executeAppCommand } from "../app/commandBus.js";
import { getPartnerLookupInput, lookupPartnerInfo } from "../partners/partnerTaxLookup.js";
import { resolveContractorVersion } from "../partners/contractorVersionBinding.js";
import {
  renderJointVentureModalBody,
  renderJointVentureModalFooter,
  renderJointVentureModalHeader
} from "./detail/JointVentureModal.js";
import {
  findContractorByCode,
  findDuplicateJvMemberCodes,
  getJointVentureSubMembers,
  mapPartnerLookupToContractor,
  normalizeContractorLookupCode,
  resolveLeadMemberName,
  resolveOpeningLeadContractor
} from "./openingContractorLookup.js";

export function openMoThauJVManager(tr) {
  const leadCode = (tr.querySelector(".mt-ma-nha-thau") || tr.querySelector(".row-ma-nha-thau"))?.value.trim() || "";
  const controller = getAppController();
  const latestNhaThauListJV = controller?.model?.getLatestNhaThau?.() || [];
  const fallbackContractor = resolveOpeningLeadContractor(
    controller?.model,
    latestNhaThauListJV,
    leadCode,
    tr._leadMemberContractorId || tr.dataset.contractorVersionId
  );
  const rowMembers = Array.isArray(tr._thanhVienLienDanh) ? tr._thanhVienLienDanh : [];
  const fallbackMembers = Array.isArray(fallbackContractor?.thanhVienLienDanh) ? fallbackContractor.thanhVienLienDanh : [];
  const members = getJointVentureSubMembers(rowMembers.length > 0 ? rowMembers : fallbackMembers, leadCode);
  const modalId = "modal-mothau-jv-manager";
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();
  modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "modal-overlay active";
  setRuntimeStyle(modal, "zIndex", "2000");
  const card = document.createElement("div");
  card.className = "modal-card";
  setRuntimeStyle(card, "maxWidth", "600px");
  setRuntimeStyle(card, "width", "95%");
  setRuntimeStyle(card, "margin", "20px auto");
  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = trustedHTML(`
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv">&times;</button>
    `);
  const body = document.createElement("div");
  body.className = "modal-body";
  setRuntimeStyle(body, "padding", "20px");
  const foundLeadNt = fallbackContractor;
  const currentLeadCode = normalizeContractorLookupCode(leadCode);
  const leadName = tr._leadMemberCode === currentLeadCode
    ? tr._leadMemberName || resolveLeadMemberName(foundLeadNt, leadCode)
    : resolveLeadMemberName(foundLeadNt, leadCode);
  const displayLeadCode = formatPartnerIdentityCode(leadCode, "Chưa nhập");
  body.innerHTML = trustedHTML(`
        <div class="bf-s-8df25cd500">
            <div class="bf-s-7f07b6bbca">Thành viên đứng đầu liên danh</div>
            <div class="bf-s-16fbb6e0cf">
                <div class="form-group bf-s-4bbf3df076">
                    <label class="bf-s-7a5db2128e">Mã/MST thành viên đứng đầu</label>
                    <input type="text" id="jv-input-lead-code" class="form-control bf-s-76939df48e" value="${escapeHtml(displayLeadCode)}" readonly>
                </div>
                <div class="form-group bf-s-4bbf3df076">
                    <label class="bf-s-7a5db2128e">Tên thành viên đứng đầu</label>
                    <input type="text" id="jv-input-lead-name" class="form-control bf-s-810c9fe5d1" required placeholder="Tên thành viên đứng đầu" value="${escapeHtml(leadName)}">
                </div>
            </div>
        </div>

        <div class="bf-s-48e4421941">
            <h4 class="bf-s-76334239c2">Danh sách Thành viên liên danh</h4>
            <button type="button" class="btn btn-primary btn-sm bf-s-186f022dc5" id="btn-add-mothau-jv-member">
                + Thêm thành viên
            </button>
        </div>

        <div id="mothau-jv-members-list" class="bf-s-fa71b8d74c">
            <!-- Member inputs dynamic list -->
        </div>
    `);
  const footer = document.createElement("div");
  footer.className = "modal-footer";
  footer.innerHTML = trustedHTML(`
        <button type="button" class="btn btn-outline" id="btn-cancel-mothau-jv">Hủy</button>
        <button type="button" class="btn btn-primary" id="btn-save-mothau-jv">Xác nhận</button>
    `);
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  modal.appendChild(card);
  document.body.appendChild(modal);
  const listContainer = document.getElementById("mothau-jv-members-list");
  const leadNameInput = document.getElementById("jv-input-lead-name");
  const lookupInfoByTaxCode = async (code, inputToDim) => {
    const lookupInput = getPartnerLookupInput(code);
    if (!lookupInput) return null;
    try {
      if (inputToDim) setRuntimeStyle(inputToDim, "opacity", "0.7");
      const data = await lookupPartnerInfo({ ...lookupInput, partnerRole: "NT" });
      return data ? await mapPartnerLookupToContractor(code, data) : null;
    } catch (err) {
      console.error("Tax-code lookup during bid opening failed: ", err);
      return null;
    } finally {
      if (inputToDim) setRuntimeStyle(inputToDim, "opacity", "1");
    }
  };
  const fillLeadNameFromCode = async () => {
    if (!leadCode || !leadNameInput) return;
    const localContractor = resolveOpeningLeadContractor(
      controller?.model,
      latestNhaThauListJV,
      leadCode,
      tr._leadMemberContractorId || tr.dataset.contractorVersionId
    );
    const localName = resolveLeadMemberName(localContractor, leadCode);
    if (localName) {
      leadNameInput.value = localName;
      leadNameInput.dataset.autofilled = "1";
      tr._leadMemberName = localName;
      tr._leadMemberLookupData = {
        tenNhaThau: localName,
        maNhaThau: localContractor?.maNhaThau || leadCode,
        maSoThue: localContractor?.maSoThue || "",
        diaChi: localContractor?.diaChi || "",
        diaChiGoc: localContractor?.diaChiGoc || "",
        tenVietTat: localContractor?.tenVietTat || "",
        thanhVienNhaThauId: localContractor?.id || ""
      };
      tr._leadMemberContractorId = localContractor?.id || "";
      tr.dataset.contractorVersionId = localContractor?.id || "";
      tr._leadMemberCode = normalizeContractorLookupCode(leadCode);
      return;
    }
    const apiInfo = await lookupInfoByTaxCode(leadCode, leadNameInput);
    if (apiInfo?.tenNhaThau) {
      if (!leadNameInput.value.trim() || leadNameInput.dataset.autofilled !== "0") {
        leadNameInput.value = apiInfo.tenNhaThau;
      }
      tr._leadMemberName = apiInfo.tenNhaThau;
      tr._leadMemberLookupData = apiInfo;
      tr._leadMemberContractorId = "";
      tr.dataset.contractorVersionId = "";
      tr._leadMemberCode = normalizeContractorLookupCode(leadCode);
    }
  };
  const addMemberRow = (member = { tenNhaThau: "", maSoThue: "" }) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "mothau-jv-member-row";
    setRuntimeStyle(rowDiv, "display", "grid");
    setRuntimeStyle(rowDiv, "gridTemplateColumns", "1fr 1fr auto");
    setRuntimeStyle(rowDiv, "gap", "10px");
    setRuntimeStyle(rowDiv, "alignItems", "center");
    setRuntimeStyle(rowDiv, "padding", "8px");
    setRuntimeStyle(rowDiv, "border", "1px solid var(--border-color)");
    setRuntimeStyle(rowDiv, "borderRadius", "var(--radius-sm)");
    setRuntimeStyle(rowDiv, "background", "var(--bg-nested, rgba(0,0,0,0.02))");
    rowDiv.innerHTML = trustedHTML(`
            <div class="form-group bf-s-4bbf3df076">
                <input type="text" class="jv-input-mst bf-s-810c9fe5d1" required placeholder="Mã số thuế / Mã nhà thầu" value="${escapeHtml(member.maNhaThau || member.maSoThue || "")}">
            </div>
            <div class="form-group bf-s-4bbf3df076">
                <input type="text" class="jv-input-ten bf-s-810c9fe5d1" required placeholder="Tên nhà thầu thành viên" value="${escapeHtml(member.tenNhaThau || "")}">
            </div>
            <button type="button" class="action-btn btn-delete btn-remove-jv-row bf-s-f499e07949" aria-label="Xóa thành viên liên danh"><i data-lucide="trash-2" class="bf-s-58050124fc"></i></button>
        `);
    rowDiv.querySelector(".btn-remove-jv-row").onclick = () => {
      rowDiv.remove();
    };
    const mstInput = rowDiv.querySelector(".jv-input-mst");
    const tenInput = rowDiv.querySelector(".jv-input-ten");
    rowDiv._lookupData = member;
    let lastResolvedMemberCode = normalizeContractorLookupCode(mstInput.value);
    const fillMemberNameFromCode = async (allowOnlineLookup = false) => {
      const code = mstInput.value.trim();
      const normalizedCode = normalizeContractorLookupCode(code);
      if (!normalizedCode) {
        tenInput.value = "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = {};
        lastResolvedMemberCode = "";
        return;
      }
      if (normalizedCode !== lastResolvedMemberCode) {
        tenInput.value = "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = {};
        lastResolvedMemberCode = normalizedCode;
      }
      const found = findContractorByCode(latestNhaThauListJV, code);
      if (found) {
        tenInput.value = found.tenNhaThau || "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = {
          ...found,
          maNhaThau: found.maNhaThau || code,
          maSoThue: found.maSoThue || "",
          tenNhaThau: found.tenNhaThau || ""
        };
        return;
      }
      if (allowOnlineLookup) {
        const apiInfo = await lookupInfoByTaxCode(code, mstInput);
        tenInput.value = apiInfo?.tenNhaThau || "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = apiInfo || {};
      }
    };
    tenInput.addEventListener("input", () => {
      tenInput.dataset.autofilled = "0";
      const lookupInput = getPartnerLookupInput(mstInput.value.trim()) || {};
      rowDiv._lookupData = {
        ...rowDiv._lookupData || {},
        tenNhaThau: tenInput.value.trim(),
        maNhaThau: lookupInput.orgCode || rowDiv._lookupData?.maNhaThau || mstInput.value.trim(),
        maSoThue: lookupInput.taxCode || rowDiv._lookupData?.maSoThue || ""
      };
    });
    mstInput.addEventListener("input", () => fillMemberNameFromCode(false));
    mstInput.addEventListener("change", () => fillMemberNameFromCode(true));
    mstInput.addEventListener("blur", () => fillMemberNameFromCode(true));
    rowDiv._resolveLookup = () => fillMemberNameFromCode(true);
    listContainer.appendChild(rowDiv);
    fillMemberNameFromCode(false);
    lucide.createIcons({ root: rowDiv });
  };
  if (members.length > 0) {
    members.forEach((m) => addMemberRow(m));
  } else {
    addMemberRow();
  }
  fillLeadNameFromCode();
  document.getElementById("btn-add-mothau-jv-member").onclick = () => addMemberRow();
  const closeModal = () => modal.remove();
  document.getElementById("btn-close-mothau-jv").onclick = closeModal;
  document.getElementById("btn-cancel-mothau-jv").onclick = closeModal;
  document.getElementById("btn-save-mothau-jv").onclick = async () => {
    await fillLeadNameFromCode();
    await Promise.all(Array.from(listContainer.querySelectorAll(".mothau-jv-member-row")).map((row) => row._resolveLookup?.()));
    const leadNameInput2 = document.getElementById("jv-input-lead-name").value.trim();
    if (!leadNameInput2) {
      controller?.view?.customAlert?.("Thiếu thông tin", "Vui lòng nhập tên thành viên đứng đầu liên danh!", "alert-triangle", "#jv-input-lead-name");
      return;
    }
    const rows = listContainer.querySelectorAll(".mothau-jv-member-row");
    const updatedMembers = [];
    const invalidInputs = [];
    let valid = true;
    rows.forEach((r) => {
      const inputTen = r.querySelector(".jv-input-ten");
      const inputMst = r.querySelector(".jv-input-mst");
      const ten = inputTen?.value.trim() || "";
      const mst = inputMst?.value.trim() || "";
      if (ten && mst) {
        const lookupInput = getPartnerLookupInput(mst) || {};
        updatedMembers.push({
          ...r._lookupData || {},
          tenNhaThau: ten,
          maNhaThau: r._lookupData?.maNhaThau || lookupInput.orgCode || mst,
          maSoThue: r._lookupData?.maSoThue || lookupInput.taxCode || ""
        });
      } else if (ten || mst) {
        valid = false;
        if (!ten && inputTen) invalidInputs.push(inputTen);
        if (!mst && inputMst) invalidInputs.push(inputMst);
      }
    });
    if (!valid) {
      controller?.view?.customAlert?.("Thiếu thông tin", "Vui lòng điền đầy đủ cả Tên nhà thầu và Mã số thuế của Thành viên liên danh!", "alert-triangle", invalidInputs);
      return;
    }
    const duplicateInputs = findDuplicateJvMemberCodes({
      leadCode,
      leadInput: document.getElementById("jv-input-lead-code"),
      rows
    });
    if (duplicateInputs.length > 0) {
      duplicateInputs.forEach((input) => {
        setRuntimeStyle(input, "border", "1px solid var(--danger)");
        input.addEventListener("input", () => {
          setRuntimeStyle(input, "border", "");
        }, { once: true });
      });
      controller?.view?.customAlert?.("Trùng mã số thuế", "Các thành viên liên danh không được trùng mã số thuế hoặc mã nhà thầu. Vui lòng kiểm tra lại!", "alert-triangle", duplicateInputs);
      return;
    }
    tr._leadMemberName = leadNameInput2;
    tr._thanhVienLienDanh = updatedMembers;
    const labelSpan = tr.querySelector(".mt-jv-btn-text") || tr.querySelector(".row-jv-btn-text");
    if (labelSpan) {
      labelSpan.textContent = `Thành viên liên danh (${updatedMembers.length})`;
    }
    closeModal();
  };
  lucide.createIcons({ root: modal });
}
export function showNhaThauDetailsAndCloseJV(ntId) {
  const jvModal = document.getElementById("modal-mothau-jv-view");
  if (jvModal) jvModal.remove();
  executeAppCommand("showNhaThauDetails", ntId);
}
export function openMoThauJVViewModal(members, leadName, leadCode, leadContractorVersionId = "") {
  const modalId = "modal-mothau-jv-view";
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();
  modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "modal-overlay active";
  setRuntimeStyle(modal, "zIndex", "2000");
  const card = document.createElement("div");
  card.className = "modal-card";
  setRuntimeStyle(card, "maxWidth", "600px");
  setRuntimeStyle(card, "width", "95%");
  setRuntimeStyle(card, "margin", "20px auto");
  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = trustedHTML(renderJointVentureModalHeader());
  const body = document.createElement("div");
  body.className = "modal-body";
  setRuntimeStyle(body, "padding", "20px");
  const appController = getAppController();
  const matchedContractor = resolveContractorVersion(appController?.model, {
    contractorVersionId: leadContractorVersionId,
    code: leadCode
  });
  const visibleMembers = getJointVentureSubMembers(members || [], leadCode);
  const resolvedLeadName = matchedContractor?.tenNhaThau || resolveLeadMemberName(matchedContractor, leadCode) || leadName;
  const displayLeadName = escapeHtml(resolvedLeadName || "Chưa cập nhật");
  const displayLeadCode = escapeHtml(formatPartnerIdentityCode(matchedContractor?.maNhaThau || matchedContractor?.maSoThue || leadCode, "Chưa cập nhật"));
  const leadNtId = matchedContractor?.id || null;
  const leadIdAttr = escapeHtml(leadNtId || "");
  const leadCodeHtml = leadNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${leadIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${displayLeadCode}</a>` : displayLeadCode;
  const leadNameHtml = leadNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${leadIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${displayLeadName}</a>` : displayLeadName;
  let membersHtml = "";
  if (visibleMembers.length === 0) {
    membersHtml = `<div class="bf-s-7fa70bc597"><small>Không có Thành viên liên danh</small></div>`;
  } else {
    membersHtml = visibleMembers.map((m, idx) => {
      const memberContractor = resolveContractorVersion(appController?.model, m);
      const memberCode = escapeHtml(formatPartnerIdentityCode(memberContractor?.maNhaThau || memberContractor?.maSoThue || m.maNhaThau || m.maSoThue, "--"));
      const memberName = escapeHtml(memberContractor?.tenNhaThau || m.tenNhaThau || "--");
      const memberNtId = memberContractor?.id || null;
      const memberIdAttr = escapeHtml(memberNtId || "");
      const mCodeHtml = memberNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${memberIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${memberCode}</a>` : memberCode;
      const mNameHtml = memberNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${memberIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${memberName}</a>` : memberName;
      return `
                <div class="bf-s-a8d71b3a93">
                    <div>
                        <div class="bf-s-68d41663ac">Mã số thuế / Mã nhà thầu</div>
                        <div class="bf-s-f41e7182b7">${mCodeHtml}</div>
                    </div>
                    <div>
                        <div class="bf-s-68d41663ac">Tên thành viên ${idx + 2}</div>
                        <div class="bf-s-f41e7182b7">${mNameHtml}</div>
                    </div>
                </div>
            `;
    }).join("");
  }
  body.innerHTML = trustedHTML(renderJointVentureModalBody({ leadCodeHtml, leadNameHtml, membersHtml }));
  const footer = document.createElement("div");
  footer.className = "modal-footer";
  footer.innerHTML = trustedHTML(renderJointVentureModalFooter());
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  modal.appendChild(card);
  document.body.appendChild(modal);
  const closeModal = () => modal.remove();
  document.getElementById("btn-close-mothau-jv-view").onclick = closeModal;
  document.getElementById("btn-ok-mothau-jv-view").onclick = closeModal;
}
