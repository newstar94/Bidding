# ADR-012: Preview nhanh và enrichment nền cho kế hoạch Mua Sắm Công

## Trạng thái

Đã chấp thuận và triển khai.

## Bối cảnh

Một kế hoạch lớn như `PL2600150284` có thể liên kết nhiều thông báo mời thầu. Nếu request chuẩn bị kế hoạch chờ tải đầy đủ từng TBMT, một notice chậm có thể làm hết hạn toàn bộ request dù dữ liệu kế hoạch đã sẵn sàng.

## Quyết định

- Giai đoạn chuẩn bị trả về preview kế hoạch và import session nhanh, với `previewMode=QUICK` và `enrichmentStatus=PENDING` khi còn TBMT liên kết.
- Enrichment chạy trong operation nền có idempotency theo session/workspace, trạng thái và tiến độ từng notice.
- Số worker và deadline mỗi notice bị giới hạn; lỗi một notice tạo trạng thái `PARTIAL` và warning rõ ràng, không làm mất dữ liệu kế hoạch.
- Khi hoàn tất, worker cập nhật canonical bundle của chính import session theo organization/user/workspace scope. Worker stale hoặc session đã hủy không được ghi đè.
- Preview kế hoạch vẫn hiển thị để người dùng theo dõi tiến độ, nhưng revision draft của kế hoạch không được đọc hoặc materialize khi enrichment còn `PENDING`/`RUNNING`.
- Chỉ operation `COMPLETED` mới mở khóa revision draft. `PARTIAL`/`FAILED` phải báo rõ và yêu cầu chuẩn bị lại, không được âm thầm tạo gói thiếu trạng thái, quyết định HSMT, bảo đảm dự thầu hoặc hàng hóa.
- Cả luồng wizard và checkbox lấy từ MSC đều phải đợi operation hoàn tất rồi mới đọc lại revision draft đã enriched.

## Tương thích và di chuyển

- Không đổi role, permission, tenant isolation, record scope hoặc semantics hiển thị dữ liệu đã được cấp quyền.
- Không cần migration schema mới; operation và import session hiện hữu được tái sử dụng. Các session cũ tiếp tục hoạt động như trước.
- Client cũ vẫn nhận `importSession`; các trường trạng thái enrichment chỉ là metadata bổ sung.
- Client cũ cố đọc draft khi enrichment chưa hoàn tất nhận lỗi `PROCUREMENT_ENRICHMENT_PENDING` thay vì một draft thiếu dữ liệu.

## Kiểm thử hồi quy

- Route test xác nhận linked notice dùng quick mode và operation id không lộ context nội bộ.
- Service/import tests giữ nguyên kết quả canonical và kiểm tra warning partial.
- Service test xác nhận session `PENDING` không thể phát draft chưa enrichment.
- JS tests xác nhận nút áp dụng và luồng checkbox chỉ đọc draft sau khi operation `COMPLETED`.

## Bổ sung 2026-08-16: giới hạn song song theo nguồn thực

- Mỗi nguồn enrichment chỉ được cấp cho một TBMT tại một thời điểm. Nếu
  `source_factory` trả về cùng một process-wide source, worker pool tự giảm về
  một nguồn thực và xếp hàng các TBMT thay vì phát sinh
  `PROCUREMENT_LOOKUP_BUSY`.
- Chỉ chạy enrichment song song khi factory tạo được các source có identity độc
  lập. Giới hạn cấu hình worker vẫn được giữ nguyên và tiếp tục là trần trên.
- Compatibility impact: không thay đổi dữ liệu canonical, quyền, record scope,
  tenant isolation hoặc API response; chỉ loại bỏ trạng thái `PARTIAL` giả do
  tranh chấp chính connector nội bộ. Với singleton source, enrichment nền có thể
  hoàn tất chậm hơn nhưng không chặn thao tác UI và không bỏ sót TBMT.
- Migration strategy: không cần migration schema hay dữ liệu. Các operation/session
  cũ đang ở `PARTIAL` giữ nguyên bằng chứng lịch sử; người dùng chuẩn bị lại kế
  hoạch để tạo operation mới theo cơ chế đã sửa.
- Regression test: dùng hai TBMT và một shared source có hành vi fail-fast khi bị
  gọi đồng thời; xác nhận bounded enrichment hoàn tất cả hai và không sinh
  warning `PROCUREMENT_LOOKUP_BUSY`.
