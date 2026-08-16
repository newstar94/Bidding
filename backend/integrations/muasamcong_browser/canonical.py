"""Normalize Mua Sắm Công payloads into Bidding's stable import contract."""

from __future__ import annotations

from copy import deepcopy
import json
import math
import re
from typing import Iterable

from backend.procurement_import.source import ProcurementSourceError
from backend.integrations.muasamcong_browser.code_mapping import (
    map_contract_type,
    map_domestic_scope,
    map_evaluation_method,
    map_online_mode,
    map_optional_boolean,
    map_package_field,
    map_plan_type,
    map_selection_form,
    map_selection_mode,
    normalize_investor_code,
)


_PERIOD_UNITS = {"D": "ngày", "M": "tháng", "Y": "năm"}


def pick(row: dict, *aliases, default=None):
    """Return the first present non-empty alias from an upstream object."""

    for alias in aliases:
        if alias in row and row[alias] not in (None, ""):
            return row[alias]
    return default


def _source_scalar(value):
    """Unwrap singleton search arrays used for scalar procurement fields."""

    while isinstance(value, list) and len(value) == 1:
        value = value[0]
    return value


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


def _embedded_form_pick(raw, *aliases):
    """Read a scalar from JSON-encoded MSC web-form payloads."""

    for item in _walk(raw):
        if not isinstance(item, dict):
            continue
        value = item.get("formValue")
        if not isinstance(value, str):
            continue
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(parsed, dict):
            continue
        result = pick(parsed, *aliases)
        if result not in (None, ""):
            return result
    return None


def _fallback_package_field(raw):
    """Read the package field from observed source and plan-detail contracts."""

    if isinstance(raw, dict):
        direct = pick(raw, "bidField", "investField", "field")
        if direct not in (None, ""):
            return _source_scalar(direct)

    for item in _walk(raw):
        if not isinstance(item, dict):
            continue
        for key in ("bidpPlanDetail", "bidpPlanDetailDTO"):
            nested = item.get(key)
            if not isinstance(nested, dict):
                continue
            value = pick(nested, "bidField", "investField", "field")
            if value not in (None, ""):
                return _source_scalar(value)
    return None


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


def _number(value):
    """Return a finite source number without accepting boolean coercions."""

    if isinstance(value, bool) or value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        normalized = value.strip().replace(" ", "").replace("%", "")
        if not normalized:
            return None
        if "," in normalized and "." not in normalized:
            normalized = normalized.replace(",", ".")
        try:
            parsed = float(normalized)
        except ValueError:
            return None
        if not math.isfinite(parsed):
            return None
        return int(parsed) if parsed.is_integer() else parsed
    return None


def _positive_days(value):
    parsed = _number(value)
    if parsed is None or parsed <= 0 or int(parsed) != parsed:
        return None
    return int(parsed)


def normalize_additional_purchase_items(row):
    """Normalize MSC ``formValue`` rows while retaining source identity."""

    value = pick(
        row,
        "formValue",
        "additionalPurchaseItems",
        "additionalChoiceList",
        "additionalChoiseList",
    )
    for _ in range(2):
        if not isinstance(value, str):
            break
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
    if isinstance(value, dict):
        value = pick(value, "items", "rows", "data", "value", default=[])
    if not isinstance(value, list):
        return []

    result = []
    for item in value:
        if not isinstance(item, dict):
            continue
        normalized = {
            "sourceItemId": str(pick(
                item, "sourceItemId", "id", "itemId", default=""
            ) or "") or None,
            "name": pick(item, "name", "category", "hangMuc"),
            "unit": pick(item, "unit", "donVi"),
            "quantity": _number(pick(item, "quantity", "qty", "soLuong")),
            "percentage": _number(pick(
                item, "percentage", "percent", "tyLe"
            )),
            "estimateValueVnd": _money(pick(
                item,
                "estimateValueVnd",
                "estimateValue",
                "price",
                "giaTriUocTinh",
            )),
        }
        if any(value not in (None, "") for value in normalized.values()):
            result.append(normalized)
    return result


_GOODS_FORM_CODES = (
    "BD.MT.02.0812",
    "BD.MT.02.1224",
    "BD.MT.02.1281",
)
_EVALUATION_METHOD_FORM_CODES = {"BD.CG.02.0113"}


def _decoded_form_value(value):
    for _ in range(3):
        if not isinstance(value, str):
            break
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    return value


def _form_values(raw, form_codes):
    """Decode values only from explicitly supported MSC form contracts."""

    values = []
    expected = {str(code).strip().upper() for code in form_codes}
    for item in _walk(raw):
        if not isinstance(item, dict):
            continue
        form_code = str(item.get("formCode") or "").strip().upper()
        if form_code not in expected:
            continue
        value = _decoded_form_value(item.get("formValue"))
        if value is not None:
            values.append(value)
    return values


def _form_rows(raw, form_codes):
    rows = []
    for value in _form_values(raw, form_codes):
        if isinstance(value, dict):
            value = pick(
                value,
                "Table",
                "table",
                "items",
                "rows",
                "data",
                "value",
                default=[],
            )
        if isinstance(value, list):
            rows.extend(row for row in value if isinstance(row, dict))
    return rows


def normalize_evaluation_method_form(raw, bid_field):
    """Read the overall evaluation method from its supported E-HSMT form."""

    for value in _form_values(raw, _EVALUATION_METHOD_FORM_CODES):
        if not isinstance(value, dict):
            continue
        return map_evaluation_method(value.get("method"), bid_field)
    return None


def _text(value):
    if value in (None, ""):
        return None
    normalized = str(value).strip()
    return normalized or None


def _goods_lot_indexes(rows):
    by_source_id = {}
    by_code = {}
    for row in rows:
        lot_no = _text(pick(row, "lotNo", "lotCode", "maPhanLo"))
        if not lot_no:
            continue
        lot = (lot_no, _text(pick(row, "lotName", "tenPhanLo")))
        source_lot_id = _text(pick(row, "sourceLotId", "id", "itemId"))
        if source_lot_id:
            by_source_id[source_lot_id] = lot
        by_code[lot_no.casefold()] = lot
    return by_source_id, by_code


def _goods_row_lot(
    row,
    *,
    lot_by_source_id,
    lot_by_code,
    inherited_lot,
    allow_inherited_lot,
):
    explicit_lot_no = _text(pick(row, "lotNo", "lotCode", "maPhanLo"))
    if explicit_lot_no:
        return lot_by_code.get(
            explicit_lot_no.casefold(),
            (explicit_lot_no, _text(pick(row, "lotName", "tenPhanLo"))),
        )

    parent_ids = {
        parent_id
        for alias in ("parent", "tempParent")
        if (parent_id := _text(row.get(alias)))
    }
    if parent_ids:
        parent_lots = {
            lot_by_source_id[parent_id]
            for parent_id in parent_ids
            if parent_id in lot_by_source_id
        }
        if len(parent_lots) == 1:
            return parent_lots.pop()
        # A declared but unresolved/conflicting parent is not safe to replace
        # with the nearest preceding lot.
        return None

    if allow_inherited_lot:
        return inherited_lot
    return None


def _normalize_goods_form_rows(rows, *, allow_inherited_lot, is_multi_lot):
    result = []
    lot_by_source_id, lot_by_code = _goods_lot_indexes(rows)
    inherited_lot_no = None
    inherited_lot_name = None
    for row in rows:
        row_lot_no = _text(pick(row, "lotNo", "lotCode", "maPhanLo"))
        row_lot_name = _text(pick(row, "lotName", "tenPhanLo"))
        if row_lot_no:
            inherited_lot_no = row_lot_no
            inherited_lot_name = row_lot_name
        source_index = _text(pick(
            row, "currentItemIndex", "itemIndex", "stt", "sequence", "pos"
        ))
        source_item_id = _text(pick(
            row, "sourceItemId", "id", "itemId", default=source_index
        ))
        code = _text(pick(
            row, "code", "itemCode", "goodsCode", "maHangHoa",
            default=source_index,
        ))
        name = _text(pick(
            row, "name", "goodsName", "itemName", "tenHangHoa"
        ))
        unit = _text(pick(
            row, "uom", "unit", "unitName", "donViTinh"
        ))
        quantity = _number(pick(
            row, "qty", "quantity", "amount", "soLuong"
        ))
        if not source_item_id or not code or not name or not unit:
            continue
        if quantity is None or quantity <= 0:
            continue
        lot = _goods_row_lot(
            row,
            lot_by_source_id=lot_by_source_id,
            lot_by_code=lot_by_code,
            inherited_lot=(inherited_lot_no, inherited_lot_name),
            allow_inherited_lot=allow_inherited_lot,
        )
        has_parent = any(
            _text(row.get(alias)) for alias in ("parent", "tempParent")
        )
        if is_multi_lot is not False and has_parent and lot is None:
            continue
        lot_no, lot_name = lot or (None, None)
        result.append({
            "sourceItemId": source_item_id,
            "sourceIndex": source_index,
            "lotNo": lot_no,
            "lotName": lot_name,
            "code": code,
            "name": name,
            "unit": unit,
            "quantity": quantity,
            "technicalRequirement": _text(pick(
                row,
                "description",
                "technicalRequirement",
                "technicalSpecifications",
                "specification",
                "yeuCauKyThuat",
            )),
            "referenceCode": _text(pick(
                row, "referenceCode", "modelNo", "model", "kyMaHieuThamChieu"
            )),
            "requiredOrigin": _text(pick(
                row, "requiredOrigin", "origin", "xuatXuYeuCau"
            )),
            "deliveryLocation": _text(pick(
                row, "deliveryLocation", "deliveryPlace", "diaDiemGiaoHang"
            )),
            "deliveryTime": _text(pick(
                row, "deliveryTime", "deliveryPeriod", "thoiGianGiaoHang"
            )),
            "note": _text(pick(row, "note", "notes", "ghiChu")),
        })
    return result


def normalize_goods_items(raw, *, is_multi_lot=None):
    """Normalize goods from verified MSC forms and preserve their lot scope.

    Form ``0812`` carries package-scoped goods whose parent is a non-lot group.
    Form ``1224`` is a legacy interleaved table, so goods without an explicit
    parent inherit the preceding lot heading. Form ``1281`` carries an exact
    ``parent``/``tempParent`` link to the source lot row. Positional fallback
    is deliberately disabled outside ``1224``. Missing values are not
    fabricated and lot headings are never materialized as goods.
    """

    result = []
    seen = set()
    for form_code in _GOODS_FORM_CODES:
        rows = _form_rows(raw, {form_code})
        normalized_rows = _normalize_goods_form_rows(
            rows,
            allow_inherited_lot=form_code == "BD.MT.02.1224",
            is_multi_lot=is_multi_lot,
        )
        for item in normalized_rows:
            if is_multi_lot is False:
                item["lotNo"] = None
                item["lotName"] = None
            identity = (item.get("lotNo") or "", item["sourceItemId"])
            if identity in seen:
                continue
            seen.add(identity)
            result.append(item)
    return result


def normalize_plan_package_goods(raw, *, is_multi_lot=None):
    """Normalize item rows embedded in PLAN_PACKAGE_DETAIL lot DTOs.

    Some MSC medicine packages do not publish an 0812/1224/1281 goods form.
    Their actual item rows are still present in ``bidpBidLotList``.  A lot
    row is an item only when it has a positive quantity, name, unit and a
    stable item/medicine code; otherwise it remains lot metadata.
    """

    if not isinstance(raw, dict):
        return []
    result = []
    seen = set()
    for container in _walk(raw):
        if not isinstance(container, dict):
            continue
        rows = container.get("bidpBidLotList")
        if not isinstance(rows, list):
            continue
        for index, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                continue
            adapted = {
                "id": pick(row, "sourceItemId", "id", "itemId", default=str(index)),
                "currentItemIndex": pick(
                    row, "currentItemIndex", "itemIndex", "stt", "pos",
                    default=str(index),
                ),
                "lotNo": pick(row, "lotNo", "lotCode", "maPhanLo"),
                "lotName": pick(row, "lotName", "tenPhanLo"),
                "code": pick(
                    row, "code", "itemCode", "goodsCode", "medicineCode",
                    default=str(index),
                ),
                "name": pick(
                    row, "name", "goodsName", "itemName", "tenHangHoa",
                    "tenThuoc", "lotName",
                ),
                "uom": pick(row, "uom", "unit", "unitName", "donViTinh"),
                "qty": pick(row, "qty", "quantity", "amount", "soLuong"),
                "description": pick(
                    row, "description", "technicalRequirement",
                    "qualityStandards", "specification",
                ),
                "modelNo": pick(row, "modelNo", "model"),
                "origin": pick(row, "origin", "requiredOrigin"),
                "note": pick(row, "note", "notes"),
            }
            normalized = _normalize_goods_form_rows(
                [adapted],
                allow_inherited_lot=False,
                is_multi_lot=is_multi_lot,
            )
            for item in normalized:
                identity = (item.get("lotNo") or "", item["sourceItemId"])
                if identity in seen:
                    continue
                seen.add(identity)
                result.append(item)
    return result


def _period(row):
    explicit = pick(row, "implementationPeriod", "executionPeriod")
    if explicit not in (None, ""):
        return str(explicit)
    value = pick(
        row,
        "cperiod",
        "cPeriod",
        "contractPeriod",
        "contractPeriodDT",
        "bidContractPeriod",
    )
    if value in (None, ""):
        return None
    raw_unit = str(
        pick(
            row,
            "cperiodUnit",
            "cPeriodUnit",
            "contractPeriodUnit",
            "contractPeriodDTUnit",
            default="",
        )
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


def normalize_lots(row):
    candidates = pick(
        row,
        "lotDTOList",
        "lots",
        "lotList",
        "bidpPlanDetailLotList",
        "bidpBidLotList",
    )
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
                "lotPrice": _money(pick(
                    lot,
                    "lotEstimatePrice",
                    "lotPrice",
                    "bidPrice",
                    "price",
                )),
                "bidGuarantee": _money(pick(
                    lot,
                    "lotGuaranteeValue",
                    "bidGuarantee",
                    "bidGuaranteeValue",
                    "guaranteeValue",
                )),
                "executionPeriod": _period(lot),
            }
        )
    return result or None


def _notice_lots(raw):
    """Return the fullest authoritative tender lot list in notice sidecars."""

    searchable = [raw, *_form_values(raw, {"BD_DATA_TABLE"})]
    candidates = [
        lots
        for source in searchable
        for item in _walk(source)
        if isinstance(item, dict)
        and (lots := normalize_lots(item))
    ]
    return max(
        candidates,
        key=lambda rows: (
            sum(row.get("bidGuarantee") is not None for row in rows),
            len(rows),
        ),
        default=None,
    )


def _source_flag(raw, *aliases):
    for item in _walk(raw):
        if not isinstance(item, dict):
            continue
        value = pick(item, *aliases)
        if value not in (None, ""):
            mapped = map_optional_boolean(value)
            if mapped is not None:
                return mapped
    return None


def _first_nested_value(raw, *aliases):
    """Return the first non-empty scalar alias anywhere in a bounded payload."""

    for item in _walk(raw):
        if not isinstance(item, dict):
            continue
        value = pick(item, *aliases)
        if value not in (None, ""):
            return _source_scalar(value)
    return None


def _approval_decision(raw_detail, hsmt):
    """Read E-HSMT approval without confusing cancellation/result decisions."""

    approved = None
    if isinstance(raw_detail, dict):
        approved = raw_detail.get("bidInvContractorOfflineDTO")
    if not isinstance(approved, dict):
        approved = {}
    return {
        "number": pick(
            approved, "approvalDecisionNo", "decisionNo", "approveNo",
            default=_first_nested_value(
                hsmt, "approvalDecisionNo", "decisionNo", "approveNo"
            ),
        ),
        "date": pick(
            approved, "approvalDecisionDate", "decisionDate", "approveDate",
            default=_first_nested_value(
                hsmt, "approvalDecisionDate", "decisionDate", "approveDate"
            ),
        ),
    }


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
            "totalInvestment",
            "totalAmountVnd",
        },
    )
    package_rows = _package_rows(raw)
    packages = []
    for index, row in enumerate(package_rows):
        if not isinstance(row, dict):
            continue
        notice_no = _notice_number(row)
        is_multi_lot = map_optional_boolean(pick(row, "isMultiLot"))
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
                "lots": normalize_lots(row) if is_multi_lot is True else None,
                "isMultiLot": is_multi_lot,
                "isPrequalification": map_optional_boolean(
                    pick(row, "isPrequalification")
                ),
                "isConcentrateShopping": map_optional_boolean(
                    pick(row, "isConcentrateShopping")
                ),
                "additionalPurchaseOption": map_optional_boolean(pick(
                    row, "additionalChoise", "additionalPurchaseOption"
                )),
                "additionalPurchaseItems": normalize_additional_purchase_items(row),
                "bidValidityDays": _positive_days(pick(
                    row, "bidValidity", "bidValidityDays", "bidValidityNum"
                )),
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
    source_plan_type = pick(plan, "planType")
    return {
        "familyNo": family_no,
        "revisionId": str(revision_id),
        "revisionNumber": str(revision_number).zfill(2),
        "name": pick(plan, "planName", "name"),
        "sourcePlanType": source_plan_type,
        "planType": map_plan_type(source_plan_type),
        "projectName": pick(plan, "projectName", "pname", "name"),
        "investorCode": normalize_investor_code(
            pick(plan, "createdBy")
            or next((
                pick(row, "createdBy")
                for row in package_rows
                if isinstance(row, dict)
                and pick(row, "createdBy")
            ), None)
            or pick(plan, "investorCode", "newInvestorCode")
            or next((
                pick(row, "investorCode", "newInvestorCode")
                for row in package_rows
                if isinstance(row, dict)
                and pick(row, "investorCode", "newInvestorCode")
            ), None)
        ),
        "investorName": pick(plan, "investorName", "newInvestorName"),
        "totalAmountVnd": _money(
            pick(plan, "totalAmountVnd", "totalInvestment", "investTotal")
        ),
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
                return _source_scalar(value)
        return default

    execution_period = None
    for row in related:
        execution_period = _period(row)
        if execution_period not in (None, ""):
            break
    process_apply = str(pick(notice, "processApply", default="LDT")).upper()
    bid_field = (
        related_pick("bidField", "investField", "field")
        or _fallback_package_field(raw)
    )
    lots = _notice_lots(raw)
    is_multi_lot = _source_flag(raw, "isMultiLot")
    if lots and len(lots) > 1:
        is_multi_lot = True
    if is_multi_lot is not True:
        lots = []
    selection_row = next((
        row
        for row in related
        if pick(
            row,
            "bidStartDate",
            "selectionStart",
            "bidStartYear",
        ) not in (None, "")
    ), None)
    return {
        "noticeNo": notice_no,
        "revisionId": str(revision_id),
        "revisionNumber": str(revision_number).zfill(2),
        "kind": "TBMT",
        "notifyId": str(pick(notice, "notifyId", "id", default=revision_id)),
        "planNo": str(pick(notice, "planNo", default="") or "").upper() or None,
        "planDetailRevisionId": pick(
            notice,
            "planDetailRevisionId",
            "idDetail",
            "bidPlanDetailId",
            "bidId",
        ),
        "stablePackageId": pick(notice, "bidNo", "stablePackageId"),
        "symbol": pick(notice, "bidNo", "symbol"),
        "name": _source_scalar(pick(notice, "bidName", "name")),
        "status": str(
            related_pick("bidStatus", "status", default="") or ""
        ).upper() or None,
        "statusForNotify": str(
            related_pick("statusForNotify", default="") or ""
        ).upper() or None,
        "publishedAt": pick(notice, "publicDate", "publishedAt"),
        "bidClosingAt": pick(notice, "bidCloseDate", "bidClosingAt"),
        "bidOpeningAt": pick(notice, "bidOpenDate", "bidOpeningAt"),
        "selectionForm": map_selection_form(
            pick(notice, "bidForm", "selectionForm")
        ),
        "selectionMode": map_selection_mode(
            pick(notice, "bidMode", "selectionMode")
        ),
        "sourceBidPriceVnd": _money(related_pick("bidPrice", "priceVnd")),
        "estimatePriceVnd": _money(related_pick(
            "bidEstimatePrice", "estimatePriceVnd"
        )),
        "priceVnd": (
            _money(related_pick("bidEstimatePrice", "estimatePriceVnd"))
            if _money(related_pick(
                "bidEstimatePrice", "estimatePriceVnd"
            )) is not None
            else _money(related_pick("bidPrice", "priceVnd"))
        ),
        "bidGuaranteeVnd": _money(related_pick(
            "bidGuarantee",
            "bidGuaranteed",
            "bidGuaranteeValue",
            "totalGuaranteeValue",
            "bidSecurity",
            "bidSecurityValue",
            "guaranteeValue",
        )),
        "capitalDetail": related_pick(
            "capitalDetail", "investmentFunds"
        ),
        "field": map_package_field(bid_field),
        "evaluationMethod": normalize_evaluation_method_form(raw, bid_field),
        "executionPeriod": execution_period,
        "contractType": map_contract_type(
            related_pick("ctype", "contractType")
        ),
        "onlineMode": map_online_mode(related_pick("isInternet")),
        "domesticOrInternational": map_domestic_scope(
            related_pick("isDomestic")
        ),
        "processApply": process_apply,
        "additionalPurchaseOption": map_optional_boolean(related_pick(
            "additionalChoise", "additionalPurchaseOption"
        )),
        "additionalPurchaseItems": normalize_additional_purchase_items(
            selection_row or notice
        ),
        "bidValidityDays": _positive_days(
            related_pick("bidValidity", "bidValidityDays", "bidValidityNum")
            or _embedded_form_pick(raw, "effectTimeHSDT")
        ),
        "selectionDuration": str(related_pick(
            "bidTime", "selectionDuration", default=""
        ) or "") or None,
        "selectionStart": _selection_start(selection_row) if selection_row else None,
        "isMedicinePackage": _source_flag(
            raw, "isMedicine", "isThuoc", "isMedicinePackage"
        ),
        "isMultiLot": is_multi_lot,
        "lots": lots,
        "goodsItems": normalize_goods_items(raw, is_multi_lot=is_multi_lot),
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
    package_bid_numbers = {
        str(item.get("bidNo") or "").strip()
        for item in _walk(raw_bundle)
        if isinstance(item, dict) and item.get("bidNo") not in (None, "")
    }

    def lot_scope(item):
        lot_no = str(
            pick(item, "lotNo", "lotCode", "_inheritedLotNo", default="")
            or ""
        ).strip()
        return None if not lot_no or lot_no in package_bid_numbers else lot_no

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

    def opening_phase(source_key):
        return "FINANCIAL" if str(source_key).endswith("_2") else "TECHNICAL"

    def opening_bidder_identity(item):
        code = str(pick(
            item,
            "contractorCode",
            "contractorCodeStr",
            "taxCode",
            "orgCode",
            "bidderCode",
            default="",
        ) or "").strip()
        name = str(pick(
            item,
            "contractorName",
            "contractorNameStr",
            "orgName",
            "bidderName",
            default="",
        ) or "").strip()
        return code.casefold() if code else name.casefold()

    # lotOpenDetail exposes the contractor-lot rows but can return a null
    # guarantee. bid-open is authoritative for the bidder's submitted
    # guarantee, so capture it independently of concurrent response order.
    bid_open_security = {}
    for source_key, source_payload in raw_bundle.items():
        if not str(source_key).casefold().startswith("opening_bid"):
            continue
        phase = opening_phase(source_key)
        for item in opening_objects(source_payload):
            if not isinstance(item, dict):
                continue
            contractor_identity = opening_bidder_identity(item)
            if not contractor_identity:
                continue
            key = (contractor_identity, lot_scope(item) or "", phase)
            security = bid_open_security.setdefault(key, {
                "bidGuarantee": None,
                "bidGuaranteeValidityDays": None,
            })
            guarantee = _money(pick(
                item,
                "bidGuarantee",
                "bidGuaranteed",
                "bidGuaranteeValue",
                "totalGuaranteeValue",
                "bidSecurity",
                "bidSecurityValue",
                "guaranteeValue",
            ))
            validity = pick(
                item, "bidGuaranteeValidity", "bidGuaranteeValidityDays"
            )
            if guarantee is not None:
                security["bidGuarantee"] = guarantee
            if validity not in (None, ""):
                security["bidGuaranteeValidityDays"] = validity

    def authoritative_bid_open_security(bidder):
        contractor_identity = opening_bidder_identity(bidder)
        if not contractor_identity:
            return None
        phase = bidder.get("phase") or "TECHNICAL"
        lot_no = str(bidder.get("lotNo") or "")
        exact = bid_open_security.get((contractor_identity, lot_no, phase))
        summary = bid_open_security.get((contractor_identity, "", phase))
        if exact is None and summary is None:
            return None
        exact = exact or {}
        summary = summary or {}
        return {
            "bidGuarantee": (
                exact.get("bidGuarantee")
                if exact.get("bidGuarantee") is not None
                else summary.get("bidGuarantee")
            ),
            "bidGuaranteeValidityDays": (
                exact.get("bidGuaranteeValidityDays")
                if exact.get("bidGuaranteeValidityDays") not in (None, "")
                else summary.get("bidGuaranteeValidityDays")
            ),
        }

    bidders = []
    seen = set()
    bidders_by_identity = {}
    lot_rows = []
    opening_times_by_phase = {
        "TECHNICAL": {"completed": [], "actual": [], "scheduled": []},
        "FINANCIAL": {"completed": [], "actual": [], "scheduled": []},
    }

    def remember_opening_time(phase, kind, value):
        if value in (None, ""):
            return
        candidates = opening_times_by_phase[phase][kind]
        if value not in candidates:
            candidates.append(value)

    for source_key, source_payload in raw_bundle.items():
        phase = opening_phase(source_key)
        for item in opening_objects(source_payload):
            if not isinstance(item, dict):
                continue
            remember_opening_time(
                phase,
                "completed",
                pick(item, "successBidOpenDate", "successBidOpenDateTc"),
            )
            remember_opening_time(
                phase,
                "actual",
                pick(item, "bidRealityOpenDate", "actualOpeningAt"),
            )
            remember_opening_time(
                phase,
                "scheduled",
                pick(item, "bidOpenDate", "bidOpeningAt"),
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
            source_members = pick(
                item, "jointVentureMembers", "ventureMembers", "memberList"
            )
            source_members = source_members if isinstance(source_members, list) else []
            joint_venture_code = pick(item, "jointVentureCode", "ventureCode")
            joint_venture_name = pick(item, "jointVentureName", "ventureName")
            source_type = str(
                pick(item, "contractorType", "typeName", default="") or ""
            )
            is_joint_venture = bool(
                joint_venture_code
                or joint_venture_name
                or source_members
                or re.search(
                    r"JOINT|VENTURE|LIEN\s*DANH|LIÊN\s*DANH",
                    source_type,
                    re.IGNORECASE,
                )
            )
            identity = (
                code.casefold() if code else name.casefold(),
                lot_scope(item) or "",
                phase,
            )
            if identity in seen:
                existing = bidders_by_identity[identity]
                if is_joint_venture:
                    existing["contractorType"] = "JOINT_VENTURE"
                    if joint_venture_code not in (None, ""):
                        existing["jointVentureCode"] = joint_venture_code
                    if joint_venture_name not in (None, ""):
                        existing["jointVentureName"] = joint_venture_name
                    if source_members and not existing["jointVentureMembers"]:
                        existing["jointVentureMembers"] = deepcopy(source_members)
                continue
            seen.add(identity)
            bidder = {
                "contractorCode": code or None,
                "contractorName": name or None,
                "contractorType": (
                    "JOINT_VENTURE" if is_joint_venture else "INDEPENDENT"
                ),
                "jointVentureCode": joint_venture_code,
                "jointVentureName": joint_venture_name,
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
                    pick(
                        item,
                        "bidGuarantee",
                        "bidGuaranteed",
                        "totalGuaranteeValue",
                    )
                ),
                "bidGuaranteeValidityDays": pick(
                    item, "bidGuaranteeValidity", "bidGuaranteeValidityDays"
                ),
                "executionPeriod": _period(item),
                "lotNo": lot_scope(item),
                "jointVentureMembers": deepcopy(source_members),
                "phase": phase,
            }
            bidders_by_identity[identity] = bidder
            bidders.append(bidder)
    lot_rows.extend(
        item
        for source_payload in raw_bundle.values()
        for item in opening_objects(source_payload)
        if isinstance(item, dict)
        and lot_scope(item) is not None
    )
    lots = []
    seen_lots = set()
    for index, row in enumerate(lot_rows):
        if not isinstance(row, dict):
            continue
        lot_no = lot_scope(row)
        if lot_no is None:
            continue
        if lot_no in seen_lots:
            continue
        seen_lots.add(lot_no)
        lots.append(
            {
                "lotNo": lot_no,
                "lotName": pick(row, "lotName", "name"),
            }
        )
    lot_names_by_no = {
        str(lot["lotNo"]): lot.get("lotName")
        for lot in lots
        if lot.get("lotNo") not in (None, "")
    }
    for bidder in bidders:
        lot_no = bidder.get("lotNo")
        if lot_no not in (None, ""):
            bidder["lotName"] = lot_names_by_no.get(str(lot_no))
        security = authoritative_bid_open_security(bidder)
        if security is not None:
            bidder["bidGuarantee"] = security["bidGuarantee"]
            bidder["bidGuaranteeValidityDays"] = security[
                "bidGuaranteeValidityDays"
            ]

    # Opening endpoints expose both package-level contractor summaries and
    # contractor-lot bid rows. Once a phase has lot-scoped rows, the unscoped
    # rows in that phase are summaries, not additional opening-record lines.
    lot_scoped_phases = {
        bidder.get("phase")
        for bidder in bidders
        if bidder.get("lotNo") not in (None, "")
    }
    if lot_scoped_phases:
        bidders = [
            bidder
            for bidder in bidders
            if (
                bidder.get("lotNo") not in (None, "")
                or bidder.get("phase") not in lot_scoped_phases
            )
        ]

    def first_time(phase, kind):
        values = opening_times_by_phase[phase][kind]
        return values[0] if values else None

    completed_by_phase = {
        phase: first_time(phase, "completed") or first_time(phase, "actual")
        for phase in opening_times_by_phase
    }
    scheduled_by_phase = {
        phase: first_time(phase, "scheduled")
        for phase in opening_times_by_phase
    }
    effective_by_phase = {
        phase: completed_by_phase[phase] or scheduled_by_phase[phase]
        for phase in opening_times_by_phase
    }
    completed_opening_at = (
        completed_by_phase["TECHNICAL"] or completed_by_phase["FINANCIAL"]
    )
    scheduled_opening_at = (
        scheduled_by_phase["TECHNICAL"] or scheduled_by_phase["FINANCIAL"]
    )
    return {
        "noticeNo": notice_no,
        "revisionId": str(revision_id),
        "openingAt": completed_opening_at or scheduled_opening_at,
        "completedOpeningAt": completed_opening_at,
        "scheduledOpeningAt": scheduled_opening_at,
        "financialOpeningAt": effective_by_phase["FINANCIAL"],
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
        notice["status"] = str(
            node.get("sourceStatus") or notice.get("status") or ""
        ).upper() or None
        notice["statusForNotify"] = str(
            node.get("statusForNotify") or notice.get("statusForNotify") or ""
        ).upper() or None
        approval = _approval_decision(raw_detail, sidecars.get("hsmt"))
        notice["approvalDecisionNo"] = approval["number"]
        notice["approvalDecisionDate"] = approval["date"]
        plan_detail_source = sources.get("planDetail") or {}
        plan_detail = plan_detail_source.get("response")
        plan_package = None
        if plan_detail_source.get("success") is True and isinstance(
            plan_detail, dict
        ):
            plan_revision = max(
                (
                    item
                    for item in _walk(plan_detail)
                    if isinstance(item, dict)
                    and _same_family(item.get("planNo"), notice.get("planNo"))
                ),
                key=lambda item: sum(
                    key in item for key in ("id", "planNo", "planVersion")
                ),
                default={},
            )
            notice["linkedPlanRevisionId"] = pick(
                plan_revision, "id", "revisionId"
            )
            linked_plan_version = pick(
                plan_revision, "planVersion", "revisionNumber"
            )
            notice["linkedPlanVersion"] = (
                str(linked_plan_version).zfill(2)
                if linked_plan_version not in (None, "")
                else None
            )
            package_rows = _package_rows(plan_detail)
            notice_identities = {
                str(value)
                for value in (
                    notice.get("planDetailRevisionId"),
                    notice.get("stablePackageId"),
                    notice.get("symbol"),
                )
                if value not in (None, "")
            }
            plan_package = next((
                row
                for row in package_rows
                if isinstance(row, dict)
                and any(
                    str(row.get(key)) in notice_identities
                    for key in ("idDetail", "id", "bidNo", "stablePackageId")
                    if row.get(key) not in (None, "")
                )
            ), None)
            if plan_package is None and notice.get("name"):
                name_matches = [
                    row
                    for row in package_rows
                    if isinstance(row, dict)
                    and str(pick(row, "bidName", "name", default="")).strip()
                    == str(notice.get("name")).strip()
                ]
                if len(name_matches) == 1:
                    plan_package = name_matches[0]
        goods_from_plan_package = False
        if plan_package is not None:
            plan_package_detail_source = sources.get("planPackageDetail") or {}
            plan_package_detail = (
                plan_package_detail_source.get("response")
                if plan_package_detail_source.get("success") is True
                else None
            )
            plan_package_goods = normalize_plan_package_goods(
                plan_package_detail or plan_package,
                is_multi_lot=notice.get("isMultiLot"),
            )
            goods_from_plan_package = bool(
                plan_package_goods and not notice.get("goodsItems")
            )
            if goods_from_plan_package:
                notice["goodsItems"] = plan_package_goods
            additional_purchase_items = normalize_additional_purchase_items(
                plan_package_detail or {}
            )
            if not additional_purchase_items:
                additional_purchase_items = normalize_additional_purchase_items(
                    plan_package
                )
            plan_values = {
                "additionalPurchaseOption": map_optional_boolean(pick(
                    plan_package,
                    "additionalChoise",
                    "additionalPurchaseOption",
                )),
                "additionalPurchaseItems": additional_purchase_items,
                "bidValidityDays": _positive_days(pick(
                    plan_package,
                    "bidValidity",
                    "bidValidityDays",
                    "bidValidityNum",
                )),
                "selectionDuration": str(pick(
                    plan_package,
                    "bidTime",
                    "selectionDuration",
                    default="",
                ) or "") or None,
                "selectionStart": _selection_start(plan_package),
            }
            for field, value in plan_values.items():
                if value is not None:
                    notice[field] = value
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
                "sourceBidPriceVnd": _money(sidecar_pick(
                    "bidPrice", "priceVnd"
                )),
                "estimatePriceVnd": _money(sidecar_pick(
                    "bidEstimatePrice", "estimatePriceVnd"
                )),
                "capitalDetail": sidecar_pick(
                    "capitalDetail", "investmentFunds"
                ),
                "field": map_package_field(
                    sidecar_pick("bidField", "investField", "field")
                ),
                "contractType": map_contract_type(
                    sidecar_pick("ctype", "contractType")
                ),
                "bidGuaranteeVnd": _money(sidecar_pick(
                    "bidGuarantee",
                    "bidGuaranteed",
                    "bidGuaranteeValue",
                    "guaranteeValue",
                )),
                "onlineMode": map_online_mode(sidecar_pick("isInternet")),
            }
            period_row = next(
                (item for item in tender_objects if _period(item)), None
            )
            sidecar_values["executionPeriod"] = (
                _period(period_row) if period_row else None
            )
            sidecar_values["priceVnd"] = (
                sidecar_values["estimatePriceVnd"]
                if sidecar_values["estimatePriceVnd"] is not None
                else sidecar_values["sourceBidPriceVnd"]
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
        opening = (
            normalize_opening_bundle(
                opening_raw,
                notice_no=notice_no,
                revision_id=revision_id,
            )
            if opening_raw
            else None
        )
        revision = {
            **notice,
            "availableSources": sorted(sidecars),
            "actualOpeningAt": (opening or {}).get("openingAt"),
            "financialActualOpeningAt": (opening or {}).get(
                "financialOpeningAt"
            ),
            "opening": opening,
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
            "sourceBidPriceVnd", "estimatePriceVnd",
            "executionPeriod", "contractType", "selectionMode",
            "isMedicinePackage", "isMultiLot", "lots",
            "evaluationMethod",
            "goodsItems",
            "additionalPurchaseOption", "additionalPurchaseItems",
            "bidValidityDays", "selectionDuration", "selectionStart",
            "linkedPlanRevisionId", "linkedPlanVersion",
            "approvalDecisionNo", "approvalDecisionDate", "actualOpeningAt",
            "financialActualOpeningAt",
        ):
            if revision.get(field) is not None:
                operation = detail_source.get("operation")
                if (
                    field in sidecar_override_fields
                ):
                    operation = tender_info_source.get("operation")
                if field in {
                    "additionalPurchaseOption",
                    "additionalPurchaseItems",
                    "bidValidityDays",
                    "selectionDuration",
                    "selectionStart",
                } and plan_package is not None:
                    operation = plan_detail_source.get("operation")
                if field == "goodsItems":
                    operation = (
                        plan_package_detail_source.get("operation")
                        if goods_from_plan_package
                        else (sources.get("hsmt") or {}).get("operation")
                    )
                if field == "evaluationMethod":
                    operation = (sources.get("hsmt") or {}).get("operation")
                source_path = field
                if field == "evaluationMethod":
                    source_path = (
                        "bidoInvBiddingDTO[formCode=BD.CG.02.0113]."
                        "formValue.method"
                    )
                field_sources[f"revisions.{revision_number}.{field}"] = {
                    "operation": operation,
                    "revision": str(revision_number),
                    "sourcePath": source_path,
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
        "mappingSchemaVersion": "biddingflow-muasamcong-mapping-v7",
        "kind": "NOTICE",
        "canonicalCode": notice_no,
        "revisions": revisions,
        "contracts": contracts,
        "fieldSources": field_sources,
    }


class ImportParserRegistry:
    """Select immutable parser versions by schema fingerprint family."""

    version = "2026.08.2"

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
