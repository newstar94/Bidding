"""Cross-record validation for bidder-goods sync batches."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation

from backend.shared.numeric_utils import parse_vnd_amount
from backend.shared.text_utils import clean_id


def _value(row, name, index):
    try:
        return row[name]
    except (KeyError, TypeError):
        return row[index]


def _chunked(values, size=500):
    for offset in range(0, len(values), size):
        yield values[offset:offset + size]


def _load_by_ids(cursor, table, organization_id, ids, columns):
    result = {}
    for chunk in _chunked(sorted(set(ids))):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"SELECT {', '.join(columns)} FROM {table} "
            f"WHERE organization_id = ? AND id IN ({placeholders})",
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            result[str(_value(row, columns[0], 0))] = {
                column: _value(row, column, index)
                for index, column in enumerate(columns)
            }
    return result


def _error(item, field, code, message):
    return {
        "table": "hang_hoa_du_thau_nha_thau",
        "id": clean_id(item.get("id")),
        "field": field,
        "code": code,
        "message": message,
    }


def _amount(value):
    parsed = parse_vnd_amount(value)
    return Decimal(parsed) if parsed is not None else None


def validate_bidder_goods_batch(cursor, organization_id, items):
    items = [item for item in (items or ()) if isinstance(item, dict)]
    if not items:
        return []
    incoming_record_ids = {clean_id(item.get("id")) for item in items} - {None}

    package_ids = {
        clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        for item in items
    } - {None}
    opening_ids = {
        clean_id(item.get("thongTinMoThauId") or item.get("thong_tin_mo_thau_id"))
        for item in items
    } - {None}
    lot_ids = {
        clean_id(item.get("phanLoId") or item.get("phan_lo_id"))
        for item in items
    } - {None}
    requirement_ids = {
        clean_id(item.get("goiThauHangHoaId") or item.get("goi_thau_hang_hoa_id"))
        for item in items
    } - {None}

    packages = _load_by_ids(
        cursor,
        "goi_thau",
        organization_id,
        package_ids,
        ("id", "linh_vuc", "phan_lo", "trang_thai"),
    )
    openings = _load_by_ids(
        cursor,
        "thong_tin_mo_thau",
        organization_id,
        opening_ids,
        ("id", "goi_thau_id", "ma_phan_lo", "gia_du_thau", "archived_at"),
    )
    lots = _load_by_ids(
        cursor,
        "goi_thau_phan_lo",
        organization_id,
        lot_ids,
        ("id", "goi_thau_id", "ma_phan_lo", "archived_at"),
    )
    requirements = _load_by_ids(
        cursor,
        "goi_thau_hang_hoa",
        organization_id,
        requirement_ids,
        ("id", "goi_thau_id", "phan_lo_id"),
    )

    stored_mappings = {}
    stored_official_by_scope = defaultdict(list)
    if opening_ids:
        for chunk in _chunked(sorted(opening_ids)):
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT id, thong_tin_mo_thau_id, phan_lo_id,
                           goi_thau_hang_hoa_id, thanh_tien_du_thau, is_draft
                    FROM hang_hoa_du_thau_nha_thau
                    WHERE organization_id = ?
                      AND thong_tin_mo_thau_id IN ({placeholders})""",
                (organization_id, *chunk),
            ).fetchall()
            for row in rows:
                record_id = str(_value(row, "id", 0))
                opening_id = str(_value(row, "thong_tin_mo_thau_id", 1))
                lot_id = str(_value(row, "phan_lo_id", 2) or "")
                requirement_id = _value(row, "goi_thau_hang_hoa_id", 3)
                line_total = _value(row, "thanh_tien_du_thau", 4)
                is_draft = bool(_value(row, "is_draft", 5))
                if requirement_id is not None:
                    stored_mappings[(opening_id, str(requirement_id))] = record_id
                if not is_draft:
                    stored_official_by_scope[(opening_id, lot_id)].append(
                        (record_id, clean_id(requirement_id), _amount(line_total))
                    )
    stored_mappings = {
        key: record_id
        for key, record_id in stored_mappings.items()
        if record_id not in incoming_record_ids
    }

    errors = []
    seen_mappings = {}
    official_by_scope = defaultdict(list)
    for item in items:
        record_id = clean_id(item.get("id"))
        package_id = clean_id(item.get("goiThauId") or item.get("goi_thau_id"))
        opening_id = clean_id(item.get("thongTinMoThauId") or item.get("thong_tin_mo_thau_id"))
        lot_id = clean_id(item.get("phanLoId") or item.get("phan_lo_id"))
        requirement_id = clean_id(item.get("goiThauHangHoaId") or item.get("goi_thau_hang_hoa_id"))
        is_draft = item.get("isDraft", item.get("is_draft", True)) in (True, 1, "1", "true", "True")
        package = packages.get(str(package_id))
        opening = openings.get(str(opening_id))
        lot = lots.get(str(lot_id)) if lot_id else None
        requirement = requirements.get(str(requirement_id)) if requirement_id else None

        if not package or str(package.get("linh_vuc") or "").strip() != "Hàng hóa":
            errors.append(_error(item, "goiThauId", "BIDDER_GOODS_PACKAGE_INVALID", "Hàng hóa dự thầu chỉ áp dụng cho gói thầu lĩnh vực Hàng hóa trong tổ chức hiện tại."))
            continue
        if not opening or opening.get("archived_at") or clean_id(opening.get("goi_thau_id")) != package_id:
            errors.append(_error(item, "thongTinMoThauId", "BIDDER_GOODS_OPENING_INVALID", "Hồ sơ mở thầu không thuộc gói thầu hiện tại."))
            continue

        is_lotted = str(package.get("phan_lo") or "").strip() == "Có"
        opening_lot_code = str(opening.get("ma_phan_lo") or "").strip().casefold()
        if is_lotted:
            if not lot or lot.get("archived_at") or clean_id(lot.get("goi_thau_id")) != package_id:
                errors.append(_error(item, "phanLoId", "BIDDER_GOODS_LOT_INVALID", "Phần lô không thuộc gói thầu hiện tại."))
            elif str(lot.get("ma_phan_lo") or "").strip().casefold() != opening_lot_code:
                errors.append(_error(item, "phanLoId", "BIDDER_GOODS_OPENING_LOT_MISMATCH", "Nhà thầu không tham dự phần lô đã chọn."))
        elif lot_id:
            errors.append(_error(item, "phanLoId", "BIDDER_GOODS_UNEXPECTED_LOT", "Gói không phân lô không được gán phần lô cho hàng hóa dự thầu."))

        if requirement_id:
            if not requirement or clean_id(requirement.get("goi_thau_id")) != package_id:
                errors.append(_error(item, "goiThauHangHoaId", "BIDDER_GOODS_REQUIREMENT_INVALID", "Hàng hóa yêu cầu không thuộc gói thầu hiện tại."))
            elif clean_id(requirement.get("phan_lo_id")) != lot_id:
                errors.append(_error(item, "goiThauHangHoaId", "BIDDER_GOODS_REQUIREMENT_LOT_MISMATCH", "Hàng hóa yêu cầu không thuộc đúng phần lô."))
            mapping_key = (str(opening_id), str(requirement_id))
            conflicting_id = seen_mappings.get(mapping_key) or stored_mappings.get(mapping_key)
            if conflicting_id and conflicting_id != record_id:
                errors.append(_error(item, "goiThauHangHoaId", "DUPLICATE_BIDDER_GOODS_MAPPING", "Một hàng hóa yêu cầu chỉ được ghép một lần trong cùng hồ sơ dự thầu."))
            else:
                seen_mappings[mapping_key] = record_id

        if not is_draft:
            if not requirement_id or str(item.get("mappingStatus") or item.get("mapping_status") or "") != "matched":
                errors.append(_error(item, "goiThauHangHoaId", "BIDDER_GOODS_UNMATCHED", "Không thể lưu chính thức khi còn hàng hóa chưa ghép."))
            quantity = item.get("khoiLuong", item.get("khoi_luong"))
            unit_price = _amount(item.get("donGiaDuThau", item.get("don_gia_du_thau")))
            line_total = _amount(item.get("thanhTienDuThau", item.get("thanh_tien_du_thau")))
            try:
                expected = Decimal(str(quantity)) * unit_price if unit_price is not None else None
            except (InvalidOperation, TypeError, ValueError):
                expected = None
            if expected is None or line_total is None or abs(expected - line_total) > Decimal(1):
                errors.append(_error(item, "thanhTienDuThau", "BIDDER_GOODS_LINE_TOTAL_MISMATCH", "Thành tiền phải khớp khối lượng nhân đơn giá, sai lệch tối đa 1 VND."))
            official_by_scope[(str(opening_id), str(lot_id or ""))].append((requirement_id, line_total))

    for (opening_id, lot_key), official_rows in official_by_scope.items():
        opening = openings.get(opening_id) or {}
        effective_rows = [
            (requirement_id, total)
            for record_id, requirement_id, total in stored_official_by_scope.get((opening_id, lot_key), ())
            if record_id not in incoming_record_ids
        ]
        effective_rows.extend(official_rows)
        required_rows = cursor.execute(
            """SELECT id FROM goi_thau_hang_hoa
               WHERE organization_id = ? AND goi_thau_id = ?
                 AND ((? = '' AND phan_lo_id IS NULL) OR phan_lo_id = ?)""",
            (organization_id, clean_id(opening.get("goi_thau_id")), lot_key, lot_key or None),
        ).fetchall()
        required_ids = {str(_value(row, "id", 0)) for row in required_rows}
        mapped_ids = {str(requirement_id) for requirement_id, _total in effective_rows if requirement_id}
        if required_ids - mapped_ids:
            errors.append({
                "table": "hang_hoa_du_thau_nha_thau",
                "id": None,
                "field": "goiThauHangHoaId",
                "code": "BIDDER_GOODS_INCOMPLETE",
                "message": "Chưa nhập đủ hàng hóa yêu cầu của nhà thầu/phần lô.",
            })
        totals = [total for _requirement_id, total in effective_rows if total is not None]
        bid_price = _amount(opening.get("gia_du_thau"))
        if bid_price is None or len(totals) != len(effective_rows) or abs(sum(totals, Decimal(0)) - bid_price) > Decimal(1):
            errors.append({
                "table": "hang_hoa_du_thau_nha_thau",
                "id": None,
                "field": "thanhTienDuThau",
                "code": "BIDDER_GOODS_BID_TOTAL_MISMATCH",
                "message": "Tổng hàng hóa dự thầu phải khớp giá dự thầu trước giảm giá, sai lệch tối đa 1 VND.",
            })
    return errors
