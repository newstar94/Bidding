# 0068 — Chuyển màn hình sau khi phê duyệt kết quả LCNT

Ngày: 2026-10-06. Trạng thái: chấp nhận theo báo lỗi của chủ sản phẩm.

## Lỗi được tái hiện

Panel phê duyệt nhận nhập liệu, quyết định được xác nhận lưu và báo thành công,
nhưng vẫn giữ form chỉnh sửa thay vì màn hình “Gói thầu đã hoàn thành LCNT”.
Kiểm tra Playwright gọi panel, lệnh phê duyệt, persistence helper và renderer thật:
trạng thái gói là `Đã có kết quả`, quyết định có trong snapshot được xác nhận,
nhưng workspace vẫn dirty. `showPackageDetails` chặn refresh cùng gói đang dirty.
Đổi duy nhất cờ dirty về false khiến cùng luồng vẽ đúng panel hoàn thành.

## Quyết định

Luồng phê duyệt kết thúc dirty state bằng `completePackageWorkspaceEdit` trước
khi gọi renderer của kết quả đã lưu. Giữ guard bảo vệ bản nháp trong renderer.
Đây là bước sau commit thành công của phê duyệt toàn gói, cập nhật kết quả chính
thức hoặc xác nhận lifecycle của đợt phần lô; không xóa dirty khi request thất bại.

Regression còn phát hiện `ok: true, localMutationsPending: true` bị coi là thành công.
Luồng phê duyệt dùng classifier canonical hiện có để chỉ chuyển panel/báo hoàn tất
khi server đã xác nhận. Đồng bộ dependency của phần lô chưa xác nhận không được
gọi finalize. HTTP lỗi, conflict, lỗi mạng và pending giữ form cùng nội dung nhập.

## Compatibility và migration

Không đổi vai trò, quyền, tenant/assignment/record scope, entitlement, masking,
trường dữ liệu, quyết định hoặc giá trúng thầu. Không đổi API/schema, không sửa
dữ liệu đã lưu và không cần migration. Đường chỉ định thầu/đặc biệt hiện có giữ
nguyên command. Gói phân lô vẫn hiển thị trạng thái một phần theo lifecycle.

## Kiểm chứng

- `award_result_completion_render_browser.test.mjs`: dữ liệu tư vấn 1G2T theo
  báo lỗi, form thực, input/change thực và renderer thật; chờ ACK giả lập;
  dirty/clean success chuyển panel, lỗi hoặc pending giữ form và quyết định.
- `award_result_completion_state.test.mjs`: phần lô complete/partial, chờ finalize,
  lỗi lifecycle và dependency pending; không kết thúc dirty trước xác nhận.
- Các regression contractor snapshot, markup và lifecycle giữ contracts hiện có.

Bằng chứng cục bộ với phản hồi đồng bộ giả lập; không phải kiểm chứng trên tab
người dùng hoặc triển khai production. Bản sửa cần build frontend mới.
