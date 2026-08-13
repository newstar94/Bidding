# Báo cáo hoàn tất refactor và audit BiddingFlow — 2026-08-14

## 1. Baseline và business contract

- Baseline: `508ec6fdb542508cb0552f6a4ea7c9c409b7b1a0`, nhánh `main`.
- Worktree có thay đổi dở từ phiên audit trước và được giữ nguyên; không dùng reset/restore/clean.
- Prompt triển khai:
  - `docs/PROMPT_CODEX_REFACTOR_FIX_BIDDINGFLOW_TOAN_DIEN.md`;
  - `docs/PROMPT_CODEX_FIX_HOAN_THIEN_TOAN_BO_CAC_VAN_DE_AUDIT_BIDDINGFLOW.md`;
  - `docs/PROMPT_CODEX_FIX_TRIET_DE_CAC_VAN_DE_AUDIT_VONG_2_BIDDINGFLOW.md`.
- Contract ưu tiên cao nhất nằm trong `AGENTS.md`, `CONTEXT.md` và ADR 0010: người đã có quyền đọc bản ghi được đọc đầy đủ dữ liệu, gồm CCCD, tài khoản ngân hàng, chữ ký và con dấu. Quyền xuất Word/Excel chỉ kiểm soát hành động xuất, không kiểm soát field visibility.

## 2. Requirement traceability

| Requirement | Trạng thái | Production evidence | Regression evidence |
|---|---|---|---|
| Prompt gốc — unified authorization/RBAC | Hoàn tất | `backend/shared/access_policy.py`, canonical module registry, record authorization tại HTTP/sync/import/AI/export | `test_record_access_projection.py`, security/authorization suites |
| Prompt gốc — assignment/offboarding | Hoàn tất | assignment domain policy và successor semantics dùng chung | assignment, sync mutation và N+1 suites |
| Prompt gốc — versioning/snapshot | Hoàn tất | server-generated graph, deterministic ID, full validator, historical mutability guard | aggregate command/snapshot/relation tests |
| Prompt gốc — sync/PostgreSQL | Hoàn tất | SQL visibility, cursor/tombstone protocol, qmark scanner, transaction rollback | full PostgreSQL, sync paging/conflict/race suites |
| Prompt gốc — AI/frontend/procurement/security | Hoàn tất | AI read-only authorization, workspace token, request cancellation, procurement source authority | AI, workspace, procurement và E2E suites |
| Audit vòng 1 A1–A10 — aggregate integrity/scale | Hoàn tất | clone/remap fail-closed; repository query chunks 500; aggregate lane bỏ per-row savepoint | aggregate repository/performance/migration tests |
| Audit vòng 1 B1–B5 — visibility/convergence | Hoàn tất | visibility token v3, SQL scope, transactional cursor + hint | projection, sync delta, WebSocket tests |
| Audit vòng 1 C1 — multi-tab outbox | Hoàn tất | IndexedDB atomic read-modify-write; merge delta theo snapshot tab | disjoint tabs, ACK/enqueue, delete/upsert tests |
| Audit vòng 1 C2–C3 — logout/quarantine/overlay | Hoàn tất | explicit logout chỉ purge sau `{ok:true}` hoặc discard rõ; forced termination giữ workspace-scoped outbox | `logout_mutation_safety.test.mjs`, pending overlay suites |
| Audit vòng 1 D1–D4 — procurement workspace/revision/CAS | Hoàn tất | bỏ property giả `activeWorkspaceLease`; dùng `getWorkspaceToken()` và assert sau await | 72 targeted procurement tests và full JS |
| Audit vòng 1 E1 — async document authorization | Hoàn tất | policy hash bắt buộc; reauthorize pre/post render, retry và download | revoke before/during/after render, concurrent retry, internal job tests |
| Audit vòng 1 E2–E3 — export registry/official source | Hoàn tất | registry fail-closed; official export từ server snapshot; draft template được gắn nhãn | export policy, award, timeline, Excel worker suites |
| Audit vòng 1 F1–F2 — WebSocket | Hoàn tất theo ADR 0006 | local hint là `dispatched`, không claim global delivery; bounded polling luôn chạy | transactional outbox, polling fallback, multi-browser smoke |
| Audit vòng 1 G — migration/concurrency/error/observability | Hoàn tất | migration v59, catalog contract v59, typed public errors | v1→v59 replay, clean install, races, static gates |
| Vòng 2 H1 — canonical module registry | Hoàn tất | canonical module/action mapping | registry and authorization coverage |
| Vòng 2 H2 — sensitive read | Hoàn tất theo contract chủ sản phẩm | `serialize_sensitive_read_item()` bảo toàn record; capability đọc riêng không còn runtime caller | 12 projection tests, structural regression |
| Vòng 2 H3–H5 — assignment/epoch/SQL visibility | Hoàn tất | optional assignment parity, token v3, scope pushed into query | sync authorization/delta/projection suites |
| Vòng 2 H6–H8 — graph/mutability/direct-write convergence | Hoàn tất | full graph validator, writer guard, transactional outbox | aggregate, direct writer, rollback suites |
| Vòng 2 H9 — official export | Hoàn tất | server-owned export registry; draft client rows không mang nhãn official | 50 targeted export tests |
| Vòng 2 H10 — bounded WebSocket hint | Hoàn tất | `dispatched_at`; 30-second delta reconciliation | WebSocket Python/JS and E2E tests |
| Vòng 2 H11–H12 — public errors/active role | Hoàn tất | sanitized errors và active-role authorization context | security, AI, role-switch suites |
| Vòng 2 H13 — aggregate scale | Hoàn tất | O(n) relation index, 500-ID chunks, no aggregate per-row savepoint | 2.001 threshold + 2k/10k/25k benchmark |
| Vòng 2 H14 — effective relation lineage | Hoàn tất | deterministic precedence in relation policy | relation registry and lineage tests |

## 3. Authorization parity matrix

| Action/resource | HTTP | Sync | Import | AI | Export/async | Frontend projection | Canonical policy |
|---|---|---|---|---|---|---|---|
| Đọc package/plan/contract | session + tenant + module + record scope | cùng record scope trước projection | session/import-session + target record | read-only context cùng scope | scope trước generate/download | visibility token + manifest | `access_policy.py` |
| CCCD/tài khoản/chữ ký/con dấu của record được phép đọc | trả đầy đủ | trả đầy đủ | giữ đầy đủ trong authorized graph | chỉ đọc trong authorized context | capability xuất chỉ kiểm soát action | không mask/redact | ADR 0010 + `sensitive_data.py` |
| Assignment mutation | route domain service | cùng validator/policy | procurement materialization dùng cùng graph rule | không có mutation tool | không thay assignment | outbox giữ mutation bị block | assignment policy/domain service |
| Historical aggregate | writer guard | validator + server command | source revision authority | read-only | snapshot revision cố định | selector canonical | versioning policy/registry |
| Organization/admin access | current session + active role | current transaction role | server session | authorization context | policy reauth | session refresh + visibility reset | auth/access policy |

## 4. Writer → projection/convergence matrix

| Resource | Writer/seam | Transaction owner | Cursor/revision | Projection/outbox | Client fetch | Idempotency |
|---|---|---|---|---|---|---|
| Generic domain records | sync HTTP | sync transaction | one `next_sync_version` | mutation tracker + transactional hint | full/delta/manifest | client mutation ID + request hash |
| Aggregate version | official version endpoint | serializable sync transaction | one cursor for full graph | same sync response/outbox | delta + version family | deterministic UUID + mutation ID |
| Procurement plan/notice/opening | import session/apply | import transaction | source revision + sync cursor | provenance + hint in transaction | delta/import resume | session/revision/idempotency key |
| Lot lifecycle | lifecycle routes | route transaction | domain row version | transactional WebSocket hint | delta + detail refresh | CAS/current state |
| Package documents | document routes | route transaction | sync version allocated in transaction | document event + hint | package detail/doc list | document identity + row state |
| Organization/member/access | org/auth/admin routes | route transaction | access/visibility revision | revoke/broadcast hint | session refresh + full reset if token changes | conditional update/current membership |
| Partner enrichment | partner lookup service | service transaction | row version | transactional hint | delta/record lookup | normalized identity/job key |
| Restore/delete | restore/sync transaction | transaction owner | one committed cursor | tombstone + hint | delta/tombstone | mutation/restore identity |

## 5. Export action matrix

| Export type | Draft/official | Server source | Record permission | Sensitive data contract | Format entitlement | Reauth | Audit |
|---|---|---|---|---|---|---|---|
| Generic/opening empty template | Template | schema/allowlist | authenticated session | không chứa record data | allowlisted free template | tại request | registry action |
| Package lot/optional purchase rows | Draft template | bounded client form rows | authenticated session | không gọi là official | allowlisted draft template | tại request | registry action; tên file có `ban_nhap` |
| Timeline/evaluation/financial opening/award result | Official XLSX | persisted package snapshot | tenant + package read | full authorized fields nếu tài liệu cần | `document.export.excel`/award-result Excel | request; async nếu dùng job | required export audit |
| Winning/bidder goods | Official XLSX | authoritative package/opening/goods graph | package scope | server selects fields | award-result Excel policy | request | required export audit |
| Package/report Word | Official DOCX | persisted revision + server context | package scope | đầy đủ field theo ADR 0010 | `document.export.word` | pre-render, post-render, retry, download | create/download audit |
| PDF | Không có endpoint production đăng ký | registry từ chối operation không đăng ký | không mở route | không thay field visibility | không có entitlement ngầm | fail-closed | không tạo artifact |

## 6. Snapshot relation registry matrix

| Relation group | Owner root | Disposition | Stable order | ID namespace/resolver | Validator | Historical behavior |
|---|---|---|---|---|---|---|
| Lots/options/extensions/clarifications/timeline/adjustments | package | clone/remap | registry order fields | deterministic aggregate UUID | nested graph + timeline references | source frozen |
| Goods/openings/bidder goods/assignments | package/plan | clone/remap | parent + business key + ID | package/opening/goods mappings | pending reference validator | source frozen |
| Evaluation rounds/criteria/reports/details | package | clone/remap | round/type/order/ID | round and criterion maps | full parent/round/criterion checks | source frozen |
| Joint-venture members | opening | clone/remap | sort order + ID | opening-owned UUID | unique member IDs | source frozen |
| Expert links | package | cloned external reference | type + expert ID | expert identity retained as external | declared external reference | link snapshot copied |
| Contractor participation | package/opening | derived | opening + contractor root | derived resolver | effective projection checks | recomputed, not copied as mutable evidence |
| Violation/lot-processing/documents/contracts | package lineage | retain | registry-specific timestamp/sequence/ID | exact evidence + deterministic lineage precedence | registry coverage | remains on historical snapshot |

Registry: `backend/versioning/aggregate_policy.py`; coverage: `tests/test_aggregate_relation_registry.py`.

## 7. Migration, performance và rollout

- Schema v59 adds `websocket_events.dispatched_at`, migrates `delivered` to `dispatched`, and replaces the status constraint.
- Fresh schema and v1 replay both match `backend/db/postgres_schema_contract.json`.
- Visibility policy version is 3; clients with an older token must full-refresh once to remove legacy masked projections.
- Table `sensitive_record_read_capabilities` remains inert for historical v56/v57 replay compatibility; runtime has no caller. It can be dropped only in a separately approved cleanup migration.
- Aggregate query parameter bound: 500 parent IDs/query. Official generated graph remains one outer transaction.

Benchmark results and reproducible commands are in `docs/performance/BENCHMARKS.md`.

## 8. Verification evidence

| Gate | Command | Result |
|---|---|---|
| Full Python + PostgreSQL | `python -m pytest -q` with configured PostgreSQL 17 | 1178 passed, exit 0 |
| Full JavaScript | `npm run test:js` | 801 passed, exit 0 |
| JS coverage | `npm run test:js:coverage` | 803 tests after added WebSocket branches; global 47.46% lines/61.92% branches/64.01% functions; 14 critical ratchets pass, exit 0 |
| Static/schema/lint | `npm run check:static` | pass, exit 0 |
| Secure production build | `npm run build:secure` | 281 modules, 52 obfuscated bundles, verification pass, exit 0 |
| PostgreSQL migration/races | migration chain + document jobs + WebSocket targeted suite | v1→v59, clean install and races pass |
| Browser smoke | isolated PostgreSQL + `npm run test:e2e:smoke` | Chromium, Firefox, WebKit: 3 passed, exit 0 |
| Authenticated E2E | `scripts/run_isolated_audit_e2e.ps1 -Suite auth-roles` | 14 auth/role/session steps passed, including employee protected-delete contract |
| Offline E2E | `scripts/run_isolated_audit_e2e.ps1 -Suite offline` | reconnect retry and interrupted-mutation manual retry passed; pending outbox survived reload |
| Bidder-goods E2E | `scripts/run_isolated_audit_e2e.ps1 -Suite bidder-goods` | single/two-envelope, PostgreSQL persistence, second-context sync and realtime preview passed |
| Typed sync errors | `python -m pytest -q tests/test_sync_public_errors.py tests/test_delete_concurrency.py tests/test_sync_conflict_authorization.py` | 5 passed, 4 PostgreSQL-dependent tests skipped in isolated unit run; `DELETE_ROLE_PROTECTED` preserved at public boundary |
| Aggregate benchmark | `npm run benchmark:aggregate-version` | 2k: 0.0544s/1.71 MiB; 10k: 0.266s/8.78 MiB; 25k: 0.6865s/22.26 MiB |
| Diff integrity | `git diff --check` | pass; only line-ending warnings from Git on Windows |

## 9. Remaining rollout notes

- Run migration v59 with migrator credentials before application workers; production runtime credentials remain without DDL.
- Deploy frontend and backend together because visibility token v3 and outbox envelope reconciliation are coordinated behavior.
- No user-facing role, permission, masking, redaction or field visibility was intentionally changed except removal of the unapproved sensitive-read masking model, restoring the product-owner contract.
- The comprehensive Codex remediation prompt remains `docs/PROMPT_CODEX_FIX_TRIET_DE_CAC_VAN_DE_AUDIT_VONG_2_BIDDINGFLOW.md`; section 0.1 forbids future unapproved data-display or permission changes.
