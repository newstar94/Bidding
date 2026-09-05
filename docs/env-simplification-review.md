# Rà soát khả năng tinh giản cấu hình môi trường BiddingFlow

> Đã triển khai đợt PostgreSQL cục bộ: `.env` còn 77 biến, 18 biến chuyển vào
> profile riêng tư và 9 URL sinh từ kết nối chính. Xem `docs/database-profile.md`.
> Tài khoản/mật khẩu và database không gộp; chưa thay các cặp ENABLED/MODE thương mại/Word.

> Cập nhật theo ADR 0036: trình duyệt không còn lựa chọn mode hoặc cờ bật riêng.
> Các đề xuất về hai công tắc chế độ bên dưới là lịch sử nghiên cứu, đã được thay
> bằng launcher thống nhất. Allowlist hiện dùng `PROCUREMENT_ALLOWED_TARGET_HOSTS`.

## Cập nhật triển khai đợt 1

Đã thực hiện sau khi được người dùng chấp thuận: bỏ 13 khai báo tương đương mặc định/kế thừa và biến đã nghỉ dùng `WORD_EXPORT_STANDARDIZATION_MODE` ở cả `.env` và `.env.example`. Số biến đang khai báo còn 94 và 64. Các con số và nội dung nghiên cứu bên dưới là ảnh chụp trước khi thực hiện.

Công cụ `python scripts/simplify_env.py` mặc định chỉ kiểm tra; thêm `--apply` mới ghi. Công cụ xét riêng từng file, so sánh bộ đọc AI/tra cứu cả khi có biến môi trường tiến trình; giữ override nếu khác mặc định, giữ nguyên các giá trị còn lại và không in bí mật. Chỉ xóa mô tả liền trước biến được bỏ. Các override vẫn được hỗ trợ trong code và có tại `deploy/environment-variables.reference`; không nạp toàn bộ file tham chiếu làm cấu hình.

Chưa tách setup/test, chưa đổi cặp enabled/mode, chưa bỏ khóa HMAC legacy hoặc Google secret cần xác minh công cụ ngoài repo. Công cụ setup PostgreSQL hiện ghi trực tiếp `.env` (`scripts/setup_local_postgres.py:615-735`); tách vật lý phải thay cả reader/writer, launcher, test và cách cấp credential dịch vụ. Đây là đợt tiếp theo, không phải đã hoàn thành trong đợt 1. Không thay permission, entitlement, khóa mã hóa, dữ liệu DB, chính sách thanh toán hoặc restart dịch vụ.

Ngày kiểm tra: 05/09/2026. Chỉ nghiên cứu; chưa sửa cấu hình, quyền hoặc dữ liệu. Chỉ liệt kê tên biến của `.env`, không xuất giá trị bí mật.

## Kết luận và phạm vi

Đếm bằng `dotenv_values`: `.env` có 108 biến đang khai báo; `.env.example` có 78 biến đang khai báo và một dòng biến bị comment. Hợp của hai tập biến đang khai báo là 112 tên. Số 79 trong lần sắp xếp file mẫu trước đây tính cả dòng comment, không phải 79 biến có hiệu lực.

Có thể giảm đáng kể số dòng cấu hình phải duy trì, nhưng cần phân biệt ba việc: bỏ khai báo vì code đã có mặc định, bỏ biến cũ không còn được đọc, và thay kiến trúc để dùng một nguồn cấu hình. Đây không phải đề nghị gộp tất cả credential hay công tắc nghiệp vụ.

Nghiên cứu đối chiếu tên biến với code backend, frontend, scripts và các nguồn dẫn dưới đây; kiểm tra biến không tìm thấy consumer rộng hơn trong tests/tài liệu. Không đọc môi trường của tiến trình đang chạy, không gọi dịch vụ AI/thanh toán, không thay quyền, không sửa `.env` hoặc `.env.example`. Kết quả bằng nhau của bộ đọc cấu hình không thay thế kiểm tra production/launcher, biến do hệ điều hành cấp và các môi trường khác.

## 1. Nhóm có thể bỏ khai báo theo mặc định/kế thừa hiện tại

Thử nghiệm chỉ đọc: nạp `.env` vào dictionary, tạo cấu hình bằng hàm thật; xóa các khóa khỏi bản sao trong bộ nhớ; so sánh toàn bộ đối tượng cấu hình trước/sau, không in giá trị.

| Nhóm | Biến ứng viên | Kết quả và ràng buộc |
|---|---|---|
| AI — mặc định | `AI_BASE_URL`, `AI_PROVIDER_ALLOWED_HOSTS`, `AI_KNOWLEDGE_ENABLED`, `AI_PROVIDER_STORE_RESPONSES`, `AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_TOKEN_LIMIT`, `AI_WEB_SEARCH_PROVIDER`, `AI_WEB_SEARCH_ALLOWED_DOMAINS` | Cùng với hai biến kế thừa bên dưới, bỏ đồng thời vẫn cho `get_ai_config` giống hệt trên cấu hình file hiện tại. Provider/URL riêng có thể cần override. Nguồn: `backend/ai/configuration.py:114-202`, `228-282`. |
| AI — kế thừa | `AI_WEB_SEARCH_API_KEY`, `AI_WEB_SEARCH_MODEL` | Khóa tìm kiếm có chuỗi fallback qua `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `AI_API_KEY`; model tìm kiếm fallback về model chính. Chỉ bỏ khi cùng nhà cung cấp/tài khoản và model phù hợp; không dùng khóa của một nhà cung cấp cho nhà cung cấp khác. Nguồn: `backend/ai/configuration.py:244-267`. |
| Tra cứu — mặc định | `PROCUREMENT_BROWSER_MODE`, `PROCUREMENT_BROWSER_ENABLED`, `PROCUREMENT_ALLOWED_TARGET_HOSTS` | Bỏ cả ba cùng 10 biến AI: cấu hình AI và `ProcurementLookupSettings` đều bằng trước. Bộ nguồn trình duyệt cũng khai báo các mặc định tương ứng. Nguồn: `backend/procurement_lookup/config.py:73-91`; `backend/integrations/muasamcong_browser/procurement_source.py:147-166`. |

Kết quả đã chạy: `13-key combined AI parity True`; `13-key combined lookup parity True`. Nếu được duyệt, riêng nhóm này có thể giảm `.env` từ 108 xuống 95 dòng khai báo mà không đổi kết quả của hai bộ đọc đã kiểm tra. Chưa gọi đây là xác nhận toàn ứng dụng; mặc định có thể thay đổi khi nâng phiên bản, vì vậy cần khóa regression cho cấu hình triển khai mong muốn. Vẫn giữ các tên override trong tài liệu nâng cao.

## 2. Biến cũ hoặc chỉ phục vụ luồng riêng

- **`WORD_EXPORT_STANDARDIZATION_MODE`: đã hết tác dụng đối với runtime xuất Word.** ADR 0033 yêu cầu loại khỏi mẫu cấu hình; regression cố tình đặt biến legacy để xác nhận không còn ảnh hưởng. Có thể đề xuất bỏ ở cả hai file. Chú thích được thêm trong lần sắp xếp trước chưa nêu rõ điều này. Nguồn: `docs/adr/0033-word-export-preserves-selected-template-format.md:14-17`, `41-49`; `tests/test_word_export_preserves_template.py:48`, `68`.
- **`BIDDING_RESTORE_DRILL_HMAC_KEY`: ứng viên biến cũ**, chưa thấy nơi đọc trong repo; hiện dùng Ed25519 private/public key. Cần kiểm tra công cụ bên ngoài trước khi bỏ, xem phần cơ sở dữ liệu bên dưới.
- **`GOOGLE_CLIENT_SECRET`: không thấy dùng để xác thực đăng nhập Google hiện tại.** Luồng đang xác minh ID token bằng Client ID; secret chỉ xuất hiện trong kiểm tra tách biệt bí mật và danh sách loại khỏi worker. Không khẳng định mọi tích hợp ngoài repo đều không cần. Nguồn: `backend/auth/google_auth_routes.py:55-102`; `backend/startup.py:235-254`; `scripts/run_document_worker.py:216`.
- **`VNEPS_PROCUREMENT_API_AUTHORIZATION_CONFIRMED`: không phải công tắc bắt buộc cho bộ nguồn hiện hành.** Provider phân giải từ cấu hình file không phải `vneps`; class VNEPS vẫn luôn từ chối khởi tạo sau bước xác nhận. Có thể chuyển biến vào tài liệu adapter legacy, không xóa điều kiện xác nhận quyền sử dụng API khỏi code. Nguồn: `backend/procurement_import/runtime.py:23-42`; `backend/integrations/vneps/procurement_provider.py:238-256`.

## 3. Cặp công tắc có thể thiết kế gọn hơn, nhưng cần sửa code và duyệt semantics

| Hiện tại | Hướng nghiên cứu | Không được đánh mất |
|---|---|---|
| `COMMERCIAL_POLICY_ENABLED` + `COMMERCIAL_POLICY_MODE` | Một mode `off/shadow/enforce`, với alias tương thích có cảnh báo | Cần kiểm kê trạng thái `enabled=true, mode=off` và mọi consumer trước khi coi là tương đương. Trial vẫn có ưu tiên riêng. |
| `WORD_TEMPLATE_CATALOG_ENABLED` + `WORD_TEMPLATE_CATALOG_MODE` | Một mode `off/shadow/cutover` | Chế độ shadow, cutover, tắt và điều kiện đường dẫn production. |
| `PROCUREMENT_BROWSER_MODE` + `PROCUREMENT_BROWSER_ENABLED` | Giữ một lựa chọn mode ở cấu hình thông thường; phần nâng cao giữ override khi cần | Điều kiện host chính thức và quyền nguồn dữ liệu không bị nới rộng. |

Nguồn: `backend/commercial_policy/config.py:22-69`; `backend/startup.py:38-60`; `backend/documents/template_catalog/compatibility.py:26-35`; `backend/procurement_lookup/config.py:118-132`.

**Không gộp** checkout, kích hoạt thanh toán, trừ lượt tra cứu, trial và các xác nhận merchant/webhook/pháp lý thành một cờ. Chúng phục vụ các hành động/điều kiện khác nhau; trial chủ động vô hiệu hóa các cờ thương mại, nhưng điều đó không biến chúng thành alias. Nguồn: `backend/commercial_policy/config.py:22-44`, `86-148`.

`APP_ENV`, `APP_DEBUG`, `FRONTEND_ASSET_MODE` cũng không trùng nhau: môi trường, gỡ lỗi và cách dùng tài nguyên frontend là các chiều khác nhau. Khi debug tắt, bundle được dùng bất kể mode; không vì thế xóa mode khỏi các môi trường phát triển. Nguồn: `backend/app.py:94-100`.

## 4. Những biến nên giữ riêng hoặc đưa vào phần nâng cao

- Hai timeout tra cứu thuộc hai tầng. Thử bỏ `PROCUREMENT_LOOKUP_TIMEOUT_SECONDS` khỏi cấu hình file hiện tại làm bộ đọc báo cấu hình không hợp lệ; bỏ timeout worker làm cấu hình thay đổi. Quy tắc là worker phải thấp hơn request ít nhất 5 giây. Không gộp thành một con số; có thể thiết kế suy ra giá trị mặc định cho tầng con sau khi kiểm thử. Nguồn: `backend/procurement_lookup/config.py:151-172`.
- `SMTP_USER` và `SMTP_SENDER`: tài khoản xác thực khác địa chỉ From. Bộ gửi đã fallback sender về username, nhưng validator production yêu cầu sender khai báo rõ; không bỏ đồng loạt. Nguồn: `backend/auth/email_utils.py:48-51`, `78-94`.
- `AI_DAILY_REQUEST_LIMIT` và `AI_DAILY_TOKEN_LIMIT`: hai hạn mức khác đơn vị. Dùng mặc định để giảm dòng, không hợp nhất thành một hạn mức. Nguồn: `backend/ai/configuration.py:199-200`.
- `LEGAL_VERSIONING_ENABLED`, `AI_COMPLIANCE_ENABLED`, `VERSION_COMPARISON_ENABLED`: tính năng khác nhau; AI compliance phụ thuộc legal nhưng không thay thế legal hoặc so sánh phiên bản. Nguồn: `backend/startup.py:61-81`; `backend/version_comparison/routes.py:22-25`, `158`.
- Bộ Turnstile của ứng dụng và reCAPTCHA của nguồn đấu thầu không phải cùng dịch vụ. Các giới hạn đăng nhập và xác minh cũng đọc ở hai luồng riêng. Nguồn: `backend/auth/auth_routes.py` (`TURNSTILE_LOGIN_AFTER_ATTEMPTS`), `backend/auth/otp_routes.py` (`TURNSTILE_VERIFY_AFTER_ATTEMPTS`), `backend/integrations/muasamcong_browser/registry.py:22`.

## 5. Lộ trình đề xuất — chưa thực hiện

1. **Đợt ít rủi ro:** bỏ biến đã chính thức nghỉ dùng; chuyển các khai báo trùng mặc định thành override tùy chọn sau kiểm tra parity, không đổi giá trị hiệu lực.
2. **Tách trách nhiệm:** cấu hình chạy ứng dụng chỉ chứa biến cần vận hành; thông tin tạo role/DB thuộc cấu hình setup, cơ sở dữ liệu test thuộc cấu hình test, backup/worker được cấp đúng cấu hình dịch vụ. Chưa tự tạo file `.env.*`: loader hiện tại không mặc nhiên nạp chúng; phải cập nhật công cụ nạp và thứ tự ưu tiên cùng lúc. Ví dụ loader hiện tại: `scripts/env_utils.py:9-23`.
3. **Một nguồn nhập:** cân nhắc suy ra origin từ URL công khai và sinh URL từ profile kết nối; giữ override và các ranh giới đã được duyệt.
4. **Đợt thay code:** hợp nhất các cặp enabled/mode sau khi có mapping trạng thái đầy đủ, cảnh báo biến legacy, migration/rollback và regression; không tự gộp cờ quyền hoặc xác nhận bên ngoài.
5. **Xác minh trước áp dụng:** so sánh cấu hình trước/sau không lộ giá trị; chạy test các bộ đọc/startup, thử web/worker/setup/backup/test bằng môi trường cách ly; khi triển khai thực sự kiểm tra cấu hình hiệu lực sau restart. Giữ nguyên `.env` hiện tại trong lần nghiên cứu này.

## Phụ lục: cơ sở dữ liệu, bí mật và nguồn truy cập

## Có thể giảm số biến phải nhập

1. **Tên miền là ứng viên rõ nhất.** Trong production, `CORS_ORIGINS` và `ALLOWED_WS_ORIGINS` bắt buộc bằng đúng `APP_PUBLIC_URL`; `ALLOWED_HOSTS` bắt buộc bằng hostname của URL đó (`backend/app.py:1374-1388`). Có thể sửa bộ đọc cấu hình để suy ra ba trường khi không khai báo, vẫn kiểm tra và giữ override hợp lệ; chưa thể xóa ngay vì CORS/WS hiện mặc định localhost (`backend/app.py:1345-1349`, `backend/shared/origin_policy.py:97-110`). `CSRF_TRUSTED_ORIGINS` đã fallback về `APP_PUBLIC_URL` khi bỏ trống (`backend/shared/origin_policy.py:40-57`); nếu cấu hình hiện tại tương đương chính xác thì đây là ứng viên bỏ khai báo mà không cần đổi logic. Phải giữ các trường hợp dev/test và miền phụ hiện được cho phép; không gộp mù danh sách trust.

2. **Mật khẩu dịch vụ và URL chứa mật khẩu là dữ liệu nhập lặp, nhưng các tài khoản không trùng vai trò.** Công cụ khởi tạo nhận bốn `DATABASE_*_PASSWORD` rồi xây bốn URL (`scripts/setup_local_postgres.py:615-660`); công cụ cấp quyền cũng đọc mật khẩu rời để tạo/đổi tài khoản (`scripts/configure_database_roles.py:49-77`). Có thể chỉ nhập một nguồn cho từng tài khoản và sinh URL trong công cụ quản trị, hoặc chuyển các biến khởi tạo khỏi cấu hình chạy thường ngày. Không gộp runtime/migrator/backup/document-worker thành một tài khoản: hiện code yêu cầu bốn role khác nhau (`scripts/configure_database_roles.py:62-64`) và web production cấm mang theo các credential đặc quyền (`backend/startup.py:496-516`).

3. **`LOAD_TEST_DATABASE_URL` và `PERFORMANCE_DATABASE_URL` được công cụ setup ghi cùng một URL** (`scripts/setup_local_postgres.py:680-683`). Trong phạm vi code, scripts, tests và CI đã tìm, không thấy consumer chạy thực tế ngoài setup/reset. Đây là ứng viên ngừng sinh hoặc giữ một tên canonical sau khi kiểm tra script vận hành bên ngoài. Không khẳng định chúng vô dụng với công cụ ngoài repo.

4. **`RUNTIME_DATABASE_URL` là giá trị được setup sinh, không phải biến backend tự dùng.** Backend đọc `DATABASE_URL` (`backend/db/db_helper.py:339-345`); `RUNTIME_DATABASE_URL` xuất hiện ở setup và các danh sách lọc credential của sandbox/worker (`scripts/setup_local_postgres.py:655`, `scripts/run_document_worker.py:206`). Có thể chuyển URL này thành đầu ra hướng dẫn triển khai thay vì luôn giữ trong `.env`; phải kiểm tra launcher/triển khai ngoài repo trước. Không mặc định `RUNTIME_DATABASE_URL` và `DATABASE_URL` có cùng tài khoản.

5. **`BIDDING_RESTORE_DRILL_HMAC_KEY` có dấu hiệu biến cũ.** Không thấy consumer trong backend/scripts/tests; cơ chế hiện tại ký bằng `BIDDING_RESTORE_DRILL_PRIVATE_KEY` và xác minh bằng public key (`scripts/backup.py:670-680`, `backend/observability/metrics.py:284`, `backend/startup.py:623-634`). Ứng viên loại bỏ sau kiểm tra ngoài repo; private/public key vẫn là cặp khác nhiệm vụ, không gộp.

## Nhìn giống nhưng không nên gộp

- `BACKUP_DATABASE_URL` fallback về `DATABASE_URL` (`scripts/backup.py:419-421`); `MIGRATOR_DATABASE_URL` fallback tương tự (`scripts/manage_database.py:56-57`). Fallback hỗ trợ dev, không phải bằng chứng nên dùng chung credential production.
- `RESTORE_DRILL_DATABASE_URL` phải khác đích dữ liệu chính; công cụ kiểm tra tách biệt trước `pg_restore --clean` (`scripts/backup.py:631-646`). Không gộp với `DATABASE_URL`.
- `TEST_DATABASE_URL`, `API_TEST_DATABASE_URL`, `MULTIWORKER_TEST_DATABASE_URL` được sinh cho các database riêng (`scripts/setup_local_postgres.py:663-678`). Có thể sinh từ profile kết nối dùng chung, nhưng phải giữ tên DB cách ly để các suite không đè dữ liệu nhau. `PACKAGE_SMOKE_DATABASE_URL` đã fallback `API_TEST_DATABASE_URL` (`scripts/package_production.py:466-475`).
- `EMAIL_OUTBOX_ENCRYPTION_KEY`, `CONFLICT_DRAFT_ENCRYPTION_KEY`, `CONFLICT_RESOLUTION_SIGNING_KEY`, `OTP_HMAC_KEY`, `AUDIT_CHECKPOINT_HMAC_KEY` phục vụ miền dữ liệu/chữ ký riêng; production chủ động từ chối tái sử dụng bí mật (`backend/startup.py:235-273`). Có thể tự sinh qua setup để giảm thao tác, không thay bằng một master key trong phạm vi dọn ENV; cần chiến lược chuyển đổi dữ liệu mã hóa/rotation nếu muốn thay kiến trúc.
- Năm `SESSION_*` không phải alias: thời hạn thường/ghi nhớ chọn theo `remember` (`backend/auth/auth_routes.py:461`); inactivity là giới hạn nhàn rỗi; touch là chu kỳ cập nhật DB (`backend/auth/auth_helper.py:44-48`, `185`); retention dùng dọn lịch sử (`backend/lifecycle.py:265`). Có thể đưa touch/retention vào cấu hình nâng cao nhưng không gom thành một thời hạn.

## Hướng đề xuất

Ưu tiên giảm phần người vận hành phải nhìn/nhập: một URL công khai có giá trị suy ra; tách cấu hình khởi tạo DB và test khỏi runtime; bỏ biến cũ sau xác minh; giữ biến nâng cao ở tài liệu tham chiếu. Bảo toàn giá trị hiệu lực, sự cách ly DB, danh sách nguồn được phép và thời hạn session hiện tại. Không suy ra rằng ít dòng ENV đồng nghĩa ít chính sách cần quản lý.
