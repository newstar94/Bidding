import sys
import os
import importlib.machinery
import importlib.util

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
models_dir = os.path.join(project_root, 'models')

sys.path.insert(0, project_root)
sys.path.append(models_dir)

def load_and_register(name, filepath):
    loader = importlib.machinery.SourcelessFileLoader(name, filepath)
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    sys.modules[name] = module
    loader.exec_module(module)
    return module

models = load_and_register('models', os.path.join(models_dir, 'models.cpython-314.pyc'))
database = load_and_register('database', os.path.join(models_dir, 'database.cpython-314.pyc'))

db_indexes_created = False
orig_get_connection = database.get_connection

def optimized_get_connection(*args, **kwargs):
    conn = orig_get_connection(*args, **kwargs)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA cache_size = -65536")
        cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.execute("PRAGMA temp_store = MEMORY")
        
        global db_indexes_created
        if not db_indexes_created:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_kehoach ON goi_thau(ke_hoach_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_kehoach_chudautu ON ke_hoach_lcnt(chu_dau_tu_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_thongtinmothau_goithau ON thong_tin_mo_thau(goi_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chudautu_latest ON chu_dau_tu(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nhathau_latest ON nha_thau(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_hopdong_chudautu ON hop_dong(chu_dau_tu_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_hopdong_nhathau ON hop_dong(nha_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_kehoach_latest ON ke_hoach_lcnt(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_latest ON goi_thau(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_nhathau ON goi_thau(nha_thau_trung_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_thongtinmothau_nhathau ON thong_tin_mo_thau(nha_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_hopdonggoithau_goithau ON hop_dong_goi_thau(goi_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_deletedrecords_lookup ON deleted_records(owner_id, deleted_at)")
            
            # Reverse lookup indexes for relationship tables
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithauchuyengia_chuyengia ON goi_thau_chuyen_gia(chuyen_gia_id)")
            
            # Compound indexes for sync queries
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chudautu_owner_updated ON chu_dau_tu(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_kehoach_owner_updated ON ke_hoach_lcnt(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_owner_updated ON goi_thau(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nhathau_owner_updated ON nha_thau(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chuyengia_owner_updated ON chuyen_gia(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_hopdong_owner_updated ON hop_dong(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_assignments_owner_updated ON phan_cong_nhan_su(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_paperstatus_owner_updated ON trang_thai_ho_so_giay(owner_id, updated_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_thongtinmothau_owner_updated ON thong_tin_mo_thau(owner_id, updated_at)")
            
            # [MỚI] Composite indexes tối ưu cho API phân trang (owner_id + is_latest)
            # Trước đây chỉ có index đơn, nay thêm index ghép để tránh table scan khi lọc đồng thời
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chudautu_owner_latest ON chu_dau_tu(owner_id, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_kehoach_owner_latest ON ke_hoach_lcnt(owner_id, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_owner_latest ON goi_thau(owner_id, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nhathau_owner_latest ON nha_thau(owner_id, is_latest)")
            
            # [MỚI] Composite indexes cho versioning queries (id_goc + phien_ban)
            # Tối ưu truy vấn tìm phiên bản mới nhất theo id_goc nhóm
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chudautu_goc_ver ON chu_dau_tu(id_goc, phien_ban)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_kehoach_goc_ver ON ke_hoach_lcnt(id_goc, phien_ban)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_goc_ver ON goi_thau(id_goc, phien_ban)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nhathau_goc_ver ON nha_thau(id_goc, phien_ban)")
            
            # [MỚI] Indexes cho bảng phân quyền nhân viên (ma_tran_phan_quyen)
            # Tạo index cho bảng ma_tran_phan_quyen nếu bảng tồn tại
            try:
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_matran_owner_empid ON ma_tran_phan_quyen(owner_id, emp_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_matran_owner_updated ON ma_tran_phan_quyen(owner_id, updated_at)")
            except Exception:
                pass  # Bảng chưa tồn tại, sẽ tạo khi ứng dụng khởi động
            
            # Indexes for organizations and members
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_thanhvientochuc_tochuc ON thanh_vien_to_chuc(to_chuc_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_tochuc_quanly ON to_chuc(quan_ly_id)")
            
            db_indexes_created = True
    except Exception as e:
        print(f"Error applying SQLite PRAGMAs or indexes: {e}")
    return conn

database.get_connection = optimized_get_connection
