"""Validate a completed target snapshot graph before sync persistence."""

from __future__ import annotations

from backend.sync.evaluation_metadata import parse_evaluation_metadata
from backend.versioning.aggregate_policy import cloned_nested_fields


class AggregateGraphValidationError(ValueError):
    def __init__(self, code, message):
        self.code = str(code)
        super().__init__(message)


def _rows(payload, key):
    value = payload.get(key, ())
    return value if isinstance(value, list) else ()


def _ids(rows):
    return {
        str(row.get("id"))
        for row in rows
        if isinstance(row, dict) and row.get("id")
    }


def _require(condition, code, message):
    if not condition:
        raise AggregateGraphValidationError(code, message)


def _evaluation_blocks(package):
    metadata = parse_evaluation_metadata(package.get("danhGiaHsdtMetadata"))
    if set(metadata) <= {"schemaVersion"}:
        return ()
    if metadata.get("is1G2T"):
        return tuple(
            block
            for block in (metadata.get("technical"), metadata.get("financial"))
            if isinstance(block, dict)
        )
    return (metadata,) if isinstance(metadata, dict) and metadata else ()


def _package_nested_graph(package):
    lots = _rows(package, "phanLoList")
    lot_ids = _ids(lots)
    awarded_lot_ids = _ids(_rows(package, "awardedPhanLoList"))
    _require(
        awarded_lot_ids <= lot_ids,
        "AGGREGATE_AWARD_LOT_UNMAPPED",
        "Awarded lot is outside its package lot graph.",
    )

    round_ids = set()
    criterion_ids = set()
    criteria = []
    for block in _evaluation_blocks(package):
        round_id = str(block.get("id") or block.get("vongDanhGiaId") or "")
        _require(
            bool(round_id),
            "AGGREGATE_EVALUATION_ROUND_INVALID",
            "Evaluation metadata contains a round without an ID.",
        )
        round_ids.add(round_id)
        for criterion in _rows(block, "criteria"):
            criterion_id = str(criterion.get("id") or "")
            _require(
                bool(criterion_id),
                "AGGREGATE_EVALUATION_CRITERION_INVALID",
                "Evaluation criterion has no target ID.",
            )
            criterion_ids.add(criterion_id)
            criteria.append(criterion)
    for criterion in criteria:
        parent_id = str(
            criterion.get("parentCriterionId")
            or criterion.get("tieuChiChaId")
            or ""
        )
        _require(
            not parent_id or parent_id in criterion_ids,
            "AGGREGATE_CRITERION_PARENT_UNMAPPED",
            "Evaluation criterion parent is outside the target graph.",
        )

    owned_ids = set(lot_ids) | round_ids | criterion_ids
    for field in cloned_nested_fields():
        if field == "danhGiaHsdtMetadata":
            continue
        owned_ids |= _ids(_rows(package, field))
    for timeline in _rows(package, "timelineItems"):
        source_id = str(timeline.get("sourceEntityId") or "")
        _require(
            not source_id or source_id in owned_ids,
            "AGGREGATE_TIMELINE_SOURCE_UNMAPPED",
            "Timeline source entity is outside the target graph.",
        )
    return {
        "lots": lot_ids,
        "rounds": round_ids,
        "criteria": criterion_ids,
        "owned": owned_ids,
    }


def validate_generated_aggregate_graph(payload, *, source_ids=()):
    """Fail closed when target ownership or pending references are incomplete."""

    table_keys = (
        "kehoach",
        "goithau",
        "goithauhanghoa",
        "thongtinmothau",
        "hanghoaduthaunhathau",
        "assignments",
    )
    packages = {
        str(row.get("id")): row
        for row in _rows(payload, "goithau")
        if isinstance(row, dict) and row.get("id") and row.get("isLatest") == 1
    }
    package_ids = set(packages)
    plan_ids = {
        str(row.get("id"))
        for row in _rows(payload, "kehoach")
        if isinstance(row, dict) and row.get("id") and row.get("isLatest") == 1
    }
    goods_ids = _ids(_rows(payload, "goithauhanghoa"))
    opening_ids = _ids(_rows(payload, "thongtinmothau"))
    package_graph = {
        package_id: _package_nested_graph(package)
        for package_id, package in packages.items()
    }
    all_ids = []
    for key in table_keys:
        all_ids.extend(
            str(row.get("id"))
            for row in _rows(payload, key)
            if isinstance(row, dict) and row.get("id")
        )
    for graph in package_graph.values():
        all_ids.extend(graph["owned"])
    for opening in _rows(payload, "thongtinmothau"):
        all_ids.extend(_ids(_rows(opening, "thanhVienLienDanh")))
        for report in _rows(opening, "baoCaoDanhGiaChiTietList"):
            report_id = str(report.get("id") or "")
            if report_id:
                all_ids.append(report_id)
            all_ids.extend(_ids(_rows(report, "chiTietList")))
    _require(
        len(all_ids) == len(set(all_ids)),
        "AGGREGATE_TARGET_ID_DUPLICATE",
        "Generated aggregate contains duplicate target IDs.",
    )

    for package_id, package in packages.items():
        plan_id = str(package.get("keHoachId") or "")
        _require(
            not plan_ids or plan_id in plan_ids,
            "AGGREGATE_TARGET_PLAN_INVALID",
            "Generated package does not belong to the target plan.",
        )
        ancestor_id = str(package.get("rebidFromPackageId") or "")
        _require(
            not (plan_ids and ancestor_id) or ancestor_id in package_ids,
            "AGGREGATE_REBID_DEPENDENCY_EXCLUDED",
            "Generated rebid edge points outside the target graph.",
        )
        del package_id

    def require_package(row):
        package_id = str(row.get("goiThauId") or "")
        _require(
            package_id in package_ids,
            "AGGREGATE_PENDING_REFERENCE_INVALID",
            "Generated child does not belong to a target package.",
        )
        return package_id

    for row in _rows(payload, "goithauhanghoa"):
        package_id = require_package(row)
        lot_id = str(row.get("phanLoId") or "")
        _require(
            not lot_id or lot_id in package_graph[package_id]["lots"],
            "AGGREGATE_PENDING_REFERENCE_INVALID",
            "Generated goods lot is invalid.",
        )
    for row in _rows(payload, "thongtinmothau"):
        package_id = require_package(row)
        lot_id = str(row.get("phanLoId") or "")
        _require(
            not lot_id or lot_id in package_graph[package_id]["lots"],
            "AGGREGATE_PENDING_REFERENCE_INVALID",
            "Generated opening lot is invalid.",
        )
        member_ids = [
            str(member.get("id") or "")
            for member in _rows(row, "thanhVienLienDanh")
        ]
        _require(
            all(member_ids) and len(member_ids) == len(set(member_ids))
            if member_ids else True,
            "AGGREGATE_JOINT_VENTURE_INVALID",
            "Joint-venture members require unique target IDs.",
        )
        for report in _rows(row, "baoCaoDanhGiaChiTietList"):
            round_id = str(report.get("vongDanhGiaId") or "")
            _require(
                round_id in package_graph[package_id]["rounds"],
                "AGGREGATE_EVALUATION_ROUND_INVALID",
                "Detailed evaluation report round is outside the target graph.",
            )
            for detail in _rows(report, "chiTietList"):
                criterion_id = str(detail.get("tieuChiDanhGiaId") or "")
                _require(
                    criterion_id in package_graph[package_id]["criteria"],
                    "AGGREGATE_DETAIL_CRITERION_UNMAPPED",
                    "Detailed evaluation criterion is outside the target graph.",
                )
    for row in _rows(payload, "hanghoaduthaunhathau"):
        package_id = require_package(row)
        references = (
            (row.get("thongTinMoThauId"), opening_ids),
            (row.get("goiThauHangHoaId"), goods_ids),
            (row.get("phanLoId"), package_graph[package_id]["lots"]),
        )
        _require(
            not any(value and str(value) not in allowed for value, allowed in references),
            "AGGREGATE_PENDING_REFERENCE_INVALID",
            "Generated bidder-goods reference is incomplete.",
        )
    for row in _rows(payload, "assignments"):
        target_type = str(row.get("type") or "")
        target_id = str(row.get("targetId") or "")
        allowed = package_ids if target_type == "goithau" else plan_ids
        _require(
            target_type in {"goithau", "kehoach"} and target_id in allowed,
            "ASSIGNMENT_INHERITANCE_INVALID",
            "Generated assignment target is outside the target graph.",
        )

    target_owned_ids = (
        package_ids
        | plan_ids
        | goods_ids
        | opening_ids
        | _ids(_rows(payload, "hanghoaduthaunhathau"))
        | _ids(_rows(payload, "assignments"))
        | set().union(
            *(graph["owned"] for graph in package_graph.values())
        )
    )
    for opening in _rows(payload, "thongtinmothau"):
        target_owned_ids |= _ids(_rows(opening, "thanhVienLienDanh"))
        for report in _rows(opening, "baoCaoDanhGiaChiTietList"):
            if report.get("id"):
                target_owned_ids.add(str(report["id"]))
            target_owned_ids |= _ids(_rows(report, "chiTietList"))
    source_ids = {str(value) for value in source_ids if value}
    _require(
        not (source_ids & target_owned_ids),
        "AGGREGATE_SOURCE_REFERENCE_LEAK",
        "Generated graph retains a source-owned internal ID.",
    )
    return payload
