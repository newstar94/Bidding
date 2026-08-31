# ADR 0034 — Tra cứu nội tuyến nhanh và retry thực sự cho Mua Sắm Công

- Trạng thái: Chấp nhận
- Ngày: 2026-08-31
- Phạm vi: lấy dữ liệu tự động nội tuyến cho KHLCNT; phiên protected API; circuit breaker và timeout prepare

## Bối cảnh

Với `PL2600150284`, đường nội tuyến trước đây yêu cầu `ALL`, lấy 3 revision và
111 chi tiết gói (116 request upstream), sau đó còn đứng chờ enrichment TBMT liên
kết. Phiên lạnh mất khoảng 27 giây; phần collection `ALL` mất thêm khoảng 16,4
giây dù mapping chỉ khoảng 61 ms.

Khi bootstrap phiên thất bại, ba lần thử kỹ thuật trong cùng một request bị tính
như ba lỗi upstream và mở circuit 30 giây. Lần bấm lại vì vậy trả 502 trong dưới
1 ms mà không chạm nguồn. Ngoài ra, Puppeteer đôi lúc thu gom Promise trả trực
tiếp từ `grecaptcha.execute`, làm phiên thất bại không ổn định. Timeout prepare
mặc định 60 giây cũng ngắn hơn ngân sách phiên lạnh cộng retry API.

## Quyết định và business contract

1. Thao tác lấy dữ liệu nội tuyến cho biểu mẫu Kế hoạch giữ nguyên `ALL`, mọi
   revision, mọi chi tiết gói và linked-notice enrichment. Tối ưu hiệu năng
   không được cắt endpoint, revision hoặc dữ liệu nguồn.
2. Collector và API client dùng bounded concurrency mặc định 12 (vẫn có override
   1–16) để thu thập song song toàn bộ graph dữ liệu. Thứ tự revision và mapping
   canonical không thay đổi.
3. Lỗi bootstrap phiên không mở API circuit. Circuit vẫn bảo vệ nguồn khi có
   timeout hoặc lỗi upstream thực sự.
4. Mỗi request tương tác do người dùng khởi tạo được prime đúng một circuit
   probe. Vì vậy bấm Thử lại thực sự gọi lại nguồn; các request nền hoặc request
   tự động khác vẫn chịu circuit hiện hành.
5. reCAPTCHA execution được khởi động song song với portal capture. Kết quả được
   đọc qua trạng thái tạm trong page thay vì await Promise qua ranh giới
   Puppeteer; token/cookie không được log hoặc trả ra client.
6. Timeout prepare Mua Sắm Công mặc định là 90 giây để bao phủ session timeout,
   API retry và response margin. Override bounded 20–120 giây vẫn giữ nguyên.
7. Retry kỹ thuật, lỗi và cache hit tiếp tục không tạo usage debit theo ADR 0017.
8. API hoàn tất nguyên tử chuỗi phiên bản kế hoạch dùng cùng giới hạn request
   `REQUEST_MAX_SYNC_BYTES` với `/api/sync`, thay vì giới hạn JSON chung 1 MB.
   Payload vẫn được xác thực và commit nguyên tử; không cắt revision hoặc field.
9. `procurement_source_revision.canonical_snapshot_json` cho phép tối đa 16 MiB,
   bằng giới hạn canonical bundle của import session. Bằng chứng từng revision
   được lưu nguyên vẹn; không cắt package, hàng hóa hoặc linked-notice fields.

Quyết định này không thay đổi tenant isolation, role, module permission,
assignment scope, record scope, entitlement, masking hoặc tập field của bản ghi
đã được phép đọc.

## Compatibility impact

- Nút lấy dữ liệu trực tiếp trên biểu mẫu Kế hoạch tiếp tục tuần tự nhập mọi
  revision và chờ linked-notice enrichment như trước.
- Số endpoint và tập dữ liệu không đổi; chỉ lịch thực thi các request độc lập
  được tăng song song trong giới hạn cấu hình.
- Retry sau lỗi có thể mất thời gian như một request thật thay vì trả 502 ngay.
- Không thay đổi schema database hoặc public response field.
- Chuỗi phiên bản đầy đủ lớn hơn 1 MB có thể hoàn tất trong giới hạn đồng bộ
  mặc định 10 MB; API JSON không thuộc luồng đồng bộ vẫn giữ giới hạn 1 MB.
- Revision nguồn lớn hơn giới hạn cũ 256 KiB có thể commit provenance đầy đủ.

## Migration và rollout

Migration schema v89 thay check constraint của canonical revision từ 256 KiB
thành 16 MiB; không viết lại dữ liệu hiện hữu. Deploy frontend và backend cùng
release. Worker Node cũ phải được restart để nhận operation prime retry và
session bootstrap mới. Rollback code không cần chuyển đổi dữ liệu, nhưng rollback
schema chỉ an toàn khi không có revision đã lưu vượt 256 KiB.

## Regression seams

- `tests/js/muasamcong_session_transport.test.mjs`: session failure không mở
  circuit; explicit retry probe; portal/reCAPTCHA chạy song song; không await
  reCAPTCHA Promise qua Puppeteer.
- `tests/test_muasamcong_integration_source.py`: interactive prepare prime đúng
  một runtime retry probe.
- `tests/test_procurement_import_runtime.py`: timeout ngoài bao phủ cold/retry
  budget.
- `tests/js/procurement_lookup_wizard.test.mjs`: inline Plan giữ `ALL`, linked-
  notice enrichment và mở revision đầu tiên của phiên đầy đủ.
- `tests/test_muasamcong_integration_source.py`: collector/API concurrency mặc
  định 12 và vẫn bounded theo cấu hình.
- `tests/test_procurement_import_routes.py`: request prepare tương tác đi qua
  retry context nhưng giữ nguyên authorization và quick-preview behavior.
- `tests/test_http_resource_limits.py`: finalization của chuỗi phiên bản dùng
  sync request budget, không bị chặn nhầm bởi JSON budget 1 MB.
- `tests/test_postgres_migration_chain.py`: schema mới lưu và đọc lại đầy đủ
  canonical revision lớn hơn 256 KiB qua PostgreSQL thật.
