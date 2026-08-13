# PROMPT CHO CODEX — KHẮC PHỤC VÀ HOÀN THIỆN TOÀN BỘ CÁC VẤN ĐỀ AUDIT BỔ SUNG CỦA BIDDINGFLOW

## 0. Bối cảnh và mục tiêu

Bạn đang làm việc trong repository BiddingFlow.

Baseline đã được audit:

```text
2bd3e018fb0ca5cc4dcfd349207ca5c252c66606
```

Prompt gốc bắt buộc phải đọc đầy đủ trước khi sửa:

```text
docs/PROMPT_CODEX_REFACTOR_FIX_BIDDINGFLOW_TOAN_DIEN.md
```

File hiện tại là phần bổ sung bắt buộc sau một vòng audit sâu giữa prompt gốc và code hiện hành. Mọi yêu cầu trong prompt gốc vẫn còn hiệu lực. Nếu hai file khác nhau về độ chặt, áp dụng yêu cầu chặt hơn. Không được coi file này là lý do bỏ qua bất kỳ cụm công việc nào của prompt gốc.

Mục tiêu của lần thực hiện:

1. Sửa toàn bộ lỗi đã xác nhận trong prompt gốc.
2. Sửa toàn bộ lỗi bổ sung được mô tả trong file này.
3. Chốt rõ các domain contract còn mơ hồ trước khi thay đổi schema hoặc hành vi.
4. Thêm regression test ở đúng ranh giới tích hợp, không chỉ unit test từng helper.
5. Bảo toàn dữ liệu, tenant isolation, lịch sử phiên bản, offline mutation và khả năng đồng bộ đa client.
6. Chạy đầy đủ test, lint, build, migration check và PostgreSQL concurrency test phù hợp.
7. Kết thúc bằng báo cáo có bằng chứng; không chỉ trả lời rằng đã rà soát.

Đây là nhiệm vụ triển khai. Không được chỉ viết báo cáo, chỉ sửa tài liệu, chỉ thêm test bị skip, hoặc dừng sau khi tạo abstraction mà chưa chuyển các đường chạy production sang dùng abstraction đó.

---

# 1. Quy tắc làm việc bắt buộc

## 1.1. Bảo toàn worktree

Trước khi sửa:

1. Chạy `git status --short`.
2. Ghi lại HEAD hiện tại.
3. Xác định thay đổi nào đã có trước phiên làm việc.
4. Không restore, reset, checkout, xóa hoặc ghi đè thay đổi của người dùng.
5. Không khôi phục các file documentation đang bị xóa nếu người dùng không yêu cầu.
6. Chỉ sửa file cần thiết cho nhiệm vụ.

Không dùng:

```text
git reset --hard
git checkout -- <path>
git clean -fd
```

## 1.2. Đọc trước khi sửa

Phải đọc và lập bản đồ ít nhất các khu vực sau:

```text
backend/versioning
backend/sync
backend/shared/access_policy.py
backend/shared/sensitive_data.py
backend/procurement_import
backend/documents
backend/db
backend/ai
frontend/app
frontend/plans
frontend/packages
frontend/procurement
frontend/documents
frontend/admin
tests
tests/js
```

Đặc biệt phải truy vết đường chạy end-to-end, không dừng ở helper thuần:

```text
HTTP request
→ authorization
→ domain command
→ payload/graph generation
→ validation
→ transaction/persist
→ sync version
→ WebSocket event
→ delta/full pull
→ memory state
→ IndexedDB/outbox
→ render/detail route/export
```

## 1.3. Test-first cho từng lỗi xác nhận

Với mỗi finding:

1. Viết test tái hiện lỗi trên code cũ.
2. Xác nhận test fail vì đúng nguyên nhân.
3. Sửa implementation ở source-of-truth phù hợp.
4. Chạy lại test hẹp.
5. Chạy test của các module lân cận.
6. Cuối cùng chạy full regression.

Không được làm test pass bằng cách:

- sửa expected value theo hành vi sai;
- mock bỏ qua validation/authorization thật;
- chỉ test pure snapshot mà không đưa payload qua production validator/persist path;
- chỉ kiểm tra response HTTP mà không kiểm tra DB, sync cursor và cache client;
- xóa, skip, `xfail` hoặc nới lỏng test hiện có;
- thêm fallback fail-open;
- bắt exception rộng rồi tiếp tục.

## 1.4. Không tạo source-of-truth trùng lặp

Code đã có registry table-to-module tại:

```text
backend/shared/access_policy.py
```

Không tạo thêm registry khác chỉ để đáp ứng prompt. Phải củng cố registry hiện có và chuyển caller đang bypass sang dùng nó.

Tương tự, nếu đã có workspace token, visibility builder, subscription policy, sync version allocator, transactional outbox hoặc snapshot validator phù hợp thì mở rộng source-of-truth đó; không dựng lớp song song có semantics khác.

## 1.5. Mọi quyết định nghiệp vụ phải được ghi lại

Trước khi sửa các điểm có nhiều cách hợp lệ, tạo một working note hoặc ADR ngắn trong vị trí phù hợp của repo, ghi rõ:

- contract được chọn;
- bằng chứng từ code/UI/test/schema;
- compatibility impact;
- migration/backfill;
- lý do loại bỏ phương án còn lại.

Ít nhất phải chốt sáu quyết định ở phần 2.

---

# 2. Các domain contract phải chốt trước khi implementation

## 2.1. Semantics canonical của package `isLatest`

Contract mặc định cần áp dụng, trừ khi có bằng chứng domain mạnh hơn trong repo:

```text
Package isLatest được xác định trong partition:
(organization_id, package_root_id, plan_snapshot_id)
```

Lý do: mỗi phiên bản kế hoạch sở hữu một package snapshot đóng băng riêng. Package thuộc plan lịch sử có thể là package đại diện của plan đó, nhưng toàn aggregate vẫn là historical vì plan cha không còn latest.

Hệ quả bắt buộc:

- frontend không demote package cùng root ở plan khác;
- resolver global muốn tìm package hiện hành phải ưu tiên phiên bản plan cha, sau đó mới đến package version;
- write/delete không được chỉ kiểm tra `package.isLatest`; phải kiểm tra cả plan cha hiện hành;
- detail của plan lịch sử vẫn resolve đúng package snapshot của chính plan đó;
- server, frontend authoritative path, fallback offline path và tests phải cùng semantics.

Nếu chọn semantics khác, phải sửa đồng bộ DB partition, query, frontend resolver, snapshot clone, delete, timeline, contract relation và mọi test liên quan. Không được giữ hai định nghĩa `isLatest` đồng thời.

## 2.2. Atomicity của procurement import `ALL`

Contract đề xuất:

```text
Atomic theo từng source revision.
Toàn operation phải durable, ordered, idempotent và resumable.
```

Nếu revision N commit và revision N+1 fail:

- N vẫn được giữ;
- operation cursor trỏ đúng N+1;
- resume không replay hoặc duplicate N;
- provenance, sync version và WebSocket event của N phải cùng transaction với business rows của N;
- crash sau business commit nhưng trước cập nhật operation cursor phải phục hồi idempotent.

Không tuyên bố atomic toàn bộ operation nếu implementation vẫn commit từng revision.

## 2.3. Quan hệ hợp đồng–gói thầu xuyên phiên bản

Phải phân loại `hop_dong_goi_thau` rõ ràng. Contract khuyến nghị:

- row liên kết chính xác vẫn neo vào package snapshot được trao thầu để giữ bằng chứng lịch sử;
- consumer cần trạng thái logic của package hiện hành phải resolve quan hệ theo package lineage có tenant scope;
- không nhân bản mù liên kết sang mọi snapshot;
- historical export/timeline phải cho biết quan hệ exact hay lineage-derived;
- metrics “đã có kết quả nhưng chưa có hợp đồng” không được báo sai sau versioning.

Nếu domain yêu cầu clone relation thay vì lineage-aware projection, phải chứng minh bằng code/UI hiện có và thêm audit metadata để không làm sai lịch sử.

Ngoài `hop_dong_goi_thau`, phải lập registry cho mọi relation xuyên phiên bản và đánh dấu một trong ba loại:

```text
clone_and_remap
retain_exact_historical_evidence
resolve_by_lineage
```

Không để relation nào rơi vào behavior ngầm định.

## 2.4. Quyền `chudautu` và `nhathau`

UI và schema hiện công khai `none/view/edit`, vì vậy trạng thái cuối không được tiếp tục bypass matrix một cách âm thầm.

Phải chọn và triển khai nhất quán một trong hai policy:

1. Matrix thật sự điều khiển read/write của `chu_dau_tu` và `nha_thau`; hoặc
2. Đây là shared reference cố ý luôn readable/editable theo membership, khi đó phải bỏ control/cột gây hiểu nhầm và tách sensitive-data capability thành policy riêng.

Ưu tiên policy 1 nếu không có bằng chứng nghiệp vụ ngược lại. Dù chọn policy nào:

- dữ liệu ngân hàng, định danh, chữ ký, con dấu và media riêng không được tự động mở chỉ vì base reference readable;
- manager/personal owner/super-admin behavior phải rõ;
- migration cho permission row cũ phải forward-safe;
- không thể phân biệt blank legacy và explicit deny thì phải ghi rõ chiến lược backfill, chọn fail-closed cho dữ liệu nhạy cảm và báo compatibility impact.

## 2.5. Export draft và export chính thức

Phải phân loại từng action export vào đúng một loại:

```text
empty_template
local_draft_export
official_or_compliance_export
```

Contract bắt buộc:

- official/compliance export dùng committed server snapshot, server-side permission, entitlement và audit;
- local draft export phải ghi nhãn rõ “chưa đồng bộ/không phải bản chính thức”;
- khi outbox còn pending, official export phải block hoặc xuất committed snapshot gần nhất với thông báo rõ ràng;
- client-only button không phải security control;
- empty template miễn phí chỉ được phép qua allowlist server-owned có test.

Phải chốt riêng winning-goods Excel và bidder-goods Excel thuộc loại nào.

## 2.6. WebSocket delivery contract

Phải chọn rõ một contract:

### Contract A — Durable fanout

Mỗi worker/consumer có socket liên quan nhận event at-least-once, có consumer cursor/ack riêng và replay sau crash.

### Contract B — WebSocket chỉ là hint

Delta sync là source-of-truth và mọi client phải tự pull trong một SLA bounded kể cả khi WebSocket đang connected nhưng miss event.

Không được tiếp tục dùng tên hoặc observability “durable delivery” nếu chỉ có một trạng thái `delivered` toàn cục và không bảo đảm fanout đa worker.

---

# 3. Invariant toàn hệ thống sau khi sửa

## 3.1. Tenant và authorization

- Mọi read/write scope bằng organization do server xác định.
- Không dùng organization ID từ payload làm authority.
- Module permission, record scope, assignment scope và sensitive capability đều fail-closed.
- Direct API, sync, pagination, AI, document job và procurement dùng cùng effective authorization model.
- Thu hồi membership/assignment/permission phải có hiệu lực với request mới và dữ liệu cache.

## 3.2. Versioning

- Historical aggregate immutable cho cả upsert, nested child mutation và delete/archive.
- Package chỉ writable khi package snapshot current trong plan và plan cha current.
- Target graph không giữ internal source ID, trừ relation đã được registry đánh dấu rõ.
- Mọi pending target reference được validate trên union của DB state và payload target graph.
- Mapping thiếu phải fail transaction có cấu trúc.
- Server-generated inheritance không bị hiểu nhầm thành client cấp quyền mới.

## 3.3. Sync

- Mọi business write observable bởi client đều tham gia sync version protocol.
- Business rows, sync metadata và `db_changed` outbox commit cùng transaction.
- Rollback không tăng authoritative cursor và không phát event.
- Visibility grant/revoke có protocol riêng, không phụ thuộc business row vô tình thay đổi.
- Delta/full sync không fetch/serialize dữ liệu ngoài scope khi có thể push predicate xuống SQL.

## 3.4. Offline

- Không mutation đã được xác nhận durable nào bị mất âm thầm.
- Hai tab không overwrite stale full-envelope của nhau.
- ACK chỉ loại đúng generation/receipt đã gửi.
- Logout/expiry/revocation không làm mutation biến mất mà không có quyết định rõ ràng.
- Dữ liệu quarantine của user A không thể hydrate bởi user B.
- Mutation cũ không tự replay sau khi quyền bị thu hồi.

## 3.5. Procurement

- Disposition server-owned được giữ xuyên preview, session, UI, persist và provenance.
- Chỉ `MATERIALIZE` hoặc `RESYNC` theo policy mới tạo business snapshot.
- `NOOP`, `PROVENANCE_ONLY`, `ALREADY_IMPORTED` không tạo version giả.
- CAS được truyền bằng row version thật sau từng outcome.
- Workspace transition loại bỏ mọi response của epoch cũ trước khi render hoặc mutate state.

## 3.6. Export

- Permission/entitlement được kiểm tra ở mọi security boundary, không chỉ lúc enqueue.
- Quyền hiệu lực của async job không được mở rộng sau enqueue.
- Revocation trước process/retry/download phải fail-closed.
- Artifact nhạy cảm không được publish nếu policy thay đổi trong lúc render.

## 3.7. WebSocket

- Event chỉ tồn tại nếu business transaction commit.
- Không mất event vì cursor nhảy qua một event đang backoff.
- Concurrent success/failure không ghi đè trạng thái terminal sai.
- Multi-worker behavior đúng với contract đã chọn.

---

# 4. CỤM A — AGGREGATE VERSIONING VÀ SNAPSHOT GRAPH

## A1. Validator phải hiểu pending target graph

### Lỗi hiện tại

`backend/versioning/aggregate_snapshot.py` tạo bidder-goods trỏ tới package, opening, goods và lot ID mới. `backend/sync/record_validator.py` gọi `validate_bidder_goods_batch()` trước persist. `backend/sync/bidder_goods.py` chỉ load parent từ DB, nên target package chưa tồn tại và payload hợp lệ bị trả `BIDDER_GOODS_PACKAGE_INVALID`.

### Yêu cầu

1. Tạo một pending graph/reference context từ toàn payload canonical.
2. Validator phải resolve package, opening, lot, requirement và bidder-goods từ:

```text
authoritative DB rows
union
pending target rows trong cùng command
```

3. Pending row chỉ hợp lệ khi chính row đó đã qua shape, tenant, parent và status validation.
4. Không bỏ validation chỉ vì row đến từ server-generated payload.
5. Không persist parent trước rồi validate child nếu điều đó tạo partial state.
6. Mọi validation hoàn tất trước write hoặc chạy trong transaction có rollback toàn aggregate.
7. Reuse context cho package goods, bidder goods, opening uniqueness, evaluation references và ownership validation.

### Acceptance tests

1. Package version có opening, goods requirement và bidder-goods commit thành công qua endpoint production.
2. Mọi FK của target graph trỏ ID mới.
3. Delta sau commit trả đủ package, opening, goods, bidder-goods và nested children.
4. Thiếu mapping opening trả structured error và không ghi row nào.
5. Thiếu mapping goods/lot trả structured error và không ghi row nào.
6. Gói phân lô, nhiều opening và cả bidder-goods draft/official đều được test.

## A2. Authorization của assignment kế thừa

### Lỗi hiện tại

Snapshot clone toàn bộ assignment. Một chuyên viên A có quyền version source package nhưng validator sau đó coi assignment kế thừa của B là hành động A tự cấp quyền cho B và từ chối.

### Yêu cầu

1. Phân biệt provenance của mutation:

```text
client_requested_assignment
server_inherited_assignment
server_domain_generated_assignment
```

2. Server-inherited assignment không cần quyền “assign other user” của actor.
3. Vẫn phải validate:

- employee active;
- cùng organization;
- target mới thuộc aggregate đang tạo;
- source assignment thực sự tồn tại và thuộc source aggregate;
- không duplicate business key;
- actor có quyền version source aggregate.

4. Assignment invalid không được silent drop. Mặc định fail transaction bằng structured error `ASSIGNMENT_INHERITANCE_INVALID`; chỉ được auto-clean nếu có domain rule, audit và test rõ ràng.
5. Client tự gửi assignment của B ngoài server-generated command vẫn bị deny.

### Acceptance tests

- A version package đang phân công A+B; target giữ A+B.
- A tự gửi assignment B qua sync thường; bị deny.
- B inactive hoặc đã rời organization; aggregate fail có cấu trúc và không partial persist.
- Duplicate assignment không sinh.
- Manager, personal owner và inherited specialist mode đúng contract.
- Plan assignment và package assignment đều được kiểm tra.

## A3. Historical-plan parent immutability

### Lỗi hiện tại

Package `is_latest=1` trong partition của plan cũ vẫn qua guard hiện hành vì guard chỉ nhìn flag của package. Package-owned children cũng không kiểm tra plan cha.

### Yêu cầu

1. Tạo aggregate mutability resolver server-owned.
2. Với `goi_thau`, write/delete yêu cầu:

```text
package is current in its package+plan partition
AND
owning plan is current in its plan lineage
AND
neither row is archived
```

3. Với package-owned child, resolve package cha rồi áp dụng cùng rule.
4. Áp dụng cho:

- package core fields;
- nested lots;
- opening;
- package goods;
- bidder goods;
- evaluation rounds, criteria, results and reports;
- assignments;
- timeline metadata;
- package documents;
- extension/adjustment records;
- sync upsert;
- sync deletion/archive;
- direct CRUD;
- import enrichment;
- AI write path nếu sau này có, dù AI hiện phải read-only.

5. Historical detail vẫn readable theo permission nhưng không writable.
6. Error không leak record ngoài scope.

### Acceptance tests

- Package `is_latest=1` dưới plan `is_latest=0`: update package bị deny.
- Cùng package: update opening/goods/bidder-goods/nested evaluation bị deny.
- Delete/archive package lịch sử và child lịch sử bị deny.
- Package current dưới plan current vẫn update được theo permission/assignment/status.
- Manager không được bypass historical immutability.
- Personal workspace tuân cùng version invariant.

## A4. Đồng nhất `isLatest` server và frontend

### Yêu cầu

1. Giữ một helper canonical cho package partition/resolution.
2. Sửa fallback tại:

```text
frontend/plans/planAggregateSnapshot.js
frontend/packages/packagePreparation.js
frontend/shared/versionResolver.js
```

3. Plan version clone không demote source package thuộc plan cũ nếu semantics canonical là per-plan snapshot.
4. Package version trong cùng plan chỉ demote package cùng root và cùng plan.
5. Global current resolver ưu tiên version của plan cha.
6. Backend `recalculate_is_latest`, import repository, delete/restore và client fallback dùng cùng ordering.

### Acceptance tests

- Hai plan snapshots cùng package root, mỗi plan có đúng một package representative.
- Tạo plan version không làm mất representative của plan lịch sử.
- Tạo package version chỉ demote family trong plan hiện hành.
- Authoritative server path và legacy/offline fallback tạo cùng state logic.
- F5, full sync và delta không đổi selection sai.

## A5. Rebid dependency closure

### Lỗi hiện tại

Khi plan snapshot exclude package ancestor, `rebidFromPackageId` của package target có thể giữ source ID thuộc plan cũ. Schema chỉ kiểm tra tồn tại/self-reference; ownership validator không bắt buộc cùng target plan.

### Yêu cầu

1. Package selection phải đóng theo rebid dependency.
2. Chọn một behavior và ghi ADR:

- tự động include toàn bộ ancestor hợp lệ; hoặc
- reject selection bằng `AGGREGATE_REBID_DEPENDENCY_EXCLUDED`.

3. Không giữ cạnh rebid sang source plan.
4. Validator phải kiểm tra:

- target ancestor tồn tại;
- cùng organization;
- cùng target plan snapshot;
- source status hợp lệ;
- không cycle;
- không archived;
- toàn chuỗi đã remap.

### Acceptance tests

- Exclude direct ancestor.
- Exclude ancestor trong chuỗi nhiều tầng.
- Ancestor archived.
- Ancestor không ở trạng thái cancelled.
- Cycle.
- Include/exclude conflict.
- Target graph hoàn tất không còn source rebid ID.

## A6. Validate chính xác include/exclude roots

Mọi root ID do caller gửi phải resolve đúng một lineage trong source plan.

Phải reject trước persist khi:

- root không tồn tại;
- root thuộc plan khác;
- duplicate sau normalize;
- root rỗng;
- cùng root nằm cả include và exclude;
- danh sách vượt giới hạn.

Test list rỗng, only-exclude, include-all, historical package root và boundary 500 phần tử.

## A7. Registry relation xuyên phiên bản

1. Lập inventory tất cả relation package/plan/expert/document/contract/timeline/procurement provenance.
2. Gán policy rõ cho từng relation.
3. Thực hiện contract phần 2.3 cho `hop_dong_goi_thau`.
4. Sửa ít nhất các consumer hiện join exact package ID:

```text
backend/analytics/semantic_registry.py
backend/documents/timeline_context_service.py
frontend/packages/PackageTimelineView.js
```

5. Tenant và lineage root phải nằm trong query predicate.
6. Không khiến hợp đồng của package lineage A xuất hiện ở lineage B có cùng mã hiển thị.

### Acceptance tests

- Package awarded có contract, sau plan/package version vẫn không bị metric báo thiếu contract.
- Historical snapshot hiển thị exact relation đúng.
- Current snapshot có lineage-derived relation theo contract đã chọn.
- Cross-tenant và same-display-code không match nhầm.
- Delete/archive contract hoặc package cập nhật projection đúng.

## A8. Namespace deterministic ID và idempotency

### Lỗi hiện tại

UUID snapshot chỉ phụ thuộc `clientMutationId`, kind, counter và entity kind; replay key lại scope theo organization + actor + mutation ID.

### Yêu cầu

Chọn một namespace nhất quán:

```text
organization_id
actor_user_id hoặc organization-wide command authority
source aggregate ID/root
command kind
client mutation ID
entity kind
stable ordinal/business key
```

Không dựa vào counter dễ đổi thứ tự nếu có business key ổn định.

### Acceptance tests

- Hai user cùng org dùng cùng mutation ID cho hai source khác nhau không collision.
- Cùng actor replay cùng request trả cùng result.
- Cùng actor, cùng mutation ID nhưng request hash khác bị conflict.
- Khác tenant có thể dùng cùng mutation ID mà không ảnh hưởng nhau.
- Retry sau timeout không sinh graph thứ hai.

## A9. Quy mô aggregate do server sinh

### Lỗi hiện tại

Aggregate server-generated vẫn dùng giới hạn batch mặc định 2.000 dành cho client. Plan có 2.000 packages đã vượt cap trước khi tính children.

### Yêu cầu

1. Tách client payload limit khỏi server-generated aggregate limit.
2. Không bỏ mọi giới hạn; dùng transaction strategy bounded:

- set-based load;
- chunked validation/query;
- bounded memory;
- deterministic ordering;
- một transaction logic;
- rollback toàn aggregate khi chunk cuối fail.

3. Idempotency không phụ thuộc chunk boundary.
4. Đo query count, elapsed time và peak memory nếu tooling hỗ trợ.

### Acceptance tests

- 2.000 và 2.001 generated records thành công.
- Aggregate lớn hơn client `SYNC_MAX_BATCH_ITEMS` vẫn thành công qua official endpoint.
- Client tự gửi payload vượt cap vẫn bị 413.
- Lỗi validation ở chunk cuối rollback tất cả.
- Retry cùng mutation ID trả cùng graph.

## A10. Snapshot validator bắt buộc

Mở rộng validator trong prompt gốc để kiểm tra sau khi graph hoàn chỉnh được tạo và trước persist:

- unique target IDs toàn graph;
- target plan/package ownership;
- exact version/root/isLatest;
- no source internal IDs;
- all pending FK resolvable;
- rebid closure;
- assignment provenance;
- relation registry policy;
- no duplicate business key;
- no archived parent;
- row count/resource bound;
- deterministic output cho replay.

Validator fail phải rollback và trả structured error; không fallback về source ID hoặc tạo orphan.

---

# 5. CỤM B — AUTHORIZATION, VISIBILITY VÀ SYNC

## B1. Hoàn thiện permission matrix cho shared references

### Lỗi hiện tại

UI/schema lưu `chudautu` và `nhathau`, nhưng backend grant cho mọi active member và bỏ module check ở read/write. Sensitive read policy gọi cùng helper nên deny trong matrix không bảo vệ financial/signature data.

### Yêu cầu

1. Thực hiện contract phần 2.4.
2. Central registry trả module, record scope, sensitive groups và action policy.
3. Không dùng dynamic SQL identifier ngoài allowlist.
4. Read, write, pagination, sync, AI, export và media access phải parity.
5. Base `view` không tự động cấp financial/identity/signature capability.
6. Tạo migration/backfill có test từ schema hiện tại.

### Acceptance tests

- Employee `nhathau=''`: list/detail/sync/pagination/AI không trả contractor ngoài policy.
- Employee `nhathau=view`: read base data, không edit; sensitive fields theo capability riêng.
- Employee `nhathau=edit`: edit theo domain rule.
- Tương tự cho `chudautu`.
- Manager/personal/super-admin đúng contract.
- Legacy permission row migration không tạo accidental privilege escalation.
- Invalid module fail-closed và không abort PostgreSQL transaction ngoài kiểm soát.

## B2. Visibility revocation protocol

### Lỗi hiện tại

Xóa assignment hoặc hạ permission không thay đổi business row, nên delta không báo client xóa record đã cache. Full-sync manifest và deletion tombstone không giải quyết access revocation.

### Yêu cầu

Triển khai một contract rõ, ưu tiên một trong:

```text
per-user/per-scope access epoch
visibility tombstone
forced scoped full sync marker
```

Contract phải xử lý:

- assignment removed/transferred;
- module permission view/edit/none thay đổi;
- membership deactivated;
- active role/effective role thay đổi;
- sensitive capability revoked;
- subscription downgrade nếu ảnh hưởng visibility;
- lineage assignment thay đổi.

Client khi nhận revoke phải:

1. Không render stale detail.
2. Xóa hoặc quarantine full records và owned children khỏi memory/IndexedDB.
3. Xóa derived indexes/render cache/reference hydration phù hợp.
4. Không xóa pending mutation âm thầm.
5. Chuyển pending mutation sang blocked/quarantine và yêu cầu reauthorization trước replay.
6. Giữ reference tối thiểu chỉ khi server cho phép và phải đánh dấu `referenceOnly`.

### Acceptance tests

- User đang cache package, manager xóa assignment, delta tiếp theo purge package và children.
- User đang mở detail, revoke xảy ra, route đóng/redirect và không tiếp tục hiển thị dữ liệu.
- Permission `view → none` purge đúng module.
- Membership deactivate purge toàn organization scope.
- Regrant sau revoke chỉ hydrate dữ liệu từ server, không khôi phục stale full record.
- Pending outbox bị revoke không tự replay.
- Tombstone/revoke không leak ID user chưa từng có scope.

## B3. Procurement direct write phải tham gia sync protocol

### Lỗi hiện tại

Plan/notice apply trực tiếp commit repository mà không cấp authoritative sync version và không enqueue `db_changed` cùng transaction. Insert/inherited child có `sync_version=0`; update tự set `updated_at` nên PostgreSQL touch trigger không cấp version.

### Yêu cầu

1. Mọi materializing revision phải lấy sync version từ canonical allocator.
2. Tất cả insert/update/archive/delete trong revision dùng version observable phù hợp.
3. `sync_metadata.current_version` và durable WebSocket event commit cùng business transaction.
4. Không phụ thuộc trigger có điều kiện bị bypass bởi `updated_at` do caller set.
5. `NOOP`, `PROVENANCE_ONLY`, `ALREADY_IMPORTED` không phát business change giả; provenance change nếu client cần quan sát phải có table/protocol riêng.
6. Rollback không tăng committed cursor và không để outbox event.
7. Direct import và sync-bound import phải hội tụ cùng state.

### Acceptance tests

- Giữ cursor C, apply plan revision, cursor tăng và delta từ C trả plan/package/child/assignment.
- Tương tự notice/opening apply.
- Có đúng durable `db_changed` event trong transaction thành công.
- Validation/persist failure rollback rows, metadata và event.
- Demotion source rows xuất hiện trong delta.
- Retry idempotent không tăng cursor hoặc phát duplicate business event ngoài contract.
- Client B đang online nhận invalidation và hội tụ không cần full reload.

## B4. Generic sync/direct parity

Ngoài các lỗi prompt gốc, phải so sánh toàn bộ direct route với `/api/sync` cho:

- version mutability;
- assignment inheritance;
- status transitions;
- child-parent validation;
- delete/archive;
- row version;
- procurement provenance;
- sync version allocation;
- audit;
- WebSocket invalidation;
- sensitive data authorization.

Không duplicate domain validation giữa route và sync. Tạo shared command/service nơi phù hợp.

## B5. PostgreSQL aborted transaction và optional compatibility path

Giữ yêu cầu prompt gốc và bổ sung:

- mọi optional query có khả năng fail phải dùng savepoint riêng hoặc preflight schema capability;
- không bắt `DatabaseError` rồi tiếp tục cùng transaction;
- test PostgreSQL thật, không chỉ fake cursor/SQLite;
- permission compatibility và rolling migration phải fail-closed nhưng transaction còn usable nếu contract yêu cầu tiếp tục.

---

# 6. CỤM C — OFFLINE OUTBOX, LOGOUT VÀ MULTI-TAB

## C1. Multi-tab outbox không được last-writer-wins

### Lỗi hiện tại

Mỗi `WorkspaceMutationOutboxStore` có revision trong memory và `persist()` ghi toàn bộ envelope. Hai tab hydrate cùng revision rồi ghi disjoint mutations có thể làm tab sau xóa mutation tab trước ở cả localStorage và IndexedDB. Storage bridge chỉ schedule sync, không merge hoặc lock.

### Yêu cầu

1. Dùng transaction/CAS/lease/lock theo workspace.
2. Ưu tiên IndexedDB transaction làm durable source-of-truth; localStorage chỉ mirror/signal nếu phù hợp.
3. Merge theo mutation identity và generation, không replace stale full queue.
4. Có policy rõ cho cùng record:

- upsert vs upsert;
- delete vs upsert;
- replace-table vs row mutation;
- ACK vs concurrent enqueue.

5. ACK chỉ xóa mutation thuộc receipt/generation đã gửi.
6. Lock phải có timeout/owner/lease recovery khi tab chết.
7. Nếu Web Locks API không có, fallback vẫn an toàn.
8. Replica degraded/recovery không được chọn “newest” chỉ bằng clock dễ lệch rồi mất union mutation.

### Acceptance tests

- Tab A enqueue record A, tab B enqueue record B xen kẽ; tab C hydrate thấy cả A+B trong durable source và mirror.
- A và B edit cùng record: merge/conflict đúng policy, không silent loss.
- A ACK trong khi B enqueue: B còn nguyên.
- Delete/upsert race cùng ID.
- Replace-table/row race.
- Tab chết khi giữ lease.
- IndexedDB quota/blocked và localStorage failure; trạng thái degraded rồi ready không mất mutation.
- Reload ngay sau enqueue.

## C2. Logout và session termination không làm mất mutation âm thầm

### Lỗi hiện tại

Logout chỉ `await autoSync()` và bắt exception. `autoSync()` có nhiều nhánh resolve `{ok:false}`, sau đó flow vẫn logout và purge workspace/outbox.

### Yêu cầu

1. Chỉ coi final sync thành công khi `result.ok === true`.
2. Với explicit logout và còn pending mutation:

- nếu sync fail, hiển thị số mutation và lý do;
- cho hủy logout để retry;
- hoặc cho xác nhận rõ việc bỏ dữ liệu;
- không purge trước quyết định.

3. Với forced logout, idle expiry, session revoke hoặc global 401:

- ngắt truy cập ngay;
- quarantine outbox theo user/workspace;
- mã hóa/cách ly phù hợp với threat model;
- user khác không hydrate được;
- cùng user đăng nhập lại chỉ replay sau server reauthorize membership, workspace, permission và record scope.

4. Nếu membership đã bị revoke, mutation cũ phải blocked; không tự gửi khi login lại.
5. Multi-tab logout không half-purge hoặc xóa DB khi tab khác còn transaction đang commit.
6. Purge marker và retry deletion vẫn hoạt động khi IndexedDB blocked.

### Acceptance tests

- `{ok:true}`: logout/purge bình thường.
- `{ok:false}` do transport, storage degraded, validation, conflict hoặc stale: không purge âm thầm.
- `autoSync()` throw: cùng behavior an toàn.
- Idle expiry/global 401/session revoke với pending outbox: quarantine.
- User B login không thấy outbox A.
- User A login lại nhưng mất assignment: mutation không replay.
- Browser đóng giữa sync và confirmation.
- Outbox chỉ có delete vẫn được bảo vệ.

## C3. Pending outbox và authoritative pull

Giữ overlay logic hiện có nhưng bổ sung:

- visibility revoke thắng quyền render, nhưng không phá hủy mutation chưa xử lý;
- mutation bị blocked phải có trạng thái, reason và recovery action;
- full manifest không được biến pending unauthorized mutation thành visible business row;
- conflict/rejection cleanup phải atomic giữa memory, IndexedDB và outbox.

---

# 7. CỤM D — PROCUREMENT SESSION, WORKSPACE VÀ REVISION ORDER

## D1. Thay `activeWorkspaceLease` không tồn tại bằng context thật

### Lỗi hiện tại

Production model có `getWorkspaceToken()` và workspace epoch, nhưng procurement đọc/so sánh `activeWorkspaceLease`, một property không được khởi tạo trong production. Test hiện tự inject property này nên tạo false confidence.

### Yêu cầu

Tách rõ:

```text
client workspace-transition token
server import-session lease
```

1. Client token lấy từ `BiddingModel.getWorkspaceToken()` hoặc helper workspace request hiện có.
2. Server lease do server cấp hoặc được khởi tạo bằng contract rõ; không dùng client string làm authorization.
3. Mọi procurement flow capture request context và assert sau mỗi `await`, trước khi:

- render preview;
- mở confirm/modal;
- mutate DOM;
- mutate model state;
- ghi draft/resume pointer;
- start materialization;
- apply response;
- cancel/cleanup.

4. Workspace transition abort/retire:

- plan prepare/apply/resume/cancel;
- notice prepare/apply;
- opening technical/financial prepare/apply;
- inline lookup;
- investor lookup;
- revision draft load.

5. Response từ epoch A cũ vẫn bị loại sau chuỗi A → B → A.
6. Nếu server commit ở A rồi client chuyển B trước response, không mutate B; khi quay A phải reconcile idempotent từ server.

### Acceptance tests

Dùng `BiddingModel` thật, không gán property giả:

- bắt đầu mỗi flow ở A, chuyển B trước response; không hiển thị metadata A và không sửa state B;
- resume và chuyển workspace ở từng await boundary;
- A → B → A không nhận response epoch A cũ;
- logout/revoke giữa request;
- modal tái sử dụng qua workspace;
- server từ chối preview/session sai user, org hoặc server lease;
- loading/button state được cleanup khi abort.

## D2. Bảo toàn revision disposition

### Lỗi hiện tại

Preparer tính disposition đúng, session biến mọi revision thành `READY`, frontend materialize tất cả, sync binding ghi `APPLIED` cho tất cả.

### Yêu cầu

1. Manifest session giữ immutable server-owned fields:

```text
revisionId
revisionNumber
revisionDigest
disposition
status
expectedRowVersion
```

2. Frontend không được sửa hoặc nâng disposition.
3. `PROVENANCE_ONLY` và `ALREADY_IMPORTED`:

- không mở business form;
- không tạo plan/package snapshot;
- chỉ ghi evidence/cursor theo transaction;
- không bị ghi sai thành `APPLIED` nếu schema phân biệt disposition.

4. `MATERIALIZE` và `RESYNC` chạy đúng policy.
5. Resume bắt đầu tại revision chưa xử lý đầu tiên.
6. Required-field validation của materialization không được block provenance-only revision không cần business row.
7. Tamper disposition/cursor từ client bị reject.

### Acceptance tests

- `[PROVENANCE_ONLY, ALREADY_IMPORTED]`: không có local version mới.
- `[PROVENANCE_ONLY, MATERIALIZE]`: chỉ revision sau materialize.
- `[MATERIALIZE, ALREADY_IMPORTED]`: chỉ một version mới.
- Tất cả NOOP: session hoàn tất không mở form.
- Reload/resume sau NOOP.
- Replay cùng session/idempotency key.
- Digest drift thành `RESYNC`.
- Local latest cao hơn source revision không bị hồi quy.
- Lỗi giữa ghi provenance và advance cursor rollback nguyên tử.

## D3. CAS qua chuỗi `ALL`

### Lỗi hiện tại

Plan `NOOP` return trước row-version check, nhưng route hardcode expected của revision sau thành 1. Resume cũng dùng expected đã lưu sai.

### Yêu cầu

1. Mỗi outcome trả explicit `nextExpectedPlanRowVersion` hoặc current authoritative row version.
2. Chỉ materialization tạo row mới mới thay đổi expected theo row thực tế.
3. `NOOP`, `PROVENANCE_ONLY`, `ALREADY_IMPORTED` giữ/refresh expected current, không hardcode 1.
4. Operation manifest persist next expected sau commit cùng cách crash-safe.
5. Notice và plan dùng cùng abstraction CAS propagation nếu domain tương đương.

### Acceptance tests

- Current row version 5, `[ALREADY_IMPORTED, MATERIALIZE]` hoàn tất.
- Nhiều NOOP liên tiếp.
- Materialize → NOOP → materialize.
- Concurrent local edit giữa revisions trả conflict đúng revision.
- Fail giữa chuỗi rồi resume dùng expected đúng.
- Completed operation replay không tạo thêm row.

## D4. Đồng bộ và idempotency của từng revision

Thực hiện contract atomicity phần 2.2 cùng yêu cầu B3. Phải test crash tại:

- sau business commit nhưng trước operation cursor update;
- sau sync metadata update nhưng trước response;
- sau enqueue event nhưng trước commit;
- sau response timeout;
- cancel giữa revisions.

Mọi retry phải hội tụ một state, không duplicate provenance, package, plan, assignment hoặc event ngoài delivery contract.

---

# 8. CỤM E — ASYNC DOCUMENT JOB VÀ EXCEL ENTITLEMENT

## E1. Reauthorize async document job ở mọi security boundary

### Lỗi hiện tại

Context và sensitive capabilities được materialize lúc enqueue. Status/download/retry chỉ kiểm tra owner và package read; worker/retry không recheck Word subscription hoặc sensitive capabilities hiện tại.

### Yêu cầu

1. Authorization phải fail-closed tại:

```text
enqueue
claim/process
publish completion
retry
download
```

2. Quyền hiệu lực là giao của:

- permission/capability tại enqueue;
- permission/capability hiện tại;
- current membership/assignment;
- current subscription entitlement.

Grant thêm sau enqueue không được mở rộng dữ liệu trong immutable context cũ.

3. Job lưu tối thiểu:

- document type;
- organization/user/package scope;
- policy/capability fingerprint hoặc access epoch;
- sensitive groups used;
- source sync version/snapshot contract;
- creation authorization decision.

4. Revoke trong lúc render phải ngăn publish result bằng optimistic epoch/fingerprint check.
5. Completed artifact cũng bị deny và purge/quarantine theo policy nếu revoke trước download.
6. Retry mutation phải scope bằng `job_id + organization_id + user_id`, không chỉ `job_id`.
7. Artifact filesystem và DB state cần recovery khi worker crash giữa write bytes và update status.

### Acceptance tests

- Revoke từng financial/identity/signature capability trước process.
- Revoke Word subscription trước process, trước retry và sau completion nhưng trước download.
- Remove assignment/membership/deactivate user giữa create/process/download.
- Grant thêm sau enqueue không xuất thêm field.
- Revoke trong lúc render không có download window.
- User/org khác đoán job ID không status/retry/download được.
- Concurrent retry chỉ một caller thắng.
- Package archived/deleted/versioned trong lúc job pending.
- Worker crash sau ghi byte nhưng trước completed status.
- Legacy job trước migration fail-closed theo policy đã ghi.

## E2. Registry entitlement chung cho mọi export endpoint

### Lỗi hiện tại

Nhiều route Excel chỉ verify session dù schema/policy có `document_export_excel` riêng. Một số route khác lại check Word hoặc award-result entitlement, tạo behavior không nhất quán.

### Yêu cầu

Tạo registry server-owned:

```text
operation/route
→ export classification
→ format capability
→ record scope
→ sensitive groups
→ rate/resource limits
→ audit action
```

1. Route mới/unregistered fail-closed.
2. Empty template miễn phí phải nằm allowlist có lý do.
3. Package-derived export kiểm tra active workspace và current record visibility.
4. Body-only export vẫn kiểm tra format entitlement và payload limits.
5. Direct HTTP và UI dùng cùng policy.
6. Không dùng `can_use_word_export` để kiểm tra Excel nếu capability Excel riêng tồn tại.

### Route matrix test bắt buộc

Bao phủ ít nhất:

- generic import template;
- opening template;
- financial opening template;
- evaluation template;
- award result;
- package lot export;
- optional purchase export;
- timeline;
- winning goods;
- bidder goods;
- mọi route DOCX/job hiện có.

Mỗi route test:

- entitlement on/off/expired;
- organization và personal subscription;
- manager/employee/super-admin theo policy;
- assigned/unassigned record;
- cross-tenant ID;
- direct HTTP không qua UI;
- revoke trước worker/render;
- rate limit trước expensive work.

## E3. Official export không trộn pending local state

Theo contract phần 2.5:

- official winning/result export không đọc mutation chưa sync;
- snapshot N không trộn row N+1 nếu data đổi trong lúc render;
- historical package export dùng đúng toàn bộ historical graph;
- workspace switch trong lúc export không download/đặt tên file từ workspace cũ vào UI mới;
- formula injection, filename sanitation, object URL cleanup và audit redaction áp dụng cho mọi export.

---

# 9. CỤM F — WEBSOCKET TRANSACTIONAL OUTBOX VÀ MULTI-WORKER

## F1. Sửa cursor skip khi event retry/backoff

### Rủi ro hiện tại

Loader chọn `id > last_event_id` và chỉ lấy event đã đến `available_at`. Nếu event N đang backoff nhưng N+1 ready, broker có thể xử lý N+1 và tăng cursor qua N; N không còn thỏa `id > cursor`.

### Yêu cầu

1. Cursor không được nhảy qua prefix chưa hoàn tất nếu dùng strict ordering.
2. Nếu cho out-of-order, mỗi event phải có independent per-consumer ack; không dùng một scalar cursor làm mất gap.
3. Retry/dead-letter policy phải explicit và observable.
4. Poison event không chặn vô hạn toàn organization mà không có cảnh báo/repair path.

### Acceptance tests

- N fail/backoff, N+1 ready; N vẫn được replay sau backoff.
- N dead-letter theo policy; cursor chỉ advance đúng contract.
- Burst lớn hơn batch 500 không mất gap.
- DB reconnect/NOTIFY loss vẫn replay từ durable state.

## F2. Multi-worker delivery

### Rủi ro hiện tại

Mỗi ASGI worker có local socket set nhưng broker dùng một status `delivered` toàn cục. ACK của worker A có thể che event khỏi worker B; concurrent success/failure có thể ghi đè trạng thái.

### Yêu cầu nếu chọn durable fanout

1. Có stable consumer identity/lease cho từng worker generation.
2. Per-consumer cursor hoặc `(consumer_id, event_id)` ack unique.
3. Claim/ack dùng CAS hoặc row locking đúng.
4. Success của A không xóa pending của B.
5. Worker B fail/restart vẫn replay.
6. Cleanup chỉ xóa khi mọi live consumer đã ack hoặc retention contract cho phép.
7. Autoscale up/down và expired lease có recovery.
8. Revoke-user event có cùng durability/order guarantee.

### Yêu cầu nếu chọn WebSocket hint

1. Không dùng global `delivered` để tuyên bố mọi worker đã nhận.
2. Mỗi connected client vẫn pull delta định kỳ trong bounded SLA.
3. Socket reconnect luôn reconcile từ authoritative sync cursor.
4. Missed notification không giữ stale authorization/data quá SLA.

### Acceptance tests

- Hai broker worker, mỗi worker có socket cùng org; event commit tới cả hai hoặc cả hai hội tụ qua bounded polling đúng contract.
- A success, B fail rồi recover.
- Crash sau SELECT, sau local send, trước ack và sau ack.
- Concurrent success/failure không hạ terminal status.
- Transaction rollback không phát event.
- Socket reconnect/full-delta reconciliation.
- Worker scale down và lease expiry.

---

# 10. CỤM G — DATABASE, MIGRATION VÀ CONCURRENCY

## G1. Migration bắt buộc

Nếu giải pháp cần schema mới cho access epoch, job policy fingerprint hoặc WebSocket consumer ack:

- migration idempotent và forward-safe;
- test clean schema;
- test upgrade từ baseline hiện tại;
- backfill old rows fail-closed có lý do;
- không drop dữ liệu;
- không reset table production;
- index lớn có strategy tránh lock kéo dài;
- rollback strategy hoặc forward repair rõ.

## G2. Constraint/index cần rà soát

Ít nhất đánh giá:

```text
package current partition:
(organization_id, root_id, plan_id, is_latest)

visibility/access epoch:
(organization_id, user_id, epoch)

document job authorization:
(organization_id, user_id, id, status)

websocket consumer ack:
(consumer_id, event_id)

websocket ready queue:
(status, available_at, id)

procurement operation cursor:
(organization_id, operation_id, next_revision_index)
```

Không tạo index theo suy đoán; dùng query plan/benchmark.

## G3. PostgreSQL race tests

Chạy trên PostgreSQL thật với ít nhất hai connection/worker cho:

- package version concurrent;
- same mutation ID same/different actor;
- outbox claim/ACK;
- document retry/download/revoke race;
- procurement revision apply/CAS;
- visibility revoke trong lúc delta;
- migration và compatibility query failure;
- transaction rollback không phát sync/WebSocket state.

Không coi SQLite/fake cursor là đủ cho concurrency và aborted transaction semantics.

---

# 11. Error contract bắt buộc

Các lỗi mới phải structured, ổn định, không lộ record ngoài scope. Dùng naming phù hợp convention repo; tối thiểu phải phân biệt được các trường hợp tương đương:

```text
HISTORICAL_PARENT_IMMUTABLE
AGGREGATE_PENDING_REFERENCE_INVALID
ASSIGNMENT_INHERITANCE_INVALID
AGGREGATE_REBID_DEPENDENCY_EXCLUDED
AGGREGATE_SELECTION_ROOT_INVALID
AGGREGATE_RELATION_POLICY_VIOLATION
IDEMPOTENCY_NAMESPACE_CONFLICT
SYNC_VISIBILITY_RESET_REQUIRED
OUTBOX_WRITE_CONFLICT
UNSYNCED_CHANGES_BLOCK_LOGOUT
WORKSPACE_CHANGED
PROCUREMENT_REVISION_DISPOSITION_INVALID
PROCUREMENT_PREVIEW_STALE
DOCUMENT_EXPORT_PERMISSION_REVOKED
DOCUMENT_EXPORT_ENTITLEMENT_REQUIRED
WEBSOCKET_DELIVERY_GAP
```

Không bắt buộc đúng literal nếu repo đã có code canonical tốt hơn, nhưng frontend và backend phải dùng cùng contract và tests phải assert code, status, retryability.

Không trả:

- stack trace;
- SQL text;
- raw sensitive context;
- unauthorized record ID;
- outbox payload trong telemetry;
- document content trong audit/error log.

---

# 12. Observability bắt buộc

Thêm metrics/log có cardinality bounded cho:

- aggregate validation failure theo code;
- historical-parent write denial;
- generated aggregate size/query time;
- visibility epoch/reset/purge/quarantine;
- outbox CAS conflict và lock recovery;
- pending mutation blocked at logout/revoke;
- procurement outcome theo disposition;
- procurement sync version allocation;
- document job revoke at process/retry/download;
- export entitlement denial theo operation;
- WebSocket delivery lag, retry, gap, dead-letter và consumer lease;
- delta convergence latency sau direct import/revoke.

Không dùng raw user ID, record ID hoặc payload làm metric label. Audit security-sensitive phải required và transactional theo convention repo.

---

# 13. Danh sách regression test bắt buộc

Các test dưới đây là tối thiểu. Có thể tách file theo convention repo nhưng không được bỏ case.

## 13.1. Aggregate/versioning

1. Official package version có full bidder-goods graph commit thành công.
2. Pending parent missing fail và rollback.
3. Employee A version package có assignment A+B, target giữ A+B.
4. Client A tự assign B vẫn bị deny.
5. Inactive inherited assignee fail có cấu trúc.
6. Package dưới historical plan không update được dù package `is_latest=1`.
7. Historical child upsert/delete bị deny.
8. Current package/current plan update được theo permission.
9. Server/fallback `isLatest` parity.
10. Excluded rebid ancestor không tạo cross-plan edge.
11. Unknown/foreign include/exclude root fail.
12. Contract metric/timeline đúng sau plan/package version.
13. Same-org different actors cùng mutation ID không collision.
14. Same request replay deterministic.
15. Aggregate hơn 2.000 records thành công và rollback toàn bộ khi chunk cuối fail.

## 13.2. RBAC/visibility

16. `chudautu` none/view/edit qua sync, pagination, detail và AI.
17. `nhathau` none/view/edit cùng sensitive capability matrix.
18. Legacy permission migration không mở rộng privilege.
19. Remove assignment làm client purge cached aggregate.
20. Permission `view → none` purge module cache.
21. Membership revoke purge organization cache và block pending mutation.
22. Regrant hydrate fresh server state.
23. Visibility event không leak unauthorized IDs.

## 13.3. Offline/multi-tab

24. Hai tab enqueue disjoint mutations, hydrate thấy union.
25. Hai tab sửa cùng record theo conflict policy.
26. ACK đồng thời enqueue không mất mutation mới.
27. Delete/upsert và replace-table/row races.
28. Tab chết khi giữ lock/lease.
29. Một replica fail rồi recover không mất queue.
30. Logout sync success purge bình thường.
31. Logout `{ok:false}` hoặc throw không purge âm thầm.
32. Idle/global-401/revoke quarantine đúng.
33. User khác không hydrate quarantine.
34. Cùng user mất quyền không replay mutation cũ.

## 13.4. Procurement

35. Plan/notice direct apply tăng sync cursor và xuất hiện trong delta.
36. Child/assignment inherited cũng có observable sync version.
37. Rollback không tăng cursor và không enqueue event.
38. Mixed disposition không materialize provenance-only/already-imported.
39. Tampered disposition bị reject.
40. `[ALREADY_IMPORTED, MATERIALIZE]` với row version khác 1 thành công.
41. Materialize/NOOP/materialize truyền CAS đúng.
42. Crash/resume không duplicate revision đã commit.
43. Dùng BiddingModel thật, workspace switch ở từng async boundary không nhiễm state.
44. A → B → A loại response epoch A cũ.
45. Server commit A nhưng response về tại B không mutate B; quay A reconcile đúng.

## 13.5. Export/document jobs

46. Revoke sensitive capability trước process/retry/download.
47. Revoke subscription sau completion nhưng trước download.
48. Remove membership/assignment trong lúc render không publish artifact.
49. Grant thêm sau enqueue không mở rộng context.
50. Cross-user/cross-tenant job ID fail-closed.
51. Concurrent retry chỉ một caller thắng.
52. Parameterized entitlement matrix cho mọi Excel/DOCX route.
53. Official export không chứa pending local edit.
54. Historical export dùng đúng historical graph.
55. Workspace switch không download artifact vào UI mới.

## 13.6. WebSocket/PostgreSQL

56. Event N backoff, N+1 ready, N không bị mất.
57. Hai worker delivery/hội tụ đúng contract.
58. Worker fail/restart replay đúng.
59. Concurrent ACK success/failure không corrupt status.
60. Crash ở các boundary send/ack.
61. Lost NOTIFY/DB reconnect vẫn hội tụ.
62. Cleanup không xóa pending/retry chưa đủ điều kiện.
63. Business rollback không phát event.

---

# 14. Test commands và verification gates

Trước khi thay đổi, chạy các test mục tiêu hiện có để có baseline. Sau mỗi cụm, chạy lại cùng các regression test mới.

Các nhóm tối thiểu:

```powershell
python -m pytest -q tests/test_aggregate_version_snapshot.py tests/test_aggregate_version_command.py tests/test_aggregate_version_http.py tests/test_aggregate_version_repository.py

python -m pytest -q tests/test_procurement_import_routes.py tests/test_procurement_import_command.py tests/test_procurement_import_service.py tests/test_procurement_import_sync_binding.py

python -m pytest -q tests/test_sync_mutation_contract.py tests/test_record_access_projection.py tests/test_security_regressions.py tests/test_sync_delta_paging.py tests/test_websocket_transactional_outbox.py tests/test_websocket_ready_contract.py

python -m pytest -q tests/test_document_export_jobs.py tests/test_document_export_entitlements.py tests/test_workspace_asset_permissions.py

node --test tests/js/aggregate_version_client.test.mjs tests/js/plan_version_package_regression.test.mjs tests/js/sync_pending_overlay.test.mjs tests/js/sync_delta_paging.test.mjs tests/js/outbox_durability.test.mjs tests/js/workspace_mutation_lease.test.mjs tests/js/procurement_import_wizard.test.mjs
```

Sau đó phải chạy:

1. Toàn bộ Python test suite.
2. Toàn bộ JavaScript test suite.
3. PostgreSQL integration/concurrency suite.
4. Schema clean-install và upgrade chain.
5. Lint theo script hiện có của repo.
6. Production frontend build theo script hiện có của repo.
7. `git diff --check`.
8. Critical coverage/debt gates hiện có.

Nếu command trong repo khác, đọc `package.json`, CI workflow và test documentation để dùng command canonical. Không tự bịa script và không bỏ gate chỉ vì tên command khác.

Mọi skip phải liệt kê cùng lý do. Không được báo “full suite pass” nếu chỉ chạy test mục tiêu.

---

# 15. Thứ tự triển khai đề xuất

## Phase 1 — Red tests và contract

1. Pin baseline/worktree.
2. Viết ADR cho sáu policy ở phần 2.
3. Thêm red tests cho A1, A3, B2, B3, C1, C2, D1, D2, D3, E1, E2, F1 và F2.
4. Xác nhận từng test fail đúng nguyên nhân.

## Phase 2 — Source-of-truth backend

1. Aggregate pending graph validator.
2. Aggregate mutability resolver.
3. Assignment mutation provenance.
4. Relation registry và deterministic ID namespace.
5. Unified authorization/visibility context từ prompt gốc.
6. Sync version/write transaction abstraction dùng chung cho procurement.
7. Export entitlement registry.

## Phase 3 — Frontend/offline

1. Canonical package version resolver.
2. Workspace request token cho toàn procurement.
3. Disposition-aware sequential controller.
4. Multi-tab outbox transaction/CAS.
5. Logout quarantine/recovery.
6. Visibility revoke purge/block protocol.
7. Export classification/UI wording.

## Phase 4 — Async/multi-worker

1. Document policy epoch/fingerprint and reauthorization.
2. WebSocket delivery contract implementation.
3. Crash recovery and cleanup.
4. PostgreSQL migrations/indexes.

## Phase 5 — Regression/performance/security

1. Full tests.
2. PostgreSQL races.
3. Scale benchmark.
4. Security review.
5. Lint/build/schema gates.
6. Final audit against both prompt files.

Không trì hoãn lỗi P1 chỉ để hoàn thành refactor thẩm mỹ. Ưu tiên:

```text
1. Không mất dữ liệu và không sai lineage
2. Không vượt quyền hoặc giữ dữ liệu sau revoke
3. Flow production không tự fail
4. Multi-client convergence
5. Compatibility và performance
6. Cleanup kiến trúc/UI
```

---

# 16. Những điều tuyệt đối không được làm

- Không chỉ tăng batch limit lên số lớn rồi coi là xử lý scale.
- Không bypass bidder-goods validation cho server-generated payload.
- Không persist parent trước để child validator nhìn thấy rồi để partial commit.
- Không coi manager được sửa historical snapshot.
- Không demote package ở plan lịch sử theo root toàn cục nếu canonical partition là per-plan.
- Không fallback internal reference sang source ID.
- Không silent drop assignment invalid.
- Không hardcode row version `1` giữa procurement revisions.
- Không tự chuyển disposition thành `READY` hoặc `APPLIED`.
- Không dùng `activeWorkspaceLease` nếu property không có lifecycle production rõ.
- Không coi organization ID fallback là client workspace epoch.
- Không ghi full stale outbox envelope mà không CAS/lock/merge.
- Không purge pending mutation chỉ vì logout/session expiry.
- Không replay quarantined mutation trước reauthorization.
- Không chỉ gửi `db_changed` ngoài transaction sau commit.
- Không sửa `updated_at` theo cách vô hiệu hóa sync version allocator.
- Không coi WebSocket global `delivered` là fanout đa worker.
- Không để cursor nhảy qua event retry gap.
- Không chỉ check export permission lúc render button hoặc enqueue job.
- Không dùng Word entitlement cho Excel ngoài policy registry.
- Không log raw document context, sensitive fields hoặc mutation payload.
- Không thêm test chỉ kiểm tra source text nếu có thể chạy behavior thật.
- Không skip/xóa/nới test để pass.
- Không tạo migration phá dữ liệu hoặc reset bảng.
- Không sửa unrelated user changes.

---

# 17. Definition of Done

Chỉ được coi là hoàn thành khi toàn bộ điều kiện sau đúng:

## Functional

- Mọi finding trong prompt gốc được xử lý hoặc có bằng chứng xác nhận không còn áp dụng.
- Mọi finding A1–A10, B1–B5, C1–C3, D1–D4, E1–E3, F1–F2 được xử lý.
- Official aggregate version hoạt động với full graph thực tế.
- Procurement import hội tụ qua delta/WebSocket.
- Sequential import giữ disposition và CAS đúng.
- Multi-tab/offline/logout không mất mutation âm thầm.

## Security

- Không permission bypass ở shared references/export.
- Revoke membership/assignment/permission có hiệu lực với cache và job.
- Async artifact không tải được sau revoke theo contract.
- Workspace cũ không render/mutate workspace mới.
- Cross-tenant read/write/job/relation đều fail.

## Data integrity

- Historical aggregate immutable cả parent và children.
- Không orphan hoặc source internal ID ngoài registry policy.
- Contract/rebid/assignment relation đúng sau versioning.
- ID deterministic không collision với idempotency namespace.
- Rollback không để sync metadata/event nửa vời.

## Convergence

- Direct writes có authoritative sync version.
- Visibility revoke purge/quarantine client đúng.
- WebSocket nhiều worker đúng contract hoặc bounded polling bảo đảm hội tụ.
- F5, reconnect, retry và resume không duplicate hoặc mất state.

## Quality

- Tất cả regression tests mới pass.
- Full Python suite pass.
- Full JavaScript suite pass.
- PostgreSQL race/migration tests pass.
- Lint pass.
- Production build pass.
- `git diff --check` pass.
- Không có test bị skip/xóa chỉ để đạt xanh.

## Performance

- Aggregate lớn hơn 2.000 records có strategy bounded đã đo.
- Sync read không fetch cả tenant rồi filter nếu predicate có thể push SQL.
- Không giant `IN` không chunk.
- WebSocket/job cleanup query có index phù hợp.
- Không tạo N+1 nghiêm trọng trong relation lineage hoặc visibility resolver.

---

# 18. Báo cáo cuối cùng Codex phải trả về

Báo cáo cuối phải có đúng các phần sau:

## A. Baseline và worktree

- HEAD trước/sau;
- thay đổi có sẵn được bảo toàn;
- prompt/ADR đã đọc.

## B. Contract decisions

Nêu quyết định cuối cho:

- package `isLatest`;
- import `ALL` atomicity;
- contract-package relation;
- shared-reference permissions;
- export classification;
- WebSocket delivery.

## C. Findings và root cause

Với từng finding:

- root cause;
- files/lines chính;
- fix;
- regression test;
- compatibility impact.

## D. Authorization và visibility model

- module permission;
- assignment scope;
- sensitive capability;
- visibility revoke/access epoch;
- cache/outbox behavior.

## E. Versioning model

- graph construction;
- pending validation;
- immutability;
- ID mapping;
- relation registry;
- idempotency namespace;
- scale strategy.

## F. Procurement/sync model

- disposition flow;
- CAS propagation;
- transaction boundary;
- sync version;
- WebSocket event;
- resume/crash behavior.

## G. Offline/frontend model

- multi-tab serialization;
- ACK generations;
- logout/quarantine;
- workspace epoch;
- stale cache purge.

## H. Export/WebSocket model

- job reauthorization;
- entitlement registry;
- artifact revocation;
- multi-worker delivery/polling contract.

## I. Database/migrations

- schema changes;
- backfill;
- indexes;
- PostgreSQL concurrency evidence;
- rollback/forward-repair strategy.

## J. Tests và verification

Liệt kê exact command và exact result:

- targeted tests;
- full Python;
- full JavaScript;
- PostgreSQL;
- migrations;
- lint;
- build;
- diff check;
- benchmark.

Không được dùng từ “all pass” nếu không có command/result tương ứng.

## K. Remaining risks

Chỉ liệt kê rủi ro thật còn lại. Mỗi rủi ro phải có:

- phạm vi;
- lý do chưa xử lý;
- mitigation hiện tại;
- owner/next action.

Nếu còn P1/P2 chưa xử lý mà không bị blocker bên ngoài, tiếp tục làm thay vì kết thúc.

---

# 19. Checklist tự kiểm tra cuối cùng

Trước khi trả lời, tự xác nhận từng mục:

```text
[ ] Đã đọc đầy đủ prompt gốc và prompt bổ sung này.
[ ] Đã bảo toàn user changes có sẵn.
[ ] Pending target graph được validate cùng DB state.
[ ] Full bidder-goods aggregate đi qua production endpoint thành công.
[ ] Assignment kế thừa không bị coi là client grant.
[ ] Historical plan chặn package/child upsert và delete.
[ ] Server/frontend dùng cùng package isLatest semantics.
[ ] Rebid graph không có cross-plan source reference.
[ ] Include/exclude root lạ fail có cấu trúc.
[ ] Contract-package consumers đúng sau versioning.
[ ] Deterministic ID namespace khớp idempotency scope.
[ ] Aggregate server-generated không bị client cap 2.000 làm hỏng.
[ ] chudautu/nhathau permission không còn control chết hoặc bypass ngầm.
[ ] Sensitive data không được mở chỉ nhờ shared-reference access.
[ ] Assignment/permission revoke purge hoặc quarantine stale cache.
[ ] Procurement direct apply tăng sync cursor và phát event cùng transaction.
[ ] Multi-tab outbox không last-writer-wins.
[ ] ACK không xóa concurrent mutation.
[ ] Logout/expiry không làm mất mutation âm thầm.
[ ] Mutation quarantine không replay sau revoke.
[ ] Procurement dùng workspace token/lease có lifecycle thật.
[ ] Response epoch cũ không render/mutate workspace mới.
[ ] Disposition được giữ xuyên toàn flow.
[ ] NOOP không hardcode next row version là 1.
[ ] Import ALL resume/crash không duplicate.
[ ] Async document job reauthorize process/retry/download.
[ ] Excel/DOCX routes dùng entitlement registry hoặc explicit free allowlist.
[ ] Official export không trộn pending local state.
[ ] WebSocket không skip retry gap.
[ ] Multi-worker behavior đúng contract đã ghi.
[ ] PostgreSQL migrations/races đã được test thật.
[ ] Full Python suite đã chạy và pass.
[ ] Full JavaScript suite đã chạy và pass.
[ ] Lint/build/schema/diff gates đã pass.
[ ] Không test nào bị skip/xóa/nới để che lỗi.
[ ] Báo cáo cuối có exact commands và results.
```

Nếu một mục quan trọng chưa đạt và không có blocker bên ngoài thực sự, tiếp tục sửa trong cùng phiên làm việc.
