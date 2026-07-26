# Placeholder Word cho báo cáo đánh giá chi tiết

## 1. Danh sách dữ liệu hệ thống

Hệ thống cung cấp sáu danh sách mặc định:

| Biến danh sách | Phạm vi |
|---|---|
| `ds_bao_cao_dgct` | Một phần tử cho mỗi nhà thầu/vòng đánh giá; dùng khi cần một bộ bảng riêng cho từng nhà thầu |
| `ds_dgct` | Tất cả dòng đánh giá chi tiết đã lưu |
| `ds_dgct_hop_le` | Chỉ tiêu chí hợp lệ |
| `ds_dgct_nang_luc` | Chỉ tiêu chí năng lực và kinh nghiệm |
| `ds_dgct_ky_thuat` | Chỉ tiêu chí kỹ thuật |
| `ds_dgct_tai_chinh` | Chỉ tiêu chí tài chính |

Các danh sách được nhận diện theo dữ liệu gói thầu và vòng đã lưu. 1G1T dùng báo cáo `single`; 1G2T dùng báo cáo `technical` và `financial`. Quy trình 1/2, phân lô, nhà thầu độc lập/liên danh không cần đổi cú pháp Word.

## 2. Cách tạo một bảng lặp đơn giản

Trong Word, giữ nguyên hàng tiêu đề bảng và thêm ba hàng bên dưới:

1. Hàng điều khiển mở: đặt `{#ds_dgct_hop_le}` trong ô đầu tiên.
2. Hàng dữ liệu: đặt các placeholder như `{stt}`, `{ten_tieu_chi}`, `{ket_qua_chuyen_gia_dat}` vào các ô tương ứng.
3. Hàng điều khiển đóng: đặt `{/ds_dgct_hop_le}` trong ô đầu tiên.

Hai hàng điều khiển sẽ bị xóa khi xuất; hàng dữ liệu được nhân lên theo số tiêu chí.

Ví dụ bảng hợp lệ:

| STT | Nội dung đánh giá | Hệ thống Đạt | Hệ thống Không đạt | Chuyên gia Đạt | Chuyên gia Không đạt | Nhận xét |
|---|---|---|---|---|---|---|
| `{stt}` | `{ten_tieu_chi}` | `{ket_qua_tu_dong_dat}` | `{ket_qua_tu_dong_khong_dat}` | `{ket_qua_chuyen_gia_dat}` | `{ket_qua_chuyen_gia_khong_dat}` | `{nhan_xet}` |

Thay tên danh sách ở hàng mở/đóng bằng `ds_dgct_nang_luc`, `ds_dgct_ky_thuat` hoặc `ds_dgct_tai_chinh` cho các bảng còn lại.

## 3. Một bộ bảng riêng cho từng nhà thầu/vòng

Đặt thẻ mở ở một đoạn văn riêng trước phần thông tin nhà thầu:

```text
{%p for bc in ds_bao_cao_dgct %}
```

Các placeholder cấp báo cáo:

```text
Nhà thầu: {{ bc.ten_nha_thau }}
Loại nhà thầu: {{ bc.loai_nha_thau }}
Phần lô: {{ bc.ma_phan_lo }} - {{ bc.ten_phan_lo }}
Vòng đánh giá: {{ bc.ten_vong }}
Trạng thái: {{ bc.trang_thai }}
Kết luận: {{ bc.ket_luan }}
```

Trong bảng hợp lệ của nhà thầu đó, dùng một hàng điều khiển mở riêng:

```text
{%tr for tc in bc.ds_hop_le %}
```

Hàng dữ liệu dùng:

```text
{{ tc.stt }}
{{ tc.ten_tieu_chi }}
{{ tc.ket_qua_tu_dong_dat }}
{{ tc.ket_qua_tu_dong_khong_dat }}
{{ tc.ket_qua_chuyen_gia_dat }}
{{ tc.ket_qua_chuyen_gia_khong_dat }}
{{ tc.nhan_xet }}
```

Hàng điều khiển đóng của bảng:

```text
{%tr endfor %}
```

Sau toàn bộ các bảng hợp lệ, năng lực, kỹ thuật và tài chính, đặt thẻ đóng ở một đoạn văn riêng:

```text
{%p endfor %}
```

Các danh sách con của `bc` là `bc.ds_hop_le`, `bc.ds_nang_luc`, `bc.ds_ky_thuat`, `bc.ds_tai_chinh` và `bc.ds_tieu_chi`.

## 4. Placeholder của một dòng tiêu chí

| Placeholder | Nội dung |
|---|---|
| `stt` | STT phân cấp như `2`, `2.1`, `2.1.1` |
| `ma_tieu_chi` | Mã tiêu chí nội bộ nếu cần |
| `ten_tieu_chi` | Nội dung/tiêu chí đánh giá |
| `yeu_cau` | Yêu cầu của E-HSMT |
| `nhom_danh_gia` | `validity`, `capacity`, `technical`, `financial` |
| `ten_nhom_danh_gia` | Tên nhóm tiếng Việt |
| `loai_ket_qua` | Kiểu kết quả: đạt/không đạt, điểm, số hoặc nội dung |
| `bat_buoc` | Tiêu chí bắt buộc (`true`/`false`) |
| `la_muc_lon` | Dòng mục lớn tự tổng hợp (`true`/`false`) |
| `diem_toi_da` | Điểm tối đa |
| `diem_toi_thieu` | Điểm tối thiểu |
| `trong_so` | Trọng số |
| `ket_qua_tu_dong_hien_thi` | Đạt/Không đạt/Chưa đánh giá/Không áp dụng |
| `ket_qua_tu_dong_dat` | `x` nếu hệ thống đánh giá đạt |
| `ket_qua_tu_dong_khong_dat` | `x` nếu hệ thống đánh giá không đạt |
| `ket_qua_chuyen_gia_hien_thi` | Kết quả đánh giá của chuyên gia |
| `ket_qua_chuyen_gia_dat` | `x` nếu chuyên gia đánh giá đạt |
| `ket_qua_chuyen_gia_khong_dat` | `x` nếu chuyên gia đánh giá không đạt |
| `diem` | Điểm chuyên gia nhập |
| `noi_dung_hsdt` | Nội dung trong HSDT hoặc giá trị tài chính |
| `nhan_xet` | Nhận xét của chuyên gia |
| `ten_nha_thau` | Tên nhà thầu |
| `loai_nha_thau` | Độc lập/Liên danh |
| `ma_phan_lo`, `ten_phan_lo` | Mã và tên phần lô |
| `ten_vong` | Tên vòng đánh giá |

Không có placeholder lý do không đạt, yêu cầu làm rõ hoặc kết quả làm rõ trong báo cáo chi tiết. Các nội dung đó thuộc báo cáo tổng quát theo nghiệp vụ đã chốt.

## 5. Bố trí theo từng mẫu

- 14A/14B/14C: các bảng hợp lệ và năng lực dùng bốn cột dấu `x`; bảng kỹ thuật dùng kết quả hoặc điểm theo tiêu chí; bảng tài chính dùng `stt`, `ten_tieu_chi`, `noi_dung_hsdt`.
- 14D Tư vấn: bảng kỹ thuật dùng `diem_toi_da`, `diem_toi_thieu`, `diem`, `nhan_xet`; bảng tài chính dùng danh sách tài chính tương ứng.
- Bảng hợp lệ/năng lực phải giữ STT từ dữ liệu; không đánh số tự động trong Word vì hệ thống đã xử lý liên danh và phân cấp.

## 6. Lưu ý khi soạn Word

- Gõ toàn bộ một placeholder trong cùng một lần định dạng; không tô đậm một nửa placeholder.
- Hàng mở và hàng đóng vòng lặp phải là hai hàng riêng, không đặt chung với hàng dữ liệu.
- Với thẻ `{%p ... %}`, cả thẻ phải nằm trong một đoạn văn riêng.
- Dùng font `Plus Jakarta Sans` để đồng bộ ứng dụng; không dùng Times New Roman.
- Sau khi hoàn tất, vào **Biểu mẫu → Quản lý biểu mẫu Word**, tải tệp `.docx` lên và kích hoạt mẫu trước khi xuất báo cáo đánh giá.
