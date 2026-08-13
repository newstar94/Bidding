# BiddingFlow — quy tắc nghiệp vụ bắt buộc

## Không được tự ý thay đổi hiển thị dữ liệu hoặc quyền

Đây là business contract do chủ sản phẩm xác nhận và có mức ưu tiên cao hơn mọi suy luận, khuyến nghị hardening chung hoặc tài liệu audit cũ:

1. Không được tự ý thêm, bỏ hoặc thay đổi masking, redaction, ẩn trường, làm mờ, rút gọn, lọc response hay giới hạn dữ liệu mà người dùng đang được phép xem.
2. Không được tự ý thêm, bỏ, gộp, tách hoặc đổi semantics của role, module permission, record scope, assignment scope, capability, entitlement, inheritance hay default allow/deny.
3. Không được coi “an toàn hơn”, “least privilege”, “fail-closed” hoặc “best practice” là căn cứ đủ để thay đổi hành vi nghiệp vụ hiện hữu.
4. Nếu yêu cầu không nói rõ việc thay đổi quyền hoặc hiển thị dữ liệu, phải bảo toàn hành vi hiện tại. Nếu thay đổi là cần thiết để hoàn thành nhiệm vụ nhưng contract chưa rõ, phải dừng phần thay đổi đó và hỏi chủ sản phẩm trước khi sửa production code, schema, migration, UI hoặc test expectation.
5. Mọi thay đổi đã được chủ sản phẩm chấp thuận phải được ghi thành ADR/business contract, có compatibility impact, migration strategy và regression test tại các seam liên quan.
6. Test không được tự định nghĩa nghiệp vụ mới. Không được sửa expected value để hợp thức hóa một thay đổi quyền/hiển thị chưa được phê duyệt.

Contract cụ thể hiện hành:

- Người dùng đã có quyền đọc bản ghi theo tenant, module, assignment và record scope được xem đầy đủ dữ liệu của bản ghi đó, gồm CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và các trường liên quan.
- Quyền hoặc entitlement xuất Word chỉ kiểm soát hành động tạo/tải tài liệu Word; nó không được dùng để che hoặc mở dữ liệu trong màn hình/API đọc bản ghi.
- Không tạo capability đọc dữ liệu nhạy cảm riêng nếu chưa có yêu cầu nghiệp vụ mới được chủ sản phẩm xác nhận rõ ràng.
- Vẫn bắt buộc bảo toàn tenant isolation, module permission, assignment scope, record-level authorization, session checks và audit; contract này không cấp quyền đọc một bản ghi mà người dùng vốn không được phép truy cập.

