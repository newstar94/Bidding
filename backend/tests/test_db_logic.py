# pyrefly: ignore [missing-import]
import pytest
import sqlite3
import sys
import os

# Thêm đường dẫn backend và helpers_py vào sys.path để import dễ dàng
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../helpers_py')))

from helpers_py.schema import SCHEMA_DINH_NGHIA

@pytest.fixture
def temp_db():
    """Tạo database tạm trong RAM cho mỗi ca kiểm thử"""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Tạo bảng goi_thau dựa trên schema cấu trúc thực tế
    cols_def = []
    table_spec = SCHEMA_DINH_NGHIA["goi_thau"]
    for col_name, col_def in table_spec["columns"].items():
        cols_def.append(f"{col_name} {col_def}")
    
    cursor.execute(f"CREATE TABLE goi_thau ({', '.join(cols_def)})")
    conn.commit()
    yield conn
    conn.close()

def test_is_thuoc_default_value(temp_db):
    """Kiểm tra cột is_thuoc mặc định phải là 0"""
    cursor = temp_db.cursor()
    cursor.execute("""
        INSERT INTO goi_thau (id, ten_goi_thau, linh_vuc) 
        VALUES ('test-id-1', 'Gói thầu hàng hóa X', 'Hàng hóa')
    """)
    temp_db.commit()
    
    cursor.execute("SELECT is_thuoc FROM goi_thau WHERE id='test-id-1'")
    row = cursor.fetchone()
    assert row["is_thuoc"] == 0  # Giá trị mặc định phải là 0 (Không phải thuốc)

def test_invalid_trang_thai_constraint(temp_db):
    """Kiểm tra ràng buộc CHECK constraint của trang_thai"""
    cursor = temp_db.cursor()
    # Nhập trạng thái không hợp lệ nằm ngoài CHECK ('Chuẩn bị', 'Đang mời thầu', ...)
    with pytest.raises(sqlite3.IntegrityError):
        cursor.execute("""
            INSERT INTO goi_thau (id, ten_goi_thau, trang_thai) 
            VALUES ('test-id-2', 'Gói thầu lỗi', 'Trạng thái không hợp lệ')
        """)
        temp_db.commit()
