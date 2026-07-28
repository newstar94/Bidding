# Yêu cầu Codex triển khai chức năng nhập hàng hóa dự thầu của nhà thầu

Hãy làm việc trực tiếp trên repository Bidding hiện tại và triển khai đầy đủ chức năng **nhập thông tin hàng hóa dự thầu của nhà thầu trong phần Báo cáo đánh giá chi tiết**, dưới dạng một tab riêng có tên **Danh mục hàng hóa dự thầu**. Chức năng phục vụ bước đánh giá tài chính và áp dụng cho cả:

- Gói hàng hóa theo phương thức **1 giai đoạn 1 túi hồ sơ (1G1T)**.
- Gói hàng hóa theo phương thức **1 giai đoạn 2 túi hồ sơ (1G2T)**, tại tab/bước **đánh giá tài chính**.
- Gói không chia phần lô.
- Gói có chia phần lô.
- Một phần lô có một mặt hàng.
- Một phần lô có nhiều mặt hàng.
- Một nhà thầu tham dự một hoặc nhiều phần lô.

Dữ liệu hàng hóa dự thầu phải được đọc từ **Sheet 12.1** trong các file Excel mẫu được cung cấp cùng nhiệm vụ:

1. `Dự thầu không phân lô.xlsx`
2. `Dự thầu 1 phân lô 1 mặt hàng.xlsx`
3. `Dự thầu 1 phân lô nhiều mặt hàng.xlsx`

Không được chỉ dựng giao diện giả hoặc chỉ lưu dữ liệu ở frontend. Chức năng phải hoạt động đầy đủ từ giao diện, IndexedDB/local state, mutation queue, đồng bộ backend, PostgreSQL, phân quyền, kiểm tra dữ liệu, import/export Excel và kiểm thử E2E.

---

# I. Yêu cầu khảo sát bắt buộc trước khi sửa code

Trước khi triển khai, hãy đọc kỹ code trên **nhánh hiện tại đang được checkout**, không mặc định rằng `main` là phiên bản mới nhất.

Hãy xác định chính xác:

- Cơ chế hiện tại của `goi_thau_hang_hoa` hoặc thực thể tương đương.
- Cách hàng hóa yêu cầu được gắn với gói và phần lô.
- Cấu trúc `thongtinmothau` hoặc thực thể đại diện nhà thầu/phần lô trong mở thầu.
- Cấu trúc đánh giá 1G1T.
- Cấu trúc tab kỹ thuật và tài chính của 1G2T.
- Cách `BidEvaluationWorkflow`, table presentation, row renderer và actions hiện hoạt động.
- Cơ chế lưu nháp, lưu chính thức hoặc chốt đánh giá tài chính.
- Cơ chế IndexedDB, mutation queue, auto sync, sync version và row version.
- Access policy theo workspace, module và phân công gói thầu.
- Schema contract và file runtime được sinh tự động.
- Cơ chế import/export Excel và document worker hiện có.
- Cơ chế tạo phiên bản gói thầu và đấu thầu lại.
- Bộ test hiện tại liên quan đến đánh giá, hàng hóa, Excel, sync và quyền.

Nếu trong branch hiện tại đã có một phần chức năng tương tự, phải **tái sử dụng và mở rộng**, không tạo module trùng lặp.

Trước khi code, hãy ghi ngắn gọn trong báo cáo cuối:

- Các file đã khảo sát.
- Kiến trúc hiện tại.
- Những điểm sẽ tái sử dụng.
- Những điểm cần bổ sung.

---

# II. Phạm vi nghiệp vụ

## 1. Điều kiện và vị trí hiển thị

Chức năng chỉ xuất hiện khi:

```text
pkg.linhVuc === "Hàng hóa"
```

### Vị trí bắt buộc

Không hiển thị chức năng này trong **bảng đánh giá tổng quát bên ngoài**.

Cụ thể, không được thêm vào bảng tổng quát:

- Cột `Hàng hóa dự thầu`.
- Nút `Nhập hàng hóa` hoặc `Xem hàng hóa`.
- Badge số lượng hàng hóa.
- Trạng thái thiếu/đủ hoặc chênh lệch giá.
- Bất kỳ nội dung chi tiết hàng hóa nào.

Người dùng tiếp tục mở **Báo cáo đánh giá chi tiết** bằng luồng/nút hiện có của ứng dụng. Trong phần Báo cáo đánh giá chi tiết, bổ sung một tab mới:

```text
Danh mục hàng hóa dự thầu
```

Tab này phải nằm cùng hệ thống tab hiện có của Báo cáo đánh giá chi tiết, ưu tiên đặt ngay sau tab `Tài chính` hoặc tại vị trí hợp lý nhất theo cấu trúc hiện tại.

### Theo phương thức đánh giá

- **1G1T hàng hóa:** hiển thị tab `Danh mục hàng hóa dự thầu` trong Báo cáo đánh giá chi tiết của nhà thầu/phần lô đang chọn.
- **1G2T hàng hóa:** chỉ hiển thị hoặc cho phép truy cập tab này khi nhà thầu đã đủ điều kiện vào bước đánh giá tài chính theo logic hiện có; không hiển thị trong phần đánh giá kỹ thuật.
- **Gói có phần lô:** tab phải làm việc theo đúng nhà thầu và phần lô đang được đánh giá; có thể cho phép lọc/chuyển phần lô trong tab nếu Báo cáo đánh giá chi tiết hiện hỗ trợ một nhà thầu tham dự nhiều phần lô.

Không hiển thị với:

- Gói tư vấn.
- Gói xây lắp.
- Gói phi tư vấn.
- Các lĩnh vực khác.

Không tạo thêm một nút điều hướng mới ở bảng tổng quát nếu ứng dụng đã có nút mở Báo cáo đánh giá chi tiết. Phải tái sử dụng đúng luồng mở báo cáo chi tiết hiện tại.

## 2. Ý nghĩa dữ liệu

Phải phân biệt rõ hai loại dữ liệu:

```text
Hàng hóa yêu cầu của bên mời thầu
    ↕ đối chiếu
Hàng hóa dự thầu do từng nhà thầu chào
```

Không được ghi thông tin hàng hóa dự thầu của nhà thầu vào bảng `goi_thau_hang_hoa`.

`goi_thau_hang_hoa` hoặc thực thể tương đương là danh mục yêu cầu gốc của gói thầu/phần lô.

Cần tạo thực thể riêng cho hàng hóa dự thầu của từng nhà thầu.

---

# III. Phân tích Sheet 12.1 và danh sách cột

## 1. Sheet nguồn

Đọc Sheet có tên tương ứng với:

```text
Mẫu số 12.1B. Bảng giá dự thầu
```

Tên sheet trong file thực tế có thể có khoảng trắng cuối hoặc khác biệt nhỏ về chữ hoa/thường.

Thứ tự nhận diện:

1. Tên sau khi chuẩn hóa khớp chính xác `Mẫu số 12.1B. Bảng giá dự thầu`.
2. Tên chứa `12.1B`.
3. Tên chứa đồng thời `12.1` và `Bảng giá dự thầu`.

Không được đọc nhầm Sheet 11.1.

Không được mặc định Sheet 12.1 luôn nằm ở vị trí thứ hai.

## 2. Các cột phải lấy

### Cột dùng chung

- `STT`
- `Danh mục hàng hóa`
- `Ký mã hiệu`
- `Nhãn hiệu`
- `Năm sản xuất`
- `Xuất xứ (quốc gia, vùng lãnh thổ)`
- `Hãng sản xuất`
- `Cấu hình, tính năng kỹ thuật cơ bản`
- `Đơn vị tính`
- `Khối lượng`
- `Mã HS`
- `Đơn giá dự thầu (đã bao gồm thuế, phí, lệ phí (nếu có))`
- `Thành tiền (đã bao gồm thuế, phí, lệ phí (nếu có))`

### Cột bổ sung với file có phần lô

- `Mã phần (lô)`
- `Tên phần (lô)`

## 3. Các cột phải bỏ qua hoàn toàn

Theo yêu cầu nghiệp vụ, không lấy và không lưu ba cột:

- `Mặt hàng dự thầu`
- `Mã hàng hóa`
- `Phân nhóm`

Ba cột này:

- Không hiển thị trong preview.
- Không lưu IndexedDB.
- Không gửi lên backend.
- Không lưu PostgreSQL.
- Không đưa vào export từ dữ liệu ứng dụng.
- Không được sử dụng làm khóa ghép chính.

## 4. Alias tiêu đề cần hỗ trợ

Parser phải chấp nhận tối thiểu:

```text
Ký mã hiệu / Kỹ mã hiệu
Khối lượng / Số lượng
Mã phần (lô) / Mã phần lô / Mã lô
Tên phần (lô) / Tên phần lô / Tên lô
Xuất xứ / Xuất xứ (quốc gia, vùng lãnh thổ)
Đơn giá dự thầu / Đơn giá
Thành tiền / Tổng tiền
Cấu hình, tính năng kỹ thuật cơ bản / Cấu hình kỹ thuật / Thông số kỹ thuật
```

Dữ liệu sau import phải chuẩn hóa tên trường, không giữ lỗi chính tả `Kỹ mã hiệu` trong model.

## 5. Kiểu dữ liệu đặc biệt

### STT

Lưu dạng `TEXT`, vì dữ liệu có thể là:

```text
1
1.1
1.2
1.3
```

Không lưu STT dạng số thực.

### Năm sản xuất

Lưu dạng `TEXT`, vì dữ liệu có thể là:

```text
2024 trở về sau
Năm 2025 trở về sau
Từ 2026 trở đi
```

### Mã HS

Lưu dạng `TEXT`, không parse thành số vì có thể:

- Có số 0 đầu.
- Có dấu chấm.
- Có nhiều mã.
- Có nội dung mô tả.

### Khối lượng

Lưu kiểu số phù hợp với schema hiện tại, hỗ trợ số nguyên và số thập phân dương.

### Tiền

`Đơn giá dự thầu` và `Thành tiền` phải sử dụng cùng chuẩn lưu tiền của ứng dụng hiện tại.

Không dùng số thực nhị phân cho tiền.

Phải đưa các trường mới vào `MONEY_COLUMNS` hoặc cơ chế tương đương nếu repository đang sử dụng danh sách khai báo tiền tệ.

---

# IV. Mô hình dữ liệu đề xuất

## 1. Tạo thực thể mới

Tên backend ưu tiên:

```text
hang_hoa_du_thau_nha_thau
```

Frontend state key ưu tiên:

```text
hanghoaduthaunhathau
```

Có thể điều chỉnh tên theo convention thực tế của repository, nhưng phải giữ ý nghĩa rõ ràng và không trùng với `goi_thau_hang_hoa`.

## 2. Các trường tối thiểu

```text
id
organization_id
owner_type
goi_thau_id
thong_tin_mo_thau_id
phan_lo_id
goi_thau_hang_hoa_id
stt_nguon
danh_muc_hang_hoa
ky_ma_hieu
nhan_hieu
nam_san_xuat
xuat_xu
hang_san_xuat
cau_hinh_tinh_nang_ky_thuat
don_vi_tinh
khoi_luong
ma_hs
don_gia_du_thau
thanh_tien_du_thau
sort_order
import_batch_id
is_draft
row_version
sync_version
created_at
updated_at
```

## 3. Ý nghĩa quan hệ

- `goi_thau_id`: ID phiên bản gói thầu hiện tại.
- `thong_tin_mo_thau_id`: bản ghi đại diện cho nhà thầu đang được đánh giá trong gói/phần lô.
- `phan_lo_id`: bắt buộc nếu gói có phần lô; `NULL` nếu gói không phân lô.
- `goi_thau_hang_hoa_id`: hàng hóa yêu cầu tương ứng.
- `danh_muc_hang_hoa`: snapshot tên hàng hóa tại thời điểm nhập để bảo toàn lịch sử hiển thị.

## 4. Ràng buộc duy nhất

Trong phạm vi một bản ghi mở thầu, mỗi hàng hóa yêu cầu chỉ được ánh xạ một lần:

```sql
UNIQUE (
    organization_id,
    thong_tin_mo_thau_id,
    goi_thau_hang_hoa_id
)
```

Nếu kiến trúc hiện tại cho phép một hàng hóa yêu cầu có nhiều cấu hình hoặc nhiều dòng chào, phải khảo sát dữ liệu thực tế và điều chỉnh unique constraint hợp lý; không được tự ý cho phép trùng mà không có khóa nghiệp vụ rõ ràng.

## 5. Foreign key và index

Tạo foreign key/index phù hợp cho:

- `organization_id + goi_thau_id`
- `organization_id + thong_tin_mo_thau_id`
- `organization_id + phan_lo_id`
- `organization_id + goi_thau_hang_hoa_id`
- `organization_id + import_batch_id`

Backend phải kiểm tra toàn bộ tham chiếu thuộc cùng workspace và cùng gói thầu, không chỉ dựa vào foreign key đơn.

---

# V. Quan hệ với gói thầu, nhà thầu và phần lô

## 1. Gói không phân lô

```text
phan_lo_id = NULL
```

Tất cả hàng hóa dự thầu được gắn với `thong_tin_mo_thau_id` của nhà thầu trong gói.

## 2. Gói có phần lô

Mỗi dòng phải gắn đúng:

```text
nhà thầu
+ bản ghi mở thầu
+ phần lô
+ hàng hóa yêu cầu
```

Backend phải xác minh:

- Phần lô tồn tại.
- Phần lô thuộc đúng gói.
- Nhà thầu thực sự tham dự phần lô đó.
- Hàng hóa yêu cầu thuộc đúng phần lô.
- Không thể gửi `phan_lo_id` hoặc `goi_thau_hang_hoa_id` của gói khác.

## 3. Một nhà thầu tham dự nhiều phần lô

Khi import một file có nhiều phần lô cho cùng nhà thầu:

- Xác định tất cả bản ghi mở thầu của nhà thầu đó trong gói.
- Ghép từng dòng theo mã phần lô.
- Gắn đúng `thong_tin_mo_thau_id` tương ứng.
- Lưu toàn bộ batch trong một transaction logic.
- Không được gán dữ liệu sang bản ghi của nhà thầu khác.

---

# VI. Parser Excel Sheet 12.1

## 1. Tìm header động

Không hard-code header luôn ở dòng 4.

Tìm dòng có tối thiểu các tiêu đề chuẩn hóa:

```text
STT
Danh mục hàng hóa
Đơn vị tính
Khối lượng
Đơn giá dự thầu
Thành tiền
```

Với file phần lô, tìm thêm:

```text
Mã phần lô
Tên phần lô
```

## 2. Bỏ các dòng không phải hàng hóa

Không import:

- Dòng tiêu đề.
- Dòng trống.
- Dòng `Tổng cộng giá dự thầu`.
- Dòng `Số tiền bằng chữ`.
- Dòng `Chi phí dự phòng`.
- Dòng ghi chú cuối biểu mẫu.
- Dòng tổng phần lô.
- Dòng cha chỉ dùng để mô tả phần lô.

## 3. Một phần lô nhiều mặt hàng

File mẫu có thể có cấu trúc:

```text
1    Dòng phần lô
1.1  Hàng hóa thứ nhất
1.2  Hàng hóa thứ hai
1.3  Hàng hóa thứ ba
```

Parser phải:

1. Nhận diện dòng cha của phần lô.
2. Ghi nhớ phần lô hiện tại.
3. Nhận diện các STT con bắt đầu bằng `STT-cha.`.
4. Gắn các dòng con vào phần lô đang nhớ.
5. Không lưu dòng cha như một hàng hóa nếu dòng đó chỉ là tổng/phần lô.
6. Không nhận một giá trị mẫu hoặc giá trị rác trong ô mã lô là phần lô hợp lệ.
7. Chỉ chấp nhận mã lô tồn tại trong danh sách phần lô của gói.

Không được chỉ dùng điều kiện ô trống để nhận diện dòng cha/con.

## 4. Công thức Excel

Nếu ô dùng công thức:

- Ưu tiên giá trị cached nếu có.
- Nếu không có cached value, tính được công thức đơn giản khi an toàn hoặc báo lỗi rõ ràng.
- Không tự chạy macro.
- Không thực thi nội dung bên ngoài workbook.

## 5. Bảo mật file

Tuân thủ cơ chế sandbox/document worker hiện tại.

Kiểm tra:

- File sai MIME.
- File đổi đuôi giả.
- File quá lớn.
- Workbook lỗi.
- Sheet thiếu.
- Header thiếu.
- Công thức hoặc chuỗi bắt đầu bằng `=`, `+`, `-`, `@` khi export để ngăn spreadsheet injection.

---

# VII. Ghép với danh mục hàng hóa yêu cầu

## 1. Điều kiện bắt buộc

Nếu gói chưa có danh mục hàng hóa yêu cầu, không cho import hàng hóa dự thầu.

Hiển thị thông báo:

```text
Gói thầu chưa có danh mục hàng hóa yêu cầu.
Vui lòng nhập danh mục hàng hóa của gói/phần lô trước khi nhập hàng hóa dự thầu của nhà thầu.
```

## 2. Thứ tự ghép

Trong đúng gói và đúng phần lô:

1. Mapping đã được người dùng xác nhận trước đó.
2. Ghép theo STT/sort order khi số lượng và cấu trúc tương ứng rõ ràng.
3. Ghép chính xác theo tên `Danh mục hàng hóa` đã chuẩn hóa.
4. Ghép theo tên + đơn vị tính + khối lượng.
5. Đề xuất fuzzy match nếu chỉ có một ứng viên đủ tin cậy.

Không tự lưu khi:

- Có nhiều ứng viên.
- Không đủ tin cậy.
- Tên trùng nhưng đơn vị/khối lượng khác.

## 3. Xử lý không khớp

Preview phải cho phép người dùng chọn hàng hóa yêu cầu bằng dropdown.

Mỗi dòng cần trạng thái:

```text
Đã ghép tự động
Đã ghép thủ công
Chưa ghép
Trùng hàng hóa yêu cầu
Sai phần lô
Không tìm thấy phần lô
```

Không được lưu chính thức nếu còn dòng chưa ghép hoặc trùng mapping.

---

# VIII. Vị trí chức năng và UI/UX trong Báo cáo đánh giá chi tiết

## 1. Không thay đổi bảng đánh giá tổng quát

Tuyệt đối không thêm cột, nút, badge hoặc trạng thái hàng hóa dự thầu vào bảng đánh giá tổng quát bên ngoài.

Bảng tổng quát phải giữ nguyên mục đích tổng hợp và mật độ thông tin hiện tại. Chức năng hàng hóa dự thầu chỉ được truy cập sau khi người dùng mở **Báo cáo đánh giá chi tiết** bằng luồng hiện có.

Không được làm thay đổi:

- Cấu trúc cột của bảng đánh giá tổng quát.
- Chiều rộng và khả năng cuộn hiện tại của bảng tổng quát.
- Luồng lưu nhanh hoặc chốt kết quả tổng quát.
- Giao diện của các gói không phải hàng hóa.

## 2. Tab mới trong Báo cáo đánh giá chi tiết

Bổ sung một tab mới có nhãn chính xác:

```text
Danh mục hàng hóa dự thầu
```

Tab phải được đăng ký trong cùng tab system/router/state machine đang dùng cho Báo cáo đánh giá chi tiết, không tạo một hệ tab riêng chồng lên giao diện hiện tại.

Vị trí ưu tiên:

```text
... → Tài chính → Danh mục hàng hóa dự thầu
```

Nếu cấu trúc tab hiện tại có thứ tự khác, hãy đặt tab ngay cạnh phần tài chính nhưng vẫn giữ logic điều hướng nhất quán.

Điều kiện:

- Chỉ có với `pkg.linhVuc === "Hàng hóa"`.
- 1G1T: hiển thị trong Báo cáo đánh giá chi tiết của nhà thầu/phần lô đang chọn.
- 1G2T: chỉ cho nhà thầu đã qua kỹ thuật và được phép đánh giá tài chính theo logic hiện có.
- Không hiển thị trong ngữ cảnh kỹ thuật 1G2T.
- Chế độ chỉ đọc vẫn xem được tab nhưng không được chỉnh sửa.

## 3. Ngữ cảnh hiển thị trong tab

Phần đầu tab phải thể hiện rõ ngữ cảnh hiện tại mà không lặp lại quá nhiều thông tin:

```text
Nhà thầu
Gói thầu
Phần lô (nếu có)
Phương thức 1G1T hoặc 1G2T
Trạng thái đánh giá tài chính
```

Nếu Báo cáo đánh giá chi tiết đã có header chung chứa các thông tin này thì phải tái sử dụng header đó, không tạo thêm một header lớn trùng lặp.

Với một nhà thầu tham dự nhiều phần lô, áp dụng pattern điều hướng hiện có của Báo cáo đánh giá chi tiết. Chỉ thêm dropdown/bộ lọc phần lô nếu thực sự cần và phải đồng bộ với state nhà thầu/phần lô đang chọn.

## 4. Thanh công cụ trong tab

Các thao tác được bố trí trong toolbar của tab:

- Tải file mẫu hoặc hướng dẫn.
- Chọn file Excel.
- Preview trước khi nhập.
- Thêm thủ công.
- Tìm kiếm.
- Lọc phần lô nếu có nhiều phần lô.
- Chế độ gộp.
- Chế độ thay thế.
- Xuất danh sách đã nhập ra Excel.
- Lưu nháp.
- Lưu chính thức nếu workflow hiện tại phân biệt hai trạng thái.

Không dồn quá nhiều nút ngang hàng. Phân nhóm thao tác chính/phụ theo đúng pattern toolbar hiện có của ứng dụng; các thao tác ít dùng có thể đặt trong menu `Thêm` hoặc menu ba chấm nếu ứng dụng đang dùng pattern đó.

## 5. Bảng danh mục trong tab

Bảng chi tiết gồm:

```text
STT
Danh mục hàng hóa
Ký mã hiệu
Nhãn hiệu
Năm sản xuất
Xuất xứ
Hãng sản xuất
Cấu hình, tính năng kỹ thuật cơ bản
Đơn vị tính
Khối lượng
Mã HS
Đơn giá dự thầu
Thành tiền
Trạng thái ghép
Thao tác
```

Yêu cầu trải nghiệm:

- Header bảng sticky nếu bảng dài và pattern hiện tại hỗ trợ.
- Cố định hợp lý các cột nhận diện như STT/Danh mục hàng hóa nếu ứng dụng đã có frozen columns.
- Nội dung kỹ thuật dài phải được rút gọn có tooltip/expand, không làm một dòng cao bất thường.
- Tiền và số căn phải, định dạng theo convention tiền tệ hiện tại.
- Text tiếng Việt không bị cắt mất ý; có tooltip hoặc xem chi tiết.
- Hỗ trợ tìm kiếm, lọc và phân trang theo pattern hiện có.
- Tránh tạo bảng ngang quá khó sử dụng; có thể dùng column visibility hoặc panel xem chi tiết nếu ứng dụng đã có pattern tương tự.

## 6. Thêm, sửa và preview

Có thể sử dụng modal/drawer/form inline tùy pattern hiện tại của ứng dụng, nhưng phải thống nhất với các màn hình khác.

Khi thêm thủ công, tự điền từ hàng hóa yêu cầu:

- Danh mục hàng hóa.
- Đơn vị tính.
- Khối lượng yêu cầu.
- Phần lô.
- Thứ tự.

Người dùng nhập các thông tin nhà thầu chào và giá.

Preview import phải hiển thị rõ:

- Dòng thêm mới.
- Dòng cập nhật.
- Dòng bị bỏ qua.
- Dòng lỗi.
- Trạng thái ghép hàng hóa yêu cầu.
- Phần lô tương ứng.
- Tổng số dòng và tổng giá trị.

## 7. Trạng thái tổng hợp chỉ nằm trong tab chi tiết

Các trạng thái sau chỉ hiển thị trong tab `Danh mục hàng hóa dự thầu` hoặc header của Báo cáo đánh giá chi tiết, không đưa ra bảng tổng quát:

```text
Đã nhập 5/5 hàng hóa
Thiếu 2/5 hàng hóa
Có lỗi đối chiếu
Khớp giá dự thầu
Chênh lệch giá
```

## 8. Chế độ chỉ đọc

Khi đánh giá tài chính bị khóa hoặc người dùng không có quyền sửa:

- Tab vẫn hiển thị để xem nếu người dùng có quyền đọc.
- Không cho thêm/sửa/xóa/import/thay thế.
- Không hiển thị nút lưu.
- Các control chỉnh sửa phải bị ẩn hoặc disabled đúng convention hiện tại.
- Backend vẫn phải kiểm tra quyền, không chỉ khóa UI.

## 9. Yêu cầu đồng bộ UI/UX với toàn bộ ứng dụng

UI/UX của tab mới phải hòa nhập với giao diện hiện tại, không được tạo cảm giác đây là một module được ghép thêm độc lập.

Trước khi triển khai, hãy khảo sát và tái sử dụng:

- Design tokens, CSS variables và theme hiện có.
- Kiểu tab trong Báo cáo đánh giá chi tiết.
- Typography, cỡ chữ, font weight và line-height.
- Khoảng cách, padding, border radius và shadow.
- Button variants, icon set và kích thước icon.
- Input, select, dropdown, modal/drawer, tooltip và pagination.
- Table component, empty state, loading skeleton và error state.
- Toast/notification và confirmation dialog.
- Quy tắc responsive và breakpoints.
- Dark/light mode nếu ứng dụng hỗ trợ.

Không được:

- Tạo bộ màu riêng.
- Tự đưa thư viện UI mới vào chỉ cho chức năng này.
- Dùng icon khác phong cách.
- Dùng modal, nút, bảng hoặc thông báo khác convention hiện tại.
- Viết CSS global gây ảnh hưởng màn hình khác.
- Sao chép style thủ công khi đã có component hoặc utility dùng chung.

Yêu cầu trải nghiệm tối thiểu:

- Có loading, empty, error và success state rõ ràng.
- Không mất dữ liệu người dùng khi import hoặc validation lỗi.
- Có cảnh báo trước thao tác thay thế toàn bộ/xóa dữ liệu.
- Chống double submit và disable nút khi đang lưu.
- Giữ focus hợp lý khi mở/đóng modal hoặc drawer.
- Hỗ trợ bàn phím cơ bản và focus-visible.
- Label, aria-label hoặc accessible name đầy đủ cho control quan trọng.
- Nội dung và thông báo lỗi dùng cùng giọng văn tiếng Việt của ứng dụng.
- Responsive tối thiểu cho desktop phổ biến; trên viewport hẹp phải cuộn/thu gọn có chủ đích, không vỡ layout.

Codex phải ưu tiên mở rộng component hiện có. Chỉ tạo component mới khi không có component phù hợp, và component mới vẫn phải tuân theo kiến trúc UI hiện tại.

---

# IX. Kiểm tra tài chính

## 1. Thành tiền từng dòng

Kiểm tra:

```text
Khối lượng × Đơn giá dự thầu = Thành tiền
```

Cho phép sai lệch tối đa 1 VND do làm tròn.

Nếu sai lệch lớn hơn:

- Hiển thị cảnh báo ở dòng.
- Cho phép lưu nháp.
- Không cho lưu chính thức/chốt tài chính.

## 2. Tổng theo nhà thầu/phần lô

Tính:

```text
Tổng hàng hóa dự thầu = tổng Thành tiền của các dòng
```

Đối chiếu với giá dự thầu trước giảm giá của bản ghi mở thầu tương ứng.

Hiển thị:

```text
Khớp giá dự thầu
Chênh lệch +1.200.000 đồng
Chênh lệch -500.000 đồng
Chưa nhập đủ hàng hóa
```

## 3. Giảm giá

Trong MVP:

- Giữ cơ chế giảm giá hiện tại của bản ghi mở thầu.
- Không tự phân bổ giảm giá xuống từng mặt hàng.
- Không ghi đè giá sau giảm giá bằng tổng mặt hàng.

Nếu code hiện tại đã có cơ chế phân bổ giảm giá đáng tin cậy thì phải khảo sát và tích hợp, không tạo logic thứ hai mâu thuẫn.

## 4. Điều kiện lưu chính thức/chốt

Không cho chốt đánh giá tài chính nếu:

- Có dòng chưa ghép.
- Thiếu hàng hóa yêu cầu bắt buộc.
- Một hàng hóa yêu cầu bị ghép nhiều lần.
- Có dòng sai phần lô.
- Nhà thầu không tham dự phần lô.
- Khối lượng không hợp lệ.
- Đơn giá/thành tiền không hợp lệ.
- Thành tiền dòng không khớp phép tính.
- Tổng thành tiền không khớp giá dự thầu theo ngưỡng được quy định.
- Đồng bộ server chưa thành công.

Lưu nháp phải được phép khi dữ liệu chưa hoàn thiện, nhưng trạng thái lỗi phải được giữ rõ ràng.

---

# X. Chế độ import

## 1. Gộp dữ liệu

Mặc định:

- Dòng đã tồn tại theo hàng hóa yêu cầu: cập nhật.
- Dòng mới: tạo.
- Dòng cũ không có trong file: giữ nguyên.

## 2. Thay thế toàn bộ phạm vi

Phạm vi thay thế là:

```text
nhà thầu + phần lô
```

hoặc toàn bộ các phần lô của nhà thầu nếu người dùng chọn import nhiều phần lô.

Yêu cầu:

- Cảnh báo rõ số dòng sẽ bị xóa/thay thế.
- Chỉ thực hiện khi toàn bộ file hợp lệ.
- Thao tác phải atomic ở mức nghiệp vụ.
- Nếu một mutation lỗi, không để dữ liệu ở trạng thái lưu một phần.

## 3. Import batch

Mỗi lần import có `import_batch_id` để:

- Truy vết nguồn.
- Hiển thị lịch sử cơ bản nếu cần.
- Hỗ trợ rollback logic khi import thất bại.

Không cần xây giao diện lịch sử import phức tạp trong MVP nếu repository chưa có pattern tương ứng.

---

# XI. Đồng bộ, IndexedDB và backend

## 1. Frontend state

Thêm entity mới vào đúng các danh sách khai báo tường minh:

- State mặc định.
- Storage keys.
- Synced state keys.
- IndexedDB object stores.
- Mutation serialization.
- Merge/reconciliation.
- Deleted-record handling.

Tăng version IndexedDB theo đúng migration pattern hiện tại.

Không xóa dữ liệu local cũ khi nâng version.

## 2. Schema runtime

Nếu `schemaRuntime.js` hoặc file tương đương là generated file:

- Sửa nguồn schema contract.
- Chạy generator chuẩn.
- Không chỉnh tay file generated trừ khi repository quy định khác.

## 3. Lưu cùng đánh giá tài chính

Luồng lưu đánh giá phải đồng bộ cả thực thể mới.

Ví dụ logic tương đương:

```javascript
await persistAndSync(this, [
  "goithau",
  "thongtinmothau",
  "hanghoaduthaunhathau"
]);
```

Điều chỉnh theo tên thực tế của repository.

Không được đánh dấu bước tài chính đã lưu/chốt trước khi mutation hàng hóa được backend commit thành công.

## 4. Backend validation

Backend phải kiểm tra độc lập:

- Gói là gói hàng hóa.
- Người dùng có quyền sửa gói.
- Gói thuộc workspace hiện tại.
- Bản ghi mở thầu thuộc đúng gói.
- Phần lô thuộc đúng gói.
- Nhà thầu tham dự phần lô.
- Hàng hóa yêu cầu thuộc đúng phần lô.
- Không có duplicate mapping.
- Kiểu và giới hạn dữ liệu hợp lệ.
- Trạng thái đánh giá cho phép sửa.

Không tin các trường `organization_id`, `owner_type`, `goi_thau_id` do client tự gửi nếu backend có thể suy ra từ quan hệ cha.

---

# XII. Phân quyền và bảo mật

Thực thể mới phải kế thừa access policy của gói thầu và bước đánh giá.

Kiểm thử:

- Manager được sửa trong tổ chức.
- Employee có quyền module và được phân công được sửa.
- Employee chỉ xem không sửa được.
- Employee không được phân công không đọc/sửa được nếu policy hiện tại quy định như vậy.
- Không thể sửa dữ liệu workspace khác.
- Không thể thay ID trong payload để gắn hàng hóa vào gói khác.
- API trực tiếp vẫn bị chặn dù nút UI bị ẩn.
- Không lộ dữ liệu tài chính cho người không có quyền tương ứng.

Chuỗi hiển thị/export phải chống:

- XSS.
- HTML injection.
- Spreadsheet formula injection.

---

# XIII. Versioning và đấu thầu lại

## 1. Phiên bản gói thầu

Hàng hóa dự thầu là dữ liệu phát sinh trong quá trình đánh giá của một phiên bản gói cụ thể.

Không tự động chuyển hàng hóa dự thầu sang phiên bản gói khác nếu điều đó làm sai lịch sử.

Khi xem phiên bản cũ, phải hiển thị đúng dữ liệu dự thầu của phiên bản đó.

## 2. Đấu thầu lại

Khi tạo gói đấu thầu lại:

- Có thể sao chép danh mục hàng hóa yêu cầu theo logic hiện có.
- Không sao chép hàng hóa dự thầu của nhà thầu từ lần đấu thầu trước.
- Không sao chép kết quả tài chính của nhà thầu cũ.

---

# XIV. Cấu trúc module đề xuất

Ưu tiên tách module để tránh làm các file đánh giá hiện tại quá lớn:

```text
frontend/packages/BidderGoodsWorkflow.js
frontend/packages/BidderGoodsExcel.js
frontend/packages/bidderGoodsValidation.js
frontend/packages/bidderGoodsMapping.js
frontend/packages/bidderGoodsSelectors.js
```

Tên có thể thay đổi theo convention hiện tại.

Các file đánh giá hiện có chỉ nên:

- Đăng ký tab mới trong Báo cáo đánh giá chi tiết.
- Truyền đúng ngữ cảnh nhà thầu, phần lô và trạng thái đánh giá.
- Mở/đóng hoặc render workflow hàng hóa dự thầu trong tab.
- Gọi save/chốt đúng trình tự.

Không thêm cột/nút hàng hóa vào bảng đánh giá tổng quát.
Không nhét toàn bộ parser Excel và mapping vào row renderer hoặc file dựng bảng tổng quát.

---

# XV. Các file dự kiến cần khảo sát/thay đổi

Danh sách dưới đây chỉ là định hướng, phải xác nhận theo repository thực tế:

## Backend

```text
backend/db/schema.py
backend/db/postgres_schema.py hoặc migration tương ứng
backend/documents/schema_contract.py
backend/shared/access_policy.py
backend/sync/*
backend/documents/excel_handler.py
backend/documents/excel_service.py
backend/documents/routes_excel.py hoặc route tương đương
```

## Frontend nền tảng

```text
frontend/app/BiddingModel.js
frontend/app/BrowserDB.js
frontend/documents/schemaRuntime.js
```

## Frontend đánh giá và Báo cáo đánh giá chi tiết

Trước hết phải tìm đúng module đang quản lý **Báo cáo đánh giá chi tiết**, hệ thống tab và state nhà thầu/phần lô. Không mặc định tên file dưới đây là đầy đủ.

Các file có thể cần khảo sát:

```text
frontend/packages/BidEvaluationWorkflow.js
frontend/packages/BidEvaluationPanelController.js
frontend/packages/bidEvaluationActions.js
các module/tab của Báo cáo đánh giá chi tiết hiện có
các component tab, table, modal/drawer và toolbar dùng chung
```

`BidEvaluationTablePresentation.js` và `BidEvaluationRowRenderer.js` chỉ được sửa khi cần giữ tương thích hoặc truyền luồng mở báo cáo chi tiết hiện có; không thêm cột/nút hàng hóa dự thầu vào bảng tổng quát.

## Test

```text
tests/*evaluation*
tests/*excel*
tests/*sync*
tests/*access*
tests/*postgres*
frontend hoặc e2e test hiện có
```

Không sửa các file không liên quan nếu không cần thiết.

---

# XVI. Kế hoạch triển khai bắt buộc

Thực hiện theo thứ tự:

## Giai đoạn 1 — Khảo sát và thiết kế

- Đọc code.
- Xác nhận luồng 1G1T/1G2T.
- Xác nhận quan hệ nhà thầu–phần lô.
- Đọc trực tiếp ba file Excel mẫu.
- Lập mapping trường.
- Xác nhận mô hình dữ liệu.

## Giai đoạn 2 — Schema và sync

- Tạo migration/bảng.
- Foreign key/index/unique.
- Money fields.
- Row version/sync version.
- Schema contract.
- IndexedDB.
- State/mutation/read/delete.
- Access policy.

## Giai đoạn 3 — Parser Excel

- Sheet detection.
- Header detection.
- Alias.
- Loại ba cột bị bỏ.
- Dòng cha/con phần lô.
- Dòng tổng và ghi chú.
- Chuẩn hóa kiểu dữ liệu.
- Preview lỗi.

## Giai đoạn 4 — Mapping hàng hóa yêu cầu

- Ghép tự động.
- Ghép thủ công.
- Kiểm tra trùng.
- Kiểm tra thiếu.
- Kiểm tra phần lô.

## Giai đoạn 5 — UI/UX trong Báo cáo đánh giá chi tiết

- Không thay đổi bảng đánh giá tổng quát.
- Đăng ký tab `Danh mục hàng hóa dự thầu` trong Báo cáo đánh giá chi tiết.
- Điều kiện hiển thị đúng cho 1G1T và 1G2T.
- Truyền đúng context nhà thầu/phần lô.
- Thêm/sửa/xóa trong tab.
- Import/preview/export.
- Tìm kiếm/lọc/phân trang.
- Chế độ gộp/thay thế.
- Loading/empty/error/read-only states.
- Đồng bộ hoàn toàn với design system, component, spacing, typography và interaction pattern hiện tại.
- Kiểm tra responsive và accessibility cơ bản.

## Giai đoạn 6 — Tích hợp tài chính

- Kiểm tra thành tiền dòng.
- Tổng theo lô/nhà thầu.
- Đối chiếu giá dự thầu.
- Lưu nháp.
- Chặn chốt khi lỗi.
- Đồng bộ trước khi đánh dấu hoàn tất.

## Giai đoạn 7 — Kiểm thử và hoàn thiện

- Unit test.
- Integration test.
- PostgreSQL test.
- Access policy test.
- Sync test.
- Browser E2E.
- Kiểm thử lại trực tiếp với ba file mẫu.

Không dừng ở việc lập kế hoạch. Sau khi khảo sát, hãy triển khai đầy đủ, tự sửa lỗi và chạy lại test.

---

# XVII. Ma trận kiểm thử tối thiểu

## 1. Ba file mẫu

- `Dự thầu không phân lô.xlsx`.
- `Dự thầu 1 phân lô 1 mặt hàng.xlsx`.
- `Dự thầu 1 phân lô nhiều mặt hàng.xlsx`.

Mỗi file phải được import qua UI, preview, lưu, reload và xác minh dữ liệu từ backend/database.

## 2. Luồng nghiệp vụ và điều kiện hiển thị

- Bảng đánh giá tổng quát 1G1T không có cột/nút/badge hàng hóa dự thầu.
- Bảng đánh giá tổng quát 1G2T không có cột/nút/badge hàng hóa dự thầu.
- 1G1T không phân lô: tab xuất hiện trong Báo cáo đánh giá chi tiết.
- 1G1T có phần lô: tab xuất hiện và dùng đúng phần lô.
- 1G2T tài chính không phân lô: tab xuất hiện cho nhà thầu đủ điều kiện.
- 1G2T tài chính có phần lô: tab xuất hiện cho đúng nhà thầu/phần lô đủ điều kiện.
- Không hiển thị trong ngữ cảnh/tab kỹ thuật 1G2T.
- Không hiển thị với lĩnh vực khác hàng hóa.
- Điều hướng vào tab thông qua luồng Báo cáo đánh giá chi tiết hiện có.
- Một nhà thầu tham dự nhiều lô.
- Nhà thầu liên danh nếu cấu trúc mở thầu hỗ trợ.

## 3. Parser

- Tên sheet có khoảng trắng cuối.
- Tên sheet viết hoa/thường khác nhau.
- Header không nằm dòng 4.
- `Ký mã hiệu`.
- `Kỹ mã hiệu`.
- Dòng trống.
- Dòng tổng.
- Dòng số tiền bằng chữ.
- Dòng dự phòng.
- Một lô nhiều dòng con.
- Mã lô không tồn tại.
- File thiếu Sheet 12.1.
- File thiếu cột bắt buộc.
- File sai định dạng.
- File quá lớn.
- Workbook lỗi.
- Giá trị Unicode tiếng Việt.
- Nội dung kỹ thuật rất dài.
- Mã HS có số 0 đầu/dấu chấm.
- Năm sản xuất dạng mô tả.

## 4. Mapping

- Ghép đúng tự động.
- Không ghép được.
- Nhiều ứng viên.
- Ghép thủ công.
- Hai dòng ghép cùng một hàng hóa yêu cầu.
- Hàng hóa thuộc phần lô khác.
- Gói chưa có danh mục hàng hóa yêu cầu.

## 5. Tài chính

- Thành tiền khớp.
- Sai lệch 1 VND.
- Sai lệch lớn hơn 1 VND.
- Tổng khớp giá dự thầu.
- Tổng lệch giá dự thầu.
- Thiếu dòng hàng hóa.
- Khối lượng bằng 0.
- Khối lượng âm.
- Đơn giá âm.
- Tiền vượt giới hạn.

## 6. Import mode

- Gộp thêm mới.
- Gộp cập nhật.
- Gộp giữ dòng cũ không có trong file.
- Thay thế toàn bộ.
- Hủy ở preview.
- Lỗi giữa batch không để lưu dở dang.

## 7. Sync và realtime

- Lưu rồi reload.
- Hai tab/browser context.
- Tab A sửa, tab B nhận cập nhật.
- Xung đột row version.
- Mất mạng rồi kết nối lại.
- Backend restart.
- Mutation gửi lại không tạo duplicate.

## 8. Phân quyền

- Manager.
- Employee được phân công và có quyền sửa.
- Employee chỉ xem.
- Employee không được phân công.
- API gửi ID workspace khác.
- API gửi `phan_lo_id` gói khác.
- API gửi `goi_thau_hang_hoa_id` gói khác.

## 9. UI/UX và tính nhất quán

- Tab mới có cùng kiểu tab, spacing và typography với các tab hiện có.
- Toolbar dùng đúng button variants và icon set hiện tại.
- Modal/drawer/form dùng component chung hiện có.
- Bảng dùng cùng table pattern, pagination và empty/loading/error state.
- Không có CSS global làm thay đổi màn hình khác.
- Không vỡ layout ở các viewport desktop phổ biến.
- Nội dung dài, tiền tệ và tooltip hiển thị đúng.
- Keyboard focus và focus-visible hoạt động.
- Double click nút lưu/import không tạo thao tác trùng.
- Thay thế toàn bộ có confirmation đúng pattern hiện tại.
- Chế độ chỉ đọc không còn control chỉnh sửa.

## 10. Trạng thái/chế độ chỉ đọc

- Đang chỉnh sửa tài chính.
- Đã lưu tài chính.
- Đã chốt tài chính.
- Đã có kết quả.
- Gói hủy.
- Tài khoản chỉ xem.

---

# XVIII. Tiêu chí nghiệm thu

Chức năng chỉ được coi là hoàn thành khi đáp ứng toàn bộ:

1. Chỉ xuất hiện với gói hàng hóa.
2. Không thêm cột, nút, badge hoặc trạng thái hàng hóa dự thầu vào bảng đánh giá tổng quát.
3. Có tab riêng `Danh mục hàng hóa dự thầu` trong Báo cáo đánh giá chi tiết.
4. Hoạt động trong Báo cáo đánh giá chi tiết của 1G1T.
5. Hoạt động trong Báo cáo đánh giá chi tiết ở bước tài chính của 1G2T.
6. Không xuất hiện trong ngữ cảnh/tab kỹ thuật 1G2T.
7. Điều hướng bằng luồng mở Báo cáo đánh giá chi tiết hiện có, không tạo luồng điều hướng trùng lặp.
8. Đọc đúng Sheet 12.1 của cả ba file mẫu.
9. Không lưu ba cột `Mặt hàng dự thầu`, `Mã hàng hóa`, `Phân nhóm`.
10. Hỗ trợ gói không phân lô.
11. Hỗ trợ một lô một mặt hàng.
12. Hỗ trợ một lô nhiều mặt hàng.
13. Hỗ trợ một nhà thầu dự nhiều phần lô.
14. Mỗi dòng gắn đúng nhà thầu, bản ghi mở thầu, phần lô và hàng hóa yêu cầu.
15. Không cho lưu chính thức khi còn dòng chưa ghép hoặc trùng mapping.
16. Đối chiếu thành tiền dòng và tổng giá dự thầu.
17. Có lưu nháp và lưu chính thức rõ ràng.
18. Dữ liệu tồn tại sau reload.
19. Dữ liệu đồng bộ sang phiên/browser khác.
20. Backend chặn tham chiếu chéo workspace/gói/phần lô.
21. Chế độ chỉ đọc được áp dụng ở cả UI và backend.
22. UI/UX của tab mới dùng cùng design system, component, typography, spacing, icon, table, modal/drawer và notification pattern của toàn bộ ứng dụng.
23. Có loading, empty, error, confirmation, responsive và accessibility cơ bản.
24. Không thêm thư viện UI hoặc bộ style riêng nếu chưa có lý do kiến trúc được chứng minh.
25. Tạo phiên bản/đấu thầu lại không sao chép sai hàng hóa dự thầu cũ.
26. Có unit, integration, access policy, sync và E2E test.
27. Frontend build thành công.
28. Toàn bộ test liên quan pass.
29. Không làm hỏng chức năng danh mục hàng hóa yêu cầu đã có.
30. Không làm hỏng luồng đánh giá hiện tại của các lĩnh vực khác.

---

# XIX. Báo cáo sau triển khai

Tạo file:

```text
CODEX_BIDDER_GOODS_IMPLEMENTATION_REPORT.md
```

Báo cáo gồm:

## 1. Kiến trúc đã khảo sát

- Branch/commit.
- Các module hiện tại.
- Luồng 1G1T/1G2T.
- Cơ chế sync và phân quyền.

## 2. Thiết kế đã triển khai

- Bảng mới.
- Quan hệ dữ liệu.
- Parser.
- Mapping.
- Vị trí tab trong Báo cáo đánh giá chi tiết.
- UI/UX và các component/design token đã tái sử dụng.
- Cơ chế kiểm tra tài chính.

## 3. File đã thay đổi

Chia thành:

- File thêm mới.
- File sửa.
- Migration/generated file.
- Test.

## 4. Kết quả kiểm thử ba file mẫu

Bảng tối thiểu:

| File | Sheet | Dòng đọc được | Dòng lưu | Dòng bỏ qua | Lỗi | Kết quả |
|---|---|---:|---:|---:|---:|---|

## 5. Kết quả test

- Lệnh đã chạy.
- Pass/fail/skip.
- E2E scenarios.
- Build/lint/type-check nếu có.

## 6. Lỗi phát hiện và sửa

- Bước tái hiện.
- Nguyên nhân.
- File sửa.
- Regression test.

## 7. Vấn đề còn tồn tại

Không được che giấu giới hạn hoặc test chưa chạy được.

---

# XX. Các nguyên tắc thực hiện

- Không chỉ sửa frontend.
- Không hiển thị chức năng hàng hóa dự thầu trong bảng đánh giá tổng quát.
- Chỉ tích hợp dưới dạng tab trong Báo cáo đánh giá chi tiết.
- UI/UX phải đồng bộ với toàn bộ ứng dụng và ưu tiên tái sử dụng component/design token hiện có.
- Không tạo theme, bộ màu, icon style hoặc thư viện UI riêng cho chức năng này.
- Không lưu toàn bộ dữ liệu trong một trường JSON của gói hoặc nhà thầu.
- Không dùng tên hàng hóa làm khóa database.
- Không tin dữ liệu quyền và quan hệ do client gửi.
- Không bỏ qua row version/sync version.
- Không đánh dấu tài chính hoàn tất trước khi hàng hóa được commit server.
- Không chỉnh tay file generated nếu có generator.
- Không phá dữ liệu cũ khi migration.
- Không refactor diện rộng các module không liên quan.
- Không tuyên bố hoàn thành nếu chưa chạy trực tiếp cả ba file mẫu.
- Không tuyên bố E2E pass nếu chỉ kiểm thử API.
- Không sửa test để che hành vi sai.
- Giữ convention, style và kiến trúc hiện tại của repository.

Bắt đầu bằng khảo sát repository và ba file Excel. Sau đó triển khai tuần tự, chạy test, sửa lỗi, kiểm thử qua trình duyệt như người dùng thật và tạo báo cáo cuối cùng.
