# ADR 0106: Bảng tổng hợp theo nhà thầu, giá trị ưu đãi và hạn trong thư cho Word

- Ngày: 2026-11-14
- Trạng thái: Chấp nhận. Chủ sản phẩm quyết định ngày 2026-11-14: hạn trong thư là **biến kết quả** do từng không gian làm việc tự đặt công thức (ví dụ ngày văn bản + 10 ngày), bắt buộc cấu hình khi xuất mẫu cần biến, hộp cấu hình để trống. Ba điểm còn lại chủ sản phẩm giao Claude tự quyết theo phương án đề xuất (đếm "đạt" theo tiêu chí của từng bảng, "xếp hạng nhất" theo xếp hạng khi đánh giá, ưu đãi lấy "Tổng giá trị cộng ưu đãi" đã lưu); có thể đổi nếu chủ sản phẩm yêu cầu.
- Phạm vi: `backend/documents/computed_word_values.py`, `docx_bid_context_service.py`, `docx_service.py`, `docx_context_policy.py`, `docx_mapping_service.py`, `field_manifest.py`, `word_defaults.py` (danh mục v22), `required_word_variables.py` (mới), `word_publication_team_policy.py`, `routes_docx.py`, `document_job_routes.py`, `frontend/documents/requiredWordVariables.js` (mới), `WordPublicationJob.js`, `WordPublication.js`, `frontend/contracts/ContractWordExport.js`, `frontend/documents/wordVariableManifest.js` (sinh lại), công cụ `Templates_Bidding/_cong_cu`
- Liên quan: ADR 0105

## Bối cảnh

Sau ADR 0105 còn 28 chỗ `[[...]]` trong bộ 101 mẫu:

- 20 chỗ trong bảng tổng hợp **theo từng nhà thầu** của mẫu phân lô (PLQT1, PLQT1 V2, BCTĐ KQLCNT PL): số phần lô tham dự/đạt/không đạt/xếp hạng nhất, tổng giá phần lô. `ds_nt_tham_du` có một dòng cho mỗi cặp nhà thầu–phần lô nên không cộng được theo nhà thầu.
- 3 chỗ giá trị ưu đãi: `thong_tin_mo_thau.tong_gia_tri_cong_uu_dai` đã lưu (tính từ bảng hàng hóa dự thầu) nhưng bị bộ lọc ngữ cảnh Word loại bỏ.
- 3 chỗ "Ngày cuối hoàn thiện" (Thư chấp thuận) và 2 chỗ "Ngày báo cáo" (Giấy mời xác nhận năng lực, Báo cáo tư cách hợp lệ): chưa có dữ liệu.

## Quyết định

1. **Hạn trong thư là biến kết quả của từng không gian làm việc**, không phải biến hệ thống:
   - `ngay_han_hoan_thien_hd`: hạn cuối hoàn thiện, ký kết hợp đồng trong Thư chấp thuận (3 mẫu).
   - `ngay_han_xac_nhan_nl`: hạn phản hồi trong Giấy mời xác nhận năng lực và ngày của Báo cáo tư cách hợp lệ (2 mẫu KQCĐ CXN).
   - Quản lý/chủ không gian tạo hai biến này trong Biểu mẫu Word → Biến kết quả, công thức trả về một ngày, ví dụ `addDays(ngay_thu_chap_thuan, 10)` hoặc `addWorkingDays(ngay_phe_duyet_kh, 5)`. Ngày tính ra in dạng "dd/m/yyyy"; mẫu tự thêm chữ "ngày" khi câu chưa có ("Nếu đến ngày 09/4/2026", "Bắc Ninh, ngày 15/3/2026").
   - **Bắt buộc khi xuất**: nếu biểu mẫu được chọn dùng một trong hai biến (dạng `{bien}`, `{S_bien}` hoặc `{{ bien }}`, kể cả khi chữ bị tách qua nhiều đoạn trong Word) mà không gian làm việc chưa có biến cùng tên, lệnh xuất bị chặn với mã 422 `DOCUMENT_EXPORT_REQUIRED_VARIABLES_MISSING`, kèm danh sách biến thiếu và `canConfigure`.
   - Người có quyền quản lý cấu hình Word (quản lý tổ chức, chủ không gian cá nhân — quyền hiện có, không đổi) được hỏi "Cấu hình ngay": ứng dụng mở Biểu mẫu Word, điền sẵn tên biến, để trống công thức. Người khác được báo nhờ quản lý cấu hình. Xuất hàng loạt và xuất hợp đồng hiện đúng lời nhắn của máy chủ.
   - Bản đầu của ADR này tính sẵn hai ngày ở máy chủ (ngày văn bản + 10 ngày). Theo yêu cầu chủ sản phẩm cùng ngày, phần đó đã bỏ: danh mục mặc định không có hai biến này (v22), để mỗi không gian tự quyết quy tắc.
2. **Ưu đãi**: mỗi dòng nhà thầu có `tong_gia_tri_cong_uu_dai` (định dạng tiền, "0" khi không có ưu đãi).
3. **Bảng tổng hợp theo nhà thầu**: mẫu cấp gói thầu có thêm 3 danh sách, mỗi nhà thầu một dòng, cộng dồn qua các phần lô:
   - `ds_nt_tong_hop` (`ds_nha_thau_tong_hop`): mọi nhà thầu tham dự.
   - `ds_nt_tong_hop_dat_kt` (`ds_nha_thau_tong_hop_dat_ky_thuat`): nhà thầu có ít nhất một phần lô đạt kỹ thuật.
   - `ds_nt_tong_hop_hang_1` (`ds_nha_thau_tong_hop_xep_hang_1`): nhà thầu có ít nhất một phần lô xếp hạng 1.

   Trường của mỗi dòng: tên, mã, mã số thuế; số phần lô tham dự, đạt/không đạt năng lực, đạt kỹ thuật, xếp hạng 1; tổng giá phần lô, giá dự thầu, giá trị giảm giá (giá dự thầu − giá sau giảm giá), giá sau giảm giá, giá trị ưu đãi, giá đánh giá — cho tất cả phần lô, cho các phần lô đạt kỹ thuật và cho các phần lô xếp hạng 1. Tính hợp lệ/năng lực của nhà thầu: một giá trị nếu mọi phần lô giống nhau, ngược lại "Đạt N/M phần lô".

   Quy tắc:
   - "Đạt" theo tiêu chí của từng bảng: bảng năng lực, kinh nghiệm đếm phần lô có đánh giá năng lực "Đạt"/"Không đạt"; bảng kỹ thuật đếm phần lô có đánh giá kỹ thuật "Đạt" (phương pháp chấm điểm thì theo kết luận của dòng đó).
   - "Xếp hạng nhất" = cột Xếp hạng của phần lô là "Xếp hạng 1" ở bước đánh giá.
   - Giá phần lô lấy từ giá trị phần lô của gói; gói không chia lô dùng giá gói thầu.
4. Danh mục biến mặc định lên v22 (thêm 3 danh sách tổng hợp; không có biến hạn trong thư). Công cụ chuyển mẫu: trong thư mục phân lô, dòng bảng có các cột tổng hợp trên chuyển sang lặp theo danh sách tương ứng (theo cột tên nhà thầu của dòng); bảng nhà thầu trúng theo phần lô hiện có (`ds_nt_trung_kem_lo`) giữ nguyên. Chuyển lại bộ mẫu: 9 mẫu đổi; ngoài biến, văn bản chỉ thêm chữ "ngày" trước biến hạn ở 4 chỗ; không còn chỗ `[[...]]` luôn hiện.

## Không thay đổi

Không đổi role, module permission, record/assignment scope, entitlement, capability hay hiển thị dữ liệu. Danh sách tổng hợp chỉ cộng các dòng nhà thầu đã có trong ngữ cảnh xuất của gói; trường ưu đãi là cột của chính dòng mở thầu đó. Quyền xuất Word vẫn chỉ kiểm soát hành động tạo/tải. Việc chặn xuất chỉ áp dụng khi biểu mẫu dùng biến chưa cấu hình; ai được tạo biến kết quả vẫn theo `can_manage_word_config` hiện có.

## Tương thích và triển khai

Không có migration. Override và biến tự tạo cũ giữ nguyên. Cần khởi động lại Bidding, build lại frontend, tải lại 9 mẫu đã đổi lên "Biểu mẫu Word", và quản lý mỗi không gian tạo hai biến kết quả trước khi xuất Thư chấp thuận hoặc mẫu KQCĐ CXN (ứng dụng sẽ nhắc). Rollback: bỏ danh sách mới và bước kiểm tra; mẫu dùng biến chưa có sẽ in rỗng.

## Regression seams

`tests/test_contractor_summary_word_values.py` (đếm theo tiêu chí, phương pháp chấm điểm, tổng giá và giảm giá, danh sách lọc, gói không chia lô, trường ưu đãi, chính sách ngữ cảnh, danh mục biến); `tests/test_required_word_variables.py` (ba cú pháp và chữ bị tách, tên gần giống, biến đã định nghĩa, không phải biến mặc định, lời nhắn theo quyền, mã 422 của lệnh xuất); `tests/js/required_word_variables.test.mjs` (giữ chi tiết lỗi, lỗi bọc ngoài, hỏi cấu hình với quản lý, chỉ báo với nhân viên, mở form điền sẵn tên). Công cụ mẫu: `render_test.py` 101/101 với dữ liệu tính bằng chính hàm backend.
