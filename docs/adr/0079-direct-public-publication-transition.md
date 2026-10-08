# ADR 0079 — Chuyển từ Thử nội bộ sang Công khai trong Admin

- Ngày: 2026-10-09.
- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm.

## Business contract

Super Admin có nút **Chuyển sang Công khai** trên bản đang hiệu lực ở chế độ
Thử nội bộ. Hệ thống tạo bản nháp riêng từ đúng bản đó, chỉ đổi `rollout.mode`
thành `production`, lưu và kiểm tra tự động. Sau khi kiểm tra đạt, Admin xem
tóm tắt toàn bộ gói rồi xác nhận **Xuất bản** trong hộp thoại hiện có.

Giữ nguyên giá, quyền lợi, quota, chính sách, trạng thái và hiển thị từng gói,
thuế, cấu hình provider, readiness và các trường mở rộng. Không tự xác nhận
merchant, credential hoặc webhook. Bản phát hành nguồn bất biến; các đơn và
quyền lợi đã mua tiếp tục ghim bản cũ. Các bản nháp khác không bị ghi đè.

Hủy xác nhận, lỗi kiểm tra hoặc lỗi ở bước tiếp theo giữ lại bản nháp mới để
Admin tiếp tục xử lý. Chưa xác nhận xuất bản thì danh mục public không đổi.
Không hiện nút chuyển nhanh trên bản đã dừng bán toàn cục hoặc trên bản
đang Công khai/Thí điểm; quy trình quản lý bản phát hành hiện có vẫn áp dụng.

## Compatibility impact

Chỉ thêm thao tác giao diện, dùng các API clone/save/validate/publish hiện có
và giữ nguyên quyền Super Admin, CSRF, step-up, revision, validation digest,
audit và resolver. Không đổi API shape, role, tenant scope hoặc entitlement.
Thao tác xuất bản thủ công và chuyển nhanh dùng chung hộp xác nhận.

## Migration strategy

Không có migration DB hoặc thay đổi `.env`. Triển khai frontend mới trên
backend hiện có. Bản nháp và bản phát hành tiếp tục theo lifecycle hiện tại.
Xác thực lại từng yêu cầu riêng; lỗi ở bước sau không chạy lại toàn bộ chuỗi
và không tạo lại bản nháp. Không giả định header idempotency của các endpoint
clone/validate/publish có cơ chế chống trùng; các POST này không tự retry.

## Regression seams

- Nút xuất hiện cho bản Thử nội bộ hiện hành, không xuất hiện khi đã dừng bán.
- Clone đúng nguồn hiện hành, giữ toàn bộ document và chỉ đổi chế độ.
- Save revision mới, validate đúng revision và publish đúng digest đã xác nhận.
- Một hộp xác nhận xuất bản; không yêu cầu nhân bản hay nhập lý do riêng.
- Hủy xác nhận giữ bản nháp Công khai đã kiểm tra và có thể tiếp tục chỉnh sửa.
- Lỗi kiểm tra giữ cấu hình readiness hiện có, hiển thị lỗi và không publish.
- Xác thực lại ở bước validation chỉ chạy lại bước đó; bấm liên tiếp không
  tạo trùng bản nháp hoặc chạy lại save.
