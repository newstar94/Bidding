# ADR 0017 — Ranh giới thương mại tra cứu đối tác và kiểm tra vi phạm

- Trạng thái: Chấp nhận
- Ngày: 2026-08-25
- Phạm vi: biến thể gói Nội bộ/Kết nối Mua Sắm Công, tra cứu Chủ đầu tư/Nhà thầu và kiểm tra vi phạm nhà thầu

## Quyết định

1. Tra cứu thông tin Chủ đầu tư và Nhà thầu là chức năng dùng chung, không giới hạn lượt cho cả bản Nội bộ và bản Kết nối Mua Sắm Công. Tra cứu này không bị đưa vào quota lấy hồ sơ đấu thầu và không bao gồm đánh giá vi phạm.
2. Kiểm tra và ghi nhận tình trạng vi phạm của Nhà thầu chỉ thuộc bản Kết nối Mua Sắm Công, nhưng không giới hạn lượt. Kết quả phải đến từ nguồn/rule có thẩm quyền; người dùng không tự gán nhãn “vi phạm”.
3. Bản Nội bộ vẫn nhập thủ công hoặc Excel, không kèm quota lấy hồ sơ Kế hoạch/TBMT/Mở thầu nhưng được khởi tạo lần lấy mới khi workspace còn quota đã mua. Bản Nội bộ không được chạy kiểm tra vi phạm. Bản Kết nối kèm quota lấy hồ sơ và được kiểm tra vi phạm không giới hạn.
4. Ranh giới thương mại gắn với subscription của workspace, không gắn với vai trò `manager`/`employee`. Người dùng vẫn phải vượt qua tenant, module, assignment và record authorization hiện hành trước khi thao tác.
5. Một lượt chỉ được tiêu thụ khi lấy thành công một mã + revision hồ sơ nguồn. Preview/import/update từ cùng snapshot, cache hit, retry nội bộ, timeout hoặc lỗi nguồn không tạo lượt mới.

## Business contract

- Khi gói hết hạn hoặc hạ từ Kết nối xuống Nội bộ, dữ liệu và trạng thái vi phạm đã được ghi trước đó vẫn hiển thị đầy đủ cho người vốn có quyền đọc bản ghi; chỉ hành động lấy/kiểm tra mới bị dừng.
- Không thay đổi role, module permission, assignment scope, record scope, masking hoặc `document_export_capabilities`.
- Tra cứu thông tin đối tác không được âm thầm gọi mô-đun vi phạm để biến chức năng chung thành chức năng trả phí.
- “Không giới hạn” vẫn chịu giới hạn chống lạm dụng, bảo vệ nguồn ngoài và capacity kỹ thuật; các giới hạn này không được biến thành quota thương mại ngầm.
- Quota mua thêm thuộc đúng workspace, không chuyển giữa cá nhân/tổ chức và không mở rộng quyền đọc bản ghi.
- Nâng từ Nội bộ lên Kết nối bảo toàn toàn bộ quota đã mua; quota kèm gói và quota mua thêm vẫn là hai quyền lợi có nguồn gốc riêng.

## Compatibility impact

- Các gói Bạc/Vàng/Kim Cương hiện hữu được ánh xạ sang biến thể Kết nối tương ứng khi cutover để không thu hồi chức năng kiểm tra vi phạm đang có. Biến thể Nội bộ chỉ áp dụng cho plan version mới.
- API tra cứu thông tin Chủ đầu tư/Nhà thầu giữ hành vi hiện tại và không phát sinh usage debit.
- Kết quả vi phạm đã lưu không bị xóa, che hoặc đổi thành `NOT_CHECKED` khi subscription thay đổi.

## Migration và rollout

- Plan version bổ sung entitlement kiểm tra vi phạm và quota kèm theo cho lấy hồ sơ; quota mua thêm được ghi bằng grant/ledger riêng. Không tạo entitlement hoặc usage debit cho tra cứu thông tin đối tác.
- Backfill subscription hiện hữu vào plan version Kết nối tương ứng. Chỉ mở bán bản Nội bộ sau khi frontend/backend gate cùng một contract và regression đạt.
- Cutover qua feature flag/shadow telemetry; không dùng deployment flag `PROCUREMENT_LOOKUP_ENABLED` thay cho subscription entitlement.

## Regression seams

- Cả Nội bộ và Kết nối tra cứu Chủ đầu tư/Nhà thầu không giới hạn, không trừ quota;
- Nội bộ không quota bị từ chối lấy hồ sơ; mua quota thì lấy được và trừ đúng một lượt thành công;
- Nội bộ bị từ chối khi khởi tạo kiểm tra vi phạm nhưng vẫn xem trạng thái đã lưu;
- Kết nối chạy kiểm tra vi phạm không giới hạn và không trừ quota lấy hồ sơ;
- hạ gói không xóa/che dữ liệu hoặc trạng thái vi phạm;
- role/module/assignment/record scope vẫn được kiểm tra giống trước cutover;
- preview/import cùng snapshot, retry, cache hit và lỗi nguồn ngoài không tạo usage debit hoặc tự gán trạng thái vi phạm.
