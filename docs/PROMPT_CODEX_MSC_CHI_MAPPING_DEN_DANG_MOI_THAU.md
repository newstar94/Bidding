# PROMPT CHO CODEX — TÁCH DỮ LIỆU NGUỒN MUA SẮM CÔNG VÀ GIAI ĐOẠN NGHIỆP VỤ BIDDING

## 0. Baseline

Repository:

`https://github.com/newstar94/Bidding`

Baseline đã rà soát:

`a6daeb115a2b56d6d2d90f7662c6214888eac7b8`

Trước khi sửa, phải pull/check HEAD mới nhất, chạy `git status --short`, không reset thay đổi của người dùng, và revalidate toàn bộ finding nếu HEAD đã thay đổi.

## 1. Mục tiêu nghiệp vụ

Khi thêm mới kế hoạch/gói thầu bằng dữ liệu từ Mua Sắm Công:

- vẫn fetch và lưu giữ đầy đủ dữ liệu Mua Sắm Công trả về;
- nhưng local business workflow của Bidding chỉ materialize tối đa đến `INVITED` / **Đang mời thầu**;
- không được vì upstream đã mở thầu, đang xét thầu hoặc đã có kết quả mà tự động đưa Bidding sang các giai đoạn sau;
- không tự tạo record mở thầu/chấm thầu/kết quả/hợp đồng;
- tùy chọn **Thẩm định HSMT** của gói mới import mặc định là **Không**;
- nếu người dùng muốn chuyển sang **Đang chấm thầu**, phải thực hiện thao tác **Mở thầu** trong Bidding;
- tại màn Biên bản mở thầu, người dùng có thể tùy chọn **Lấy dữ liệu Mua Sắm Công** để prefill thông tin đã được source trả về;
- chỉ khi người dùng kiểm tra và **Lưu thông tin mở thầu** thì Bidding mới tạo dữ liệu mở thầu và chuyển trạng thái sang **Đang chấm thầu**.

Nguyên tắc:

> **Mua Sắm Công cung cấp dữ liệu/evidence; Bidding kiểm soát tiến trình nghiệp vụ.**

## 2. Tách hai khái niệm trạng thái

Phải tách rõ:

### A. Source observed lifecycle

Là trạng thái thật quan sát từ Mua Sắm Công, ví dụ:

`OPEN_BID`, `DANG XET THAU`, `DANG CHAM THAU`, `AWARDED`, `CANCELLED`.

Phải giữ nguyên ở raw/canonical/provenance. Không được làm mất hay giả thành INVITED.

Có thể tiếp tục dùng `derive_import_lifecycle_status()` như diễn giải trạng thái nguồn.

### B. Local Bidding workflow lifecycle

Là trạng thái Bidding cho phép workflow đã đi tới.

Trong source-driven import:

`maximum initial local lifecycle = INVITED`

Không được tự set local:

- `OPENED`
- `EVALUATING`
- `PARTIALLY_AWARDED`
- `AWARDED`
- `CANCELLED`

chỉ vì source đã có trạng thái đó.

## 3. Hiện trạng cần sửa

### 3.1 `backend/procurement_import/domain.py`

`derive_import_lifecycle_status(package)` hiện có thể trả:

- `DANG XET THAU` / `DANG CHAM THAU` → `EVALUATING`
- `DXT` → `EVALUATING`
- `OPEN_BID` / `OPEN_DXKT` / `OPEN_DXTC` → `OPENED`
- `PUB_DSNTKT` → `EVALUATING`

Đây là source observation hợp lệ nhưng không được dùng trực tiếp làm local workflow status cho package mới import.

Tạo một policy/helper tập trung riêng, ví dụ:

`project_source_lifecycle_to_bidding(...)`

Không rải logic status ở nhiều file.

## 4. Policy local status bắt buộc

- Chưa có exact linked TBMT / chưa đủ evidence đăng mời thầu: giữ `PREPARING` hoặc `UNKNOWN` theo contract hiện tại.
- TBMT đã publish / trạng thái Mua Sắm Công tương đương **Chưa đóng thầu**: local = `INVITED`.
- Source `OPEN_BID`, `OPEN_DXKT`, `OPEN_DXTC`, `DANG XET THAU`, `DANG CHAM THAU`, `PUB_DSNTKT`, `PARTIALLY_AWARDED`, `AWARDED`: package mới local = `INVITED`.
- Source đã hủy: không tự chạy action **Hủy thầu** ở Bidding. Nếu có exact TBMT đã publish thì local initial vẫn dừng ở `INVITED`, còn evidence hủy giữ trong source. Nếu chưa có evidence publish thì giữ PREPARING/UNKNOWN theo evidence.
- Không dùng ordinal clamp ngây thơ làm sai `UNKNOWN`/`CANCELLED`.

## 5. Existing package / resync

Source import không được trở thành workflow engine.

- local PREPARING + source có exact published TBMT → được lên INVITED;
- local INVITED + source OPENED/EVALUATING/AWARDED → vẫn INVITED;
- local EVALUATING/AWARDED do người dùng đã thao tác → resync không downgrade, không tự advance thêm;
- local status cao hơn INVITED phải giữ local workflow state, source chỉ cập nhật evidence/source-owned fields hợp lệ.

## 6. Authoritative backend phải sửa

### `backend/procurement_import/command.py`

Trong `ProcurementPlanReconciler`, hiện package dùng:

`initialStatus = observation.lifecycleStatus or derive_import_lifecycle_status(...)`

Phải thay bằng local projection policy.

Trong `ProcurementNoticeReconciler`, `initialStatus` cũng đang derive trực tiếp từ source. Phải dùng cùng policy và bảo toàn existing local workflow nếu package đã tiến xa hơn do người dùng.

Không tạo hai status policy khác nhau giữa plan và notice reconciler.

## 7. Frontend materialization phải cùng semantics

### `frontend/procurement/ProcurementDraftWorkflow.js`

Hiện nhiều nhánh dùng trực tiếp:

`trangThai: biddingPackageStatus(sourcePackage.trangThai)`

bao gồm tạo revision mới, materialize vào plan hiện có và clone từ revision trước.

Đưa về một helper duy nhất, ví dụ:

`resolveProcurementImportedPackageStatus({ sourceStatus, existingStatus, isNew, hasPublishedNotice })`

Yêu cầu:

- new → max Đang mời thầu;
- existing INVITED → không source-advance;
- existing > INVITED → giữ local;
- PREPARING + exact published TBMT → có thể lên INVITED.

Không duplicate logic backend/frontend bằng các if rải rác.

## 8. Không map opening-stage fields vào package khi initial import

### `backend/procurement_import/draft_mapping.py`

`map_package_canonical_to_draft()` hiện map:

- `thoiGianMoThau` từ `actualOpeningAt` / `bidOpeningAt`;
- `thoiGianMoEhsdxtc` từ `financialActualOpeningAt`.

Đối với initial plan/package import:

- KHÔNG materialize `thoiGianMoThau`;
- KHÔNG materialize `thoiGianMoEhsdxtc`.

Những giá trị này vẫn phải tồn tại trong raw/canonical/source evidence và được dùng sau ở Opening Import Wizard.

## 9. Những field invitation-stage vẫn được map

Tiếp tục mapping các field phù hợp đến giai đoạn đang mời thầu theo contract hiện có, gồm tối thiểu:

- mã/số hiệu/tên/tóm tắt gói;
- giá gói, dự toán;
- lĩnh vực, nguồn vốn;
- hình thức/phương thức lựa chọn;
- phương pháp đánh giá;
- thời gian tổ chức/bắt đầu;
- loại hợp đồng, thời gian thực hiện;
- qua mạng, trong nước/quốc tế;
- phân lô và danh sách lô;
- gói thuốc, sơ tuyển, mua sắm tập trung;
- tùy chọn mua thêm và danh sách;
- hiệu lực HSDT;
- bảo đảm dự thầu;
- thời gian đăng tải;
- thời gian đóng thầu;
- `sourceRevision`, `noticeLink`, provenance.

Không xóa source field chỉ vì chưa được materialize.

## 10. Thẩm định HSMT mặc định “Không”

Schema có:

- `yeu_cau_tham_dinh_hsmt`
- `yeu_cau_tham_dinh_hsmt_code`

Gói **mới** import từ MSC phải materialize:

`yeuCauThamDinhHsmt = "Không"`

`yeuCauThamDinhHsmtCode = "NOT_REQUIRED"`

Không để code `UNDETERMINED` nếu UI đã là Không.

Không override package hiện hữu nếu người dùng đã chọn Có/REQUIRED hoặc trạng thái khác.

Kiểm tra tương tác với `frontend/packages/packageAppraisal.js`; không phá rule của Chào hàng cạnh tranh.

## 11. Tuyệt đối không auto-create downstream records

Initial import dù source đã có opening/result không được tự tạo:

- `thong_tin_mo_thau`;
- `nha_thau_tham_du_mo_thau`;
- liên danh mở thầu;
- `hang_hoa_du_thau_nha_thau`;
- evaluation rounds/details;
- `ket_qua_danh_gia_nha_thau`;
- award result;
- `hop_dong`;
- `hop_dong_goi_thau`;
- hoặc business row tương đương giai đoạn sau.

Dữ liệu đó chỉ là source evidence chưa được người dùng materialize.

## 12. Vẫn fetch/store COMPLETE source data

Không hiểu “chỉ mapping tới Đang mời thầu” thành “chỉ fetch invitation”.

Kiến trúc cần là:

`FETCH COMPLETE SOURCE → STORE RAW/CANONICAL → PROJECT ONLY INVITATION INTO BIDDING`

Tận dụng kiến trúc có sẵn:

- `ProcurementRawSnapshotRepository`
- `collect_complete_bundle(...)`
- `normalize_notice_complete_bundle(...)`
- `map_notice_raw_bundle(...)`
- `get_opening_bundle(...)`
- `get_result_bundle(...)`

Không nhét giant raw JSON trực tiếp vào `goi_thau` hay frontend state.

## 13. Rà lại `_enrich_linked_notices`

### `backend/procurement_import/service.py`

Hiện linked notice enrichment gọi `_lookup_complete_bundle(... detail_level="INVITATION")`.

Yêu cầu mới cần downstream opening data đã fetch có thể dùng lại.

Thiết kế phù hợp để:

- với exact linked TBMT cần thiết, thu thập/lưu COMPLETE bundle;
- lưu raw qua `ProcurementRawSnapshotRepository`;
- dedupe theo notice/revision;
- reuse cache hiện có;
- bounded concurrency/time/memory;
- partial source vẫn giữ evidence + warning;
- không fetch COMPLETE cho package chưa có linked TBMT.

Không chỉ thay mọi `INVITATION` bằng `COMPLETE` mà không đánh giá performance/cache/duplicate calls.

## 14. Opening UI hiện có phải là ranh giới workflow

### `frontend/packages/BidProcessWorkflow.js`

Hiện đã có button:

`btn-mothau-import-msc`

và gọi:

`this.importOpeningFromMuasamcong()`

Giữ/reuse button này, không tạo button song song.

### `frontend/procurement/OpeningImportWizard.js`

Luồng hiện có:

`click lấy MSC → prepareOpening → preview → MERGE/OVERWRITE → applyOpening → prefill rows/time`

Giữ semantics này:

**Opening import = PREFILL DRAFT**, không phải auto-open-bid.

## 15. Chỉ Save opening mới sang Đang chấm thầu

`performSaveThongTinMoThau()` hiện:

- tạo/cập nhật `thongtinmothau`;
- `gt.trangThai = "Đang chấm thầu"`;
- persist/sync.

Đây là ranh giới nghiệp vụ đúng và phải giữ:

`Đang mời thầu → user mở màn Biên bản mở thầu → tùy chọn lấy MSC → preview/prefill → user kiểm tra → Lưu → tạo thongtinmothau → Đang chấm thầu`

Không được bypass bước **Lưu thông tin mở thầu**.

## 16. Reuse snapshot đã lấy trước

### `backend/procurement_import/routes.py`

`_prepare_opening_blocking()` hiện gọi trực tiếp:

`source.get_opening_bundle(notice_no, selected_revision_id)`

Hãy ưu tiên:

1. tìm exact raw/complete snapshot theo organization + provider + noticeNo + revision;
2. nếu snapshot có đủ opening evidence thì project từ snapshot, không gọi upstream;
3. nếu miss/stale/incomplete thì fallback `get_opening_bundle`;
4. nếu fetch upstream thì lưu/refresh source evidence theo repository hiện có;
5. không dùng snapshot tenant/revision khác;
6. giữ preview expiry, permission, binding và rowVersion stale checks.

## 17. Click “Lấy dữ liệu MSC” không được đổi status

Regression bắt buộc:

Package trước = `Đang mời thầu`.

Sau click lấy MSC + preview/apply-to-draft:

- form được điền;
- package vẫn `Đang mời thầu`;
- chưa persist `thongtinmothau`;
- cancel preview không đổi state.

Chỉ sau Save opening:

- `thongtinmothau` được persist;
- package = `Đang chấm thầu`.

## 18. ALL revisions

`revisionMode=ALL` vẫn phải giữ:

- full provenance từng revision;
- package/version lineage;
- source revision/version;
- exact notice binding;
- canonical source evidence.

Nhưng mọi source-driven local package snapshot không được tự vượt invitation workflow.

Không làm hỏng `source_revision_version`, `packageRevisionNumber`, `localVersion`, `noticeVersion`, `planSnapshotId`, `isLatest`.

## 19. Backend tests bắt buộc

### Source truth

Chứng minh source observation vẫn giữ đúng:

- OPEN_BID → source observed OPENED;
- DANG XET THAU → source observed EVALUATING;
- AWARDED → source observed AWARDED.

### Local initial projection

Parameterize:

- PREPARING → PREPARING;
- published / Chưa đóng thầu → INVITED;
- OPEN_BID → INVITED;
- OPEN_DXKT → INVITED;
- OPEN_DXTC → INVITED;
- DANG XET THAU → INVITED;
- DANG CHAM THAU → INVITED;
- PUB_DSNTKT → INVITED;
- PARTIALLY_AWARDED → INVITED;
- AWARDED → INVITED;
- CANCELLED after published notice → INVITED.

Đồng thời assert source evidence vẫn giữ status thật.

### No opening field projection

Source có `actualOpeningAt` và `financialActualOpeningAt`.

Initial local package phải không materialize hai opening time đó, trong khi raw/canonical vẫn có.

### Appraisal

New imported package:

- `yeuCauThamDinhHsmt == "Không"`
- `yeuCauThamDinhHsmtCode == "NOT_REQUIRED"`

### No downstream business rows

Apply plan/package source đã AWARDED:

- DB package status local = INVITED;
- `COUNT(thong_tin_mo_thau)=0`;
- không evaluation/award/contract rows;
- provenance vẫn có source awarded/opening evidence.

## 20. Existing package/resync tests

- local PREPARING + published source → INVITED;
- local INVITED + EVALUATING source → vẫn INVITED;
- local EVALUATING + AWARDED source → vẫn EVALUATING;
- local AWARDED + EVALUATING source → vẫn AWARDED;
- existing appraisal Có/REQUIRED không bị source resync đổi thành Không.

## 21. Opening cache tests

### Cache hit

Initial import đã lưu complete exact notice revision.

`prepareOpening` phải dùng stored snapshot, upstream opening call count = 0.

### Cache miss

Không có evidence → fallback `get_opening_bundle`.

### Partial snapshot

Không fabricate bidders. Fallback hoặc warning/fail-closed theo contract hiện có.

## 22. Frontend tests

- initial materialization caps status;
- existing package preserves local status;
- appraisal defaults;
- import opening fills draft but does not change status;
- cancel leaves state unchanged;
- MERGE preserves local draft;
- OVERWRITE only changes draft;
- Save opening creates opening records and changes to Đang chấm thầu;
- rowVersion stale still rejected;
- outbox/pending mutation behavior unaffected.

## 23. Security

Giữ nguyên:

- `goithau` edit permission;
- organization scope;
- workspace lease;
- preview scope/expiry;
- exact source binding;
- expected rowVersion;
- tenant isolation.

Không gửi raw source dump ra client nếu không cần.

## 24. Performance

- dedupe unique notice/revision;
- reuse complete cache;
- reuse raw snapshot repository;
- bounded upstream concurrency;
- không COMPLETE fetch unlinked placeholders;
- không refetch exact bundle khi cache hợp lệ;
- không lưu raw giant payload trong frontend/package rows.

## 25. Không mở rộng scope

Không refactor lớn RBAC, AI, BiddingModel, MutationObserver, versioning framework, document export, contract/evaluation UI.

Chỉ xử lý ranh giới:

`complete source retention + local workflow capped at invitation + user-controlled opening materialization`

## 26. Files phải rà tối thiểu

- `backend/procurement_import/domain.py`
- `backend/procurement_import/draft_mapping.py`
- `backend/procurement_import/service.py`
- `backend/procurement_import/command.py`
- `backend/procurement_import/routes.py`
- `backend/procurement_import/repository.py`
- `backend/integrations/muasamcong_browser/canonical.py`
- `backend/integrations/muasamcong_browser/procurement_source.py`
- `backend/procurement_raw.py`
- `backend/shared/domain_enums.py`
- `backend/db/schema.py`
- `frontend/procurement/ProcurementDraftWorkflow.js`
- `frontend/procurement/OpeningImportWizard.js`
- `frontend/procurement/PlanImportWizard.js`
- `frontend/procurement/NoticeImportWizard.js`
- `frontend/packages/BidProcessWorkflow.js`
- `frontend/packages/packageAppraisal.js`
- procurement/opening Python + JS tests.

## 27. Definition of Done

- [ ] Source lifecycle thật được giữ đầy đủ.
- [ ] Raw/canonical opening/result evidence không mất.
- [ ] New imported package không vượt INVITED.
- [ ] Chưa đóng thầu → Đang mời thầu.
- [ ] Source OPENED/EVALUATING/AWARDED → local initial INVITED.
- [ ] Source cancellation không tự chạy local Hủy thầu.
- [ ] Existing workflow > INVITED không bị source overwrite/downgrade.
- [ ] Initial package không map opening/financial opening time.
- [ ] Initial import không tạo opening/evaluation/result/contract rows.
- [ ] New imported package appraisal = Không / NOT_REQUIRED.
- [ ] Existing appraisal của user không bị overwrite.
- [ ] Existing MSC opening button vẫn là optional action.
- [ ] Opening import chỉ prefill draft.
- [ ] Opening import không đổi package status.
- [ ] Chỉ Save opening mới chuyển Đang chấm thầu.
- [ ] Stored complete snapshot được ưu tiên reuse.
- [ ] Cache miss fallback upstream đúng.
- [ ] Exact notice/revision/tenant/permission/rowVersion protections còn nguyên.
- [ ] Multi-revision import không regression.
- [ ] Python/JS/static/build gates pass.

## 28. Test gates

Chạy tối thiểu:

```bash
python -m pytest -q tests/test_procurement_import_service.py
python -m pytest -q tests/test_muasamcong_integration_source.py
python -m pytest -q
npm run test:js
npm run check:static
npm run build:secure
git diff --check
```

Nếu có procurement/opening E2E thì chạy thêm.

Không ghi pass nếu không chạy.

## 29. Báo cáo cuối

Tạo:

`docs/reports/BIDDINGFLOW_PROCUREMENT_IMPORT_WORKFLOW_BOUNDARY_2026-08-15.md`

Báo cáo phải ghi:

- HEAD before/after;
- root cause;
- source truth vs local workflow contract;
- complete raw/canonical retention;
- local status cap;
- appraisal default;
- opening cache reuse/fallback;
- opening flow: import → preview/prefill → user save → EVALUATING;
- test commands + pass/fail/skipped + exit code;
- performance/cache behavior;
- remaining risks.

## 30. Chỉ thị cuối

Không sửa bằng cách làm `derive_import_lifecycle_status()` luôn trả INVITED.

Không xóa opening/result khỏi source parser.

Không chỉ sửa frontend label.

Không tự tạo opening rows rồi ẩn UI.

Kiến trúc cuối phải là:

```text
MUA SẮM CÔNG
   |
   +-- full raw/canonical evidence ----------------------+
   |                                                     |
   +-- local projection policy                           |
             |                                           |
             v                                           |
       BIDDING PACKAGE                                   |
       max = Đang mời thầu                               |
             |                                           |
             | user chọn "Lấy dữ liệu MSC"               |
             v                                           |
       Opening preview <---------------------------------+
             |
             | user kiểm tra + Lưu
             v
       thong_tin_mo_thau
             |
             v
       Đang chấm thầu
```

**Mua Sắm Công cung cấp dữ liệu. Bidding kiểm soát quy trình.**
