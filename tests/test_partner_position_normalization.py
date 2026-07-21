import pytest

from backend.partners.position_normalization import derive_investor_head_position


@pytest.mark.parametrize(
    ("representative_position", "expected"),
    [
        ("Chủ tịch", "Chủ tịch"),
        ("Giám đốc", "Giám đốc"),
        ("Phó hiệu trưởng", "Hiệu trưởng"),
        ("Phó chủ tịch", "Chủ tịch"),
        ("Phó giám đốc", "Giám đốc"),
        ("Phó Tổng giám đốc", "Tổng giám đốc"),
        ("Phó trưởng phòng", "Trưởng phòng"),
        ("Hiệu phó", "Hiệu trưởng"),
        ("Hiệu phó phụ trách chuyên môn", "Hiệu trưởng phụ trách chuyên môn"),
        ("", ""),
        (None, ""),
    ],
)
def test_derive_investor_head_position(representative_position, expected):
    assert derive_investor_head_position(representative_position) == expected
