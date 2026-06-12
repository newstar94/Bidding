import os
import sys
import sqlite3
import uuid
import random
from datetime import datetime, timedelta

# Setup paths so we can import from controllers and models
current_dir = os.path.dirname(os.path.abspath(__file__))
models_dir = os.path.join(current_dir, 'models')
controllers_dir = os.path.join(current_dir, 'controllers')

sys.path.insert(0, current_dir)
sys.path.append(models_dir)
sys.path.append(controllers_dir)

# Import migration function from app.py to ensure DB schema is fully up-to-date
from controllers.app import khoi_tao_va_di_tru_he_thong, hash_password

def clear_existing_data(conn):
    print("Xóa dữ liệu cũ trong các bảng...")
    cursor = conn.cursor()
    tables = [
        "deleted_records", "goi_thau_chuyen_gia", "thanh_vien_to_chuc", "to_chuc",
        "thong_tin_mo_thau", "trang_thai_ho_so_giay", "phan_cong_nhan_su",
        "hop_dong_goi_thau", "hop_dong", "chuyen_gia", "goi_thau",
        "nha_thau", "ke_hoach_lcnt", "chu_dau_tu", "tai_khoan", "goi_dich_vu"
    ]
    for table in tables:
        try:
            cursor.execute(f"DELETE FROM {table}")
        except Exception as e:
            print(f"Lưu ý khi xóa bảng {table}: {e}")
    conn.commit()

def generate_seeds():
    # 1. Run migration to ensure all tables exist
    print("Khởi tạo cấu trúc database...")
    khoi_tao_va_di_tru_he_thong()
    
    db_path = os.path.join(models_dir, 'bidding.db')
    conn = sqlite3.connect(db_path)
    clear_existing_data(conn)
    
    cursor = conn.cursor()
    now = int(datetime.utcnow().timestamp())
    
    print("Bắt đầu tạo dữ liệu mẫu...")
    
    # ----------------------------------------------------
    # 1. GOI DICH VU (SaaS Subscription Plans)
    # ----------------------------------------------------
    goi_dich_vu_data = [
        ("silver", "Gói Bạc (Silver)", 500000.0, 5, "Gói cơ bản cho doanh nghiệp nhỏ"),
        ("gold", "Gói Vàng (Gold)", 1500000.0, 15, "Gói tiêu chuẩn cho doanh nghiệp vừa"),
        ("diamond", "Gói Kim Cương (Diamond)", 5000000.0, 50, "Gói cao cấp cho tập đoàn lớn"),
        ("platinum", "Gói Bạch Kim (Platinum)", 10000000.0, 200, "Gói đặc biệt tích hợp sâu"),
        ("trial", "Gói Dùng Thử", 0.0, 2, "Gói trải nghiệm miễn phí 14 ngày")
    ]
    for gdv in goi_dich_vu_data:
        cursor.execute("""
            INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (gdv[0], gdv[1], gdv[2], gdv[3], gdv[4], now - 30*24*3600, now))
    
    # ----------------------------------------------------
    # 2. TO CHUC (Organizations)
    # ----------------------------------------------------
    to_chuc_ids = [f"tc-{uuid.uuid4()}" for _ in range(3)]
    to_chuc_names = [
        "Tập đoàn Xây dựng và Phát triển Hạ tầng Đông Á",
        "Tổng Công ty Công nghệ thông tin & Viễn thông Việt Nam",
        "Công ty Cổ phần Tư vấn Thiết kế và Đầu tư BiddingFlow"
    ]
    
    # ----------------------------------------------------
    # 3. TAI KHOAN (Accounts / Users)
    # ----------------------------------------------------
    tai_khoan_names = [
        ("tuanduong", "Vy Tuấn Dương", "tuanduong51794@gmail.com", "super_admin", "diamond"),
        ("hoangnam", "Nguyễn Hoàng Nam", "namnh@dongajsc.vn", "manager", "gold"),
        ("minhthu", "Trần Minh Thư", "thutm@dongajsc.vn", "employee", "gold"),
        ("anhduc", "Phạm Anh Đức", "ducpa@dongajsc.vn", "employee", "gold"),
        ("quynhchi", "Lê Quỳnh Chi", "chilq@dongajsc.vn", "employee", "silver"),
        ("trungkien", "Đỗ Trung Kiên", "kientd@biddingflow.vn", "super_admin", "platinum"),
        ("phuongthao", "Hoàng Phương Thảo", "thaohp@biddingflow.vn", "manager", "platinum"),
        ("vietanh", "Bùi Việt Anh", "anhbv@biddingflow.vn", "employee", "platinum"),
        ("khanhly", "Nguyễn Khánh Ly", "lynk@biddingflow.vn", "employee", "platinum"),
        ("duyhung", "Vũ Duy Hưng", "hungvd@biddingflow.vn", "employee", "silver")
    ]
    
    tai_khoan_ids = []
    user_map = {} # username -> user_id
    for idx, tk in enumerate(tai_khoan_names):
        u_id = f"user-{uuid.uuid4()}"
        tai_khoan_ids.append(u_id)
        user_map[tk[0]] = u_id
        
        # Thiết lập tên tổ chức. Với minhthu, ta cho thuộc cả 3 tổ chức
        if tk[0] == "minhthu":
            org_names_str = ", ".join(to_chuc_names)
        else:
            org_names_str = to_chuc_names[idx % len(to_chuc_names)]
            
        cursor.execute("""
            INSERT INTO tai_khoan (
                id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email, token_phien, 
                anh_dai_dien, goi_dich_vu_id, ngay_bat_dau_goi, ngay_het_han_goi, 
                han_su_dung_token, thong_tin_thiet_bi_cuoi, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            u_id, tk[0], hash_password("123456abc"), tk[1], tk[3], tk[2], "",
            "", tk[4], "2026-01-01", "2027-01-01", 
            "2026-12-31T23:59:59", "Chrome / Windows 11",
            now - 20*24*3600, now
        ))
        
    # Populate to_chuc & thanh_vien_to_chuc
    for idx, tc_id in enumerate(to_chuc_ids):
        # Manage assigned to one of super_admin / manager
        mngr_id = tai_khoan_ids[idx * 3 % len(tai_khoan_ids)]
        cursor.execute("""
            INSERT INTO to_chuc (id, ten_to_chuc, quan_ly_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (tc_id, to_chuc_names[idx], mngr_id, now - 20*24*3600, now))
        
        # Add members
        for u_idx, u_id in enumerate(tai_khoan_ids):
            if u_idx % len(to_chuc_ids) == idx:
                cursor.execute("""
                    INSERT INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (u_id, tc_id, "admin" if u_idx < 3 else "member", now - 20*24*3600, now))

    # Thêm minhthu vào cả 2 tổ chức còn lại
    special_user_id = user_map["minhthu"]
    for extra_tc_idx in [0, 1]:
        extra_tc_id = to_chuc_ids[extra_tc_idx]
        cursor.execute("""
            INSERT INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (special_user_id, extra_tc_id, "member", now - 20*24*3600, now))

    # Định nghĩa danh sách tài khoản theo từng tổ chức
    org_members = {
        to_chuc_names[0]: ["tuanduong", "phuongthao", "anhduc", "duyhung", "minhthu"],
        to_chuc_names[1]: ["hoangnam", "quynhchi", "vietanh", "minhthu"],
        to_chuc_names[2]: ["trungkien", "khanhly", "minhthu"]
    }

    # ----------------------------------------------------
    # TẠO DỮ LIỆU CHO MỖI TỔ CHỨC
    # ----------------------------------------------------
    for org_idx, org_name in enumerate(to_chuc_names):
        print(f"-> Tạo dữ liệu cho tổ chức: {org_name}")
        org_id = to_chuc_ids[org_idx]
        
        # 4. CHU DAU TU (Investors) - 5 per org
        chu_dau_tu_templates = [
            ("Sở Giao thông Vận tải", "01001001", "Số 2 Phùng Hưng, Hà Đông", "02433546", "sgtvt"),
            ("Sở Giáo dục và Đào tạo", "03002002", "66-68 Lê Thánh Tôn, Quận 1", "02838291", "sgddt"),
            ("Ban Quản lý Dự án Đầu tư Xây dựng", "57003003", "Phường Hồng Hà, TP. Hạ Long", "02033835", "pmu"),
            ("Tổng Công ty Điện lực", "01001004", "11 Cửa Bắc, Ba Đình", "0246694", "evn"),
            ("Bệnh viện Đa khoa Trung ương", "18005005", "315 Nguyễn Văn Linh, Ninh Kiều", "02923820", "hospital")
        ]
        
        chu_dau_tu_ids = []
        for cdt_idx, (name_prefix, tax_prefix, address, phone_prefix, email_prefix) in enumerate(chu_dau_tu_templates):
            cdt_id = f"cdt-{uuid.uuid4()}"
            chu_dau_tu_ids.append(cdt_id)
            full_name = f"{name_prefix} {org_name.split(' ')[-1]} (CĐt {cdt_idx + 1})"
            
            cursor.execute("""
                INSERT INTO chu_dau_tu (
                    id, owner_id, id_goc, phien_ban, is_latest, ma_chu_dau_tu, ten_chu_dau_tu, 
                    ma_so_thue, chuc_vu_nguoi_dung_dau, nguoi_ky_quyet_dinh, chuc_vu_nguoi_ky, 
                    danh_xung, dia_chi, so_dien_thoai, so_tai_khoan, noi_mo_tai_khoan, email, ma_qhns, co_quan_chu_quan, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                cdt_id, org_id, cdt_id, "00", 1, f"CDT-{org_idx * 10 + cdt_idx}", full_name,
                f"{tax_prefix}{cdt_idx}", "Giám đốc", "Nguyễn Văn Đại Diện", "Giám đốc",
                "Ông", address, f"{phone_prefix}{cdt_idx}", f"11002200{org_idx}{cdt_idx}", 
                "Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)", 
                f"{email_prefix}_{org_idx}@vietnam.gov.vn", f"QHNS-{org_idx}{cdt_idx}", "Ủy ban Nhân dân", now - 15*24*3600, now
            ))

        # 5. KÊ HOẠCH LỰA CHỌN NHÀ THẦU - 10 per org
        ke_hoach_templates = [
            ("Phát triển hạ tầng số và nâng cấp trung tâm dữ liệu", 12000000000.0, "Ngân sách Nhà nước"),
            ("Xây dựng trường THPT chuyên chất lượng cao - Giai đoạn 2", 45000000000.0, "Vốn đầu tư công tập trung"),
            ("Cung cấp lắp đặt hệ thống điều hòa thông gió tòa nhà văn phòng", 8500000000.0, "Vốn sự nghiệp"),
            ("Mua sắm trang thiết bị dạy học số hóa cho các trường tiểu học", 5000000000.0, "Ngân sách tự chủ"),
            ("Cải tạo nâng cấp tuyến đường liên tỉnh kết nối các khu công nghiệp", 150000000000.0, "Vốn trái phiếu"),
            ("Lắp đặt trạm biến áp và đường dây truyền tải điện", 35000000000.0, "Vốn đầu tư phát triển"),
            ("Hệ thống camera giám sát giao thông thông minh và xử phạt nguội", 18000000000.0, "Vốn xã hội hóa"),
            ("Số hóa học bạ và xây dựng trục dữ liệu liên thông sở ban ngành", 6200000000.0, "Vốn chương trình mục tiêu"),
            ("Xây dựng khu điều trị kỹ thuật cao bệnh viện trung tâm", 98000000000.0, "Vốn vay ưu đãi ODA"),
            ("Hệ thống quản lý đấu thầu BiddingFlow Enterprise", 3200000000.0, "Vốn tự có")
        ]
        
        ke_hoach_ids = []
        for kh_idx, (kh_name, kh_budget, kh_source) in enumerate(ke_hoach_templates):
            kh_id = f"kh-{uuid.uuid4()}"
            ke_hoach_ids.append(kh_id)
            cdt_id = chu_dau_tu_ids[kh_idx % len(chu_dau_tu_ids)]
            full_kh_name = f"Kế hoạch: {kh_name} - {org_name.split(' ')[-1]}"
            qd_ngay = (datetime.now() - timedelta(days=90 - kh_idx * 5)).strftime("%Y-%m-%d")
            
            cursor.execute("""
                INSERT INTO ke_hoach_lcnt (
                    id, owner_id, id_goc, ma_ke_hoach, ma_du_an, phien_ban, is_latest, 
                    ten_ke_hoach, ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id, 
                    tong_muc_dau_tu, ngay_phe_duyet, quyet_dinh_phe_duyet, thoi_gian_dang_tai, 
                    cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien, nguon_von, 
                    thoi_gian_du_an, dia_diem_quy_mo, thong_tin_khac, so_qd_phe_duyet_du_an, 
                    ngay_qd_phe_duyet_du_an, co_quan_phe_duyet_du_an, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                kh_id, org_id, kh_id, f"KH-{org_idx * 100 + kh_idx}", f"DA-{org_idx * 1000 + kh_idx}", "00", 1,
                full_kh_name, f"Dự án đầu tư {full_kh_name}", "Mua sắm hàng hóa / Xây lắp", cdt_id,
                kh_budget, qd_ngay, f"{100 + kh_idx}/QĐ-UBND", qd_ngay,
                "Rà soát quy hoạch đất đai", "Không áp dụng giải phóng mặt bằng", "Chưa đủ điều kiện giai đoạn tiếp theo", kh_source,
                "24 tháng", "Địa bàn tỉnh/Thành phố", "Chi tiết đính kèm hồ sơ quyết định",
                f"{50 + kh_idx}/QĐ-SĐT", qd_ngay, "Ủy ban nhân dân", now - 40*24*3600, now
            ))

        # 6. NHA THAU (Bidders) - 15 per org
        nha_thau_names = [
            "Tổng Công ty Xây dựng Trường Sơn", "Công ty Cổ phần Tập đoàn PC1", "Công ty Cổ phần Công nghệ Sao Bắc Đẩu",
            "Công ty Cổ phần Viễn thông FPT", "Tập đoàn Công nghệ CMC", "Công ty Cổ phần Tập đoàn Đèo Cả",
            "Tổng Công ty Cổ phần Công trình Viettel", "Công ty Cổ phần Tập đoàn Xây dựng Hòa Bình",
            "Công ty Cổ phần Đầu tư và Phát triển Công nghệ Việt Hưng", "Công ty Cổ phần Thiết bị Y tế Phương Đông",
            "Tập đoàn Xây dựng Miền Trung", "Công ty Cổ phần Đầu tư và Phát triển Xây dựng 17",
            "Công ty TNHH Giải pháp Phần mềm Trí Tuệ - ISOFT", "Công ty Cổ phần Tư vấn và Đầu tư Xây dựng Giao thông 8",
            "Tổng công ty 319 Bộ Quốc phòng"
        ]
        
        nha_thau_ids = []
        for nt_idx, nt_name in enumerate(nha_thau_names):
            nt_id = f"nt-{uuid.uuid4()}"
            nha_thau_ids.append(nt_id)
            full_nt_name = f"{nt_name} (CN {org_idx + 1})"
            
            cursor.execute("""
                INSERT INTO nha_thau (
                    id, owner_id, id_goc, phien_ban, is_latest, ma_nha_thau, ten_nha_thau, 
                    loai_nha_thau, thanh_vien_lien_danh, ma_so_thue, nguoi_dai_dien, 
                    danh_xung, so_dien_thoai, email, dia_chi, so_tai_khoan, noi_mo_tai_khoan, ma_ngan_hang, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                nt_id, org_id, nt_id, "00", 1, f"NT-{org_idx * 100 + nt_idx}", full_nt_name,
                "Doanh nghiệp tư nhân / Cổ phần", "Không liên danh", f"01002008{org_idx}{nt_idx}", "Nguyễn Văn Đại Diện",
                "Ông", "024356567", f"contact_{org_idx}_{nt_idx}@nha_thau.vn", f"Số {nt_idx + 1} Đường Giải Phóng", 
                f"999000111{org_idx}{nt_idx}", "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)", "BIDV",
                now - 15*24*3600, now
            ))

        # 7. CHUYEN GIA (Experts) - 8 per org
        chuyen_gia_names = [
            "TS. Nguyễn Hoàng Giang", "PGS.TS. Trần Thị Hồng", "ThS. Bùi Quang Huy", "KTS. Lê Anh Tuấn",
            "KS. Phạm Thành Nam", "ThS. Hoàng Ngọc Hà", "TS. Vũ Việt Dũng", "KS. Đỗ Duy Mạnh"
        ]
        
        chuyen_gia_ids = []
        for cg_idx, cg_name in enumerate(chuyen_gia_names):
            cg_id = f"cg-{uuid.uuid4()}"
            chuyen_gia_ids.append(cg_id)
            
            cursor.execute("""
                INSERT INTO chuyen_gia (
                    id, owner_id, ho_ten, so_chung_chi, ngay_cap_chung_chi, don_vi_cap_chung_chi, 
                    so_cccd, ngay_cap_cccd, noi_cap_cccd, anh_chung_chi, ten_anh_chung_chi, anh_chu_ky, ten_anh_chu_ky, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                cg_id, org_id, f"{cg_name} ({org_name.split(' ')[-1]})", f"CC-LCNT-{org_idx * 1000 + cg_idx}", "2024-05-15", 
                "Cục Quản lý Đấu thầu - Bộ Kế hoạch và Đầu tư", f"00109200{org_idx}{cg_idx}", "2021-08-20", 
                "Cục Cảnh sát Quản lý hành chính về trật tự xã hội", f"uploads/chuyen_gia/cert_{org_idx}_{cg_idx}.png", 
                "chung_chi_hanh_nghe.png", f"uploads/chuyen_gia/sig_{org_idx}_{cg_idx}.png", "chu_ky_so.png",
                now - 15*24*3600, now
            ))

        # 8. TRANG THAI HO SO GIAY (Document physical statuses)
        status_list = [
            ("Mới nhận", "#007bff"),
            ("Đang thẩm định", "#ffc107"),
            ("Chờ ký duyệt", "#28a745"),
            ("Đã lưu trữ", "#6c757d"),
            ("Yêu cầu bổ sung", "#dc3545")
        ]
        for st_idx, st in enumerate(status_list):
            st_id = f"tm-{uuid.uuid4()}"
            cursor.execute("""
                INSERT INTO trang_thai_ho_so_giay (id, owner_id, org_id, name, color, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (st_id, org_id, org_id, st[0], st[1], now - 15*24*3600, now))

        # 9. GÓI THẦU (Bidding Packages) - 40 per org
        linh_vuc_list = ["Xây lắp", "Mua sắm hàng hóa", "Tư vấn", "Phi tư vấn", "Hỗn hợp"]
        loai_hd_list = ["Trọn gói", "Đơn giá cố định", "Đơn giá điều chỉnh", "Thời gian"]
        hinh_thuc_list = ["Đấu thầu rộng rãi", "Chỉ định thầu", "Chào hàng cạnh tranh", "Mua sắm trực tiếp"]
        phuong_thuc_list = ["Một giai đoạn một túi hồ sơ", "Một giai đoạn hai túi hồ sơ", "Hai giai đoạn hai túi hồ sơ"]
        trang_thai_tuy_chon = ["Đang chuẩn bị", "Đang đấu thầu", "Đang đánh giá", "Đã phê duyệt kết quả", "Đã ký hợp đồng", "Hủy thầu"]
        
        # Mapped members for assignment
        members = org_members[org_name]
        
        for gt_idx in range(40):
            gt_id = f"gt-{uuid.uuid4()}"
            kh_id = ke_hoach_ids[gt_idx % len(ke_hoach_ids)]
            
            # Date flow logic
            base_days = 120 - (gt_idx * 3)
            ngay_tao = datetime.now() - timedelta(days=base_days)
            ngay_duyet_kh = ngay_tao + timedelta(days=5)
            ngay_dang_tai = ngay_duyet_kh + timedelta(days=5)
            ngay_dong_thau = ngay_dang_tai + timedelta(days=20)
            ngay_mo_thau = ngay_dong_thau + timedelta(hours=1)
            ngay_phe_duyet_kq = ngay_mo_thau + timedelta(days=15)
            ngay_ky_hd = ngay_phe_duyet_kq + timedelta(days=10)
            
            # Status distribution
            trang_thai = trang_thai_tuy_chon[gt_idx % len(trang_thai_tuy_chon)]
            
            gia_goi_thau = random.randint(5, 50) * 200000000.0 # 1 Billion to 10 Billion VND
            
            nha_thau_trung_id = None
            gia_trung_thau = None
            ngay_qd_kq_str = ""
            so_qd_kq_str = ""
            
            if trang_thai in ["Đã phê duyệt kết quả", "Đã ký hợp đồng"]:
                nha_thau_trung_id = nha_thau_ids[gt_idx % len(nha_thau_ids)]
                discount_pct = random.uniform(0.01, 0.05)
                gia_trung_thau = round(gia_goi_thau * (1 - discount_pct), 2)
                ngay_qd_kq_str = ngay_phe_duyet_kq.strftime("%Y-%m-%d")
                so_qd_kq_str = f"{200 + gt_idx}/QĐ-{org_idx}-KQ"
                
            thoi_gian_dong_thau_str = ngay_dong_thau.strftime("%Y-%m-%dT%H:%M:%S")
            thoi_gian_mo_thau_str = ngay_mo_thau.strftime("%Y-%m-%dT%H:%M:%S")
            thoi_gian_dang_tai_str = ngay_dang_tai.strftime("%Y-%m-%d")
            
            cursor.execute("""
                INSERT INTO goi_thau (
                    id, owner_id, id_goc, ma_goi_thau, phien_ban, is_latest, ke_hoach_id, 
                    ten_goi_thau, gia_goi_thau, loai_hop_dong, hinh_thuc_lua_chon, phuong_thuc_lua_chon, 
                    thoi_gian_thuc_hien, nguon_von, nha_thau_trung_thau_id, gia_trung_thau, linh_vuc, 
                    tuy_chon_mua_them, thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, phan_lo, phan_lo_list, 
                    tuy_chon_mua_them_list, thoi_gian_dang_tai, thoi_gian_dong_thau, thoi_gian_mo_thau, 
                    chuyen_gia_list, tham_dinh_list, so_quyet_dinh, ngay_quyet_dinh, so_quyet_dinh_ket_qua, 
                    ngay_quyet_dinh_ket_qua, gia_han_list, yeu_cau_lam_ro_list, tra_loi_lam_ro_list, 
                    thoi_gian_goi_thau, thoi_gian_hop_dong, awarded_phan_lo_list, gia_tri_dam_bao_du_thau, 
                    hieu_luc_hsdt, hieu_luc_dam_bao_du_thau, danh_gia_hsdt_metadata, trang_thai, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                gt_id, org_id, gt_id, f"GT-{org_idx * 1000 + gt_idx}", "00", 1, kh_id,
                f"Gói thầu số {gt_idx + 1}: {ke_hoach_templates[gt_idx % len(ke_hoach_templates)][0]} ({org_name.split(' ')[-1]})",
                gia_goi_thau, loai_hd_list[gt_idx % len(loai_hd_list)], hinh_thuc_list[gt_idx % len(hinh_thuc_list)], 
                phuong_thuc_list[gt_idx % len(phuong_thuc_list)], "180 ngày", ke_hoach_templates[gt_idx % len(ke_hoach_templates)][2],
                nha_thau_trung_id, gia_trung_thau, linh_vuc_list[gt_idx % len(linh_vuc_list)],
                "Không", "Quý I/2026", "2026-02-15", "Không", "[]", "[]",
                thoi_gian_dang_tai_str, thoi_gian_dong_thau_str, thoi_gian_mo_thau_str,
                "[]", "[]", f"{150 + gt_idx}/QĐ-{org_idx}-PD", ngay_duyet_kh.strftime("%Y-%m-%d"),
                so_qd_kq_str, ngay_qd_kq_str, "[]", "[]", "[]",
                "180 ngày", "24 tháng", "[]", round(gia_goi_thau * 0.015, 2),
                90, 120, "{}", trang_thai, int(ngay_tao.timestamp()), now
            ))
            
            # Select 2 experts for this package
            selected_cg_ids = random.sample(chuyen_gia_ids, 2)
            for cg_id in selected_cg_ids:
                cursor.execute("""
                    INSERT INTO goi_thau_chuyen_gia (goi_thau_id, chuyen_gia_id, created_at)
                    VALUES (?, ?, ?)
                """, (gt_id, cg_id, now))

            # Bid proposals (`thong_tin_mo_thau`)
            if trang_thai not in ["Đang chuẩn bị", "Đang đấu thầu"]:
                participating_contractors = random.sample(nha_thau_ids, 3)
                for c_idx, nt_id in enumerate(participating_contractors):
                    cursor.execute("SELECT ten_nha_thau FROM nha_thau WHERE id = ?", (nt_id,))
                    nt_name = cursor.fetchone()[0]
                    
                    if nt_id == nha_thau_trung_id:
                        gia_du_thau = gia_trung_thau
                        conclusion = "Trúng thầu"
                        valid_tech = "Đạt"
                        valid_cap = "Đạt"
                        valid_legal = "Đạt"
                    else:
                        gia_du_thau = round(gia_goi_thau * random.uniform(0.96, 1.05), 2)
                        conclusion = "Trượt thầu"
                        valid_tech = "Đạt" if c_idx == 1 else "Không đạt"
                        valid_cap = "Đạt"
                        valid_legal = "Đạt"
                    
                    cursor.execute("""
                        INSERT INTO thong_tin_mo_thau (
                            id, owner_id, goi_thau_id, nha_thau_id, ma_phan_lo, ten_phan_lo, ma_dinh_danh, 
                            gia_du_thau, dam_bao_du_thau, hieu_luc_dam_bao, hieu_luc_hsdxt, ty_le_giam_gia, 
                            gia_sau_giam_gia, hieu_luc_hsdt, gia_tri_dam_bao, hieu_luc_bao_dam_ngay, 
                            thoi_gian_thuc_hien, ten_nha_thau, loai_nha_thau, thanh_vien_lien_danh, 
                            danh_gia_hop_le, danh_gia_nang_luc, danh_gia_ky_thuat, danh_gia_tai_chinh, 
                            danh_gia_ket_luan, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        f"ttmt-{uuid.uuid4()}", org_id, gt_id, nt_id, "PL-01", "Hạng mục chính", f"DD-{org_idx}-{gt_idx}-{c_idx}",
                        gia_du_thau, round(gia_du_thau * 0.015, 2), "120 ngày", "90 ngày", 0.0,
                        gia_du_thau, 90, round(gia_du_thau * 0.015, 2), 120,
                        "180 ngày", nt_name, "Doanh nghiệp tư nhân", "Không liên danh",
                        valid_legal, valid_cap, valid_tech, "Đạt", conclusion, now - 10*24*3600, now
                    ))
                    
            # Contract (`hop_dong`)
            if trang_thai == "Đã ký hợp đồng" and nha_thau_trung_id:
                cursor.execute("SELECT chu_dau_tu_id FROM ke_hoach_lcnt WHERE id = ?", (kh_id,))
                cdt_id_db = cursor.fetchone()[0]
                
                hd_id = f"hd-{uuid.uuid4()}"
                
                cursor.execute("""
                    INSERT INTO hop_dong (
                        id, owner_id, ten_hop_dong, so_hop_dong, ngay_ky, chu_dau_tu_id, nha_thau_id, 
                        gia_tri, loai_hop_dong, thoi_gian_thuc_hien, trang_thai_ho_so, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    hd_id, org_id, f"Hợp đồng kinh tế: Gói thầu số {gt_idx + 1} ({org_name.split(' ')[-1]})", f"{50 + gt_idx}/HĐ-{org_idx}",
                    ngay_ky_hd.strftime("%Y-%m-%d"), cdt_id_db, nha_thau_trung_id,
                    gia_trung_thau, loai_hd_list[gt_idx % len(loai_hd_list)], "180 ngày",
                    "Đã ký kết", int(ngay_ky_hd.timestamp()), now
                ))
                
                cursor.execute("""
                    INSERT INTO hop_dong_goi_thau (hop_dong_id, goi_thau_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                """, (hd_id, gt_id, now, now))
                
                # Assign contract directly to the same staff member
                # Let's pick staff round-robin from organization members
                assigned_username = members[gt_idx % len(members)]
                assigned_emp_id = user_map[assigned_username]
                cursor.execute("""
                    INSERT INTO phan_cong_nhan_su (id, owner_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (f"asm-{uuid.uuid4()}", org_id, assigned_emp_id, hd_id, "hopdong", now - 10*24*3600, now))

            # Assign package to the employee (round-robin)
            assigned_username = members[gt_idx % len(members)]
            assigned_emp_id = user_map[assigned_username]
            cursor.execute("""
                INSERT INTO phan_cong_nhan_su (id, owner_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (f"asm-{uuid.uuid4()}", org_id, assigned_emp_id, gt_id, "goithau", now - 10*24*3600, now))
            
    conn.commit()
    
    # ----------------------------------------------------
    # IN THÔNG TIN THỐNG KÊ ĐỂ KIỂM TRA
    # ----------------------------------------------------
    print("\n--- THỐNG KÊ DỮ LIỆU ĐÃ TẠO ---")
    
    for idx, org_name in enumerate(to_chuc_names):
        org_id = to_chuc_ids[idx]
        print(f"\nTổ chức: {org_name}")
        cursor.execute("SELECT COUNT(*) FROM chu_dau_tu WHERE owner_id = ?", (org_id,))
        print(f"  - Chủ đầu tư: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM ke_hoach_lcnt WHERE owner_id = ?", (org_id,))
        print(f"  - Kế hoạch: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM nha_thau WHERE owner_id = ?", (org_id,))
        print(f"  - Nhà thầu: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM chuyen_gia WHERE owner_id = ?", (org_id,))
        print(f"  - Chuyên gia: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM goi_thau WHERE owner_id = ?", (org_id,))
        print(f"  - Gói thầu: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM hop_dong WHERE owner_id = ?", (org_id,))
        print(f"  - Hợp đồng: {cursor.fetchone()[0]}")
        
    print("\n--- THỐNG KÊ PHÂN CÔNG THEO TÀI KHOẢN ---")
    for username, u_id in user_map.items():
        cursor.execute("SELECT COUNT(*) FROM phan_cong_nhan_su WHERE id_nhan_vien = ? AND loai_doi_tuong = 'goithau'", (u_id,))
        pkg_cnt = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM phan_cong_nhan_su WHERE id_nhan_vien = ? AND loai_doi_tuong = 'hopdong'", (u_id,))
        con_cnt = cursor.fetchone()[0]
        print(f"  - Tài khoản {username}: Phân công {pkg_cnt} gói thầu, {con_cnt} hợp đồng")
        
    conn.close()
    print("\nHoàn tất tạo dữ liệu mẫu thành công!")

if __name__ == "__main__":
    generate_seeds()
