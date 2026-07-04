import pytest
import sys
import os

# Thêm đường dẫn backend vào sys.path để import dễ dàng
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from helpers_py.text_utils import (
    to_snake_case,
    to_camel_case,
    clean_id,
    format_date_str,
    VietnameseFloat,
    clean_admin_prefix
)

def test_to_snake_case():
    assert to_snake_case("CamelCase") == "camel_case"
    assert to_snake_case("camelCase") == "camel_case"
    assert to_snake_case("Simple") == "simple"
    assert to_snake_case("snake_case") == "snake_case"

def test_to_camel_case():
    assert to_camel_case("snake_case") == "snakeCase"
    assert to_camel_case("camel_case_string") == "camelCaseString"
    assert to_camel_case("simple") == "simple"

def test_clean_id():
    assert clean_id(None) is None
    assert clean_id("") is None
    assert clean_id("  12345  ") == "12345"

def test_format_date_str():
    assert format_date_str(None) == "--"
    assert format_date_str("") == "--"
    # test YYYY-MM-DD to DD/MM/YYYY
    assert format_date_str("2026-06-25") == "25/06/2026"
    assert format_date_str("2026-06-25 09:30:00") == "25/06/2026"
    # test DD/MM/YYYY formatting
    assert format_date_str("25/06/2026") == "25/06/2026"
    # invalid date format should fall back to itself
    assert format_date_str("invalid-date") == "invalid-date"

def test_vietnamese_float():
    val = VietnameseFloat(1234567.89)
    # 1234567.89 formatted with ,.0f becomes 1,234,568, and with replace(",", ".") becomes 1.234.568
    assert str(val) == "1.234.568"
    assert format(val) == "1.234.568"

def test_clean_admin_prefix():
    assert clean_admin_prefix("Tỉnh Lâm Đồng") == "Lâm Đồng"
    assert clean_admin_prefix("Thành phố Đà Lạt") == "Đà Lạt"
    assert clean_admin_prefix("Phường 1") == "1"
    assert clean_admin_prefix("Xã Tà Nung") == "Tà Nung"
    assert clean_admin_prefix("Thị trấn Liên Nghĩa") == "Liên Nghĩa"
    assert clean_admin_prefix("Huyện Đức Trọng") == "Huyện Đức Trọng"  # Không nằm trong danh sách loại bỏ
    assert clean_admin_prefix("") == ""
    assert clean_admin_prefix(None) == ""
