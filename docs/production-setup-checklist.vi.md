# BiddingFlow — Checklist cài đặt và cấu hình production

Ngày lập: 01/10/2026.

Phạm vi: triển khai BiddingFlow production, bao gồm thanh toán thật qua PayOS.

Tài liệu này tổng hợp các việc cần chuẩn bị theo bộ triển khai hiện tại. Các ô chưa đánh dấu là việc cần xác nhận, không khẳng định rằng hệ thống đang thiếu hoặc chưa được cài đặt. Việc có mã nguồn, mẫu cấu hình hoặc kết quả kiểm thử cục bộ không thay thế bằng chứng trên máy chủ thật.

Không ghi mật khẩu, API key, token, cookie, OTP hoặc private key vào tài liệu này, repository hay chat. Chỉ ghi tên tham chiếu trong hệ thống quản lý bí mật.

## 1. Thông tin cần chốt trước khi triển khai

- [ ] Tên miền production và địa chỉ HTTPS chính thức.
- [ ] Máy chủ: hệ điều hành, khu vực, tài nguyên và người phụ trách.
- [ ] Nơi đặt PostgreSQL, kết nối mạng riêng và chứng chỉ CA.
- [ ] Dịch vụ email, địa chỉ người gửi và trạng thái xác thực người gửi.
- [ ] Tài khoản PayOS, tài khoản ngân hàng liên kết và kênh thanh toán production.
- [ ] Gói dịch vụ, giá bán và chính sách thương mại đã được phê duyệt.
- [ ] Mã định danh bản phát hành và thời điểm chuyển lưu lượng.
- [ ] Người nhận cảnh báo, người trực và phương án quay lại phiên bản trước.

## 2. Cài đặt trên máy chủ

Bộ triển khai hiện tại sử dụng Linux và systemd. Không cần cài Microsoft Word trên máy chủ Linux.

### Thành phần bắt buộc theo bộ triển khai hiện tại

- [ ] Python **3.14.5**, môi trường Python riêng và các thư viện theo bộ phiên bản đã khóa.
- [ ] PostgreSQL **17**, hoặc phiên bản đã kiểm chứng tương thích; có thể đặt trên máy chủ DB riêng.
- [ ] NGINX làm reverse proxy.
- [ ] Cloudflare Tunnel nếu dùng phương án triển khai hiện có.
- [ ] Dịch vụ web `biddingflow.service`.
- [ ] Dịch vụ xử lý tài liệu riêng `biddingflow-document-worker.service`.
- [ ] Bubblewrap, libseccomp và cấu hình AppArmor cho môi trường xử lý tài liệu cách ly.

### Thành phần phụ thuộc tính năng

- [ ] Nếu giữ tra cứu Mua Sắm Công bằng trình duyệt: Node.js **24**, các thư viện Node production đã khóa và Chromium tương ứng với Playwright.
- [ ] Trình duyệt và bộ nhớ đệm của nó có thể được tài khoản dịch vụ không có quyền root truy cập.
- [ ] Kết nối ra ngoài đến hệ thống Mua Sắm Công được kiểm tra trên máy chủ thật.

Triển khai bộ phát hành đã được kiểm chứng; không tự xây dựng lại giao diện trên máy chủ production bằng phiên bản thư viện khác.

## 3. Domain, HTTPS và cấu hình ứng dụng

- [ ] DNS, HTTPS và Cloudflare Tunnel hoạt động với đúng tên miền.
- [ ] `APP_ENV=production`.
- [ ] `APP_RELEASE_ID` khớp mã bản phát hành thực tế, không chỉ là tên phiên bản.
- [ ] `APP_DEBUG=false` và `APP_SECURE_COOKIES=true`.
- [ ] `APP_PUBLIC_URL`, `CORS_ORIGINS` và `ALLOWED_WS_ORIGINS` sử dụng đúng HTTPS origin.
- [ ] `ALLOWED_HOSTS` sử dụng tên miền hợp lệ, không chứa scheme.
- [ ] `TRUSTED_PROXY_CIDRS` khớp proxy thực tế; không mở tin cậy mọi địa chỉ.
- [ ] `APP_INSTANCE_COUNT` khớp số instance thực tế; có thể bắt đầu với một instance.
- [ ] Không mở trực tiếp cổng nội bộ 8000/8080 ra Internet theo mô hình Tunnel hiện tại.
- [ ] Kiểm tra giới hạn yêu cầu, WAF và cảnh báo cho đăng nhập, tải lên và các luồng quan trọng.

Tham chiếu: [Mẫu cấu hình production](D:/Bidding/deploy/production.env.example).

## 4. PostgreSQL và nâng cấp dữ liệu

- [ ] PostgreSQL nằm trong mạng riêng.
- [ ] Kết nối TLS với `sslmode=verify-full` và CA hợp lệ.
- [ ] Tạo **bốn tài khoản/role độc lập**: web, migrator, backup và document worker.
- [ ] Không dùng tài khoản migrator/backup/worker để chạy ứng dụng web.
- [ ] Worker chỉ sử dụng quyền DB phục vụ hàng đợi tài liệu theo hướng dẫn triển khai.
- [ ] Lưu cấu hình DB riêng ngoài bộ phát hành, giới hạn quyền đọc của các tệp bí mật.
- [ ] Nâng cấp DB đến **schema 98** bằng bước triển khai riêng, sau khi sao lưu và kiểm tra trước nâng cấp.
- [ ] Đặt `DATABASE_AUTO_MIGRATE=false` trong dịch vụ production.
- [ ] Kiểm tra tài nguyên PostgreSQL và giới hạn kết nối phù hợp với số tiến trình/instance.
- [ ] Có sao lưu ngoài máy chủ, thời gian lưu giữ và mục tiêu khôi phục đã chốt.
- [ ] Thử khôi phục bản sao lưu vào DB cách ly và lưu bằng chứng kết quả.

Mẫu dữ liệu đầu vào: [Mẫu bí mật PostgreSQL](D:/Bidding/deploy/production-database-secret.json.example). Công cụ tạo tệp cấu hình không thay thế bước tạo tài khoản/role DB.

## 5. Email, khóa bảo vệ và tài khoản khởi tạo

- [ ] Cấu hình `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SENDER` và `SMTP_SECURITY`.
- [ ] Gửi thử email OTP và khôi phục tài khoản đến hộp thư thật.
- [ ] Tạo các khóa riêng, đúng định dạng cho `EMAIL_OUTBOX_ENCRYPTION_KEY`, `OTP_HMAC_KEY`, `AUDIT_CHECKPOINT_HMAC_KEY` và `SYNC_CURSOR_SIGNING_KEY`.
- [ ] Cấu hình `BIDDING_RESTORE_DRILL_PUBLIC_KEY` tương ứng với bằng chứng thử khôi phục đã ký; không coi việc điền khóa là đã thử khôi phục.
- [ ] Không tái sử dụng cùng một bí mật cho DB, SMTP, OTP, audit và các tích hợp khác.
- [ ] Lưu bí mật trong secret manager hoặc tệp môi trường bên ngoài bộ phát hành, có quyền truy cập hạn chế.
- [ ] Chốt người phụ trách luân chuyển bí mật và ghi `SECRET_ROTATION_CONFIRMED_AT` đúng thời điểm thực tế.
- [ ] Khởi tạo tài khoản quản trị bằng cấu hình bootstrap.
- [ ] Đổi mật khẩu quản trị và loại bỏ `ADMIN_PASSWORD` khỏi cấu hình sau khi bootstrap hoàn tất.

## 6. Lưu trữ và dịch vụ xử lý Word

- [ ] Tách dữ liệu, media, log và tệp tạm khỏi thư mục phát hành bất biến.
- [ ] Cấu hình `BIDDING_DATA_DIR`, hạn mức dung lượng và mã hóa dữ liệu lưu trữ.
- [ ] Có audit checkpoint được lưu ngoài máy chủ.
- [ ] Tạo tài khoản riêng cho web và document worker, cùng nhóm trao đổi tài liệu theo hướng dẫn.
- [ ] Thư mục trao đổi tài liệu có đúng owner, group và quyền truy cập.
- [ ] `DOCUMENT_WORKER_SHARED_GID` khớp GID thực tế; không chép nguyên số mẫu nếu khác máy chủ.
- [ ] `DOCUMENT_WORKER_EXECUTION_MODE=external` và cấu hình worker được tách riêng.
- [ ] Không đưa khóa SMTP, PayOS, AI hoặc tài khoản DB web vào môi trường worker.
- [ ] Kiểm tra sandbox và dịch vụ worker trên Linux thật bằng các công cụ kiểm chứng của dự án.
- [ ] Nếu chạy nhiều instance: có lưu trữ dùng chung riêng tư cho tài liệu và kết quả xác thực; không chỉ dựa vào sticky session hoặc ổ đĩa riêng từng máy.

Tham chiếu: [Mẫu cấu hình worker](D:/Bidding/deploy/document-worker.env.example) và [Hướng dẫn triển khai](D:/Bidding/deploy/README.md).

Chỉ đặt các cờ `DATABASE_PRIVATE_NETWORK_CONFIRMED`, `DATA_AT_REST_ENCRYPTION_CONFIRMED`, `AUDIT_CHECKPOINT_OFFHOST_CONFIRMED`, `DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED` và các xác nhận lưu trữ liên quan thành `true` sau khi đã kiểm chứng thực tế. Không bật cờ chỉ để vượt kiểm tra khởi động.

## 7. PayOS — bật nhận tiền thật

### Tài khoản và cấu hình bên ngoài

- [ ] Tài khoản PayOS đã xác thực, có tài khoản ngân hàng liên kết và kênh thanh toán production.
- [ ] Có `Client ID`, `API Key` và `Checksum Key` của đúng kênh thanh toán.
- [ ] Chủ sản phẩm đã phê duyệt đơn vị nhận tiền, gói dịch vụ, giá bán và chính sách thương mại.

Hướng dẫn chính thức: [Tạo kênh thanh toán PayOS](https://payos.vn/docs/huong-dan-su-dung/tao-kenh-thanh-toan/).

### Cấu hình trong BiddingFlow

- [ ] Lưu `PAYOS_CLIENT_ID`, `PAYOS_API_KEY` và `PAYOS_CHECKSUM_KEY` trong hệ thống quản lý bí mật.
- [ ] Cấu hình `COMMERCIAL_PAYMENT_PROVIDER=payos` và `PAYMENT_PROVIDER_ENVIRONMENT=production`.
- [ ] Cấu hình hồ sơ `provider-payos-production-v2` theo runbook: `payos / production / live / ready`.
- [ ] Tham chiếu bí mật của hồ sơ và `PAYOS_CREDENTIAL_REFERENCE` cùng khớp `env://payos/default`.
- [ ] Đăng ký webhook đúng kênh thanh toán:

  ```text
  https://<tên-miền>/api/billing/providers/provider-payos-production-v2/webhook
  ```

- [ ] Webhook không bị Cloudflare Access, chuyển hướng đăng nhập hoặc CAPTCHA chặn; ngoại lệ chỉ áp dụng đúng đường dẫn cần thiết.
- [ ] Giữ kiểm tra chữ ký webhook và các giới hạn bảo vệ tại backend.
- [ ] Kiểm tra webhook từ bên ngoài đến được backend và trả phản hồi JSON có kiểm soát.
- [ ] Chỉ xác nhận `PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED`, `PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED` và `COMMERCIAL_EXTERNAL_LEGAL_READY` sau khi đủ bằng chứng/phê duyệt.

### Thứ tự kích hoạt

1. Chuyển sang chế độ thương mại theo phạm vi đã được phê duyệt:

   ```dotenv
   TRIAL_FULL_ACCESS_ENABLED=false
   COMMERCIAL_POLICY_ENABLED=true
   COMMERCIAL_POLICY_MODE=enforce
   ```

2. Sau khi đủ điều kiện sẵn sàng, bật xử lý kích hoạt và giữ checkout tắt trong lúc kiểm tra webhook, đối soát:

   ```dotenv
   PAYMENT_ACTIVATION_ENABLED=true
   PAYMENT_CHECKOUT_ENABLED=false
   ```

3. Sau khi activation ổn định, được phê duyệt và chưa mở traffic bán hàng,
   bật checkout trong cửa sổ kiểm thử có kiểm soát theo runbook:

   ```dotenv
   PAYMENT_CHECKOUT_ENABLED=true
   ```

   Cờ này là điều kiện để tạo order mới; không thể yêu cầu tạo giao dịch mới
   khi vẫn giữ `PAYMENT_CHECKOUT_ENABLED=false`. Kiểm soát cửa sổ kiểm thử bằng
   quy trình/ingress triển khai hiện hành; không thêm bypass quyền nghiệp vụ.
4. Thực hiện giao dịch thật giá trị nhỏ, với số tiền và người thực hiện được
   phê duyệt. Xác nhận nhận tiền, cập nhật trạng thái, kích hoạt đúng và không
   trùng. Trang chuyển hướng thành công không đủ làm bằng chứng nhận tiền.
5. Chỉ mở cho khách hàng sau khi kiểm thử/đối soát đạt và có phê duyệt mở
   traffic. Nếu chưa đạt, tắt checkout mới; vẫn giữ reconciliation/activation
   cho order đã tạo theo runbook, không xóa lịch sử thanh toán.

Lưu ý: không coi môi trường staging là sandbox thanh toán miễn phí. Việc bật PayOS không mặc nhiên yêu cầu bật `PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED`; thu phí lượt tra cứu Mua Sắm Công là quyết định nghiệp vụ riêng.

Tham chiếu: [Runbook PayOS production](D:/Bidding/docs/runbooks/payos-production-integration.md).

## 8. Tích hợp chỉ cấu hình khi sử dụng

- [ ] Turnstile: widget cho đúng tên miền production, site key/secret riêng và hostname được phép; không dùng khóa thử nghiệm cục bộ.
- [ ] Đăng nhập Google: Client ID và cấu hình domain/origin được phép.
- [ ] AI: khóa nhà cung cấp, model, địa chỉ dịch vụ và allowlist phù hợp.
- [ ] Conflict center và các tính năng tùy chọn khác: khóa/cấu hình riêng theo yêu cầu của tính năng.

Không bật đồng loạt mọi tính năng hoặc thay đổi quyền/hiển thị dữ liệu để hoàn tất triển khai. Phải bảo toàn tenant isolation, module/assignment/record scope và quyền xem đầy đủ dữ liệu của người dùng đã được cấp quyền. Quyền xuất Word chỉ kiểm soát xuất tài liệu.

## 9. Kiểm chứng trước khi mở cho khách hàng

- [ ] Bản phát hành đúng mã định danh và checksum; các kiểm tra CI bắt buộc hoàn tất cho chính bản đó.
- [ ] Có staging với domain, DB và bí mật tách khỏi production.
- [ ] Kiểm tra HTTPS, tài nguyên giao diện, đăng nhập và email.
- [ ] Kiểm tra đọc một bản ghi mà tài khoản kiểm thử đã có quyền truy cập; không tự cấp thêm quyền để vượt kiểm thử.
- [ ] Kiểm tra xuất Word và sandbox worker trên máy chủ thật.
- [ ] Kiểm tra trình duyệt, tải và cảnh báo vận hành theo phạm vi phát hành.
- [ ] Thử nâng cấp DB, khôi phục sao lưu và quay lại phiên bản trước.
- [ ] Hoàn tất giao dịch PayOS thật đã phê duyệt và đối soát thành công.
- [ ] Có người phụ trách xác nhận mở traffic và bật checkout.

Lượt sửa ngày 01/10/2026 đã chạy backend đầy đủ tuần tự: 2.502 test đạt, 1 bỏ
qua, coverage 65,02% và 16 mô-đun trọng yếu đạt ngưỡng. Frontend 1.972/1.972
đạt ở snapshot trước F5, coverage và 14 mô-đun trọng yếu đạt. Bổ sung ADR
0049 đã đạt focused 33/33 conflict và 79/79 draft/workflow; giữ nội dung nhập
đến F5 rồi tải canonical, không replay. Sau tối ưu startup ADR 0050, full JS
cuối **2.049/2.049**, 14 coverage ratchets và focused landing/browser **26/26**
đạt; secure build/package smoke mới đạt với release ID `9ba70825…`. Gate
**100ms cho từng tác vụ startup landing** đạt hai lượt **30 cold + 30 warm**,
không ghi nhận task >=50ms. Không phải tổng thời gian tải ứng dụng <100ms;
startup Edge/workspace thật và smoke F5/IndexedDB trên staging có xác thực
còn cần kiểm chứng. Bản sửa không cần cấu hình/migration mới; xem
[báo cáo sửa lỗi và bằng chứng](production-repair-report.vi.md).

## 10. Thứ tự thực hiện đề xuất

1. Chốt domain, máy chủ, PostgreSQL, SMTP và tài khoản/kênh PayOS.
2. Cài runtime, reverse proxy, Tunnel và các dịch vụ riêng.
3. Tạo tài khoản DB, kho bí mật và lưu trữ; cấu hình backup, audit và cảnh báo.
4. Triển khai staging, thử nâng cấp/khôi phục, kiểm chứng web và document worker.
5. Hoàn tất cấu hình thương mại, webhook và kiểm thử PayOS có kiểm soát.
6. Hoàn tất kiểm tra bản phát hành và ký xác nhận vận hành.
7. Triển khai production, kiểm tra sau triển khai, chuyển traffic và bật checkout theo thứ tự đã phê duyệt.

## 11. Tài liệu theo dõi

- [Phiếu thông tin và xác nhận vận hành production](D:/Bidding/docs/production-security-information.md).
- [Danh sách khoảng trống sẵn sàng production](D:/Bidding/docs/production-readiness-gap-register.vi.md).
- [Hướng dẫn triển khai](D:/Bidding/deploy/README.md).
- [Mẫu cấu hình production](D:/Bidding/deploy/production.env.example).
- [Runbook PayOS](D:/Bidding/docs/runbooks/payos-production-integration.md).

Tài liệu Markdown này phục vụ chuẩn bị và bàn giao trong repository, không phải tệp cần đưa vào gói runtime production.
