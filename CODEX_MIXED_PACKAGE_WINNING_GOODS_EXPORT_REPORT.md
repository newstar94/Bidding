# Báo cáo mở rộng hàng hóa cho gói hỗn hợp và xuất hàng hóa trúng thầu

## 1. Tóm tắt thay đổi

- Bổ sung quy tắc dùng chung để nhận diện cả `Hàng hóa` và `Hỗn hợp` là lĩnh vực có nghiệp vụ hàng hóa, có chuẩn hóa `trim` ở frontend và backend.
- Mở rộng tab danh mục hàng hóa, hàng hóa dự thầu, đánh giá chi tiết, kiểm tra hoàn thành, ưu đãi/xếp hạng và validator backend cho gói `Hỗn hợp`.
- Cho phép chuyển lĩnh vực `Hàng hóa` ↔ `Hỗn hợp` khi gói đã có danh mục hàng hóa; vẫn chặn chuyển sang lĩnh vực không hỗ trợ hàng hóa.
- Bổ sung selector thuần xác định hàng hóa chính thức của đúng nhà thầu/lô trúng thầu.
- Bổ sung workbook Excel một sheet, đúng 12 cột, nhóm `nhà thầu → phần lô → hàng hóa`.
- Thêm nút **Xuất danh sách hàng hóa trúng thầu** tại kết quả lựa chọn nhà thầu chính thức, độc lập quyền xuất Word.
- Với nhân viên/luồng chỉ đọc, các thao tác không được phép được ẩn thay vì hiển thị mờ: khu tải biểu mẫu Word bị ẩn; nút xóa hàng hóa không còn render ở trạng thái `disabled`.

## 2. File thêm mới

- `backend/domain/__init__.py`
- `backend/domain/goods_workflow.py`
- `frontend/packages/goodsWorkflowSupport.js`
- `frontend/packages/winningGoodsSelectors.js`
- `frontend/packages/WinningGoodsExcel.js`
- `tests/js/winning_goods_export.test.mjs`
- `tests/js/award_result_winning_goods_button.test.mjs`
- `CODEX_MIXED_PACKAGE_WINNING_GOODS_EXPORT_REPORT.md`

## 3. File cập nhật

- `backend/sync/bidder_goods.py`
- `backend/sync/mapper.py`
- `backend/sync/ownership.py`
- `backend/sync/package_goods.py`
- `frontend/documents/WordIntegration.js`
- `frontend/packages/DetailedEvaluationSaveWorkflow.js`
- `frontend/packages/PackageGoodsWorkflow.js`
- `frontend/packages/bidderGoodsPreference.js`
- `frontend/packages/bidderGoodsSelectors.js`
- `frontend/packages/detail/AwardResultDetailsPanel.js`
- `frontend/packages/detail/AwardResultPanel.js`
- `frontend/packages/detail/PackageTabs.js`
- `frontend/packages/detailedEvaluationRules.js`
- `frontend/packages/packageGoodsValidation.js`
- `frontend/shared/BiddingCalculations.js`
- `tests/js/bidder_goods.test.mjs`
- `tests/js/package_goods.test.mjs`
- `tests/js/word_variable_readonly_layout.test.mjs`
- `tests/test_bidder_goods.py`
- `tests/test_package_goods.py`

## 4. Cách xác định nhà thầu và hàng hóa trúng thầu

Selector `selectWinningGoodsForExport` dùng ID bất biến và thực hiện theo thứ tự:

1. Xác nhận gói thuộc `Hàng hóa` hoặc `Hỗn hợp`.
2. Với gói không phân lô, lấy winner từ `pkg.nhaThauTrungThauId`.
3. Với gói phân lô, lấy winner riêng từ từng `phanLoList[].nhaThauTrungThauId` và giữ nguyên thứ tự `phanLoList`.
4. Tìm đúng hồ sơ mở thầu bằng `goiThauId + nhaThauId + phanLoId`; nếu opening không có ID lô thì dùng `maPhanLo` chuẩn hóa làm fallback.
5. Loại opening đã lưu trữ/xóa; chặn khi thiếu hoặc có nhiều opening không thể phân biệt.
6. Chỉ lấy dòng cùng `goiThauId`, `thongTinMoThauId`, đúng `phanLoId` và có `isDraft === false`.
7. Nếu phạm vi winner còn bất kỳ dòng nháp nào hoặc không có dòng chính thức, chặn xuất với thông báo nêu nhà thầu/lô và hành động cần làm.
8. Loại trùng theo ID dòng; fallback theo `thongTinMoThauId + goiThauHangHoaId`.
9. Sắp xếp theo `sortOrder`, sau đó `sttNguon` và ID; giữ `sttNguon` dạng `1.1`, `1.2`.
10. Tên liên danh/nhà thầu dùng helper chuẩn `resolveBidContractorName`.

Selector cũng phát hiện mâu thuẫn giữa winner cấp gói và winner cấp lô.

## 5. Gói phân lô có nhiều winner trong một file

Selector nhóm nhà thầu theo lần xuất hiện đầu tiên trong `phanLoList`. Các lô của cùng nhà thầu được đặt liền nhau và vẫn giữ thứ tự gốc của danh sách lô.

Workbook chỉ có một sheet `HangHoaTrungThau`:

```text
NHÀ THẦU: Nhà thầu A
PHẦN (LÔ): L01 - Lô 1
<12 cột hàng hóa>
PHẦN (LÔ): L03 - Lô 3
<12 cột hàng hóa>

NHÀ THẦU: Nhà thầu B
PHẦN (LÔ): L02 - Lô 2
<12 cột hàng hóa>
```

Dòng nhà thầu và phần lô đều merge đủ 12 cột. Không tạo ZIP hoặc nhiều file.

## 6. Công thức đơn giá trúng thầu

- Nếu có `giaTriCoSoSauGiamGia`, đơn giá xuất là:

  `giaTriCoSoSauGiamGia / khoiLuong`

- Phép chia dùng `BigInt`, biểu diễn phân số thập phân chính xác và làm tròn HALF_UP tối đa 6 chữ số thập phân qua helper tách từ logic ưu đãi hiện có.
- Nếu không lưu giá trị sau giảm giá, fallback về `donGiaDuThau` hợp lệ.
- Tuyệt đối không đọc `giaTriCongUuDai`, `giaDuThauSauUuDai`, `thanhTienSauUuDai`, `giaSoSanhSauUuDai`, `giaDanhGiaSauUuDai` hoặc `giaXepHang` để tạo đơn giá xuất.
- Thiếu giá hoặc khối lượng không hợp lệ sẽ chặn xuất, không tự ghi `0`.

## 7. Cấu trúc và an toàn Excel

Workbook có đúng 12 cột theo thứ tự yêu cầu, gồm nhãn `Kỹ mã hiệu` và `Đơn giá trúng thầu`. Không có cột ưu đãi, xếp hạng hoặc thành tiền.

- Dùng SheetJS vendor hiện có và `ensureXlsxLoaded`.
- Chống formula injection cho toàn bộ ô text bằng `escapeSpreadsheetFormula`.
- Giữ `STT`, `Năm sản xuất`, `Kỹ mã hiệu` và `Mã HS` ở dạng text; số 0 đầu không bị mất.
- Giá trị tiền vượt `Number.MAX_SAFE_INTEGER` được giữ dạng chuỗi chính xác.
- Có wrap text, độ rộng cột, header in đậm, merge heading và freeze pane an toàn.
- Tên file được sanitize: `Danh_sach_hang_hoa_trung_thau_<maGoiThau>.xlsx`.

## 8. Hỗ trợ gói Hỗn hợp

Hai helper `supportsGoodsWorkflow` và `supports_goods_workflow` được dùng tại:

- tab và trạng thái chỉnh sửa danh mục hàng hóa;
- tab hàng hóa dự thầu ở vòng `single` và `financial`, không mở ở vòng `technical` của 1G2T;
- cấu hình nhóm đánh giá chi tiết và kiểm tra hoàn thành;
- điều kiện chặn ưu đãi/xếp hạng;
- validator hàng hóa dự thầu backend;
- ownership danh mục hàng hóa;
- validator đổi lĩnh vực khi còn dữ liệu;
- lưu tiến độ đánh giá chi tiết phía server.

Các kiểm tra còn dùng điều kiện riêng `linhVuc === "Hàng hóa"` chỉ liên quan đến gói thuốc (`isThuoc`), nên không mở cho `Hỗn hợp`.

## 9. Kiểm thử bổ sung

- Helper lĩnh vực: trim, `Hàng hóa`, `Hỗn hợp`, từ chối `Tư vấn`/`Xây lắp`.
- Tab danh mục, quyền chỉnh sửa và tab hàng hóa dự thầu của gói hỗn hợp.
- Nhóm đánh giá chi tiết 1G1T/1G2T và cổng hoàn thành.
- Ưu đãi/xếp hạng gói hỗn hợp.
- Backend chấp nhận batch hỗn hợp, vẫn giữ kiểm tra sai lô, trùng mapping, thiếu mapping, lệch tổng và điều kiện kỹ thuật.
- Chuyển lĩnh vực `Hàng hóa` ↔ `Hỗn hợp`; chặn chuyển sang lĩnh vực khác.
- Selector winner không phân lô/phân lô, hai winner, một winner nhiều lô, loại loser/draft, opening mơ hồ, mâu thuẫn winner và liên danh.
- Đơn giá không giảm, sau giảm giá, có dữ liệu ưu đãi, số lớn và khối lượng thập phân.
- Workbook một sheet, đúng 12 cột, thứ tự nhóm, merge đủ 12 cột, formula injection và số 0 đầu.
- UI không render nút Excel khi chưa đủ phạm vi winner; không render thao tác bị cấm cho nhân viên.

## 10. Kết quả kiểm tra

| Lệnh | Kết quả |
|---|---|
| `python -m pytest -q tests` | Qua: 157 test, 8 cảnh báo thư viện/deprecation |
| `node --test tests/js/*.test.mjs` | Qua: 154 test |
| `npm run build:secure` | Qua; Trusted Types, vendor audit và Vite secure build thành công |
| `npm run check` | Qua; quality, coverage, JS, secure build, FK audit, production package và SBOM |
| `git diff --check` | Qua |

Chạy trực tiếp `pytest -q tests` bằng executable trong môi trường Windows không thêm workspace vào `sys.path`, nên dừng ở import `scripts.audit_fk_indexes`; cùng bộ test chạy bằng entrypoint chuẩn của repository `python -m pytest -q tests` đã qua toàn bộ. `npm run check` cũng dùng entrypoint này và đã qua.

## 11. Giới hạn và rủi ro còn lại

- Không chạy `npm run test:lifecycle` vì cần máy chủ E2E, tài khoản/mật khẩu và ba file Excel ngoài repository. Hai kịch bản không phân lô và nhiều lô/nhiều winner đã được kiểm thử tích hợp ở mức selector → workbook với SheetJS thực.
- SheetJS/Excel dùng số IEEE-754 cho ô số. Để không mất chính xác, đơn giá vượt miền an toàn được xuất dưới dạng text chính xác thay vì ép thành số.
- Repository đang có 68 cảnh báo ESLint nằm trong baseline cho phép; thay đổi này không làm tăng baseline và `npm run check` vẫn qua.

Không có commit hoặc push nào được thực hiện.
