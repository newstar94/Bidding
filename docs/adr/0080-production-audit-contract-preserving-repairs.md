# ADR 0080 — Khắc phục audit production ngày 09/10/2026

- Trạng thái: sửa các lỗi đã được chủ sản phẩm yêu cầu; không tạo quyền/nghiệp vụ mới.
- Căn cứ: báo cáo F01–F18 ngày 09/10/2026; yêu cầu khắc phục toàn bộ, ngoại trừ F12.

## Quyết định và business contract

1. F01 áp ADR0017 và ADR0071: cùng mã/revision nguồn chỉ ghi một lượt thành công. Import và lookup dùng chung reservation, snapshot commit và ledger. Giữ thứ tự phần danh sách đủ lượt; không lấy các mục không được nhận lượt. Cache/retry/lỗi không tạo lượt mới.
2. F02 áp transition policy bất biến của release/quote/order ở báo giá, checkout và activation. `upgrade.start_new_term` với `activeTerm.manual_review` không tự đổi kỳ đang có hiệu lực; `downgrade.manual_review/selfService=false` không tự phục vụ. Giao dịch cũ đã thanh toán nhưng chưa áp dụng cần xét duyệt khi trái policy; không ghi đè subscription. Purchase giữ luồng nhận báo giá/thanh toán cũ và vẫn cần xét duyệt tại activation nếu có kỳ active. Renewal giữ đúng ADR0072.
3. F05 khôi phục quyền chủ tổ chức bổ nhiệm/thu hồi quản lý theo ADR0045. Ngoại lệ owner chỉ áp điều kiện ngang cấp; session/persona, tổ chức, chống tự đổi vai trò, chủ tổ chức và quản lý cuối cùng, audit/transaction vẫn được giữ.
4. F10 dùng `AccessDecision.message` đúng contract; trả `VERSION_SOURCE_WRITE_DENIED` 403 sau rollback. Không thay quyết định quyền.
5. F04/F08/F09/F16/F18 giữ owner/workspace/generation qua toàn bộ thao tác bất đồng bộ. Response cũ và rollback không được ghi vào scope mới; chuyển workspace bị hủy không báo thành công.
6. F17 chỉ đóng preview và báo hoàn tất khi có canonical confirmation. Pending/rejected/conflict giữ nội dung nhập để người dùng xử lý có chủ ý; không tự phát lại draft đã bị từ chối, không thay dữ liệu canonical theo draft.
7. F07 đưa DB/I/O/audit tài liệu qua lane hữu hạn và giữ transaction/cancellation ownership. F11 backup/verify/restore bao gồm immutable Word catalog khi có dữ liệu hoặc bật feature. F13 readiness phải chờ dữ liệu route đang đo và release ID phải khớp artifact; giữ budget hiện hành.
8. F12 giữ nguyên TLS/sandbox của browser Mua Sắm Công theo yêu cầu chủ sản phẩm. Không suy việc này thành chấp thuận phát hành production.
9. F06 phân biệt admission trước provider với kế toán usage thực tế: mỗi provider round giữ reservation riêng theo input/tool history mới; settle luôn giữ token đã quan sát, cả khi vượt estimate, lỗi hoặc hủy. Native adapter công bố actual usage ngay khi nhận; queue giữ snapshot riêng của producer dưới lock, kể cả usage consumer chưa đọc. Cleanup dừng producer, chờ hữu hạn, freeze rồi settle; producer không ghi DB hoặc đổi counters sau freeze. Usage trên cap chặn reservation tiếp theo, không bị xóa khi cleanup. Không charge estimate hoặc usage chỉ được provider trả sau cutoff, không thay giới hạn hoặc entitlement AI.
10. F14 biểu mẫu chuyên gia chỉ đóng sau canonical confirmation, giữ mở khi conflict/rejected/pending và không đóng lần mở mới do response của lần lưu trước.
11. F03 theo xác nhận chủ sản phẩm ngày 09/10/2026: người tạo đơn và chủ tổ chức hiện tại được xem trạng thái/hủy từng đơn thuộc tổ chức đang chọn, khi tổ chức và membership còn hoạt động. Chủ tổ chức nhận diện bằng `to_chuc.owner_user_id`, người tạo bằng `billing_orders.actor_user_id`; không suy quyền từ role quản lý. Giữ ngoại lệ Super Admin hiện có, vẫn giới hạn theo tổ chức đang chọn. Không cấp quyền usage balance/lịch sử chung của tổ chức hoặc đổi quyền mua. Hủy lấy lock tổ chức trước khi nạp lại session/account rồi order/command, và kiểm tra lại membership/owner trong transaction. Thanh toán đã xác minh không bị hủy; provider trả PAID khi đang hủy tiếp tục đối soát/kích hoạt idempotent hiện có.

## Compatibility impact

- Không thêm role/capability, không đổi masking/response của dữ liệu được phép đọc; giữ tenant/module/assignment/record scope và Word entitlement chỉ kiểm soát xuất.
- Báo giá/checkout bị policy chặn trả lỗi cụ thể trước tạo QR. Snapshot và lịch sử đơn/release bất biến không được sửa. Replay đơn đã áp dụng vẫn idempotent.
- Gói và subscription hiện hữu không bị backfill hoặc kích hoạt lại. Không gọi provider thật để kiểm thử.
- Endpoint từng đơn và hủy `/api/billing/orders/{public_id}` giữ payload hiện có. Workspace cá nhân vẫn chỉ đọc/hủy đơn tài khoản của chính người đăng nhập. Workspace tổ chức bỏ `BLOCKED_DECISION` cho hai thao tác đã chốt; chủ thể không có grant hoặc đơn ngoài tổ chức trả `NOT_FOUND`, không tiết lộ trạng thái đơn. Quyền mua của manager/Super Admin và API lịch sử cá nhân giữ nguyên.

## Migration strategy

Không migration schema hoặc sửa dữ liệu đang dùng cho các mục trên. Triển khai source đã kiểm chứng và artifact cùng release ID. Backup manifest mới vẫn đọc backup legacy; catalog cần được kiểm đủ trước restore. F03 dùng các trường owner/actor/membership hiện hữu, không gán chủ sở hữu hồi tố hoặc backfill người tạo; tổ chức thiếu chủ vẫn có thể truy cập từng đơn qua người tạo hợp lệ hoặc ngoại lệ Super Admin hiện có.

## Regression seams

- HTTP import/lookup, source identity, cache/missing quota/provider error và affordable partial batch.
- Quote, checkout với quote cũ, paid activation trong kỳ/hết kỳ, revision/replay và renewal.
- Route membership owner/manager với transaction/auth seam, denied aggregate-version rollback.
- F03 HTTP và service: creator/owner/manager/nonmember/cross-org/Super Admin, membership revoked/legacy, tổ chức inactive/owner thiếu, session revoked/workspace đổi, personal parity, cancel replay và verified-paid. PostgreSQL hai kết nối: membership admin org→account không deadlock với hủy; provider PAID thắng cuộc đua cancel chỉ ghi một payment fact/activation.
- Browser/source + model mutation lease, Excel canonical/pending/conflict/close/reopen, chatbot reset và workspace switch.
- Document event-loop/admission/cancellation, catalog backup/restore/digest, readiness và artifact identity.
- F14 phải được chẩn đoán và kiểm lại browser matrix; F15 build/package/currentness/extracted smoke sau bản sửa cuối. Local evidence không thay CI trên commit mới hoặc kiểm chứng host/provider production.
