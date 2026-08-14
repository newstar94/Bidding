"""Full and delta synchronization read service."""

from backend.db.db_helper import DatabaseError

import hmac
import time

from starlette.responses import JSONResponse

from backend.shared.helpers import OrgPermissionError, _assert_safe_table, database, get_active_org, verify_session
from backend.shared.access_policy import (
    can_read_record,
    can_read_table,
    filter_items_for_read,
    is_organization_manager,
)
from backend.shared.media_helper import public_image_path
from backend.shared.date_utils import vietnam_now_sql
from backend.shared.sensitive_data import (
    resolve_sensitive_read_policy,
    serialize_sensitive_read_item,
    serialize_sensitive_read_items,
)
from backend.shared.domain_enums import enum_label
from backend.sync.mapper import (
    attach_child_rows_to_items,
    json_key_for_column,
    map_db_to_json,
)
from backend.sync.queries import (
    TABLE_KEYS,
    build_dashboard_summary,
    get_contract_package_ids as _get_contract_package_ids,
    get_expert_relations_for_packages as _get_expert_relations_for_packages,
)
from backend.sync.repository import ARCHIVED_TABLES, get_current_sync_version
from backend.sync.visibility_epoch import build_visibility_token
from backend.sync.visibility_scope import VisibilityScope, scoped_deletion_branches
from backend.sync.request_contract import parse_sync_read_window
from backend.sync.payload_validation import get_package_field_policy
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.observability.recording import record_database_phase


_VERSION_FAMILY_SQL = {
    "goi_thau": """
        SELECT id, phien_ban FROM goi_thau
        WHERE organization_id = ? AND archived_at IS NULL
          AND ((id_goc IS NOT NULL AND id_goc != '' AND id_goc = ?)
               OR ((id_goc IS NULL OR id_goc = '') AND id = ?))
          AND ke_hoach_id = (
              SELECT current_package.ke_hoach_id FROM goi_thau AS current_package
               WHERE current_package.organization_id = goi_thau.organization_id
                 AND current_package.id = ?
          )
        ORDER BY CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC
    """,
    "ke_hoach_lcnt": """
        SELECT id, phien_ban FROM ke_hoach_lcnt
        WHERE organization_id = ? AND archived_at IS NULL
          AND ((id_goc IS NOT NULL AND id_goc != '' AND id_goc = ?)
               OR ((id_goc IS NULL OR id_goc = '') AND id = ?))
        ORDER BY CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC
    """,
    "hop_dong": """
        SELECT id, phien_ban FROM hop_dong
        WHERE organization_id = ? AND archived_at IS NULL
          AND ((id_goc IS NOT NULL AND id_goc != '' AND id_goc = ?)
               OR ((id_goc IS NULL OR id_goc = '') AND id = ?))
        ORDER BY CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC
    """,
    "chu_dau_tu": """
        SELECT id, phien_ban FROM chu_dau_tu
        WHERE organization_id = ? AND archived_at IS NULL
          AND ((id_goc IS NOT NULL AND id_goc != '' AND id_goc = ?)
               OR ((id_goc IS NULL OR id_goc = '') AND id = ?))
        ORDER BY CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC
    """,
    "nha_thau": """
        SELECT id, phien_ban FROM nha_thau
        WHERE organization_id = ? AND archived_at IS NULL
          AND ((id_goc IS NOT NULL AND id_goc != '' AND id_goc = ?)
               OR ((id_goc IS NULL OR id_goc = '') AND id = ?))
        ORDER BY CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC
    """,
    "chuyen_gia": """
        SELECT id, phien_ban FROM chuyen_gia
        WHERE organization_id = ? AND archived_at IS NULL
          AND ((id_goc IS NOT NULL AND id_goc != '' AND id_goc = ?)
               OR ((id_goc IS NULL OR id_goc = '') AND id = ?))
        ORDER BY CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC
    """,
}


def _load_visible_deletions(
    cursor, visibility_scope, *, after_version=None, since=None,
    payload_keys=None, limit=1000
):
    """Load tombstones after applying the same record scope as delta sync."""

    if after_version is None and since in (None, "", "0", "1970-01-01 00:00:00"):
        return []
    statements = []
    parameters = []
    for payload_key, _table_name, predicate in scoped_deletion_branches(
        visibility_scope, "deleted_row", payload_keys
    ):
        boundary = "deleted_row.delete_version > ?" if after_version is not None else "deleted_row.deleted_at > ?"
        statements.append(
            f"SELECT '{payload_key}' AS table_key, deleted_row.record_id, "  # noqa: S608 - payload key/predicate come from canonical registries
            "deleted_row.delete_version, deleted_row.deleted_at "
            "FROM deleted_records AS deleted_row "
            f"WHERE {predicate.sql} AND {boundary}"  # noqa: S608 - predicate is registry-built
        )
        parameters.extend(predicate.parameters)
        parameters.append(after_version if after_version is not None else since)
    order = (
        "delete_version ASC, deleted_at ASC, table_key ASC, record_id ASC"
        if after_version is not None
        else "deleted_at DESC, table_key ASC, record_id ASC"
    )
    query = " UNION ALL ".join(statements) + f" ORDER BY {order}"  # noqa: S608 - fixed clauses plus registry-built branches
    if after_version is None:
        query += " LIMIT ?"
        parameters.append(limit)
    return [
        {"table": row[0], "id": row[1]}
        for row in cursor.execute(query, tuple(parameters)).fetchall()
    ]


def _database_read_unavailable(request, code, message):
    response = error_response(request, code, message, status_code=503)
    response.headers["Retry-After"] = "1"
    return response


async def read_sync_data(request):
    try:
        return await run_database_read(
            _read_sync_data_blocking,
            request,
            timeout_seconds=30.0,
        )
    except BlockingIOBusyError:
        return _database_read_unavailable(
            request,
            "DATABASE_READ_QUEUE_FULL",
            "Hệ thống đang xử lý quá nhiều truy vấn. Vui lòng thử lại.",
        )
    except BlockingIOTimeoutError:
        return _database_read_unavailable(
            request,
            "DATABASE_READ_TIMEOUT",
            "Truy vấn dữ liệu vượt quá thời gian cho phép. Vui lòng thử lại.",
        )


def _read_sync_data_blocking(request):
    """
    [GET] /api/get-all-data
    Trả về dữ liệu thay đổi từ lần đồng bộ trước (nếu truyền since) hoặc toàn bộ dữ liệu.
    """
    conn = None
    started_at = time.perf_counter()
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        read_window = parse_sync_read_window(request.query_params)
        since = read_window.since
        after_version = read_window.after_version
        is_full_initial_fetch = read_window.is_full_initial_fetch
        requested_keys = {
            key.strip() for key in (request.query_params.get("tables") or "").split(",")
            if key.strip() in TABLE_KEYS
        }
        is_partial_response = bool(requested_keys)
        include_dashboard_summary = request.query_params.get("include_summary") in {"1", "true", "yes"}

        conn = database.get_connection()
        cursor = conn.cursor()
        # Pin every table, manifest and dashboard aggregate in this response to
        # one PostgreSQL read snapshot. Without an explicit transaction, concurrent
        # writes could make the cards disagree with the returned lists/cursor.
        cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        current_time = vietnam_now_sql()


        org_name = get_active_org(request, role_or_err.user_id, cursor=cursor)
        media_session_token = str(
            getattr(request, "cookies", {}).get("session_token", "")
        )
        role_str = role_or_err
        user_id = role_or_err.user_id
        visibility_token = build_visibility_token(
            cursor, org_name, user_id, role_str
        )
        visibility_scope = VisibilityScope.resolve(
            cursor, role_str, user_id, org_name
        )
        supplied_visibility = str(
            request.query_params.get("visibility_token") or ""
        )
        if after_version is not None and (
            not supplied_visibility
            or not hmac.compare_digest(supplied_visibility, visibility_token)
        ):
            conn.close()
            conn = None
            return JSONResponse(
                {
                    "code": "SYNC_VISIBILITY_RESET_REQUIRED",
                    "requiresFullSync": True,
                },
                status_code=409,
            )
        sensitive_read_policy = resolve_sensitive_read_policy(
            cursor, role_str, user_id, org_name
        )

        metadata_row = cursor.execute(
            "SELECT current_version, min_available_version FROM sync_metadata WHERE organization_id = ?",
            (org_name,),
        ).fetchone()
        min_available_sync_version = int(metadata_row[1] or 0) if metadata_row else 0
        if after_version is not None and after_version < min_available_sync_version:
            conn.close()
            conn = None
            return JSONResponse({
                "error": "Con trỏ đồng bộ đã quá cũ; cần tải lại dữ liệu đầy đủ.",
                "code": "FULL_SYNC_REQUIRED",
                "requiresFullSync": True,
                "minAvailableSyncVersion": min_available_sync_version,
            }, status_code=409)



        heavy_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "chuyen_gia", "hop_dong"]
        paginated_payload_keys = [key for key, table in TABLE_KEYS.items() if table in heavy_tables]


        use_server_pagination = True


        def query_table(tbl):
            payload_key = next((key for key, table_name in TABLE_KEYS.items() if table_name == tbl), None)
            if is_partial_response and payload_key not in requested_keys:
                return []
            is_full_fetch = is_full_initial_fetch
            if use_server_pagination and tbl in heavy_tables and is_full_fetch:

                return []
            active_clause = " AND archived_at IS NULL" if tbl in ARCHIVED_TABLES else ""
            visibility = visibility_scope.live_predicate(tbl, "source_row")
            if after_version is not None:
                cursor.execute(
                    f"SELECT * FROM {tbl} AS source_row WHERE {visibility.sql} "  # noqa: S608 - table/predicate come from internal registries
                    f"AND sync_version > ?{active_clause}",
                    (*visibility.parameters, after_version),
                )
            elif not is_full_fetch:
                cursor.execute(
                    f"SELECT * FROM {tbl} AS source_row WHERE {visibility.sql} "  # noqa: S608 - table/predicate come from internal registries
                    f"AND updated_at > ?{active_clause}",
                    (*visibility.parameters, since),
                )
            else:
                cursor.execute(
                    f"SELECT * FROM {tbl} AS source_row WHERE {visibility.sql}{active_clause}",  # noqa: S608 - table/predicate come from internal registries
                    visibility.parameters,
                )
            return cursor.fetchall()


        chudautu = []
        for row in query_table("chu_dau_tu"):
            chudautu.append(map_db_to_json("chu_dau_tu", dict(row)))


        kehoach = []
        for row in query_table("ke_hoach_lcnt"):
            item = map_db_to_json("ke_hoach_lcnt", dict(row))
            for list_key in ["cvDaThucHienList", "cvKhongApDungList", "cvChuaDuDieuKienList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
            kehoach.append(item)
        attach_child_rows_to_items(cursor, "ke_hoach_lcnt", kehoach, organization_id=org_name)


        chuyengia = []
        for row in query_table("chuyen_gia"):
            row_dict = dict(row)

            img_path = row_dict.get("anh_chung_chi", "")
            sig_path = row_dict.get("anh_chu_ky", "")
            item = map_db_to_json("chuyen_gia", row_dict)
            item["anhChungChi"] = public_image_path(
                img_path,
                session_token=media_session_token,
                organization_id=org_name,
            )
            item["anhChuKy"] = public_image_path(
                sig_path,
                session_token=media_session_token,
                organization_id=org_name,
            )
            item = serialize_sensitive_read_item(
                "chuyen_gia", item, sensitive_read_policy
            )
            chuyengia.append(item)


        nhathau = []
        for row in query_table("nha_thau"):
            row_dict = dict(row)
            row_dict["anh_dau"] = public_image_path(
                row_dict.get("anh_dau"),
                session_token=media_session_token,
                organization_id=org_name,
            )
            nhathau.append(map_db_to_json("nha_thau", row_dict))
        attach_child_rows_to_items(cursor, "nha_thau", nhathau, organization_id=org_name)


        goithau = []
        goithau_rows = query_table("goi_thau")
        gt_ids = [row["id"] for row in goithau_rows]
        relations_map = _get_expert_relations_for_packages(cursor, gt_ids, org_name)

        for row in goithau_rows:
            row_dict = dict(row)
            item = map_db_to_json("goi_thau", row_dict)
            gt_id = row_dict["id"]


            pkg_rels = relations_map.get(gt_id, {"to_cg": [], "to_td": [], "cg_ids": []})
            item["toChuyenGia"] = pkg_rels.get("to_cg", [])
            item["toThamDinh"] = pkg_rels.get("to_td", [])
            item["chuyenGiaIds"] = pkg_rels.get("cg_ids", [])

            for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
            goithau.append(item)
        attach_child_rows_to_items(cursor, "goi_thau", goithau, organization_id=org_name)


        hopdong = []
        hopdong_rows = query_table("hop_dong")
        hd_ids = [row["id"] for row in hopdong_rows]
        contract_packages_map = _get_contract_package_ids(cursor, hd_ids, org_name)
        for row in hopdong_rows:
            row_dict = dict(row)
            item = map_db_to_json("hop_dong", row_dict)
            item["goiThauIds"] = contract_packages_map.get(row_dict["id"], [])
            hopdong.append(item)


        assignments = []
        if not is_partial_response or "assignments" in requested_keys:
            assignment_visibility = visibility_scope.live_predicate(
                "phan_cong_nhan_su", "source_row"
            )
            if after_version is not None:
                cursor.execute(
                    f"SELECT * FROM phan_cong_nhan_su AS source_row WHERE {assignment_visibility.sql} AND sync_version > ?",  # noqa: S608 - predicate is registry-built
                    (*assignment_visibility.parameters, after_version),
                )
            elif since != '1970-01-01 00:00:00' and since != '0':
                cursor.execute(
                    f"SELECT * FROM phan_cong_nhan_su AS source_row WHERE {assignment_visibility.sql} AND updated_at > ?",  # noqa: S608 - predicate is registry-built
                    (*assignment_visibility.parameters, since),
                )
            else:
                cursor.execute(
                    f"SELECT * FROM phan_cong_nhan_su AS source_row WHERE {assignment_visibility.sql}",  # noqa: S608 - predicate is registry-built
                    assignment_visibility.parameters,
                )
            for row in cursor.fetchall():
                assignments.append(map_db_to_json("phan_cong_nhan_su", dict(row)))


        customcontractstatuses = []
        if not is_partial_response or "customcontractstatuses" in requested_keys:
            if after_version is not None:
                cursor.execute("SELECT * FROM danh_muc_trang_thai_hop_dong WHERE organization_id = ? AND sync_version > ?", (org_name, after_version))
            elif since != '1970-01-01 00:00:00' and since != '0':
                cursor.execute("SELECT * FROM danh_muc_trang_thai_hop_dong WHERE organization_id = ? AND updated_at > ?", (org_name, since))
            else:
                cursor.execute("SELECT * FROM danh_muc_trang_thai_hop_dong WHERE organization_id = ?", (org_name,))
            for row in cursor.fetchall():
                customcontractstatuses.append(map_db_to_json("danh_muc_trang_thai_hop_dong", dict(row)))


        thongtinmothau = []
        for row in query_table("thong_tin_mo_thau"):
            thongtinmothau.append(map_db_to_json("thong_tin_mo_thau", dict(row)))
        attach_child_rows_to_items(cursor, "thong_tin_mo_thau", thongtinmothau, organization_id=org_name)

        goithauhanghoa = [
            map_db_to_json("goi_thau_hang_hoa", dict(row))
            for row in query_table("goi_thau_hang_hoa")
        ]
        hanghoaduthaunhathau = [
            map_db_to_json("hang_hoa_du_thau_nha_thau", dict(row))
            for row in query_table("hang_hoa_du_thau_nha_thau")
        ]


        permissionmatrix = []
        if not is_partial_response or "permissionmatrix" in requested_keys:
            permission_visibility = visibility_scope.live_predicate(
                "ma_tran_phan_quyen", "source_row"
            )
            if after_version is not None:
                cursor.execute(
                    f"SELECT * FROM ma_tran_phan_quyen AS source_row WHERE {permission_visibility.sql} AND sync_version > ?",  # noqa: S608 - predicate is registry-built
                    (*permission_visibility.parameters, after_version),
                )
            elif since != '1970-01-01 00:00:00' and since != '0':
                cursor.execute(
                    f"SELECT * FROM ma_tran_phan_quyen AS source_row WHERE {permission_visibility.sql} AND updated_at > ?",  # noqa: S608 - predicate is registry-built
                    (*permission_visibility.parameters, since),
                )
            else:
                cursor.execute(
                    f"SELECT * FROM ma_tran_phan_quyen AS source_row WHERE {permission_visibility.sql}",  # noqa: S608 - predicate is registry-built
                    permission_visibility.parameters,
                )
            for row in cursor.fetchall():
                permissionmatrix.append(map_db_to_json("ma_tran_phan_quyen", dict(row)))


        deletions = _load_visible_deletions(
            cursor,
            visibility_scope,
            after_version=after_version,
            since=since,
            payload_keys=requested_keys if is_partial_response else None,
        )

        chudautu = filter_items_for_read(cursor, role_str, user_id, org_name, "chudautu", "chu_dau_tu", chudautu)
        kehoach = filter_items_for_read(cursor, role_str, user_id, org_name, "kehoach", "ke_hoach_lcnt", kehoach)
        chuyengia = filter_items_for_read(cursor, role_str, user_id, org_name, "chuyengia", "chuyen_gia", chuyengia)
        nhathau = filter_items_for_read(cursor, role_str, user_id, org_name, "nhathau", "nha_thau", nhathau)
        nhathau = serialize_sensitive_read_items(
            "nha_thau", nhathau, sensitive_read_policy
        )
        goithau = filter_items_for_read(cursor, role_str, user_id, org_name, "goithau", "goi_thau", goithau)
        hopdong = filter_items_for_read(cursor, role_str, user_id, org_name, "hopdong", "hop_dong", hopdong)
        assignments = filter_items_for_read(cursor, role_str, user_id, org_name, "assignments", "phan_cong_nhan_su", assignments)
        customcontractstatuses = filter_items_for_read(cursor, role_str, user_id, org_name, "customcontractstatuses", "danh_muc_trang_thai_hop_dong", customcontractstatuses)
        thongtinmothau = filter_items_for_read(cursor, role_str, user_id, org_name, "thongtinmothau", "thong_tin_mo_thau", thongtinmothau)
        goithauhanghoa = filter_items_for_read(cursor, role_str, user_id, org_name, "goithauhanghoa", "goi_thau_hang_hoa", goithauhanghoa)
        hanghoaduthaunhathau = filter_items_for_read(cursor, role_str, user_id, org_name, "hanghoaduthaunhathau", "hang_hoa_du_thau_nha_thau", hanghoaduthaunhathau)
        permissionmatrix = filter_items_for_read(cursor, role_str, user_id, org_name, "permissionmatrix", "ma_tran_phan_quyen", permissionmatrix)

        # Heavy tables are omitted from a full bootstrap response because they
        # are paginated. Return an authoritative ID manifest so the client can
        # remove stale IndexedDB rows without downloading complete records.
        record_manifest = {}
        reference_data = {}
        if is_full_initial_fetch:
            reference_columns = {
                "chudautu": ["id", "id_goc", "phien_ban", "is_latest", "ngay_ap_dung", "ma_chu_dau_tu", "ten_chu_dau_tu", "ma_so_thue"],
                "kehoach": ["id", "id_goc", "phien_ban", "is_latest", "ma_ke_hoach", "ten_ke_hoach", "chu_dau_tu_id"],
                "goithau": ["id", "id_goc", "phien_ban", "is_latest", "ma_goi_thau", "ten_goi_thau", "ke_hoach_id", "trang_thai"],
                "nhathau": ["id", "id_goc", "phien_ban", "is_latest", "ngay_ap_dung", "ma_nha_thau", "ten_nha_thau", "ma_so_thue", "loai_nha_thau"],
                "chuyengia": ["id", "id_goc", "phien_ban", "is_latest", "ho_ten", "so_cccd", "so_chung_chi"],
            }
            for payload_key, table_name in TABLE_KEYS.items():
                if table_name not in heavy_tables:
                    continue
                if is_partial_response and payload_key not in requested_keys:
                    continue
                cursor.execute(
                    f"SELECT source_row.id FROM {table_name} AS source_row "  # noqa: S608 - table/predicate come from internal registries
                    f"WHERE {visibility_scope.live_predicate(table_name, 'source_row').sql} "
                    "AND archived_at IS NULL",
                    visibility_scope.live_predicate(
                        table_name, "source_row"
                    ).parameters,
                )
                manifest_items = [{"id": row[0]} for row in cursor.fetchall()]
                record_manifest[payload_key] = [item["id"] for item in manifest_items]

                selected_columns = reference_columns.get(payload_key)
                if not selected_columns:
                    continue
                reference_where = "organization_id = ? AND is_latest = 1 AND archived_at IS NULL"
                reference_params = (org_name,)
                reference_visibility = visibility_scope.live_predicate(
                    table_name, "source_row"
                )
                reference_where = (
                    f"{reference_visibility.sql} AND is_latest = 1 "
                    "AND archived_at IS NULL"
                )
                reference_params = reference_visibility.parameters
                if table_name == "goi_thau":
                    reference_where += (
                        " AND ke_hoach_id IN ("
                        "SELECT id FROM ke_hoach_lcnt "
                        "WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL)"
                    )
                    reference_params = (*reference_params, org_name)
                if table_name in {"chu_dau_tu", "nha_thau"}:
                    # Date-based stage binding needs the lightweight identity of
                    # every version; full details remain paginated/lazy-loaded.
                    reference_where = (
                        f"{reference_visibility.sql} AND archived_at IS NULL"
                    )
                    reference_params = reference_visibility.parameters
                cursor.execute(
                    f"SELECT {', '.join('source_row.' + column for column in selected_columns)} "  # noqa: S608 - table/columns are fixed reference registry entries
                    f"FROM {table_name} AS source_row WHERE {reference_where}",
                    reference_params,
                )
                reference_items = []
                for row in cursor.fetchall():
                    row_dict = dict(row)
                    reference_item = {
                        json_key_for_column(table_name, column): enum_label(table_name, column, row_dict.get(column))
                        for column in selected_columns
                    }
                    # The client must never treat these lightweight dropdown
                    # records as complete detail/edit records.
                    reference_item["referenceOnly"] = True
                    reference_items.append(reference_item)
                reference_data[payload_key] = reference_items
                reference_data[payload_key] = serialize_sensitive_read_items(
                    table_name,
                    reference_data[payload_key],
                    sensitive_read_policy,
                )

        if not is_organization_manager(cursor, role_str, user_id, org_name):
            deletions = [
                item for item in deletions
                if can_read_table(cursor, role_str, user_id, org_name, item.get("table"), TABLE_KEYS.get(item.get("table"), ""))
            ]

        current_sync_version = get_current_sync_version(cursor, org_name)
        dashboard_summary = build_dashboard_summary(cursor, org_name, role_str, user_id) if include_dashboard_summary else None

        response_payload = {
            "chudautu": chudautu,
            "kehoach": kehoach,
            "chuyengia": chuyengia,
            "nhathau": nhathau,
            "goithau": goithau,
            "hopdong": hopdong,
            "assignments": assignments,
            "customcontractstatuses": customcontractstatuses,
            "thongtinmothau": thongtinmothau,
            "goithauhanghoa": goithauhanghoa,
            "hanghoaduthaunhathau": hanghoaduthaunhathau,
            "permissionmatrix": permissionmatrix,
            "deletions": deletions,
            "useServerSidePagination": use_server_pagination,
            "paginatedKeys": paginated_payload_keys if use_server_pagination else [],
            "recordManifest": record_manifest,
            "referenceData": reference_data,
            "dashboardSummary": dashboard_summary,
            "partial": is_partial_response,
            "timestamp": current_time,
            "syncVersion": current_sync_version,
            "minAvailableSyncVersion": min_available_sync_version,
            "visibilityToken": visibility_token,
            "domainContract": {"packageFieldPolicy": get_package_field_policy()},
        }
        if is_partial_response:
            for payload_key in list(TABLE_KEYS):
                if payload_key not in requested_keys:
                    response_payload.pop(payload_key, None)
            response_payload["deletions"] = [
                item for item in response_payload["deletions"] if item.get("table") in requested_keys
            ]
        # Mapping and authorization above require the consistent read snapshot.
        # JSON encoding does not: return the connection to the pool before the
        # potentially expensive payload serialization phase.
        conn.close()
        conn = None
        record_database_phase(
            "sync",
            "snapshot_checkout",
            time.perf_counter() - started_at,
        )
        json_started_at = time.perf_counter()
        try:
            response = JSONResponse(response_payload)
        finally:
            record_database_phase(
                "sync",
                "json_serialize",
                time.perf_counter() - json_started_at,
            )
        response.headers["Server-Timing"] = f"sync-read;dur={(time.perf_counter() - started_at) * 1000:.1f}"
        return response
    except OrgPermissionError:
        if conn:
            try:
                conn.rollback()
            except DatabaseError:
                pass
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as e:
        return log_and_error(
            request,
            e,
            "read_sync_data",
            "SYNC_READ_FAILED",
            "Không thể tải dữ liệu đồng bộ.",
        )
    finally:
        if conn:
            try:
                conn.close()
            except DatabaseError:
                pass

async def read_single_record(request):
    try:
        return await run_database_read(
            _read_single_record_blocking,
            request,
            timeout_seconds=15.0,
        )
    except BlockingIOBusyError:
        return _database_read_unavailable(
            request,
            "DATABASE_READ_QUEUE_FULL",
            "Hệ thống đang xử lý quá nhiều truy vấn. Vui lòng thử lại.",
        )
    except BlockingIOTimeoutError:
        return _database_read_unavailable(
            request,
            "DATABASE_READ_TIMEOUT",
            "Truy vấn dữ liệu vượt quá thời gian cho phép. Vui lòng thử lại.",
        )


def _read_single_record_blocking(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        params = request.query_params
        table_key = params.get("table")
        lookup_value = (params.get("id") or params.get("lookup") or "").strip()
        if table_key not in TABLE_KEYS or not lookup_value:
            return JSONResponse({"error": "Invalid record lookup"}, status_code=400)

        table_name = TABLE_KEYS[table_key]
        if table_name not in {
            "goi_thau",
            "ke_hoach_lcnt",
            "hop_dong",
            "chu_dau_tu",
            "nha_thau",
            "chuyen_gia",
            "thong_tin_mo_thau",
        }:
            return JSONResponse({"error": "Record lookup is not supported for this table"}, status_code=400)
        _assert_safe_table(table_name)

        org_name = get_active_org(request, role_or_err.user_id)
        media_session_token = str(
            getattr(request, "cookies", {}).get("session_token", "")
        )
        role_str = role_or_err
        user_id = role_or_err.user_id
        conn = database.get_connection()
        cursor = conn.cursor()
        visibility_scope = VisibilityScope.resolve(
            cursor, role_str, user_id, org_name
        )
        record_visibility = visibility_scope.live_predicate(
            table_name, "source_row"
        )

        if not can_read_table(cursor, role_str, user_id, org_name, table_key, table_name):
            return JSONResponse({"error": "Không có quyền đọc dữ liệu này."}, status_code=403)

        if table_name == "thong_tin_mo_thau":
            cursor.execute(
                f"""SELECT * FROM thong_tin_mo_thau AS source_row
                   WHERE {record_visibility.sql} AND id = ? AND archived_at IS NULL
                   LIMIT 1""",  # noqa: S608 - predicate is registry-built
                (*record_visibility.parameters, lookup_value),
            )
        else:
            lookup_column = {
                "goi_thau": "ma_goi_thau",
                "ke_hoach_lcnt": "ma_ke_hoach",
                "hop_dong": "so_hop_dong",
                "chu_dau_tu": "ma_chu_dau_tu",
                "nha_thau": "ma_nha_thau",
                "chuyen_gia": "so_chung_chi",
            }[table_name]
            lookup_candidates = [lookup_value]
            if "_" in lookup_value:
                lookup_candidates.append(lookup_value.rsplit("_", 1)[0])
            if table_name == "hop_dong":
                lookup_candidates.extend(value.replace("-", "/") for value in list(lookup_candidates))
            lookup_candidates = list(dict.fromkeys(value for value in lookup_candidates if value))
            placeholders = ", ".join(["?"] * len(lookup_candidates))
            cursor.execute(f"""
                SELECT *
                FROM {table_name} AS source_row
                WHERE {record_visibility.sql}
                  AND (
                      id IN ({placeholders})
                      OR (archived_at IS NULL AND {lookup_column} IN ({placeholders}))
                  )
                ORDER BY is_latest DESC,
                         CAST(COALESCE(phien_ban, 0) AS INTEGER) DESC,
                         COALESCE(updated_at, created_at) DESC
                LIMIT 1
            """, tuple(record_visibility.parameters) + tuple(lookup_candidates + lookup_candidates))  # noqa: S608 - table/column are strict allowlist values above
        row = cursor.fetchone()
        if not row:
            return JSONResponse({"item": None}, status_code=404)

        row_dict = dict(row)
        if not can_read_record(cursor, role_str, user_id, org_name, table_key, table_name, row_dict):
            return JSONResponse({"error": "Không có quyền đọc bản ghi này."}, status_code=403)

        if table_name == "chuyen_gia":
            row_dict["anh_chung_chi"] = public_image_path(
                row_dict.get("anh_chung_chi"),
                session_token=media_session_token,
                organization_id=org_name,
            )
            row_dict["anh_chu_ky"] = public_image_path(
                row_dict.get("anh_chu_ky"),
                session_token=media_session_token,
                organization_id=org_name,
            )
        elif table_name == "nha_thau":
            row_dict["anh_dau"] = public_image_path(
                row_dict.get("anh_dau"),
                session_token=media_session_token,
                organization_id=org_name,
            )
        item = map_db_to_json(table_name, row_dict)
        items = [item]
        if table_name in {
            "ke_hoach_lcnt",
            "goi_thau",
            "nha_thau",
            "thong_tin_mo_thau",
        }:
            attach_child_rows_to_items(cursor, table_name, items, organization_id=org_name)
        if table_name == "goi_thau":
            relations_map = _get_expert_relations_for_packages(cursor, [row_dict["id"]], org_name)
            pkg_rels = relations_map.get(row_dict["id"], {"to_cg": [], "to_td": [], "cg_ids": []})
            item["toChuyenGia"] = pkg_rels.get("to_cg", [])
            item["toThamDinh"] = pkg_rels.get("to_td", [])
            item["chuyenGiaIds"] = pkg_rels.get("cg_ids", [])
            for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                if item.get(list_key) is None:
                    item[list_key] = []
        elif table_name == "hop_dong":
            item["goiThauIds"] = _get_contract_package_ids(cursor, [row_dict["id"]], org_name).get(row_dict["id"], [])

        version_family_sql = _VERSION_FAMILY_SQL.get(table_name)
        if version_family_sql:
            root_id = row_dict.get("id_goc") or row_dict.get("id")
            version_params = (
                (org_name, root_id, root_id, row_dict["id"])
                if table_name == "goi_thau"
                else (org_name, root_id, root_id)
            )
            cursor.execute(version_family_sql, version_params)
            item["allVersions"] = [
                {"id": version_row[0], "phienBan": version_row[1]}
                for version_row in cursor.fetchall()
            ]

        sensitive_read_policy = resolve_sensitive_read_policy(
            cursor,
            role_str,
            user_id,
            org_name,
            table_names=(table_name,),
        )
        item = serialize_sensitive_read_item(
            table_name, item, sensitive_read_policy
        )

        return JSONResponse({"item": item})
    except OrgPermissionError:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as e:
        return log_and_error(
            request,
            e,
            "get_record_by_id",
            "SYNC_RECORD_READ_FAILED",
            "Không thể tải bản ghi.",
        )
    finally:
        if conn:
            try:
                conn.close()
            except DatabaseError:
                pass
