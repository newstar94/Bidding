# ADR 0105: Tổng kế hoạch và số tiền bảo đảm thực hiện hợp đồng tính sẵn cho Word

- Ngày: 2026-11-14
- Trạng thái: Chủ sản phẩm chọn triển khai (mục 2H, 2026-11-13). Hai điểm là mặc định đề xuất, chờ chủ sản phẩm xác nhận: số tiền bảo đảm = tỷ lệ × giá sau giảm giá (giá hợp đồng in trong thư chấp thuận), làm tròn nửa lên đến đồng; "Giá tổng dự toán" = tổng mức đầu tư/dự toán − tổng phần công việc đã thực hiện (đúng công thức in trong mẫu).
- Phạm vi: `backend/documents/computed_word_values.py` (mới), `docx_service.py`, `docx_bid_context_service.py`, `docx_context_policy.py`, `field_manifest.py`, `word_defaults.py` (danh mục v20), `frontend/documents/wordVariableManifest.js` (sinh lại), công cụ `Templates_Bidding/_cong_cu`
- Liên quan: ADR 0099, ADR 0100, ADR 0102

## Bối cảnh

Biểu thức trong mẫu Word không được cộng, trừ, nhân (`template_security`). Vì vậy:

- Dòng tổng trong mẫu Kế hoạch (tổng giá gói thầu, tổng phần đã thực hiện, tổng phần không áp dụng, "Giá tổng dự toán") chỉ đúng khi bảng có 0–1 dòng; từ 2 dòng thì hiện `[[...]]` để điền tay (38 chỗ trong 10 mẫu).
- Thư chấp thuận cần số tiền bảo đảm thực hiện hợp đồng nhưng gói thầu chỉ lưu tỷ lệ (%) (2 chỗ).

## Quyết định

1. Mẫu **Kế hoạch** có thêm 4 khóa ngữ cảnh (số nguyên, VND) và 4 biến mặc định định dạng tiền, có sẵn bản bằng chữ `bangchu_<biến>`:

   | Biến | Khóa ngữ cảnh | Giá trị |
   |---|---|---|
   | `tong_gia_gt_kh` | `tong_gia_goi_thau_ke_hoach` | Tổng giá các gói thầu hiện hành (bản mới nhất, chưa lưu trữ) của kế hoạch — cùng danh sách `ds_gt` |
   | `tong_gia_tri_da_th` | `tong_gia_tri_cv_da_thuc_hien` | Tổng giá trị các dòng "Công việc đã thực hiện" |
   | `tong_gia_tri_khong_ad` | `tong_gia_tri_cv_khong_ap_dung` | Tổng giá trị các dòng "Công việc không áp dụng LCNT" |
   | `tmdt_tru_da_th` | `tong_muc_dau_tu_tru_da_thuc_hien` | Tổng mức đầu tư/dự toán − tổng phần đã thực hiện; để trống khi kế hoạch chưa có tổng mức đầu tư |

   Danh sách rỗng cho tổng bằng 0. Chỉ mẫu Kế hoạch nhận các khóa này.
2. Mỗi dòng nhà thầu trong mẫu cấp gói thầu (`ds_nt_tham_du`, `ds_nt_trung`, … và `nha_thau`) có thêm trường `gia_tri_bao_dam_thuc_hien_hd` = tỷ lệ bảo đảm hợp đồng của gói × giá sau giảm giá của dòng đó (không có thì lấy giá dự thầu), làm tròn nửa lên đến đồng, định dạng "8.400.000". Gói chưa có tỷ lệ hoặc dòng chưa có giá thì để trống. Trong Thư chấp thuận (lặp theo nhà thầu trúng), mẫu dùng `{{ nt.gia_tri_bao_dam_thuc_hien_hd }}`, cùng dòng với "giá hợp đồng là `nt.gia_sau_giam_gia`".
3. Danh mục biến Word mặc định lên v20. Công cụ chuyển mẫu ánh xạ các chỗ trống trên sang biến mới. Chuyển lại bộ mẫu: chỉ 12 mẫu đổi (10 mẫu Kế hoạch, 2 Thư chấp thuận), và chỉ đổi đúng các chỗ này.

## Chưa làm, chờ chủ sản phẩm quyết định

- Bảng tổng hợp **theo từng nhà thầu** trong mẫu phân lô (PLQT1, PLQT1 V2, BCTĐ KQLCNT PL): số phần lô tham dự/đạt/không đạt/xếp hạng nhất, tổng giá phần lô — 20 chỗ. `ds_nt_tham_du` hiện có một dòng cho mỗi cặp nhà thầu–phần lô, nên cần danh sách mới gộp theo nhà thầu, đổi vòng lặp trong mẫu, và chốt nghĩa của "đạt" (đạt kỹ thuật hay đạt năng lực theo từng bảng) và "xếp hạng nhất".
- Giá trị ưu đãi (3 chỗ): cần chốt nguồn dữ liệu ưu đãi đã lưu.
- "Ngày cuối hoàn thiện" (3 chỗ, Thư chấp thuận) và "Ngày báo cáo" (2 chỗ, Giấy mời xác nhận năng lực): chưa có trường dữ liệu.

## Không thay đổi

Không đổi role, module permission, record/assignment scope, entitlement, capability hay hiển thị dữ liệu. Các giá trị mới chỉ tính từ bản ghi đã nằm trong ngữ cảnh xuất của chính tài liệu; quyền xuất Word vẫn chỉ kiểm soát hành động tạo/tải.

## Tương thích và triển khai

Không có migration. Override biến cũ giữ nguyên; tên biến mới không trùng biến mặc định hiện có (danh mục tự kiểm tra trùng). Cần khởi động lại Bidding, build lại frontend và tải lại 12 mẫu đã đổi lên "Biểu mẫu Word". Rollback: bỏ khóa/biến; mẫu dùng biến mới sẽ in rỗng.

## Regression seams

`tests/test_computed_word_values.py` (cộng nhiều dòng, danh sách rỗng, thiếu tổng mức đầu tư, làm tròn, chuỗi tiền hiển thị, trường bảo đảm trên dòng nhà thầu, chính sách ngữ cảnh, danh mục biến). Công cụ mẫu: `render_test.py` 101/101 với giá trị tính bằng chính hàm backend.
