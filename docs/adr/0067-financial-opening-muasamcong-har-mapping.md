# 0067 — Lấy dữ liệu mở E-HSĐXTC từ Mua Sắm Công

Ngày: 2026-10-06. Trạng thái: chấp nhận theo yêu cầu lấy dữ liệu tài chính và mapping từ hai HAR của chủ sản phẩm.

## Bằng chứng nguồn

HAR tư vấn `IB2600512536` và hàng hóa phân lô `IB2500426513` ghi nhận các endpoint
`notify`, `roundmng`, `bid-open`, `lotOpenDetail`, `lot-open` với
`packType: 2`, `viewType: 0`, `type: TBMT`, đúng mã TBMT và revision ID.
DTO round vẫn trả `packType: 1`; phase được xác định từ request nguồn.
Không dùng header, cookie hoặc token trong HAR để gọi lại nguồn. Fixture chỉ chứa
các trường JSON nghiệp vụ phục vụ mapping và các trường request đã cho phép.

## Quyết định

- Nút **Lấy dữ liệu tự động** trong mở tài chính gửi `openingPhase: FINANCIAL`.
  Collector lấy riêng năm nguồn packType 2 đã ghi nhận, không phụ thuộc các endpoint
  tài chính bổ sung không có trong hai HAR hoặc trạng thái mở kỹ thuật.
- Cache chỉ có phần kỹ thuật không được đáp ứng yêu cầu tài chính. Cache đúng
  revision phải có nguồn round/bid tài chính và nguồn lot nếu có phần lô.
  Cache tài chính chưa có dòng nhà thầu có giá không chặn lần lấy lại sau khi nguồn công bố dữ liệu.
- `successBidOpenDateTc` là thời điểm mở tài chính; `successBidOpenDate` và
  `bidOpenDate` không được dùng làm thời điểm tài chính. Khi thiếu trường hoàn tất,
  dùng `createdDateBidOpen` từ bản ghi tài chính. Màn hình điền ngày, giờ và phút
  theo formatter hiện có, không chuyển múi giờ của chuỗi giờ nguồn.
- Tư vấn lấy `bidPrice`, `saleNumber`, `bidFinalPrice`, `bidValidityNum` từ bidder summary.
  Phân lô lấy `lotPrice`, `discountPercent`, `lotFinalPrice` theo đúng nhà thầu và mã lô.
  Hiệu lực và bảo đảm dự thầu vẫn lấy từ summary đúng nhà thầu và phase.
  Chỉ bổ sung tỷ lệ 0 từ summary khi giá lô trước/sau giảm bằng nhau và summary
  có tỷ lệ 0; không phân bổ tổng giá hoặc tỷ lệ giảm dương của gói cho từng lô.
  Trường giá trúng thầu không phải nguồn giá mở hồ sơ.
- `lotNo` bằng mã `bidNo` là nhóm của gói, không tạo dòng phần lô.
- Chỉ điền các dòng đủ điều kiện đang có trên màn hình, khớp mã nhà thầu và phần lô.
  Giữ nguyên điểm kỹ thuật, danh tính và danh sách đủ điều kiện. Giá sau giảm nguồn
  được giữ khi thu thập dữ liệu để lưu; chỉnh giá/tỷ lệ thủ công vẫn tính lại như trước.
- Import chỉ điền bản nháp. Người dùng kiểm tra và bấm nút lưu hiện có; chỉ báo lưu
  thành công sau xác nhận canonical. Lỗi nguồn, dữ liệu trống/không khớp, trùng danh tính,
  dữ liệu sai định dạng, thay đổi bản nháp hoặc package CAS không sửa một phần bản nháp.
  Workspace/panel đã thay không nhận kết quả muộn. Không lưu đồng thời lúc lấy dữ liệu.

## Compatibility và migration

`openingPhase` là trường prepare tùy chọn, chỉ chấp nhận `FINANCIAL` hoặc bỏ trống.
Luồng mở kỹ thuật và chữ ký lời gọi source cũ giữ mặc định; apply tiếp tục chỉ nhận
preview và package CAS, không nhận payload nghiệp vụ do client tự khai.
Không đổi quyền, capability, entitlement, tenant/assignment/record scope, masking,
schema hoặc dữ liệu đã lưu. Không cần migration. Parser version tăng để nhận diện
mapping mới. Phát hành cần triển khai backend và build frontend cùng nhau.

## Kiểm chứng và giới hạn

- `test_financial_opening_har.py`: hai HAR, giá từng lô, ngày giờ tài chính, hiệu lực,
  loại nhóm giả, không lấy giá trúng thầu hoặc chia tỷ lệ summary dương cho lô;
  kiểm tra phase xuyên source/worker request.
- `test_procurement_opening_snapshot.py`, `test_procurement_import_routes.py`:
  cache đúng phase/revision, prepare/apply và module authority hiện hữu.
- `financial_opening_collector.test.mjs`: request khớp HAR, năm endpoint lõi,
  không yêu cầu các endpoint tài chính bổ sung, client giữ request mặc định cũ.
- `financial_opening_import_browser.test.mjs`: panel thực, client HTTP, mapping từ
  canonical parser thực, phút nguồn, giữ điểm kỹ thuật và dòng không đủ điều kiện,
  không lưu trước thao tác người dùng, chờ ACK giả lập và xử lý nguồn lỗi/stale.

Đây là kiểm chứng cục bộ từ HAR và phản hồi máy chủ giả lập trong regression;
chưa kiểm chứng phiên Mua Sắm Công trực tiếp hoặc triển khai production.
