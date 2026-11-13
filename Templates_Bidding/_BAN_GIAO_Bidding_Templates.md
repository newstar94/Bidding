# Bàn giao: phần mềm Bidding và xử lý mẫu Word

Cập nhật: 13/11/2026. Mở cuộc trò chuyện mới, đính kèm file này và nói: "Đọc file bàn giao rồi làm tiếp phần Bidding/mẫu Word".

## 1. Thư mục trên máy

| Đường dẫn | Nội dung |
|---|---|
| `D:\Bidding` | Mã nguồn BiddingFlow (backend Python 3.14, frontend JS). **Không đọc hoặc sao chép `.env`, `.env.database.json`.** Tuân thủ `AGENTS.md`: không tự đổi quyền, masking, phạm vi hiển thị dữ liệu; thay đổi đã được duyệt phải có ADR, đánh giá tương thích và test. Chỉ sửa code khi chủ sản phẩm đồng ý. |
| `C:\Users\newst\OneDrive\Data\3. HCP\Phần mềm đấu thầu\Phần mềm\Templates` | 101 mẫu gốc (placeholder dạng `[[Tên]]`), đã định dạng lại theo Nghị định 30: thân 14pt, bảng 13pt, giãn dòng 1,2, cách đoạn 6pt, kẻ khung bảng. Bản trước khi định dạng: `_Backup_truoc_format`. |
| `D:\Bidding\Templates_Bidding` | 101 mẫu đã chuyển sang cú pháp Bidding (20 thư mục con), `_Bang_doi_chieu_bien_Bidding.xlsx` (sheet: Đã thay / Chưa có dữ liệu / Hướng dẫn), thư mục `_cong_cu` và file này. |
| `...\2026\00. Chỉ định thầu\58-60. 03 gói tiếng anh\Hiệp Hòa 3.xlsx` | File Excel nguồn của công cụ cũ, chứa quy tắc điền và chuỗi ngày. |

## 2. Cách Bidding xuất Word (đã đọc từ mã)

- Luồng: `custom_exporter.translate_xml_tags` → kiểm tra `template_security` → kết xuất bằng docxtpl 0.20.2 trong SandboxedEnvironment với **StrictUndefined**.
- `{bien}`: tên không tồn tại thì in rỗng.
- `{#ds}…{/ds}`: trong một dòng bảng thì thành vòng lặp theo dòng; ở chỗ khác là vòng lặp thường. Bên trong vòng lặp, `{x}` được hiểu là `item.x`. Muốn dùng biến gốc trong vòng lặp phải viết dạng gốc Jinja: `{{ goi_thau.x|default('', true) }}`.
- **Khóa gốc được phép:**
  - các khóa của ngữ cảnh;
  - biến ánh xạ;
  - `bangchu_<biến tiền>`;
  - `S_`/`s_<biến ngày>`.

  `nam_*` **không** được phép (sẽ báo lỗi kiểm tra).
- **Jinja được phép:**
  - Filter: capitalize, default, first, float, int, join, last, length, list, lower, replace, reverse, round, sort, string, title, trim, upper.
  - Lệnh: for, endfor, if, elif, else, endif.
  - Bị cấm: cộng, trừ, nhân, chia, nối chuỗi, gọi hàm, gán biến.
- **Định dạng:**
  - Ngày: "ngày dd tháng m năm yyyy". Bản `S_`: "dd/m/yyyy", riêng tháng 1 và 2 viết "01", "02".
  - Ngày giờ: "hh:mm ngày dd/m/yyyy".
  - Tiền: "288.000.000".
- **Ngữ cảnh plan:** ke_hoach, goi_thau (danh sách), chu_dau_tu, các danh sách ds_*.
- **Ngữ cảnh gói thầu** (evaluation/hsmt/opening/result/contract/liquidation): goi_thau, ke_hoach, chu_dau_tu, to_chuyen_gia, to_tham_dinh, nha_thau, các ds_nha_thau_*, ds_phan_lo*, hop_dong_list, current_time, today.
- **Biến mặc định** lấy từ catalog trong mã (`backend/documents/word_defaults.py`), không lưu thành dòng trong cơ sở dữ liệu. Mỗi không gian làm việc tùy biến bằng override thưa: đổi tên, đổi nguồn, ẩn, khôi phục.
- **Biến tính toán** (`__computed__`) chỉ tính được trên giá trị gốc: số học, ngày, if(). Không cộng dồn được trên danh sách.
- **Nhãn sai:** trường `ke_hoach.phe_duyet` chứa "Kế hoạch" hoặc "Dự toán và kế hoạch", nhưng nhãn trong từ điển biến ghi nhầm là "Họ tên người phê duyệt".

## 3. Thay đổi mã Bidding (ADR 0099, đã commit `a01a5a0f`, cần khởi động lại Bidding)

Mỗi mốc không lặp trên tab Tiến độ (48 mốc) có hai biến hệ thống: `{so_<mốc>}` (số văn bản) và `{ngay_<mốc>}` (ngày; dạng ngắn `{S_ngay_<mốc>}`).

**Ví dụ tên biến**
- `so_qd_tl_tcg`, `ngay_qd_tl_ttd`
- `so_bcdg`, `ngay_bcdg_tc`
- `so_bctd_kt`, `so_qd_kt`
- `so_bbdc`, `so_bctd_kq`
- `ngay_bbht_hd`, `ngay_thu_chap_thuan`
- `so_chung_thu_tdg`, `so_qd_tl_to`
- Ba mốc thêm `pd` để không trùng biến gói thầu đã có: `ttr_pd_hsmt`, `qd_pd_hsmt`, `qd_pd_kq`.
- Danh sách đủ: `MILESTONE_WORD_SLUGS` trong `backend/timeline/word_fields.py`.

**Quy tắc giá trị**
- Dùng đúng bộ đánh giá tiến độ của tab Tiến độ; chỉ lấy dòng có trạng thái APPLICABLE.
- Ngày thực tế được ưu tiên; chưa có thì lấy ngày dự kiến.
- Mẫu gói thầu dùng tiến độ của chính gói đó.
- Mẫu Kế hoạch chỉ điền nhóm "KHLCNT + dự toán", lấy từ gói cũ nhất có dữ liệu cho mốc đó.
- Biến tự tạo trùng tên với biến hệ thống thì biến tự tạo được ưu tiên, và biến hệ thống không được liệt kê ở không gian làm việc đó.

**File đã sửa hoặc thêm**
- `backend/timeline/word_fields.py` (mới)
- `backend/documents/timeline_context_service.py`
- `backend/documents/docx_service.py`
- `backend/documents/docx_context_policy.py`
- `backend/documents/field_manifest.py`
- `backend/documents/word_defaults.py` (mặc định v17, chặn trùng tên)
- `backend/documents/word_mapping_registry.py`
- `frontend/documents/wordVariableManifest.js` (sinh lại bằng `python scripts/generate_word_variable_manifest.py`)
- `frontend/partners/PartnerView.js`
- `docs/adr/0099-timeline-milestone-word-variables.md`
- `tests/test_timeline_word_variables.py` (mới)
- `tests/test_plan_basis_word_context.py`

**Chạy test trên máy ảo** (thư mục `D:\Bidding` gắn tại `~/mnt/Bidding`)
- Cài đặt: `uv python install 3.14` → `uv venv -p 3.14 ~/bfvenv` → `uv pip install -p ~/bfvenv/bin/python -r requirements-test.txt`.
- Chạy: `~/bfvenv/bin/python -m pytest -q -p no:cacheprovider tests/test_timeline_word_variables.py tests/test_word_mapping_registry.py ...`
- Lần gần nhất: 176 test liên quan đều đạt.
- Các test cần PostgreSQL hoặc trình duyệt Playwright không chạy được trên máy ảo, vì môi trường thiếu chứ không phải do lỗi.

## 4. Trạng thái 101 mẫu trong `Templates_Bidding`

- Cả 101 mẫu đều kết xuất được qua bản mô phỏng pipeline Bidding và là file Word hợp lệ.
- **28 chỗ còn để `[[...]]`** (13/11/2026: 465 chỗ TVL/TVT theo ADR 0100; 14/11/2026: "Bảo đảm thực hiện hợp đồng" theo ADR 0105, xem mục 5c):
  - 3 chỗ: Ưu đãi, Giá trị ưu đãi tổng. Có cột cộng ưu đãi nhưng không phải trường Word.
  - 5 chỗ: không có dữ liệu. Gồm "Ngày cuối hoàn thiện" (3) và "Ngày báo cáo" trong mẫu KQCĐ CXN (2).
  - 20 chỗ: số liệu theo từng nhà thầu trong mẫu phân lô: Số phần tham dự/đạt/không đạt/xếp hạng 1, Giá phần lô tham dự (đạt xếp hạng 1) tổng. `ds_nt_tham_du` có một dòng cho mỗi cặp nhà thầu–phần lô, nên cần danh sách mới gộp theo nhà thầu.
- **137 chỗ chỉ hiện `[[...]]` khi thiếu dữ liệu:**
  - Địa danh (66): khi địa chỉ chủ đầu tư không có tỉnh.
  - Địa danh TVL (23) / TVT (31): khi địa chỉ đơn vị tư vấn không có tỉnh.
  - ~~Các dòng tổng (38)~~: nay dùng biến tổng tính sẵn (ADR 0105).
  - Áp dụng Hình thức/Phương thức/Loại hợp đồng (12): ngoài 3 trường hợp đã biết.
  - Chứng thư thẩm định (5): khi mốc chưa có số và ngày.
- **Lưu ý trong mẫu:**
  - ~~`8. BCĐG PLQT2/5.1.1` có tên "Ngô Anh Tuấn" gõ sẵn ở 3 chỗ.~~ Đã bỏ trong mẫu gốc ngày 13/11/2026 và đã chuyển lại.
  - `8. BCĐG TVB2/5.4.1` có dòng "Hà Nội, [[Ngày thành lập TVL]]". Có lẽ phải là ngày báo cáo tài chính, nhưng hiện vẫn lấy ngày thành lập tổ chuyên gia.
  - `5. TVTB1/3.3` dùng nhầm biến "Ngày ký BBHT TVL"; đã cho lấy mốc biên bản hoàn thiện của tư vấn thẩm.

## 5. Công cụ chuyển đổi (`Templates_Bidding\_cong_cu`)

Chạy bằng Python 3, cần python-docx, docxtpl, openpyxl. Đường dẫn trong các script đều tính theo thư mục `_cong_cu`.

- `mapping.py`: toàn bộ bảng ánh xạ từ tên `[[...]]` sang biến Bidding.
  - ROOT, FORCE_SHORT, nhóm vòng lặp, UNMAPPED kèm lý do.
  - INFER/INFER_PREV: suy luận và giá trị dự phòng.
  - TIMELINE_ROOT, FOLDER_ROOT: biến tiến độ.
- `convert.py <thư mục mẫu NĐ30> <thư mục đích>`: chuyển mẫu và ghi `convert_report.json`.
- `build_xlsx.py <file.xlsx>`: dựng bảng đối chiếu từ `convert_report.json` và danh mục biến hiện hành của Bidding.
- `render_test.py <thư mục đã chuyển> <thư mục kết xuất>`: kết xuất thử với ngữ cảnh giả lập; kiểm tra không còn ngoặc `{}` và chữ "None". Kết quả từng file ghi vào `<thư mục kết xuất>/results.json`.
- `bf.py`: cầu nối tới backend trong cùng repo. Các công cụ dùng trực tiếp pipeline DOCX, `template_security` và danh mục biến (`build_frontend_defaults`, `build_frontend_field_metadata`) của Bidding. Không còn bản sao `vars.json`, `meta.json`, `template_security.py`, nên không phải sinh lại khi catalog biến thay đổi.
- Kiểm tra file Word hợp lệ: dùng `validate.py` của skill docx, chạy với `--original` là mẫu gốc.

## 5b. ADR 0100: biến đơn vị tư vấn (code đã commit `e36129e5`)

Chủ sản phẩm đã duyệt ngày 12/11/2026 phương án "Chỉ thông tin đơn vị": số, ngày, giá hợp đồng tư vấn giữ nguyên như mẫu đang làm.

**Đã xong**
- Hai khóa gốc mới: `don_vi_tu_van_lap` và `don_vi_tu_van_tham`.
- 26 biến hệ thống: `ten_tvl`, `ten_tat_tvl`, `mst_tvl`, `dai_dien_tvl`, `chuc_vu_dai_dien_tvl`, `danh_xung_tvl`, `dia_chi_tvl`, `sdt_tvl`, `email_tvl`, `stk_tvl`, `noi_mo_tk_tvl`, `ma_ngan_hang_tvl`, `anh_dau_tvl`, cùng bộ `_tvt` tương ứng.
- Danh mục biến mặc định v18.
- Mã: `backend/documents/consultant_context.py` (mới), `docx_service`, `docx_context_policy`, `docx_mapping_service`, `word_defaults`, `field_manifest`, `effective_timeline` (thêm `consultant_contract_kind`), `wordVariableManifest.js` (đã sinh lại), `WordIntegration.js`, `views/tabs/tab_bieumau.html`.
- ADR: `docs/adr/0100-consultant-firm-word-variables.md`.
- Test: `tests/test_consultant_word_variables.py` (mới) đạt cùng `test_timeline_word_variables.py` và `test_word_variable_labels.py`, tổng 30 test.
- Công cụ: `mapping.py` có `CONSULTANT_ROOT` và suy luận "Địa danh TVL/TVT" từ địa chỉ đơn vị; `render_test.py` có dữ liệu giả lập TVL/TVT.

**Chuyển lại mẫu (xong 13/11/2026)**
1. `convert.py` chạy từ 20 thư mục mẫu NĐ30 (bỏ `_Backup_truoc_format`, `Pictures`) vào thư mục tạm: 101 file, 0 lỗi.
2. `render_test.py`: 101/101 đạt, cả trên thư mục tạm lẫn `Templates_Bidding` sau khi chép. Giá trị giả lập TVL/TVT hiện đủ, không còn `[[...TVL/TVT]]`.
3. Chỉ chép 57 mẫu có nội dung thay đổi. 44 mẫu còn lại giống hệt từng phần bên trong nên giữ bản cũ. So sánh văn bản: 55 mẫu chỉ khác ở chỗ TVL/TVT; `8. BCĐG PLQT2/5.1.1` khác thêm do mẫu gốc vừa sửa; `4. TVLB2/2.8` và PLQT2 có phần đầu trang được Word đổi tên khi lưu (cấu trúc trang không đổi). `build_xlsx.py` đã chạy: sheet "Chưa có dữ liệu" còn 10 dòng.
4. Không chạy test Word: không đổi mã, và không test nào đọc `Templates_Bidding`.

**Còn lại**
1. Khởi động lại Bidding nếu chưa nạp mã ADR 0100.
2. Tải lại 57 mẫu đã đổi lên "Biểu mẫu Word" của từng không gian làm việc (ứng dụng không đọc trực tiếp thư mục này). Danh sách: `git status -- Templates_Bidding`.
3. Xuất thử một gói thầu có hợp đồng phân loại "Tư vấn" và "Thẩm định" để kiểm tra dữ liệu thật.

## 5c. ADR 0105: tổng kế hoạch và bảo đảm thực hiện hợp đồng (14/11/2026, chưa commit)

- Biến mới (danh mục v20, định dạng tiền, có `bangchu_`): `tong_gia_gt_kh`, `tong_gia_tri_da_th`, `tong_gia_tri_khong_ad`, `tmdt_tru_da_th` (chỉ mẫu Kế hoạch). Trường dòng nhà thầu `gia_tri_bao_dam_thuc_hien_hd` = tỷ lệ bảo đảm × giá sau giảm giá, dùng trong Thư chấp thuận: `{{ nt.gia_tri_bao_dam_thuc_hien_hd }}`.
- Mã: `backend/documents/computed_word_values.py` (mới), `docx_service`, `docx_bid_context_service`, `docx_context_policy`, `field_manifest`, `word_defaults`, `wordVariableManifest.js` (sinh lại). Test: `tests/test_computed_word_values.py`.
- Công cụ: `mapping.py` (`_total` dùng biến tổng, `Giá tổng dự toán` → `tmdt_tru_da_th`, `Bảo đảm thực hiện hợp đồng` trong `BID_ITEMS`), `bf.py` và `render_test.py` tính giá trị giả lập bằng chính hàm backend.
- Chuyển lại mẫu: chỉ 12 mẫu đổi (10 mẫu Kế hoạch, 2 Thư chấp thuận), so sánh văn bản xác nhận chỉ đổi đúng các chỗ trên; `render_test.py` 101/101. Cần tải lại 12 mẫu này lên "Biểu mẫu Word" sau khi khởi động lại Bidding.

## 6. Việc còn mở (chờ chủ sản phẩm quyết)

1. ~~Đưa thông tin đơn vị tư vấn ra Word (465 chỗ).~~ Xong: code theo ADR 0100, mẫu chuyển lại ngày 13/11/2026 (mục 5b).
2. ~~Xóa tên "Ngô Anh Tuấn" gõ sẵn trong mẫu PLQT2.~~ Xong ngày 13/11/2026.
3. Nếu đơn vị dùng phần mềm luôn là đơn vị tư vấn lập thì ánh xạ `[[Tư vấn lập]]` → `{ten_to_chuc}`.
4. Chuyển thư mục mẫu ra `D:\Templates_Bidding`.
5. ~~Tạo biến tính toán "Bảo đảm thực hiện hợp đồng"~~ (xong, ADR 0105). Còn: số liệu theo từng nhà thầu trong mẫu phân lô (đếm và cộng theo phần lô), chốt nghĩa "đạt"/"xếp hạng nhất"; nguồn giá trị ưu đãi; nơi nhập "Ngày cuối hoàn thiện" và "Ngày báo cáo".
6. ~~Commit git các thay đổi code~~ (đã commit `a01a5a0f`, `e36129e5`); còn khởi động lại Bidding.
7. Lần chạy test để lại 6 thư mục `data\document-worker-temp\job-*`. Bidding tự dọn sau 1 giờ.
