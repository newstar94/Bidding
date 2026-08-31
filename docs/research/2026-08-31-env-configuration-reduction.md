# Nghiên cứu giảm số biến cấu hình `.env`

Ngày khảo sát: 2026-08-31  
Phạm vi: `.env`, `.env.example`, `deploy/production.env.example`, catalog `deploy/environment-variables.reference`, source consumer và tài liệu liên quan trong repo. Không ghi lại giá trị secret trong `.env`; chỉ đối chiếu tên biến, trạng thái có/rỗng và effective behavior.

## Kết luận ngắn

Catalog baseline ban đầu có 313 dòng cấu hình; snapshot hiện tại còn **308 dòng active** trong `deploy/environment-variables.reference`, **108 key** trong `.env` local, **78 key** trong `.env.example` và **109 key** trong `deploy/production.env.example`. Lookup/import Mua Sắm Công và provider chính thức nay là default trong code nên ba biến canonical chỉ còn là override dạng comment, không phải cấu hình fresh install. Hai template vẫn để lộ rõ các quyết định về trial/thương mại, đủ bộ PayOS, AI, Turnstile, browser policy/reCAPTCHA Mua Sắm Công, session, OTP, Google sign-in, conflict center, version/legal và Word. Phần được chuyển ra catalog chủ yếu là timeout, queue, pool, cache, concurrency, retention kỹ thuật và biến dành riêng cho worker/job.

Vấn đề không chỉ là số lượng lớn: baseline ban đầu đã trộn ít nhất bốn phạm vi khác nhau vào một nơi:

1. cấu hình web runtime;
2. cấu hình document worker/backup/migrator vốn phải có secret scope riêng;
3. tuning nâng cao đã có default trong code;
4. cấu hình test, benchmark và máy phát triển cá nhân.

Kết quả áp dụng mô hình **compact feature profile + catalog/overlay theo tiến trình**; không xóa reader hay đổi default runtime. Profile vẫn dài hơn một mẫu “tối thiểu” vì chủ sản phẩm cần tự quyết định feature và policy, nhưng phần lớn dòng đã có giá trị mặc định có chủ đích. Người vận hành chỉ phải điền database/bootstrap và credential của các feature thực sự bật. Production vẫn cần nhiều attestation/secret hơn local vì đó là startup contract, không phải tuning có thể tự suy ra.

Điểm giảm lớn nhất, ít rủi ro nhất:

- không copy toàn bộ `.env.example` production để chạy local;
- bỏ khỏi profile chính các default tuning không cần quyết định nghiệp vụ;
- tách `web.env`, `document-worker.env`, `migrator.env`, `backup.env`, `test.env`;
- luôn hiện switch và input cốt lõi của feature; chỉ chuyển chi tiết kỹ thuật của feature sang catalog;
- suy ra `ALLOWED_HOSTS`, `CORS_ORIGINS`, `ALLOWED_WS_ORIGINS` và Turnstile hostname từ `APP_PUBLIC_URL` trong profile same-origin, nhưng đây là thay đổi runtime cần compatibility rollout;
- giữ alias cũ trong ít nhất một chu kỳ phát hành và phát cảnh báo, không xóa ngay.

## Evidence hiện trạng

### Cơ chế load làm `.env` trở thành một “túi chung”

Backend tự đọc mọi dòng trong `.env`, dùng `setdefault` để process environment có ưu tiên; riêng `AI_ENABLED` và `AI_PROVIDER` ở non-production bị `.env` ghi đè. Điều này khiến một file local dễ vô tình cung cấp cả secret/tuning cho nhiều tiến trình. [backend/app.py:65](../../backend/app.py#L65) [backend/app.py:76](../../backend/app.py#L76)

Các repository script lại có loader gần tương tự, cũng nạp toàn bộ `.env` bằng `setdefault`. [scripts/env_utils.py:9](../../scripts/env_utils.py#L9)

README trước đợt rút gọn hướng dẫn copy nguyên `.env.example` thành `.env`; cùng với catalog baseline 313 key, đây là nguyên nhân tạo cảm giác “313 biến phải cấu hình”. Snapshot hiện tại đã tách catalog đầy đủ sang `deploy/environment-variables.reference`; hai template vận hành chỉ giữ các nhóm cốt lõi/profile cần nhìn thấy. [README.md:21](../../README.md#L21) [README.md:26](../../README.md#L26) [deploy/environment-variables.reference](../../deploy/environment-variables.reference)

### Repo đã có default; catalog đầy đủ không đồng nghĩa mọi key phải nằm trong template

Các nhóm dưới đây có default trong code, vì vậy phần tuning không cần xuất hiện trong compact profile nếu giữ hành vi mặc định:

| Nhóm | Ví dụ default trong source | Khuyến nghị |
|---|---|---|
| App local | `APP_HOST=127.0.0.1`, `APP_PORT=8000`, `APP_ENV=development`, cookie/debug false, asset mode source | Bỏ khỏi `.env.local.example`; chỉ ghi khi override. [backend/app.py:89](../../backend/app.py#L89) [backend/app.py:93](../../backend/app.py#L93) |
| HTTP/WS local | CORS, allowed hosts và WS origin đều có local fallback | Bỏ khỏi compact profile local. [backend/app.py:1196](../../backend/app.py#L1196) [backend/shared/origin_policy.py:97](../../backend/shared/origin_policy.py#L97) |
| Database pool/budget | instance 1, workers 1, pool max 8, dedicated 1, reserve 20 | Giữ ở advanced/production profile, không bắt người dùng local điền. [backend/startup.py:139](../../backend/startup.py#L139) |
| HTTP limits | concurrency 256, backlog 512, keepalive 5, request recycling, WS size/queue | Chuyển sang deploy profile hoặc hard-coded service defaults. [backend/startup.py:194](../../backend/startup.py#L194) |
| Retention/monitoring | lifecycle có default cho event-loop, tombstone, mutation, idempotency, partner job, session | Chỉ đưa vào operator reference. [backend/lifecycle.py:70](../../backend/lifecycle.py#L70) [backend/lifecycle.py:214](../../backend/lifecycle.py#L214) |
| Runtime paths | mọi thư mục con suy ra từ `BIDDING_DATA_DIR` | Giữ một root; bỏ override con khỏi base example. [backend/shared/paths.py:15](../../backend/shared/paths.py#L15) [backend/shared/paths.py:27](../../backend/shared/paths.py#L27) |
| AI | provider, endpoint, model, quota, RAG/privacy và web-search là lựa chọn có ý nghĩa; timeout/retention kỹ thuật có default | Giữ switch, provider, key, model, quota, RAG/privacy và source-domain policy; chuyển timeout và giới hạn nội bộ sang reference. [backend/ai/configuration.py:104](../../backend/ai/configuration.py#L104) [backend/ai/configuration.py:174](../../backend/ai/configuration.py#L174) |
| Procurement lookup | lookup/import và provider chính thức mặc định bật trong code; browser mode/reCAPTCHA quyết định cách chạy | Bỏ ba biến canonical khỏi fresh-install profile, giữ browser policy ở profile và rollback overrides trong reference. [backend/procurement_lookup/config.py:72](../../backend/procurement_lookup/config.py#L72) [backend/procurement_import/runtime.py:23](../../backend/procurement_import/runtime.py#L23) |
| Commercial/payment | trial, policy, checkout/activation, provider, readiness và PayOS credential có business semantics | Giữ toàn bộ control cốt lõi và credential placeholder; chỉ chuyển worker/tuning sang reference. [backend/commercial_policy/config.py:22](../../backend/commercial_policy/config.py#L22) [backend/commercial_policy/config.py:84](../../backend/commercial_policy/config.py#L84) |

### `.env` local đang chứa key ngoài `.env.example`

Khảo sát theo tên key ở snapshot hiện tại cho thấy `.env` local vẫn có các key task/process-specific không nằm trong `.env.example`, chủ yếu là:

- DB của test/load/performance/restore (`TEST_DATABASE_URL`, `API_TEST_DATABASE_URL`, `LOAD_TEST_DATABASE_URL`, `PERFORMANCE_DATABASE_URL`, ...);
- credential quản trị/migrator/backup/document worker;
- alias URL runtime/migrator, procurement legacy và `CSRF_TRUSTED_ORIGINS`.

Đây là bằng chứng nên tách file theo tiến trình và tác vụ, không mở rộng base example để bao phủ tiếp. Web production hiện còn **chủ động từ chối** nhận secret admin, migrator, backup, document worker và restore private key. [backend/startup.py:495](../../backend/startup.py#L495)

Standalone document worker cũng từ chối nhận secret của web/migrator/backup và yêu cầu release directory không có `.env`. [scripts/run_document_worker.py:200](../../scripts/run_document_worker.py#L200) [scripts/run_document_worker.py:280](../../scripts/run_document_worker.py#L280) Vì vậy việc để tất cả key chung trong `.env` vừa dài vừa ngược trust-boundary đã được code áp dụng.

## Phân loại biến nên áp dụng

### 1. Bắt buộc thực sự cho local development

Theo startup hiện tại:

- `DATABASE_URL`: luôn bắt buộc, phải là PostgreSQL URL có credential/host/database. [backend/startup.py:454](../../backend/startup.py#L454)
- `ADMIN_PASSWORD`: chỉ bắt buộc khi database chưa có user. [backend/startup.py:526](../../backend/startup.py#L526) [backend/startup.py:692](../../backend/startup.py#L692)

SMTP/email, Google, AI, procurement, payment, conflict center và các catalog đều có thể tắt theo defaults. Nếu chỉ xét điều kiện để process local khởi động, tập bắt buộc có thể chỉ gồm:

```dotenv
DATABASE_URL=postgresql://.../biddingflow
ADMIN_PASSWORD=
```

Đây không phải đề xuất dùng template hai dòng: `.env.example` cố ý giữ các switch/credential/policy để chủ sản phẩm và người vận hành quyết định. `setup_local_postgres.py` tiếp tục chuẩn bị URL/key local trong `.env` đã được Git ignore; nghiên cứu này không thêm default ngầm hay startup validation mới cho trial/feature choice.

### 2. Bắt buộc thực sự cho production web theo contract hiện tại

Production startup hiện yêu cầu hoặc kiểm tra các nhóm sau:

- DB runtime: `DATABASE_URL`, SSL verify-full (trong URL hoặc `DATABASE_SSLMODE`), `DATABASE_AUTO_MIGRATE=false`, `DATABASE_PRIVATE_NETWORK_CONFIRMED=true`. [backend/startup.py:454](../../backend/startup.py#L454) [backend/startup.py:476](../../backend/startup.py#L476) [backend/startup.py:483](../../backend/startup.py#L483) [backend/startup.py:491](../../backend/startup.py#L491)
- Email/auth/audit: SMTP config hợp lệ, `EMAIL_OUTBOX_ENCRYPTION_KEY`, `OTP_HMAC_KEY`, `AUDIT_CHECKPOINT_HMAC_KEY`, restore public key. [backend/startup.py:608](../../backend/startup.py#L608) [backend/startup.py:613](../../backend/startup.py#L613) [backend/startup.py:617](../../backend/startup.py#L617) [backend/startup.py:621](../../backend/startup.py#L621) [backend/startup.py:626](../../backend/startup.py#L626)
- Attestation: off-host audit, encrypted storage, secret rotation date. [backend/startup.py:641](../../backend/startup.py#L641) [backend/startup.py:645](../../backend/startup.py#L645) [backend/startup.py:649](../../backend/startup.py#L649)
- App identity/security: debug false, secure cookies true, release ID, public HTTPS URL. [backend/startup.py:661](../../backend/startup.py#L661) [backend/startup.py:665](../../backend/startup.py#L665) [backend/startup.py:673](../../backend/startup.py#L673)
- First bootstrap only: username/name/email/org and password. [backend/startup.py:677](../../backend/startup.py#L677) [backend/startup.py:692](../../backend/startup.py#L692)
- Import-time production checks còn yêu cầu exact same-origin triplet, allowed host và explicit super-admin allowlist. [backend/app.py:1202](../../backend/app.py#L1202)

Không nên “giảm” các biến trên bằng cách bỏ validation mà không có ADR/approval. Có thể giảm thao tác cấu hình bằng cách **suy ra giá trị trùng lặp** hoặc đặt chúng trong deploy profile được generate/validate.

### 3. Bắt buộc theo tiến trình, không được để chung

| Tiến trình | Key chính | Căn cứ |
|---|---|---|
| Web | chỉ runtime `DATABASE_URL` và secret app | Web từ chối credential đặc quyền khác. [backend/startup.py:495](../../backend/startup.py#L495) |
| Migrator | `MIGRATOR_DATABASE_URL` | README yêu cầu migration bằng credential migrator. [README.md:49](../../README.md#L49) |
| Document worker | `DOCUMENT_WORKER_DATABASE_URL`, execution mode/identity/storage attestations | Worker yêu cầu URL riêng và role riêng. [scripts/run_document_worker.py:170](../../scripts/run_document_worker.py#L170) [scripts/run_document_worker.py:322](../../scripts/run_document_worker.py#L322) |
| Backup/restore | `BACKUP_DATABASE_URL` và private restore scope | Backup script đọc URL riêng; web từ chối restore private key. [scripts/backup.py:419](../../scripts/backup.py#L419) [backend/startup.py:495](../../backend/startup.py#L495) |
| Test/benchmark | `TEST_DATABASE_URL`, `API_TEST_DATABASE_URL`, ... | Đây là task-scoped configuration, không phải app runtime; README cũng mô tả E2E cần credential riêng. [README.md:63](../../README.md#L63) |

### 4. Biến có thể suy ra/gộp

#### Origin/hostname

Production đã ép:

- `CORS_ORIGINS == {APP_PUBLIC_URL}`;
- `ALLOWED_WS_ORIGINS == {APP_PUBLIC_URL}`;
- `ALLOWED_HOSTS == hostname(APP_PUBLIC_URL)`.

[backend/app.py:1225](../../backend/app.py#L1225) [backend/app.py:1227](../../backend/app.py#L1227) [backend/app.py:1231](../../backend/app.py#L1231)

Security preflight cũng lặp đúng phép suy ra này. [scripts/check_security_deployment.py:102](../../scripts/check_security_deployment.py#L102) [scripts/check_security_deployment.py:134](../../scripts/check_security_deployment.py#L134)

Vì contract hiện là same-origin, nên có thể dùng `APP_PUBLIC_URL` làm source of truth và giữ ba key kia như optional override/compatibility assertion. `CSRF_TRUSTED_ORIGINS` đã tự fallback về `APP_PUBLIC_URL`, chứng minh pattern này đã tồn tại. [backend/shared/origin_policy.py:40](../../backend/shared/origin_policy.py#L40) [backend/shared/origin_policy.py:55](../../backend/shared/origin_policy.py#L55)

Turnstile exact hostname cũng có thể suy ra khi không cấu hình override; preflight hiện đã so nó với hostname của public URL. [scripts/check_security_deployment.py:148](../../scripts/check_security_deployment.py#L148)

Compatibility: giữ đọc các key cũ; nếu có thì validate chúng bằng giá trị suy ra, nếu thiếu thì synthesize. Không đổi multi-origin semantics ngoài production same-origin profile.

#### PostgreSQL SSL

`DATABASE_SSLMODE` là override của query `sslmode` trong `DATABASE_URL`; production chấp nhận nguồn nào cũng được. [backend/startup.py:476](../../backend/startup.py#L476) Profile production giữ `DATABASE_SSLMODE=verify-full` để startup contract rõ ràng ngay cả khi URL placeholder chưa có query. Reader hiện hữu và khả năng đặt `sslmode` trong URL vẫn được giữ nguyên.

#### Runtime directories

`BIDDING_DATA_DIR` đã là root và code suy ra backup/log/upload/template/catalog/cache/worker-temp. [backend/shared/paths.py:13](../../backend/shared/paths.py#L13) [backend/shared/paths.py:15](../../backend/shared/paths.py#L15) Base production chỉ cần root; override con chuyển sang advanced storage profile.

#### Procurement aliases

Code hiện có precedence mới-cũ:

- `PROCUREMENT_PROVIDER` -> lookup enabled -> `VNEPS_PROCUREMENT_PROVIDER`; [backend/procurement_import/runtime.py:23](../../backend/procurement_import/runtime.py#L23)
- `PROCUREMENT_IMPORT_ENABLED` -> `VNEPS_PROCUREMENT_IMPORT_ENABLED`. [backend/procurement_import/runtime.py:40](../../backend/procurement_import/runtime.py#L40)

`.env.example` lại khai báo đồng thời cả tên mới và alias legacy, dễ tạo giá trị mâu thuẫn. Nên chỉ trình bày tên canonical trong base/profile, giữ aliases được đọc nhưng deprecated trong một chu kỳ rồi mới quyết định xóa theo telemetry/test.

#### AI aliases

AI adapter đã ưu tiên `AI_*`, sau đó fallback `OPENAI_*`/provider-specific keys. [backend/ai/configuration.py:132](../../backend/ai/configuration.py#L132) [backend/ai/configuration.py:141](../../backend/ai/configuration.py#L141) [backend/ai/configuration.py:163](../../backend/ai/configuration.py#L163) Base example chỉ nên dùng bộ vendor-neutral; provider-specific aliases đưa vào docs migration, không đồng thời khai báo hai bộ trong active env.

#### Process-manager và app limits

`UVICORN_WS_MAX_SIZE` phải bằng `WEBSOCKET_MAX_FRAME_BYTES`; đây là duplicate cấu hình được enforce. [backend/startup.py:221](../../backend/startup.py#L221) Systemd service nội suy trực tiếp các `UVICORN_*`, nên unit hiện khai báo default trước `EnvironmentFile`; file `/etc/biddingflow/web.env` vẫn có thể override sau capacity test. Nhờ đó production profile không cần lặp các giá trị tuning mà `ExecStart` vẫn luôn nhận đủ biến. [deploy/systemd/biddingflow.service.example](../../deploy/systemd/biddingflow.service.example)

## Cấu trúc đã áp dụng

Không tiếp tục dùng một `.env.example` chứa mọi knob. Cấu trúc hiện tại:

```text
.env.example                           # compact local feature profile
deploy/production.env.example          # web production + startup contract
deploy/environment-variables.reference # catalog tuning/override đầy đủ
deploy/turnstile/*.env.example         # overlay Turnstile theo môi trường
```

`deploy/systemd/biddingflow.service.example` dùng `/etc/biddingflow/web.env`; credential đặc quyền cho migrator, backup và document worker tiếp tục nằm ngoài web profile theo trust boundary hiện hữu. [deploy/systemd/biddingflow.service.example](../../deploy/systemd/biddingflow.service.example) [backend/startup.py:495](../../backend/startup.py#L495)

### Production web theo nhóm bắt buộc và control hiển thị

Không lặp toàn bộ catalog. File mẫu giữ:

1. identity/origin: `APP_ENV`, `APP_RELEASE_ID`, `APP_PUBLIC_URL`;
2. runtime DB: `DATABASE_URL`, `DATABASE_AUTO_MIGRATE=false`, private network attestation;
3. required secrets: SMTP, email outbox, OTP, audit, restore public key;
4. storage/audit attestations và rotation date;
5. bootstrap block được comment và ghi “first run only”;
6. `SUPER_ADMIN_IP_ALLOWLIST`, `TRUSTED_PROXY_CIDRS`;
7. switch/credential/policy cho trial, PayOS, AI, CAPTCHA, Mua Sắm Công, session, OTP và các feature khác để operator tự quyết định.

Các tuning giữ default không cần dòng active trong file; catalog reference vẫn phải ghi rõ default, range, owner và restart impact.

## Rủi ro compatibility và chiến lược migration

1. **Không đổi default ngầm.** Xóa một dòng khỏi example chỉ an toàn khi source default đúng bằng giá trị cũ. Regression test hiện parse cả compact local và production profile, khóa các feature controls bắt buộc phải nhìn thấy.
2. **Không xóa alias ngay.** Procurement và AI có explicit fallback; xóa reader có thể phá deployment cũ. Đầu tiên chỉ bỏ alias khỏi template active, thêm warning không lộ secret, sau đó đo usage rồi mới ADR xóa.
3. **Không đưa secret nhiều scope vào một process.** Việc tách file phải đi cùng service/job wiring; web hiện fail khi nhận secret đặc quyền. [backend/startup.py:495](../../backend/startup.py#L495)
4. **Origin derivation có thể ảnh hưởng deployment multi-origin.** Chỉ áp dụng tự động cho production same-origin vì code hiện đã enforce same-origin; giữ explicit override cho development/test hoặc tương lai.
5. **Systemd interpolation là dependency cứng.** Unit đã có default cho các `UVICORN_*`; `EnvironmentFile` vẫn là lớp override của operator. [deploy/systemd/biddingflow.service.example](../../deploy/systemd/biddingflow.service.example)
6. **Feature flag là business semantics.** Không gộp/xóa flag thương mại, trial, procurement entitlement/capability chỉ vì muốn giảm env. Có thể tách profile và default off; thay semantics cần ADR/business approval và regression tests.
7. **Startup attestation không phải tuning.** Các xác nhận private network, encryption, off-host checkpoint và rotation hiện là fail-start contract. Giảm thao tác nên làm qua validated deployment manifest/generator, không im lặng default `true`.
8. **`.env` parser đơn giản.** App và scripts có hai loader tương tự nhưng không hoàn toàn là dotenv chuẩn; profile composition không nên dựa vào shell interpolation/include nếu chưa thay loader và test compatibility. [backend/app.py:65](../../backend/app.py#L65) [scripts/env_utils.py:9](../../scripts/env_utils.py#L9)

## Inventory baseline 313 key trong catalog reference

Mục này bảo đảm mỗi key hiện có đều được gắn với owner/subsystem. Ký hiệu đề xuất:

- **base**: còn trong compact profile vì là đầu vào căn bản hoặc control cần nhìn thấy;
- **required-prod**: production contract hiện bắt buộc hoặc bắt buộc có điều kiện;
- **profile**: chuyển sang file tiến trình/tính năng tương ứng;
- **default**: bỏ khỏi file người dùng cần điền, giữ default trong code và ghi ở reference;
- **derive**: có thể suy ra từ source of truth khác, nhưng phải rollout tương thích;
- **alias**: không trình bày trong profile mới, tiếp tục đọc trong compatibility window.

1. **SMTP — profile; production web coi là required-prod:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SENDER`, `SMTP_SECURITY`, `SMTP_TIMEOUT_SECONDS`. Owner là email configuration; production startup gọi validator của subsystem. [backend/startup.py:608](../../backend/startup.py#L608)

2. **App identity/server:** `APP_HOST` (default), `APP_PORT` (default), `APP_ENV` (base), `APP_RELEASE_ID` (required-prod), `APP_DEBUG` (default/required-prod false), `FRONTEND_ASSET_MODE` (default hoặc deploy profile), `APP_SECURE_COOKIES` (default local/required-prod true), `APP_PUBLIC_URL` (required-prod), `ALLOWED_HOSTS` (derive). Owner và default nằm ở app bootstrap; production invariant nằm ở import-time checks. [backend/app.py:89](../../backend/app.py#L89) [backend/app.py:1202](../../backend/app.py#L1202)

3. **Turnstile — feature profile:** `TURNSTILE_ENABLED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES` (derive trong same-origin profile), `TURNSTILE_VERIFY_TIMEOUT_SECONDS`, `TURNSTILE_LOGIN_AFTER_ATTEMPTS`, `TURNSTILE_VERIFY_AFTER_ATTEMPTS`, `TURNSTILE_EDGE_CHALLENGE_HEADER`, `TURNSTILE_EDGE_CHALLENGE_VALUE`. Khi disabled/auto chưa đủ key thì không cần cấu hình cả nhóm; startup dùng một config owner duy nhất. [backend/startup.py:577](../../backend/startup.py#L577) [scripts/check_security_deployment.py:148](../../scripts/check_security_deployment.py#L148)

4. **Frontend secure build — build profile, không phải web runtime:** `ENABLE_JS_DEAD_CODE_INJECTION`, `ENABLE_JS_DEBUG_PROTECTION`. Exhaustive environment reference tự mô tả cả hai là opt-in/default false; nên thuộc build pipeline, không thuộc runtime env. [deploy/environment-variables.reference:57](../../deploy/environment-variables.reference#L57)

5. **Database/Uvicorn:** `DATABASE_URL` (base/required-prod), `LP25_DATABASE_ALLOWLIST` (test profile), `DATABASE_RUNTIME_ROLE` (production web profile), `DATABASE_SSLMODE` (derive/compatibility override), `DATABASE_AUTO_MIGRATE` (default local/required-prod false), `DATABASE_AUTO_START_LOCAL` (default), `DATABASE_PRIVATE_NETWORK_CONFIRMED` (required-prod), `DATABASE_POOL_MIN_SIZE`, `DATABASE_POOL_MAX_SIZE`, `APP_INSTANCE_COUNT`, `UVICORN_WORKERS`, `UVICORN_LIMIT_CONCURRENCY`, `UVICORN_BACKLOG`, `UVICORN_TIMEOUT_KEEP_ALIVE`, `UVICORN_MAX_REQUESTS`, `UVICORN_MAX_REQUESTS_JITTER`, `UVICORN_WS_MAX_SIZE`, `UVICORN_WS_MAX_QUEUE`, `DATABASE_DEDICATED_CONNECTIONS_PER_WORKER`, `DATABASE_RESERVED_CONNECTIONS`, `DATABASE_POOL_TIMEOUT_SECONDS`, `DATABASE_POOL_MAX_IDLE_SECONDS`, `DATABASE_POOL_MAX_LIFETIME_SECONDS`, `DATABASE_CONNECT_TIMEOUT_SECONDS`, `DATABASE_STATEMENT_TIMEOUT_MS`, `DATABASE_LOCK_TIMEOUT_MS`, `DATABASE_IDLE_TRANSACTION_TIMEOUT_MS`, `DATABASE_APPLICATION_NAME` (các key còn lại: default/deploy tuning profile). DB startup contract và process-manager dependency là hai owner chính. [backend/startup.py:139](../../backend/startup.py#L139) [backend/startup.py:194](../../backend/startup.py#L194) [backend/startup.py:454](../../backend/startup.py#L454) [deploy/systemd/biddingflow.service.example:16](../../deploy/systemd/biddingflow.service.example#L16)

6. **Data/audit/retention/cache:** `BIDDING_DATA_DIR` (production storage profile), `DATA_AT_REST_ENCRYPTION_CONFIRMED` (required-prod), `SECRET_ROTATION_CONFIRMED_AT` (required-prod), `BIDDING_BACKUP_RETENTION_COUNT` (backup profile/default), `SYNC_TOMBSTONE_RETENTION_DAYS`, `SYNC_MUTATION_RETENTION_DAYS`, `RETENTION_CLEANUP_BATCH_SIZE`, `API_IDEMPOTENCY_RETENTION_DAYS`, `PARTNER_JOB_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`, `AUDIT_CHAIN_VERIFY_INTERVAL_SECONDS`, `AUDIT_CHECKPOINT_INTERVAL_SECONDS` (operator defaults), `AUDIT_CHECKPOINT_HMAC_KEY`, `AUDIT_CHECKPOINT_OFFHOST_CONFIRMED`, `BIDDING_RESTORE_DRILL_PUBLIC_KEY` (required-prod web), `BIDDING_RESTORE_DRILL_PRIVATE_KEY` (restore-job profile, cấm ở web), `BACKUP_MAX_RPO_SECONDS`, `RESTORE_MAX_RTO_SECONDS`, `OPERATIONAL_ARTIFACT_VERIFY_INTERVAL_SECONDS` (operator defaults), `BIDDING_WORD_TEMPLATE_CATALOG_DIR`, `BIDDING_WORD_EXPORT_CACHE_DIR` (derive từ data root trừ khi override), `WORD_EXPORT_CACHE_ENABLED`, `WORD_EXPORT_CACHE_MAX_MB`, `WORD_EXPORT_CACHE_MAX_ENTRIES` (default/Word profile). [backend/shared/paths.py:15](../../backend/shared/paths.py#L15) [backend/lifecycle.py:214](../../backend/lifecycle.py#L214) [backend/startup.py:621](../../backend/startup.py#L621) [backend/startup.py:641](../../backend/startup.py#L641)

7. **Document worker — worker profile, không để trong web base:** `DOCUMENT_WORKER_EXECUTION_MODE`, `DOCUMENT_WORKER_MAX_CONCURRENCY`, `DOCUMENT_WORKER_INSTANCE_COUNT`, `DOCUMENT_WORKER_QUEUE_TIMEOUT_SECONDS`, `DOCUMENT_WORKER_QUEUE_SIZE`, `DOCUMENT_WORKER_TIMEOUT_SECONDS`, `DOCUMENT_JOB_MAX_ATTEMPTS`, `DOCUMENT_JOB_STALE_SECONDS`, `DOCUMENT_JOB_RETENTION_SECONDS`, `DOCUMENT_JOB_POLL_SECONDS`, `DOCUMENT_JOB_MAX_POLL_SECONDS`, `WORKER_IDLE_POLL_JITTER_RATIO`, `DOCUMENT_WORKER_SHARED_GID`, `DOCUMENT_WORKER_TEMP_DIR`, `AWARD_RESULT_ARTIFACT_SHARED_STORAGE_CONFIRMED`, `AWARD_RESULT_ARTIFACT_MAX_PER_USER`, `AWARD_RESULT_ARTIFACT_MAX_BYTES_PER_USER`, `AWARD_RESULT_ARTIFACT_MAX_PER_ORGANIZATION`, `AWARD_RESULT_ARTIFACT_MAX_BYTES_PER_ORGANIZATION`, `AWARD_RESULT_ARTIFACT_MAX_GLOBAL_BYTES`, `AWARD_RESULT_ARTIFACT_CLEANUP_INTERVAL_SECONDS`, `DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED`, `DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED`, `DOCUMENT_WORKER_CPU_SECONDS`, `DOCUMENT_WORKER_MAX_MEMORY_MB`, `DOCUMENT_WORKER_MAX_OUTPUT_MB`, `DOCUMENT_WORKER_SANDBOX`, `DOCUMENT_WORKER_SANDBOX_EXECUTABLE`, `DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP`, `DOCUMENT_WORKER_SANDBOX_UID`, `DOCUMENT_WORKER_SANDBOX_GID`. Identity/storage attestations và DB URL riêng là required-prod cho standalone worker; tuning còn lại có default. [scripts/run_document_worker.py:230](../../scripts/run_document_worker.py#L230) [scripts/run_document_worker.py:267](../../scripts/run_document_worker.py#L267) [scripts/run_document_worker.py:322](../../scripts/run_document_worker.py#L322)

8. **Bounded execution pools — default/advanced performance profile:** `BLOCKING_IO_MAX_WORKERS`, `BLOCKING_IO_MAX_QUEUE`, `DATABASE_READ_WORKERS`, `DATABASE_READ_QUEUE`, `DATABASE_WRITE_WORKERS`, `DATABASE_WRITE_QUEUE`, `CPU_WORKER_COUNT`, `CPU_WORKER_QUEUE`. Không phải input bắt buộc của fresh install; owner đọc bounded defaults. [backend/shared/async_io.py:24](../../backend/shared/async_io.py#L24)

9. **Email outbox/conflict/OTP:** `EMAIL_OUTBOX_ENCRYPTION_KEY` (required-prod), `EMAIL_OUTBOX_STALE_SECONDS`, `EMAIL_OUTBOX_POLL_SECONDS`, `EMAIL_OUTBOX_MAX_POLL_SECONDS` (default); `CONFLICT_CENTER_ENABLED` (default false), `CONFLICT_DRAFT_ENCRYPTION_KEY`, `CONFLICT_RESOLUTION_SIGNING_KEY` (conflict profile, bắt buộc có điều kiện); `OTP_HMAC_KEY` (required-prod), `EMAIL_CHANGE_OTP_TTL_SECONDS`, `EMAIL_CHANGE_REQUEST_MAX`, `EMAIL_CHANGE_REQUEST_WINDOW_SECONDS`, `EMAIL_CHANGE_VERIFY_MAX`, `EMAIL_CHANGE_VERIFY_WINDOW_SECONDS` (default). [backend/startup.py:590](../../backend/startup.py#L590) [backend/startup.py:613](../../backend/startup.py#L613) [backend/startup.py:617](../../backend/startup.py#L617)

10. **Request/session transport limits — default/operator profile:** `REQUEST_MAX_JSON_BYTES`, `REQUEST_MAX_SYNC_BYTES`, `REQUEST_MAX_DOCUMENT_BYTES`, `REQUEST_MAX_PACKAGE_DOCUMENT_BYTES`, `SYNC_MAX_BATCH_ITEMS`, `EXCEL_MAX_IMPORT_ROWS`, `WEBSOCKET_MAX_FRAME_BYTES`, `WEBSOCKET_MAX_CONNECTIONS_PER_IP`, `WEBSOCKET_MAX_CONNECTIONS_PER_USER`, `PROTECTED_MEDIA_URL_TTL_SECONDS`, `EVENT_LOOP_LAG_INTERVAL_SECONDS`, `EVENT_LOOP_LAG_WARN_MS`. Ví dụ source owners cung cấp default trực tiếp. [backend/sync/request_contract.py:10](../../backend/sync/request_contract.py#L10) [backend/shared/media_helper.py:49](../../backend/shared/media_helper.py#L49) [backend/lifecycle.py:70](../../backend/lifecycle.py#L70)

11. **Observability — operator profile/default:** `METRICS_ENABLED`, `METRICS_ALLOWED_CIDRS`, `BIDDING_METRICS_PUBLISH_INTERVAL_SECONDS`, `STRUCTURED_REQUEST_LOG_MODE`, `LOG_INCLUDE_EXCEPTION_DETAILS`, `BIDDING_RESTORE_DRILL_STATE_FILE`. Không bắt local user điền; production operator chỉ override topology/token/path cần thiết. [backend/observability/metrics.py:1389](../../backend/observability/metrics.py#L1389) [backend/observability/metrics.py:1410](../../backend/observability/metrics.py#L1410) [backend/shared/logging_utils.py:231](../../backend/shared/logging_utils.py#L231)

12. **First-run admin — bootstrap profile:** `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_EMAIL`, `DEFAULT_ORG_NAME`. Chỉ password bắt buộc local khi DB trống; production DB trống yêu cầu đủ block. [backend/startup.py:677](../../backend/startup.py#L677) [backend/startup.py:692](../../backend/startup.py#L692)

13. **Password hashing — security tuning/default:** `ARGON2_TIME_COST`, `ARGON2_MEMORY_COST_KIB`, `ARGON2_PARALLELISM`. Không phải fresh-install input; chỉ override sau benchmark. Default được đọc tại password hashing owner. [backend/auth/auth_helper.py:23](../../backend/auth/auth_helper.py#L23)

14. **Origins, access, rate limit, partner lookup:** `CORS_ORIGINS`, `ALLOWED_WS_ORIGINS` (derive từ public URL cho production same-origin), `SUPER_ADMIN_IP_ALLOWLIST`, `TRUSTED_PROXY_CIDRS` (required-prod/topology), `PRIVILEGED_REAUTH_TTL_SECONDS`, `RATE_LIMIT_MAX_ATTEMPTS`, `RATE_LIMIT_WINDOW_SECONDS`, `PARTNER_LOOKUP_MAX_CONCURRENCY`, `PARTNER_LOOKUP_SLOT_TIMEOUT_SECONDS`, `PARTNER_LOOKUP_LOCK_TIMEOUT_SECONDS`, `PARTNER_LOOKUP_POLL_SECONDS`, `PARTNER_LOOKUP_MAX_POLL_SECONDS`, `PARTNER_LOOKUP_POSITIVE_CACHE_SECONDS`, `PARTNER_LOOKUP_NEGATIVE_CACHE_SECONDS`, `PARTNER_UPSTREAM_MAX_ATTEMPTS`, `PARTNER_MUASAMCONG_TIMEOUT_SECONDS`, `PARTNER_MUASAMCONG_AREA_TIMEOUT_SECONDS`, `PARTNER_VIETQR_TIMEOUT_SECONDS`, `PARTNER_ESCODATA_TIMEOUT_SECONDS` (default/operator tuning). [backend/app.py:1196](../../backend/app.py#L1196) [backend/app.py:1202](../../backend/app.py#L1202) [backend/partners/partner_lookup_service.py:36](../../backend/partners/partner_lookup_service.py#L36)

15. **Mua Sắm Công browser lookup — code default + browser policy:** `PROCUREMENT_LOOKUP_ENABLED` mặc định bật trong code và chỉ còn là rollback override; browser mode mặc định là `research-stealth` với exact official hostname. Các driver/extractor/timeout/cache vẫn có bounded default và `standard` vẫn là rollback adapter. [backend/procurement_lookup/config.py:72](../../backend/procurement_lookup/config.py#L72) [backend/integrations/muasamcong_browser/procurement_source.py:138](../../backend/integrations/muasamcong_browser/procurement_source.py#L138)

16. **Sessions — default/security profile:** `SESSION_EXPIRY_HOURS`, `SESSION_REMEMBER_EXPIRY_HOURS`, `SESSION_INACTIVITY_TIMEOUT_HOURS`, `SESSION_ACTIVITY_TOUCH_SECONDS`, `SESSION_RETENTION_DAYS`. Không có key nào là startup-required; retention có default. [backend/lifecycle.py:265](../../backend/lifecycle.py#L265) [deploy/environment-variables.reference:393](../../deploy/environment-variables.reference#L393)

17. **Google login — feature profile:** `GOOGLE_AUTH_ENABLED`, `GOOGLE_CLIENT_ID`. App mặc định auto: chỉ bật ở production; client ID rỗng không expose widget. `GOOGLE_CLIENT_SECRET` có trong local `.env` nhưng không có trong `.env.example`, nên phải được catalog/profile owner xác nhận trước khi dọn. [backend/app.py:140](../../backend/app.py#L140)

18. **AI — feature profile; tên `AI_*` canonical:** `AI_ENABLED`, `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_PROVIDER_ALLOWED_HOSTS`, `AI_PROVIDER_PROXY_URL`, `AI_PROVIDER_ALLOWED_PROXY_HOSTS`, `AI_API_VERSION`, `AI_PROVIDER_VERSION`, `AI_AUTH_TYPE`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AI_MODEL`, `AI_MAX_OUTPUT_TOKENS`, `AI_REQUEST_TIMEOUT_SECONDS`, `AI_TOOL_TIMEOUT_SECONDS`, `AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_TOKEN_LIMIT`, `AI_CONVERSATION_RETENTION_DAYS`, `AI_PROVIDER_STORE_RESPONSES`, `AI_CHAT_INCLUDE_USAGE`, `AI_CHAT_MAX_TOKENS_FIELD`, `AI_KNOWLEDGE_ENABLED`, `AI_KNOWLEDGE_TOP_K`, `AI_KNOWLEDGE_MIN_SCORE`, `AI_KNOWLEDGE_MAX_CONTEXT_CHARS`, `AI_KNOWLEDGE_CANDIDATE_LIMIT`, `AI_WEB_SEARCH_ENABLED`, `AI_WEB_SEARCH_PROVIDER`, `AI_WEB_SEARCH_API_KEY`, `AI_WEB_SEARCH_BASE_URL`, `AI_WEB_SEARCH_PROVIDER_ALLOWED_HOSTS`, `AI_WEB_SEARCH_PROXY_URL`, `AI_WEB_SEARCH_ALLOWED_PROXY_HOSTS`, `AI_WEB_SEARCH_MODEL`, `AI_WEB_SEARCH_TIMEOUT_SECONDS`, `AI_WEB_SEARCH_ALLOWED_DOMAINS`. `OPENAI_*` là alias; khi AI off không cần cấu hình phần còn lại. [backend/ai/configuration.py:104](../../backend/ai/configuration.py#L104) [backend/ai/configuration.py:163](../../backend/ai/configuration.py#L163) [backend/ai/configuration.py:174](../../backend/ai/configuration.py#L174)

19. **Violation lookup/procurement import — code default + compatibility overrides:** procurement import mặc định bật với provider `muasamcong`; `PROCUREMENT_IMPORT_ENABLED` và `PROCUREMENT_PROVIDER` chỉ cần cho rollback/migration. Các alias `VNEPS_*` vẫn được đọc khi deployment cũ khai báo tường minh; fixture vẫn chỉ dùng test. Các timeout, cache và concurrency có bounded defaults. [backend/procurement_import/runtime.py:23](../../backend/procurement_import/runtime.py#L23) [backend/procurement_import/runtime.py:45](../../backend/procurement_import/runtime.py#L45) [backend/contractor_risk/routes.py:37](../../backend/contractor_risk/routes.py#L37)

20. **Logging/version/legal — defaults/feature profiles:** `LOG_MAX_BYTES`, `LOG_BACKUP_COUNT` (logging defaults), `VERSION_COMPARISON_ENABLED`, `LEGAL_VERSIONING_ENABLED`, `AI_COMPLIANCE_ENABLED` (feature flags; không gộp semantics). [backend/shared/logging_utils.py:88](../../backend/shared/logging_utils.py#L88) [backend/startup.py:61](../../backend/startup.py#L61) [backend/startup.py:72](../../backend/startup.py#L72)

21. **Commercial/payment — feature profile, giữ nguyên business semantics:** `TRIAL_FULL_ACCESS_ENABLED`, `COMMERCIAL_POLICY_ENABLED`, `COMMERCIAL_POLICY_MODE`, `PAYMENT_CHECKOUT_ENABLED`, `PAYMENT_ACTIVATION_ENABLED`, `PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED`, `COMMERCIAL_PAYMENT_PROVIDER`, `PAYMENT_PROVIDER_ENVIRONMENT`, `COMMERCIAL_EXTERNAL_LEGAL_READY`, `PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED`, `PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED`, `PAYOS_CREDENTIAL_REFERENCE`, `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`. Mặc định policy/payment off; credential/readiness chỉ required khi payOS payment bật. [backend/commercial_policy/config.py:22](../../backend/commercial_policy/config.py#L22) [backend/commercial_policy/config.py:84](../../backend/commercial_policy/config.py#L84)

22. **Word export/catalog — Word feature profile/default:** `WORD_EXPORT_STANDARDIZATION_MODE`, `WORD_TEMPLATE_CATALOG_ENABLED`, `WORD_TEMPLATE_CATALOG_MODE`, `WORD_TEMPLATE_PROJECTION_POLL_SECONDS`, `WORD_TEMPLATE_PROJECTION_MAX_POLL_SECONDS`, `WORD_TEMPLATE_RETENTION_INTERVAL_SECONDS`. Catalog path đã nằm ở nhóm storage; production chỉ bắt explicit absolute path khi catalog enabled. [backend/startup.py:37](../../backend/startup.py#L37)

23. **Product analytics — analytics job/profile:** `ANALYTICS_HMAC_KEY`, `ANALYTICS_AI_COST_VND_MULTIPLIER`. HMAC key được route/refresh job dùng; multiplier rỗng có semantics “cost not configured”, vì vậy không cần active line trong base. [backend/product_analytics/routes.py:38](../../backend/product_analytics/routes.py#L38) [backend/product_analytics/aggregation.py:358](../../backend/product_analytics/aggregation.py#L358)

Tổng số key trong 23 nhóm baseline ban đầu là 313. Sau khi chuyển năm flag/provider canonical và legacy của Mua Sắm Công thành override comment, catalog còn 308 dòng active nhưng vẫn catalog đủ tên biến. Các dòng provider-specific đang comment (Anthropic/Gemini/Ollama/Azure), CA file, metrics bearer token, credential backup/worker và appendix override code-owned là catalog/profile tham khảo. Lượt quét source cuối đã catalog mọi literal environment input do ứng dụng/script sở hữu; hai tên không phải input của BiddingFlow là `PATH` của hệ điều hành và `INVOCATION_ID` do systemd cấp (tên sau vẫn được ghi chú để dễ tra cứu). [deploy/systemd/biddingflow.service.example:23](../../deploy/systemd/biddingflow.service.example#L23) [deploy/runbooks/metrics-multiworker.md:18](../../deploy/runbooks/metrics-multiworker.md#L18)

## Trạng thái triển khai và phần để dành

### Đã thực hiện

- Đổi `.env.example` thành compact local profile và tạo `deploy/production.env.example`.
- Chuyển baseline đầy đủ sang `deploy/environment-variables.reference`.
- Giữ reader/default và các alias tương thích; không đổi quyền, entitlement hoặc hiển thị dữ liệu.
- Thêm regression test cho trial, PayOS Client/API/checksum/reference, AI, Turnstile/reCAPTCHA, procurement, session, OTP và các feature controls khác.
- Đặt Uvicorn defaults trong systemd unit để tuning không còn là input bắt buộc của `web.env`.
- Nối `PROCUREMENT_BROWSER_MODE` vào unified Mua Sắm Công runtime; `research-stealth` vẫn yêu cầu gate riêng, exact official host, không thêm solver/token replay/bypass hay Chromium flags yếu.
- Bổ sung appendix dạng comment cho các override code-owned phát hiện sau khi đối chiếu source (sync/Excel signing, AI bounds, billing worker, procurement enrichment/session, sync paging, partner retry, metrics và Word cache). Appendix không làm tăng số biến active phải cấu hình.
- Đồng bộ placeholder `APP_RELEASE_ID=replace-with-release-id` của production template với startup validation để bản mẫu chưa được điền luôn bị từ chối đúng như contract.

### Có thể làm sau, cần compatibility review

- Suy ra exact production origins/hostnames từ `APP_PUBLIC_URL` khi key phụ bị thiếu.
- Canonicalize PostgreSQL SSL trong URL.
- Phát cảnh báo khi dùng aliases procurement/AI; không log secret.
- Cập nhật preflight để hiển thị effective config đã redacted.

### Chỉ làm khi có ADR/business approval

- Sau một chu kỳ quan sát, bỏ aliases không còn dùng bằng ADR + migration note.
- Chỉ cân nhắc gộp feature flags khi chủ sản phẩm xác nhận semantics; phải có regression test tại entitlement/capability seams.

## Tiêu chí nghiệm thu

- Fresh local install dùng compact profile, không phải copy catalog baseline 313 key; chỉ điền secret/value của phần thực sự dùng.
- Trial, PayOS, AI, CAPTCHA, browser policy/reCAPTCHA Mua Sắm Công, session, OTP và các feature controls còn cần operator quyết định vẫn nhìn thấy trong cả local và production template; lookup/import/provider Mua Sắm Công dùng code default đã ghi trong ADR 0032.
- Production web, document worker, migrator và backup job không nhận secret ngoài scope.
- Effective config của các biến tuning không đổi; lookup/import/provider Mua Sắm Công đổi default theo phê duyệt và ADR 0032.
- Startup vẫn fail với production thiếu attestation/secret bắt buộc.
- Không thay đổi tenant isolation, module permission, assignment/record scope, entitlement, masking hoặc dữ liệu hiển thị.
- Mọi thay đổi derivation/alias có compatibility tests và ADR trước khi xóa contract cũ.
