from starlette.testclient import TestClient

from backend.app import app
from backend.shared.request_validation import validate_json_object
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
