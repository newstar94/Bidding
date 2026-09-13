# Prompt xử lý finding bảo mật BiddingFlow và Chuẩn Hóa

## Mục tiêu

Thực hiện sửa code có kiểm soát cho các finding bảo mật đã được xác nhận trong
đợt rà soát ngày 2026-09-13 của hai repository:

- BiddingFlow: `D:\Bidding`
- Chuẩn Hóa: `D:\Chuẩn Hóa`

Đây là yêu cầu triển khai và kiểm thử thực tế, không chỉ viết báo cáo. Phải
kiểm tra code hiện tại trước khi sửa, giữ thay đổi đang có, sửa tối thiểu tại
đúng seam và báo cáo bằng chứng thực tế.

## Ràng buộc bắt buộc

Đọc và tuân thủ `D:\Bidding\AGENTS.md` cùng tài liệu hướng dẫn của Chuẩn Hóa
nếu có.

Không được:

- thay đổi masking, redaction, field visibility hoặc response filtering đối với
  người dùng đã có quyền đọc bản ghi;
- thay đổi tenant isolation, module permission, assignment scope,
  record-level authorization, role, capability, entitlement hoặc default
  allow/deny;
- dùng security hardening làm lý do tự ý mở rộng hoặc thu hẹp quyền nghiệp vụ;
- gộp tài khoản, billing, merchant, license, entitlement hoặc database giữa hai
  sản phẩm;
- đưa secret server-to-server vào browser, bundle, log, exception hoặc test
  artifact;
- sửa expected test để hợp thức hóa thay đổi hành vi chưa được phê duyệt;
- chạy thanh toán thật, migration production, deploy, commit hoặc push.

Giữ nguyên kiến trúc “một trung tâm Admin, hai sản phẩm độc lập”: BiddingFlow là
giao diện và integration client; Chuẩn Hóa là nguồn sự thật cho tài khoản,
payment, entitlement, license và billing của Chuẩn Hóa.

## Phạm vi finding phải xử lý

### 1. P2 — Replay protection phải hoạt động khi chạy nhiều replica

Hiện tại `src/ChuanHoa.Api/Security/IntegrationRequestAuthenticator.cs` dùng
`ConcurrentDictionary` trong process để lưu nonce. Với nhiều instance dùng cùng
HMAC secret, cùng một nonce có thể được chấp nhận một lần trên mỗi instance.

Yêu cầu:

- thiết kế replay store dùng chung, ưu tiên PostgreSQL hoặc cơ chế hạ tầng đã có;
- lưu nonce theo client và thời hạn bounded, có thao tác insert-if-absent nguyên
  tử;
- giữ constant-time HMAC comparison, clock-skew validation và fail-closed;
- không làm tăng unbounded memory trong API process;
- phân biệt rõ lỗi replay, nonce hết hạn, storage unavailable và lỗi cấu hình;
- nếu chưa thể dùng distributed store trong môi trường hiện tại, phải ghi rõ
  limitation, không giả vờ coi process-local store là multi-instance safe;
- giữ nguyên idempotency database cho entitlement mutation; replay store không
  được thay thế hoặc làm yếu idempotency hiện hữu.

Test bắt buộc:

- cùng nonce: instance A nhận, instance B từ chối;
- khác nonce hợp lệ: cả hai instance nhận;
- nonce hết hạn, timestamp ngoài clock skew, storage lỗi;
- concurrent insert cùng nonce chỉ một request thành công;
- regression cho entitlement idempotency replay/conflict/concurrency.

### 2. P2 — Xác minh HMAC trên đúng raw request body

Hiện tại controller có nguy cơ serialize lại `JsonElement` trước khi xác minh
body hash, trong khi Bidding ký raw UTF-8 JSON. Payload có tiếng Việt hoặc ký tự
Unicode có thể bị encode khác và bị từ chối dù request hợp lệ.

Yêu cầu:

- xác minh chữ ký trên raw request bytes trước hoặc tại boundary model binding;
- không tự ý canonicalize lại JSON nếu việc đó làm thay đổi bytes đã ký;
- bảo đảm Bidding và Chuẩn Hóa dùng cùng method/path/timestamp/nonce/body-hash;
- giữ giới hạn kích thước body và không log raw secret/payload nhạy cảm;
- giữ phân biệt lỗi xác thực, body tamper, malformed JSON và validation nghiệp vụ;
- không nới lỏng xác minh để chấp nhận body không khớp chữ ký.

Test bắt buộc:

- payload ASCII hợp lệ;
- payload tiếng Việt/Unicode trong `reason`, tên sản phẩm và trường text khác;
- whitespace/key-order khác nhau nhưng bytes ký khác phải bị từ chối;
- body bị thay đổi sau khi ký phải bị từ chối;
- empty body, malformed JSON, body vượt giới hạn;
- TestServer HTTP contract từ Bidding tới Chuẩn Hóa.

### 3. P3 — Bảo vệ query string trong chữ ký

Hiện tại canonical signature chỉ bao gồm path, không bao gồm query string dùng
cho search, filter và pagination.

Yêu cầu:

- thống nhất canonical request có path và query đã chuẩn hóa deterministic;
- client và server phải ký cùng chuỗi canonical, không phụ thuộc thứ tự ngẫu
  nhiên của query parameter;
- giữ URL encoding đúng và không double-decode;
- query bị thay đổi, thêm, xóa hoặc đổi thứ tự không hợp lệ phải bị từ chối nếu
  làm thay đổi canonical request;
- không đưa secret hoặc dữ liệu không cần thiết vào query.

Test bắt buộc:

- query hợp lệ với search/page/pageSize;
- tamper từng query parameter;
- encoded Unicode và ký tự reserved;
- query parameter trùng lặp hoặc thứ tự khác nhau theo canonicalization rule;
- backward compatibility cho endpoint không có query.

### 4. P2 có điều kiện — Khóa chặt Development Admin/bootstrap

Rà soát các endpoint Development Admin/bootstrap trong:

- `src/ChuanHoa.Api/Program.cs`
- `DevelopmentAdminController.cs`
- `DevelopmentBootstrapController.cs`

Yêu cầu:

- Development endpoint chỉ tồn tại khi build/runtime Development và feature flag
  explicit được bật;
- bind localhost hoặc network boundary rõ ràng; không tin mù
  `RemoteIpAddress` sau reverse proxy;
- nếu có forwarded headers, chỉ tin header từ proxy được cấu hình rõ;
- production environment phải fail-closed dù cờ development bị cấu hình nhầm;
- thêm test cho direct remote, reverse proxy, forwarded header giả mạo và
  production configuration;
- không ảnh hưởng customer auth/billing/API production.

## Rà soát bổ sung bắt buộc

Trong cùng lượt triển khai, kiểm tra lại:

- production IdP/RBAC và các route `[Authorize]` của Chuẩn Hóa;
- PayOS signature, amount/currency/order/reference validation và webhook
  idempotency;
- đăng ký `IPurchaseStore`/persistence production và trạng thái 503 khi thiếu
  dependency;
- dependency advisories của npm, Python và NuGet nếu môi trường cho phép.

Nếu dependency scan cần network hoặc secret ngoài môi trường hiện tại, không tự
ý vượt rào; ghi `unverified`, lệnh đã thử và lý do không thể xác minh.

## Quy trình thực hiện

1. Đọc instruction/ADR, kiểm tra `git status --short` của cả hai repository.
2. Reproduce hoặc viết characterization test cho từng finding trước khi sửa.
3. Sửa tối thiểu, ưu tiên seam xác thực/integration/storage; không refactor lan
   rộng.
4. Bổ sung migration additive và rollback nếu replay store cần schema. Không xóa
   dữ liệu hoặc chạy migration production.
5. Chạy formatter/lint/build/test phù hợp ở cả hai repository.
6. Chạy lại regression về tenant, role, record authorization, Word export,
   billing, webhook, idempotency và Admin integration.
7. Kiểm tra secret không xuất hiện trong log, bundle, test output hoặc artifact.
8. Chạy `git diff --check` và kiểm tra lại `git status --short`.

## Bộ kiểm thử tối thiểu

### BiddingFlow

- integration/authentication tests cho HMAC, query, timeout, replay và actor;
- Admin route mapped/unmapped Super Admin;
- mutation không retry mù và giữ idempotency key;
- test bảo toàn tenant/module/assignment/record scope và Word entitlement;
- `npm run lint:security`;
- `npm run audit:vendor`;
- `npm run lint:modules`;
- full Python/JS suite và critical coverage ratchet;
- secure build nếu source frontend thay đổi.

### Chuẩn Hóa

- `dotnet build ChuanHoa.slnx --no-restore --nologo`;
- `dotnet test ChuanHoa.slnx --no-restore --nologo`;
- API/TestServer contract tests cho authentication và raw-body HMAC;
- replay/concurrency/persistence tests với PostgreSQL thật hoặc test harness
  tương đương;
- migration up/down assertions nếu có thay đổi schema;
- billing/webhook/idempotency regression;
- dependency scan nếu được phép chạy.

## Tiêu chí nghiệm thu

Chỉ đánh dấu `fixed` khi có đủ code evidence và regression test tương ứng.

Báo cáo cuối phải có bảng:

| Finding | Trạng thái | File/line | Test/lệnh | Exit code | Ghi chú |
|---|---|---|---|---:|---|

Các trạng thái hợp lệ: `fixed`, `confirmed`, `deferred`, `unverified`,
`not-reproducible`, `blocked`.

Phải nêu riêng:

- lỗi đã sửa và compatibility impact;
- migration/rollback strategy;
- test thật, test mock và test chưa chạy;
- phần production chưa thể xác minh;
- cấu hình vận hành cần chủ sản phẩm cung cấp;
- `git status --short` cuối cùng của cả hai repository.

Không được gọi hệ thống là production-ready nếu còn finding bảo mật chưa có
biện pháp giảm thiểu hoặc bằng chứng production tương ứng.
