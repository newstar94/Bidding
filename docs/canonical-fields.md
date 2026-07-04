# Canonical Fields - BiddingFlow

Tai lieu nay ghi lai bien DB canonical va ten field frontend tuong ung cho cac entity chinh.

Quy uoc:

- DB/backend luu bang snake_case.
- Frontend dung camelCase.
- API/sync mapper la bien chuyen doi duy nhat giua hai dang ten.

## chu_dau_tu

| DB field | Frontend field |
| --- | --- |
| `id` | `id` |
| `id_goc` | `rootId` |
| `phien_ban` | `phienBan` |
| `is_latest` | `isLatest` |
| `ma_chu_dau_tu` | `maChuDauTu` |
| `ten_chu_dau_tu` | `tenChuDauTu` |
| `ma_so_thue` | `maSoThue` |
| `chuc_vu_nguoi_dung_dau` | `chucVuNguoiDungDau` |
| `dai_dien_cdt` | `daiDienCdt` |
| `chuc_vu_dai_dien` | `chucVuDaiDien` |
| `danh_xung` | `danhXung` |
| `dia_chi` | `diaChi` |
| `so_dien_thoai` | `soDienThoai` |
| `so_tai_khoan` | `soTaiKhoan` |
| `noi_mo_tai_khoan` | `noiMoTaiKhoan` |
| `email` | `email` |
| `ma_qhns` | `maQHNS` |
| `co_quan_chu_quan` | `coQuanChuQuan` |

## ke_hoach_lcnt

| DB field | Frontend field |
| --- | --- |
| `id` | `id` |
| `id_goc` | `rootId` |
| `ma_ke_hoach` | `maKeHoach` |
| `ma_du_an` | `maDuAn` |
| `phien_ban` | `phienBan` |
| `is_latest` | `isLatest` |
| `ten_ke_hoach` | `tenKeHoach` |
| `ten_du_an_du_toan` | `tenDuAnDuToan` |
| `loai_hinh_mua_sam` | `loaiHinhMuaSam` |
| `chu_dau_tu_id` | `chuDauTuId` |
| `tong_muc_dau_tu` | `tongMucDauTu` |
| `is_tong_muc_tu_dong` | `isTongMucTuDong` |
| `ngay_phe_duyet` | `ngayPheDuyet` |
| `quyet_dinh_phe_duyet` | `quyetDinhPheDuyet` |
| `thoi_gian_dang_tai` | `thoiGianDangMa` |
| `cv_da_thuc_hien` | `cvDaThucHienList` |
| `cv_khong_ap_dung` | `cvKhongApDungList` |
| `cv_chua_du_dieu_kien` | `cvChuaDuDieuKienList` |
| `nguon_von` | `nguonVon` |
| `thoi_gian_du_an` | `thoiGianDuAn` |
| `dia_diem_quy_mo` | `diaDiemQuyMo` |
| `thong_tin_khac` | `thongTinKhac` |
| `so_qd_phe_duyet_du_an` | `soQdPheDuyetDuAn` |
| `ngay_qd_phe_duyet_du_an` | `ngayQdPheDuyetDuAn` |
| `co_quan_phe_duyet_du_an` | `coQuanPheDuyetDuAn` |
| `phe_duyet` | `pheDuyet` |
| `ngay_trinh_du_toan` | `ngayTrinhDuToan` |
| `ngay_phe_duyet_du_toan` | `ngayPheDuyetDuToan` |
| `so_qd_phe_duyet_du_toan` | `soQdPheDuyetDuToan` |
| `ngay_trinh_ke_hoach` | `ngayTrinhKeHoach` |

## goi_thau

| DB field | Frontend field |
| --- | --- |
| `id` | `id` |
| `id_goc` | `rootId` |
| `ma_goi_thau` | `maGoiThau` |
| `phien_ban` | `phienBan` |
| `is_latest` | `isLatest` |
| `ke_hoach_id` | `keHoachId` |
| `ten_goi_thau` | `tenGoiThau` |
| `gia_goi_thau` | `giaGoiThau` |
| `loai_hop_dong` | `loaiHopDong` |
| `hinh_thuc_lua_chon` | `hinhThucLuaChon` |
| `phuong_thuc_lua_chon` | `phuongThucLuaChon` |
| `thoi_gian_thuc_hien` | `thoiGianThucHien` |
| `nguon_von` | `nguonVon` |
| `nha_thau_trung_thau_id` | `nhaThauTrungThauId` |
| `gia_trung_thau` | `giaTrungThau` |
| `linh_vuc` | `linhVuc` |
| `tuy_chon_mua_them` | `tuyChonMuaThem` |
| `thoi_gian_to_chuc` | `thoiGianToChuc` |
| `thoi_gian_bat_dau_to_chuc` | `thoiGianBatDauToChuc` |
| `phan_lo` | `phanLo` |
| `phan_lo_list` | `phanLoList` |
| `tuy_chon_mua_them_list` | `tuyChonMuaThemList` |
| `thoi_gian_dang_tai` | `thoiGianDangTai` |
| `thoi_gian_dong_thau` | `thoiGianDongThau` |
| `thoi_gian_mo_thau` | `thoiGianMoThau` |
| `thoi_gian_mo_ehsdxtc` | `thoiGianMoEhsdxtc` |
| `so_quyet_dinh` | `soQuyetDinh` |
| `ngay_quyet_dinh` | `ngayQuyetDinh` |
| `so_quyet_dinh_ket_qua` | `soQuyetDinhKetQua` |
| `ngay_quyet_dinh_ket_qua` | `ngayQuyetDinhKetQua` |
| `gia_han_list` | `giaHanList` |
| `yeu_cau_lam_ro_list` | `yeuCauLamRoList` |
| `tra_loi_lam_ro_list` | `traLoiLamRoList` |
| `thoi_gian_goi_thau` | `thoiGianGoiThau` |
| `thoi_gian_hop_dong` | `thoiGianHopDong` |
| `awarded_phan_lo_list` | `awardedPhanLoList` |
| `gia_tri_dam_bao_du_thau` | `giaTriDamBaoDuThau` |
| `hieu_luc_hsdt` | `hieuLucHsdt` |
| `hieu_luc_dam_bao_du_thau` | `hieuLucDamBaoDuThau` |
| `danh_gia_hsdt_metadata` | `danhGiaHsdtMetadata` |
| `phuong_phap_danh_gia` | `phuongPhapDanhGia` |
| `trong_so_ky_thuat` | `trongSoKyThuat` |
| `ty_le_bao_dam_hop_dong` | `tyLeBaoDamHopDong` |
| `is_thuoc` | `isThuoc` |
| `trang_thai` | `trangThai` |
| `yeu_cau_tham_dinh_hsmt` | `yeuCauThamDinhHsmt` |
| `so_bao_cao_tham_dinh_hsmt` | `soBaoCaoThamDinhHsmt` |
| `ngay_bao_cao_tham_dinh_hsmt` | `ngayBaoCaoThamDinhHsmt` |
| `so_to_trinh_hsmt` | `soToTrinhHsmt` |
| `ngay_trinh_hsmt` | `ngayTrinhHsmt` |

## nha_thau

| DB field | Frontend field |
| --- | --- |
| `id` | `id` |
| `id_goc` | `rootId` |
| `phien_ban` | `phienBan` |
| `is_latest` | `isLatest` |
| `ma_nha_thau` | `maNhaThau` |
| `ten_nha_thau` | `tenNhaThau` |
| `loai_nha_thau` | `loaiNhaThau` |
| `thanh_vien_lien_danh` | `thanhVienLienDanh` |
| `ma_so_thue` | `maSoThue` |
| `nguoi_dai_dien` | `nguoiDaiDien` |
| `danh_xung` | `danhXung` |
| `so_dien_thoai` | `soDienThoai` |
| `email` | `email` |
| `dia_chi` | `diaChi` |
| `so_tai_khoan` | `soTaiKhoan` |
| `noi_mo_tai_khoan` | `noiMoTaiKhoan` |
| `ma_ngan_hang` | `maNganHang` |

## chuyen_gia

| DB field | Frontend field |
| --- | --- |
| `id` | `id` |
| `id_goc` | `rootId` |
| `phien_ban` | `phienBan` |
| `is_latest` | `isLatest` |
| `ho_ten` | `hoTen` |
| `so_chung_chi` | `soChungChi` |
| `ngay_cap_chung_chi` | `ngayCapChungChi` |
| `don_vi_cap_chung_chi` | `donViCapChungChi` |
| `so_cccd` | `soCCCD` |
| `ngay_cap_cccd` | `ngayCapCCCD` |
| `noi_cap_cccd` | `noiCapCCCD` |
| `anh_chung_chi` | `anhChungChi` |
| `ten_anh_chung_chi` | `tenAnhChungChi` |
| `anh_chu_ky` | `anhChuKy` |
| `ten_anh_chu_ky` | `tenAnhChuKy` |

## hop_dong

| DB field | Frontend field |
| --- | --- |
| `id` | `id` |
| `id_goc` | `rootId` |
| `phien_ban` | `phienBan` |
| `is_latest` | `isLatest` |
| `ten_hop_dong` | `tenHopDong` |
| `so_hop_dong` | `soHopDong` |
| `ngay_ky` | `ngayKy` |
| `chu_dau_tu_id` | `chuDauTuId` |
| `nha_thau_id` | `nhaThauId` |
| `ke_hoach_id` | `keHoachId` |
| `gia_tri` | `giaTri` |
| `loai_hop_dong` | `loaiHopDong` |
| `thoi_gian_thuc_hien` | `soNgayThucHien` |
| `trang_thai_ho_so` | `trangThaiHoSo` |
| `phan_loai` | `phanLoai` |
| `co_qd_chi_dinh` | `coQdChiDinh` |
| `so_qd_chi_dinh` | `soQdChiDinh` |
| `ngay_qd_chi_dinh` | `ngayQdChiDinh` |

## thong_tin_mo_thau

| DB field | Frontend field |
| --- | --- |
| `id` | `id` |
| `goi_thau_id` | `goiThauId` |
| `nha_thau_id` | `nhaThauId` |
| `ma_phan_lo` | `maPhanLo` |
| `ten_phan_lo` | `tenPhanLo` |
| `ma_dinh_danh` | `maDinhDanh` |
| `gia_du_thau` | `giaDuThau` |
| `dam_bao_du_thau` | `damBaoDuThau` |
| `hieu_luc_dam_bao` | `hieuLucDamBao` |
| `hieu_luc_hsdxt` | `hieuLucHsdxt` |
| `ty_le_giam_gia` | `tyLeGiamGia` |
| `gia_sau_giam_gia` | `giaSauGiamGia` |
| `hieu_luc_hsdt` | `hieuLucHsdt` |
| `gia_tri_dam_bao` | `giaTriDamBao` |
| `hieu_luc_bao_dam_ngay` | `hieuLucBaoDamNgay` |
| `thoi_gian_thuc_hien` | `thoiGianThucHien` |
| `ten_nha_thau` | `tenNhaThau` |
| `loai_nha_thau` | `loaiNhaThau` |
| `thanh_vien_lien_danh` | `thanhVienLienDanh` |
| `danh_gia_hop_le` | `danhGiaHopLe` |
| `danh_gia_nang_luc` | `danhGiaNangLuc` |
| `danh_gia_ky_thuat` | `danhGiaKyThuat` |
| `danh_gia_tai_chinh` | `danhGiaTaiChinh` |
| `danh_gia_ket_luan` | `danhGiaKetLuan` |
| `ly_do_truot` | `lyDoTruot` |
| `lam_ro_hop_le` | `lamRoHopLe` |
| `lam_ro_nang_luc` | `lamRoNangLuc` |
| `lam_ro_ky_thuat` | `lamRoKyThuat` |
| `lam_ro_tai_chinh` | `lamRoTaiChinh` |
| `nguyen_nhan_khong_dat_hop_le` | `nguyenNhanKhongDatHopLe` |
| `nguyen_nhan_khong_dat_nang_luc` | `nguyenNhanKhongDatNangLuc` |
| `nguyen_nhan_khong_dat_ky_thuat` | `nguyenNhanKhongDatKyThuat` |
