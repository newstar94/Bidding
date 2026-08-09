import {
  resolveBidContractorName,
  resolveBidJointVentureMembers,
  resolveContractorVersion
} from "../../partners/contractorVersionBinding.js";
import { setJvData } from "../jvDataStore.js";
import { escapeHtml } from "../../shared/view_helpers.js";

export function renderBidContractorLink(model, bid, jointVentureKey, options = {}) {
  const name = escapeHtml(resolveBidContractorName(model, bid) || bid?.tenNhaThau || "--");
  if (String(bid?.loaiNhaThau || "").trim().toLowerCase() === "liên danh") {
    const members = resolveBidJointVentureMembers(model, bid);
    const lead = members.find((member) => member.vaiTro === "Đứng đầu liên danh");
    setJvData(model, jointVentureKey, {
      members: members.filter((member) => member.vaiTro !== "Đứng đầu liên danh"),
      leadName: lead?.tenNhaThau || bid.tenNhaThau || "",
      leadCode: lead?.maNhaThau || lead?.maSoThue || bid.maNhaThau || bid.maDinhDanh || "",
      leadContractorVersionId: lead?.thanhVienNhaThauId || bid.nhaThauId || ""
    }, options);
    return `<a href="#" data-bf-action="show-jv" data-id="${escapeHtml(jointVentureKey)}" class="text-success fw-bold link-hover" title="Xem thành viên liên danh">👥 ${name}</a>`;
  }
  const contractor = resolveContractorVersion(model, bid);
  return contractor?.id
    ? `<a href="#" data-bf-action="show-contractor" data-id="${escapeHtml(contractor.id)}" class="text-blue fw-bold link-hover">${name}</a>`
    : `<span class="fw-bold">${name}</span>`;
}
