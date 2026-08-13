"""Cross-record validation for bidder-goods sync batches."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json

from backend.domain.goods_preference import calculate_goods_preference, preference_rate_bp
from backend.domain.goods_workflow import supports_goods_workflow
from backend.shared.numeric_utils import parse_vnd_amount
from backend.shared.text_utils import clean_id, normalize_lot_code


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


def _pending_value(record, camel_name, snake_name, default=None):
    if camel_name in record:
        return record.get(camel_name)
    return record.get(snake_name, default)


def _pending_records(incoming_records_by_table, table_name):
    return (incoming_records_by_table or {}).get(table_name, {})


def validate_bidder_goods_batch(
    cursor,
    organization_id,
    items,
    opening_items=None,
    *,
    incoming_records_by_table=None,
):
    items = [item for item in (items or ()) if isinstance(item, dict)]
    if not items:
        return []
    incoming_record_ids = {clean_id(item.get("id")) for item in items} - {None}
    opening_payload_by_id = {
        clean_id(item.get("id")): item for item in (opening_items or ()) if isinstance(item, dict)
    }

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
        (
            "id", "linh_vuc", "phan_lo", "trang_thai",
            "phuong_thuc_lua_chon", "phuong_phap_danh_gia",
        ),
    )
    openings = _load_by_ids(
        cursor,
        "thong_tin_mo_thau",
        organization_id,
        opening_ids,
        ("id", "goi_thau_id", "ma_phan_lo", "gia_du_thau", "archived_at", "ty_le_giam_gia", "gia_sau_giam_gia"),
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
    for record_id, record in _pending_records(
        incoming_records_by_table, "goi_thau"
    ).items():
        if str(record_id) not in package_ids:
            continue
        packages[str(record_id)] = {
            "id": record_id,
            "linh_vuc": _pending_value(record, "linhVuc", "linh_vuc"),
            "phan_lo": _pending_value(record, "phanLo", "phan_lo"),
            "trang_thai": _pending_value(record, "trangThai", "trang_thai"),
            "phuong_thuc_lua_chon": _pending_value(
                record, "phuongThucLuaChon", "phuong_thuc_lua_chon"
            ),
            "phuong_phap_danh_gia": _pending_value(
                record, "phuongPhapDanhGia", "phuong_phap_danh_gia"
            ),
        }
        for lot in record.get("phanLoList") or record.get("phan_lo_list") or ():
            if not isinstance(lot, dict):
                continue
            lot_id = clean_id(lot.get("id"))
            if lot_id and lot_id in lot_ids:
                lots[str(lot_id)] = {
                    "id": lot_id,
                    "goi_thau_id": record_id,
                    "ma_phan_lo": _pending_value(lot, "maPhanLo", "ma_phan_lo"),
                    "archived_at": _pending_value(lot, "archivedAt", "archived_at"),
                }
    for record_id, record in _pending_records(
        incoming_records_by_table, "thong_tin_mo_thau"
    ).items():
        if str(record_id) not in opening_ids:
            continue
        openings[str(record_id)] = {
            "id": record_id,
            "goi_thau_id": _pending_value(record, "goiThauId", "goi_thau_id"),
            "ma_phan_lo": _pending_value(record, "maPhanLo", "ma_phan_lo"),
            "gia_du_thau": _pending_value(record, "giaDuThau", "gia_du_thau"),
            "archived_at": _pending_value(record, "archivedAt", "archived_at"),
            "ty_le_giam_gia": _pending_value(
                record, "tyLeGiamGia", "ty_le_giam_gia"
            ),
            "gia_sau_giam_gia": _pending_value(
                record, "giaSauGiamGia", "gia_sau_giam_gia"
            ),
        }
    for record_id, record in _pending_records(
        incoming_records_by_table, "goi_thau_hang_hoa"
    ).items():
        if str(record_id) not in requirement_ids:
            continue
        requirements[str(record_id)] = {
            "id": record_id,
            "goi_thau_id": _pending_value(record, "goiThauId", "goi_thau_id"),
            "phan_lo_id": _pending_value(record, "phanLoId", "phan_lo_id"),
        }
    required_ids_by_scope = defaultdict(set)
    for chunk in _chunked(sorted(package_ids)):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, goi_thau_id, phan_lo_id
                  FROM goi_thau_hang_hoa
                 WHERE organization_id = ?
                   AND goi_thau_id IN ({placeholders})""",
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            required_ids_by_scope[(
                str(_value(row, "goi_thau_id", 1)),
                str(_value(row, "phan_lo_id", 2) or ""),
            )].add(str(_value(row, "id", 0)))
    for record_id, requirement in _pending_records(
        incoming_records_by_table, "goi_thau_hang_hoa"
    ).items():
        package_id = clean_id(_pending_value(
            requirement, "goiThauId", "goi_thau_id"
        ))
        if package_id not in package_ids:
            continue
        lot_id = clean_id(_pending_value(
            requirement, "phanLoId", "phan_lo_id"
        ))
        required_ids_by_scope[(str(package_id), str(lot_id or ""))].add(
            str(record_id)
        )
    technical_results = {}
    detailed_progress = {}
    if opening_ids:
        for chunk in _chunked(sorted(opening_ids)):
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"SELECT thong_tin_mo_thau_id, danh_gia_ky_thuat FROM ket_qua_danh_gia_nha_thau "
                f"WHERE organization_id = ? AND thong_tin_mo_thau_id IN ({placeholders})",
                (organization_id, *chunk),
            ).fetchall()
            for row in rows:
                technical_results[str(_value(row, "thong_tin_mo_thau_id", 0))] = str(
                    _value(row, "danh_gia_ky_thuat", 1) or ""
                )
            reports = cursor.execute(
                f"""SELECT report.thong_tin_mo_thau_id, report.extension_json
                      FROM bao_cao_danh_gia_nha_thau AS report
                      JOIN vong_danh_gia AS round
                        ON round.organization_id = report.organization_id
                       AND round.id = report.vong_danh_gia_id
                     WHERE report.organization_id = ?
                       AND round.loai_vong = 'single'
                       AND report.thong_tin_mo_thau_id IN ({placeholders})""",
                (organization_id, *chunk),
            ).fetchall()
            for row in reports:
                try:
                    extension = json.loads(str(_value(row, "extension_json", 1) or "{}"))
                except (TypeError, ValueError, json.JSONDecodeError):
                    extension = {}
                detailed_progress[str(_value(row, "thong_tin_mo_thau_id", 0))] = extension
    for record_id, opening in _pending_records(
        incoming_records_by_table, "thong_tin_mo_thau"
    ).items():
        if str(record_id) not in opening_ids:
            continue
        technical_results[str(record_id)] = str(_pending_value(
            opening, "danhGiaKyThuat", "danh_gia_ky_thuat", ""
        ) or "")
        reports = (
            opening.get("baoCaoDanhGiaChiTietList")
            or opening.get("bao_cao_danh_gia_chi_tiet_list")
            or ()
        )
        report = next((
            value for value in reports
            if isinstance(value, dict)
            and str(_pending_value(value, "loaiVong", "loai_vong", "single"))
                == "single"
        ), None)
        if report:
            extension = report.get("extension")
            if isinstance(extension, dict):
                detailed_progress[str(record_id)] = extension

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
        try:
            code = int(item.get("maUuDai", item.get("ma_uu_dai", 0)) or 0)
            preference_rate_bp(code)
            item["maUuDai"] = code
        except (TypeError, ValueError):
            errors.append(_error(item, "maUuDai", "BIDDER_GOODS_PREFERENCE_CODE_INVALID", "Mã ưu đãi phải là số nguyên từ 0 đến 5."))
        package = packages.get(str(package_id))
        opening = openings.get(str(opening_id))
        lot = lots.get(str(lot_id)) if lot_id else None
        requirement = requirements.get(str(requirement_id)) if requirement_id else None

        if not package or not supports_goods_workflow(package.get("linh_vuc")):
            errors.append(_error(item, "goiThauId", "BIDDER_GOODS_PACKAGE_INVALID", "Hàng hóa dự thầu chỉ áp dụng cho gói thầu lĩnh vực Hàng hóa hoặc Hỗn hợp trong tổ chức hiện tại."))
            continue
        if not opening or opening.get("archived_at") or clean_id(opening.get("goi_thau_id")) != package_id:
            errors.append(_error(item, "thongTinMoThauId", "BIDDER_GOODS_OPENING_INVALID", "Hồ sơ mở thầu không thuộc gói thầu hiện tại."))
            continue

        is_lotted = str(package.get("phan_lo") or "").strip() == "Có"
        opening_lot_code = normalize_lot_code(opening.get("ma_phan_lo"))
        if is_lotted:
            if not lot or lot.get("archived_at") or clean_id(lot.get("goi_thau_id")) != package_id:
                errors.append(_error(item, "phanLoId", "BIDDER_GOODS_LOT_INVALID", "Phần lô không thuộc gói thầu hiện tại."))
            elif normalize_lot_code(lot.get("ma_phan_lo")) != opening_lot_code:
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
            is_two_envelope = "hai túi" in str(
                package.get("phuong_thuc_lua_chon") or ""
            ).casefold()
            progress = detailed_progress.get(str(opening_id), {})
            completed_groups = set(progress.get("completedGroups") or [])
            group_results = progress.get("groupResults") or {}
            single_prerequisite_passed = (
                int(progress.get("workflowVersion") or 0) >= 2
                and "technical" in completed_groups
                and group_results.get("technical") == "Đạt"
            )
            technical_prerequisite_passed = (
                technical_results.get(str(opening_id), "").strip().startswith("Đạt")
                and (is_two_envelope or single_prerequisite_passed)
            )
            if not technical_prerequisite_passed:
                errors.append(_error(item, "isDraft", "BIDDER_GOODS_TECHNICAL_PREREQUISITE", "Chỉ được chốt danh mục hàng hóa sau khi phần Kỹ thuật đã hoàn thành và Đạt."))
            preference_status = str(item.get("uuDaiMatchStatus", item.get("uu_dai_match_status", "matched")) or "matched")
            if preference_status != "matched":
                errors.append(_error(item, "uuDaiMatchStatus", "BIDDER_GOODS_PREFERENCE_UNRESOLVED", "Khai báo hoặc mapping Mẫu 15A còn mơ hồ/mâu thuẫn."))
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
        required_ids = required_ids_by_scope.get((
            str(clean_id(opening.get("goi_thau_id")) or ""),
            lot_key,
        ), set())
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
        scope_items = [
            item for item in items
            if clean_id(item.get("thongTinMoThauId") or item.get("thong_tin_mo_thau_id")) == opening_id
            and str(clean_id(item.get("phanLoId") or item.get("phan_lo_id")) or "") == lot_key
            and item.get("isDraft", item.get("is_draft", True)) in (False, 0, "0", "false", "False")
        ]
        if scope_items and len(scope_items) != len(effective_rows):
            errors.append({
                "table": "hang_hoa_du_thau_nha_thau",
                "id": None,
                "field": "trangThaiUuDai",
                "code": "BIDDER_GOODS_SCOPE_RECOMPUTE_REQUIRED",
                "message": "Phải gửi đầy đủ hàng hóa trong phạm vi nhà thầu/phần lô để máy chủ tính lại ưu đãi.",
            })
        elif scope_items:
            try:
                opening_payload = opening_payload_by_id.get(opening_id)
                calculation = calculate_goods_preference(
                    scope_items,
                    discount_rate=opening.get("ty_le_giam_gia") or 0,
                    scope_after_discount=opening.get("gia_sau_giam_gia"),
                    evaluation_base=(opening_payload or {}).get("giaXepHang"),
                )
                by_id = {str(line.get("id")): line for line in calculation["lines"]}
                for item in scope_items:
                    derived = by_id.get(str(item.get("id")))
                    if not derived:
                        continue
                    for field in (
                        "maUuDai", "heSoUuDaiGocBp", "heSoCongUuDaiBp",
                        "giaTriCoSoSauGiamGia", "giaTriCongUuDai", "thanhTienSauUuDai",
                    ):
                        item[field] = derived[field]
                    item["trangThaiUuDai"] = "ready"
                if opening_payload is not None:
                    opening_payload["tongGiaTriCongUuDai"] = calculation["tongGiaTriCongUuDai"]
                    opening_payload["giaSoSanhSauUuDai"] = calculation["giaSoSanhSauUuDai"]
                    opening_payload["giaDanhGiaSauUuDai"] = calculation["giaDanhGiaSauUuDai"]
                    opening_payload["trangThaiTinhUuDai"] = "ready"
                    opening_payload["uuDaiTinhLuc"] = datetime.now(timezone.utc).isoformat()
                    hash_payload = {
                        "rows": [{
                            "id": item.get("id"),
                            "maUuDai": item.get("maUuDai"),
                            "khoiLuong": item.get("khoiLuong"),
                            "donGiaDuThau": item.get("donGiaDuThau"),
                            "thanhTienDuThau": item.get("thanhTienDuThau"),
                            "goiThauHangHoaId": item.get("goiThauHangHoaId"),
                            "phanLoId": item.get("phanLoId"),
                        } for item in sorted(
                            scope_items,
                            key=lambda value: str(value.get("id") or ""),
                        )],
                        "tyLeGiamGia": opening.get("ty_le_giam_gia"),
                        "giaSauGiamGia": opening.get("gia_sau_giam_gia"),
                        "giaXepHang": (opening_payload or {}).get("giaXepHang"),
                        "phuongPhapDanhGia": package.get("phuong_phap_danh_gia"),
                    }
                    opening_payload["uuDaiInputHash"] = hashlib.sha256(
                        json.dumps(hash_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
                    ).hexdigest()
            except ValueError as exc:
                errors.append({
                    "table": "hang_hoa_du_thau_nha_thau",
                    "id": None,
                    "field": "maUuDai",
                    "code": "BIDDER_GOODS_PREFERENCE_CALCULATION_FAILED",
                    "message": str(exc),
                })
    return errors
