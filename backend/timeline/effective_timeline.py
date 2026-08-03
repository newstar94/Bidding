"""Pure effective-timeline evaluator backed by the shared declarative catalog."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path


_CATALOG_PATH = Path(__file__).resolve().parents[2] / "shared" / "timeline_rules.json"
CATALOG = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
TIMELINE_TEMPLATE_VERSION = int(CATALOG["catalogVersion"])
SECTION_BY_KEY = {item["sectionKey"]: item for item in CATALOG["sections"]}
MANDATORY_TWO_ENVELOPE_MILESTONES = frozenset({
    "DOCUMENT_RECONCILIATION_INVITATION",
    "DOCUMENT_RECONCILIATION_MINUTES",
    "CONTRACT_NEGOTIATION",
    "CONTRACTOR_SELECTION_RESULT_APPRAISAL",
    "TECHNICAL_RESULT_APPRAISAL",
})


def _normalized(value):
    return " ".join(str(value or "").strip().casefold().split())


def _first(record, keys=()):
    record = record or {}
    for key in keys or ():
        value = record.get(key)
        if value not in (None, ""):
            return value
    return ""


def _list(record, keys=()):
    record = record or {}
    for key in keys:
        if isinstance(record.get(key), list):
            return record[key]
    return []


def _canonical_fact(group, value):
    target = _normalized(value)
    if not target:
        return "UNDETERMINED"
    for code, aliases in CATALOG["factMappings"].get(group, {}).items():
        if value == code or any(_normalized(alias) == target for alias in aliases):
            return code
    return "UNDETERMINED"


def canonical_timeline_facts(package_data=None, plan_data=None):
    package_data = package_data or {}
    plan_data = plan_data or {}
    return {
        "selectionMethod": _canonical_fact(
            "selectionMethod",
            _first(package_data, (
                "hinhThucLuaChonCode", "hinh_thuc_lua_chon_code",
                "hinhThucLuaChon", "hinh_thuc_lua_chon",
            )),
        ),
        "selectionProcedure": _canonical_fact(
            "selectionProcedure",
            _first(package_data, (
                "phuongThucLuaChonCode", "phuong_thuc_lua_chon_code",
                "phuongThucLuaChon", "phuong_thuc_lua_chon",
            )),
        ),
        "planApproval": _canonical_fact(
            "planApproval",
            _first(plan_data, ("pheDuyetCode", "phe_duyet_code", "pheDuyet", "phe_duyet")),
        ),
        "packageField": str(_first(package_data, ("linhVuc", "linh_vuc")) or ""),
    }


def normalize_ehsmt_appraisal_requirement(package_data=None):
    package_data = package_data or {}
    coded = str(_first(package_data, (
        "yeuCauThamDinhHsmtCode", "yeu_cau_tham_dinh_hsmt_code",
    )) or "").upper()
    if coded in CATALOG["appraisalRequirementStates"]:
        return coded
    legacy = _first(package_data, ("yeuCauThamDinhHsmt", "yeu_cau_tham_dinh_hsmt"))
    if legacy is True or legacy == 1 or _normalized(legacy) in {"có", "co", "required", "true", "1"}:
        return "REQUIRED"
    if legacy is False or legacy == 0 or _normalized(legacy) in {"không", "khong", "not_required", "false", "0"}:
        return "NOT_REQUIRED"
    return "UNDETERMINED"


def _parse_metadata(raw):
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _contract_kind(contract):
    label = _normalized(_first(contract, ("phanLoai", "phan_loai")))
    if label in {"tư vấn", "tu van", "consulting"} or "tvl" in label or "tư vấn lập" in label:
        return "preparation"
    if label in {"thẩm định", "tham dinh", "appraisal"} or "tvt" in label or "tư vấn thẩm" in label:
        return "appraisal"
    return ""


def _has_appointment_decision(contract):
    flag = _first(contract, ("coQdChiDinh", "co_qd_chi_dinh"))
    if flag != "":
        return flag is True or flag == 1 or _normalized(flag) in {"1", "true", "có", "co"}
    return bool(_first(contract, (
        "soQdChiDinh", "so_qd_chi_dinh", "ngayQdChiDinh", "ngay_qd_chi_dinh",
    )))


def _active(items):
    return [
        item for item in (items if isinstance(items, list) else [])
        if not _first(item, ("archivedAt", "archived_at", "deletedAt", "deleted_at"))
    ]


def _version_ehsmt_adjustment(package_data):
    try:
        sequence = int(_first(package_data, ("phienBan", "phien_ban")) or 0)
    except (TypeError, ValueError):
        sequence = 0
    package_id = str(_first(package_data, ("id",)) or "").strip()
    if sequence <= 0 or not package_id:
        return None
    return {
        "id": f"package-version:{package_id}",
        "sequence": sequence,
        "reason": "Điều chỉnh E-HSMT theo phiên bản gói thầu",
        "submissionNumber": "",
        "submissionDate": "",
        "appraisalReportNumber": "",
        "appraisalReportDate": "",
        "approvalDecisionNumber": _first(package_data, ("soQuyetDinh", "so_quyet_dinh")),
        "approvalDecisionDate": _first(package_data, ("ngayQuyetDinh", "ngay_quyet_dinh")),
        "publishedAt": _first(package_data, ("thoiGianDangTai", "thoi_gian_dang_tai")),
    }


def _sequence_number(record):
    try:
        return int(_first(record, ("sequence", "thuTu", "thu_tu")) or 0)
    except (TypeError, ValueError):
        return 0


def _related(package_data, related_entities):
    related = dict(related_entities or {})
    contracts = _active(related.get("contracts") or related.get("hopDong") or [])
    metadata = _parse_metadata(_first(package_data, (
        "danhGiaHsdtMetadata", "danh_gia_hsdt_metadata",
    )))
    technical = metadata.get("technical") if isinstance(metadata.get("technical"), dict) else metadata
    raw_adjustments = (
        related.get("ehsmtAdjustments")
        if isinstance(related.get("ehsmtAdjustments"), list)
        else _list(package_data, ("ehsmtAdjustments", "ehsmt_adjustments"))
    )
    version_adjustment = _version_ehsmt_adjustment(package_data)
    has_version_adjustment = version_adjustment and any(
        str(_first(item, ("id",)) or "") == version_adjustment["id"]
        or _sequence_number(item) == version_adjustment["sequence"]
        for item in raw_adjustments
    )
    inferred_adjustments = list(raw_adjustments)
    if version_adjustment and not has_version_adjustment:
        inferred_adjustments.append(version_adjustment)
    related.update({
        "contracts": contracts,
        "preparationContract": next((item for item in contracts if _contract_kind(item) == "preparation"), {}),
        "appraisalContract": next((item for item in contracts if _contract_kind(item) == "appraisal"), {}),
        "technicalEvaluation": related.get("technicalEvaluation") or technical or {},
        "financialEvaluation": related.get("financialEvaluation") or metadata.get("financial") or {},
        "resultEvaluation": related.get("resultEvaluation") or metadata.get("result") or {},
        "ehsmtAdjustments": _active(inferred_adjustments),
        "clarificationRequests": _active(related.get("clarificationRequests") or _list(package_data, ("yeuCauLamRoList", "yeu_cau_lam_ro_list"))),
        "clarificationResponses": _active(related.get("clarificationResponses") or _list(package_data, ("traLoiLamRoList", "tra_loi_lam_ro_list"))),
        "extensions": _active(related.get("extensions") or _list(package_data, ("giaHanList", "gia_han_list"))),
        "expertTeam": related.get("expertTeam") or _list(package_data, ("toChuyenGia", "to_chuyen_gia")),
        "appraisalTeam": related.get("appraisalTeam") or _list(package_data, ("toThamDinh", "to_tham_dinh")),
    })
    related["effectiveClosingTime"] = resolve_latest_bid_closing_time(
        package_data, {"extensions": related["extensions"]}
    )
    return related


def _date_only(value):
    raw = str(value or "").strip()
    if len(raw) >= 10 and raw[4:5] == "-" and raw[7:8] == "-":
        return raw[:10]
    try:
        return datetime.strptime(raw, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return ""


def _date_time_value(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) >= 10 and raw[4:5] == "-" and raw[7:8] == "-":
        return raw
    for pattern in ("%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, pattern).isoformat(timespec="seconds")
        except ValueError:
            continue
    return ""


def resolve_latest_bid_closing_time(package_data=None, related_entities=None):
    package_data = package_data or {}
    related_entities = related_entities or {}
    candidates = [_date_time_value(_first(package_data, ("thoiGianDongThau", "thoi_gian_dong_thau")))]
    candidates.extend(
        _date_time_value(_first(item, ("thoiGianDongThau", "thoi_gian_dong_thau")))
        for item in _active(related_entities.get("extensions") or related_entities.get("giaHanList") or related_entities.get("gia_han_list") or [])
    )
    return max((value for value in candidates if value), default="")


def _source_values(definition, package_data, plan_data, related, entity=None):
    source = definition.get("source")
    if not source:
        return {"number": "", "date": "", "sourceKey": ""}
    if source.get("entity"):
        record = entity or {}
    elif source.get("record") == "package":
        record = package_data
    elif source.get("record") == "plan":
        record = plan_data
    else:
        record = related.get(source.get("record"), {})
    return {
        "number": str(_first(record, source.get("numberFields", ())) or ""),
        "date": _date_only(_first(record, source.get("dateFields", ()))),
        "sourceKey": (
            f"{source['entity']}.{_first(record, ('id',))}"
            if source.get("entity") else str(source.get("record") or "")
        ),
    }


def _has_saved_data(saved):
    return bool(_first(saved, (
        "soVanBan", "so_van_ban", "ngayDuKien", "ngay_du_kien",
        "ngayThucTe", "ngay_thuc_te",
    ))) or str(_first(saved, ("trangThai", "trang_thai"))).upper() in {"IN_PROGRESS", "DONE"}


def _has_appraisal_evidence(package_data, related):
    return bool(
        _first(package_data, (
            "soBaoCaoThamDinhHsmt", "so_bao_cao_tham_dinh_hsmt",
            "ngayBaoCaoThamDinhHsmt", "ngay_bao_cao_tham_dinh_hsmt",
        ))
        or related.get("appraisalContract")
        or related.get("appraisalTeam")
    )


def _is_consulting_package(facts):
    return _normalized(facts.get("packageField")) in {
        "tư vấn", "tu van", "consulting", "tu_van",
    }


def _rule_result(definition, *, facts, package_data, related, saved, source):
    tags = set(definition.get("tags", ()))
    rule = definition["applicabilityRule"]
    has_data = _has_saved_data(saved) or bool(source["number"] or source["date"])
    if rule == "CONSULTANT_PREPARATION_APPOINTMENT":
        if str(related.get("preparationConsultantMode") or "").upper() == "INTERNAL":
            return "NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_PREPARATION"
        if _has_appointment_decision(related.get("preparationContract")):
            return "APPLICABLE", "INCLUDED_BY_PREPARATION_APPOINTMENT_DECISION"
        if related.get("expertTeam") or _is_consulting_package(facts) or has_data:
            return "APPLICABLE", "INCLUDED_BY_PREPARATION_CONSULTANT_PROCESS"
        return "NOT_APPLICABLE", "EXCLUDED_WITHOUT_PREPARATION_APPOINTMENT_DECISION"
    if rule == "CONSULTANT_APPRAISAL_APPOINTMENT":
        if str(related.get("appraisalConsultantMode") or "").upper() == "INTERNAL":
            return "NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_APPRAISAL"
        if _has_appointment_decision(related.get("appraisalContract")):
            return "APPLICABLE", "INCLUDED_BY_APPRAISAL_APPOINTMENT_DECISION"
        if related.get("appraisalTeam") or _is_consulting_package(facts) or has_data:
            return "APPLICABLE", "INCLUDED_BY_APPRAISAL_CONSULTANT_PROCESS"
        return "NOT_APPLICABLE", "EXCLUDED_WITHOUT_APPRAISAL_APPOINTMENT_DECISION"
    if facts["selectionMethod"] == "COMPETITIVE_OFFERING" and "APPRAISAL" in tags:
        return "NOT_APPLICABLE", "EXCLUDED_BY_COMPETITIVE_OFFERING"
    if facts["selectionProcedure"] == "ONE_STAGE_ONE_ENVELOPE" and "TWO_ENVELOPE_ONLY" in tags:
        return "NOT_APPLICABLE", "EXCLUDED_BY_ONE_STAGE_ONE_ENVELOPE"
    if facts["selectionMethod"] in {"DIRECT_APPOINTMENT", "DIRECT_APPOINTMENT_SIMPLIFIED"} and "COMPETITIVE_TENDER" in tags:
        return "NOT_APPLICABLE", "EXCLUDED_BY_DIRECT_APPOINTMENT"
    if facts["selectionMethod"] == "DIRECT_APPOINTMENT_SIMPLIFIED" and "APPRAISAL" in tags:
        return "NOT_APPLICABLE", "EXCLUDED_BY_SIMPLIFIED_DIRECT_APPOINTMENT"
    if facts["selectionProcedure"] == "ONE_STAGE_TWO_ENVELOPES" and definition["milestoneKey"] in MANDATORY_TWO_ENVELOPE_MILESTONES:
        return "APPLICABLE", "INCLUDED_BY_ONE_STAGE_TWO_ENVELOPES"
    if rule == "CONTRACT_NEGOTIATION":
        is_eligible = (
            facts["selectionMethod"] == "DIRECT_APPOINTMENT_SIMPLIFIED"
            or facts["selectionProcedure"] == "ONE_STAGE_TWO_ENVELOPES"
            or _is_consulting_package(facts)
        )
        if not is_eligible:
            return "NOT_APPLICABLE", "EXCLUDED_BY_CONTRACT_NEGOTIATION_SCOPE"
        return (
            ("APPLICABLE", "INCLUDED_BY_CONTRACT_NEGOTIATION_DATA")
            if has_data
            else ("CONDITIONAL", "WAITING_FOR_CONTRACT_NEGOTIATION_DATA")
        )
    if facts["selectionMethod"] == "DIRECT_APPOINTMENT_SIMPLIFIED" and "OPTIONAL" in tags and not has_data:
        return "NOT_APPLICABLE", "EXCLUDED_BY_SIMPLIFIED_DIRECT_APPOINTMENT"
    if rule == "PLAN_SEPARATE":
        if facts["planApproval"] == "COMBINED":
            return "NOT_APPLICABLE", "EXCLUDED_BY_COMBINED_PLAN"
        if facts["planApproval"] == "SEPARATE":
            return "APPLICABLE", "INCLUDED_BY_SEPARATE_PLAN"
        return "CONDITIONAL", "WAITING_FOR_PLAN_APPROVAL_MODE"
    if rule == "PLAN_COMBINED":
        if facts["planApproval"] == "SEPARATE":
            return "NOT_APPLICABLE", "EXCLUDED_BY_SEPARATE_PLAN"
        if facts["planApproval"] == "COMBINED":
            return "APPLICABLE", "INCLUDED_BY_COMBINED_PLAN"
        return "CONDITIONAL", "WAITING_FOR_PLAN_APPROVAL_MODE"
    if rule == "E_HSMT_APPRAISAL":
        decision = normalize_ehsmt_appraisal_requirement(package_data)
        evidence = _has_appraisal_evidence(package_data, related) or has_data
        if decision == "NOT_REQUIRED" and evidence:
            return "CONDITIONAL", "CONFLICT_E_HSMT_APPRAISAL_DATA"
        if decision == "NOT_REQUIRED":
            return "NOT_APPLICABLE", "EXCLUDED_BY_E_HSMT_APPRAISAL_DECISION"
        if decision == "REQUIRED" or evidence:
            return "APPLICABLE", "INCLUDED_BY_APPRAISAL_DATA" if evidence else "INCLUDED_BY_E_HSMT_APPRAISAL_DECISION"
        return "CONDITIONAL", "WAITING_FOR_E_HSMT_APPRAISAL_DECISION"
    if rule == "TWO_ENVELOPE":
        if facts["selectionProcedure"] == "ONE_STAGE_TWO_ENVELOPES":
            return "APPLICABLE", "INCLUDED_BY_ONE_STAGE_TWO_ENVELOPES"
        if facts["selectionProcedure"] == "UNDETERMINED":
            return "CONDITIONAL", "WAITING_FOR_SELECTION_PROCEDURE"
        return "NOT_APPLICABLE", "EXCLUDED_BY_SELECTION_PROCEDURE"
    if rule == "TECHNICAL_APPRAISAL":
        if facts["selectionProcedure"] != "ONE_STAGE_TWO_ENVELOPES":
            if facts["selectionProcedure"] == "UNDETERMINED":
                return "CONDITIONAL", "WAITING_FOR_SELECTION_PROCEDURE"
            return "NOT_APPLICABLE", "EXCLUDED_BY_SELECTION_PROCEDURE"
        return ("APPLICABLE", "INCLUDED_BY_TECHNICAL_APPRAISAL_DATA") if has_data else ("CONDITIONAL", "WAITING_FOR_TECHNICAL_APPRAISAL_DATA")
    if rule == "CONSULTANT_PREPARATION":
        if str(related.get("preparationConsultantMode") or "").upper() == "INTERNAL":
            return "NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_PREPARATION"
        if related.get("preparationContract"):
            return "APPLICABLE", "INCLUDED_BY_PREPARATION_CONSULTANT_DATA"
        if related.get("expertTeam") or _is_consulting_package(facts) or has_data:
            return "APPLICABLE", "INCLUDED_BY_PREPARATION_CONSULTANT_PROCESS"
        return "NOT_APPLICABLE", "EXCLUDED_WITHOUT_PREPARATION_CONSULTANT_CONTRACT"
    if rule == "CONSULTANT_APPRAISAL":
        if str(related.get("appraisalConsultantMode") or "").upper() == "INTERNAL":
            return "NOT_APPLICABLE", "EXCLUDED_BY_INTERNAL_APPRAISAL"
        if related.get("appraisalContract"):
            return "APPLICABLE", "INCLUDED_BY_APPRAISAL_CONSULTANT_DATA"
        if related.get("appraisalTeam") or _is_consulting_package(facts) or has_data:
            return "APPLICABLE", "INCLUDED_BY_APPRAISAL_CONSULTANT_PROCESS"
        return "NOT_APPLICABLE", "EXCLUDED_WITHOUT_APPRAISAL_CONSULTANT_CONTRACT"
    if rule == "EXPERT_TEAM":
        return ("APPLICABLE", "INCLUDED_BY_EXPERT_TEAM_DATA") if related.get("expertTeam") or _is_consulting_package(facts) or has_data else ("CONDITIONAL", "WAITING_FOR_EXPERT_TEAM_DATA")
    if rule == "APPRAISAL_TEAM":
        if not related.get("appraisalContract") and not related.get("appraisalTeam") and not _is_consulting_package(facts) and not has_data:
            return "NOT_APPLICABLE", "EXCLUDED_WITHOUT_APPRAISAL_CONSULTANT_CONTRACT"
        return ("APPLICABLE", "INCLUDED_BY_APPRAISAL_TEAM_DATA") if related.get("appraisalTeam") or _is_consulting_package(facts) or has_data else ("CONDITIONAL", "WAITING_FOR_APPRAISAL_TEAM_DATA")
    if rule in {"OPTIONAL_WHEN_DATA", "OPTIONAL_APPRAISAL"}:
        return ("APPLICABLE", "INCLUDED_BY_BUSINESS_DATA") if has_data else ("CONDITIONAL", "WAITING_FOR_OPTIONAL_BUSINESS_DATA")
    if rule == "STANDARD_TENDER" and facts["selectionMethod"] == "SPECIAL_SELECTION":
        return ("APPLICABLE", "INCLUDED_BY_SPECIAL_SELECTION_DATA") if has_data else ("CONDITIONAL", "WAITING_FOR_SPECIAL_SELECTION_PLAN")
    if rule == "STANDARD_TENDER":
        return "APPLICABLE", "INCLUDED_BY_STANDARD_TENDER"
    return "APPLICABLE", "DEFAULT_APPLICABLE"


def _saved_indexes(saved_entries):
    stable = {}
    legacy = {}
    for entry in saved_entries if isinstance(saved_entries, list) else []:
        milestone = str(_first(entry, ("milestoneKey", "milestone_key")) or "")
        instance = str(_first(entry, ("instanceKey", "instance_key")) or "")
        if milestone:
            stable[(milestone, instance)] = entry
        code = str(_first(entry, ("maMoc", "ma_moc")) or "")
        if code:
            legacy.setdefault(code, entry)
    return stable, legacy


def _entity_sort(entity, index):
    raw_sequence = _first(entity, ("sequence", "thuTu", "thu_tu", "sortOrder", "sort_order"))
    try:
        sequence = int(raw_sequence)
    except (TypeError, ValueError):
        sequence = 100000 + index
    if sequence <= 0:
        sequence = 100000 + index
    date = str(_first(entity, (
        "approvalDecisionDate", "approval_decision_date", "thoiGian", "thoi_gian",
        "createdAt", "created_at",
    )) or "")
    return sequence, date, str(_first(entity, ("id",)) or index)


def _timeline_title(definition, facts):
    if definition["milestoneKey"] == "BID_EVALUATION_REPORT":
        if facts["selectionProcedure"] == "ONE_STAGE_ONE_ENVELOPE":
            return "Báo cáo đánh giá E-HSDT"
        if facts["selectionProcedure"] == "ONE_STAGE_TWO_ENVELOPES":
            return "Báo cáo đánh giá E-HSĐXKT"
    if definition["milestoneKey"] == "DOCUMENT_RECONCILIATION_INVITATION" and facts["selectionProcedure"] == "ONE_STAGE_TWO_ENVELOPES":
        return "Thư mời đối chiếu tài liệu/Thương thảo hợp đồng"
    return definition["title"]


def _make_row(definition, entity, ordinal, package_data, plan_data, related, indexes):
    section = SECTION_BY_KEY[definition["sectionKey"]]
    instance_key = str(_first(entity, ("id",)) or f"{definition['milestoneKey']}-{ordinal}") if definition["repeatable"] else ""
    stable, legacy = indexes
    legacy_code = str((definition.get("legacyCodes") or [f"{section['displayPrefix']}.0"])[0])
    saved = stable.get((definition["milestoneKey"], instance_key)) or (legacy.get(legacy_code) if not definition["repeatable"] else None) or {}
    source = _source_values(definition, package_data, plan_data, related, entity)
    source_mode = str(_first(saved, ("sourceMode", "source_mode")) or ("AUTO" if definition.get("source") else "MANUAL")).upper()
    number = _first(saved, ("soVanBan", "so_van_ban")) if source_mode == "MANUAL" else source["number"]
    actual_date = _first(saved, ("ngayThucTe", "ngay_thuc_te")) if source_mode == "MANUAL" else source["date"]
    facts = canonical_timeline_facts(package_data, plan_data)
    applicability, reason = _rule_result(
        definition,
        facts=facts,
        package_data=package_data,
        related=related,
        saved=saved,
        source=source,
    )
    entity_sequence = _sequence_number(entity)
    repeatable_ordinal = entity_sequence if entity_sequence > 0 else ordinal
    base_title = _timeline_title(definition, facts)
    title = f"{base_title} lần {repeatable_ordinal}" if definition["repeatable"] and repeatable_ordinal > 0 else base_title
    status = str(_first(saved, ("status", "trangThai", "trang_thai")) or ("DONE" if actual_date else "PENDING")).upper()
    return {
        **deepcopy(saved),
        "id": str(_first(saved, ("id",)) or f"{definition['milestoneKey']}:{instance_key or 'base'}"),
        "milestone_key": definition["milestoneKey"],
        "instance_key": instance_key,
        "display_code": "",
        "display_group_code": "",
        "title": title,
        "section_key": definition["sectionKey"],
        "applicability": applicability,
        "applicability_reason": reason,
        "status": status,
        "source": source["sourceKey"],
        "source_entity_id": instance_key if definition["repeatable"] else "",
        "effective_closing_time": related.get("effectiveClosingTime") or "",
        "saved_entry": deepcopy(saved) if saved else None,
        "is_repeatable": bool(definition["repeatable"]),
        "sort_order": float(definition["sortAnchor"]) + (ordinal / 100 if definition["repeatable"] else 0),
        "template_version": TIMELINE_TEMPLATE_VERSION,
        "tags": list(definition.get("tags", ())),
        "ma_nhom": section["legacyCode"],
        "ten_nhom": section["title"],
        "ma_moc": legacy_code,
        "cong_viec": title,
        "don_vi_ban_hanh": str(_first(saved, ("donViBanHanh", "don_vi_ban_hanh")) or definition.get("issuer") or ""),
        "so_van_ban": str(number or ""),
        "ngay_du_kien": _date_only(_first(saved, ("ngayDuKien", "ngay_du_kien"))),
        "ngay_thuc_te": _date_only(actual_date),
        "ghi_chu": str(_first(saved, ("ghiChu", "ghi_chu")) or ""),
        "source_key": source["sourceKey"] or str(_first(saved, ("sourceKey", "source_key")) or ""),
        "source_mode": source_mode,
        "is_optional": "OPTIONAL" in definition.get("tags", ()),
        "trang_thai": status,
    }


def _roman_numeral(value):
    pairs = (
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
        (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
        (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
    )
    remaining = int(value or 0)
    result = []
    for amount, symbol in pairs:
        while remaining >= amount:
            result.append(symbol)
            remaining -= amount
    return "".join(result)


def assign_timeline_display_codes(rows):
    visible_sections = {
        row["section_key"] for row in rows
        if row["applicability"] != "NOT_APPLICABLE"
    }
    section_numbers = {
        section["sectionKey"]: index
        for index, section in enumerate(
            (section for section in CATALOG["sections"] if section["sectionKey"] in visible_sections),
            start=1,
        )
    }
    counters = {}
    for row in rows:
        if row["applicability"] == "NOT_APPLICABLE":
            row["display_code"] = ""
            row["display_group_code"] = ""
            continue
        section_key = row["section_key"]
        counters[section_key] = counters.get(section_key, 0) + 1
        section_number = section_numbers[section_key]
        row["display_code"] = f"{section_number}.{counters[section_key]}"
        row["display_group_code"] = _roman_numeral(section_number)
    return rows


def build_effective_timeline(
    package_data=None,
    related_entities=None,
    saved_entries=None,
    *,
    include_not_applicable=False,
):
    """Return a deterministic timeline without mutating caller-owned data."""

    package_copy = deepcopy(package_data or {})
    related_copy = deepcopy(related_entities or {})
    plan_data = deepcopy(related_copy.get("plan") or {})
    related = _related(package_copy, related_copy)
    indexes = _saved_indexes(deepcopy(saved_entries or []))
    rows = []
    for definition in CATALOG["milestones"]:
        if definition["repeatable"]:
            seen_ids = set()
            entities = []
            for index, entity in enumerate(_active(related.get((definition.get("source") or {}).get("entity"), []))):
                stable_id = str(_first(entity, ("id",)) or f"repeatable-{index}")
                if stable_id in seen_ids:
                    continue
                seen_ids.add(stable_id)
                entities.append(entity)
            entities = sorted(entities, key=lambda item: _entity_sort(item, 0))
            rows.extend(
                _make_row(definition, entity, index, package_copy, plan_data, related, indexes)
                for index, entity in enumerate(entities, start=1)
            )
        else:
            rows.append(_make_row(definition, None, 0, package_copy, plan_data, related, indexes))
    rows.sort(key=lambda row: (row["sort_order"], row["milestone_key"], row["instance_key"]))
    assign_timeline_display_codes(rows)
    return rows if include_not_applicable else [row for row in rows if row["applicability"] != "NOT_APPLICABLE"]


def timeline_progress(rows):
    applicable = [row for row in rows if row.get("applicability") == "APPLICABLE"]
    completed = sum(str(row.get("status") or row.get("trang_thai") or "").upper() in {"DONE", "COMPLETED"} for row in applicable)
    return {"completed": completed, "total": len(applicable), "ratio": completed / len(applicable) if applicable else 0}
