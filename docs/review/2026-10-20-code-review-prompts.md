# Code review BiddingFlow — 20/10/2026

Phạm vi: backend Python (~128k dòng), frontend JS (~97k dòng), commit HEAD `2a43a255`.
Phương pháp: quét AST/grep toàn bộ backend + đọc kỹ các vùng rủi ro và tính năng mới nhất (procurement_monitor).
Chưa chạy được bộ test (máy review không có Python 3.14 và mạng để cài dependency) — mọi prompt dưới đây yêu cầu agent tự chạy test.

## Điểm mạnh (giữ nguyên)
- XSS: mọi `innerHTML` đi qua `trustedHTML()` + DOMPurify + Trusted Types, có script kiểm tra.
- SQL dùng placeholder; bộ chuyển `?` → `%s` bỏ qua chuỗi/comment.
- Không có `except: pass` rộng (chỉ 2 chỗ có chủ đích); không `eval`/`shell=True`/`pickle`.
- `.env`, `.env.database.json` đã được gitignore; worker dùng lease + `FOR UPDATE SKIP LOCKED`.
- Kỷ luật ADR (90 ADR) và contract quyền trong AGENTS.md rõ ràng.

## Danh sách cần cải thiện

| # | Mức | Vấn đề | Vị trí |
|---|-----|--------|--------|
| 1 | Cao | Truy vấn DB đồng bộ chạy thẳng trên event loop trong `async def` route — khi pool cạn, `pool.getconn()` chặn cả worker uvicorn | `auth/auth_routes.py` (update_profile, verify_email_change, change_password, logout, privileged_reauth, update_user_role), `auth/google_auth_routes.py:131`, `auth/otp_routes.py` (register, verify_email, resend_code), `app.py:1148 protected_image_api`, `product_analytics/routes.py:32,68`, `verify_session()` gọi trực tiếp trong các wrapper `lot_lifecycle_routes.py` |
| 2 | Trung bình–Cao | Procurement monitor không giới hạn tốc độ/khử trùng lặp: 4 web worker × 1 gói/giây, cùng một mã TBMT ở nhiều tổ chức bị scrape lặp lại; fetch không có deadline rõ ràng so với lease 1800s; lỗi nguồn bị nuốt, không phân loại | `backend/procurement_monitor/worker.py` |
| 3 | Trung bình | `PreviewStore` trong RAM không giới hạn số mục, chỉ dọn khi `put`, mỗi mục `deepcopy` cả bundle → tăng bộ nhớ theo từng worker | `procurement_import/service.py:149` |
| 4 | Trung bình | 98 hàm > 150 dòng; nặng nhất: `build_dashboard` 1378 dòng, `execute_sync_mutation` 697, `validate_sync_item` 507, `_paginate_records_blocking` 498 | `product_analytics/query_service.py`, `sync/*` |
| 5 | Thấp–Trung bình | Ruff chỉ bật 7 rule; chưa có rule `ASYNC` (bắt được lỗi #1), `S608`, `BLE` | `pyproject.toml` |
| 6 | Thấp | 271 chỗ quản lý connection thủ công (`conn=None / try / finally close`) — hiện không rò rỉ nhưng dễ sai khi sửa | toàn backend |
| 7 | Thấp | SQL ghép f-string (giá trị hiện là hằng nội bộ) — nên khoá bằng whitelist/`psycopg.sql` | `sync/dashboard_summary.py`, `auth/admin_user_routes.py`, `ai/workspace_schema.py`, `admin/platform_directory_routes.py` |
| 8 | Thấp | Lot lifecycle chạy hàm `async` trong thread bằng `asyncio.run` → tạo event loop mới mỗi request | `lot_lifecycle_routes.py` (`_run_lot_impl_in_worker`) |

---

## Ràng buộc chung (dán kèm MỌI prompt)

```
Bối cảnh: repo BiddingFlow tại thư mục gốc dự án. Đọc AGENTS.md trước khi sửa và tuân thủ tuyệt đối:
- Không thay đổi masking/redaction/ẩn trường, role, permission, record/assignment scope, entitlement.
- Không sửa expected value của test để hợp thức hoá thay đổi hành vi.
- Đây là refactor/hardening KHÔNG đổi hành vi nghiệp vụ: response body, status code, thông báo tiếng Việt, audit giữ nguyên.
- Nếu thấy cần đổi hành vi, DỪNG và hỏi tôi.
Hoàn thành khi: `npm run check:static` và `npm test` pass; nêu rõ file đã sửa và test đã thêm.
```

---

### Prompt 1 — Đưa DB I/O đồng bộ ra khỏi event loop (ưu tiên cao)

```
Mục tiêu: không còn lời gọi DB/blocking đồng bộ nào chạy trực tiếp trên event loop trong các async route.

Hiện trạng: các route sau là `async def` nhưng gọi trực tiếp database.get_connection()/cursor.execute()/verify_session() (verify_session truy vấn PostgreSQL và có thể touch_session):
- backend/auth/auth_routes.py: update_profile_api, verify_email_change_api, change_password_api, logout_api, privileged_reauth_api, update_user_role_api
- backend/auth/google_auth_routes.py: google_login_api
- backend/auth/otp_routes.py: register_api, verify_email_api, resend_code_api
- backend/app.py: protected_image_api
- backend/product_analytics/routes.py: commercial_analytics_event_api, commercial_analytics_feedback_api
- backend/lot_lifecycle_routes.py: các *_api gọi verify_session trước khi run_database_write
Khi pool cạn, psycopg_pool.getconn() chặn tới timeout → treo toàn bộ worker uvicorn.

Cách làm:
1. Theo đúng pattern đã có trong backend/auth/admin_user_routes.py (_list_users_sync + run_blocking_io / run_database_write trong backend/shared/async_io.py, cùng _database_lane_unavailable_response): chỉ giữ `await request.json()/read_json_object` ở phần async, chuyển phần còn lại vào hàm `_xxx_sync` chạy qua lane đọc/ghi phù hợp.
2. Bảo toàn y nguyên status code, JSON lỗi, cookie set/clear, audit và thứ tự kiểm tra quyền. Xử lý BlockingIOBusyError/BlockingIOTimeoutError giống các route đã chuyển.
3. Viết script scripts/check_async_blocking.py (AST): báo lỗi khi một `async def` trong backend/ gọi trực tiếp get_connection, .execute(, verify_session(, time.sleep( mà không qua run_blocking_io/run_database_write/to_thread. Thêm vào `check:static` trong package.json; có allowlist có lý do cho ngoại lệ.
4. Thêm test: mỗi route đã chuyển có test chứng minh chạy trong lane (ví dụ monkeypatch run_blocking_io để ghi nhận lời gọi) và test hồi quy response không đổi.
```

### Prompt 2 — Hardening procurement monitor (ADR 0090)

```
Mục tiêu: giảm tải lên nguồn Mua Sắm Công và tăng độ tin cậy của backend/procurement_monitor/worker.py mà KHÔNG đổi quy tắc nghiệp vụ trong docs/adr/0090-scheduled-procurement-updates.md (khung giờ 08:30/14:30, điều kiện eligible, ai nhận thông báo, nội dung thông báo).

Vấn đề:
a) Mỗi web worker (UVICORN_WORKERS=4) đều chạy run_procurement_monitor, xử lý 1 gói/giây → tối đa ~4 request scrape/giây, không giới hạn.
b) Khoá state theo (organization_id, package_root_id, notice_no): cùng một mã TBMT ở N tổ chức bị fetch N lần trong cùng slot.
c) self.fetch() không có deadline rõ ràng; nếu treo quá LEASE_SECONDS=1800 thì worker khác chiếm lease và scrape lại.
d) Exception trong fetch bị nuốt; log chỉ có "SOURCE_UNAVAILABLE", không phân biệt timeout / schema changed / blocked.

Cách làm:
1. Thêm cache kết quả fetch theo (notice_no, slot) dùng chung giữa các tổ chức: bảng mới procurement_monitor_fetch_cache (notice_no, slot, observed_json, fetched_at, error_code) qua migration mới trong backend/db/upgrades.py + schema.py + postgres_schema_contract.json; worker đọc cache trước khi gọi nguồn. Chỉ lưu dữ liệu đã chuẩn hoá (snapshots), không lưu payload/URL thô.
2. Giới hạn toàn cục: dùng pg_try_advisory_lock hoặc bảng token để tối đa K fetch đồng thời trên mọi worker (env PROCUREMENT_MONITOR_MAX_CONCURRENCY, mặc định 1) và khoảng nghỉ tối thiểu giữa các fetch (env PROCUREMENT_MONITOR_MIN_INTERVAL_MS, mặc định 1000). Ghi vào .env.example và deploy/environment-variables.reference.
3. Đặt timeout fetch rõ ràng < LEASE_SECONDS (env, mặc định 120s); khi quá hạn coi như nguồn lỗi theo luồng hiện có.
4. Phân loại lỗi (mã lỗi ProcurementSourceError → last_error, ví dụ SOURCE_TIMEOUT, SOURCE_SCHEMA_CHANGED) và tăng metric trong backend/observability; không log payload.
5. Test: hai tổ chức cùng mã TBMT chỉ fetch 1 lần/slot nhưng cả hai đều nhận thông báo đúng; giới hạn concurrency giữa 2 tiến trình; timeout giải phóng lease; mọi test hiện có của procurement monitor vẫn pass không sửa expected.
```

### Prompt 3 — Giới hạn bộ nhớ PreviewStore

```
Mục tiêu: PreviewStore (backend/procurement_import/service.py) không thể tăng bộ nhớ vô hạn.

Hiện trạng: dict trong RAM, không giới hạn số mục, chỉ dọn mục hết hạn khi put(), mỗi put deepcopy cả canonical bundle. Mỗi worker uvicorn có một bản riêng.

Cách làm:
1. Thêm giới hạn max_items (env PROCUREMENT_IMPORT_PREVIEW_MAX_ITEMS, mặc định 200) và per-user cap (env ..._MAX_PER_USER, mặc định 5); vượt thì loại mục cũ nhất của chính user đó trước, sau đó LRU toàn cục. Dùng OrderedDict.
2. Dọn mục hết hạn cả ở get() và thêm thao tác sweep định kỳ rẻ (ví dụ dọn khi số lượt get/put chia hết cho 50).
3. Giữ nguyên ngữ nghĩa: TTL, kiểm tra scope organization/user/workspace_lease, mã lỗi PROCUREMENT_PREVIEW_EXPIRED / PROCUREMENT_PREVIEW_SCOPE_INVALID. Preview bị loại phải trả về đúng PROCUREMENT_PREVIEW_EXPIRED như hết hạn, frontend đã xử lý mã này.
4. Thêm metric số mục/eviction; ghi env mới vào .env.example và deploy/environment-variables.reference.
5. Unit test: eviction theo user, LRU toàn cục, sweep, thread-safety cơ bản.
```

### Prompt 4 — Thêm lint rule để chặn lỗi tái diễn

```
Mục tiêu: mở rộng ruff trong pyproject.toml để bắt sớm lỗi async/SQL/exception mà không gây hàng nghìn lỗi một lúc.

Cách làm:
1. Chạy `ruff check backend --select ASYNC,S608,BLE001,B,PERF --statistics` để lấy baseline.
2. Bật ngay rule nào có 0 vi phạm. Với rule có vi phạm: dùng `extend-per-file-ignores` cho đúng các file hiện có (ghi chú lý do) để code mới bị chặn; KHÔNG thêm noqa hàng loạt vào code.
3. Ưu tiên ASYNC (ASYNC210, ASYNC220, ASYNC230, ASYNC251) — liên quan Prompt 1.
4. Không sửa logic trong prompt này; chỉ cấu hình + sửa các vi phạm tầm thường (dưới 20 chỗ) có test bao phủ.
5. Đảm bảo scripts/check_python_quality.py và CI (.github/workflows/ci.yml) dùng cấu hình mới.
```

### Prompt 5 — Tách hàm quá dài (làm từng hàm, mỗi PR một hàm)

```
Mục tiêu: refactor thuần cấu trúc, KHÔNG đổi hành vi, cho hàm: <TÊN HÀM>
Gợi ý thứ tự: backend/sync/service.py:execute_sync_mutation (697 dòng) → backend/sync/payload_validation.py:validate_sync_item (507) → backend/product_analytics/query_service.py:build_dashboard (1378) → backend/sync/pagination.py:_paginate_records_blocking (498).

Cách làm:
1. Trước khi sửa, viết characterization test bao phủ các nhánh chính của hàm (đầu vào hợp lệ, từng loại lỗi, từng nhánh quyền/scope) bằng dữ liệu thật trong tests/ hiện có; chạy để chắc chắn pass trên code cũ.
2. Tách thành các hàm private nhỏ (< 80 dòng) theo từng bước nghiệp vụ, giữ nguyên thứ tự truy vấn SQL, thứ tự kiểm tra quyền, transaction boundary và thông báo lỗi.
3. Không đổi chữ ký public, không đổi tên field response, không gộp/bỏ kiểm tra authorization.
4. So sánh: số truy vấn SQL trước/sau phải bằng nhau (dùng benchmark n+1 hiện có: npm run benchmark:n-plus-one).
5. Báo cáo: sơ đồ hàm mới, danh sách test đã thêm.
```

### Prompt 6 — Context manager cho connection/transaction

```
Mục tiêu: giảm boilerplate `conn = None / try / except rollback / finally close` (khoảng 271 chỗ) bằng context manager, làm dần.

Cách làm:
1. Thêm vào backend/db/db_helper.py: `database.connection()` (contextmanager: lấy connection, luôn close) và `database.transaction()` (BEGIN, commit khi thành công, rollback khi exception, luôn close). Giữ nguyên metric connection_acquire hiện có.
2. Test kỹ: commit/rollback/close trong mọi nhánh, exception bị re-raise nguyên vẹn, lồng savepoint (xem lớp savepoint trong backend/db/postgres_schema.py).
3. Chỉ migrate một module nhỏ làm mẫu (ví dụ backend/product_analytics/routes.py); không đổi thứ tự câu lệnh, không đổi response.
4. Viết hướng dẫn ngắn trong docs/guides về khi nào dùng connection() vs transaction().
```

### Prompt 7 — Khoá SQL động bằng whitelist

```
Mục tiêu: các câu SQL ghép f-string chỉ có thể nhận identifier/fragment từ whitelist cố định.

Vị trí: backend/sync/dashboard_summary.py (latest_cte(table_name) và các f-string), backend/auth/admin_user_routes.py (email_filter_tk_sql), backend/ai/workspace_schema.py:145 (spec.table, alias, where_sql), backend/admin/platform_directory_routes.py:345 (joins, where_sql), backend/db/upgrades.py:2955/3562.

Cách làm:
1. Với mỗi vị trí, xác minh nguồn giá trị nội suy; thêm assert/whitelist tường minh (frozenset tên bảng/cột) ngay trước khi ghép, hoặc dùng psycopg.sql.Identifier khi đi qua kết nối psycopg trực tiếp.
2. Giá trị người dùng phải luôn là tham số `?`. Không đổi kết quả truy vấn.
3. Test: truyền tên bảng ngoài whitelist → ValueError; các test hiện có pass.
```

### Prompt 8 — Bỏ asyncio.run trong lot lifecycle

```
Mục tiêu: backend/lot_lifecycle_routes.py không còn chạy hàm async trong worker thread bằng asyncio.run (_run_lot_impl_in_worker).

Cách làm:
1. Chuyển _create_lot_batch_impl, _finalize_lot_batch_impl (và các impl tương tự) thành hàm sync nhận (request, session, data) đã parse sẵn; phần đọc JSON giữ ở route async.
2. Gọi qua run_database_write như hiện tại; giữ nguyên validate, status code, thông báo và transaction.
3. Test hồi quy các endpoint lot lifecycle hiện có; thêm test không có event loop mới được tạo (monkeypatch asyncio.run để fail).
```

---

## Trạng thái thực hiện (20/10/2026)

Kiểm chứng trên Python 3.14 + PostgreSQL 17: 3706 test pass (3672 test cũ + 34 test mới); `check_async_blocking`, `check_python_quality`, `check_mojibake`, schema runtime/migration fixture đều pass. Chưa chạy các bước cần `node_modules` (eslint, build frontend, JS test) — không có thay đổi frontend.

| Prompt | Trạng thái | Ghi chú |
|---|---|---|
| 1 | Xong | Auth (6 route), Google login, OTP (3 route), ảnh bảo vệ, analytics, lot lifecycle; audit độc lập chạy qua write lane; script `scripts/check_async_blocking.py` gắn vào `check:static`. Khi lane quá tải trả 503 `DATABASE_*_QUEUE_FULL` thay vì 500. |
| 2 | Xong (không migration) | Permit toàn cụm bằng advisory lock, timeout fetch, cache theo (mã TBMT, khung giờ) trong mỗi worker, phân loại lỗi trong log. Quy tắc ADR 0090 giữ nguyên. |
| 3 | Xong | Giới hạn 200 mục / 5 mục mỗi người dùng, dọn định kỳ. |
| 4 | Xong | Thêm nhóm ASYNC vào ratchet `check_python_quality.py`. |
| 5, 6 | Chưa làm | Refactor lớn, nên làm từng PR riêng. |
| 7 | Xong | `backend/shared/sql_identifiers.py`; áp cho dashboard summary và AI workspace query. |
| 8 | Chưa làm | Test hiện có ràng buộc impl dạng async; cần chủ sản phẩm đồng ý đổi test cấu trúc. |
