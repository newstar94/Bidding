# ProcurementCase shadow và cutover

Áp dụng ADR 0012. `PROCUREMENT_CASE_ENABLED=false` là trạng thái mặc định. Case kế thừa toàn bộ quyền đọc/ghi của Gói thầu cha; responsibility và party không cấp quyền. Không có masking mới và Word entitlement không tham gia.

## Triển khai

1. Chạy migration v72 và `python scripts/generate_postgres_schema_contract.py --check`.
2. Chạy `python scripts/procurement_case_inventory.py`; báo cáo luôn là read-only và không ghép request/response legacy bằng vị trí, thời gian hay nội dung.
3. Bật flag trên canary. Xác nhận legacy hiển thị `LEGACY_UNLINKED`, case mới giữ exact package version trên mỗi response/transition và deadline manual là `NOT_EVALUATED`.
4. Theo dõi audit `procurement_case.*`, lỗi CAS, observation mismatch và file attachment thiếu.

Rollback tắt flag, giữ nguyên case/history/attachment/source observation và tiếp tục đọc/ghi legacy theo seam cũ. Không xóa hay ghi ngược dữ liệu case vào list legacy.

