---
status: accepted
date: 2026-08-19
---

# Cách ly xung đột phiên bản thành bản nháp phục hồi

Khi `/api/sync` từ chối một batch bằng `ROW_VERSION_CONFLICT`, BiddingFlow phải lưu bền vững toàn bộ checkpoint cục bộ thành bản nháp phục hồi trước khi dọn batch khỏi active outbox. Sau khi cách ly thành công, ứng dụng pull dữ liệu có thẩm quyền, hoàn tất startup reconciliation và cho phép các mutation khác tiếp tục đồng bộ. Cùng một tập bản ghi xung đột chỉ giữ một recovery draft mới nhất, nên reload không gửi lại mutation cũ và không lặp thông báo conflict.

Người dùng mở recovery draft bằng chỉ báo đồng bộ và chọn một trong ba hành động: để sau, bỏ bản nháp, hoặc áp lại vào dữ liệu mới nhất. Hành động áp lại chỉ chạy khi active outbox đang rỗng, thực hiện full pull/rebase, dùng request identity mới của outbox và chỉ báo thành công sau khi push cùng verification pull hoàn tất. Nếu recovery storage không ghi được, active outbox không bị dọn và cơ chế conflict chặn cũ được giữ để tránh mất dữ liệu.

`IDEMPOTENCY_KEY_REUSED` không phải xung đột phiên bản và tiếp tục được tự động phục hồi bằng request identity mới. Kế hoạch liên kết nguồn không được tự sinh phiên bản nghiệp vụ mới để né conflict; recovery draft được áp lại lên snapshot hiện hành có thẩm quyền, còn phiên bản nguồn mới chỉ được tạo qua workflow phiên bản chính thức.

## Compatibility impact

Không thay đổi tenant isolation, module permission, assignment scope, record-level authorization, role, entitlement, field masking hoặc dữ liệu người dùng được phép đọc. Snapshot lịch sử vẫn bất biến và chỉ xem. Server vẫn rollback toàn bộ sync transaction bị conflict; chỉ trạng thái cục bộ của client chuyển từ active outbox sang recovery draft. Các mutation không xung đột không còn bị một recovery draft khác chặn.

## Migration strategy

Không đổi schema server hoặc IndexedDB. Recovery draft dùng storage key theo workspace `bf_conflict_recovery_drafts_v1`; workspace chưa có key này được xem là không có draft. Active outbox cũ tiếp tục hydrate như trước. Conflict đang nằm trong outbox sẽ được cách ly ở lần sync kế tiếp; không purge hoặc tự động bỏ dữ liệu cục bộ.

## Regression seams

Regression tests khóa các seam sau: recovery draft sống qua reload; conflict lặp cho cùng bản ghi không tạo thông báo/draft trùng; recovery phải persist trước khi active outbox bị dọn; lỗi recovery storage không được làm mất outbox; startup hoàn tất sau khi cách ly; background sync pull dữ liệu có thẩm quyền; trạng thái hiển thị recovery là non-assertive; thao tác áp lại chạy theo thứ tự restore → full pull/rebase → push → verification pull; workspace race và outbox durability suites vẫn phải đạt.
