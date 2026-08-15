"""Mutability policy for records owned by a versioned plan/package graph."""

from __future__ import annotations

from dataclasses import dataclass, field

from backend.shared.text_utils import clean_id


PACKAGE_CHILD_TABLES = frozenset({
    "goi_thau_phan_lo",
    "thong_tin_mo_thau",
    "goi_thau_hang_hoa",
    "hang_hoa_du_thau_nha_thau",
    "dot_xu_ly_phan_lo",
    "nhom_phu_thuoc_phan_lo",
    "vong_danh_gia",
    "ket_qua_danh_gia_nha_thau",
    "goi_thau_moc_tien_do",
    "goi_thau_dieu_chinh_hsmt",
    "tai_lieu_goi_thau",
    "goi_thau_chuyen_gia",
    "goi_thau_tuy_chon_mua_them",
    "goi_thau_gia_han",
    "goi_thau_lam_ro",
    "nha_thau_tham_du_mo_thau",
    "contractor_violation_checks",
})
_QUERY_CHUNK_SIZE = 500


def _value(record, camel_name, snake_name):
    if not isinstance(record, dict):
        return None
    if camel_name in record:
        return record.get(camel_name)
    return record.get(snake_name)


def _chunks(values):
    values = sorted(set(values))
    for offset in range(0, len(values), _QUERY_CHUNK_SIZE):
        yield values[offset:offset + _QUERY_CHUNK_SIZE]


def _row_value(row, name, index):
    try:
        return row[name]
    except (KeyError, TypeError):
        return row[index]


@dataclass(slots=True)
class AggregateMutabilityContext:
    package_plan_by_id: dict[str, str] = field(default_factory=dict)
    plan_is_latest_by_id: dict[str, bool] = field(default_factory=dict)

    def package_is_mutable(self, package_id) -> bool:
        package_id = clean_id(package_id)
        if not package_id:
            return True
        plan_id = self.package_plan_by_id.get(str(package_id))
        if not plan_id:
            return True
        return self.plan_is_latest_by_id.get(str(plan_id), False)


def build_aggregate_mutability_context(
    cursor,
    organization_id,
    records_by_table,
    current_records_by_table=None,
):
    """Build DB ∪ pending-payload ownership state with bounded queries."""

    current_records_by_table = current_records_by_table or {}
    context = AggregateMutabilityContext()
    package_ids = set()

    for package in records_by_table.get("goi_thau", ()):
        package_id = clean_id(package.get("id"))
        if not package_id:
            continue
        package_id = str(package_id)
        package_ids.add(package_id)
        current = current_records_by_table.get("goi_thau", {}).get(package_id, {})
        plan_id = clean_id(
            _value(package, "keHoachId", "ke_hoach_id")
            or current.get("ke_hoach_id")
        )
        if plan_id:
            context.package_plan_by_id[package_id] = str(plan_id)

    for table_name in PACKAGE_CHILD_TABLES:
        for item in records_by_table.get(table_name, ()):
            record_id = clean_id(item.get("id"))
            current = current_records_by_table.get(table_name, {}).get(
                str(record_id), {}
            )
            package_id = clean_id(
                _value(item, "goiThauId", "goi_thau_id")
                or current.get("goi_thau_id")
            )
            if package_id:
                package_ids.add(str(package_id))

    for assignment in records_by_table.get("phan_cong_nhan_su", ()):
        target_type = str(
            _value(assignment, "type", "loai_doi_tuong") or ""
        ).strip()
        if target_type == "goithau":
            package_id = clean_id(_value(
                assignment, "targetId", "id_muc_tieu"
            ))
            if package_id:
                package_ids.add(str(package_id))

    missing_package_ids = package_ids - context.package_plan_by_id.keys()
    for chunk in _chunks(missing_package_ids):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, ke_hoach_id FROM goi_thau
                WHERE organization_id = ? AND id IN ({placeholders})""",  # noqa: S608
            (organization_id, *chunk),
        ).fetchall()
        context.package_plan_by_id.update(
            (str(_row_value(row, "id", 0)), str(_row_value(row, "ke_hoach_id", 1)))
            for row in rows
        )

    for plan in records_by_table.get("ke_hoach_lcnt", ()):
        plan_id = clean_id(plan.get("id"))
        if not plan_id:
            continue
        current = current_records_by_table.get("ke_hoach_lcnt", {}).get(
            str(plan_id), {}
        )
        latest = _value(plan, "isLatest", "is_latest")
        if latest is None:
            latest = current.get("is_latest")
        if latest is None and not current:
            # ``is_latest`` is server-managed and therefore absent from a
            # normal client payload. A plan that is both incoming and absent
            # from PostgreSQL is the initial/current snapshot of its new
            # family for this batch, so packages created with it are mutable.
            latest = 1
        if latest is not None:
            context.plan_is_latest_by_id[str(plan_id)] = int(latest or 0) == 1

    plan_ids = set(context.package_plan_by_id.values())
    missing_plan_ids = plan_ids - context.plan_is_latest_by_id.keys()
    for chunk in _chunks(missing_plan_ids):
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, is_latest FROM ke_hoach_lcnt
                WHERE organization_id = ? AND id IN ({placeholders})""",  # noqa: S608
            (organization_id, *chunk),
        ).fetchall()
        context.plan_is_latest_by_id.update(
            (
                str(_row_value(row, "id", 0)),
                int(_row_value(row, "is_latest", 1) or 0) == 1,
            )
            for row in rows
        )
    return context


def authorized_package_family_deletion_ids(
    cursor,
    organization_id,
    records_by_table,
    context,
):
    """Authorize historical package rows only for a complete family deletion.

    Historical snapshots remain immutable when targeted on their own. A package
    family may nevertheless be removed as one aggregate when the same delete
    batch contains a representative owned by the current plan and every active
    package snapshot in that family.
    """

    packages = records_by_table.get("goi_thau", {})
    requested_by_root = {}
    has_current_by_root = {}
    for package_id, package in packages.items():
        normalized_id = clean_id(package.get("id") or package_id)
        if not normalized_id:
            continue
        normalized_id = str(normalized_id)
        root_id = clean_id(package.get("id_goc") or normalized_id)
        if not root_id:
            continue
        root_id = str(root_id)
        requested_by_root.setdefault(root_id, set()).add(normalized_id)
        if context.package_is_mutable(normalized_id):
            has_current_by_root[root_id] = True

    candidate_roots = {
        root_id
        for root_id in requested_by_root
        if has_current_by_root.get(root_id)
    }
    if not candidate_roots:
        return set()

    stored_by_root = {root_id: set() for root_id in candidate_roots}
    for offset in range(0, len(candidate_roots), _QUERY_CHUNK_SIZE):
        chunk = sorted(candidate_roots)[offset:offset + _QUERY_CHUNK_SIZE]
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            f"""SELECT id, COALESCE(id_goc, id) AS family_root
                FROM goi_thau
                WHERE organization_id = ?
                  AND archived_at IS NULL
                  AND COALESCE(id_goc, id) IN ({placeholders})
                FOR UPDATE""",  # noqa: S608 - placeholders are generated locally
            (organization_id, *chunk),
        ).fetchall()
        for row in rows:
            try:
                package_id = row["id"]
                root_id = row["family_root"]
            except (KeyError, TypeError):
                package_id, root_id = row[0], row[1]
            root_id = str(root_id)
            if root_id in stored_by_root:
                stored_by_root[root_id].add(str(package_id))

    authorized = set()
    for root_id in candidate_roots:
        stored_ids = stored_by_root.get(root_id, set())
        if stored_ids and requested_by_root[root_id] == stored_ids:
            authorized.update(stored_ids)
    return authorized


def historical_parent_mutation_error(
    context,
    table_name,
    item,
    current_record=None,
):
    package_id = None
    if table_name == "goi_thau":
        package_id = clean_id(item.get("id"))
    elif table_name in PACKAGE_CHILD_TABLES:
        package_id = clean_id(
            _value(item, "goiThauId", "goi_thau_id")
            or (current_record or {}).get("goi_thau_id")
        )
    elif table_name == "phan_cong_nhan_su" and str(
        _value(item, "type", "loai_doi_tuong") or ""
    ).strip() == "goithau":
        package_id = clean_id(_value(item, "targetId", "id_muc_tieu"))
    if not package_id or context.package_is_mutable(package_id):
        return None
    return {
        "field": "$record",
        "code": "HISTORICAL_PARENT_IMMUTABLE",
        "message": "Không thể thay đổi dữ liệu thuộc phiên bản kế hoạch lịch sử.",
    }


def package_mutability_error(cursor, organization_id, package_id, *, lock=True):
    """Resolve the owning plan under the caller's write transaction."""

    lock_clause = " FOR UPDATE OF package, plan" if lock else ""
    query = """SELECT package.id, plan.id, plan.is_latest
             FROM goi_thau AS package
             JOIN ke_hoach_lcnt AS plan
               ON plan.organization_id = package.organization_id
              AND plan.id = package.ke_hoach_id
            WHERE package.organization_id = ? AND package.id = ?
              AND package.archived_at IS NULL""" + lock_clause  # noqa: S608 - lock clause is a local boolean constant
    row = cursor.execute(
        query,
        (organization_id, package_id),
    ).fetchone()
    if not row:
        return {
            "field": "$record",
            "code": "AGGREGATE_OWNER_NOT_FOUND",
            "message": "Không tìm thấy aggregate sở hữu bản ghi.",
        }
    if int(_row_value(row, "is_latest", 2) or 0) == 1:
        return None
    return {
        "field": "$record",
        "code": "HISTORICAL_PARENT_IMMUTABLE",
        "message": "Không thể thay đổi dữ liệu thuộc phiên bản kế hoạch lịch sử.",
    }
