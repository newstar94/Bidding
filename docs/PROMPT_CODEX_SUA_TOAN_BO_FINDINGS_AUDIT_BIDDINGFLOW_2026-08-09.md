# PROMPT CODEX — SỬA TOÀN BỘ FINDINGS SAU AUDIT TOÀN DIỆN BIDDINGFLOW
## ƯU TIÊN P0/P1, SAU ĐÓ XỬ LÝ TOÀN BỘ P2/P3 CÓ THỂ HÀNH ĐỘNG — KHÔNG BIG-BANG REWRITE

Repository: `newstar94/Bidding`
Nhánh: `main`

Báo cáo nguồn bắt buộc:

```text
docs/audit/BAO_CAO_AUDIT_TOAN_DIEN_BIDDINGFLOW_2026-08-09.md
```

Mốc audit:

```text
47629c307b1ab6289918eb638fdddf09488a7639
```

# 0. NHIỆM VỤ

Đọc toàn bộ báo cáo audit và remediation toàn bộ active findings:

```text
P0 = 3
P1 = 14
P2 = 31
P3 = 9
Tổng = 57
```

Phải đi qua từng ID:

```text
BF-P0-01 .. BF-P0-03
BF-P1-01 .. BF-P1-14
BF-P2-01 .. BF-P2-31
BF-P3-01 .. BF-P3-09
```

Mỗi finding phải có trạng thái cuối:

```text
FIXED
MITIGATED
VERIFIED RESOLVED ON LATEST HEAD
BLOCKED BY EXTERNAL/LEGAL/PRODUCT DECISION
DEFERRED BY AUDIT SAFETY RULE
```

Không bỏ qua finding.

# 1. NGUYÊN TẮC

- `git fetch origin` trước khi sửa; revalidate trên `main` mới nhất.
- Không áp patch mù theo line cũ.
- Không big-bang rewrite frontend/backend/state/database.
- Small commits, test-first, compatibility-safe.
- Không biến `RISK` thành bug nếu chưa có evidence.
- Không rewrite migration v2–v42.
- Mọi schema change phải bằng migration mới append-only.
- Không drop table/column.
- Không xóa code `UNKNOWN`/`POSSIBLY UNUSED`.
- Không bypass legal gate.

Giữ nguyên architecture đã được audit đánh giá tốt:

- aggregate server transaction + repository locks;
- generic atomic `row_version` update writer;
- tombstone restore;
- `BrowserDB` multi-store transaction;
- `EntityIndexes`;
- Excel worker;
- document sandbox/archive hardening;
- root/version schema;
- owner/tenant model;
- 104-FK baseline.

# 2. BASELINE

Tạo:

```text
docs/remediation/BIDDINGFLOW_AUDIT_REMEDIATION_2026-08-09.md
```

Ghi HEAD, test counts, coverage, E2E, DB schema/index/FK, security/build, dependency audit, production package, performance và master status 57 findings.

Với P0/P1 confirmed bug: ưu tiên red regression test trước khi fix.

# 3. WAVE 1 — 3 P0

## BF-P0-01 — stale response A ghi vào workspace B

Tạo workspace-scoped async lease/capability nhỏ, capture:

```text
workspace token/epoch
scope
DB instance
AbortController khi có
```

Mọi side effect sau `await` phải validate lease:

```text
state
IndexedDB
DOM
cache
```

Áp cho pagination/shared table data, plan/package hydration, users/admin, notifications, package/contract loaders, Word mappings/templates, timeline fetches.

Workspace transition phải invalidate/abort/reset pending request maps.

Test deferred A→B cho từng nhóm; B không được nhận state/IDB/DOM của A.

## BF-P0-02 — in-flight mutation vượt workspace boundary

Mutation phải capture token + DB + outbox + scope. Không dereference resource mới sau `await`.

Workspace switch phải drain/abort mutation đang chạy an toàn. Test add/update/delete/upsert+delete qua switch A→B và durable failure. Không mutation A nào được stage/upload/delete trong B.

## BF-P0-03 — AI dùng role manager của org khác

Bind selected role với current organization. Effective role phải derive từ membership hiện tại của org hiện tại. Org switch/demotion phải invalidate/rederive.

Áp cho permission context, analytics scope, workspace search, toàn AI tools/routes.

Test matrix:

```text
manager A / employee B
manager A / no membership B
employee A / manager B
demotion mid-session
org switch
stale active_role
```

Negative assertions bắt buộc.

# 4. WAVE 2 — P1

## BF-P1-01
Pending local mutation là protected overlay trước pull. Server stale row không được làm mất edit local. Test delta/full + pending upsert/delete + second edit + reload/reconnect.

## BF-P1-02
Serialize pulls per workspace hoặc generation commit guard. Cursor phải monotonic. Test reverse completion v2 trước v1, WS+manual, route+background, 409/full sync.

## BF-P1-03
Synced mutation phải atomic. Ưu tiên route legacy direct entity APIs qua `WorkspaceDataStore`; nếu còn compatibility thì checkpoint/rollback + durable staging. Test IDB quota/error + reload.

## BF-P1-04
Dual outbox không được map read/write failure thành queue rỗng. Có degraded/recovery state; fail closed trước authoritative pull nếu durable queue không đáng tin. Test localStorage/IDB/both/corruption/recovery.

## BF-P1-05
Không mutate historical contractor version in-place. Tạo version mới hoặc giữ enrichment immutable trên bid snapshot theo current domain contract. Test business-date/history/reload.

## BF-P1-06
Production package phải chứa runbook/scripts mà packaged README tham chiếu. Add path-contract tests.

## BF-P1-07
Legal gate là intentional blocker. Không bypass, không fabricate approval. Nếu không có authoritative approved facts thì status `BLOCKED BY EXTERNAL/LEGAL APPROVAL`.

## BF-P1-08
Enforce stored Word access restrictions end-to-end. Không để deny flags nhưng runtime `allow_all()`. Chỉ retire UI/schema nếu repo có authoritative deprecation contract. Test all false/each flag/mixed/manager/employee/org + DOCX negative assertions.

## BF-P1-09
Delete/archive phải lock hoặc compare expected `row_version` và check rowcount. Stale delete phải conflict. Real PostgreSQL two-connection barrier tests.

## BF-P1-10
Serialize member quota count+insert/reactivate trong transaction bằng org/subscription lock. Concurrent last-slot test.

## BF-P1-11
Serialize last-manager invariant trên shared org lock. Concurrent remove/demote test không được còn 0 manager.

## BF-P1-12
Serialize last-super-admin invariant bằng platform/advisory/shared role lock. Concurrent delete/demote test.

## BF-P1-13
Package document lifecycle check và upload/delete phải cùng lock/version boundary. Two-connection TOCTOU test.

## BF-P1-14
Personal workspace phải luôn có WebSocket hoặc polling. 4003/non-retryable WS close phải restart polling nếu WS unusable. Test two-tab/reconnect/logout/workspace switch.

# 5. WAVE 3 — P2-01 .. P2-31

Xử lý đủ toàn bộ P2:

- **P2-01:** regenerate `schemaRuntime.js`; add generate-and-diff CI + serializer field contracts.
- **P2-02:** content-hashed bootstrap URLs; không immutable-cache static `?v=2.0`.
- **P2-03:** không silently chọn oldest future contractor version; explicit no-match policy.
- **P2-04:** scope/bound/clear JV global cache theo workspace/render lifecycle.
- **P2-05:** accessible combobox/listbox/keyboard/ARIA; reuse canonical helper nếu có.
- **P2-06:** contrast audited case >=4.5:1 + 320px axe regression.
- **P2-07:** canonical lot JSON parser: strict command mode + display/recovery mode có telemetry.
- **P2-08:** invariant/tie-break tests rồi canonicalize latest/root resolver; không rewrite version model.
- **P2-09:** incremental route CSS split; measure bundle/startup/visual.
- **P2-10:** profile exact cold long task; chỉ optimize nếu reproducible; không nới 100ms.
- **P2-11:** remove fixed 250ms offline E2E wait; state/network barrier + soak.
- **P2-12:** giảm arbitrary waits, DOM `.click()`, hardcoded dates; dùng Playwright actionability + test clock.
- **P2-13:** risk-based coverage floors; thêm JS coverage critical modules.
- **P2-14:** enforce real Chromium/Firefox/WebKit canonical test matrix hoặc docs hỗ trợ trung thực.
- **P2-15:** upgrade vulnerable `nanoid@3.3.16` dependency chain compatibly; run full/prod audits.
- **P2-16:** Python CI dùng hashed lock/`--require-hashes`, project install `--no-deps` nếu phù hợp.
- **P2-17:** SBOM include vendored Flatpickr/Lucide/SheetJS/fonts/assets + version/hash/license.
- **P2-18:** private source-map/mapping archive per immutable release + symbolication smoke.
- **P2-19:** production package reject `releaseId=development/unknown/empty`.
- **P2-20:** structured redacted telemetry tại critical catches; không mass rewrite.
- **P2-21:** pin GitHub Actions SHA và container/image digest khi khả thi.
- **P2-22:** expand normalized PostgreSQL schema contract: types/null/default/CHECK/UNIQUE/FK/index/trigger/extra-object policy + negative tests.
- **P2-23:** không rewrite migration v36; add preflight cardinality/dry-run/runbook/realistic upgrade test.
- **P2-24:** migration mới cho `sync_metadata`: `current_version >= 0`, `min_available_version <= current_version`; preflight + safe validate.
- **P2-25:** lot finalize idempotency key + request digest/result replay.
- **P2-26:** reliable transactional/durable realtime event outbox; không swallow enqueue failure as guaranteed success.
- **P2-27:** AI provider URL validation: HTTPS + allowlisted hosts + redirect/proxy policy.
- **P2-28:** realistic retention benchmark/EXPLAIN; chỉ thêm cutoff-first/partial index nếu evidence; batch cleanup.
- **P2-29:** real PostgreSQL v1/vN→latest migration-chain tests + catalog/data/invariant assertions.
- **P2-30:** account deletion retention/privacy integration contract; không purge audit evidence mù; nếu thiếu authoritative legal/product rule thì BLOCKED nhưng harden accidental exposure/deletion.
- **P2-31:** không thêm cascade FK mù; nếu org decommission chưa là feature thì block unsafe path, add ownership dry-run/postcondition contract.

# 6. WAVE 4 — P3-01 .. P3-09

- **P3-01:** NotificationCenter explicit dispose cho interval/listener/observer nếu lifecycle remount.
- **P3-02:** characterization direct/special award rồi remove dead branch only.
- **P3-03:** remove 5 confirmed unused `evaluationMetadata` aliases sau import/tests/build.
- **P3-04:** restore business-matrix generator+gate hoặc intentionally retire command/docs; không để `MODULE_NOT_FOUND`.
- **P3-05:** canonical reusable CI gate; không giảm encoding/modules/security/build coverage.
- **P3-06:** benchmark scripts vẫn `UNKNOWN`; không xóa chỉ vì không có caller.
- **P3-07:** migration mới drop only `idx_audit_log_single_successor` nếu latest catalog vẫn exact duplicate; keep constraint-backed twin; rollback documented.
- **P3-08:** characterize rồi coordinated remove timeline DOCX legacy route/worker IPC/template chain nếu vẫn dead; không đụng active document worker.
- **P3-09:** LP-25 fixture reverse-dependency cleanup + `APP_ENV=test`/allowlisted DB guard + zero-row postcondition.

# 7. SAFE-TO-DELETE

Chỉ `SAFE AFTER TEST`:

```text
5 evaluationMetadata aliases
dead award direct/special branch
timeline DOCX legacy chain
duplicate explicit audit index via migration
```

Không xóa:

```text
excelParseWorker.js
DB tables
DB columns
historical migrations v2–v42
schema runtime generator
direct deps/vendor assets without new evidence
LP-25 fixture itself
```

Không xóa `UNKNOWN`:

```text
11 no-frontend-caller API paths
2 benchmark scripts
CSS selectors/files
whole JS/Python modules
```

# 8. DUPLICATED LOGIC

Sau correctness fixes, canonicalize chỉ khi có characterization tests cho 10 families:

```text
award projection
evaluation normalization
latest/root resolver
contractor identity/version
lot JSON
lot outcome
AI scope
tax-code normalization
realtime enqueue
timeline export
```

# 9. DB MIGRATION RULES

Mọi DB change:

```text
new append-only migration
preflight
transaction plan
backward compatibility
rollback
fresh schema update
schema contract update
real upgrade-chain test
```

Không sửa v2–v42. Không drop table/column.

# 10. PERFORMANCE

Budget:

```text
Cold p95 <= 800 ms
Warm p95 <= 325 ms
Longest task <= 100 ms
```

30+30 isolated runs cho startup/long task khi relevant. Không cherry-pick, không nới threshold.

# 11. SECURITY ACCEPTANCE

Regression bắt buộc:

```text
cross-org AI role
workspace A→B stale reads
workspace A→B mutation
Word export restrictions
stale delete
AI provider config
tenant/document access
```

Không log token, full prompt, private contractor data, document content.

# 12. FULL TEST MATRIX

Cuối cùng chạy:

```text
full Python + coverage + critical coverage
full JS + JS critical coverage
quality/security/debt/module/encoding
schema/FK/index
real upgrade-chain
two-connection concurrency
secure build
production package
SBOM/dependency audits
startup performance
```

E2E:

```text
auth shell
auth/roles
CRUD
multi-assignee
JV
bidder goods
low-price conflict
offline/reconnect
package pairwise
full lifecycle
UI quality
AI cross-org authorization
personal workspace two-tab
Word access
```

Browser matrix:

```text
Chromium
Firefox
WebKit
```

Soak ít nhất:

```text
workspace async switch
offline/reconnect
JV multi-lot
personal WS/poll
pull ordering
```

# 13. RELEASE

Production package phải self-contained, immutable release ID, SBOM đầy đủ, dependency/security gates pass.

Nếu legal facts chưa approved:

```text
release vẫn BLOCKED
```

Không bypass.

# 14. COMMIT STRATEGY

Không mega-commit. Tách theo auth/workspace/sync/persistence/backend concurrency/documents/realtime/schema/accessibility/CI/release/dead-code/migrations.

# 15. REMEDIATION REPORT

Trong:

```text
docs/remediation/BIDDINGFLOW_AUDIT_REMEDIATION_2026-08-09.md
```

tạo đủ 57 rows:

| ID | Before | Repro/Test | Root cause | Fix | Commit | Tests | Migration | Status | Remaining risk |
|---|---|---|---|---|---|---|---|---|---|

# 16. DEFINITION OF DONE

- 3/3 P0 fixed và deterministic regression pass.
- Tất cả confirmed P1 correctness/security bugs fixed.
- P1 risks đã harden/test hoặc ghi blocker chính xác.
- 31 P2 đều có disposition.
- 9 P3 đều có disposition.
- Không active finding nào bị bỏ quên.
- Full Python/JS/E2E/security/schema/package/performance gates pass, trừ external legal blocker được ghi rõ.
- `git diff --check` pass.
- Không debug/repro artifacts.
- Không debt ratchet regression.

# 17. BLOCKER RULE

Có thể để `BLOCKED` khi thật sự cần external/legal/product decision, ví dụ:

```text
legal approval
retention/legal requirement chưa có source
external API consumer telemetry
```

Nhưng phải sửa hết phần kỹ thuật độc lập trước và ghi chính xác decision còn thiếu.

# 18. KẾT LUẬN CUỐI BẮT BUỘC

Trả lời:

1. Latest HEAD ban đầu?
2. Bao nhiêu P0/P1/P2/P3 FIXED?
3. Bao nhiêu MITIGATED?
4. Bao nhiêu VERIFIED RESOLVED?
5. Bao nhiêu BLOCKED và vì sao?
6. Còn cross-tenant path đã biết không?
7. Còn path mất dữ liệu đã biết không?
8. Word access enforce thật chưa?
9. Personal workspace realtime fallback thật chưa?
10. Stale delete còn thắng update mới không?
11. Migration mới nào?
12. Dead code nào đã xóa?
13. DB object nào đã xóa và rollback?
14. Test counts trước/sau?
15. E2E/browser/soak?
16. Performance trước/sau?
17. Dependency/SBOM/release status?
18. Legal gate pass hay blocked?
19. Có finding nào chưa có disposition?
20. Có đủ điều kiện technical release không?

Không được nói “đã sửa hết” nếu còn finding chưa có disposition hoặc release blocker chưa pass.

Chỉ được gọi release-ready khi:

```text
3 P0 = 0 active
all confirmed P1 correctness/security bugs fixed
required P1 risks hardened/tested
full test/E2E/security/schema/package gates pass
legal gate pass
no known cross-tenant/data-loss blocker
```

Nếu legal gate vẫn chưa được phê duyệt:

```text
Technical remediation complete where possible, but production release remains blocked by legal approval.
```
