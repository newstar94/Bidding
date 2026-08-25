# ADR 0015 — Xuất bản Word nhanh theo lô và xử lý nền

- Trạng thái: Chấp nhận
- Ngày: 2026-08-24
- Phạm vi: mọi luồng tạo/tải DOCX, document job, media Word và giao diện tác vụ dài
- Liên quan: ADR 0010, ADR 0014

## Quyết định

BiddingFlow dùng một pipeline Word chung cho cả xuất một biểu mẫu và nhiều biểu
mẫu. Pipeline tự động chuẩn bị mẫu, tạo tài liệu trong sandbox, đóng gói khi cần,
tái kiểm tra quyền rồi mới công bố kết quả. Màn Xuất bản Word và nút xuất hợp
đồng tạo durable job, theo dõi trạng thái và tự tải kết quả; người dùng không
phải chọn chế độ nhanh/chậm, profile chuẩn hóa hay cách xử lý ảnh.

Các tối ưu được chấp nhận:

1. Mẫu đã chuẩn hóa được cache theo tenant, SHA-256 nguồn, loại tài liệu, mode,
   policy, engine, rule-set và validator version. Cache chỉ chứa bytes biểu mẫu
   bất biến cùng attestation; không chứa context, dữ liệu bản ghi hay đối tượng
   `DocxTemplate` mutable. Cache có single-flight, kiểm tra hash, giới hạn số
   entry/dung lượng và tự tính lại khi entry hỏng hoặc version thay đổi. Sandbox
   chỉ tạo cache sidecar khi preservation là `PASS`; parent kiểm tra lại path,
   loại file, kích thước, archive và template statement trước khi publish.
2. `anh_chu_ky`, `anh_dau`, `anh_chung_chi` và mọi image field hiện được server
   cho phép trong manifest là media pháp lý bất biến. Renderer nhúng exact source
   bytes, kể cả PNG/JPEG/WebP, và chỉ đặt kích thước hiển thị bằng OOXML. Không
   resize pixel, đổi định dạng, DPI, EXIF, ICC, alpha hoặc quality. WebP được đọc
   kích thước để tạo OOXML nhưng blob không bị mã hóa lại.
3. Nhiều mẫu dùng `render_docx_batch`: một context, một assets set, một lần
   staging và một sandbox process. Thứ tự output theo thứ tự mẫu; publication là
   nguyên tử. ZIP ngoài dùng `ZIP_STORED` vì từng DOCX vốn đã là ZIP.
4. Durable job chạy trực tiếp từ staging đã được hash. Manifest chuẩn bị chỉ tạo
   sidecar mẫu đã cache và tái sử dụng assets đã stage; không copy ảnh/context
   qua một tầng IPC riêng lần nữa. Worker vẫn kiểm tra manifest/hash/path,
   sandbox, giới hạn CPU/RAM/thời gian/output và không có network/DB access.
5. Automatic standardization gộp preview/apply trong một trusted internal pass,
   tái sử dụng structural fingerprint và bỏ lượt validate ZIP ngay sau serialize
   khi `_Package` kế tiếp đã thực hiện cùng validation. Public `apply_fix` vẫn
   bắt buộc accepted `analysisHash`; ranh giới bảo toàn của ADR 0014 không đổi.
6. Mặc định tối đa bốn document worker chạy đồng thời, tiếp tục bị chặn bởi
   semaphore, queue capacity và resource limit. Giá trị vẫn cấu hình được trong
   khoảng 1–8; tăng throughput không được dùng để bỏ qua budget mỗi job.
7. Durable job công khai phase content-free: `queued`, `preparing`, `rendering`,
   `finalizing`, `completed`, `failed` hoặc `cancelled`, kèm số mẫu đã xong/tổng.
   Phase không chứa tên người, nội dung hồ sơ, đường dẫn ảnh, chữ ký hay con dấu.
8. Mọi tác vụ nền Word dùng `LongTaskLoading` chung của ứng dụng. Excel import là
   adapter trên cùng surface. Overlay dùng cùng brand, token, responsive layout,
   `aria-live`, `aria-busy` và `prefers-reduced-motion`.

## Business và authorization contract

- Không sửa câu chữ, nội dung pháp lý, số liệu, placeholder, người ký, chữ ký,
  con dấu hoặc chứng chỉ. Formatting chỉ được thay đổi trong allowlist và phải
  vượt toàn bộ preservation invariant của ADR 0014.
- Không thêm, bỏ, đổi role, module permission, assignment scope, record scope,
  capability, entitlement, inheritance, masking hay field visibility.
- Người đã có quyền đọc bản ghi tiếp tục xem đầy đủ dữ liệu được phép, gồm CCCD,
  tài khoản, ngân hàng, chữ ký và con dấu. Word entitlement chỉ kiểm soát hành
  động tạo/tải Word.
- Plan job kiểm tra `kehoach/ke_hoach_lcnt`; package job kiểm tra
  `goithau/goi_thau`. Session, tenant, record/assignment scope, entitlement và
  sensitive export capability được kiểm tra khi tạo, trước render, sau render và
  khi tải. Record revision hoặc sync revision của tenant thay đổi làm job thất
  bại, kể cả khi dependency đổi mà revision bản ghi gốc chưa tăng; không công bố
  snapshot cũ.
- Progress, cache và loading không được trở thành nguồn quyền hoặc nguồn dữ liệu.

### Bổ sung authority phụ thuộc chính xác — 2026-08-25

Job Word mới ghi `sourceDigest` SHA-256 của exact context và manifest đã niêm phong,
không gồm `current_time` là nhiễu theo thời điểm request. Sau render và trước khi
công bố, parent worker dựng lại cùng context theo `recordType`, `recordId`, loại văn
bản và chức năng xuất bản rồi so digest. Job đã hoàn thành cũng kiểm tra lại digest
trước status/download. Vì vậy mutation ngoài aggregate không còn làm job thất bại;
thay đổi bất kỳ dữ liệu nào thực sự đi vào Word vẫn trả
`DOCUMENT_EXPORT_SOURCE_CHANGED`.

`syncRevision` tiếp tục được giữ trong policy để đọc job cũ và chẩn đoán, nhưng job
có `sourceDigest` không dùng revision toàn tenant làm authority. Job v1/v2 cũ chưa
có digest vẫn giữ nguyên hành vi cũ để không làm thay đổi job đang xếp hàng khi deploy.

## Compatibility impact

Các endpoint đồng bộ `/api/export-plan` và `/api/export-report` vẫn tồn tại cho
client cũ và cùng đi qua batch/cache pipeline. UI chính chuyển sang endpoint
additive:

- `POST /api/document-jobs/plan/{plan_id}`;
- `POST /api/document-jobs/package-report/{package_id}`;
- `GET /api/document-jobs/{job_id}`;
- `GET /api/document-jobs/{job_id}/download`.

Package job cũ giữ `package_id` và policy v1 để đọc các job đang chờ trước nâng
cấp. Job mới ghi `record_type/record_id` và policy v2; batch provenance là danh
sách, mỗi output có artifact ID và SHA-256 riêng. `policy_json` tăng giới hạn có
kiểm soát từ 8 KiB lên 64 KiB để chứa tối đa 50 provenance; request vượt giới
hạn bị từ chối trước DB bằng mã rõ ràng.

Formatting/output có thể khác theo ADR 0014, và media pháp lý nay giữ exact bytes
thay vì derivative JPEG cũ. Điều này có thể làm DOCX lớn hơn nhưng là thay đổi
correctness được chủ sản phẩm yêu cầu. Tên file, dữ liệu merge và quyền hiện hữu
không đổi.

## Migration và triển khai

Migration PostgreSQL v76 bổ sung additive columns vào `document_jobs`:

- `record_type`, `record_id`;
- `progress_phase`, `progress_completed_items`, `progress_total_items`;
- index record-owner;
- check `policy_json` tối đa 65.536 ký tự.

Job có `package_id` được backfill thành `record_type='goi_thau'` và
`record_id=package_id`; progress được suy ra từ status hiện hữu. Không rewrite
input/result artifact. Deploy migration v76 trước web và document worker v76;
runtime min/max cùng là 76.

Cache nằm tại `BIDDING_WORD_EXPORT_CACHE_DIR`, mặc định dưới `BIDDING_DATA_DIR`,
và có thể xóa an toàn: lần xuất kế tiếp tự tính lại trong sandbox. Rollback an
toàn là dùng build tương thích schema 76 nhưng tiếp tục package_id/policy v1;
không drop cột, không backfill ngược và không hạ schema metadata. Có thể tắt
cache bằng `WORD_EXPORT_CACHE_ENABLED=false`, hạ concurrency về 2 và giữ durable
job/UI mà không đổi quyền hoặc dữ liệu.

## Regression seams

- cache miss/hit, tenant/source/hint/version invalidation, corrupt-entry rebuild,
  bounded eviction và single-flight;
- automatic apply vẫn giữ exact text/number/placeholder/table/signature/media và
  public apply vẫn yêu cầu analysis hash;
- PNG/JPEG/WebP source hash bằng embedded media hash cho media pháp lý;
- batch giữ order, filename uniqueness, một assets set, một worker result,
  atomic failure và outer ZIP `STORED`;
- durable staging không copy ảnh lần hai; hash/path/sandbox/output validation và
  cleanup/retry vẫn hoạt động;
- concurrency mặc định 4, admission/queue overload và worker resource limits;
- policy v1 package tương thích, policy v2 plan/package, batch provenance, record
  revision drift, sync/dependency revision drift, revoke/demotion giữa render và
  publication;
- mutation tenant không liên quan không đổi source digest; thay đổi context thật
  đổi digest và chặn publication/status/download;
- migration v1→v76, fresh schema/contract và policy-size boundary;
- Word Publication và nút hợp đồng dùng background API, poll/download, khóa thao
  tác trùng, lỗi rõ ràng và cùng loading surface với Excel;
- loading responsive, `aria-live`, body/overlay `aria-busy`, stale-handle safety
  và reduced-motion.
