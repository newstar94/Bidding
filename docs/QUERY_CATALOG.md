# Danh mục truy vấn chính

| Màn hình/tác vụ | Truy vấn chính | Cơ chế hiệu năng |
|---|---|---|
| Dashboard | Đếm kế hoạch/gói/hợp đồng theo workspace, trạng thái và thời gian | Summary server-side, index `(organization_id, is_latest, archived_at, date)` |
| Danh sách kế hoạch | Workspace + latest + khoảng ngày/tháng + tìm kiếm | Cursor pagination, date/month index, FTS5 |
| Danh sách gói thầu | Workspace + kế hoạch + trạng thái/hình thức + tìm kiếm | Server pagination, parent/status index, FTS5 |
| Nhà thầu/chủ đầu tư | Workspace + latest + tên/mã/mã số thuế | Server pagination, unique business-key index, FTS5 |
| Hợp đồng | Workspace + kế hoạch/nhà thầu + ngày ký | Relation/date index, FTS5 |
| Chi tiết gói | Gói theo ID rồi tải child-list, mở thầu và đánh giá | FK/index theo `(organization_id, goi_thau_id)` |
| Sync delta | `sync_version` lớn hơn cursor; tombstone theo delete version | Index `(organization_id, sync_version)` |
| Full bootstrap | Manifest ID + reference DTO; bảng lớn không tải toàn bộ | Paginated keys và record manifest |
| Export | Flush mutation, chụp `sync_version`, truy vấn snapshot đã commit | Idempotency, rate limit và document worker |

Các plan quan trọng được khóa bằng `tests/api/test_query_plans.py`. Test cũng phát hiện index không unique có cùng danh sách cột và kiểm tra FTS tiếng Việt không dấu.
