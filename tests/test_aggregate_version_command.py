from copy import deepcopy

import pytest

from backend.versioning.command import (
    AggregateVersionConflict,
    HistoricalAggregateError,
    build_aggregate_version_payload,
)


class FakeRepository:
    def __init__(self, state):
        self.state = state

    def load_package_state(self, _organization_id, _source_id):
        return self.state

    def load_plan_state(self, _organization_id, _source_id):
        return self.state

    def current_sync_version(self, _organization_id):
        return 12


def _state():
    return {
        "kehoach": [{
            "id": "plan-1", "rootId": "plan-root", "phienBan": 1,
            "isLatest": 1, "rowVersion": 3, "tenKeHoach": "Kế hoạch cũ",
        }],
        "goithau": [{
            "id": "package-1", "rootId": "package-root", "keHoachId": "plan-1",
            "phienBan": 2, "isLatest": 1, "rowVersion": 5,
            "tenGoiThau": "Gói cũ", "phanLoList": [],
        }],
        "goithauhanghoa": [],
        "thongtinmothau": [],
        "hanghoaduthaunhathau": [],
        "assignments": [],
    }


def test_package_version_command_builds_an_idempotent_server_sync_payload():
    source_state = _state()
    frozen_source = deepcopy(source_state)
    command = {
        "kind": "package",
        "sourceId": "package-1",
        "expectedRowVersion": 5,
        "changes": {"tenGoiThau": "Gói mới"},
        "clientMutationId": "version-command-1",
    }
    first = build_aggregate_version_payload(
        FakeRepository(source_state), "org-1", command, timestamp="2026-08-08 10:00:00"
    )
    second = build_aggregate_version_payload(
        FakeRepository(_state()), "org-1", command, timestamp="2026-08-08 10:00:00"
    )

    assert first == second
    assert first["baseSyncVersion"] == "12"
    assert first["clientMutationId"] == "version-command-1"
    assert len(first["goithau"]) == 2
    source, created = first["goithau"]
    assert source["id"] == "package-1"
    assert source["expectedVersion"] == 5
    assert source["isLatest"] == 0
    assert created["id"] != "package-1"
    assert created["phienBan"] == 3
    assert created["tenGoiThau"] == "Gói mới"
    assert source_state == frozen_source


def test_version_command_cannot_resolve_a_same_id_source_from_another_tenant():
    class TenantRepository(FakeRepository):
        def load_package_state(self, organization_id, _source_id):
            return self.state if organization_id == "org-a" else None

    command = {
        "kind": "package",
        "sourceId": "package-1",
        "expectedRowVersion": 5,
        "changes": {},
        "clientMutationId": "tenant-scoped-version-command",
    }

    with pytest.raises(LookupError, match="does not exist"):
        build_aggregate_version_payload(
            TenantRepository(_state()),
            "org-b",
            command,
            timestamp="2026-08-08 10:00:00",
        )
def test_plan_version_command_clones_packages_from_server_state():
    state = _state()
    state["assignments"] = [{
        "id": "plan-assignment-1",
        "targetId": "plan-1",
        "type": "kehoach",
        "empId": "employee-1",
        "rowVersion": 2,
    }]
    payload = build_aggregate_version_payload(
        FakeRepository(state),
        "org-1",
        {
            "kind": "plan",
            "sourceId": "plan-1",
            "expectedRowVersion": 3,
            "changes": {"tenKeHoach": "Kế hoạch mới"},
            "clientMutationId": "version-command-plan",
        },
        timestamp="2026-08-08 10:00:00",
    )

    assert len(payload["kehoach"]) == 2
    assert payload["kehoach"][1]["tenKeHoach"] == "Kế hoạch mới"
    assert len(payload["goithau"]) == 1
    assert payload["goithau"][0]["keHoachId"] == payload["kehoach"][1]["id"]
    assert len(payload["assignments"]) == 1
    assert payload["assignments"][0]["targetId"] == payload["kehoach"][1]["id"]
    assert payload["assignments"][0]["empId"] == "employee-1"
    assert payload["assignments"][0]["id"] != "plan-assignment-1"


def test_version_command_rejects_a_stale_expected_row_version():
    with pytest.raises(AggregateVersionConflict) as error:
        build_aggregate_version_payload(
            FakeRepository(_state()),
            "org-1",
            {
                "kind": "package",
                "sourceId": "package-1",
                "expectedRowVersion": 4,
                "changes": {},
                "clientMutationId": "stale-version-command",
            },
            timestamp="2026-08-08 10:00:00",
        )
    assert error.value.current_version == 5


def test_version_command_drops_server_owned_fields_from_requested_changes():
    payload = build_aggregate_version_payload(
        FakeRepository(_state()),
        "org-1",
        {
            "kind": "package",
            "sourceId": "package-1",
            "expectedRowVersion": 5,
            "changes": {
                "organizationId": "other-org",
                "rowVersion": 999,
                "expectedVersion": 999,
                "syncVersion": 999,
                "id": "attacker-controlled-id",
            },
            "clientMutationId": "server-field-injection",
        },
        timestamp="2026-08-08 10:00:00",
    )

    created = payload["goithau"][1]
    assert created["id"] != "attacker-controlled-id"
    assert "organizationId" not in created
    assert "rowVersion" not in created
    assert "expectedVersion" not in created
    assert "syncVersion" not in created


def test_plan_version_command_migrates_legacy_plan_field_names():
    payload = build_aggregate_version_payload(
        FakeRepository(_state()),
        "org-1",
        {
            "kind": "plan",
            "sourceId": "plan-1",
            "expectedRowVersion": 3,
            "changes": {
                "diadiemQuymo": "Hà Nội, quy mô 10 ha",
                "thongtinKhac": "Thông tin kế thừa",
            },
            "clientMutationId": "legacy-plan-field-command",
        },
        timestamp="2026-08-08 10:00:00",
    )

    created = payload["kehoach"][1]
    assert created["diaDiemQuyMo"] == "Hà Nội, quy mô 10 ha"
    assert created["thongTinKhac"] == "Thông tin kế thừa"
    assert "diadiemQuymo" not in created
    assert "thongtinKhac" not in created


def test_package_version_command_rejects_package_owned_by_historical_plan():
    state = _state()
    state["kehoach"][0]["isLatest"] = 0
    with pytest.raises(HistoricalAggregateError, match="owning plan"):
        build_aggregate_version_payload(
            FakeRepository(state),
            "org-1",
            {
                "kind": "package",
                "sourceId": "package-1",
                "expectedRowVersion": 5,
                "changes": {},
                "clientMutationId": "historical-plan-package",
            },
            timestamp="2026-08-08 10:00:00",
        )


def test_manual_version_command_rejects_muasamcong_managed_lineage():
    class ManagedRepository(FakeRepository):
        def source_version_authority(self, organization_id, kind, root_id):
            assert organization_id == "org-1"
            assert kind == "plan"
            assert root_id == "plan-root"
            return "MUASAMCONG"

    with pytest.raises(HistoricalAggregateError, match="MUASAMCONG-managed"):
        build_aggregate_version_payload(
            ManagedRepository(_state()),
            "org-1",
            {
                "kind": "plan",
                "sourceId": "plan-1",
                "expectedRowVersion": 3,
                "changes": {},
                "clientMutationId": "managed-plan-version",
            },
            timestamp="2026-08-08 10:00:00",
        )


def test_plan_version_command_can_exclude_removed_package_roots():
    state = _state()
    state["goithau"].append({
        **state["goithau"][0],
        "id": "package-removed",
        "rootId": "removed-root",
    })
    payload = build_aggregate_version_payload(
        FakeRepository(state),
        "org-1",
        {
            "kind": "plan",
            "sourceId": "plan-1",
            "expectedRowVersion": 3,
            "changes": {},
            "excludePackageRootIds": ["removed-root"],
            "clientMutationId": "plan-with-removal",
        },
        timestamp="2026-08-08 10:00:00",
    )
    assert [row["rootId"] for row in payload["goithau"]] == ["package-root"]
