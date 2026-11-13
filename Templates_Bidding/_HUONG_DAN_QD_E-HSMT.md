# Hướng dẫn: QĐ phê duyệt và điều chỉnh E-HSMT trong mẫu Word

Áp dụng từ ADR 0102 (danh mục biến v19). Chỉ dùng được ở mẫu cấp gói thầu (HSMT, đánh giá, mở thầu, kết quả, hợp đồng, thanh lý), không dùng được ở mẫu Kế hoạch.

## 1. Biến đơn

| Biến | Ý nghĩa |
|---|---|
| `{so_qd_pd_hsmt}`, `{ngay_qd_pd_hsmt}`, `{S_ngay_qd_pd_hsmt}` | Luôn là QĐ phê duyệt E-HSMT **gốc**, kể cả khi xuất từ phiên bản đã điều chỉnh |
| `{so_qd_dc_hsmt}`, `{ngay_qd_dc_hsmt}`, `{S_ngay_qd_dc_hsmt}` | QĐ điều chỉnh **mới nhất**; để trống nếu chưa điều chỉnh |

## 2. Danh sách `ds_qd_hsmt`

Dòng đầu tiên là QĐ gốc, tiếp theo là các lần điều chỉnh theo thứ tự.

| Trường | Ý nghĩa |
|---|---|
| `lan` | `0` là QĐ gốc; `1`, `2`… là lần điều chỉnh thứ mấy |
| `loai` | "Phê duyệt E-HSMT" hoặc "Điều chỉnh E-HSMT lần N" |
| `so_quyet_dinh`, `ngay_quyet_dinh` | Số, ngày QĐ |
| `so_to_trinh`, `ngay_to_trinh` | Số, ngày tờ trình |
| `so_bao_cao_tham_dinh`, `ngay_bao_cao_tham_dinh` | Số, ngày báo cáo thẩm định |
| `ly_do` | Lý do điều chỉnh (QĐ gốc để trống) |

Mỗi trường ngày có thêm dạng ngắn với tiền tố `S_`, ví dụ `S_ngay_quyet_dinh` cho ra 05/02/2026.

## 3. Mẫu viết sẵn (đã kết xuất thử)

### a) Mỗi QĐ một đoạn có gạch đầu dòng (khuyên dùng cho phần "Căn cứ")

Viết 3 dòng, mỗi dòng là một đoạn riêng, và đặt gạch đầu dòng cho **dòng giữa**:

```
{%p for item in ds_qd_hsmt %}
Căn cứ Quyết định số {{ item.so_quyet_dinh }} ngày {{ item.S_ngay_quyet_dinh }} về việc {% if item.lan == 0 %}phê duyệt{% else %}phê duyệt điều chỉnh lần {{ item.lan }}{% endif %} E-HSMT;
{%p endfor %}
```

Kết quả:
- Căn cứ Quyết định số QĐ-GỐC ngày 05/02/2026 về việc phê duyệt E-HSMT;
- Căn cứ Quyết định số QĐ-ĐC1 ngày 01/3/2026 về việc phê duyệt điều chỉnh lần 1 E-HSMT;

Lưu ý:
- Hai dòng `{%p … %}` tự biến mất khi xuất.
- Trong vòng lặp `{%p for %}` phải viết trường bằng ngoặc kép, dạng `{{ item.ten_truong }}`.

### b) Gộp tất cả trong một đoạn

```
{#ds_qd_hsmt}{loai} số {so_quyet_dinh} ngày {S_ngay_quyet_dinh}; {/ds_qd_hsmt}
```

### c) Bảng, mỗi QĐ một dòng

Trong một dòng của bảng, đặt `{#ds_qd_hsmt}` ở ô đầu và `{/ds_qd_hsmt}` ở ô cuối:

| Lần | Loại | Số QĐ | Ngày |
|---|---|---|---|
| `{#ds_qd_hsmt}{lan}` | `{loai}` | `{so_quyet_dinh}` | `{S_ngay_quyet_dinh}{/ds_qd_hsmt}` |

### d) Chỉ lấy QĐ gốc hoặc chỉ lấy các lần điều chỉnh

```
{#ds_qd_hsmt}{% if item.lan == 0 %}QĐ gốc: {so_quyet_dinh}{% endif %}{/ds_qd_hsmt}
{#ds_qd_hsmt}{% if item.lan > 0 %}Lần {lan}: {so_quyet_dinh}; {% endif %}{/ds_qd_hsmt}
```

Trong điều kiện `{% if %}` viết `item.lan`; phần chữ hiển thị vẫn viết `{lan}`.

### e) Câu văn thay đổi theo việc đã điều chỉnh hay chưa

```
{% if so_qd_dc_hsmt %}E-HSMT đã điều chỉnh theo QĐ {so_qd_dc_hsmt}.{% else %}E-HSMT chưa điều chỉnh.{% endif %}
```

## 4. Không nên

- Đặt `{#ds_qd_hsmt}` và `{/ds_qd_hsmt}` ở hai đoạn riêng: mỗi QĐ vẫn ra một đoạn, nhưng để lại dòng trống giữa các QĐ. Dùng mẫu 3a thay thế.
- Dùng `{so_qd_hsmt}` (không có `pd`) để lấy QĐ gốc: biến này là trường của phiên bản gói thầu đang xuất, nên có thể là QĐ điều chỉnh.

## 5. Dữ liệu lấy từ đâu

- Mỗi lần tạo phiên bản mới của gói thầu, ứng dụng ghi nhận một lần điều chỉnh. Lần N ứng với phiên bản N; số và ngày QĐ lấy từ "Số/Ngày quyết định" của phiên bản đó.
- Có thể sửa số/ngày trên tab Tiến độ, ở dòng "QĐ phê duyệt điều chỉnh E-HSMT lần N". Lần nào bị ẩn bằng nút thùng rác sẽ không được in ra.
- QĐ gốc lấy từ phiên bản đầu tiên của gói thầu.
