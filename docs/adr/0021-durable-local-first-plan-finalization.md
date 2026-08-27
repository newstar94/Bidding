# ADR 0021 — Phản hồi tức thì khi hoàn tất kế hoạch

- Trạng thái: Accepted
- Ngày: 2026-08-27

## Bối cảnh

Luồng hoàn tất kế hoạch từng đóng giao diện ngay sau khi dữ liệu được lưu bền vững
trên thiết bị. Sau khi việc lưu toàn bộ dòng phiên bản được chuyển sang một
transaction máy chủ nguyên tử, giao diện chờ transaction hoàn tất mới đóng modal.
Độ trễ mạng hoặc xử lý máy chủ vì vậy trở thành độ trễ người dùng nhìn thấy, dù
bản nháp trên thiết bị đã an toàn.

Mục tiêu sản phẩm được xác nhận là thao tác phải phản hồi tức thì trong cả debug
và production. Không được dùng khác biệt môi trường làm lý do chấp nhận độ trễ
trên critical path giao diện.

## Quyết định

Khi hoàn tất một phiên bản kế hoạch:

1. Frontend vẫn validate và lưu toàn bộ aggregate bản nháp vào IndexedDB trước.
2. Ngay sau mốc lưu bền vững này, frontend đóng modal và trả quyền tương tác cho
   người dùng.
3. Transaction finalize trên PostgreSQL tiếp tục chạy ngoài critical path hiển
   thị nhưng vẫn dùng cùng payload, idempotency key, rowVersion, authorization,
   audit và ranh giới nguyên tử hiện hữu.
4. Chỉ sau khi máy chủ commit thành công, frontend mới hiển thị “Đã lưu kế hoạch”,
   xóa bản nháp và làm mới dữ liệu chuẩn ở nền.
5. Nếu finalize thất bại, frontend không báo thành công, giữ bản nháp bền vững và
   báo “Chưa đồng bộ kế hoạch” để người dùng có thể thử lại.
6. Response muộn từ workspace cũ không được hiển thị thông báo, refresh dữ liệu
   hoặc thay đổi edit state của workspace mới.

## Compatibility impact

- Hành vi dữ liệu máy chủ, transaction, version history và API không đổi.
- Modal đóng sớm hơn: sau khi IndexedDB xác nhận thay vì sau khi PostgreSQL commit.
- Thông báo thành công muộn hơn modal và chỉ phản ánh commit thật.
- Không thay đổi masking, field visibility, tenant isolation, role, module
  permission, assignment scope, record scope, capability hoặc entitlement.

## Migration strategy

Không cần migration schema hoặc backfill. Thay đổi được triển khai cùng frontend.
Bản nháp đang tồn tại tiếp tục dùng cùng envelope và idempotency key nên vẫn có
thể phục hồi hoặc finalize sau khi nâng cấp.

## Regression seams

`tests/js/plan_version_draft_session.test.mjs` khóa các invariant:

- response finalize bị giữ pending nhưng modal đã đóng sau durable local save;
- không có success toast hoặc canonical refresh trước commit;
- commit thành công mới xóa draft và phát success toast;
- commit lỗi giữ draft và phát cảnh báo chưa đồng bộ;
- response muộn từ workspace cũ không tác động workspace mới.

