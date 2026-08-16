# ADR-022: Enrichment TBMT giới hạn ở giai đoạn mời thầu và thời gian hoàn thành mở thầu

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu giới hạn dữ liệu khi nhập kế hoạch và làm rõ quy tắc biên bản mở thầu

## Bối cảnh

Khi nhập một kế hoạch có nhiều TBMT liên kết, việc tải đồng thời biên bản mở thầu,
nhà thầu dự thầu, kết quả và hợp đồng làm tăng mạnh số request và có thể khiến
enrichment hết thời gian. Các dữ liệu này chưa cần thiết để tạo gói ở trạng thái
“Đang mời thầu”; người dùng sẽ lấy biên bản tại màn hình mở thầu khi thực sự cần.

Dữ liệu Mua sắm công cũng phân biệt giờ dự kiến mở thầu (`bidOpenDate`) và giờ
hoàn thành mở thầu (`successBidOpenDate`/`successBidOpenDateTc`). Trường thời gian
mở thầu của BiddingFlow được chủ sản phẩm xác nhận là giờ hoàn thành.

## Quyết định

### Enrichment khi nhập kế hoạch

- TBMT liên kết được thu thập với `detail_level="INVITATION"`.
- Mức này vẫn lấy và materialize dữ liệu cần để hoàn thiện gói mời thầu: tên và
  thông tin gói; lĩnh vực; hình thức, phương thức và phương pháp đánh giá; số/ngày
  quyết định E-HSMT; ngày đăng tải; thời hạn đóng/mở dự kiến; bảo đảm dự thầu;
  hiệu lực HSDT; tùy chọn mua thêm; danh mục hàng hóa; phần/lô; cùng các trường
  HSMT liên quan.
- Mức này không gọi endpoint biên bản mở thầu, danh sách nhà thầu nộp hồ sơ, kết
  quả kỹ thuật/tài chính, kết quả lựa chọn nhà thầu, hợp đồng hoặc dữ liệu hậu kỳ.
- Raw snapshot mức `INVITATION` được lưu và tái sử dụng theo cùng organization,
  mã gói, revision và thời hạn cache. Snapshot này không được coi là `COMPLETE`
  cho một thao tác cần dữ liệu hậu mở thầu.
- Luồng lấy biên bản mở thầu tại màn hình chi tiết gói tiếp tục dùng nguồn đầy đủ
  tại thời điểm người dùng bấm lấy dữ liệu.

### Thời gian và nhà thầu trong biên bản mở thầu

- `openingAt` ưu tiên giờ hoàn thành (`successBidOpenDate`,
  `successBidOpenDateTc`), sau đó mới đến giờ thực tế tương đương; `bidOpenDate`
  chỉ là dự kiến và là fallback khi nguồn chưa có giờ hoàn thành.
- Canonical giữ riêng `completedOpeningAt` và `scheduledOpeningAt` để không làm
  mất ý nghĩa của hai mốc nguồn.
- Có `ventureCode` hoặc `ventureName` là đủ để phân loại nhà thầu là liên danh,
  kể cả khi payload không trả danh sách thành viên. `contractorType` và danh sách
  thành viên nguồn vẫn là bằng chứng bổ sung.
- Khi là liên danh, biểu mẫu dùng tên liên danh từ nguồn và giữ mã nhà thầu đại
  diện hiện có. Không tự điền thành viên liên danh; người dùng nhập và xác nhận
  thủ công.

## Tác động tương thích

- Các gói được nhập từ kế hoạch vẫn có đầy đủ dữ liệu đến trạng thái “Đang mời
  thầu”, nhưng request chuẩn bị kế hoạch không còn tải dữ liệu hậu mở thầu.
- Biên bản cũ không bị migration hoặc viết lại. Lần lấy dữ liệu mở thầu tiếp theo
  sẽ dùng giờ hoàn thành và cách phân loại liên danh mới.
- Không thay đổi role, module permission, capability, entitlement, tenant
  isolation, assignment scope, record scope, masking hoặc dữ liệu người dùng được
  phép xem.

## Migration strategy

Không cần migration schema. Triển khai backend và frontend cùng phiên bản. Raw
snapshot `COMPLETE` cũ vẫn dùng được cho thao tác đầy đủ; snapshot `INVITATION`
mới được phân biệt bằng `detailLevel` và chỉ phục vụ enrichment mời thầu.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_opening_uses_completion_time_and_detects_venture_from_real_shape`
- `tests/js/procurement_import_wizard.test.mjs` kiểm tra tên/phân loại liên danh và
  không tự điền thành viên.
- `tests/test_procurement_import_service.py::test_plan_linked_notice_uses_invitation_only_source_and_caps_local_projection`
- `tests/test_procurement_import_service.py::test_prepare_plan_all_cold_then_warm_uses_raw_cache_and_exact_linked_notice_version`
- `tests/js/muasamcong_session_transport.test.mjs` kiểm tra mức `INVITATION` vẫn
  lấy tender/HSMT/plan-package nhưng không gọi opening/result/contract.
- `tests/test_procurement_raw_snapshot.py::test_invitation_notice_snapshot_excludes_post_opening_sources`
