# Quy tắc xóa và lưu trữ dữ liệu

Tài liệu này là ma trận chuẩn cho các lệnh xóa đi qua `/api/sync`. Frontend chỉ làm nhiệm vụ cảnh báo UX; backend và foreign key SQLite là ranh giới bảo vệ dữ liệu.

## 1. Nguyên tắc

- Bản ghi versioned đã tham gia chứng từ hoặc lịch sử nghiệp vụ không được hard-delete. Hồ sơ mở thầu cũng luôn được archive. Server đặt `archived_at`, bỏ cờ `is_latest` khi có version, phát tombstone để client ẩn bản ghi và giữ nguyên khóa ngoại phục vụ tra cứu lịch sử.
- Bản ghi archive không xuất hiện trong danh sách, phân trang, dashboard hoặc reference data hoạt động; lookup trực tiếp bằng ID vẫn có thể đọc để dựng chứng từ lịch sử.
- Không cho chỉnh sửa hoặc dùng bản ghi archive làm tham chiếu mới.
- Hard-delete aggregate chỉ dành cho dữ liệu chưa tạo lịch sử hoặc quan hệ con được duyệt cascade. Owner/manager phải xác thực lại mật khẩu gần đây.
- Impact và audit được ghi trong cùng transaction với archive/delete. Transaction lỗi sẽ rollback cả dữ liệu, tombstone và audit.

## 2. Quan hệ lịch sử dùng `RESTRICT`

| Bản ghi gốc | Quan hệ bảo vệ |
|---|---|
| Chủ đầu tư | Kế hoạch, hợp đồng, hợp đồng thanh lý |
| Nhà thầu | Kết quả gói/phần lô, hồ sơ mở thầu, hợp đồng, thành viên liên danh |
| Chuyên gia | Phân công chuyên gia/thẩm định gói thầu |
| Kế hoạch | Gói thầu, hợp đồng, nội dung công việc kế hoạch |
| Gói thầu | Hợp đồng, phần lô, gia hạn, làm rõ, hồ sơ mở thầu |
| Hợp đồng | Liên kết gói thầu của hợp đồng |
| Hồ sơ mở thầu | Luôn archive; thành viên liên danh được giữ cùng hồ sơ |

Khi một versioned record có ít nhất một quan hệ trên, yêu cầu xóa được chuyển thành `action=archived`. Xóa SQL trực tiếp vẫn bị foreign key `RESTRICT` từ chối.

## 3. Cascade được cho phép có chủ đích

| Aggregate | Thành phần con | Lý do |
|---|---|---|
| Gói thầu chưa có lịch sử | Tùy chọn mua thêm | Thành phần cấu hình, không có ý nghĩa độc lập |
| Gói thầu chưa có lịch sử | Liên kết tổ chuyên gia | Quan hệ phân công, không phải snapshot chuyên gia |
| Hồ sơ mở thầu | Thành viên liên danh mở thầu | Thành phần cấu thành duy nhất của hồ sơ cha |

Các cascade trên phải xuất hiện trong `deleteImpacts` và audit. Mọi quan hệ nghiệp vụ khác mặc định là `RESTRICT`.

## 4. Hợp đồng API

- Thiếu quyền cao: lỗi `DELETE_ELEVATED_PERMISSION_REQUIRED`.
- Chưa xác thực lại mật khẩu: HTTP `403`, mã `PRIVILEGED_REAUTH_REQUIRED`; frontend được phép password step-up và retry đúng một lần.
- Tham chiếu không thuộc nhóm có thể archive: lỗi `DELETE_REFERENCED`.
- Thành công: response có `deleteImpacts[]` gồm `action`, `rootCount`, `dependentCount`, `totalCount`, chi tiết quan hệ và số assignment.
- Audit action tương ứng là `sync.record_archived` hoặc `sync.record_deleted`.

## 5. Dữ liệu offline trên trình duyệt

- Mỗi IndexedDB và khóa local/session storage phải được scope bằng `userId + organizationId`; không dùng chung cache dữ liệu giữa hai tài khoản hoặc hai tổ chức.
- Khi đăng xuất, tùy chọn “Xóa dữ liệu offline trên thiết bị” được bật mặc định. Người dùng có thể bỏ chọn trên thiết bị cá nhân.
- Nếu lần đồng bộ cuối thất bại, hệ thống phải cảnh báo nguy cơ mất thay đổi và yêu cầu xác nhận riêng trước khi xóa.
- Khi phiên hết hạn, bị thu hồi hoặc tài khoản đăng nhập ở nơi khác, dữ liệu workspace cục bộ được xóa để tránh lộ dữ liệu trên máy dùng chung.
- Xóa workspace chỉ xóa đúng database và khóa storage của cặp user/tổ chức hiện hành; không xóa workspace của tài khoản hoặc tổ chức khác.
- Service worker không cache HTML cá nhân hóa, API, WebSocket, ảnh tải lên hoặc vendor không có content hash. Mỗi build dùng cache asset riêng và dọn cache build cũ khi activate.
