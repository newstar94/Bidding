# ADR-017: Timeline hiển thị dòng gói và giữ phả hệ quyết định E-HSMT

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu sửa timeline của `IB2600212155`

## Bối cảnh và quyết định

Một gói thầu có thể có nhiều snapshot phiên bản nhưng vẫn là một dòng gói nghiệp vụ. Timeline trước đây đưa trực tiếp mọi snapshot vào bộ chọn `Gói thầu`, đồng thời dùng quyết định E-HSMT của phiên bản đang chọn cho cả mốc phê duyệt gốc và mốc điều chỉnh.

Quy tắc timeline được xác nhận:

- Bộ chọn `Gói thầu` chỉ hiển thị một đại diện mới nhất cho mỗi `rootId`.
- Các snapshot `00`, `01`, ... của cùng dòng gói chỉ xuất hiện trong bộ chọn `Phiên bản`.
- Mốc `QĐ phê duyệt E-HSMT` lấy số và ngày quyết định từ phiên bản gói thấp nhất trong cùng dòng phiên bản.
- Mỗi phiên bản gói từ `01` trở đi tạo mốc `QĐ phê duyệt điều chỉnh E-HSMT lần n` từ số và ngày quyết định của chính phiên bản đó.
- Với `IB2600212155`, timeline phiên bản `01` phải hiển thị quyết định gốc `124/QĐ-TTYT` và điều chỉnh lần 1 `125/QĐ-TTYT`.

Timeline tải phiên bản gốc theo metadata `allVersions` khi bản ghi đầy đủ chưa có trong bộ nhớ. Dữ liệu gốc không được ghi đè vào snapshot hiện tại và chỉ được dùng làm nguồn tự động cho mốc phê duyệt ban đầu.

## Tác động tương thích

- Không gộp hoặc xóa bản ghi phiên bản; thay đổi chỉ áp dụng cho cách chọn gói và dựng nguồn timeline.
- Bộ chọn phiên bản, chỉnh sửa timeline, lưu và xuất Excel tiếp tục làm việc trên đúng snapshot được chọn.
- Mốc timeline đặt `sourceMode = MANUAL` tiếp tục giữ giá trị người dùng đã nhập; quy tắc phả hệ áp dụng cho nguồn tự động.
- Không thay đổi role, permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Timeline hiện có được dựng lại từ dòng phiên bản khi mở. Bản ghi timeline đã chỉnh thủ công không bị ghi đè.

## Regression tests

- `tests/js/timeline_rule_engine.test.mjs` — `timeline package picker shows one package family and leaves revisions to the version picker`
- `tests/js/timeline_rule_engine.test.mjs` — `timeline keeps the original E-HSMT approval and maps revision 01 as adjustment 1`
- `tests/js/version_resolver.test.mjs` — kiểm tra chọn đại diện mới nhất ổn định theo `rootId`.
- `tests/js/workspace_loader_lease.test.mjs` — kiểm tra tải gói timeline không ghi dữ liệu sang workspace khác.
