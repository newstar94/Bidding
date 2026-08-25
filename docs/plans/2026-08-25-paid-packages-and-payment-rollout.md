# Kế hoạch gói trả phí và thanh toán tự động BiddingFlow

- Ngày cập nhật: 25/08/2026
- Trạng thái: khung thương mại Mua Sắm Công và quyền quản trị cấu hình của Super Admin đã chốt; các giá trị ban đầu phải được xuất bản trong Trung tâm cấu hình thương mại trước khi mở bán
- Tài liệu nền: [Nghiên cứu gói trả phí và tích hợp thanh toán](../research/2026-08-25-paid-plans-and-payment-integration.md)
- Hợp đồng nghiệp vụ: [ADR 0017](../adr/0017-procurement-connection-commercial-boundary.md) và [ADR 0018](../adr/0018-super-admin-versioned-commercial-control.md)

## 1. Mục tiêu

1. Bán gói và lượt lấy hồ sơ trực tuyến; thanh toán thành công thì tự kích hoạt đúng workspace.
2. Định vị bản Kết nối Mua Sắm Công là lựa chọn có lợi nhất cho người dùng thường xuyên, còn bản Nội bộ phù hợp nhu cầu phát sinh ít.
3. Không thay đổi quyền xem dữ liệu, role, module permission, assignment scope, record scope, masking hoặc quyền xuất hiện hành ngoài đúng entitlement đã được duyệt.
4. Thanh toán, cấp gói và trừ lượt phải chống xử lý trùng, có audit, đối soát được và có đường quay lui an toàn.
5. Sau lần triển khai đầu, Super Admin thay đổi được mọi giá trị thương mại được hỗ trợ mà không sửa mã nguồn hoặc triển khai lại ứng dụng.

## 2. Cấu hình thương mại ban đầu đã chốt

Các giá trị trong mục này là bản cấu hình đầu tiên để Super Admin xem trước và xuất bản, không phải hằng số trong mã nguồn. Các đơn hàng và thuê bao luôn ghim đúng phiên bản đã áp dụng tại thời điểm phát sinh.

### 2.1. Hai biến thể

| Quyền lợi | Bản Nội bộ | Bản Kết nối Mua Sắm Công |
|---|---|---|
| Nhập thủ công hoặc Excel | Có | Có |
| Tra cứu/làm giàu thông tin Chủ đầu tư, Nhà thầu | Có, không giới hạn | Có, không giới hạn |
| Lấy hồ sơ Kế hoạch/TBMT/Mở thầu từ Mua Sắm Công | Dùng quota mua thêm | Có quota kèm gói và được mua thêm |
| Kiểm tra, ghi nhận vi phạm Nhà thầu từ nguồn có thẩm quyền | Không | Có, không giới hạn |
| Xem dữ liệu và kết quả đã lưu trong phạm vi quyền | Đầy đủ | Đầy đủ |

Thuê bao và quota thuộc workspace cá nhân hoặc tổ chức, không gắn trực tiếp với vai trò quản lý/chuyên viên và không mở rộng quyền đọc bản ghi.

### 2.2. Giá năm và lượt kèm gói

| Quy mô | Người dùng | Nội bộ/năm | Kết nối/năm | Lượt kèm bản Kết nối |
|---|---:|---:|---:|---:|
| Cá nhân | 1 | 2.490.000đ | 3.990.000đ | 1.000 |
| Bạc | 5 | 12.000.000đ | 15.000.000đ | 3.000 |
| Vàng | 15 | 28.000.000đ | 35.000.000đ | 7.000 |
| Kim Cương | 50 | 60.000.000đ | 75.000.000đ | 15.000 |

Đây là giá pilot, cần đánh giá lại sau 60–90 ngày bằng số liệu sử dụng, chi phí vận hành, tỷ lệ mua và phản hồi của khách hàng trả tiền.

### 2.3. Gói lượt mua thêm

| Gói lượt | Giá | Bình quân |
|---|---:|---:|
| 20 lượt | 99.000đ | 4.950đ/lượt |
| 100 lượt | 399.000đ | 3.990đ/lượt |
| 500 lượt | 1.490.000đ | 2.980đ/lượt |
| 2.000 lượt | 4.490.000đ | 2.245đ/lượt |

Cả Nội bộ và Kết nối đều được mua thêm. Không tăng giá hoặc tạo giới hạn giả để ép người dùng Nội bộ nâng cấp.

### 2.4. Lợi thế bắt buộc của bản Kết nối

| Quy mô | Nội bộ + số lượt tương đương | Kết nối | Tiết kiệm khi chọn Kết nối |
|---|---:|---:|---:|
| Cá nhân | 5.470.000đ | 3.990.000đ | 1.480.000đ — 27,1% |
| Bạc | 19.470.000đ | 15.000.000đ | 4.470.000đ — 23,0% |
| Vàng | 44.450.000đ | 35.000.000đ | 9.450.000đ — 21,3% |
| Kim Cương | 94.410.000đ | 75.000.000đ | 19.410.000đ — 20,6% |

Nguyên tắc giữ giá: tại cùng quy mô, Kết nối không được đắt hơn 80% tổng giá Nội bộ cộng các gói lượt rẻ nhất để đạt số lượt tương đương. Ngoài phần tiết kiệm này, Kết nối còn có kiểm tra vi phạm Nhà thầu không giới hạn.

### 2.5. Cách tính một lượt

- Một lượt là một mã hồ sơ + revision nguồn được lấy thành công và commit thành snapshot.
- Xem trước, nhập hoặc cập nhật từ cùng snapshot không trừ thêm.
- Cache hit, retry nội bộ, timeout, hủy, lỗi nguồn hoặc không có dữ liệu không trừ lượt.
- Khi nhận job, hệ thống giữ chỗ một lượt; thành công mới tiêu thụ, thất bại hoặc hủy thì hoàn giữ chỗ.
- Quota mua thêm thuộc đúng một workspace, không chuyển nhượng; khi nâng Nội bộ lên Kết nối vẫn giữ nguyên số dư đã mua.
- Tra cứu thông tin Chủ đầu tư/Nhà thầu và kiểm tra vi phạm không được tạo bút toán trừ lượt.

### 2.6. Tương thích thuê bao hiện hữu

- Thuê bao Bạc/Vàng/Kim Cương hiện tại được ghim vào phiên bản Kết nối tương ứng khi chuyển đổi để không thu hồi hành vi đang có.
- Diamond có hạn mức kỹ thuật `999` được giữ trong phiên bản cũ đến hết cam kết; chỉ phiên bản bán mới dùng mốc 50 người.
- Hạ gói hoặc hết hạn không xóa, che hoặc đổi dữ liệu và kết quả vi phạm đã lưu của người vẫn có quyền đọc bản ghi.

## 3. Trung tâm cấu hình thương mại cho Super Admin

### 3.1. Quyền quản trị đã chốt

- Chỉ tài khoản đang hoạt động với vai trò nền tảng `super_admin` được tạo bản nháp, kiểm tra, lên lịch, xuất bản, ngừng bán hoặc phục hồi cấu hình thương mại.
- Không tạo role mới và không đưa quyền này vào role quản lý/chuyên viên.
- Backend tái sử dụng `verify_session_in_transaction(..., required_role="super_admin")` và kiểm soát privileged re-auth/network hiện có; không chỉ ẩn nút ở frontend.
- Quyền cấu hình thương mại không cấp quyền đọc bản ghi nghiệp vụ và không thay đổi tenant, module permission, assignment scope, record scope, masking hoặc `document_export_capabilities` hiện hữu.
- Mọi thao tác xuất bản, dừng khẩn cấp, đổi cổng, đổi thuế hoặc hoàn tiền yêu cầu xác thực lại và audit bắt buộc trong cùng transaction.

### 3.2. Những nội dung Super Admin tự cấu hình

| Khu vực | Nội dung được cấu hình |
|---|---|
| Gói và phiên bản | Mã/tên gói, Nội bộ/Kết nối, Cá nhân/Bạc/Vàng/Kim Cương, số người, bật/tắt các entitlement xuất đã tồn tại, quota kèm gói, mô tả và thứ tự hiển thị; không đổi capability nội dung tài liệu |
| Giá và kỳ bán | VND, giá niêm yết, năm/tháng, ngày hiệu lực, ngừng bán mới, nhãn “Khuyên dùng” và ngưỡng lợi ích Kết nối |
| Gói lượt | SKU, số lượt, giá, có được mua lặp, hạn sử dụng, điều kiện cần gói nền và thứ tự tiêu thụ quota |
| Vòng đời thuê bao | Bắt đầu kỳ, gia hạn, nâng/hạ, tính phần chênh, grace period, xử lý thanh toán đến muộn và đơn đang chờ khi cấu hình đổi |
| Thẩm quyền mua | Chủ tài khoản cá nhân; với tổ chức chọn Super Admin hoặc manager hiện hành theo policy đã xuất bản |
| Hoàn tiền | Cho phép/không, toàn phần/một phần, thời hạn, luôn xử lý thủ công hay theo provider; mọi thao tác vẫn có tái xác thực và audit |
| Thuế và hóa đơn | Cách hiển thị thuế, mức thuế/phân loại, giá đã gồm/chưa gồm, thời điểm lập hóa đơn và hồ sơ cấu hình nhà cung cấp hóa đơn |
| Cổng thanh toán | Bật/tắt provider, thứ tự ưu tiên, min/max giao dịch, thời hạn checkout, timeout/retry và merchant/credential profile được phép dùng |
| Quota và cảnh báo | Mốc 70/90/100% hoặc mốc khác, carry-over, expiry, reserve/consume/release và đề nghị nâng cấp |
| Phát hành an toàn | Shadow/pilot/production, nhóm khách được mở, ngày hiệu lực, dừng checkout mới và ngưỡng cảnh báo vận hành |

Super Admin chỉ chọn các policy type mà hệ thống đã hỗ trợ và kiểm thử. Thêm một loại quy tắc, cổng thanh toán hoặc entitlement hoàn toàn mới vẫn cần thay đổi mã nguồn, migration và regression; không cho nhập JavaScript, Python, SQL hoặc biểu thức tùy ý.

### 3.3. Nội dung không được biến thành cấu hình

Các bất biến sau luôn do hệ thống bảo vệ:

- không dùng thuê bao để che dữ liệu của bản ghi mà người dùng vốn được quyền đọc;
- không mở rộng tenant, module, assignment hoặc record scope;
- không tin giá, quota, owner hoặc URL do trình duyệt gửi lên;
- không kích hoạt chỉ dựa vào trang quay về sau thanh toán;
- xác minh provider, chống xử lý trùng, khóa đồng thời và audit nguyên tử là bắt buộc;
- không sửa/xóa bản cấu hình đã xuất bản, đơn đã trả, activation ledger hoặc usage ledger;
- lỗi, retry, cache và preview/import lại không được trừ lượt lấy hồ sơ;
- bí mật cổng thanh toán không được trả về giao diện hoặc lưu dạng đọc được trong bảng cấu hình.

### 3.4. Vòng đời cấu hình

```text
BẢN NHÁP → ĐÃ KIỂM TRA → ĐÃ LÊN LỊCH → ĐANG HIỆU LỰC → ĐÃ NGỪNG
     └──────────── sửa/kiểm tra lại ────────────┘
```

1. Super Admin sao chép bản đang hiệu lực thành một bản nháp mới.
2. Chỉnh sửa bằng biểu mẫu có kiểu dữ liệu rõ ràng; không sửa trực tiếp bản đang chạy.
3. Hệ thống kiểm tra toàn bộ catalog/policy và sinh báo cáo tác động.
4. Super Admin xem chênh lệch, thử các tình huống mẫu, xác thực lại rồi chọn “Xuất bản ngay” hoặc ngày giờ hiệu lực.
5. Tại thời điểm hiệu lực, toàn bộ storefront/checkout/renewal/quota cùng chuyển sang một release; không có trạng thái nửa cũ nửa mới.
6. Muốn quay lui, sao chép release trước thành release mới rồi xuất bản. Release cũ và mọi chứng từ tham chiếu nó vẫn bất biến.

Mỗi release có mã phiên bản, checksum, người tạo/người xuất bản, thời điểm hiệu lực, lý do thay đổi và liên kết tới release nguồn. Chỉ một release được hiệu lực cho cùng thị trường/phạm vi tại một thời điểm.

### 3.5. Kiểm tra trước khi xuất bản

Nút “Xuất bản” chỉ mở khi tất cả kiểm tra bắt buộc đạt:

- đủ cặp quy mô × biến thể định bán; SKU không trùng và giá/quota là số hợp lệ;
- thời gian hiệu lực không chồng lấn; không sửa hồi tố chứng từ đã phát sinh;
- giá Kết nối đạt ngưỡng lợi ích do Super Admin cấu hình hoặc có xác nhận bỏ qua cảnh báo kèm lý do;
- quyền lợi chỉ dùng capability thương mại có trong allowlist; không có khóa lạ tác động quyền đọc dữ liệu;
- policy nâng/hạ/gia hạn/expiry không mâu thuẫn nhau;
- cấu hình thuế/hóa đơn có trạng thái phê duyệt và ngày hiệu lực;
- provider được bật có credential profile, webhook, merchant và health check hợp lệ;
- báo cáo chỉ rõ thuê bao hiện hữu, đơn đang chờ, renewal tương lai và landing page bị ảnh hưởng thế nào;
- ít nhất các kịch bản Cá nhân/Tổ chức, Nội bộ/Kết nối, mua mới/gia hạn/nâng/hạ và mua lượt đều resolve được kết quả xác định.

### 3.6. Giao diện Super Admin

Thêm tab **“Thương mại & Thanh toán”** với sáu khu vực:

1. **Tổng quan:** release đang chạy/sắp chạy, doanh thu thực thu, đơn lỗi, quota đã bán và cảnh báo.
2. **Gói & Giá:** trình dựng 4 quy mô × 2 biến thể, kỳ bán, quyền lợi, giá và bản xem trước trang giá.
3. **Lượt Mua Sắm Công:** SKU lượt, hạn dùng, mua lặp, thứ tự trừ và mô phỏng chi phí Nội bộ/Kết nối.
4. **Chính sách thuê bao:** thẩm quyền mua, gia hạn, nâng/hạ, grace, đơn đến muộn và hoàn tiền.
5. **Thanh toán, Thuế & Hóa đơn:** provider profile, giới hạn, trạng thái webhook, cách hiển thị thuế và thời điểm hóa đơn.
6. **Bản nháp & Lịch sử:** diff, impact preview, validate, schedule, publish, clone/rollback và audit.

Các thay đổi được autosave vào bản nháp theo revision. Hai cửa sổ sửa cùng lúc phải phát hiện xung đột; không để lần lưu sau ghi đè im lặng. Mọi nút chờ mạng dùng loading chung toàn ứng dụng.

### 3.7. Mô-đun và interface đề xuất

Đặt một seam duy nhất quanh mô-đun **Chính sách thương mại**. Storefront, checkout, activation, renewal và quota không tự đọc nhiều bảng hoặc tự diễn giải policy.

Interface runtime nhỏ:

```text
resolve_offer(context, at) -> catalog + allowed_actions + release_id
evaluate_commercial_command(command, context, at) -> decision + pinned_snapshot
```

Interface quản trị:

```text
save_draft(draft_id, expected_revision, changes) -> draft
validate_draft(draft_id) -> errors + warnings + impact_preview
publish_draft(draft_id, expected_revision, effective_at, reason) -> release
```

Implementation ẩn việc chọn release theo thời gian, kiểm tra catalog, tính giá/quota, policy vòng đời, pin snapshot, cache/invalidate và ghi audit. payOS/hóa đơn/kho bí mật là adapter tại seam ngoài; test dùng adapter giả.

HTTP adapter dự kiến:

| Endpoint | Mục đích |
|---|---|
| `GET /api/commercial/admin/overview` | Release hiện tại/sắp tới, draft, readiness và cảnh báo |
| `POST /api/commercial/drafts` | Tạo draft từ release hiện tại hoặc lịch sử |
| `PATCH /api/commercial/drafts/{id}` | Lưu thay đổi với `If-Match`/expected revision |
| `POST /api/commercial/drafts/{id}/validate` | Validate, mô phỏng và sinh digest/impact report |
| `POST /api/commercial/drafts/{id}/publish` | Tái xác thực, publish/schedule đúng digest đã kiểm tra |
| `POST /api/commercial/releases/{id}/clone` | Tạo draft khôi phục từ release cũ |
| `POST /api/commercial/releases/{id}/stop-sales` | Dừng bán mới có lý do; không thu hồi quyền lợi đã ghim |
| `GET /api/public/commercial/offers` | Catalog công khai của release đang hiệu lực |
| `POST /api/billing/quotes` | Báo giá phía máy chủ và trả decision snapshot có thời hạn |

Mutation dùng CSRF, idempotency/revision và session revalidation; frontend không gửi hoặc diễn giải policy document đã xuất bản như nguồn có thẩm quyền.

### 3.8. Dữ liệu cần bổ sung

| Nhóm bảng | Vai trò |
|---|---|
| `commercial_drafts` | Bản nháp có revision, người sửa và nội dung chưa hiệu lực |
| `commercial_releases` | Snapshot bất biến đã/sắp xuất bản, thời gian hiệu lực, checksum và provenance |
| `billing_plan_versions` | Phiên bản gói, biến thể, quy mô, quota, entitlement và trạng thái bán |
| `billing_prices` | Giá/kỳ/tiền tệ/thuế theo plan version |
| `billing_skus` | Mã mua gói chính hoặc gói lượt; quantity và repeatable policy |
| `commercial_policy_versions` | Policy có schema version cho mua, vòng đời, quota, refund, thuế và provider routing |
| `payment_provider_profiles` | Metadata không bí mật, giới hạn và tham chiếu credential profile |
| `commercial_publication_audit` | Diff, impact report, lý do, xác thực lại và kết quả publish |

Core field tài chính dùng cột có kiểu dữ liệu và ràng buộc; policy document chỉ chứa các trường theo schema version đã biết. Không dùng một bảng key/value tự do làm nguồn sự thật.

Order, subscription, quota grant và hóa đơn phải ghim `release_id`, `plan_version_id`, `price_id`, `sku_id` và policy version liên quan. Khi Super Admin xuất bản release mới, giao dịch cũ không tự đổi giá/quyền lợi.

### 3.9. Các seam mã nguồn hiện tại cần thay

- [tab_superadmin.html](../../views/tabs/tab_superadmin.html) và `SystemUserView.js` đang chứa thẻ/tính năng gói cố định; thay bằng màn hình lấy catalog/release từ máy chủ.
- `POST /api/system-packages/update` trong [auth_routes.py](../../backend/auth/auth_routes.py) đang sửa trực tiếp `goi_dich_vu`; chuyển thành tạo/cập nhật bản nháp rồi publish release bất biến.
- `GET /api/public/packages` đang đọc bảng mutable; chuyển sang read model của release đang hiệu lực, có ETag/cache theo `release_id`.
- [subscription_policy.py](../../backend/shared/subscription_policy.py) đang join trực tiếp `goi_dich_vu`; subscription phải pin plan version và dùng mô-đun Chính sách thương mại.
- Không dùng `goi_dich_vu.trang_thai` làm nút “Ngừng bán mới” vì hiện nó làm thuê bao active mất entitlement; thêm sales state riêng và giữ kill-switch cũ đúng semantics hiện hành cho tới khi có quyết định thay đổi riêng.
- `renew` trong [org_routes.py](../../backend/api/org_routes.py) và frontend đang mặc định 365 ngày; thay bằng kỳ/policy đã xuất bản.
- Tạo mô-đun riêng dưới `backend/commercial_policy/` và tab riêng dưới `frontend/commercial-policy/`; không nhồi logic mới vào route xác thực hoặc màn quản lý người dùng.
- Draft/release là cấu hình toàn hệ thống, đọc trực tiếp từ máy chủ; không đưa vào workspace sync, IndexedDB hoặc outbox offline của dữ liệu nghiệp vụ.
- Trang giá công khai và dashboard bỏ giả định chỉ có ba thẻ Silver/Gold/Diamond, render từ projection của release đang hiệu lực.
- Giữ đường cấp gói thủ công cho Super Admin nhưng mọi thay đổi phải chọn plan version/SKU, nguồn `admin`, revision/idempotency và audit; không tạo đơn thanh toán giả.

## 4. Trải nghiệm bán hàng

1. Trang giá cho chọn quy mô trước, sau đó so sánh Nội bộ và Kết nối cạnh nhau.
2. Kết nối mang nhãn **“Khuyên dùng”** và hiển thị khoản chênh bình quân tháng, giá trị lượt được kèm cùng số tiền tiết kiệm thực tế.
3. Nội dung chính dùng cách nói gần gũi, ví dụ: “Khi thanh toán năm, phần chênh quy đổi chỉ 125.000đ/tháng; có 1.000 lượt/năm và kiểm tra vi phạm không giới hạn”.
4. Khi chi phí lượt người dùng Nội bộ đã mua hoặc dự kiến cần mua chạm phần chênh giá gói, hiển thị phép tính thật và nút nâng cấp.
5. Cảnh báo số dư tại 70%, 90% và 100%; hết lượt vẫn thấy chức năng lấy hồ sơ cùng lựa chọn mua thêm hoặc nâng cấp.
6. Lựa chọn gói/kỳ/workspace được giữ qua bước đăng nhập, nhưng giá và quyền kích hoạt luôn do máy chủ xác định.
7. Trong lúc tạo đơn, chờ xác nhận và kích hoạt, dùng màn loading chung của toàn ứng dụng.
8. Không dùng đếm ngược giả, khuyến mại giả, che lựa chọn Nội bộ hoặc làm yếu chức năng để ép nâng cấp.

## 5. Phạm vi MVP đề xuất

### Có trong MVP

- Trung tâm cấu hình thương mại cho Super Admin với draft, validate, impact preview, schedule, publish và clone release cũ để quay lui;
- mọi giá, quota, kỳ bán, authority mua, policy vòng đời, thuế/hóa đơn và provider routing trong phạm vi được hỗ trợ đều lấy từ release, không lấy từ hằng số frontend/backend;
- danh mục phiên bản gói và giá bất biến;
- mua mới/gia hạn một lần bằng payOS hosted checkout;
- mua gói lượt và tự cộng đúng workspace sau thanh toán;
- số dư, lịch sử sử dụng, cảnh báo quota và đề nghị nâng cấp;
- lịch sử đơn, trạng thái thanh toán/kích hoạt và hóa đơn theo quy tắc kế toán được duyệt;
- màn đối soát cho Super Admin, hoàn tiền thủ công có tái xác thực và audit;
- cổng giả để kiểm thử, payOS chạy shadow trước khi tự kích hoạt;
- theo dõi giao dịch, retry, cảnh báo và runbook sự cố.

### Chưa đưa vào MVP

- trình chạy mã/quy tắc tự do; Super Admin chỉ dùng các policy type đã được kiểm thử;
- tự động trừ tiền định kỳ;
- dùng thử 14 ngày;
- tự mua thêm chỗ ngồi;
- AI hoặc chức năng còn shadow/pilot làm điểm khác biệt trả phí;
- người dùng tự tạo tổ chức;
- cổng thanh toán thứ hai;
- Trung tâm hồ sơ, lịch ngoài ứng dụng hoặc tác vụ hàng loạt đã được loại bỏ.

Khuyến nghị chỉ bán kỳ năm trong pilot đầu tiên. Nếu mở kỳ tháng, đó vẫn là một checkout mới mỗi tháng ở giai đoạn payOS, không được quảng cáo là tự động gia hạn.

## 6. Luồng thanh toán chuẩn

1. Người có thẩm quyền chọn workspace, gói hoặc gói lượt.
2. Máy chủ lấy SKU và giá đang hiệu lực, ghim đúng owner rồi tạo đơn có khóa chống trùng.
3. Máy chủ gọi payOS ngoài transaction và trả hosted checkout URL đã kiểm tra.
4. payOS gửi webhook; BiddingFlow kiểm tra chữ ký, lưu sự kiện vào hộp thư bền vững rồi trả phản hồi nhanh.
5. Worker truy vấn lại payOS để xác nhận merchant, mã đơn, trạng thái và số tiền.
6. Một transaction nguyên tử khóa đơn + thuê bao/quota, ghi thanh toán, kích hoạt, audit bắt buộc và outbox thông báo.
7. Giao diện nhận trạng thái bằng poll/WebSocket, làm mới session rồi hiển thị gói hoặc số dư mới.

Trang người dùng quay lại sau thanh toán chỉ dùng để hiển thị. Query trên URL không bao giờ là bằng chứng đã trả tiền.

## 7. Kế hoạch thực hiện đã chỉnh sửa

### Giai đoạn 0 — đóng khung policy type và hợp đồng quản trị, 2–4 ngày

- ghi ADR về quyền xuất bản của Super Admin, cấu hình bất biến và các invariant không được cấu hình phá vỡ;
- đóng schema version đầu tiên cho catalog, pricing, authority, transition, delinquency, refund, tax/invoice, usage credit và provider routing;
- xác định lựa chọn được hỗ trợ cho từng policy, mã lỗi và kịch bản mô phỏng bắt buộc;
- lập bản cấu hình đầu tiên từ mục 2 nhưng chưa cho hiệu lực;
- song song lấy hồ sơ pháp lý/thuế/hóa đơn và điều khoản payOS để Super Admin nhập profile thực tế trước khi mở bán.

**Điều kiện hoàn thành:** thay đổi giá trị trong tập policy được hỗ trợ không còn đòi sửa code; loại policy mới vẫn có quy trình bổ sung rõ ràng.

### Giai đoạn 1 — nền tảng dữ liệu tương thích, 5–7 ngày

- migration cộng thêm cho draft/release/policy version, plan/price/SKU, provider profile, order/items, transaction, webhook inbox và activation ledger;
- bảng grant, reservation và ledger cho lượt Mua Sắm Công;
- backfill thuê bao hiện tại vào plan version Kết nối bất biến, không đổi entitlement; giữ Diamond legacy `999`;
- `goi_dich_vu` trở thành projection/adapter tương thích trong chuyển đổi, không còn là nguồn cấu hình chính;
- thêm cờ triển khai, mặc định tắt checkout, publish tự động, activation và enforcement quota.

**Điều kiện hoàn thành:** ứng dụng cũ chạy được trên schema mới; regression xác nhận quyền, dữ liệu và entitlement không đổi.

**Quay lui:** tắt cờ và tiếp tục chạy projection cũ; không xóa release, ledger hoặc down migration dữ liệu tài chính.

### Giai đoạn 2A — mô-đun Chính sách thương mại và API quản trị, 5–8 ngày

- triển khai `resolve_offer`, `evaluate_commercial_command`, draft/validate/publish;
- compiler/validator cho các policy type, chọn release theo thời gian và decision snapshot;
- optimistic revision, checksum, diff, impact preview, schedule và audit/outbox nguyên tử;
- projection/cache theo release và invalidation sau publish;
- test thời điểm hiệu lực, xung đột draft, policy mâu thuẫn và rollback bằng release mới.

### Giai đoạn 2B — giao diện Trung tâm cấu hình, 5–7 ngày

- sáu khu vực tại mục 3.6, bản xem trước trang giá và bộ mô phỏng tình huống;
- form theo schema, lỗi ngay tại trường, cảnh báo tác động và checklist trước publish;
- tái xác thực cho thao tác nhạy cảm; loading chung toàn ứng dụng;
- dừng bán mới tách rõ với khóa khẩn cấp để không vô tình thu hồi quyền lợi hiện hữu.

### Giai đoạn 2C — quota Mua Sắm Công, 4–6 ngày

- số dư theo workspace và provenance `plan|purchase|admin`;
- reserve/consume/release, expiry/carry-over/consumption order theo policy đã pin;
- ghim cùng mã + revision để cache/retry/preview/import không trừ hai lần;
- shadow ghi nhận số lượt dự kiến trước khi bật enforcement;
- test đồng thời để không âm số dư.

Ba nhánh 2A/2B/2C có thể chia workstream, nhưng 2B dùng hợp đồng API của 2A.

### Giai đoạn 3A — module thanh toán với cổng giả, 5–7 ngày

- tạo/xem/hủy đơn từ decision snapshot, không nhận giá hoặc quota từ client;
- tách trạng thái thanh toán khỏi trạng thái kích hoạt;
- transaction kích hoạt subscription hoặc grant đúng loại SKU, audit bắt buộc và outbox;
- kiểm thử sự kiện trùng, sai thứ tự, timeout, thiếu/thừa tiền và race với Super Admin/policy release.

### Giai đoạn 3B — payOS chạy shadow, 4–6 ngày

- adapter create/get/cancel/verify và provider profile do Super Admin chọn;
- chữ ký đúng cách chuẩn hóa của payOS và xác thực response truy vấn theo tài liệu;
- webhook inbox, worker retry/reconcile và giao dịch thật giá trị nhỏ;
- nhận, kiểm tra và đối soát nhưng chưa tự cấp gói.

### Giai đoạn 3C — giao diện mua gói và quản lý thuê bao, 5–7 ngày

- storefront render hoàn toàn từ release, nhãn Khuyên dùng và phép tính tiết kiệm;
- giữ lựa chọn qua đăng nhập; chọn đúng workspace;
- hosted checkout, loading chung, poll/WebSocket và refresh session;
- lịch sử đơn, số dư/cảnh báo quota, CTA nâng cấp và màn đối soát Super Admin.

### Giai đoạn 4 — xuất bản release đầu tiên và pilot cá nhân, tối thiểu 7 ngày quan sát

- mở cho nhóm nhỏ tài khoản cá nhân;
- chạy đủ Nội bộ, Kết nối và mua gói lượt;
- tối thiểu 20 giao dịch thành công;
- không có lệch owner, số tiền, SKU, quota hoặc entitlement;
- 100% sự kiện trùng xử lý idempotent;
- 100% giao dịch đã trả được kích hoạt hoặc đưa vào review trong 60 giây;
- ít nhất 7 ngày không có lỗi đối soát nghiêm trọng.

**Quay lui:** dừng checkout mới; tiếp tục nhận webhook, đối soát và phục vụ mọi quyền lợi đã thanh toán.

### Giai đoạn 5 — thanh toán tổ chức, 3–5 ngày sau pilot

- chỉ mở cho tổ chức có sẵn;
- kiểm tra đúng authority profile mà Super Admin đã xuất bản;
- kiểm thử tenant, đổi role sau thanh toán, tổ chức bị khóa và race với thao tác Admin;
- không tự ghi đè khi subscription revision đã thay đổi; chuyển `REVIEW_REQUIRED`.

### Giai đoạn 6 — gia hạn và nâng cấp, 3–5 ngày

- gia hạn bằng checkout một lần;
- nâng từ Nội bộ lên Kết nối giữ nguyên lượt đã mua;
- chỉ mở nâng/hạ khi policy tương ứng đã được Super Admin xuất bản và bộ mô phỏng/regression đạt;
- hạ gói không xóa hoặc che dữ liệu đã lưu.

### Giai đoạn 7 — tự động gia hạn, ngoài MVP

- chỉ thực hiện khi có nhu cầu thực và hợp đồng MoMo Subscription;
- ủy quyền rõ ràng, token hóa, nhắc trước kỳ, retry và hủy;
- ước tính thêm 2–4 tuần cùng thời gian onboarding/UAT của MoMo.

**Ước tính:** một kỹ sư cần khoảng 35–52 ngày làm việc cho Giai đoạn 0–3 và phần hoàn thiện pilot, chưa tính pháp lý, merchant onboarding và 7 ngày quan sát. Với 2–3 workstream và hợp đồng interface ổn định, có thể rút xuống khoảng 25–38 ngày; không tính bằng cách bỏ validate, audit hoặc shadow.

## 8. Kiểm thử và tiêu chí nghiệm thu bắt buộc

### Cấu hình thương mại

- chỉ `super_admin` đang hoạt động và đã tái xác thực được publish/schedule/stop/rollback;
- manager/employee và Super Admin đang chọn vai trò hoạt động khác không thể gọi mutation quản trị;
- hai cửa sổ cùng sửa một draft trả xung đột revision, không ghi đè im lặng;
- release thiếu SKU, trùng khoảng hiệu lực, rule mâu thuẫn, capability lạ, thiếu tax/provider profile hoặc secret reference không được publish;
- publish tạo release + audit + outbox nguyên tử; audit lỗi thì không có release nửa vời;
- đúng thời điểm hiệu lực, storefront/checkout/renewal/quota cùng resolve một `release_id`;
- order/subscription/grant cũ giữ nguyên snapshot khi release mới được xuất bản;
- ngừng bán SKU không thu hồi thuê bao hiện hữu; quay lui tạo release mới, không sửa/xóa lịch sử;
- public API, checkout và worker trả cùng giá/quota/policy cho cùng context/thời điểm;
- cấu hình thương mại không thể sinh field filter, masking, role, module permission, assignment hoặc record scope.

### Nghiệp vụ gói và quyền

- đúng tám tổ hợp quy mô/biến thể, giá, số người và quota đã chốt;
- Nội bộ có quota mua thì lấy được hồ sơ; không quota thì chỉ hành động mới bị dừng;
- Kết nối có quota kèm gói và kiểm tra vi phạm không giới hạn;
- tra cứu Chủ đầu tư/Nhà thầu không giới hạn ở cả hai bản và không trừ lượt;
- hết hạn/hạ gói không che dữ liệu hoặc kết quả vi phạm đã lưu;
- tenant, module, assignment, record scope và `document_export_capabilities` giữ nguyên.

### Quota

- đúng một mã + revision thành công chỉ trừ một lượt;
- cache, preview/import lại, retry, timeout, hủy hoặc lỗi không trừ lượt;
- hai job đồng thời không làm âm số dư;
- quota cá nhân không dùng cho tổ chức và ngược lại;
- nâng gói giữ nguyên grant đã mua.

### Thanh toán

- sửa giá trên trình duyệt không thay đổi giá máy chủ;
- webhook giả/trùng/sai thứ tự/đến chậm chỉ kích hoạt một lần;
- redirect giả không kích hoạt;
- số tiền, currency, merchant, order và provider phải khớp;
- audit/outbox lỗi làm transaction kích hoạt rollback nhưng sự kiện vẫn còn để retry;
- không lưu số thẻ, CVV, mật khẩu ngân hàng hoặc OTP;
- secret không xuất hiện trong JavaScript, response hoặc log.

### Giao diện và vận hành

- loading đồng bộ với toàn ứng dụng và không khóa màn hình vô thời hạn;
- trạng thái chờ, thành công, thất bại và review có lời giải thích dễ hiểu;
- mobile, mất mạng giữa checkout và quay lại muộn vẫn hiển thị đúng trạng thái;
- cảnh báo đơn chờ quá lâu, webhook backlog, provider 429/5xx và paid-not-applied;
- có runbook xoay khóa, sự cố cổng, đối soát, hoàn tiền và dừng bán khẩn cấp.

## 9. Cấu hình và điều kiện phải hoàn tất trước khi mở bán

Các nội dung trước đây là “câu hỏi cần chốt” nay trở thành trường cấu hình của release. Mã nguồn chỉ thực thi policy type đã hỗ trợ. Bản đầu nên được Super Admin tạo với các giá trị khuyến nghị sau:

| Nhóm | Giá trị khuyến nghị ban đầu | Super Admin có thể đổi bằng release mới |
|---|---|---|
| Kỳ mở bán | Chỉ năm | Bật thêm tháng khi đã có giá và nội dung hiển thị |
| Mua cho tổ chức | Chỉ Super Admin | Cho phép manager hiện hành khi muốn mở self-service |
| Nâng gói | Chuyển sang kỳ mới; trường hợp có kỳ đang dùng đưa review | Chọn công thức đã hỗ trợ như cuối kỳ hoặc tính theo ngày |
| Hạ gói | Chưa mở self-service | Bật hạ cuối kỳ khi policy và kiểm thử đạt |
| Grace period | 0 ngày | Chọn số ngày và quyền hành động được giữ trong grace; không đổi quyền đọc bản ghi |
| Thanh toán muộn/thiếu/thừa | `REVIEW_REQUIRED`, không tự kích hoạt | Chọn action đã hỗ trợ trong giới hạn an toàn |
| Hoàn tiền | Thủ công, tái xác thực và audit | Cấu hình cửa sổ, toàn phần/một phần và provider hỗ trợ |
| Tạo tổ chức | Tắt | Bật khi luồng onboarding và authority đã nghiệm thu |
| Quota kèm gói | Hết cùng kỳ, không tự cộng dồn | Chọn carry-over/expiry trong giới hạn đã hỗ trợ |
| Quota mua thêm | 365 ngày, cần gói nền còn hiệu lực, được mua lặp | Đổi hạn, điều kiện dùng, repeatable và thứ tự tiêu thụ |
| Lợi ích Kết nối | Cảnh báo/chặn dưới 20% | Chọn ngưỡng và có lý do khi override cảnh báo |
| Provider | payOS, chế độ shadow trước | Bật/tắt/routing theo profile đã health check |

Trước khi nút “Xuất bản production” được phép hoạt động, vẫn phải có dữ kiện bên ngoài mà phần mềm không thể tự tạo:

- người có trách nhiệm xác nhận phân loại VAT, giá đã gồm/chưa gồm thuế và thời điểm lập hóa đơn;
- hợp đồng/merchant payOS xác nhận SLA, giới hạn, retry, đối soát, hỗ trợ và quy trình hoàn tiền;
- credential profile đã được cài trong kho bí mật, webhook xác minh thành công và health check đạt;
- thủ tục thương mại điện tử, dữ liệu cá nhân và mẫu điều khoản bán hàng đã được xác nhận;
- release đầu tiên đã qua validate, impact preview, mô phỏng bắt buộc và tái xác thực Super Admin.

Thay đổi các giá trị trên về sau không cần sửa code. Thêm policy type, provider protocol, công thức mới hoặc capability mới vẫn là thay đổi sản phẩm cần code, migration, ADR và regression.

## 10. Định nghĩa hoàn thành

MVP chỉ được coi là hoàn thành khi:

- release đầu tiên tại mục 9 đã được Super Admin xuất bản từ bản nháp hợp lệ;
- không còn giá, quota, thời hạn 365 ngày, authority mua hoặc policy vòng đời bị rải dưới dạng hằng số ở frontend/backend;
- migration và backfill bảo toàn chính xác thuê bao/quyền hiện hữu;
- bản đang hiệu lực là bất biến; order/subscription/grant pin đúng release và snapshot;
- toàn bộ test nghiệp vụ, bảo mật, đồng thời và E2E đạt;
- giao dịch pilot đạt điều kiện thoát tại Giai đoạn 4;
- thủ tục thương mại điện tử, dữ liệu cá nhân, thuế và hóa đơn đã được người có trách nhiệm xác nhận;
- có thể dừng checkout mới mà vẫn xử lý an toàn mọi giao dịch đã tạo hoặc đã thanh toán.
