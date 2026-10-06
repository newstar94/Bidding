# ADR 0066 — Giới hạn chờ vẽ tiến trình lưu

Ngày: 2026-10-06.

## Quyết định

Báo lỗi khi lưu QĐ danh sách nhà thầu đạt kỹ thuật: màn hình “Đang chờ máy
chủ xác nhận” đứng mãi, tải lại trang thấy dữ liệu đã lưu.

`LongTaskLoading` tiếp tục chờ hai animation frame để tiến trình có cơ hội
hiển thị. Nếu callback không chạy, thời gian chờ vẽ kết thúc sau tối đa
150 ms. Khi một nhánh hoàn tất, timer và frame còn lại được hủy; callback
đến muộn không khởi động thêm frame.

Giới hạn này chỉ áp dụng cho việc vẽ tiến trình. Lưu cục bộ, xác nhận máy
chủ, cập nhật rowVersion và xử lý kết quả vẫn được chờ như trước. Không
dùng thời hạn vẽ để báo đã lưu hoặc đóng tiến trình khi máy chủ chưa xác nhận.

## Compatibility và migration

Áp dụng tại helper chung cho mở tiến trình, đổi bước và khôi phục tiến trình
lồng nhau. Không đổi API, dữ liệu, quyền, scope, entitlement hoặc schema.
Không cần migration. Build lại frontend để phát hành bản sửa.

## Bằng chứng và giới hạn

`qualified_approval_confirmation.test.mjs` dùng panel QĐ thực, `setupSyncUx`,
`autoSync`, outbox và phản hồi HTTP thành công. Giữ callback animation frame
để tái hiện: background sync đã nhận ACK, nhưng màn hình và caller không
kết thúc. Kiểm tra trước sửa thất bại; sau sửa tiến trình tự đóng, caller
hoàn tất và chỉ gửi một request lưu.

Kiểm tra riêng vẫn giữ tiến trình khi cập nhật cache rowVersion chưa xong,
hoặc khi phản hồi máy chủ bị giữ lâu hơn thời hạn vẽ. Các regression lưu
thất bại vẫn giữ bản nháp, không báo thành công.
Đây là bằng chứng cục bộ với callback bị giữ có chủ đích; chưa xác nhận
nguyên nhân trên tab trình duyệt người dùng đang gặp lỗi.
