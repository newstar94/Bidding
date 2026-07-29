from dataclasses import dataclass, field

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
    "goi_thau_hang_hoa": [
        ("goi_thau_id", "goi_thau"),
    ],
    "hang_hoa_du_thau_nha_thau": [
        ("goi_thau_id", "goi_thau"),
        ("thong_tin_mo_thau_id", "thong_tin_mo_thau"),
        ("phan_lo_id", "goi_thau_phan_lo"),
        ("goi_thau_hang_hoa_id", "goi_thau_hang_hoa"),
    ],
}

ARCHIVABLE_REFERENCE_TABLES = {
    "chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"
}

_QUERY_CHUNK_SIZE = 500


@dataclass(slots=True)
class OwnerReferenceContext:
    active_ids_by_table: dict[str, set[str]] = field(default_factory=dict)
    root_by_table_and_id: dict[tuple[str, str], str] = field(default_factory=dict)
    organization_member_ids: set[str] = field(default_factory=set)
    platform_admin_ids: set[str] = field(default_factory=set)
    package_plan_by_id: dict[str, str | None] = field(default_factory=dict)
    package_lotted_by_id: dict[str, bool] = field(default_factory=dict)
    package_status_by_id: dict[str, object] = field(default_factory=dict)
    package_field_by_id: dict[str, str] = field(default_factory=dict)
    lot_package_by_id: dict[str, str] = field(default_factory=dict)
    lot_codes_by_package_id: dict[str, set[str]] = field(default_factory=dict)
    rebid_cycle_package_ids: set[str] = field(default_factory=set)
    winner_opening_by_pair: dict[tuple[str, str], tuple[object, object]] = field(
        default_factory=dict
    )


def _row_value(row, name, index):
    try:
        return row[name]
    except (KeyError, TypeError):
        return row[index]


def _optional_row_value(row, name, index, default=None):
    try:
        return _row_value(row, name, index)
    except (KeyError, IndexError, TypeError):
        return default


def _chunked(values):
    for offset in range(0, len(values), _QUERY_CHUNK_SIZE):
        yield values[offset:offset + _QUERY_CHUNK_SIZE]


def build_owner_reference_context(
    cursor,
    organization_id,
    records_by_table,
    incoming_ids_by_table=None,
):
    """Prefetch stable owner-scoped references used by sync validation."""

    incoming_ids_by_table = incoming_ids_by_table or {}
    referenced_ids_by_table = {}
    employee_ids = set()
    opening_package_ids = set()
    rebid_pairs = []
    winner_pairs = []

    def remember(table_name, value):
        record_id = clean_id(value)
        if record_id and str(record_id) not in incoming_ids_by_table.get(table_name, set()):
            referenced_ids_by_table.setdefault(table_name, set()).add(str(record_id))
        return record_id

    for table_name, items in records_by_table.items():
        for item in items:
            if table_name in {"phan_cong_nhan_su", "ma_tran_phan_quyen"}:
                employee_id = clean_id(get_payload_value(
                    table_name,
                    item,
                    "id_nhan_vien" if table_name == "phan_cong_nhan_su" else "emp_id",
                ))
                if employee_id and str(employee_id) != str(organization_id):
                    employee_ids.add(str(employee_id))
            if table_name == "phan_cong_nhan_su":
                target_type = str(get_payload_value(table_name, item, "loai_doi_tuong") or "").strip()
                target_table = {
                    "kehoach": "ke_hoach_lcnt",
                    "goithau": "goi_thau",
                    "hopdong": "hop_dong",
                }.get(target_type)
                if target_table:
                    remember(target_table, get_payload_value(table_name, item, "id_muc_tieu"))
            for column_name, reference_table in OWNER_SCOPED_REFERENCES.get(table_name, ()):
                remember(reference_table, get_payload_value(table_name, item, column_name))
            if table_name == "goi_thau":
                package_id = clean_id(item.get("id"))
                rebid_from_id = remember(
                    "goi_thau",
                    get_payload_value(table_name, item, "rebid_from_package_id"),
                )
                winner_id = remember(
                    "nha_thau",
                    get_payload_value(table_name, item, "nha_thau_trung_thau_id"),
                )
                if package_id and rebid_from_id:
                    rebid_pairs.append((str(package_id), str(rebid_from_id)))
                if package_id and winner_id:
                    winner_pairs.append((str(package_id), str(winner_id)))
            if table_name == "hop_dong":
                remember("ke_hoach_lcnt", get_payload_value(table_name, item, "ke_hoach_id"))
                for package_id in item.get("goiThauIds") or ():
                    remember("goi_thau", package_id)
            if table_name == "thong_tin_mo_thau":
                package_id = remember("goi_thau", get_payload_value(table_name, item, "goi_thau_id"))
                if package_id:
                    opening_package_ids.add(str(package_id))
                remember("nha_thau", get_payload_value(table_name, item, "nha_thau_id"))
            if table_name == "goi_thau_hang_hoa":
                remember("goi_thau_phan_lo", get_payload_value(table_name, item, "phan_lo_id"))
            if table_name in {"nha_thau", "thong_tin_mo_thau"}:
                for member in item.get("thanhVienLienDanh") or ():
                    if isinstance(member, dict):
                        remember(
                            "nha_thau",
                            member.get("thanhVienNhaThauId")
                            or member.get("thanh_vien_nha_thau_id"),
                        )

    context = OwnerReferenceContext()
    for chunk in _chunked(sorted(employee_ids)):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT account.id, lower(trim(account.vai_tro)) AS platform_role,
                       membership.user_id AS member_id
                FROM tai_khoan AS account
                LEFT JOIN thanh_vien_to_chuc AS membership
                  ON membership.user_id = account.id
                 AND membership.organization_id = ?
                WHERE account.id IN ({placeholders})""",
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            employee_id = str(_row_value(row, "id", 0))
            if _row_value(row, "member_id", 2) is not None:
                context.organization_member_ids.add(employee_id)
            if str(_row_value(row, "platform_role", 1) or "").strip().lower() == "super_admin":
                context.platform_admin_ids.add(employee_id)

    for table_name, record_ids in referenced_ids_by_table.items():
        active_clause = " AND archived_at IS NULL" if table_name in ARCHIVABLE_REFERENCE_TABLES else ""
        extra_columns = ""
        if table_name == "goi_thau":
            extra_columns = ", ke_hoach_id, phan_lo, trang_thai, linh_vuc"
        elif table_name == "goi_thau_phan_lo":
            extra_columns = ", goi_thau_id"
        lineage_column = ", COALESCE(NULLIF(id_goc, ''), id) AS lineage_root" if table_name in ARCHIVABLE_REFERENCE_TABLES else ""
        for chunk in _chunked(sorted(record_ids)):
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT id{lineage_column}{extra_columns}
                    FROM {table_name}
                    WHERE organization_id = ? AND id IN ({placeholders}){active_clause}""",
                (organization_id, *chunk),
            ).fetchall()
            for row in rows:
                record_id = str(_row_value(row, "id", 0))
                context.active_ids_by_table.setdefault(table_name, set()).add(record_id)
                column_index = 1
                if table_name in ARCHIVABLE_REFERENCE_TABLES:
                    lineage_root = str(_row_value(row, "lineage_root", column_index))
                    context.root_by_table_and_id[(table_name, record_id)] = lineage_root
                    column_index += 1
                if table_name == "goi_thau":
                    plan_id = clean_id(_row_value(row, "ke_hoach_id", column_index))
                    lotted = str(_row_value(row, "phan_lo", column_index + 1) or "").strip() == "Có"
                    context.package_plan_by_id[record_id] = plan_id
                    context.package_lotted_by_id[record_id] = lotted
                    context.package_status_by_id[record_id] = _row_value(
                        row,
                        "trang_thai",
                        column_index + 2,
                    )
                    context.package_field_by_id[record_id] = str(
                        _optional_row_value(row, "linh_vuc", column_index + 3, "") or ""
                    ).strip()
                elif table_name == "goi_thau_phan_lo":
                    context.lot_package_by_id[record_id] = str(
                        _row_value(row, "goi_thau_id", column_index) or ""
                    ).strip()

    stored_opening_package_ids = sorted(
        package_id
        for package_id in opening_package_ids
        if package_id not in incoming_ids_by_table.get("goi_thau", set())
    )
    for chunk in _chunked(stored_opening_package_ids):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT goi_thau_id, ma_phan_lo FROM goi_thau_phan_lo
                WHERE organization_id = ?
                  AND goi_thau_id IN ({placeholders})
                  AND archived_at IS NULL""",
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            package_id = str(_row_value(row, "goi_thau_id", 0))
            lot_code = str(_row_value(row, "ma_phan_lo", 1) or "").strip().casefold()
            context.lot_codes_by_package_id.setdefault(package_id, set()).add(lot_code)

    for chunk in _chunked(list(dict.fromkeys(rebid_pairs))):
        value_sql = ", ".join("(?, ?)" for _ in chunk)
        rows = cursor.execute(
            f"""WITH RECURSIVE requested(package_id, source_id) AS (
                       VALUES {value_sql}
                   ), source_chain(package_id, id) AS (
                       SELECT package_id, source_id FROM requested
                       UNION
                       SELECT chain.package_id, package.rebid_from_package_id
                       FROM source_chain AS chain
                       JOIN goi_thau AS package
                         ON package.organization_id = ?
                        AND package.id = chain.id
                       WHERE package.rebid_from_package_id IS NOT NULL
                   )
                   SELECT DISTINCT package_id
                   FROM source_chain
                   WHERE id = package_id""",
            (
                *(value for pair in chunk for value in pair),
                organization_id,
            ),
        ).fetchall()
        context.rebid_cycle_package_ids.update(
            str(_row_value(row, "package_id", 0)) for row in rows
        )

    incoming_contractors = {
        str(contractor_id): contractor
        for contractor in records_by_table.get("nha_thau", ())
        if (contractor_id := clean_id(contractor.get("id")))
    }
    winner_requests = []
    for package_id, winner_id in dict.fromkeys(winner_pairs):
        incoming_winner = incoming_contractors.get(winner_id, {})
        winner_root_hint = clean_id(
            incoming_winner.get("rootId")
            or incoming_winner.get("idGoc")
            or winner_id
        )
        winner_requests.append((package_id, winner_id, winner_root_hint))
    for chunk in _chunked(winner_requests):
        value_sql = ", ".join("(?, ?, ?)" for _ in chunk)
        rows = cursor.execute(
            f"""WITH requested(package_id, winner_id, winner_root_hint) AS (
                       VALUES {value_sql}
                   )
                   SELECT requested.package_id, requested.winner_id,
                          matched_opening.id,
                          matched_opening.danh_gia_ket_luan
                   FROM requested
                   JOIN LATERAL (
                       SELECT opening.id, result.danh_gia_ket_luan
                       FROM thong_tin_mo_thau AS opening
                       JOIN nha_thau AS opening_contractor
                         ON opening_contractor.organization_id = opening.organization_id
                        AND opening_contractor.id = opening.nha_thau_id
                        AND opening_contractor.archived_at IS NULL
                       LEFT JOIN nha_thau AS winner_contractor
                         ON winner_contractor.organization_id = opening.organization_id
                        AND winner_contractor.id = requested.winner_id
                        AND winner_contractor.archived_at IS NULL
                       LEFT JOIN ket_qua_danh_gia_nha_thau AS result
                         ON result.organization_id = opening.organization_id
                        AND result.thong_tin_mo_thau_id = opening.id
                        AND result.goi_thau_id = opening.goi_thau_id
                       WHERE opening.organization_id = ?
                         AND opening.goi_thau_id = requested.package_id
                         AND opening.archived_at IS NULL
                         AND COALESCE(
                             NULLIF(opening_contractor.id_goc, ''),
                             opening_contractor.id
                         ) = COALESCE(
                             NULLIF(winner_contractor.id_goc, ''),
                             winner_contractor.id,
                             requested.winner_root_hint
                         )
                       LIMIT 1
                   ) AS matched_opening ON TRUE""",
            (
                *(value for request in chunk for value in request),
                organization_id,
            ),
        ).fetchall()
        for row in rows:
            key = (
                str(_row_value(row, "package_id", 0)),
                str(_row_value(row, "winner_id", 1)),
            )
            context.winner_opening_by_pair.setdefault(
                key,
                (
                    _row_value(row, "id", 2),
                    _row_value(row, "danh_gia_ket_luan", 3),
                ),
            )
    return context


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


def _plan_root_id(
    cursor,
    organization_id,
    plan_id,
    incoming_records_by_table=None,
    reference_context=None,
):
    if not plan_id:
        return None
    incoming = _incoming_record(incoming_records_by_table, "ke_hoach_lcnt", plan_id)
    if incoming:
        return clean_id(incoming.get("rootId") or incoming.get("idGoc") or incoming.get("id"))
    if reference_context is not None:
        return clean_id(
            reference_context.root_by_table_and_id.get(
                ("ke_hoach_lcnt", str(plan_id))
            )
        )
    row = cursor.execute(
        """SELECT COALESCE(NULLIF(id_goc, ''), id)
           FROM ke_hoach_lcnt
           WHERE organization_id = ? AND id = ? AND archived_at IS NULL
           LIMIT 1""",
        (organization_id, plan_id),
    ).fetchone()
    return clean_id(row[0]) if row else None


def _contractor_root_id(
    cursor,
    organization_id,
    contractor_id,
    incoming_records_by_table=None,
    reference_context=None,
):
    if not contractor_id:
        return None
    incoming = _incoming_record(
        incoming_records_by_table, "nha_thau", contractor_id
    )
    if incoming:
        return clean_id(
            incoming.get("rootId")
            or incoming.get("idGoc")
            or incoming.get("id")
        )
    if reference_context is not None:
        return clean_id(
            reference_context.root_by_table_and_id.get(
                ("nha_thau", str(contractor_id)),
                contractor_id,
            )
        )
    row = cursor.execute(
        """SELECT COALESCE(NULLIF(id_goc, ''), id)
           FROM nha_thau
           WHERE organization_id = ? AND id = ? AND archived_at IS NULL
           LIMIT 1""",
        (organization_id, contractor_id),
    ).fetchone()
    return clean_id(row[0]) if row else clean_id(contractor_id)


def validate_owner_scoped_references(
    cursor,
    organization_id,
    table_name,
    item,
    incoming_ids_by_table=None,
    incoming_records_by_table=None,
    reference_context=None,
):
    errors = []
    incoming_ids_by_table = incoming_ids_by_table or {}
    if table_name in {"phan_cong_nhan_su", "ma_tran_phan_quyen"}:
        emp_id = clean_id(get_payload_value(table_name, item, "id_nhan_vien" if table_name == "phan_cong_nhan_su" else "emp_id"))
        if emp_id and str(emp_id) != str(organization_id):
            if reference_context is not None:
                valid_employee = str(emp_id) in reference_context.organization_member_ids
                if table_name == "phan_cong_nhan_su":
                    valid_employee = valid_employee or str(emp_id) in reference_context.platform_admin_ids
            else:
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
                valid_employee = cursor.fetchone() is not None
            if not valid_employee:
                errors.append(f"Nhan su {emp_id} khong thuoc owner hien tai.")

    if table_name == "phan_cong_nhan_su":
        target_id = clean_id(get_payload_value(table_name, item, "id_muc_tieu"))
        target_type = str(get_payload_value(table_name, item, "loai_doi_tuong") or "").strip()
        target_table = {"kehoach": "ke_hoach_lcnt", "goithau": "goi_thau", "hopdong": "hop_dong"}.get(target_type)
        if target_id and target_table:
            if str(target_id) in incoming_ids_by_table.get(target_table, set()):
                target_table = None
        if target_id and target_table:
            if reference_context is not None:
                target_exists = str(target_id) in reference_context.active_ids_by_table.get(target_table, set())
            else:
                active_clause = " AND archived_at IS NULL" if target_table in ARCHIVABLE_REFERENCE_TABLES else ""
                cursor.execute(
                    f"SELECT 1 FROM {target_table} WHERE organization_id = ? AND id = ?{active_clause} LIMIT 1",
                    (organization_id, target_id),
                )
                target_exists = cursor.fetchone() is not None
            if not target_exists:
                errors.append(f"Phan cong {target_type}={target_id} khong thuoc owner hien tai.")

    for col_name, ref_table in OWNER_SCOPED_REFERENCES.get(table_name, []):
        ref_id = clean_id(get_payload_value(table_name, item, col_name))
        if not ref_id:
            continue
        if str(ref_id) in incoming_ids_by_table.get(ref_table, set()):
            continue
        if reference_context is not None:
            reference_exists = str(ref_id) in reference_context.active_ids_by_table.get(ref_table, set())
        else:
            active_clause = " AND archived_at IS NULL" if ref_table in ARCHIVABLE_REFERENCE_TABLES else ""
            cursor.execute(
                f"SELECT 1 FROM {ref_table} WHERE organization_id = ? AND id = ?{active_clause} LIMIT 1",
                (organization_id, ref_id),
            )
            reference_exists = cursor.fetchone() is not None
        if not reference_exists:
            errors.append(f"Tham chieu {col_name}={ref_id} khong thuoc owner hien tai.")

    if table_name == "goi_thau":
        package_id = clean_id(item.get("id"))
        rebid_from_id = clean_id(get_payload_value(table_name, item, "rebid_from_package_id"))
        if rebid_from_id:
            if reference_context is not None:
                source_status = reference_context.package_status_by_id.get(str(rebid_from_id))
                source = (source_status,) if source_status is not None else None
            else:
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
                if reference_context is not None:
                    creates_cycle = str(package_id) in reference_context.rebid_cycle_package_ids
                else:
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
            winner_root_id = None
            incoming_opening = None
            for opening in (incoming_records_by_table or {}).get(
                "thong_tin_mo_thau", {}
            ).values():
                opening_package_id = clean_id(
                    get_payload_value("thong_tin_mo_thau", opening, "goi_thau_id")
                )
                if opening_package_id != package_id:
                    continue
                opening_contractor_id = clean_id(
                    get_payload_value("thong_tin_mo_thau", opening, "nha_thau_id")
                )
                same_contractor = opening_contractor_id == winner_id
                if opening_contractor_id and not same_contractor:
                    winner_root_id = winner_root_id or _contractor_root_id(
                        cursor,
                        organization_id,
                        winner_id,
                        incoming_records_by_table,
                        reference_context,
                    )
                    opening_root_id = _contractor_root_id(
                        cursor,
                        organization_id,
                        opening_contractor_id,
                        incoming_records_by_table,
                        reference_context,
                    )
                    same_contractor = bool(
                        winner_root_id and winner_root_id == opening_root_id
                    )
                if same_contractor:
                    incoming_opening = opening
                    break
            incoming_winner = _incoming_record(
                incoming_records_by_table, "nha_thau", winner_id
            )
            winner_root_hint = clean_id(
                (incoming_winner or {}).get("rootId")
                or (incoming_winner or {}).get("idGoc")
                or winner_id
            )
            if reference_context is not None:
                stored_opening = reference_context.winner_opening_by_pair.get(
                    (str(package_id), str(winner_id))
                )
            else:
                stored_opening = cursor.execute(
                    """SELECT mt.id, kq.danh_gia_ket_luan
                       FROM thong_tin_mo_thau mt
                       INNER JOIN nha_thau opening_contractor
                         ON opening_contractor.organization_id = mt.organization_id
                        AND opening_contractor.id = mt.nha_thau_id
                        AND opening_contractor.archived_at IS NULL
                       LEFT JOIN nha_thau winner_contractor
                         ON winner_contractor.organization_id = mt.organization_id
                        AND winner_contractor.id = ?
                        AND winner_contractor.archived_at IS NULL
                       LEFT JOIN ket_qua_danh_gia_nha_thau kq
                         ON kq.organization_id = mt.organization_id
                        AND kq.thong_tin_mo_thau_id = mt.id
                        AND kq.goi_thau_id = mt.goi_thau_id
                       WHERE mt.organization_id = ? AND mt.goi_thau_id = ?
                         AND COALESCE(NULLIF(opening_contractor.id_goc, ''), opening_contractor.id)
                             = COALESCE(NULLIF(winner_contractor.id_goc, ''), winner_contractor.id, ?)
                         AND mt.archived_at IS NULL
                       LIMIT 1""",
                    (winner_id, organization_id, package_id, winner_root_hint),
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
            cursor,
            organization_id,
            contract_plan_id,
            incoming_records_by_table,
            reference_context,
        )
        incoming_packages = {
            package_id: _incoming_record(
                incoming_records_by_table,
                "goi_thau",
                package_id,
            )
            for package_id in package_ids
        }
        stored_package_ids = [
            package_id
            for package_id in package_ids
            if not incoming_packages[package_id]
        ]
        if reference_context is not None:
            stored_package_plans = {
                package_id: reference_context.package_plan_by_id[package_id]
                for package_id in stored_package_ids
                if package_id in reference_context.package_plan_by_id
            }
        else:
            stored_package_plans = {}
            for offset in range(0, len(stored_package_ids), _QUERY_CHUNK_SIZE):
                chunk = stored_package_ids[offset:offset + _QUERY_CHUNK_SIZE]
                placeholders = ", ".join("?" for _ in chunk)
                rows = cursor.execute(
                    f"""SELECT id, ke_hoach_id
                        FROM goi_thau
                        WHERE organization_id = ?
                          AND id IN ({placeholders})
                          AND archived_at IS NULL""",
                    (organization_id, *chunk),
                ).fetchall()
                stored_package_plans.update(
                    (clean_id(row[0]), clean_id(row[1])) for row in rows
                )

        package_plan_ids = {
            clean_id(get_payload_value("goi_thau", package, "ke_hoach_id"))
            for package in incoming_packages.values()
            if package
        }
        package_plan_ids.update(stored_package_plans.values())
        package_plan_ids.discard(None)
        stored_plan_ids = [
            plan_id
            for plan_id in package_plan_ids
            if not _incoming_record(
                incoming_records_by_table,
                "ke_hoach_lcnt",
                plan_id,
            )
        ]
        if reference_context is not None:
            stored_plan_roots = {
                plan_id: clean_id(reference_context.root_by_table_and_id.get(
                    ("ke_hoach_lcnt", str(plan_id))
                ))
                for plan_id in stored_plan_ids
                if ("ke_hoach_lcnt", str(plan_id)) in reference_context.root_by_table_and_id
            }
        else:
            stored_plan_roots = {}
            for offset in range(0, len(stored_plan_ids), _QUERY_CHUNK_SIZE):
                chunk = stored_plan_ids[offset:offset + _QUERY_CHUNK_SIZE]
                placeholders = ", ".join("?" for _ in chunk)
                rows = cursor.execute(
                    f"""SELECT id, COALESCE(NULLIF(id_goc, ''), id)
                        FROM ke_hoach_lcnt
                        WHERE organization_id = ?
                          AND id IN ({placeholders})
                          AND archived_at IS NULL""",
                    (organization_id, *chunk),
                ).fetchall()
                stored_plan_roots.update(
                    (clean_id(row[0]), clean_id(row[1])) for row in rows
                )

        for package_id in package_ids:
            incoming_package = incoming_packages[package_id]
            if incoming_package:
                package_plan_id = clean_id(get_payload_value("goi_thau", incoming_package, "ke_hoach_id"))
            else:
                package_plan_id = stored_package_plans.get(package_id)
                if package_id not in stored_package_plans:
                    errors.append(f"Gói thầu {package_id} không tồn tại, đã lưu trữ hoặc khác tổ chức.")
                    continue
            incoming_plan = _incoming_record(
                incoming_records_by_table,
                "ke_hoach_lcnt",
                package_plan_id,
            )
            package_plan_root = (
                clean_id(
                    incoming_plan.get("rootId")
                    or incoming_plan.get("idGoc")
                    or incoming_plan.get("id")
                )
                if incoming_plan
                else stored_plan_roots.get(package_plan_id)
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
        elif package_id and reference_context is not None:
            is_lotted = reference_context.package_lotted_by_id.get(str(package_id), False)
            lot_codes = reference_context.lot_codes_by_package_id.get(
                str(package_id),
                set(),
            )
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

    if table_name == "goi_thau_hang_hoa":
        package_id = clean_id(get_payload_value(table_name, item, "goi_thau_id"))
        lot_id = clean_id(get_payload_value(table_name, item, "phan_lo_id"))
        incoming_package = _incoming_record(incoming_records_by_table, "goi_thau", package_id)
        if incoming_package:
            is_lotted = str(get_payload_value("goi_thau", incoming_package, "phan_lo") or "").strip() == "Có"
            package_field = str(get_payload_value("goi_thau", incoming_package, "linh_vuc") or "").strip()
            incoming_lots = {
                clean_id(lot.get("id")): clean_id(package_id)
                for lot in (incoming_package.get("phanLoList") or [])
                if isinstance(lot, dict) and clean_id(lot.get("id"))
            }
        else:
            is_lotted = reference_context.package_lotted_by_id.get(str(package_id), False) if reference_context else False
            package_field = reference_context.package_field_by_id.get(str(package_id), "") if reference_context else ""
            incoming_lots = {}
        if package_field != "Hàng hóa":
            errors.append("Danh mục hàng hóa chỉ áp dụng cho gói thầu lĩnh vực Hàng hóa.")
        if is_lotted and not lot_id:
            errors.append("Gói thầu phân lô bắt buộc mỗi hàng hóa phải thuộc một phần lô.")
        if not is_lotted and lot_id:
            errors.append("Gói thầu không phân lô không được gán phần lô cho hàng hóa.")
        if lot_id:
            lot_package_id = incoming_lots.get(lot_id)
            if lot_package_id is None and reference_context is not None:
                lot_package_id = clean_id(reference_context.lot_package_by_id.get(str(lot_id)))
            if lot_package_id != clean_id(package_id):
                errors.append("Phần lô của hàng hóa không thuộc gói thầu hiện tại.")

        for member in item.get("thanhVienLienDanh") or []:
            if not isinstance(member, dict):
                continue
            contractor_id = clean_id(
                member.get("thanhVienNhaThauId")
                or member.get("thanh_vien_nha_thau_id")
            )
            if not contractor_id or str(contractor_id) in incoming_ids_by_table.get("nha_thau", set()):
                continue
            if reference_context is not None:
                contractor_exists = str(contractor_id) in reference_context.active_ids_by_table.get(
                    "nha_thau",
                    set(),
                )
            else:
                cursor.execute(
                    "SELECT 1 FROM nha_thau WHERE organization_id = ? AND id = ? AND archived_at IS NULL LIMIT 1",
                    (organization_id, contractor_id),
                )
                contractor_exists = cursor.fetchone() is not None
            if not contractor_exists:
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
            elif reference_context is not None:
                root_id = clean_id(reference_context.root_by_table_and_id.get(
                    ("nha_thau", str(contractor_id))
                ))
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
