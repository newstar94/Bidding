# Trạng thái triển khai audit BiddingFlow

Baseline triển khai: `f39d6176f9fb75fa96dc470e904f0cb71e6b661a` (worktree đã có thay đổi của chủ repository tại file prompt audit). `open/partial` ở cột baseline là trạng thái quan sát trước đợt sửa này; `fixed` nghĩa là acceptance đã có code + regression evidence. Legal facts không được tự suy luận nên giữ blocker có chủ đích.

| ID | Baseline tại HEAD | Trạng thái sau triển khai | Bằng chứng / quyết định | Test bảo vệ |
|---|---|---|---|---|
| BF-SEC-01 | open | fixed | `conflict_projection.py`; authorize write/read trước projection, bounded deny | `test_sync_conflict_authorization.py`, `test_phase0_boundaries.py` |
| BF-LEGAL-01 | open | blocked-external | 27 facts ở `legal-fact-sheet.md`; dev warning, public-production fail | `test_legal_readiness.py` |
| BF-SYNC-01 | partial | fixed | mutation ID bắt buộc, tombstone-aware validate, v30, explicit restore | `test_sync_mutation_contract.py`, `test_sync_restore.py` |
| BF-OPS-01 | partial | fixed | readiness đọc fail-closed audit state, bounded reason codes | `test_phase0_boundaries.py` |
| BF-SEC-02 | partial | fixed | record/tenant/module/assignment policy; legacy field capability không deny dữ liệu hồ sơ | `test_record_access_projection.py` |
| BF-AUDIT-01 | partial | fixed | same-transaction create/update/delete/restore evidence; export-job create + required audit cùng commit; coverage matrix riêng | `test_immutable_mutation_audit.py`, `test_sync_restore.py`, `test_document_export_jobs.py` |
| BF-SYNC-02 | open | fixed | `/api/sync/delta`, fixed `throughVersion`, stable order, item/byte limit, HMAC cursor, final-page cursor commit | `test_sync_delta_paging.py`, `sync_delta_paging.test.mjs` |
| BF-SYNC-03 | partial | fixed | `enqueue_websocket_event` dùng business cursor; v32 pending/retry/dead-letter; `NOTIFY` chỉ phát sau commit | `test_websocket_transactional_outbox.py` |
| BF-DOC-01 | partial | fixed | package-report async API 202/status/download/cancel/retry; job owner scope v31; enqueue rollback nếu required audit fail | `test_document_export_jobs.py`, route composition smoke |
| BF-MEDIA-01 | partial | fixed | private staging + `asset_journal` + post-commit promote/reconcile v31 | `test_asset_journal.py` |
| BF-TEST-01 | partial | fixed | resource warnings dọn sạch; warnings-as-errors; critical line/branch ratchet | full pytest; `test_critical_coverage_gate.py` |
| BF-ARCH-01 | open | fixed | backend lifecycle contract v1 + frontend adapter/parity | `test_lifecycle_policy_contract.py`, `lifecycle_policy.test.mjs` |
| BF-ARCH-02 | open | fixed-incremental | `PackageDetailModule` mount/navigate/save/dispose; chrome là vertical slice đầu | `package_detail_module.test.mjs` |
| BF-ARCH-03 | partial | fixed | `RouteRegistry` + module-owned `PackageWorkspaceState`, dirty guard | `route_workspace_state.test.mjs` |
| BF-ARCH-04 | open | fixed-incremental | `WorkspaceDataStore.transaction`; bidder-goods import vertical slice | `workspace_data_store.test.mjs`, `bidder_goods.test.mjs` |
| BF-ARCH-05 | partial | fixed-incremental | sync/document/lifecycle route registries; app compose thay vì thêm business logic | `test_backend_route_composition.py` |
| BF-ARCH-06 | open | fixed | native ESM code splitting, TT-safe import, every chunk secure-obfuscated | secure build; `single_bundle_build_config.test.mjs` |
| BF-ARCH-07 | open | fixed | overview, lifecycle, evaluation/lot, sync, worker trust, ADR, glossary, status | documentation inventory |
| H-C01 | partial | fixed-incremental | package version selector dùng native select; compatibility custom select có dev inventory/warning | `tabs_button_contract.test.mjs`, `custom_select_label.test.mjs` |
| H-C02 | partial | fixed-incremental | `design.md`, three-layer tokens, cascade layers, finite z-index, debt ratchet | `audit_ui_boundaries.test.mjs`, `test_frontend_debt_gate.py` |
| H-C03 | open | fixed | shared focus token ≥2 px, solid contrast color, no focus border shift | `audit_ui_boundaries.test.mjs` |
| H-M01 | partial | fixed | accessible tabs: roles/linkage/roving focus/Arrow/Home/End + cleanup | `tabs_button_contract.test.mjs` |
| H-M02 | open | fixed-incremental | explicit Button contract/loading guard; inferred system chỉ compatibility inventory | `tabs_button_contract.test.mjs` |
| H-M03 | open | deferred-by-DEC-06 | giữ package long form trong modal; chỉ sửa focus/validation/state boundary | modal/UI regressions hiện hữu |
| H-M04 | open | fixed-incremental | bidder-goods visible success đổi sang inline “Đã lưu lúc…”; đơn giá, thành tiền, ưu đãi, tổng và đối chiếu giá cập nhật realtime; save official stage cả goods + opening trong cùng sync batch; giữ business warnings | `bidder_goods.test.mjs`, `verify_bidder_goods_e2e.cjs` |
| H-M05 | open | fixed | deactivated/missing/delayed assignee không render raw ID; mobile first name +N | `multi_assignee_activity.test.mjs` |
| H-M06 | partial | fixed | authenticated real-app viewport matrix 320/375/414/768/1280, axe, keyboard, deep-link, overflow | `verify_authenticated_ui_matrix.mjs` |
| H-m01 | open | fixed | collapsed sidebar tooltip hỗ trợ `:focus-visible` | `audit_ui_boundaries.test.mjs` |

## Compatibility notes

- V30/v31/v32 là additive forward-only migrations; không sửa migration đã phát hành.
- Legacy `document_export_capabilities`, custom select, button enhancer và direct state writes được giữ sau compatibility seam; ratchet ngăn debt mới.
- Sync client chỉ dùng delta pager cho full delta pull; route-only/full bootstrap tiếp tục contract cũ.
- Synchronous document export nhỏ vẫn được giữ; large package report có API async riêng.
- Production-public packaging phải tiếp tục fail cho tới khi mọi legal fact chuyển sang `approved` với owner/evidence/date/approver thật.

## Xác minh cuối ngày 2026-07-30

- Gate tổng hợp: 203 test Python + 240 test Node pass; coverage tổng và ratchet line/branch cho module trọng yếu pass.
- PostgreSQL bidder-goods E2E pass 5 biến thể gói, gồm 20 phạm vi phần lô, xác minh database và browser context thứ hai.
- Secure build pass với 41 chunk đã obfuscate; app entry 124,31 kB, chunk lớn nhất 635,92 kB.
- Dependency audit báo 0 lỗ hổng npm và không có lỗ hổng Python đã biết.
- N+1 benchmark giữ query count cố định cho 1/10/50/100 bản ghi, không có query pattern lặp.
- Legal gate development cảnh báo đủ 27 placeholder chưa duyệt; production-public packaging fail closed trước build/package đúng yêu cầu.
- Sinh CycloneDX SBOM thành công. Document sandbox runtime probe chỉ hỗ trợ Linux/POSIX nên vẫn phải chạy tại Linux staging; workspace Windows từ chối rõ ràng.
