# ADR 0033 — Chỉ hiển thị lỗi validation tại trường nhập liệu

- Trạng thái: Chấp nhận
- Ngày: 2026-08-31
- Phạm vi: Các form validation dùng `frontend/shared/FormValidation.js`

## Bối cảnh

Khi form có dữ liệu không hợp lệ, ứng dụng tự chèn một banner `validation-summary` ở đầu form với nội dung “lỗi cần xử lý”. Banner lặp lại thông tin đã hiển thị cạnh từng trường, chiếm không gian và gây nhiễu khi người dùng sửa dữ liệu.

## Quyết định

1. Không tạo hoặc duy trì page-level validation summary (`.validation-summary`/`[data-validation-summary]`). Nếu summary cũ tồn tại, luồng validation loại bỏ nó.
2. Giữ nguyên cảnh báo tại từng trường, `aria-invalid`, `aria-describedby`, focus vào trường lỗi và các quy tắc validation hiện hữu.
3. Không thay đổi role, permission, scope, dữ liệu nghiệp vụ, API response hoặc entitlement.

## Compatibility impact

- Các form dùng `validateForm`/`validateNativeForm` không còn banner tổng hợp; lỗi cạnh trường tiếp tục hiển thị như trước.
- API validation nội bộ không còn tạo nhãn hoặc markup summary; không có caller bên ngoài module dùng helper summary cũ.
- Không cần migration dữ liệu hoặc thay đổi backend.

## Regression seams

- Form invalid: không có `.validation-summary` trong form; trường lỗi vẫn có thông báo và `aria-invalid="true"`.
- Form valid và sửa lỗi: cảnh báo tại trường được xóa theo hành vi hiện hữu.
- Các workflow gọi `validateForm`/`validateNativeForm` trên mọi ứng dụng tiếp tục chặn submit khi dữ liệu không hợp lệ.
