# Nghiên cứu KHLCNT, gói thầu liên kết và phiên bản trên Mua Sắm Công

## Kết luận ngắn

Thời điểm kiểm tra: **2026-08-10, múi giờ Asia/Saigon**.

Phạm vi nguồn: chỉ trang, HTML/JavaScript và endpoint first-party thuộc `muasamcong.mpi.gov.vn`. Không dùng blog, bản tổng hợp của bên thứ ba và không gọi các endpoint chi tiết theo cách bỏ qua reCAPTCHA.

Kết luận cho BiddingFlow:

1. **Có thể tự thêm toàn bộ gói thầu khi thêm KHLCNT.** Trang chi tiết KHLCNT trả về một danh sách gói (`bidpPlanDetailToProjectList`), có số lượng, bảng tổng hợp, tab **Thông tin gói thầu**, và `idDetail` để tải chi tiết từng gói. Đây là cấu trúc nguồn phù hợp để import kế hoạch cùng các gói con trong một giao dịch.
2. **Gói chưa có “Số thông báo liên kết” vẫn có nhiều dữ liệu ở cấp kế hoạch.** Portal hiển thị danh sách/chi tiết như tên, giá, nguồn vốn, lĩnh vực, hình thức/phương thức, hợp đồng, thời gian, địa điểm, phần/lô… Nếu thiếu `linkNotifyInfo`, portal có thể hiển thị **Chưa có TBMT**; tuy nhiên cụm “giai đoạn chuẩn bị” là nhãn nghiệp vụ suy ra, không phải trạng thái chung được portal cam kết cho mọi loại gói.
3. **Có liên kết thì nên enrichment vào đúng gói đã có, không tạo gói trùng.** `Số thông báo liên kết` lấy từ `linkNotifyInfo.notifyNo`. Khi bấm, portal tìm thông báo theo `notifyNo`, ưu tiên loại TBMT (`es-notify-contractor`), rồi thử loại thông báo sơ tuyển/mời quan tâm (`es-pre-notify-contractor`). Vì vậy cần lưu cả `notice_no` và `notice_kind`, không mặc định mọi liên kết đều là TBMT.
4. **Phiên bản KHLCNT và phiên bản TBMT là hai dòng phiên bản độc lập.** KHLCNT dùng `planNo` + `planVersion` + UUID `id`; TBMT dùng `notifyNo` + `notifyVersion` + UUID `id`. Không có bằng chứng primary-source cho quy tắc “KHLCNT tăng 00 → 01 thì TBMT hoặc gói tự động tăng 00 → 01”.
5. **Quy tắc hiện tại của BiddingFlow giữ hai trục phiên bản độc lập.** Khi kế hoạch nội bộ 00 lên 01, hệ thống tạo một row snapshot mới cho gói dưới kế hoạch 01 nhưng giữ nguyên `phienBan` của gói. Gói chỉ tăng 00 → 01 khi có một package-version command riêng; gói mới ở kế hoạch 01 bắt đầu ở 00. Command kế hoạch hiện tại còn sao chép toàn bộ gói nguồn, nên chưa xử lý đúng gói bị loại khỏi revision mới.

## Quy ước mức độ bằng chứng

- **FACT**: thấy trực tiếp trong HTML/JavaScript first-party hoặc response endpoint first-party đã gọi đúng như giao diện.
- **INFERENCE**: kết luận thiết kế hợp lý từ các FACT, nhưng không phải cam kết chính thức của portal.
- **UNKNOWN**: chưa thể chứng minh trong phạm vi public và không vượt CAPTCHA.

## 1. Trang KHLCNT có thể cung cấp cả danh sách gói và chi tiết từng gói

### 1.1. Hai tab và danh sách gói

**FACT.** Trang “Xem thông tin kế hoạch lựa chọn nhà thầu” có hai tab:

- `Thông tin chung`;
- `Thông tin gói thầu`.

Khi mở tab gói thầu, JavaScript gọi:

```text
loadPkgDetail(
  detailKhlcntRes.bidpPlanDetailToProjectList[0].idDetail,
  detailKhlcntRes.bidpPlanDetailToProjectList[0].bidEstimatePrice
)
```

Số lượng gói trên phần thông tin chung chính là:

```text
detailKhlcntRes.bidpPlanDetailToProjectList.length
```

Nguồn: [trang KHLCNT mẫu PL2400239107](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

**FACT.** Bảng danh sách gói ở phần thông tin chung có các trường (tùy phân loại/quy trình mà cột có thể ẩn/hiện):

- tên chủ đầu tư;
- tên gói và tóm tắt công việc chính;
- lĩnh vực;
- giá gói thầu;
- chi tiết nguồn vốn;
- hình thức và phương thức LCNT;
- thời gian tổ chức/bắt đầu LCNT;
- loại hợp đồng;
- thời gian thực hiện hợp đồng/gói thầu;
- tùy chọn mua thêm;
- giám sát hoạt động đấu thầu;
- tình trạng TBMT.

Nguồn: [HTML first-party của PL2400239107, bảng “Danh sách gói thầu”](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

**FACT.** Bảng trong tab **Thông tin gói thầu** có tối thiểu:

```text
STT | Tên gói thầu | Dự toán gói thầu được duyệt sau KHLCNT
    | Giá gói thầu | Số thông báo liên kết
```

Tên từng gói là liên kết gọi `loadPkgDetail(bpd.idDetail, bpd.bidEstimatePrice)`; tức portal có một record chi tiết riêng cho từng dòng gói.

### 1.2. Các trường có ở chi tiết gói cấp KHLCNT

**FACT.** Phần **Thông tin chi tiết gói thầu** sử dụng object `dtlPkgNoList` và hiển thị một tập dữ liệu rộng, gồm:

- chủ đầu tư, quy trình áp dụng, phân loại nguồn vốn;
- tên gói, tóm tắt công việc, dự án liên quan;
- `bidPackageSymbol` — nhãn “Số hiệu gói thầu”;
- qua mạng/không qua mạng, trong nước/nội khối/quốc tế;
- giá gói, dự toán duyệt sau KHLCNT, chi tiết giá/ngoại tệ/tỷ giá;
- lĩnh vực, sơ tuyển, khảo sát sự quan tâm;
- hình thức, phương thức, loại hợp đồng;
- chi tiết nguồn vốn, đấu thầu trước, mua sắm tập trung;
- thời gian tổ chức, thời gian bắt đầu, thời gian thực hiện;
- địa điểm;
- có nhiều phần/lô, tùy chọn mua thêm;
- danh sách phần/lô và các trường chuyên biệt cho hàng hóa/thuốc;
- danh sách ngắn (nếu có);
- lịch sử thay đổi, thông tin hủy và kết quả LCNT (nếu có).

Nguồn: [trang PL2400239107, template chi tiết gói](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

**INFERENCE.** Import KHLCNT không cần đợi có TBMT mới tạo gói. Dữ liệu cấp kế hoạch đã đủ để tạo một bản ghi gói “planned/package-from-plan”; TBMT là lớp enrichment về sau.

## 2. “Số thông báo liên kết”: dữ liệu, điều hướng và trường hợp trống

### 2.1. Trường nguồn

**FACT.** Cột **Số thông báo liên kết** hiển thị:

```text
paseJson(bpd.linkNotifyInfo)?.notifyNo
```

Chỉ render khi `bpd.linkNotifyInfo` tồn tại. Như vậy nguồn thực tế là một giá trị JSON ở `linkNotifyInfo`, trong đó portal lấy trường `notifyNo`.

Nguồn: [trang KHLCNT mẫu, tab “Thông tin gói thầu”](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

### 2.2. Một liên kết không nhất thiết chỉ là TBMT

**FACT.** Hàm click `renderNotifyPage(notifyNo)` của portal thực hiện hai lần tìm kiếm theo mã chính xác:

1. tìm trong index `es-contractor-selection` với type `es-notify-contractor`;
2. nếu không thấy, tìm tiếp type `es-pre-notify-contractor`.

Nếu tìm thấy, trang điều hướng bằng các metadata như `id`, `notifyId`, `notifyNo`, `planNo`, `type`, `stepCode`, `processApply`, `bidMode`, v.v.

Nguồn: [JavaScript first-party nằm trong trang PL2400239107](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

**INFERENCE.** Mô hình dữ liệu của BiddingFlow nên có:

```text
linked_notice_no
linked_notice_kind = TBMT | PRE_NOTIFY | UNKNOWN
linked_notice_external_id = nullable
```

Chỉ notifyNo được chứng minh trực tiếp khi link JSON hợp lệ. kind mặc định UNKNOWN; external ID và revision metadata nullable cho đến khi resolve exact. PRE_NOTIFY chưa có version endpoint được nghiên cứu này xác nhận. Không nên chỉ có một boolean `has_tbmt` nếu muốn bám sát dữ liệu portal.

### 2.3. Khi không có số thông báo liên kết

**FACT.** Trong bảng danh sách gói, với một số hình thức được template kiểm tra trực tiếp (`DTRR`, `CHCT`, `CHCTRG`), portal hiển thị:

```text
!bpd.linkNotifyInfo  -> “Chưa có TBMT”
bpd.linkNotifyInfo   -> “Đã có TBMT”
```

Trong tab **Thông tin gói thầu**, cột **Số thông báo liên kết** để trống khi không có `linkNotifyInfo`.

Nguồn: [template KHLCNT chính thức](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

**FACT.** Không có liên kết không làm mất dữ liệu kế hoạch của gói: các trường nêu tại mục 1.2 vẫn đến từ record chi tiết gói của KHLCNT.

**INFERENCE.** Có thể gán trạng thái nghiệp vụ nội bộ “đang chuẩn bị” nếu đồng thời:

- hình thức/quy trình đó được kỳ vọng phải có TBMT;
- `linkNotifyInfo` chưa có;
- chưa có bằng chứng hủy/kết quả hoặc một loại thông báo khác.

**UNKNOWN.** Portal không cung cấp trong template một trạng thái tổng quát tên “giai đoạn chuẩn bị” cho mọi gói không có link. Vì vậy không nên chuyển thẳng `linkNotifyInfo == null` thành một kết luận pháp lý hoặc trạng thái tuyệt đối.

## 3. TBMT bổ sung dữ liệu gì

**FACT.** Trang TBMT có dữ liệu chi tiết hơn lớp kế hoạch, gồm:

- `notifyNo`, ngày đăng tải, `notifyVersion`;
- mã/phân loại KHLCNT và dự án/dự toán;
- tên gói, chủ đầu tư, bên mời thầu;
- vốn, lĩnh vực, hình thức, phương thức, hợp đồng;
- qua mạng/không qua mạng, trong nước/quốc tế;
- địa điểm phát hành/nhận/mở thầu;
- thời điểm đóng và mở thầu;
- hiệu lực HSDT/báo giá;
- giá trị/tỷ lệ/hình thức bảo đảm dự thầu;
- thông tin quyết định;
- phần/lô;
- lịch sử gia hạn, hủy/khôi phục và các dữ liệu hậu kỳ liên quan khi phát sinh.

Nguồn: [trang TBMT mẫu IB2400040053](https://muasamcong.mpi.gov.vn/vi/web/portaloldv1/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&bidMode=1_MTHS&id=cbd7af22-0469-402b-8583-ec9dc325f533&isInternet=1&notifyId=cbd7af22-0469-402b-8583-ec9dc325f533&notifyNo=IB2400040053&planNo=PL2400020327&processApply=LDT&step=tbmt&stepCode=notify-contractor-step-1-tbmt&type=es-notify-contractor).

**INFERENCE.** Khi có `notifyNo`, nên merge các trường TBMT vào cùng logical package với provenance riêng, ví dụ:

```text
field_value
source_kind = PLAN | NOTICE
source_external_id
source_version
fetched_at
```

Trường thuộc TBMT không nên ghi đè mù lên dữ liệu người dùng hoặc làm mất snapshot KHLCNT. UI nên preview khác biệt và chỉ cập nhật các trường thuộc nguồn Mua Sắm Công.

## 4. Phiên bản KHLCNT

### 4.1. Cách portal biểu diễn

**FACT.** Dropdown **Phiên bản thay đổi** của KHLCNT dùng:

```text
v-model="id"
option.value = v.id
option.label = v.planVersion
on change     = loadDetailKhLcnt()
```

Nghĩa là mỗi phiên bản có một UUID chi tiết riêng, còn `planNo` là mã logical chung.

Nguồn: [trang PL2400213559](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=1005fcf6-c617-462d-8f0c-f50d763ea0f7&planNo=PL2400213559&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

**FACT.** JavaScript gọi version-list không kèm reCAPTCHA:

```http
POST /o/egp-portal-contractor-selection-v2/services/expose/lcnt/
     bid-po-bidp-plan-project-view/get-version-list
Content-Type: application/json

{"planNo":"PL2400213559"}
```

Endpoint: [KHLCNT version-list first-party](https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/expose/lcnt/bid-po-bidp-plan-project-view/get-version-list).

Kết quả kiểm tra ngày 2026-08-10:

```json
{
  "versionList": [
    {"id":"515d4b2d-02d7-4cf1-abb1-a3840c31549c","planNo":"PL2400213559","planVersion":"02"},
    {"id":"8808ea56-b9d0-45e0-be00-6b5fb2adba48","planNo":"PL2400213559","planVersion":"01"},
    {"id":"1005fcf6-c617-462d-8f0c-f50d763ea0f7","planNo":"PL2400213559","planVersion":"00"}
  ]
}
```

Mẫu thứ hai:

```json
{
  "versionList": [
    {"id":"164edf35-7d4c-4a7a-a101-26463ce56b20","planNo":"PL2600163819","planVersion":"01"},
    {"id":"3cb6302c-69b2-488a-84cc-35340c10c549","planNo":"PL2600163819","planVersion":"00"}
  ]
}
```

**FACT.** Frontend có hàm `sortListVersionKH` để sắp theo `planVersion` trước khi hiển thị.

**OBSERVATION.** Gọi cùng endpoint bằng `{"planNo":"PL2600163819-00"}` trả danh sách rỗng, trong khi dùng `PL2600163819` trả 00/01. Đây là bằng chứng ở một mẫu rằng version-list mong mã logical cơ sở; chưa đủ để coi đây là quy tắc tuyệt đối cho mọi phân hệ.

### 4.2. Gói thầu bên trong một phiên bản kế hoạch

**FACT.** Khi đổi dropdown KHLCNT, portal đổi UUID `id`, gọi lại chi tiết kế hoạch và lấy lại toàn bộ `bidpPlanDetailToProjectList`. Do đó mỗi `planVersion` nên được hiểu như một snapshot có danh sách gói riêng.

**FACT.** Trong UI KHLCNT, gói có `idDetail` để mở chi tiết và có thể có `bidPackageSymbol`, nhưng không có một trường “packageVersion” được hiển thị song song với `planVersion`.

**FACT.** Cấp gói có một cơ chế khác tên **Lịch sử thay đổi thông tin**. Template chỉ hiện khi `dtlPkgNoList.correctingPacks.length > 0` và hiển thị:

```text
createdDate | fieldsChange | diffContent[field + "Old"] | diffContent[field]
```

Nguồn: [template chi tiết gói của PL2400239107](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p).

**UNKNOWN.** Không thể khẳng định từ version-list rằng một gói kế thừa giữa kế hoạch 00 và 01 giữ nguyên `idDetail`, nhận UUID mới, hoặc có một parent ID ổn định. Payload chi tiết mỗi phiên bản được bảo vệ bằng reCAPTCHA; nghiên cứu này không gọi vòng qua cơ chế đó.

## 5. Phiên bản TBMT là dòng phiên bản riêng

### 5.1. Cách portal biểu diễn

**FACT.** Dropdown TBMT dùng ID phiên bản làm value và số phiên bản làm label; việc đổi dropdown gọi lại chi tiết TBMT bằng `notifyId`. Trên template, trường hiện tại là `bidoNotifyView.notifyVersion`.

Nguồn: [trang IB2400040053](https://muasamcong.mpi.gov.vn/vi/web/portaloldv1/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&bidMode=1_MTHS&id=cbd7af22-0469-402b-8583-ec9dc325f533&isInternet=1&notifyId=cbd7af22-0469-402b-8583-ec9dc325f533&notifyNo=IB2400040053&planNo=PL2400020327&processApply=LDT&step=tbmt&stepCode=notify-contractor-step-1-tbmt&type=es-notify-contractor).

**FACT.** Version-list TBMT là endpoint riêng:

```http
POST /o/egp-portal-contractor-selection-v2/services/expose/lcnt/
     bid-po-bido-notify-contractor-view/get-version-list
Content-Type: application/json

{"notifyNo":"IB2400040053"}
```

Endpoint: [TBMT version-list first-party](https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/expose/lcnt/bid-po-bido-notify-contractor-view/get-version-list).

Kết quả kiểm tra ngày 2026-08-10:

```json
{
  "versionList": [
    {"id":"cbd7af22-0469-402b-8583-ec9dc325f533","notifyNo":"IB2400040053","notifyVersion":"01"},
    {"id":"dc1cde07-19a2-49a0-8cd2-270c2625c83e","notifyNo":"IB2400040053","notifyVersion":"00"}
  ]
}
```

Một mẫu chỉ có phiên bản đầu:

```json
{
  "versionList": [
    {"id":"952e9129-fc52-476d-86a9-c6b326a1fdf8","notifyNo":"IB2400211941","notifyVersion":"00"}
  ]
}
```

### 5.2. Hệ quả

**FACT.** KHLCNT version-list nhận `planNo` và trả `planVersion`; TBMT version-list nhận `notifyNo` và trả `notifyVersion`. Hai endpoint, hai UUID và hai field phiên bản khác nhau.

**INFERENCE.** Không đồng bộ số phiên bản bằng phép gán:

```text
package_version = planVersion = notifyVersion
```

Ba giá trị có ý nghĩa khác nhau:

- `planVersion`: revision của snapshot KHLCNT;
- `package revision` của BiddingFlow: revision nội bộ theo rule kế thừa của ứng dụng;
- `notifyVersion`: revision độc lập của thông báo liên kết.

Một TBMT có thể lên 01 do sửa/gia hạn mà KHLCNT vẫn ở phiên bản hiện tại. Ngược lại, KHLCNT có thể lên 01 do thêm/sửa gói nhưng một TBMT đã liên kết chưa chắc đổi version.

## 6. Trả lời tình huống kế hoạch 00 → 01, gói cũ và gói mới

### 6.1. Điều portal chứng minh và không chứng minh

Giả sử:

- KHLCNT phiên bản 00 có gói A;
- KHLCNT phiên bản 01 vẫn có A và thêm B.

**FACT.** Portal có thể biểu diễn hai version KHLCNT bằng hai UUID và hai snapshot package list khác nhau.

**UNKNOWN.** Public version-list không cho biết A ở hai snapshot có cùng ID hay không, và portal không hiển thị một `packageVersion` 00/01 cho A.

**FACT từ code BiddingFlow.** Câu “gói A phiên bản 00 tự thành 01 khi kế hoạch lên 01” không phải quy tắc đang chạy. Plan snapshot tạo ID gói mới, giữ cùng `rootId`, chuyển sang `keHoachId` mới và giữ `sourcePackage.phienBan`. Package chỉ tăng phiên bản bằng package command riêng.

### 6.2. Thuật toán sync phù hợp với quy tắc kế thừa

Khi import một mã KHLCNT:

1. Lấy version-list; xác định các revision chưa có trong BiddingFlow.
2. Với lần đầu import lịch sử, xử lý `planVersion` theo thứ tự 00 → 01 → 02… để rule kế thừa chạy tuần tự.
3. Với từng version, lấy snapshot kế hoạch và toàn bộ package list.
4. So sánh snapshot mới với snapshot liền trước.
5. Phân loại gói thành `MATCHED`, `ADDED`, `REMOVED`, `AMBIGUOUS`.
6. Gọi một command đối chiếu nguyên tử dùng lại các snapshot/version primitive hiện có; không gọi plan command rồi package command thành hai transaction và không tự nhân bản bằng SQL rời rạc.
7. Sau khi tạo/ghép package, xử lý `linkNotifyInfo` và enrichment thông báo như một bước riêng.

Quy tắc kết quả đề xuất:

| Tình huống ở plan 01 | Hành động BiddingFlow |
|---|---|
| A khớp và không đổi so với plan 00 | Clone snapshot sang plan 01, giữ `rootId` và giữ `phienBan` gói theo rule hiện tại |
| A là logical package đã tồn tại và field gói đổi hoặc link mới được resolve | Clone sang plan 01 rồi tạo package revision kế tiếp trong cùng transaction; không gán số `planVersion` hay `notifyVersion` vào `phienBan` |
| B mới xuất hiện và đã có linked notice ngay lần tạo đầu | Tạo B ở package revision 00 đã enrichment; không sinh thừa revision 01 |
| B chỉ xuất hiện ở plan 01 | Tạo logical package mới, revision đầu tiên theo convention nội bộ (thường là 00) |
| A không còn ở plan 01 | Không xóa lịch sử; đánh dấu không thuộc snapshot 01/đã loại khỏi revision hiện tại |
| A có `notifyNo` mới xuất hiện | Enrich chính A; không tạo package thứ hai |
| `notifyVersion` của A tăng | Tạo/sync notice revision; không mặc định tăng `planVersion` hay package revision |
| Không match chắc chắn | Dừng auto-merge cho dòng đó và yêu cầu xác nhận trong preview |

### 6.3. Khóa match gói

**INFERENCE.** Không nên dùng tên gói đơn lẻ. Thứ tự ưu tiên nên là:

1. lineage key chính thức nếu payload được cấp sau này có một khóa ổn định xuyên version;
2. cùng `linked_notice_no` khi cả hai snapshot đều có link;
3. cùng `bidPackageSymbol` trong cùng `planNo`, nếu có và duy nhất;
4. binding đã được người dùng xác nhận ở lần import trước;
5. fingerprint tên + chủ đầu tư + lĩnh vực + hình thức + loại hợp đồng chỉ dùng để gợi ý;
6. nếu mơ hồ, người dùng chọn gói cũ hoặc xác nhận đây là gói mới.

`idDetail` phải được lưu để nhận diện chính xác một observation và chống import lặp lại cùng revision, nhưng **UNKNOWN** liệu nó ổn định xuyên `planVersion`; do đó chưa được dùng một mình làm logical package key. STT tuyệt đối không phải identity.

## 7. Thiết kế import được khuyến nghị

### 7.1. Các khóa nguồn cần lưu

```text
Plan logical key:
  source = MUASAMCONG
  external_plan_no

Plan revision key:
  external_plan_no
  external_plan_version
  external_plan_revision_id   # UUID từ version-list

Package source identity:
  external_plan_detail_id     # idDetail, có provenance theo snapshot
  bid_package_symbol
  linked_notice_no
  matched_logical_package_id

Notice revision key:
  linked_notice_kind
  external_notice_no
  external_notice_version       # nullable đến khi exact resolution
  external_notice_revision_id   # nullable đến khi exact resolution
```

Chỉ tạo notice revision key sau khi resolve exact kind và revision. Nên lưu thêm canonical snapshot hash, fetched_at, source_url và mapping provenance theo field để sync lặp lại có tính idempotent và audit được. Không lưu raw upstream payload.

### 7.2. Luồng UI

1. Nhập `PL...`.
2. Hiển thị các plan version tìm thấy; mặc định version mới nhất nhưng cho phép xem/import lịch sử.
3. Preview kế hoạch và tất cả gói trong snapshot.
4. Với mỗi gói hiển thị:
   - mới/kế thừa/thay đổi/mơ hồ;
   - có link, loại link, số version notice;
   - field nào sẽ điền/ghi đè/bỏ qua.
5. Người dùng xác nhận.
6. Commit kế hoạch + package base transactionally.
7. Enrichment TBMT/pre-notify có thể chạy phase 2; lỗi enrichment không làm mất các gói đã import từ kế hoạch.

### 7.3. Idempotency

Import lặp lại cùng `(planNo, planVersion, revisionId, snapshotHash)` phải trả “không có thay đổi”. Khi portal có revision mới, chỉ sync version mới và các notice version mới. Không tạo bản ghi gói trùng vì người dùng đã từng nhập `IB...` riêng trước đó; phải reconcile qua `notifyNo` và quan hệ plan/package.

Không backfill local version theo cách chèn vào trước một revision đã áp dụng. Nếu source revision 03 đã thành local plan 00 thì source 00–02 đến sau chỉ lưu provenance OBSERVED_NOT_APPLIED; source 04 mới tạo local next version. Nếu người dùng tạo local version thủ công xen giữa source revisions, source revision kế tiếp kế thừa từ local latest và mapping source/local được lưu riêng.

## 8. CAPTCHA và giới hạn bằng chứng

**FACT.** JavaScript của trang thực hiện `grecaptcha.execute(...)`, lấy token rồi mới POST cho:

- chi tiết KHLCNT `.../bid-po-bidp-plan-project-view/get-by-id`;
- chi tiết từng gói `.../get-bidp-plan-detail-by-id`;
- chi tiết TBMT;
- elastic search dùng để resolve `notifyNo` khi click liên kết.

Nguồn: [JavaScript first-party trang KHLCNT](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p) và [trang TBMT first-party](https://muasamcong.mpi.gov.vn/vi/web/portaloldv1/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&bidMode=1_MTHS&id=cbd7af22-0469-402b-8583-ec9dc325f533&isInternet=1&notifyId=cbd7af22-0469-402b-8583-ec9dc325f533&notifyNo=IB2400040053&planNo=PL2400020327&processApply=LDT&step=tbmt&stepCode=notify-contractor-step-1-tbmt&type=es-notify-contractor).

**FACT.** Hai endpoint version-list nêu ở mục 4 và 5 được frontend gọi không có token và đã trả dữ liệu công khai trong lần kiểm tra này.

**UNKNOWN.** Nghiên cứu không xác nhận một API chính thức, ổn định và được phép cho backend bên thứ ba lấy toàn bộ detail payload không qua CAPTCHA. Tên path `services/expose` không tự nó là cam kết về SLA, tính ổn định hay điều khoản sử dụng.

**KHUYẾN NGHỊ.** Trước khi code production:

- ưu tiên API/quyền truy cập chính thức do cơ quan vận hành cung cấp;
- không giả lập/reuse token để vượt reCAPTCHA;
- đặt adapter nguồn, cache, rate limit, circuit breaker và feature flag;
- cho phép preview/import thủ công khi nguồn chi tiết không khả dụng;
- giữ parser contract tests vì template/field có thể thay đổi.

## 9. Mức độ chắc chắn theo câu hỏi

| Câu hỏi | Kết luận | Mức độ |
|---|---|---|
| KHLCNT có danh sách gói không? | Có, `bidpPlanDetailToProjectList` và tab riêng | FACT — cao |
| Click từng gói có chi tiết không? | Có, dùng `idDetail` và endpoint detail gói | FACT — cao |
| Có thể tự thêm gói khi thêm KHLCNT không? | Có về mô hình dữ liệu; production phụ thuộc quyền truy cập detail hợp lệ | INFERENCE — cao |
| `Số thông báo liên kết` lấy từ đâu? | `linkNotifyInfo.notifyNo` | FACT — cao |
| Có link luôn là TBMT? | Không nên giả định; portal fallback sang `es-pre-notify-contractor` | FACT — cao |
| Không có link nghĩa là “chuẩn bị”? | Portal có thể nói “Chưa có TBMT”; “chuẩn bị” là mapping nghiệp vụ có điều kiện | FACT + INFERENCE |
| Plan 00/01 được biểu diễn thế nào? | Cùng `planNo`, khác `planVersion` và UUID `id` | FACT — cao |
| TBMT 00/01 được biểu diễn thế nào? | Cùng `notifyNo`, khác `notifyVersion` và UUID `id` | FACT — cao |
| Plan version tăng có tự làm package/TBMT tăng version không? | Không có bằng chứng; hai version stream là độc lập | UNKNOWN + FACT về cấu trúc |
| Có áp dụng rule kế thừa hiện có được không? | Dùng lại được primitive clone/version, nhưng command hiện tại chưa đủ cho changed/new/removed trong một transaction | FACT từ code |
| `idDetail` có ổn định xuyên plan version không? | Chưa xác nhận | UNKNOWN |

## 10. Đối chiếu với mô hình hiện tại của BiddingFlow

### 10.1. Hành vi phiên bản đã được code và test xác nhận

Khi kế hoạch nội bộ `P0/v00` tạo phiên bản `P1/v01`:

| Bản ghi | ID | `rootId` | `phienBan` | Kế hoạch chứa |
|---|---|---|---:|---|
| Kế hoạch nguồn | `P0` | `P0` | `00` | — |
| Kế hoạch mới | `P1` | `P0` | `01` | — |
| Gói A ở snapshot cũ | `G0` | `G0` | `00` | `P0` |
| Snapshot mới của A, nếu không đổi | `G1` | `G0` | **vẫn `00`** | `P1` |
| Gói B mới xuất hiện | `N0` | `N0` | `00` | `P1` |

Bằng chứng:

- [planAggregateSnapshot.js](../../frontend/plans/planAggregateSnapshot.js) truyền package version từ sourcePackage.phienBan, fallback 00;
- [aggregate_snapshot.py](../../backend/versioning/aggregate_snapshot.py) giữ nguyên phienBan của source package;
- [packageDeleteHelpers.js](../../frontend/packages/packageDeleteHelpers.js) mô tả identity của package version là `(phienBan, keHoachId)`;
- [plan_package_snapshot_hydration.test.mjs](../../tests/js/plan_package_snapshot_hydration.test.mjs) assert phải giữ số phiên bản gói;
- package command mới cộng một tại [command.py](../../backend/versioning/command.py).

Nếu A thay đổi thật trong snapshot kế hoạch mới, command đối chiếu có thể tạo `G2` dưới `P1`, cùng `rootId=G0`, `phienBan=01`. Việc tăng này do diff nội dung và package version rule, không do phép gán `phienBan = planVersion`.

### 10.2. Khoảng trống của command hiện tại

- Plan command hiện clone mọi gói latest của kế hoạch nguồn; chưa nhận tập include/exclude, nên gói đã bị loại trên nguồn vẫn bị mang sang revision mới.
- Gói thay đổi phải gọi thêm package command sau plan command, tạo hai transaction và trạng thái trung gian không mong muốn.
- Model chưa có stable external package binding, external plan/package/notice revision, snapshot hash hoặc provenance để chống trùng và đối chiếu lần sau.
- Generic sync chưa hard-block mọi cập nhật vào row lịch sử; package command cũng chưa kiểm tra kế hoạch chứa gói là kế hoạch latest.
- Aggregate clone sâu nhiều dữ liệu con nhưng chưa bao phủ một số lifecycle/artifact/document/contract link. Cần chốt rõ bảng nào clone và bảng nào chỉ giữ ở lịch sử trước khi tuyên bố “kế thừa toàn bộ”.

Vì vậy bundle import phải dùng một backend command `reconcileProcurementPlanRevision` chạy transaction `SERIALIZABLE`, có CAS, idempotency, provenance và trả authoritative delta. Command này dùng lại primitive snapshot hiện có nhưng xử lý `UNCHANGED`, `CHANGED`, `ADDED`, `REMOVED`, `AMBIGUOUS` trong một lần commit.

## 11. Quyết định đề xuất cho kế hoạch triển khai

Chốt đặc tả theo các nguyên tắc sau:

1. **Import PL tạo plan và toàn bộ package base** trong snapshot đã chọn.
2. **Version-aware từ đầu**: không key theo `planNo` đơn lẻ; lưu cả `planVersion` và UUID revision.
3. **Snapshot diff chạy trước inheritance**; không suy diễn package version trực tiếp từ chuỗi `planVersion`.
4. **Gói mới và gói kế thừa xử lý khác nhau**; gói bị loại không hard-delete.
5. **Linked notice là enrichment của package**, với stream version riêng.
6. **Không link chỉ có nghĩa chắc chắn là chưa có linked notice trong snapshot**; trạng thái “chuẩn bị” cần điều kiện nghiệp vụ.
7. **Không triển khai scraping vượt CAPTCHA**; phải có nguồn truy cập được phép hoặc fallback rõ ràng.
8. **Giữ semantics phiên bản hiện tại**: source plan version, local plan version, local package version và source notice version là bốn bộ đếm độc lập; không lockstep số phiên bản.
9. **Gói thay đổi mới tăng local package version**; gói chỉ được kế thừa do plan tăng version thì giữ nguyên `phienBan`.
10. **Dùng command đối chiếu nguyên tử và provenance bắt buộc**; không triển khai bundle import bằng chuỗi thao tác frontend.

Với tình huống người dùng nêu, kết quả khả thi và đúng rule hiện tại là: import plan 01 tạo snapshot kế hoạch 01; gói A không đổi được kế thừa nhưng vẫn mang package version 00; nếu A thay đổi thật thì command tạo package version 01; gói B mới bắt đầu ở 00. Nếu sản phẩm muốn mọi gói A luôn thành 01 chỉ vì plan thành 01, đó là một thay đổi domain rule riêng, trái với code và test hiện tại.
