"""Server-side pagination for synchronized entity tables."""

from backend.db.db_helper import DatabaseError

import base64
import hashlib
import hmac
import json

from starlette.responses import JSONResponse

from backend.shared.helpers import (
    SCHEMA_DINH_NGHIA,
    OrgPermissionError,
    _assert_safe_table,
    database,
    get_active_org,
    verify_session,
)
from backend.shared.access_policy import (
    OWNERSHIP_SCOPED_TABLES,
    authorize_record_write,
    can_read_table,
    is_organization_manager,
)
from backend.shared.media_helper import public_image_path
from backend.shared.sensitive_data import (
    resolve_sensitive_read_policy,
    serialize_sensitive_read_items,
)
from backend.sync.mapper import (
    attach_child_rows_to_items,
    db_column_for_json_key,
    map_db_to_json,
)
from backend.sync.queries import (
    TABLE_KEYS,
    get_contract_package_ids as _get_contract_package_ids,
    get_expert_relations_for_packages as _get_expert_relations_for_packages,
)
from backend.db.postgres_schema import postgres_column_definition
from backend.shared.domain_enums import enum_code
from backend.sync.repository import ARCHIVED_TABLES, VERSIONED_TABLES
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.workspace_scope import is_personal_scope_for_user


def _urlsafe_b64encode(payload):
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _urlsafe_b64decode(payload):
    if not isinstance(payload, str) or not payload:
        raise ValueError("invalid base64 payload")
    padding = "=" * (-len(payload) % 4)
    return base64.b64decode(
        payload + padding,
        altchars=b"-_",
        validate=True,
    )


def _encode_keyset_cursor(
    table_name,
    column,
    direction,
    value,
    record_id,
    *,
    signing_key,
):
    payload = json.dumps(
        {
            "v": 2,
            "table": table_name,
            "column": column,
            "direction": direction,
            "value": "" if value is None else str(value),
            "id": str(record_id),
        },
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode("utf-8")
    key = str(signing_key or "").encode("utf-8")
    if not key:
        raise ValueError("cursor signing key is required")
    encoded_payload = _urlsafe_b64encode(payload)
    signature = hmac.new(key, encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded_payload}.{_urlsafe_b64encode(signature)}"


def _decode_keyset_cursor(
    raw_cursor,
    table_name,
    column,
    direction,
    *,
    signing_key,
):
    if (
        not isinstance(raw_cursor, str)
        or not raw_cursor
        or len(raw_cursor) > 2048
        or raw_cursor.count(".") != 1
    ):
        return None
    try:
        encoded_payload, encoded_signature = raw_cursor.split(".", 1)
        signature = _urlsafe_b64decode(encoded_signature)
        key = str(signing_key or "").encode("utf-8")
        if not key or len(signature) != hashlib.sha256().digest_size:
            return None
        expected_signature = hmac.new(
            key,
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature, expected_signature):
            return None
        payload = json.loads(_urlsafe_b64decode(encoded_payload).decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if (
        not isinstance(payload, dict)
        or payload.get("v") != 2
        or payload.get("table") != table_name
        or payload.get("column") != column
        or payload.get("direction") != direction
        or not payload.get("id")
    ):
        return None
    return str(payload.get("value") or ""), str(payload["id"])


async def paginate_records(request):
    try:
        return await run_database_read(
            _paginate_records_blocking,
            request,
            timeout_seconds=20.0,
        )
    except BlockingIOBusyError:
        response = error_response(
            request,
            "DATABASE_READ_QUEUE_FULL",
            "Hệ thống đang xử lý quá nhiều truy vấn. Vui lòng thử lại.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response
    except BlockingIOTimeoutError:
        response = error_response(
            request,
            "DATABASE_READ_TIMEOUT",
            "Truy vấn dữ liệu vượt quá thời gian cho phép. Vui lòng thử lại.",
            status_code=503,
        )
        response.headers["Retry-After"] = "1"
        return response


def _paginate_records_blocking(request):
    conn = None
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)

        params = request.query_params
        table_key = params.get("table")

        if table_key not in TABLE_KEYS:
            return JSONResponse({"error": "Invalid table key"}, status_code=400)
        table_name = TABLE_KEYS[table_key]
        _assert_safe_table(table_name)

        page_size_raw = params.get("pageSize", "10")
        try:
            page = max(1, int(params.get("page", 1)))
            page_size = max(1, min(200, int(page_size_raw)))
        except (ValueError, TypeError):
            return JSONResponse({"error": "Tham số phân trang không hợp lệ"}, status_code=400)
        search = params.get("search", "").strip().lower()

        media_session_token = str(
            getattr(request, "cookies", {}).get("session_token", "")
        )
        role_str = str(role_or_err)
        user_id = role_or_err.user_id
        conn = database.get_connection()
        cursor = conn.cursor()
        org_name = get_active_org(
            request,
            role_or_err.user_id,
            cursor=cursor,
        )
        if not can_read_table(cursor, role_str, user_id, org_name, table_key, table_name):
            conn.close()
            return JSONResponse({"items": [], "totalItems": 0})
        sensitive_read_policy = resolve_sensitive_read_policy(
            cursor,
            role_str,
            user_id,
            org_name,
            table_names=(table_name,),
        )
        can_view_sensitive_expert = sensitive_read_policy.can_view("chuyen_gia")


        query_parts = ["organization_id = ?"]
        query_params = [org_name]
        if table_name in ARCHIVED_TABLES:
            query_parts.append("archived_at IS NULL")
        if (
            not is_personal_scope_for_user(org_name, user_id)
            and not is_organization_manager(cursor, role_str, user_id, org_name)
        ):
            if table_name == "phan_cong_nhan_su":
                query_parts.append("id_nhan_vien = ?")
                query_params.append(user_id)
            elif table_name == "ma_tran_phan_quyen":
                query_parts.append("emp_id = ?")
                query_params.append(user_id)
            elif table_name == "ke_hoach_lcnt":
                query_parts.append("""
                    (
                        id IN (
                            SELECT id_muc_tieu FROM phan_cong_nhan_su
                            WHERE organization_id = ? AND id_nhan_vien = ? AND loai_doi_tuong = 'kehoach'
                        )
                        OR id IN (
                            SELECT gt.ke_hoach_id FROM goi_thau gt
                            JOIN phan_cong_nhan_su pc
                              ON pc.organization_id = gt.organization_id
                             AND pc.id_muc_tieu = gt.id
                             AND pc.loai_doi_tuong = 'goithau'
                            WHERE gt.organization_id = ? AND pc.id_nhan_vien = ?
                        )
                    )
                """)
                query_params.extend([org_name, user_id, org_name, user_id])
            elif table_name in ["goi_thau", "hop_dong"]:
                assignment_type = {
                    "goi_thau": "goithau",
                    "hop_dong": "hopdong",
                }[table_name]
                query_parts.append("""
                    id IN (
                        SELECT id_muc_tieu FROM phan_cong_nhan_su
                        WHERE organization_id = ? AND id_nhan_vien = ? AND loai_doi_tuong = ?
                    )
                """)
                query_params.extend([org_name, user_id, assignment_type])
            elif table_name == "thong_tin_mo_thau":
                query_parts.append("""
                    goi_thau_id IN (
                        SELECT id_muc_tieu FROM phan_cong_nhan_su
                        WHERE organization_id = ? AND id_nhan_vien = ? AND loai_doi_tuong = 'goithau'
                    )
                """)
                query_params.extend([org_name, user_id])




        versioned_tables = ["chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "nha_thau", "hop_dong", "chuyen_gia"]
        plan_snapshot_id = params.get("keHoachId", "").strip() if table_name == "goi_thau" else ""
        if table_name == "goi_thau" and plan_snapshot_id:
            query_parts.append("ke_hoach_id = ?")
            query_params.append(plan_snapshot_id)
        elif table_name in versioned_tables:
            query_parts.append("is_latest = 1")
            if table_name == "goi_thau":
                query_parts.append("""
                    (
                        ke_hoach_id IS NULL
                        OR ke_hoach_id IN (
                            SELECT id FROM ke_hoach_lcnt
                            WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL
                        )
                    )
                """)
                query_params.append(org_name)

        def add_like_search_filter():
            columns = ()
            if table_name == "ke_hoach_lcnt":
                columns = ("ma_ke_hoach", "ten_ke_hoach", "ten_du_an_du_toan")
            elif table_name == "goi_thau":
                columns = ("ma_goi_thau", "ten_goi_thau")
            elif table_name == "chu_dau_tu":
                columns = ("ma_chu_dau_tu", "ten_chu_dau_tu", "ten_viet_tat", "ma_so_thue")
            elif table_name == "nha_thau":
                columns = ("ma_nha_thau", "ten_nha_thau", "ten_viet_tat", "ma_so_thue")
            elif table_name == "chuyen_gia":
                columns = (("ho_ten", "so_cccd", "so_chung_chi") if can_view_sensitive_expert else ("ho_ten", "so_chung_chi"))
            elif table_name == "hop_dong":
                columns = ("so_hop_dong", "ten_hop_dong")
            if columns:
                expression = " || ' ' || ".join(
                    f"COALESCE({column}, '')" for column in columns
                )
                query_parts.append(
                    f"bf_unaccent(lower({expression})) LIKE '%' || bf_unaccent(lower(?)) || '%'"
                )
                query_params.append(search)


        if search:
            add_like_search_filter()


        if table_name == "goi_thau":
            trang_thai = params.get("trangThai", "")
            hinh_thuc = params.get("hinhThuc", "")
            if trang_thai:
                query_parts.append("trang_thai = ?")
                query_params.append(enum_code("goi_thau", "trang_thai", trang_thai))
            if hinh_thuc:
                query_parts.append("hinh_thuc_lua_chon = ?")
                query_params.append(hinh_thuc)


        nam = params.get("nam", "")
        thang = params.get("thang", "")
        date_column = None
        if table_name == "ke_hoach_lcnt":
            date_column = "ngay_phe_duyet"
        elif table_name == "goi_thau":
            date_column = "ngay_quyet_dinh"
        elif table_name == "hop_dong":
            date_column = "ngay_ky"

        if date_column:
            try:
                year_num = int(nam) if nam else None
                month_num = int(thang) if thang else None
            except ValueError:
                year_num = None
                month_num = None
            if year_num and month_num and 1 <= month_num <= 12:
                next_year = year_num + 1 if month_num == 12 else year_num
                next_month = 1 if month_num == 12 else month_num + 1
                query_parts.append(f"{date_column} >= ? AND {date_column} < ?")
                query_params.extend([
                    f"{year_num:04d}-{month_num:02d}-01",
                    f"{next_year:04d}-{next_month:02d}-01",
                ])
            elif year_num:
                query_parts.append(f"{date_column} >= ? AND {date_column} < ?")
                query_params.extend([
                    f"{year_num:04d}-01-01",
                    f"{year_num + 1:04d}-01-01",
                ])
            elif month_num and 1 <= month_num <= 12:
                # Month-only filtering uses an indexed deterministic expression;
                # year/month and year-only filters above remain sargable ranges.
                query_parts.append(f"EXTRACT(MONTH FROM {date_column}) = ?")
                query_params.append(month_num)


        sort_by = params.get("sortBy", "").strip()
        sort_order = params.get("sortOrder", "asc").strip().upper()
        if sort_order not in ["ASC", "DESC"]:
            sort_order = "ASC"

        db_column = ""
        if sort_by:
            db_column = db_column_for_json_key(table_name, sort_by)

        valid_columns = SCHEMA_DINH_NGHIA.get(table_name, {}).get("columns", {})
        if db_column and db_column in valid_columns:
            sort_column = db_column
        else:
            default_sorts = {
                "ke_hoach_lcnt": "ma_ke_hoach",
                "goi_thau": "ma_goi_thau",
                "chu_dau_tu": "ten_chu_dau_tu",
                "nha_thau": "ten_nha_thau",
                "chuyen_gia": "ho_ten",
                "hop_dong": "ten_hop_dong"
            }
            def_col = default_sorts.get(table_name)
            if def_col and def_col in valid_columns:
                sort_column = def_col
                sort_order = "ASC"
            else:
                sort_column = "id"
                sort_order = "ASC"

        cursor_mode = params.get("pagination", "").strip().lower() == "cursor"
        # Keyset mode is deliberately limited to textual keys. It preserves the
        # database's text collation and avoids changing numeric sort semantics.
        column_declaration = postgres_column_definition(
            table_name,
            sort_column,
            str(valid_columns.get(sort_column, "TEXT")),
        ).upper()
        is_text_sort = column_declaration.startswith("TEXT")
        cursor_mode = cursor_mode and (sort_column == "id" or is_text_sort)
        where_clause = " AND ".join(query_parts)
        include_total = (
            not cursor_mode
            or params.get("includeTotal", "").strip().lower()
            in {"1", "true", "yes"}
        )
        total_items = None
        if include_total:
            count_sql = (
                f"SELECT COUNT(*) FROM {table_name} WHERE {where_clause}"
            )
            cursor.execute(count_sql, tuple(query_params))
            total_items = cursor.fetchone()[0]
        item_query_parts = list(query_parts)
        item_query_params = list(query_params)
        decoded_cursor = None
        raw_cursor = params.get("cursor", "").strip()
        if cursor_mode and raw_cursor:
            decoded_cursor = _decode_keyset_cursor(
                raw_cursor,
                table_name,
                sort_column,
                sort_order,
                signing_key=media_session_token,
            )
            if decoded_cursor is None:
                return JSONResponse({"error": "Cursor phân trang không hợp lệ"}, status_code=400)
            cursor_value, cursor_id = decoded_cursor
            comparator = ">" if sort_order == "ASC" else "<"
            item_query_parts.append(
                f"(COALESCE({sort_column}, '') {comparator} ? OR "
                f"(COALESCE({sort_column}, '') = ? AND id {comparator} ?))"
            )
            item_query_params.extend([cursor_value, cursor_value, cursor_id])

        sort_expression = (
            f"COALESCE({sort_column}, '')" if is_text_sort else sort_column
        )
        stable_sort_sql = f" ORDER BY {sort_expression} {sort_order} NULLS LAST"
        if sort_column != "id":
            stable_sort_sql += f", id {sort_order}"
        item_where_clause = " AND ".join(item_query_parts)
        if cursor_mode:
            items_sql = f"SELECT * FROM {table_name} WHERE {item_where_clause}{stable_sort_sql} LIMIT ?"
            cursor.execute(items_sql, tuple(item_query_params + [page_size + 1]))
        else:
            offset = (page - 1) * page_size
            items_sql = f"SELECT * FROM {table_name} WHERE {item_where_clause}{stable_sort_sql} LIMIT ? OFFSET ?"
            cursor.execute(items_sql, tuple(item_query_params + [page_size, offset]))
        rows = cursor.fetchall()
        has_more = cursor_mode and len(rows) > page_size
        if has_more:
            rows = rows[:page_size]
        next_cursor = None
        if cursor_mode and has_more and rows:
            last_row = rows[-1]
            next_cursor = _encode_keyset_cursor(
                table_name,
                sort_column,
                sort_order,
                last_row[sort_column],
                last_row["id"],
                signing_key=media_session_token,
            )


        relations_map = {}
        if table_name == "goi_thau" and rows:
            gt_ids = [r["id"] for r in rows]
            relations_map = _get_expert_relations_for_packages(cursor, gt_ids, org_name)


        contract_packages_map = {}
        if table_name == "hop_dong" and rows:
            hd_ids = [r["id"] for r in rows]
            contract_packages_map = _get_contract_package_ids(cursor, hd_ids, org_name)


        versions_by_root = {}
        if table_name in versioned_tables and rows:
            all_root_vals = list({(r["id_goc"] or r["id"]) for r in rows})
            v_placeholders = ", ".join(["?"] * len(all_root_vals))
            version_query_parts = [
                "organization_id = ?",
                "archived_at IS NULL",
                f"""(
                    (id_goc IS NOT NULL AND id_goc != '' AND id_goc IN ({v_placeholders})) OR
                    ((id_goc IS NULL OR id_goc = '') AND id IN ({v_placeholders}))
                )"""
            ]
            version_query_params = [org_name] + all_root_vals + all_root_vals
            if table_name == "goi_thau" and plan_snapshot_id:
                version_query_parts.append("ke_hoach_id = ?")
                version_query_params.append(plan_snapshot_id)

            cursor.execute(f"""
                SELECT id, id_goc, phien_ban FROM {table_name}
                WHERE {" AND ".join(version_query_parts)}
                ORDER BY CAST(phien_ban AS INTEGER) DESC
            """, version_query_params)
            for v_row in cursor.fetchall():
                v_root = v_row[1] or v_row[0]
                if v_root not in versions_by_root:
                    versions_by_root[v_root] = []
                versions_by_root[v_root].append({"id": v_row[0], "phienBan": v_row[2]})

        items = []
        for row in rows:
            row_dict = dict(row)

            if table_name == "chuyen_gia":
                img_path = row_dict.get("anh_chung_chi", "")
                sig_path = row_dict.get("anh_chu_ky", "")
                row_dict["anh_chung_chi"] = public_image_path(
                    img_path,
                    session_token=media_session_token,
                    organization_id=org_name,
                )
                row_dict["anh_chu_ky"] = public_image_path(
                    sig_path,
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
            if table_name in OWNERSHIP_SCOPED_TABLES:
                item["canEdit"] = authorize_record_write(
                    cursor,
                    role_str,
                    user_id,
                    org_name,
                    table_key,
                    table_name,
                    item,
                ).allowed
            if table_name == "goi_thau":
                gt_id = row_dict["id"]
                pkg_rels = relations_map.get(gt_id, {"to_cg": [], "to_td": [], "cg_ids": []})
                item["toChuyenGia"] = pkg_rels.get("to_cg", [])
                item["toThamDinh"] = pkg_rels.get("to_td", [])
                item["chuyenGiaIds"] = pkg_rels.get("cg_ids", [])
                for list_key in ["phanLoList", "tuyChonMuaThemList", "awardedPhanLoList", "giaHanList", "yeuCauLamRoList", "traLoiLamRoList"]:
                    if item.get(list_key) is None:
                        item[list_key] = []
            elif table_name == "hop_dong":
                item["goiThauIds"] = contract_packages_map.get(row_dict["id"], [])


            if table_name in versioned_tables:
                root_val = row_dict.get("id_goc") or row_dict.get("id")
                item["allVersions"] = versions_by_root.get(root_val, [])

            items.append(item)
        if table_name in ["ke_hoach_lcnt", "goi_thau", "nha_thau", "thong_tin_mo_thau"]:
            attach_child_rows_to_items(cursor, table_name, items, organization_id=org_name)
        items = serialize_sensitive_read_items(
            table_name, items, sensitive_read_policy
        )

        conn.close()
        return JSONResponse({
            "items": items,
            "totalItems": total_items,
            "nextCursor": next_cursor,
            "hasMore": bool(has_more),
        })
    except OrgPermissionError as e:
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
            "paginate_records",
            "PAGINATION_FAILED",
            "Không thể tải trang dữ liệu.",
        )
    finally:

        if conn:
            try:
                conn.close()
            except DatabaseError:
                pass
