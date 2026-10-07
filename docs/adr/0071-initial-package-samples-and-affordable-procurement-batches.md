# ADR 0071 — Gói mẫu ban đầu và xử lý danh sách đủ lượt Mua Sắm Công

- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm và xác nhận cấu hình ngày 2026-10-07.
- Phạm vi: cấu hình bản nháp mẫu, giữ nguyên các bản phát hành và thuê bao hiện hữu.

## Business contract

1. Khi danh sách cần lấy dữ liệu Mua Sắm Công lớn hơn số lượt khả dụng, xử lý các gói đủ lượt theo thứ tự danh sách đã chuẩn hóa. Báo riêng những gói chưa được xử lý do thiếu lượt. Ví dụ chọn 10 gói, còn 6 lượt: xử lý tối đa 6 gói và báo 4 gói chưa xử lý.
2. Bộ mẫu dùng `partialBatch.kind = process_affordable_in_stable_order`, chính sách đã có trong runtime. Giữ cơ chế loại trùng phiên bản nguồn, reservation, consume khi lưu có thẩm quyền, release khi thất bại và idempotency hiện hữu. Các gói không có reservation không được lấy dữ liệu hoặc bị trừ lượt.
3. Yêu cầu bộ mẫu vẫn giữ tám tổ hợp năm: Cá nhân/Bạc/Vàng/Kim cương × Cơ bản/Nâng cao; Cơ bản có quota Mua Sắm Công kèm theo bằng 0. Giá tháng cấu hình sau trong Admin, không suy từ giá năm.
4. Chủ sản phẩm xác nhận kỳ năm 365 ngày (`baseTerm.fixed_days`), gia hạn từ cuối kỳ hiện tại (`renewalAnchor.end_of_term`) và Cá nhân bật ba capability xuất hiện hữu: Word, Excel và Excel kết quả lựa chọn nhà thầu. Quyền xuất tổ chức lấy đúng giá trị của Bạc/Vàng/Kim cương trong `goi_dich_vu`; không có mapping thì vẫn chặn validation. Không tự định nghĩa quyền đọc, masking, role, tenant/module/assignment/record scope hoặc quyền mua.
5. Mỗi gói mẫu có đầy đủ tên, nhóm, chủ sở hữu, giá chưa thuế/thuế/tổng VND, hạn mức thành viên/lượt, quyền xuất, kiểm tra vi phạm, trạng thái bán và metadata trình bày. Giữ các giá/quota năm hiện có trong code; phần thuế của giá mẫu bằng 0 như trước. Đây không phải quyết định thuế/hóa đơn cho vận hành production.

| Quy mô | Cơ bản/năm | Nâng cao/năm | Thành viên | Lượt Nâng cao |
| --- | ---: | ---: | ---: | ---: |
| Cá nhân | 2.490.000 | 3.990.000 | 1 | 1.000 |
| Bạc | 12.000.000 | 15.000.000 | 5 | 3.000 |
| Vàng | 28.000.000 | 35.000.000 | 15 | 7.000 |
| Kim cương | 60.000.000 | 75.000.000 | 50 | 15.000 |

6. `templateMode=complete_templates` tạo tám gói năm có giá/quota và chính sách đã xác nhận. Bảo toàn các cấu hình chung, trường không có biểu mẫu và mapping quyền xuất đã cấu hình của nguồn; chỉ bổ sung các quyết định kỳ năm/gia hạn/batch đang thiếu hoặc `blocked_decision`. Không tự thay chính sách nguồn đã chốt. Các mode `empty`, `blank_templates`, sao chép release mặc định giữ hành vi cũ.

## Compatibility impact

Chính sách áp dụng vào các mẫu được tạo mới từ code. Không ghi đè document/revision/checksum của bản nháp đã có, snapshot bất biến của release, đơn hàng, thuê bao hay ledger. Admin vẫn cần lưu, kiểm tra và phát hành qua session, revision, validation digest, readiness, step-up và audit hiện hữu.

## Migration strategy

Không migration DB và không tự phát hành. First install tiếp tục dùng đường seed hiện hữu với `ON CONFLICT(id) DO NOTHING`. Cơ sở dữ liệu đã khởi tạo giữ nguyên cấu hình; thay đổi chính sách của gói đã mở bán cần bản phát hành mới qua Admin.

Admin có thể tạo bộ mẫu hoàn chỉnh cả khi thiếu seed. Backend đọc quyền xuất tổ chức hiện có trong transaction đã xác thực và tạo draft mới; không thay initial draft hoặc release cũ. Triển khai backend trước frontend dùng mode mới.

## Giới hạn phát hành và vận hành

- Bộ mẫu đạt validation nội bộ ở chế độ shadow với mapping tổ chức thực tế. Phát hành pilot/production vẫn yêu cầu reference thuế/hóa đơn, legal/merchant/webhook và provider live thật; không dùng dữ liệu mẫu giả để vượt cửa này.
- Cấu hình `renewalAnchor.end_of_term` ghi quyết định của chủ sản phẩm; runtime hiện hành vẫn đưa giao dịch trên kỳ đang active sang review. Không bổ sung cơ chế gia hạn tự động trong nhiệm vụ gieo mẫu.
- Projection của release mới hiện chưa cung cấp `legacy_package_id` cho activation. Bộ mẫu hợp lệ không chứng minh việc mua và tự kích hoạt; cần hoàn thiện seam này trước khi mở bán thực tế. Nhiệm vụ này không suy mapping cá nhân sang gói tổ chức khác.

## Regression seams

- Builder sinh policy xử lý phần đủ lượt; validator không còn blocker riêng cho `partialBatch`.
- Tám offer năm có giá/quota/mapping hợp lệ và các chính sách đã xác nhận đạt validation shadow; production thiếu thuế/hóa đơn/provider/reference vẫn bị chặn.
- Seed lặp không thay đổi draft đã chỉnh hoặc lưu trữ, release hay mapping quyền xuất tổ chức đọc từ DB.
- Reservation chọn số gói vừa đủ lượt theo thứ tự ổn định; kết quả báo phần chưa xử lý và không consume các mục không được nhận.
