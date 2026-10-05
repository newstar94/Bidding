# ADR 0052 — Viết thường liên từ trong tên đối tác procurement

Status: Accepted by the product owner's request.

## Decision

Khi chuẩn hóa tên đối tác procurement được cung cấp bằng chữ hoa toàn bộ,
liên từ tiếng Việt `và` được viết thường trong tên hiển thị và giá trị chuẩn
hóa. Ví dụ:

`CÔNG TY ... TÀI NGUYÊN VÀ MÔI TRƯỜNG ...` trở thành
`Công ty ... Tài Nguyên và Môi Trường ...`.

Các acronym đã đăng ký, tên viết mixed-case và spacing/punctuation hiện hữu
tiếp tục được xử lý theo contract casing-only hiện tại. Quyết định này không
thay đổi tenant, permission, scope, dữ liệu được phép xem hoặc logic tra cứu.

## Compatibility and migration

Đầu ra chuẩn hóa của tên nguồn viết hoa toàn bộ thay đổi ở các vị trí có từ
`VÀ`; đây là thay đổi hiển thị và giá trị nhập liệu có chủ đích. Không có thay
đổi schema và không chạy migration hoặc bulk rewrite trên dữ liệu đã lưu.

Dữ liệu cũ chỉ được chuẩn hóa lại khi đi qua luồng nhập/tra cứu tương ứng.
Muốn chuẩn hóa hồi tố toàn bộ dữ liệu đã lưu phải có yêu cầu và migration
riêng, kèm đối soát các tên pháp lý chính thức.

Frontend và backend phải dùng cùng quy tắc để không tạo release skew giữa
tra cứu, nhập và đồng bộ.

## Verification

- `tests/js/partner_name_case.test.mjs`
- `tests/test_partner_name_case.py`
- `tests/test_partner_muasamcong_lookup.py`

