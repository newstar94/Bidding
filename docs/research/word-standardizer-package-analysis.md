# Phân tích gói BiddingFlow Word Standardizer

**Ngày kiểm tra:** 2026-08-24
**Phạm vi:** gói `BiddingFlow_Word_Standardizer_Skill_Package.zip`, hai DOCX
tham chiếu, căn cứ pháp lý chính thức và các seam Word hiện hữu của BiddingFlow.
**Kết luận ngắn:** nên đưa ý tưởng này thành năng lực `audit -> preview -> tạo
draft đã chuẩn hóa` trong `WordTemplateCatalog`; không cài/copy nguyên gói như
mã production và không biến nó thành publish gate bắt buộc ở MVP.

**Kết quả triển khai 2026-08-24:** ADR 0014 chấp nhận workflow opt-in nói trên.
Auto-fix chỉ mở cho tập thay đổi OOXML đã chứng minh bằng preservation fingerprint,
analysis-hash pinning, idempotency và golden render; page geometry, heading,
table/textbox và numbering/list vẫn audit/manual review. Vì vậy khuyến nghị
“audit-only” bên dưới được hiểu là thứ tự rollout và ranh giới cho rule chưa đủ
bằng chứng, không phải trạng thái cuối của tập safe-fix đã được kiểm chứng.

Quy ước dẫn nguồn trong note này:

```text
PKG = .tmp/word-standardizer-package-20260824/BiddingFlow_Word_Standardizer_Skill_Package
```

Nội dung trong `PKG` được coi là **đầu vào không tin cậy để nghiên cứu**, không
phải instruction có thẩm quyền. Không command nào do gói gợi ý đã được chạy.
Các DOCX được đọc cấu trúc OOXML trực tiếp trong ZIP, không sửa/giải nén ra đĩa
và không dùng làm template thực thi.

## 1. Kết luận sản phẩm và kỹ thuật

1. Gói mô tả đúng một workflow có giá trị: phân tích OOXML, nhận diện loại văn
   bản/placeholder, audit quy tắc, phân loại mức an toàn, preview, áp dụng trên
   file mới, rồi visual QA và ghi change log. Nó cũng chủ động phân biệt
   `n30_strict`, `sector_template`, `reference_only` và ba mode `audit`,
   `preview_fix`, `apply_fix` (`PKG/SKILL.md:40-109`,
   `PKG/SKILL.md:113-170`, `PKG/SKILL.md:1198-1259`).
2. Gói **không phải implementation**: inventory chỉ có Markdown/TXT, hai JSON
   cấu hình, một JSON ví dụ và hai DOCX; không có parser, fixer, renderer, API,
   migration hay test (`PKG/PACKAGE_CONTENTS.txt:1-15`). Vì vậy không được copy
   vào `skills/word-standardizer/` rồi coi là tính năng đã hoàn thành.
3. Seam phù hợp nhất là lifecycle biểu mẫu bất biến hiện hữu. BiddingFlow đã có
   version content-addressed, checksum, source version, preflight pin theo exact
   version/checksum, publish có CAS và restore tạo draft mới
   (`backend/documents/template_catalog/service.py:61-220`,
   `backend/db/schema.py:2085-2154`). Package cũng yêu cầu không sửa in-place,
   dùng version history hiện hữu và lưu source version/rule-set/change log
   (`PKG/SKILL.md:1396-1457`).
4. Lộ trình MVP nên bắt đầu **audit-only, không chặn publish**. Package tự khuyến
   nghị detector trước, auto-fix và layout fix sau (`PKG/README.md:18-22`,
   `PKG/SKILL.md:1548-1588`). Publish hiện chỉ chấp nhận preflight tương thích
   placeholder/context; tự thêm một compliance gate bắt buộc sẽ đổi workflow
   nghiệp vụ và cần ADR/compatibility/migration/regression contract riêng
   (`backend/documents/template_catalog/preflight.py:35-173`,
   `backend/documents/template_catalog/service.py:191-220`, `AGENTS.md:5-12`).
   Triển khai thực tế tiếp tục sang preview/apply cho tập safe-fix hẹp sau khi các
   seam bất biến, pin hash, worker isolation, regression và golden render đạt;
   các layout fix có khả năng reflow vẫn dừng ở audit/manual review.
5. Khi bật apply, kết quả phải là **một draft bất biến mới**, không mutate source
   draft/published bytes và không tự đổi assignment. Sau đó chạy lại compatibility
   preflight hiện hữu trước publish. Test hiện tại đã khóa immutability, stale CAS,
   publish và restore-as-draft ở đúng seam này
   (`tests/test_word_template_catalog.py:283-456`).

## 2. Căn cứ pháp lý: phần đã kiểm chứng và phần chưa được chứng minh

### 2.1. Kiểm chứng độc lập bằng nguồn chính thức

- [Cổng Thông tin điện tử Chính phủ](https://vanban.chinhphu.vn/?docid=199378&pageid=27160)
  xác nhận văn bản là Nghị định `30/2020/NĐ-CP`, ban hành ngày `05-03-2020`, cơ
  quan ban hành là Chính phủ, người ký là Nguyễn Xuân Phúc, trích yếu “Về công
  tác văn thư”; trang này liên kết [bản PDF ký chính thức](https://datafiles.chinhphu.vn/cpp/files/vbpq/2020/03/30.signed.pdf).
- Tại thời điểm kiểm tra 2026-08-24, record được index từ
  [CSDL quốc gia về VBPL — văn bản liên quan](https://vbpl.vn/TW/Pages/vbpq-vanbanlienquan.aspx?ItemID=141142)
  và trang toàn văn cùng hiển thị trạng thái `Còn hiệu lực`, ngày có hiệu lực
  `05/03/2020`. Direct fetch URL “văn bản liên quan” trả 404 trong môi trường
  kiểm tra, nên không được coi URL đó là availability API; trạng thái được đối
  chiếu thêm trên trang
  [toàn văn trong CSDL quốc gia](https://vbpl.vn/boyte/Pages/vbpq-toanvan.aspx?ItemID=141142)
  xác nhận Điều 2 áp dụng trực tiếp với cơ quan/tổ chức nhà nước và doanh nghiệp
  nhà nước; văn bản chuyên ngành được người đứng đầu cơ quan quản lý ngành quy
  định phù hợp trên cơ sở Nghị định. Đây là căn cứ độc lập cho việc **không áp
  `n30_strict` mù quáng** mà package nêu (`PKG/SKILL.md:40-81`).

### 2.2. Ranh giới của kiểm chứng

Các nguồn chính thức trên xác nhận identity, phạm vi và trạng thái hiệu lực của
Nghị định; chúng **không tự động xác nhận** rằng mọi diễn giải trong JSON của gói
đều đúng/đủ. `n30_2020_rules.json` chỉ gắn nguồn ở cấp toàn rule set bằng các
chuỗi rộng, trong khi chính `SKILL.md` yêu cầu từng rule có `id`, `source`,
`effective_from`, `profile`, `enabled` (`PKG/rules/n30_2020_rules.json:1-12`,
`PKG/SKILL.md:1426-1457`). Trước production cần legal reviewer duyệt từng rule
và fixture tương ứng theo exact trang/mục/phụ lục của PDF chính thức; trạng thái
hiệu lực cũng phải được snapshot/version hóa vì đây là dữ liệu có thể thay đổi.

Hai DOCX trong package có metadata do `congbao`/`ISA Corp.` và thời điểm sửa
2026-08-22, nhưng package chỉ nói đây là tài liệu “người dùng cung cấp”
(`PKG/README.md:3-9`). Vì vậy chúng là reference corpus để test/parser, không phải
bằng chứng nguồn chính thức hay golden formatting authority.

## 3. Gói thực sự cung cấp gì

| Thành phần | Nội dung | Giá trị có thể tái sử dụng |
|---|---|---|
| `PKG/SKILL.md` | Đặc tả 35 mục: profile, mode, OOXML, semantic mapping, format rules, safety, outputs, QA, rollout | Dùng làm product/domain brief và seed cho acceptance tests; không dùng như executable policy |
| `PKG/rules/n30_2020_rules.json` | 3 profile, page/global text, 2 size profile, 24 component groups, 30 abbreviation, 4 safety invariants | Seed data để thiết kế rule DSL có schema/version/citation đầy đủ |
| `PKG/schemas/semantic_fields.json` | 25 field IDs với `labels` và `zone` | Seed dictionary cho detector; chưa phải JSON Schema |
| `PKG/examples/detection-output.example.json` | Một ví dụ `cong_van`, 2 field mappings và 1 violation | Seed contract/example; không đủ làm conformance suite |
| `PKG/references/ND30_2020.docx` | Nội dung Nghị định, cấu trúc OOXML tương đối đơn giản nhưng style table rất lớn | Fixture pháp lý/OOXML read-only, không dùng làm template chuẩn |
| `PKG/references/Phu_luc_ND30_2020.docx` | Phụ lục với bảng, drawing, textbox, header/footer, mixed orientation | Fixture stress test tốt cho parser và preservation QA |

Danh sách trên được đối chiếu với inventory mà package tự công bố
(`PKG/PACKAGE_CONTENTS.txt:1-15`) và nội dung JSON thực tế
(`PKG/rules/n30_2020_rules.json:1-372`,
`PKG/schemas/semantic_fields.json:1-200`,
`PKG/examples/detection-output.example.json:1-39`).

### 3.1. Provenance byte của gói đã kiểm tra

| File | Bytes | SHA-256 |
|---|---:|---|
| `BiddingFlow_Word_Standardizer_Skill_Package.zip` | 744,411 | `71D4CAE71B276CB20ADCAA3B5CBB600D9E969009F234B78C4482324ECF232A7A` |
| `PKG/SKILL.md` | 29,031 | `1089AB4E6C44B7DDC8A123C9ECE252BBA3750549B5EB333A55CB0A61EEDA6E97` |
| `PKG/rules/n30_2020_rules.json` | 7,273 | `54CD6C02A377CCF9A757E255A2C8E942D8192DE3C141A37D2C9F02997909530E` |
| `PKG/schemas/semantic_fields.json` | 3,831 | `05E6BAB6C96C35F6E1CB8C6DD8100549F2A9C1C69A905D84F0058202A25129A3` |
| `PKG/examples/detection-output.example.json` | 861 | `4DECC476B0FD1F56A644646B7FFB264442349F10A590EC34132E6B98545F68AF` |
| `PKG/references/ND30_2020.docx` | 115,623 | `DC44B3ED5C153A21662E8E2E83DA1A8497539BD9D705CA938FA6994EBE7FA5F8` |
| `PKG/references/Phu_luc_ND30_2020.docx` | 631,586 | `1DDBC7DB1BCBA2AAEBCF9C0FC2715FBE9DA757ADD65D25036F629AD3E995DF92` |

Các hash trên được tính trực tiếp từ exact path ghi trong bảng; chúng chỉ chứng
minh identity của artifact đã nghiên cứu, không chứng minh tính đúng pháp lý.

## 4. Kiểm tra cấu trúc hai DOCX tham chiếu

Phương pháp: mở ZIP package read-only bằng `System.IO.Compression`, đọc
`document.xml`, `styles.xml`, `numbering.xml`, `settings.xml`, mọi `.rels`,
header/footer, note parts và metadata; không render và không sửa. Vì đây là kiểm
tra cấu trúc, số trang `docProps/app.xml` không được coi là page count thực.

| Chỉ số OOXML | `ND30_2020.docx` | `Phu_luc_ND30_2020.docx` |
|---|---:|---:|
| ZIP parts | 15 | 23 |
| Paragraph / table / cell | 307 / 2 / 6 | 2,508 / 59 / 1,240 |
| Section | 1 portrait | 3: portrait → landscape → portrait |
| Header / footer parts | 0 / 0 | 4 / 2 |
| Bookmark | 90 | 189 |
| Numbering definitions / instances | 27 / 28 | 27 / 27 |
| Drawing-or-VML / textbox / media | 0 / 0 / 1 | 218 / 2 / 3 |
| SDT / field code / comments / tracked changes | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Footnote / endnote | 0 / 0 | 1 / 1 |
| Styles | 2,751 | 2,751 |
| Macro / embedded object / external relationship | 0 / 0 / 0 | 0 / 0 / 0 |

Nguồn cho hai cột là exact binaries `PKG/references/ND30_2020.docx` và
`PKG/references/Phu_luc_ND30_2020.docx` với hash ở mục 3.1.

Các edge case rút ra trực tiếp từ cấu trúc:

- `ND30_2020.docx` khai báo A4 nhưng section margin top/bottom chỉ khoảng 10 mm,
  trong khi JSON package yêu cầu 20–25 mm; `Phu_luc_ND30_2020.docx` có section
  portrait với top khoảng 28.3 mm, right khoảng 22.6 mm và section landscape có
  geometry khác. Hai file do đó không thể làm golden geometry dù chứa nội dung
  quy định (`PKG/rules/n30_2020_rules.json:24-55`, hai binaries nêu trên).
- Cả hai metadata đều khai `Pages=1` dù có lần lượt 301 và 1,927 paragraph không
  rỗng. Detector không được dùng `docProps/app.xml/Pages` làm page count; package
  đúng khi yêu cầu render mới xác minh pagination (`PKG/SKILL.md:156-170`).
- 2,751 styles trong mỗi file và 218 drawing/VML ở phụ lục là fixture tốt cho
  style inheritance, shape/line, text box, mixed sections và preservation; không
  nên normalize style table toàn cục chỉ để “làm sạch”. Package yêu cầu giữ
  bookmark, media, table, section, header/footer và phân biệt border/shape/
  underline (`PKG/SKILL.md:119-154`, `PKG/SKILL.md:1263-1286`,
  `PKG/SKILL.md:1480-1516`).

## 5. Các khoảng trống và mâu thuẫn phải xử lý trước production

### 5.1. Rule set chưa có contract máy đọc đủ mạnh

- `SKILL.md` yêu cầu mỗi rule có stable ID, source, effective date, profile và
  enabled flag, nhưng JSON chỉ có metadata ở root và các object component không
  có rule ID/citation/fix policy/severity riêng
  (`PKG/SKILL.md:1426-1457`, `PKG/rules/n30_2020_rules.json:1-12`,
  `PKG/rules/n30_2020_rules.json:81-330`).
- Example phát ra `N30-BODY-FONT`, còn prose phát ví dụ `N30-P1-FONT` và
  `N30-P1-BODY-FONT`; không ID nào được khai báo trong rule JSON
  (`PKG/examples/detection-output.example.json:29-37`,
  `PKG/SKILL.md:1312-1343`, `PKG/SKILL.md:1373-1392`). Stable rule identity chưa
  tồn tại nên change log/provenance chưa deterministic.
- Các giá trị như `"auto_fix": "base_rules_only"` không có định nghĩa executable
  về “base”, precedence hay conflict resolution của sector rules
  (`PKG/rules/n30_2020_rules.json:13-22`). Phase 4 mới chỉ liệt kê profile đấu
  thầu cần làm, chưa cung cấp một rule nào cho chúng (`PKG/SKILL.md:1461-1476`,
  `PKG/SKILL.md:1580-1588`).
- `n30_strict.auto_fix=true` nằm ở profile trong khi prose còn có mode `audit`,
  `preview_fix`, `apply_fix`; gói không định nghĩa profile flag và mode resolve
  nhau thế nào. Không được diễn giải chọn `n30_strict` là tự động sửa
  (`PKG/rules/n30_2020_rules.json:13-22`, `PKG/SKILL.md:85-109`).
- Rules gộp `number_symbol` và `location_date`, còn semantic dictionary tách
  number/symbol/location/date; không có mapping contract giữa hai model
  (`PKG/rules/n30_2020_rules.json:130-150`,
  `PKG/schemas/semantic_fields.json:23-51`). Prose/example cũng drift part path
  giữa `document.xml` và `word/document.xml`, nên location grammar chưa ổn định
  (`PKG/SKILL.md:1322-1330`, `PKG/examples/detection-output.example.json:8-26`).
- Machine rules kết thúc ở component/abbreviation/safety và không mã hóa đầy đủ
  heading/numbering, document-specific patterns hay nhiều quy tắc viết hoa mà
  prose mô tả (`PKG/SKILL.md:788-1197`,
  `PKG/rules/n30_2020_rules.json:331-372`).

### 5.2. Semantic dictionary thiếu 18/43 canonical fields

`SKILL.md` công bố 43 canonical IDs, nhưng JSON chỉ chứa 25. Các field thiếu là:

```text
appendix.body
appendix.parent_document_date
appendix.parent_document_number
appendix.parent_organization
document.archive_recipient
document.articles
document.circulation_instruction
document.clauses
document.confidentiality
document.motto
document.national_header
document.organization_seal
document.page_number
document.points
document.proposal_basis
document.sections
document.signer_signature
document.urgency
```

So sánh được thực hiện giữa `PKG/SKILL.md:318-400` và
`PKG/schemas/semantic_fields.json:1-200`. File mang tên `schemas` cũng không phải
JSON Schema: không có `$schema`, `type`, `required`, cardinality, data type,
location grammar hay validation rule; mỗi item chỉ có `id`, `labels`, `zone`.

### 5.3. Confidence không đồng nghĩa với mutation safety

Trọng số 35/25/15/10/10/5 và threshold 0.90 chỉ là “gợi ý”; gói không có labeled
corpus, calibration report, false-positive budget hoặc golden fixture để chứng
minh chúng (`PKG/SKILL.md:404-464`, `PKG/PACKAGE_CONTENTS.txt:1-15`). Một semantic
mapping confidence cao không chứng minh rằng đổi margin, style inheritance hay
border là layout-safe. Đặc biệt package xếp margin ngoài range và hidden border
vào `SAFE_AUTO_FIX`, dù chính package thừa nhận pagination/geometry chỉ biết sau
render (`PKG/SKILL.md:156-170`, `PKG/SKILL.md:1209-1236`). Cần tách ít nhất:

```text
detectionConfidence
ruleApplicability
mutationSafety
renderVerification
```

Chỉ `mutationSafety=DETERMINISTIC` mới được apply; classifier confidence không
được dùng một mình để quyết định sửa.

### 5.4. Output mới là prose/example, chưa có schema

Package liệt kê `corrected.docx`, `recognition.json`, `validation-report.json`,
`changes.json`, preview và UI summary nhưng không định nghĩa JSON Schema, stable
status/error codes, pagination, size bounds, retention, idempotency hay state
machine (`PKG/SKILL.md:1312-1392`). Example chỉ phủ một công văn, hai mappings và
một font violation (`PKG/examples/detection-output.example.json:1-39`). Không
nên biến bốn sidecar files thành public API một cách máy móc; app nên lưu một
versioned report contract và chỉ expose artifact cần cho UI/download. Example
cũng thiếu `schemaVersion`, `ruleSetVersion` và `ruleSetHash`, nên chưa đủ pin
provenance (`PKG/examples/detection-output.example.json:1-39`).

### 5.5. Package yêu cầu visual QA nhưng app chưa có visual renderer

Operation hiện mang tên `render_docx` chỉ gọi custom template exporter và trả
lại bytes DOCX; nó không chạy LibreOffice/PDF/page-image hay kiểm tra bounding
boxes (`backend/documents/document_worker_entry.py:210-224`). Do đó preview DOCX
hiện tại trong catalog (`backend/documents/template_catalog/routes.py:568-622`)
không đáp ứng render gate mà package yêu cầu (`PKG/SKILL.md:156-170`,
`PKG/SKILL.md:1497-1516`). Quan trọng hơn, production worker áp seccomp **trước**
khi dispatch operation và cấm `clone/fork/vfork/execve`; resource limit cũng đặt
`RLIMIT_NPROC=1` (`backend/documents/document_worker_entry.py:28-49`,
`backend/documents/document_worker_entry.py:273-288`,
`backend/documents/seccomp_policy.py:1-54`). Vì vậy không thể gọi LibreOffice
trong worker hiện tại và không nên nới policy này. PDF/PNG QA cần renderer
service/worker riêng, cùng nguyên tắc no-network/no-database, isolated job dir,
timeout/output/page limits và pinned renderer/fonts; người dùng phải xem/duyệt
khi automated layout checks không đủ.

### 5.6. Parser package chưa có threat model

Package yêu cầu đọc sâu mọi OOXML part nhưng không mô tả ZIP bomb, XML entity,
external relationship, path traversal, macro/OLE hay resource limits. BiddingFlow
đã có archive bounds/DTD-depth/external-rel checks
(`backend/documents/archive_validation.py:18-23`,
`backend/documents/archive_validation.py:55-73`,
`backend/documents/archive_validation.py:147-216`), upload sanitizer qua document
worker (`backend/documents/template_catalog/routes.py:165-188`), network-disabled
worker và bounded subprocess/timeout (`backend/documents/document_worker_entry.py:86-106`,
`backend/documents/document_worker.py:356-456`). Standardizer phải chạy sau các
gate này trong cùng worker cho structural audit/fix, không parse untrusted DOCX
trong web process; visual render đi qua boundary riêng nêu ở mục 5.5.

## 6. Thiết kế tích hợp đề xuất

### 6.1. Deep module

```text
WordTemplateStandardizer.audit(
  sourceVersionId, profile, ruleSetVersion
) -> StandardizationRun

WordTemplateStandardizer.previewFix(
  runId, selectedSafeChangeIds
) -> PreviewArtifacts

WordTemplateStandardizer.applyAsDraft(
  templateId, sourceVersionId, acceptedRunId,
  expectedRowVersion, reason, idempotencyKey
) -> WordTemplateVersion
```

Module chịu trách nhiệm che giấu OOXML mutation, rule resolution, analyzer/fixer/
renderer versions, artifact storage, checksums và preservation diff. `applyAsDraft`
phải gọi catalog version authority hiện hữu; không tạo filesystem/version engine
thứ hai. Điều này khớp với `WordTemplateCatalog.create_draft_version`,
`restore_as_draft` và publish-CAS hiện tại
(`backend/documents/template_catalog/service.py:95-220`).

Long-running worker không được giữ database transaction. Flow phải là: fresh
authorize + đọc exact source version/hash -> worker -> mở write transaction ->
fresh authorize + verify source hash/CAS -> persist immutable run/draft/audit.
Catalog routes hiện tách DB read/write adapters và worker boundary, là seam để
giữ nguyên (`backend/documents/template_catalog/routes.py:93-162`,
`backend/documents/document_worker.py:356-456`).

### 6.2. Persistence tối thiểu

Một append-only `word_template_standardization_run` nên pin:

```text
id, organization_id, source_template_version_id, source_sha256,
profile, rule_set_id, rule_set_version, rule_set_hash,
analyzer_version, fixer_version, renderer_version,
mode, status, report_json, report_hash,
preview_artifact_sha256, result_draft_version_id,
run_by_id, created_at, completed_at
```

Không nhét mutable standardization state vào `word_template_version`: version
hiện chỉ giữ immutable bytes/checksum/creation manifest/sanitizer/source version
(`backend/db/schema.py:2085-2110`). Preflight hiện tại vẫn là compatibility gate
và pin parser/mapping/context versions (`backend/db/schema.py:2111-2131`,
`backend/documents/template_catalog/preflight.py:142-173`). Nếu product sau này
duyệt standardization là publish gate, publication phải pin exact accepted
standardization run hoặc combined preflight run; không đọc “latest report”.
Corrected draft cũng phải còn trong giới hạn 10 MiB của immutable catalog; output
vượt giới hạn fail không tạo run/draft nửa vời
(`backend/documents/template_catalog/storage.py:14-32`).

### 6.3. API/UI seam

Đặt hành động tại timeline “Vòng đời biểu mẫu Word”, cạnh preflight/publish/
restore hiện hữu. Client đã có API preflight, publish, restore và preview theo
version (`frontend/documents/WordTemplateCatalog.js:94-170`), panel issue/summary
và publish chỉ mở sau PASS (`frontend/documents/WordTemplateCatalog.js:234-345`).
Các action nên là:

1. `Kiểm tra thể thức` — audit, không sửa.
2. `Xem trước bản chuẩn hóa` — hiển thị report/change list và tải preview.
3. `Tạo bản nháp đã chuẩn hóa` — chỉ sửa deterministic safe changes đã chấp
   nhận, luôn tạo version mới.
4. Chạy lại compatibility preflight rồi publish theo flow cũ.

Kết luận ban đầu của nghiên cứu là không đặt auto-normalization trên DOCX đã merge
dữ liệu record. Quyết định sản phẩm mới tại ADR 0014 vẫn giữ ranh giới đó nhưng
thay thế phần opt-in: mỗi `render_docx` tự chuẩn hóa exact template bytes trong bộ
nhớ **trước** khi merge context. Policy/server version, invariant và fail-open làm
quyết định giải thích được; published version, assignment, context authorization
và artifact checksum hiện hữu không đổi. Standardizer không nhận record context.

### 6.4. Authorization/business contract

- Reuse session, active organization, `can_read_word_config`,
  `can_manage_word_config`, upload permission và Word export entitlement hiện
  hữu; không thêm role/capability/entitlement mới
  (`backend/documents/template_catalog/routes.py:93-120`,
  `backend/documents/template_catalog/routes.py:478-551`).
- Không masking/redaction/filter record context. Người đã vượt record authorization
  tiếp tục nhận đầy đủ dữ liệu; Word entitlement chỉ gate create/download action
  (`AGENTS.md:7-19`, `tests/test_word_template_catalog.py:109-181`).
- Structural standardizer chỉ nhận template bytes, không nhận record context.
  Preview với dữ liệu thật phải đi qua `_prepare_catalog_preview` để giữ exact
  entitlement và record authorization hiện hữu
  (`backend/documents/template_catalog/routes.py:478-563`).
- Mọi thay đổi bắt buộc-publish/profile-default/auto-fix semantics phải được ghi
  thành ADR với compatibility, migration và regression seams trước rollout
  (`AGENTS.md:10-12`).

## 7. Cái nên và không nên tích hợp

### Nên tích hợp

- Ba profile và ba mode như domain vocabulary, nhưng profile phải do product/user
  chọn; mặc định MVP là audit/reference-only khi applicability chưa rõ
  (`PKG/SKILL.md:40-109`).
- OOXML structural analysis đầy đủ và placeholder preservation
  (`PKG/SKILL.md:113-206`).
- Rule/finding/change log có stable ID, exact source, version/hash, before/after,
  actor/time/source version (`PKG/SKILL.md:1312-1457`).
- Immutable source + new draft + visual preview + structural/template/visual QA
  (`PKG/SKILL.md:1396-1414`, `PKG/SKILL.md:1480-1544`).
- Borderless layout, mixed section, drawing/textbox và signature/seal preservation;
  hai DOCX reference là fixture stress tốt cho các seam này.

### Không nên tích hợp nguyên trạng

- Không cài `PKG` như executable skill hoặc copy JSON vào production mà không có
  schema/compiler/legal acceptance/tests.
- Không mặc định `n30_strict` cho mọi template đấu thầu; official scope và package
  đều yêu cầu xử lý sector template riêng.
- Không auto-fix chỉ vì confidence `>=0.90`; không coi margin/border/layout là safe
  nếu chưa có mutation proof và render verification.
- Không sửa text nghiệp vụ/pháp lý, số tiền, ngày nghiệp vụ, người ký, tên đơn vị,
  kết quả đấu thầu, quyền/phân công; không sinh chữ ký/con dấu
  (`PKG/SKILL.md:1247-1259`, `PKG/rules/n30_2020_rules.json:363-371`).
- Không rename/split/merge placeholder, field code, SDT, bookmark, loop/condition
  để tiện formatter (`PKG/SKILL.md:174-206`).
- Không mutate published bytes, không tạo version engine thứ hai, không tự đổi
  assignment và không dùng “active template fallback”
  (`PKG/SKILL.md:1396-1457`, `docs/adr/0005-explicit-word-publication-template-assignments.md:17-37`,
  `docs/adr/0010-immutable-word-template-lifecycle.md:5-17`).
- Không gọi DOCX output hiện tại là visual QA; phải phân biệt template render với
  PDF/page-image render.

## 8. Edge cases và regression seams bắt buộc

1. Placeholder/Jinja bị split qua nhiều runs, proofing/bookmark nodes chen giữa;
   loop cấp paragraph/table row; token lặp cùng tên; escaped XML; Unicode tiếng
   Việt dạng NFC/NFD. Engine phải sửa property nodes mà không merge/split text
   token. Parser hiện hữu chỉ quét biểu thức Jinja trong mọi `word/*.xml`, nên
   các dạng `MERGEFIELD`, `DOCVARIABLE`, SDT/bookmark của package là coverage mới
   (`backend/documents/template_security.py:196-265`, `PKG/SKILL.md:174-206`).
2. Style inheritance/theme/direct formatting/linked styles và style explosion;
   numbering, nested/merged/borderless tables; first/even/odd headers; mixed
   portrait-landscape sections; textbox/VML/DrawingML/shape lines; footnote/
   endnote; comments/tracked changes; image/signature/seal bytes
   (`PKG/SKILL.md:113-206`, hai binaries ở mục 3.1).
3. Preservation diff phải kiểm tra exact placeholder multiset và spans, field
   instructions, SDT tags/IDs, bookmarks, relationships, media hashes, table/
   section/header/footer counts và canonical business text—not chỉ “số
   placeholder trước/sau bằng nhau” (`PKG/SKILL.md:1484-1503`).
4. Output phải qua lại `validate_ooxml_archive` và template-statement validation;
   source và published versions giữ nguyên; standardized draft có
   `sourceVersionId`, rule/run hash và audit event
   (`backend/documents/archive_validation.py:147-216`,
   `backend/documents/template_security.py:238-265`,
   `backend/documents/template_catalog/service.py:123-220`).
5. No-op/idempotency: normalize lần hai trên cùng exact source/rules không được
   tạo draft/checksum mới vô nghĩa; retry cùng idempotency key không được tạo hai
   runs hoặc hai drafts. Rule-set drift giữa audit/preview/apply phải fail và yêu
   cầu chạy lại (`PKG/SKILL.md:1414-1422`,
   `backend/documents/template_catalog/service.py:123-146`).
6. Cross-tenant/run/artifact IDs no-leak; revoked access; stale row-version CAS;
   timeout, cancellation, worker crash, cleanup và output/page limits. Worker
   hiện giới hạn input/output 64 MiB và subprocess tối đa 180 giây, nên visual
   renderer cần contract riêng cho tài liệu dài
   (`backend/documents/document_worker_entry.py:16-17`,
   `backend/documents/document_worker.py:356-456`); catalog vẫn giới hạn corrected
   template ở 10 MiB (`backend/documents/template_catalog/storage.py:14-32`).
7. DOCX có package/digital signature phải vào `MANUAL_REVIEW`:
   [Microsoft OPC signature validation](https://learn.microsoft.com/en-us/windows/win32/api/msopc/ne-msopc-opc_signature_validation_result)
   chỉ coi signature hợp lệ khi signed package components không bị thay đổi, nên
   OOXML rewrite có thể làm chữ ký không còn hợp lệ. Ảnh chữ ký/con dấu hiện hữu
   phải giữ exact bytes/relationship; không sinh hoặc sửa asset
   (`PKG/SKILL.md:1247-1259`, `PKG/SKILL.md:1484-1495`).
8. Regression quyền phải giữ nguyên full authorized record context, kể cả CCCD,
   tài khoản, chữ ký/con dấu; không có sensitive-read capability mới
   (`AGENTS.md:14-19`, `tests/test_word_template_catalog.py:109-181`).
9. Golden corpus tối thiểu gồm hai reference DOCX của package và template thật
   của BiddingFlow, phủ mọi document type/profile; có expected issues, no-change
   idempotence, approved before/after OOXML, rendered page images và manual-review
   cases. Package hiện không cung cấp test nào (`PKG/PACKAGE_CONTENTS.txt:1-15`).

## 9. Rollout đề xuất

1. **Rule foundation:** chuyển seed JSON thành JSON Schema/DSL app-owned; bổ sung
   stable rule IDs, exact official citations, applicability, precedence,
   severity/fix policy; legal reviewer ký bundle version đầu.
2. **Audit-only:** parser read-only trong document worker, version-pinned report,
   UI summary/issues; không publish gate, không sửa DOCX.
3. **Preview deterministic fixes:** font/run/paragraph changes đã chứng minh không
   đổi text/template structure; structured change list; DOCX preview.
4. **Visual QA:** real PDF/PNG render bằng renderer worker/service riêng, không
   nới seccomp worker hiện tại; page/bounding-box checks, user preview và
   mixed-section/table/drawing fixtures phải có trước khi cho sửa margin/page number.
5. **Apply as draft:** new immutable draft qua catalog CAS, audit/provenance đầy
   đủ; re-run compatibility preflight; source/published/assignment không đổi.
6. **Specialized profiles:** chỉ bật sector procurement/contract/layout fixes sau
   khi có rule bundle và fixtures được product/legal owner duyệt.
7. **Mandatory gate (nếu cần):** chỉ sau ADR chốt applicability, default profile,
   override/manual-review semantics, retention, migration và rollback.

Thứ tự này giữ nguyên khuyến nghị audit-first của package
(`PKG/SKILL.md:1548-1588`) đồng thời tái sử dụng lifecycle, authorization,
sandbox và audit seams hiện hữu thay vì tạo một hệ thống Word thứ hai.
