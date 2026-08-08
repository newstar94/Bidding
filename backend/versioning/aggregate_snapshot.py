"""Pure clone/remap rules for official plan and package versions."""

from __future__ import annotations

from copy import deepcopy

from backend.sync.bid_evaluation_rules import (
    parse_technical_score,
    requires_technical_score,
)
from backend.sync.evaluation_metadata import (
    dump_evaluation_metadata,
    parse_evaluation_metadata,
)


SERVER_FIELDS = {
    "rowVersion",
    "expectedVersion",
    "syncVersion",
    "organizationId",
    "ownerType",
    "archivedAt",
    "allVersions",
    "referenceOnly",
}
OWNED_CHILDREN = (
    ("tuyChonMuaThemList", "tuychonmuathem"),
    ("giaHanList", "giahan"),
    ("yeuCauLamRoList", "yeucaulamro"),
    ("traLoiLamRoList", "traloilamro"),
    ("timelineItems", "timeline"),
    ("ehsmtAdjustments", "ehsmtadjustment"),
)


def _rows(value):
    return value if isinstance(value, list) else []


def _clean_server_fields(record):
    cloned = deepcopy(record or {})
    for field in SERVER_FIELDS:
        cloned.pop(field, None)
    return cloned


def _clone_owned_row(source, kind, create_id):
    cloned = _clean_server_fields(source)
    cloned["id"] = create_id(kind)
    return cloned


def _lot_token(lot):
    return str(lot.get("maPhanLo") or lot.get("tenPhanLo") or "").strip().casefold()


def _clone_evaluation_metadata(raw_metadata, target_package_id, create_id):
    if raw_metadata in (None, ""):
        return raw_metadata, {}, {}
    was_string = isinstance(raw_metadata, str)
    metadata = parse_evaluation_metadata(raw_metadata)
    round_ids = {}
    criterion_ids = {}
    blocks = (
        (("technical", metadata.get("technical")), ("financial", metadata.get("financial")))
        if metadata.get("is1G2T")
        else (("single", metadata),)
    )
    for round_type, block in blocks:
        if not isinstance(block, dict):
            continue
        target_round_id = f"evaluation-round:{target_package_id}:{round_type}"
        old_round_id = str(block.get("id") or block.get("vongDanhGiaId") or "")
        if old_round_id:
            round_ids[old_round_id] = target_round_id
        round_ids[round_type] = target_round_id
        for criterion in _rows(block.get("criteria")):
            old_id = str(criterion.get("id") or "")
            new_id = create_id("evaluationcriterion")
            if old_id:
                criterion_ids[old_id] = new_id
            criterion["id"] = new_id
        for criterion in _rows(block.get("criteria")):
            parent_id = str(
                criterion.get("parentCriterionId")
                or criterion.get("tieuChiChaId")
                or ""
            )
            if parent_id not in criterion_ids:
                continue
            if "parentCriterionId" in criterion:
                criterion["parentCriterionId"] = criterion_ids[parent_id]
            if "tieuChiChaId" in criterion:
                criterion["tieuChiChaId"] = criterion_ids[parent_id]
    return (
        dump_evaluation_metadata(metadata) if was_string else metadata,
        round_ids,
        criterion_ids,
    )


def _technical_block(package):
    metadata = parse_evaluation_metadata(package.get("danhGiaHsdtMetadata"))
    return metadata.get("technical") or {} if metadata.get("is1G2T") else metadata


def _inherited_technical_score(opening, package):
    if not requires_technical_score(package.get("phuongPhapDanhGia")):
        return None
    existing = parse_technical_score(opening.get("danhGiaKyThuat"))
    if existing is not None:
        return str(existing)
    block = _technical_block(package)
    round_id = str(block.get("id") or block.get("vongDanhGiaId") or "")
    report = next((
        candidate for candidate in _rows(opening.get("baoCaoDanhGiaChiTietList"))
        if str(candidate.get("loaiVong") or "") == "technical"
        or (round_id and str(candidate.get("vongDanhGiaId") or "") == round_id)
    ), None)
    if not report:
        return None
    criterion_ids = {
        str(criterion.get("id") or "")
        for criterion in _rows(block.get("criteria"))
        if not criterion.get("group") or criterion.get("group") == "technical"
    }
    scores = []
    for row in _rows(report.get("chiTietList")):
        if criterion_ids and str(row.get("tieuChiDanhGiaId") or "") not in criterion_ids:
            continue
        score = parse_technical_score(row.get("diem"))
        if score is not None:
            scores.append(score)
    if scores:
        return str(sum(scores))
    score = parse_technical_score(
        report.get("diemKyThuat", report.get("technicalScore"))
    )
    return None if score is None else str(score)


def snapshot_package_aggregate(
    state,
    source_package,
    *,
    target_package_id,
    target_plan_id,
    package_version,
    timestamp,
    overrides=None,
    create_id,
):
    if not source_package or not source_package.get("id") or not target_plan_id:
        raise ValueError("Không đủ dữ liệu để tạo snapshot gói thầu.")
    package_record = _clean_server_fields(source_package)
    package_record.update(deepcopy(overrides or {}))
    package_record.update({
        "id": target_package_id,
        "rootId": source_package.get("rootId") or source_package["id"],
        "phienBan": package_version,
        "isLatest": 1,
        "keHoachId": target_plan_id,
        "createdAt": source_package.get("createdAt") or timestamp,
        "updatedAt": timestamp,
    })

    old_lots = _rows(source_package.get("phanLoList"))
    selected_lots = _rows(package_record.get("phanLoList"))
    old_lots_by_code = {_lot_token(lot): lot for lot in old_lots}
    lot_ids = {}
    cloned_lots = []
    for lot in selected_lots:
        cloned = _clone_owned_row(lot, "phanlo", create_id)
        source_lot = next((
            item for item in old_lots
            if str(item.get("id")) == str(lot.get("id"))
        ), None) or old_lots_by_code.get(_lot_token(lot))
        if source_lot and source_lot.get("id"):
            lot_ids[str(source_lot["id"])] = cloned["id"]
        cloned_lots.append(cloned)
    package_record["phanLoList"] = cloned_lots
    target_lots_by_code = {_lot_token(lot): lot for lot in cloned_lots}
    awards = []
    for award in _rows(package_record.get("awardedPhanLoList")):
        source_lot = next((
            item for item in old_lots
            if str(item.get("id")) == str(award.get("id"))
        ), None) or old_lots_by_code.get(_lot_token(award))
        target_lot = None
        if source_lot:
            mapped_id = lot_ids.get(str(source_lot.get("id")))
            target_lot = next((lot for lot in cloned_lots if lot["id"] == mapped_id), None)
        target_lot = target_lot or target_lots_by_code.get(_lot_token(award))
        cloned = _clean_server_fields(award)
        cloned["id"] = target_lot["id"] if target_lot else create_id("phanlo")
        awards.append(cloned)
    package_record["awardedPhanLoList"] = awards
    for field, kind in OWNED_CHILDREN:
        package_record[field] = [
            _clone_owned_row(row, kind, create_id)
            for row in _rows(package_record.get(field))
        ]
    for item in package_record.get("timelineItems", []):
        source_id = str(item.get("sourceEntityId") or "")
        if source_id in lot_ids:
            item["sourceEntityId"] = lot_ids[source_id]

    metadata, round_ids, criterion_ids = _clone_evaluation_metadata(
        package_record.get("danhGiaHsdtMetadata"),
        target_package_id,
        create_id,
    )
    if metadata is None:
        package_record.pop("danhGiaHsdtMetadata", None)
    else:
        package_record["danhGiaHsdtMetadata"] = metadata

    goods_ids = {}
    goods = []
    for row in _rows(state.get("goithauhanghoa")):
        if str(row.get("goiThauId")) != str(source_package["id"]):
            continue
        cloned = _clone_owned_row(row, "goithauhanghoa", create_id)
        cloned["goiThauId"] = target_package_id
        cloned["phanLoId"] = lot_ids.get(str(row.get("phanLoId"))) if row.get("phanLoId") else None
        goods_ids[str(row.get("id"))] = cloned["id"]
        goods.append(cloned)

    opening_ids = {}
    openings = []
    for row in _rows(state.get("thongtinmothau")):
        if str(row.get("goiThauId")) != str(source_package["id"]):
            continue
        cloned = _clone_owned_row(row, "thongtinmothau", create_id)
        opening_ids[str(row.get("id"))] = cloned["id"]
        cloned["goiThauId"] = target_package_id
        if row.get("phanLoId"):
            cloned["phanLoId"] = lot_ids.get(str(row.get("phanLoId")))
        score = _inherited_technical_score(row, source_package)
        if score is not None:
            cloned["danhGiaKyThuat"] = score
        cloned["thanhVienLienDanh"] = [
            _clone_owned_row(member, "jointventuremember", create_id)
            for member in _rows(cloned.get("thanhVienLienDanh"))
        ]
        reports = []
        for report in _rows(cloned.get("baoCaoDanhGiaChiTietList")):
            report_clone = _clone_owned_row(report, "detailedevaluation", create_id)
            round_type = str(report.get("loaiVong") or "single")
            report_clone["vongDanhGiaId"] = (
                round_ids.get(str(report.get("vongDanhGiaId") or ""))
                or round_ids.get(round_type)
                or f"evaluation-round:{target_package_id}:{round_type}"
            )
            details = []
            for detail in _rows(report_clone.get("chiTietList")):
                detail_clone = _clone_owned_row(detail, "detailedevaluationrow", create_id)
                old_criterion = str(detail.get("tieuChiDanhGiaId") or "")
                detail_clone["tieuChiDanhGiaId"] = criterion_ids.get(
                    old_criterion, old_criterion
                )
                details.append(detail_clone)
            report_clone["chiTietList"] = details
            reports.append(report_clone)
        cloned["baoCaoDanhGiaChiTietList"] = reports
        openings.append(cloned)

    bidder_goods = []
    for row in _rows(state.get("hanghoaduthaunhathau")):
        if str(row.get("goiThauId")) != str(source_package["id"]):
            continue
        cloned = _clone_owned_row(row, "hanghoaduthaunhathau", create_id)
        cloned["goiThauId"] = target_package_id
        cloned["thongTinMoThauId"] = opening_ids.get(
            str(row.get("thongTinMoThauId")), row.get("thongTinMoThauId")
        )
        cloned["goiThauHangHoaId"] = goods_ids.get(
            str(row.get("goiThauHangHoaId"))
        ) if row.get("goiThauHangHoaId") else None
        cloned["phanLoId"] = lot_ids.get(str(row.get("phanLoId"))) if row.get("phanLoId") else None
        bidder_goods.append(cloned)

    assignments = []
    for row in _rows(state.get("assignments")):
        if row.get("type") != "goithau" or str(row.get("targetId")) != str(source_package["id"]):
            continue
        cloned = _clone_owned_row(row, "assignments", create_id)
        cloned["targetId"] = target_package_id
        assignments.append(cloned)

    return {
        "packageRecord": package_record,
        "goithauhanghoa": goods,
        "thongtinmothau": openings,
        "hanghoaduthaunhathau": bidder_goods,
        "assignments": assignments,
        "mappings": {
            "packageIds": {str(source_package["id"]): target_package_id},
            "lotIds": lot_ids,
            "goodsIds": goods_ids,
            "openingIds": opening_ids,
            "roundIds": round_ids,
            "criterionIds": criterion_ids,
        },
    }


def _version_number(record):
    try:
        return int(record.get("phienBan") or 0)
    except (TypeError, ValueError):
        return 0


def snapshot_plan_aggregate(
    state,
    *,
    source_plan_id,
    target_plan_id,
    timestamp,
    create_id,
):
    if not source_plan_id or not target_plan_id:
        raise ValueError("Không đủ dữ liệu để kế thừa phiên bản kế hoạch.")
    latest_by_root = {}
    for package in _rows(state.get("goithau")):
        if str(package.get("keHoachId")) != str(source_plan_id):
            continue
        root = str(package.get("rootId") or package.get("id"))
        current = latest_by_root.get(root)
        if current is None or (
            _version_number(package), int(package.get("isLatest") == 1)
        ) > (_version_number(current), int(current.get("isLatest") == 1)):
            latest_by_root[root] = package
    aggregate = {
        "goithau": [],
        "goithauhanghoa": [],
        "thongtinmothau": [],
        "hanghoaduthaunhathau": [],
        "assignments": [],
        "sourcePackageIds": [],
        "mappings": {"packageIds": {}, "packageRoots": {}},
    }
    for source_package in latest_by_root.values():
        snapshot = snapshot_package_aggregate(
            state,
            source_package,
            target_package_id=create_id("goithau"),
            target_plan_id=target_plan_id,
            package_version=source_package.get("phienBan") or 0,
            timestamp=timestamp,
            create_id=create_id,
        )
        aggregate["goithau"].append(snapshot["packageRecord"])
        for key in (
            "goithauhanghoa",
            "thongtinmothau",
            "hanghoaduthaunhathau",
            "assignments",
        ):
            aggregate[key].extend(snapshot[key])
        aggregate["sourcePackageIds"].append(source_package["id"])
        aggregate["mappings"]["packageIds"][str(source_package["id"])] = snapshot["packageRecord"]["id"]
        aggregate["mappings"]["packageRoots"][str(source_package.get("rootId") or source_package["id"])] = snapshot["packageRecord"]["id"]
    for package in aggregate["goithau"]:
        source_rebid_id = str(package.get("rebidFromPackageId") or "")
        replacement = aggregate["mappings"]["packageIds"].get(source_rebid_id)
        if replacement:
            package["rebidFromPackageId"] = replacement
    return aggregate
