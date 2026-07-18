import asyncio
import json
from types import SimpleNamespace

from starlette.testclient import TestClient

from backend.app import app
from backend.shared.request_validation import read_json_object, validate_json_object
from backend.sync.payload_validation import (
    validate_package_locked_fields,
    validate_sync_item,
    validate_sync_payload_shape,
)


def _codes(errors):
    return {error["code"] for error in errors}


def test_request_schema_distinguishes_absent_null_unknown_and_invalid_type():
    fields = {
        "name": {"type": "string", "required": True},
        "count": {"type": "integer", "nullable": True},
    }
    assert _codes(validate_json_object({}, fields)) == {"FIELD_REQUIRED"}
    assert _codes(validate_json_object({"name": None}, fields)) == {"NULL_NOT_ALLOWED"}
    assert _codes(validate_json_object({"name": "ok", "extra": True}, fields)) == {"UNKNOWN_FIELD"}
    assert _codes(validate_json_object({"name": "ok", "count": 1.5}, fields)) == {"INVALID_INTEGER"}
    assert validate_json_object({"name": "ok", "count": None}, fields) == []


def test_json_reader_preserves_syntax_and_top_level_object_errors():
    class Request:
        headers = {}
        state = SimpleNamespace()

        def __init__(self, value=None, error=None):
            self.value = value
            self.error = error

        async def json(self):
            if self.error:
                raise self.error
            return self.value

    data, response = asyncio.run(read_json_object(Request(value={"ok": True})))
    assert data == {"ok": True}
    assert response is None

    _, malformed = asyncio.run(
        read_json_object(Request(error=json.JSONDecodeError("bad", "{", 1)))
    )
    assert malformed.status_code == 400
    assert json.loads(malformed.body)["code"] == "REQUEST_JSON_INVALID"

    _, non_object = asyncio.run(read_json_object(Request(value=[])))
    assert non_object.status_code == 400
    assert json.loads(non_object.body)["code"] == "REQUEST_JSON_OBJECT_REQUIRED"


def test_sync_schema_rejects_unknown_fields_truncation_and_invalid_children():
    errors = validate_sync_payload_shape({
        "goithau": [{
            "id": "bid-1",
            "organizationId": "org-1",
            "tenGoiThau": "Bid",
            "hieuLucHsdt": 1.5,
            "unknown": "silently ignored before",
            "phanLoList": [{"giaTriPhanLo": "1.5"}],
        }],
    })
    assert {error["field"] for error in errors} >= {
        "goithau[0].hieuLucHsdt",
        "goithau[0].unknown",
        "goithau[0].phanLoList[0].giaTriPhanLo",
    }
    assert {"INVALID_INTEGER", "UNKNOWN_FIELD", "INVALID_MONEY"} <= _codes(errors)


def test_sync_schema_accepts_exact_large_money_and_explicit_nullable_field():
    assert validate_sync_payload_shape({
        "goithau": [{
            "id": "bid-1",
            "organizationId": "org-1",
            "tenGoiThau": "Bid",
            "giaGoiThau": "9007199254740993",
            "giaTrungThau": None,
        }],
    }) == []


def test_sync_schema_uses_one_canonical_payload_shape_and_strict_summary_flag():
    legacy_errors = validate_sync_payload_shape({
        "upserts": {"goithau": [{"id": "bid-1", "tenGoiThau": "Bid"}]},
    })
    assert any(error["field"] == "upserts" and error["code"] == "UNKNOWN_FIELD" for error in legacy_errors)

    boolean_errors = validate_sync_payload_shape({"includeDashboardSummary": "true"})
    assert any(
        error["field"] == "includeDashboardSummary" and error["code"] == "INVALID_BOOLEAN"
        for error in boolean_errors
    )


def test_sync_schema_requires_a_consistent_rebid_source_pair():
    _, missing_source, _ = validate_sync_item(
        "goi_thau",
        {"id": "bid-rebid", "tenGoiThau": "Đấu thầu lại", "isRebid": True},
        set(),
    )
    assert any("gói thầu nguồn" in error for error in missing_source)

    _, stray_source, _ = validate_sync_item(
        "goi_thau",
        {
            "id": "bid-normal",
            "tenGoiThau": "Gói thường",
            "isRebid": False,
            "rebidFromPackageId": "bid-source",
        },
        set(),
    )
    assert any("không được tham chiếu" in error for error in stray_source)


def test_joint_venture_requires_unique_members_and_exactly_one_leader():
    _, errors, _ = validate_sync_item(
        "thong_tin_mo_thau",
        {
            "id": "opening-jv",
            "loaiNhaThau": "Liên danh",
            "thanhVienLienDanh": [
                {"thanhVienNhaThauId": "nt-a", "vaiTro": "Đứng đầu liên danh"},
                {"thanhVienNhaThauId": "nt-a", "vaiTro": "Đứng đầu liên danh"},
            ],
        },
        set(),
    )

    assert "Một nhà thầu không được xuất hiện nhiều lần trong cùng liên danh." in errors
    assert "Liên danh phải có đúng một thành viên đứng đầu." in errors


def test_valid_joint_venture_has_one_leader_and_at_least_two_members():
    _, errors, _ = validate_sync_item(
        "thong_tin_mo_thau",
        {
            "id": "opening-jv",
            "loaiNhaThau": "Liên danh",
            "thanhVienLienDanh": [
                {"thanhVienNhaThauId": "nt-a", "vaiTro": "Đứng đầu liên danh"},
                {"thanhVienNhaThauId": "nt-b", "vaiTro": "Thành viên liên danh"},
            ],
        },
        set(),
    )

    assert errors == []


def test_backend_recalculates_discounted_bid_price_instead_of_trusting_client_total():
    item, errors, _ = validate_sync_item("thong_tin_mo_thau", {
        "id": "opening-1", "goiThauId": "package-1", "nhaThauId": "contractor-1",
        "giaDuThau": "1000001", "tyLeGiamGia": 10,
        "giaSauGiamGia": "1",
    })
    assert not any("giảm giá" in str(error).lower() for error in errors)
    assert item["giaSauGiamGia"] == "900001"


def test_backend_recalculates_package_award_total_from_awarded_lots():
    item, _errors, _ = validate_sync_item("goi_thau", {
        "id": "package-1", "tenGoiThau": "Package", "giaGoiThau": "300",
        "trangThai": "Đã có kết quả", "phanLo": "Có",
        "phanLoList": [
            {"maPhanLo": "L1", "tenPhanLo": "Lot 1", "giaTriPhanLo": "100"},
            {"maPhanLo": "L2", "tenPhanLo": "Lot 2", "giaTriPhanLo": "200"},
        ],
        "awardedPhanLoList": [
            {"maPhanLo": "L1", "nhaThauTrungThauId": "contractor-1", "giaTrungThau": "90"},
            {"maPhanLo": "L2", "nhaThauTrungThauId": "contractor-2", "giaTrungThau": "180"},
        ],
        "giaTrungThau": "1",
    })
    assert item["giaTrungThau"] == "270"


def test_issued_package_requires_a_new_version_for_material_changes():
    errors = validate_package_locked_fields(
        {
            "trang_thai": "Đang mời thầu",
            "ten_goi_thau": "Gói A",
            "gia_goi_thau": 100,
            "nguon_von": "Ngân sách",
        },
        {
            "tenGoiThau": "Gói A",
            "giaGoiThau": 120,
            "nguonVon": "Ngân sách",
        },
    )
    assert [error["field"] for error in errors] == ["giaGoiThau"]
    assert errors[0]["code"] == "PACKAGE_FIELD_LOCKED"


def test_json_middleware_and_login_schema_return_stable_400_errors():
    with TestClient(app, base_url="https://testserver") as client:
        malformed = client.post(
            "/api/auth/login",
            content=b'{"username":',
            headers={"Content-Type": "application/json"},
        )
        assert malformed.status_code == 400
        assert malformed.json()["code"] == "REQUEST_JSON_INVALID"

        unknown = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "not-the-password", "unexpected": 1},
        )
        assert unknown.status_code == 400
        body = unknown.json()
        assert body["code"] == "REQUEST_VALIDATION_FAILED"
        assert body["fields"]["errors"][0]["code"] == "UNKNOWN_FIELD"

        role_override = client.post(
            "/api/auth/register",
            json={
                "username": "role_override_user",
                "password": "valid-password-2026",
                "name": "Role Override",
                "email": "role-override@example.com",
                "role": "manager",
            },
        )
        assert role_override.status_code == 400
        role_errors = role_override.json()["fields"]["errors"]
        assert any(
            error["field"] == "role" and error["code"] == "UNKNOWN_FIELD"
            for error in role_errors
        )
