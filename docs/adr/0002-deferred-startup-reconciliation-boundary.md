---
status: accepted
---

# Đối soát khởi động defer với ranh giới mutation có thẩm quyền

BiddingFlow tiếp tục render ảnh chụp workspace cục bộ trước khi full authoritative sync hoàn tất để giữ startup nhanh, nhưng quản lý rõ các trạng thái `LOCAL_READY`, `RECONCILING`, `RECONCILED`, `OFFLINE_LOCAL`, `SYNC_ERROR` và `CONFLICT`. Mutation trực tuyến phải chờ ranh giới có thẩm quyền; mutation phát sinh trong cửa sổ stale phải đi qua authoritative pull trước lần push đầu tiên, còn outbox có sẵn từ phiên trước vẫn được bảo toàn. Xung đột row-version không tự chọn server và không tự discard local outbox; hệ thống chỉ bỏ thay đổi sau luồng retry/rebase và xác nhận rõ ràng của người dùng.

## Compatibility impact

UI vẫn render nhanh từ IndexedDB và offline workflow vẫn lưu mutation vào durable outbox. Các thao tác đang online có thể chờ reconciliation tại thời điểm commit; lỗi, conflict và workspace switch không còn được trình bày như đã lưu máy chủ. Quyết định này không thêm/bớt role, permission, assignment scope, record scope, entitlement, field masking hay dữ liệu mà người dùng đã được phép đọc; backend vẫn là authority cuối cho tenant, permission, assignment và record authorization.

## Migration strategy

Không đổi schema server hoặc IndexedDB và không purge dữ liệu cục bộ. Outbox cũ được hydrate như trước; generation hiện có chỉ dùng để phân biệt mutation đã tồn tại lúc workspace local-ready với mutation mới phát sinh trong stale-window. Secure build local dùng content SHA-256 khi CI không cấp commit SHA để giữ nguyên production artifact fail-fast contract.

## Regression seams

Unit/integration tests khóa state transition, authoritative mutation boundary, stale-window pull-before-push, startup/background single-flight, retry double-click, workspace A/B completion, route-safe render, actionable validation/transport state, conflict giữ outbox, IndexedDB/outbox durability và version/permission seams hiện có. Playwright scenarios trong `startup-sync.spec.mjs` xác minh mutation trên local snapshot không phát POST sync trước authoritative pull, server-deleted record không bị resurrect và route/modal không bị mất; auth-role E2E giữ response org A đến sau khi switch org B để khóa race workspace thật.
