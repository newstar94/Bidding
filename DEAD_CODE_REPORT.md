# Báo cáo code chết và thành phần có khả năng không còn sử dụng

- Snapshot: `1fb76ad`
- Ngày rà soát: 2026-07-26
- Trạng thái: **không xóa code trong giai đoạn review**

## 1. Cách kiểm tra

Đã kết hợp các phương pháp sau:

1. Phân tích Python AST để thu thập binding từ `Import`/`ImportFrom` và mọi `Name(ctx=Load)`.
2. Quét toàn repository bằng `rg` để tìm caller, re-export, `__all__`, star import và lookup động.
3. Dựng import graph frontend từ `frontend/app/app.js`.
4. Kiểm tra thủ công các facade/compatibility module vì static “không dùng tại chỗ” không đồng nghĩa không có consumer bên ngoài.
5. Đối chiếu test-only caller với production caller.

Kết quả tổng quát:

- 173/173 frontend JS module reachable từ entry point; không có frontend import cycle.
- Có 21 Python import binding độc lập, độ tin cậy cao là thừa.
- Có 1 binding trông thừa tại chỗ nhưng đang là re-export cho 5 module.
- Các function chỉ được test gọi được phân loại `LIKELY_UNUSED` hoặc `REQUIRES_CONFIRMATION`, không phải `SAFE_TO_REMOVE`.
- Không có table/column/index nào đủ bằng chứng để tự động xóa.
- CSS selector không được phân loại an toàn vì class được tạo động và chưa có browser coverage.

## 2. Định nghĩa phân loại

| Loại | Ý nghĩa | Hành động |
|---|---|---|
| `SAFE_TO_REMOVE` | Không có local load, không có external consumer/re-export/dynamic lookup được tìm thấy | Xóa trong PR cleanup riêng, chạy test đầy đủ |
| `LIKELY_UNUSED` | Không có production caller tĩnh, nhưng có test hoặc khả năng là public/operational hook | Xác nhận owner và runtime trước khi xóa |
| `LEGACY_COMPATIBILITY` | Facade, payload cũ, vendor hoặc compatibility path còn giá trị | Giữ hoặc migrate caller trong cùng PR |
| `REQUIRES_CONFIRMATION` | Static evidence chưa chứng minh đủ | Không xóa |
| `STILL_USED` | Có production caller hoặc vai trò runtime rõ | Giữ |

## 3. Import binding có thể xóa độc lập

Mỗi mục dưới đây đã được AST xác nhận không có local load và quét repository không thấy consumer dựa vào re-export. “An toàn” ở đây chỉ áp dụng cho việc xóa binding import, không áp dụng cho việc xóa module nguồn.

| Loại | File/Symbol | Bằng chứng | Mức tin cậy | Hành động | Rủi ro | Test sau khi xóa |
|---|---|---|---:|---|---|---|
| SAFE_TO_REMOVE | `backend/app.py:41 — Request` | 0 local load; không re-export | Cao | Xóa import | Thấp | Import app, Python suite, startup tests |
| SAFE_TO_REMOVE | `backend/lot_lifecycle_routes.py:13 — is_organization_manager, is_personal_workspace_owner` | 0 local load; route dùng policy khác | Cao | Xóa 2 binding | Thấp | Lot lifecycle + tenant tests |
| SAFE_TO_REMOVE | `backend/auth/auth_helper.py:6 — datetime` | 0 local load | Cao | Xóa binding | Thấp | Auth policy tests |
| SAFE_TO_REMOVE | `backend/auth/auth_routes.py:3,11,39,1974 — sys, defaultdict, hash_session_token, _re` | 0 local load; không nằm trong public import từ module | Cao | Xóa 4 binding | Thấp–trung bình do file có re-export khác | Toàn bộ auth tests + app import |
| SAFE_TO_REMOVE | `backend/documents/docx_bid_context_service.py:3 — re` | 0 local load | Cao | Xóa binding | Thấp | Document context tests |
| SAFE_TO_REMOVE | `backend/documents/docx_service.py:2,7 — clean_id, _org_cache_invalidate_by_user_id, custom_exporter` | 0 local load | Cao | Xóa 3 binding | Thấp–trung bình vì module document | DOCX tests + worker tests |
| SAFE_TO_REMOVE | `backend/documents/excel_handler.py:4 — hashlib` | 0 local load | Cao | Xóa binding | Thấp | Excel service tests |
| SAFE_TO_REMOVE | `backend/documents/routes_docx.py:52 — _format_formula_date` | 0 local load, không re-export | Cao | Xóa binding | Thấp | DOCX route/context tests |
| SAFE_TO_REMOVE | `backend/shared/logging_utils.py:4 — time` | 0 local load | Cao | Xóa binding | Thấp | Logging/metrics/startup tests |
| SAFE_TO_REMOVE | `backend/shared/text_utils.py:2 — datetime` | 0 local load | Cao | Xóa binding | Thấp | Text/date helper tests |
| SAFE_TO_REMOVE | `backend/sync/service.py:9,42,54,78 — _assert_safe_table, db_column_for_json_key, TABLE_KEYS, parse_sync_read_window` | 0 local load; không external re-export | Cao | Xóa 4 binding trong một cleanup hunk | Trung bình do sync là critical path | Sync service/mapper/tenant/full Python suite |
| SAFE_TO_REMOVE | `scripts/load_test.py:12 — statistics` | 0 local load | Cao | Xóa binding | Thấp | Script import/help + load rehearsal tests |

Tổng: **21 binding trên 12 file**. Chưa xóa vì yêu cầu hiện tại chỉ review và đề xuất.

**Cập nhật triển khai 2026-07-26:** Đã xác minh lại trên worktree hiện tại và xóa đủ 21/21 binding trong bảng. Compile/import smoke, security static gate, các test sync/security trọng yếu và full Python suite đều đạt. Các mục `LIKELY_UNUSED`, `REQUIRES_CONFIRMATION`, `LEGACY_COMPATIBILITY` bên dưới chưa bị xóa.

## 4. Binding trông thừa nhưng đang được dùng

| Loại | File/Symbol | Bằng chứng | Mức tin cậy | Hành động | Rủi ro | Test |
|---|---|---|---:|---|---|---|
| LEGACY_COMPATIBILITY | `backend/auth/auth_service.py:13 — get_client_ip` | Không load nội bộ nhưng được re-export; 5 module import qua `auth_service`: auth, Google auth, OTP, export, address | Cao | Giữ, hoặc chuyển cả 5 caller sang `backend.shared.client_ip` trong cùng PR | Xóa riêng gây import error production | Auth/OTP/Google/export/address |
| STILL_USED | `backend/auth/auth_routes.py:1519 — delete_user_api, list_users_api, update_user_access_settings_api` | Re-export và được `backend/app.py:367` import | Cao | Giữ | Route startup hỏng nếu xóa | App import + admin routes |
| LEGACY_COMPATIBILITY | `backend/shared/helpers.py` facade imports | Nhiều consumer import symbol từ facade dù module không load nội bộ | Cao | Không xóa cơ học; migrate caller theo lát cắt | Shotgun surgery/import cycle | Full backend suite |

## 5. Function/export chỉ thấy test hoặc chưa có production caller

| Loại | File/Symbol | Bằng chứng | Mức tin cậy | Hành động | Rủi ro | Test cần chạy/xác nhận |
|---|---|---|---:|---|---|---|
| LIKELY_UNUSED | `frontend/packages/lotEvaluationScope.js:374 — ensureWholePackageEvaluationAvailable` | Chỉ `tests/js/lot_evaluation_scope.test.mjs` gọi | Trung bình | Hỏi owner; nếu bỏ thì thay test bằng interface đang dùng thật | Có thể là public hook dự kiến | Lot scope + package workflow |
| LIKELY_UNUSED | `frontend/packages/GoiThauView.js:4 — async checkBidQualified wrapper` | Không production caller của wrapper; core function ở `detail/PackageTabs.js` vẫn dùng nhiều nơi | Cao | Xóa wrapper/re-export riêng sau import graph test | Nhầm xóa core function sẽ hỏng kết quả | JS suite + secure build |
| LIKELY_UNUSED | `backend/sync/payload_validation.py:333 — validate_contract_status_transition` | No-op, chỉ test gọi | Cao | Xác nhận contract status policy rồi xóa hoặc triển khai thật | Có thể là seam dành cho rule sắp tới | Contract/sync validation |
| LIKELY_UNUSED | `backend/sync/queries.py:26 — build_fts_match_query` | Chỉ test gọi | Cao | Xác nhận không có plugin/runtime lookup | Search fallback có thể dựa vào public helper | Pagination/search tests |
| LIKELY_UNUSED | `backend/shared/access_policy.py:175 — can_export_document_capability` | Chỉ test gọi; wrapper trên policy khác | Trung bình | Xác nhận external consumer | Xóa public policy helper | Access/document tests |
| LIKELY_UNUSED | `backend/shared/subscription_policy.py:93 — word_export_entitlement_payload` | Chỉ test gọi | Trung bình | Xác nhận route cũ không import động | Entitlement payload compatibility | Subscription/archive tests |
| LIKELY_UNUSED | `backend/auth/auth_service.py:139,185 — record_rate_limit_failure / async` | Chỉ test gọi | Trung bình | Xác nhận không phải supported facade | External import có thể tồn tại | Auth rate-limit tests |
| LIKELY_UNUSED | `backend/documents/custom_exporter.py:455 — validate_template_syntax` | Chỉ test gọi | Trung bình | Xác định replacement trước khi xóa | Template security path | Template/export tests |
| LIKELY_UNUSED | `backend/documents/timeline_document_service.py:183 — create_timeline_template` | Chỉ test gọi | Trung bình | Xác nhận CLI/ops không dùng | Operational helper | Timeline document tests |
| REQUIRES_CONFIRMATION | `backend/lot_selection_lifecycle.py:287,333 — require_transition, validate_artifact_scope` | Chỉ direct test gọi, nhưng là domain rules có thể được dành cho route rollout | Trung bình | Không xóa trước khi lifecycle owner chốt | Mất invariant tương lai | Lot lifecycle tests |
| REQUIRES_CONFIRMATION | `backend/auth/email_delivery_service.py:388 — retry_email_delivery` | Không production/CLI caller; test PostgreSQL và outbox gọi trực tiếp | Trung bình | Có thể cần expose qua ops tool thay vì xóa | Mất khả năng phục hồi email | Email outbox + ops decision |

## 6. Thành phần đã xác nhận vẫn dùng hoặc tương thích

| Loại | File/Symbol | Bằng chứng | Hành động |
|---|---|---|---|
| STILL_USED | `backend/shared/audit_chain.py:297 — verify_audit_chain` | `audit_monitor.verify_audit_chain_before_ready` gọi trong application lifespan | Giữ; tối ưu incremental nếu benchmark yêu cầu |
| LEGACY_COMPATIBILITY | `CompatRow` | PostgreSQL compatibility layer/test còn dựa vào access theo index/key | Giữ |
| STILL_USED | SheetJS vendor bundle | Excel reader/runtime và vendor integrity check tham chiếu | Giữ |
| LEGACY_COMPATIBILITY | Các no-op organization-cache hooks | Facade/caller cũ còn import; bỏ cần coordinated migration | Giữ tới PR riêng |
| STILL_USED | `wordVariableManifest.js` | Generated manifest được Word integration và tests dùng | Không coi file generated lớn là dead code |
| STILL_USED | Applied migration helpers | Cần tái tạo/upgrade database cũ; lịch sử migration không được sửa/xóa | Giữ |

## 7. Frontend file, asset và CSS

- Static graph không tìm thấy JS file không reachable. Vì dynamic import và command registry, kết quả này đáng tin hơn chỉ tìm textual import, nhưng vẫn không chứng minh từng export đều cần thiết.
- Không có import cycle frontend.
- Không phân loại CSS selector nào là `SAFE_TO_REMOVE`. Repository dùng HTML partial, `innerHTML` template, runtime class và generated style; cần browser CSS coverage qua toàn bộ route/modal/state trước khi xóa.
- Không phân loại asset nào an toàn để xóa trong lượt này. Production packaging đã dùng allowlist/exclusion check và đạt smoke test.

## 8. Database

Không có table, column, index hoặc constraint nào đủ bằng chứng để xóa tự động:

- Dataset cục bộ không đại diện production retention/legacy usage.
- Applied migration và fresh schema có yêu cầu tương thích dài hạn.
- PostgreSQL audit không phát hiện missing FK-leading index trên dataset đã kiểm tra.
- Column lý do/làm rõ chi tiết hiện không còn UI nhưng phải giữ để đọc payload cũ; sửa invariant code trước, không drop schema.
- `trang_thai_ho_so`/`trang_thai_ho_so_giay` đã bị v11 xóa là vấn đề mất dữ liệu, không phải ứng viên cleanup.

## 9. Trình tự cleanup an toàn

1. Tạo PR chỉ xóa 21 import binding `SAFE_TO_REMOVE`.
2. Chạy import smoke, toàn bộ Python tests, JavaScript tests và secure build.
3. Không trộn với refactor module hoặc thay đổi nghiệp vụ.
4. Với function `LIKELY_UNUSED`, mở xác nhận owner/runtime trước; thêm deprecation nếu có khả năng public.
5. Chỉ xóa test cũ khi test qua interface module mới đã thay thế đầy đủ hành vi.
6. Ghi rõ từng symbol đã xóa trong `CHANGELOG_REFACTOR.md` ở giai đoạn implementation sau.
