# ADR 0087: Chuyển Mua Sắm Công sang tên miền Bộ Tài chính

Trạng thái: chấp nhận theo yêu cầu chủ sản phẩm chuyển địa chỉ hệ thống từ
`https://muasamcong.mpi.gov.vn/` sang `https://muasamcong.mof.gov.vn/`.

## Quyết định

Mọi yêu cầu tra cứu mới dùng hostname chính xác `muasamcong.mof.gov.vn` qua HTTPS:
browser worker, session, danh mục endpoint, Origin/Referer, tra cứu KHLCNT/TBMT,
nhà thầu/chủ đầu tư, vi phạm và URL nguồn mới sinh ra. Theo yêu cầu chủ sản phẩm,
đọc một biến `MUASAMCONG_HOST` từ env; Origin HTTPS và URL portal được suy ra,
không có ba biến độc lập dễ lệch nhau. Mặc định vẫn là `muasamcong.mof.gov.vn`.
Đọc/kiểm tra cấu hình trong module có sẵn `backend/procurement_lookup/config.py`
và `session_provider.mjs`, không tạo file hằng số riêng. Kiểm thử đối chiếu env,
normalization và URL giữa Python/Node; env không mở rộng hostname được chấp nhận.

Giữ nguyên giới hạn host chính xác, kiểm tra TLS/DNS, chính sách redirect,
timeout, giới hạn kích thước, luồng phiên và yêu cầu tương tác hiện hữu. Không
fallback sang tên miền cũ, wildcard hoặc host tùy ý. Không thay đổi đường dẫn
endpoint, cấu trúc payload, role, phạm vi bản ghi, quyền xem dữ liệu, entitlement
hoặc điều kiện sử dụng dữ liệu. Thay thế hostname được ghi trong ADR 0032.

## Compatibility impact và triển khai

Không đổi schema và không migration/backfill dữ liệu. URL trong bản ghi, snapshot
và dữ liệu lịch sử giữ nguyên. Thông báo lỗi dùng nhãn trung lập hiện hữu nhận
diện cả tên miền mới và tên miền cũ; không sửa URL dữ liệu mà người dùng được xem.

Cập nhật các cấu hình đang ghi tường minh tên miền cũ trước khi khởi động lại:

- `MUASAMCONG_HOST=muasamcong.mof.gov.vn` (có thể bỏ qua để dùng mặc định).
- `PROCUREMENT_ALLOWED_TARGET_HOSTS=muasamcong.mof.gov.vn`
- `VNEPS_VIOLATION_SERVICE_BASE=https://muasamcong.mof.gov.vn/o/egp-portal-org-ind-violating/services`
- Thay hostname cũ bằng mới trong `AI_WEB_SEARCH_ALLOWED_DOMAINS` nếu đã cấu hình.
- Cho phép kết nối outbound TLS/SNI tới hostname mới ở firewall/proxy nếu có.

Cấu hình allowlist browser còn hostname cũ bị từ chối như các cấu hình không khớp
khác; không tự mở rộng allowlist. Session/cookie/cache hiện hữu không được chuyển
sang domain mới; browser tạo phiên mới theo vòng đời hiện hành sau khi khởi động
lại tiến trình. Không thay site key CAPTCHA hoặc bỏ qua yêu cầu tương tác.

## Kiểm chứng

Kiểm thử hồi quy xác nhận hostname/header mới trên các transport, mọi endpoint
Node, URL TBMT, startup allowlist và browser worker; tên miền giả mạo, HTTP và
hostname cũ bị từ chối tại các seam kiểm tra hiện hữu. Nội dung nghiệp vụ/import
và hiển thị dữ liệu giữ nguyên. Kiểm thử mock không thay thế smoke thật của API
được bảo vệ, CAPTCHA, phiên đăng nhập và tải tài liệu trên môi trường triển khai.
