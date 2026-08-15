"""Map trusted canonical procurement snapshots to editable Bidding drafts."""

from __future__ import annotations

from copy import deepcopy
import re

from backend.shared.domain_enums import PACKAGE_STATUS_LABELS
from backend.procurement_import.domain import (
    derive_import_lifecycle_status,
    has_exact_published_notice,
    project_source_lifecycle_to_bidding,
)


_BIDDING_PACKAGE_CODE = re.compile(r"^IB[0-9]{10}(?:-[0-9]{2})?$", re.I)


def _package_code(*candidates):
    for candidate in candidates:
        value = str(candidate or "").strip().upper()
        if _BIDDING_PACKAGE_CODE.fullmatch(value):
            return value
    return ""


def _package_symbol(value):
    symbol = str(value or "").strip()
    return "" if symbol.upper().startswith("BP") else symbol


def _bidding_package_status(value):
    status = str(value or "UNKNOWN").strip()
    return PACKAGE_STATUS_LABELS.get(status, status)


def _derive_bid_guarantee_validity_days(value):
    """Derive the package guarantee validity from the bid validity rule.

    BiddingFlow's package form uses a fixed 30-day extension for the bid
    guarantee.  MSC does not reliably expose this as a package-level field,
    so keep the derivation in the canonical-to-draft boundary rather than
    leaving the form to depend on a DOM event.
    """

    if isinstance(value, bool) or value in (None, ""):
        return None
    match = re.match(r"^\s*(\d+)", str(value))
    if not match:
        return None
    days = int(match.group(1))
    return days + 30 if days > 0 else None


def _source_revision(provider, family_no, revision):
    return {
        "provider": str(provider or ""),
        "familyNo": str(family_no or ""),
        "revisionId": str(revision.get("revisionId") or ""),
        "revisionNumber": str(revision.get("revisionNumber") or ""),
        "revisionDigest": revision.get("revisionDigest"),
    }


def map_plan_canonical_to_draft(provider, family_no, revision):
    """Return form-shaped plan data while retaining immutable provenance."""

    source = _source_revision(provider, family_no, revision)
    return {
        "maKeHoach": str(family_no or ""),
        "tenKeHoach": revision.get("name") or "",
        "loaiHinhMuaSam": revision.get("planType") or "",
        "tenDuAnDuToan": revision.get("projectName") or "",
        "tongMucDauTu": revision.get("totalAmountVnd"),
        "nguonVon": revision.get("capitalDetail") or "",
        "quyetDinhPheDuyet": revision.get("approvalDecisionNo") or "",
        "ngayPheDuyet": revision.get("approvalDecisionDate") or "",
        "thoiGianDangMa": revision.get("publishedAt"),
        "phienBan": str(revision.get("revisionNumber") or ""),
        "investorSource": {
            "code": revision.get("investorCode"),
            "name": revision.get("investorName"),
            "taxCode": revision.get("investorTaxCode"),
            "approvalDecisionNo": revision.get("approvalDecisionNo") or "",
        },
        "sourceRevision": source,
    }


def map_package_canonical_to_draft(provider, family_no, revision, package):
    """Return package form data without guessing unsupported source enums."""

    source = _source_revision(provider, family_no, revision)
    source["packageObservationId"] = package.get("planDetailRevisionId")
    source["stablePackageId"] = package.get("stablePackageId")
    effective = deepcopy(package.get("effectiveFields") or package)
    # A package enriched while importing a plan keeps notice milestones nested,
    # while a direct IB revision owns the same canonical fields at its root.
    notice = effective.get("noticeFields") or effective
    link = effective.get("noticeLink") or {}
    notice_version = link.get("noticeVersion")
    if notice_version not in (None, ""):
        source["packageRevisionNumber"] = str(notice_version).zfill(2)
    price = effective.get("estimatePriceVnd")
    if price is None:
        price = effective.get("priceVnd")
    bid_validity_days = effective.get("bidValidityDays")
    additional_purchase_items = [
        {
            "sourceItemId": item.get("sourceItemId"),
            "hangMuc": item.get("name") or "",
            "donVi": item.get("unit") or "",
            "soLuong": item.get("quantity"),
            "tyLe": item.get("percentage"),
            "giaTriUocTinh": item.get("estimateValueVnd"),
        }
        for item in (effective.get("additionalPurchaseItems") or [])
        if isinstance(item, dict)
    ]
    goods_items = [
        {
            "sourceItemId": item.get("sourceItemId"),
            "sourceIndex": item.get("sourceIndex"),
            "maPhanLo": item.get("lotNo") or "",
            "tenPhanLo": item.get("lotName") or "",
            "maHangHoa": item.get("code") or "",
            "tenHangHoa": item.get("name") or "",
            "donViTinh": item.get("unit") or "",
            "soLuong": item.get("quantity"),
            "yeuCauKyThuat": item.get("technicalRequirement") or "",
            "kyMaHieuThamChieu": item.get("referenceCode") or "",
            "xuatXuYeuCau": item.get("requiredOrigin") or "",
            "diaDiemGiaoHang": item.get("deliveryLocation") or "",
            "thoiGianGiaoHang": item.get("deliveryTime") or "",
            "ghiChu": item.get("note") or "",
        }
        for item in (effective.get("goodsItems") or [])
        if isinstance(item, dict)
    ]
    return {
        # MSC bidNo/symbol may be a BP... package number. Bidding's package
        # code is the IB... notice number only; an unlinked package has no
        # Bidding code yet.
        "maGoiThau": _package_code(link.get("noticeNo"), family_no),
        "soHieuGoiThau": _package_symbol(effective.get("symbol")),
        "tenGoiThau": effective.get("name") or "",
        "tomTatGoiThau": effective.get("summary") or "",
        "giaGoiThau": price,
        "duToanGoiThau": effective.get("estimatePriceVnd"),
        "linhVuc": effective.get("field"),
        "nguonVon": effective.get("capitalDetail") or "",
        "hinhThucLuaChon": effective.get("selectionForm"),
        "phuongThucLuaChon": effective.get("selectionMode"),
        "phuongPhapDanhGia": effective.get("evaluationMethod"),
        "thoiGianToChuc": effective.get("selectionDuration") or "",
        "thoiGianBatDauToChuc": effective.get("selectionStart") or "",
        "loaiHopDong": effective.get("contractType"),
        "thoiGianThucHien": effective.get("executionPeriod") or "",
        "quaMang": effective.get("onlineMode"),
        "trongNuocQuocTe": effective.get("domesticOrInternational"),
        "phanLo": effective.get("isMultiLot"),
        "goiThauThuoc": effective.get("isMedicinePackage"),
        "danhSachPhanLo": deepcopy(effective.get("lots") or []),
        "danhSachHangHoa": goods_items,
        "soTuyen": effective.get("isPrequalification"),
        "muaSamTapTrung": effective.get("isConcentrateShopping"),
        "tuyChonMuaThem": effective.get("additionalPurchaseOption"),
        "tuyChonMuaThemList": additional_purchase_items,
        "hieuLucHsdt": bid_validity_days,
        "hieuLucDamBaoDuThau": _derive_bid_guarantee_validity_days(
            bid_validity_days
        ),
        "giaTriBaoDamDuThau": effective.get("bidGuaranteeVnd"),
        "soQuyetDinh": effective.get("approvalDecisionNo") or "",
        "ngayQuyetDinh": effective.get("approvalDecisionDate") or "",
        "thoiGianDangTai": notice.get("publishedAt"),
        "thoiGianDongThau": notice.get("bidClosingAt"),
        "trangThai": _bidding_package_status(
            project_source_lifecycle_to_bidding(
                effective.get("lifecycleStatus")
                or derive_import_lifecycle_status(effective),
                has_published_notice=has_exact_published_notice(effective),
            )
        ),
        "yeuCauThamDinhHsmt": "Không",
        "yeuCauThamDinhHsmtCode": "NOT_REQUIRED",
        "sourceStatus": effective.get("sourceStatus"),
        "noticeLink": deepcopy(link),
        "sourceRevision": source,
    }
