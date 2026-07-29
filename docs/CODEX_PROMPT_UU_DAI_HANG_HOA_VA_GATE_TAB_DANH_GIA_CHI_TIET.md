# PROMPT CHO CODEX — TRIỂN KHAI LUỒNG ĐÁNH GIÁ TUẦN TỰ VÀ ƯU ĐÃI HÀNG HÓA

## 0. Vai trò và yêu cầu thực thi

Bạn đang làm việc trực tiếp trên repository:

```text
https://github.com/newstar94/Bidding
```

Hãy **khảo sát kỹ mã nguồn hiện tại trên nhánh `main` mới nhất**, sau đó **triển khai đầy đủ**, không chỉ lập kế hoạch hoặc viết bản mô tả.

Yêu cầu này mở rộng hai phần đã tồn tại trong ứng dụng:

1. Báo cáo đánh giá chi tiết theo từng nhà thầu.
2. Danh mục hàng hóa dự thầu của nhà thầu và parser Excel Mẫu số 12.1B.

Phải nối vào kiến trúc hiện tại, tái sử dụng các model, IndexedDB, outbox, API đồng bộ, mapper, access policy, validator, UI component và test hiện có. **Không được tạo một luồng dữ liệu thứ hai chạy song song** hoặc lưu dữ liệu chỉ ở frontend.

Sau khi triển khai:

- Tự chạy migration.
- Tự chạy toàn bộ test liên quan và test hồi quy.
- Tự sửa lỗi phát hiện được.
- Viết báo cáo triển khai.
- Không dừng lại để hỏi lại người dùng về các quyết định kỹ thuật nhỏ; hãy chọn phương án an toàn, nhất quán với codebase và ghi rõ trong báo cáo.

---

# I. KHẢO SÁT BẮT BUỘC TRƯỚC KHI SỬA CODE

Trước khi thay đổi bất kỳ file nào, thực hiện và ghi nhận:

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

Đọc tối thiểu các tài liệu/file hiện có nếu chúng còn tồn tại:

```text
CODEX_BIDDER_GOODS_IMPLEMENTATION_REPORT.md
CONTEXT.md
README.md
```

Khảo sát toàn bộ luồng gọi và dữ liệu của các module sau; tên file có thể đã thay đổi nên phải tìm theo symbol nếu cần:

```text
frontend/packages/detailedEvaluationRules.js
frontend/packages/detailedEvaluationAggregation.js
frontend/packages/DetailedEvaluationState.js
frontend/packages/DetailedEvaluationSaveWorkflow.js
frontend/packages/DetailedEvaluationImport.js
frontend/packages/detail/DetailedEvaluationPanel.js
frontend/packages/DetailedEvaluationPanelController.js
frontend/packages/detailedEvaluationValidation.js

frontend/packages/BidderGoodsExcel.js
frontend/packages/BidderGoodsWorkflow.js
frontend/packages/bidderGoodsMapping.js
frontend/packages/bidderGoodsSelectors.js
frontend/packages/bidderGoodsValidation.js

frontend/shared/BiddingCalculations.js
frontend/packages/BidEvaluationRankingController.js
frontend/packages/BidEvaluationRowRenderer.js
frontend/app/BrowserDB.js

backend/db/schema.py
backend/db/postgres_schema.py
backend/db/upgrades.py
backend/documents/schema_contract.py
backend/sync/bidder_goods.py
backend/sync/mapper.py
backend/sync/queries.py
backend/sync/read_service.py
backend/sync/record_serializer.py
backend/sync/record_validator.py
backend/sync/validator.py
```

Kiểm tra:

- Phiên bản schema SQLite/PostgreSQL hiện tại.
- Phiên bản IndexedDB hiện tại.
- Cách `baoCaoDanhGiaChiTietList` được lưu, attach và đồng bộ.
- Cách `extension.completedGroups` đang được sử dụng.
- Cách kết quả từng nhóm được tổng hợp thành `Đạt`, `Không đạt`, hoặc chưa kết luận.
- Cách bảng `hang_hoa_du_thau_nha_thau` đang được định nghĩa, validate, serialize, đồng bộ và hiển thị.
- Cách giá dự thầu, tỷ lệ giảm giá, giá sau giảm giá, chi phí quy đổi và giá xếp hạng hiện được tính.
- Cách xếp hạng theo từng phần lô và theo phương pháp đánh giá.
- Cơ chế phân quyền organization/workspace và chống ghi chéo dữ liệu.

Không được giả định phiên bản schema cố định. Sau khi khảo sát, dùng **phiên bản kế tiếp thực tế** và cập nhật đầy đủ mọi schema contract/generated runtime tương ứng.

---

# II. PHẠM VI NGHIỆP VỤ

## 1. Thứ tự chuẩn của các tab báo cáo đánh giá chi tiết

Đối với gói thầu thuộc lĩnh vực **Hàng hóa**, thứ tự logic chuẩn là:

```text
Tính hợp lệ
→ Năng lực và kinh nghiệm
→ Kỹ thuật
→ Danh mục hàng hóa
→ Tài chính
```

Các key nội bộ nên tiếp tục dùng key hiện có nếu phù hợp:

```text
validity
capacity
technical
bidder_goods
financial
```

Nhãn hiển thị của tab `bidder_goods` trong báo cáo đánh giá chi tiết phải là:

```text
Danh mục hàng hóa
```

Không hiển thị “Danh mục hàng hóa dự thầu” ở tiêu đề tab nếu yêu cầu giao diện hiện tại là tên ngắn; nội dung bên trong vẫn là bảng danh mục hàng hóa dự thầu của nhà thầu.

Đối với lĩnh vực không phải hàng hóa, không chèn tab `bidder_goods`.

## 2. Nguyên tắc hiển thị tuần tự

Một phần phía sau chỉ được hiển thị khi phần ngay trước nó đã:

1. Được hoàn thành hợp lệ; và
2. Có kết luận `Đạt`.

Quy tắc:

- Nếu phần trước `Không đạt`: ẩn toàn bộ phần phía sau.
- Nếu phần trước chưa hoàn thành hoặc chưa có kết luận: ẩn toàn bộ phần phía sau.
- Nếu phần trước `Đạt`: mở phần kế tiếp.
- Không cho người dùng truy cập tab phía sau bằng URL, state cũ, thao tác DOM hoặc gọi trực tiếp hàm save.
- Backend phải kiểm tra điều kiện tiên quyết khi hoàn thành một tab hoặc hoàn thành báo cáo; không chỉ ẩn UI.

### 2.1. Trường hợp một giai đoạn một túi hồ sơ — 1G1T

Đối với gói hàng hóa:

```text
validity
→ capacity
→ technical
→ bidder_goods
→ financial
```

Điều kiện cụ thể:

- `validity` luôn là tab đầu tiên được phép hiển thị.
- `capacity` chỉ hiện khi `validity` đã hoàn thành và `Đạt`.
- `technical` chỉ hiện khi `capacity` đã hoàn thành và `Đạt`.
- `bidder_goods` chỉ hiện khi `technical` đã hoàn thành và `Đạt`.
- `financial` chỉ hiện khi dữ liệu danh mục hàng hóa đã đạt trạng thái sẵn sàng để đánh giá tài chính theo mục II.4.

### 2.2. Trường hợp một giai đoạn hai túi hồ sơ — 1G2T

Giữ đúng bản chất hai vòng hiện tại, không gộp hai vòng thành một báo cáo:

**Vòng kỹ thuật:**

```text
validity
→ capacity
→ technical
```

- Chỉ các nhà thầu đạt vòng kỹ thuật mới được đưa sang vòng tài chính theo cơ chế hiện có.

**Vòng tài chính đối với gói hàng hóa:**

```text
bidder_goods
→ financial
```

- Không lặp lại `validity`, `capacity`, `technical` ở vòng tài chính.
- `financial` chỉ mở khi danh mục hàng hóa của nhà thầu đã được lưu và hợp lệ theo mục II.4.

Đối với gói không phải hàng hóa, giữ luồng hiện hành tương ứng và không tạo tab `bidder_goods`.

## 3. Kết luận tab và dữ liệu tiến trình

Tái sử dụng logic tổng hợp hiện có trong `detailedEvaluationAggregation`:

- Có tiêu chí bắt buộc `fail` → `Không đạt`.
- Tất cả tiêu chí bắt buộc đã có kết quả hợp lệ và không fail → `Đạt`.
- Còn tiêu chí bắt buộc `pending` hoặc chưa nhập → chưa kết luận.

Khi người dùng chọn **Hoàn thành tab**:

1. Validate tab hiện tại.
2. Tính kết luận của tab.
3. Persist dữ liệu xuống backend/database.
4. Ghi trạng thái hoàn thành và kết luận nhóm một cách có thể khôi phục sau reload.
5. Chỉ sau khi server xác nhận thành công mới mở tab kế tiếp.

Có thể mở rộng `report.extension` theo hướng tương thích ngược, ví dụ:

```json
{
  "completedGroups": ["validity"],
  "groupResults": {
    "validity": "Đạt"
  },
  "workflowVersion": 2
}
```

Không bắt buộc đúng tên field trên nếu codebase đã có cấu trúc tốt hơn, nhưng phải bảo đảm:

- Reload trang vẫn xác định chính xác tab được phép hiện.
- Đồng bộ nhiều client không làm mất tiến trình.
- Backend có thể tự kiểm tra prerequisite.
- Báo cáo cũ không có `groupResults` vẫn hoạt động: suy ra từ `completedGroups` và các dòng tiêu chí hiện có.

## 4. Trạng thái của tab Danh mục hàng hóa

Tab `bidder_goods` không phải nhóm tiêu chí chuyên gia giống `validity/capacity/technical/financial`; không tự ý tạo kết luận nghiệp vụ “Không đạt” cho hàng hóa nếu hệ thống chưa có khái niệm này.

Dùng trạng thái workflow riêng, tối thiểu:

```text
empty        Chưa có dữ liệu
 draft        Đã lưu nháp nhưng còn lỗi/chưa đầy đủ
 ready        Dữ liệu chính thức đã lưu, mapping và phép tính hợp lệ
 stale        Dữ liệu từng ready nhưng đã lỗi thời do đầu vào phía trước thay đổi
```

Tab `financial` chỉ mở khi trạng thái hàng hóa là `ready`.

Trạng thái `ready` yêu cầu tối thiểu:

- Có dữ liệu hàng hóa dự thầu đối với nhà thầu/phần lô phải đánh giá.
- Không có mapping mơ hồ/chưa ghép bắt buộc.
- Không thiếu hàng hóa bắt buộc.
- Không ghép trùng hàng hóa yêu cầu.
- Dòng thuộc đúng phần lô và nhà thầu tham dự phần lô đó.
- Khối lượng, đơn giá, thành tiền hợp lệ.
- Thành tiền dòng khớp phép tính trong ngưỡng hiện hành.
- Mã ưu đãi hợp lệ.
- Các giá trị sau ưu đãi đã được backend tính lại thành công.
- Đồng bộ server thành công.

Nếu không có sheet 15A thì mã ưu đãi mặc định bằng `0`; đây **không phải lỗi** và không ngăn trạng thái `ready`.

## 5. Thay đổi kết luận phần trước sau khi đã có dữ liệu phần sau

Khi người dùng mở lại hoặc sửa phần trước từ `Đạt` thành `Không đạt`/chưa hoàn thành:

- Ẩn ngay toàn bộ tab phía sau.
- Nếu active tab hiện tại bị ẩn, chuyển về tab cuối cùng còn hợp lệ.
- **Không xóa dữ liệu phía sau đã lưu trong DB.**
- Đánh dấu dữ liệu phía sau là không còn khả dụng hoặc `stale` nếu đầu vào ảnh hưởng tới kết quả tính toán.
- Khi phần trước được hoàn thành và `Đạt` trở lại, hiển thị lại tab phía sau và nạp lại dữ liệu đã lưu.
- Không tự động coi dữ liệu cũ là `ready` nếu đầu vào quyết định giá/ưu đãi đã thay đổi; phải chạy lại validation/recalculation cần thiết.

---

# III. LƯU NHÁP DỮ LIỆU NHẬP TỪ EXCEL

Hiện tại phải kiểm tra xem import Excel báo cáo đánh giá chi tiết chỉ cập nhật draft trong bộ nhớ hay đã persist.

Yêu cầu mới:

- Khi người dùng nhập file Excel chưa có kết quả đánh giá, ứng dụng vẫn phải lưu các tiêu chí và dữ liệu đã đọc được ở trạng thái nháp xuống DB để phục vụ đánh giá trực tiếp trên ứng dụng.
- Không được yêu cầu mọi dòng phải có `Đạt/Không đạt` mới cho lưu.
- Các dòng chưa có kết quả lưu `pending` theo contract hiện hành.
- Không mở tab kế tiếp chỉ vì đã import file; chỉ mở khi tab hiện tại đã được người dùng hoàn thành và kết luận `Đạt`.
- Sau reload, dữ liệu nháp đã nhập phải còn nguyên.
- Nếu đồng bộ offline-first: ghi IndexedDB + outbox theo cơ chế chuẩn, chờ server khi thao tác yêu cầu hoàn thành/chốt.

Luồng đề xuất:

```text
Chọn file
→ preview
→ xác nhận nhập
→ ghi report draft + criteria rows
→ hiển thị để chuyên gia tiếp tục đánh giá
→ Hoàn thành tab
→ server validate + tính kết luận
→ nếu Đạt thì mở tab kế tiếp
```

Không tạo API “tạm” riêng nếu `persistAndSync` và mapper hiện tại đã đáp ứng được.

---

# IV. SHEET 15A VÀ MÃ ƯU ĐÃI

## 1. Tên sheet chuẩn

Tên nghiệp vụ chuẩn là:

```text
Mẫu số 15A. Bảng kê khai hàng hóa được hưởng ưu đãi
```

Người dùng đã xác nhận là **15A**, không phải 15.1A.

Parser không được phụ thuộc tuyệt đối vào chuỗi tên sheet đầy đủ. Phải nhận diện alias theo tên đã chuẩn hóa, tối thiểu:

- Có token `15A`.
- Có nội dung gần nghĩa `hàng hóa` và `ưu đãi`.
- Không nhầm với sheet `15C`.
- Không phân biệt chữ hoa/thường.
- Chấp nhận thừa/thiếu dấu chấm, khoảng trắng, xuống dòng, tên bị Excel rút gọn.
- Chấp nhận tên đầy đủ `Mẫu số 15A. Bảng kê khai hàng hóa được hưởng ưu đãi`.

Nếu không tìm thấy sheet 15A:

- Gán mã ưu đãi `0` cho mọi dòng hàng hóa.
- Hiển thị thông tin trong preview: `Không có Mẫu số 15A — toàn bộ hàng hóa được coi là không thuộc đối tượng ưu đãi`.
- Không báo lỗi chặn import/chốt.

## 2. Các cột cần nhận diện trong 15A

Parser phải tìm hàng header động, không hard-code hàng số 4. Quét vùng đầu sheet theo giới hạn an toàn tương tự parser 12.1B hiện có.

Nhận diện alias theo nội dung chuẩn hóa cho tối thiểu các trường:

```text
STT
Tên hàng hóa
Xuất xứ
Hàng hóa có xuất xứ Việt Nam, tỷ lệ chi phí sản xuất trong nước dưới 50%
(alias thường gặp trong mẫu: “từ 30% đến dưới 50%” hoặc cách diễn đạt tương đương)
Hàng hóa có xuất xứ Việt Nam, tỷ lệ chi phí sản xuất trong nước từ 50% trở lên
Cơ sở sản xuất có từ 50% lao động thuộc nhóm được ưu tiên theo quy định
Sản phẩm đổi mới sáng tạo có xuất xứ Việt Nam / sản phẩm tại điểm i khoản 1 Điều 10 Luật Đấu thầu
Thông tin kê khai chi phí sản xuất trong nước / tham chiếu Mẫu 15C
```

Không dùng nguyên văn một câu dài làm duy nhất một alias. Tách token/keyword để chịu được xuống dòng và thay đổi nhẹ về mẫu biểu.

Chuẩn hóa giá trị boolean:

```text
Có / Không
Co / Khong
Yes / No
Y / N
True / False
1 / 0
X hoặc dấu chọn rõ ràng
```

Ô trống không được tự suy thành `Có`.

## 3. Mã ưu đãi 0–5

Thêm cột nghiệp vụ `Ưu đãi` và lưu mã nguyên từ `0` đến `5`:

```text
0 = Hàng hóa không thuộc đối tượng được hưởng ưu đãi.

1 = Hàng hóa có xuất xứ Việt Nam, tỷ lệ chi phí sản xuất trong nước dưới 50%.

2 = Nhóm mã 1 và cơ sở sản xuất có từ 50% lao động là người khuyết tật,
    thương binh, người dân tộc thiểu số; hợp đồng lao động có thời gian thực
    hiện từ 03 tháng trở lên và còn hiệu lực tại thời điểm đóng thầu.

3 = Hàng hóa có xuất xứ Việt Nam, tỷ lệ chi phí sản xuất trong nước từ 50% trở lên.

4 = Nhóm mã 3 và cơ sở sản xuất đáp ứng điều kiện lao động đặc biệt như mã 2.

5 = Hàng hóa là sản phẩm đổi mới sáng tạo có xuất xứ Việt Nam hoặc sản phẩm
    quy định tại điểm i khoản 1 Điều 10 của Luật Đấu thầu.
```

### 3.1. Thứ tự ưu tiên khi nhiều cột được đánh dấu

Áp dụng precedence sau:

```text
Sản phẩm đổi mới sáng tạo                         → 5
Từ 50% trở lên + điều kiện lao động đặc biệt      → 4
Từ 50% trở lên                                    → 3
Dưới 50% + điều kiện lao động đặc biệt             → 2
Dưới 50%                                           → 1
Không đáp ứng                                      → 0
```

Tuy nhiên, các tổ hợp mâu thuẫn phải được cảnh báo thay vì âm thầm chọn precedence, ví dụ:

- Đồng thời đánh dấu cả “dưới 50%” và “từ 50% trở lên”.
- Đánh dấu điều kiện lao động đặc biệt nhưng không đánh dấu một nhóm tỷ lệ chi phí tương ứng.
- Đánh dấu thuộc ưu đãi nhưng xuất xứ không phải Việt Nam.
- Giá trị boolean không nhận diện được.

Cho phép lưu nháp với cảnh báo, nhưng không cho chuyển dữ liệu hàng hóa sang `ready` cho tới khi mâu thuẫn được xử lý, ngoại trừ trường hợp không có sheet 15A thì toàn bộ mã `0` là hợp lệ.

Không tự xác nhận điều kiện pháp lý của sản phẩm đổi mới sáng tạo dựa trên tên hàng hóa. Chỉ mã hóa `5` khi 15A khai báo rõ hoặc người dùng có quyền xác nhận thủ công theo cơ chế audit.

## 4. Đối chiếu với bảng 12.1B

Sheet 15A nằm trong cùng workbook với Mẫu số 12.1B. Việc gắn ưu đãi phải thẳng hàng với đúng hàng hóa ở bảng dự thầu.

Ưu tiên khóa ghép ổn định theo thứ tự:

1. Mapping hiện có tới `goiThauHangHoaId`, nếu có thể xác định chắc chắn.
2. Phần lô + tên hàng hóa đã chuẩn hóa + thứ tự xuất hiện của tên trùng.
3. Tên hàng hóa đã chuẩn hóa + thứ tự xuất hiện trong trường hợp không phân lô.
4. Căn chỉnh theo thứ tự các dòng dữ liệu thực tế giữa 12.1B và 15A chỉ khi số dòng và phạm vi hoàn toàn nhất quán.

Chuẩn hóa tên:

- Unicode NFKC.
- Trim đầu/cuối.
- Gộp khoảng trắng và xuống dòng.
- So sánh không phân biệt hoa/thường.
- Chuẩn hóa dấu câu thông dụng.
- Có thể có lớp so sánh bỏ dấu tiếng Việt để gợi ý, nhưng **không được tự lưu chính thức bằng fuzzy match mơ hồ**.

### 4.1. Không phân lô

Ghép trong phạm vi nhà thầu:

```text
normalized_goods_name + occurrence_index
```

Nếu tên duy nhất thì ghép trực tiếp. Nếu trùng tên, dùng thứ tự xuất hiện và cảnh báo rõ trong preview.

### 4.2. Phân lô, mỗi lô một loại hàng

Ghép theo phần lô nếu sheet có thông tin lô. Nếu 15A không có cột lô, dùng thứ tự nhóm/dòng đã được parser 12.1B xác định, sau đó kiểm tra tên hàng hóa.

### 4.3. Phân lô, mỗi lô nhiều loại hàng

Phải giữ phạm vi theo lô từ dữ liệu 12.1B. Ghép từng hàng theo:

```text
lot_scope + normalized_goods_name + occurrence_index
```

Nếu 15A không thể hiện rõ lô và việc căn hàng theo thứ tự không chắc chắn:

- Không tự gán mù.
- Hiển thị preview mapping mơ hồ.
- Cho phép người có quyền chọn dòng 15A tương ứng hoặc chọn mã 0–5 thủ công.
- Lưu dấu vết nguồn và phương pháp ghép.

### 4.4. Metadata nguồn

Mỗi dòng cần có đủ metadata để audit, tối thiểu:

```text
source workbook/import batch
source sheet 12.1B + source row
source sheet 15A + source row, nếu có
matching method
matching confidence/status
parser warnings
manual override flag + actor + timestamp, nếu có
```

Không ghi dữ liệu nội bộ nhạy cảm vào thông báo lỗi cho người dùng.

## 5. Mẫu 15C

Nếu workbook có `Mẫu số 15C. Bảng kê khai chi phí sản xuất trong nước`:

- Chỉ dùng để đối chiếu/QA, không thay thế 15A làm nguồn quyết định mã ưu đãi.
- Có thể kiểm tra tỷ lệ chi phí trong nước khớp nhóm `<50%` hoặc `>=50%`.
- Nếu tỷ lệ dưới ngưỡng đủ điều kiện theo quy định hiện hành nhưng 15A khai báo được hưởng ưu đãi, hiển thị cảnh báo cần kiểm tra.
- Không bắt buộc phải có 15C để import hoặc lưu mã ưu đãi nếu 15A đã khai báo.

---

# V. FILE MẪU BẮT BUỘC DÙNG ĐỂ KIỂM THỬ

Người dùng cung cấp file:

```text
vn0101905830_Bảng giá.xlsx
```

Trong file này có các sheet:

```text
Mẫu số 11.1 ...
Mẫu số 12.1B. Bảng giá dự thầu
Mẫu số 15A. Bảng kê khai hàng hóa được hưởng ưu đãi
Mẫu số 15C. Bảng kê khai chi phí sản xuất trong nước
```

Dữ liệu kỳ vọng từ 15A đối với 4 dòng hàng hóa của 12.1B là:

```text
Dòng 1 → mã 1
Dòng 2 → mã 0
Dòng 3 → mã 1
Dòng 4 → mã 1
```

Codex phải:

- Tìm file đính kèm trong môi trường làm việc nếu có.
- Dùng file thật để chạy parser/import test.
- Nếu không thể đưa binary fixture vào repository do chính sách dự án, tạo fixture Excel tối thiểu bằng code với cùng cấu trúc và ghi rõ cách tái kiểm tra file thật trong báo cáo.
- Không sửa file mẫu nguồn.

---

# VI. MÔ HÌNH TÍNH ƯU ĐÃI

## 1. Hệ số ưu đãi gốc theo mã

Dùng bảng chuẩn sau:

| Mã | Hệ số ưu đãi gốc |
|---:|------------------:|
| 0 | 0% |
| 1 | 7,5% |
| 2 | 10% |
| 3 | 10% |
| 4 | 12% |
| 5 | 15% |

Nên lưu tỷ lệ dưới dạng **basis point nguyên** để tránh sai số số thực:

```text
0%    = 0 bp
7,5%  = 750 bp
10%   = 1000 bp
12%   = 1200 bp
15%   = 1500 bp
```

Không dùng `float` nhị phân để tính tiền.

## 2. Phạm vi so sánh

Tính độc lập cho từng phạm vi:

```text
organization
+ gói thầu
+ bản ghi mở thầu/nhà thầu
+ phần lô nếu gói thầu phân lô
```

Không lấy hệ số cao nhất của một phần lô áp sang phần lô khác.

## 3. Thuật toán tổng quát

Trong mỗi phạm vi so sánh:

```text
max_preference_rate = hệ số ưu đãi gốc cao nhất trong các dòng hàng hóa hợp lệ
```

Với mỗi dòng:

```text
surcharge_rate = max(0, max_preference_rate - intrinsic_preference_rate)
```

Trong đó:

- `intrinsic_preference_rate` là hệ số ưu đãi gốc theo mã 0–5.
- `surcharge_rate` là tỷ lệ phải cộng vào hàng hóa đó để so sánh/xếp hạng.

Thuật toán này phải là nguồn logic duy nhất, không viết nhiều nhánh rời rạc dễ mâu thuẫn.

### 3.1. Ma trận kết quả bắt buộc

Nếu hệ số cao nhất là `0%`:

```text
mã 0 → cộng 0%
```

Nếu hệ số cao nhất là `7,5%`:

```text
mã 0 → cộng 7,5%
mã 1 → cộng 0%
```

Nếu hệ số cao nhất là `10%`:

```text
mã 0 → cộng 10%
mã 1 → cộng 2,5%
mã 2 → cộng 0%
mã 3 → cộng 0%
```

Nếu hệ số cao nhất là `12%`:

```text
mã 0 → cộng 12%
mã 1 → cộng 4,5%
mã 2 → cộng 2%
mã 3 → cộng 2%
mã 4 → cộng 0%
```

Nếu hệ số cao nhất là `15%`:

```text
mã 0 → cộng 15%
mã 1 → cộng 7,5%
mã 2 → cộng 5%
mã 3 → cộng 5%
mã 4 → cộng 3%
mã 5 → cộng 0%
```

Các dòng mang mã không xuất hiện trong phạm vi thì không ảnh hưởng kết quả.

## 4. Giá trị cơ sở sau giảm giá

Quy định tính ưu đãi áp dụng trên giá hàng hóa sau sửa lỗi/hiệu chỉnh sai lệch (nếu hệ thống đã có các bước này) và sau khi trừ giảm giá nếu có. Không tự tạo dữ liệu sửa lỗi/hiệu chỉnh mới nếu codebase chưa hỗ trợ; phải dùng đúng trường giá nền có thẩm quyền hiện hành.

Khảo sát dữ liệu hiện tại:

```text
giaDuThau
tyLeGiamGia
giaSauGiamGia
```

Nếu ứng dụng hiện chỉ có tỷ lệ giảm giá ở cấp nhà thầu/phần lô mà không có giảm giá từng dòng, phân bổ giảm giá theo cùng tỷ lệ cho từng dòng:

```text
line_base_after_discount_exact
  = thanhTienDuThau × (1 - tyLeGiamGia / 100)
```

Phải dùng Decimal hoặc số nguyên phân số chính xác.

Để tổng từng dòng khớp tuyệt đối với `giaSauGiamGia` của phạm vi:

1. Tính giá trị chính xác cho tất cả dòng.
2. Làm tròn/phân bổ phần dư bằng thuật toán xác định, ví dụ largest remainder.
3. Tie-break bằng `sort_order`, sau đó `id` để kết quả lặp lại ổn định.
4. Bảo đảm:

```text
sum(line_base_after_discount) == scope_price_after_discount
```

Nếu tổng hàng hóa trước giảm giá không khớp giá dự thầu theo ngưỡng hợp lệ hiện có:

- Cho lưu nháp.
- Không cho `ready`.
- Không âm thầm ép tổng để che lỗi.

Nếu trong tương lai có giảm giá trực tiếp từng dòng:

- Ưu tiên dữ liệu từng dòng.
- Không áp dụng giảm giá cấp nhà thầu lần thứ hai.

## 5. Tính tiền cộng ưu đãi từng dòng

```text
preference_surcharge_amount
  = ROUND_HALF_UP(line_base_after_discount × surcharge_rate / 100)
```

Đơn vị tiền là VND, làm tròn đến 1 đồng bằng quy tắc `ROUND_HALF_UP` hoặc quy tắc tiền tệ thống nhất đã được codebase sử dụng. Không dùng `Math.round` trên số vượt vùng an toàn JavaScript.

```text
thanhTienSauUuDai
  = line_base_after_discount + preference_surcharge_amount
```

`thanhTienSauUuDai` là giá trị chuẩn có thẩm quyền ở cấp dòng.

## 6. Cột Giá dự thầu sau ưu đãi

Bảng hiện có `Đơn giá dự thầu` và `Thành tiền`. Thêm cột hiển thị đúng nhãn người dùng yêu cầu:

```text
Giá dự thầu sau ưu đãi
```

Giá trị hiển thị là đơn giá so sánh sau giảm giá và ưu đãi:

```text
giaDuThauSauUuDai
  = thanhTienSauUuDai / khoiLuong
```

Quy tắc:

- Đây là giá trị dẫn xuất phục vụ hiển thị/audit.
- Không lấy đơn giá đã làm tròn nhân ngược lại để tạo `thanhTienSauUuDai`.
- `thanhTienSauUuDai` mới là nguồn chuẩn.
- Hiển thị đủ số lẻ cần thiết, tối đa hợp lý theo UI hiện hành; tooltip ghi rõ “Đơn giá so sánh sau giảm giá và ưu đãi”.
- Nếu khối lượng bằng 0 hoặc không hợp lệ: không tính, báo lỗi.

## 7. Tổng giá sau ưu đãi và xếp hạng

Trong mỗi phạm vi:

```text
tongTienCongUuDai = sum(preference_surcharge_amount)

tongGiaSauUuDai = scope_price_after_discount + tongTienCongUuDai
```

### 7.1. Phương pháp giá thấp nhất

Dùng:

```text
giaSoSanhSauUuDai = giaDuThauSauGiamGia + tongTienCongUuDai
```

Giá này phải được dùng để so sánh và xếp hạng thay cho giá chưa áp dụng ưu đãi.

Không ghi đè mất giá gốc. Lưu/hiển thị riêng:

```text
giá trước ưu đãi
khoản cộng ưu đãi
giá so sánh sau ưu đãi
```

### 7.2. Phương pháp giá đánh giá

Xác định giá đánh giá nền theo logic hiện có, ví dụ:

```text
giaDanhGiaNen = giaXepHang đã nhập
```

hoặc:

```text
giaSauGiamGia + chiPhiQuyDoi
```

sau đó:

```text
giaDanhGiaSauUuDai = giaDanhGiaNen + tongTienCongUuDai
```

Dùng giá này để xếp hạng.

Nếu chưa đủ dữ liệu để xác định `giaDanhGiaNen`:

- Hiển thị trạng thái chưa thể tính.
- Không tự thay bằng một giá khác làm sai nghiệp vụ.
- Không cho hoàn thành tài chính nếu giá sau ưu đãi là dữ liệu bắt buộc.

### 7.3. Các phương pháp khác

Yêu cầu hiện tại chỉ cung cấp quy tắc tự động cho:

```text
Giá thấp nhất
Giá đánh giá
```

Đối với `Kết hợp giữa kỹ thuật và giá`, `Giá cố định`, `Dựa trên kỹ thuật` hoặc phương pháp khác:

- Không tự bịa công thức.
- Không làm thay đổi kết quả xếp hạng hiện có ngoài phạm vi yêu cầu.
- Vẫn có thể hiển thị mã ưu đãi và dữ liệu gốc.
- Hiển thị rõ “Chưa áp dụng tự động ưu đãi cho phương pháp này” nếu cần.
- Kiến trúc calculator phải dễ mở rộng sau này.

---

# VII. ĐỐI CHIẾU QUY TẮC NGHIỆP VỤ

Logic ở mục VI phải cho ra đúng các trường hợp sau.

## 1. Chỉ có hàng hóa dưới 50%, không có hàng hóa từ 50% trở lên

- Mã 1 là mức ưu đãi nền 7,5%.
- Mã 0 bị cộng 7,5%.
- Nếu có mã 2 thì mức ưu đãi cao nhất thành 10%:
  - mã 0 bị cộng 10%;
  - mã 1 bị cộng 2,5%;
  - mã 2 không bị cộng.

## 2. Có hàng hóa từ 50% trở lên

Với mức cao nhất 10%:

- Mã 0 cộng 10%.
- Mã 1 cộng 2,5%.
- Mã 2 và mã 3 không cộng.

Nếu có mã 4 thì mức cao nhất là 12%, áp dụng chênh lệch hệ số:

- Mã 0 cộng 12%.
- Mã 1 cộng 4,5%.
- Mã 2/mã 3 cộng 2%.
- Mã 4 không cộng.

## 3. Có sản phẩm đổi mới sáng tạo mã 5

Mức cao nhất là 15%:

- Mã 0 cộng 15%.
- Mã 1 cộng 7,5%.
- Mã 2 cộng 5%.
- Mã 3 cộng 5%.
- Mã 4 cộng 3%.
- Mã 5 không cộng.

## 4. Điều kiện sản phẩm đổi mới sáng tạo

Hiển thị tooltip/help mô tả các nhóm điều kiện người dùng đã cung cấp:

- Danh mục công nghệ cao được ưu tiên/khuyến khích.
- Kết quả nhiệm vụ khoa học, công nghệ và đổi mới sáng tạo theo quy định.
- Sản phẩm từ sáng chế, thiết kế bố trí mạch tích hợp, giống cây trồng hoặc chương trình máy tính của chính nhà thầu trong thời hạn quy định.
- Sản phẩm chip bán dẫn.
- Sản phẩm đạt giải thưởng Hồ Chí Minh hoặc giải thưởng Nhà nước về khoa học và công nghệ.
- Sản phẩm mới từ kết quả nghiên cứu tại Trung tâm Đổi mới sáng tạo Quốc gia hoặc trung tâm đổi mới sáng tạo cấp quốc gia/cấp tỉnh.
- Sản phẩm mới từ kết quả nghiên cứu khoa học và phát triển công nghệ theo pháp luật về chuyển giao công nghệ.
- Thời hạn hưởng ưu đãi: 06 năm từ lần đầu được sản xuất và đủ điều kiện đưa ra thị trường.

Ứng dụng không tự chứng minh các điều kiện này nếu file không có đủ dữ liệu. 15A là bản kê khai làm nguồn phân loại; mọi override thủ công phải có audit.

---

# VIII. THAY ĐỔI DATA MODEL VÀ DATABASE

## 1. Mở rộng bảng hàng hóa dự thầu

Mở rộng bảng/model hiện tại `hang_hoa_du_thau_nha_thau`; không tạo bảng hàng hóa thứ hai.

Các trường tối thiểu cần có hoặc trường tương đương:

```text
ma_uu_dai                         INTEGER NOT NULL DEFAULT 0 CHECK 0..5
he_so_uu_dai_goc_bp               INTEGER NOT NULL DEFAULT 0
he_so_cong_uu_dai_bp              INTEGER NOT NULL DEFAULT 0
gia_tri_co_so_sau_giam_gia        INTEGER NULL
gia_tri_cong_uu_dai               INTEGER NULL
thanh_tien_sau_uu_dai             INTEGER NULL
uu_dai_source_sheet               TEXT NULL
uu_dai_source_row                 INTEGER NULL
uu_dai_match_method               TEXT NULL
uu_dai_match_status               TEXT NULL
uu_dai_source_payload             JSON/TEXT NULL
uu_dai_manual_override            BOOLEAN/INTEGER NOT NULL DEFAULT false
uu_dai_manual_actor_id            FK/TEXT NULL
uu_dai_manual_updated_at          TIMESTAMP NULL
```

`gia_du_thau_sau_uu_dai` có thể:

- Được tính dẫn xuất khi đọc/render từ `thanh_tien_sau_uu_dai / khoi_luong`; hoặc
- Lưu bằng Decimal có scale rõ ràng.

Ưu tiên **không lưu hai nguồn tiền có thể lệch nhau**. Nếu lưu đơn giá dẫn xuất, backend phải luôn recompute và không tin client.

Có thể gom metadata parser vào JSON nếu phù hợp với pattern hiện tại, nhưng các trường dùng để filter/validate phải có kiểu rõ ràng.

## 2. Dữ liệu tổng hợp cấp nhà thầu/phần lô

Khảo sát model bản ghi mở thầu hiện tại và chọn cách ít trùng lặp nhất. Cần có khả năng đọc nhanh:

```text
tongGiaTriCongUuDai
giaSoSanhSauUuDai hoặc giaDanhGiaSauUuDai
trangThaiTinhUuDai
thoiDiemTinh
version/hash đầu vào
```

Có thể tính từ các dòng bằng selector/query nếu hiệu năng đủ. Nếu cache/persist tổng hợp:

- Backend là nguồn tính chuẩn.
- Có cơ chế invalidation/recompute.
- Không cho client tự gửi tổng và ghi đè.

Không ghi đè các trường giá gốc như `giaDuThau`, `giaSauGiamGia`, `giaXepHang` nếu chúng đang có ý nghĩa riêng.

## 3. Migration và contract

Cập nhật đầy đủ:

- SQLite schema.
- PostgreSQL schema.
- Upgrade migration từ phiên bản hiện hành.
- Index/check constraint/FK.
- Schema contract.
- Generated frontend schema runtime theo script của dự án.
- IndexedDB version/store indexes nếu cần.
- Serialization/deserialization.
- Sync allowlist/record validator.
- Read API và mapper attach.
- Delete policy và ownership validation nếu bị ảnh hưởng.

Migration phải:

- Idempotent theo cơ chế dự án.
- Giữ dữ liệu cũ.
- Backfill mọi dòng cũ thành `ma_uu_dai = 0`.
- Có test nâng cấp từ DB phiên bản trước.
- Hoạt động cả SQLite và PostgreSQL.

---

# IX. BACKEND CALCULATOR LÀ NGUỒN CHUẨN

Tạo một module domain thuần, ví dụ:

```text
backend/domain/goods_preference.py
```

hoặc vị trí phù hợp với kiến trúc hiện tại.

Module này phải:

- Không phụ thuộc HTTP/UI.
- Dùng Decimal/số nguyên basis point.
- Tính theo scope nhà thầu + phần lô.
- Phân bổ giảm giá xác định.
- Tính hệ số chênh lệch.
- Tính tiền cộng ưu đãi.
- Trả breakdown audit cho từng dòng và tổng.
- Có unit test đầy đủ.

Backend phải recompute khi một trong các đầu vào thay đổi:

```text
ma_uu_dai
khoi_luong
don_gia_du_thau
thanh_tien_du_thau
ty_le_giam_gia
gia_sau_giam_gia
mapping phần lô
thêm/xóa dòng
thay đổi phương pháp đánh giá
gia_xep_hang/chi_phi_quy_doi khi phương pháp giá đánh giá
```

Không tin các field dẫn xuất do client gửi. Nếu client gửi để offline preview, server phải tính lại và trả dữ liệu chuẩn.

Khi request cố hoàn thành/chốt tài chính:

- Validate dữ liệu hàng hóa.
- Recompute ưu đãi.
- Validate giá tổng hợp.
- Chỉ sau đó mới cập nhật trạng thái hoàn thành/xếp hạng.

Dùng transaction để không lưu nửa chừng.

---

# X. FRONTEND CALCULATOR VÀ OFFLINE-FIRST

Có thể tạo module frontend thuần tương đương để preview tức thời, ví dụ:

```text
frontend/packages/bidderGoodsPreference.js
```

Yêu cầu:

- Thuật toán và test vector giống backend.
- Không dùng Number cho tiền lớn nếu vượt vùng an toàn; dùng BigInt hoặc utility tiền hiện có.
- Kết quả frontend chỉ là preview.
- Khi sync thành công, merge dữ liệu chuẩn từ server.
- Không làm đứt outbox hoặc conflict recovery.
- Có version/hash để nhận biết preview đã stale nếu dữ liệu đầu vào đổi.

Nếu tránh được việc duplicate logic giữa Python và JavaScript bằng một contract/test vector chung thì thực hiện; tối thiểu phải có fixture JSON dùng chung để chống lệch công thức.

---

# XI. UI/UX

## 1. Tab báo cáo đánh giá chi tiết

Sửa resolver/context để trả về `visibleGroups` theo tiến trình thực tế thay vì danh sách tĩnh.

Tách hai khái niệm:

```text
configuredGroups = các nhóm có thể tồn tại theo phương thức/gói thầu
accessibleGroups = các nhóm hiện được phép hiển thị theo kết quả đã lưu
```

Không mutate constant rule dùng chung.

Tab bị khóa có thể:

- Không render; hoặc
- Render trạng thái disabled kèm lý do.

Theo yêu cầu chính, các phần phía sau **không hiển thị** khi phần trước không đạt/chưa đạt. Có thể hiển thị một dòng thông báo ngắn ở cuối tab hiện tại, ví dụ:

```text
Hoàn thành và kết luận Đạt phần Kỹ thuật để tiếp tục đến Danh mục hàng hóa.
```

## 2. Bảng danh mục hàng hóa

Thêm các cột:

```text
Ưu đãi
Giá dự thầu sau ưu đãi
Thành tiền sau ưu đãi
```

Cột `Ưu đãi`:

- Hiển thị mã `0`–`5` rõ ràng.
- Có badge/tooltip mô tả đầy đủ loại ưu đãi.
- Hiển thị nguồn: `15A`, `Thủ công`, hoặc `Không có 15A`.
- Có cảnh báo nếu mapping/khai báo mâu thuẫn.

Hai cột giá sau ưu đãi:

- Read-only.
- Định dạng tiền theo utility hiện có.
- Hiển thị `—` nếu chưa tính được.
- Tooltip hoặc popover giải thích:
  - giá trước giảm giá;
  - phần giảm giá phân bổ;
  - hệ số ưu đãi gốc;
  - hệ số cộng;
  - tiền cộng;
  - giá sau ưu đãi.

Không làm bảng quá rộng trên màn hình nhỏ. Dùng sticky columns, horizontal scroll, responsive details hoặc cơ chế hiện có của ứng dụng.

## 3. Import preview

Preview import phải cho biết:

```text
Đã nhận diện sheet 12.1B nào
Đã nhận diện sheet 15A nào
Có/không có 15C
Số dòng hàng hóa
Số dòng mã 0,1,2,3,4,5
Số dòng ghép chắc chắn
Số dòng mơ hồ
Số dòng mâu thuẫn
Các cảnh báo theo dòng
```

Cho phép người dùng xem dòng 12.1B và dòng 15A đã ghép với nhau trước khi lưu.

## 4. Override thủ công

Cho phép người có quyền chỉnh mã ưu đãi thủ công khi:

- Không có 15A nhưng người dùng cần nhập trực tiếp trên ứng dụng; hoặc
- Mapping 15A mơ hồ; hoặc
- Cần sửa khai báo theo hồ sơ đã xác minh.

Yêu cầu:

- Dropdown chỉ nhận `0`–`5`.
- Xác nhận khi đổi giá trị import từ 15A.
- Lưu lý do override nếu ứng dụng có pattern audit reason; nếu chưa có, thêm trường lý do ngắn.
- Lưu actor và timestamp.
- Recompute ngay toàn bộ scope vì đổi một dòng có thể làm thay đổi `max_preference_rate` của tất cả dòng.

## 5. Thông tin tổng hợp

Hiển thị ít nhất:

```text
Tổng thành tiền trước giảm giá
Tổng sau giảm giá
Hệ số ưu đãi cao nhất trong phạm vi
Tổng khoản cộng ưu đãi
Giá so sánh/giá đánh giá sau ưu đãi
Trạng thái tính toán
```

Với gói phân lô, tổng hợp theo từng lô và không trộn lẫn.

---

# XII. TÍCH HỢP XẾP HẠNG

Khảo sát `BiddingCalculations.calculateRankings` và mọi controller/render dùng kết quả.

Thay đổi theo nguyên tắc:

## 1. Giá thấp nhất

Đối với hàng hóa và khi dữ liệu ưu đãi đã `ready`:

```text
rankingPrice = giaSoSanhSauUuDai
```

Không tiếp tục dùng `giaXepHang || giaSauGiamGia || giaDuThau` nếu giá ưu đãi hợp lệ đã có.

## 2. Giá đánh giá

Đối với hàng hóa và khi dữ liệu ưu đãi đã `ready`:

```text
rankingPrice = giaDanhGiaSauUuDai
```

Không cộng ưu đãi hai lần nếu `giaXepHang` đã bao gồm khoản này. Phải có field/trạng thái rõ ràng phân biệt giá nền và giá đã ưu đãi.

## 3. Dữ liệu chưa sẵn sàng

Nếu gói hàng hóa áp dụng giá thấp nhất/giá đánh giá nhưng dữ liệu hàng hóa chưa `ready`:

- Không âm thầm xếp hạng theo giá cũ như thể đã áp dụng ưu đãi.
- Hiển thị trạng thái `Chưa đủ dữ liệu ưu đãi để xếp hạng`.
- Có thể vẫn hiển thị xếp hạng tạm nếu sản phẩm hiện có khái niệm preview, nhưng phải đánh dấu rõ và không cho chốt/phê duyệt.

## 4. Hiệu năng

Không query từng dòng trong vòng lặp nhà thầu. Lấy dữ liệu hàng hóa theo batch và tổng hợp bằng map theo `opening_bid_id + lot_id` để tránh N+1.

---

# XIII. VALIDATION VÀ BẢO MẬT

## 1. Lưu nháp

Cho phép lưu nháp khi:

- Chưa nhập kết quả đánh giá.
- Mapping 15A chưa hoàn chỉnh.
- Có cảnh báo công thức.
- Chưa đủ dữ liệu tính ưu đãi.

Nhưng phải lưu rõ trạng thái lỗi/cảnh báo, không biến thành dữ liệu `ready`.

## 2. Lưu chính thức/ready

Không cho chuyển sang `ready` khi:

- Có dòng 15A mơ hồ hoặc mâu thuẫn chưa xử lý.
- Mã ưu đãi ngoài 0–5.
- Dòng ưu đãi không thuộc đúng organization/package/opening bid/lot.
- Thiếu mapping hàng hóa bắt buộc.
- Có mapping trùng.
- Sai phần lô.
- Khối lượng/đơn giá/thành tiền không hợp lệ.
- Tổng dòng không khớp giá dự thầu theo ngưỡng hiện hành.
- Calculator backend lỗi hoặc kết quả không khớp contract.
- Sync chưa thành công.

## 3. Chống bypass tiến trình tab

Backend phải từ chối:

- Hoàn thành `capacity` khi `validity` chưa hoàn thành và Đạt.
- Hoàn thành `technical` khi `capacity` chưa Đạt.
- Chuyển hàng hóa sang `ready` khi `technical` chưa Đạt ở 1G1T.
- Hoàn thành `financial` khi hàng hóa chưa `ready`.
- Ghi báo cáo vòng tài chính 1G2T cho nhà thầu không đạt vòng kỹ thuật.

Trả lỗi nghiệp vụ có mã ổn định và thông báo tiếng Việt rõ ràng.

## 4. An toàn file Excel

Giữ hoặc bổ sung:

- Giới hạn kích thước file/sheet/row/cell.
- Chống zip bomb/archive bomb.
- Timeout parser.
- Không thực thi macro/formula.
- Không render HTML chưa sanitize từ nội dung cell.
- Chống CSV/Excel formula injection khi export.
- Không log toàn bộ hồ sơ hoặc dữ liệu nhạy cảm.

## 5. Phân quyền

Mọi read/write/override phải kiểm tra:

```text
organization
workspace
package
opening bid
lot
role/permission
```

Không cho sửa mã ưu đãi hoặc dữ liệu của nhà thầu thuộc organization khác bằng cách thay ID trên request.

---

# XIV. EXPORT VÀ TÍNH TRUY VẾT

Nếu ứng dụng hiện hỗ trợ export bảng hàng hóa, cập nhật export để có:

```text
Mã ưu đãi
Mô tả ưu đãi
Hệ số ưu đãi gốc
Hệ số cộng khi so sánh
Giá trị sau giảm giá
Khoản cộng ưu đãi
Giá dự thầu sau ưu đãi
Thành tiền sau ưu đãi
Nguồn sheet/dòng 15A
Trạng thái override
```

Không phá định dạng mẫu hiện có. Dữ liệu tiền phải xuất dưới dạng số, không phải chuỗi có dấu phân cách nếu điều đó làm mất khả năng tính toán trong Excel.

Nếu báo cáo đánh giá chi tiết Word/PDF lấy dữ liệu tài chính, bổ sung giá sau ưu đãi theo đúng vị trí hiện có nhưng không mở rộng ngoài phạm vi nếu module export chưa hỗ trợ danh mục hàng hóa.

---

# XV. TEST BẮT BUỘC

## 1. Unit test parser 15A

Tối thiểu:

- Nhận đúng tên sheet đầy đủ.
- Nhận alias có thừa/thiếu dấu chấm và khoảng trắng.
- Không nhầm 15C.
- Header không nằm cố định ở hàng 4.
- Ô merge/xuống dòng.
- `Có/Không`, `1/0`, `X`, boolean.
- Không có 15A → tất cả mã 0.
- Mâu thuẫn dưới 50% và từ 50% trở lên.
- Điều kiện lao động đặc biệt không có nhóm tỷ lệ.
- Innovation precedence.
- File mẫu thật trả `[1, 0, 1, 1]`.

## 2. Test mapping 3 cấu trúc gói

- Không phân lô.
- Phân lô, mỗi lô một loại hàng.
- Phân lô, mỗi lô nhiều loại hàng.
- Tên hàng hóa trùng.
- Tên có xuống dòng/khoảng trắng/dấu câu khác nhau.
- 15A thiếu lô.
- Mapping mơ hồ không được tự chốt.
- Một nhà thầu tham dự nhiều lô.
- Nhà thầu liên danh nếu opening bid hiện hỗ trợ.

## 3. Unit test calculator

Test mọi vector:

```text
max 0%
max 7,5%
max 10%
max 12%
max 15%
```

Test từng mã 0–5 và các tổ hợp trộn:

```text
[0,1]
[0,1,2]
[0,1,3]
[0,1,2,3]
[0,1,2,3,4]
[0,1,2,3,4,5]
[4,5]
[2,5]
chỉ mã 0
chỉ mã 5
```

Test:

- Có/không giảm giá.
- Tỷ lệ giảm giá có số lẻ.
- Phân bổ phần dư.
- Tiền rất lớn vượt Number safe integer.
- Khối lượng lẻ nếu schema cho phép.
- Làm tròn HALF_UP.
- Mỗi lô có max rate riêng.
- Đổi một mã làm toàn scope recompute.
- Tổng dòng sau giảm giá khớp tổng cấp nhà thầu.
- Tổng khoản cộng ưu đãi khớp tổng từng dòng.

Dùng test vector chung cho backend và frontend để chống lệch thuật toán.

## 4. Test tiến trình tab

### 1G1T hàng hóa

- Ban đầu chỉ hiện `validity`.
- Lưu nháp validity chưa mở capacity.
- Hoàn thành validity Không đạt: không hiện phần sau.
- Hoàn thành validity Đạt: hiện capacity.
- Lặp tương tự cho capacity và technical.
- Technical Đạt: hiện bidder_goods.
- Bidder goods draft: chưa hiện financial.
- Bidder goods ready: hiện financial.
- Đổi validity từ Đạt thành Không đạt: ẩn tất cả phía sau nhưng dữ liệu vẫn còn DB.
- Đổi lại Đạt: dữ liệu phía sau hiển thị lại.
- Active tab bị ẩn được chuyển an toàn.

### 1G2T hàng hóa

- Vòng kỹ thuật chỉ có validity → capacity → technical.
- Nhà thầu không đạt kỹ thuật không có trong vòng tài chính.
- Vòng tài chính hiển thị bidder_goods trước financial.
- Financial chỉ hiện khi bidder_goods ready.
- Không hiển thị bidder_goods trong vòng kỹ thuật.

### Không phải hàng hóa

- Không có bidder_goods.
- Luồng cũ không bị phá.

## 5. Backend integration/security test

- Request bypass prerequisite bị từ chối.
- Cross-organization ID bị từ chối.
- Cross-package/cross-lot mapping bị từ chối.
- Client gửi derived money sai: server bỏ qua/recompute.
- Concurrent update/version conflict.
- Offline outbox retry không nhân đôi dòng.
- Reload/read API trả đầy đủ field mới.
- Delete/replace import không để lại tổng cache sai.

## 6. Migration test

- Upgrade DB cũ có hàng hóa nhưng chưa có ưu đãi.
- Backfill mã 0.
- SQLite và PostgreSQL parity.
- Constraint mã 0–5.
- Schema runtime generate sạch và idempotent.

## 7. E2E

Qua UI thực tế:

```text
upload file mẫu
preview 12.1B + 15A
xác minh mã [1,0,1,1]
lưu nháp
reload
hoàn thành danh mục hàng hóa
xem cột giá sau ưu đãi
hoàn thành tài chính
xác minh xếp hạng dùng giá sau ưu đãi
```

Chạy cả trường hợp:

- Không phân lô.
- Một lô một hàng.
- Một lô nhiều hàng.
- Không có 15A.
- Có mã 5.
- Có mã 4 và mã 5 trộn nhau.

---

# XVI. LỆNH KIỂM TRA TỐI THIỂU

Khảo sát `package.json`, CI và tài liệu hiện tại để dùng đúng lệnh. Tối thiểu chạy các lệnh tương đương:

```bash
python -m pytest -q
node --test tests/js/*.test.mjs
python scripts/generate_schema_runtime.py
npm run test:bidder-goods-e2e
npm run build
git diff --check
```

Sau khi chạy generator:

```bash
git diff --exit-code -- frontend/app/schemaRuntime.js
```

hoặc lệnh idempotency tương đương của dự án.

Nếu môi trường staging Linux có Bubblewrap/seccomp test riêng thì chạy theo CI hiện có; nếu không chạy được do thiếu dependency hệ thống, ghi rõ, không đánh dấu sai là lỗi sản phẩm.

Không được chỉ chạy test mới. Phải chạy test hồi quy toàn bộ vì thay đổi ảnh hưởng:

- detailed evaluation;
- Excel parser;
- database schema;
- sync;
- ranking;
- tài chính;
- E2E trình duyệt.

---

# XVII. TIÊU CHÍ CHẤP NHẬN

Công việc chỉ được coi là hoàn thành khi tất cả điều sau đúng:

1. Tab hàng hóa nằm giữa Kỹ thuật và Tài chính đúng theo từng phương thức.
2. Tab phía sau không hiện khi phần trước chưa Đạt.
3. Backend chặn bypass thứ tự.
4. Import Excel chưa có kết quả vẫn lưu nháp vào DB và còn sau reload.
5. Parser nhận đúng sheet 15A, không dùng tên 15.1A.
6. Không có 15A → mã 0, không chặn luồng.
7. File mẫu thật cho mã `[1,0,1,1]`.
8. Mapping hoạt động cho không phân lô, một hàng/lô và nhiều hàng/lô.
9. Bảng có đủ 3 cột mới.
10. Giá trị sau ưu đãi do backend tính lại, không tin client.
11. Thuật toán chênh lệch hệ số cho đúng toàn bộ mã 0–5.
12. Giảm giá được phân bổ xác định và không làm lệch tổng.
13. Giá thấp nhất và giá đánh giá dùng giá sau ưu đãi để xếp hạng.
14. Dữ liệu gốc không bị ghi đè/mất.
15. Dữ liệu tab phía sau được bảo toàn khi phần trước chuyển Không đạt.
16. SQLite, PostgreSQL, IndexedDB và sync contract đồng bộ.
17. Không phát sinh N+1 rõ ràng.
18. Test unit/integration/security/E2E mới đều pass.
19. Test hồi quy hiện có đều pass.
20. `git diff --check` sạch.

---

# XVIII. BÁO CÁO KẾT QUẢ CODEx PHẢI TẠO

Tạo file:

```text
CODEX_GOODS_PREFERENCE_IMPLEMENTATION_REPORT.md
```

Nội dung tối thiểu:

1. Commit/branch/base đã khảo sát.
2. Kiến trúc cũ và điểm tích hợp được chọn.
3. Danh sách file thêm/sửa.
4. Migration/schema version trước và sau.
5. Contract field mới.
6. Cách gate tab 1G1T và 1G2T.
7. Cách lưu draft Excel chưa có kết quả.
8. Cách nhận diện và mapping sheet 15A.
9. Công thức ưu đãi và làm tròn.
10. Cách tích hợp giá thấp nhất/giá đánh giá/xếp hạng.
11. Kết quả test từng nhóm, kèm lệnh và số lượng pass/fail/skip.
12. Kết quả kiểm tra file mẫu thật.
13. Các giới hạn còn lại, nếu có.
14. Hướng dẫn migration/deploy/rollback.

Không ghi “hoàn thành” nếu còn test fail do code. Nếu có test không chạy được vì môi trường, phân biệt rõ lỗi môi trường và cung cấp bằng chứng.

---

# XIX. NGUYÊN TẮC TRIỂN KHAI CUỐI CÙNG

- Ưu tiên mở rộng component/module hiện có.
- Tách parser, mapping, calculator, persistence và UI thành các lớp trách nhiệm rõ ràng.
- Không nhét toàn bộ logic vào controller hoặc renderer.
- Không dùng magic number; định nghĩa enum/map mã ưu đãi tập trung.
- Không duplicate công thức ở nhiều nơi không có test contract.
- Không dùng float cho tiền.
- Không xóa dữ liệu cũ chỉ vì tab bị ẩn.
- Không mở tab dựa trên state tạm chưa persist.
- Không chỉ sửa frontend.
- Không chỉ sửa SQLite mà quên PostgreSQL/IndexedDB/schema runtime.
- Không ghi đè giá gốc bằng giá sau ưu đãi.
- Không tự suy mã 5 từ tên sản phẩm.
- Không fuzzy-match im lặng khi mapping 15A mơ hồ.
- Không làm thay đổi nghiệp vụ giá thấp bất thường hiện tại ngoài phạm vi yêu cầu.
- Không dừng ở plan: hãy triển khai, chạy test, sửa lỗi và bàn giao báo cáo đầy đủ.
