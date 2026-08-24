# Phiếu quyết định sản phẩm để tiếp tục 9 tính năng

**Trạng thái:** đã được chủ sản phẩm duyệt toàn bộ phương án khuyến nghị ngày 2026-08-24.  
**Business contracts:** ADR 0008–0013; các bảng dưới đây là nguồn quyết định đã được chấp nhận.  
**Cách trả lời nhanh:** trả lời `Duyệt toàn bộ phương án khuyến nghị` hoặc ghi
`Sửa <mã>: <giá trị mới>` cho từng dòng muốn thay đổi.

Các khuyến nghị dưới đây giữ nguyên tenant/module/assignment/record authorization,
không tạo capability đọc dữ liệu nhạy cảm và không dùng Word entitlement để che
dữ liệu trên màn hình/API đọc bản ghi.

## A. DG-07 — Trung tâm xử lý xung đột

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 07.1 | Nơi lưu và qua F5 | Lưu server theo exact tenant/workspace/actor; giữ qua F5 nhưng **không tự replay**; chỉ actor đã tạo được mở draft và mỗi lần mở phải authorize lại record. |
| 07.2 | Retention/logout/revocation | 30 ngày, tối đa 20 draft/actor/workspace; logout/forced logout không xóa; hết hạn hoặc user xóa thì purge payload; bị thu hồi quyền thì không được đọc/resolve, không trả server data. |
| 07.3 | Allowlist merge v1 | Chỉ `kehoach` và `goithau`; freeze registry v1 gồm scalar business fields mà canonical validator hiện cho sửa. Loại identity/tenant/version/permission/assignment/lifecycle/status, object/list/delete. Field tài chính/định danh vẫn hiển thị đầy đủ khi đã authorize nhưng không auto-chọn; người dùng phải chọn từng field. |
| 07.4 | Merge semantics | Base/server/local; thay đổi một phía được phân loại nhưng vẫn preview; cả hai phía khác nhau phải chọn. `null` khác missing. Nested/list/delete/duplicate identity là unsupported. Không có “force overwrite toàn record”. |
| 07.5 | Resolution authority | Server-issued signed preview token, TTL 15 phút, pin actor/workspace/record/base/server rowVersion/policy version; fresh auth + CAS; race lần hai vẫn 409 mới. |
| 07.6 | Audit | Audit metadata, decision path và digests; không lặp full field values trong audit. Snapshot payload được mã hóa và chịu retention 07.2. |

## B. DG-08 — Phiên bản pháp lý

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 08.1 | Ngày neo | Kế hoạch: ngày phê duyệt kế hoạch. Gói thầu: ngày phát hành/đăng tải E-HSMT. Thiếu exact anchor thì `UNRESOLVED`, không dùng ngày hiện tại. |
| 08.2 | Chuyển tiếp/chồng lấn | Dùng `ApplicabilityPolicyVersion` do legal owner duyệt. Thiếu fact, overlap hoặc điều khoản chuyển tiếp chưa phân giải thì `AMBIGUOUS`/`MANUAL_REVIEW_REQUIRED`; không fallback “latest”. |
| 08.3 | Catalog và quyền | Phase 1 chỉ catalog `SYSTEM`, super-admin quản trị bằng action hiện hữu tương ứng; không organization override. Phase sau muốn override phải có ADR riêng. |
| 08.4 | Binding/version/legacy | Binding pin exact immutable profile version. Version business mới resolve lại theo facts/anchor của chính nó, không clone binding. Legacy không auto-backfill luật hiện tại; đưa vào review queue. Offline giữ `UNRESOLVED`. |

## C. DG-12 — AI tuân thủ

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 12.1 | Deterministic bundle v1 | Pilot chỉ kiểm tra **deadline/timeline readiness** từ `timeline_rules.json` + exact legal binding. Đây là finding quy trình, không tự gọi là “vi phạm pháp luật”. |
| 12.2 | Trạng thái finding | `PASS`, `FAIL`, `NEEDS_REVIEW`, `NOT_EVALUATED`; chỉ deterministic engine tạo trạng thái, AI chỉ giải thích và trích nguồn. |
| 12.3 | Quyền/hành động | Reuse assistant hiện hữu; fresh canonical record auth mỗi tool call; không write/approve/publish/sign/change-state tool; authorized snapshot trả đủ business fields. |
| 12.4 | Owner nghiệm thu | Chủ sản phẩm duyệt fixtures bundle v1; legal reviewer duyệt legal citations trước production flag. Nếu chưa chỉ định legal reviewer, feature giữ `NOT_EVALUATED` cho legal conclusion. |

## D. DG-15 — WordTemplateCatalog

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 15.1 | Lifecycle | `DRAFT → PUBLISHED → RETIRED`; mỗi logical template có tối đa một published version hiện hành trong một scope; published bytes bất biến. Restore luôn tạo draft version mới rồi preflight/publish, không di chuyển pointer âm thầm. |
| 15.2 | Action authority | Reuse exact authorization của template CRUD/publication-assignment hiện hữu; không thêm role/capability. Render/tải Word từ SAMPLE hoặc RECORD vẫn yêu cầu Word entitlement hiện hữu; preflight không tạo artifact dùng template-management authority. |
| 15.3 | Retention | Published versions/provenance giữ vô thời hạn; retired giữ vô thời hạn; abandoned drafts 90 ngày; preflight run 30 ngày; temporary preview artifact 24 giờ. Sample fixture do product duyệt và không chứa dữ liệu người thật. |
| 15.4 | Assignment | `FOLLOW_PUBLISHED` theo logical template để tương thích filename hiện hữu; lúc render luôn pin exact resolved version/checksum vào artifact provenance. Rename chỉ đổi display/alias, không đổi identity hoặc orphan assignment. |
| 15.5 | Usage authority | Authoritative usage gồm explicit publication assignment và generated artifact provenance; preview/preflight không tính là publication usage. |

## E. DG-19 — Lịch công việc

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 19.1 | Event sources | Export mọi applicable row có ngày từ `effective_timeline`; case deadline bổ sung sau mục 20/21. Không tự export raw field ngoài catalog. |
| 19.2 | Text projection | `SUMMARY = mã gói — nhãn mốc`; description gồm tên kế hoạch/gói và link nội bộ; `LOCATION` bỏ trống. Không đưa CCCD, tài khoản, ngân hàng, chữ ký/con dấu vào `.ics`; đây chỉ là outbound calendar contract, không đổi quyền đọc record. |
| 19.3 | Time | Timed event serialize UTC; date-only là all-day với exclusive `DTEND`; UI vẫn hiển thị Asia/Ho_Chi_Minh. Floating/local datetime bị từ chối. |
| 19.4 | Identity/revision | UID = lineage root + milestone key + instance key + namespace BiddingFlow. Event-head pin semantic digest; significant date/title/cancellation change tăng `SEQUENCE`; `DTSTAMP` lấy server event-revision time, không lấy download time. |
| 19.5 | Snapshot/cancel/auth/limits | `.ics` tải theo một record hoặc explicit authorized selection; có một denied item thì fail toàn bộ không lộ item. Snapshot không có `METHOD`; event bị bỏ khỏi snapshot chỉ biến mất. Tối đa 500 events/1 MiB, private no-store. |
| 19.6 | Connector 19B | Opt-in từng user, one-way BiddingFlow → selected Google/Microsoft calendar; minimal OAuth scope; revoke dừng enqueue/send mới nhưng mặc định không xóa remote event đã tạo. Remote edit không ghi ngược business record. |

## F. DG-20 — ProcurementCase/CLARIFICATION

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 20.1 | Ownership qua version | Case thuộc package lineage; header giữ exact current package version và mỗi response/transition pin exact version đã dùng. Package version mới share case, không clone history. |
| 20.2 | Legacy migration | Chỉ pair request/response khi có stable deterministic evidence; trường hợp còn lại import thành observations riêng và yêu cầu manual preview/link, không ghép theo index/time/content. |
| 20.3 | Permission | Case kế thừa canonical read/write scope của parent package; responsibility chỉ metadata, không cấp access; external party không có workspace access phase 1. Authorized case reader xem đầy đủ case data. |
| 20.4 | Direction/state | Một case type `CLARIFICATION` có `INBOUND/OUTBOUND`. State: `DRAFT → UNDER_REVIEW → APPROVED → ISSUED → CLOSED`; `RETURNED` quay về `DRAFT`; cho `WITHDRAWN`; reopen từ `CLOSED` tạo transition audited. |
| 20.5 | Revisions/SLA | Edit sau approve tạo response revision mới và làm approval stale, quay `DRAFT`. Due date chỉ manual hoặc derive từ exact approved policy/legal binding; thiếu thì `NOT_EVALUATED`. Issue pin exact approved revision. |

## G. DG-21 — PETITION

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 21.1 | Taxonomy v1 | `E_HSMT`, `CONTRACTOR_SELECTION_RESULT`, `OTHER`; `OTHER` bắt buộc mô tả. Taxonomy versioned để mở rộng sau. |
| 21.2 | State | `RECEIVED → ASSIGNED → UNDER_REVIEW → DRAFT_RESPONSE → APPROVED → ISSUED → CLOSED`; hỗ trợ `RETURNED`, `WITHDRAWN`, `REJECTED`, reopen audited. |
| 21.3 | Legal basis/SLA | Exact LegalBinding/profile sources bắt buộc cho legal conclusion; free text chỉ là note bổ sung. Thiếu binding/SLA thì `NOT_EVALUATED`, không chặn lưu draft. |
| 21.4 | Source reconciliation | Mua Sắm Công revision chỉ tạo immutable `SourceObservation`; preview rõ rồi user mới link/create official case. External update không overwrite local response/state. |
| 21.5 | Permission/party | Dùng permission inheritance tại 20.3; không module/capability riêng phase 1; party ngoài không đăng nhập/xem case. |

## H. DG-30 — BulkOperation pilot

| Mã | Cần quyết định | Phương án khuyến nghị |
|---|---|---|
| 30.1 | Pilot | `EXPORT_RECORD_DATA` cho `kehoach` và `goithau`, reuse canonical record-read authorization; không tạo quyền đọc/export Word mới và không mutation business record. |
| 30.2 | Selection/limit | Chỉ `EXPLICIT_IDS`, tối đa 100 records; không “select all by filter” trong v1. |
| 30.3 | Execution/side effect | `STAGED_FINALIZE`, tạo temporary ZIP chứa JSON UTF-8 của full authorized business projection; filesystem artifact 24 giờ; không external provider. |
| 30.4 | Preview/auth | Opaque preview TTL 10 phút, bind tenant/actor/action/selection/schema version; preview lại và fresh authorize từng record khi confirm. Một denied/stale item làm toàn operation fail, không lộ metadata item. |
| 30.5 | Retry/cancel/idempotency | Idempotency không tạo hai artifact/audit; retry chỉ job chưa committed; cancel chỉ queued/unstarted; drift trả stale preview. |
| 30.6 | Audit/result | Audit operation + digest/danh sách exact authorized record IDs; result ghi included count, artifact checksum/expiry. UI preview hiển thị code/title và reason cho records đã authorize. |

## I. Thứ tự thực thi sau khi duyệt

1. Ghi accepted ADR/business contracts và cập nhật glossary cho các term đã chốt.
2. Mục 7 và 15.
3. Mục 8 rồi bundle mục 12.
4. Shared case mục 20, sau đó policy mục 21.
5. Mục 19A rồi 19B.
6. Mục 30 pilot; các bulk adapter khác là increment riêng.

Mỗi increment vẫn cần compatibility impact, migration/rollback, feature flag và
regression tại tenant/module/assignment/record authorization seams trước cutover.

## Mẫu trả lời

```text
Duyệt toàn bộ phương án khuyến nghị.

Sửa 07.2: ...
Sửa 08.3: ...
Sửa 12.4: legal reviewer là ...
Sửa 19.6: ...
Sửa 30.1: ...
```
