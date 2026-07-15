"""Opening-bid participant uniqueness within a package/lot scope."""

from backend.shared.text_utils import clean_id


PACKAGE_SCOPE = "__PACKAGE__"


def normalize_lot_scope(value):
    """Return one stable scope for package-wide bids and normalized lot codes."""
    normalized = " ".join(str(value or "").strip().casefold().split())
    return normalized or PACKAGE_SCOPE


def _contractor_root_ids(cursor, organization_id, contractor_ids):
    clean_ids = {clean_id(value) for value in contractor_ids}
    clean_ids.discard("")
    if not clean_ids:
        return {}
    placeholders = ", ".join("?" for _ in clean_ids)
    rows = cursor.execute(
        f"""SELECT id, COALESCE(NULLIF(id_goc, ''), id)
            FROM nha_thau
            WHERE organization_id = ? AND id IN ({placeholders})""",
        (organization_id, *sorted(clean_ids)),
    ).fetchall()
    return {str(row[0]): str(row[1]) for row in rows}


def _member_ids(item):
    members = item.get("thanhVienLienDanh")
    if not isinstance(members, list):
        return []
    return [
        clean_id(
            member.get("thanhVienNhaThauId")
            or member.get("thanh_vien_nha_thau_id")
            or member.get("nhaThauId")
        )
        for member in members
        if isinstance(member, dict)
    ]


def _is_joint_venture(item):
    return str(item.get("loaiNhaThau") or item.get("loai_nha_thau") or "").strip().casefold() == "liên danh"


def _incoming_participant_ids(item):
    if _is_joint_venture(item):
        return [value for value in _member_ids(item) if value]
    contractor_id = clean_id(item.get("nhaThauId") or item.get("nha_thau_id"))
    return [contractor_id] if contractor_id else []


def validate_opening_participant_uniqueness(cursor, organization_id, incoming_items):
    """Validate a complete incoming opening-bid mutation against stored bids.

    Incoming records replace stored records with the same IDs for validation. A
    contractor identity is its lineage root, so two versions cannot bypass the
    package/lot uniqueness rule.
    """
    incoming_items = [item for item in incoming_items if isinstance(item, dict)]
    if not incoming_items:
        return []

    incoming_by_id = {
        clean_id(item.get("id")): item
        for item in incoming_items
        if clean_id(item.get("id"))
    }
    incoming_ids = set(incoming_by_id)
    stored_rows = cursor.execute(
        """SELECT id, goi_thau_id, nha_thau_id, ma_phan_lo, loai_nha_thau
           FROM thong_tin_mo_thau
           WHERE organization_id = ? AND archived_at IS NULL""",
        (organization_id,),
    ).fetchall()

    stored_records = []
    stored_bid_ids = []
    for row in stored_rows:
        bid_id = str(row[0])
        stored_bid_ids.append(bid_id)
        stored_records.append({
            "id": bid_id,
            "goiThauId": row[1],
            "nhaThauId": row[2],
            "maPhanLo": row[3],
            "loaiNhaThau": row[4],
            "thanhVienLienDanh": [],
        })

    if stored_bid_ids:
        placeholders = ", ".join("?" for _ in stored_bid_ids)
        member_rows = cursor.execute(
            f"""SELECT thong_tin_mo_thau_id, thanh_vien_nha_thau_id
                FROM thong_tin_mo_thau_lien_danh_thanh_vien
                WHERE organization_id = ?
                  AND thong_tin_mo_thau_id IN ({placeholders})""",
            (organization_id, *stored_bid_ids),
        ).fetchall()
        records_by_id = {record["id"]: record for record in stored_records}
        for bid_id, contractor_id in member_rows:
            record = records_by_id.get(str(bid_id))
            if record is not None and contractor_id:
                record["thanhVienLienDanh"].append({"thanhVienNhaThauId": contractor_id})

    stored_by_id = {record["id"]: record for record in stored_records}
    records = [record for record in stored_records if record["id"] not in incoming_ids]
    for incoming in incoming_items:
        incoming_id = clean_id(incoming.get("id"))
        base = stored_by_id.get(incoming_id, {})
        merged = {**base, **incoming}
        if "thanhVienLienDanh" not in incoming and base.get("thanhVienLienDanh"):
            merged["thanhVienLienDanh"] = base["thanhVienLienDanh"]
        records.append(merged)
    all_contractor_ids = {
        contractor_id
        for record in records
        for contractor_id in _incoming_participant_ids(record)
    }
    roots = _contractor_root_ids(cursor, organization_id, all_contractor_ids)

    occupied = {}
    errors = []
    reported = set()
    for record in records:
        package_id = clean_id(record.get("goiThauId") or record.get("goi_thau_id"))
        lot_scope = normalize_lot_scope(record.get("maPhanLo") or record.get("ma_phan_lo"))
        bid_id = clean_id(record.get("id"))
        for contractor_id in _incoming_participant_ids(record):
            root_id = roots.get(contractor_id, contractor_id)
            key = (package_id, lot_scope, root_id)
            previous_bid_id = occupied.get(key)
            if previous_bid_id is None:
                occupied[key] = bid_id
                continue
            if bid_id not in incoming_ids and previous_bid_id not in incoming_ids:
                continue
            report_key = (bid_id, key)
            if report_key in reported:
                continue
            reported.add(report_key)
            scope_label = "toàn gói thầu" if lot_scope == PACKAGE_SCOPE else f"phần lô '{record.get('maPhanLo') or record.get('ma_phan_lo')}'"
            errors.append({
                "table": "thong_tin_mo_thau",
                "id": bid_id,
                "field": "nhaThauId",
                "code": "OPENING_CONTRACTOR_DUPLICATE",
                "message": f"Nhà thầu đã xuất hiện trong biên bản mở thầu của {scope_label}.",
                "conflictingId": previous_bid_id,
            })
    return errors
