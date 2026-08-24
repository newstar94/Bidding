# Trạng thái thực thi 9 tính năng sau completion audit

Ngày audit: 2026-08-24  
Nguồn yêu cầu: `docs/05_KE_HOACH_VA_PROMPT_9_TINH_NANG_2026-08-23.md`  
Nguồn evidence: `docs/research/2026-08-23-evidence-ledger-tinh-nang-06-07-08-12-15-19-20-21-30.md`

Tài liệu này phân biệt phần đã nghiệm thu với phần đang triển khai. Chủ sản phẩm
đã duyệt toàn bộ phương án khuyến nghị ngày 2026-08-24; ADR 0008–0013 là các
business contract mở cổng triển khai production theo feature flag và regression seams.

| Mục | Bằng chứng đã đạt | Phần chưa đạt | Gate/authority còn thiếu |
|---|---|---|---|
| 6 | Authorized read-only comparison: authorize độc lập hai version, full authorized values, scalar/relation diff, ambiguity values, stable bound cursor, 5.000-row aggregate budget, timeline/assignment/exact generated-document/legal impact, strict API, UI selector/filter/pagination/accessibility, feature flag | Các nhóm progress/workflow/evaluation/contract/notification/compliance chưa có authoritative provider vẫn trả explicit `NOT_EVALUATED` đúng contract, không bị bỏ khỏi response | Không còn decision gate; thêm provider tương lai chỉ khi có provenance authoritative |
| 7 | Durable conflict draft, encrypted/base-snapshot authority, server resolution command, outbox recovery, Conflict Center UI và regression seams theo ADR 0008 | Full cross-module soak/operational rollout | Không còn decision gate; rollout qua feature flag |
| 8 | ADR 0009; immutable SYSTEM instrument/profile/policy catalog; typed append-only plan/package binding + independent CAS head; deterministic no-latest resolver; exact hash-verified sources; Super Admin lifecycle UI; authorized target UI; legal comparison provider; read-only reconciliation CLI/runbook; schema v70/API/accessibility/mobile/regression tests | Full-suite soak và production shadow review trên tập target được duyệt | Không còn decision gate; rollout bằng `LEGAL_VERSIONING_ENABLED`, không auto-bind legacy |
| 12 | ADR 0009; deterministic bundle v1 over exact hashed timeline catalog; ComplianceContext deep module; fresh-authorized exact version/binding/source/document snapshot; strict target-bound read-only tool; no-web exact target; untrusted prompt policy; target/version chip + rule/evidence/not-evaluated UI; startup dependency gate; backend/integration/JS fixtures | Full-suite soak và legal reviewer approval cho citation fixtures trước production flag | Không còn product decision gate; legal conclusion cố định `NOT_EVALUATED` cho tới reviewer approval |
| 15 | Immutable content-addressed catalog; draft/publish/restore CAS; SAMPLE/authorized RECORD preview; timeline UI; ordered assignment v2 + durable legacy projection; direct/durable-job exact provenance; retention; inventory CLI/runbook; migration v65–v69 và ADR 0010 | Full-suite soak và safe orphan-byte GC sau DB retention | Không còn decision gate; shadow parity trước cutover |
| 19 | 19A + 19B hoàn tất: canonical timeline/case projection, persisted significant event head/revision, stable opaque UID/SEQUENCE/DTSTAMP, preview và explicit `.ics`; opt-in one-way Google/Microsoft connectors; exact scope, state/PKCE, encrypted token, refresh/revoke, provider ID/transactionId, ETag recovery, durable retry, fresh auth trước enqueue/send/retry, provider kill switch và integration UI | Production provider sandbox/canary cần credential do operator cấp | Không còn decision gate; connector mặc định off và chỉ rollout từng provider theo runbook |
| 20 | Shared ProcurementCase schema/service/API/UI; lineage ownership, parent auth, CLARIFICATION state machine, immutable response/transition, party/responsibility/legal basis/attachment/deadline/source observation, legacy read-only inventory | Production shadow parity trên dữ liệu thật | Không còn decision gate; rollout qua `PROCUREMENT_CASE_ENABLED` |
| 21 | PETITION policy trên cùng core/UI, taxonomy/state/reject/withdraw/reopen, exact legal basis và immutable external observation | Source fixture Mua Sắm Công thật vẫn cần trước adapter tự động | Không còn gate cho manual case flow; không auto-import khi chưa có fixture |
| 30 | Registry production chỉ có `EXPORT_RECORD_DATA`; explicit 100 IDs, 10-minute preview, fresh auth/rowVersion drift, staged ZIP full authorized data, 24-hour download/cleanup, audit và UI | Worker async không cần cho pilot bounded v1; action khác cố ý unsupported | Không còn gate cho pilot; rollout qua `BULK_EXPORT_ENABLED` |

## Verification authoritative

- `npm run check:quality`: pass sau review fixes.
- Backend: 1.789 tests pass; branch coverage tổng 61,17%; critical backend
  coverage ratchet pass.
- Full JS coverage suite và critical JS coverage ratchet pass.
- Static/schema/security/Trusted Types/module graph/dead-code/mojibake/diff checks pass.
- PostgreSQL schema v75 contract pass: 125 tables, 577 indexes, 100 triggers;
  FK-index audit 188/188 pass. Development và test database đã migrate v75.
- `npm run build:secure`: pass; 313 modules transformed, secure-artifact và
  route-CSS verification pass.
- Targeted audit 9 increments: 118 pass; PostgreSQL conflict authorization bổ
  sung 4 pass với `TEST_DATABASE_URL` được nạp riêng, không in credential.
- Dual review Standards/Spec findings đã được sửa và regression hóa: relation
  identity/ambiguity, full values, aggregate query bound, cursor binding,
  type-aware normalization, provider timeout, VersionSelector/filter/pagination,
  stale cancellation, RFC parser và negative vectors.

## Trạng thái gate

Chủ sản phẩm đã duyệt toàn bộ phương án khuyến nghị ngày 2026-08-24. Không còn
decision gate; các mục tiếp tục được triển khai theo ADR 0008–0013 và feature
flag/cutover runbook tương ứng. Business contract quyền/hiển thị trong
`AGENTS.md` vẫn là bất biến bắt buộc.

## Điều kiện tiếp tục

Chín increment đã có production seams sau feature flag. Trước cutover tiếp tục
shadow/canary theo từng runbook, legal reviewer approval cho citation fixtures và
provider credential/callback setup và canary theo runbook cho connector lịch 19B. Không
mở thêm bulk action ngoài registry v1 nếu chưa có contract riêng.
