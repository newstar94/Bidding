# Prompt triển khai: Căn cứ lập Kế hoạch LCNT và ánh xạ Word

Bạn đang làm việc trong repository BiddingFlow tại `D:\Bidding`. Đây là nhiệm vụ
implementation, không dừng ở nghiên cứu. Hãy đọc đầy đủ `AGENTS.md`, `CONTEXT.md`,
`docs/adr/0030-derived-ten-can-cu-for-word-mapping.md` và
`docs/research/2026-08-30-can-cu-lap-ke-hoach-xuat-word.md` trước khi sửa code.

## Mục tiêu đã được chủ sản phẩm chấp thuận

Thêm danh sách căn cứ vào Kế hoạch LCNT. Mỗi căn cứ được người dùng nhập bằng một ô
text tự nhiên; trước mỗi lần xuất Word người dùng chọn những căn cứ nào sẽ đưa vào
tài liệu. Word phải hỗ trợ hai recipe trên cùng một danh sách đã chọn:

1. In nguyên văn câu người dùng nhập.
2. Chọn và sắp xếp các trường đã tách, trong đó có biến `tenCanCu` thuận tiện.

Ví dụ input:

```text
Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC về việc phê duyệt dự toán
```

Projection phải là:

```json
{
  "noiDungGoc": "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC về việc phê duyệt dự toán",
  "tenVanBan": "Quyết định",
  "soVanBan": "123/QĐ",
  "ngayBanHanh": "2025-11-11",
  "donViBanHanh": "UBND xã ABC",
  "trichYeu": "phê duyệt dự toán",
  "tenCanCu": "Quyết định về việc phê duyệt dự toán"
}
```

`tenCanCu` là derived/server-owned, không persist riêng và không nhận từ client.
Nếu chỉ có một trong `tenVanBan`/`trichYeu`, dùng phần có giá trị; nếu cả hai rỗng,
trả chuỗi rỗng. Không gộp số, ngày hoặc đơn vị vào `tenCanCu`. Giữ nguyên
`noiDungGoc`, kể cả khi parser `PARTIAL` hoặc `UNPARSED`.

## Ràng buộc không được vi phạm

- Đọc `AGENTS.md` là bắt buộc. Không thay đổi masking, redaction, role, permission,
  tenant/module/assignment/record scope, entitlement hoặc dữ liệu mà actor đã được
  phép xem. Người có quyền đọc plan vẫn xem đầy đủ danh sách và trường; Word
  entitlement chỉ gate hành động tạo/tải Word.
- Bảo toàn mọi thay đổi dirty có sẵn trong worktree; không reset, checkout đè,
  stage, commit, push, deploy hoặc gọi hệ thống bên ngoài thật.
- Không dùng LLM/web/tra cứu pháp lý để parse hoặc điền thiếu. Parser deterministic,
  pure, có version (ví dụ `can-cu-citation-v1`), không parse lại lúc read/export/
  retry/clone/reorder.
- Không tự tách nhiều căn cứ trong một textbox; cảnh báo và yêu cầu người dùng tách
  thành các dòng riêng.
- Năm parser field thiếu phải là `null` trong persistence/read model; riêng
  `tenCanCu` luôn áp dụng công thức dẫn xuất đã chốt và trả `""` khi cả
  `tenVanBan` lẫn `trichYeu` đều thiếu. Word DTO phải materialize đủ key trên mọi
  item, chuyển mọi giá trị thiếu thành `""`, không được in `None` hoặc để từ nối
  treo.

## Phạm vi implementation

### 1. Domain, schema và persistence

- Tạo child table version-owned `ke_hoach_can_cu` theo convention tenant-owned child;
  mỗi row có raw text, năm parser fields, `parse_status`, `parse_version`, thứ tự,
  physical ID và lineage `rootId/id_goc`.
- Dùng FK/tenant-parent invariants, order index, delete policy, version comparison
  và ID registry hiện hữu. Không dùng JSON column làm nguồn chính.
- Update semantics: thiếu `canCuLapKeHoachList` = preserve; `[]` = explicit clear;
  mảng có item = atomic replace/reconcile theo server order. Derived fields do
  server sở hữu; reject duplicate/foreign/cross-tenant IDs.
- Dùng giới hạn sync hiện hữu: tối đa `MAX_SYNC_CHILD_ITEMS = 500` rows và
  `MAX_SYNC_TEXT_LENGTH = 100_000` ký tự cho mỗi `noiDungGoc`; UI phản ánh cùng
  giới hạn, server là authority, không cắt/ngầm rút gọn text và không thêm total-limit
  riêng ngoài request limits dùng chung.
- Deep-clone rows khi tạo plan version mới, cấp physical IDs mới, giữ lineage và
  projection/parser version; không reparse và không mutate version cũ.
- Đừng bỏ sót state/clone seams: `backend/versioning/repository.py`,
  `backend/versioning/command.py`, `backend/versioning/aggregate_snapshot.py`,
  `frontend/plans/PlanVersionDraftSession.js`,
  `frontend/plans/planAggregateSnapshot.js` và legacy workflow.
- Kiểm tra current schema version/migration chain trước khi đặt số migration; research
  gợi ý v81→v82 nhưng phải xác minh trên working tree hiện tại.

### 2. Parser

Implement grammar v1 tối thiểu:

```text
[Căn cứ]? <tên/loại văn bản> số <số/ký hiệu> ngày <ngày>
(của <đơn vị> | do <đơn vị> ban hành) [về việc <trích yếu>]
```

- Hỗ trợ ngày số và ngày viết bằng chữ; validate ngày lịch thật; lưu date canonical
  `YYYY-MM-DD`.
- Chỉ normalize bản sao để match; không rewrite raw text/case/dấu câu.
- Không chọn ứng viên đầu tiên khi nhiều mốc; dùng `PARSED`, `PARTIAL`, `UNPARSED`
  và reason codes (`MISSING_*`, `MULTIPLE_DATES`, `INVALID_DATE`,
  `MULTIPLE_BASES_DETECTED`, ...).
- `Căn cứ`, `số`, `ngày`, `của`, `về việc` là connectors, không nằm trong field.
- Golden corpus phải có câu mẫu, thiếu trường, `của`/`do ... ban hành`, ngày chữ/số,
  số có `/`/`-`, punctuation, trích yếu chứa “số/ngày/của”, nhiều văn bản và ngày
  không tồn tại.

### 3. API, read model và UI kế hoạch

- Thêm list vào mọi read/detail/pagination seam; authorized reader thấy đầy đủ raw
  và projection. Không kiểm tra Word entitlement ở read API.
- Form repeatable rows: add/edit/delete/reorder bằng một ô text, giữ ID trong cùng
  version. MVP không thêm parser frontend hoặc endpoint preview riêng: backend parse
  authoritative trong create/update, rồi UI hiển thị projection/status từ response
  sau save/read; `PARTIAL`/`UNPARSED` chỉ cảnh báo, không chặn lưu. Sửa raw thì save
  và parse lại; client không override projection.
- Hiển thị `tenCanCu` như trường tiện dụng cùng metadata; không cho sửa trực tiếp
  `tenCanCu`.
- Import/revision/durable draft/legacy version paths phải giữ missing-vs-`[]` semantics.

### 4. Chọn căn cứ khi xuất Word

- Dialog plan publication có checkbox từng row, chọn tất cả/bỏ chọn tất cả; mặc định
  chọn tất cả; cho phép explicit zero (`[]`); giữ thứ tự server; đóng/mở dialog không
  ghi vào plan.
- Request transport dùng `selectedCanCuLapKeHoachIds`. Thêm POST JSON trên cùng
  `/api/export-plan/{plan_id}` và cập nhật `backend/app.py`; background POST
  `/api/document-jobs/plan/{plan_id}` nhận cùng field. GET cũ vẫn hoạt động và
  compat-all; POST thiếu field cũng compat-all cho client cũ; `[]` là explicit zero.
- Direct export và background job dùng cùng selection resolver. Job policy mới phải
  seal exact IDs/selection mode. Worker render/retry tiếp tục dùng immutable queued
  context; source-authority completion phải truyền selection từ policy khi dựng lại
  context/digest. Policy v1/v2 thiếu selection phải dùng legacy context contract và
  không tự thêm root/alias mới khi verify digest; queued policy cũ vẫn hoàn tất.
- Server chỉ lấy rows thuộc đúng plan/tenant đã authorize; không nhận raw content từ
  request xuất; audit ID/count/hash/mode, không log free-text.

### 5. Word context và mapping

Chỉ expose một selected-only list root:

```text
ds_can_cu_lap_ke_hoach
```

Không tạo hai list mappings cho raw/structured và không thêm child collection vào
`ke_hoach` root làm lộ toàn bộ rows. Trong loop dùng canonical item fields trực tiếp:

```text
{#ds_can_cu_lap_ke_hoach}
{stt} | {ten_can_cu} | {noi_dung_goc}
{/ds_can_cu_lap_ke_hoach}
```

Theo kiến trúc mapping hiện hữu, `ds_can_cu_lap_ke_hoach` là **custom list mapping
alias**, không được thêm vào `PLAN_ROOT_SPECS` vì tên mapping trùng reserved system
root sẽ bị validator từ chối. Giữ selected DTO ở source key nội bộ
`ke_hoach_can_cu`; đăng ký EntitySpec, `_SOURCE_FIELDS`, `_PLAN_MAPPING_SOURCES`,
`_LIST_ONLY_SOURCES`, `_MAPPING_LIST_ENTITY_BY_SOURCE` và source-to-context trong
mapping service để mapping tạo alias template-visible. Không expose collection đầy
đủ qua nested field của `ke_hoach`.

Recipe nguyên văn:

```text
{#ds_can_cu_lap_ke_hoach}
{noi_dung_goc}
{/ds_can_cu_lap_ke_hoach}
```

Recipe cấu trúc mặc định:

```text
{#ds_can_cu_lap_ke_hoach}
Căn cứ {ten_van_ban}{cum_so_van_ban}{cum_ngay_ban_hanh}{cum_don_vi_ban_hanh}{cum_trich_yeu}
{/ds_can_cu_lap_ke_hoach}
```

Expose thêm `{ten_van_ban}`, `{so_van_ban}`, `{ngay_ban_hanh}`, `{S_ngay_ban_hanh}`,
`{don_vi_ban_hanh}`, `{trich_yeu}`, `{ten_can_cu}`, `{stt}`. `cum_*` là helper
presentation-only, gồm connector hoặc `""` khi thiếu. Item fields chỉ có nghĩa bên
trong loop; không tạo scalar alias lấy giá trị item cuối.

Cập nhật allowlist/EntitySpec/context policy, mapping registry/catalog, HTML/JS source
catalog, generated manifest, sample preview context và preflight. Tăng mapping version
chỉ sau khi xác minh current version (research gợi ý 15→16); publish template version
mới immutable, không sửa bytes template đã publish.

### 6. Verification và rollout

Chạy targeted tests trước, trong và sau implementation; tối thiểu khóa:

- parser golden corpus và công thức `tenCanCu`;
- schema fresh/upgrade, FK/tenant/order, child clone/comparison/delete;
- missing vs `[]`, validation và server-owned derived fields;
- full read visibility và authorization regression;
- editor/status-after-save/accessibility; không có parser frontend/preview endpoint;
- selected subset/all/zero, server order, invalid IDs, no plan mutation;
- raw/structured Word, `{stt}`, date short form, empty list, mixed
  `PARSED`/`PARTIAL`/`UNPARSED`, no `None`, no dangling connectors;
- dictionary hai nhóm, copy block/copy từng biến, read-only copy, multiline/mobile;
- direct/job/retry parity, legacy job compatibility, source-authority behavior;
- mapping registry uniqueness/version/generated manifest/preflight/sample preview;
- `git diff --check`, UTF-8/mojibake scan, frontend build/lint và backend suite phù hợp.

Không sửa expected để che regression hoặc thay đổi nghiệp vụ. Nếu gặp xung đột với
quyền/hiển thị hoặc một semantics chưa có trong prompt/ADR, dừng đúng nhánh đó, ghi
`BLOCKED_DECISION`, tiếp tục phần độc lập an toàn và báo cáo rõ.

## Bàn giao bắt buộc

Tạo implementation report trong `docs/testing/` gồm mapping yêu cầu→file/test,
migration/rollback, lệnh test và kết quả, compatibility với template/job cũ, cờ rollout,
blocker còn lại và xác nhận quyền/hiển thị dữ liệu không đổi. Không tuyên bố production
rollout nếu chưa có gate triển khai tương ứng.
