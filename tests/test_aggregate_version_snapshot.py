from copy import deepcopy

from backend.versioning.aggregate_snapshot import (
    PACKAGE_CHILD_CLONE_POLICY,
    snapshot_package_aggregate,
    snapshot_plan_aggregate,
)


def _ids():
    counter = 0

    def create(kind):
        nonlocal counter
        counter += 1
        return f"{kind}-{counter}"

    return create


def _state():
    package = {
        "id": "package-source",
        "rootId": "package-root",
        "keHoachId": "plan-source",
        "phienBan": 2,
        "isLatest": 1,
        "rowVersion": 7,
        "phanLoList": [{"id": "lot-source", "maPhanLo": "L01"}],
        "awardedPhanLoList": [{"id": "lot-source", "maPhanLo": "L01"}],
        "tuyChonMuaThemList": [{"id": "option-source", "noiDung": "Mua them"}],
        "giaHanList": [{"id": "extension-source", "lyDo": "Gia han"}],
        "yeuCauLamRoList": [{"id": "clarification-source", "noiDung": "Yeu cau"}],
        "traLoiLamRoList": [{"id": "answer-source", "noiDung": "Tra loi"}],
        "timelineItems": [{
            "id": "timeline-source",
            "sourceEntityId": "lot-source",
            "rowVersion": 2,
        }],
        "ehsmtAdjustments": [{"id": "adjustment-source", "noiDung": "Dieu chinh"}],
        "danhGiaHsdtMetadata": {
            "schemaVersion": 1,
            "is1G2T": True,
            "technical": {
                "id": "round-source",
                "criteria": [{"id": "criterion-source", "name": "Kỹ thuật"}],
            },
            "financial": {"criteria": []},
        },
    }
    return {
        "kehoach": [{
            "id": "plan-source",
            "rootId": "plan-root",
            "phienBan": 1,
            "isLatest": 1,
            "rowVersion": 4,
        }],
        "goithau": [package],
        "goithauhanghoa": [{
            "id": "goods-source",
            "goiThauId": package["id"],
            "phanLoId": "lot-source",
        }],
        "thongtinmothau": [{
            "id": "opening-source",
            "goiThauId": package["id"],
            "phanLoId": "lot-source",
            "danhGiaHopLe": "pass",
            "danhGiaKetLuan": "qualified",
            "giaDeNghiTrungThau": 900,
            "thanhVienLienDanh": [{"id": "member-source", "thanhVienNhaThauId": "contractor-1"}],
            "baoCaoDanhGiaChiTietList": [{
                "id": "report-source",
                "loaiVong": "technical",
                "vongDanhGiaId": "round-source",
                "chiTietList": [{
                    "id": "detail-source",
                    "tieuChiDanhGiaId": "criterion-source",
                    "diem": 85,
                }],
            }],
        }],
        "hanghoaduthaunhathau": [{
            "id": "bidder-goods-source",
            "goiThauId": package["id"],
            "thongTinMoThauId": "opening-source",
            "goiThauHangHoaId": "goods-source",
            "phanLoId": "lot-source",
        }],
        "assignments": [{
            "id": "assignment-source",
            "targetId": package["id"],
            "type": "goithau",
            "empId": "employee-1",
        }],
    }


def test_package_snapshot_remaps_full_aggregate_without_server_fields():
    state = _state()
    snapshot = snapshot_package_aggregate(
        state,
        state["goithau"][0],
        target_package_id="package-target",
        target_plan_id="plan-target",
        package_version=3,
        timestamp="2026-08-08 10:00:00",
        create_id=_ids(),
    )

    package = snapshot["packageRecord"]
    assert package["id"] == "package-target"
    assert package["keHoachId"] == "plan-target"
    assert package["rootId"] == "package-root"
    assert package["phienBan"] == 3
    assert "rowVersion" not in package
    lot_id = package["phanLoList"][0]["id"]
    assert package["awardedPhanLoList"][0]["id"] == lot_id
    source_ids = {
        "tuyChonMuaThemList": "option-source",
        "giaHanList": "extension-source",
        "yeuCauLamRoList": "clarification-source",
        "traLoiLamRoList": "answer-source",
        "timelineItems": "timeline-source",
        "ehsmtAdjustments": "adjustment-source",
    }
    for field, source_id in source_ids.items():
        assert package[field][0]["id"] != source_id
        assert "rowVersion" not in package[field][0]
    assert package["timelineItems"][0]["sourceEntityId"] == lot_id
    goods = snapshot["goithauhanghoa"][0]
    opening = snapshot["thongtinmothau"][0]
    bidder_goods = snapshot["hanghoaduthaunhathau"][0]
    assert goods["phanLoId"] == lot_id
    assert opening["phanLoId"] == lot_id
    assert opening["danhGiaHopLe"] == "pass"
    assert opening["danhGiaKetLuan"] == "qualified"
    assert opening["giaDeNghiTrungThau"] == 900
    assert opening["thanhVienLienDanh"][0]["id"] != "member-source"
    report = opening["baoCaoDanhGiaChiTietList"][0]
    criterion = package["danhGiaHsdtMetadata"]["technical"]["criteria"][0]
    assert report["vongDanhGiaId"] == "evaluation-round:package-target:technical"
    assert report["chiTietList"][0]["tieuChiDanhGiaId"] == criterion["id"]
    assert bidder_goods["thongTinMoThauId"] == opening["id"]
    assert bidder_goods["goiThauHangHoaId"] == goods["id"]
    assert snapshot["assignments"][0]["targetId"] == "package-target"


def test_operational_evidence_remains_on_the_historical_package_snapshot():
    state = _state()
    retained_tables = PACKAGE_CHILD_CLONE_POLICY["retain_on_historical_snapshot"]
    for table in retained_tables:
        state[table] = [{"id": f"{table}-source", "goiThauId": "package-source"}]
    original_evidence = {
        table: deepcopy(state[table]) for table in retained_tables
    }

    snapshot = snapshot_package_aggregate(
        state,
        state["goithau"][0],
        target_package_id="package-target",
        target_plan_id="plan-target",
        package_version=3,
        timestamp="2026-08-08 10:00:00",
        create_id=_ids(),
    )

    for table in retained_tables:
        assert table not in snapshot
        assert state[table] == original_evidence[table]


def test_plan_snapshot_uses_complete_server_state_without_browser_hydration():
    state = _state()
    aggregate = snapshot_plan_aggregate(
        state,
        source_plan_id="plan-source",
        target_plan_id="plan-target",
        timestamp="2026-08-08 10:00:00",
        create_id=_ids(),
    )

    assert len(aggregate["goithau"]) == 1
    assert aggregate["goithau"][0]["keHoachId"] == "plan-target"
    assert len(aggregate["goithauhanghoa"]) == 1
    assert len(aggregate["thongtinmothau"]) == 1
    assert len(aggregate["hanghoaduthaunhathau"]) == 1
    assert len(aggregate["assignments"]) == 1
    inherited_package = aggregate["goithau"][0]
    assert inherited_package["timelineItems"][0]["sourceEntityId"] == inherited_package["phanLoList"][0]["id"]
    assert inherited_package["yeuCauLamRoList"][0]["id"] != "clarification-source"
    assert inherited_package["giaHanList"][0]["id"] != "extension-source"


def test_plan_snapshot_can_exclude_removed_package_roots():
    state = _state()
    state["goithau"].append({
        **state["goithau"][0],
        "id": "package-removed",
        "rootId": "package-removed-root",
        "phanLoList": [],
        "awardedPhanLoList": [],
    })
    aggregate = snapshot_plan_aggregate(
        state,
        source_plan_id="plan-source",
        target_plan_id="plan-target",
        timestamp="2026-08-08 10:00:00",
        create_id=_ids(),
        exclude_package_roots={"package-removed-root"},
    )

    assert len(aggregate["goithau"]) == 1
    assert aggregate["goithau"][0]["rootId"] == "package-root"
