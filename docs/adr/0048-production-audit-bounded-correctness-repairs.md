# ADR 0048 — Sửa các lỗi đúng đắn phát hiện trước production

- Trạng thái: Accepted trong phạm vi sửa lỗi được chủ sản phẩm yêu cầu ngày 01/10/2026
- Phạm vi: báo giá/checkout, xuất Word, phục hồi mutation bị từ chối, tải danh mục địa chỉ đối tác, nhập/lưu mở thầu
- Liên quan: ADR 0015, 0018, 0044; `AGENTS.md` và `CONTEXT.md`

## Contract được bảo toàn

Không đổi role, persona, tenant, module, assignment, record scope hoặc field visibility.
Người đã được quyền đọc vẫn xem đầy đủ trường nghiệp vụ. Entitlement Word chỉ
kiểm soát xuất/tải tài liệu. Không tạo capability đọc dữ liệu nhạy cảm.

## Quyết định triển khai

1. Báo giá và checkout tổ chức phải xác nhận membership quản lý hiện hành,
   không coi lựa chọn vai trò đã lưu trong session là bằng chứng membership.
   Chuyên viên do quản lý chủ động chọn vẫn không được mua như quản lý.
   Giữ nguyên ngoại lệ Super Admin của đường billing hiện hành và mua cho chính
   tài khoản cá nhân. Checkout giữ khóa owner hiện hành; quote dùng khóa đọc
   membership trong transaction để không thêm chu kỳ khóa account/organization
   với tác vụ quản lý thành viên. Không thay session/permission ở phân hệ khác.
2. Xuất chính thức không tiếp tục nếu còn mutation chưa được xác nhận, đang chờ
   chuyển persona hoặc workspace đã thay đổi. Dùng cursor đã commit khi thực sự
   không còn mutation; không đánh đồng `ok: true, skipped: true` với commit mới.
   Bổ sung ngày 03/10/2026: trước khi chọn phiên bản xuất, chờ complete workspace
   pull từ máy chủ và kiểm tra lại workspace, persona, pending mutation. Push ACK
   hoặc route bootstrap partial không chứng minh cursor pull đã cập nhật. Không
   fallback sang cursor cũ khi pull lỗi, partial hoặc thiếu phiên bản.
   Persona được capture trước đồng bộ và kiểm tra lại sau mỗi lượt chờ; cập nhật
   vai trò trong cùng workspace token cũng phải hủy chuẩn bị xuất của lượt cũ.
3. Lỗi transport, 429/5xx hoặc response không xác định khi khôi phục không phải
   bằng chứng bản ghi không tồn tại. Chỉ kết quả canonical mới quyết định
   phục hồi hoặc loại projection do mất phạm vi. Giữ nội dung rejected thành
   bản nháp tách khỏi active outbox, không tự replay. Không xác nhận hoàn tất
   phục hồi từ một full bootstrap vốn không trả chi tiết bảng phân trang.
4. Kiểm tra URL checkout PayOS tại adapter chung cho create/query/cancel,
   giữ allowlist HTTPS hiện hành, chữ ký và provider giả lập không đổi.
5. Bổ sung ngày 03/10/2026: biểu mẫu Chủ đầu tư/Nhà thầu mở sau khi giá trị
   biểu mẫu sẵn sàng; danh mục tỉnh/xã tải riêng. Hiển thị đầy đủ giá trị đã
   lưu ngay khi mở, giữ nội dung người dùng nhập trong lúc chờ và bỏ phản hồi
   thuộc biểu mẫu/DOM cũ. Không đổi validation, quyền, giá trị mặc định hoặc
   định dạng lưu địa chỉ. HTTP 200 của upstream thiếu `wards` dạng danh sách
   trả lỗi 502 hiện hành và không được cache thành danh sách rỗng hợp lệ.
6. Bổ sung ngày 03/10/2026 theo báo lỗi của chủ sản phẩm: tab Mở thầu độc lập
   và Chi tiết gói cùng tồn tại trong DOM. Nhập nguồn, dựng dòng, đọc/lưu,
   phân trang và cập nhật trạng thái vi phạm chỉ dùng biểu mẫu thuộc tab
   đang hoạt động. Không đọc bảng ẩn hoặc gộp dòng của hai gói. Bảng không
   còn dòng phải báo chưa có dữ liệu trước khi đổi ngày, trạng thái hay xóa
   bản ghi cũ; không báo lưu thành công hoặc chuyển sang đánh giá.
   Nguồn không có nhà thầu ở pha kỹ thuật phải giữ nguyên dòng, thời gian
   và preview đang nhập; không ghi đè bảng bằng tập rỗng của pha tài chính.

## Compatibility impact

Phiên từng chọn Quản lý nhưng membership đã `left` hoặc bị hạ về `employee`
không tiếp tục tạo báo giá/checkout tổ chức. Đây là thực thi membership hiện
hành, không thu hồi quyền đọc bản ghi ngoài contract. Tài liệu Word chưa tạo
cho đến khi dữ liệu được xác nhận; lỗi được báo rõ thay vì xuất snapshot cũ
như kết quả của phần nhập mới. Phục hồi có thể chờ khi mạng/lưu trữ chưa sẵn sàng.
Xuất có thể cần thêm một lượt đọc máy chủ để xác nhận snapshot đầy đủ sau save;
không nâng cursor từ push ACK và không bỏ kiểm tra `EXPORT_SNAPSHOT_STALE`.
Danh mục địa chỉ chưa tải xong không trì hoãn việc mở biểu mẫu. Lựa chọn đã
lưu, địa chỉ thô và các trường nghiệp vụ vẫn hiển thị; kết quả tải về chỉ cập
nhật biểu mẫu hiện hành và bảo toàn chỉnh sửa mới của người dùng.
Biên bản nhập từ Mua Sắm Công xuất hiện và được lưu trong đúng gói đang mở.
Không đổi mapping nguồn, quyền hoặc các trường được phép xem. Form rỗng do
không có/dữ liệu chưa dựng xong không được coi là biên bản đã lưu hợp lệ;
đường xóa dòng cuối hiện hành vẫn tạo dòng nhập trống và yêu cầu nhập nhà thầu.

## Migration và rollout

Không có migration PostgreSQL, backfill hay thay đổi schema/API nghiệp vụ.
Metadata phục hồi cục bộ additive theo exact tài khoản/workspace; không chuyển
draft thành mutation. Triển khai backend và bundle tương ứng; lưu draft trước
khi bỏ rejected receipt. Không xóa lịch sử thanh toán hoặc dữ liệu nghiệp vụ.
Recovery archive được lưu tách khỏi outbox ở cả localStorage và IndexedDB;
hydrate archive trước push. Receipt `prepared` được đối chiếu từng operation
bằng nội dung với generation hiện tại, không adopt mutation mới không liên quan.
Delete legacy thiếu snapshot version/nội dung và đã đổi batch identity phải
giữ pending, không đoán để discard hoặc POST. Khi cả hai nơi lưu đều lỗi chỉ
cam kết giữ nội dung trong phiên đang mở; không khẳng định durability qua reload.

Chủ sản phẩm đã chốt `ROW_VERSION_CONFLICT` ngày 01/10/2026: giữ nội dung nhập
đến F5, sau F5 tải dữ liệu máy chủ, không tự replay. Quyết định superseding và
regression seams ghi tại [ADR 0049](0049-conflict-input-until-f5-and-canonical-reload.md).

## Regression seams

- Membership `left`/downgrade sau role selection; active manager, personal owner,
  selected employee và ngoại lệ Super Admin; PostgreSQL khóa đồng thời.
- Export pending/skipped/persona/cursor/workspace và các caller Word hiện hành;
  complete pull sau ACK 42 trong khi cursor 38, partial/missing/failure và thay
  đổi workspace/persona/mutation trong lúc chờ pull, gồm cập nhật persona tại
  chỗ trong cùng workspace token.
- Canonical lookup lỗi mạng/HTTP/schema, absence/denial, receipt base, draft
  persistence, reload/rebuilt generations, no replay, workspace fence, newer
  correction cùng hàng hoặc không liên quan, ambiguous deletes, bảng phân trang,
  lỗi self-wait push/pull và archive hydration, overlay state/cache/queue thật.
- PayOS signed GET/cancel URL không hợp lệ, omission/null/empty tương thích,
  create bắt buộc URL và provider giả lập.
- Biểu mẫu đối tác trên DOM thật khi catalog còn chờ: mở từ nút/route,
  điều hướng, dữ liệu đã lưu/địa chỉ thô, nhập mới, mở bản ghi khác, readonly
  và phản hồi tỉnh/xã cũ; HTTP 200 malformed rồi valid, valid empty/nonempty
  và cache giữ đầy đủ các trường upstream.
- Chromium với loader và module thật: nhập prepare/apply, lưu và dựng đánh
  giá; hai route mở thầu cùng mounted; form mất dòng không persist/chuyển
  trạng thái/xóa bản ghi cũ; mở lại biên bản và bảo toàn nháp gói khác ở cả
  hai thứ tự mount; nguồn chỉ có pha tài chính giữ nháp kỹ thuật. Metadata
  schema 1 và tiền dạng chuỗi dựng được 1/202 dòng.
