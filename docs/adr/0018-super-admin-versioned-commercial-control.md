# ADR 0018 — Super Admin xuất bản cấu hình thương mại theo phiên bản

- Trạng thái: Chấp nhận
- Ngày: 2026-08-25

Super Admin là thẩm quyền duy nhất quản lý catalog gói/SKU, giá, quota, kỳ bán, policy mua và chuyển gói, grace/refund, thuế/hóa đơn cùng provider routing. Các giá trị này không nằm trong hằng số frontend/backend mà được tạo dưới dạng bản nháp, kiểm tra/mô phỏng rồi xuất bản thành một release bất biến có thời điểm hiệu lực; storefront, checkout, activation, renewal và quota đều resolve qua cùng mô-đun Chính sách thương mại và ghim release/snapshot đã dùng.

## Ranh giới bắt buộc

- Không tạo role mới. Mutation cấu hình chỉ dành cho phiên Super Admin đang hoạt động, có tái xác thực và audit bắt buộc.
- Policy dùng tập loại/công thức đã đăng ký và kiểm thử; không cho chạy mã, SQL hoặc biểu thức tùy ý. Thêm loại policy, provider protocol hoặc capability mới vẫn cần code, migration, ADR và regression.
- Cấu hình thương mại không được thay đổi masking, dữ liệu hiển thị, role, module permission, assignment scope, record scope hoặc quyền đọc bản ghi.
- Published release, đơn, activation và usage ledger là bất biến. Quay lui bằng cách xuất bản release mới từ release cũ; không sửa hoặc xóa lịch sử.
- Giá, owner, quota và URL do máy chủ resolve. Xác minh provider, idempotency, khóa đồng thời, transaction kích hoạt và audit không phải tùy chọn Super Admin có thể tắt.
- Bí mật provider nằm trong kho bí mật; release chỉ tham chiếu credential profile không bí mật.

## Compatibility impact

- `goi_dich_vu` trở thành projection/adapter tương thích trong giai đoạn chuyển đổi, không còn là nguồn cấu hình chính.
- Thuê bao legacy được backfill vào plan version Kết nối tương ứng và giữ chính xác entitlement/hạn mức đã cam kết, gồm Diamond `999`.
- Ngừng bán một SKU không thu hồi quyền lợi thuê bao hiện hữu. Việc hết hạn/hạ gói không xóa hoặc che dữ liệu của người vẫn có quyền đọc.
- API cấp gói thủ công của Super Admin tiếp tục tồn tại nhưng phải chọn release/plan version, ghi nguồn `admin`, revision, idempotency và audit; không tạo giao dịch thanh toán giả.

## Migration strategy

1. Bổ sung draft/release/policy version và projection mới khi mọi cờ thương mại còn tắt.
2. Tạo release legacy cho các gói hiện hữu, backfill thuê bao và chạy resolver mới ở shadow so với hành vi cũ.
3. Chuyển lần lượt Super Admin, public catalog, checkout, subscription và quota sang mô-đun mới.
4. Tắt endpoint sửa trực tiếp `goi_dich_vu` sau khi shadow/regression đạt; chỉ bỏ projection tương thích ở một migration sau, không xóa lịch sử tài chính.
5. Rollback dừng mutation/checkout mới nhưng tiếp tục xử lý release đã hiệu lực, webhook, đơn đã trả và ledger.

## Regression seams

- draft revision conflict, validate/simulate, schedule/publish/rollback và audit nguyên tử;
- storefront, checkout, worker, renewal và quota resolve cùng release tại cùng thời điểm;
- đơn/thuê bao/grant cũ giữ snapshot khi release mới có hiệu lực;
- mọi role/quyền/phạm vi/hiển thị dữ liệu hiện hữu không đổi;
- secret không xuất hiện trong policy, API, frontend hoặc log.
