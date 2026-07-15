from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.sync.payload_validation import validate_sync_item


def test_investor_without_tax_code_is_valid():
    item, errors, _ = validate_sync_item(
        "chu_dau_tu",
        {
            "id": "cdt-without-tax-code",
            "tenChuDauTu": "Ban quản lý dự án không có mã số thuế",
            "maSoThue": "",
        },
    )

    assert item["maSoThue"] == ""
    assert errors == []


def test_investor_with_null_tax_code_is_valid():
    _, errors, _ = validate_sync_item(
        "chu_dau_tu",
        {
            "id": "cdt-null-tax-code",
            "tenChuDauTu": "Đơn vị sự nghiệp",
            "maSoThue": None,
        },
    )

    assert errors == []


def test_investor_non_empty_tax_code_still_requires_valid_format():
    _, errors, _ = validate_sync_item(
        "chu_dau_tu",
        {
            "id": "cdt-invalid-tax-code",
            "tenChuDauTu": "Đơn vị có mã sai",
            "maSoThue": "ABC",
        },
    )

    assert any("Mã số thuế" in error for error in errors)
