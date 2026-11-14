# ADR 0107: Một giá xếp hạng duy nhất và giá tự điền trong bảng đánh giá

- Ngày: 2026-11-14
- Trạng thái: Chấp nhận. Chủ sản phẩm yêu cầu tự điền giá đánh giá và giá đề nghị trúng thầu, đồng ý gộp "giá xếp hạng" với "giá đánh giá sau ưu đãi" thành một con số, và yêu cầu giữ đúng quy tắc của phương pháp giá đánh giá (cùng ngày 2026-11-14).
- Phạm vi: `frontend/packages/bidEvaluationPriceDefaults.js` (mới), `BidEvaluationPriceCells.js`, `BidEvaluationRowRenderer.js`, `bidderGoodsPreference.js`, `BidderGoodsWorkflow.js`, `views/css/views.css`, `backend/domain/goods_preference.py`, `backend/sync/bidder_goods.py`, `backend/documents/award_result_excel_service.py`
- Liên quan: ADR 0106 (giá đánh giá trong bảng tổng hợp Word đã lấy giá xếp hạng)

## Bối cảnh

Ứng dụng có hai con số cùng ý nghĩa "giá dùng để so sánh, xếp hạng nhà thầu":

- **Giá xếp hạng** (`giaXepHang`, ô trong bảng đánh giá): người dùng tự nhập; xếp hạng nhà thầu chỉ dựa vào ô này.
- **Giá đánh giá sau ưu đãi** (`giaDanhGiaSauUuDai`): tính bằng giá xếp hạng + tổng giá trị cộng ưu đãi; chỉ dùng cho cột "Giá đánh giá" của Excel kết quả lựa chọn nhà thầu.

Thiết kế cũ coi giá xếp hạng là "giá nền" chưa có ưu đãi. Điều này mâu thuẫn với nghiệp vụ: giá dùng để xếp hạng luôn đã gồm ưu đãi. Hệ quả là xếp hạng bỏ qua ưu đãi, hoặc (khi giá xếp hạng đã gồm ưu đãi) cột Excel bị cộng ưu đãi hai lần, nhất là khi tính lại ưu đãi.

## Quyết định

1. **Giá xếp hạng là con số duy nhất** để so sánh, xếp hạng và in ra "Giá đánh giá" (Excel kết quả, Word).
2. **Tự điền trong bảng đánh giá** (ô vẫn cho nhập tay):
   - Giá xếp hạng = giá sau giảm giá + tổng giá trị cộng ưu đãi khi đánh giá chi tiết tài chính đã tính ưu đãi chính thức (`trangThaiTinhUuDai = "ready"`); ngược lại = giá sau giảm giá.
   - Giá đề nghị trúng thầu = giá sau giảm giá.
   - Chỉ tự điền khi ô đang trống hoặc đang bằng một giá tự điền trước đó (giá sau giảm giá). Giá người dùng gõ khác đi được giữ nguyên, không cộng thêm, không bị ghi đè. Khi giá dự thầu đổi trên dòng, các ô còn ở chế độ tự điền tính lại ngay.
   - Dòng chỉ xem/đã khóa hiển thị đúng giá đã lưu, không tự điền.
3. **Phương pháp giá đánh giá**: giá đánh giá = G + ΔG + giá trị ưu đãi (G là giá sau sửa lỗi, hiệu chỉnh sai lệch, trừ giảm giá).
   - Ứng dụng chưa có số ΔG có cấu trúc (tiêu chí ΔG trong đánh giá chi tiết là nội dung chữ), nên giá tự điền **chưa gồm ΔG**. Ô giá xếp hạng hiện nhắc "giá tự điền chưa gồm ΔG, hãy cộng ΔG (nếu có) theo E-HSMT" khi phương pháp là giá đánh giá và ô đang tự điền.
   - Khi người dùng gõ giá xếp hạng, giá đó là giá đánh giá cuối cùng (G + ΔG + ưu đãi), được giữ nguyên và dùng thẳng để xếp hạng; lời nhắc biến mất.
   - Giá trị ưu đãi do ứng dụng tính dựa trên giá sau giảm giá của từng mặt hàng. Nếu E-HSMT/quy định yêu cầu tính ưu đãi trên giá đánh giá của mặt hàng (đã gồm ΔG), người dùng tự nhập giá xếp hạng theo kết quả đúng. Tự động phân bổ ΔG theo mặt hàng là yêu cầu mới, chưa làm.
4. **`giaDanhGiaSauUuDai` giữ cột để tương thích** nhưng không còn là "giá xếp hạng + ưu đãi"; nay bằng giá sau giảm giá + tổng giá trị cộng ưu đãi (cùng giá trị với `giaSoSanhSauUuDai`). Cả bộ tính phía trình duyệt và máy chủ bỏ tham số `evaluationBase`/`evaluation_base`. Không còn đường nào cộng ưu đãi hai lần.
5. **Excel kết quả lựa chọn nhà thầu**: cột "Giá đánh giá" lấy `ket_qua_danh_gia_nha_thau.gia_xep_hang`.

## Không thay đổi

- Quy tắc xếp hạng (vẫn dựa vào giá xếp hạng), quy tắc giá đề nghị trúng thầu dưới 50%, cách tính tổng giá trị cộng ưu đãi.
- Quyền, phạm vi dữ liệu và hiển thị dữ liệu.

## Tương thích và chuyển đổi

- Không đổi schema, không cần migration.
- Dữ liệu cũ: cột "Giá đánh giá" của Excel đổi nguồn sang giá xếp hạng đã lưu. Gói có giá xếp hạng trống sẽ trống cột này cho đến khi mở bảng đánh giá (giá tự điền) và lưu lại.
- `giaDanhGiaSauUuDai` đã lưu trước đây giữ nguyên tới lần tính ưu đãi kế tiếp; không còn được đọc để xuất tài liệu.

## Kiểm thử hồi quy

- `tests/js/bid_evaluation_price_defaults.test.mjs`: giá tự điền, giữ giá nhập tay, tính ưu đãi nhiều lần không cộng hai lần, lời nhắc ΔG chỉ ở phương pháp giá đánh giá.
- `tests/test_goods_preference.py`: giá đánh giá sau ưu đãi bằng giá sau giảm + ưu đãi, tính lại không đổi.
- `tests/test_bidder_goods.py`: máy chủ không cộng ưu đãi vào giá xếp hạng.
- `tests/test_award_result_excel_service.py`: cột "Giá đánh giá" lấy giá xếp hạng.
