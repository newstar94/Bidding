# Nghiên cứu hiệu năng xuất Word của BiddingFlow

**Ngày:** 2026-08-24
**Phạm vi:** pipeline xuất DOCX hiện tại, chuẩn hóa tự động, `docxtpl`/`python-docx`,
IPC/worker, ảnh và đóng gói ZIP.
**Loại tài liệu:** nghiên cứu và đề xuất; chưa sửa production code, cấu hình, quyền hay
hành vi hiển thị dữ liệu.
**Kết luận ngắn:** độ trễ lớn nhất không nằm ở một lệnh `doc.render()` đơn lẻ. Nó đến
từ việc cùng một template/ảnh bị copy, mở, kiểm tra, parse, fingerprint và nén lại
nhiều lần trong một subprocess mới cho từng tài liệu. Cách cải thiện có tỷ lệ lợi ích/
rủi ro tốt nhất là chuẩn hóa và kiểm tra **một lần theo phiên bản template bất biến**,
cache bytes/attestation theo hash, không tái mã hóa chữ ký/con dấu, batch các tài liệu
cùng một lần xuất và tránh DEFLATE đối với blob vốn đã nén.

## 1. Ranh giới bắt buộc

Mọi tối ưu trong note này phải giữ nguyên các contract sau:

- Không sửa câu chữ, nội dung pháp lý, số liệu, placeholder, field, bookmark, chữ ký
  hay con dấu.
- Không đổi quyền, entitlement, tenant/record/assignment scope hoặc dữ liệu người dùng
  đã được phép đọc. Word entitlement tiếp tục chỉ kiểm soát hành động xuất/tải Word.
- Không chia sẻ object render mutable hoặc artifact tenant này cho tenant khác.
- Không bỏ archive/template validation chỉ để lấy tốc độ. Chỉ được tái sử dụng một
  kết quả validation khi nó pin đúng exact SHA-256, validator version và policy version
  của một artifact bất biến.

Đặc biệt, `anh_chu_ky` và `anh_dau` phải được coi là `LEGAL_IMMUTABLE`: hash blob trước
và sau khi nhúng phải giống nhau. Chỉ thay đổi kích thước hiển thị trong OOXML, không
decode/resize/re-encode pixels. `anh_chung_chi` cũng nên mặc định bất biến vì có thể là
chứng cứ pháp lý; mọi derivative khác bytes chỉ được dùng nếu chủ sản phẩm duyệt một
business contract riêng.

## 2. Pipeline hiện tại

```text
DB/context/template selection
  -> durable job manifest: copy template + mọi ảnh được tham chiếu
  -> consumer materialize job
  -> private child-job manifest: copy template + ảnh lần nữa
  -> tạo Python subprocess mới + sandbox
  -> đọc/verify IPC sidecars
  -> automatic standardization
       complexity scan
       sector preview
       [strict preview]
       [apply + preservation verification + serialize + reopen verification]
  -> translate/repack template cho docxtpl
  -> lần lượt decode/resize/re-encode ảnh
  -> docxtpl render
  -> python-docx save (ZIP_DEFLATED toàn package)
  -> result.bin + hash/IPC readback
  -> [nhiều DOCX: nén các DOCX vào ZIP lần nữa]
  -> audit + HTTP response
```

Căn cứ trong repo:

- Route chạy từng template **tuần tự** tại
  `backend/documents/routes_docx.py:1194-1244`.
- `run_document_job_async()` luôn tạo durable job; enqueue ghi manifest/copy sidecar tại
  `backend/documents/document_worker.py:642-742`, rồi consumer gọi lại
  `run_document_job()` tại `backend/documents/document_worker.py:1089-1126`.
  Lần gọi sau tạo private temp job và ghi manifest/copy sidecar lần nữa tại
  `backend/documents/document_worker.py:413-514`.
- Mỗi private job tạo một `subprocess.Popen` mới tại
  `backend/documents/document_worker.py:459-506`.
- Standardizer chạy trước render tại
  `backend/documents/document_worker_entry.py:271-300`.
- Translate template và render/save nằm tại
  `backend/documents/custom_exporter.py:1142-1226` và
  `backend/documents/custom_exporter.py:1528-1601`.

Đây là lý do tăng riêng `DOCUMENT_WORKER_MAX_CONCURRENCY` không thể tự làm một job
đơn lẻ nhanh hơn: nó chủ yếu tăng throughput/giảm queue khi còn CPU và RAM, trong khi
mỗi job vẫn thực hiện đầy đủ chuỗi trên.

## 3. Local benchmark evidence

### 3.1. Phương pháp và giới hạn

Các số dưới đây được đo cục bộ trên Windows, Python 3.14.5, dependency đang pin trong
repo (`docxtpl==0.20.2`, `python-docx==1.2.0`, `Pillow==12.3.0`). `python -m PIL` xác
nhận wheel hiện tại có libjpeg-turbo 3.1.4.1 và zlib-ng. Benchmark dùng subprocess/
IPC thật của app nhưng phần lớn dữ liệu là synthetic; không gồm mạng, database thực,
reverse proxy hay tải đồng thời production. Vì vậy đây là bằng chứng so sánh các phase,
**không phải production SLA**.

### 3.2. End-to-end isolated worker

Median của 3 mẫu trong cùng harness:

| Case | Median |
|---|---:|
| 0 ảnh, standardization `off` | 446,7 ms |
| 0 ảnh, `shadow` | 511,0 ms |
| 0 ảnh, `apply_safe` | 750,1 ms |
| 1 PNG 1,87 MB, `apply_safe` | 789,3 ms |
| 10 PNG unique, tổng 18,7 MB, `off` | 952,9 ms |
| 10 PNG unique, tổng 18,7 MB, `apply_safe` | 1.383,7 ms |
| 10 WebP nhỏ unique, tổng 93,7 KB, `apply_safe` | 1.052,0 ms |

So sánh cùng harness ảnh: 10 lần tham chiếu cùng một path mất 922,1 ms, còn 10 path
unique mất 1.264,8 ms. Điều này phù hợp với việc cache hiện tại giúp trong **một**
subprocess khi key path lặp, nhưng không sống qua job. Với 4 job đồng thời và giới hạn
2 worker, cặp đầu hoàn tất khoảng 1,27 giây, cặp sau khoảng 2,50 giây: concurrency 2
tạo hai wave, không giảm CPU time của từng export.

Đo phase trực tiếp cho thấy standardizer của fixture nhỏ khoảng 242-248 ms; render 10
ảnh cold-cache 381,9 ms và warm-cache 116,4 ms. Một template lưu thật 41,6 KB/178
paragraph, kết luận low-confidence, mất 295,9 ms ở `apply_safe`. CProfile tương ứng ghi
nhận hai lần `process_docx` và bốn lần `validate_ooxml_archive`; với ảnh cold, các điểm
đứng đầu là tối ưu ảnh và archive validation.

### 3.3. Stress corpus của standardizer

Đo trực tiếp `standardize_template_for_export()` trên tài liệu repo:

| Input | Đặc điểm | `shadow` | `apply_safe` |
|---|---|---:|---:|
| `docs/BiddingFlow_Mau_Kiem_Thu_Xuat_Word.docx` | 41.592 B, low confidence | 0,235 s | 0,218 s |
| `docs/30_2020_ND-CP_436532.docx` | 115.623 B | 1,335 s | 2,929 s |
| `docs/Phụ lục.docx` | 631.586 B, 3 media/250.905 B uncompressed | 7,137 s | 16,483 s |

Các số này cho thấy kích thước ZIP không dự báo đủ chi phí; số paragraph/run/style và
số lượt phân tích/fingerprint mới là biến quan trọng. CProfile trên input 115.623 B ở
nhánh strict/apply ghi nhận 3 lần `process_docx`, 6 lần `_analyze`, 13 lần
`_fingerprint`, 5 lần archive validation và 4 lần dựng `_Package`. Profiling có overhead
nên không dùng thời gian tuyệt đối của CProfile làm SLA, nhưng call count chỉ ra công
việc lặp.

Feedback loop ngắn, deterministic và agent-runnable cho nhánh chậm này:

```powershell
python -c "from pathlib import Path; from time import perf_counter; from backend.documents.word_standardizer import standardize_template_for_export; b=Path('docs/30_2020_ND-CP_436532.docx').read_bytes(); s=perf_counter(); result=standardize_template_for_export(b, mode='apply_safe'); elapsed=perf_counter()-s; print(round(elapsed, 3), result.metadata.get('status'), result.metadata.get('plannedTargetCount')); assert elapsed < 2.0, elapsed"
```

Lần chạy đã ghi nhận `2.319 APPLIED 1365` và fail assertion. Ngưỡng 2 giây ở đây là
budget chẩn đoán gắn với queue-timeout mặc định hiện tại, không phải production SLA;
bảng median phía trên là bằng chứng so sánh chính.

### 3.4. Stress ảnh và ZIP

Một JPEG synthetic 4.000x3.000, 11.378.165 B được đưa qua field ảnh chữ ký với
standardization `off`. Hai lần export mất 0,644 s và 0,587 s. Blob nhúng chỉ còn 8.437 B
và SHA-256 **không còn giống nguồn**. Đây không phải ảnh nghiệp vụ thật, nhưng nó chứng
minh chính xác code path hiện tại đang resize/re-encode một field được phép là chữ ký.
Đó là rủi ro correctness cần xử lý trước cả tối ưu sâu hơn.

Một benchmark đóng gói synthetic DOCX có JPEG khoảng 11,38 MB cho kết quả:

| ZIP strategy | Thời gian 3 lần | Kích thước |
|---|---:|---:|
| DEFLATE mặc định/level 6 cho mọi part | 0,353-0,354 s | 11.330.616 B |
| DEFLATE level 1 cho mọi part | 0,156-0,161 s | 12.115.625 B |
| XML DEFLATE level 1, JPEG `ZIP_STORED` | 0,008-0,013 s | 11.443.549 B |

Đây chỉ là microbenchmark định hướng. Nó cho thấy media vốn đã nén là ứng viên rất
mạnh cho `ZIP_STORED`, nhưng mọi writer mới vẫn phải qua corpus Word/LibreOffice,
archive validation, golden render và byte-preservation trước rollout.

## 4. Điểm nghẽn đã xác định

### 4.1. Chuẩn hóa lặp toàn bộ package trong hot path

`standardize_template_for_export()` chạy complexity scan, `sector_template` preview,
có thể thêm `n30_strict` preview, rồi gọi `process_docx(... apply_fix)` lần nữa
(`backend/documents/word_standardizer/automatic.py:301-422`). Bên trong mỗi
`process_docx`, `_Package` lại validate, đọc mọi ZIP part vào RAM, parse story/style XML,
fingerprint, analyze; apply còn analyze hậu kiểm, serialize, reopen và fingerprint output
(`backend/documents/word_standardizer/engine.py:355-389`,
`backend/documents/word_standardizer/engine.py:2236-2315`).

Việc kiểm tra bảo toàn là đúng và không được bỏ. Vấn đề là nó đang được lặp lại cho
**mỗi record export**, dù standardizer chỉ nhận template bytes và document-type hint,
không nhận record context. Với template catalog bất biến, kết quả này có thể tính một
lần theo exact version/hash và tái sử dụng có kiểm chứng.

### 4.2. Cache template hiện tại gần như không có hit qua worker

`_TRANSLATED_DOCXTPL_CACHE` và `_OPTIMIZED_IMAGE_CACHE` là dictionary trong process
(`backend/documents/custom_exporter.py:1140-1226`,
`backend/documents/custom_exporter.py:1273-1346`). Mỗi tài liệu tạo Python subprocess
mới, nên cache bị hủy khi job kết thúc. Khi standardizer trả bytes đã đổi,
`template_content` làm `using_content_override=True`; nhánh này còn chủ động không đọc/
ghi translated-template cache. Ngay cả nhánh không đổi cũng chỉ có một request trong
process nên cold miss là trạng thái bình thường.

`prewarm_image_cache()` cũng không giải quyết đường worker:

- Nó chỉ `os.listdir(images/chuyen_gia)` một cấp, trong khi media tenant hiện nằm trong
  thư mục con `t-...`.
- Nó không prewarm `nha_thau/anh_dau`.
- IPC chỉ copy ảnh nguồn được context tham chiếu, không copy file sibling
  `*_opt_<width>.jpg`.
- Child worker đổi `BIDDING_UPLOAD_DIR` sang private `job/assets/images`, nên derivative
  đã prewarm bên ngoài không hiện diện.

Căn cứ: `backend/documents/custom_exporter.py:1349-1391`,
`backend/documents/document_ipc.py:111-165`, và
`backend/documents/document_worker.py:211-265`.

### 4.3. Ảnh bị copy và biến đổi trên mỗi export

`optimize_image_for_docx()` hiện:

- đọc metadata/file, mở Pillow;
- resize về 300 px, riêng certificate 1.200 px;
- flatten alpha trên nền trắng;
- chuyển mọi output thành JPEG quality 80;
- ghi cache cạnh source rồi trả bytes.

Căn cứ: `backend/documents/custom_exporter.py:1275-1346` và image field contract tại
`backend/documents/docx_context_policy.py:29-42`. Điều này vừa tốn decode/resize/encode,
vừa không đáp ứng yêu cầu exact-byte cho chữ ký/con dấu. Pillow ghi rõ JPEG `quality`
điều khiển nén mất mát, `optimize=True` còn chạy thêm một pass; metadata như ICC/EXIF
chỉ được giữ khi truyền lại rõ ràng
([Pillow JPEG saving options](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html#jpeg)).

Pillow cũng xác nhận `ImageOps.exif_transpose()` biến đổi hướng pixels và xóa Orientation
tag, nên thao tác này chỉ phù hợp một lần ở ingestion cho loại ảnh được phép, không
được âm thầm áp dụng khi xuất chữ ký/con dấu
([Pillow ImageOps](https://pillow.readthedocs.io/en/stable/reference/ImageOps.html#PIL.ImageOps.exif_transpose)).

### 4.4. `python-docx` đã dedupe ảnh, nhưng vẫn phải đọc/hash blob

`InlineImage` gọi `new_pic_inline()` mỗi lần placeholder được render
([docxtpl 0.20.2 source](https://github.com/elapouya/python-docx-template/blob/v0.20.2/docxtpl/inline_image.py)).
`python-docx` đọc toàn bộ image descriptor thành bytes, rồi tính SHA1; package chỉ tạo
media part mới khi chưa có part trùng SHA1
([Image.from_file](https://github.com/python-openxml/python-docx/blob/v1.2.0/src/docx/image/image.py),
[image-part dedupe](https://github.com/python-openxml/python-docx/blob/v1.2.0/src/docx/package.py)).

Do đó duplicate blob không làm DOCX phình tuyến tính, nhưng vẫn có thể trả giá đọc/hash
và dựng drawing XML nhiều lần. Truyền `width` chỉ thay kích thước hiển thị EMU; nó không
làm blob nhỏ đi
([python-docx picture API](https://python-docx.readthedocs.io/en/latest/user/quickstart.html#adding-a-picture),
[scaling implementation](https://github.com/python-openxml/python-docx/blob/v1.2.0/src/docx/image/image.py)).

### 4.5. ZIP nén lại dữ liệu vốn đã nén

Upstream `python-docx` 1.2.0 dùng một `ZipFile(... ZIP_DEFLATED)` cho mọi OPC part và
không expose `compresslevel` theo part
([pinned writer source](https://github.com/python-openxml/python-docx/blob/v1.2.0/src/docx/opc/phys_pkg.py)).
Ngoài ra, khi người dùng chọn nhiều mẫu, BiddingFlow đặt các `.docx` — bản thân đã là
ZIP — vào một ZIP `ZIP_DEFLATED` khác tại `backend/documents/routes_docx.py:1178-1191`.

Python hỗ trợ `ZIP_STORED`, `ZIP_DEFLATED` và level 0-9; tài liệu cũng cảnh báo các
method mới như BZIP2/LZMA/Zstandard có thể không tương thích công cụ cũ, nên DOCX chỉ
nên thử STORE/DEFLATE
([Python `zipfile`](https://docs.python.org/3/library/zipfile.html)). Microsoft OPC chính
thức cho phép `NONE`, `NORMAL`, `MAXIMUM`, `FAST`, `SUPERFAST`, xác nhận compression là
trade-off theo từng part chứ không phải contract bắt buộc phải nén tối đa
([Microsoft OPC compression options](https://learn.microsoft.com/en-us/windows/win32/api/msopc/ne-msopc-opc_compression_options)).

### 4.6. Copy bytes/RAM và tuần tự hóa nhiều output

Trong một synchronous export, template/ảnh đi qua durable sidecar rồi private child
sidecar; output đi từ `BytesIO` sang `bytes`, `result.bin`, đọc lại thành `bytes`, rồi lại
bọc `BytesIO` cho response. `BytesIO.getbuffer()` có thể cấp view không copy, nhưng view
khóa resize/close của buffer khi còn sống
([Python `BytesIO`](https://docs.python.org/3/library/io.html#io.BytesIO.getbuffer)).
Với output lớn, `SpooledTemporaryFile` giữ trong RAM đến ngưỡng rồi rollover xuống disk;
nó chủ yếu giảm RAM peak, không mặc nhiên giảm latency
([Python `SpooledTemporaryFile`](https://docs.python.org/3/library/tempfile.html#tempfile.SpooledTemporaryFile)).

Khi chọn nhiều template, `_render_word_selection()` await từng target tuần tự. Mỗi target
lặp lại worker startup, copy cùng context/ảnh, standardization và render. Đây là điểm
nghẽn rõ cho tính năng xuất bộ tài liệu.

## 5. Phương án đề xuất

### P0 — Đo đúng phase và khóa correctness trước

1. Thêm timing monotonic cho các phase:
   `queue_wait`, `ipc_manifest`, `asset_copy`, `process_start`, `standardize_complexity`,
   `standardize_preview`, `standardize_apply`, `template_translate`, `image_prepare`,
   `docxtpl_render`, `docx_save`, `bundle_zip`, `audit`, `response_ready`.
2. Chỉ log metadata allowlisted, low-cardinality: operation/document type/profile,
   bucket paragraph/run/style, bucket image count/total bytes, cache hit/miss, bucket
   input/output bytes và status. Không dùng template ID/SHA làm metric label và không log
   context, tên người, path ảnh, chữ ký/con dấu hay dữ liệu pháp lý. Exact hash chỉ tồn
   tại ở cache/provenance/verification seam đã authorize, theo contract hiện có.
3. Thêm invariant `embeddedSha256 == sourceSha256` cho `anh_chu_ky`, `anh_dau` và mặc
   định cho `anh_chung_chi`. Case WebP chưa được `python-docx` pin hỗ trợ phải fail rõ
   hoặc dùng đường chèn byte-preserving đã được kiểm chứng; không silently convert JPEG.
4. Lập benchmark matrix p50/p95/p99 theo template complexity và bucket ảnh, không chỉ
   theo kích thước DOCX.

Kết quả P0 giúp phân biệt latency một job với queue latency và tránh “tăng concurrency”
khi bottleneck thực là CPU/RAM.

### P1 — Cache chuẩn hóa theo template bất biến

Đây là ưu tiên có tác động lớn nhất, đặc biệt với stress corpus 7-16 giây.

1. Khi upload/publish một template version, chạy standardizer trong sandbox một lần và
   lưu artifact/attestation bất biến. Với legacy template chưa có record cache, lazy
   compute một lần có single-flight.
2. Cache key tối thiểu:

   ```text
   organization_scope
   source_template_sha256
   document_type_hint
   automatic_policy_sha256 + policy_version
   engine_version
   rule_set_sha256
   effective_profile
   validator_version
   translator_version + stable root-variable-schema sha256
   ```

3. Cache value gồm standardized bytes (hoặc source bytes nếu NO_CHANGE), decision
   metadata, source/output SHA-256, preservation PASS, package-signature disposition và
   validation attestation. Mọi mismatch/version drift là miss, không “best effort”.
4. Không dùng built-in `hash(frozenset(...))` hiện tại làm persistent key vì Python hash
   không phải content-address. Dùng SHA-256 của danh sách biến đã sort và schema/version.
5. Cache bytes/metadata bất biến, **không cache và chia sẻ `DocxTemplate` instance**.
   Upstream cho thấy `render()` thay đổi `self.docx`, current rendering part, maps và cờ
   render/save
   ([docxtpl template source](https://github.com/elapouya/python-docx-template/blob/v0.20.2/docxtpl/template.py)).
6. Dùng cache có giới hạn dung lượng/TTL/LRU và per-key lock. `functools.lru_cache` là
   thread-safe nhưng có thể tính cùng cold key hơn một lần khi concurrent miss, nên job
   đắt vẫn cần single-flight
   ([Python `lru_cache`](https://docs.python.org/3/library/functools.html#functools.lru_cache)).

Cache có thể dùng cùng lifecycle catalog hiện có thay vì thêm quyền mới. Tenant vẫn phải
authorize template/version trước khi đọc artifact; hash global không được tạo timing/
existence oracle cross-tenant.

### P1 — Đổi pipeline ảnh thành byte-preserving mặc định

1. Với `LEGAL_IMMUTABLE`, bỏ Pillow khỏi hot path: dùng blob PNG/JPEG đã validate, đặt
   display width qua OOXML và assert hash media part. Cách này vừa nhanh hơn vừa đúng
   contract. Không đổi DPI/EXIF/ICC/alpha/pixels.
2. Chỉ với loại `NON_LEGAL_OPTIMIZABLE` đã được chủ sản phẩm duyệt:
   - kiểm tra format/dimensions trước, bypass nếu đã trong budget;
   - tạo derivative **một lần** khi upload/background, giữ nguyên original;
   - key derivative bằng source SHA-256 + target dimensions + format + quality + EXIF
     policy + pipeline version;
   - dùng content-addressed cache root riêng, không ghi `*_opt_` cạnh asset nghiệp vụ;
   - ở cold path dùng `thumbnail()`/`reducing_gap`, vì Pillow có thể dùng `draft()` cho
     JPEG và resize hai bước nhanh hơn
     ([Pillow `thumbnail`](https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.Image.thumbnail));
   - không dùng encoder `optimize=True` trên request; Pillow ghi rõ đây là extra pass
     ([Pillow formats](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html)).
3. Dedupe task theo source digest trước khi tạo `InlineImage`; cùng blob/variant chỉ đọc
   và chuẩn bị một lần. Vẫn để `python-docx` dedupe media part theo SHA1 như lớp phòng
   thủ thứ hai.
4. Cache phải bounded và single-flight. Không cache theo path+mtime đơn thuần; path có
   thể tái sử dụng và mtime có độ phân giải/semantics khác nhau giữa filesystem.

### P1 — Batch một lần xuất nhiều template

Thêm operation nội bộ `render_docx_batch` nhận danh sách exact template sidecars nhưng
chỉ một context/manifest/assets set:

- copy ảnh một lần;
- khởi động sandbox/process một lần;
- tái sử dụng standardized/translated bytes cache;
- render từng template thành result sidecar riêng với giới hạn tổng output;
- nếu trả ZIP, dùng `ZIP_STORED` cho các `.docx` đã nén.

Nếu benchmark cho thấy một batch CPU-bound quá dài, shard danh sách thành tối đa
`min(template_count, measured_worker_capacity)` batch và chạy bounded concurrent. Không
dùng `asyncio.gather` không giới hạn vì mỗi job có thể giữ nhiều bản copy template/ảnh.

### P1/P2 — Trả durable job cho UI đối với export nặng

Frontend hiện gọi trực tiếp `/api/export-plan` và `/api/export-report`, chờ toàn bộ pipeline
hoàn tất (`frontend/documents/WordPublicationState.js:73-80`). Repo đã có API trả `202` cho
package report tại `backend/documents/document_job_routes.py:84-204`, nhưng chưa phải đường
mặc định của UI và chưa có biến thể tương đương cho plan.

Sau khi có phase metrics, dùng một ngưỡng complexity do server tính từ template, số template,
image count và tổng image bytes để chuyển export nặng sang durable UX: trả job ID, hiển thị tiến
độ và tải khi hoàn tất. Đây không làm CPU của một job giảm, nhưng loại request chờ dài/timeout và
cho phép retry/cancel có kiểm soát. Mọi session, tenant, module, assignment, record scope, Word
entitlement, pre/post-worker reauthorization và audit hiện có phải giữ nguyên; client không được
tự quyết định bỏ qua authorization hoặc ép fast path.

### P1/P2 — ZIP writer theo loại part

Prototype writer version-pinned:

- `word/media/*.jpg|jpeg|png|webp` và embedded binary đã nén: `ZIP_STORED`;
- XML/rels/content-types: `ZIP_DEFLATED`, benchmark level 1 hoặc 3;
- không dùng BZIP2/LZMA/Zstandard trong DOCX;
- outer ZIP chứa `.docx`: `ZIP_STORED`.

Không nên save bằng `python-docx` rồi reopen/repack chỉ để đổi compression nếu hai lượt
ghi xóa hết lợi ích. Nên bọc/thay writer seam trong phiên bản pin, có compatibility test
vì upstream writer là API nội bộ. Gate rollout bằng exact OOXML validation, Word desktop,
Word Online, LibreOffice, golden render, file-size delta và p95 CPU.

### P2 — Hợp nhất standardizer pass, vẫn giữ preservation proof

Tạo API nội bộ riêng cho automatic export, ví dụ:

```text
analyze_and_apply_safe(source_bytes, hint, policy) -> bytes + attestation
```

Nó dựng một `_Package`, một immutable analysis snapshot/hash và một fingerprint before;
quyết định profile rồi apply trên chính state đó; analyze hậu kiểm có thể dùng resolver/
inventory đã invalidation có chủ đích; serialize một lần và verify output. Workflow catalog
`preview -> user accepts hash -> apply` vẫn giữ hai boundary độc lập như hiện tại. Chỉ
automatic same-call path mới tái sử dụng state.

Các tối ưu cụ thể:

- parse/fingerprint một lần cho sector decision thay vì gọi lại `process_docx`;
- không đọc toàn bộ media vào cấu trúc phân tích nếu chỉ cần stream-hash bất biến;
- cache rule/style resolution immutable;
- không lặp full archive validation khi exact input đã có trusted attestation, nhưng vẫn
  validate output mới và mọi input mới/untrusted;
- giữ nguyên signed-package bypass, analysis hash, placeholder/business-text/media/
  relationship/table/section invariants và fail-to-original semantics.

Đây là refactor rủi ro hơn cache theo immutable version, nên làm sau P1 và yêu cầu golden
equivalence toàn corpus.

### P2 — Giảm copy IPC và RAM peak

1. Trong external/durable mode, dùng chính job directory đã authorize làm sandbox input
   thay vì materialize sang một private job thứ hai; hoặc dùng reflink/hardlink chỉ sau
   khi kiểm tra resolved path, owner/mode, no-symlink và SHA-256. Không bind toàn bộ upload
   root vào worker.
2. Kết quả lớn nên giữ dưới dạng sidecar/spooled file tới khi HTTP stream xong; audit hash
   được tính streaming. Cần lifecycle cleanup/cancellation rõ ràng để không xóa file trước
   response.
3. Dùng `memoryview/getbuffer` chỉ tại seam framework thực sự chấp nhận bytes-like và
   release view đúng lúc; đừng đổi rộng khắp chỉ vì micro-optimization.

### P3 — Warm worker/pool chỉ sau khi đo và threat-model lại

Pool sống lâu có thể amortize import/startup và giữ cache. Python cung cấp process pool,
multi-core và `max_tasks_per_child` để recycle worker
([Python `ProcessPoolExecutor`](https://docs.python.org/3/library/concurrent.futures.html#processpoolexecutor)).
Tuy nhiên worker hiện tại dùng process-per-job để giới hạn quyền, filesystem, network,
memory/CPU và cleanup. Chuyển sang pool làm thay đổi security/isolation contract, nên
không phải quick win.

Nếu P1/P2 vẫn chưa đạt mục tiêu:

- dùng dedicated long-lived document service, no network/no DB, immutable cache only;
- reset job state/temp/log handles sau mỗi task;
- max tasks/RSS/age rồi recycle;
- per-job timeout và kill subtree;
- không dùng chung `DocxTemplate` mutable;
- benchmark `DOCUMENT_WORKER_INSTANCE_COUNT` và concurrency theo CPU/RSS thực.

## 6. Thứ tự triển khai và kỳ vọng

| Thứ tự | Thay đổi | Kỳ vọng | Rủi ro |
|---|---|---|---|
| 1 | Phase metrics + legal-media hash invariant | Biết chính xác p95; chặn sửa chữ ký/con dấu | Thấp |
| 2 | Precompute/cache standardization + validation theo immutable template SHA | Loại phần lớn 0,2-16 s lặp lại ở cache hit | Thấp-vừa |
| 3 | Byte-preserving legal images; content-addressed derivative chỉ cho ảnh được phép | Nhanh hơn, đúng contract; cache sống qua job | Vừa, cần xử lý format compatibility |
| 4 | Batch multi-template + outer ZIP `STORED` | Loại nhiều process/copy cùng request | Vừa |
| 5 | Per-part ZIP compression prototype | Giảm CPU save đáng kể với DOCX nhiều ảnh | Vừa-cao vì writer nội bộ/interoperability |
| 6 | Hợp nhất automatic analysis/apply | Giảm CPU ở cold miss/template mới | Cao; preservation regression |
| 7 | Giảm IPC copy/RAM; cân nhắc warm worker | Throughput/RAM tốt hơn | Cao; lifecycle/isolation |

Không đặt trước con số SLA từ benchmark local. Nên đặt rollout gate tương đối trên corpus
production đã ẩn danh, ví dụ: cache-hit standardization giảm ít nhất 80%; end-to-end 0 ảnh
giảm ít nhất 35%; bộ nhiều template chỉ copy một assets set; legal-media hash pass 100%;
không tăng error/timeout/RSS p95 và không có golden-layout delta ngoài format đã duyệt.

## 7. Regression/evaluation bắt buộc

1. Exact preservation: business text, số, date, placeholder spans/multiset, Jinja logic,
   field/SDT/bookmark, signer paragraph, media hashes, relationships, table/section/
   header/footer và package signature behavior.
2. Ảnh: PNG alpha, JPEG EXIF orientation, WebP compatibility, ảnh 1 px, 8K/20 MP,
   duplicate same path, duplicate same bytes/different path, 100 unique ảnh, chữ ký/con
   dấu/certificate exact hash.
3. Cache: version/policy/rule/translator drift, corrupt entry, concurrent cold miss,
   eviction, restart, tenant isolation, source replaced cùng path/mtime, signed template.
4. ZIP: Word desktop/Online/LibreOffice, `validate_ooxml_archive`, unzip CRC, empty/large
   parts, headers/footers/footnotes, drawing/VML/OLE, output 64 MiB boundary.
5. Worker: cancel/timeout/crash, two concurrency waves, max queue, cleanup sidecar, audit
   hash, no network/no DB/no source-root leakage.
6. Performance: p50/p95/p99 và RSS/CPU cho 0/1/10/100 ảnh; 1/5/20 template; cold/warm;
   50 KB/1 MB/10 MB DOCX; low-confidence/no-change/apply/strict/signed/bypassed branches.

## 8. Quyết định đề xuất

Nên duyệt ngay một workstream gồm P0 và ba thay đổi P1:

1. instrumentation theo phase và invariant exact-byte cho legal media;
2. chuẩn hóa/validate/translate một lần theo immutable template version + single-flight
   content-addressed cache;
3. batch multi-template, copy assets một lần và không DEFLATE `.docx` trong outer ZIP;
4. bỏ re-encode chữ ký/con dấu ở export; derivative chỉ cho loại ảnh được product duyệt.

Chưa nên chuyển ngay sang persistent pool hoặc sửa sâu preservation algorithm. Dữ liệu
local cho thấy cache đúng seam có thể loại phần lớn độ trễ trước khi phải nới security
boundary. Sau khi có phase metrics production, mới quyết định có cần per-part ZIP writer,
IPC zero-copy/reflink hoặc long-lived worker hay không.
