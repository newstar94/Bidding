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
   tài liệu cấp gói thầu, danh sách hợp đồng hiện hành liên kết với gói thầu được
   cấp cho mapping `ds_hop_dong` theo phạm vi của stable document ID: tư vấn
   lập/đánh giá Bước 1 hoặc 2 chỉ nhận hợp đồng phân loại `Tư vấn`; tư vấn thẩm
   định Bước 1 hoặc 2 chỉ nhận hợp đồng phân loại `Thẩm định`. Các tài liệu cấp
   gói thầu khác giữ nguyên danh sách đầy đủ. Các biến đơn không có trong
   manifest hiện tại vẫn được để trống, vòng lặp khác không
   có trong manifest vẫn sinh 0 dòng, và biểu thức Jinja hoặc root ngoài manifest
   vẫn bị từ chối.
7. Không thay đổi entitlement xuất Word, role, module permission, record scope,
   assignment scope hay dữ liệu được hiển thị.
8. “Hồ sơ tổng hợp gói thầu” là ngữ cảnh dữ liệu dùng để điền các tài liệu Word,
   không phải một loại tài liệu xuất bản. `package_full_profile` không thuộc tập
   stable document ID, không được hiển thị trong màn hình gán biểu mẫu hoặc xuất
   bản và không có endpoint xuất riêng. Ngữ cảnh tổng hợp vẫn giữ dữ liệu kế
   hoạch, gói thầu, tổ chuyên gia, tổ thẩm định, mở thầu và hợp đồng để các loại
   tài liệu xuất bản hợp lệ có thể dùng khi mapping yêu cầu.
9. Context `contract` giữ `hop_dong` đơn để tương thích mẫu cũ và bổ sung
   `hop_dong_list`/mapping mặc định `ds_hop_dong` chứa mọi hợp đồng hiện hành
   liên kết với dòng phiên bản gói thầu. Mapping danh sách có thể lặp toàn bộ các
   hợp đồng thuộc phạm vi của tài liệu trong một file; không yêu cầu người dùng
   xuất nhiều lượt hoặc dựa vào
   lựa chọn `LIMIT 1` không xác định.
10. Các cột tiền thuộc schema được định dạng ở bản sao DTO dành cho kết xuất Word,
    kể cả khi giá trị đầu vào là số hoặc chuỗi chỉ chứa số. Dữ liệu lưu, dữ liệu
    API và phép tính nghiệp vụ không bị chuyển thành chuỗi định dạng.
11. Manifest kết xuất mang danh sách các biến tùy chỉnh ánh xạ từ cột có định dạng
    `datetime`. Formatter phải dùng metadata này để giữ giờ/phút, không được suy
    đoán chỉ từ tên alias Word. Biến ngày thuần (`date`) vẫn chỉ xuất ngày tháng.
12. Manifest kết xuất khai báo riêng root của trường `date`/`datetime` và trường
    tiền. Chỉ các root này được sinh biến dẫn xuất: `S_<biến>`/`s_<biến>` cho ngày
    rút gọn và `bangchu_<biến>`/`BangChu_<biến>` cho tiền bằng chữ. Giá trị tiền
    có thể là số hoặc chuỗi chỉ chứa số. Ngày rút gọn giữ ngày ở hai chữ số;
    tháng chỉ có số `0` phía trước với tháng 1 và tháng 2, ví dụ `05/01/2026`,
    `05/02/2026`, `05/3/2026`. Công thức `formatDate(...)` dùng cùng quy tắc này;
    giao diện cấu hình không được mô tả quy tắc bằng ký hiệu `dd/MM/yyyy` vì ký
    hiệu đó ngụ ý sai rằng tháng 3–9 cũng có số `0` phía trước.
13. Phạm vi hợp đồng được xác định từ `publicationType` ổn định và trường phân
    loại hợp đồng, không suy đoán từ tên file biểu mẫu hoặc tên hợp đồng. So sánh
    phân loại không phụ thuộc chữ hoa/thường, dấu tiếng Việt hoặc khoảng trắng.

## Compatibility impact

- Workspace trước đây chỉ chọn một biểu mẫu hoạt động nhưng chưa gán theo chức
  năng sẽ không còn xuất tự động Kế hoạch, Báo cáo hoặc Kết quả.
- Các assignment hợp lệ đã lưu vẫn giữ nguyên và tiếp tục hoạt động; riêng ID dữ
  liệu-only `package_full_profile` được xử lý như mô tả bên dưới.
- Response cấu hình vẫn giữ `activeTemplate` và trường compatibility
  `legacyActiveFallback`, nhưng giá trị fallback là `false` cho toàn bộ document ID.
- Client cũ nhận response mới sẽ thấy các loại chưa gán là không có resolved
  template.
- Template đa ngữ cảnh trước đây có thể nhận HTTP 422 khi chứa vòng lặp không có
  trong context; sau thay đổi, phần ngoài ngữ cảnh được để trống mà không mở rộng
  dữ liệu được cấp cho document worker.
- Các tài liệu cấp gói thầu ngoài bốn chức năng tư vấn vẫn nhận `ds_hop_dong`
  gồm mọi hợp đồng hiện hành liên kết với dòng phiên bản gói thầu. Hai chức năng
  tư vấn lập/đánh giá chỉ
  nhận hợp đồng `Tư vấn`; hai chức năng tư vấn thẩm định chỉ nhận hợp đồng `Thẩm
  định`. Nhà đầu tư và nhà thầu chính của từng loại tài liệu vẫn giữ nguyên; chỉ
  context `contract`/`liquidation` mới dùng một hợp đồng làm bản ghi vô hướng
  `hop_dong`.
- Hàng cấu hình và thẻ xuất `package_full_profile` không còn được công bố. Cấu
  hình cũ mang ID này bị bỏ qua khi đọc và bị loại khỏi cấu hình lưu ở lần ghi
  tiếp theo; 11 loại tài liệu xuất bản hợp lệ không đổi. `procurement_plan` vẫn
  chỉ có nghĩa là xuất Kế hoạch và không tự nhận một loại tài liệu tổng hợp mới.
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
- Mẫu có thể dùng `bangchu_<biến-tiền>` để trình bày tiền bằng chữ và
  `S_<biến-ngày>` để trình bày ngày rút gọn theo quy tắc tháng 1–2 có số `0`,
  các tháng còn lại không thêm số `0`. Biến kết quả dùng `formatDate(...)` nhận
  cùng cách trình bày; gợi ý công thức cũ có tham số `"dd/MM/yyyy"` được đổi sang
  công thức không tham số định dạng. Biến không ánh xạ
  từ đúng kiểu schema không được tự suy đoán là tiền hoặc ngày; điều này giữ
  nguyên phạm vi dữ liệu và tránh tạo biến dẫn xuất ngoài manifest.

## Migration và rollout

1. Không có schema hoặc migration dữ liệu tự động.
2. Không tự chuyển `activeTemplate` thành assignment vì việc đó tái tạo chính hành
   vi tự động mà quyết định này loại bỏ.
3. Sau rollout, người quản lý mở màn hình Biểu mẫu Word, chọn file cho từng chức
   năng và lưu cấu hình.
4. Có thể gán cùng một file cho nhiều chức năng nếu đó là lựa chọn rõ ràng của
   người quản lý.
5. Không có migration schema. Assignment cũ mang ID `package_full_profile` được
   bỏ qua trong response cấu hình và bị loại khi người quản lý lưu lại 11
   assignment hợp lệ; không xóa file biểu mẫu hoặc dữ liệu tổng hợp gói thầu.
6. Default mapping version 15 bổ sung `ds_hop_dong`; registry hiện hữu nhận mapping
   hệ thống này theo cơ chế nâng version sẵn có, không ghi đè mapping tùy chỉnh.
7. Không có migration dữ liệu cho định dạng ngày giờ; metadata được tạo lại trong
   manifest ở mỗi lần xuất Word.
8. Không có migration dữ liệu cho biến dẫn xuất tiền/ngày. Các mẫu hiện hữu tiếp
   tục hoạt động; người quản lý chỉ thêm tiền tố khi chủ động muốn cách trình bày
   mới. Công thức `formatDate(...)` hiện hữu tiếp tục được đọc; thay đổi chỉ làm
   gợi ý tạo công thức mới không còn hiển thị ký hiệu `dd/MM/yyyy` gây hiểu sai.
   File mẫu kiểm thử được bổ sung hướng dẫn và ví dụ ngay trong tài liệu.
9. Không có migration schema hoặc dữ liệu hợp đồng cho phạm vi theo chức năng.
   Phạm vi được tính lại ở mỗi lần xuất từ `publicationType` và `phan_loai` hiện
   có; hợp đồng thiếu hoặc có phân loại khác không được đưa vào bốn tài liệu tư
   vấn chuyên biệt nhưng vẫn có trong ngữ cảnh dữ liệu của các tài liệu cấp gói
   thầu khác.

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
- `tests/js/word_publication_policy.test.mjs` và
  `tests/test_word_publication_template_assignments.py`: `package_full_profile`
  không phải tài liệu xuất bản; policy frontend/backend cùng công bố 11 loại.
- `tests/test_contract_relation_policy.py`: context Word chỉ giữ các hợp đồng hiện
  hành và không làm rơi hợp đồng thứ hai.
- `tests/test_docx_mapping_policy.py` và `tests/test_docx_partner_version_policy.py`:
  mọi context báo cáo cấp gói thầu giữ danh sách hợp đồng để biểu mẫu tổng hợp
  không sinh phần hợp đồng trống.
- `tests/test_docx_cross_context_template.py`: mẫu tổng hợp lặp đủ hợp đồng và định
  dạng cả tiền kiểu số lẫn chuỗi số trong các danh sách.
- `tests/test_docx_cross_context_template.py` và `tests/test_docx_mapping_policy.py`:
  alias ánh xạ từ `datetime` được khai báo trong manifest và giữ giờ/phút khi render.
- `tests/test_docx_cross_context_template.py`: pipeline ánh xạ thật giữ số tiền
  đến bước sinh chữ, biến tiền bằng chữ chấp nhận cả số và chuỗi số; biến ngày
  ngắn và công thức `formatDate(...)` áp quy tắc tháng 1–2 có số `0` cho đủ 12
  tháng; file mẫu có hướng dẫn cùng cú pháp minh họa.
- `tests/test_docx_mapping_policy.py`: manifest chỉ đánh dấu alias tiền, ngày và
  ngày giờ theo định dạng của cột nguồn.
- `tests/test_word_publication_template_assignments.py`: context được lọc trước
  mapping theo bốn stable document ID tư vấn; các báo cáo cấp gói thầu khác vẫn
  giữ danh sách đầy đủ.
- `tests/test_docx_cross_context_template.py`: cùng file mẫu tổng hợp chỉ render
  hợp đồng Tư vấn khi xuất “Tư vấn lập, đánh giá Bước 1”.
- `tests/js/word_resources_layout.test.mjs` và
  `tests/js/word_variable_presentation.test.mjs`: màn hình Biểu mẫu đưa mã tiền
  bằng chữ/ngày rút gọn vào đúng dòng biến tương ứng và cho phép tìm không phân
  biệt dấu theo mã biến, ý nghĩa hoặc nguồn ánh xạ; gợi ý công thức ngày dùng
  đúng nhãn và cú pháp ngày ngắn đã phê duyệt.
