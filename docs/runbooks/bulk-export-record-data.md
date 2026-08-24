# BulkOperation `EXPORT_RECORD_DATA` v1

Áp dụng ADR 0013. Bật bằng `BULK_EXPORT_ENABLED=true` và đặt `BIDDING_BULK_EXPORT_DIR` tuyệt đối ở production. Registry chỉ có `EXPORT_RECORD_DATA` cho `kehoach`/`goithau`, `EXPLICIT_IDS`, tối đa 100 bản ghi.

Prepare giữ authority 10 phút. Confirm khóa operation, tái authorize và so rowVersion toàn bộ; một denied/stale item làm operation fail không trả metadata bị từ chối. Artifact ZIP chứa JSON UTF-8 của full authorized business projection, không phụ thuộc Word entitlement, hết hạn sau 24 giờ. Download tái authorize lần nữa.

Retention loop xóa bytes hết hạn nhưng giữ metadata operation/artifact và audit checksum. Rollback tắt flag; không có business mutation cần undo. Orphan bytes sau crash trước DB finalize được nhận diện bằng cách so file dưới storage root với `bulk_operation_artifact.storage_key` và chỉ xóa sau thời gian an toàn vận hành.

