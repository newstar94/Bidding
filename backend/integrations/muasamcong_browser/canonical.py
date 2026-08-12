"""Normalize Mua Sắm Công payloads into Bidding's stable import contract."""

from __future__ import annotations

from copy import deepcopy
import json
from typing import Iterable

from backend.procurement_import.source import ProcurementSourceError
from backend.integrations.muasamcong_browser.code_mapping import (
    map_contract_type,
    map_domestic_scope,
    map_online_mode,
    map_optional_boolean,
    map_package_field,
    map_selection_form,
    map_selection_mode,
)


_PERIOD_UNITS = {"D": "ngày", "M": "tháng", "Y": "năm"}


def pick(row: dict, *aliases, default=None):
    """Return the first present non-empty alias from an upstream object."""

    for alias in aliases:
        if alias in row and row[alias] not in (None, ""):
            return row[alias]
    return default


def _walk(value, *, max_depth=10, max_nodes=10_000) -> Iterable[object]:
    pending = [(value, 0)]
    visited = 0
    while pending and visited < max_nodes:
        item, depth = pending.pop()
        visited += 1
        yield item
        if depth >= max_depth:
            continue
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item[:2_000])


def _same_family(actual, expected):
    return str(actual or "").strip().upper().split("-", 1)[0] == str(
        expected or ""
    ).strip().upper().split("-", 1)[0]


def _best_object(payload, *, identifier, code, preferred):
    matches = [
        item
        for item in _walk(payload)
        if isinstance(item, dict) and _same_family(item.get(identifier), code)
    ]
    if not matches:
        raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
    return max(matches, key=lambda row: sum(key in row for key in preferred))


def _money(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list) and value:
        return _money(value[0])
    if isinstance(value, str):
        normalized = value.replace(".", "").replace(",", "").strip()
        if normalized.isdigit():
            return int(normalized)
    return None


def _period(row):
    explicit = pick(row, "implementationPeriod", "executionPeriod")
    if explicit not in (None, ""):
        return str(explicit)
    value = pick(row, "cperiod", "contractPeriodDT", "bidContractPeriod")
    if value in (None, ""):
        return None
    raw_unit = str(
        pick(row, "cperiodUnit", "contractPeriodDTUnit", default="")
    ).strip().upper()
    return f"{value} {_PERIOD_UNITS.get(raw_unit, raw_unit)}".strip()


def _selection_start(row):
    explicit = pick(row, "selectionStart", "bidStartDate")
    if explicit:
        return str(explicit)
    year = pick(row, "bidStartYear")
    month = pick(row, "bidStartMonth")
    quarter = pick(row, "bidStartQuarter")
    if year and month not in (None, "", 0, "0"):
        return f"{int(year):04d}-{int(month):02d}"
    if year and quarter:
        return f"Quý {quarter}/{year}"
    return str(year or "") or None


def _notice_number(row):
    direct = str(pick(row, "notifyNo", default="") or "").strip().upper()
    if direct:
        return direct.split("-", 1)[0]
    raw = row.get("linkNotifyInfo")
    if not raw:
        return None
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    result = str((value or {}).get("notifyNo") or "").strip().upper()
    return result.split("-", 1)[0] or None


def _lots(row):
    candidates = pick(row, "lots", "lotList", "bidpPlanDetailLotList")
    if not isinstance(candidates, list):
        return None
    result = []
    for index, lot in enumerate(candidates):
        if not isinstance(lot, dict):
            continue
        result.append(
            {
                "lotNo": str(pick(lot, "lotNo", "lotCode", default=index + 1)),
                "lotName": pick(lot, "lotName", "name"),
                "lotPrice": _money(pick(lot, "lotPrice", "bidPrice", "price")),
            }
        )
    return result or None


def _package_rows(payload):
    named = []
    if isinstance(payload, dict):
        for key in (
            "bidpPlanDetailToProjectList",
            "lsBidpPlanDetailDTO",
            "packageRows",
            "bidPackageList",
        ):
            if isinstance(payload.get(key), list):
                named.append(payload[key])
    arrays = [
        item
        for item in _walk(payload)
        if isinstance(item, list)
        and item
        and any(
            isinstance(row, dict)
            and any(field in row for field in ("idDetail", "bidNo", "bidName"))
            for row in item
        )
    ]
    return max((*named, *arrays), key=len, default=[])


def normalize_plan_revision(
    raw: dict,
    *,
    family_no: str,
    revision_id: str,
    revision_number: str,
    source: dict | None = None,
):
    plan = _best_object(
        raw,
        identifier="planNo",
        code=family_no,
        preferred={
            "planVersion",
            "name",
            "planName",
            "investorName",
            "decisionNo",
            "investTotal",
        },
    )
    packages = []
    for index, row in enumerate(_package_rows(raw)):
        if not isinstance(row, dict):
            continue
        notice_no = _notice_number(row)
        notify_id = pick(row, "notifyId")
        notice_version = pick(row, "notifyVersion")
        linked = bool(notice_no)
        source_status = str(pick(row, "status", default="") or "").upper()
        if linked and source_status in {"01", "PUBLISHED", "PUB_TBMT"}:
            source_status = "PUBLISHED"
        packages.append(
            {
                "planDetailRevisionId": str(
                    pick(row, "idDetail", "id", default=f"{revision_id}:{index}")
                ),
                "stablePackageId": str(
                    pick(row, "bidNo", "stablePackageId", "idDetail", "id", default="")
                )
                or None,
                "symbol": str(pick(row, "bidNo", "symbol", default=index + 1)),
                "name": pick(row, "bidName", "name"),
                "summary": pick(row, "generalTasks", "summary"),
                "priceVnd": _money(pick(row, "bidPrice", "priceVnd")),
                "estimatePriceVnd": _money(
                    pick(row, "bidEstimatePrice", "estimatePriceVnd")
                ),
                "field": map_package_field(
                    pick(row, "bidField", "investField", "field")
                ),
                "capitalDetail": pick(row, "capitalDetail", "investmentFunds"),
                "selectionForm": map_selection_form(
                    pick(row, "bidForm", "selectionForm")
                ),
                "selectionMode": map_selection_mode(
                    pick(row, "bidMode", "selectionMode")
                ),
                "evaluationMethod": pick(row, "evaluationMethod"),
                "selectionDuration": str(pick(row, "bidTime", "selectionDuration", default=""))
                or None,
                "selectionStart": _selection_start(row),
                "contractType": map_contract_type(
                    pick(row, "ctype", "contractType")
                ),
                "executionPeriod": _period(row),
                "onlineMode": map_online_mode(pick(row, "isInternet")),
                "domesticOrInternational": map_domestic_scope(
                    pick(row, "isDomestic")
                ),
                "lots": _lots(row),
                "isMultiLot": map_optional_boolean(
                    pick(row, "isMultiLot")
                ),
                "isPrequalification": map_optional_boolean(
                    pick(row, "isPrequalification")
                ),
                "isConcentrateShopping": map_optional_boolean(
                    pick(row, "isConcentrateShopping")
                ),
                "additionalPurchaseOption": pick(
                    row, "additionalChoise", "additionalPurchaseOption"
                ),
                "expectedNotice": not linked,
                "sourceStatus": source_status or None,
                "noticeLink": {
                    "state": "LINKED" if linked else "UNLINKED",
                    "noticeNo": notice_no,
                    "kind": "TBMT" if linked else "UNKNOWN",
                    "noticeRevisionId": str(notify_id or "") or None,
                    "noticeVersion": (
                        str(notice_version).zfill(2)
                        if notice_version not in (None, "")
                        else None
                    ),
                },
            }
        )
    if not packages and int(pick(plan, "bidPack", default=0) or 0) > 0:
        raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
    return {
        "familyNo": family_no,
        "revisionId": str(revision_id),
        "revisionNumber": str(revision_number).zfill(2),
        "name": pick(plan, "planName", "name"),
        "planType": pick(plan, "planType"),
        "projectName": pick(plan, "projectName", "pname", "name"),
        "investorCode": pick(plan, "investorCode", "newInvestorCode"),
        "investorName": pick(plan, "investorName", "newInvestorName"),
        "approvalDecisionNo": pick(plan, "decisionNo", "approvalDecisionNo"),
        "approvalDecisionDate": pick(
            plan, "decisionDate", "approvalDecisionDate"
        ),
        "publishedAt": pick(plan, "publicDate", "publishedAt"),
        "packages": packages,
        "source": deepcopy(source or {}),
    }


def normalize_notice_revision(
    raw: dict,
    *,
    notice_no: str,
    revision_id: str,
    revision_number: str,
    source: dict | None = None,
):
    notice = _best_object(
        raw,
        identifier="notifyNo",
        code=notice_no,
        preferred={
            "notifyVersion",
            "notifyId",
            "bidName",
            "planNo",
            "bidMode",
            "processApply",
        },
    )

    identity = [
        (field, notice.get(field))
        for field in ("notifyNo", "bidNo")
        if notice.get(field) not in (None, "")
    ]
    related = [notice]
    candidates = [
        item
        for item in _walk(raw)
        if isinstance(item, dict)
        and item is not notice
        and any(
            _same_family(item.get(field), expected)
            for field, expected in identity
        )
    ]
    candidates.sort(
        key=lambda row: sum(
            field in row
            for field in (
                "bidPrice", "capitalDetail", "bidField", "investField",
                "ctype", "contractType", "cperiod", "cperiodUnit",
                "implementationPeriod", "executionPeriod",
            )
        ),
        reverse=True,
    )
    related.extend(candidates)

    def related_pick(*aliases, default=None):
        for row in related:
            value = pick(row, *aliases)
            if value not in (None, ""):
                return value
        return default

    execution_period = None
    for row in related:
        execution_period = _period(row)
        if execution_period not in (None, ""):
            break
    process_apply = str(pick(notice, "processApply", default="LDT")).upper()
    return {
        "noticeNo": notice_no,
        "revisionId": str(revision_id),
        "revisionNumber": str(revision_number).zfill(2),
        "kind": "TBMT",
        "notifyId": str(pick(notice, "notifyId", "id", default=revision_id)),
        "planNo": str(pick(notice, "planNo", default="") or "").upper() or None,
        "planDetailRevisionId": pick(
            notice, "planDetailRevisionId", "idDetail", "bidPlanDetailId"
        ),
        "stablePackageId": pick(notice, "bidNo", "stablePackageId"),
        "symbol": pick(notice, "bidNo", "symbol"),
        "name": pick(notice, "bidName", "name"),
        "status": str(pick(notice, "status", default="") or "").upper() or None,
        "publishedAt": pick(notice, "publicDate", "publishedAt"),
        "bidClosingAt": pick(notice, "bidCloseDate", "bidClosingAt"),
        "bidOpeningAt": pick(notice, "bidOpenDate", "bidOpeningAt"),
        "selectionForm": map_selection_form(
            pick(notice, "bidForm", "selectionForm")
        ),
        "selectionMode": map_selection_mode(
            pick(notice, "bidMode", "selectionMode")
        ),
        "priceVnd": _money(related_pick("bidPrice", "priceVnd")),
        "capitalDetail": related_pick(
            "capitalDetail", "investmentFunds"
        ),
        "field": map_package_field(
            related_pick("bidField", "investField", "field")
        ),
        "executionPeriod": execution_period,
        "contractType": map_contract_type(
            related_pick("ctype", "contractType")
        ),
        "onlineMode": map_online_mode(related_pick("isInternet")),
        "domesticOrInternational": map_domestic_scope(
            related_pick("isDomestic")
        ),
        "processApply": process_apply,
        "bidOpenId": pick(notice, "bidOpenId"),
        "inputResultId": pick(notice, "inputResultId"),
        "techReqId": pick(notice, "techReqId"),
        "publicUrl": (
            "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection"
            f"?notifyNo={notice_no}&id={revision_id}"
        ),
        "source": deepcopy(source or {}),
    }


def normalize_opening_bundle(raw_bundle: dict, *, notice_no: str, revision_id: str):
    def opening_objects(value, inherited_lot=None, depth=0):
        if depth > 10:
            return
        if isinstance(value, dict):
            lot_no = pick(value, "lotNo", "lotCode", default=inherited_lot)
            yield {**value, "_inheritedLotNo": lot_no}
            for child in value.values():
                yield from opening_objects(child, lot_no, depth + 1)
        elif isinstance(value, list):
            for child in value[:2_000]:
                yield from opening_objects(child, inherited_lot, depth + 1)

    bidders = []
    seen = set()
    lot_rows = []
    opening_at = None
    for source_key, source_payload in raw_bundle.items():
        phase = "FINANCIAL" if str(source_key).endswith("_2") else "TECHNICAL"
        for item in opening_objects(source_payload):
            if not isinstance(item, dict):
                continue
            opening_at = opening_at or pick(
                item, "bidOpenDate", "bidOpeningAt", "bidRealityOpenDate"
            )
            if isinstance(item.get("lotNoValueDTOList"), list):
                lot_rows.extend(item["lotNoValueDTOList"])
            code = str(
            pick(
                item,
                "contractorCode",
                "contractorCodeStr",
                "taxCode",
                "orgCode",
                "bidderCode",
                default="",
            )
            or ""
            ).strip()
            name = str(
            pick(
                item,
                "contractorName",
                "contractorNameStr",
                "orgName",
                "bidderName",
                default="",
            )
            or ""
            ).strip()
            if not code and not name:
                continue
            identity = (
                code.casefold(),
                name.casefold(),
                str(pick(item, "lotNo", "lotCode", "_inheritedLotNo", default="")),
                phase,
            )
            if identity in seen:
                continue
            seen.add(identity)
            bidder = {
            "contractorCode": code or None,
            "contractorName": name or None,
            "contractorType": pick(item, "contractorType", "typeName", default="INDEPENDENT"),
            "bidPrice": _money(
                pick(
                    item,
                    "bidPrice",
                    "bidValue",
                    "lotPrice",
                    "bidFinalPrice",
                    "bidPriceAfterDiscount",
                    "lotFinalPrice",
                    "price",
                )
            ),
            "discountRate": pick(
                item, "discountRate", "discountPercent", "discount"
            ),
            "priceAfterDiscount": _money(
                pick(
                    item,
                    "bidPriceAfterDiscount",
                    "priceAfterDiscount",
                    "bidFinalPrice",
                    "lotFinalPrice",
                )
            ),
            "bidValidityDays": pick(
                item, "bidValidity", "bidValidityDays", "bidValidityNum"
            ),
            "bidGuarantee": _money(
                pick(item, "bidGuarantee", "bidGuaranteed", "totalGuaranteeValue")
            ),
            "bidGuaranteeValidityDays": pick(
                item, "bidGuaranteeValidity", "bidGuaranteeValidityDays"
            ),
            "executionPeriod": _period(item),
            "lotNo": str(
                pick(item, "lotNo", "lotCode", "_inheritedLotNo", default="")
                or ""
            )
            or None,
            "jointVentureMembers": deepcopy(
                pick(item, "jointVentureMembers", "ventureMembers", "memberList")
                if isinstance(
                    pick(item, "jointVentureMembers", "ventureMembers", "memberList"),
                    list,
                )
                else []
            ),
            "phase": phase,
        }
            bidders.append(bidder)
    lot_rows.extend(
        item
        for source_payload in raw_bundle.values()
        for item in opening_objects(source_payload)
        if isinstance(item, dict)
        and pick(item, "lotNo", "lotCode", "_inheritedLotNo") not in (None, "")
    )
    lots = []
    seen_lots = set()
    for index, row in enumerate(lot_rows):
        if not isinstance(row, dict):
            continue
        lot_no = str(pick(row, "lotNo", "lotCode", default=index + 1))
        if lot_no in seen_lots:
            continue
        seen_lots.add(lot_no)
        lots.append(
            {
                "lotNo": lot_no,
                "lotName": pick(row, "lotName", "name"),
            }
        )
    return {
        "noticeNo": notice_no,
        "revisionId": str(revision_id),
        "openingAt": opening_at,
        "bidders": bidders,
        "lots": lots,
    }


def _result_boolean(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value == 1
    normalized = str(value or "").strip().upper()
    if normalized in {
        "1", "TRUE", "YES", "Y", "WIN", "WINNER", "TRUNG_THAU",
        "TRUNG THAU", "TRÚNG THẦU",
    }:
        return True
    if normalized in {
        "0", "FALSE", "NO", "N", "LOSE", "FAILED", "KHONG_TRUNG_THAU",
        "KHONG TRUNG THAU", "KHÔNG TRÚNG THẦU",
    }:
        return False
    return None


def normalize_result_bundle(raw_bundle: dict, *, notice_no: str, revision_id: str):
    """Normalize selection and technical results without exposing upstream payloads."""

    if not isinstance(raw_bundle, dict):
        raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")

    notice = None
    try:
        notice = _best_object(
            raw_bundle.get("noticeDetail", raw_bundle),
            identifier="notifyNo",
            code=notice_no,
            preferred={
                "notifyId",
                "notifyVersion",
                "status",
                "inputResultId",
                "techReqId",
            },
        )
    except ProcurementSourceError:
        notice = {}

    contractors = []
    seen = set()
    for source_key, source_payload in raw_bundle.items():
        normalized_key = str(source_key).casefold()
        if normalized_key == "technicalresult":
            phase = "TECHNICAL"
        elif normalized_key == "selectionresult":
            phase = "SELECTION"
        else:
            continue
        for item in _walk(source_payload):
            if not isinstance(item, dict):
                continue
            code = str(
                pick(
                    item,
                    "contractorCode",
                    "contractorCodeStr",
                    "taxCode",
                    "orgCode",
                    "bidderCode",
                    default="",
                )
                or ""
            ).strip()
            name = str(
                pick(
                    item,
                    "contractorName",
                    "contractorNameStr",
                    "orgName",
                    "bidderName",
                    default="",
                )
                or ""
            ).strip()
            if not code and not name:
                continue
            lot_no = str(
                pick(item, "lotNo", "lotCode", "lotNumber", default="") or ""
            ).strip() or None
            identity = (code.casefold(), name.casefold(), lot_no, phase)
            if identity in seen:
                continue
            seen.add(identity)
            contractors.append(
                {
                    "contractorCode": code or None,
                    "contractorName": name or None,
                    "lotNo": lot_no,
                    "phase": phase,
                    "rank": pick(item, "rank", "ranking", "contractorRank"),
                    "isWinner": _result_boolean(
                        pick(
                            item,
                            "isWinner",
                            "winner",
                            "winStatus",
                            "isSelected",
                            "result",
                        )
                    ),
                    "technicalStatus": pick(
                        item,
                        "technicalStatus",
                        "techStatus",
                        "evaluationResult",
                        "status",
                    ),
                    "bidPrice": _money(
                        pick(item, "bidPrice", "bidValue", "offeredPrice")
                    ),
                    "evaluatedPrice": _money(
                        pick(
                            item,
                            "evaluatedPrice",
                            "evaluationPrice",
                            "winningPrice",
                            "awardPrice",
                        )
                    ),
                }
            )

    result_objects = [
        item
        for key in ("selectionResult", "technicalResult")
        for item in _walk(raw_bundle.get(key))
        if isinstance(item, dict)
    ]
    metadata = max(
        result_objects,
        key=lambda row: sum(
            field in row
            for field in (
                "status",
                "resultStatus",
                "decisionNo",
                "approvalDecisionNo",
                "decisionDate",
                "approvalDecisionDate",
            )
        ),
        default={},
    )
    has_selection = "selectionResult" in raw_bundle
    has_technical = "technicalResult" in raw_bundle
    if not has_selection and not has_technical:
        raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
    return {
        "noticeNo": notice_no,
        "revisionId": str(revision_id),
        "status": pick(metadata, "resultStatus", "status", default=pick(notice, "status")),
        "approvalDecisionNo": pick(
            metadata, "approvalDecisionNo", "decisionNo", "approveNo"
        ),
        "approvalDecisionDate": pick(
            metadata, "approvalDecisionDate", "decisionDate", "approveDate"
        ),
        "contractors": contractors,
        "hasSelectionResult": has_selection,
        "hasTechnicalResult": has_technical,
    }


def normalize_contract_list(raw_contracts):
    """Map contract list rows while retaining stable upstream identifiers."""

    rows = raw_contracts if isinstance(raw_contracts, list) else []
    contracts = []
    seen = set()
    for item in rows:
        if not isinstance(item, dict):
            continue
        code = str(pick(item, "contractCode", "contractNo", default="") or "").strip()
        contract_id = str(pick(item, "id", "contractId", default="") or "").strip()
        identity = code or contract_id
        if not identity or identity in seen:
            continue
        seen.add(identity)
        contracts.append(
            {
                "contractId": contract_id or None,
                "contractCode": code or None,
                "signedAt": pick(item, "contractDate", "signDate", "signedDate"),
                "status": pick(item, "status", "contractStatus", "statusName"),
                "contractValue": _money(
                    pick(item, "contractValue", "contractPrice", "totalValue")
                ),
                "processApply": pick(item, "processApply"),
                "type": pick(item, "type"),
                "contractorCode": pick(
                    item, "contractorCode", "winningContractorCode"
                ),
                "contractorName": pick(
                    item, "contractorName", "winningContractorName"
                ),
            }
        )
    return contracts


def normalize_notice_complete_bundle(bundle: dict):
    """Project a NOTICE Complete Raw Bundle into a stable aggregate."""

    if not isinstance(bundle, dict):
        raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
    entity = bundle.get("entity") or {}
    notice_no = str(
        entity.get("noticeNo") or entity.get("canonicalCode") or ""
    ).strip().upper()
    if not notice_no:
        raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
    revisions = []
    field_sources = {}
    for revision_number, node in sorted(
        (bundle.get("revisions") or {}).items(),
        key=lambda item: str(item[0]),
    ):
        sources = (node or {}).get("sources") or {}
        detail_source = sources.get("noticeDetail") or {}
        raw_detail = detail_source.get("response")
        if detail_source.get("success") is not True or not isinstance(
            raw_detail, dict
        ):
            continue
        revision_id = str(node.get("revisionId") or "")
        notice = normalize_notice_revision(
            raw_detail,
            notice_no=notice_no,
            revision_id=revision_id,
            revision_number=str(revision_number).zfill(2),
            source={
                "provider": "MUASAMCONG",
                "semanticOperation": detail_source.get("operation"),
                "schemaFingerprint": detail_source.get("schemaFingerprint"),
                "retrievedAt": detail_source.get("retrievedAt"),
            },
        )
        sidecars = {}
        for key in (
            "tenderInfo",
            "hsmt",
            "petition",
            "clarification",
            "prebidConference",
            "planVersionList",
            "planDetail",
            "planPackageDetail",
            "phaseTwo",
            "hsmtPhaseTwo",
        ):
            source = sources.get(key) or {}
            if source.get("success") is True and source.get("response") is not None:
                sidecars[key] = deepcopy(source.get("response"))
        related_notice_raw = {
            "noticeDetail": raw_detail,
            **sidecars,
        }
        notice = normalize_notice_revision(
            related_notice_raw,
            notice_no=notice_no,
            revision_id=revision_id,
            revision_number=str(revision_number).zfill(2),
            source=notice["source"],
        )
        tender_info_source = sources.get("tenderInfo") or {}
        tender_info = tender_info_source.get("response")
        sidecar_override_fields = set()
        if tender_info_source.get("success") is True and isinstance(
            tender_info, dict
        ):
            tender_objects = [
                item for item in _walk(tender_info) if isinstance(item, dict)
            ]

            def sidecar_pick(*aliases):
                for item in tender_objects:
                    value = pick(item, *aliases)
                    if value not in (None, ""):
                        return value
                return None

            sidecar_values = {
                "priceVnd": _money(sidecar_pick("bidPrice", "priceVnd")),
                "capitalDetail": sidecar_pick(
                    "capitalDetail", "investmentFunds"
                ),
                "field": map_package_field(
                    sidecar_pick("bidField", "investField", "field")
                ),
                "contractType": map_contract_type(
                    sidecar_pick("ctype", "contractType")
                ),
            }
            period_row = next(
                (item for item in tender_objects if _period(item)), None
            )
            sidecar_values["executionPeriod"] = (
                _period(period_row) if period_row else None
            )
            for field, value in sidecar_values.items():
                if value not in (None, ""):
                    notice[field] = value
                    sidecar_override_fields.add(field)
        opening_raw = {
            key: source.get("response")
            for key, source in sources.items()
            if key.startswith("opening_") and source.get("success") is True
        }
        result_raw = {
            mapped: (sources.get(key) or {}).get("response")
            for key, mapped in (
                ("selectionResult", "selectionResult"),
                ("technicalResult", "technicalResult"),
            )
            if (sources.get(key) or {}).get("success") is True
        }
        revision = {
            **notice,
            "availableSources": sorted(sidecars),
            "opening": (
                normalize_opening_bundle(
                    opening_raw,
                    notice_no=notice_no,
                    revision_id=revision_id,
                )
                if opening_raw
                else None
            ),
            "result": (
                normalize_result_bundle(
                    {"noticeDetail": raw_detail, **result_raw},
                    notice_no=notice_no,
                    revision_id=revision_id,
                )
                if result_raw
                else None
            ),
        }
        revisions.append(revision)
        for field in (
            "name", "planNo", "priceVnd", "capitalDetail", "field",
            "executionPeriod", "contractType", "selectionMode",
        ):
            if revision.get(field) is not None:
                operation = detail_source.get("operation")
                if (
                    field in sidecar_override_fields
                ):
                    operation = tender_info_source.get("operation")
                field_sources[f"revisions.{revision_number}.{field}"] = {
                    "operation": operation,
                    "revision": str(revision_number),
                    "sourcePath": field,
                }
        if revision.get("opening") is not None:
            field_sources[f"revisions.{revision_number}.opening"] = {
                "operations": sorted(
                    {
                        source.get("operation")
                        for key, source in sources.items()
                        if key.startswith("opening_") and source.get("success") is True
                    }
                ),
                "revision": str(revision_number),
            }
        if revision.get("result") is not None:
            field_sources[f"revisions.{revision_number}.result"] = {
                "operations": [
                    (sources.get(key) or {}).get("operation")
                    for key in ("technicalResult", "selectionResult")
                    if (sources.get(key) or {}).get("success") is True
                ],
                "revision": str(revision_number),
            }
    contract_source = (bundle.get("sources") or {}).get("contractList") or {}
    contracts = normalize_contract_list(
        contract_source.get("response")
        if contract_source.get("success") is True
        else []
    )
    if contracts:
        field_sources["contracts"] = {
            "operation": contract_source.get("operation"),
            "sourcePath": "response",
        }
    return {
        "schemaVersion": "biddingflow-procurement-canonical-v2",
        "mappingSchemaVersion": "biddingflow-muasamcong-mapping-v3",
        "kind": "NOTICE",
        "canonicalCode": notice_no,
        "revisions": revisions,
        "contracts": contracts,
        "fieldSources": field_sources,
    }


class ImportParserRegistry:
    """Select immutable parser versions by schema fingerprint family."""

    version = "2026.08"

    def __init__(self, *, shadow_enabled=False):
        self._parsers = {
            ("plan", "v1"): normalize_plan_revision,
            ("package-notice", "v1"): normalize_notice_revision,
            ("opening", "v1"): normalize_opening_bundle,
            ("result", "v1"): normalize_result_bundle,
        }
        self._shadow_parsers = {}
        self.shadow_enabled = bool(shadow_enabled)

    def register_shadow(
        self,
        kind,
        schema_version,
        parser,
        *,
        parser_version,
    ):
        if not callable(parser):
            raise TypeError("Shadow parser must be callable.")
        self._shadow_parsers[(str(kind), str(schema_version))] = (
            str(parser_version),
            parser,
        )

    def resolve(self, fingerprint):
        parts = str(fingerprint or "").split(":", 2)
        if len(parts) < 2:
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        parser = self._parsers.get((parts[0], parts[1]))
        if parser is None:
            raise ProcurementSourceError("PROCUREMENT_SCHEMA_CHANGED")
        return parser

    def parse(self, fingerprint, raw, *, shadow_observer=None, **kwargs):
        parts = str(fingerprint or "").split(":", 2)
        active = self.resolve(fingerprint)
        canonical = active(raw, **kwargs)
        if not self.shadow_enabled or len(parts) < 2:
            return canonical
        shadow_entry = self._shadow_parsers.get((parts[0], parts[1]))
        if shadow_entry is None:
            return canonical
        shadow_version, shadow = shadow_entry
        event = {
            "status": "MATCH",
            "fingerprint": str(fingerprint),
            "activeParserVersion": self.version,
            "shadowParserVersion": shadow_version,
        }
        try:
            shadow_canonical = shadow(raw, **kwargs)
            if shadow_canonical != canonical:
                event["status"] = "DIFF"
        except Exception:  # noqa: BLE001 - shadow must never affect active parse.
            event["status"] = "ERROR"
        if event["status"] != "MATCH" and callable(shadow_observer):
            shadow_observer(event)
        return canonical
