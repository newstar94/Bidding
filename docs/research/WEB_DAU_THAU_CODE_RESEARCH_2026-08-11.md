# Nghiên cứu code `WEB_DAU_THAU.zip`

Ngày kiểm tra: **2026-08-11**, múi giờ Asia/Saigon.

Nguồn phân tích: `WEB_DAU_THAU.zip`, SHA-256
`FBE5C28E667C1460EDDED10803357DE6AE2AFD7731A965DC09378B0B1DEB56DD`.

Phương pháp: giải nén vào thư mục tạm, chỉ đọc và phân tích tĩnh. Không chạy
crawler, không cài dependency, không gọi Mua Sắm Công hoặc Supabase, không dùng
token/cookie có trong archive.

## 1. Kết luận ngắn

1. Archive là **kho thử nghiệm/crawler và tài liệu quan sát**, không phải một
   connector production hoàn chỉnh.
2. Giá trị lớn nhất đối với BiddingFlow là các bản chụp shape dữ liệu, danh mục
   type/stepCode, payload tìm kiếm và template Vue được sao chép từ portal.
3. Archive xác nhận thêm các kết luận trong hai tài liệu KHLCNT hiện có:
   - `smart/search` được frontend gọi với reCAPTCHA token;
   - detail KHLCNT, detail gói và detail TBMT đều được bọc token;
   - hai version-list KHLCNT/TBMT là route riêng;
   - KHLCNT trả `bidpPlanDetailToProjectList` và từng gói có `idDetail`;
   - resolve `notifyNo` thử TBMT trước rồi fallback pre-notify.
4. Không được tái sử dụng trực tiếp crawler hiện có. Nó chủ động che dấu
   automation, lấy/reuse reCAPTCHA token và cookie, lưu raw response, không có
   provenance/idempotency/CAS/tenant boundary, và không triển khai semantics
   revision của đặc tả BiddingFlow.
5. Archive chứa các giá trị cấu hình Supabase không giống placeholder và các
   cURL capture có token/cookie. Không ghi giá trị vào báo cáo. Nếu chúng từng
   là credential thật, phải coi là đã lộ và rotate/revoke.

## 2. Inventory

Archive có 145 entries, trong đó:

- 69 JSON;
- 10 JavaScript;
- 4 Vue;
- 5 Markdown;
- 2 SQL;
- 1 HTML monitor;
- 2 ảnh chụp màn hình;
- `.env`, `.env.example`, `package.json`, `package-lock.json`.

Các nhóm chính:

| Nhóm | Vai trò quan sát được |
|---|---|
| `crawler/` | Hai crawler và scheduler ghi Supabase |
| `code_test/` | Puppeteer probe và bản sao template Vue portal |
| `warehouse/` | Catalog, payload, raw/sample response, cURL capture |
| `database/` | Schema crawl tổng quát và schema TBMT riêng |
| `src/monitor/` | Dashboard HTML đọc trực tiếp Supabase |
| `documentation/` | Tài liệu suy diễn type, quan hệ và flow crawl |

Root package chỉ có script TBMT và một `test` cố ý thoát lỗi; dependency gồm
Supabase, dotenv và Puppeteer. Nguồn:
`WEB_DAU_THAU.zip!/package.json:1`.

## 3. Kiến trúc và runtime thực tế

### 3.1. Generic Puppeteer crawler

`crawler/crawler.js`:

- mở Chromium headless;
- tắt sandbox và web security;
- sửa `navigator.webdriver`, plugins, languages và permissions để tránh nhận
  diện automation;
- truy cập trang portal;
- chọc vào Vue component `#search-home.__vue__`;
- gọi `grecaptcha.execute(...)`, sau đó dùng token để POST `smart/search`;
- điều hướng sang trang detail và intercept response `/get-by-id`;
- lưu nguyên `list_data` và `detail_data` vào `raw_records`.

Nguồn:

- `WEB_DAU_THAU.zip!/crawler/crawler.js:41`;
- `WEB_DAU_THAU.zip!/crawler/crawler.js:68`;
- `WEB_DAU_THAU.zip!/crawler/crawler.js:176`;
- `WEB_DAU_THAU.zip!/crawler/crawler.js:193`;
- `WEB_DAU_THAU.zip!/crawler/crawler.js:314`.

Đây chính là browser scraping/automation-evasion mà đặc tả BiddingFlow đặt ngoài
phạm vi. Nó không tạo ra một API contract hoặc quyền tích hợp hợp lệ.

### 3.2. Direct TBMT crawler

`crawler/tbmt_crawler.js`:

- đọc một token và cookie có thể được cập nhật/tái sử dụng;
- POST trực tiếp `services/smart/search?token=...`;
- quét lùi từng ngày tới 17/09/2022;
- upsert dữ liệu TBMT và location vào Supabase;
- lưu cursor/log, nhưng retry ngày lỗi không có giới hạn.

Nguồn:

- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:24`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:96`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:134`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:226`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:351`.

Code mặc định `notifyVersion = "00"` khi upstream thiếu field. Điều này sai với
nguyên tắc canonical nullable/UNKNOWN và có thể bịa revision:
`WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:159`.

### 3.3. Scheduler

Scheduler mô tả daily crawl, detail crawl, retry, cleanup và health check, nhưng:

- retry vẫn là TODO;
- query pending dùng `.limit(1)` rồi lấy `data.length`, nên không phải tổng số
  pending;
- biến môi trường mong đợi không khớp `.env` đi kèm;
- fallback `CONFIG.supabaseUrl/supabaseKey` không tồn tại trong CONFIG;
- package riêng trong `crawler/` dùng script path không đúng nếu chạy tại chính
  thư mục đó.

Nguồn:

- `WEB_DAU_THAU.zip!/crawler/scheduler.js:31`;
- `WEB_DAU_THAU.zip!/crawler/scheduler.js:89`;
- `WEB_DAU_THAU.zip!/crawler/scheduler.js:128`;
- `WEB_DAU_THAU.zip!/crawler/package.json:1`.

Do đó README mô tả năng lực đầy đủ hơn mức code hiện thực.

## 4. Bằng chứng bổ sung cho nghiên cứu KHLCNT

Template Vue đi kèm khai báo đúng các route quan trọng:

- `smart/search`;
- KHLCNT detail `bid-po-bidp-plan-project-view/get-by-id`;
- KHLCNT version-list `.../get-version-list`;
- package detail `.../get-bidp-plan-detail-by-id`;
- TBMT detail `bid-po-bido-notify-contractor-view/get-by-id`;
- TBMT version-list `.../get-version-list`.

Nguồn: `WEB_DAU_THAU.zip!/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue:468`.

Template cũng thể hiện rõ:

- KHLCNT version-list POST `{planNo}` không bọc `grecaptcha`;
- KHLCNT detail POST `{id}` sau `grecaptcha.execute`;
- package detail POST `{id: pkgId}` sau `grecaptcha.execute`;
- resolve `notifyNo` exact với `es-notify-contractor`, nếu rỗng thì tìm
  `es-pre-notify-contractor`, cả hai lần đều dùng token.

Nguồn:

- `WEB_DAU_THAU.zip!/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue:1731`;
- `WEB_DAU_THAU.zip!/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue:2052`;
- `WEB_DAU_THAU.zip!/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue:3028`;
- `WEB_DAU_THAU.zip!/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue:3070`.

Sample KHLCNT detail có hai nhánh:

- `bidPoBidpPlanProjectDetailView` cho revision kế hoạch;
- `bidpPlanDetailToProjectList[]` cho danh sách gói.

Gói sample có `id`, `bidNo`, `idDetail`, `idPlan`, `planNo`, tên, giá, hình
thức, lĩnh vực, phương thức, process, `linkNotifyInfo`, vốn, thời gian tổ chức,
thời gian hợp đồng, chủ đầu tư và nhiều flag. Nguồn:
`WEB_DAU_THAU.zip!/warehouse/data_example_by_type/Ke_hoach_lua_chon_nha_thau_plan_project/Ke_hoach_lua_chon_nha_thau_plan_project_detail.json`.

Điều này củng cố DTO chuẩn hóa hiện có, nhưng không chứng minh `id`, `bidNo` hoặc
`idDetail` ổn định xuyên `planVersion`. Chúng vẫn phải được xem là observation
metadata cho đến khi có contract chính thức/multi-revision evidence.

## 5. Mapping trong archive không phải production contract

`detail_api_mapping.json` có 17 type và nhiều endpoint hữu ích làm catalog tham
khảo, nhưng mâu thuẫn ngay với runtime/template đi kèm:

- mapping ghi search `/smart-search/search/advance-search`, runtime dùng
  `/smart/search`;
- mapping KHLCNT dùng `bid-po-bidp-plan-project/get-by-id`, template dùng
  `bid-po-bidp-plan-project-view/get-by-id`;
- mapping TBMT dùng `bid-notify-contractor/get-by-id`, template dùng
  `bid-po-bido-notify-contractor-view/get-by-id`.

Nguồn:

- `WEB_DAU_THAU.zip!/warehouse/catalog_search/detail_api_mapping.json:1`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:28`;
- `WEB_DAU_THAU.zip!/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue:475`.

Kết luận: chỉ dùng mapping để tạo danh sách giả thuyết/fixture; adapter thật phải
dựa trên API được cấp quyền và contract tests.

## 6. Không tương thích với mô hình BiddingFlow

Archive không triển khai các invariant sau:

- bốn trục version độc lập;
- traversal version-list và backfill `OBSERVED_NOT_APPLIED`;
- match package observation sang logical root;
- `UNCHANGED/CHANGED/ADDED/REMOVED/AMBIGUOUS`;
- preview-before-persist;
- three-way merge và field ownership;
- immutable historical rows;
- provenance append-only;
- bundle/revision digest;
- CAS, idempotency key và lock theo tenant/plan family;
- transaction nguyên tử cho plan revision + package set;
- enrichment notice vào cùng logical package.

Schema crawl có unique `(plan_no, plan_version)` và
`(notify_no, notify_version)`, nhưng đó chỉ là lưu record nguồn, không phải mô
hình source/local provenance của BiddingFlow. Nguồn:
`WEB_DAU_THAU.zip!/database/supabase_schema.sql:95` và
`WEB_DAU_THAU.zip!/database/supabase_schema.sql:196`.

`bid_packages` không có package revision, plan revision UUID, observation key,
stable binding, source digest hoặc unique constraint phù hợp. Nó chỉ liên kết
`plan_id/plan_no` và lưu `raw_data`:
`WEB_DAU_THAU.zip!/database/supabase_schema.sql:550`.

Tài liệu ERD trong archive gợi ý liên kết package–notice bằng `bidId`, `bidNo`
và `planNo`. Đây là gợi ý cần kiểm chứng, không đủ để auto-match. `planNo` chắc
chắn không phân biệt các gói trong cùng kế hoạch; `bidId/bidNo` chưa được chứng
minh ổn định xuyên plan revision. Nguồn:
`WEB_DAU_THAU.zip!/documentation/Luoc_do_quan_he_doi_tuong.md:247`.

## 7. Security và privacy findings

### 7.1. Credential material trong archive

`.env` có ba giá trị không rỗng, không giống `.env.example` và không trông như
placeholder:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `SUPABASE_SERVICE_ROLE_KEY`.

Không ghi giá trị tại đây. `.gitignore` lại comment các rule `.env`, nên file có
thể bị commit/đóng gói ngoài ý muốn. Nguồn:
`WEB_DAU_THAU.zip!/.env:1` và `WEB_DAU_THAU.zip!/.gitignore:69`.

Ngoài ra có cURL capture chứa reCAPTCHA token/cookie và hai cURL nhà thầu chứa
cookie. Nguồn:

- `WEB_DAU_THAU.zip!/src/api_root/curl_thongbaomoithau/curl_TBMT.js:1`;
- `WEB_DAU_THAU.zip!/warehouse/data_nha_thau/cURL_bash/approved_contractors_list.js:1`;
- `WEB_DAU_THAU.zip!/warehouse/data_nha_thau/cURL_bash/approved_contractors_deatil.js:1`.

Hành động khuyến nghị:

1. Xác minh các credential có thật/đang hoạt động hay không mà không phát tán
   chúng.
2. Nếu từng là thật, rotate Supabase service role và revoke session/cookie.
3. Xóa material khỏi bản phân phối và git history liên quan.
4. Bật secret scanning; `.env` phải ignore, chỉ giữ `.env.example` placeholder.

### 7.2. CAPTCHA/automation gate

README nói crawler dùng stealth để bypass và code sửa dấu hiệu automation, lấy
token từ browser context hoặc reuse token/cookie. Nguồn:

- `WEB_DAU_THAU.zip!/crawler/README.md:73`;
- `WEB_DAU_THAU.zip!/crawler/crawler.js:41`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:24`.

Không đưa bất kỳ kỹ thuật này vào BiddingFlow. External gate vẫn là:
`BLOCKED BY EXTERNAL/API AUTHORIZATION`.

### 7.3. Raw data và tenant/privacy

Schema chủ đích lưu raw list/detail JSON và nhiều sample response thực, gồm dữ
liệu tổ chức/nhà thầu. Không có data minimization/provenance allowlist như đặc
tả BiddingFlow. Nguồn:
`WEB_DAU_THAU.zip!/database/supabase_schema.sql:9`.

Schema tổng quát để RLS ở trạng thái comment/optional; không có organization
scope. Schema TBMT bật anonymous read cho cả dữ liệu, crawl progress và crawl
log. Nguồn:

- `WEB_DAU_THAU.zip!/database/supabase_schema.sql:1063`;
- `WEB_DAU_THAU.zip!/database/bidding_tbmt_schema.sql:209`.

### 7.4. Stored XSS và filter injection trong monitor

Dashboard dựng HTML bằng template string từ các trường DB như tên gói, bên mời
thầu, nhà thầu và lỗi crawler rồi gán `innerHTML` mà không escape. Modal cũng
render trực tiếp field DB. Search lại nội suy input người dùng vào chuỗi
PostgREST `.or(...)`. Nguồn:

- `WEB_DAU_THAU.zip!/src/monitor/index.html:786`;
- `WEB_DAU_THAU.zip!/src/monitor/index.html:828`;
- `WEB_DAU_THAU.zip!/src/monitor/index.html:888`;
- `WEB_DAU_THAU.zip!/src/monitor/index.html:946`.

Không tái sử dụng UI này. Nếu cần dashboard, dùng component an toàn,
`textContent`, validated query builders, CSP/Trusted Types và backend auth.

## 8. Correctness và vận hành

Các lỗi/rủi ro đáng chú ý:

- `tbmt_crawler` bịa revision `00` khi thiếu giá trị;
- retry ngày lỗi không bounded/circuit breaker;
- xóa locations rồi insert lại không cùng transaction, có thể để trạng thái
  rỗng/partial;
- bộ đếm `newCount` tăng cho mọi upsert nên `dupCount` không phản ánh duplicate;
- cursor `lastPage` được đọc nhưng không dùng để resume đúng page;
- scheduler retry là TODO;
- scheduler pending count không đúng;
- generic crawler lưu raw response và chỉ upsert theo UUID `id`;
- không có schema guard, response-size limit, exact host/redirect policy,
  authorization gate hoặc immutable preview;
- không có test assertion.

Nguồn:

- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:226`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:276`;
- `WEB_DAU_THAU.zip!/crawler/tbmt_crawler.js:351`;
- `WEB_DAU_THAU.zip!/crawler/scheduler.js:89`;
- `WEB_DAU_THAU.zip!/crawler/scheduler.js:128`;
- `WEB_DAU_THAU.zip!/package.json:16`.

## 9. Reuse matrix

| Thành phần | Quyết định | Cách dùng an toàn |
|---|---|---|
| Copied Vue templates | Tham khảo | Dùng như evidence tĩnh; xác minh lại first-party hiện hành |
| Sample KHLCNT/TBMT shapes | Tham khảo | Chuyển thành fixture tổng hợp tối thiểu, bỏ raw/real data |
| Catalog type/stepCode | Tham khảo có kiểm chứng | Allowlist + contract tests; unknown giữ warning/unset |
| Search payload examples | Tham khảo | Không gọi production khi chưa có API authorization |
| `detail_api_mapping.json` | Không dùng như contract | Chỉ dùng tạo hypothesis vì endpoint đã drift/mismatch |
| Puppeteer crawler | Không reuse | Vi phạm browser scraping/CAPTCHA gate |
| Direct token/cookie crawler | Không reuse | Reuse credential/token và retry không an toàn |
| Supabase schemas | Không reuse | Thiếu tenant/provenance/revision semantics; lưu raw data |
| Monitor HTML | Không reuse | Anonymous direct DB access và stored-XSS surface |
| cURL/raw responses | Không reuse/không commit | Có token/cookie và dữ liệu thực |

## 10. Hệ quả cho tính năng BiddingFlow

Nghiên cứu ZIP không làm thay đổi đặc tả đã chốt. Nó chỉ bổ sung evidence và
fixture candidates. Khi triển khai:

1. Giữ `ProcurementSource` backend-only và feature flag disabled-by-default.
2. Không copy Puppeteer/cookie/token flow.
3. Chỉ dùng hai version-list public sau khi exact validation và contract test;
   detail vẫn phải qua external authorization gate.
4. Parse KHLCNT thành immutable canonical DTO; package observation key vẫn là
   `(planRevisionId, idDetail)`.
5. `bidNo/bidId` trong archive chỉ là candidate alias, chưa là stable family ID.
6. Không default version/status/enum; unknown phải nullable + warning.
7. Không lưu raw response; fixture phải tổng hợp và allowlisted.
8. Reconcile phải dùng preview, provenance, digest, CAS, idempotency và
   transaction nguyên tử theo revision.
9. Version streams tiếp tục độc lập; archive không có bằng chứng cho lockstep.
10. Linked notice tiếp tục là enrichment của package, không tạo package trùng.

## 11. Kiểm tra đã thực hiện

- xác minh ZIP có 145 entries và không có path traversal/absolute entry;
- tính SHA-256 archive;
- parse tĩnh cả 10 file JavaScript bằng `node --check`: 10/10 pass;
- parse cả 69 JSON bằng `JSON.parse`: 69/69 pass;
- tìm test assertion: không có;
- không chạy `npm install`, `npm test`, crawler, scheduler hoặc bất kỳ network
  request nào;
- không hiển thị/ghi lại giá trị secret trong báo cáo.

Việc parse thành công chỉ chứng minh cú pháp, không chứng minh runtime đúng,
schema đúng, endpoint còn hiệu lực hoặc integration được cấp quyền.
