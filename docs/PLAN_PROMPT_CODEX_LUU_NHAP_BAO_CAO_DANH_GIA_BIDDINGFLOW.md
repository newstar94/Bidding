# PLAN + PROMPT CODEX — LƯU NHÁP BÁO CÁO ĐÁNH GIÁ BIDDINGFLOW

**Repository:** `https://github.com/newstar94/Bidding`  
**Mục tiêu:** Bổ sung cơ chế lưu nháp an toàn cho **Báo cáo đánh giá tổng quát** và chuẩn hóa/đồng bộ cơ chế lưu nháp của **Báo cáo đánh giá chi tiết**, cho phép người dùng đánh giá dở dang theo **từng nhà thầu, từng phần đánh giá, từng phần lô, từng vòng đánh giá** và quay lại làm tiếp sau.

---

# PHẦN I — PLAN TRIỂN KHAI

## 1. Bối cảnh nghiệp vụ

Trong thực tế một gói thầu có thể có rất nhiều nhà thầu. Người dùng không nhất thiết đánh giá hoàn chỉnh một nhà thầu từ đầu đến cuối rồi mới chuyển sang nhà thầu khác.

Người dùng có thể thực hiện theo nhiều kiểu:

- Đánh giá **Tính hợp lệ** cho toàn bộ nhà thầu trước.
- Sau đó đánh giá **Năng lực, kinh nghiệm** cho một số nhà thầu.
- Hôm sau tiếp tục phần Năng lực còn lại.
- Sau đó mới đánh giá **Kỹ thuật**.
- Với gói phân lô, có thể đang làm dở một hoặc nhiều phần lô.
- Với 1G2T, có thể đang làm dở báo cáo kỹ thuật nhưng chưa được phép chuyển sang tài chính.
- Với báo cáo chi tiết, có thể mới nhập một số tiêu chí trong một nhóm đánh giá.

Do đó, trạng thái nháp phải tồn tại ở cấp độ đủ nhỏ để khôi phục chính xác dữ liệu người dùng đã nhập, không ép người dùng hoàn thành toàn bộ một nhà thầu hoặc toàn bộ báo cáo trong một lần.

---

## 2. Nguyên tắc nghiệp vụ bắt buộc

### 2.1. Hai khái niệm phải tách biệt

Hệ thống phải phân biệt rõ:

1. **Lưu nháp**
   - Cho phép dữ liệu chưa hoàn chỉnh.
   - Không kích hoạt kết quả nghiệp vụ cuối cùng.
   - Không mở bước tiếp theo.
   - Không khóa báo cáo.
   - Không hoàn thành vòng đánh giá.
   - Không thay đổi trạng thái gói thầu sang trạng thái kết quả chính thức.

2. **Hoàn thành báo cáo đánh giá**
   - Chạy toàn bộ validation nghiệp vụ.
   - Yêu cầu đầy đủ các trường bắt buộc.
   - Có thể tính kết luận, xếp hạng, kết quả.
   - Có thể mở bước tiếp theo theo workflow hiện tại.
   - Đánh dấu vòng đánh giá đã hoàn thành.

### 2.2. Người dùng phải được phép lưu nháp ở bất kỳ thời điểm hợp lệ nào

Ví dụ hợp lệ khi lưu nháp:

```text
Nhà thầu A:
- Hợp lệ: Đạt
- Năng lực: chưa đánh giá
- Kỹ thuật: chưa đánh giá

Nhà thầu B:
- Hợp lệ: Không đạt
- Lý do: Thiếu bảo đảm dự thầu

Nhà thầu C:
- chưa đánh giá
```

Hoặc:

```text
Nhà thầu A:
- Hợp lệ: Đạt
- Năng lực: Đạt
- Kỹ thuật: 82.5

Nhà thầu B:
- Hợp lệ: Đạt
- Năng lực: đang làm dở

Nhà thầu C:
- Hợp lệ: Đạt
- Năng lực: chưa làm
```

Tất cả các trường hợp trên đều phải lưu nháp được.

---

## 3. Validation khi lưu nháp

Áp dụng nguyên tắc:

> **Trường để trống được phép khi lưu nháp. Nhưng nếu người dùng đã nhập dữ liệu thì dữ liệu đó phải hợp lệ.**

Ví dụ:

```text
Điểm kỹ thuật = ""
=> được phép lưu nháp.

Điểm kỹ thuật = "abc"
=> không được lưu vì giá trị đã nhập nhưng sai định dạng.

Điểm kỹ thuật = "82.5"
=> được lưu nháp.
```

Không được dùng cùng validation “required” của hành động Hoàn thành cho hành động Lưu nháp.

Cần tách validation thành các lớp:

```text
validateDraft()
validateCompletion()
```

hoặc API tương đương có mode rõ ràng.

---

## 4. Phạm vi chức năng

Phải hỗ trợ đầy đủ:

### 4.1. Báo cáo đánh giá tổng quát

Bao gồm các trường hiện có như:

- `danhGiaHopLe`
- `nguyenNhanKhongDatHopLe`
- `lamRoHopLe`
- `danhGiaNangLuc`
- `nguyenNhanKhongDatNangLuc`
- `lamRoNangLuc`
- `danhGiaKyThuat`
- `nguyenNhanKhongDatKyThuat`
- `lamRoKyThuat`
- `danhGiaTaiChinh`
- `lamRoTaiChinh`
- `danhGiaKetLuan`
- `diemDanhGia`
- `giaXepHang`
- `giaDeNghiTrungThau`
- các trường liên quan hiện có khác.

Phải cho phép lưu từng phần, không cần đủ dữ liệu toàn bộ nhà thầu.

### 4.2. Báo cáo đánh giá chi tiết

Giữ và hoàn thiện cơ chế hiện có trong:

```text
frontend/packages/DetailedEvaluationDraftAutosave.js
frontend/packages/DetailedEvaluationSaveWorkflow.js
```

Không tạo một hệ thống nháp hoàn toàn khác nếu có thể tái sử dụng/generialize code hiện tại.

### 4.3. Gói thầu phân lô

Draft phải đúng theo scope:

```text
package
+ evaluation round
+ lot/batch scope
+ bidder
+ evaluation field
```

Không để dữ liệu nháp của lô A làm ảnh hưởng lô B.

### 4.4. Một giai đoạn hai túi hồ sơ — 1G2T

Lưu nháp kỹ thuật:

```text
technical.saved = false
```

và vòng kỹ thuật vẫn ở trạng thái draft.

Không được mở tab tài chính chỉ vì đã có dữ liệu nháp kỹ thuật.

Chỉ hành động hoàn thành kỹ thuật chính thức mới được phép mở bước tài chính theo logic hiện tại.

---

## 5. Kiến trúc dữ liệu đề xuất

## 5.1. Không tạo bảng draft riêng ngay lập tức

Ưu tiên tận dụng mô hình normalized hiện tại:

```text
vong_danh_gia
ket_qua_danh_gia_nha_thau
tieu_chi_danh_gia
...
```

Backend hiện đã có semantics:

```text
saved = false
=> trang_thai = "draft"

saved = true
=> trang_thai = "completed"
```

Và `ket_qua_danh_gia_nha_thau` đang hỗ trợ conditional UPSERT theo trường được truyền vào.

Do đó, trước khi tạo migration hoặc bảng mới, Codex phải chứng minh rõ dữ liệu hiện tại không đủ đáp ứng yêu cầu.

**Không tạo bảng `evaluation_drafts`, `draft_reports`, hoặc JSON blob chứa toàn bộ báo cáo nếu không thực sự cần.**

---

## 5.2. Partial update theo field/record

Đây là yêu cầu quan trọng.

Nếu người dùng chỉ sửa:

```text
Nhà thầu A:
danhGiaKyThuat: 80 -> 82
```

thì không nên gửi lại toàn bộ 100 nhà thầu và toàn bộ các trường.

Payload nên càng gần dạng:

```js
{
  id: bidId,
  danhGiaKyThuat: "82"
}
```

thay vì gửi lại record đầy đủ.

Phải tận dụng backend conditional UPSERT hiện có để tránh:

- ghi đè dữ liệu cũ bằng snapshot stale;
- tăng payload;
- tăng số mutation;
- tăng rủi ro conflict khi nhiều tab/thiết bị;
- giảm hiệu năng khi có nhiều nhà thầu.

---

## 6. Dirty tracking

Cần có cơ chế theo dõi các trường đã thay đổi.

Ví dụ:

```js
dirtyEvaluationFields = {
  [bidId]: new Set([
    "danhGiaKyThuat",
    "lamRoKyThuat",
  ]),
}
```

Hoặc cấu trúc khác phù hợp hơn với codebase.

Yêu cầu:

- Chỉ persist bidder records có thay đổi.
- Trong từng bidder record chỉ gửi các trường thực sự thay đổi nếu persistence layer cho phép.
- Khi persist thành công phải clear dirty tương ứng.
- Nếu persist thất bại phải giữ dirty state.
- Không clear local recovery draft trước khi server persist thành công.
- Phải xử lý rerender mà không làm mất dirty state.

---

## 7. Hai tầng lưu nháp

Nên có 2 lớp bảo vệ:

### 7.1. Local recovery autosave

Mục tiêu:

- mất điện;
- đóng tab nhầm;
- reload;
- trình duyệt crash;
- mất mạng trước khi bấm Lưu nháp.

Tái sử dụng/generalize cơ chế:

```text
DraftAutosaveStore
DetailedEvaluationDraftAutosave.js
```

Delay hiện tại khoảng 800ms có thể giữ nguyên hoặc điều chỉnh hợp lý trong khoảng 800–1500ms nếu có lý do.

Local autosave không phải nguồn dữ liệu nghiệp vụ chính thức.

### 7.2. Server draft

Khi người dùng bấm:

```text
Lưu nháp
```

phải persist lên server để:

- đăng nhập thiết bị khác vẫn làm tiếp được;
- đăng nhập lại vẫn làm tiếp được;
- không phụ thuộc localStorage.

Server draft là persisted incomplete evaluation state, nhưng **không phải phiên bản nghiệp vụ hoàn thành**.

---

## 8. Báo cáo tổng quát — API frontend đề xuất

Refactor:

```js
saveDanhGiaHsdt()
```

thành dạng có mode rõ ràng, ví dụ:

```js
saveDanhGiaHsdt({ mode: "draft" })
saveDanhGiaHsdt({ mode: "complete" })
```

Hoặc:

```js
saveDanhGiaHsdt({ complete: false })
saveDanhGiaHsdt({ complete: true })
```

Ưu tiên enum/string rõ nghĩa hơn boolean nếu phù hợp codebase.

Không tạo hai hàm khổng lồ copy/paste như:

```text
saveDanhGiaHsdtDraft()
saveDanhGiaHsdtComplete()
```

với 80–90% code giống nhau.

Nên tách thành các helper:

```text
collectEvaluationDraftChanges()
validateEvaluationDraft()
validateEvaluationCompletion()
buildEvaluationMetadata()
persistEvaluationChanges()
applyEvaluationCompletionProjection()
```

Tên cụ thể có thể thay đổi để đồng bộ convention hiện tại.

---

## 9. Hành vi Lưu nháp tổng quát

Khi `mode === "draft"`:

### Được phép

- thiếu số báo cáo;
- thiếu ngày báo cáo;
- còn nhà thầu chưa đánh giá;
- một nhà thầu mới đánh giá Hợp lệ;
- một nhà thầu mới đánh giá Hợp lệ + Năng lực;
- điểm kỹ thuật còn trống;
- kết luận còn trống;
- chưa xếp hạng;
- chưa hoàn thành tất cả phần lô.

### Phải làm

- validate format của trường đã nhập;
- persist metadata báo cáo đã nhập;
- persist dirty bidder fields;
- giữ round trạng thái draft;
- giữ `saved = false`;
- ghi thời điểm server draft gần nhất nếu cần và phù hợp schema;
- hiển thị feedback lưu thành công thân thiện;
- giữ người dùng ở đúng màn hình/tab/scope hiện tại.

### Tuyệt đối không làm

- không gọi workflow hoàn thành;
- không chuyển tab kết quả;
- không tự chuyển sang bước tiếp theo;
- không finalize batch phần lô;
- không xếp hạng chính thức;
- không tạo kết quả trúng thầu;
- không khóa báo cáo;
- không set `saved = true`;
- không set `completed`;
- không set `hoanThanhLuc`;
- không thay đổi lifecycle gói thầu sang “Đã có kết quả”;
- không mở Financial của 1G2T.

---

## 10. Hành vi Hoàn thành báo cáo

Khi `mode === "complete"`:

Giữ nguyên business behavior hiện có, sau refactor phải không có regression.

Phải:

- yêu cầu Số báo cáo;
- yêu cầu Ngày báo cáo;
- validate toàn bộ các trường nghiệp vụ bắt buộc;
- validate điểm kỹ thuật theo phương pháp đánh giá;
- validate phạm vi phần lô;
- validate điều kiện 1G2T;
- tính kết luận;
- tính ranking nếu workflow yêu cầu;
- set `saved = true`;
- set round `completed`;
- set completion timestamp;
- thực hiện downstream workflow hiện có;
- chuyển bước/tab nếu logic hiện tại đang làm như vậy.

---

## 11. Kết luận tạm thời và kết quả suy ra

Không được coi dữ liệu draft là kết quả chính thức.

Có thể hiển thị preview trên UI nếu hiện tại màn hình đã có logic suy ra kết luận từ các ô đang nhập, nhưng:

- preview không được persist thành official ranking nếu chưa hoàn thành;
- preview không được mở bước tiếp theo;
- preview không được cập nhật lifecycle package;
- preview không được sinh award/result;
- preview không được finalize lot batch.

Nếu draft thay đổi một bước trước đó làm downstream data không còn đáng tin cậy, phải xử lý invalidation thận trọng.

Ví dụ:

```text
Hợp lệ: Đạt
Năng lực: Đạt
Kỹ thuật: 82
```

sau đó sửa:

```text
Hợp lệ: Không đạt
```

thì các giá trị downstream không còn hợp lệ phải được clear/mark stale theo business rule hiện tại.

Không được để dữ liệu ẩn cũ tự xuất hiện trở lại và tạo kết quả sai.

---

# 12. UI/UX — YÊU CẦU BẮT BUỘC

## 12.1. Không redesign

**Tuyệt đối không thiết kế lại giao diện hiện tại.**

Không được tự ý thay đổi:

- bố cục màn hình;
- kích thước panel;
- cấu trúc table;
- thứ tự cột;
- tab;
- màu chủ đạo;
- font;
- border radius;
- spacing tổng thể;
- form layout;
- navigation;
- modal;
- icon style;
- responsive behavior hiện có;
- route-level CSS structure;
- design tokens;
- cách hiển thị các phần nghiệp vụ không liên quan.

Không được “làm hiện đại hơn” bằng cách thay toàn bộ UI.

Yêu cầu “hiện đại, thân thiện” ở đây nghĩa là **phần chức năng mới phải hòa nhập hoàn toàn với UI hiện có**.

---

## 12.2. Nút hành động

Trong chế độ đang nhập/chỉnh sửa báo cáo, bố trí hai hành động:

```text
[Lưu nháp] [Hoàn thành báo cáo đánh giá]
```

hoặc wording tương đương nhưng phải rõ ràng.

Ưu tiên:

- nút Hoàn thành dùng visual hierarchy tương đương primary action hiện tại;
- Lưu nháp là secondary action;
- dùng class/component/style/button pattern có sẵn;
- dùng icon Lucide đang được dùng trong codebase nếu cần;
- không tạo button design mới.

Không làm toolbar quá cao hoặc phá layout.

---

## 12.3. Save status

Nên có feedback nhẹ, không gây gián đoạn.

Ví dụ:

```text
Đã lưu nháp lúc 14:32
```

hoặc toast theo pattern hiện tại.

Không mở modal xác nhận mỗi lần lưu nháp.

Không dùng popup làm gián đoạn workflow nếu không có lỗi.

Nếu có local unsynced recovery draft:

```text
Đã lưu tạm trên thiết bị
```

Nếu server save thành công:

```text
Đã lưu nháp
```

Nếu sync lỗi:

```text
Chưa đồng bộ được bản nháp
```

phải cho phép người dùng hiểu dữ liệu hiện đang ở trạng thái nào.

---

## 12.4. Thanh tiến trình đánh giá — BẮT BUỘC

Phải bổ sung một **thanh tiến trình compact**, thân thiện và hiện đại nhưng không làm thay đổi bố cục hiện tại.

Vị trí ưu tiên:

- ngay phía trên bảng đánh giá hoặc sát khu vực tiêu đề của bảng;
- cùng container hiện có nếu có thể;
- không tạo dashboard/card lớn;
- không đẩy bảng xuống quá nhiều;
- không thay đổi cấu trúc hoặc thứ tự cột.

Gợi ý hiển thị:

```text
Tiến độ đánh giá                                      31%
████████░░░░░░░░░░░░░░░░░░

Hợp lệ 20/20 · Năng lực 8/20 · Kỹ thuật 3/20
Đã lưu nháp lúc 14:32
```

Trên màn hình nhỏ có thể wrap dòng chi tiết nhưng thanh tiến trình phải giữ full width của container hiện tại.

### 12.4.1. Màu gradient động theo phần trăm hoàn thành

Người dùng yêu cầu màu sắc thanh tiến trình **thay đổi theo tỷ lệ % hoàn thành dưới dạng gradient**.

Màu phải chuyển dần theo hướng trực quan:

```text
0%        : chưa có fill / neutral track
1–25%     : đỏ -> cam đỏ
26–50%    : cam -> vàng
51–75%    : vàng -> xanh non
76–99%    : xanh non -> xanh lá
100%      : xanh lá hoàn thành
```

Ưu tiên chuyển màu **liên tục** thay vì chỉ đổi class theo ngưỡng.

Một cách triển khai tham khảo:

```text
progressHue = clamp(percent, 0, 100) * 1.2

0%   -> hue ~ 0°   (đỏ)
50%  -> hue ~ 60°  (vàng)
100% -> hue ~ 120° (xanh)
```

Fill có thể dùng gradient cục bộ, ví dụ về nguyên tắc:

```css
background:
  linear-gradient(
    90deg,
    hsl(startHue ...),
    hsl(endHue ...)
  );
width: var(--progress-percent);
```

Codex không bắt buộc phải dùng đúng đoạn CSS trên; phải lựa chọn implementation tương thích với browser target và CSS architecture hiện tại.

Yêu cầu bắt buộc:

- gradient chỉ áp dụng cho **progress component**, không thay đổi global theme;
- không thêm global CSS gây side effect;
- ưu tiên CSS variable/scoped class;
- track nền dùng neutral/border token hiện có;
- màu phải đủ tương phản;
- vẫn hiển thị con số `%` nên không phụ thuộc màu để truyền đạt trạng thái;
- `100%` phải có trạng thái hoàn thành rõ ràng;
- `0%` không được hiển thị một thanh đỏ gây cảm giác lỗi; nên là neutral/empty.

Nếu browser/support architecture khiến continuous HSL gradient không phù hợp, cho phép fallback sang các gradient theo ngưỡng ở trên, nhưng vẫn phải là gradient chứ không phải một màu phẳng.

### 12.4.2. Công thức tính tiến độ theo từng bước

Không được tính đơn giản theo “số nhà thầu đã hoàn thành toàn bộ”.

Phải phản ánh việc người dùng có thể đánh giá từng phần.

Ví dụ:

```text
Hợp lệ     20/20
Năng lực    8/15
Kỹ thuật    3/8
Tài chính   0/3
```

Mẫu số của từng bước chỉ bao gồm các nhà thầu **thực sự cần đánh giá bước đó** theo rule nghiệp vụ hiện tại.

Ví dụ:

```text
20 nhà thầu ban đầu
5 nhà thầu Không đạt Hợp lệ
=> Năng lực có denominator = 15

7/15 nhà thầu Không đạt Năng lực
=> chỉ các nhà thầu đủ điều kiện mới đi tiếp Kỹ thuật
```

Không được coi các bước bị khóa do upstream failure là “chưa làm”.

Chúng phải được coi là:

```text
NOT_APPLICABLE / RESOLVED_BY_UPSTREAM
```

### 12.4.3. Công thức % tổng thể

Để % tổng thể không bị sai khi nhà thầu bị loại ở bước trước, dùng khái niệm **resolved work**.

Mỗi nhà thầu có tập các bước đánh giá tiềm năng theo cấu hình gói thầu.

Một bước được coi là `resolved` khi:

1. người dùng đã nhập một kết quả hợp lệ cho bước đó; hoặc
2. bước đó không còn áp dụng vì một bước upstream đã kết luận nhà thầu không được đi tiếp.

Gợi ý:

```text
overallPercent =
  resolvedEvaluationSlots / potentialEvaluationSlots * 100
```

Trong đó:

- `potentialEvaluationSlots`: tổng số bước đánh giá tiềm năng của các nhà thầu trong scope hiện tại;
- `resolvedEvaluationSlots`: số bước đã có kết quả hợp lệ + số bước downstream đã trở thành N/A do kết luận upstream.

Mục tiêu:

- tiến độ phản ánh đúng lượng công việc còn lại;
- nhà thầu bị loại sớm không khiến progress mãi thấp vì các bước sau không bao giờ cần làm;
- không tính một ô trống chưa đủ điều kiện là đã hoàn thành;
- kết quả phải deterministic và test được.

Nếu codebase có business rule đặc thù khiến công thức trên chưa phù hợp ở một workflow, Codex phải giữ cùng nguyên tắc “resolved work” và ghi rõ công thức thực tế trong báo cáo triển khai.

### 12.4.4. Trạng thái theo từng nhà thầu/bước

Nên derive từ dữ liệu hiện tại, không cần thêm DB column nếu không cần thiết:

```text
NOT_STARTED
IN_PROGRESS
COMPLETED
NOT_APPLICABLE
```

Không persist progress percentage như source of truth nếu có thể tính lại từ dữ liệu đánh giá.

Progress là **derived UI state**.

### 12.4.5. Phần lô

Với gói phân lô, progress phải tính theo **scope phần lô đang xem/chọn**, không cộng lẫn các lô ngoài scope.

Ví dụ:

```text
Lô 01, 02 — Tiến độ 45%
Hợp lệ 10/10 · Năng lực 7/10 · Kỹ thuật 2/7
```

Khi đổi scope phần lô:

- progress phải recompute;
- không làm thay đổi dữ liệu;
- không finalize batch;
- không dùng progress để suy ra package lifecycle.

Có thể bổ sung progress tổng của toàn gói nếu UI hiện có vị trí phù hợp, nhưng không bắt buộc. Progress của scope hiện tại là bắt buộc.

### 12.4.6. 1G2T

Tách progress theo vòng.

Ví dụ vòng kỹ thuật:

```text
Hồ sơ kỹ thuật — 65%
Hợp lệ 20/20 · Năng lực 18/20 · Kỹ thuật 11/18
```

Khi kỹ thuật chưa hoàn thành:

- Financial vẫn locked theo rule hiện tại;
- progress kỹ thuật không được dùng để unlock Financial.

Sau khi technical hoàn thành, vòng Financial có progress riêng:

```text
Hồ sơ tài chính — 30%
Tài chính 3/10 · Xếp hạng 0/10
```

Các bước thực tế phải dựa trên workflow hiện hành, không hard-code field không tồn tại.

### 12.4.7. Báo cáo chi tiết

Với báo cáo chi tiết, progress nên dựa trên các tiêu chí bắt buộc/applicable trong group hoặc round đang xem.

Nguyên tắc:

```text
completed/applicable criteria
```

Các tiêu chí bị vô hiệu hóa bởi hierarchy/upstream result phải là `NOT_APPLICABLE`, không phải “chưa làm”.

Không được persist % vào report nếu có thể derive lại từ criteria results.

### 12.4.8. Hiệu năng

Không được mỗi lần gõ một ký tự lại scan/recalculate toàn bộ ứng dụng.

Có thể:

- chỉ recompute progress của current package/scope;
- debounce cập nhật visual nếu cần;
- dùng dữ liệu row hiện có;
- tránh server call chỉ để tính progress.

Thanh progress phải cập nhật gần realtime khi người dùng thay đổi các lựa chọn đánh giá, nhưng đây chỉ là UI-derived state và không được tạo server mutation riêng.

---

## 12.5. Accessibility

Phần UI mới phải:

- có `aria-label`/`aria-disabled` phù hợp;
- keyboard accessible;
- focus không bị mất sau save;
- error focus vào control lỗi;
- không chỉ dựa vào màu sắc để biểu thị trạng thái;
- không làm giảm khả năng dùng trên màn hình nhỏ.

---

# 13. Phần lô

Phải nghiên cứu kỹ trước khi sửa:

```text
frontend/packages/lotEvaluationScope.js
frontend/packages/BidEvaluationLotScopeController.js
frontend/packages/bidEvaluationActions.js
```

Hệ thống hiện có official lot batch lifecycle như ACTIVE/FINAL/CLOSED.

Yêu cầu:

- “Lưu nháp” không được finalize batch.
- Không tạo history entry như một đợt đánh giá đã hoàn thành nếu nghiệp vụ không yêu cầu.
- Không đánh dấu phần lô completed.
- Không làm `resolvePackageResultStatus()` hiểu nhầm rằng đã có kết quả một phần.
- Khi quay lại phải khôi phục đúng scope phần lô.
- Nếu draft cần batch identity để gắn scope, phải dùng trạng thái draft/active phù hợp và không làm sai official history.
- Nếu `ensureEvaluationLotBatch()` hiện tạo official batch quá sớm, Codex phải refactor để tách:
  - draft scope identity;
  - official/final evaluation batch.
- Không tự tạo schema mới trước khi hiểu rõ lifecycle hiện tại.

---

# 14. 1G2T

Phải kiểm thử riêng.

### Kỹ thuật đang draft

```text
technical.saved === false
round = draft
```

Financial:

```text
disabled/locked
```

### Kỹ thuật hoàn thành

```text
technical.saved === true
round = completed
```

Financial mới được mở theo rule hiện có.

### Financial draft

Tương tự:

```text
financial.saved === false
```

Không tạo kết quả cuối cùng.

---

# 15. Báo cáo chi tiết

Hiện tại code đã có draft workflow.

Cần:

1. Giữ toàn bộ behavior đang hoạt động.
2. Đánh giá khả năng generalize `DraftAutosaveStore`.
3. Tránh duplicate code giữa tổng quát và chi tiết.
4. Không làm báo cáo chi tiết tự động “completed” khi chỉ autosave.
5. Khi server persist thành công mới clear local pending recovery draft.
6. Khi completion của báo cáo chi tiết cập nhật projection sang báo cáo tổng quát, giữ behavior hiện có.
7. Draft chi tiết không được vô tình cập nhật projection tổng quát như một kết quả chính thức.

---

# 16. Concurrency / stale data

Đây là phần bắt buộc.

Tình huống:

```text
Tab A mở báo cáo.
Tab B mở cùng báo cáo.

Tab A sửa Hợp lệ.
Tab B sửa Kỹ thuật.

Tab A lưu nháp.
Tab B lưu nháp.
```

Không được để Tab B gửi toàn bộ snapshot cũ và ghi đè Hợp lệ của Tab A.

Giải pháp ưu tiên:

- dirty field/dirty record payload;
- expected version/row version nếu persistence layer hỗ trợ;
- refresh authoritative boundary theo cơ chế hiện có;
- conflict handling theo sync architecture hiện tại.

Nghiên cứu:

```text
frontend/shared/MutationService.js
model.beginWorkspaceMutation()
persistChanges()
commitLocalMutation()
awaitAuthoritativeMutationBoundary()
sync/outbox/conflict handling
```

Không tạo một cơ chế concurrency độc lập nếu nền tảng hiện tại đã có.

---

# 17. Offline behavior

Nếu đang offline:

- local autosave vẫn phải bảo vệ dữ liệu;
- nút Lưu nháp không được giả vờ server save thành công;
- phải hiển thị trạng thái pending sync phù hợp với pattern hiện tại;
- không xóa local recovery draft;
- khi sync thành công mới cập nhật trạng thái.

Không được silent data loss.

---

# 18. Các file cần ưu tiên nghiên cứu

Ít nhất phải đọc kỹ:

```text
frontend/packages/bidEvaluationActions.js
frontend/packages/BidEvaluationPanelController.js
frontend/packages/BidEvaluationPanelState.js
frontend/packages/BidEvaluationWorkflow.js
frontend/packages/BidEvaluationRowRenderer.js
frontend/packages/BidEvaluationLotScopeController.js
frontend/packages/lotEvaluationScope.js
frontend/packages/evaluationMetadata.js
frontend/packages/bidEvaluationValidation.js
frontend/packages/evaluationMethodRules.js

frontend/packages/DetailedEvaluationDraftAutosave.js
frontend/packages/DetailedEvaluationSaveWorkflow.js
frontend/packages/DetailedEvaluationState.js
frontend/packages/DetailedEvaluationPanelController.js
frontend/packages/detailedEvaluationValidation.js

frontend/shared/MutationService.js

backend/sync/evaluation_persistence.py
backend/sync/bid_evaluation_rules.py
backend sync mapper / serializer / payload validation liên quan

tests/js/*
tests/*evaluation*
scripts/verify_*evaluation*
```

Tên file test thực tế có thể khác. Phải search repo trước khi tạo test mới.

---

# 19. Kế hoạch triển khai theo phase

## Phase 0 — Khảo sát

- Trace đầy đủ luồng render -> collect -> validate -> stage mutation -> persist -> sync -> rerender.
- Trace general evaluation.
- Trace detailed evaluation.
- Trace lot evaluation.
- Trace 1G2T.
- Trace offline sync.
- Xác định các dữ liệu nào là:
  - source of truth;
  - derived projection;
  - local recovery state;
  - official workflow state.

Không code trước khi hoàn thành trace.

---

## Phase 1 — Tách save mode

Refactor tổng quát:

```text
saveDanhGiaHsdt({ mode })
```

Tách:

```text
DRAFT
COMPLETE
```

Giữ compatibility với caller hiện tại nếu cần.

---

## Phase 2 — Validation

Tạo validation draft:

- empty accepted;
- entered value must be valid.

Completion giữ validation hiện tại.

Thêm unit tests.

---

## Phase 3 — Dirty tracking + partial persistence

- track dirty field;
- collect minimal changes;
- persist only modified bidder records;
- clear only after success;
- preserve on failure.

---

## Phase 4 — Server draft metadata

- `saved = false`;
- round `draft`;
- không completion timestamp;
- metadata form fields có thể chưa đầy đủ.

Không finalize lifecycle.

---

## Phase 5 — UI action

Bổ sung Lưu nháp bằng existing design system.

Primary:

```text
Hoàn thành báo cáo đánh giá
```

Secondary:

```text
Lưu nháp
```

Không thay layout ngoài mức tối thiểu.

---

## Phase 6 — General autosave local recovery

Generalize DraftAutosaveStore nếu hợp lý.

Scope key phải tránh collision:

```text
organization/workspace
package
round
lot scope
bidder/report context
```

Không leak draft giữa workspace/user/package.

---

## Phase 7 — Lot + 1G2T hardening

Viết test riêng cho:

- no-lot;
- multi-lot;
- partial lot;
- all remaining lots;
- technical 1G2T draft;
- technical completion;
- financial draft.

---

## Phase 8 — Concurrency / offline

Test stale snapshot và offline recovery.

---

## Phase 9 — Regression

Chạy toàn bộ suite và build/security checks phù hợp.

---

# 20. Acceptance Criteria

## AC01

Có nút **Lưu nháp** tại Báo cáo đánh giá tổng quát khi người dùng đang ở mode cho phép chỉnh sửa.

## AC02

Người dùng chỉ đánh giá Hợp lệ của 1/100 nhà thầu vẫn lưu nháp được.

## AC03

Người dùng đánh giá Hợp lệ cho 100 nhà thầu nhưng chưa làm Năng lực vẫn lưu nháp được.

## AC04

Số báo cáo và Ngày báo cáo có thể để trống khi lưu nháp.

## AC05

Số báo cáo và Ngày báo cáo vẫn bắt buộc khi Hoàn thành nếu rule hiện tại yêu cầu.

## AC06

Trường trống được phép ở draft; trường đã nhập sai format bị báo lỗi.

## AC07

Reload/mở lại báo cáo khôi phục dữ liệu server draft chính xác.

## AC08

Crash/reload trước server save có local recovery phù hợp.

## AC09

Lưu nháp không tự chuyển sang tab Kết quả.

## AC10

Lưu nháp không thay đổi package sang “Đã có kết quả”.

## AC11

Lưu nháp không tạo official ranking/award.

## AC12

Lưu nháp kỹ thuật 1G2T không mở financial.

## AC13

Hoàn thành kỹ thuật 1G2T vẫn mở financial theo logic hiện tại.

## AC14

Draft phần lô không đánh dấu lô completed/final.

## AC15

Draft của một phần lô không làm mất draft phần lô khác.

## AC16

Sửa một field không ghi đè field khác vừa được một tab khác cập nhật, trong phạm vi conflict model của hệ thống.

## AC17

Server save thất bại không làm UI báo “Đã lưu nháp” sai.

## AC18

Server save thất bại không xóa local recovery draft.

## AC19

Existing detailed evaluation draft vẫn hoạt động.

## AC20

Completion của báo cáo chi tiết vẫn update general projection đúng như trước.

## AC21

Không thay đổi thứ tự cột/table và layout tổng thể.

## AC22

Không tạo global CSS gây side effects.

## AC23

Không làm regression import/export Excel của scope đánh giá.

## AC24

Không làm regression package lifecycle/versioning.

## AC25

Thanh tiến trình hiển thị % tổng thể và breakdown theo các bước đánh giá mà không làm thay đổi layout/table hiện tại.

## AC26

Màu fill của thanh tiến trình chuyển theo tỷ lệ hoàn thành dưới dạng gradient từ vùng đỏ/cam ở tiến độ thấp sang vàng và xanh ở tiến độ cao; 0% dùng neutral/empty.

## AC27

Nhà thầu bị loại ở bước upstream không làm các bước downstream bị tính sai thành “chưa hoàn thành”; các bước đó được xử lý như NOT_APPLICABLE/RESOLVED.

## AC28

Progress của gói phân lô chỉ tính trên scope phần lô đang xem/chọn.

## AC29

Progress Technical/Financial của 1G2T độc lập và progress không được sử dụng để bypass điều kiện unlock workflow.

## AC30

Progress là derived UI state, không tạo server mutation hoặc lưu % như source of truth nếu không cần thiết.

## AC31

Test suite và build/security checks liên quan pass.

---

# PHẦN II — PROMPT DÀNH CHO CODEX

Sao chép toàn bộ phần dưới đây và đưa cho Codex.

---

## PROMPT

Bạn đang làm việc trực tiếp trên repository:

```text
https://github.com/newstar94/Bidding
```

Hãy triển khai hoàn chỉnh chức năng **LƯU NHÁP BÁO CÁO ĐÁNH GIÁ** cho BiddingFlow.

### QUY TẮC SỐ 1 — PHẢI NGHIÊN CỨU CODE TRƯỚC KHI SỬA

Không được đoán kiến trúc.

Trước khi code, hãy đọc và trace đầy đủ các luồng liên quan, tối thiểu:

```text
frontend/packages/bidEvaluationActions.js
frontend/packages/BidEvaluationPanelController.js
frontend/packages/BidEvaluationPanelState.js
frontend/packages/BidEvaluationWorkflow.js
frontend/packages/BidEvaluationRowRenderer.js
frontend/packages/BidEvaluationLotScopeController.js
frontend/packages/lotEvaluationScope.js
frontend/packages/evaluationMetadata.js
frontend/packages/bidEvaluationValidation.js
frontend/packages/evaluationMethodRules.js

frontend/packages/DetailedEvaluationDraftAutosave.js
frontend/packages/DetailedEvaluationSaveWorkflow.js
frontend/packages/DetailedEvaluationState.js
frontend/packages/DetailedEvaluationPanelController.js
frontend/packages/detailedEvaluationValidation.js

frontend/shared/MutationService.js

backend/sync/evaluation_persistence.py
backend/sync/bid_evaluation_rules.py
các mapper/serializer/payload validation/sync writer liên quan

tests/
scripts/
```

Hãy tự search repo để tìm thêm mọi caller/callee, test, CSS/template và lifecycle rule liên quan.

Trước khi sửa, hãy ghi ngắn gọn trong phần output của bạn:

```text
1. Source of truth hiện tại.
2. General evaluation save flow hiện tại.
3. Detailed evaluation draft flow hiện tại.
4. Lot evaluation lifecycle hiện tại.
5. 1G2T locking rule hiện tại.
6. Sync/concurrency mechanism hiện tại.
7. Những file dự kiến sửa và lý do.
```

Sau đó mới triển khai.

---

## MỤC TIÊU NGHIỆP VỤ

Người dùng có thể có rất nhiều nhà thầu và không đánh giá hoàn chỉnh từng nhà thầu từ đầu đến cuối.

Ví dụ:

```text
Ngày 1:
Đánh giá Tính hợp lệ cho toàn bộ 50 nhà thầu.

Ngày 2:
Đánh giá Năng lực cho 15 nhà thầu.

Ngày 3:
Làm tiếp Năng lực cho các nhà thầu còn lại.

Ngày 4:
Bắt đầu Kỹ thuật.
```

Hệ thống phải cho phép lưu lại ở bất kỳ trạng thái dở dang hợp lệ nào và hôm sau mở lại làm tiếp.

Áp dụng cho:

```text
1. Báo cáo đánh giá tổng quát.
2. Báo cáo đánh giá chi tiết.
3. Gói không phân lô.
4. Gói phân lô.
5. Một giai đoạn một túi hồ sơ.
6. Một giai đoạn hai túi hồ sơ.
```

---

## YÊU CẦU CỐT LÕI

### A. Hai hành động độc lập

Phải có:

```text
Lưu nháp
Hoàn thành báo cáo đánh giá
```

`Lưu nháp` KHÔNG đồng nghĩa với `Hoàn thành`.

---

### B. Refactor saveDanhGiaHsdt

Refactor luồng tổng quát hiện tại để hỗ trợ mode rõ ràng.

Ưu tiên:

```js
saveDanhGiaHsdt({ mode: "draft" })
saveDanhGiaHsdt({ mode: "complete" })
```

Không copy nguyên hàm thành hai phiên bản gần giống nhau.

Hãy tách helper hợp lý để complexity giảm thay vì tăng.

---

### C. Draft validation

Khi draft:

```text
trống => được phép
đã nhập nhưng sai => không được phép
```

Ví dụ:

```text
Kỹ thuật = ""
=> save draft OK

Kỹ thuật = "abc"
=> validation error

Kỹ thuật = "82.5"
=> save draft OK
```

Không bắt buộc hoàn thành tất cả nhà thầu.

Không bắt buộc `soBaoCao`, `ngayBaoCao` khi draft.

Không làm yếu validation của completion.

---

### D. Partial evaluation theo từng field

Người dùng phải được phép dừng ở:

```text
Hợp lệ
```

hoặc:

```text
Hợp lệ + Năng lực
```

hoặc:

```text
Hợp lệ + Năng lực + một phần Kỹ thuật
```

Không được yêu cầu hoàn thành toàn bộ một nhà thầu mới lưu.

---

### E. Dirty field / dirty row persistence

Không gửi lại toàn bộ bảng nếu chỉ một số ô thay đổi.

Nghiên cứu backend hiện tại:

```text
save_bid_evaluation_result(...)
```

và conditional UPSERT theo key presence.

Hãy tận dụng cơ chế đó.

Mục tiêu:

```js
{
  id: bidId,
  danhGiaKyThuat: "82"
}
```

thay vì snapshot đầy đủ nếu chỉ field đó thay đổi.

Phải tránh stale overwrite.

Nếu frontend persistence pipeline bắt buộc phải có thêm identity/version fields, chỉ bổ sung đúng những field cần thiết.

---

### F. Server draft

Khi bấm Lưu nháp:

```text
saved = false
round = draft
hoanThanhLuc = null
```

hoặc semantics tương đương với schema hiện tại.

Không được:

```text
saved = true
completed
FINAL
CLOSED
```

---

### G. Completion

Khi hoàn thành:

Giữ toàn bộ validation/business workflow hiện tại.

Chỉ completion mới được:

```text
saved = true
completed
hoanThanhLuc = now
official ranking
official result
workflow transition
```

---

## UI/UX — BẮT BUỘC GIỮ NGUYÊN GIAO DIỆN HIỆN TẠI

Đây là yêu cầu quan trọng nhất về frontend.

### KHÔNG ĐƯỢC REDESIGN.

Không thay đổi tổng thể:

```text
layout
table
columns
tabs
navigation
font
color palette
spacing system
form structure
modal style
responsive structure
route CSS architecture
design tokens
```

Không được tự tiện “modernize” toàn màn hình.

Mọi phần UI mới phải **đồng bộ tuyệt đối với style hiện tại**.

### Nút

Trong edit/save mode hiển thị:

```text
[Lưu nháp] [Hoàn thành báo cáo đánh giá]
```

Yêu cầu:

- tái sử dụng class button hiện có;
- secondary visual cho Lưu nháp;
- primary visual cho Hoàn thành;
- dùng Lucide/icon mechanism hiện tại;
- không tạo design system mới;
- không làm toolbar đổi chiều cao đáng kể;
- không thay các nút khác ngoài phạm vi cần thiết.

Nếu DOM/template hiện tại chỉ có một button slot, hãy sửa tối thiểu template/controller để bổ sung secondary action, không viết lại panel.

### Feedback

Lưu nháp thành công:

```text
Đã lưu nháp
```

có thể thêm thời gian:

```text
Đã lưu nháp lúc 14:32
```

Dùng toast/status pattern hiện có.

Không mở modal xác nhận khi save draft thành công.

Error vẫn sử dụng error UX pattern hiện tại.

### Accessibility

- keyboard usable;
- aria state đúng;
- focus error đúng field;
- save không đẩy scroll lên đầu;
- save không làm mất vị trí người dùng;
- không chỉ dùng màu để biểu diễn status.

---

## LOCAL AUTOSAVE

Báo cáo chi tiết hiện có:

```text
DetailedEvaluationDraftAutosave.js
DraftAutosaveStore
```

Hãy đánh giá để generalize cho báo cáo tổng quát thay vì copy/paste.

Mục tiêu local autosave:

```text
crash recovery
reload recovery
browser close recovery
temporary offline protection
```

Không được coi localStorage là official server source of truth.

Key phải đủ scope để không collision giữa:

```text
workspace / organization
package
round
lot/batch
report/bidder context
```

Không được restore draft của workspace khác.

---

## SERVER SAVE vs LOCAL AUTOSAVE

Luồng mong muốn:

```text
user edits
   ↓
local recovery autosave
   ↓
user presses Lưu nháp
   ↓
server persist + sync
   ↓
success
   ↓
clear/mark local pending recovery state
```

Nếu server thất bại:

```text
do NOT clear local recovery
do NOT show server save success
keep dirty state
```

---

## PHẦN LÔ

Phải nghiên cứu kỹ:

```text
lotEvaluationScope.js
BidEvaluationLotScopeController.js
ensureEvaluationLotBatch()
saveEvaluationScopeMetadata()
getOfficialEvaluationLotState()
resolvePackageResultStatus()
```

Đặc biệt chú ý:

```text
ACTIVE
FINAL
CLOSED
saved
result.saved
completedLotIds
history
```

### Draft không phải official lot completion

Khi lưu nháp:

- không finalize batch;
- không đánh dấu lô completed;
- không đưa batch vào official completed history sai nghĩa;
- không làm package thành “Đã có kết quả một phần” chỉ vì có draft;
- không chuyển package sang “Đã có kết quả”.

Nếu current `ensureEvaluationLotBatch()` tạo official batch quá sớm cho draft, hãy tách draft scope khỏi official batch lifecycle một cách backward-compatible.

Không tạo migration tùy tiện.

---

## 1G2T

Phải giữ invariant:

```text
technical draft:
technical.saved = false

=> financial locked
```

Chỉ khi technical hoàn thành:

```text
technical.saved = true

=> financial có thể mở theo rule hiện tại
```

Financial draft cũng:

```text
financial.saved = false
```

và không được tạo final result.

---

## DEPENDENCY BETWEEN EVALUATION STEPS

Giữ business dependency hiện tại.

Ví dụ:

```text
Hợp lệ != Đạt
=> Năng lực bị khóa
=> Kỹ thuật bị khóa
```

```text
Hợp lệ = Đạt
Năng lực != Đạt
=> Kỹ thuật bị khóa
```

Lưu nháp không được bypass dependency.

Nếu thay field upstream khiến field downstream không còn hợp lệ:

- clear hoặc invalidate theo rule hiện tại;
- persist sự thay đổi cần thiết;
- không để stale hidden value tồn tại và được tính lại thành kết quả sau này.

---

## DRAFT KHÔNG ĐƯỢC TẠO OFFICIAL CONCLUSION/RANKING

Có thể render preview nếu UI hiện tại cần.

Nhưng khi draft, không được sử dụng preview để:

```text
unlock next step
rank officially
declare winner
create award
finalize lot
complete round
update package result lifecycle
```

Hãy tách rõ:

```text
user-entered draft data
derived UI preview
official completion projection
```

---

## CONCURRENCY

Hãy kiểm tra và bảo vệ tình huống:

```text
Tab A và Tab B cùng mở một báo cáo.
Tab A sửa Hợp lệ.
Tab B sửa Kỹ thuật.
A save.
B save.
```

B không được ghi đè lại Hợp lệ bằng snapshot stale nếu B không sửa Hợp lệ.

Ưu tiên:

```text
dirty-field payload
row version / expected version
existing mutation boundary
existing outbox/conflict mechanism
```

Nghiên cứu và tái sử dụng:

```text
frontend/shared/MutationService.js
awaitAuthoritativeMutationBoundary()
beginWorkspaceMutation()
persistChanges()
commitLocalMutation()
outbox
sync conflict handling
```

Không tạo một cơ chế concurrency song song mới nếu codebase đã có.

---

## OFFLINE

Nếu offline:

- local recovery vẫn hoạt động;
- không nói “Đã lưu nháp trên máy chủ” khi chưa sync;
- giữ pending state;
- không xóa recovery data;
- khi reconnect sử dụng sync architecture hiện có;
- tránh duplicate mutation.

---

# PROGRESS INDICATOR — BẮT BUỘC

Hãy triển khai một thanh tiến trình đánh giá compact, đặt gần header/bảng đánh giá mà **không redesign hoặc làm thay đổi cấu trúc table**.

Ví dụ:

```text
Tiến độ đánh giá                                      31%
████████░░░░░░░░░░░░░░░░░░

Hợp lệ 20/20 · Năng lực 8/15 · Kỹ thuật 3/8
```

## Gradient màu theo %

Thanh fill phải đổi màu theo tỷ lệ hoàn thành dưới dạng **gradient động**:

```text
0%        neutral/empty
1–25%     đỏ -> cam đỏ
26–50%    cam -> vàng
51–75%    vàng -> xanh non
76–99%    xanh non -> xanh lá
100%      xanh lá hoàn thành
```

Ưu tiên continuous mapping:

```text
hue = clamp(percent, 0, 100) * 1.2
```

tương ứng:

```text
0%   ≈ red
50%  ≈ yellow
100% ≈ green
```

Có thể dùng CSS custom property + scoped gradient hoặc JS tính màu nếu phù hợp kiến trúc hiện tại.

Không hard-code style global.

Không thay đổi palette của ứng dụng.

Progress vẫn phải có text `%` để accessibility không phụ thuộc màu.

`0%` dùng neutral track, không hiển thị đỏ như lỗi.

## Tính tiến độ

Không tính theo số nhà thầu hoàn thành toàn bộ.

Per-stage denominator phải dựa trên bidder thực sự applicable:

```text
Hợp lệ:
all bidders in current scope

Năng lực:
chỉ bidder đã Đạt Hợp lệ và workflow yêu cầu bước này

Kỹ thuật:
chỉ bidder đủ điều kiện từ các bước trước

Tài chính:
chỉ bidder đủ điều kiện tài chính theo workflow/1G2T
```

Các bước downstream bị khóa vì nhà thầu đã fail upstream phải được coi là:

```text
NOT_APPLICABLE / RESOLVED_BY_UPSTREAM
```

không phải pending.

## Overall percentage

Dùng nguyên tắc resolved work:

```text
overallPercent =
  resolvedEvaluationSlots / potentialEvaluationSlots * 100
```

`resolvedEvaluationSlots` gồm:

- bước đã có giá trị/kết quả hợp lệ;
- bước downstream đã trở thành không áp dụng do upstream failure.

`potentialEvaluationSlots` là toàn bộ bước đánh giá tiềm năng theo cấu hình workflow đối với bidder trong scope.

Không persist percentage làm source of truth.

Hãy tạo pure helper có test để derive progress từ dữ liệu đánh giá hiện tại.

## Lot scope

Progress phải tính theo phần lô đang chọn/xem.

Đổi lot scope phải recompute progress nhưng:

```text
không persist
không finalize
không thay lifecycle
```

## 1G2T

Technical và Financial có progress độc lập.

Technical progress không được unlock Financial.

Financial chỉ unlock theo official completion rule hiện tại.

## Detailed evaluation

Progress của báo cáo chi tiết dựa trên:

```text
completed required/applicable criteria
/
required/applicable criteria
```

và tôn trọng hierarchy/NOT_APPLICABLE.

## Performance

Không server call chỉ để tính progress.

Không tạo mutation khi progress thay đổi.

Không scan toàn app trên mỗi keystroke.

Recompute current package/scope; debounce visual update nếu cần.

---

# KHÔNG TẠO BẢNG DRAFT MỚI TRỪ KHI THỰC SỰ BẮT BUỘC

Backend hiện có normalized persistence và round `draft/completed`.

Không được mặc định tạo:

```text
evaluation_drafts
report_draft_json
draft_blob
```

Nếu bạn xác định cần migration mới, trước khi thực hiện hãy chứng minh:

1. Dữ liệu hiện tại không biểu diễn được yêu cầu nào.
2. Vì sao không thể dùng `vong_danh_gia` + `ket_qua_danh_gia_nha_thau`.
3. Migration backward-compatible thế nào.
4. Rollback thế nào.

Nếu không có lý do mạnh, không tạo bảng mới.

---

# TEST BẮT BUỘC

Hãy search test convention hiện tại và thêm test tại đúng vị trí.

Ít nhất phải có các case sau.

## General

```text
1. draft with only valid evaluation.
2. draft with evaluation + capacity.
3. draft with only some contractors.
4. draft with empty report number/date.
5. invalid non-empty score rejected in draft.
6. valid score accepted.
7. complete still requires official fields.
8. draft does not navigate to result.
9. draft does not set saved=true.
10. draft does not mark package completed.
```

## Dirty update

```text
11. editing one field persists only intended field/record.
12. untouched evaluation fields survive.
13. failed persist keeps dirty state.
14. successful persist clears dirty state.
```

## Dependency

```text
15. changing Hợp lệ from Đạt -> Không đạt invalidates downstream correctly.
16. changing Năng lực -> Không đạt invalidates technical correctly.
```

## Lot

```text
17. draft one lot.
18. reopen same lot draft.
19. draft multiple selected lots.
20. draft does not mark lot FINAL.
21. draft does not add completed lot.
22. draft does not change package to partial result.
23. completing lot keeps old official behavior.
```

## 1G2T

```text
24. technical draft keeps financial locked.
25. technical completion unlock behavior unchanged.
26. financial draft does not finalize result.
```

## Detailed evaluation

```text
27. existing detailed local autosave still works.
28. existing detailed server draft still works.
29. detailed draft does not update official general projection.
30. detailed completion still updates projection.
```

## Recovery/offline

```text
31. local recovery after reload.
32. server failure does not clear local recovery.
33. pending server sync status handled.
```

## Concurrency

```text
34. stale tab does not overwrite unrelated field where architecture supports field-level update.
```

## Progress

```text
35. 0% renders empty/neutral progress state.
36. low percentage uses red/orange gradient range.
37. middle percentage transitions through orange/yellow.
38. high percentage transitions toward green.
39. 100% renders completed green gradient state.
40. percent text matches derived numeric progress.
41. bidder failed at Hợp lệ makes downstream stages NOT_APPLICABLE, not pending.
42. bidder failed at Năng lực makes technical downstream NOT_APPLICABLE.
43. per-stage denominator excludes non-applicable bidders.
44. overall resolved-work percentage is deterministic.
45. lot-scope progress excludes bidders/lots outside current scope.
46. switching lot scope recomputes progress without persistence mutation.
47. technical and financial 1G2T progress are independent.
48. technical progress never unlocks financial by itself.
49. detailed report progress respects required/applicable criteria and hierarchy.
50. progress updates do not cause server mutation.
```

## UI

```text
51. draft button visible only in valid edit/save mode.
52. draft button hidden/disabled in read-only/locked status.
53. completion button behavior unchanged.
54. keyboard accessibility.
55. no duplicate event handler after rerender.
56. progress component has accessible percent/status text and does not rely on color alone.
57. progress component does not alter existing table column order/layout.
```

---

# REGRESSION TESTING

Phải chạy các command phù hợp với repository.

Tối thiểu:

```bash
npm run test:js
```

Các Python test liên quan evaluation/sync.

Sau đó nếu môi trường cho phép:

```bash
npm run check:static
npm run lint:security
npm test
npm run build:secure
```

Nếu full suite quá nặng hoặc có failure unrelated, hãy:

- chạy test target trước;
- chạy rộng dần;
- báo chính xác command;
- báo pass/fail;
- không giấu lỗi.

Ngoài unit tests, nếu có test Playwright/E2E phù hợp hãy thêm hoặc cập nhật smoke test cho luồng save draft.

---

# QUALITY REQUIREMENTS

Không chấp nhận:

```text
copy/paste large functions
global mutable hacks
unscoped localStorage key
giant JSON draft blob
silent catch
swallow sync errors
setTimeout-based fake sync success
full-table persist for one changed field without reason
redesign UI
global CSS side effect
bypass lifecycle rules
bypass permission rules
```

Ưu tiên:

```text
small pure helpers
explicit save mode
minimal mutations
existing persistence architecture
existing design system
existing lifecycle policy
existing permission checks
unit tests
E2E regression
```

---

# PERMISSION / SECURITY

Lưu nháp không được bypass quyền.

Người dùng chỉ được lưu nháp nếu hiện tại họ có quyền sửa báo cáo tương ứng.

Read-only/locked package:

```text
không được save draft
```

Không tạo API mới cho phép update evaluation ngoài authorization boundary hiện có.

Không trust client để thay đổi organization/workspace/package identity.

Nếu backend persistence hiện có permission boundary thì phải đi qua boundary đó.

---

# BACKWARD COMPATIBILITY

Dữ liệu báo cáo đã lưu trước feature này phải đọc bình thường.

Không làm crash metadata schema cũ.

Nếu bổ sung metadata field:

- optional;
- có default;
- parser cũ/new migration path an toàn;
- không vượt giới hạn metadata hiện tại;
- không lưu danh sách bidder draft khổng lồ vào package metadata.

Bidder evaluation data phải tiếp tục nằm trong normalized bidder evaluation persistence nếu phù hợp.

---

# PERFORMANCE

Giả định có:

```text
100–500 nhà thầu
nhiều phần lô
nhiều field
```

Không được mỗi keystroke:

```text
persist full table to server
rerender full app
recalculate all package lifecycle unnecessarily
```

Local debounce autosave có thể dùng.

Server save ưu tiên explicit user action `Lưu nháp`.

Nếu thêm background server autosave thì phải chứng minh không tạo mutation storm; mặc định không cần.

---

# OUTPUT SAU KHI HOÀN THÀNH

Sau khi code xong, trả về báo cáo theo format:

```markdown
## 1. Kiến trúc đã xác nhận

## 2. Thay đổi đã thực hiện
- file
- thay đổi
- lý do

## 3. Luồng Lưu nháp mới

## 4. Luồng Hoàn thành

## 5. Phần lô

## 6. 1G2T

## 7. Báo cáo chi tiết

## 8. Concurrency / offline

## 9. UI/UX
Xác nhận cụ thể rằng không redesign hoặc phá layout hiện tại.

## 10. Tests
- command
- result

## 11. Files changed

## 12. Những rủi ro/công việc còn lại
```

Nếu phát hiện kiến trúc hiện tại khiến một yêu cầu trong prompt có nguy cơ phá dữ liệu hoặc lifecycle, **không được âm thầm chọn giải pháp khác**. Hãy ghi rõ vấn đề, chọn giải pháp backward-compatible an toàn nhất, implement phần chắc chắn và giải thích trade-off.

---

# DEFINITION OF DONE

Feature chỉ được coi là hoàn thành khi:

1. Báo cáo tổng quát lưu nháp được ở từng phần đánh giá.
2. Không cần hoàn thành một nhà thầu.
3. Không cần hoàn thành tất cả nhà thầu.
4. Có server-persisted draft.
5. Có local recovery hợp lý.
6. Draft không kích hoạt official workflow.
7. Lot draft không finalize lot.
8. 1G2T draft không mở sai bước.
9. Detailed draft không regression.
10. Partial/dirty persistence không gây stale overwrite ngoài conflict model cho phép.
11. UI mới hòa nhập hoàn toàn với giao diện hiện tại.
12. Không redesign.
13. Không thay đổi table/layout không cần thiết.
14. Thanh tiến trình hiển thị đúng tiến độ theo từng phần đánh giá và scope.
15. Gradient của progress thay đổi theo % hoàn thành, từ vùng đỏ/cam -> vàng -> xanh, 0% neutral.
16. Nhà thầu bị loại ở upstream không làm sai mẫu số hoặc % tiến độ.
17. Progress của phần lô và 1G2T đúng scope/round và không ảnh hưởng lifecycle.
18. Progress là derived UI state, không tạo mutation riêng.
19. Tests liên quan pass.
20. Build/security checks liên quan không regression.

---

**Hãy bắt đầu bằng việc đọc code và trình bày trace kiến trúc. Sau đó thực hiện thay đổi trực tiếp trong repo, viết test và chạy test. Không chỉ đưa ra hướng dẫn lý thuyết.**
