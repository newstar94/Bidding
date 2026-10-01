# ADR 0048 — Sửa các lỗi đúng đắn phát hiện trước production

- Trạng thái: Accepted trong phạm vi sửa lỗi được chủ sản phẩm yêu cầu ngày 01/10/2026
- Phạm vi: báo giá/checkout, xuất Word, phục hồi mutation bị từ chối
- Liên quan: ADR 0015, 0018, 0044; `AGENTS.md` và `CONTEXT.md`

## Contract được bảo toàn

Không đổi role, persona, tenant, module, assignment, record scope hoặc field visibility.
Người đã được quyền đọc vẫn xem đầy đủ trường nghiệp vụ. Entitlement Word chỉ
kiểm soát xuất/tải tài liệu. Không tạo capability đọc dữ liệu nhạy cảm.

## Quyết định triển khai

1. Báo giá và checkout tổ chức phải xác nhận membership quản lý hiện hành,
   không coi lựa chọn vai trò đã lưu trong session là bằng chứng membership.
   Chuyên viên do quản lý chủ động chọn vẫn không được mua như quản lý.
   Giữ nguyên ngoại lệ Super Admin của đường billing hiện hành và mua cho chính
   tài khoản cá nhân. Checkout giữ khóa owner hiện hành; quote dùng khóa đọc
   membership trong transaction để không thêm chu kỳ khóa account/organization
   với tác vụ quản lý thành viên. Không thay session/permission ở phân hệ khác.
2. Xuất chính thức không tiếp tục nếu còn mutation chưa được xác nhận, đang chờ
   chuyển persona hoặc workspace đã thay đổi. Dùng cursor đã commit khi thực sự
   không còn mutation; không đánh đồng `ok: true, skipped: true` với commit mới.
3. Lỗi transport, 429/5xx hoặc response không xác định khi khôi phục không phải
   bằng chứng bản ghi không tồn tại. Chỉ kết quả canonical mới quyết định
   phục hồi hoặc loại projection do mất phạm vi. Giữ nội dung rejected thành
   bản nháp tách khỏi active outbox, không tự replay. Không xác nhận hoàn tất
   phục hồi từ một full bootstrap vốn không trả chi tiết bảng phân trang.
4. Kiểm tra URL checkout PayOS tại adapter chung cho create/query/cancel,
   giữ allowlist HTTPS hiện hành, chữ ký và provider giả lập không đổi.

## Compatibility impact

Phiên từng chọn Quản lý nhưng membership đã `left` hoặc bị hạ về `employee`
không tiếp tục tạo báo giá/checkout tổ chức. Đây là thực thi membership hiện
hành, không thu hồi quyền đọc bản ghi ngoài contract. Tài liệu Word chưa tạo
cho đến khi dữ liệu được xác nhận; lỗi được báo rõ thay vì xuất snapshot cũ
như kết quả của phần nhập mới. Phục hồi có thể chờ khi mạng/lưu trữ chưa sẵn sàng.

## Migration và rollout

Không có migration PostgreSQL, backfill hay thay đổi schema/API nghiệp vụ.
Metadata phục hồi cục bộ additive theo exact tài khoản/workspace; không chuyển
draft thành mutation. Triển khai backend và bundle tương ứng; lưu draft trước
khi bỏ rejected receipt. Không xóa lịch sử thanh toán hoặc dữ liệu nghiệp vụ.
Recovery archive được lưu tách khỏi outbox ở cả localStorage và IndexedDB;
hydrate archive trước push. Receipt `prepared` được đối chiếu từng operation
bằng nội dung với generation hiện tại, không adopt mutation mới không liên quan.
Delete legacy thiếu snapshot version/nội dung và đã đổi batch identity phải
giữ pending, không đoán để discard hoặc POST. Khi cả hai nơi lưu đều lỗi chỉ
cam kết giữ nội dung trong phiên đang mở; không khẳng định durability qua reload.

Chủ sản phẩm đã chốt `ROW_VERSION_CONFLICT` ngày 01/10/2026: giữ nội dung nhập
đến F5, sau F5 tải dữ liệu máy chủ, không tự replay. Quyết định superseding và
regression seams ghi tại [ADR 0049](0049-conflict-input-until-f5-and-canonical-reload.md).

## Regression seams

- Membership `left`/downgrade sau role selection; active manager, personal owner,
  selected employee và ngoại lệ Super Admin; PostgreSQL khóa đồng thời.
- Export pending/skipped/persona/cursor/workspace và các caller Word hiện hành.
- Canonical lookup lỗi mạng/HTTP/schema, absence/denial, receipt base, draft
  persistence, reload/rebuilt generations, no replay, workspace fence, newer
  correction cùng hàng hoặc không liên quan, ambiguous deletes, bảng phân trang,
  lỗi self-wait push/pull và archive hydration, overlay state/cache/queue thật.
- PayOS signed GET/cancel URL không hợp lệ, omission/null/empty tương thích,
  create bắt buộc URL và provider giả lập.
