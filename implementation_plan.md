# Kế hoạch Sửa Lỗi: Chỉnh sửa/Xóa Gói thầu & Lưu Dữ liệu Mở thầu, Đánh giá, Kết quả

## Mô tả Vấn đề

Người dùng không thực hiện được các thao tác sau:
1. **Sửa gói thầu** (Edit GoiThau form) — Form mở nhưng không lưu được hoặc lỗi validation
2. **Xóa gói thầu** — Không xóa được hoặc không có phản hồi
3. **Lưu thông tin mở thầu** (tab Mở thầu) — Nút "Lưu thông tin mở thầu" không hoạt động
4. **Lưu đánh giá HSDT** (tab Đánh giá) — Dữ liệu đánh giá không được lưu
5. **Lưu kết quả trúng thầu** (tab Kết quả) — Không lưu được thông tin kết quả

## Kết quả Phân tích Code

### A. Luồng Sửa/Xóa Gói thầu

| Hàm | File | Trạng thái |
|-----|------|------------|
| `window.editGoiThau(id)` | `BiddingController.js` (line 391) | Gọi `this.editGoiThau(id, isReadOnly)` |
| `editGoiThau(id)` | `GoiThauWorkflow.js` (line 140) | Đổ dữ liệu vào form modal |
| `handleGoiThauSubmit` | `BiddingControllerForms.js` | Xử lý submit → gọi `GoiThauWorkflow._handleGoiThauSubmit` |
| `_handleGoiThauSubmit` | `GoiThauWorkflow.js` (line ~700) | Lưu vào `model.state.goithau`, gọi `persistData('goithau')` |
| `window.deleteGoiThau(id)` | `BiddingController.js` (line 392) | Gọi `this.deleteGoiThau(id)` |
| `deleteGoiThau(id)` | `GoiThauWorkflow.js` (line 20) | Xóa khỏi state, gọi `persistData` → `autoSync()` |

**Vấn đề tiềm ẩn phát hiện:**
- Hàm `editGoiThau` tại line 430-432 sử dụng `this.model.formatForDatetimeLocal(...)` để đổ dữ liệu vào `<input type="datetime-local">`, nhưng trong `_handleGoiThauSubmit`, giá trị đọc ra từ `document.getElementById('gt-thoigiandangtai').value` lại được xử lý qua `this.model.convertDMYHMSToYMDHMS(valueDate1)` — hàm này **chỉ nhận định dạng `dd/MM/yyyy HH:mm`** (từ Flatpickr), không nhận định dạng `yyyy-MM-ddTHH:mm` (từ `datetime-local` native). Nếu Flatpickr không khởi tạo được (do lỗi dependency hoặc element chưa render), input sẽ trả về giá trị `datetime-local` native gây chuyển đổi sai thời gian → validate fail hoặc lưu sai dữ liệu.

### B. Luồng Lưu Thông tin Mở thầu

| Hàm | File | Trạng thái |
|-----|------|------------|
| `renderMoThauPanel()` | `BidProcessWorkflow.js` (line 300) | Render bảng nhà thầu |
| `saveThongTinMoThau()` | `BidProcessWorkflow.js` (line 1198) | Lưu vào `model.state.thongtinmothau` |

**Vấn đề phát hiện:**
- `renderMoThauPanel()` (line 307) lọc gói thầu theo điều kiện: `trangThai === 'Đang mời thầu'` VÀ `thoiGianDongThau < now`. Nếu thời gian đóng thầu chưa qua, gói sẽ **không hiển thị** trong dropdown → người dùng không thể thêm nhà thầu.
- Từ tab `goithau-detail`, khi gói ở trạng thái `'Đang mời thầu'`, tab `opening` hiển thị bảng nhà thầu thông qua `window.appController.renderMoThauPanel()` (GoiThauView.js line 1305) — nhưng `mothau-goithau-select` đã được set sẵn `value = gt.id`. Tuy nhiên hàm `handlePackageSelection` lọc lại `targetPackages` và nếu gói không thỏa điều kiện thời gian → **dropdown không có gói đó → select.value bị reset → panel không render → nút "Lưu" không hoạt động**.

### C. Luồng Lưu Đánh giá HSDT

| Hàm | File | Trạng thái |
|-----|------|------------|
| `renderDanhGiaHsdtPanel()` | `BidEvaluationWorkflow.js` | Render bảng đánh giá |
| `saveDanhGiaHsdt()` | `BidEvaluationWorkflow.js` | Lưu metadata đánh giá |

Cần kiểm tra xem nút `btn-danhgiahsdt-save` có được bind sự kiện đúng không, và `renderDanhGiaHsdtPanel()` có được gọi sau khi DOM sẵn sàng không.

### D. Luồng Lưu Kết quả (Tab `result`)

- Kết quả được lưu thông qua form `modal-goithau` với `trangThai = 'Đã có kết quả'` và trường `nhaThauTrungThauId`, `giaTrungThau`.
- Nếu `editGoiThau()` bị lỗi → kết quả cũng không lưu được.

---

## Câu hỏi cần làm rõ

> [!IMPORTANT]
> **Q1:** Khi bấm nút "Chỉnh sửa" gói thầu, form modal có mở ra không? Hay không có phản hồi gì?

> [!IMPORTANT]
> **Q2:** Khi bấm "Lưu thông tin mở thầu" trong tab mở thầu, có thông báo lỗi nào hiện ra không (alert đỏ)? Hay form đóng nhưng dữ liệu không được lưu?

> [!IMPORTANT]
> **Q3:** Lỗi có xảy ra ở tất cả gói thầu, hay chỉ gói thầu ở trạng thái nhất định (ví dụ chỉ khi trạng thái là "Đang mời thầu" trở lên)?

---

## Proposed Changes (Thay đổi Đề xuất)

### 1. Sửa điều kiện lọc trong `renderMoThauPanel` — cho phép mở thầu từ Tab Chi tiết

**Root cause:** Khi vào tab `opening` từ `showPackageDetails(id)`, `mothau-goithau-select` đã được gán sẵn `value = gt.id` (GoiThauView.js line 1282), nhưng `handlePackageSelection` trong `renderMoThauPanel` lọc `targetPackages` và không tìm thấy gói → select bị blank → không render nội dung.

#### [MODIFY] [BidProcessWorkflow.js](file:///f:/Bidding/controllers/workflows/BidProcessWorkflow.js)

Tại `renderMoThauPanel()` (line ~315-323): Khi select đã có `value` (preset từ chi tiết), bỏ qua bước populate dropdown và xử lý trực tiếp với `gtId` đã có.

---

### 2. Sửa lỗi chuyển đổi ngày tháng trong `_handleGoiThauSubmit` — tương thích `datetime-local`

**Root cause:** Input nhận value từ `datetime-local` native (`yyyy-MM-ddTHH:mm`) nhưng bị parse bằng `convertDMYHMSToYMDHMS()` (chỉ hỗ trợ `dd/MM/yyyy HH:mm`).

#### [MODIFY] [GoiThauWorkflow.js](file:///f:/Bidding/controllers/workflows/GoiThauWorkflow.js)

Tại hàm `_handleGoiThauSubmit()` (line ~806-815): Thêm auto-detect: nếu giá trị đã ở dạng ISO (`contains 'T'`), dùng trực tiếp, không convert.

---

### 3. Xác minh và sửa việc bind sự kiện nút "Lưu đánh giá"

#### [MODIFY] [BidEvaluationWorkflow.js](file:///f:/Bidding/controllers/workflows/BidEvaluationWorkflow.js)

Kiểm tra hàm `renderDanhGiaHsdtPanel()` — đảm bảo `btn-danhgiahsdt-save` được bind `onclick` sau khi DOM render xong.

---

### 4. Kiểm tra và đảm bảo `convertDMYHMSToYMDHMS` an toàn với cả 2 định dạng

#### [MODIFY] [models/BiddingModel.js](file:///f:/Bidding/models/BiddingModel.js)

Cập nhật `convertDMYHMSToYMDHMS()` để xử lý cả định dạng ISO (`yyyy-MM-ddTHH:mm`) và định dạng `dd/MM/yyyy HH:mm`.

---

### 5. Đảm bảo `convertDMYToYMD` an toàn với định dạng `yyyy-MM-dd`

#### [MODIFY] [models/BiddingModel.js](file:///f:/Bidding/models/BiddingModel.js)

Cập nhật `convertDMYToYMD()` để trả về nguyên giá trị nếu đã là định dạng `yyyy-MM-dd`.

---

## Verification Plan (Kế hoạch Xác minh)

### Automated Tests
- Không có test suite tự động (ứng dụng frontend thuần).

### Manual Verification
1. Thêm mới gói thầu → Kiểm tra lưu thành công.
2. Sửa gói thầu ở trạng thái "Chuẩn bị" → Kiểm tra dữ liệu lưu đúng.
3. Sửa gói thầu ở trạng thái "Đang mời thầu" → Kiểm tra không bị lỗi convert ngày.
4. Xóa gói thầu (1 phiên bản và nhiều phiên bản) → Kiểm tra xóa thành công.
5. Vào Tab "Mở thầu" từ Chi tiết gói thầu → Kiểm tra form nhà thầu hiển thị và nút "Lưu" hoạt động.
6. Lưu thông tin đánh giá kỹ thuật/tài chính → Kiểm tra metadata được ghi.
7. Lưu kết quả trúng thầu → Kiểm tra `nhaThauTrungThauId` và `giaTrungThau` được lưu.
