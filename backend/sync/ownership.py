from backend.shared.helpers import clean_id
from backend.sync.mapper import get_payload_value
from backend.shared.domain_enums import enum_label
from backend.shared.workspace_scope import personal_scope_owner_id


OWNER_SCOPED_REFERENCES = {
    "ke_hoach_lcnt": [("chu_dau_tu_id", "chu_dau_tu")],
    "goi_thau": [
        ("ke_hoach_id", "ke_hoach_lcnt"),
        ("nha_thau_trung_thau_id", "nha_thau"),
        ("rebid_from_package_id", "goi_thau"),
    ],
    "hop_dong": [
        ("chu_dau_tu_id", "chu_dau_tu"),
        ("nha_thau_id", "nha_thau"),
        ("chu_dau_tu_thanh_ly_id", "chu_dau_tu"),
        ("nha_thau_thanh_ly_id", "nha_thau"),
        ("ke_hoach_id", "ke_hoach_lcnt"),
    ],
    "thong_tin_mo_thau": [("goi_thau_id", "goi_thau"), ("nha_thau_id", "nha_thau")],
}

ARCHIVABLE_REFERENCE_TABLES = {
    "chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"
}


def get_owner_type(cursor, organization_id):
    if cursor.execute("SELECT 1 FROM to_chuc WHERE id = ?", (organization_id,)).fetchone():
        return "organization"
    owner_id = personal_scope_owner_id(organization_id)
    if owner_id and cursor.execute(
        "SELECT 1 FROM tai_khoan WHERE id = ? AND vai_tro != 'super_admin'",
        (owner_id,),
    ).fetchone():
        return "personal"
    return "unknown"


def _incoming_record(incoming_records_by_table, table_name, record_id):
    return (incoming_records_by_table or {}).get(table_name, {}).get(str(record_id))


def _plan_root_id(cursor, organization_id, plan_id, incoming_records_by_table=None):
    if not plan_id:
        return None
    incoming = _incoming_record(incoming_records_by_table, "ke_hoach_lcnt", plan_id)
    if incoming:
        return clean_id(incoming.get("rootId") or incoming.get("idGoc") or incoming.get("id"))
    row = cursor.execute(
        """SELECT COALESCE(NULLIF(id_goc, ''), id)
           FROM ke_hoach_lcnt
           WHERE organization_id = ? AND id = ? AND archived_at IS NULL
           LIMIT 1""",
        (organization_id, plan_id),
    ).fetchone()
    return clean_id(row[0]) if row else None


def validate_owner_scoped_references(
    cursor,
    organization_id,
    table_name,
    item,
    incoming_ids_by_table=None,
    incoming_records_by_table=None,
):
    errors = []
    incoming_ids_by_table = incoming_ids_by_table or {}
    if table_name in {"phan_cong_nhan_su", "ma_tran_phan_quyen"}:
        emp_id = clean_id(get_payload_value(table_name, item, "id_nhan_vien" if table_name == "phan_cong_nhan_su" else "emp_id"))
        if emp_id and str(emp_id) != str(organization_id):
            cursor.execute(
                """SELECT 1
                   FROM tai_khoan tk
                   LEFT JOIN thanh_vien_to_chuc tvtc
                     ON tvtc.user_id = tk.id AND tvtc.organization_id = ?
                   WHERE tk.id = ?
                     AND (tvtc.user_id IS NOT NULL
                          OR (? = 1 AND lower(trim(tk.vai_tro)) = 'super_admin'))
                   LIMIT 1""",
                (organization_id, emp_id, int(table_name == "phan_cong_nhan_su")),
            )
            if not cursor.fetchone():
                errors.append(f"Nhan su {emp_id} khong thuoc owner hien tai.")

    if table_name == "phan_cong_nhan_su":
        target_id = clean_id(get_payload_value(table_name, item, "id_muc_tieu"))
        target_type = str(get_payload_value(table_name, item, "loai_doi_tuong") or "").strip()
        target_table = {"kehoach": "ke_hoach_lcnt", "goithau": "goi_thau", "hopdong": "hop_dong"}.get(target_type)
        if target_id and target_table:
            if str(target_id) in incoming_ids_by_table.get(target_table, set()):
                target_table = None
        if target_id and target_table:
            active_clause = " AND archived_at IS NULL" if target_table in ARCHIVABLE_REFERENCE_TABLES else ""
            cursor.execute(
                f"SELECT 1 FROM {target_table} WHERE organization_id = ? AND id = ?{active_clause} LIMIT 1",
                (organization_id, target_id),
            )
            if not cursor.fetchone():
                errors.append(f"Phan cong {target_type}={target_id} khong thuoc owner hien tai.")

    for col_name, ref_table in OWNER_SCOPED_REFERENCES.get(table_name, []):
        ref_id = clean_id(get_payload_value(table_name, item, col_name))
        if not ref_id:
            continue
        if str(ref_id) in incoming_ids_by_table.get(ref_table, set()):
            continue
        active_clause = " AND archived_at IS NULL" if ref_table in ARCHIVABLE_REFERENCE_TABLES else ""
        cursor.execute(
            f"SELECT 1 FROM {ref_table} WHERE organization_id = ? AND id = ?{active_clause} LIMIT 1",
            (organization_id, ref_id),
        )
        if not cursor.fetchone():
            errors.append(f"Tham chieu {col_name}={ref_id} khong thuoc owner hien tai.")

    if table_name == "goi_thau":
        package_id = clean_id(item.get("id"))
        rebid_from_id = clean_id(get_payload_value(table_name, item, "rebid_from_package_id"))
        if rebid_from_id:
            source = cursor.execute(
                """
                SELECT trang_thai
                FROM goi_thau
                WHERE organization_id = ? AND id = ? AND archived_at IS NULL
                LIMIT 1
                """,
                (organization_id, rebid_from_id),
            ).fetchone()
            if not source:
                errors.append(f"Goi thau nguon {rebid_from_id} khong ton tai hoac da duoc luu tru.")
            elif str(enum_label("goi_thau", "trang_thai", source[0]) or "").strip() != "Hủy thầu":
                errors.append("Chỉ được đấu thầu lại từ một gói đã hủy thầu.")
            if package_id:
                creates_cycle = cursor.execute(
                    """WITH RECURSIVE source_chain(id) AS (
                           SELECT ?
                           UNION
                           SELECT packages.rebid_from_package_id
                           FROM goi_thau AS packages
                           INNER JOIN source_chain ON packages.id = source_chain.id
                           WHERE packages.organization_id = ?
                             AND packages.rebid_from_package_id IS NOT NULL
                       )
                       SELECT 1 FROM source_chain WHERE id = ? LIMIT 1""",
                    (rebid_from_id, organization_id, package_id),
                ).fetchone() is not None
                if creates_cycle:
                    errors.append("Chuỗi đấu thầu lại không được tạo vòng tham chiếu.")

        winner_id = clean_id(get_payload_value(table_name, item, "nha_thau_trung_thau_id"))
        status = str(enum_label("goi_thau", "trang_thai", get_payload_value(table_name, item, "trang_thai")) or "").strip()
        selection_method = str(get_payload_value(table_name, item, "hinh_thuc_lua_chon") or "").strip()
        requires_opening = selection_method not in {
            "Chỉ định thầu rút gọn",
            "Lựa chọn nhà thầu trong trường hợp đặc biệt",
        }
        if package_id and winner_id and requires_opening:
            incoming_opening = next((
                opening
                for opening in (incoming_records_by_table or {}).get("thong_tin_mo_thau", {}).values()
                if clean_id(get_payload_value("thong_tin_mo_thau", opening, "goi_thau_id")) == package_id
                and clean_id(get_payload_value("thong_tin_mo_thau", opening, "nha_thau_id")) == winner_id
            ), None)
            stored_opening = cursor.execute(
                """SELECT mt.id, kq.danh_gia_ket_luan
                   FROM thong_tin_mo_thau mt
                   LEFT JOIN ket_qua_danh_gia_nha_thau kq
                     ON kq.organization_id = mt.organization_id
                    AND kq.thong_tin_mo_thau_id = mt.id
                    AND kq.goi_thau_id = mt.goi_thau_id
                   WHERE mt.organization_id = ? AND mt.goi_thau_id = ?
                     AND mt.nha_thau_id = ? AND mt.archived_at IS NULL
                   LIMIT 1""",
                (organization_id, package_id, winner_id),
            ).fetchone()
            if not incoming_opening and not stored_opening:
                errors.append("Nhà thầu trúng thầu phải thuộc danh sách hồ sơ đã mở thầu của gói.")
            else:
                conclusion = ""
                if incoming_opening:
                    conclusion = str(incoming_opening.get("danhGiaKetLuan") or "").strip()
                if not conclusion and stored_opening:
                    conclusion = str(stored_opening[1] or "").strip()
                if not conclusion.casefold().startswith("đạt"):
                    errors.append("Nhà thầu trúng thầu phải có kết luận đánh giá Đạt.")
        if status == "Đã có kết quả" and not winner_id:
            errors.append("Gói đã có kết quả phải xác định nhà thầu trúng thầu.")

    if table_name == "hop_dong":
        package_ids = [clean_id(value) for value in (item.get("goiThauIds") or [])]
        package_ids = [value for value in package_ids if value]
        if len(package_ids) != len(set(package_ids)):
            errors.append("Danh sách gói thầu của hợp đồng không được chứa ID trùng lặp.")
        contract_plan_id = clean_id(get_payload_value(table_name, item, "ke_hoach_id"))
        contract_plan_root = _plan_root_id(
            cursor, organization_id, contract_plan_id, incoming_records_by_table
        )
        for package_id in package_ids:
            incoming_package = _incoming_record(
                incoming_records_by_table, "goi_thau", package_id
            )
            if incoming_package:
                package_plan_id = clean_id(get_payload_value("goi_thau", incoming_package, "ke_hoach_id"))
            else:
                package_row = cursor.execute(
                    """SELECT ke_hoach_id
                       FROM goi_thau
                       WHERE organization_id = ? AND id = ? AND archived_at IS NULL
                       LIMIT 1""",
                    (organization_id, package_id),
                ).fetchone()
                if not package_row:
                    errors.append(f"Gói thầu {package_id} không tồn tại, đã lưu trữ hoặc khác tổ chức.")
                    continue
                package_plan_id = clean_id(package_row[0])

            package_plan_root = _plan_root_id(
                cursor, organization_id, package_plan_id, incoming_records_by_table
            )
            if not contract_plan_root or package_plan_root != contract_plan_root:
                errors.append(f"Gói thầu {package_id} không thuộc kế hoạch/lineage của hợp đồng.")

    if table_name == "thong_tin_mo_thau":
        package_id = clean_id(get_payload_value(table_name, item, "goi_thau_id"))
        lot_code = str(get_payload_value(table_name, item, "ma_phan_lo") or "").strip()
        if not package_id:
            package_id = None
        incoming_package = _incoming_record(incoming_records_by_table, "goi_thau", package_id)
        if incoming_package:
            is_lotted = str(get_payload_value("goi_thau", incoming_package, "phan_lo") or "").strip() == "Có"
            lot_codes = {
                str(lot.get("maPhanLo") or lot.get("ma_phan_lo") or "").strip().casefold()
                for lot in (incoming_package.get("phanLoList") or [])
                if isinstance(lot, dict)
            }
        elif package_id:
            package_row = cursor.execute(
                """SELECT phan_lo FROM goi_thau
                   WHERE organization_id = ? AND id = ? AND archived_at IS NULL
                   LIMIT 1""",
                (organization_id, package_id),
            ).fetchone()
            is_lotted = bool(package_row and str(package_row[0] or "").strip() == "Có")
            lot_codes = {
                str(row[0] or "").strip().casefold()
                for row in cursor.execute(
                    """SELECT ma_phan_lo FROM goi_thau_phan_lo
                       WHERE organization_id = ? AND goi_thau_id = ?
                         AND archived_at IS NULL""",
                    (organization_id, package_id),
                ).fetchall()
            }
        else:
            is_lotted = False
            lot_codes = set()
        if package_id:
            if is_lotted and (not lot_code or lot_code.casefold() not in lot_codes):
                errors.append("Mã phần lô của hồ sơ mở thầu không tồn tại trong gói thầu.")
            if not is_lotted and lot_code:
                errors.append("Gói không phân lô không được ghi mã phần lô trong hồ sơ mở thầu.")

        for member in item.get("thanhVienLienDanh") or []:
            if not isinstance(member, dict):
                continue
            contractor_id = clean_id(
                member.get("thanhVienNhaThauId")
                or member.get("thanh_vien_nha_thau_id")
            )
            if not contractor_id or str(contractor_id) in incoming_ids_by_table.get("nha_thau", set()):
                continue
            cursor.execute(
                "SELECT 1 FROM nha_thau WHERE organization_id = ? AND id = ? AND archived_at IS NULL LIMIT 1",
                (organization_id, contractor_id),
            )
            if not cursor.fetchone():
                errors.append(f"Thanh vien lien danh nha_thau_id={contractor_id} khong thuoc owner hien tai.")

    if table_name in {"nha_thau", "thong_tin_mo_thau"}:
        member_root_ids = []
        for member in item.get("thanhVienLienDanh") or []:
            if not isinstance(member, dict):
                continue
            contractor_id = clean_id(
                member.get("thanhVienNhaThauId")
                or member.get("thanh_vien_nha_thau_id")
            )
            if not contractor_id:
                continue
            incoming_contractor = _incoming_record(
                incoming_records_by_table, "nha_thau", contractor_id
            )
            if incoming_contractor:
                root_id = clean_id(
                    incoming_contractor.get("rootId")
                    or incoming_contractor.get("idGoc")
                    or incoming_contractor.get("id")
                )
            else:
                root_row = cursor.execute(
                    """SELECT COALESCE(NULLIF(id_goc, ''), id)
                       FROM nha_thau
                       WHERE organization_id = ? AND id = ? AND archived_at IS NULL
                       LIMIT 1""",
                    (organization_id, contractor_id),
                ).fetchone()
                root_id = clean_id(root_row[0]) if root_row else None
            if root_id:
                member_root_ids.append(root_id)
        if len(member_root_ids) != len(set(member_root_ids)):
            errors.append("Một nhà thầu logic không được xuất hiện bằng nhiều phiên bản trong cùng liên danh.")
    return errors
