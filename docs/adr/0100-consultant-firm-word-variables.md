# ADR 0043 — Biến Word cho thông tin đơn vị tư vấn lập/thẩm định

- Trạng thái: Chấp nhận (chủ sản phẩm duyệt ngày 2026-11-12, phương án "Chỉ thông tin đơn vị")
- Ngày: 2026-11-12
- Phạm vi: Xuất Word cấp gói thầu (evaluation, hsmt, opening, result, contract, liquidation)

## Bối cảnh

Bộ mẫu Word của đơn vị tư vấn (TVL/TVT, HSMT, BCĐG, KQLCNT) cần tên, người đại
diện, chức vụ, danh xưng, địa chỉ, điện thoại, mã số thuế, tài khoản, ngân hàng,
mã Citad và dấu của đơn vị tư vấn lập và đơn vị tư vấn thẩm định (465 chỗ trong
101 mẫu). Dữ liệu này đã có: hợp đồng gắn với gói thầu được phân loại "Tư vấn"
hoặc "Thẩm định", và `hop_dong.nha_thau_id` trỏ tới bản ghi nhà thầu. Tuy vậy,
ngữ cảnh Word chỉ có `hop_dong_list` (thông tin hợp đồng), không có thông tin
đơn vị của hợp đồng đó, nên mẫu không có biến tương ứng.

## Quyết định

1. Ngữ cảnh xuất Word gói thầu có thêm hai khóa gốc
   - `don_vi_tu_van_lap`;
   - `don_vi_tu_van_tham`.

   Tên khóa dài để không trùng biến tự tạo hiện có như `tu_van_lap`.
2. Hợp đồng được chọn trong danh sách hợp đồng hiện hành gắn với gói thầu, tức
   cùng danh sách `ds_hop_dong`, theo quy tắc phân loại của tab Tiến độ
   (`consultant_contract_kind`):
   - "Tư vấn", "Tư vấn lập", "TVL" là tư vấn lập;
   - "Thẩm định", "Tư vấn thẩm", "TVT" là tư vấn thẩm định.

   Nếu có nhiều hợp đồng cùng loại, lấy hợp đồng đầu tiên theo thứ tự của bộ nạp
   (phiên bản mới nhất, rồi ngày ký gần nhất). Tab Tiến độ cũng dùng thứ tự này.
   Đơn vị tư vấn là bản ghi `nha_thau` có `id = hop_dong.nha_thau_id` trong cùng
   tổ chức.
3. Mỗi khóa chỉ chứa 13 trường: `ten_nha_thau`, `ten_viet_tat`, `ma_so_thue`,
   `nguoi_dai_dien`, `chuc_vu_dai_dien`, `danh_xung`, `dia_chi`, `so_dien_thoai`,
   `email`, `so_tai_khoan`, `noi_mo_tai_khoan`, `ma_ngan_hang`, `anh_dau`. Khóa
   luôn có mặt. Nếu không có hợp đồng phù hợp, hoặc nhà thầu không thuộc tổ chức,
   khóa là `{}` và biến in rỗng.
4. Danh mục biến mặc định tăng lên v18, thêm 26 biến hệ thống, chia hai nhóm nguồn:
   - "Đơn vị tư vấn lập" có hậu tố `_tvl`;
   - "Đơn vị tư vấn thẩm định" có hậu tố `_tvt`.

   Tên biến (lấy `_tvl` làm ví dụ): `ten_tvl`, `ten_tat_tvl`, `mst_tvl`,
   `dai_dien_tvl`, `chuc_vu_dai_dien_tvl`, `danh_xung_tvl`, `dia_chi_tvl`,
   `sdt_tvl`, `email_tvl`, `stk_tvl`, `noi_mo_tk_tvl`, `ma_ngan_hang_tvl`,
   `anh_dau_tvl`.

   Mỗi biến có nhãn tiếng Việt riêng. Biến xuất hiện trong từ điển biến Word. Người
   dùng có thể chọn hai nhóm này ở ô "Thực thể" để tạo biến mới hoặc đổi nguồn.
   Người dùng cũng có thể đổi tên, ẩn và khôi phục biến như các biến mặc định
   khác. Quy tắc trùng tên của ADR 0042 mục 7 vẫn áp dụng.
5. Số, ngày và giá trị của hợp đồng tư vấn giữ nguyên cách mẫu đang lấy. Mẫu Kế
   hoạch không nhận hai khóa này: ánh xạ nguồn tư vấn bị từ chối với
   `document_type="plan"`.

## Hệ quả, tương thích và triển khai

- **Không đổi quyền hay phạm vi hiển thị:**
  - Đơn vị tư vấn là nhà thầu của hợp đồng đã nằm trong ngữ cảnh Word của cùng
    gói thầu. Thông tin chỉ được đưa thêm qua bộ lọc có kiểm soát
    `docx_context_policy` (entity `consultant`).
  - `so_tai_khoan`, `noi_mo_tai_khoan`, `ma_ngan_hang` vẫn theo capability
    `financial`. `anh_dau` vẫn theo capability `signature`. Cả bộ lọc ngữ cảnh lẫn
    bộ lọc ánh xạ đều áp các capability này theo tên trường, giống nhà thầu hiện có.
  - Không tạo capability mới. Word entitlement vẫn chỉ kiểm soát hành động xuất.
- **Migration và tương thích:**
  - Không có migration schema hay dữ liệu. Biến mặc định được lấy từ catalog
    trong mã, nên mọi phạm vi có biến mới ngay khi khởi động lại.
  - Override và biến tự tạo cũ giữ nguyên.
  - Tên gốc `don_vi_tu_van_lap` và `don_vi_tu_van_tham` trở thành khóa hệ thống.
    Một biến tự tạo trùng đúng tên này sẽ bị bộ lọc ánh xạ từ chối khi xuất.
- **Hiệu năng:** mỗi lần xuất gói thầu thêm tối đa hai truy vấn đọc `nha_thau`
  theo khóa chính, trong cùng tổ chức.
- **Rollback:** bỏ hai khóa và các ánh xạ. Mẫu dùng các biến này sẽ in rỗng.

## Kiểm thử hồi quy

`tests/test_consultant_word_variables.py` khóa các điểm sau:

- 26 biến có tên, nhãn và định dạng đúng, và không trùng biến khác.
- Phân loại và thứ tự chọn hợp đồng khớp tab Tiến độ.
- Bộ nạp chỉ đọc nhà thầu cùng tổ chức.
- Ánh xạ hợp lệ cho mọi loại xuất gói thầu và bị từ chối cho Kế hoạch.
- Tài khoản, ngân hàng và dấu bị lọc khi thiếu capability.
- Kết xuất thực tế qua manifest đã niêm phong, có và không có capability.
- Phạm vi mới có sẵn biến; đổi tên, ẩn và khôi phục được.
- Form "Thực thể" có đủ hai nhóm nguồn.
