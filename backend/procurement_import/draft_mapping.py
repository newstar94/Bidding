"""Map trusted canonical procurement snapshots to editable Bidding drafts."""

from __future__ import annotations

from copy import deepcopy
import re

from backend.shared.domain_enums import PACKAGE_STATUS_LABELS
from backend.procurement_import.domain import derive_import_lifecycle_status


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
        "soTuyen": effective.get("isPrequalification"),
        "muaSamTapTrung": effective.get("isConcentrateShopping"),
        "tuyChonMuaThem": effective.get("additionalPurchaseOption"),
        "giaTriBaoDamDuThau": effective.get("bidGuaranteeVnd"),
        "soQuyetDinh": effective.get("approvalDecisionNo") or "",
        "ngayQuyetDinh": effective.get("approvalDecisionDate") or "",
        "thoiGianDangTai": notice.get("publishedAt"),
        "thoiGianDongThau": notice.get("bidClosingAt"),
        "thoiGianMoThau": (
            notice.get("actualOpeningAt")
            or effective.get("actualOpeningAt")
            or notice.get("bidOpeningAt")
        ),
        "thoiGianMoEhsdxtc": (
            notice.get("financialActualOpeningAt")
            or effective.get("financialActualOpeningAt")
        ),
        "trangThai": _bidding_package_status(
            effective.get("lifecycleStatus")
            or derive_import_lifecycle_status(effective)
        ),
        "sourceStatus": effective.get("sourceStatus"),
        "noticeLink": deepcopy(link),
        "sourceRevision": source,
    }
