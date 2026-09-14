# ADR 0044 — Lưu nguyên tử, giữ bản nháp và khóa thao tác

- Trạng thái: Accepted
- Ngày: 2026-09-14

## Quyết định

Mọi thao tác lưu hoặc xóa phải được xác nhận bởi transaction máy chủ trước khi
hiển thị thành công. Nếu transaction bị từ chối, dữ liệu nghiệp vụ chính được
khôi phục về trạng thái trước thao tác; nội dung người dùng vừa nhập vẫn được
giữ trong bản nháp bền vững tách khỏi outbox hoạt động để thử lại thủ công và không tự replay.

Đây là contract đích, không phải chứng nhận đã triển khai đầy đủ. Việc giữ
bản nháp/hoàn tác mọi nhánh lỗi chưa được xác minh end-to-end. Mất phản hồi
mạng không đồng nghĩa transaction thất bại: phải đối chiếu kết quả commit
trước khi kết luận hoặc thử lại, không tự hoàn tác một transaction đã commit.

Trong thời gian lưu hoặc xóa, giao diện dùng màn hình tiến trình toàn cục, đặt
`aria-busy` và `inert` cho nền để ngăn thao tác cạnh tranh. Lớp này không thay
đổi tenant, permission, assignment, record scope hoặc field visibility.

## Compatibility impact

Người dùng nhìn thấy tiến trình lâu hơn trước, nhưng không còn thông báo thành
công trước khi máy chủ commit. Lỗi mạng/conflict giữ bản nháp và không tạo dữ
liệu chính thức một phần.

## Regression

Các seam `MutationService.persistAndSync`, `SyncPushService.applyFailedPush` và
`LongTaskLoading` phải giữ bản nháp khi rejected/conflict, rollback projection
chính thức, không phát success toast, và chặn thao tác nền.
