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
        elif "FROM goi_thau_chuyen_gia" in normalized:
            self.rows = [
                {
                    "goi_thau_id": "package-1",
                    "chuyen_gia_id": "expert-1",
                    "loai": "chuyen_gia",
                    "chuc_vu": "Tổ trưởng",
                    "cong_viec": "Lập HSMT",
                },
                {
                    "goi_thau_id": "package-1",
                    "chuyen_gia_id": "expert-2",
                    "loai": "tham_dinh",
                    "chuc_vu": "Tổ trưởng",
                    "cong_viec": "Thẩm định HSMT",
                },
            ]
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


class AuthorityCursor:
    def __init__(self, provider):
        self.provider = provider
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((" ".join(sql.split()), tuple(params)))
        return self

    def fetchone(self):
        return None if self.provider is None else (self.provider,)


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
        "toChuyenGia": [{
            "chuyenGiaId": "expert-1",
            "id": "expert-1",
            "chucVu": "Tổ trưởng",
            "congViec": "Lập HSMT",
        }],
        "toThamDinh": [{
            "chuyenGiaId": "expert-2",
            "id": "expert-2",
            "chucVu": "Tổ trưởng",
            "congViec": "Thẩm định HSMT",
        }],
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
    assert state["goithau"][0]["toChuyenGia"][0]["chucVu"] == "Tổ trưởng"
    assert state["goithau"][0]["toThamDinh"][0]["chucVu"] == "Tổ trưởng"
    assert state["goithau"][1]["toChuyenGia"] == []
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


def test_source_version_authority_resolves_plan_lineage_through_applied_snapshot():
    cursor = AuthorityCursor("MUASAMCONG")

    provider = AggregateVersionRepository(cursor).source_version_authority(
        "org-1", "plan", "plan-root",
    )

    assert provider == "MUASAMCONG"
    query, parameters = cursor.calls[0]
    assert "JOIN ke_hoach_lcnt AS plan" in query
    assert parameters == ("org-1", "PLAN", "kehoach", "plan-root")


def test_source_version_authority_resolves_package_root_and_returns_none_when_unmanaged():
    managed = AuthorityCursor("MUASAMCONG")
    unmanaged = AuthorityCursor(None)

    assert AggregateVersionRepository(managed).source_version_authority(
        "org-1", "package", "package-root",
    ) == "MUASAMCONG"
    assert AggregateVersionRepository(unmanaged).source_version_authority(
        "org-1", "package", "package-root",
    ) is None
    query, parameters = managed.calls[0]
    assert "local_root_id = ?" in query
    assert parameters == ("org-1", "NOTICE", "goithau", "package-root")


def test_plan_repository_chunks_every_package_relation_query():
    cursor = ScriptedCursor()
    repository = AggregateVersionRepository(
        cursor,
        map_record=_map_record,
        attach_children=lambda *_args, **_kwargs: None,
    )
    package_ids = [f"package-{index}" for index in range(1201)]

    repository._load_package_relations("org-1", package_ids)

    relation_calls = [
        call for call in cursor.calls
        if any(table in call[0] for table in (
            "goi_thau_hang_hoa",
            "thong_tin_mo_thau",
            "hang_hoa_du_thau_nha_thau",
            "phan_cong_nhan_su",
        ))
    ]
    assert len(relation_calls) == 12
    assert max(len(parameters) for _sql, parameters in relation_calls) == 501


def test_expert_relations_are_chunked_at_database_parameter_boundary():
    cursor = ScriptedCursor()
    repository = AggregateVersionRepository(cursor)
    packages = [{"id": f"package-{index}"} for index in range(1001)]

    repository._attach_package_expert_relations("org-1", packages)

    calls = [call for call in cursor.calls if "goi_thau_chuyen_gia" in call[0]]
    assert len(calls) == 3
    assert max(len(parameters) for _sql, parameters in calls) == 501
