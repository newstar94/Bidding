"""Business-list filters must narrow the authorized query before pagination."""

import json
import os
import sqlite3
from contextlib import closing
from types import SimpleNamespace

import psycopg
import pytest

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.sync import pagination
from backend.sync.list_filters import (
    FILTER_FIELDS,
    ListFilterError,
    build_list_filter_predicate,
    parse_list_filters,
)
from backend.sync.mapper import json_key_for_column
from backend.sync.visibility_scope import VisibilityScope
from backend.sync.visibility_scope import SqlPredicate


def compile_filters(table, conditions, **kwargs):
    parsed = parse_list_filters(table, json.dumps(conditions, ensure_ascii=False))
    return build_list_filter_predicate(table, parsed, **kwargs)


def condition(field, operator, value):
    return {"field": field, "operator": operator, "value": value}


def test_filter_registry_uses_the_actual_record_keys_and_columns():
    for table, fields in FILTER_FIELDS.items():
        for key, field in fields.items():
            if field.kind in {"assignee", "packages"}:
                continue
            assert field.column in SCHEMA_DINH_NGHIA[table]["columns"]
            assert json_key_for_column(table, field.column) == key


@pytest.mark.parametrize("table", tuple(FILTER_FIELDS))
def test_omitted_and_empty_filter_arrays_keep_the_original_query(table):
    assert parse_list_filters(table, "") == ()
    assert parse_list_filters(table, "[]") == ()
    assert build_list_filter_predicate(table, ()).sql == ""


def test_truly_empty_supported_conditions_are_ignored_and_zero_is_retained():
    assert parse_list_filters("goi_thau", json.dumps([
        condition("tenGoiThau", "contains", "  "),
        condition("trangThai", "in", []),
        condition("giaGoiThau", "range", {"min": "", "max": None}),
        condition("ngayQuyetDinh", "year", ["", None]),
        condition("isThuoc", "equals", "0"),
    ])) == (("isThuoc", "equals", 0),)


@pytest.mark.parametrize("raw", [
    "[", "null", "{}", "[[]]", "[true]", "[" * 5000,
    json.dumps([condition("organizationId", "equals", "org-2")]),
    json.dumps([condition("tenGoiThau", "contains", {"value": "x"})]),
    json.dumps([condition("tenGoiThau", "contains", 1)]),
    json.dumps([condition("tenGoiThau", "in", "x")]),
    json.dumps([condition("tenGoiThau", "in", [True])]),
    json.dumps([condition("tenGoiThau", "equals", "x" * 513)]),
    json.dumps([condition("tenGoiThau", "in", ["x"] * 101)]),
    json.dumps([condition("tenGoiThau", "contains", "x")] * 25),
    " " * 16385,
    json.dumps([condition("tenGoiThau", "contains", "ế" * 512)] * 12, ensure_ascii=False),
], ids=lambda value: f"payload-{len(str(value))}")
def test_invalid_or_unbounded_payloads_are_rejected(raw):
    with pytest.raises(ListFilterError):
        parse_list_filters("goi_thau", raw)


@pytest.mark.parametrize("field,operator,value", [
    ("giaGoiThau", "contains", "10"),
    ("giaGoiThau", "range", {"min": "20", "max": "10"}),
    ("giaGoiThau", "range", {"min": "-1"}),
    ("giaGoiThau", "range", {"min": "1.5"}),
    ("giaGoiThau", "range", {"min": "NaN"}),
    ("giaGoiThau", "range", {"min": 1}),
    ("giaGoiThau", "range", {"min": "1", "sql": "DROP TABLE"}),
    ("giaGoiThau", "equals", "9223372036854775808"),
    ("ngayQuyetDinh", "range", {"min": "2026-02-29"}),
    ("ngayQuyetDinh", "range", {"min": "2026-03-02", "max": "2026-03-01"}),
    ("ngayQuyetDinh", "equals", "20260301"),
    ("ngayQuyetDinh", "year", ["2026", "9999"]),
    ("ngayQuyetDinh", "year", "0"),
    ("ngayQuyetDinh", "month", ["9", "13"]),
    ("isThuoc", "equals", "true"),
    ("keHoachId", "contains", "plan"),
    ("assigneeId", "range", {"min": "1"}),
    ("trangThai", "in", ["" , {}]),
])
def test_operators_types_and_range_boundaries_are_validated(field, operator, value):
    with pytest.raises(ListFilterError):
        parse_list_filters("goi_thau", json.dumps([condition(field, operator, value)]))


def test_money_keeps_large_integer_precision_and_accepts_one_sided_ranges():
    predicate = compile_filters("hop_dong", [
        condition("giaTri", "range", {"min": "9007199254740993", "max": ""}),
    ])
    assert predicate.parameters == (9007199254740993,)
    assert "hop_dong.gia_tri >= ?" in predicate.sql


def test_year_and_month_lists_are_or_within_a_field_and_and_between_fields():
    predicate = compile_filters("ke_hoach_lcnt", [
        condition("ngayPheDuyet", "year", ["2025", "2026", "2025"]),
        condition("ngayPheDuyet", "month", ["1", "9"]),
    ])
    assert " OR " in predicate.sql
    assert "EXTRACT(MONTH FROM ke_hoach_lcnt.ngay_phe_duyet) IN (?, ?)" in predicate.sql
    assert predicate.parameters == (
        "2025-01-01", "2026-01-01", "2026-01-01", "2027-01-01", 1, 9,
    )
    scalar = compile_filters("hop_dong", [condition("ngayKy", "month", "9")])
    assert scalar.parameters == (9,)


@pytest.mark.parametrize("field,column", [
    ("thoiGianDongThau", "thoi_gian_dong_thau"),
    ("thoiGianDangTai", "thoi_gian_dang_tai"),
])
def test_timestamp_filters_use_vietnam_calendar_dates_with_inclusive_bounds(field, column):
    predicate = compile_filters("goi_thau", [
        condition(field, "range", {"min": "2026-10-01", "max": "2026-10-02"}),
    ])
    assert f"(goi_thau.{column} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date" in predicate.sql
    assert predicate.parameters == ("2026-10-01", "2026-10-02")
    assert " >= ?" in predicate.sql and " <= ?" in predicate.sql


def test_choice_and_custom_status_filters_keep_existing_persisted_values():
    package = compile_filters("goi_thau", [
        condition("trangThai", "in", ["Chuẩn bị", "AWARDED"]),
    ], effective_package_status=True)
    assert package.parameters == ("PREPARING", "AWARDED")
    assert "goi_thau.effective_status IN (?, ?)" in package.sql
    contract = compile_filters("hop_dong", [
        condition("trangThaiHopDong", "equals", "Đang nghiệm thu theo đơn vị"),
    ])
    assert contract.parameters == ("Đang nghiệm thu theo đơn vị",)


def test_contains_escapes_literal_wildcards_and_never_interpolates_input():
    value = "100%_\\' OR 1=1 --"
    predicate = compile_filters("ke_hoach_lcnt", [condition("tenKeHoach", "contains", value)])
    assert value not in predicate.sql
    assert predicate.parameters == ("%100\\%\\_\\\\' OR 1=1 --%",)
    assert "ESCAPE E'\\\\'" in predicate.sql


def test_postgres_package_search_matches_vietnamese_initial_uppercase():
    """The paginated search must match ``Điều tra`` after the client folds case."""
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL search test")
    with psycopg.connect(database_url, connect_timeout=5) as connection:
        matched = connection.execute(
            """
            SELECT bf_unaccent(lower(%s)) ILIKE bf_unaccent(lower(%s))
            """,
            (
                "Điều tra đánh giá nghề cá",
                "%điều tra%",
            ),
        ).fetchone()[0]
    assert matched is True


def test_package_pagination_search_uses_case_insensitive_accent_projection(monkeypatch):
    class RecordingCursor:
        def __init__(self):
            self.queries = []

        def execute(self, sql, params=()):
            self.queries.append((sql, tuple(params)))
            return self

        def fetchone(self):
            return (0,)

        def fetchall(self):
            return []

    cursor = RecordingCursor()
    connection = SimpleNamespace(cursor=lambda: cursor, close=lambda: None)
    monkeypatch.setattr(pagination, "database", SimpleNamespace(get_connection=lambda: connection))
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, SimpleNamespace(user_id="user-1")))
    monkeypatch.setattr(pagination, "get_active_org", lambda *_args, **_kwargs: "org-1")
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(pagination, "resolve_sensitive_read_policy", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pagination, "serialize_sensitive_read_items", lambda _table, items, _policy: items)
    monkeypatch.setattr(
        pagination.VisibilityScope,
        "resolve",
        classmethod(lambda cls, *_args: SimpleNamespace(
            live_predicate=lambda _table, _alias: SqlPredicate(
                "goi_thau.organization_id = ?", ("org-1",)
            ),
        )),
    )

    response = pagination._paginate_records_blocking(SimpleNamespace(
        query_params={"table": "goithau", "search": "Điều tra"},
        cookies={"session_token": "test"},
    ))

    assert response.status_code == 200
    search_sql = cursor.queries[0][0]
    assert search_sql.count("ILIKE bf_unaccent(lower(?))") == 2
    assert " LIKE bf_unaccent(lower(?))" not in search_sql


class FixtureCursor:
    """Execute portable list SQL against fixtures and record count/page queries."""

    def __init__(self, connection):
        self.connection = connection
        self.queries = []
        self.current = None

    def execute(self, sql, params=()):
        self.queries.append((sql, tuple(params)))
        # PostgreSQL spells the one-character escape string with E quoting.
        portable_sql = sql.replace("ESCAPE E'\\\\'", "ESCAPE '\\'")
        self.current = self.connection.execute(portable_sql, params)
        return self

    def fetchone(self):
        return self.current.fetchone()

    def fetchall(self):
        return self.current.fetchall()


@pytest.fixture
def plan_list(monkeypatch):
    fixture_db = sqlite3.connect(":memory:")
    fixture_db.row_factory = sqlite3.Row
    fixture_db.execute("""
        CREATE TABLE ke_hoach_lcnt (
            id TEXT, organization_id TEXT, owner_type TEXT, id_goc TEXT,
            is_latest INTEGER, archived_at TEXT, ma_ke_hoach TEXT,
            ten_ke_hoach TEXT, tong_muc_dau_tu INTEGER, chu_dau_tu_id TEXT
        )
    """)
    fixture_db.execute("""
        CREATE TABLE phan_cong_nhan_su (
            organization_id TEXT, id_nhan_vien TEXT,
            id_muc_tieu TEXT, loai_doi_tuong TEXT
        )
    """)
    fixture_db.execute("CREATE TABLE goi_thau (id TEXT, organization_id TEXT, ke_hoach_id TEXT)")
    rows = [
        ("p1", "org-1", "organization", "p1", 1, None, "A", "Máy 100%_A", 100, "inv-a"),
        ("p2", "org-1", "organization", "p2", 1, None, "B", "Máy 100%_B", 200, "inv-b"),
        ("p3", "org-1", "organization", "p3", 1, None, "C", "Máy 100%_C", 300, "inv-a"),
        ("p4", "org-1", "organization", "p4", 1, None, "D", "Máy 100xxD", 250, "inv-a"),
        ("p5", "org-1", "organization", "p5", 1, None, "E", "Máy 100%_E", 250, "inv-a"),
        ("old", "org-1", "organization", "p1", 0, None, "F", "Máy 100%_F", 250, "inv-a"),
        ("archived", "org-1", "organization", "archived", 1, "2026-01-01", "G", "Máy 100%_G", 250, "inv-a"),
        ("other-tenant", "org-2", "organization", "other-tenant", 1, None, "H", "Máy 100%_H", 250, "inv-a"),
    ]
    fixture_db.executemany("INSERT INTO ke_hoach_lcnt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    fixture_db.executemany("INSERT INTO phan_cong_nhan_su VALUES (?, ?, ?, ?)", [
        (row[1], "user-1", row[0], "kehoach") for row in rows if row[0] != "p5"
    ])
    cursor = FixtureCursor(fixture_db)
    connection = SimpleNamespace(cursor=lambda: cursor, close=lambda: None)
    monkeypatch.setattr(pagination, "database", SimpleNamespace(get_connection=lambda: connection))
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, SimpleNamespace(user_id="user-1")))
    monkeypatch.setattr(pagination, "get_active_org", lambda *_args, **_kwargs: "org-1")
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(pagination, "resolve_sensitive_read_policy", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pagination, "serialize_sensitive_read_items", lambda _table, items, _policy: items)
    monkeypatch.setattr(pagination.VisibilityScope, "resolve", classmethod(
        lambda cls, *_args: VisibilityScope("org-1", "user-1", False, {"kehoach": "view"})
    ))
    monkeypatch.setattr(pagination, "load_visible_version_metadata", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(pagination, "attach_child_rows_to_items", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pagination, "map_db_to_json", lambda _table, row: row)
    monkeypatch.setattr(pagination, "authorize_record_write", lambda *_args: SimpleNamespace(allowed=False))
    yield cursor
    fixture_db.close()


def test_filter_totals_and_page_rows_share_tenant_assignment_and_version_scope(plan_list):
    filters = json.dumps([
        condition("tenKeHoach", "contains", "máy 100%_"),
        condition("tongMucDauTu", "range", {"min": "100", "max": "300"}),
        condition("chuDauTuId", "in", ["inv-a", "inv-b"]),
    ])
    request = SimpleNamespace(query_params={
        "table": "kehoach", "page": "2", "pageSize": "1", "filters": filters,
    }, cookies={"session_token": "test"})
    response = pagination._paginate_records_blocking(request)
    assert response.status_code == 200
    result = json.loads(response.body)
    assert result["totalItems"] == 3
    assert [item["id"] for item in result["items"]] == ["p2"]
    assert result["items"][0]["ten_ke_hoach"] == "Máy 100%_B"
    count_sql, count_params = plan_list.queries[0]
    page_sql, page_params = plan_list.queries[1]
    assert "is_latest = 1" in count_sql and "archived_at IS NULL" in count_sql
    assert "pc.id_nhan_vien = ?" in count_sql
    assert count_params == page_params[:-2]
    assert count_sql.split(" WHERE ", 1)[1] == page_sql.split(" WHERE ", 1)[1].split(" ORDER BY ", 1)[0]


def test_module_denial_keeps_empty_list_and_makes_no_row_queries(plan_list, monkeypatch):
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: False)
    response = pagination._paginate_records_blocking(SimpleNamespace(
        query_params={"table": "kehoach", "filters": json.dumps([condition("tenKeHoach", "contains", "Máy")])},
        cookies={},
    ))
    assert response.status_code == 200
    assert json.loads(response.body) == {"items": [], "totalItems": 0}
    assert plan_list.queries == []


def test_invalid_filters_are_rejected_before_database_work(monkeypatch):
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, SimpleNamespace(user_id="user-1")))
    monkeypatch.setattr(pagination, "database", SimpleNamespace(
        get_connection=lambda: pytest.fail("invalid filter must not acquire a database connection"),
    ))
    response = pagination._paginate_records_blocking(SimpleNamespace(
        query_params={"table": "goithau", "filters": json.dumps([condition("tenGoiThau; DROP TABLE", "contains", "")])},
        cookies={},
    ))
    assert response.status_code == 400


def test_relation_filters_are_tenant_and_exact_snapshot_scoped():
    with closing(sqlite3.connect(":memory:")) as connection:
        connection.execute("CREATE TABLE hop_dong (id TEXT, organization_id TEXT)")
        connection.execute("CREATE TABLE hop_dong_goi_thau (organization_id TEXT, hop_dong_id TEXT, goi_thau_id TEXT)")
        connection.execute("CREATE TABLE phan_cong_nhan_su (organization_id TEXT, id_muc_tieu TEXT, loai_doi_tuong TEXT, id_nhan_vien TEXT)")
        connection.executemany("INSERT INTO hop_dong VALUES (?, ?)", [("new", "org-1"), ("old", "org-1"), ("foreign", "org-1")])
        connection.executemany("INSERT INTO hop_dong_goi_thau VALUES (?, ?, ?)", [("org-1", "new", "pkg-a"), ("org-1", "new", "pkg-b"), ("org-1", "old", "pkg-a"), ("org-2", "foreign", "pkg-a")])
        connection.executemany("INSERT INTO phan_cong_nhan_su VALUES (?, ?, ?, ?)", [("org-1", "new", "hopdong", "user-a"), ("org-1", "old", "hopdong", "user-b"), ("org-2", "foreign", "hopdong", "user-a")])
        predicate = compile_filters("hop_dong", [
            condition("goiThauIds", "in", ["pkg-a", "pkg-b"]),
            condition("assigneeId", "equals", "user-a"),
        ])
        rows = connection.execute("SELECT id FROM hop_dong WHERE " + predicate.sql, predicate.parameters).fetchall()  # noqa: S608 - allowlisted compiler tested here
        assert rows == [("new",)]


@pytest.mark.parametrize("alert_key", ["", "delayedEvaluation"])
def test_structured_status_filters_use_official_projection_before_counts(monkeypatch, alert_key):
    queries = []

    def execute(sql, params=()):
        queries.append((sql, tuple(params)))

    cursor = SimpleNamespace(execute=execute, fetchone=lambda: (0,), fetchall=lambda: [])
    monkeypatch.setattr(pagination, "database", SimpleNamespace(get_connection=lambda: SimpleNamespace(
        cursor=lambda: cursor, close=lambda: None,
    )))
    monkeypatch.setattr(pagination, "verify_session", lambda _request: (True, SimpleNamespace(user_id="user-1")))
    monkeypatch.setattr(pagination, "get_active_org", lambda *_args, **_kwargs: "org-1")
    monkeypatch.setattr(pagination, "can_read_table", lambda *_args: True)
    monkeypatch.setattr(pagination, "resolve_sensitive_read_policy", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pagination, "serialize_sensitive_read_items", lambda _table, items, _policy: items)
    monkeypatch.setattr(pagination.VisibilityScope, "resolve", classmethod(lambda cls, *_args: SimpleNamespace(
        live_predicate=lambda _table, _alias: SqlPredicate("goi_thau.organization_id = ? AND goi_thau.id = ?", ("org-1", "allowed-snapshot")),
    )))
    response = pagination._paginate_records_blocking(SimpleNamespace(
        query_params={
            "table": "goithau", "alertKey": alert_key,
            "filters": json.dumps([
                condition("trangThai", "in", ["Đang chấm thầu", "Đã có kết quả"]),
                condition("giaGoiThau", "range", {"min": "100", "max": "200"}),
            ]),
        }, cookies={},
    ))
    assert response.status_code == 200
    assert len(queries) == 2
    for sql, parameters in queries:
        assert "END AS effective_status" in sql
        assert "goi_thau.effective_status IN (?, ?)" in sql
        assert "goi_thau.organization_id = ? AND goi_thau.id = ?" in sql
        assert "goi_thau.gia_goi_thau >= ?" in sql
        assert "is_latest = 1" in sql and "archived_at IS NULL" in sql
        assert parameters[:7] == ("org-1", "org-1", "allowed-snapshot", "org-1", "EVALUATING", "AWARDED", 100)
    assert queries[0][1] == queries[1][1][:-2]


def test_postgres_contains_and_vietnam_date_expression_execute_with_parameters():
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL filter expression test")
    predicate = compile_filters("goi_thau", [
        condition("tenGoiThau", "contains", "100%_\\'"),
        condition("thoiGianDongThau", "range", {"min": "2026-10-02", "max": "2026-10-02"}),
    ])
    sql = """
        WITH goi_thau(ten_goi_thau, thoi_gian_dong_thau) AS (
            VALUES (%s::text, %s::timestamptz), (%s::text, %s::timestamptz)
        ) SELECT ten_goi_thau FROM goi_thau WHERE
    """ + predicate.sql.replace("?", "%s")  # noqa: S608 - allowlisted compiler with bound fixture values
    with psycopg.connect(url, connect_timeout=5) as connection:
        rows = connection.execute(sql, (
            "Máy 100%_\\'", "2026-10-01T18:00:00Z",
            "Máy 100xx\\'", "2026-10-01T18:00:00Z",
            *predicate.parameters,
        )).fetchall()
        assert rows == [("Máy 100%_\\'",)]


@pytest.mark.parametrize("bounds,expected", [
    ({"min": "2026-10-02", "max": "2026-10-02"}, ["start", "utc-midnight", "end"]),
    ({"min": "2026-10-02", "max": ""}, ["start", "utc-midnight", "end", "after-end"]),
    ({"min": "", "max": "2026-10-02"}, ["before-start", "start", "utc-midnight", "end"]),
])
def test_postgres_release_timestamp_range_includes_whole_vietnam_days_and_excludes_null(bounds, expected):
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL filter expression test")
    predicate = compile_filters("goi_thau", [condition("thoiGianDangTai", "range", bounds)])
    sql = """
        WITH goi_thau(ordinal, id, thoi_gian_dang_tai) AS (
            VALUES
                (1, 'before-start', %s::timestamptz),
                (2, 'start', %s::timestamptz),
                (3, 'utc-midnight', %s::timestamptz),
                (4, 'end', %s::timestamptz),
                (5, 'after-end', %s::timestamptz),
                (6, 'missing', NULL::timestamptz)
        ) SELECT id FROM goi_thau WHERE
    """ + predicate.sql.replace("?", "%s") + " ORDER BY ordinal"  # noqa: S608 - allowlisted compiler with bound fixture values
    with psycopg.connect(url, connect_timeout=5) as connection:
        rows = connection.execute(sql, (
            "2026-10-01T16:59:59.999999Z",
            "2026-10-01T17:00:00Z",
            "2026-10-02T00:00:00Z",
            "2026-10-02T16:59:59.999999Z",
            "2026-10-02T17:00:00Z",
            *predicate.parameters,
        )).fetchall()
        assert [row[0] for row in rows] == expected
