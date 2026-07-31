# Document worker trust model

Uploaded OOXML và render payload là untrusted. Archive guard chặn traversal, duplicate entry, encryption, external relationship, malformed archive và decompression bomb. Production yêu cầu external POSIX worker với shared root được provision trước; web process không được chạy parser với quyền quản trị.

## Queue

`document_jobs` là durable queue có pending/processing/retry/completed/failed, attempt, lease, expiry và bounded backoff. Large package report API trả `202 + jobId`; status/download/retry/cancel đều bind vào `organization_id`, `user_id`, `package_id`.

Quyền hồ sơ được kiểm tra khi tạo và kiểm tra lại khi status/download/retry/cancel. Thu hồi assignment làm download không còn khả dụng. Job owner không suy ra job của user/tenant khác vì missing và denied dùng cùng `DOCUMENT_JOB_NOT_FOUND`.

Worker đọc immutable manifest, kiểm tra path/hash và ghi result sidecar. Download chỉ đọc result `completed`, dùng `private, no-store`, audit create/download và không trả lỗi subprocess nội bộ. Job/artifact hết hạn được retention cleanup; failed job chỉ retry bằng command rõ ràng. Synchronous fast path được giữ cho export nhỏ/legacy trong deadline ngắn.

