# ADR 0073 — Thiết lập thuế và điều kiện thanh toán production

- Ngày: 2026-10-07.
- Trạng thái: các quyết định giá/thuế/hoàn tiền đã được chủ sản phẩm xác nhận; payOS đã xác nhận webhook và thông báo mẫu đã ký đã tới ứng dụng chạy thử trên máy hiện tại qua Cloudflare. Phát hành cấu hình gói và kiểm chứng thanh toán/kích hoạt/gia hạn thực tế còn chờ thực hiện.
- Tiếp nối ADR 0018, 0019, 0047 và 0072.

## Tax policy

Chủ sản phẩm xác nhận trong cuộc trao đổi cấu hình production:

- Giá đã gồm VAT.
- Thuế suất cấu hình: **0%** (`taxBasisPoints=0`).
- Làm tròn tiền: **luôn làm tròn lên** (`rounding=ceil`).
- Tất cả gói hiện tại **không xuất hóa đơn** (`invoiceEnabled=false`). Có thể bật lại cho bản phát hành tương lai theo ADR 0072.

Đây là giá trị cấu hình do chủ sản phẩm cung cấp, không phải kết luận của công cụ rằng bên bán được miễn thuế hoặc không có nghĩa vụ hóa đơn. Tham chiếu `#tax-policy` ghi nhận chính xác nguồn quyết định; không thay bằng phê duyệt pháp lý giả.

## Commercial terms

- Chủ sản phẩm xác nhận đã duyệt các trang điều khoản và quyền riêng tư hiện hữu.
- Chủ sản phẩm cung cấp email hỗ trợ công khai **biddingflow@gmail.com** cho các yêu cầu về gói, thanh toán, gia hạn và dữ liệu. Email được công bố bằng liên kết `mailto:` trên trang điều khoản và quyền riêng tư; xác nhận này không thay đổi cấu hình SMTP hoặc cho phép gửi email.
- Chủ sản phẩm quyết định **không hoàn tiền** cho gói áp dụng chính sách mới. Điều khoản thương mại được bổ sung theo quyết định này và hành vi mua/kích hoạt/gia hạn đã được duyệt.
- Chính sách mới được ghim vào release/quote/order mới. Đơn đã mua hoặc đã chốt điều kiện trước đó giữ snapshot và chính sách hoàn tiền của đơn đó.
- Chính sách không hoàn tiền ngăn tạo yêu cầu hoàn mới cho đơn có snapshot này; không xóa hoặc làm thay đổi yêu cầu hoàn đã tồn tại, audit, trạng thái giao dịch hay ledger.
- Không tạo, bỏ hoặc thay đổi role, permission, tenant/module/assignment/record scope, entitlement hoặc cách hiển thị dữ liệu mà người dùng được phép xem.

## Production target và bằng chứng còn thiếu

- Tên miền dự kiến: `https://demo.hosodauthau.online`.
- Chủ sản phẩm xác nhận **chưa phát hành production**; không xem cấu hình `.env` cục bộ là cấu hình đã triển khai.
- Webhook dự kiến: `/api/billing/providers/provider-payos-production-v2/webhook`. Profile/reference thực tế phải khớp runtime, DB và release theo ADR 0019.
- Mẫu mới chuẩn bị profile payOS `production/live` và reference không bí mật `env://payos/default`, đã đối chiếu khớp tên reference trong cấu hình cục bộ. Trạng thái vẫn `blocked_external`; chế độ của bản nháp vẫn shadow. Việc có sẵn tên reference không xác nhận khóa hoạt động hoặc cho phép mở bán.
- Quan sát trước khi thêm ngoại lệ ngày 2026-10-07: trình duyệt không có phiên Access bị chuyển tới trang Cloudflare Access tại đường dẫn health và webhook; yêu cầu HTTP từ công cụ nhận 403/1010. Đây là bằng chứng các phép dò chưa tới backend, không phải xác nhận kênh payOS đã sẵn sàng.
- Cần triển khai backend/DB/worker, cho máy chủ payOS truy cập đúng endpoint webhook, xác nhận kênh thanh toán và webhook thực tế rồi mới ghi các tham chiếu readiness tương ứng và mở checkout.
- Không tự tạo reference merchant/webhook hoặc chuyển trạng thái provider sang ready để vượt kiểm tra. Các reference thuế có thể dẫn đến quyết định thực tế ở tài liệu này; reference điều khoản/quyền riêng tư dẫn đến nội dung và quyết định chủ sản phẩm tương ứng.
- Không phục hồi yêu cầu phê duyệt 27 fact đã bị bãi bỏ bởi ADR 0047.

## Cấu hình payOS và Cloudflare đã thực hiện ngày 2026-10-07

Chủ sản phẩm yêu cầu thao tác trong phiên payOS và Cloudflare đã đăng nhập để hoàn tất cấu hình thanh toán.

- Kênh payOS `27796`, tên `Bidding`, hiển thị đang hoạt động; tài khoản đã xác thực và ngân hàng đã liên kết. Đã lưu webhook `https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook`; giao diện báo thay đổi thành công. Lưu URL không phải bằng chứng đã nhận hoặc xác minh thanh toán thực tế.
- Đã tạo Access application `BiddingFlow payOS webhook`, ID `32999d96-160d-452d-b25c-510fc79ba539`, chỉ áp dụng destination `demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook`, không dùng wildcard.
- Application này gắn policy `BiddingFlow payOS webhook`, ID `bbbe6c55-1253-4bfe-8475-45daf2e1120e`, action `Bypass`, include `Everyone`. Application `demo` và policy người dùng thử hiện hữu vẫn có trong danh sách. Ngoại lệ phục vụ webhook máy chủ; backend tiếp tục xác minh chữ ký payOS và giữ các contract quyền/dữ liệu hiện hữu.
- Sau khi lưu, một POST JSON rỗng từ mạng ngoài nhận HTTP `502`, content type JSON và không chuyển hướng Access. Đã bỏ được yêu cầu đăng nhập trên phép dò này; chưa chứng minh webhook tới backend hoặc kiểm tra HMAC thành công.
- Tunnel `biddingflow-staging` hiển thị `Healthy`; connector là máy Windows hiện tại. Route của `demo.hosodauthau.online` dẫn tới `http://127.0.0.1:8000`. Kiểm tra cùng lượt không có listener ứng dụng tại cổng 8000; phần ứng dụng đích còn cần khởi chạy hoặc triển khai lên máy chủ production được chỉ định.

Compatibility: chỉ thêm ngoại lệ Access theo đường dẫn cho endpoint webhook vốn không sử dụng phiên người dùng; không thay quyền đọc dữ liệu, role, tenant/module/assignment/record scope hoặc entitlement trong ứng dụng. Không thêm schema/migration. Khi rollback edge được phê duyệt, xử lý đúng application mới nêu trên; policy webhook riêng không được gắn vào application toàn tên miền. Gate còn lại là webhook mẫu đã ký tới backend, đối soát giao dịch thật và kích hoạt/gia hạn đúng một lần theo runbook.

## Chạy thử cục bộ và xác nhận webhook ngày 2026-10-07

Chủ sản phẩm yêu cầu chạy thử trên máy hiện tại. Đã khởi động lại cụm PostgreSQL sẵn có tại `127.0.0.1:55432`, không khởi tạo lại hoặc reset dữ liệu. Cơ sở dữ liệu `biddingflow_dev` có schema **99**, đúng phiên bản runtime hiện tại. Artifact frontend đã qua `verify_secure_build_artifact.py`; kiểm tra này xác nhận marker/manifest và sự tồn tại asset, không thay thế kiểm tra độ mới của source.

- Đã khởi chạy một backend qua `scripts/run_demo_server.ps1 -Once`, không autoreload, chỉ nghe `127.0.0.1:8000`; `/health/ready` trả HTTP **200**, `status=ready`. Giao diện trang chủ đã mở được tại `http://127.0.0.1:8000/`.
- Override chỉ áp dụng cho process chạy thử: `DATABASE_AUTO_MIGRATE=false`, `PAYMENT_CHECKOUT_ENABLED=false`, `PAYMENT_ACTIVATION_ENABLED=false`. Không sửa `.env`, schema, bản nháp hoặc release; giữ nguyên enforcement quota và các quyền hiện hữu. Trước khi mở backend, không có provider command ở trạng thái pending/retry/processing. Startup vẫn chạy các tác vụ bảo trì hiện hữu, không được gọi là chỉ đọc.
- POST JSON rỗng tới đúng webhook công khai với User-Agent nhận diện ứng dụng trả HTTP **400**, `PROVIDER_EVENT_SCHEMA_INVALID`, chứng minh đã tới backend và không bị chuyển hướng Access. User-Agent mặc định Python bị edge trả **403/1010**; không thay đổi ngoại lệ WAF/Access để xử lý phép dò này.
- Gọi API chính thức `POST https://api-merchant.payos.vn/confirm-webhook` bằng credential cục bộ và đúng URL đã cấu hình: HTTP **200**, payOS `code=00`, URL phản hồi khớp. Không ghi khóa hoặc dữ liệu tài khoản ngân hàng vào log bằng chứng.
- Backend ghi nhận POST webhook HTTP **202** và persist một event đã qua xác minh chữ ký: `payment-event-098763c597203ea3782e8414fe60ca8c`, thời điểm `2026-10-07 22:21:44+07:00`. Event vẫn pending vì activation đang tắt. Đây là thông báo mẫu của payOS; không phải giao dịch thanh toán và không được gán vào đơn hàng thật.
- Sau phép thử: `billing_orders=0`, `payment_transactions=0`, `billing_subscription_activations=0`, `payment_webhook_events=1`. Không phát sinh đơn, payment fact hoặc kích hoạt gói.

Điều kiện còn lại: DB chỉ có release legacy không mở bán. Bản nháp gần nhất revision 2 còn thiếu làm tròn `ceil`, chính sách `no_refunds`, credential reference và các tham chiếu xác nhận; kết quả validation đã hết hạn. Cần chỉnh qua luồng Admin có revision/audit, kiểm tra lại và duyệt phát hành giá/cấu hình trước khi bật checkout/activation để thử giao dịch thật. Không tự xuất bản các giá mẫu hoặc đổi trạng thái readiness chỉ để vượt validator. Việc chạy trên máy cá nhân và nhận thông báo mẫu không phải triển khai production; Tunnel phụ thuộc máy và các process này còn hoạt động.

## Compatibility impact

### Giá Cá nhân phục vụ thử thanh toán cục bộ

Sau khi webhook mẫu đã được payOS xác nhận, chủ sản phẩm yêu cầu đặt gói Cá nhân đồng giá **2.000 VND** để tự thử thanh toán. Quyết định này áp dụng cho hai offer Cá nhân Cơ bản/Nâng cao kỳ **năm** đang có trong cấu hình của máy thử, không tự bổ sung giá hoặc kỳ tháng và không đổi giá mặc định trong code khởi tạo tám gói mẫu.

Bản thử được tạo thành draft/release riêng ở chế độ `pilot`, đi qua API quản trị có phiên super admin, CSRF, expected revision, validation digest, audit và outbox. Chế độ pilot hiện dùng scope global, không phải cơ chế giới hạn riêng một tài khoản. Hai gói Cá nhân được mở ở mức 2.000 VND; sáu gói tổ chức chưa từng được mở bán được giữ không mở bán trong bản thử. Cấu hình gói lượt và các giá tổ chức trong draft nguồn được bảo toàn. Routing payOS của release thử chỉ chấp nhận số tiền 2.000 VND để không mở thanh toán các giá mẫu khác.

Giữ nguyên số thành viên, hạn mức Mua Sắm Công, quyền xuất tài liệu và toàn bộ quyền đọc/phạm vi bản ghi của từng gói. Thuế 0%, giá đã gồm VAT, `ceil`, không hóa đơn, không hoàn tiền và kỳ năm 365 ngày/gia hạn theo ADR 0071–0073. Snapshot/release/đơn cũ không được sửa. Khi kết thúc thử nghiệm, dùng luồng dừng bán release thử hoặc phát hành release mới với giá đã chốt; đơn đã tạo tiếp tục theo snapshot của đơn.

Khi chuẩn bị thử checkout, phép dò GET một order không tồn tại tới API payOS cho thấy transport mặc định bị HTTP 403, cùng yêu cầu với User-Agent nhận diện `BiddingFlow-Payments/1.0` trả HTTP 200/code 101 (order không tồn tại). Adapter được bổ sung duy nhất header này. Regression tại seam request urllib đã thất bại trước sửa cho create/get/cancel và sau sửa toàn bộ 50 test provider đạt; không thay quy tắc chữ ký, credential, routing hoặc shared transport.

Bằng chứng đã áp dụng trên máy thử ngày 2026-10-07:

- API đăng nhập và xác thực lại quyền quản trị đều HTTP 200. Create/save/validate/publish đi qua đầy đủ kiểm tra phiên, CSRF và step-up; không đổi rule xác thực để hoàn tất cấu hình.
- Draft thử `commercial-draft-08a9f43070c84caca563a25cf368b00b`, revision 2, kiểm tra không lỗi. Release đã commit `commercial-release-29b2c766e16b415ea9b75a6e3dd9aea8`, mode `pilot`, checksum `70929dbfa2926ae75fc57e1bd51039d8994d354af3bc699f55c91b46faf50d99`. Mỗi bước create/save/validate/publish có một audit tương ứng.
- Draft nguồn `commercial-draft-7893a1cfb4fc4afaa7455e0ae2de0548` giữ nguyên revision 2/checksum. Hai bản giá mới ghim `personal.internal.yearly` và `personal.connected.yearly` tổng tiền/subtotal 2.000, tax 0; không sửa giá/snapshot của nguồn hoặc lịch sử.
- Backend đã khởi động lại với checkout/activation bật trong process và `DATABASE_AUTO_MIGRATE=false`, quota enforcement giữ nguyên. `/health/ready` HTTP 200. Catalog HTTP 200 trả đúng hai offer Cá nhân 2.000 VND; trình duyệt xác nhận cả tab Cơ bản và Nâng cao hiển thị 2.000đ/Hàng năm, hàng tháng chưa công bố.
- Chưa tạo đơn hoặc chuyển tiền: `billing_orders=0`, `payment_transactions=0`, `billing_subscription_activations=0`. Event mẫu trước đó đã được worker xử lý thành `dead/PROVIDER_REQUEST_FAILED` vì mã order mẫu không có trên payOS; không được gán vào đơn thật hoặc tạo kích hoạt. Đối soát và kích hoạt/gia hạn của giao dịch thật vẫn cần phép thử do chủ sản phẩm thực hiện.

Mẫu khởi tạo trong code dùng giá trị thuế đã xác nhận và chính sách không hoàn tiền; tám giá năm mặc định của mẫu này giữ nguyên. Không suy giá tháng, không reseed hoặc tự sửa bản nháp/đơn/release hiện hữu. Giá thử 2.000 VND chỉ nằm trong release mới nêu trên. Khi chỉnh bản nháp hiện có, áp dụng qua luồng quản trị có revision, digest, tái xác thực và audit như trước.

## Migration strategy và rollback

Không thêm schema hoặc cập nhật dữ liệu lịch sử. Chính sách được xuất bản trong release mới; bản nháp cũ được chỉnh có chủ đích hoặc nhân bản. Khi rollback, dừng checkout mới theo runbook và giữ đối soát/kích hoạt/hoàn tiền của các đơn đã ghim chính sách cũ. Phiên bản rollback phải giữ kiểm tra `no_refunds` tại điểm tạo refund intent; phiên bản billing cũ không hiểu chính sách này không được phục vụ yêu cầu hoàn cho đơn mới đã ghim nó.

## Regression seams

- Tám gói mẫu giữ nguyên giá, thuế bằng 0, cấu hình `ceil`, không hóa đơn; validation shadow đạt và production còn chặn nếu thiếu merchant/webhook/provider thực tế.
- Seed idempotent; bản nháp nguồn giữ các cấu hình đã tùy chỉnh.
- Đơn ghim chính sách không hoàn tiền không tạo refund intent; đơn legacy/chính sách cũ và idempotent replay giữ hành vi hiện tại.
- Trang điều khoản/quyền riêng tư có nội dung thương mại thực tế, không chứa placeholder hoặc secret; không thay quyền đọc dữ liệu.

