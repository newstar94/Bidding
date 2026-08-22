# Business contract — Xuất bản Word

- Trạng thái: Đã được chủ sản phẩm xác nhận
- Ngày xác nhận gần nhất: 2026-08-22

## Phạm vi

Contract này quy định danh sách loại văn bản được hiển thị trên màn hình
`Xuất bản Word` sau khi người dùng chọn một Kế hoạch LCNT và Gói thầu mà họ
đã có quyền đọc theo tenant, module, assignment và record scope hiện hành.

## Quy tắc danh sách văn bản

- `Kế hoạch lựa chọn nhà thầu` áp dụng cho mọi Gói thầu.
- Với `Chỉ định thầu rút gọn` hoặc
  `Lựa chọn nhà thầu trong trường hợp đặc biệt`, chỉ hiển thị đúng hai mục:
  - `Kế hoạch lựa chọn nhà thầu`;
  - `Kết quả lựa chọn nhà thầu`.
- Với các hình thức lựa chọn còn lại, hiển thị bốn tài liệu tư vấn chung:
  - `Tư vấn lập, đánh giá Bước 1`;
  - `Tư vấn lập, đánh giá Bước 2`;
  - `Tư vấn thẩm định Bước 1`;
  - `Tư vấn thẩm định Bước 2`.
- Trong nhóm hình thức lựa chọn còn lại:
  - 1G1T hiển thị thêm `Báo cáo đánh giá E-HSDT`;
  - 1G2T hiển thị thêm đúng ba document có stable ID riêng:
    `Báo cáo đánh giá E-HSĐXKT`,
    `Quyết định phê duyệt nhà thầu đạt kỹ thuật`,
    `Báo cáo đánh giá E-HSĐXTC`;
  - hiển thị thêm `Báo cáo thẩm định, KQLCNT`.
- Document chưa có template/mapping thật vẫn giữ stable identity và được hiển
  thị ở trạng thái `Chưa cấu hình mẫu`; không tạo nội dung Word giả.

## Cài đặt biểu mẫu theo chức năng

- Mỗi stable document ID có thể được gán độc lập cho một hoặc nhiều file `.docx`
  đang tồn tại trong đúng phạm vi cá nhân/tổ chức hiện hành.
- Giao diện cấu hình không nhân bản toàn bộ danh sách biểu mẫu ở từng chức năng.
  Mỗi chức năng hiển thị hàng tóm tắt, tối đa ba chip tên file và tổng số đã gán;
  nút `Chọn biểu mẫu` mở một dialog dùng chung có tìm kiếm, lọc `Đã chọn`, thao
  tác chọn/bỏ chọn toàn bộ kết quả và phân trang tối đa 20 file mỗi trang.
- Bộ chọn vẫn là multi-select checkbox, không dùng dropdown một lựa chọn. Lựa chọn
  tạm được giữ khi tìm kiếm/chuyển trang và chỉ cập nhật bản nháp khi bấm `Áp dụng`;
  nút `Lưu cài đặt` mới ghi toàn bộ thay đổi xuống backend.
- Quản lý phạm vi quyết định độc lập từng file mẫu có được phép sử dụng hay không;
  có thể bật đồng thời nhiều file, không giới hạn ở một mẫu chính duy nhất.
- File mới tải lên mặc định ở trạng thái `Tạm ngừng`. Chỉ file được bật mới hiển
  thị `Sẵn sàng`, xuất hiện trong danh sách gán theo chức năng và được phép render.
- Khi một file chuyển sang `Tạm ngừng`, assignment tham chiếu tới file đó không
  được resolve hoặc xuất. Backend phải từ chối yêu cầu gán/xuất file đang tạm ngừng,
  kể cả khi client gửi trực tiếp tên file.
- Bảng chọn mở ra từ nút `Xuất Word` chỉ được liệt kê các file vừa được gán cho
  đúng chức năng vừa đang ở trạng thái `Sẵn sàng`; file `Tạm ngừng` không được
  xuất hiện trong bảng chọn, kể cả assignment cũ vẫn còn tham chiếu tới file đó.
- Nút `Xuất Word` không render ngay. Hệ thống phải mở bảng liệt kê tất cả file
  đã được gán cho đúng chức năng để người dùng chọn một hoặc nhiều file cần xuất;
  mặc định chọn tất cả và không cho xác nhận khi chưa chọn file nào.
- Chỉ các file được người dùng xác nhận mới được render từ cùng snapshot đã xác
  thực. Nếu chọn nhiều file, endpoint trả về một gói `.zip`; nếu chọn một file,
  endpoint trả về trực tiếp file `.docx`.
- Backend phải kiểm tra danh sách yêu cầu là tập con của assignment hiện hành,
  loại tên trùng và render theo thứ tự assignment đã lưu. Không được nhận một
  file tùy ý từ workspace hoặc workspace khác chỉ dựa trên dữ liệu frontend gửi.
- Quản lý tổ chức hoặc chủ phạm vi cá nhân được thay đổi assignment; thành viên
  khác chỉ được xem cấu hình theo quyền Word config hiện hữu.
- Thao tác bật/tắt biểu mẫu dùng đúng quyền quản lý Word config hiện hữu và phải
  ghi audit `document.word_template_availability_updated`; không tạo role hoặc
  capability mới.
- Assignment không được tham chiếu template của workspace khác và không được
  chứa cùng một template nhiều lần trong một chức năng.
- Khi đổi tên template, mọi assignment trỏ tới template đó được đổi theo. Khi
  xóa template, các assignment tương ứng bị gỡ và chức năng quay về trạng thái
  chưa cấu hình.
- Ba luồng đã hoạt động trước tính năng assignment (`procurement_plan`,
  `bid_evaluation_report`, `contractor_selection_result`) tiếp tục dùng active
  template đơn đang được bật làm fallback cho tới khi có assignment riêng. Trạng
  thái active này chỉ là compatibility data, không còn hiển thị như lựa chọn độc quyền.
- Backend phải kiểm tra stable document ID, context xuất và applicability theo
  dữ liệu canonical của Gói thầu; frontend không phải nguồn ủy quyền.

## Quyền và dữ liệu

- Contract này không cấp quyền đọc thêm bất kỳ bản ghi nào.
- Người dùng đã có quyền đọc bản ghi tiếp tục xem đầy đủ dữ liệu của bản ghi
  theo contract trong `AGENTS.md`.
- Entitlement Word chỉ kiểm soát hành động tạo/tải Word; không được dùng để ẩn
  thông tin Gói thầu hoặc danh sách loại văn bản.
- Tenant isolation, module permission, assignment scope, record authorization,
  session checks và audit giữ nguyên.

## Compatibility impact

- `Biểu mẫu Word` giữ nguyên route, phạm vi dữ liệu và quyền hiện hữu.
- Bảng `Biểu mẫu Word` cho phép bật/tắt nhiều template độc lập. Trạng thái
  `Sẵn sàng` do người quản lý quyết định, không tự suy ra chỉ vì file `.docx`
  tồn tại; trạng thái mẫu chính cũ chỉ còn là compatibility data.
- Bộ chọn template theo chức năng dùng một dialog multi-select dùng chung thay cho
  checklist lặp lại ở từng hàng. Payload, stable ID và assignment đã lưu không đổi;
  với 50–100 mẫu, DOM chỉ render tối đa 20 checkbox tại một thời điểm.
- Các stable ID báo cáo 1G1T/1G2T hiện hữu giữ nguyên; chỉ cập nhật nhãn hiển thị
  thành `Báo cáo đánh giá E-HSDT`, `Báo cáo đánh giá E-HSĐXKT`,
  `Quyết định phê duyệt nhà thầu đạt kỹ thuật` và
  `Báo cáo đánh giá E-HSĐXTC`.
- So với policy Xuất bản Word trước lần xác nhận gần nhất, hai hình thức rút gọn
  và đặc biệt không còn hiển thị tài liệu tư vấn, báo cáo 1G1T/1G2T hoặc báo cáo
  thẩm định KQLCNT.
- Không thay đổi API đọc bản ghi, masking, redaction hoặc response projection.
- Endpoint xuất cũ không truyền `publicationType` tiếp tục dùng active template
  nếu template đó đang được bật; đây là compatibility path cho các màn hình xuất
  Word hiện hữu và không được vượt qua trạng thái `Tạm ngừng`.
- API cấu hình mới dùng `assignmentSets` và `resolvedTemplateSets` để biểu diễn
  danh sách. Hai trường singleton `assignments` và `resolvedTemplates` vẫn được
  trả về với phần tử đầu tiên để client cũ tiếp tục đọc được.
- API đọc cấu hình trả thêm `revision`; mutation assignment và availability gửi
  `expectedRevision`. Ghi trên revision cũ bị từ chối bằng `409` thay vì ghi đè
  thay đổi của quản trị viên khác.
- Client Xuất bản Word mới gửi một tham số `templateFilename` cho mỗi file đã
  chọn. Endpoint không có tham số này tiếp tục xuất toàn bộ assignment để tương
  thích với client cũ; không thay đổi route hoặc entitlement xuất Word.
- POST `/api/templates/active` giữ tương thích: request cũ không có `enabled`
  vẫn chọn và bật mẫu; request mới dùng `enabled: true/false` để điều khiển trạng
  thái độc lập mà không tắt các mẫu khác.

## Migration strategy

- Không cần migration schema hoặc dữ liệu.
- Bảng chọn file chỉ thay đổi luồng tương tác và request query; không cần migration
  schema, assignment hoặc template hiện hữu.
- Redesign bộ chọn theo chức năng chỉ thay đổi presentation state phía client;
  không cần migration schema, API payload hoặc dữ liệu assignment.
- Trạng thái cho phép sử dụng được lưu trong `config.json` bằng mảng
  `enabled_templates`; không cần migration database. Nếu cấu hình cũ chưa có mảng
  này, hệ thống kế thừa mẫu chính cũ và các file đã được gán theo chức năng là
  những file được bật. Lần bật/tắt đầu tiên sẽ ghi cấu hình mới.
- File tải lên sau thay đổi này không tự trở thành mẫu chính hoặc tự được bật.
- Assignment được bổ sung vào `config.json` sẵn có theo workspace dưới dạng mảng
  tên file. Giá trị chuỗi singleton từ phiên bản trước tự động được đọc thành
  mảng một phần tử và được chuẩn hóa khi cấu hình được lưu/đổi tên lần tiếp theo.
- Config legacy chưa có `revision` được xem là revision `0` và được nâng lazy ở
  mutation đầu tiên; không cần migration schema hoặc rewrite hàng loạt.
- Cấu hình cũ chỉ có `active_template` vẫn hợp lệ và được đọc theo fallback nêu
  trên; không cần migration schema hoặc thao tác dữ liệu thủ công.
- Availability được tính lại từ dữ liệu canonical của Gói thầu mỗi lần chọn hoặc
  đổi Gói thầu; state tài liệu cũ phải được reset.
- Các stable ID hiện hữu được giữ nguyên nên assignment đã lưu không cần migration:
  `bid_evaluation_report` là Báo cáo đánh giá E-HSDT; `_01` là Báo cáo đánh giá
  E-HSĐXKT; `_02` là Quyết định phê duyệt nhà thầu đạt kỹ thuật; `_03` là
  Báo cáo đánh giá E-HSĐXTC.

## Regression seams

- `tests/js/word_publication_policy.test.mjs`: ma trận business rule và stable ID.
- `tests/js/word_publication_ui.test.mjs`: danh sách thực tế, stale state, export,
  bảng chọn nhiều file, xác nhận trước request, DOCX/ZIP, entitlement,
  accessibility và responsive behavior.
- `tests/js/word_publication_navigation.test.mjs`: navigation và regression của
  `Biểu mẫu Word`.
- `tests/test_word_publication_route.py`: SPA route và reserved-route contract.
- `tests/test_word_publication_template_assignments.py`: persistence, permission,
  workspace isolation, lọc tập con theo assignment, multi-template resolution,
  trạng thái cho phép sử dụng, ZIP output và server applicability.
- `tests/js/word_template_assignments_ui.test.mjs`: searchable assignment UI,
  fixture 100 biểu mẫu, giới hạn 20 checkbox/trang, tìm kiếm, phân trang, lọc biểu
  mẫu tạm ngừng, save flow, read-only behavior, accessibility và mobile layout.
- `tests/test_word_template_crud.py` và `tests/js/word_template_crud.test.mjs`:
  bật/tắt nhiều mẫu độc lập, mặc định file mới, API/audit và điều khiển truy cập.
- `tests/test_word_template_config_concurrency.py`: CAS đa process, stale writer,
  config corruption và compatibility của config legacy.
