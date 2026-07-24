"""PostgreSQL database utilities used by application services."""

from __future__ import annotations

from backend.db.db_helper import database
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION


_ALLOWED_TABLES = frozenset(SCHEMA_DINH_NGHIA)


def _assert_safe_table(table_name: str) -> str:
    if table_name not in _ALLOWED_TABLES:
        raise ValueError(f"Tên bảng không hợp lệ hoặc không được phép: '{table_name}'")
    return table_name


def _chunks(values, size=200):
    values = tuple(values)
    for start in range(0, len(values), size):
        yield values[start : start + size]


def recalculate_is_latest(
    cursor,
    table_name,
    organization_id=None,
    *,
    affected_families=None,
):
    """Recompute only affected version families with one set-based update."""

    _assert_safe_table(table_name)
    is_package = table_name == "goi_thau"
    root_expr = "COALESCE(NULLIF(business.id_goc, ''), business.id)"
    partition_expr = f"business.organization_id, {root_expr}"
    if is_package:
        partition_expr += ", COALESCE(business.ke_hoach_id, '')"

    if affected_families is None:
        batches = (None,)
    else:
        if is_package:
            normalized = sorted(
                {
                    (str(root_id or "").strip(), str(plan_id or "").strip())
                    for root_id, plan_id in affected_families
                    if str(root_id or "").strip()
                }
            )
        else:
            normalized = sorted(
                {
                    str(root_id or "").strip()
                    for root_id in affected_families
                    if str(root_id or "").strip()
                }
            )
        if not normalized:
            return 0
        batches = _chunks(normalized)

    changed_rows = 0
    for family_batch in batches:
        params = []
        affected_cte = ""
        scope_join = ""
        if family_batch is not None:
            if is_package:
                values_sql = ", ".join("(?, ?)" for _ in family_batch)
                affected_cte = f"affected(root_id, plan_id) AS (VALUES {values_sql}),"
                for root_id, plan_id in family_batch:
                    params.extend((root_id, plan_id))
                scope_join = (
                    f"JOIN affected ON affected.root_id = {root_expr} "
                    "AND affected.plan_id = COALESCE(business.ke_hoach_id, '')"
                )
            else:
                values_sql = ", ".join("(?)" for _ in family_batch)
                affected_cte = f"affected(root_id) AS (VALUES {values_sql}),"
                params.extend(family_batch)
                scope_join = f"JOIN affected ON affected.root_id = {root_expr}"

        scope_filter = ""
        scoped_params = []
        if organization_id:
            scope_filter = "WHERE business.organization_id = ?"
            scoped_params.append(organization_id)
        ranked_filter = (
            f"{scope_filter} AND business.archived_at IS NULL"
            if scope_filter
            else "WHERE business.archived_at IS NULL"
        )
        params.extend(scoped_params)
        params.extend(scoped_params)

        result = cursor.execute(
            f"""
            WITH {affected_cte}
            scoped_rows AS (
                SELECT business.organization_id, business.id
                FROM {table_name} AS business
                {scope_join}
                {scope_filter}
            ),
            ranked AS (
                SELECT business.organization_id,
                       business.id,
                       ROW_NUMBER() OVER (
                           PARTITION BY {partition_expr}
                           ORDER BY business.phien_ban DESC,
                                    business.updated_at DESC,
                                    business.id DESC
                       ) AS rn
                FROM {table_name} AS business
                {scope_join}
                {ranked_filter}
            ),
            winners AS (
                SELECT organization_id, id
                FROM ranked
                WHERE rn = 1
            ),
            desired AS (
                SELECT scoped_rows.organization_id,
                       scoped_rows.id,
                       CASE WHEN winners.id IS NULL THEN 0 ELSE 1 END AS desired_is_latest
                FROM scoped_rows
                LEFT JOIN winners
                  ON winners.organization_id = scoped_rows.organization_id
                 AND winners.id = scoped_rows.id
            )
            UPDATE {table_name} AS target
            SET is_latest = desired.desired_is_latest
            FROM desired
            WHERE desired.organization_id = target.organization_id
              AND desired.id = target.id
              AND target.is_latest IS DISTINCT FROM desired.desired_is_latest
            """,
            tuple(params),
        )
        changed_rows += max(0, int(result.rowcount or 0))
    return changed_rows


def recalculate_tong_muc_dau_tu(cursor, organization_id=None, *, plan_ids=None):
    """Set-based recalculation for active automatic procurement plans."""

    if plan_ids is None:
        batches = (None,)
    else:
        normalized = sorted(
            {
                str(plan_id or "").strip()
                for plan_id in plan_ids
                if str(plan_id or "").strip()
            }
        )
        if not normalized:
            return 0
        batches = _chunks(normalized)

    changed_rows = 0
    for plan_batch in batches:
        filters = ["plan.is_tong_muc_tu_dong = 1", "plan.archived_at IS NULL"]
        params = []
        if organization_id:
            filters.append("plan.organization_id = ?")
            params.append(organization_id)
        if plan_batch is not None:
            placeholders = ", ".join("?" for _ in plan_batch)
            filters.append(f"plan.id IN ({placeholders})")
            params.extend(plan_batch)

        result = cursor.execute(
            f"""
            WITH target_plans AS (
                SELECT plan.id, plan.organization_id, plan.loai_hinh_mua_sam
                FROM ke_hoach_lcnt AS plan
                WHERE {" AND ".join(filters)}
            ),
            package_totals AS (
                SELECT package.organization_id,
                       package.ke_hoach_id AS plan_id,
                       SUM(COALESCE(package.gia_goi_thau, 0)) AS package_total
                FROM goi_thau AS package
                JOIN target_plans AS plan
                  ON plan.organization_id = package.organization_id
                 AND plan.id = package.ke_hoach_id
                WHERE package.is_latest = 1
                  AND package.archived_at IS NULL
                  AND package.is_rebid = 0
                GROUP BY package.organization_id, package.ke_hoach_id
            ),
            work_totals AS (
                SELECT work.organization_id,
                       work.ke_hoach_id AS plan_id,
                       SUM(CASE WHEN work.loai = 'da_thuc_hien' THEN COALESCE(work.gia_tri, 0) ELSE 0 END) AS completed_total,
                       SUM(CASE WHEN work.loai = 'khong_ap_dung' THEN COALESCE(work.gia_tri, 0) ELSE 0 END) AS excluded_total,
                       SUM(CASE WHEN work.loai = 'chua_du_dieu_kien' THEN COALESCE(work.gia_tri, 0) ELSE 0 END) AS pending_total
                FROM ke_hoach_cong_viec AS work
                JOIN target_plans AS plan
                  ON plan.organization_id = work.organization_id
                 AND plan.id = work.ke_hoach_id
                GROUP BY work.organization_id, work.ke_hoach_id
            ),
            totals AS (
                SELECT plan.id, plan.organization_id,
                       CASE WHEN plan.loai_hinh_mua_sam = 'Dự án'
                            THEN COALESCE(work.completed_total, 0)
                               + COALESCE(work.excluded_total, 0)
                               + COALESCE(work.pending_total, 0)
                               + COALESCE(package.package_total, 0)
                            ELSE COALESCE(work.excluded_total, 0)
                               + COALESCE(work.pending_total, 0)
                               + COALESCE(package.package_total, 0)
                       END AS total
                FROM target_plans AS plan
                LEFT JOIN package_totals AS package
                  ON package.organization_id = plan.organization_id
                 AND package.plan_id = plan.id
                LEFT JOIN work_totals AS work
                  ON work.organization_id = plan.organization_id
                 AND work.plan_id = plan.id
            )
            UPDATE ke_hoach_lcnt AS plan
            SET tong_muc_dau_tu = totals.total
            FROM totals
            WHERE totals.organization_id = plan.organization_id
              AND totals.id = plan.id
              AND plan.tong_muc_dau_tu IS DISTINCT FROM totals.total
            """,
            tuple(params),
        )
        changed_rows += max(0, int(result.rowcount or 0))
    return changed_rows


def khoi_tao_va_di_tru_he_thong():
    """Initialize or upgrade the canonical PostgreSQL schema."""

    from backend.db.postgres_schema import initialize_and_log

    initialize_and_log(database)
