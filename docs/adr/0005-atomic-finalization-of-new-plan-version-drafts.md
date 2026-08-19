---
status: accepted
date: 2026-08-19
---

# Chỉ commit chuỗi phiên bản kế hoạch mới khi người dùng hoàn tất

Một kế hoạch mới, chưa có bất kỳ physical plan/package nào trên server, được soạn trong một `PlanVersionDraftSession` theo workspace. Hành động **Lưu phiên bản nháp** chụp bất biến plan, package, assignment và toàn bộ child/embedded aggregate hiện tại, sinh physical ID cho phiên bản kế tiếp và chỉ ghi session vào IndexedDB của workspace. Hành động này không gọi `/api/sync`, `/api/versioning/aggregate` hoặc endpoint finalize và không đổi `isLatest` trên server.

Hành động **Lưu & hoàn tất** validate toàn bộ graph rồi gửi mọi snapshot qua `POST /api/plans/finalize-draft`. Backend xác thực session/workspace/quyền trên từng record bằng sync write lane hiện hữu, kiểm tra chuỗi phiên bản liên tục từ `00`, root/reference hợp lệ, ID mới hoàn toàn và không có deletion. Toàn bộ validation/write/audit/latest recalculation/idempotency response chạy trong một transaction `SERIALIZABLE`, không có savepoint từng record. Một lỗi bất kỳ rollback toàn bộ aggregate.

Client-generated UUID là persisted ID; mapping trả về là identity mapping. `sync_mutations` bảo vệ retry/double-click bằng `clientMutationId`. Client chỉ áp dụng rowVersion canonical và xóa IndexedDB draft sau server acknowledgement; lỗi validation, conflict, network hoặc server giữ nguyên draft. Full pull sau commit thay local projection bằng server state. Reload/pull trước commit reapply draft overlay sau server snapshot và không đưa draft vào mutation outbox.

## Compatibility impact

Quy tắc mới chỉ áp dụng cho chuỗi kế hoạch mới chưa từng persist. Chỉnh sửa hoặc tạo phiên bản từ kế hoạch đã tồn tại tiếp tục dùng `/api/sync` và `/api/versioning/aggregate` theo hành vi hiện hữu. Kế hoạch chỉ có phiên bản `00` được finalize ngay khi người dùng bấm **Lưu & hoàn tất**. Không thay đổi role, module permission, assignment scope, record scope, entitlement, tenant isolation, audit hoặc dữ liệu mà người dùng được phép xem.

## Migration strategy

Không đổi schema database. IndexedDB dùng key workspace-scoped `plan_version_drafts_v1`; workspace cũ không có key được hiểu là không có draft. Mỗi session giữ `draftId`, `rootId`, status, version list, current physical plan ID, timestamps và normalized aggregate. Session có record trùng server với `rowVersion > 0` được dọn sau hydration để tránh render duplicate draft + canonical row.

## Regression seams

- Lưu trung gian `00` và `01` không phát sinh server write; DB vẫn có 0 plan/package/assignment/child của root.
- Finalize `02` tạo `00/01/02`, chỉ `02` là latest, package snapshot A/B/C và assignment E1 → E1+E2 → E2 giữ nguyên.
- Child/reference lỗi rollback về 0 record; retry cùng mutation không tạo duplicate.
- Reload và workspace switch chỉ phục hồi draft trong đúng IndexedDB workspace.
- Finalize thất bại không clear draft; finalize thành công áp dụng rowVersion rồi mới clear và full pull canonical state.
- Luồng persisted plan/package và permission/data-visibility contract giữ nguyên.
