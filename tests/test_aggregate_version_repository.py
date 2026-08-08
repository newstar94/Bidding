from backend.versioning.repository import AggregateVersionRepository


class ScriptedCursor:
    def __init__(self):
        self.rows = []
        self.calls = []

    def execute(self, sql, params=()):
        normalized = " ".join(sql.split())
        self.calls.append((normalized, tuple(params)))
        if "FROM ke_hoach_lcnt" in normalized:
            self.rows = [{"id": "plan-1"}]
        elif "FROM goi_thau " in normalized and "ke_hoach_id = ?" in normalized:
            self.rows = [
                {"id": "package-1", "ke_hoach_id": "plan-1", "is_latest": 1},
                {"id": "package-2", "ke_hoach_id": "plan-1", "is_latest": 1},
            ]
        elif "FROM goi_thau " in normalized and "id = ?" in normalized:
            self.rows = [{"id": "package-1", "ke_hoach_id": "plan-1"}]
        elif "FROM goi_thau_hang_hoa" in normalized:
            self.rows = [{"id": "goods-1", "goi_thau_id": "package-1"}]
        elif "FROM thong_tin_mo_thau" in normalized:
            self.rows = [{"id": "opening-1", "goi_thau_id": "package-1"}]
        elif "FROM hang_hoa_du_thau_nha_thau" in normalized:
            self.rows = [{"id": "bidder-goods-1", "goi_thau_id": "package-1"}]
        elif "FROM phan_cong_nhan_su" in normalized and "'kehoach'" in normalized:
            self.rows = [{
                "id": "plan-assignment-1",
                "id_muc_tieu": "plan-1",
                "loai_doi_tuong": "kehoach",
            }]
        elif "FROM phan_cong_nhan_su" in normalized:
            self.rows = [{
                "id": "assignment-1",
                "id_muc_tieu": "package-1",
                "loai_doi_tuong": "goithau",
            }]
        elif "FROM sync_metadata" in normalized:
            self.rows = [{"current_version": 12}]
        else:
            self.rows = []
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


def _map_record(_table_name, row):
    mapping = {
        "ke_hoach_id": "keHoachId",
        "goi_thau_id": "goiThauId",
        "id_muc_tieu": "targetId",
        "loai_doi_tuong": "type",
    }
    return {mapping.get(key, key): value for key, value in row.items()}


def _attach_children(_cursor, table_name, items, **_kwargs):
    marker = {
        "ke_hoach_lcnt": "planChildrenLoaded",
        "goi_thau": "packageChildrenLoaded",
        "thong_tin_mo_thau": "openingChildrenLoaded",
    }[table_name]
    for item in items:
        item[marker] = True


def test_package_repository_loads_the_complete_server_aggregate_in_tenant_scope():
    cursor = ScriptedCursor()
    repository = AggregateVersionRepository(
        cursor,
        map_record=_map_record,
        attach_children=_attach_children,
    )

    state = repository.load_package_state("org-1", "package-1")

    assert state["goithau"] == [{
        "id": "package-1",
        "keHoachId": "plan-1",
        "packageChildrenLoaded": True,
    }]
    assert state["goithauhanghoa"][0]["goiThauId"] == "package-1"
    assert state["thongtinmothau"][0]["openingChildrenLoaded"] is True
    assert state["hanghoaduthaunhathau"][0]["id"] == "bidder-goods-1"
    assert state["assignments"][0]["targetId"] == "package-1"
    assert all(call[1][0] == "org-1" for call in cursor.calls)


def test_plan_repository_loads_latest_package_aggregates_from_server_state():
    cursor = ScriptedCursor()
    repository = AggregateVersionRepository(
        cursor,
        map_record=_map_record,
        attach_children=_attach_children,
    )

    state = repository.load_plan_state("org-1", "plan-1")

    assert state["kehoach"] == [{"id": "plan-1", "planChildrenLoaded": True}]
    assert [package["id"] for package in state["goithau"]] == [
        "package-1",
        "package-2",
    ]
    assert all(package["packageChildrenLoaded"] for package in state["goithau"])
    assert any(
        assignment["type"] == "kehoach"
        and assignment["targetId"] == "plan-1"
        for assignment in state["assignments"]
    )
    package_query = next(
        call for call in cursor.calls if "ke_hoach_id = ?" in call[0]
    )
    assert "is_latest = 1" in package_query[0]
    assert package_query[1] == ("org-1", "plan-1")
