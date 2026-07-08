# Cau truc co so du lieu Bidding

Tai lieu nay mo ta cau truc DB hien tai dua tren:

- Schema ung dung: `backend/helpers_py/schema.py`
- File SQLite thuc te: `models/bidding.db`
- Cach xay dung context xuat Word: `backend/services/docx_service.py`, `backend/routes/routes_docx.py`

Thoi diem kiem tra: 2026-07-08.

## Tong quan hien trang du lieu

DB hien tai gan nhu la trang thai khoi tao moi. Cac bang nghiep vu chinh chua co dong du lieu.

| Bang | So dong hien tai | Vai tro |
|---|---:|---|
| `goi_dich_vu` | 3 | Goi dich vu he thong |
| `tai_khoan` | 1 | Tai khoan nguoi dung |
| `to_chuc` | 1 | To chuc/owner |
| `thanh_vien_to_chuc` | 1 | Lien ket user - to chuc |
| `sync_metadata` | 6 | Trang thai dong bo |
| `audit_log` | 2 | Nhat ky he thong |
| `chu_dau_tu` | 0 | Chu dau tu |
| `ke_hoach_lcnt` | 0 | Ke hoach LCNT |
| `goi_thau` | 0 | Goi thau |
| `nha_thau` | 0 | Danh muc nha thau |
| `thong_tin_mo_thau` | 0 | Snapshot nha thau tham du/mo thau/danh gia |
| `chuyen_gia` | 0 | Danh muc chuyen gia |
| `hop_dong` | 0 | Hop dong |
| `cau_hinh_bien_word` | 374 | Cau hinh bien Word |

## Nhom thuc the

### Thuc the doc lap

Day la cac bang co ban, co the cau hinh nhu nguon du lieu truc tiep.

| Bang | Ten nghiep vu | Ghi chu |
|---|---|---|
| `chu_dau_tu` | Chu dau tu | Dung trong ke hoach, goi thau, hop dong |
| `ke_hoach_lcnt` | Ke hoach LCNT | Co danh sach cong viec JSON |
| `goi_thau` | Goi thau | Trung tam cua HSMT/mo thau/danh gia/ket qua |
| `nha_thau` | Danh muc nha thau | Thong tin goc cua nha thau |
| `thong_tin_mo_thau` | Thong tin mo thau/danh gia | Snapshot theo tung goi thau, nen dung cho nha thau tham du |
| `chuyen_gia` | Chuyen gia | Danh muc ca nhan |
| `hop_dong` | Hop dong | Co lien ket chu dau tu, nha thau, ke hoach |
| `to_chuc` | To chuc | Thong tin don vi su dung |
| `tai_khoan` | Tai khoan | Thong tin nguoi dung |

### Bang quan he nhieu-nhieu

| Bang | Quan he | Y nghia |
|---|---|---|
| `hop_dong_goi_thau` | `hop_dong` - `goi_thau` | Mot hop dong co the gan voi mot/nhieu goi thau |
| `goi_thau_chuyen_gia` | `goi_thau` - `chuyen_gia` | Gan to chuyen gia/to tham dinh cho goi thau |
| `thanh_vien_to_chuc` | `tai_khoan` - `to_chuc` | User thuoc to chuc |
| `phan_cong_nhan_su` | `tai_khoan` - doi tuong bat ky | Phan cong nhan su theo ke hoach/goi thau/... |

### Bang he thong

| Bang | Y nghia |
|---|---|
| `goi_dich_vu` | Goi dich vu/han muc |
| `trang_thai_ho_so_giay` | Trang thai ho so giay tuy bien |
| `cau_hinh_bien_word` | Cau hinh bien Word nguoi dung tao |
| `ma_tran_phan_quyen` | Ma tran phan quyen |
| `deleted_records` | Ban ghi da xoa de dong bo |
| `sync_metadata` | Version dong bo hien tai |
| `sync_mutations` | Chong lap mutation khi dong bo |
| `audit_log` | Nhat ky thao tac |

## Quan he chinh

```text
chu_dau_tu 1 -- n ke_hoach_lcnt
ke_hoach_lcnt 1 -- n goi_thau
goi_thau 1 -- n thong_tin_mo_thau
nha_thau 1 -- n thong_tin_mo_thau
nha_thau 1 -- n goi_thau thong qua goi_thau.nha_thau_trung_thau_id
chu_dau_tu 1 -- n hop_dong
nha_thau 1 -- n hop_dong
ke_hoach_lcnt 1 -- n hop_dong
hop_dong n -- n goi_thau thong qua hop_dong_goi_thau
goi_thau n -- n chuyen_gia thong qua goi_thau_chuyen_gia
tai_khoan n -- n to_chuc thong qua thanh_vien_to_chuc
```

## Cac cot JSON/danh sach can chu y

Cac cot nay luu trong DB dang `TEXT`, nhung ung dung parse thanh list/object khi dung.

| Bang | Cot | Kieu logic | Quan he |
|---|---|---|---|
| `tai_khoan` | `thong_tin_thiet_bi_cuoi` | Object JSON | Thong tin thiet bi cua user |
| `ke_hoach_lcnt` | `cv_da_thuc_hien` | List JSON | Danh sach cong viec da thuc hien cua ke hoach |
| `ke_hoach_lcnt` | `cv_khong_ap_dung` | List JSON | Danh sach cong viec khong ap dung LCNT |
| `ke_hoach_lcnt` | `cv_chua_du_dieu_kien` | List JSON | Danh sach cong viec chua du dieu kien LCNT |
| `nha_thau` | `thanh_vien_lien_danh` | List JSON | Thanh vien lien danh cua nha thau goc |
| `goi_thau` | `phan_lo_list` | List JSON | Danh sach phan lo cua goi thau |
| `goi_thau` | `awarded_phan_lo_list` | List JSON | Danh sach phan lo co ket qua/trung thau |
| `goi_thau` | `tuy_chon_mua_them_list` | List JSON | Danh sach tuy chon mua them |
| `goi_thau` | `gia_han_list` | List JSON | Danh sach gia han |
| `goi_thau` | `yeu_cau_lam_ro_list` | List JSON | Danh sach yeu cau lam ro |
| `goi_thau` | `tra_loi_lam_ro_list` | List JSON | Danh sach tra loi lam ro |
| `goi_thau` | `danh_gia_hsdt_metadata` | Object JSON | Metadata danh gia HSDT, ngay doi chieu... |
| `thong_tin_mo_thau` | `thanh_vien_lien_danh` | List JSON | Snapshot thanh vien lien danh tai thoi diem mo thau |

## Chi tiet tung bang

### `goi_dich_vu`

Loai: bang he thong doc lap.

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `ten_goi` | `TEXT` | Ten goi dich vu |
| `gia_ca` | `REAL` | Gia goi |
| `han_muc_nhan_su` | `INTEGER` | Han muc nhan su |
| `mo_ta` | `TEXT` | Mo ta |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `tai_khoan`

Loai: thuc the doc lap, co lien ket goi dich vu.

Quan he:

- `goi_dich_vu_id` -> `goi_dich_vu.id`, `ON DELETE SET NULL`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `ten_dang_nhap` | `TEXT UNIQUE` | Ten dang nhap |
| `mat_khau` | `TEXT` | Mat khau hash |
| `ho_ten` | `TEXT` | Ho ten |
| `vai_tro` | `TEXT` | Vai tro |
| `email` | `TEXT` | Email |
| `token_phien` | `TEXT` | Token phien |
| `anh_dai_dien` | `TEXT` | Anh dai dien |
| `goi_dich_vu_id` | `TEXT DEFAULT 'silver'` | FK goi dich vu |
| `ngay_bat_dau_goi` | `TEXT` | Ngay bat dau goi |
| `ngay_het_han_goi` | `TEXT` | Ngay het han goi |
| `han_su_dung_token` | `INTEGER` | Timestamp het han token |
| `thong_tin_thiet_bi_cuoi` | `TEXT` | Object JSON |
| `da_xac_minh` | `INTEGER DEFAULT 0` | Trang thai xac minh |
| `ma_xac_minh` | `TEXT` | Ma xac minh |
| `han_xac_minh` | `INTEGER` | Han ma xac minh |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `chu_dau_tu`

Loai: thuc the doc lap, co version.

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `id_goc` | `TEXT` | ID goc de gom version |
| `phien_ban` | `TEXT NOT NULL DEFAULT '00'` | Phien ban |
| `is_latest` | `INTEGER NOT NULL DEFAULT 1` | Ban moi nhat |
| `ma_chu_dau_tu` | `TEXT` | Ma chu dau tu |
| `ten_chu_dau_tu` | `TEXT NOT NULL` | Ten chu dau tu |
| `ten_viet_tat` | `TEXT` | Ten viet tat chu dau tu |
| `ma_so_thue` | `TEXT` | Ma so thue |
| `chuc_vu_nguoi_dung_dau` | `TEXT` | Chuc vu nguoi dung dau |
| `dai_dien_cdt` | `TEXT` | Dai dien chu dau tu |
| `chuc_vu_dai_dien` | `TEXT` | Chuc vu dai dien |
| `danh_xung` | `TEXT DEFAULT 'Ong'` | Danh xung |
| `dia_chi` | `TEXT` | Dia chi |
| `so_dien_thoai` | `TEXT` | Dien thoai |
| `so_tai_khoan` | `TEXT` | So tai khoan |
| `noi_mo_tai_khoan` | `TEXT` | Noi mo tai khoan |
| `email` | `TEXT` | Email |
| `ma_qhns` | `TEXT` | Ma QHNS |
| `co_quan_chu_quan` | `TEXT` | Co quan chu quan |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `ke_hoach_lcnt`

Loai: thuc the doc lap, co version, la cha cua `goi_thau`.

Quan he:

- `chu_dau_tu_id` -> `chu_dau_tu.id`, `ON DELETE SET NULL`
- `goi_thau.ke_hoach_id` tro ve bang nay, `ON DELETE CASCADE`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `id_goc` | `TEXT` | ID goc de gom version |
| `ma_ke_hoach` | `TEXT` | Ma ke hoach |
| `ma_du_an` | `TEXT` | Ma du an |
| `phien_ban` | `TEXT NOT NULL DEFAULT '00'` | Phien ban |
| `is_latest` | `INTEGER NOT NULL DEFAULT 1` | Ban moi nhat |
| `ten_ke_hoach` | `TEXT NOT NULL` | Ten ke hoach |
| `ten_du_an_du_toan` | `TEXT` | Ten du an/du toan |
| `loai_hinh_mua_sam` | `TEXT` | Loai hinh mua sam |
| `chu_dau_tu_id` | `TEXT` | FK chu dau tu |
| `tong_muc_dau_tu` | `REAL` | Tong muc dau tu |
| `is_tong_muc_tu_dong` | `INTEGER DEFAULT 0` | Co tinh tong tu dong |
| `ngay_phe_duyet` | `TEXT` | Ngay phe duyet |
| `quyet_dinh_phe_duyet` | `TEXT` | Quyet dinh phe duyet |
| `thoi_gian_dang_tai` | `TEXT` | Thoi gian dang tai |
| `cv_da_thuc_hien` | `TEXT` | List JSON cong viec da thuc hien |
| `cv_khong_ap_dung` | `TEXT` | List JSON cong viec khong ap dung |
| `cv_chua_du_dieu_kien` | `TEXT` | List JSON cong viec chua du dieu kien |
| `nguon_von` | `TEXT` | Nguon von |
| `thoi_gian_du_an` | `TEXT` | Thoi gian du an |
| `dia_diem_quy_mo` | `TEXT` | Dia diem/quy mo |
| `thong_tin_khac` | `TEXT` | Thong tin khac |
| `so_qd_phe_duyet_du_an` | `TEXT` | So QD phe duyet du an |
| `ngay_qd_phe_duyet_du_an` | `TEXT` | Ngay QD phe duyet du an |
| `co_quan_phe_duyet_du_an` | `TEXT` | Co quan phe duyet du an |
| `phe_duyet` | `TEXT` | Phe duyet |
| `ngay_trinh_du_toan` | `TEXT` | Ngay trinh du toan |
| `ngay_phe_duyet_du_toan` | `TEXT` | Ngay phe duyet du toan |
| `so_qd_phe_duyet_du_toan` | `TEXT` | So QD phe duyet du toan |
| `ngay_trinh_ke_hoach` | `TEXT` | Ngay trinh ke hoach |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

Danh sach JSON trong bang:

- `cv_da_thuc_hien`, `cv_khong_ap_dung`, `cv_chua_du_dieu_kien`: moi item thuong gom `ten_cong_viec`, `gia_tri` va cac truong lien quan neu UI bo sung.

### `nha_thau`

Loai: danh muc nha thau goc, co version.

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `id_goc` | `TEXT` | ID goc de gom version |
| `phien_ban` | `TEXT NOT NULL DEFAULT '00'` | Phien ban |
| `is_latest` | `INTEGER NOT NULL DEFAULT 1` | Ban moi nhat |
| `ma_nha_thau` | `TEXT` | Ma nha thau |
| `ten_nha_thau` | `TEXT NOT NULL` | Ten nha thau |
| `ten_viet_tat` | `TEXT` | Ten viet tat nha thau |
| `loai_nha_thau` | `TEXT` | Doc lap/lien danh |
| `thanh_vien_lien_danh` | `TEXT` | List JSON thanh vien lien danh |
| `ma_so_thue` | `TEXT` | Ma so thue |
| `nguoi_dai_dien` | `TEXT` | Nguoi dai dien |
| `danh_xung` | `TEXT DEFAULT 'Ong'` | Danh xung |
| `so_dien_thoai` | `TEXT` | Dien thoai |
| `email` | `TEXT` | Email |
| `dia_chi` | `TEXT` | Dia chi |
| `so_tai_khoan` | `TEXT` | So tai khoan |
| `noi_mo_tai_khoan` | `TEXT` | Noi mo tai khoan |
| `ma_ngan_hang` | `TEXT` | Ma ngan hang |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

Danh sach JSON trong bang:

- `thanh_vien_lien_danh`: danh sach thanh vien cua nha thau lien danh. Cac truong hay dung: `ten_thanh_vien`, `ma_so_thue`, `dia_chi`, `vai_tro`, `ty_le`.

### `goi_thau`

Loai: thuc the trung tam, co version, thuoc ke hoach.

Quan he:

- `ke_hoach_id` -> `ke_hoach_lcnt.id`, `ON DELETE CASCADE`
- `nha_thau_trung_thau_id` -> `nha_thau.id`, `ON DELETE SET NULL`
- `thong_tin_mo_thau.goi_thau_id` tro ve bang nay
- `goi_thau_chuyen_gia.goi_thau_id` tro ve bang nay
- `hop_dong_goi_thau.goi_thau_id` tro ve bang nay

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `id_goc` | `TEXT` | ID goc de gom version |
| `ma_goi_thau` | `TEXT` | Ma goi thau |
| `phien_ban` | `TEXT NOT NULL DEFAULT '00'` | Phien ban |
| `is_latest` | `INTEGER NOT NULL DEFAULT 1` | Ban moi nhat |
| `ke_hoach_id` | `TEXT` | FK ke hoach |
| `ten_goi_thau` | `TEXT NOT NULL` | Ten goi thau |
| `gia_goi_thau` | `REAL` | Gia goi thau |
| `loai_hop_dong` | `TEXT` | Loai hop dong |
| `hinh_thuc_lua_chon` | `TEXT` | Hinh thuc lua chon |
| `phuong_thuc_lua_chon` | `TEXT` | Phuong thuc lua chon |
| `thoi_gian_thuc_hien` | `TEXT` | Thoi gian thuc hien |
| `nguon_von` | `TEXT` | Nguon von |
| `nha_thau_trung_thau_id` | `TEXT` | FK nha thau trung cho goi khong chia lo |
| `gia_trung_thau` | `REAL` | Gia trung thau goi khong chia lo |
| `linh_vuc` | `TEXT` | Linh vuc |
| `tuy_chon_mua_them` | `TEXT DEFAULT 'Khong'` | Co tuy chon mua them |
| `thoi_gian_to_chuc` | `TEXT` | Thoi gian to chuc |
| `thoi_gian_bat_dau_to_chuc` | `TEXT` | Thoi gian bat dau to chuc |
| `phan_lo` | `TEXT DEFAULT 'Khong'` | Co chia phan lo |
| `phan_lo_list` | `TEXT` | List JSON phan lo |
| `tuy_chon_mua_them_list` | `TEXT` | List JSON tuy chon mua them |
| `thoi_gian_dang_tai` | `TEXT` | Thoi gian dang tai |
| `thoi_gian_dong_thau` | `TEXT` | Thoi gian dong thau |
| `thoi_gian_mo_thau` | `TEXT` | Thoi gian mo thau |
| `thoi_gian_mo_ehsdxtc` | `TEXT` | Thoi gian mo E-HSDXTC |
| `so_quyet_dinh` | `TEXT` | So quyet dinh |
| `ngay_quyet_dinh` | `TEXT` | Ngay quyet dinh |
| `so_quyet_dinh_ket_qua` | `TEXT` | So quyet dinh ket qua |
| `ngay_quyet_dinh_ket_qua` | `TEXT` | Ngay quyet dinh ket qua |
| `gia_han_list` | `TEXT` | List JSON gia han |
| `yeu_cau_lam_ro_list` | `TEXT` | List JSON yeu cau lam ro |
| `tra_loi_lam_ro_list` | `TEXT` | List JSON tra loi lam ro |
| `thoi_gian_goi_thau` | `TEXT` | Thoi gian goi thau |
| `thoi_gian_hop_dong` | `TEXT` | Thoi gian hop dong |
| `awarded_phan_lo_list` | `TEXT` | List JSON phan lo trung thau |
| `gia_tri_dam_bao_du_thau` | `REAL` | Gia tri dam bao du thau |
| `hieu_luc_hsdt` | `INTEGER` | Hieu luc HSDT |
| `hieu_luc_dam_bao_du_thau` | `INTEGER` | Hieu luc dam bao du thau |
| `danh_gia_hsdt_metadata` | `TEXT` | Object JSON metadata danh gia |
| `phuong_phap_danh_gia` | `TEXT` | Phuong phap danh gia |
| `trong_so_ky_thuat` | `INTEGER` | Trong so ky thuat |
| `ty_le_bao_dam_hop_dong` | `REAL` | Ty le bao dam hop dong |
| `is_thuoc` | `INTEGER DEFAULT 0` | Co phai goi thuoc |
| `trang_thai` | `TEXT CHECK(...)` | Trang thai goi thau |
| `yeu_cau_tham_dinh_hsmt` | `TEXT DEFAULT 'Khong'` | Co yeu cau tham dinh HSMT |
| `so_bao_cao_tham_dinh_hsmt` | `TEXT` | So bao cao tham dinh HSMT |
| `ngay_bao_cao_tham_dinh_hsmt` | `TEXT` | Ngay bao cao tham dinh HSMT |
| `so_to_trinh_hsmt` | `TEXT` | So to trinh HSMT |
| `ngay_trinh_hsmt` | `TEXT` | Ngay trinh HSMT |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

Danh sach JSON trong bang:

- `phan_lo_list`: danh sach phan lo cau hinh trong goi thau. Truong hay dung: `ma_phan_lo`, `ten_phan_lo`, `gia_tri_phan_lo`, `thoi_gian_goi_thau`, `thoi_gian_hop_dong`.
- `awarded_phan_lo_list`: danh sach phan lo co ket qua. Truong hay dung: `ma_phan_lo`, `ten_phan_lo`, `gia_trung_thau`, `nha_thau_trung_thau_id`, `ten_nha_thau_trung`, `thoi_gian_goi_thau`, `thoi_gian_hop_dong`.
- `tuy_chon_mua_them_list`: danh sach tuy chon mua them cua goi thau.
- `gia_han_list`: danh sach lan gia han, thuong phuc vu thoi diem dong/mo thau.
- `yeu_cau_lam_ro_list`: danh sach yeu cau lam ro HSMT/HSDT.
- `tra_loi_lam_ro_list`: danh sach tra loi lam ro.
- `danh_gia_hsdt_metadata`: object metadata danh gia, co the chua `ngayMoiDoiChieu`, `ngayDoiChieu`, hoac nhom `financial` voi quy trinh 1 giai do 2 tui.

### `chuyen_gia`

Loai: danh muc chuyen gia, co version.

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `id_goc` | `TEXT` | ID goc de gom version |
| `phien_ban` | `TEXT NOT NULL DEFAULT '00'` | Phien ban |
| `is_latest` | `INTEGER NOT NULL DEFAULT 1` | Ban moi nhat |
| `ho_ten` | `TEXT NOT NULL` | Ho ten |
| `so_chung_chi` | `TEXT` | So chung chi |
| `ngay_cap_chung_chi` | `TEXT` | Ngay cap chung chi |
| `don_vi_cap_chung_chi` | `TEXT` | Don vi cap chung chi |
| `so_cccd` | `TEXT` | So CCCD |
| `ngay_cap_cccd` | `TEXT` | Ngay cap CCCD |
| `noi_cap_cccd` | `TEXT` | Noi cap CCCD |
| `anh_chung_chi` | `TEXT` | Duong dan anh chung chi |
| `ten_anh_chung_chi` | `TEXT` | Ten file anh chung chi |
| `anh_chu_ky` | `TEXT` | Duong dan anh chu ky |
| `ten_anh_chu_ky` | `TEXT` | Ten file anh chu ky |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `hop_dong`

Loai: thuc the doc lap, co version, co the gan nhieu goi thau qua bang noi.

Quan he:

- `chu_dau_tu_id` -> `chu_dau_tu.id`, `ON DELETE SET NULL`
- `nha_thau_id` -> `nha_thau.id`, `ON DELETE SET NULL`
- `ke_hoach_id` -> `ke_hoach_lcnt.id`, `ON DELETE SET NULL`
- `hop_dong_goi_thau.hop_dong_id` tro ve bang nay

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `id_goc` | `TEXT` | ID goc de gom version |
| `phien_ban` | `TEXT NOT NULL DEFAULT '00'` | Phien ban |
| `is_latest` | `INTEGER NOT NULL DEFAULT 1` | Ban moi nhat |
| `ten_hop_dong` | `TEXT` | Ten hop dong |
| `so_hop_dong` | `TEXT` | So hop dong |
| `ngay_ky` | `TEXT` | Ngay ky |
| `chu_dau_tu_id` | `TEXT` | FK chu dau tu |
| `nha_thau_id` | `TEXT` | FK nha thau |
| `ke_hoach_id` | `TEXT` | FK ke hoach |
| `gia_tri` | `REAL` | Gia tri hop dong |
| `loai_hop_dong` | `TEXT` | Loai hop dong |
| `thoi_gian_thuc_hien` | `TEXT` | Thoi gian thuc hien |
| `trang_thai_ho_so` | `TEXT` | Trang thai ho so |
| `phan_loai` | `TEXT` | Phan loai hop dong |
| `co_qd_chi_dinh` | `INTEGER DEFAULT 0` | Co quyet dinh chi dinh |
| `so_qd_chi_dinh` | `TEXT` | So QD chi dinh |
| `ngay_qd_chi_dinh` | `TEXT` | Ngay QD chi dinh |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `hop_dong_goi_thau`

Loai: bang quan he nhieu-nhieu.

Khoa chinh ghep:

- `hop_dong_id`
- `goi_thau_id`

Quan he:

- `hop_dong_id` -> `hop_dong.id`, `ON DELETE CASCADE`
- `goi_thau_id` -> `goi_thau.id`, `ON DELETE CASCADE`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `hop_dong_id` | `TEXT` | FK hop dong |
| `goi_thau_id` | `TEXT` | FK goi thau |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `phan_cong_nhan_su`

Loai: bang quan he/phan cong.

Rang buoc:

- `UNIQUE(owner_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)`
- `id_nhan_vien` -> `tai_khoan.id`, `ON DELETE CASCADE`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `id_nhan_vien` | `TEXT NOT NULL` | FK tai khoan nhan vien |
| `id_muc_tieu` | `TEXT NOT NULL` | ID doi tuong duoc phan cong |
| `loai_doi_tuong` | `TEXT NOT NULL` | Loai doi tuong |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `trang_thai_ho_so_giay`

Loai: danh muc trang thai tuy bien.

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `org_id` | `TEXT` | ID to chuc |
| `name` | `TEXT NOT NULL` | Ten trang thai |
| `color` | `TEXT NOT NULL DEFAULT '#64748b'` | Mau |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `thong_tin_mo_thau`

Loai: snapshot nha thau tham du theo goi thau. Day la bang quan trong nhat cho cac danh sach nha thau trong bao cao.

Quan he:

- `goi_thau_id` -> `goi_thau.id`, `ON DELETE CASCADE`
- `nha_thau_id` -> `nha_thau.id`, `ON DELETE SET NULL`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `goi_thau_id` | `TEXT` | FK goi thau |
| `nha_thau_id` | `TEXT` | FK nha thau goc |
| `ma_phan_lo` | `TEXT` | Ma phan lo tham du |
| `ten_phan_lo` | `TEXT` | Ten phan lo tham du |
| `ma_dinh_danh` | `TEXT` | Ma dinh danh trong mo thau |
| `gia_du_thau` | `REAL` | Gia du thau |
| `dam_bao_du_thau` | `REAL` | Dam bao du thau |
| `hieu_luc_dam_bao` | `TEXT` | Hieu luc dam bao |
| `hieu_luc_hsdxt` | `TEXT` | Hieu luc HSDXT |
| `ty_le_giam_gia` | `REAL` | Ty le giam gia |
| `gia_sau_giam_gia` | `REAL` | Gia sau giam gia |
| `hieu_luc_hsdt` | `INTEGER` | Hieu luc HSDT |
| `gia_tri_dam_bao` | `REAL` | Gia tri dam bao |
| `hieu_luc_bao_dam_ngay` | `INTEGER` | Hieu luc bao dam theo ngay |
| `thoi_gian_thuc_hien` | `TEXT` | Thoi gian thuc hien |
| `ten_nha_thau` | `TEXT` | Ten nha thau snapshot |
| `loai_nha_thau` | `TEXT` | Loai nha thau snapshot |
| `thanh_vien_lien_danh` | `TEXT` | List JSON snapshot lien danh |
| `danh_gia_hop_le` | `TEXT` | Danh gia hop le |
| `danh_gia_nang_luc` | `TEXT` | Danh gia nang luc |
| `danh_gia_ky_thuat` | `TEXT` | Danh gia ky thuat |
| `danh_gia_tai_chinh` | `TEXT` | Danh gia tai chinh/xep hang |
| `danh_gia_ket_luan` | `TEXT` | Ket luan danh gia |
| `ly_do_truot` | `TEXT` | Ly do truot |
| `lam_ro_hop_le` | `TEXT` | Lam ro hop le |
| `lam_ro_nang_luc` | `TEXT` | Lam ro nang luc |
| `lam_ro_ky_thuat` | `TEXT` | Lam ro ky thuat |
| `lam_ro_tai_chinh` | `TEXT` | Lam ro tai chinh |
| `nguyen_nhan_khong_dat_hop_le` | `TEXT` | Nguyen nhan khong dat hop le |
| `nguyen_nhan_khong_dat_nang_luc` | `TEXT` | Nguyen nhan khong dat nang luc |
| `nguyen_nhan_khong_dat_ky_thuat` | `TEXT` | Nguyen nhan khong dat ky thuat |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

Ghi chu quan trong:

- Bang nay co tinh snapshot. Cac cot `ten_nha_thau`, `loai_nha_thau`, `thanh_vien_lien_danh` duoc luu lai tai thoi diem mo thau de ho so phap ly khong bi thay doi khi danh muc `nha_thau` cap nhat sau nay.
- Nen lay danh sach nha thau tham du/trung/truot/khong dat tu bang nay, khong lay truc tiep tu `nha_thau`.

### `to_chuc`

Loai: thuc the doc lap.

Quan he:

- `quan_ly_id` -> `tai_khoan.id`, `ON DELETE SET NULL`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `ten_to_chuc` | `TEXT UNIQUE NOT NULL` | Ten to chuc |
| `quan_ly_id` | `TEXT` | Tai khoan quan ly |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `thanh_vien_to_chuc`

Loai: bang quan he nhieu-nhieu.

Khoa chinh ghep:

- `user_id`
- `to_chuc_id`

Quan he:

- `user_id` -> `tai_khoan.id`, `ON DELETE CASCADE`
- `to_chuc_id` -> `to_chuc.id`, `ON DELETE CASCADE`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `user_id` | `TEXT NOT NULL` | FK tai khoan |
| `to_chuc_id` | `TEXT NOT NULL` | FK to chuc |
| `vai_tro_trong_to_chuc` | `TEXT` | Vai tro trong to chuc |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `goi_thau_chuyen_gia`

Loai: bang quan he nhieu-nhieu co thuoc tinh.

Khoa chinh ghep:

- `goi_thau_id`
- `chuyen_gia_id`
- `loai`

Quan he:

- `goi_thau_id` -> `goi_thau.id`, `ON DELETE CASCADE`
- `chuyen_gia_id` -> `chuyen_gia.id`, `ON DELETE CASCADE`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `goi_thau_id` | `TEXT NOT NULL` | FK goi thau |
| `chuyen_gia_id` | `TEXT NOT NULL` | FK chuyen gia |
| `loai` | `TEXT NOT NULL DEFAULT 'chuyen_gia'` | `chuyen_gia` hoac `tham_dinh` |
| `chuc_vu` | `TEXT` | Chuc vu trong to |
| `cong_viec` | `TEXT` | Cong viec duoc giao |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |

### `deleted_records`

Loai: bang he thong phuc vu dong bo/xoa mem.

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Khoa chinh |
| `table_name` | `TEXT NOT NULL` | Ten bang |
| `record_id` | `TEXT NOT NULL` | ID ban ghi bi xoa |
| `owner_id` | `TEXT NOT NULL` | Owner |
| `delete_version` | `INTEGER DEFAULT 0` | Version xoa |
| `deleted_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Thoi diem xoa |

### `cau_hinh_bien_word`

Loai: bang cau hinh nguoi dung.

Rang buoc:

- `UNIQUE(owner_id, ten_bien)`
- `UNIQUE(owner_id, source_table, source_column)`

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `ten_bien` | `TEXT NOT NULL` | Ten bien Word nguoi dung cau hinh |
| `source_table` | `TEXT NOT NULL` | Bang/nguon du lieu |
| `source_column` | `TEXT NOT NULL` | Cot/formula/nguon con |
| `mo_ta` | `TEXT` | Mo ta |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `ma_tran_phan_quyen`

Loai: bang phan quyen.

Cot:

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Khoa chinh |
| `owner_id` | `TEXT NOT NULL` | To chuc/user so huu |
| `owner_type` | `TEXT NOT NULL DEFAULT 'organization'` | Loai owner |
| `emp_id` | `TEXT NOT NULL` | ID nhan vien |
| `kehoach` | `TEXT` | Quyen ke hoach |
| `goithau` | `TEXT` | Quyen goi thau |
| `chudautu` | `TEXT` | Quyen chu dau tu |
| `nhathau` | `TEXT` | Quyen nha thau |
| `chuyengia` | `TEXT` | Quyen chuyen gia |
| `hopdong` | `TEXT` | Quyen hop dong |
| `thongtinmothau` | `TEXT` | Quyen thong tin mo thau |
| `sync_version` | `INTEGER DEFAULT 0` | Version dong bo |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `sync_metadata`

Loai: bang he thong dong bo.

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `owner_id` | `TEXT` | Owner |
| `current_version` | `INTEGER NOT NULL DEFAULT 0` | Version hien tai |
| `updated_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay cap nhat |

### `sync_mutations`

Loai: bang he thong dong bo.

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `owner_id` | `TEXT NOT NULL` | Owner |
| `client_mutation_id` | `TEXT NOT NULL` | ID mutation tu client |
| `response_json` | `TEXT` | Ket qua da tra |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |

### `audit_log`

Loai: bang nhat ky he thong.

| Cot | Kieu DB | Ghi chu |
|---|---|---|
| `id` | `INTEGER` | Khoa chinh |
| `actor_user_id` | `TEXT` | User thuc hien |
| `owner_id` | `TEXT` | Owner |
| `action` | `TEXT NOT NULL` | Hanh dong |
| `target_type` | `TEXT` | Loai doi tuong |
| `target_id` | `TEXT` | ID doi tuong |
| `ip_address` | `TEXT` | Dia chi IP |
| `metadata_json` | `TEXT` | Metadata JSON |
| `created_at` | `TEXT NOT NULL DEFAULT datetime(...)` | Ngay tao |

## Context Word duoc xay tu DB

Khi xuat Word theo goi thau, backend xay `unified_context` nhu sau:

| Context | Nguon DB | Kieu |
|---|---|---|
| `goi_thau` | 1 dong `goi_thau` | Object |
| `goi_thau_versions` | Cac version cua `goi_thau` cung `id_goc` | List |
| `ke_hoach` | `ke_hoach_lcnt` lien ket qua `goi_thau.ke_hoach_id` | Object |
| `chu_dau_tu` | `chu_dau_tu` qua `ke_hoach.chu_dau_tu_id` | Object |
| `nha_thau` | Cac dong `thong_tin_mo_thau` theo `goi_thau_id`, bo sung `ten_viet_tat` tu bang `nha_thau` neu co `nha_thau_id` | List |
| `to_chuyen_gia` | Join `goi_thau_chuyen_gia` + `chuyen_gia`, `loai='chuyen_gia'` | List |
| `to_tham_dinh` | Join `goi_thau_chuyen_gia` + `chuyen_gia`, `loai='tham_dinh'` | List |
| `hop_dong` | Hop dong moi nhat gan goi thau khi xuat hop dong | Object |
| `user` | `tai_khoan` | Object |
| `to_chuc` | `to_chuc` | Object |
| `goi_dich_vu` | `goi_dich_vu` cua user | Object |

Khi xuat Word theo ke hoach, backend xay:

| Context | Nguon DB | Kieu |
|---|---|---|
| `ke_hoach` | 1 dong `ke_hoach_lcnt` | Object |
| `chu_dau_tu` | `chu_dau_tu` cua ke hoach | Object |
| `goi_thau` | Cac goi thau thuoc ke hoach | List |
| `user` | `tai_khoan` | Object |
| `to_chuc` | `to_chuc` | Object |
| `goi_dich_vu` | `goi_dich_vu` cua user | Object |

## Danh sach dong sinh ra khi xuat Word

Nhung danh sach sau khong phai bang DB rieng. Chung duoc tong hop tu `goi_thau`, `goi_thau.phan_lo_list`, `goi_thau.awarded_phan_lo_list` va `thong_tin_mo_thau`.

| Bien context | Kieu | Nguon goc |
|---|---|---|
| `ds_phan_lo` | List | Hop nhat `phan_lo_list` va `awarded_phan_lo_list`, bo sung nha thau theo `thong_tin_mo_thau.ma_phan_lo` |
| `ds_phan_lo_co_nha_thau_tham_du` | List loc | Tu `ds_phan_lo`, chi lay lo co `ds_nha_thau_tham_du` khong rong |
| `ds_phan_lo_khong_co_nha_thau_tham_du` | List loc | Tu `ds_phan_lo`, chi lay lo khong co nha thau tham du |
| `ds_phan_lo_co_nha_thau_trung` | List loc | Tu `ds_phan_lo`, chi lay lo co nha thau trung |
| `ds_phan_lo_co_nha_thau_tham_du_khong_trung` | List loc | Tu `ds_phan_lo`, co nha thau tham du nhung khong co nha thau trung |
| `ds_nha_thau_tham_du` | List | Tat ca dong `thong_tin_mo_thau` cua goi thau |
| `ds_nha_thau_trung_thau` | List loc | Nha thau trung theo `nha_thau_trung_thau_id` hoac ket luan danh gia |
| `ds_nha_thau_truot_thau` | List loc | Nha thau tham du nhung khong trung |
| `ds_nha_thau_khong_dat` | List loc | Nha thau co danh gia khong dat |
| `ds_nha_thau_dat_khong_xep_hang_1` | List loc | Nha thau dat nhung khong xep hang 1 va khong trung |
| `ds_nha_thau_khong_duoc_danh_gia` | List loc | Nha thau khong duoc danh gia, dac biet quy trinh 2 |
| `ds_nha_thau_trung_theo_phan_lo` | List tong hop | Moi dong la mot nha thau trung thau; ben trong co `ds_phan_lo` gom cac phan lo ma nha thau do trung |

Moi item trong `ds_phan_lo` duoc bo sung cac danh sach con:

| Truong con | Kieu | Y nghia |
|---|---|---|
| `ds_nha_thau_tham_du` | List | Nha thau tham du phan lo hien tai |
| `ds_nha_thau_trung_thau` | List | Nha thau trung phan lo hien tai, thuong 0 hoac 1 item |
| `ds_nha_thau_truot_thau` | List | Nha thau khong trung phan lo hien tai |
| `so_nha_thau_tham_du` | Number | So nha thau tham du phan lo |
| `co_nha_thau_tham_du` | Text | Co/Khong |
| `co_nha_thau_trung` | Text | Co/Khong |
| `ten_nha_thau_trung` | Text | Ten nha thau trung phan lo |
| `gia_trung_thau` | Text | Gia trung thau da format |
| `ds_ten_nha_thau_tham_du` | Text | Chuoi ten nha thau tham du, cach nhau bang dau `;` |
| `ly_do_khong_trung` | Text | Chuoi ly do khong trung |

## Goi y cho cau hinh sau nay

Nen chia nguon cau hinh thanh 4 nhom:

1. **Bang du lieu**: `chu_dau_tu`, `ke_hoach_lcnt`, `goi_thau`, `nha_thau`, `thong_tin_mo_thau`, `chuyen_gia`, `hop_dong`, `to_chuc`, `tai_khoan`.
2. **Danh sach DB/JSON**: `phan_lo_list`, `awarded_phan_lo_list`, `tuy_chon_mua_them_list`, `gia_han_list`, `yeu_cau_lam_ro_list`, `tra_loi_lam_ro_list`, `thanh_vien_lien_danh`, `cv_da_thuc_hien`, `cv_khong_ap_dung`, `cv_chua_du_dieu_kien`.
3. **Danh sach dong**: cac `ds_*` duoc sinh khi xuat Word, nhu `ds_phan_lo`, `ds_nha_thau_trung_thau`, `ds_nha_thau_khong_dat`.
4. **Thuc the dong**: cac bien dem/tong hop nhu `tong_so_phan_lo`, `so_phan_lo_co_nha_thau_trung`, `tong_so_nha_thau_tham_du`.

Voi phan lo, khong nen coi la bang DB rieng vi hien tai no nam trong JSON cua `goi_thau`. Nen coi phan lo la **danh sach JSON cua goi thau** va co them **danh sach dong** khi xuat Word.
