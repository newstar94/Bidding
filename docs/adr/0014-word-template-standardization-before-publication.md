# ADR 0014 — Chuẩn hóa thể thức Word tự động khi xuất bản

- Trạng thái: Bị thay thế một phần bởi ADR 0033
- Ngày: 2026-08-24
- Phạm vi: `render_docx`, Word standardizer, `WordTemplateCatalog` và mọi luồng xuất DOCX

## Quyết định

BiddingFlow tự động nhận diện và chuẩn hóa an toàn thể thức của mọi DOCX đi qua
operation dùng chung `render_docx`. Ngay trước khi merge dữ liệu bản ghi, document
worker đọc đúng bytes của phiên bản biểu mẫu đã được assignment hiện hữu chọn và
đưa bytes đó vào policy do máy chủ sở hữu. Candidate chuẩn hóa chỉ tồn tại trong
bộ nhớ và được dùng làm đầu vào render; hệ thống không ghi đè source bytes,
published bytes, assignment hay bất kỳ phiên bản biểu mẫu nào.

Xuất Word không phụ thuộc vào lựa chọn profile, thao tác preflight, preview, tạo
standardized draft hay publish lại của người dùng. Policy tự phân loại nội dung,
đánh giá mức tin cậy và chọn effective profile. Exact ngưỡng, allowlist loại văn
bản và quy tắc được version hóa/pin bằng policy, engine và rule-set hash:

- loại văn bản hành chính có bằng chứng nhất quán và độ tin cậy cao có thể dùng
  `n30_strict`;
- biểu mẫu có administrative shell nhất quán nhưng cần bảo toàn cấu trúc chuyên
  ngành dùng `sector_template`;
- loại không rõ, bằng chứng xung đột, độ tin cậy thấp, package có OPC digital
  signature hoặc trường hợp không được hỗ trợ dùng `reference_only` và giữ
  nguyên bytes đầu vào.

Policy chỉ nhận template bytes và bounded `document_type` hint đã có trong
`context_manifest`; nó không nhận context đầy đủ hay giá trị trường của bản ghi.
Hint chỉ làm policy thận trọng hơn cho các nhóm tài liệu chuyên ngành như hồ sơ
mời thầu, đánh giá, mở thầu, hợp đồng và thanh lý; hint không được tự mình chứng
minh rằng Nghị định 30 áp dụng. Quyết định strict luôn cần bằng chứng nội dung
độc lập, nhất quán. Nếu strict apply không an toàn, policy được phép thử lại
`sector_template`; nếu vẫn không đạt thì dùng nguyên template.

### Ranh giới mutation bắt buộc

Automatic apply dùng positive allowlist: chỉ các thuộc tính trình bày mà engine
sở hữu, trên paragraph/run đã được chứng minh là target an toàn, mới được thay
đổi. Việc “không phát hiện rủi ro” không đủ để mở rộng target. Page size,
orientation, margins, page-number placement và thay đổi có thể gây reflow nhiều
section tiếp tục chỉ được audit/manual review.

Các invariants sau là business contract, không phải heuristic:

- giữ nguyên tuyệt đối câu chữ và thứ tự text, nội dung nghiệp vụ/pháp lý, dấu
  câu, khoảng trắng có nghĩa, mọi numeric token, số tiền, ngày, mã, kết quả,
  người ký và đơn vị;
- không đổi placeholder hoặc span placeholder; không đổi field instruction/
  field code, SDT/content control, bookmark, relationship hay immutable part;
- không merge/split/reorder run; không thêm hoặc xóa text;
- không sửa cấu trúc hoặc formatting bên trong bảng;
- không sửa đoạn thuộc vùng chữ ký/người ký, signature line, tracked change,
  numbering/list, textbox, section-property paragraph hoặc container OOXML
  không được hỗ trợ;
- không sửa drawing, object, hình chữ ký, con dấu, media bytes hoặc liên kết tới
  media; không sinh chữ ký hay con dấu;
- package có OPC digital signature không bao giờ bị rewrite tự động vì rewrite
  có thể làm chữ ký số mất hiệu lực.

Fingerprint trước/sau phải pin exact text và numeric tokens, placeholder, field,
SDT, bookmark, story/run structure, exact table XML, protected paragraphs,
section, relationship, immutable part, media và signature part. Apply chỉ được
trả candidate khi mọi preservation invariant đạt `PASS`; `analysisHash` của
preview và apply phải khớp để chặn source/rule drift.

### Chế độ vận hành và fallback

`WORD_EXPORT_STANDARDIZATION_MODE` có ba giá trị và không mang semantics quyền:

- `apply_safe` — mặc định; phân tích, chọn profile và áp dụng candidate chỉ khi
  toàn bộ invariants đạt;
- `shadow` — chạy phân tích/quyết định nhưng luôn render từ original template;
- `off` — bỏ qua policy và render từ original template.

Giá trị cấu hình không hợp lệ được xử lý như `off`. Mọi exception, report không
nhất quán, detection mơ hồ, apply failure hoặc preservation failure đều fail-open
riêng cho bước formatting: `render_docx` tiếp tục với original template bytes.
Template vượt budget version hóa về số story/style part, XML bytes, paragraph,
run hoặc style cũng được bypass trước các lượt phân tích lặp lại để còn đủ CPU
cho render hiện hữu; budget này không chặn xuất và không làm thay đổi template.
Hệ thống không được tuyên bố đã apply khi đã fallback. “Fail-open” ở đây không
bỏ qua validation, session, tenant, module, assignment, record authorization,
Word entitlement hay lỗi render vốn có.

Policy trả metadata nội bộ có allowlist và kích thước giới hạn, gồm policy/mode,
hash nguồn-kết quả, quyết định profile, reason code, engine/rule/analysis hash và
trạng thái preservation. `render_docx` chỉ dùng bytes và không expose metadata
qua API. Worker chỉ phát một structured operational event low-cardinality gồm
mode/status/profile/type/count/preservation để `shadow` và fallback quan sát
được; event không chứa hash nguồn, full report, signal, sample text hay dữ liệu
bản ghi. Provenance/audit hiện hữu tiếp tục ghi exact template version và hash
của final artifact; ADR này không tạo bảng provenance mới.

## Workflow catalog tùy chọn

`WordTemplateCatalog` tiếp tục là version authority duy nhất và workflow
preflight/preview/apply hiện hữu vẫn có giá trị để quản lý biểu mẫu, điều tra
finding và chủ động xuất bản một phiên bản đã chuẩn hóa. Workflow này là tùy
chọn, không phải export gate và không phải điều kiện để tài liệu xuất ra được tự
động format.

Ba profile catalog tiếp tục được hỗ trợ:

- `sector_template` chỉ sửa quy tắc nền và administrative shell được nhận diện
  chắc chắn;
- `n30_strict` dành cho preview/apply khi người quản lý chủ động xác nhận phạm vi
  văn bản;
- `reference_only` chỉ audit, không cho catalog apply auto-fix.

Preflight compatibility `PASS/BLOCKED` giữ nguyên semantics. Finding về format
không trở thành publish gate ngầm. Apply catalog vẫn phải pin exact
`analysisHash`, luôn tạo draft bất biến mới có `sourceVersionId`, checksum,
engine/rule-set version và change log trong creation manifest; source/published
bytes không bị sửa.

Hai endpoint catalog giữ nguyên:

- `POST /api/word-template-catalog/versions/{versionId}/standardized-preview`
  trả candidate DOCX theo read-config + Word-export contract;
- `POST /api/word-template-catalog/{templateId}/standardized-drafts` tạo draft
  bất biến mới, yêu cầu `Idempotency-Key` 8-128 ký tự. Lần tạo đầu trả `201`;
  replay cùng key/cùng canonical request trả response đã lưu; cùng key/payload
  khác trả `409`; cùng source/preflight/profile/output dưới key khác trả
  replay/no-duplicate (`200`).

Giới hạn 1 MiB của preflight vẫn là contract có trước. Nếu standardization report
làm response kết hợp vượt trần, hệ thống giữ nguyên compatibility report/result
và hạ metadata tùy chọn xuống `standardizationUnavailable` có kích thước cố
định; phần tùy chọn không được làm preflight vốn hợp lệ thất bại.

DOCX preview là artifact để người dùng kiểm tra, không được gọi là automated
visual QA. LibreOffice/PDF/PNG vẫn cần renderer worker riêng; không nới
seccomp/no-network/resource limits của document worker production.

## Business/authorization contract

- Không thêm, bỏ, gộp hoặc đổi role, capability, module permission, assignment
  scope, record scope, entitlement, inheritance hay default allow/deny.
- Word entitlement chỉ kiểm soát hành động tạo/tải Word; nó không che hoặc mở dữ
  liệu trong màn hình/API đọc bản ghi và không tạo capability đọc dữ liệu nhạy
  cảm riêng.
- Người dùng đã qua tenant, module, assignment và record-level authorization vẫn
  nhận đầy đủ dữ liệu của bản ghi được phép đọc, gồm CCCD, số tài khoản, ngân
  hàng, chữ ký, con dấu và các trường liên quan. Automatic formatting không
  masking, redaction, lọc response hay thay đổi field visibility.
- Luồng xuất vẫn kiểm tra session, tenant, module, assignment, record scope và
  Word entitlement tại các seam hiện hữu. Chuẩn hóa diễn ra sau khi exact
  template được chọn và trước record merge nên engine không quan sát giá trị dữ
  liệu bản ghi.
- Preflight/apply catalog tiếp tục dùng `can_manage_word_config`; preview/tải
  candidate tiếp tục dùng `can_read_word_config`, Word export entitlement và
  post-worker reauthorization hiện hữu.

## Compatibility impact

Request/response contract của API xuất đồng bộ và bất đồng bộ, durable job
payload, renderer output type, explicit assignment và template provenance không
đổi. Cả hai đường xuất đều hội tụ tại `render_docx`, nên không có client nào phải
gửi profile hay thực hiện thao tác mới.

Compatibility quan sát được là formatting của file xuất có thể thay đổi theo
policy/rule version dù assignment vẫn trỏ cùng published template; câu chữ, số
liệu, placeholder, dữ liệu merge, chữ ký, con dấu và các invariant bảo vệ phải
giữ nguyên. Source/published template checksum không đổi. Existing final-artifact
hash tiếp tục phản ánh chính xác bytes đã tải xuống.

API catalog vẫn nhận optional `standardizationProfile` và trả
`report.standardization`; client cũ có thể bỏ qua field này. Hai endpoint catalog,
publish gate compatibility và idempotency semantics không đổi. Tắt
`WORD_TEMPLATE_CATALOG_ENABLED` không tắt automatic export formatting; hai tính
năng có rollback độc lập.

## Migration, rollout và rollback

Không có schema migration, data backfill hay rewrite template. Rule JSON và
automatic policy được đóng gói, version hóa và pin bằng SHA-256. Default rollout
là `WORD_EXPORT_STANDARDIZATION_MODE=apply_safe`, đúng với quyết định sản phẩm
rằng xuất Word phải tự động và không phụ thuộc người dùng.

Có thể chuyển sang `shadow` để so sánh quyết định mà không đổi output, hoặc `off`
để rollback tức thời về original-template rendering. Rollback không xóa
version/report/audit, không đổi assignment và không sửa bytes đã publish. Feature
flag catalog, shadow/cutover authority của ADR 0010, bảng `api_idempotency`,
advisory lock và CAS hiện hữu không đổi.

## Regression seams

- mọi API/durable job xuất DOCX hội tụ tại `render_docx` và tự động format mà
  không cần profile, preflight, click hay standardized draft;
- mode mặc định `apply_safe`, semantics `shadow`/`off`, invalid-mode fallback và
  original-template fail-open khi analyze/apply/invariant thất bại;
- complexity budget theo namespace URI, kể cả prefix OOXML thay thế, và
  structured operational event không chứa nội dung;
- content detector, confidence/conflict handling, conservative context hint,
  strict allowlist/fallback, policy/engine/rule hash và stale analysis rejection;
- exact text, numeric token, placeholder, field, SDT, bookmark, story/run,
  relationship, immutable part, media, signature part, table, protected
  paragraph và section preservation;
- hard exclusion cho table, signature/seal/drawing, list/numbering, textbox,
  section-property paragraph, tracked change, field/SDT/bookmark/placeholder và
  signed OPC package;
- standardizer chỉ nhận template bytes + bounded type hint trước record merge;
  authorization, full-data visibility và dữ liệu merge sau chuẩn hóa không đổi;
- archive/template validation, output-size limit và lỗi render hiện hữu không bị
  formatting fail-open che khuất;
- immutable source/published bytes, unchanged assignment, exact template
  provenance và final-artifact checksum;
- catalog preflight/preview/apply vẫn tùy chọn; derived draft source link,
  stale/no-op CAS, same-key replay, different-payload conflict và no-duplicate
  behavior không đổi;
- bounded preflight fallback, tenant scope, storage checksum, post-worker
  reauthorization và unchanged record authorization/full-data contract;
- production package chứa versioned rule/policy assets, automatic apply
  idempotent, và golden DOCX được render/kiểm tra mọi trang thay đổi trước khi mở
  rộng mutation allowlist hoặc thêm layout fix.
