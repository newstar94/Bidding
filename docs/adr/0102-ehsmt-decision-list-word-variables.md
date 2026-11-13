# ADR 0102: Danh sách QĐ phê duyệt và điều chỉnh E-HSMT trong Word

- Ngày: 2026-11-13
- Trạng thái: Chủ sản phẩm chấp thuận (2026-11-13: danh sách gồm QĐ gốc và các lần điều chỉnh; biến đơn luôn là QĐ gốc, thêm biến cho lần điều chỉnh mới nhất)
- Phạm vi: xuất Word cấp gói thầu (evaluation, hsmt, opening, result, contract, liquidation), danh mục biến Word mặc định
- Liên quan: ADR 0099 (biến số/ngày theo mốc tiến độ)

## Bối cảnh

Khi E-HSMT được sửa đổi, người dùng tạo phiên bản mới của gói thầu. Ứng dụng tự sinh một lần "QĐ phê duyệt điều chỉnh E-HSMT" cho phiên bản đó:

- lưu trong `goi_thau_dieu_chinh_hsmt`;
- lần thứ N ứng với phiên bản N;
- số/ngày QĐ lấy từ "Số/Ngày quyết định" của phiên bản mới.

Phiên bản mới sao chép cả các lần điều chỉnh trước. Tab Tiến độ hiện mỗi lần là một dòng "… lần N".

Trước ADR này, Word có hai vấn đề:

1. Mốc điều chỉnh là mốc lặp, nên không có biến Word nào. ADR 0099 chỉ làm biến cho mốc không lặp.
2. `so_qd_pd_hsmt`/`ngay_qd_pd_hsmt` lấy theo phiên bản đang xuất. Ở phiên bản đã điều chỉnh, hai biến này in số QĐ điều chỉnh, không phải QĐ phê duyệt gốc.

## Quyết định

1. **Danh sách `ds_qd_hsmt`** (nguồn `qd_hsmt_list`).
   - Dòng đầu là QĐ phê duyệt E-HSMT gốc, lấy từ tiến độ hiệu lực của phiên bản đầu trong dòng gói thầu. Phiên bản đầu là bản cùng tổ chức, chưa lưu trữ, có `phien_ban` nhỏ nhất.
   - Tiếp theo là mọi lần "QĐ phê duyệt điều chỉnh E-HSMT" áp dụng được của phiên bản đang xuất, theo thứ tự tiến độ.
   - Mỗi dòng có các trường:
     - `lan`: 0 cho QĐ gốc, sau đó là số thứ tự lần điều chỉnh;
     - `loai`: "Phê duyệt E-HSMT" hoặc "Điều chỉnh E-HSMT lần N";
     - `so_quyet_dinh`, `ngay_quyet_dinh`;
     - `so_to_trinh`, `ngay_to_trinh`;
     - `so_bao_cao_tham_dinh`, `ngay_bao_cao_tham_dinh`;
     - `ly_do`.
   - Số/ngày QĐ lấy từ dòng tiến độ hiệu lực, giống ADR 0099: tôn trọng sửa tay trên tab Tiến độ, ngày thực tế được ưu tiên hơn ngày dự kiến.
   - Với QĐ gốc, tờ trình và báo cáo thẩm định lấy từ các mốc tương ứng của phiên bản đầu. Với lần điều chỉnh, các trường này và lý do lấy từ bản ghi điều chỉnh.
   - Trường ngày có sẵn dạng `S_` trong vòng lặp.
2. **`so_qd_pd_hsmt`/`ngay_qd_pd_hsmt` luôn là QĐ gốc.** Giá trị lấy từ phiên bản đầu của dòng gói thầu. Khi xuất phiên bản đầu, giá trị không đổi so với trước.
3. **Biến mới `so_qd_dc_hsmt`/`ngay_qd_dc_hsmt`.** Đây là lần điều chỉnh áp dụng được mới nhất của phiên bản đang xuất; trống nếu chưa điều chỉnh. Giá trị luôn khớp dòng cuối của `ds_qd_hsmt`.
4. **Danh mục biến mặc định lên v19.**
   - Nhãn mới rõ nghĩa: "… QĐ phê duyệt E-HSMT gốc", "… QĐ phê duyệt điều chỉnh E-HSMT, lần mới nhất".
   - Nguồn `qd_hsmt_list` có trong form "Danh sách nguồn", nên người dùng có thể tạo alias, đổi tên, ẩn và khôi phục như các danh sách khác.
   - Xuất Kế hoạch không có danh sách này: ánh xạ bị từ chối với `document_type="plan"`. Hai biến `*_qd_dc_hsmt` ở xuất Kế hoạch luôn trống, như các mốc ngoài phần Kế hoạch.

## Hệ quả, tương thích và triển khai

- **Thay đổi giá trị in ra:** mẫu đang dùng `{so_qd_pd_hsmt}`/`{ngay_qd_pd_hsmt}`, khi xuất từ một phiên bản đã điều chỉnh, giờ in QĐ gốc thay cho QĐ điều chỉnh. Muốn in QĐ điều chỉnh mới nhất thì dùng `{so_qd_dc_hsmt}`/`{ngay_qd_dc_hsmt}`.
- **Không đổi:**
  - biến trường gói thầu `{so_qd_hsmt}` (cột `goi_thau.so_quyet_dinh` của phiên bản đang xuất);
  - các biến tờ trình và báo cáo thẩm định E-HSMT của ADR 0099;
  - tab Tiến độ và bản xuất Excel tiến độ.
- **Quyền:** không đổi quyền, masking hay phạm vi tenant. Dữ liệu chỉ đọc trong cùng tổ chức, từ gói thầu đã được phép xuất. Các trường mới không thuộc nhóm nhạy cảm.
- **Migration:** không có. Bảng `goi_thau_dieu_chinh_hsmt` và các cột dòng phiên bản đã có sẵn.
- **Hiệu năng:** khi xuất một phiên bản không phải bản đầu, thêm một truy vấn tìm dòng phiên bản và một lần tính tiến độ của phiên bản đầu, trong cùng tổ chức.
- **Tên dành riêng:** `qd_hsmt_list` thành khóa ngữ cảnh hệ thống. Biến tự tạo trùng tên sẽ bị từ chối.
- **Rollback:** bỏ khóa danh sách, bỏ `LATEST_INSTANCE_WORD_SLUGS` và `ORIGINAL_VERSION_MILESTONE_KEYS`, rồi đưa danh mục về v18. Mẫu dùng biến mới sẽ in rỗng.

## Kiểm thử hồi quy

`tests/test_ehsmt_decision_word_variables.py`:

- thứ tự danh sách: QĐ gốc trước, sau đó các lần điều chỉnh theo thứ tự tiến độ; bỏ lần không áp dụng; trường lấy từ bản ghi điều chỉnh;
- không có QĐ gốc áp dụng được thì danh sách chỉ có các lần điều chỉnh;
- biến lần mới nhất lấy dòng áp dụng được cuối cùng và không có ở xuất Kế hoạch;
- QĐ gốc chỉ thay mốc phê duyệt E-HSMT;
- với dữ liệu thật (sqlite), xuất phiên bản 02 in QĐ gốc của phiên bản 00, đủ hai lần điều chỉnh và bỏ lần đã ẩn; bỏ qua phiên bản đã lưu trữ và dòng cùng mã ở tổ chức khác;
- danh mục v19, nhãn và nguồn danh sách;
- ánh xạ hợp lệ cho mọi loại xuất gói thầu, bị từ chối cho Kế hoạch; projection chỉ giữ trường khai báo;
- kết xuất thực tế vòng lặp `{#ds_qd_hsmt}` cùng ngày `S_` qua manifest đã niêm phong.

`tests/test_timeline_word_variables.py` được cập nhật cho hai biến mới và khóa danh sách trong ngữ cảnh gói thầu.
