# Evaluation và lot scope

## Định danh phạm vi

- Package: `goi_thau.id`, lineage qua `id_goc`.
- Evaluation round: `vong_danh_gia.id`.
- Bid/opening: `thong_tin_mo_thau.id`.
- Lot: `goi_thau_phan_lo.id`; package không phân lô dùng whole-package scope.
- Bidder goods: khóa nghiệp vụ theo package + bid + requirement + lot.

Route/workspace snapshot giữ `packageId`, `workflowTab`, `evaluationRoundId`, `bidId`, `detailTab`, `lotScope`. F5/back/forward phải round-trip các giá trị này; dữ liệu nhạy cảm không nằm trong URL.

Evaluation không được trộn lot: bidder selector, goods requirement, price comparison, low-price decision, ranking và award đều lọc theo active lot. Với 1G2T, technical và financial round là scope riêng. Award partial chỉ cập nhật lot/batch liên quan và không khóa các lot chưa hoàn tất.

Với mọi loại gói, `giaXepHang` là giá so sánh chính để xếp hạng trong các phương pháp có thành phần giá, bao gồm Giá thấp nhất, Giá đánh giá và Kết hợp giữa kỹ thuật và giá. Trạng thái tính ưu đãi không được chặn việc xếp hạng hoặc thay `giaXepHang` bằng giá sau ưu đãi.

Backend authorization kế thừa package assignment cho opening/goods/bidder-goods. Cross-tenant luôn deny; employee được phân công nhận đủ identity/financial/signature cần thiết cho hồ sơ.
