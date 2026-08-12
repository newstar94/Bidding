"""Versioned parsers from observed portal shapes to the stable contract."""

from __future__ import annotations

from copy import deepcopy
import json

from backend.integrations.muasamcong_browser.artifacts import (
    artifact_arrays,
    artifact_objects,
    same_procurement_family,
)
from backend.integrations.muasamcong_browser.code_mapping import (
    map_contract_type,
    map_optional_boolean,
    map_package_field,
    map_plan_type,
    map_selection_form,
    map_selection_mode,
    normalize_investor_code,
)
from backend.procurement_lookup.domain import ProcurementLookupError


PACKAGE_FIELDS = (
    "notifyNo",
    "notifyId",
    "planNo",
    "bidName",
    "investorName",
    "procuringEntityName",
    "bidPrice",
    "bidPriceUnit",
    "bidGuarantee",
    "capitalDetail",
    "bidField",
    "bidForm",
    "bidMode",
    "processApply",
    "contractType",
    "implementationPeriod",
    "bidCloseDate",
    "bidOpenDate",
    "bidOpenId",
    "inputResultId",
    "isMedicinePackage",
    "isMultiLot",
    "lots",
)


def _exact_object(payload, field, code, preferred_fields):
    matches = [
        item
        for item in artifact_objects(payload)
        if same_procurement_family(item.get(field), code)
    ]
    if not matches:
        raise ProcurementLookupError("PROCUREMENT_NOT_FOUND")
    return max(
        matches,
        key=lambda item: sum(key in item for key in preferred_fields),
    )


def _first_money(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, list) and value:
        return _first_money(value[0])
    return None


def _first_money_field(row, *fields):
    for field in fields:
        value = row.get(field)
        if value not in (None, ""):
            return _first_money(value)
    return None


def _notice_no(row):
    direct = str(row.get("notifyNo") or "").strip().upper()
    if direct:
        return direct
    raw = row.get("linkNotifyInfo")
    if not raw:
        return None
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    value = str((parsed or {}).get("notifyNo") or "").strip().upper()
    return value or None


def _period(row):
    explicit = row.get("implementationPeriod") or row.get("executionPeriod")
    if explicit not in (None, ""):
        return str(explicit)
    value = row.get("cperiod")
    if value in (None, ""):
        return None
    unit = {"D": "ngày", "M": "tháng", "Y": "năm"}.get(
        str(row.get("cperiodUnit") or "").upper(),
        str(row.get("cperiodUnit") or "").strip(),
    )
    return f"{value} {unit}".strip()


def parse_package_row(row):
    raw_lots = (
        row.get("lotDTOList")
        if isinstance(row.get("lotDTOList"), list)
        else row.get("lots")
    )
    lots = None
    if isinstance(raw_lots, list):
        lots = []
        for index, lot in enumerate(raw_lots):
            if not isinstance(lot, dict):
                continue
            normalized_lot = {
                "lotNo": str(lot.get("lotNo") or lot.get("lotCode") or index + 1),
                "lotName": lot.get("lotName") or lot.get("name"),
                "lotPrice": _first_money_field(
                    lot, "lotEstimatePrice", "lotPrice", "bidPrice", "price"
                ),
            }
            bid_guarantee = _first_money_field(
                lot,
                "lotGuaranteeValue",
                "bidGuarantee",
                "bidGuaranteeValue",
                "guaranteeValue",
            )
            execution_period = _period(lot)
            if bid_guarantee is not None:
                normalized_lot["bidGuarantee"] = bid_guarantee
            if execution_period is not None:
                normalized_lot["executionPeriod"] = execution_period
            lots.append(normalized_lot)
        lots = lots or None
    is_multi_lot = map_optional_boolean(row.get("isMultiLot"))
    if is_multi_lot is None and lots and len(lots) > 1:
        is_multi_lot = True
    values = {
        "notifyNo": _notice_no(row),
        "notifyId": row.get("notifyId") or row.get("id"),
        "planNo": row.get("planNo"),
        "bidName": (
            row.get("bidName")[0]
            if isinstance(row.get("bidName"), list) and row.get("bidName")
            else row.get("bidName") or row.get("name")
        ),
        "investorName": row.get("investorName"),
        "procuringEntityName": row.get("procuringEntityName"),
        "bidPrice": _first_money(row.get("bidPrice")),
        "bidPriceUnit": row.get("bidPriceUnit") or "VND",
        "bidGuarantee": _first_money_field(
            row,
            "bidGuarantee",
            "bidGuaranteed",
            "bidGuaranteeValue",
            "totalGuaranteeValue",
            "bidSecurity",
            "bidSecurityValue",
            "guaranteeValue",
        ),
        "capitalDetail": row.get("capitalDetail"),
        "bidField": map_package_field(row.get("bidField")),
        "bidForm": map_selection_form(row.get("bidForm")),
        "bidMode": map_selection_mode(row.get("bidMode")),
        "processApply": row.get("processApply"),
        "contractType": map_contract_type(
            row.get("contractType") or row.get("ctype")
        ),
        "implementationPeriod": _period(row),
        "bidCloseDate": row.get("bidCloseDate"),
        "bidOpenDate": row.get("bidOpenDate"),
        "bidOpenId": row.get("bidOpenId"),
        "inputResultId": row.get("inputResultId"),
        "isMedicinePackage": map_optional_boolean(
            row.get("isMedicine", row.get("isThuoc"))
        ),
        "isMultiLot": is_multi_lot,
        "lots": lots,
    }
    return {field: deepcopy(values.get(field)) for field in PACKAGE_FIELDS}


class PlanParserV1:
    kind = "PLAN"
    version = "2026.1"

    def parse(self, payload, code):
        plan = _exact_object(
            payload,
            "planNo",
            code,
            {
                "planVersion", "name", "planName", "investorName",
                "decisionNo", "investTotal",
            },
        )
        package_rows = []
        for rows in artifact_arrays(payload):
            candidates = [
                row
                for row in rows
                if isinstance(row, dict)
                and (
                    same_procurement_family(row.get("planNo"), code)
                    or row.get("idDetail") is not None
                )
                and any(key in row for key in ("bidName", "bidPrice", "idDetail"))
            ]
            if len(candidates) > len(package_rows):
                package_rows = candidates
        return {
            "planNo": code,
            "planName": plan.get("planName") or plan.get("name"),
            "sourcePlanType": plan.get("planType"),
            "planType": map_plan_type(plan.get("planType")),
            "projectName": plan.get("projectName") or plan.get("pname"),
            "investorCode": normalize_investor_code(
                plan.get("createdBy")
                or next((
                    row.get("createdBy")
                    for row in package_rows
                    if row.get("createdBy")
                ), None)
                or plan.get("investorCode")
                or plan.get("newInvestorCode")
                or next((
                    row.get("investorCode") or row.get("newInvestorCode")
                    for row in package_rows
                    if row.get("investorCode") or row.get("newInvestorCode")
                ), None)
            ),
            "investorName": plan.get("investorName"),
            "totalInvestment": _first_money(
                plan.get("totalInvestment", plan.get("investTotal"))
            ),
            "capitalDetail": plan.get("capitalDetail"),
            "decisionNo": plan.get("decisionNo"),
            "decisionDate": plan.get("decisionDate"),
            "publicDate": plan.get("publicDate"),
            "packages": [parse_package_row(row) for row in package_rows],
        }


class PackageParserV1:
    kind = "PACKAGE"
    version = "2026.1"

    def parse(self, payload, code):
        package = _exact_object(
            payload,
            "notifyNo",
            code,
            {
                "notifyVersion", "notifyId", "bidName", "planNo",
                "investorName", "bidPrice",
            },
        )
        parsed = parse_package_row(package)
        parsed["notifyNo"] = code
        return parsed


class ParserRegistry:
    """Resolve an explicit parser version without leaking source schema upward."""

    def __init__(self, parsers=None):
        selected = parsers or [PlanParserV1(), PackageParserV1()]
        self._parsers = {
            (str(parser.kind).upper(), str(parser.version)): parser
            for parser in selected
        }

    def resolve(self, kind, version=None):
        normalized_kind = str(kind or "").strip().upper()
        candidates = [
            parser
            for (parser_kind, _), parser in self._parsers.items()
            if parser_kind == normalized_kind
        ]
        if version is not None:
            parser = self._parsers.get((normalized_kind, str(version)))
            if parser is None:
                raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
            return parser
        if not candidates:
            raise ProcurementLookupError("PROCUREMENT_ADAPTER_UNSUPPORTED")
        return max(candidates, key=lambda parser: str(parser.version))
