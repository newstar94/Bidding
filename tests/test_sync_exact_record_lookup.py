"""Exact bulk-delete reads cannot resolve a selected ID to another version."""

import json
import sqlite3
from types import SimpleNamespace

import pytest

from backend.sync import read_service
from backend.sync.visibility_scope import SqlPredicate


TABLES = {
    "kehoach": ("ke_hoach_lcnt", "ma_ke_hoach"),
    "goithau": ("goi_thau", "ma_goi_thau"),
    "hopdong": ("hop_dong", "so_hop_dong"),
}


class FixtureCursor:
    def __init__(self, fixture):
        self.fixture = fixture
        self.answer = None

    def execute(self, sql, parameters=()):
        self.fixture.queries.append((" ".join(sql.split()), tuple(parameters)))
        self.answer = self.fixture.raw.execute(sql, parameters)
        return self

    def fetchone(self):
        return self.answer.fetchone()

    def fetchall(self):
        return self.answer.fetchall()


@pytest.fixture
def record_lookup(monkeypatch):
    fixture = SimpleNamespace(raw=sqlite3.connect(":memory:"), queries=[], module_allowed=True, record_allowed=True)
    fixture.raw.row_factory = sqlite3.Row
    for table, code_column in TABLES.values():
        fixture.raw.execute(f"""CREATE TABLE {table} (
            id TEXT PRIMARY KEY, id_goc TEXT, organization_id TEXT,
            {code_column} TEXT, is_latest INTEGER, phien_ban INTEGER,
            row_version INTEGER, archived_at TEXT, updated_at TEXT, created_at TEXT,
            ke_hoach_id TEXT, scope_allowed INTEGER
        )""")  # noqa: S608 - fixed fixture registry
        fixture.raw.executemany(f"INSERT INTO {table} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [  # noqa: S608
            ("family_00", "family", "org-1", "SHARED-CODE", 0, 0, 4, None, "2026-01-01", "2026-01-01", "plan-1", 1),
            ("family", "family", "org-1", "SHARED-CODE", 1, 2, 6, None, "2026-03-01", "2026-01-01", "plan-1", 1),
            ("collision", "collision", "org-1", "family_00", 1, 3, 7, None, "2026-04-01", "2026-04-01", "plan-1", 1),
            ("foreign_00", "foreign", "org-2", "FOREIGN", 1, 0, 1, None, "2026-01-01", "2026-01-01", "plan-1", 1),
            ("unassigned_00", "unassigned", "org-1", "UNASSIGNED", 1, 0, 1, None, "2026-01-01", "2026-01-01", "plan-1", 0),
        ])
    connection = SimpleNamespace(cursor=lambda: FixtureCursor(fixture), close=lambda: None)
    monkeypatch.setattr(read_service, "database", SimpleNamespace(get_connection=lambda: connection))
    monkeypatch.setattr(read_service, "verify_session", lambda _request: (True, SimpleNamespace(user_id="user-1")))
    monkeypatch.setattr(read_service, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(read_service, "can_read_table", lambda *_args: fixture.module_allowed)
    monkeypatch.setattr(read_service, "can_read_record", lambda *_args: fixture.record_allowed)
    monkeypatch.setattr(read_service.VisibilityScope, "resolve", lambda *_args: SimpleNamespace(
        live_predicate=lambda _table, alias: SqlPredicate(
            f"{alias}.organization_id = ? AND {alias}.scope_allowed = ?", ("org-1", 1),
        ),
    ))
    monkeypatch.setattr(read_service, "map_db_to_json", lambda _table, row: {
        "id": row["id"], "rootId": row["id_goc"], "rowVersion": row["row_version"],
    })
    fixture.child_reads = []
    monkeypatch.setattr(read_service, "attach_child_rows_to_items",
                        lambda _cursor, table, _items, **_kwargs: fixture.child_reads.append(table))
    monkeypatch.setattr(read_service, "_get_expert_relations_for_packages", lambda *_args: {})
    monkeypatch.setattr(read_service, "_get_contract_package_ids", lambda *_args: {"family_00": ["package-1"]})
    monkeypatch.setattr(read_service, "resolve_sensitive_read_policy", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(read_service, "serialize_sensitive_read_item", lambda _table, item, _policy: item)

    def read(table_key, lookup, *, exact=True):
        parameters = {"table": table_key, "lookup": lookup}
        if exact:
            parameters["exactId"] = "1"
        return read_service._read_single_record_blocking(SimpleNamespace(
            query_params=parameters, cookies={}, headers={}, state=SimpleNamespace(),
        ))

    fixture.read = read
    yield fixture
    fixture.raw.close()


@pytest.mark.parametrize("table_key", TABLES)
def test_exact_id_keeps_historical_underscore_id_despite_latest_id_and_business_code_collision(
    record_lookup, table_key,
):
    fixture = record_lookup
    exact = fixture.read(table_key, "family_00")
    item = json.loads(exact.body)["item"]
    assert exact.status_code == 200
    assert item["id"] == "family_00"
    assert item["rowVersion"] == 4
    assert item["allVersions"] == [{"id": "family", "phienBan": 2}, {"id": "family_00", "phienBan": 0}]
    sql, parameters = fixture.queries[0]
    assert "source_row.id = ?" in sql
    assert " OR " not in sql
    assert "ORDER BY" not in sql
    assert parameters == ("org-1", 1, "family_00")
    if table_key in {"kehoach", "goithau"}:
        assert TABLES[table_key][0] in fixture.child_reads
    else:
        assert item["goiThauIds"] == ["package-1"]
    # The additive flag leaves the existing code/ID candidate lookup intact.
    default = fixture.read(table_key, "family_00", exact=False)
    assert json.loads(default.body)["item"]["id"] == "collision"


@pytest.mark.parametrize("table_key", TABLES)
@pytest.mark.parametrize("lookup", ["SHARED-CODE", "foreign_00", "unassigned_00", "missing_00"])
def test_exact_lookup_cannot_fallback_to_code_or_bypass_tenant_and_record_scope(record_lookup, table_key, lookup):
    response = record_lookup.read(table_key, lookup)
    assert response.status_code == 404
    assert json.loads(response.body) == {"item": None}
    sql, parameters = record_lookup.queries[0]
    assert "source_row.organization_id = ? AND source_row.scope_allowed = ?" in sql
    assert parameters == ("org-1", 1, lookup)


@pytest.mark.parametrize("table_key", TABLES)
@pytest.mark.parametrize("gate", ["module", "record"])
def test_exact_lookup_retains_both_module_and_post_query_record_authorization(record_lookup, table_key, gate):
    fixture = record_lookup
    if gate == "module":
        fixture.module_allowed = False
    else:
        fixture.record_allowed = False
    response = fixture.read(table_key, "family_00")
    assert response.status_code == 403
    assert not fixture.child_reads
    assert len(fixture.queries) == (0 if gate == "module" else 1)
