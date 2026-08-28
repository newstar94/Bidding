# Báo cáo triển khai remediation Performance / UX / Security

Ngày xác minh: 28/08/2026 · HEAD tham chiếu `4f5a2d99cb4d8d8a26e919ee42788cb7829eb54a` · worktree dirty được bảo toàn.

## Kết quả theo work package

| WP/Finding | Trạng thái | Root cause | Files changed | Tests | Before | After | Compatibility | Rollback | Blocker |
|---|---|---|---|---|---:|---:|---|---|---|
| WP-01 PAY-00 timestamp/review | DONE | Timestamp provider-shaped bị parse như số; thiếu durable review | `backend/billing/provider_timestamp.py`, billing activation/service/worker | billing/payOS targeted; 81 backend pass | timestamp mơ hồ có thể dead-loop | chuẩn hóa UTC khi explicit; mơ hồ vào review | giữ live payment OFF, không tự activation | tắt worker mới, giữ evidence | timezone mơ hồ cần owner quyết định nếu bật live |
| WP-02 service worker/deploy | DONE | Eager/lifecycle và version-skew lazy chunk | `views/service-worker.js`, lifecycle tests | SW lifecycle targeted; secure build | feature graph bị tải sớm / 404 N/N-1 | runtime cache on demand + safe reload guard | giữ asset N-1 theo rollout | rollback HTML+SW đồng bộ | N/N-1 deploy smoke ngoài môi trường |
| WP-03 active-role correctness | DONE | Local persona có thể đổi trước ACK lỗi | `frontend/app/BiddingController.js`, lifecycle controller | role/scope targeted | lỗi 403/409 có side effect | chỉ apply sau response hợp lệ | role/permission semantics giữ nguyên | revert controller seam | auth browser E2E bị renderer block |
| WP-04 mutation local-first | DONE | UI chờ remote pagination/full render | `WorkspaceMutationCoordinator.js`, `MutationService.js`, workflow callers | mutation/conflict/workspace targeted; JS 1411/1411 | thao tác khựng, modal bị giữ | local durable + feedback trước canonical ACK | outbox/draft/recovery durable | fallback pipeline, không xóa outbox | P95 production RUM chưa có |
| WP-05A scheduler/render/pull | DONE | task/render/pull không có priority, dedupe, active-pane guard | scheduler, render coordinator, sync pull/merge | scheduler/render/race targeted | request/CPU cạnh tranh | delay/dedupe/cancel/generation guard | cache namespace giữ nguyên | tắt warming implementation | production INP/RUM chưa có |
| WP-05B projection cache | DONE | Cache key/in-flight thiếu scope và pagination identity | `PaginatedProjectionStore.js`, table utils | projection/hydration targeted | first click cold, cross-query risk | exact key, SWR, bounded cache | full-record visibility giữ nguyên | dispose cache layer | N/N-1 smoke ngoài môi trường |
| WP-06 workspace lifecycle | DONE | Rapid switch capture lease/mutation sau microtask | `WorkspaceLifecycleController.js`, `OrganizationMembershipCommand.js` | workspace/membership race targeted | stale workspace có thể commit | lease capture đồng bộ + generation guard | tenant/workspace isolation giữ nguyên | revert lifecycle seam | browser E2E external block |
| WP-07 assignment/membership | DONE | nhiều mutation rời và reload cạnh tranh | `AssignmentBatch.js`, membership/admin/shared callers | assignment/member targeted | UI khựng, rollback không nguyên tử | một local transaction/logical batch | assignment scope/identity giữ nguyên | fallback từng mutation | composite command cần owner quyết định |
| WP-08 procurement | DONE | upstream/circuit/progress trộn quota/cache | procurement routes/raw/wizards | procurement targeted; 81 backend pass | lỗi upstream không phân biệt | progress/cancel/circuit nhanh, cache hit không tiêu quota | package/quota contract giữ nguyên | tắt lookup optimization | MSC live/upstream external |
| WP-09 DB/metrics | DONE | blocking I/O và scrape đồng thời gây bão | `backend/shared/async_io.py`, metrics/lifecycle | blocking lanes + metrics targeted; 81 pass | lane không bounded | bounded lanes + snapshot single-flight | schema/API compatibility | giảm lane config về default | production dashboard/RUM external |
| WP-10 renderer/timeline | DONE | full render/hidden pane/Flatpickr lifecycle | chunked renderer, package/timeline files | renderer/timeline targeted | long task và timeline lỗi | active pane + chunk budget + lifecycle cleanup | focus/ARIA/draft/export giữ nguyên | revert renderer seam | table long tasks 238–280 ms follow-up |
| WP-11 payment readiness | PARTIAL | provider live credential/webhook/reconciliation chưa được owner bật | billing files/tests/runbook giữ payment OFF | provider-shaped targeted | chưa có live evidence | signature/idempotency/review path local | không gọi payOS thật | disable checkout/worker | live payment, requeue dead, mapping cần quyết định |
| WP-12 debt/retention | PARTIAL | static debt ratchet và retention policy còn cần xử lý | retention inventory/docs, profile script | dead-code/module/security/dependency green | debt baseline 428/930/59 | current 433/1067/61; runtime styles 512 | không xóa artifact/dữ liệu | dry-run/quarantine only | owner duyệt retention; debt trả theo wave |

## Gate và bằng chứng

- `npm run test:js`: **1411 pass / 0 fail / 0 cancelled** (`data/logs/test-js-remediation.log`).
- Backend targeted: **81 pass / 29.75 s** (`data/logs/test-python-remediation.log`).
- `npm run lint:security`: **pass**; Trusted Types pass.
- `npm run lint:modules`: **324 modules, 0 cycle**.
- `npm run audit:dead-code`: **324 reachable, 0 orphan, 0 unresolved**.
- `npm run audit:dependencies`: **npm 0 vulnerabilities; pip-audit no known vulnerabilities**.
- `npm run build:secure`: **pass**, 328 modules, 71 obfuscated bundles, route CSS pass.
- `python scripts/check_python_quality.py`: pass; `git diff --check`: pass.
- `npm run check:static`: dừng tại `lint:debt` (`important 433>428`, `raw_colors 1067>930`, `direct_state_writes 61>59`). Không hạ threshold.
- `npm test`: không gọi pass; full-run loopback AI test nhạy với tải môi trường và bị treo sau 55%. File AI độc lập đạt 45/45.

## Blocked decisions còn lại

1. Timezone mặc định cho `transactionDateTime` payOS không có timezone.
2. Policy purchase/renew/upgrade/downgrade khi subscription active.
3. Mapping `legacy_package_id`.
4. Fake checkout authorization contract.
5. First-use offline commitment sau khi thu nhỏ SW precache.
6. Asset N/N-1 grace window.
7. Retention/backup artifact, log, Word QA và symbols.
8. Composite membership lookup+add command.
9. Bật live payment và requeue event/command `dead` thật.

Mỗi mục trên phải có ADR, compatibility impact, migration/rollback và regression test trước khi bật semantics tương ứng.

## Blocked external

Production RUM/INP/dashboard, deploy N/N-1 smoke, payOS/MSC live và Chromium auth/CRUD/offline/lifecycle E2E chưa có môi trường sạch/credential/authority. Các E2E bị dừng đều đã cleanup fixture chính xác; không gọi là pass.

## Rollout / rollback

Deploy backend trước frontend cho batch contract; giữ asset N-1 trong grace; rollout implementation theo cohort nếu cần. Payment checkout/activation live vẫn **OFF**. Rollback HTML/SW đồng bộ, không xóa draft/outbox/signed evidence/activation ledger; retention tooling chỉ dry-run/quarantine.

## Contract bất biến

Không thay masking/full-record visibility; người đã có tenant/module/assignment/record scope vẫn xem đầy đủ dữ liệu. Không thay role, permission, entitlement, quota, package semantics hoặc 27 legal items. Không stage, commit, push hay deploy.
