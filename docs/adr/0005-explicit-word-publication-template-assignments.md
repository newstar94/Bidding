# ADR 0005 — Bắt buộc gán biểu mẫu rõ ràng cho Xuất bản Word

- Trạng thái: Chấp nhận
- Ngày: 2026-08-23
- Phạm vi: Cấu hình và xuất tài liệu trong màn hình Xuất bản Word

## Bối cảnh

Ba loại tài liệu `procurement_plan`, `bid_evaluation_report` và
`contractor_selection_result` từng tự dùng biểu mẫu đang hoạt động khi chưa có
assignment. UI gọi đây là “mẫu tương thích”. Hành vi này khiến một file có thể
được dùng cho Kế hoạch, Báo cáo và Kết quả dù người quản lý chưa gán file đó cho
từng chức năng.

Chủ sản phẩm yêu cầu tự cấu hình toàn bộ biểu mẫu và không cho phép tự động chọn
biểu mẫu tương thích.

## Quyết định

1. Mọi loại tài liệu trong Xuất bản Word chỉ được resolve từ assignment rõ ràng
   theo stable document ID.
2. Biểu mẫu đang hoạt động (`activeTemplate`) không được dùng làm fallback cho
   bất kỳ loại tài liệu Xuất bản Word nào.
3. Chức năng chưa có assignment phải hiển thị “Chưa cấu hình” trong màn hình cấu
   hình và “Chưa chọn biểu mẫu” trong màn hình xuất bản; hành động xuất bị khóa.
4. Backend phải từ chối xuất loại tài liệu chưa có assignment, kể cả khi workspace
   đang có một biểu mẫu hoạt động.
5. `activeTemplate` và resolver fallback cấp thấp được giữ lại cho các endpoint
   Word legacy không truyền `publicationType`; quyết định này không thay đổi các
   luồng đó.
6. Một biểu mẫu được gán rõ ràng có thể chứa biến của nhiều loại ngữ cảnh. Với
   mọi tài liệu cấp gói thầu, danh sách hợp đồng hiện hành liên kết với gói thầu
   là dữ liệu dùng chung và được cấp cho mapping `ds_hop_dong`. Các biến đơn
   không có trong manifest hiện tại vẫn được để trống, vòng lặp khác không có
   trong manifest vẫn sinh 0 dòng, và biểu thức Jinja hoặc root ngoài manifest
   vẫn bị từ chối.
7. Không thay đổi entitlement xuất Word, role, module permission, record scope,
   assignment scope hay dữ liệu được hiển thị.
8. Biểu mẫu tổng hợp nhiều giai đoạn không được gán cho
   `procurement_plan`. Stable document ID `package_full_profile` (“Hồ sơ tổng
   hợp gói thầu”) có scope `package`, context `contract` và áp dụng cho mọi gói
   thầu. Context này giữ riêng nhà thầu của hợp đồng và danh sách thông tin mở
   thầu để một biểu mẫu có thể xuất đồng thời kế hoạch, gói thầu, tổ chuyên gia,
   tổ thẩm định, mở thầu và hợp đồng.
9. Context `contract` giữ `hop_dong` đơn để tương thích mẫu cũ và bổ sung
   `hop_dong_list`/mapping mặc định `ds_hop_dong` chứa mọi hợp đồng hiện hành
   liên kết với dòng phiên bản gói thầu. Biểu mẫu tổng hợp lặp toàn bộ danh sách
   này trong một file; không yêu cầu người dùng xuất nhiều lượt hoặc dựa vào
   lựa chọn `LIMIT 1` không xác định.
10. Các cột tiền thuộc schema được định dạng ở bản sao DTO dành cho kết xuất Word,
    kể cả khi giá trị đầu vào là số hoặc chuỗi chỉ chứa số. Dữ liệu lưu, dữ liệu
    API và phép tính nghiệp vụ không bị chuyển thành chuỗi định dạng.
11. Manifest kết xuất mang danh sách các biến tùy chỉnh ánh xạ từ cột có định dạng
    `datetime`. Formatter phải dùng metadata này để giữ giờ/phút, không được suy
    đoán chỉ từ tên alias Word. Biến ngày thuần (`date`) vẫn chỉ xuất ngày tháng.

## Compatibility impact

- Workspace trước đây chỉ chọn một biểu mẫu hoạt động nhưng chưa gán theo chức
  năng sẽ không còn xuất tự động Kế hoạch, Báo cáo hoặc Kết quả.
- Các assignment đã lưu vẫn giữ nguyên và tiếp tục hoạt động.
- Response cấu hình vẫn giữ `activeTemplate` và trường compatibility
  `legacyActiveFallback`, nhưng giá trị fallback là `false` cho toàn bộ document ID.
- Client cũ nhận response mới sẽ thấy các loại chưa gán là không có resolved
  template.
- Template đa ngữ cảnh trước đây có thể nhận HTTP 422 khi chứa vòng lặp không có
  trong context; sau thay đổi, phần ngoài ngữ cảnh được để trống mà không mở rộng
  dữ liệu được cấp cho document worker.
- Biểu mẫu tổng hợp được gán rõ ràng cho các tài liệu cấp gói thầu như HSMT, mở
  thầu, đánh giá hoặc kết quả sẽ nhận `ds_hop_dong` gồm mọi hợp đồng hiện hành
  liên kết với dòng phiên bản gói thầu. Nhà đầu tư và nhà thầu chính của từng
  loại tài liệu vẫn giữ nguyên; chỉ context `contract`/`liquidation` mới dùng
  một hợp đồng làm bản ghi vô hướng `hop_dong`.
- Có thêm một hàng cấu hình `package_full_profile`. Client cũ không biết stable
  ID này vẫn tiếp tục dùng 11 loại cũ; `procurement_plan` vẫn chỉ có nghĩa là
  xuất Kế hoạch và không tự nhận dữ liệu cấp gói thầu/hợp đồng.
- Context `contract` giữ thêm bản chiếu `thong_tin_mo_thau` đã được kiểm soát bởi
  cùng tenant, module, assignment, record authorization và entitlement xuất Word
  của gói thầu. Không thay đổi API đọc bản ghi hoặc quyền xem dữ liệu trên màn hình.
- Mẫu cũ dùng biến hợp đồng đơn tiếp tục nhận một hợp đồng theo thứ tự xác định
  của relation policy. Mẫu mới có thể dùng `ds_hop_dong` để nhận toàn bộ hợp đồng
  hiện hành; hợp đồng lịch sử có `is_latest = 0` không được lặp.
- Số tiền trong Word có dấu chấm phân cách hàng nghìn nhất quán. Đây là thay đổi
  trình bày của file Word, không thay đổi giá trị số hoặc kỳ vọng API.
- Biến Word ánh xạ từ trường ngày giờ, kể cả alias do người dùng tự cấu hình, sẽ
  xuất cả giờ/phút. Ví dụ `2026-03-05 14:55:00` được trình bày thành
  `14:55 ngày 05/3/2026`; biến ánh xạ từ trường ngày thuần không thay đổi.

## Migration và rollout

1. Không có schema hoặc migration dữ liệu tự động.
2. Không tự chuyển `activeTemplate` thành assignment vì việc đó tái tạo chính hành
   vi tự động mà quyết định này loại bỏ.
3. Sau rollout, người quản lý mở màn hình Biểu mẫu Word, chọn file cho từng chức
   năng và lưu cấu hình.
4. Có thể gán cùng một file cho nhiều chức năng nếu đó là lựa chọn rõ ràng của
   người quản lý.
5. Không tự gán biểu mẫu đang dùng cho `package_full_profile`. Người quản lý phải
   chọn file cho “Hồ sơ tổng hợp gói thầu” và lưu cấu hình trước khi xuất.
6. Default mapping version 15 bổ sung `ds_hop_dong`; registry hiện hữu nhận mapping
   hệ thống này theo cơ chế nâng version sẵn có, không ghi đè mapping tùy chỉnh.
7. Không có migration dữ liệu cho định dạng ngày giờ; metadata được tạo lại trong
   manifest ở mỗi lần xuất Word.

## Rollback strategy

- Rollback đồng bộ frontend và backend nếu cần khôi phục hành vi cũ.
- Không cần sửa config; assignment đã lưu tương thích với cả hai phiên bản.
- Không tự sinh hoặc xóa assignment khi rollback.

## Regression seams

- `tests/test_word_publication_template_assignments.py`: active template không
  tạo resolved template khi chưa gán.
- `tests/js/word_template_assignments_ui.test.mjs`: hàng chưa gán luôn hiển thị
  “Chưa cấu hình”, không hiển thị mẫu tương thích.
- `tests/js/word_publication_policy.test.mjs`: không document ID nào bật fallback.
- `tests/test_word_publication_policy_parity.py`: metadata frontend/backend đồng bộ.
- `tests/test_docx_cross_context_template.py`: biến và vòng lặp ngoài ngữ cảnh
  được để trống, trong khi biểu thức Jinja ngoài manifest vẫn bị từ chối.
- `tests/test_docx_mapping_policy.py`: context hợp đồng giữ riêng danh sách mở
  thầu; mapping `ds_mo_thau` không lấy nhầm bản ghi nhà thầu của hợp đồng.
- `tests/js/word_publication_policy.test.mjs`: `package_full_profile` dùng endpoint
  báo cáo gói thầu với `type=contract` và áp dụng cho mọi gói thầu.
- `tests/test_contract_relation_policy.py`: context Word chỉ giữ các hợp đồng hiện
  hành và không làm rơi hợp đồng thứ hai.
- `tests/test_docx_mapping_policy.py` và `tests/test_docx_partner_version_policy.py`:
  mọi context báo cáo cấp gói thầu giữ danh sách hợp đồng để biểu mẫu tổng hợp
  không sinh phần hợp đồng trống.
- `tests/test_docx_cross_context_template.py`: mẫu tổng hợp lặp đủ hợp đồng và định
  dạng cả tiền kiểu số lẫn chuỗi số trong các danh sách.
- `tests/test_docx_cross_context_template.py` và `tests/test_docx_mapping_policy.py`:
  alias ánh xạ từ `datetime` được khai báo trong manifest và giữ giờ/phút khi render.
