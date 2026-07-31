# Kiến trúc BiddingFlow

## Phạm vi và nguyên tắc

BiddingFlow là ứng dụng ASGI + PostgreSQL, frontend ESM chạy offline-first. Ranh giới bảo mật nằm ở server và theo `organization_id`/hồ sơ; frontend, IndexedDB, WebSocket và obfuscation không phải authorization boundary. Người có quyền hồ sơ nhận đủ dữ liệu nghiệp vụ theo DEC-02, còn password, token, secret và hash nội bộ luôn bị loại.

## Backend

- `backend/app.py` chỉ compose middleware, lifespan, static delivery và các route registry.
- Auth/session và workspace scope nằm trong `backend/auth` và `backend/shared/workspace_scope.py`.
- Record-level access tập trung ở `backend/shared/access_policy.py`.
- Sync command/read/paging/restore nằm trong `backend/sync`; mutation, immutable audit và WebSocket outbox dùng chung transaction.
- Document parsing/rendering chạy qua durable queue trong `backend/documents/document_worker.py`; HTTP worker không trực tiếp tin input/result của subprocess.
- Protected media được ký theo session/workspace và authorize theo owner record trước khi kiểm tra file.
- Lifespan chỉ ready sau database, schema và audit-chain verification; background workers gồm audit monitor, document queue, email, WebSocket broker và reconciliation.

## Frontend

- `RouteRegistry` là seam parse/serialize/navigate.
- `PackageWorkspaceState` sở hữu package/tab/round/bid/lot/draft/dirty state.
- `PackageDetailModule` sở hữu lifecycle mount/navigate/save/dispose của package chrome; panel legacy tiếp tục migrate theo vertical slice.
- `WorkspaceDataStore.transaction` sở hữu snapshot, persist, outbox, sync, rollback và notification cho workflow đã migrate.
- `LifecyclePolicy` dùng contract version 1 từ backend, không coi nhãn tiếng Việt là status code.
- Accessible Tabs/Button là primitive mới; custom select và inferred button chỉ còn compatibility inventory.

## Luồng mutation

1. Xác thực session và active workspace.
2. Validate payload + `clientMutationId`, acquire idempotency lock.
3. Authorize write; conflict projection chỉ sau read authorization.
4. Stage media, mở transaction, ghi business rows, tombstone, immutable audit, activity và WebSocket event.
5. Commit một lần; PostgreSQL phát `NOTIFY` sau commit.
6. Promote staged asset; reconciliation hoàn tất nếu process chết giữa commit và promote.

## Build và vận hành

Vite tạo native ESM chunks tại các dynamic-import seam, không chèn script runtime. Mọi JS chunk được secure-build obfuscate và kiểm tra hash. CSS dùng cascade layers `tokens → base → components → features → utilities → legacy`. Public production packaging bị legal gate chặn cho tới khi đủ 27 fact được phê duyệt.

