# Kế hoạch triển khai vòng đời LCNT theo một hoặc nhiều phần lô

Trạng thái: đang triển khai — đã hoàn thành lát nền backend đầu tiên.

Ngày lập: 22/07/2026.

Tiến độ triển khai ngày 22/07/2026:

- Đã thêm policy thuần domain cho cổng tách lô, state machine 1G1T/1G2T,
  outcome và projection trạng thái cấp gói.
- Đã thêm schema/migration v12 cho đợt xử lý, chi tiết lô, nhóm phụ thuộc và
  hồ sơ nghiệp vụ có snapshot/phạm vi lô.
- Đã chuyển lưu phần lô từ xóa–chèn lại sang upsert giữ nguyên identity và
  lưu trữ mềm lô bị loại khỏi phiên bản hiện hành.
- Đã cho phép các lô có nhà thầu trúng khác nhau; trường nhà thầu trúng cấp
  gói chỉ còn là projection tương thích khi mọi lô cùng một nhà thầu.
- Đã có API query vòng đời và command tạo đợt xử lý có khóa giao dịch, kiểm
  tra phân quyền và policy.
- Đã nối UI lưu nháp đánh giá theo phạm vi toàn bộ hoặc một/nhiều phần lô với
  đợt xử lý `CONSOLIDATED_APPROVAL`; lưu phạm vi con không hoàn tất cờ toàn gói.
- Đã khóa nhập/xuất Excel tổng quát khi đang chọn phạm vi con và chặn quay về
  lưu toàn gói nếu đã có batch con `ACTIVE`, tránh cập nhật lô ngoài phạm vi hoặc
  làm lệch trạng thái giữa luồng cũ và vòng đời batch.
- Chưa nối command chuyển stage, phát hành hồ sơ snapshot, mở tài chính,
  KQLCNT và hợp đồng theo lô; các phần này thuộc các lát tiếp theo.

Tài liệu pháp lý đi kèm: [nghiên cứu nghiệp vụ và pháp lý](../research/multi-lot-evaluation-legal-research.md).

## 1. Kết luận kiến trúc

Không mở rộng luồng hiện tại bằng cách thêm `selectedLotIds` vào các cờ `saved`. Cần xây một mô-đun sâu `LotSelectionLifecycle` làm chủ toàn bộ vòng đời của phạm vi lô:

```text
query(packageId) -> trạng thái từng lô, đợt, hồ sơ và thao tác hợp lệ
execute(command, expectedRevisions) -> commit nguyên tử hoặc trả về vi phạm
renderArtifact(artifactId) -> context từ snapshot bất biến
```

Đơn vị xử lý là **đợt xử lý phần lô** gồm một hoặc nhiều lô. Mỗi báo cáo, biên bản, quyết định và kết quả đều có phạm vi lô riêng, phiên bản riêng và dấu vết kiểm toán. Trạng thái gói thầu chỉ là projection tổng hợp từ trạng thái các lô.

Luồng cũ “đánh giá tất cả lô một lần” không bị loại bỏ; nó trở thành một đợt có phạm vi là toàn bộ các lô đủ điều kiện.

## 2. Vấn đề trong mã nguồn hiện tại

| Khu vực | Hiện trạng | Hậu quả khi xử lý nhiều đợt |
| --- | --- | --- |
| `frontend/packages/BidEvaluationWorkflow.js:47-73, 723-736` | Đọc cờ hoàn tất ở cấp gói và tải toàn bộ hồ sơ dự thầu của gói | Lưu một số lô sẽ khóa/mở tab của tất cả lô |
| `frontend/packages/bidEvaluationActions.js:178-218, 219-347` | Ghi `saved: true`, duyệt tất cả dòng đang hiển thị và chuyển bước toàn gói | Không có ranh giới giao dịch theo lô; đợt sau có thể ghi đè đợt trước |
| `frontend/packages/detail/PackageTabs.js:22-74` | Tab kỹ thuật, đạt kỹ thuật, mở tài chính và kết quả được bật bằng cờ toàn gói | Không thể hiển thị Lô A đã mở tài chính trong khi Lô B còn đánh giá kỹ thuật |
| `frontend/packages/GoiThauDetail.js:351-379, 539-548, 596-715` | Chỉ có một bộ số/ngày thẩm định kỹ thuật, quyết định đạt kỹ thuật và một `thoiGianMoEhsdxtc` | Nhiều đợt dùng chung một hồ sơ và ghi đè số/ngày |
| `frontend/packages/detail/AwardResultDetailsPanel.js:72-96, 925-967` | Một bộ thẩm định kết quả; phê duyệt đặt cả gói thành `Đã có kết quả`; không có người trúng thì tự chuẩn bị hủy toàn gói | Không biểu diễn được kết quả một phần và nhầm “không lựa chọn được” với “hủy thầu” |
| `frontend/packages/packageCancellation.js` | Quyết định hủy và trạng thái hủy ở cấp gói | Không thể hủy/tổ chức lại một số lô mà giữ các lô khác tiếp tục |
| `frontend/packages/packageAwardResult.js:12-22` | Mở lại kết quả xóa lý do sinh tự động của mọi hồ sơ trong gói | Sửa Lô A có thể làm thay đổi Lô B đã ổn định |
| `frontend/shared/BiddingCalculations.js:12-120` | Đã nhóm xếp hạng theo `maPhanLo`, là nền tảng có thể tái sử dụng | Chưa xử lý tối ưu/phụ thuộc chéo; một số phương pháp còn dùng giá gói cho từng nhóm lô |
| `backend/db/schema.py:510-533` | Bảng lô không có trạng thái vòng đời; mã lô không có unique; chưa có identity ổn định được tham chiếu từ hồ sơ dự thầu | Không thể đặt FK chắc chắn từ đánh giá/hồ sơ sang lô |
| `backend/sync/mapper.py:501-530` | Xóa rồi chèn lại toàn bộ lô khi lưu gói | ID lô có thể thay đổi theo thứ tự; không thể dùng làm khóa cho lịch sử chính thức |
| `backend/db/schema.py:971-994` | `vong_danh_gia` unique theo `(organization, package, round_type)` | Mỗi loại vòng chỉ có đúng một bản ghi cho cả gói |
| `backend/sync/mapper.py:209-246` | ID cố định `evaluation-round:{package}:{type}`; `saved` được đổi thành `completed` | Không có đợt, phạm vi hoặc revision |
| `backend/db/schema.py:1014-1047` | Một kết quả mutable cho mỗi hồ sơ mở thầu | Không giữ được kết quả theo stage/revision và lịch sử sửa |
| `backend/sync/payload_validation.py:709-782` | Gói có kết quả phải có một nhà thầu trúng cấp gói; nhà thầu trúng từng lô phải trùng nhà thầu này | Sai với trường hợp mỗi lô có nhà thầu trúng khác nhau |
| `backend/documents/docx_service.py:237-423` | Context Word truy vấn toàn bộ gói và toàn bộ hồ sơ dự thầu tại thời điểm xuất | Báo cáo đợt cũ thay đổi khi dữ liệu sống của đợt sau thay đổi |
| `backend/documents/excel_service.py:211-389` và `routes_excel.py` | API Excel chỉ nhận `package_id` và loại đánh giá | Export/import trộn lô ngoài phạm vi và không phát hiện file cũ |
| `frontend/packages/packageTimelineRows.js:134-140` | Một mốc cho mỗi loại báo cáo của toàn gói | Không theo dõi được các mốc song song theo lô/đợt |
| `hop_dong_goi_thau` và `frontend/contracts/HopDongWorkflow.js` | Hợp đồng chỉ gắn gói, không gắn lô | Không chứng minh được hợp đồng nào thực hiện lô nào khi có nhiều nhà thầu trúng |

Kết luận: thay đổi này phải đi xuyên suốt domain, DB, command/API, UI, tài liệu, timeline, kết quả, hủy/tổ chức lại và hợp đồng. Chỉ sửa màn hình đánh giá sẽ tạo dữ liệu không nhất quán.

## 3. Từ vựng miền đề xuất

| Thuật ngữ | Định nghĩa |
| --- | --- |
| Phần lô | Phạm vi công việc có mã, tên và giá ước tính riêng trong một gói thầu |
| Hồ sơ dự thầu theo lô | Cặp hồ sơ dự thầu–phần lô; một nhà thầu có thể có kết luận khác nhau ở các lô |
| Đợt xử lý phần lô | Nhóm một hoặc nhiều lô được người dùng chọn để đi qua một phần hoặc toàn bộ vòng đời LCNT |
| Phạm vi hồ sơ | Tập lô và, khi cần, tập hồ sơ dự thầu theo lô mà báo cáo/biên bản/quyết định bao phủ |
| Hồ sơ nghiệp vụ | Báo cáo đánh giá, báo cáo thẩm định, quyết định phê duyệt, biên bản mở tài chính hoặc quyết định KQLCNT |
| Nhóm phụ thuộc | Tập lô phải xử lý cùng nhau do quy tắc HSMT, giảm giá, năng lực, tối ưu trao thầu hoặc bí mật tài chính |
| Kết quả cuối cùng của lô | Trúng thầu, không lựa chọn được, hủy phần lô, phải tổ chức lại hoặc trạng thái cuối khác có căn cứ |
| Hoàn tất một phần | Ít nhất một lô có kết quả cuối cùng nhưng vẫn còn lô chưa kết thúc |

Chỉ cập nhật `CONTEXT.md` sau khi nhóm nghiệp vụ chấp thuận các tên trên. Trước khi code cần ghi ADR cho ba quyết định khó đảo ngược: phạm vi theo lô, hồ sơ snapshot bất biến và chính sách tách/gộp nhóm phụ thuộc.

## 4. Hai chế độ nghiệp vụ

### 4.1. `CONSOLIDATED_APPROVAL` — mặc định

- Cho chọn lô để nhập, kiểm tra và lưu **nháp** nhiều lần.
- Chưa phát hành hồ sơ chính thức và chưa mở bước pháp lý kế tiếp cho đến khi toàn bộ phạm vi phê duyệt hợp nhất sẵn sàng.
- Phù hợp khi đơn vị vẫn dùng một báo cáo/quyết định chung hoặc Hệ thống mạng đấu thầu quốc gia không tách thao tác theo lô.

### 4.2. `STAGED_APPROVAL` — có điều kiện

- Mỗi đợt được phát hành báo cáo/thẩm định/quyết định theo đúng các lô trong phạm vi.
- Chỉ bật sau khi `assessSeparability` xác nhận không cắt ngang nhóm phụ thuộc và đơn vị đã lưu căn cứ cho phép.
- Việc bật phải lưu người xác nhận, căn cứ, thời gian và phiên bản chính sách.

Không cho đổi chế độ sau hồ sơ chính thức đầu tiên nếu chưa thực hiện thủ tục void/supersede có thẩm quyền.

## 5. Cổng kiểm tra khả năng tách lô

`assessSeparability(packageId, selectedLotIds, targetStage)` trả về `allowed`, `requiredLotClosure`, `blockers`, `warnings` và `policyVersion`.

Phải chặn khi có một trong các trường hợp:

1. HSMT quy định đánh giá một nhóm nhiều lô hoặc toàn gói.
2. Giảm giá chỉ có hiệu lực khi trúng một tổ hợp lô.
3. Năng lực/doanh thu/nguồn lực được đánh giá trên tổng các lô hoặc nhà thầu chỉ được trao tối đa một số lô.
4. KQLCNT phải tối ưu tổng giá/tổng giá đánh giá của một tổ hợp lô.
5. Cùng một E-HSĐXTC bao phủ lô được chọn và lô còn chờ, việc mở làm lộ giá ngoài phạm vi.
6. Một lô đang nằm trong đợt chính thức khác.
7. Tập lô chọn không có cùng phương thức, stage hoặc revision hợp lệ.
8. Có hồ sơ/hợp đồng phía sau khiến thao tác sửa cần quy trình khắc phục mở rộng.

Khi người dùng chọn một phần của nhóm phụ thuộc, UI phải đề nghị chọn toàn nhóm; không cung cấp nút “bỏ qua cảnh báo”.

## 6. State machine

### 6.1. 1G1T

```text
NOT_STARTED
  -> EVALUATION_DRAFT
  -> EVALUATION_FINALIZED
  -> RESULT_APPRAISED
  -> RESULT_APPROVED
```

### 6.2. 1G2T

```text
NOT_STARTED
  -> TECHNICAL_DRAFT
  -> TECHNICAL_EVALUATED
  -> TECHNICAL_APPRAISED
  -> TECHNICAL_APPROVED
  -> FINANCIAL_OPENED          (chỉ phạm vi đủ điều kiện)
  -> FINANCIAL_EVALUATED
  -> RESULT_APPRAISED
  -> RESULT_APPROVED
```

Stage và outcome là hai khái niệm khác nhau. Khi `RESULT_APPROVED`, mỗi lô phải có một outcome:

- `AWARDED`
- `NO_BID`
- `NO_TECHNICAL_QUALIFIER`
- `NO_FINANCIAL_QUALIFIER`
- `NO_RESPONSIVE_BID`
- `CANCELLED_LOT`
- `REPROCUREMENT_REQUIRED`
- `OTHER_APPROVED_OUTCOME`

Không tự đổi outcome thất bại thành `CANCELLED_LOT`; quyết định hủy cần command, số/ngày, lý do và quyền riêng.

### 6.3. Trạng thái tổng hợp cấp gói

Không tiếp tục dùng `trangThai = "Đã có kết quả"` như nguồn sự thật cho mọi lô. Thêm projection:

- `NOT_STARTED`
- `IN_PROGRESS`
- `PARTIALLY_COMPLETED`
- `COMPLETED`
- `PACKAGE_CANCELLED`

Kèm các bộ đếm `totalLots`, `pendingLots`, `awardedLots`, `noAwardLots`, `cancelledLots`. `COMPLETED` chỉ khi mọi lô có outcome cuối hợp lệ. `PACKAGE_CANCELLED` chỉ dùng cho quyết định hủy toàn gói.

## 7. So sánh ba thiết kế interface

### Phương án A — aggregate command tối giản

```text
query(packageId)
execute(command, expectedRevisions)
renderArtifact(artifactId)
```

Ưu điểm: interface nhỏ, mọi invariant và invalidation ở một seam, caller không biết chi tiết lưu trữ. Nhược điểm: command handler dễ phình to nếu không tách policy nội bộ.

### Phương án B — event sourcing đầy đủ

```text
append(event)
project(stream)
renderAt(sequence)
```

Ưu điểm: audit/replay/revision tự nhiên. Nhược điểm: chi phí migration, vận hành và đào tạo cao; repository hiện dùng CRUD + sync, nên đây là thay đổi kiến trúc quá lớn cho nhu cầu hiện tại.

### Phương án C — service theo từng màn hình/bước

```text
saveEvaluation(...)
approveTechnicalList(...)
recordFinancialOpening(...)
approveResult(...)
```

Ưu điểm: dễ gọi từ UI hiện tại. Nhược điểm: interface rộng, dễ lặp quy tắc phạm vi và tái tạo đúng vấn đề các cờ rải rác hiện nay.

### Khuyến nghị

Dùng phương án A ở biên mô-đun, kết hợp bảng current-state quan hệ và nhật ký sự kiện bất biến bên trong; không dùng event sourcing đầy đủ. Các command typed được dispatch vào policy/handler nhỏ nhưng caller chỉ dùng ba entry point. Đây là seam để UI, sync, tài liệu và timeline cùng nhận một cách hiểu về trạng thái.

## 8. Mô hình dữ liệu đề xuất

### 8.1. Làm ổn định identity trước

1. `goi_thau_phan_lo.id` phải ổn định; bỏ chiến lược xóa/chèn lại ở `mapper.py:501`.
2. Thêm unique theo `(organization_id, goi_thau_id, normalized_ma_phan_lo)`.
3. Thêm `lot_id` vào `thong_tin_mo_thau`, backfill bằng mã lô chuẩn hóa và đặt FK; giữ mã/tên lô snapshot để hiển thị lịch sử.
4. Sau khi mở thầu, cấm đổi mã/xóa/reorder làm thay identity; sửa nội dung vật chất phải theo version gói.

### 8.2. Bảng mới

`dot_xu_ly_phan_lo`

- `id`, `organization_id`, `goi_thau_id`, `sequence_no`
- `approval_mode`, `status`, `policy_version`
- `created_by`, `created_at`, `closed_at`, `row_version`

`dot_xu_ly_phan_lo_chi_tiet`

- `batch_id`, `lot_id`, `current_stage`, `lifecycle_revision`, `row_version`
- unique active lifecycle cho mỗi `lot_id`

`nhom_phu_thuoc_phan_lo` và bảng thành viên

- loại phụ thuộc: `EVALUATION`, `CAPACITY`, `DISCOUNT`, `AWARD_OPTIMIZATION`, `FINANCIAL_SECRECY`
- nguồn/căn cứ HSMT, phiên bản, các lô thành viên

`ho_so_nghiep_vu_lcnt`

- `id`, `batch_id`, `artifact_type`, `status: DRAFT|FINAL|VOID|SUPERSEDED`
- `document_number`, `document_date`, `revision`
- `snapshot_schema_version`, `snapshot_json`, `scope_hash`, `content_digest`
- `finalized_by/at`, `voided_by/at/reason`, `supersedes_id`, `row_version`

`ho_so_nghiep_vu_lcnt_phan_lo`

- `artifact_id`, `lot_id`
- phạm vi nhiều-nhiều để hỗ trợ đợt A+B nhưng mở tài chính chỉ A nếu B không có nhà thầu đạt

`ho_so_nghiep_vu_lcnt_ho_so_du_thau`

- `artifact_id`, `opening_bid_id`, `lot_id`, vai trò trong hồ sơ
- cần cho danh sách đạt kỹ thuật và biên bản mở tài chính theo cặp nhà thầu–lô

`phien_ban_ket_qua_danh_gia_nha_thau`

- `batch_id`, `lot_id`, `opening_bid_id`, `stage`, `revision`, các kết luận/điểm/xếp hạng/lý do
- immutable sau finalize; unique theo scope + revision
- bảng hiện tại `ket_qua_danh_gia_nha_thau` trở thành projection latest trong giai đoạn tương thích

`ket_qua_lcnt_phan_lo`

- `lot_id`, `result_artifact_id`, `outcome`
- `winner_contractor_version_id`, `winning_bid_id`, `award_price`, loại/thời gian hợp đồng
- unique một kết quả hiệu lực cho mỗi lot lifecycle revision

`hop_dong_phan_lo`

- `contract_id`, `lot_id`, `result_id`
- chặn một hợp đồng gắn lô không do đúng nhà thầu hợp đồng trúng

Các bảng nghiệp vụ mới phải có owner scope, optimistic row version, idempotency và FK/composite FK tương thích cả SQLite và PostgreSQL. Không nhét lịch sử đợt vào `extension_json` 64 KiB.

## 9. Command và invariant phía server

Các command tối thiểu:

- `CREATE_BATCH`
- `SAVE_STAGE_DRAFT`
- `FINALIZE_EVALUATION_REPORT`
- `FINALIZE_TECHNICAL_APPRAISAL`
- `APPROVE_TECHNICAL_LIST`
- `RECORD_FINANCIAL_OPENING`
- `FINALIZE_FINANCIAL_EVALUATION`
- `FINALIZE_RESULT_APPRAISAL`
- `APPROVE_LOT_RESULTS`
- `RECORD_NO_AWARD_OUTCOME`
- `CANCEL_LOTS`
- `MARK_REPROCUREMENT_REQUIRED`
- `VOID_AND_REOPEN`

Mỗi `execute` phải trong một transaction:

1. Kiểm tra quyền và phân công.
2. Lock các lot lifecycle theo thứ tự ID để tránh deadlock.
3. Kiểm tra `expectedRevisions` và idempotency key.
4. Chạy `assessSeparability` và state transition policy.
5. Kiểm tra tài chính, bidder–lot, artifact scope và predecessor.
6. Ghi current state + artifact/snapshot + audit event nguyên tử.
7. Trả projection mới và các bước tiếp theo; client không tự suy trạng thái.

Các invariant tài chính:

- Cho phép nhà thầu trúng khác nhau theo lô.
- `gia_trung_thau` cấp gói là tổng dẫn xuất từ các lô `AWARDED`; khi còn lô chờ phải gắn `isFinal = false`.
- Tổng giá trao thầu tuân thủ trần giá gói và policy HSMT/chuyên ngành.
- Kiểm tra trần từng lô chỉ khi policy áp dụng; không hard-code cho mọi lĩnh vực.
- Tổ hợp giảm giá/năng lực phải được giải trên toàn nhóm phụ thuộc trước khi phê duyệt.

## 10. Phân quyền, bất biến và sửa sai

Tách capability: `evaluate`, `appraise_technical`, `approve_technical`, `record_financial_opening`, `appraise_result`, `approve_result`, `cancel_scope`, `reopen_formal_stage`.

Ít nhất phải ghi actor, vai trò, tổ chuyên gia/tổ thẩm định, thời điểm và lý do. Nếu đơn vị yêu cầu four-eyes/segregation of duties, policy chặn cùng một người thực hiện các bước xung đột.

Hồ sơ `FINAL` không được sửa tại chỗ. `VOID_AND_REOPEN` phải:

- tạo revision mới;
- đánh dấu hồ sơ cũ `VOID` hoặc `SUPERSEDED`, không xóa;
- vô hiệu các hồ sơ hậu duệ chỉ trong phạm vi bị ảnh hưởng;
- mở rộng phạm vi vô hiệu nếu lô thuộc nhóm phụ thuộc/bí mật tài chính;
- giữ nguyên các đợt/lô không liên quan;
- chặn tự động nếu đã ký hợp đồng và yêu cầu quy trình pháp lý riêng.

Mọi transition chính thức phải ghi vào audit chain hiện có, không chỉ thao tác xóa.

## 11. UI/UX đề xuất

### 11.1. Bảng trạng thái lô

Trong chi tiết gói, thêm bảng mỗi dòng một lô:

- mã/tên/giá ước tính;
- stage hiện tại và outcome;
- đợt đang tham gia;
- số nhà thầu tham dự/đạt kỹ thuật;
- hồ sơ gần nhất;
- blocker/nhóm phụ thuộc.

### 11.2. Tạo/tiếp tục đợt

- Chọn một, nhiều hoặc “tất cả lô đủ điều kiện”.
- Hệ thống chạy preview `assessSeparability` trước khi tạo đợt.
- Luôn hiển thị banner `Đợt 02 — Lô L03, L04`; mọi tab và action nằm trong context này.
- Không trộn các lô khác stage trong cùng thao tác.

### 11.3. Tab theo đợt, không theo gói

`Báo cáo đánh giá`, `Đạt kỹ thuật`, `Mở tài chính`, `Đánh giá tài chính`, `KQLCNT` đọc projection của batch/lot. Tab gói chỉ tổng hợp và cho chuyển giữa các đợt.

Trước hành động chính thức, modal xác nhận phải cho xem:

- lô và hồ sơ dự thầu thuộc phạm vi;
- số/ngày hồ sơ;
- bước nào sẽ mở;
- hồ sơ nào sẽ bị vô hiệu nếu là reopen.

Không dùng một cờ `saved` cho cả nháp và hoàn tất. Nút phải tách `Lưu nháp` và `Phát hành/Hoàn tất bước`.

## 12. Word, Excel và timeline

### 12.1. Word

- Route chính thức nhận `artifact_id`, không chỉ `package_id`.
- Context lấy từ `snapshot_json`; không truy vấn dữ liệu sống để tái tạo bản đã phát hành.
- Mọi mẫu in mã/tên lô thuộc phạm vi; danh sách nhà thầu là bidder–lot.
- Tổng số lô/tổng giá trong đợt và toàn gói là hai trường riêng.
- Bản nháp có watermark và có thể dùng live projection; bản final chỉ dùng snapshot.

### 12.2. Excel

- Export nhận `batch_id + stage`; chỉ xuất lô/hồ sơ trong phạm vi.
- Hidden manifest chứa package, batch, lot IDs, stage, revision, scope hash và template version.
- Import từ chối dòng ngoài phạm vi, lot code không khớp, stage sai hoặc revision cũ.
- Không cung cấp dropdown toàn bộ lô khi file chỉ dành cho một đợt.

### 12.3. Timeline

- Timeline cấp lô/đợt hiển thị đầy đủ các artifact.
- Timeline cấp gói gom nhóm cùng artifact để tránh lặp, đồng thời hiện tiến độ `x/y lô`.
- Các mốc hiện lấy từ `technical.soBctdKt`, `result.soBctdKetQua`, `thoiGianMoEhsdxtc` phải chuyển sang projection artifact.

## 13. Ma trận trường hợp bắt buộc

| Trường hợp | Kết quả mong đợi |
| --- | --- |
| 1G1T, chọn L1 rồi L2 | L1 đi tới KQLCNT; L2 không bị khóa và xử lý ở đợt sau |
| 1G1T, chọn L1+L3 | Một bộ artifact có scope L1,L3; L2 không xuất hiện trong report/export |
| 1G2T, A có nhà thầu đạt, B không đạt | Quyết định kỹ thuật có thể bao phủ A,B; mở tài chính chỉ A; B đi nhánh no-award có phê duyệt |
| 1G2T, cùng nhà thầu dự lô đã chọn và lô chờ | Chặn/ép gộp nếu mở E-HSĐXTC làm lộ tài chính lô chờ |
| Hai lô có hai nhà thầu trúng khác nhau | Lưu hai outcome hợp lệ; không yêu cầu winner toàn gói |
| Giảm giá khi trúng cả L1+L2 | Không cho phê duyệt riêng L1; giải kết quả trên nhóm L1+L2 |
| Nhà thầu chỉ đủ năng lực thực hiện một trong hai lô | Xếp hạng/trao thầu theo tổ hợp; không chọn độc lập hai lần |
| Không có nhà thầu tham dự một lô | Outcome `NO_BID`; không tự hủy cả gói |
| Tất cả không đạt kỹ thuật một lô | `NO_TECHNICAL_QUALIFIER`; không mở tài chính lô đó |
| Giá/giá đánh giá không đạt policy | `NO_FINANCIAL_QUALIFIER` hoặc xử lý tình huống; không tự tạo winner |
| Phê duyệt một số lô, số còn lại đang chấm | Gói `PARTIALLY_COMPLETED`, không `COMPLETED`/`PACKAGE_CANCELLED` |
| Reopen kỹ thuật sau mở tài chính | Vô hiệu hậu duệ của phạm vi và mở rộng theo financial-secrecy group |
| Reopen kết quả một lô | Không xóa lý do/kết quả lô khác; tạo result revision mới |
| Hai người sửa hai nhóm lô độc lập | Có thể commit song song; cùng lô hoặc cùng dependency group thì conflict |
| Export trước, dữ liệu đổi, import lại | Từ chối bằng revision/scope hash |
| Hợp đồng cho nhà thầu A | Chỉ chọn các lô mà A có result `AWARDED`, không chọn toàn gói mơ hồ |

## 14. Migration và tương thích ngược

### 14.1. Migration additive

1. Tạo bảng/cột/index mới bằng DB upgrade kế tiếp; không xóa cột cũ.
2. Backfill identity lô và `lot_id` của hồ sơ mở thầu; sinh báo cáo lỗi cho mã trống/trùng/không khớp.
3. Với metadata cũ, tạo một `LEGACY_CONSOLIDATED` batch bao phủ toàn bộ lô cho mỗi gói có cờ hoàn tất.
4. Map `soBaoCao`, `soBctdKt`, quyết định đạt kỹ thuật, `thoiGianMoEhsdxtc`, `soBctdKetQua` thành artifact legacy.
5. Map kết quả đánh giá hiện tại theo `thong_tin_mo_thau.ma_phan_lo`.
6. Map award ở `goi_thau_phan_lo` thành outcome; nếu winner cấp gói mâu thuẫn winner lô thì winner lô là dữ liệu nghiệp vụ và tạo cảnh báo reconciliation.
7. Lô không có award trong gói legacy đã “Đã có kết quả” được đánh dấu `LEGACY_OUTCOME_UNKNOWN`, không tự đoán là hủy/không đạt.

### 14.2. Cutover

- New-read-first, fallback legacy trong một giai đoạn.
- Shadow-write/projection comparison trước khi cho phép `STAGED_APPROVAL`.
- Feature flag theo tổ chức và theo phương thức; mặc định chỉ `CONSOLIDATED_APPROVAL`.
- Không bật UI mới cho người dùng thật cho đến khi toàn bộ chuỗi downstream của phương thức tương ứng đã hoàn tất; không phát hành nửa tính năng chỉ có màn đánh giá.
- Giữ đường rollback bằng cách tắt flag; không drop dữ liệu cũ ít nhất hai phiên bản ổn định.

## 15. Kế hoạch triển khai theo lát dọc

### Giai đoạn 0 — chốt nghiệp vụ và ADR

- Trả lời sáu câu hỏi pháp chế trong tài liệu nghiên cứu.
- Chuẩn hóa thuật ngữ, mode và dependency policy.
- Lấy mẫu E-HSMT/biên bản thực tế để xác nhận phạm vi mở tài chính.
- Viết ADR và fixture nghiệp vụ vàng.

Điều kiện hoàn tất: business owner + pháp chế + kỹ thuật duyệt state machine và separability matrix.

### Giai đoạn 1 — nền dữ liệu và domain service

- Ổn định lot ID, thêm FK và bảng mới.
- Viết `LotSelectionLifecycle`, command policy và projection.
- Thêm permission, optimistic concurrency, idempotency, audit.
- Viết migration/backfill/reconciliation ở chế độ dry-run.

Điều kiện hoàn tất: unit/property/DB tests xanh trên SQLite và PostgreSQL; không đổi UI production.

### Giai đoạn 2 — lưu nháp nhiều lô an toàn

- Lot board, chọn đợt, save draft theo scope.
- Excel scope manifest.
- Chế độ `CONSOLIDATED_APPROVAL` vẫn là mặc định.

Điều kiện hoàn tất: lưu L1 không đổi dữ liệu/revision L2; file ngoài scope bị từ chối.

### Giai đoạn 3 — lát dọc 1G1T

- Finalize báo cáo đánh giá -> thẩm định KQLCNT -> phê duyệt outcome lô.
- Word snapshot, timeline, partial package projection.
- Hủy/tổ chức lại/reopen theo scope.

Điều kiện hoàn tất: toàn bộ case 1G1T trong ma trận chạy end-to-end dưới feature flag.

### Giai đoạn 4 — lát dọc 1G2T

- Đánh giá kỹ thuật, báo cáo thẩm định, quyết định đạt kỹ thuật.
- Financial-secrecy dependency gate và ghi nhận mở E-HSĐXTC từ bằng chứng Hệ thống.
- Đánh giá tài chính, thẩm định/phê duyệt KQLCNT, nhánh không có nhà thầu đạt.
- Word/Excel/timeline đầy đủ cho từng artifact.

Điều kiện hoàn tất: không thể mở tài chính khi thiếu predecessor hoặc cắt ngang nhóm phụ thuộc; mixed outcome hoạt động.

### Giai đoạn 5 — hợp đồng và báo cáo tổng hợp

- Thêm chọn lô khi tạo hợp đồng và invariant contractor/result.
- Dashboard/timeline cấp gói dùng projection mới.
- Báo cáo reconciliation và export lịch sử.

### Giai đoạn 6 — rollout

- Chạy dry-run migration trên bản sao production.
- So sánh projection mới/cũ và xử lý `LEGACY_OUTCOME_UNKNOWN`.
- Pilot một tổ chức với `CONSOLIDATED_APPROVAL`, sau đó pilot `STAGED_APPROVAL` cho loại gói đã được duyệt.
- Theo dõi conflict, invalid transition, scope mismatch, artifact rendering và reconciliation drift.

## 16. Chiến lược kiểm thử

1. **Domain unit tests:** mọi transition hợp lệ/không hợp lệ của 1G1T và 1G2T.
2. **Separability/property tests:** chọn tập con bất kỳ không bao giờ được cắt dependency group; tổng kết quả không phụ thuộc thứ tự command hợp lệ.
3. **Financial tests:** nhiều winner, tổng giá partial/final, discount combination, sector policy, số tiền integer chính xác.
4. **Database tests:** FK/unique/check, optimistic lock, transaction rollback, SQLite/PostgreSQL parity.
5. **Migration tests:** fixture metadata cũ, mã lô trùng/trống, winner mâu thuẫn, gói partial không rõ outcome.
6. **API/security tests:** owner scope, role/capability, four-eyes, idempotency, stale revision và audit chain.
7. **Document tests:** snapshot bất biến, exact lot scope, bidder–lot list, watermark draft, final hash.
8. **Excel tests:** export/import cùng scope; reject tamper, stale manifest và row ngoài scope.
9. **UI integration/E2E:** chọn lô, chuyển đợt, partial state, mixed outcomes, reopen preview và unaffected-lot assertions.
10. **Contract tests:** contract scope là tập con các lô cùng winner và đúng result revision.

Mỗi test sửa/reopen phải assert rõ dữ liệu của lô ngoài phạm vi không thay đổi, thay vì chỉ assert màn hình thành công.

## 17. Tiêu chí nghiệm thu cuối

- Luồng toàn bộ lô hiện tại hoạt động như một đợt duy nhất, không mất dữ liệu.
- Có thể xử lý L1/L3 trước, L2 sau; mỗi đợt có đầy đủ report/appraisal/decision/opening/result tương ứng.
- 1G2T chỉ mở tài chính đúng bidder–lot đã được phê duyệt và không vượt financial-secrecy scope.
- Nhiều lô có nhiều nhà thầu trúng được lưu, xuất và ký hợp đồng đúng.
- Gói hiển thị hoàn tất một phần cho đến khi tất cả lô có outcome cuối.
- Không tự động hủy gói khi một hoặc nhiều lô không có winner.
- Hồ sơ final tái xuất không thay đổi dù dữ liệu sống về sau thay đổi.
- Reopen chỉ vô hiệu phạm vi/hậu duệ cần thiết và giữ audit đầy đủ.
- Migration có báo cáo đối soát; mọi bản ghi mơ hồ được đưa vào hàng chờ xử lý thủ công, không tự suy diễn.

## 18. Quyết định cần người dùng nghiệp vụ xác nhận trước khi code

1. Đơn vị muốn mặc định `CONSOLIDATED_APPROVAL` hay đã có căn cứ dùng `STAGED_APPROVAL` cho loại gói cụ thể?
2. Một báo cáo/quyết định có thể bao phủ nhiều lô tùy chọn hay bắt buộc toàn gói?
3. Với E-HSĐXTC, thao tác thực tế trên Hệ thống mạng đấu thầu quốc gia cho phép tách đến mức nào?
4. Các rule tổ hợp giảm giá/năng lực/giới hạn số lô trao thầu đang được khai báo ở đâu trong HSMT?
5. Khi không có winner ở một lô, các outcome và thẩm quyền xử lý chuẩn của đơn vị là gì?
6. Có bắt buộc tách người đánh giá, thẩm định và phê duyệt bằng rule hệ thống không?

Sau khi sáu điểm này được chốt, Giai đoạn 0 có thể chuyển thành spec/test fixtures và bắt đầu triển khai TDD.
