# Audit yêu cầu tích hợp Mua Sắm Công

Audit này đối chiếu trực tiếp 80 mục của prompt với code và test. Tài liệu này
chỉ ghi bằng chứng; kết quả kiểm thử/build vẫn là điều kiện hoàn thành.

| Mục | Trạng thái | Bằng chứng chính |
|---:|:---:|---|
| 1 | Đạt | Unified source phục vụ plan, TBMT, opening và result. |
| 2 | Đạt | `session_provider.mjs` port nguyên browser/token/cookie/fallback source. |
| 3 | Đạt | Token/cookie tự động, TTL, force refresh, single-flight và cleanup. |
| 4 | Đạt | `window.stop()`, CSP bypass và reCAPTCHA fallback giữ nguyên. |
| 5 | Đạt | `api_client.mjs` port header, public/protected request và refresh-once. |
| 6 | Đạt | `endpoint_catalog.mjs` chứa đầy đủ endpoint source và generic types. |
| 7 | Đạt | `collectors.mjs` thu complete plan/tender/opening/result/contract bundle. |
| 8 | Đạt | JSONL worker nội bộ; không có Express/SQLite/UI sidecar. |
| 9 | Đạt | `registry.py` cấp một process-wide source cho lookup và import. |
| 10 | Đạt | `backend/procurement_import/source.py` là stable `ProcurementSource`. |
| 11 | Đạt | `MscSessionProvider` tách khỏi `MscApiClient`; refresh single-flight. |
| 12 | Đạt | Semantic endpoint profile `2026.08`, business code không chứa path. |
| 13 | Đạt | API trước, rồi network/framework/DOM browser fallback. |
| 14 | Đạt | Detector báo protected API, network, Vue2, Vue3, React và DOM. |
| 15 | Đạt | Năm extractor interface nằm trong `extractors.mjs`. |
| 16 | Đạt | Collector tạo shape fingerprint cho plan/notice/opening/result. |
| 17 | Đạt | `ImportParserRegistry` resolve parser bất biến theo schema version. |
| 18 | Đạt | Alias field tập trung qua `canonical.pick()`. |
| 19 | Đạt | `classifier.py` có đủ bảy classification bắt buộc. |
| 20 | Đạt | `diagnostics.py` chỉ lưu bounded shape và redact secret. |
| 21 | Đạt | Fixture corpus plan/notice/opening/result đã sanitize. |
| 22 | Đạt | Shadow parser so sánh DIFF/ERROR, không thay active output. |
| 23 | Đạt | Plan ALL lấy mọi revision, sắp xếp cũ đến mới, preview/apply. |
| 24 | Đạt | Package plan được tạo/liên kết; symbol và notifyNo là hai identity. |
| 25 | Đạt | Lifecycle mặc định PREPARING/INVITED và không downgrade status xa hơn. |
| 26 | Đạt | Plan/package có version axis độc lập; unchanged package giữ version. |
| 27 | Đạt | Removed package không clone sang snapshot mới, lịch sử còn nguyên. |
| 28 | Đạt | Backfill ghi `OBSERVED_NOT_APPLIED`, không rollback latest. |
| 29 | Đạt | Repository clone aggregate, assignment, lot, goods và opening data. |
| 30 | Đạt | Three-way merge bảo toàn local-owned fields và preview conflict. |
| 31 | Đạt | TBMT hỗ trợ ALL/LATEST/SELECTED, không chọn cứng latest. |
| 32 | Đạt | Durable operation có cursor, resume và per-revision idempotency. |
| 33 | Đạt | Provenance immutable lưu source metadata, snapshot và `operation_id`. |
| 34 | Đạt | Lookup/import gọi cùng `get_muasamcong_source()`. |
| 35 | Đạt | Nút opening Mua Sắm Công nằm cùng toolbar mở thầu. |
| 36 | Đạt | Opening dùng server preview, package CAS và merge/overwrite/cancel. |
| 37 | Đạt | notify/round/bid/lot/lot-detail cùng LDT/KHAC/ADB/WB được catalog hóa. |
| 38 | Đạt | 1G2T tách TECHNICAL/FINANCIAL; financial chỉ fetch khi eligible. |
| 39 | Đạt | Canonical opening map time, bidder, price, guarantee, period và lot. |
| 40 | Đạt | Code/name/JV được đưa qua resolver và save flow hiện hữu của Bidding. |
| 41 | Đạt | Lot number/name và bidder lot scope được giữ trong DTO/draft. |
| 42 | Đạt | Import inheritance và merge không hạ local lifecycle/data. |
| 43 | Đạt | Route giữ auth, workspace lease, org scope và module edit permission. |
| 44 | Đạt | Token/cookie chỉ ở worker memory; response/log/diagnostic đóng kín. |
| 45 | Đạt | Timeout, retry, size cap, circuit, semaphore, queue cap và dedup. |
| 46 | Đạt | Parser chỉ trả canonical DTO; repository là tầng persistence riêng. |
| 47 | Đạt | Stable DTO cho plan/package/notice/opening/contractor/lot/result. |
| 48 | Đạt | Module layout tách session/client/catalog/collector/parser/diagnostic. |
| 49 | Đạt | Full regression suites bảo vệ edit/import/Excel/version/permission cũ. |
| 50 | Đạt | Session tests phủ launch, capture, cookie, TTL, refresh, cleanup, concurrency. |
| 51 | Đạt | Mock test phủ portal không phát token và reCAPTCHA fallback source. |
| 52 | Đạt | API test chứng minh 401 refresh đúng một lần rồi thành công. |
| 53 | Đạt | Plan 00→01 tests phủ unchanged/changed/new version axes. |
| 54 | Đạt | Removed-package test phủ history và absence trong snapshot mới. |
| 55 | Đạt | Merge/inheritance tests phủ local edit và source conflict. |
| 56 | Đạt | Backfill test phủ provenance-only, latest không rollback. |
| 57 | Đạt | TBMT ALL tests phủ order, idempotency và durable resume. |
| 58 | Đạt | Opening fixtures/tests phủ 1G1T, 1G2T, lot, JV, multi bidder, zero/missing và stale. |
| 59 | Đạt | Contract tests chạy fixture qua classification/fingerprint/registry/canonical. |
| 60 | Đạt | V1 regression và unknown-schema tests vẫn chạy. |
| 61 | Đạt | Tests kiểm tra response/health/diagnostic/observer không lộ secret. |
| 62 | Đạt | Observer phát đủ timing/parser/fingerprint/strategy/retry dimensions. |
| 63 | Đạt | Health phân biệt UP/SESSION/API/SCHEMA/FRONTEND/PARTIAL/DOWN. |
| 64 | Đạt | Migration nối tiếp v52 chỉ mở rộng provider; không rewrite domain. |
| 65 | Đạt | Reuse reconciler, repository, preview store, versioning và lookup DTO. |
| 66 | Đạt | Bảng source→target nằm trong `docs/muasamcong-integration.md`. |
| 67 | Đạt | Tự lấy token/cookie, full endpoint/version/opening capability, không sidecar. |
| 68 | Đạt | Versioning tests chứng minh unchanged/changed/new/removed/backfill/inheritance. |
| 69 | Đạt | Endpoint/browser/parser đều nằm sau stable source seam. |
| 70 | Đạt | Secret isolation và tenant/permission tests đều pass. |
| 71 | Đạt | UI giữ Fetch→Preview→Apply, conflict/action/result rõ và accessible. |
| 72 | Đạt | Session reuse, bounded concurrency, dedup, single-flight và resume. |
| 73 | Đạt | Mỗi revision transaction riêng; failed cursor được lưu để resume. |
| 74 | Đạt | Tài liệu kiến trúc, lifecycle, profile, parser, debug, test và config. |
| 75 | Đạt | `.env.example` expose provider/browser/timeouts/concurrency/profile/diagnostics/shadow. |
| 76 | Đạt | Research source và Bidding được ghi tại `docs/research/` và mapping doc. |
| 77 | Đạt | Migration, unit/integration/contract/UI tests, static, security và build đã chạy. |
| 78 | Đạt | Báo cáo bàn giao nêu kiến trúc, files, mapping, versioning, opening, tests, limitation. |
| 79 | Đạt | Retrieval ở integration; business/persistence ở Bidding; upstream chỉ là data source. |
| 80 | Đạt | Toàn bộ checklist DoD có code, test hoặc tài liệu trực tiếp ở các dòng trên. |

## Cổng xác minh cuối

- Python: 993 passed.
- Node: 708 passed.
- Focused Mua Sắm Công sau audit: 12 Python và 50 Node passed.
- Static, security lint, secure build và production package smoke: passed.
- UI browser/Axe ở viewport 320×720: không có lỗi serious.
- `git diff --check`: passed.

Live reCAPTCHA/WAF không chạy trong CI; behavior được kiểm thử bằng mock ở
boundary. Signed-in mutation E2E chỉ nên chạy với database test dùng một lần.
