# PROMPT CHO CODEX — SỬA LỖI VÀ CẢI THIỆN BIDDINGFLOW

## 0. Vai trò và mục tiêu

Bạn đang làm việc trong repository **BiddingFlow**:

```text
https://github.com/newstar94/Bidding
```

Hãy nghiên cứu **code mới nhất của nhánh hiện tại**, không giả định số dòng hoặc cấu trúc vẫn giống báo cáo cũ. Báo cáo rà soát làm cơ sở cho nhiệm vụ này:

```text
BAO_CAO_RA_SOAT_CODE_BIDDINGFLOW_2026-08-04.md
```

Commit được dùng khi lập báo cáo:

```text
e2196fb1e9e116fa11fa6de62843c361c3497cf2
```

Mục tiêu của nhiệm vụ:

1. Xác minh lại từng lỗi trên code mới nhất.
2. Sửa các lỗi có thể tái hiện.
3. Cải thiện độ an toàn, tính đúng đắn nghiệp vụ, vòng đời artifact, khả năng bảo toàn workbook và khả năng bảo trì.
4. Bổ sung test hồi quy đầy đủ.
5. Làm cho các quality gate và CI liên quan chạy thành công.
6. Không thay đổi hành vi nghiệp vụ ngoài phạm vi nếu chưa có căn cứ.
7. Không chỉ viết kế hoạch hoặc pseudocode; phải sửa code thật.

Không được tuyên bố đã sửa hoặc test đã pass nếu chưa thực sự chạy và kiểm chứng.

---

# 1. Nguyên tắc làm việc bắt buộc

## 1.1 Trước khi sửa code

Thực hiện lần lượt:

1. Đọc `README.md`, `pyproject.toml`, `package.json`.
2. Đọc workflow:
   - `.github/workflows/ci.yml`
   - `.github/workflows/n-plus-one-regressions.yml`
   - các workflow bảo mật/package liên quan.
3. Đọc toàn bộ module liên quan:
   - `backend/documents/award_result_excel_service.py`
   - `backend/documents/award_result_excel_routes.py`
   - `backend/documents/document_worker_entry.py`
   - `backend/documents/archive_validation.py`
   - `backend/documents/excel_workbook_builder.py`
   - các module entitlement/RBAC/audit/artifact hiện có.
4. Đọc frontend:
   - `frontend/packages/detail/AwardResultExcelExport.js`
   - API client và cơ chế xử lý 401/403 hiện hành.
5. Đọc test:
   - `tests/test_award_result_excel_service.py`
   - `tests/test_award_result_excel_routes.py`
   - các test document worker, security, RBAC, artifact và frontend liên quan.
6. Tìm kiếm toàn repository để xác định:
   - mọi nơi ghi text vào Excel;
   - mọi mapping trạng thái/outcome;
   - mọi nơi tạo, đọc, cleanup validation artifact;
   - mọi entitlement export Word/Excel;
   - convention HTTP 401/403;
   - các helper đã tồn tại để tránh tạo logic trùng lặp.

Sau khi đọc, hãy viết một bản tóm tắt ngắn trong output làm việc:

- Kiến trúc hiện tại.
- Những lỗi còn tồn tại.
- Những lỗi đã được sửa ở commit mới hơn.
- Kế hoạch thay đổi theo file.

Không dừng lại sau bước này.

## 1.2 Giữ tương thích kiến trúc

- Không thêm framework frontend mới.
- Không thay Starlette, PostgreSQL, Vite hoặc document worker nếu không cần.
- Ưu tiên tái sử dụng helper, policy, audit, artifact store và worker hiện có.
- Không nhồi thêm logic vào `backend/app.py`.
- Không tạo nguồn dữ liệu kết quả lựa chọn nhà thầu thứ hai.
- Không thêm dependency mới nếu thư viện hiện tại đủ dùng.
- Mọi thay đổi database phải có migration, rollback hợp lý và test migration.
- Mọi thay đổi contract API phải cập nhật frontend và test.
- Giữ multi-tenancy, ownership, RBAC, audit và document sandbox.

## 1.3 Thứ tự ưu tiên

Triển khai theo thứ tự:

```text
P0 → P1 → P2 → P3 → refactor có kiểm soát
```

Nếu một lỗi trong báo cáo không còn tồn tại, phải:

1. Chỉ ra commit/code đã sửa.
2. Thêm hoặc xác nhận test hồi quy tương ứng.
3. Không sửa lại một cách không cần thiết.

---

# 2. P0 — Khôi phục Full CI

## BF-001 — Full CI đang thất bại

### Yêu cầu

1. Chạy đúng các command mà workflow CI sử dụng.
2. Xác định chính xác step đầu tiên thất bại.
3. Sửa nguyên nhân gốc, không:
   - bỏ test;
   - hạ quality gate;
   - thêm `continue-on-error`;
   - che lỗi bằng catch rộng;
   - vô hiệu hóa audit/security/build check.
4. Tách workflow `Full CI` thành các step rõ ràng nếu hiện vẫn gom quá nhiều lệnh trong một step.

Các step nên phân biệt tối thiểu:

- Python compile.
- Python lint/quality.
- ESLint/Trusted Types.
- Frontend debt gate.
- Python tests.
- JavaScript tests.
- Secure build.
- FK/index audit.
- Production package validation.
- SBOM.
- E2E.
- Dependency audit.

### Artifact khi CI thất bại

Cấu hình upload bằng `if: always()` cho các file có thể sinh ra:

- pytest JUnit XML;
- coverage XML/JSON;
- JavaScript test report;
- E2E log/screenshot/trace;
- build log;
- package validation log;
- dependency audit output.

Không upload secret hoặc nội dung nhạy cảm.

### Tiêu chí nghiệm thu

- Command CI chính chạy thành công trong môi trường repository.
- Workflow YAML hợp lệ.
- Không hạ mức kiểm tra hiện có.
- Báo cáo cuối nêu rõ nguyên nhân CI cũ thất bại và cách đã sửa.

---

# 3. P1 — Sửa lỗi bảo mật và tính đúng đắn

## BF-002 — Chặn spreadsheet formula injection

### Hiện tượng cần kiểm tra

Các trường text được ghi vào Excel có thể bắt đầu bằng:

```text
=
+
-
@
TAB
CR
LF
```

Openpyxl có thể lưu chuỗi bắt đầu bằng `=` thành formula.

### Yêu cầu triển khai

1. Tìm helper hiện có như `_safe_spreadsheet_text()` trong:
   - `backend/documents/excel_workbook_builder.py`
   - hoặc module tương đương.
2. Di chuyển hoặc tái cấu trúc thành helper dùng chung, ví dụ:

```text
backend/documents/spreadsheet_security.py
```

3. Áp dụng cho **mọi text không đáng tin cậy** lấy từ database hoặc input trước khi ghi vào workbook.
4. Không áp dụng sanitizer lên:
   - giá trị số;
   - `Decimal`;
   - ngày tháng;
   - công thức có sẵn trong template ngoài phạm vi cập nhật.
5. Không làm mất nội dung người dùng. Có thể dùng tiền tố apostrophe hoặc cơ chế an toàn tương thích Excel, nhưng phải test khi mở lại workbook.
6. Kiểm tra cả:
   - dấu cách trước ký tự nguy hiểm;
   - Unicode full-width/compatibility nếu có khả năng bypass;
   - tab, CR, LF ở đầu chuỗi.

### Test bắt buộc

Parametrize ít nhất:

```text
=1+1
+SUM(A1:A2)
-1+1
@SUM(A1:A2)
\t=1+1
\r=1+1
\n=1+1
 =1+1
```

Xác nhận:

- ô không có `data_type == "f"`;
- giá trị được hiển thị như text;
- công thức có sẵn ngoài vùng ghi vẫn không đổi;
- numeric cell vẫn là numeric;
- không phá number format.

---

## BF-003 — Mapping đúng trạng thái phần/lô bị hủy hoặc không lựa chọn được nhà thầu

### Vấn đề

Các outcome như:

```text
CANCELLED_LOT
REPROCUREMENT_REQUIRED
NO_BID
NO_TECHNICAL_QUALIFIER
NO_FINANCIAL_QUALIFIER
NO_RESPONSIVE_BID
OTHER_APPROVED_OUTCOME
```

không được phép mặc định xuất thành `"Không trúng thầu"` nếu bản chất là hủy lô hoặc không lựa chọn được nhà thầu.

### Yêu cầu

1. Tìm contract nghiệp vụ hiện có và data validation thực tế trong mẫu muasamcong.
2. Tạo domain enum hoặc mapping trung tâm, ví dụ:

```text
LotApprovedOutcome
BidderAwardStatus
ExternalPortalResultStatus
```

3. Tạo mapping tường minh từ outcome nội bộ sang:
   - trạng thái cột kết quả;
   - lý do;
   - các trường được phép/không được phép điền.
4. Không rải string literal ở service, route và frontend.
5. Nếu mẫu muasamcong chỉ chấp nhận tập giá trị giới hạn, phải lấy đúng giá trị từ:
   - data validation của workbook;
   - tài liệu nghiệp vụ trong repository;
   - fixture mẫu thực tế.
6. Lô bị hủy phải phân biệt được với:
   - nhà thầu không trúng trong một lô có người trúng;
   - không có nhà thầu tham dự;
   - không có nhà thầu đạt kỹ thuật;
   - cần tổ chức lại.

### Test bắt buộc

- Một test cho từng outcome.
- Lô hủy không bị xuất như nhà thầu thua thông thường.
- Lý do outcome được điền đúng.
- Giá trúng thầu để trống khi không có award.
- Không tự suy luận trạng thái khi outcome chưa rõ.
- Test data validation chấp nhận giá trị được ghi.

Nếu chưa đủ căn cứ để chọn wording chính thức, dùng enum nội bộ và cấu hình mapping rõ ràng; ghi giả định trong báo cáo cuối, không tự sáng tác dữ liệu pháp lý.

---

## BF-004 — Bảo toàn workbook ở cấp OOXML

### Mục tiêu

Cam kết thực tế:

```text
Chỉ các ô được phép trong G–O thay đổi.
Không đổi thứ tự dòng.
Không đổi A–F.
Không làm mất thành phần OOXML không liên quan.
```

### Việc phải làm

Trước tiên, đánh giá hai hướng:

#### Hướng A — Patch XML tối thiểu

Ưu tiên nếu khả thi:

- Giữ nguyên mọi ZIP entry byte-for-byte.
- Chỉ sửa worksheet XML/shared strings cần thiết.
- Không tái ghi toàn workbook bằng openpyxl.
- Copy nguyên mọi entry ngoài allowlist.

#### Hướng B — Contract workbook giới hạn

Chỉ dùng nếu hướng A chưa phù hợp:

- Phát hiện và từ chối workbook có unsupported parts.
- Công bố rõ phần OOXML được hỗ trợ.
- So sánh ZIP entry trước/sau.
- Không khẳng định “chỉ G–O thay đổi” nếu không chứng minh được.

### Yêu cầu kỹ thuật

1. Tạo archive manifest trước và sau:
   - danh sách ZIP entry;
   - SHA-256 từng entry;
   - content type;
   - relationship.
2. Tạo allowlist entry được phép thay đổi.
3. Với worksheet XML:
   - kiểm tra chỉ đúng tọa độ ô cho phép thay đổi;
   - row order không đổi;
   - cell ngoài vùng cho phép không đổi.
4. Dùng fixture là file Excel/muasamcong thực tế, không chỉ workbook do openpyxl tự tạo.
5. Giữ:
   - sheet order/name/state;
   - hidden rows/columns/sheets;
   - merged cells;
   - data validation;
   - formula ngoài vùng ghi;
   - print area;
   - freeze panes;
   - page setup;
   - widths/heights;
   - defined names;
   - charts/images/relationships;
   - custom XML hoặc từ chối có thông báo rõ.

### Test bắt buộc

```text
ZIP entry set trước == sau
SHA-256 mọi entry ngoài allowlist trước == sau
A–F từng dòng trước == sau
row fingerprint và vị trí trước == sau
chỉ đúng G–O được phép đổi
file đầu ra mở lại được
file nguồn không bị ghi đè
```

Không sửa metadata/document properties chỉ để làm test pass nếu điều đó che mất thay đổi ngoài ý muốn.

---

## BF-005 — Hỗ trợ nhiều mặt hàng thuốc cho cùng nhà thầu/phần lô

### Vấn đề

Matching hiện chỉ dựa vào:

```text
phần/lô + bidder identifier
phần/lô + tax code
```

nên không phân biệt nhiều thuốc/hàng hóa của cùng nhà thầu trong một lô.

### Yêu cầu

1. Xác định entity/ID ổn định hiện có cho hàng hóa:
   - `goi_thau_hang_hoa_id`;
   - mã thuốc/mã hàng;
   - ID item;
   - hoặc STT được liên kết chính thức.
2. Dataset cho mẫu thuốc phải ở cấp:

```text
package + lot + bidder + goods item
```

3. Không dùng tên hoạt chất làm khóa duy nhất nếu có ID tốt hơn.
4. Matching phải phát hiện:
   - một dòng → nhiều item;
   - một item → nhiều dòng;
   - trùng STT;
   - thiếu ID;
   - sai đơn vị/quy cách.
5. Tính số lượng và đơn giá theo từng hàng.
6. Kiểm tra tổng:

```text
sum(quantity × unit_price)
```

với giá trúng của phần/lô theo quy tắc làm tròn hiện có.
7. Không dùng float cho tiền.

### Test bắt buộc

- Hai mặt hàng cùng bidder/lot.
- Hai bidder cho cùng thuốc.
- Trùng STT.
- Thiếu goods ID.
- Nhiều đơn vị tính.
- Chênh tổng item với giá trúng.
- Một item bị match hai lần.
- Không thay đổi row order của mẫu.

Nếu domain hiện chưa có khóa ổn định, bổ sung migration và contract rõ ràng; không ghép mơ hồ bằng tên.

---

# 4. P2 — Sửa lỗi chức năng, artifact và scale

## BF-006 — Không cho export khi không có dòng có thể ghi

### Yêu cầu

Bổ sung metrics:

```text
totalRows
matchedRows
approvedRows
writableRows
updatedRows
```

Quy tắc:

- `writableRows == 0`:
  - blocking error `NO_APPROVED_RESULT_TO_EXPORT`;
  - `canExport = false`;
  - không tạo export job;
  - không trả thông báo thành công.
- Một số dòng chưa duyệt:
  - warning;
  - hiển thị rõ số dòng sẽ được cập nhật.
- Export API phải kiểm tra `updates` không rỗng.
- Audit phải ghi đúng `updatedRows`.

### Test

- Tất cả record `status=None`.
- Một phần approved, một phần chưa approved.
- Match thành công nhưng không có trường nào thay đổi.
- Export audit đúng số dòng.
- UI disable nút export khi `writableRows == 0`.

---

## BF-007 — Sửa vòng đời validation artifact, cleanup và quota

### Yêu cầu

1. **Không lưu artifact khi có blocking error**, trừ khi có use case được ghi rõ.
2. Nếu vẫn cần lưu:
   - token phải được trả;
   - có endpoint hủy;
   - UI consume/hủy khi đóng.
3. Cleanup:
   - không dùng `list(glob)[:limit]` không sắp xếp;
   - đọc metadata theo batch;
   - ưu tiên `expiresAt` hoặc mtime cũ nhất;
   - xử lý metadata hỏng an toàn;
   - không để entry hết hạn bị starvation.
4. Tạo janitor định kỳ độc lập request.
5. Thêm quota:
   - số artifact/user;
   - byte/user;
   - số artifact/organization;
   - byte/organization;
   - global disk watermark.
6. Tạo metrics:
   - artifact count;
   - total bytes;
   - expired count;
   - cleanup failures;
   - quota rejections.
7. Dùng atomic write:
   - file tạm;
   - fsync nếu cơ chế hiện tại yêu cầu;
   - atomic rename.
8. Chống race giữa:
   - validate;
   - export;
   - cleanup;
   - consume/delete.
9. Không log nội dung workbook hoặc token đầy đủ.

### Test

- Blocking validation không tạo artifact.
- Expired artifact nằm sau 128 entry vẫn bị xóa.
- Metadata hỏng.
- Cleanup đang chạy đồng thời với export.
- Quota user/org/global.
- Partial write/crash không tạo artifact hợp lệ giả.
- Token consumed không dùng lại được nếu contract là one-time.
- Cleanup không xóa artifact đang export.

---

## BF-008 — Hoàn thiện mapping các trường nghiệp vụ

### Yêu cầu

Tạo domain mapping tập trung cho:

| Cột mẫu | Nguồn chuẩn | Điều kiện |
|---|---|---|
| Kết quả | quyết định/phê duyệt outcome | từng phần/lô và nhà thầu |
| Giá sau hiệu chỉnh | dữ liệu đánh giá/phê duyệt | khi có |
| Điểm kỹ thuật | đánh giá kỹ thuật | khi phương pháp áp dụng |
| Giá đánh giá | đánh giá tài chính | khi phương pháp áp dụng |
| Giá trúng | quyết định phê duyệt | chỉ winner |
| Lý do | kết luận đánh giá/outcome | không trúng/hủy |
| Thời gian gói thầu | kết quả phê duyệt | theo contract |
| Thời gian hợp đồng | kết quả/hợp đồng | theo contract |
| Nội dung khác | kết luận/ghi chú được duyệt | khi có |

### Yêu cầu kỹ thuật

- Không select trường rồi bỏ không dùng mà không có lý do.
- Xác nhận nguồn chuẩn của `thoi_gian_thuc_hien`.
- `other_content` phải được map nếu có dữ liệu.
- `lot_cancelled` phải tác động tới output.
- Dùng `Decimal`.
- Không để logic rải trong SQL writer.

### Test

- Winner.
- Non-winner.
- Cancelled lot.
- Technical fail.
- Financial fail.
- Missing optional field.
- Có `danh_gia_ket_luan`.
- Nguồn thời gian khác nhau và precedence đúng.

---

## BF-009 — Chuẩn hóa mã phần/lô nhất quán

### Yêu cầu

1. Tạo một hàm chuẩn hóa canonical duy nhất cho:
   - Python;
   - điểm nhập dữ liệu;
   - query/matching;
   - migration/backfill.
2. Nếu cần, thêm column:

```text
ma_phan_lo_normalized
```

3. Tạo index/unique phù hợp theo package/organization.
4. Không dùng SQL `lower(trim())` như bản tương đương của NFKC/casefold.
5. Backfill dữ liệu cũ và phát hiện collision trước khi thêm unique.
6. Không làm mất số 0 ở đầu.
7. Chốt cách xử lý `"001.0"` và `"001"`.

### Test

- Unicode NFKC.
- Full-width.
- Casefold khác lower.
- NBSP và Unicode whitespace.
- `001`.
- `001.0`.
- Collision khi backfill.
- Foreign lot detection dùng cùng canonical value.

---

## BF-010 — Artifact store dùng được khi có nhiều replica

### Yêu cầu

Đánh giá deployment hiện tại.

Nếu hệ thống **chỉ hỗ trợ một web replica**:

- ghi rõ constraint;
- thêm startup/readiness validation;
- từ chối cấu hình scale ngang với local artifact store;
- document trong README/deploy runbook.

Nếu cần scale ngang:

- chuyển artifact sang shared private storage;
- lưu metadata bền vững;
- token tham chiếu artifact;
- kiểm tra user/org/package/hash;
- encryption at rest theo hạ tầng;
- cleanup/quota dùng chung;
- không phụ thuộc sticky session.

### Test

- Validate ở instance A, export ở instance B.
- Restart giữa validate và export.
- Concurrent consume.
- Artifact không truy cập chéo organization.

Không triển khai abstraction quá lớn nếu sản phẩm hiện chỉ chạy single-instance; nhưng phải fail-safe và document rõ.

---

## BF-011 — Giảm kích thước response và thêm preview phân trang

### Backend

- Response validate mặc định chỉ gồm:
  - summary;
  - blocking errors;
  - warning summary;
  - page đầu issue/preview.
- Tạo endpoint phân trang cho rows/issues.
- Không lặp cùng warning ở top-level và từng row nếu không cần.
- Giới hạn page size.
- Có filter theo:
  - status;
  - warning;
  - match method;
  - writable.
- Có thể tải báo cáo đối chiếu riêng.

### Frontend

Hiển thị bảng preview:

| Dòng | Phần/lô | Nhà thầu | Match | Giá trị cũ | Giá trị mới | Cảnh báo |
|---:|---|---|---|---|---|---|

- Pagination hoặc virtualized list.
- Hiển thị “còn N dòng”.
- Không render hàng nghìn `<li>`.
- Người dùng biết chính xác số dòng sẽ được cập nhật.
- Không thay đổi A–F trong file.

### Test

- 10.000 rows.
- Response summary không quá lớn bất hợp lý.
- Pagination ổn định.
- Filter.
- Không leak row thuộc package khác.
- Frontend không freeze với nhiều issue.

---

## BF-012 — Tách entitlement Word và Excel

### Yêu cầu

Thay tên policy dựa theo format bằng capability rõ ràng:

```text
document.export.word
document.export.excel
document.export.award_result_excel
```

Hoặc API tổng quát:

```python
can_use_document_export(
    ...,
    format="xlsx",
    feature="award_result",
)
```

### Điều kiện

- Tương thích dữ liệu subscription hiện tại.
- Migration/backfill nếu capability được lưu DB.
- Backend là nguồn quyết định cuối.
- Frontend chỉ dùng để ẩn/disable UI.
- Error code thống nhất.
- Không để Excel phụ thuộc tên hàm `can_use_word_export`.

### Test matrix

- Super admin.
- Organization manager.
- Employee.
- Personal workspace.
- Gói không có entitlement.
- Word có nhưng Excel không.
- Excel có nhưng award-result Excel không.
- Cross-organization.

---

# 5. P3 — Chuẩn hóa API, frontend và workflow

## BF-013 — Dùng đúng 401 và 403

### Yêu cầu

- Session thiếu/hết hạn → HTTP 401, error code `AUTH_REQUIRED`.
- Đã đăng nhập nhưng thiếu quyền → HTTP 403.
- Subscription/entitlement thiếu → 403 với code riêng.
- Đồng bộ convention với API còn lại.
- Frontend phải:
  - mở luồng đăng nhập/refresh khi 401;
  - hiển thị thiếu quyền khi 403;
  - không coi mọi 403 là session timeout.

### Test

- Validate khi chưa đăng nhập.
- Export khi session hết hạn.
- User không có quyền.
- User không có entitlement.
- Frontend action tương ứng.

---

## BF-014 — Tránh race khi revoke Object URL

Sửa:

```javascript
anchor.click();
anchor.remove();
URL.revokeObjectURL(objectUrl);
```

thành cơ chế revoke ở task sau hoặc sau khi browser đã nhận download.

Test hoặc ít nhất unit/browser test phải xác nhận:

- download được trigger;
- URL được revoke;
- không leak URL lâu dài;
- không revoke trước click.

---

## BF-015 — Nâng version GitHub Actions

- Đồng bộ action version giữa các workflow.
- Nâng action cũ đang target Node 20 lên version tương thích Node 24.
- Ưu tiên pin full commit SHA nếu policy repository dùng pinning.
- Không làm mất Dependabot hoặc supply-chain gate.
- Chạy actionlint/yamllint nếu có.

---

# 6. Refactor có kiểm soát

Không thực hiện một “big bang rewrite”. Refactor quanh phần đang sửa.

## 6.1 Tách module Excel

Mục tiêu cấu trúc:

```text
backend/documents/award_result_excel/
├── __init__.py
├── types.py
├── templates.py
├── normalization.py
├── inspection.py
├── matching.py
├── dataset.py
├── mapping.py
├── writer.py
├── preservation.py
├── artifacts.py
├── service.py
└── routes.py
```

Có thể điều chỉnh theo convention repository, nhưng phải tách rõ:

- domain types;
- workbook inspection;
- matching;
- dataset/query;
- business mapping;
- workbook writer;
- archive preservation;
- artifact lifecycle;
- HTTP adapter.

### Điều kiện refactor

- Không đổi API ngoài thay đổi có chủ đích.
- Giữ compatibility import tạm thời nếu test/module khác đang import file cũ.
- Không tạo circular import.
- Route phải mỏng.
- Query tránh N+1.
- Mỗi module có test trực tiếp.

## 6.2 Status enum và mapping trung tâm

Tạo enum/domain object thay string literal rải rác:

```text
PackageLifecycleStatus
LotApprovedOutcome
BidderAwardStatus
ExternalPortalResultStatus
```

- Có parser cho legacy value.
- Có validation unknown value.
- Có mapping một chiều.
- Không silent fallback sang “Không trúng thầu”.

## 6.3 API contract

- Định nghĩa schema rõ ràng cho validation summary, row preview, issue và export.
- Có version cho artifact metadata/manifest.
- Có thể dùng OpenAPI/JSON Schema/JSDoc theo công cụ hiện có.
- Không bắt buộc chuyển toàn frontend sang TypeScript.
- Frontend phải kiểm tra shape tối thiểu ở boundary.

---

# 7. Quality gate cần cải thiện

## 7.1 Python lint

Không hạ baseline hiện có.

- Code mới không được thêm:
  - `BLE001`;
  - `F401`;
  - `F841`;
  - `S110`;
  - SQL động không có allowlist/justification.
- Bật rule tăng dần cho module mới:
  - `E`;
  - `F`;
  - `I`;
  - `UP`;
  - `B`;
  - `SIM`;
  - `RUF`.
- Thêm type checking cho module Excel mới nếu repository đã có hoặc có thể thêm nhẹ:
  - pyright hoặc mypy.
- Không thêm dependency type checker nếu ảnh hưởng quá lớn; có thể dùng cấu hình scoped.

## 7.2 Coverage

- Không hạ `--cov-fail-under`.
- Thêm diff coverage cho code mới nếu hạ tầng hiện có hỗ trợ.
- Mục tiêu branch coverage cao cho:
  - spreadsheet security;
  - outcome mapping;
  - artifact lifecycle;
  - ownership/RBAC;
  - workbook preservation;
  - medicine matching.
- Test failure path, không chỉ happy path.

## 7.3 Frontend debt

Trong code mới:

- Không thêm raw color ngoài token.
- Không thêm `!important` nếu tránh được.
- Không thêm direct write vào `model.state`.
- Không thêm runtime inline style nếu class/state có thể dùng.
- Mutation nghiệp vụ phải đi qua API/model command phù hợp.

---

# 8. Tính năng nền tảng nên bổ sung trong cùng phạm vi

Chỉ triển khai các mục dưới đây sau khi P0/P1/P2 đã ổn định.

## 8.1 Preview/diff trước khi xuất

Phải hiển thị:

- dòng Excel;
- phần/lô;
- bidder;
- phương pháp match;
- cột;
- giá trị cũ;
- giá trị mới;
- nguồn dữ liệu;
- cảnh báo.

Cho phép xác nhận export nhưng không cho frontend gửi giá trị nghiệp vụ để backend tin trực tiếp. Backend phải đọc lại dữ liệu từ DB lúc export.

## 8.2 Data-readiness gate

Trước export, đánh giá:

- quyết định đã phê duyệt;
- winner hợp lệ;
- giá trúng;
- giá sau hiệu chỉnh;
- lý do non-winner;
- outcome/lý do lô hủy;
- thời gian thực hiện;
- tổng item thuốc.

Có đường dẫn từ lỗi tới màn hình dữ liệu cần sửa nếu kiến trúc UI hỗ trợ.

## 8.3 Template registry/versioning

Tạo registry cho:

- loại mẫu;
- fingerprint;
- phiên bản;
- header aliases;
- data validation;
- vùng được ghi;
- unsupported OOXML part;
- tập trạng thái được phép.

Mẫu không nhận diện được phải báo:

```text
UNSUPPORTED_TEMPLATE_VERSION
```

không được cố đoán.

## 8.4 Báo cáo đối chiếu

Cho tải file:

```text
<ten-file>_bao_cao_doi_chieu.xlsx
```

Có:

- hash file nguồn;
- package;
- user;
- thời gian;
- exact/fallback/manual/unmatched;
- warning;
- updated rows;
- source fields.

Không bắt buộc làm manual mapping trong nhiệm vụ này nếu phạm vi quá lớn, nhưng kiến trúc preview phải không cản trở việc bổ sung sau.

---

# 9. Test suite bắt buộc

## 9.1 Unit

- Spreadsheet sanitizer.
- Normalization.
- Outcome mapping.
- Award field mapping.
- Writable row calculation.
- Artifact expiry/quota.
- Medicine item key.
- Filename sanitization.
- Validation token scope/hash/expiry.

## 9.2 Workbook/OOXML

- A–F không đổi.
- Row order không đổi.
- Row count không đổi.
- Chỉ G–O được phép đổi.
- Style/number format/data validation không đổi.
- Formula ngoài vùng ghi không đổi.
- Hidden sheet/row/column.
- Merged cells.
- Defined names.
- Charts/images/relationships.
- ZIP entries ngoài allowlist byte-identical hoặc hash-identical.
- File gốc không bị ghi đè.

## 9.3 API

- 401 chưa đăng nhập.
- 403 thiếu quyền.
- 403 thiếu entitlement.
- Cross-organization.
- File sai định dạng.
- Zip bomb/path traversal/external links.
- Unsupported template.
- Blocking error không tạo artifact.
- No writable rows.
- Token hết hạn.
- Token user/org/package khác.
- Token hash mismatch.
- Export thành công.
- Audit chính xác.
- Pagination/filter rows.

## 9.4 Integration

Tạo package nhiều lô:

- winner lô 1;
- non-winner lô 1;
- cùng bidder không trúng lô 2;
- lô `NO_BID`;
- lô `NO_TECHNICAL_QUALIFIER`;
- một result chưa approved;
- nhiều item thuốc cùng bidder/lot;
- fallback tax code;
- identifier/tax-code conflict;
- text bắt đầu bằng công thức.

Xuất workbook và đọc lại để xác nhận đúng từng dòng.

## 9.5 Frontend

- Upload.
- Summary.
- Preview pagination.
- Blocking error.
- `writableRows == 0`.
- Partial writable rows.
- 401.
- 403.
- Download.
- Object URL lifecycle.
- Không gửi result data cho backend.
- Không freeze với nhiều warning.

## 9.6 CI

Chạy tối thiểu:

```bash
python -m compileall backend tests scripts
npm run check
```

Ngoài ra chạy các command riêng nếu `npm run check` không bao gồm đầy đủ:

```bash
pytest
npm test
npm run lint
npm run build
```

Dùng đúng command thực tế trong repository. Không bịa tên script.

---

# 10. Tiêu chí nghiệm thu tổng thể

Nhiệm vụ chỉ hoàn thành khi:

1. Full CI liên quan chạy xanh.
2. Formula injection bị chặn bằng test.
3. Outcome hủy/không lựa chọn được nhà thầu được map đúng.
4. Export bị chặn khi `writableRows == 0`.
5. Blocking validation không để lại artifact rác.
6. Cleanup không starvation và có test.
7. Artifact có quota hoặc ít nhất cơ chế giới hạn rõ ràng.
8. Workbook preservation được chứng minh bằng archive diff hoặc contract giới hạn.
9. Mẫu thuốc hỗ trợ nhiều item hoặc hệ thống chặn rõ với lỗi có căn cứ; không map sai.
10. Các trường nghiệp vụ được map từ nguồn chuẩn.
11. Chuẩn hóa mã dùng cùng một contract.
12. 401/403 đúng ngữ nghĩa.
13. Entitlement Excel không phụ thuộc tên quyền Word.
14. UI hiển thị số dòng thực sự sẽ ghi.
15. Audit ghi đúng số dòng và scope.
16. Không đổi A–F, row order hoặc file nguồn.
17. Các test cũ không bị hỏng.
18. Không hạ quality gate.
19. Không thêm secret hoặc dữ liệu nhạy cảm vào log.
20. Tài liệu vận hành và API được cập nhật.

---

# 11. Cách xử lý khi yêu cầu quá lớn

Không được bỏ qua P0/P1 để làm tính năng đẹp.

Thực hiện theo các PR/commit logic:

## Nhóm A — Bắt buộc trước phát hành

- BF-001.
- BF-002.
- BF-003.
- BF-006.
- BF-007 phần không tạo artifact khi block + cleanup starvation.
- Regression tests.

## Nhóm B — Độ tin cậy workbook và nghiệp vụ

- BF-004.
- BF-005.
- BF-008.
- BF-009.

## Nhóm C — Kiến trúc và scale

- BF-010.
- BF-011.
- BF-012.
- BF-013.
- BF-014.
- BF-015.
- Refactor module.

## Nhóm D — UX nền tảng

- Preview/diff.
- Data-readiness.
- Template registry.
- Báo cáo đối chiếu.

Nếu không thể hoàn tất tất cả trong một lần:

- phải hoàn tất Nhóm A;
- tiếp tục tối đa phần còn lại có thể kiểm chứng;
- ghi rõ phần chưa hoàn tất;
- không để code ở trạng thái nửa triển khai;
- không hứa làm sau;
- không đánh dấu TODO thay cho chức năng bắt buộc.

---

# 12. Báo cáo cuối cùng Codex phải trả

Sau khi hoàn thành, xuất báo cáo theo cấu trúc:

## A. Mốc code

- Branch.
- Commit ban đầu.
- Commit cuối.
- Môi trường chạy test.

## B. Lỗi đã xác minh

Bảng:

| ID | Còn tồn tại? | Nguyên nhân | Cách sửa | Test |
|---|---|---|---|---|

Bao gồm BF-001 đến BF-015.

## C. File đã sửa/thêm

Mỗi file:

- lý do;
- thay đổi chính;
- compatibility impact.

## D. API/DB/UI

- Endpoint thay đổi.
- Schema/migration.
- Error codes.
- Entitlement.
- Preview/pagination.
- Audit.

## E. Workbook preservation

Chứng minh:

- row order;
- A–F;
- vùng thay đổi;
- ZIP allowlist;
- fixture thực tế;
- source file không đổi.

## F. Kết quả test

Ghi command và kết quả thật:

```text
<command>
PASS/FAIL
```

Nêu:

- số test;
- coverage;
- test không chạy được;
- lý do;
- log/artifact liên quan.

## G. CI

- Nguyên nhân Full CI cũ thất bại.
- Step đã sửa.
- Trạng thái sau sửa.

## H. Giả định nghiệp vụ

Liệt kê các wording/status hoặc nguồn dữ liệu cần chủ sản phẩm xác nhận.

## I. Rủi ro còn lại

Không che giấu:

- unsupported OOXML;
- single-replica constraint;
- migration risk;
- feature chưa hoàn tất.

Không được viết “tất cả đã hoàn thành” nếu còn test fail hoặc mục bắt buộc chưa xong.
