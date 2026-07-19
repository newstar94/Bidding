# Kiểm kê sink bảo mật frontend

Tài liệu này ghi lại phạm vi kiểm kê bắt buộc khi thay đổi mã frontend. Build bảo mật
phải chạy `npm run lint:security`; build sẽ dừng nếu xuất hiện HTML sink không đi qua
`trustedHTML(...)`, sink bị cấm hoặc API thực thi chuỗi động.

## HTML và script sink

- Toàn bộ phép gán `innerHTML`, `outerHTML` và lời gọi `insertAdjacentHTML` trong
  `frontend/` phải nhận trực tiếp kết quả của `trustedHTML(...)`.
- `srcdoc`, `document.write`, `document.writeln` và
  `Range.createContextualFragment` bị cấm.
- `eval`, `Function`, timer nhận chuỗi và URL `javascript:` bị ESLint chặn.
- CSP bật `require-trusted-types-for 'script'` và chỉ cho phép policy
  `biddingflow-html` cùng policy cần thiết của Google Identity Services. Không có
  default policy.
- Flatpickr là mã vendored duy nhất dùng cầu nối policy tường minh; hash và bản vá
  cục bộ của nó được khóa trong `views/vendor/vendor-manifest.json`.

## URL sink

| Nhóm | Nguồn được phép | Cơ chế |
|---|---|---|
| Script động | module nội bộ, Lucide/Flatpickr nội bộ, Google GIS | `trustedScriptURL()` với allow-list |
| Stylesheet động | CSS dưới `/frontend/` hoặc `/vendor/` | `assertSafeStyleURL()` |
| Điều hướng landing | `/dang-nhap`, `/tong-quan` | hằng số nội bộ |
| Tải Word/Excel | `blob:` do chính response API tạo | tạo và thu hồi object URL ngay sau tải |
| Ảnh đã lưu | `/images/`, ảnh hồ sơ Google, PNG/JPEG/WebP base64 | `safeImageSrc()` |
| Preview upload | object/data URL sinh từ file vừa chọn | kiểm tra media fail-closed ở lớp upload |
| Dynamic import | đường dẫn module literal trong source | Vite đóng gói, không nhận dữ liệu người dùng |

Khi thêm URL sink mới, phải đưa nó về một helper allow-list ở trên hoặc bổ sung
helper mới kèm test payload. Không nối URL thực thi từ dữ liệu API, import Excel hay
giá trị người dùng.
