from backend.sync.payload_validation import validate_sync_item


MEDICINE_WEIGHT_ERROR = (
    "Đối với gói thầu thuốc, trọng số kỹ thuật phải nằm trong khoảng 30% - 40%."
)


def _medicine_package(weight):
    return {
        "linhVuc": "Hàng hóa",
        "isThuoc": 1,
        "phuongPhapDanhGia": "Kết hợp giữa kỹ thuật và giá",
        "trongSoKyThuat": weight,
    }


def test_medicine_package_accepts_technical_weight_from_30_to_40_percent():
    for weight in (30, 35, 40):
        _, errors, _ = validate_sync_item("goi_thau", _medicine_package(weight))
        assert MEDICINE_WEIGHT_ERROR not in errors


def test_medicine_package_rejects_technical_weight_outside_30_to_40_percent():
    for weight in (None, 29, 41):
        _, errors, _ = validate_sync_item("goi_thau", _medicine_package(weight))
        assert MEDICINE_WEIGHT_ERROR in errors
