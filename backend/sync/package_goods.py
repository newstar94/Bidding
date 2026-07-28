"""Batch validation for package-goods sync records."""

from __future__ import annotations

from backend.shared.text_utils import clean_id


def _text(item, key):
    return str(item.get(key) or "").strip()


def validate_package_goods_batch(cursor, organization_id, items):
    items = [item for item in (items or ()) if isinstance(item, dict)]
    if not items:
        return []
    package_ids = sorted({clean_id(item.get("goiThauId") or item.get("goi_thau_id")) for item in items} - {None})
    stored = {}
    if package_ids:
        placeholders = ", ".join("?" for _ in package_ids)
        rows = cursor.execute(
            f"""SELECT id, goi_thau_id, phan_lo_id, lower(trim(ma_hang_hoa))
                FROM goi_thau_hang_hoa
                WHERE organization_id = ? AND goi_thau_id IN ({placeholders})""",
            (organization_id, *package_ids),
        ).fetchall()
        for row in rows:
            stored[(str(row[1]), str(row[2] or ""), str(row[3]))] = str(row[0])

    errors = []
    seen = {}
    for item in items:
        record_id = clean_id(item.get("id"))
        package_id = clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        lot_id = clean_id(item.get("phanLoId") or item.get("phan_lo_id"))
        code = _text(item, "maHangHoa") or _text(item, "ma_hang_hoa")
        key = (str(package_id or ""), str(lot_id or ""), code.casefold())
        if code and key in seen and seen[key] != record_id:
            errors.append({
                "table": "goi_thau_hang_hoa", "id": record_id,
                "field": "maHangHoa", "code": "DUPLICATE_GOODS_CODE",
                "message": f"Mã hàng hóa '{code}' bị trùng trong cùng phạm vi.",
            })
        elif code:
            seen[key] = record_id
        conflicting_id = stored.get(key)
        if code and conflicting_id and conflicting_id != record_id:
            errors.append({
                "table": "goi_thau_hang_hoa", "id": record_id,
                "field": "maHangHoa", "code": "DUPLICATE_GOODS_CODE",
                "message": f"Mã hàng hóa '{code}' đã tồn tại trong cùng phạm vi.",
                "conflictingId": conflicting_id,
            })
    return errors


def validate_package_goods_configuration_change(cursor, organization_id, current_record, item):
    if not current_record:
        return []
    if not any(key in item for key in ("linhVuc", "phanLo", "phanLoList")):
        return []
    package_id = clean_id(current_record.get("id"))
    if not package_id:
        return []
    old_field = str(current_record.get("linh_vuc") or "").strip()
    new_field = str(item.get("linhVuc") if "linhVuc" in item else old_field).strip()
    old_lotted = str(current_record.get("phan_lo") or "").strip()
    new_lotted = str(item.get("phanLo") if "phanLo" in item else old_lotted).strip()
    has_goods = cursor.execute(
        "SELECT 1 FROM goi_thau_hang_hoa WHERE organization_id = ? AND goi_thau_id = ? LIMIT 1",
        (organization_id, package_id),
    ).fetchone() is not None
    if not has_goods:
        return []
    errors = []
    if old_field == "Hàng hóa" and new_field != "Hàng hóa":
        errors.append("Không thể đổi lĩnh vực khi gói thầu còn danh mục hàng hóa; hãy xử lý danh mục trước.")
    if old_lotted == "Có" and new_lotted != "Có":
        errors.append("Không thể tắt phân lô khi còn hàng hóa đang gắn với phần lô.")
    if "phanLoList" in item:
        retained_lot_ids = {
            clean_id(lot.get("id"))
            for lot in (item.get("phanLoList") or ())
            if isinstance(lot, dict) and clean_id(lot.get("id"))
        }
        referenced_rows = cursor.execute(
            """SELECT DISTINCT phan_lo_id FROM goi_thau_hang_hoa
               WHERE organization_id = ? AND goi_thau_id = ? AND phan_lo_id IS NOT NULL""",
            (organization_id, package_id),
        ).fetchall()
        missing = {clean_id(row[0]) for row in referenced_rows} - retained_lot_ids
        if missing:
            errors.append("Không thể xóa phần lô đang có hàng hóa tham chiếu.")
    return errors
