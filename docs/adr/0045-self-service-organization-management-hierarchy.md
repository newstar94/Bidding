# Tổ chức tự tạo và quản lý tối cao

- Trạng thái: Accepted
- Ngày: 2026-09-14

Người dùng đã đăng nhập có thể tạo một tổ chức bằng mã số thuế và tên viết tắt; mã số thuế duy nhất ở cấp hệ thống được bảo vệ bằng unique index và transaction. Người tạo được ghi nhận là quản lý tối cao, khác với Super Admin nền tảng; chỉ quản lý tối cao được bổ nhiệm hoặc thu hồi quản lý. Thu hồi chuyển người được bổ nhiệm về `employee`, không xóa thành viên hay thay đổi nhiệm vụ hiện có. Mọi kiểm tra tenant, session, module, assignment và audit hiện hành vẫn được giữ nguyên.

## Compatibility impact

Hai trường nhận diện tổ chức được bổ sung nullable để tương thích dữ liệu cũ. Quy tắc phân công cho tổ chức cũ chưa có quản lý tối cao được cập nhật theo xác nhận ngày 2026-10-03 dưới đây; không tự gán chủ sở hữu hồi tố.

## Regression

Kiểm tra tạo tổ chức nguyên tử, mã số thuế trùng và cạnh tranh, người tạo là quản lý tối cao, phân quyền quản lý chỉ bởi chủ thể này, thu hồi về employee giữ nhiệm vụ, và cấm quản lý được bổ nhiệm giao việc cho quản lý ngang hàng hoặc tối cao.

## Bổ sung contract phân công ngày 2026-10-03

Chủ sản phẩm xác nhận:

- “Chỉ quản lý cao nhất được phân công cho các quản lý khác”.
- “Chỉ quản lý cao nhất được sửa, chuyển hoặc xóa phân công của các quản lý khác”.
- “Giữ ngoại lệ Super Admin hiện có”.
- Với tổ chức cũ chưa xác định quản lý cao nhất: “Chặn đến khi xác định quản lý cao nhất; giữ ngoại lệ Super Admin nếu được chọn”.

Quản lý cao nhất tiếp tục được nhận diện bằng `to_chuc.owner_user_id`, không bổ sung role hay capability. Với thao tác tạo, sửa, chuyển hoặc xóa phân công của quản lý đang hoạt động trong cùng tổ chức, luồng đơn lẻ và luồng đồng bộ theo lô phải áp dụng cùng quyết định: chủ tổ chức và Super Admin theo ngoại lệ hiện có được phép, quản lý được bổ nhiệm bị từ chối. Kiểm tra cả người nhận đang lưu và người nhận gửi lên để không vượt quy tắc bằng việc bỏ trường người nhận hoặc chuyển phân công từ quản lý sang nhân viên. Phân công của nhân viên tiếp tục theo các điều kiện hiện hành.

### Compatibility impact của bản sửa parity

Luồng đồng bộ theo lô trước đây bỏ qua kiểm tra cấp quản lý dù luồng đơn lẻ đã từ chối người nhận quản lý được gửi lên. Bản sửa làm hai luồng thống nhất và bổ sung kiểm tra người nhận đã lưu theo phạm vi sửa/chuyển/xóa được xác nhận. Ngoại lệ Super Admin hiện có được giữ nguyên. Phân công giữ nguyên do máy chủ sao chép khi tạo phiên bản aggregate tiếp tục được phép sau kiểm tra quyền tạo phiên bản ở bản ghi nguồn; đây không phải người nhận mới do client lựa chọn. Việc dọn phân công phụ thuộc khi xóa aggregate đã được phân quyền giữ cơ chế lifecycle hiện hành.

Kiểm tra người nhận quản lý đang lưu áp dụng cho mọi vai trò thực hiện thay đổi trực tiếp, gồm nhân viên; không được dùng quyền tự nhận bản ghi mới để chiếm mã phân công đang thuộc quản lý. Phân công mặc định do máy chủ tạo cho bản ghi thực sự mới tiếp tục theo cơ chế creator-default hiện hành, gồm quản lý đang dùng persona nhân viên; đây là hành vi lifecycle được giữ nguyên, không cấp quyền thay đổi phân công quản lý đã tồn tại.

Đối với dữ liệu cũ, khi không xác định được `owner_user_id` có giá trị, các thao tác trực tiếp trên phân công của quản lý bị chặn đến khi chủ tổ chức được xác định; ngoại lệ Super Admin vẫn áp dụng. Không tự suy luận người chủ từ role hay lịch sử tạo dữ liệu. Các điều kiện đọc dữ liệu, tenant, module, assignment, record scope, persona và entitlement giữ nguyên.

### Migration strategy

Không thay đổi schema, dữ liệu, role, membership hoặc phân công đã lưu. Không gán chủ sở hữu hồi tố. Triển khai chỉ thay kiểm tra ghi ở máy chủ; phân công trực tiếp bị từ chối trả lỗi truy cập qua cơ chế đồng bộ hiện hành. Context tái sử dụng bản ghi hiện tại đã nạp, nạp phần thiếu và membership người nhận theo nhóm tối đa 500 mã, và nạp chủ tổ chức một lần; kiểm tra từng bản ghi trong lô không truy vấn bổ sung. Luồng xóa truyền các bản ghi đã nạp vào context để kiểm tra được phân công chỉ gửi ID.

### Regression tại seam phân quyền và đồng bộ

`tests/test_assignment_manager_hierarchy.py` tái hiện lỗi trước sửa: đơn lẻ từ chối quản lý được bổ nhiệm phân công cho quản lý ngang hàng nhưng lô cho phép; sửa không gửi người nhận, chuyển sang nhân viên và xóa chỉ gửi ID đều vượt kiểm tra người nhận đang lưu. Một kiểm tra khác tái hiện nhân viên dùng quyền tự nhận bản ghi mới để thay đổi mã phân công đang thuộc quản lý, dù kiểm tra tham chiếu hợp lệ. Kiểm tra sau sửa bao gồm quản lý ngang hàng/tối cao, chủ tổ chức, người nhận nhân viên, tên trường JSON/database, membership theo tenant/trạng thái, owner thiếu/NULL/rỗng, ngoại lệ Super Admin, creator-default do máy chủ tạo, phân công được máy chủ kế thừa khi tạo phiên bản và lô 1/50/501 người nhận/phân công hiện tại có mã trùng. Kiểm tra `SyncRecordValidator.validate_payload` và `apply_sync_deletions` bảo đảm luồng đồng bộ từ chối bằng `RECORD_ACCESS_DENIED`, giữ bản ghi khi bị từ chối, cho phép xóa hợp lệ bởi chủ tổ chức/Super Admin và không nạp lại từng phân công trong luồng xóa.
