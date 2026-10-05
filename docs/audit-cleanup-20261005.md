# Rà soát và dọn mã BiddingFlow — 2026-10-05

## Phạm vi và cách kiểm tra

Rà soát được thực hiện trước khi sửa, trên HEAD
`d39509bc67adc1226d6c5a88ff5111cf262ffa3d`; cây Git ban đầu sạch.

| Phần | Phạm vi kiểm kê và đối chiếu |
| --- | --- |
| Frontend | 365 module JavaScript, 49 HTML và 23 CSS của ứng dụng; điểm vào công khai, đăng nhập, workspace, admin, checkout, Word/Excel và luồng đấu thầu |
| Backend | 362 module Python, 3.441 hàm, 291 lớp, 250 khai báo route/mount/websocket; startup, worker, auth, sync, AI, tài liệu, thương mại và nhập dữ liệu |
| DB | 13 tệp DB và helper liên quan; 132 bảng, 605 index, 98 trigger; schema hiện hành, schema lịch sử, mapping và chuỗi nâng cấp 2–99 |
| Công cụ và tệp ứng dụng | Scripts, deploy, CI, package allowlist, shared JSON, tài sản, cache, kết quả kiểm thử và các điểm chạy thủ công |

Đối chiếu quan hệ import, tham chiếu symbol, lời gọi động, HTML tải trực tiếp,
registry nghiệp vụ, CLI, test và tài liệu vận hành. Backend AST phân tích 684
tệp Python; không có lỗi parse hoặc import/biến thừa theo Ruff F401/F841.
Frontend có 364 module được tải từ điểm vào và một facade hợp đồng kiểm thử;
không có module mồ côi, import chưa giải quyết hoặc vòng import.

## Các phần đã xóa

- 31 khai báo hàm, lớp, hằng và stub không có nơi sử dụng: các adapter cũ của
  AI, thanh toán, Word, nhập dữ liệu, analytics, chuẩn hóa tên và helper DB;
  hai helper frontend không có người gọi.
- Nhánh `recoveryCount/recoveryPending` còn sót từ Conflict Center đã bỏ.
- Tám tên bảng không còn tồn tại trong danh sách trigger hiện hành. Đối chiếu
  trước/sau tạo đúng 188 câu SQL giống hệt; DDL migration lịch sử giữ nguyên.
- Bốn mục tham chiếu `package_legal_binding` và `package_legal_binding_head`
  trong registry quan hệ và kiểm soát sửa bản ghi; bảng đã nghỉ ở schema v99.
- Allowlist trùng và nhánh `else` không thể chạy trong worker xuất Excel;
  giữ nguyên bảy thao tác được hỗ trợ và các giới hạn sandbox.
- 12 giá trị màu fallback lặp lại token đã được tải, và bốn `!important`
  ở nút tiêu chí. CSS giữ nguyên kết quả hiển thị đã kiểm chứng.

Không có cả module đang hoạt động nào được xóa chỉ vì thiếu import tĩnh.
Các điểm vào HTML, dispatcher nạp module bằng tên, callback framework,
protocol/provider extension, CLI và helper có hợp đồng kiểm thử được giữ.

## Lỗi logic phát hiện và sửa

### Mốc thời gian khởi tạo phiên

`setupAuth` ghi mốc kiểm tra trước khi tự cập nhật trạng thái của phiên đã
được xác thực. Khi hai thao tác khác nhau 1 ms, guard coi chính kết quả đó là
cũ, bỏ qua cập nhật capabilities; đăng xuất HTTP 503 sau đó khôi phục cache
rỗng. Harness cố định thời gian đạt, harness tăng từng ms thất bại đúng triệu
chứng; đây là lỗi runtime, không phải kỳ vọng kiểm thử sai.

Mốc thời gian được cập nhật sau các thao tác khởi tạo đồng bộ trong nhánh
phiên đã xác thực. Đường kiểm tra qua mạng và guard cho phiên mới giữ nguyên.
Hai regression kiểm tra khôi phục sau HTTP 503 và bỏ qua kết quả của phiên cũ.

### Fixture kiểm thử migration

Test catalog v46 trước đây chạy toàn bộ chuỗi đến v99, hạ metadata về v45,
rồi chạy lại chuỗi vào cùng kho lưu trữ. v99 đúng thiết kế từ chối collision.
Fixture nay tạo catalog mới trực tiếp trước khi mô phỏng metadata cũ; giữ
kiểm tra OID không thay đổi ở v46 và kiểm tra nâng cấp tiếp đến v99.
Không sửa migration hoặc nới guard chống collision.

## Dọn tệp sinh ra

Lượt đầu đã loại 1.220 tệp, 73.842.116 byte (70,4 MiB): cache Python/Ruff/pytest,
coverage, log kiểm thử tạm, báo cáo Playwright cũ, công cụ CI tải trong scratch
và kết quả audit cũ. Trước khi xóa, xác minh đường dẫn nằm trong workspace,
không chứa tệp tracked hoặc reparse point, tạo ZIP ngoài ứng dụng và kiểm tra
hash từng tệp. Cache sinh lại trong kiểm chứng được dọn ở lượt cuối.

Lượt cuối loại thêm 771 tệp cache/kết quả sinh lại, 11.177.783 byte, và bốn
thư mục code đã bỏ còn rỗng. Đây là lượt dọn sau kiểm thử, không phải 771 tệp
nguồn mới bị loại. Cả hai lượt đều có manifest và ZIP khôi phục riêng.

Kho khôi phục và manifest:
`C:\Users\newst\AppData\Local\Temp\bidding-code-cleanup-20261005-134838`.

Không dọn database, dữ liệu vận hành, cấu hình riêng, bản phát hành, private
symbols, tài sản thương hiệu, tài liệu người dùng hoặc dependency đã cài.
Không commit, pull, reset, đổi nhánh, restart hay triển khai hệ thống đang chạy.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run check:static` | Đạt, exit 0; schema runtime, fixture v1, Python quality, encoding, module graph, reachability, debt và E2E discovery |
| `npm run build` | Đạt, exit 0; 172 bundle qua kiểm tra secure build |
| Frontend kiểm tra trọng điểm | 114/114; đánh giá chi tiết 8/8 |
| CSS Chromium trước/sau | 192 trường hợp, 0 khác biệt về màu, nền, viền, display, opacity và kích thước |
| Backend trọng điểm | 317/317; worker/export 73/73; aggregate/sync 66/66 |
| DB ngoại tuyến | 35/35; không kết nối DB; schema và trigger SQL tương đương |
| Auth/session/startup sau sửa timing | 56/56; harness lỗi ban đầu và hai regression đều đạt |
| Python toàn bộ, lượt đầu | 2.963 đạt, 2 lỗi, 11 bỏ qua, 1 browser test không chọn; 1.307,33 giây |
| Hai lỗi Python sau sửa | Nhóm kiểm tra lại 7/7 đạt trên ba DB tạm schema v99 |
| Webhook PostgreSQL bổ sung | 18/18 đạt; bù chín case thiếu biến DB ở lượt đầu |
| JavaScript toàn bộ, lượt đầu | 2.278/2.279 đạt; một lỗi timing phiên đã tái hiện và sửa như trên |
| JavaScript toàn bộ, lượt cuối | **2.281/2.281 đạt**, 0 lỗi, 0 bỏ qua, exit 0; 614,09 giây |

Không chạy lại toàn bộ Python sau hai sửa cuối; các seam
bị ảnh hưởng đã kiểm tra lại. Hai case symlink không chạy do Windows không
cho tạo symlink. Một bài browser Python không nằm trong lượt unit/integration;
không chạy toàn bộ hành trình E2E của sản phẩm trong đợt dọn này.

Tất cả DB và role được tạo cho kiểm thử đã được xóa bằng cleanup của từng lượt;
không nâng cấp DB ứng dụng hoặc DB TEST hiện hữu.

## Giữ lại để xử lý riêng

1. `backend/documents/template_catalog/routes.py`: factory route catalog Word
   có test gọi trực tiếp nhưng chưa được đăng ký vào app. Cần đối chiếu lộ
   trình catalog trước khi nối endpoint hoặc bỏ tính năng.
2. `backend/ai/conversation_repository.py`: hàm dọn lịch sử và cấu hình số ngày
   lưu hội thoại chưa có scheduler/caller. Không tự thêm hành vi xóa dữ liệu
   hoặc bỏ cấu hình này trong đợt dọn code.

Tenant isolation, role/module/assignment/record scope, session, audit, đầy đủ
dữ liệu được phép xem và quyền xuất Word giữ nguyên. Xung đột đồng bộ tiếp tục
lấy dữ liệu máy chủ làm chuẩn; outbox, CAS và các phiên bản nghiệp vụ còn dùng
không bị loại bỏ.

## Bàn giao

- Mã nguồn đã sửa trực tiếp trong workspace; HEAD giữ nguyên, chưa commit.
- `git diff --check`, bản build cuối và kiểm tra tĩnh cuối đều đạt.
- Evidence gồm inventory, báo cáo từng phần, log kiểm thử, đối chiếu CSS,
  trạng thái tạo/xóa DB tạm, manifest và ZIP của hai lượt dọn nằm trong thư
  mục Temp nêu trên.
- DB ứng dụng, DB TEST hiện hữu và các bản release ZIP được giữ nguyên;
  bản build frontend hiện hành đã được tạo lại từ mã nguồn mới.
