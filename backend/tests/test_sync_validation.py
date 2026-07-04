import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../helpers_py')))

from helpers_py.sync_validation import validate_sync_item


def messages(errors):
    return " | ".join(errors)


def test_validate_package_rejects_invalid_time_order_and_negative_price():
    item, errors, statuses = validate_sync_item("goi_thau", {
        "id": "gt-1",
        "tenGoiThau": "Goi thau 1",
        "trangThai": "Đang mời thầu",
        "thoiGianDangTai": "2026-07-04 10:00",
        "thoiGianDongThau": "2026-07-04 09:00",
        "giaGoiThau": "-1",
    })

    text = messages(errors)
    assert "Thời gian đóng thầu" in text
    assert "Giá gói thầu" in text
    assert statuses == set()
    assert item["trangThai"] == "Đang mời thầu"


def test_validate_package_normalizes_legacy_cancelled_status():
    item, errors, _ = validate_sync_item("goi_thau", {
        "id": "gt-2",
        "tenGoiThau": "Goi thau 2",
        "trangThai": "Huỷ thầu",
    })

    assert errors == []
    assert item["trangThai"] == "Hủy thầu"


def test_validate_plan_normalizes_auto_total_flag():
    item, errors, _ = validate_sync_item("ke_hoach_lcnt", {
        "id": "kh-1",
        "tenKeHoach": "Ke hoach 1",
        "isTongMucTuDong": "true",
        "tongMucDauTu": "1000",
    })

    assert errors == []
    assert item["isTongMucTuDong"] == 1


def test_validate_contract_requests_missing_paper_status_seed():
    _, errors, statuses = validate_sync_item(
        "hop_dong",
        {
            "id": "hd-1",
            "tenHopDong": "Hop dong 1",
            "soHopDong": "HD-1",
            "trangThaiHoSo": "Dang luu kho",
        },
        incoming_paper_status_names={"Da nop"}
    )

    assert errors == []
    assert statuses == {"Dang luu kho"}
