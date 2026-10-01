# ADR 0049 — Giữ nội dung xung đột đến F5, tải lại dữ liệu máy chủ

- Trạng thái: Accepted theo xác nhận trực tiếp của chủ sản phẩm ngày 01/10/2026
- Phạm vi: thao tác lưu bị máy chủ từ chối do xung đột phiên bản
- Supersedes: yêu cầu rollback projection ngay khi conflict trong ADR 0044;
  giải quyết mục chưa quyết định của ADR 0048

## Quyết định

Khi lưu bị xung đột, giữ nội dung người dùng đang nhập trên màn hình đến khi
nhấn F5, hiển thị trạng thái xung đột và không báo lưu thành công. Nội dung
bị từ chối không được tự gửi lại, force overwrite hoặc tự merge lên máy chủ.

Sau F5, tải dữ liệu máy chủ qua kiểm tra session và phạm vi hiện hành, thay
projection xung đột bằng kết quả có thẩm quyền. Không tự khôi phục nội dung
xung đột vào màn hình hay outbox. Nếu mạng/máy chủ không xác nhận được, báo
chưa đối soát, không gọi cache cũ là dữ liệu đã phục hồi thành công.

Thay đổi khác không thuộc xung đột vẫn được bảo toàn. Conflict Center nếu
được bật có thể giữ bản nháp riêng theo contract hiện hành để người dùng xử
lý chủ động; bản nháp đó không phải dữ liệu đã commit và không tự áp lại sau F5.

## Compatibility impact

Thay yêu cầu rollback ngay của ADR 0044 chỉ tại nhánh conflict. Không đổi
semantics validation rejection, mất phản hồi mạng hoặc transaction đã commit.
Không sửa role, tenant, module, assignment, record scope, entitlement hoặc
field visibility; giữ nội dung xung đột không cho phép giữ bản ghi đã bị thu
hồi phạm vi. Entitlement Word vẫn chỉ kiểm soát xuất/tải, không che dữ liệu đọc.

## Migration và triển khai

Không cần migration PostgreSQL hoặc sửa dữ liệu máy chủ. Không xóa toàn bộ
outbox hay draft không liên quan; không biến recovery draft thành mutation.
Mọi marker phục hồi phải theo exact tài khoản/workspace, không tồn tại như
overlay nội dung sau F5. Bản phát hành phải kiểm cả có/không Conflict Center
và lỗi lưu trữ/mạng; kiểm thử cục bộ không thay bằng chứng staging.

Bản nháp đánh giá tổng quát/chi tiết bị từ chối do `ROW_VERSION_CONFLICT`
cũng chỉ được giữ trong phiên hiện tại: hủy hẹn giờ autosave và loại đúng
khóa khôi phục của thao tác đó, không xóa bản nháp khác. Giữ các dòng người
dùng nhập không đồng nghĩa báo cáo đã hoàn thành; trạng thái hoàn thành chỉ
có hiệu lực sau xác nhận máy chủ. Lỗi mạng/409 khác không tự bị phân loại
thành xung đột phiên bản.

Nếu chưa thể retire receipt hoặc dọn cache/bản nháp bền vững, giữ tab và báo
chưa bảo đảm tải lại an toàn. Lỗi dọn cache sau khi receipt đã retire không
được đưa receipt bị từ chối trở lại hàng đợi.

## Regression seams

- Save conflict: nội dung còn hiển thị, không success toast hoặc replay.
- Đồng bộ nền trước F5: không ghi đè nội dung xung đột còn được phép đọc;
  thu hồi phạm vi vẫn có hiệu lực.
- F5/fresh model: hydrate outbox không chứa mutation bị từ chối; canonical
  full/detail lookup thay nội dung xung đột, kể cả bảng phân trang.
- Mutation không liên quan được giữ; draft Conflict Center không tự áp lại.
- Lookup hoặc lưu trữ thất bại: không báo phục hồi hoàn tất sai.
- Bản nháp đánh giá: kiểm đường lưu thật, hoàn thành bị từ chối, timer muộn,
  khóa retarget và bản nháp không liên quan; không success hoặc chuyển tab.
