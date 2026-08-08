from backend.versioning.aggregate_snapshot import (
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
    goods = snapshot["goithauhanghoa"][0]
    opening = snapshot["thongtinmothau"][0]
    bidder_goods = snapshot["hanghoaduthaunhathau"][0]
    assert goods["phanLoId"] == lot_id
    assert opening["phanLoId"] == lot_id
    assert opening["thanhVienLienDanh"][0]["id"] != "member-source"
    report = opening["baoCaoDanhGiaChiTietList"][0]
    criterion = package["danhGiaHsdtMetadata"]["technical"]["criteria"][0]
    assert report["vongDanhGiaId"] == "evaluation-round:package-target:technical"
    assert report["chiTietList"][0]["tieuChiDanhGiaId"] == criterion["id"]
    assert bidder_goods["thongTinMoThauId"] == opening["id"]
    assert bidder_goods["goiThauHangHoaId"] == goods["id"]
    assert snapshot["assignments"][0]["targetId"] == "package-target"


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
