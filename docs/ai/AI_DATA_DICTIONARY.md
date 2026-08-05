# Từ điển chỉ số AI

| Chỉ số | Entity nguồn | Trường ngày | Trạng thái tính | Công thức | Quyền |
|---|---|---|---|---|---|
| Số gói thầu | `goi_thau` | Không bắt buộc | `archived_at IS NULL`, `is_latest=1` | `COUNT(*)` | `goithau.view` + record scope |
| Tổng giá gói thầu | `goi_thau.gia_goi_thau` | Theo filter được nêu | Như trên | `SUM(gia_goi_thau)` | `goithau.view` + record scope |
| Đã phát hành | `goi_thau` | `thoi_gian_dang_tai` | Trường ngày khác null | `COUNT(*)` | `goithau.view` + record scope |
| Đã có kết quả | `goi_thau` | `ngay_quyet_dinh_ket_qua` | Trường ngày khác null | `COUNT(*)` | `goithau.view` + record scope |
| Chưa phê duyệt | `ke_hoach_lcnt` | `ngay_phe_duyet` | `phe_duyet` không thuộc approved | `COUNT(*)` | `kehoach.view` + record scope |
| Tổng giá trị kế hoạch | `ke_hoach_lcnt.tong_muc_dau_tu` | Ngày do filter | Bản ghi hiện hành | `SUM(tong_muc_dau_tu)` | `kehoach.view` + record scope |
| Tổng giá trị hợp đồng | `hop_dong.gia_tri` | Mặc định `ngay_ky` | Không hủy | `SUM(gia_tri)` | `hopdong.view` + record scope |
| Tổng giá trị thanh lý | `hop_dong.gia_tri` | Bắt buộc `ngay_thanh_ly` | `ngay_thanh_ly IS NOT NULL`, không hủy | `SUM(gia_tri)` | `hopdong.view` + record scope |
| Hợp đồng đang thực hiện | `hop_dong.trang_thai_hop_dong` | Không bắt buộc | `Đang thực hiện/ACTIVE/IN_PROGRESS` | `COUNT(*)` | `hopdong.view` + record scope |

Tiền được trả dạng decimal string, đơn vị VND. Aggregation chạy ở backend; model chỉ diễn giải kết quả có `filters`, `scope`, `generatedAt` và `sourceLinks`.
