# ADR 0030 — Tên căn cứ dẫn xuất cho ánh xạ Word

- Trạng thái: Chấp nhận
- Ngày: 2026-08-30
- Phạm vi: Căn cứ lập Kế hoạch LCNT và xuất Word

## Bối cảnh

Người dùng nhập mỗi căn cứ dưới dạng một câu text tự nhiên. Một câu có thể chứa
loại/tên văn bản, số/ký hiệu, ngày ban hành, đơn vị ban hành và phần trích yếu sau
“về việc”. Biểu mẫu Word cần vừa in nguyên văn, vừa có một biến tên căn cứ thuận
tiện, đồng thời vẫn cho phép chọn riêng từng thành phần.

## Quyết định

1. Giữ `noi_dung_goc` làm nội dung nguyên bản có thẩm quyền.
2. Parser xác định và có phiên bản lưu các thành phần `ten_van_ban`, `so_van_ban`,
   `ngay_ban_hanh`, `don_vi_ban_hanh` và `trich_yeu` (ngày là ngày ban hành/ký được
   viện dẫn, không phải ngày hiệu lực).
3. Sinh `ten_can_cu`/`tenCanCu` **dẫn xuất**, không tạo cột lưu riêng và không nhận
   giá trị này từ client:
   - có cả tên văn bản và trích yếu: `<ten_van_ban> về việc <trich_yeu>`;
   - chỉ có một phần: dùng phần không rỗng;
   - cả hai rỗng: chuỗi rỗng.
4. Lưu collection có thứ tự trong child table version-owned `ke_hoach_can_cu`, có
   physical ID và lineage ID. Parser `can-cu-citation-v1` chỉ chạy khi tạo hoặc sửa
   câu gốc; `PARSED`, `PARTIAL`, `UNPARSED` không làm mất câu gốc. Clone phiên bản
   giữ projection/parser version và lineage nhưng cấp physical ID mới, không parse lại.
5. Word dùng một custom list mapping alias selected-only
   `ds_can_cu_lap_ke_hoach`. Alias lấy selected DTO từ internal source
   `ke_hoach_can_cu`; không đăng ký alias đồng thời trong `PLAN_ROOT_SPECS` và không
   expose full collection qua nested `ke_hoach`. Trong loop,
   cung cấp `{noi_dung_goc}`, `{ten_can_cu}`, `{ten_van_ban}`, `{so_van_ban}`,
   `{ngay_ban_hanh}`, `{S_ngay_ban_hanh}`, `{don_vi_ban_hanh}`, `{trich_yeu}` và
   các helper `cum_*` presentation-only. Không tạo hai list mapping hoặc alias
   scalar cho cùng nguồn.
6. Dialog xuất Word chọn các căn cứ theo ID cho từng lần xuất; lựa chọn không ghi
   ngược vào kế hoạch. Thiếu selection là compat-all, `[]` là explicit zero, danh
   sách ID là exact subset theo thứ tự server. Từ điển biểu mẫu cung cấp hai recipe:
   nguyên văn và tách trường.
7. Direct export có POST JSON additive trên path hiện hữu và vẫn giữ GET cũ.
   Background policy v3 niêm phong exact IDs để source-authority completion dựng lại
   đúng digest; worker render/retry vẫn dùng immutable queued context. Policy v1/v2
   tiếp tục dùng legacy context contract.

## Hệ quả, tương thích và triển khai

- Câu gốc không bị mất khi parser thiếu hoặc mơ hồ; `tenCanCu` chỉ là tiện ích và
  không được dùng để dựng lại câu viện dẫn có số/ngày/đơn vị nằm ở giữa.
- Template cũ và quyền/hiển thị dữ liệu hiện hữu không đổi. Word entitlement chỉ
  kiểm soát hành động xuất tài liệu.
- Child table, parser projection, mapping/manifest và durable-job changes được triển
  khai additive bằng migration schema v83 và mapping v16 (schema v82 đã được dùng
  cho product-usage analytics trước thời điểm triển khai). Plan cũ có zero child
  rows, không backfill bằng suy đoán. Rollback binary
  phải hiểu schema đã expand; không xóa table/dữ liệu để rollback thông thường.
- Client cũ thiếu child field thì preserve, thiếu Word selection thì compat-all;
  queued job v1/v2 và template đã publish giữ nguyên hành vi/bytes.
- Regression test phải khóa công thức `tenCanCu`, raw/structured Word output,
  selected-only semantics, mixed parse status/null-to-empty rendering, direct/job
  parity, v1/v2/v3 source-authority compatibility, migration fresh/upgrade, version
  clone/comparison/delete và toàn bộ authorization hiện hữu.
