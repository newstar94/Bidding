# Kế hoạch triển khai ADR 0091: tự ghi làm rõ HSMT

Tài liệu này mô tả cách triển khai [ADR 0091](../adr/0091-auto-write-hsmt-clarifications.md).

## Trạng thái ngày 2026-10-20

Đã triển khai bước 1 đến bước 8. Kết quả xác minh năm điểm mở ở cuối tài liệu:

1. **Phiên bản TBMT của gói.** `sourceRevision` và `noticeLink` chỉ tồn tại trong bộ nhớ lúc nhập, không được lưu vào `goi_thau`. Backend dùng hậu tố của `ma_goi_thau`, nếu không có thì dùng `phien_ban`, giống nút thủ công sau khi tải lại trang.
2. **Clone ID dòng làm rõ.** `_clone_owned_row` cấp ID ngẫu nhiên mới (`lr-<uuid>`), không theo dạng `lr-<64 hex>`. Phép so khớp nội dung vẫn chạy, nên không ghi trùng. Test `test_cloned_package_version_does_not_receive_duplicates` khóa hành vi này.
3. **Delta sync.** Dùng `next_sync_version` cho gói và các dòng mới, giống luồng bổ sung thông tin nhà thầu chạy nền.
4. **Websocket.** Worker ghi sự kiện `sync_update` vào outbox `websocket_events` trong cùng transaction, broker phát sau commit.
5. **Định dạng thời gian.** Port nguyên `formatForDatetimeLocal`, lấy chữ số theo đúng thứ tự trong chuỗi, không đổi múi giờ. Fixture dùng chung đã khớp giữa hai phía.

Phát sinh thêm khi code:

- Luồng đồng bộ khóa `sync_metadata` trước bản ghi, trong khi worker đang giữ bản ghi gói. Worker vì vậy khóa `sync_metadata` và đầu chuỗi audit bằng `NOWAIT`. Đang bận thì hoãn cả lần công bố (`AUTO_WRITE_BUSY`) và thử lại; đến lần thử cuối thì gửi email kèm lý do.
- Nhật ký thao tác ghi tác nhân "Hệ thống". `ActivityTimeline` có thêm nhãn cho hai danh sách làm rõ.
- `deploy/production.env.example` chưa có biến nào của bộ theo dõi nên giữ nguyên. Biến mới được ghi vào `.env.example` và `deploy/environment-variables.reference`.
- Quyền lợi dựa trên grant `source = 'plan'`. Hiện chỉ việc kích hoạt gói có quota đi kèm mới cấp grant này, và gói Cơ bản không kèm quota. Nếu sau này bảng giá cấp quota đi kèm cho gói Cơ bản, phải xem lại ADR 0091.
- Test PostgreSQL (`tests/test_procurement_monitor_auto_write_postgres.py`) cần `TEST_DATABASE_URL` và một PostgreSQL đang chạy.

## Điều kiện trước khi sửa code

Đã đủ từ ngày 2026-10-20:

1. Chủ sản phẩm đã xác nhận định nghĩa quyền lợi lấy dữ liệu tự động.
2. ADR 0091 đã ở trạng thái "Chấp nhận".
3. ADR 0090 đã có ghi chú về phần được ADR 0091 thay thế.

## Bước 1. Chốt hành vi bằng fixture dùng chung, trước khi viết logic

- Tạo `tests/fixtures/clarification_auto_write_parity.json` gồm đầu vào và kết quả mong đợi:
  - Đầu vào: dòng hiện có (có dòng nhập tay, dòng chưa hoàn chỉnh, dòng `lr-`), dòng nguồn theo từng phiên bản và phiên bản của bản ghi.
  - Kết quả: ID và số dòng được thêm.
- Sinh kết quả mong đợi bằng chính `assignLocalInvitationRowIds` và `mergeInvitationUpdateRows` hiện có trong `frontend/procurement/InvitationUpdates.js`. Thêm `tests/js/clarification_auto_write_parity.test.mjs` để khẳng định fixture khớp frontend.
- Thêm test khẳng định hash của `snapshots()` trên dữ liệu mẫu `IB2600493339` không đổi trước và sau khi sửa. Test này chặn nguy cơ gửi email hàng loạt khi baseline bị đổi.

## Bước 2. Logic thuần ở backend

Tạo file mới `backend/procurement_monitor/clarification_merge.py`, không truy cập DB:

- `local_row_id(package_id, notice_no, version, kind, identity)`: tạo `lr-` + SHA-256 của mảng JSON gọn, UTF-8, khớp `JSON.stringify` của frontend.
- `resolve_record_notice_version(package)`: port của `resolveInvitationNoticeTarget`. Không xác định được hoặc các nguồn phiên bản lệch nhau thì trả về lý do, không ghi.
- `append_only_merge(current_rows, source_rows_by_version, record_version)`: cùng quy tắc so khớp với `mergeInvitationUpdateRows`, nhưng không đổi ID của dòng hiện có và chỉ trả về các dòng cần thêm.
- Chuẩn hóa thời gian giống `formatForDatetimeLocal`, theo giờ Việt Nam.

Sửa `domain.snapshots()` để trả thêm dòng nguồn theo từng phiên bản, kèm `sourceRequestNo`/`sourceRequestId`, dùng cho bước ghi. Danh sách dùng để băm phải giữ nguyên.

## Bước 3. Kiểm tra quyền lợi

Tạo file mới `backend/procurement_monitor/entitlement.py` với hàm `auto_write_entitled(cursor, package)`:

- `commercial_runtime_config()` tắt trừ lượt, kể cả trial: trả về `True`.
- Đang bật trừ lượt: trả về `True` khi chủ sở hữu có ít nhất một dòng trong `usage_credit_grants` thỏa đủ: `feature = 'procurement.source_fetch'`, `source = 'plan'`, `expires_at` lớn hơn thời điểm kiểm tra. Không xét `remaining`.
- Chủ sở hữu là `UsageOwner("account", …)` với gói cá nhân và `UsageOwner("organization", …)` với gói tổ chức. Dùng cùng mệnh đề chủ sở hữu với `UsageCreditService._owner_clause`.
- Grant `purchase` và `admin` không được tính.
- Khi code, xác minh grant `plan` chỉ được cấp từ offer `connected`. Gói `internal` có quota 0 và ràng buộc `total > 0` nên hiện không thể tạo grant này. Nếu `order_item_id` nối được tới biến thể offer, kiểm tra thêm `variant = 'connected'` để chặn trường hợp catalog sau này cấp lượt cho gói Cơ bản.
- Không gọi reserve hay consume.

## Bước 4. Ghi trong transaction công bố của worker

Sửa `ProcurementMonitor._finish` trong `backend/procurement_monitor/worker.py`. Khi `counts["clarification"] > 0` và cờ bật:

1. Khóa gói bằng `FOR UPDATE OF gt` thay cho `FOR SHARE` hiện tại, giữ thứ tự khóa gói rồi đến state để tránh deadlock.
2. Kiểm tra quyền lợi, phiên bản TBMT và tính khả biến: kế hoạch và gói là bản mới nhất (`aggregate_mutability`).
3. Đọc các dòng `goi_thau_lam_ro` hiện có, gộp, rồi `INSERT` dòng mới. `sort_order` nối tiếp dòng cuối, `sync_version` lấy giá trị mới.
4. Chạy `UPDATE goi_thau SET row_version = row_version + 1, sync_version = …, updated_at = … WHERE id = ? AND organization_id = ? AND row_version = ?` (CAS).
5. Ghi audit bằng `insert_audit_row(actor_user_id=None, action="procurement_monitor.clarification_auto_write", target_type="goithau", …)`, metadata gồm slot, mã thông báo, phiên bản và ID dòng.
6. Đánh dấu thay đổi cho delta sync và visibility epoch theo cùng cơ chế `record_writer`/`mutation_tracker` đang dùng, để client đang mở nhận bản mới. Sau commit, phát tín hiệu websocket nếu worker có callback.
7. Phần ghi chạy trong `SAVEPOINT`. CAS thất bại thì rollback về savepoint, đọc lại và thử lại trong giới hạn `MAX_ATTEMPTS`. Hết số lần thử thì vẫn công bố email kèm lý do "chưa cập nhật được do hồ sơ đang thay đổi".
8. Việc ghi không phụ thuộc có người nhận email.

## Bước 5. Thông báo

- `_notify` nhận thêm kết quả ghi: số yêu cầu và trả lời đã thêm, hoặc mã lý do không ghi, rồi chuyển thành câu tiếng Việt. Email không chứa nội dung nguồn.
- Giữ kind `procurement_update`. Không thêm kind mới, nên không cần đổi constraint.

## Bước 6. Cấu hình

- Thêm `PROCUREMENT_MONITOR_AUTO_WRITE_ENABLED`, mặc định `true`, đọc trong `monitor_settings`.
- Cập nhật `.env.example`, `deploy/environment-variables.reference` và `deploy/production.env.example`.

## Bước 7. Frontend, chỉ ở mức tối thiểu

- Kiểm tra màn hình lịch sử hoặc hoạt động hiển thị tác nhân trống thành "Hệ thống". Chỉ thêm nhãn nếu chưa có.
- Không đổi giao diện nào khác. Xung đột 409 dùng luồng hiện hành của ADR 0049 và ADR 0057.

## Bước 8. Kiểm thử

| Seam trong ADR 0091 | Nơi kiểm thử |
|---|---|
| Phép gộp và ID khớp frontend | `tests/js/clarification_auto_write_parity.test.mjs`, `tests/test_procurement_monitor.py` |
| Hash không đổi | `tests/test_procurement_monitor.py` |
| Phạm vi phiên bản, `null` không phải rỗng | `tests/test_procurement_monitor.py` |
| Chỉ thêm dòng, không đổi ID dòng nhập tay | `tests/test_procurement_monitor.py` |
| Ma trận quyền lợi: tắt trừ lượt, trial, grant `plan` còn hạn hoặc hết lượt, grant `plan` hết hạn, chỉ `purchase`, chỉ `admin`, không grant | `tests/test_procurement_monitor_postgres.py` |
| Baseline không ghi, ngày 10 và ngày 11 | `tests/test_procurement_monitor.py` |
| CAS, thử lại, bản lưu cũ nhận 409 | `tests/test_procurement_monitor_postgres.py` |
| Rollback nguyên tử, không có dòng usage | `tests/test_procurement_monitor_postgres.py` |
| Gói cá nhân, phiên bản vật lý mới không trùng | `tests/test_procurement_monitor_postgres.py` |
| Nút thủ công sau khi tự ghi không trùng | `tests/test_procurement_monitor_postgres.py` |
| Nội dung email | `tests/test_procurement_monitor.py` |

Lệnh xác minh:

- `pytest tests/test_procurement_monitor.py tests/test_procurement_monitor_postgres.py tests/test_procurement_monitor_throttle.py`
- Các test JavaScript liên quan, `npm run check:static`, `python scripts/check_python_quality.py`, `npm run build:secure`, `git diff --check`

Không gọi nguồn thật và không gửi SMTP thật.

## Cần xác minh ngay khi bắt đầu code

1. **Cột lưu phiên bản TBMT của gói ở backend.** Frontend đọc `sourceRevision`, `noticeLink`, `phienBan` và hậu tố trong mã gói. Cần ánh xạ đúng sang cột của `goi_thau`.
2. **Cách clone ID dòng làm rõ khi tạo phiên bản gói mới.** Nếu bản clone giữ ID dạng `lr-<hash>` của gói cũ, frontend sẽ bỏ qua so khớp nội dung và hệ thống sẽ ghi trùng. Phải viết test này trước tiên.
3. **Hook delta sync và visibility epoch** cho thao tác ghi không đi qua `/api/sync`.
4. **Worker có gọi được websocket broadcast không.**
5. **Định dạng thời gian.** So sánh `formatForDatetimeLocal` ở frontend với `normalize_datetime_value` ở backend trên các mẫu có giây và có múi giờ.

## Các file dự kiến thay đổi

- Mới: `backend/procurement_monitor/clarification_merge.py`, `backend/procurement_monitor/entitlement.py`, `tests/fixtures/clarification_auto_write_parity.json`, `tests/js/clarification_auto_write_parity.test.mjs`
- Sửa: `backend/procurement_monitor/domain.py`, `backend/procurement_monitor/worker.py`, `tests/test_procurement_monitor.py`, `tests/test_procurement_monitor_postgres.py`, `.env.example`, `deploy/environment-variables.reference`, `deploy/production.env.example`, `docs/adr/0090-scheduled-procurement-updates.md` (chỉ thêm ghi chú thay thế)
- Có thể sửa: nhãn tác nhân "Hệ thống" ở frontend nếu chưa có
- Không đổi: schema, migration, quyền, masking, entitlement khác, bảng giá
