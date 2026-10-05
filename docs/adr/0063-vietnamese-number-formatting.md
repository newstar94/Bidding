# ADR 0063: Chuẩn hóa hiển thị số theo định dạng Việt Nam

- **Trạng thái:** Đã chấp thuận và triển khai
- **Ngày:** 2026-10-05

## Quyết định

Các số hiển thị trong luồng đánh giá dùng dấu chấm cho hàng nghìn và dấu
phẩy cho phần thập phân. Ví dụ `97.05` hiển thị thành `97,05` và `1234.56`
hiển thị thành `1.234,56`.

Các ô nhập điểm dùng điều khiển văn bản với `inputmode="decimal"` để người
dùng có thể nhập dấu phẩy. Trước khi lưu, giá trị được phân tích về số
canonical; dữ liệu API, cơ sở dữ liệu và phép tính xếp hạng không đổi.

## Phạm vi áp dụng

- Điểm kỹ thuật, điểm tiêu chí chi tiết và tổng điểm.
- Điểm tổng hợp trong bảng xếp hạng và các bảng mở tài chính/phê duyệt.
- Tỷ lệ giảm giá trong bảng đánh giá.

## Tương thích và kiểm chứng

- Bộ phân tích nhận cả `97,05`, `97.05` và `1.234,56`.
- Không dùng formatter tiền nguyên cho điểm hoặc tỷ lệ phần trăm.
- Không thay đổi quyền, phạm vi dữ liệu, schema hoặc semantics nghiệp vụ.
- Regression: `tests/js/vietnamese_number_format.test.mjs` và các test đánh
  giá kỹ thuật hiện hành.
