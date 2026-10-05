# ADR 0057: Dùng dữ liệu server khi xung đột và gỡ các tính năng đã bỏ

- Ngày: 2026-10-05
- Trạng thái: Được chủ sản phẩm yêu cầu
- Thay thế: ADR 0008, ADR 0009 và nhánh conflict của ADR 0049

## Quyết định

Xóa Trung tâm giải quyết xung đột, bản nháp xung đột, lựa chọn local/server,
so sánh phiên bản, catalog và binding pháp lý, công cụ AI tuân thủ cùng các
cấu hình bật/tắt và secret dành riêng cho chúng.

Khi server từ chối mutation do xung đột, server là nguồn dữ liệu chuẩn:

1. Loại đúng receipt bị từ chối khỏi outbox bền vững. Giữ thay đổi độc lập
   và generation mới không nằm trong receipt đó.
2. Tải dữ liệu server qua đường đọc hiện hữu, cập nhật cache và giao diện.
3. Không lưu conflict draft, tự merge, force overwrite, tự gửi lại receipt
   đã bị từ chối hoặc phát thông báo lưu thành công.
4. Nếu không thể loại receipt bền vững hoặc chưa tải được dữ liệu server,
   báo lỗi và yêu cầu đối soát lại trước khi ghi tiếp. Không coi lỗi mạng
   hoặc lỗi lưu trữ là xác nhận thành công.

Nếu xóa nháp local thất bại, ghi dấu nhận diện của đúng bản nháp bị từ chối
trong IndexedDB của workspace. Dấu này không chứa payload và được đọc trước
khi khôi phục nháp sau tải lại; nháp mới và nháp độc lập vẫn được giữ. Không
khôi phục nháp khi chưa xác minh được dấu loại bỏ. Nếu cả hai bộ nhớ đều lỗi,
báo lỗi lưu trữ và không xác nhận thao tác thành công.

`row_version`, CAS, HTTP 409, idempotency và offline outbox tiếp tục bảo vệ
đồng bộ. Phiên bản nghiệp vụ kế hoạch/gói thầu, căn cứ lập kế hoạch, AI tư vấn
chung và cơ chế lưu bản nháp do lỗi validation không thuộc các tính năng đã bỏ.
Tenant, role, module, assignment, record scope, session, audit và quyền xem dữ
liệu hiện hữu được giữ nguyên.

## Tương thích và chuyển đổi

Các route, UI, công cụ AI và capability dành riêng cho tính năng đã bỏ không
còn được công bố. Client cũ cần tải lại ứng dụng để dùng chính sách xung đột
mới; các biến môi trường đã bỏ không còn được đọc.

Schema v99 loại 13 bảng dành riêng khỏi schema ứng dụng. Database cũ chuyển
nguyên bảng sang `bidding_retired_features` trong một transaction; dữ liệu,
định danh và quan hệ nội bộ giữa các bảng lưu trữ được giữ. Các khóa ngoại từ
bảng đã bỏ tới bảng nghiệp vụ hiện hành được tháo để chúng không còn ngăn
thao tác kế hoạch, gói thầu hoặc tài khoản. Nếu còn quan hệ từ bảng đang dùng
tới bảng đã bỏ, hoặc đích lưu trữ bị trùng, migration dừng trước khi chuyển.
Database mới không tạo các bảng này. Migration không xóa dữ liệu server.

DDL và migration lịch sử được giữ riêng cho việc nâng cấp database cũ;
chúng không cung cấp API hoặc tính năng runtime. Khi chạy migration trong
schema kiểm thử riêng, kho lưu trữ có tên riêng theo schema nguồn. Rollback
transaction khôi phục nguyên schema cũ. Cài lại tính năng đã bỏ cần một
migration riêng và đối soát các tham chiếu lịch sử trước khi phục hồi khóa
ngoại; không tự bật lại bằng biến môi trường.

Lịch sử quyết định trong ADR được giữ và đánh dấu đã thay thế. Cập nhật ứng
dụng cần chạy migration v99 trước khi dùng schema contract mới; quy tắc
cho phép auto-migrate theo môi trường giữ như trước. Sau migration, chạy lại
`configure_database_roles.py` với các role đã cấu hình để tài khoản backup
tiếp tục đọc được kho lưu trữ; quyền của tài khoản runtime giữ nguyên.

## Kiểm tra tại các ranh giới

- Receipt xung đột không replay sau pull hoặc tải lại; thay đổi độc lập vẫn
  ở outbox và có thể đồng bộ.
- Canonical pull trong nhánh push không chờ chính promise push đang chạy.
- Response muộn không ghi sang workspace khác hoặc session mới.
- Biểu mẫu đánh giá không áp lại input conflict sau khi server được tải lại.
- Session/capability, startup, cấu hình triển khai, admin và AI tư vấn chung
  tiếp tục hoạt động sau khi bỏ các module dành riêng.
