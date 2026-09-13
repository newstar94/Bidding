# Trạng thái triển khai Admin liên ứng dụng

Ngày: 2026-09-13

## Đã triển khai

- BiddingFlow có route Admin riêng /admin/chuan-hoa và hiển thị rõ ứng dụng
  đích, nguồn sự thật, capability và trạng thái chưa sẵn sàng.
- Admin shell có bộ lọc ứng dụng rõ ràng: Tất cả ứng dụng, BiddingFlow và
  Chuẩn Hóa; lựa chọn Chuẩn Hóa chỉ điều hướng tới route liên ứng dụng đã có
  backend kiểm tra quyền.
- Các directory Chuẩn Hóa dùng phân trang phía máy chủ với nút trang trước/sau,
  page size bounded 25; không tải toàn bộ dữ liệu về trình duyệt.
- Backend BiddingFlow chỉ cho phép Super Admin có user id nằm trong
  CHUAN_HOA_ADMIN_MAPPED_USER_IDS; admin workspace không được suy ra thành
  quyền liên ứng dụng.
- Kết nối dùng CHUAN_HOA_ADMIN_BASE_URL, client id và shared secret ở server.
  Bidding chỉ bật khi `CHUAN_HOA_ADMIN_ENABLED=true`; Chuẩn Hóa có công tắc
  `ChuanHoa:AdminIntegration:Enabled=false` để thu hồi client ngay lập tức;
  thiếu hoặc sai giá trị toggle cũng bị fail-closed.
  Request ký HMAC-SHA256 với method/path/timestamp/nonce/body hash; timeout
  bounded, không retry mù và không trả secret về trình duyệt.
- Chuẩn Hóa production API có endpoint xác thực
  /v1/admin/integration/capabilities bằng client id/timestamp/nonce/HMAC,
  chống nonce dùng lại; các endpoint accounts/offers/orders đọc trực tiếp
  PostgreSQL production với tìm kiếm và phân trang bounded. Không đọc
  Development Admin store và không bịa dữ liệu.
- BiddingFlow ghi audit cho lần kiểm tra capability, gồm actor, ứng dụng đích,
  hành động, kết quả và mã lỗi.
- Chuẩn Hóa ghi audit cả lệnh entitlement thất bại (validation, conflict hoặc
  target không hợp lệ), không chỉ các lệnh thành công.
- Các endpoint integration trả envelope versioned gồm `schema`, `application`,
  `status` và `data`, giúp UI phân biệt nguồn dữ liệu ổn định.
- Lịch sử quản trị liên ứng dụng được đọc bounded từ audit store Chuẩn Hóa và
  hiển thị riêng trong tab “Lịch sử quản trị”; không trộn với audit BiddingFlow.
- ADR: docs/adr/cross-application-admin-integration.md.

## Giới hạn có chủ đích

Chuẩn Hóa đã có schema và API production cho tài khoản, offer/bảng giá, đơn
hàng, subscription/entitlement và payment events. Lệnh gia hạn entitlement
dùng transaction-scoped advisory lock, ReadCommitted, idempotency key, audit
actor/correlation và replay cùng payload. License lease refresh và activation
từ payment vẫn theo workflow thanh toán hiện hữu. Admin không tạo payment,
không giả lập webhook và không tự refresh lease ngoài nghiệp vụ Chuẩn Hóa.
Không chạy thanh toán thật, migration production hay deploy. Development Admin
không được dùng làm production API.

## Kiểm thử

- BiddingFlow: full suite — 2391 Python tests passed, 1 skipped; coverage 64.85%; critical Python ratchet passed for 18 modules (including both integration modules); JS coverage rerun and critical JS ratchet passed for 14 modules.
- BiddingFlow: python -m pytest -q tests/test_chuan_hoa_integration.py — 13 passed; bao gồm envelope validation, mapped/unmapped, workspace denial, actor override và timeout unknown-result.
- BiddingFlow: Admin router/icon/plans JavaScript tests — 17 passed.
- BiddingFlow: python -m compileall -q backend tests — passed.
- Chuẩn Hóa: dotnet test tests/ChuanHoa.Api.Tests/ChuanHoa.Api.Tests.csproj --no-restore — 34 passed, gồm revoke/missing-toggle và contract HTTP TestServer cho capability/collection/mutation.
- Chuẩn Hóa: V001/V002 migration/rollback assertions — PASS; persistence suite
  chạy 7 test tích hợp và V002 có SQL
  assertions cho bảng idempotency/audit và index rollback. Persistence suite
  bao gồm replay cùng key, conflict khác payload và concurrent cùng key.
- Visual QA thật bằng Playwright với tài khoản admin: 375x812 và 1280x800,
  không overflow ngang, không serious/critical axe violation; trạng thái thực
  tế hiển thị "chưa được ánh xạ" khi thiếu cấu hình mapping.
- HTTPS contract local xuyên hai tiến trình: `scripts/verify_chuan_hoa_https_contract.ps1`
  khởi động PostgreSQL tạm, Chuẩn Hóa Kestrel HTTPS và Bidding integration
  client; capability, audit collection và entitlement mutation đều pass.
- git diff --check — passed.

## Giới hạn bằng chứng

Đã có test xuyên hai backend qua mạng thật ở local bằng HTTPS và database tạm;
chưa có host/shared secret/database production để xác minh production E2E. Các thay đổi vẫn
chưa commit hoặc push.
Các thay đổi vẫn chưa commit hoặc push.

## Working tree

BiddingFlow có các file source/test/docs của phase này và một thay đổi người
dùng có trước tại frontend/auth/AuthFlowController.js; không reset hoặc ghi
đè thay đổi đó. Trạng thái Chuẩn Hóa phải được kiểm tra riêng trong repository
D:\Chuẩn Hóa trước khi commit.
