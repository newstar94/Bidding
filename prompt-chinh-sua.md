# Prompt triển khai khắc phục sau audit BiddingFlow

Bạn là senior full-stack engineer chịu trách nhiệm khắc phục các vấn đề đã được audit trong codebase BiddingFlow tại `D:\Bidding`.

Mục tiêu của nhiệm vụ là **sửa và kiểm chứng code thực tế**, không dừng ở phân tích hoặc tạo thêm một báo cáo audit. Hãy xử lý mọi hạng mục an toàn, đã đủ thẩm quyền; chỉ tạm dừng riêng hạng mục thực sự cần quyết định nghiệp vụ, dữ liệu đối chiếu hoặc phê duyệt của chủ sản phẩm.

## 1. Bắt buộc đọc trước khi sửa

1. Đọc toàn bộ `AGENTS.md`.
2. Đọc toàn bộ `CONTEXT.md`.
3. Đọc báo cáo audit `file.md`.
4. Kiểm tra `git status`, diff hiện có và commit hiện tại.
5. Bảo toàn toàn bộ thay đổi có sẵn của người dùng; không reset, checkout, xóa hoặc ghi đè ngoài phạm vi.
6. Kiểm chứng lại từng finding trên source hiện tại. Số dòng trong báo cáo chỉ là mốc tham khảo; không sửa theo suy đoán.
7. Nếu một finding đã được sửa một phần trong worktree, tiếp tục từ trạng thái đó, rà soát tính đúng đắn và hoàn thiện test; không làm lại máy móc.

Phiên bản được audit là `main@9cc9d3d3`. Mọi kết luận phải được đối chiếu với code hiện tại trước khi hành động.

## 2. Business contract bất biến

Các quy tắc sau có mức ưu tiên cao hơn mọi khuyến nghị hardening chung:

- Không thêm, bỏ hoặc thay đổi masking, redaction, ẩn trường, rút gọn hoặc lọc dữ liệu người dùng đang được phép xem.
- Người dùng đã có quyền đọc bản ghi theo tenant, module, assignment và record scope phải tiếp tục xem đầy đủ dữ liệu của bản ghi, gồm CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và dữ liệu liên quan.
- Entitlement/quyền xuất Word chỉ kiểm soát hành động tạo hoặc tải tài liệu Word; không được dùng để che hoặc mở dữ liệu trong API/màn hình đọc bản ghi.
- Không tạo capability đọc dữ liệu nhạy cảm riêng.
- Không tự ý thay đổi role, active persona, module permission, assignment scope, record scope, capability, entitlement, inheritance hoặc default allow/deny.
- Phải bảo toàn tenant isolation, record-level authorization, session checks và audit.
- Không sửa expected value của test để hợp thức hóa semantics quyền hoặc hiển thị dữ liệu chưa được phê duyệt.
- Nếu một sửa đổi buộc phải thay đổi contract trên, dừng riêng hạng mục đó và yêu cầu chủ sản phẩm xác nhận trước khi sửa production code, schema, migration, UI hoặc test expectation.

## 3. Thứ tự triển khai

Ưu tiên P1 → P2 → P3. Trong mỗi nhóm, viết regression test tái hiện lỗi trước, xác nhận test đỏ vì đúng nguyên nhân, sửa tối thiểu tại seam có thẩm quyền, sau đó chạy lại targeted tests.

### 3.1. Authorization và tenant isolation

1. Khắc phục rò rỉ xuyên tenant tại `GET /api/auth/users`:
   - Organization manager chỉ nhận projection thuộc active organization.
   - Không trả membership, subscription, permission, document grant hoặc personal workspace ngoài scope.
   - Phải tôn trọng active employee persona, không dùng membership quản lý nền để mở rộng dữ liệu.
   - Thêm test HTTP có ít nhất hai organization và một member dùng chung để chứng minh không rò rỉ.

2. Khắc phục durable document-job authorization:
   - Authority tại thời điểm thực thi phải lấy từ account/membership hiện tại.
   - Không tiếp tục tin platform role cũ lưu trong snapshot sau demotion hoặc revocation.
   - Snapshot active persona chỉ được dùng đúng semantics persona, không được khôi phục quyền nền đã mất.
   - Thêm test demotion trước render và demotion giữa các lần authorization recheck; artifact không được publish nếu quyền đã mất.

3. Khắc phục document-export capability routes:
   - Giữ nguyên đối tượng `SessionRole` xuyên suốt authorization; không stringify làm mất `active_role`.
   - Thêm test GET và PUT chứng minh manager đang chọn employee persona bị từ chối quản lý document-export grant.

4. Rà soát P2.1 về authorization TOCTOU trong mutation thành viên/quyền:
   - Recheck authority tại mutation boundary và trong transaction phù hợp.
   - Không thay semantics hiện hữu của role/scope.
   - Có concurrency hoặc integration test tại seam thực tế, không chỉ source-regex test.

### 3.2. Word export và cấu hình

1. Hỗ trợ tenant-scoped media xuyên suốt projection → IPC → renderer:
   - Canonical path: `images/<type>/t-<tenant-hash>/<file>`.
   - Thread tenant/organization đã được authorize một cách tường minh.
   - Bắt buộc xác thực media thuộc tenant hiện tại; từ chối path tenant khác và path traversal/malformed.
   - Giữ compatibility với media legacy hợp lệ theo contract hiện hành.
   - Thêm test kiểm tra file DOCX thực tế có entry `word/media/*`, ảnh đúng tenant được embed và ảnh tenant khác bị từ chối.

2. Chống lost update cấu hình Word:
   - Dùng persistence có revision/CAS hoặc PATCH theo document type.
   - Stale write phải trả `409 Conflict` với contract lỗi rõ ràng.
   - Không coi process-local mutex là giải pháp hoàn chỉnh cho nhiều process/worker.
   - Thêm test hai editor đọc cùng revision rồi ghi cạnh tranh, cùng test phù hợp cho nhiều worker/process.

3. Xử lý config corruption:
   - Không nuốt lỗi JSON/I/O thành `{}` rồi cho phép ghi đè.
   - Fail rõ ràng, bảo toàn dữ liệu có thể khôi phục; áp dụng quarantine/backup/revision nếu phù hợp với kiến trúc hiện tại.
   - Thêm regression test chứng minh mutation không tiếp tục trên synthetic empty config.

4. Khắc phục transaction/audit của Word template:
   - Upload, replace, delete, assignment và availability mutation phải có audit đầy đủ.
   - Không để API báo lỗi trong khi filesystem đã đổi âm thầm hoặc config/file lệch nhau.
   - Thiết kế state machine, transactional outbox/reconciler hoặc cơ chế bền vững tương đương; mô tả rõ invariant.
   - Thêm fault-injection tests cho lỗi ở ranh giới file/config/audit.

5. Loại bỏ nguy cơ hai nguồn policy Word bị drift:
   - Chọn một nguồn contract có thẩm quyền hoặc thêm parity test cho toàn bộ metadata: ID, label, applicability, scope, context và export mapping.
   - Không thay đổi semantics tài liệu hiện hữu nếu chưa có phê duyệt.

### 3.3. Frontend race và độ bền tài nguyên

1. Workspace switching:
   - Request/config/error/render của workspace A không được ghi vào workspace B.
   - Catch/finally của stale request phải no-op.
   - State phải được key/guard bằng workspace token hoặc lease có thẩm quyền.
   - Thêm test chuyển workspace trong khi request đang pending, gồm success, failure và abort.

2. Asset loader:
   - Quản lý rõ trạng thái `loading/loaded/error`.
   - Các caller concurrent phải cùng đợi asset tải hoàn tất.
   - Xóa rejected promise/node lỗi để lần sau có thể retry.
   - Script load xong phải xác nhận global mong đợi tồn tại.
   - Thêm behavioral tests cho concurrent load, failure rồi retry và CSS load race.

3. Service worker:
   - Install phải thất bại nếu precache/manifest chưa hoàn chỉnh; không activate cache rỗng.
   - Chỉ evict cache cũ sau khi cache mới commit thành công.
   - Không làm hỏng tab đang chạy bundle cũ bằng takeover/eviction sớm.
   - Thêm tests cho manifest non-OK, partial precache failure và old-client lifecycle.

### 3.4. Migration và vận hành

1. Migration v61:
   - Không sửa migration v61 đã phát hành.
   - Không tự động đổi toàn bộ `HCP` về `HTD`.
   - Chỉ thêm preflight/diagnostic read-only, ADR draft và remediation plan an toàn.
   - Nếu thiếu mapping tenant hoặc backup đã được chủ sản phẩm xác nhận, dừng riêng remediation dữ liệu và báo blocker cụ thể.

2. Bổ sung preflight/runbook cho v49–v62:
   - Bao phủ duplicate/cardinality/lock/candidate-organization checks ở các migration rủi ro.
   - Có dry-run, rollback rehearsal và liên kết tài liệu deploy đầy đủ.
   - Nếu cần schema mới, tạo migration kế tiếp; tuyệt đối không sửa migration lịch sử.

### 3.5. Quality gates, E2E và dependency monitoring

1. Làm `npm run lint:debt` xanh bằng design tokens hoặc loại bỏ raw color debt; không nâng baseline để né gate.
2. CI phải phát hiện required Playwright specs bị ignore. Với legacy procurement wizard, không xóa hoặc viết lại semantics trước product approval; ghi blocker nếu entrypoint chưa được xác nhận retire.
3. Nâng coverage tại authorization, persistence, export, error và workspace-switch seams bằng interaction/integration tests có giá trị; không chỉ thêm regex/source-shape tests.
4. Bổ sung dependency monitoring cho npm và Python theo finding trong `file.md`, giữ thay đổi workflow nhỏ và kiểm chứng được.

### 3.6. Code chết, legacy và rác

- Chỉ xóa symbol khi đã chứng minh không có production caller, dynamic registration, template reference, test contract còn giá trị hoặc external compatibility dependency.
- Chuyển test khỏi dead implementation sang authoritative runtime contract trước khi xóa policy chết.
- Có thể dọn client-side winning-goods implementation cũ và các symbol P3.6 khi đã có bằng chứng reachability đầy đủ và test production path vẫn xanh.
- Không tự xóa dữ liệu/local artifact như `data`, `release`, `.env*`; không log hoặc đưa secret vào báo cáo.
- Root `favicon.png` chỉ được xóa sau khi xác nhận không phải source-design asset ngoài runtime.
- Tài liệu trùng lặp chỉ được canonicalize khi toàn bộ link/caller được cập nhật và kiểm chứng.

Các hạng mục sau **bắt buộc giữ nguyên** cho đến khi có product approval và ADR:

- Offboarding successor flow.
- Staged-approval metadata/schema.
- Legacy procurement wizard.
- `sensitive_record_read_capabilities` và full-record read contract.

Tuyệt đối không tái kích hoạt masking hoặc sensitive-read capability. Nếu chưa đủ bằng chứng xóa an toàn, ghi thành follow-up thay vì đoán.

## 4. Quy trình kỹ thuật bắt buộc

1. Với mỗi bug authorization, tenant media, persistence hoặc concurrency:
   - Viết test tái hiện trước.
   - Chạy test và lưu bằng chứng đỏ đúng nguyên nhân.
   - Sửa tối thiểu.
   - Chạy test và lưu bằng chứng xanh.
2. Ưu tiên test hành vi qua HTTP/service/worker/public API; chỉ dùng unit test khi đó là seam có thẩm quyền thật sự.
3. Không làm refactor lớn không liên quan trong cùng thay đổi.
4. Không xóa hoặc sửa expected value chỉ để test xanh.
5. Mọi thay đổi contract/schema đã được phê duyệt phải có ADR, compatibility impact, migration/rollback strategy và regression tests tại các seam liên quan.
6. Sau mỗi nhóm, rà soát diff để phát hiện scope creep, silent behavior change và code chết mới.
7. Không commit, push, deploy hoặc mutate database ngoài ý muốn nếu chưa được yêu cầu rõ ràng.

## 5. Kiểm chứng tối thiểu

Chạy và báo cáo chính xác kết quả:

- Targeted Python tests cho authorization, session, tenant isolation, document jobs, Word media, config CAS/corruption và audit.
- Targeted JavaScript tests cho workspace switching, asset loader và service worker.
- Integration tests với PostgreSQL cho concurrency/worker khi có `TEST_DATABASE_URL` an toàn.
- `npm run lint:debt`
- `npm run check:static`
- `npm run lint:security`
- `npm run test:js:coverage`
- `git diff --check`

Chỉ chạy full Python/integration suite khi đã xác minh `TEST_DATABASE_URL` trỏ tới database test dùng riêng và được phép mutate. Không được dùng production database hoặc local runtime database ngoài ý muốn. Nếu không có môi trường an toàn, ghi rõ test nào bị skip và lệnh cần chạy trong CI.

Không tuyên bố hoàn tất nếu targeted regression tests hoặc quality gate liên quan còn đỏ. Phân biệt rõ:

- Pass.
- Fail do code.
- Skip vì thiếu hạ tầng an toàn.
- Blocked vì cần quyết định nghiệp vụ/dữ liệu.

## 6. Báo cáo bàn giao bắt buộc

Khi hoàn tất, báo cáo ngắn gọn nhưng đầy đủ:

1. Finding nào đã sửa và cách tái hiện lỗi trước đó.
2. Nguyên nhân gốc và invariant sau sửa.
3. File đã thay đổi.
4. Regression tests đã thêm hoặc cập nhật.
5. Tất cả lệnh kiểm chứng và kết quả thực tế.
6. Compatibility, migration và rollback impact.
7. Finding chưa sửa, lý do cụ thể và quyết định cần chủ sản phẩm cung cấp.
8. Mọi rủi ro còn lại hoặc test phải chạy trong CI/staging.
9. Xác nhận rõ rằng thay đổi không làm đổi masking, full-record read contract hoặc semantics quyền ngoài phạm vi đã được phê duyệt.

Không dừng sau khi chỉ lập kế hoạch. Hãy triển khai, kiểm chứng và hoàn thiện tất cả phần an toàn trong phạm vi; chỉ dừng riêng các phần thực sự bị chặn bởi contract hoặc dữ liệu mà chủ sản phẩm phải cung cấp.
