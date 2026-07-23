# Báo cáo rà soát toàn bộ Frontend, Backend và Database

- Ngày rà soát: 2026-07-23
- Snapshot: commit `6fbffba`
- Phạm vi: Frontend, Backend, schema/migration PostgreSQL, backup/restore và test
- Trạng thái: Chỉ rà soát và lập báo cáo, chưa sửa source code

## Kết luận

Bản hiện tại chưa nên được đưa lên production.

Kết quả rà soát ghi nhận:

- 3 lỗi Critical
- 6 lỗi High
- Một số lỗi nghiệp vụ và maintainability mức Medium

Các rủi ro nghiêm trọng nhất là:

- Sync có thể bỏ mất vĩnh viễn một thay đổi.
- Phê duyệt kết quả lô không atomic, có thể tạo trạng thái nửa đã duyệt.
- Restore drill có thể chạy `pg_restore --clean` nhầm production.
- Một số câu lệnh UPDATE/DELETE thiếu `organization_id`, có thể ảnh hưởng dữ liệu chéo tenant.

## Critical

### 1. Sync có thể bỏ mất vĩnh viễn thay đổi

Sync dùng `BEGIN` thông thường nhưng giả định đã cố định snapshot tại
`backend/sync/read_service.py:99`.

Connection chỉ đặt `autocommit=False`, không đặt isolation level tại
`backend/db/db_helper.py:373`. PostgreSQL vì vậy sử dụng mặc định
`READ COMMITTED`.

Các bảng được đọc trước, nhưng `syncVersion` cuối cùng được đọc sau. Một row có
thể commit sau khi bảng tương ứng đã được đọc nhưng trước khi version cuối được
lấy. Trong tình huống này:

1. Response không chứa row mới.
2. Response vẫn trả cursor/version mới.
3. Lần sync tiếp theo chỉ lấy các row có version lớn hơn cursor đó.
4. Row bị bỏ sót sẽ không bao giờ được tải lại.

#### Đề xuất

Sử dụng:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
```

Toàn bộ dữ liệu, manifest, dashboard và sync cursor phải được lấy trong cùng một
snapshot.

### 2. Phê duyệt kết quả lô không atomic

Backend đóng batch và commit tại:

- `backend/lot_lifecycle_routes.py:192-215`
- `backend/lot_lifecycle_service.py:364-386`

Sau khi transaction này đã commit, frontend mới gọi sync gói thầu bằng request
riêng tại:

- `frontend/packages/detail/AwardResultDetailsPanel.js:1198-1205`
- `frontend/packages/detail/AwardResultDetailsPanel.js:1255-1259`

Nếu sync thứ hai thất bại, batch vẫn ở trạng thái `CLOSED`, nhưng quyết định
trúng thầu, nhà thầu trúng hoặc trạng thái gói chưa được cập nhật.

Retry finalize không khắc phục được vì batch đã đóng chỉ trả lại trạng thái hiện
tại. Idempotency của `/api/sync` cũng không bao phủ endpoint finalize.

#### Trường hợp tất cả lô không có nhà thầu trúng

Frontend ánh xạ các lô không có winner thành `NO_RESPONSIVE_BID`, finalize batch,
sau đó đặt gói ở trạng thái đã có kết quả.

Tuy nhiên validator tại `backend/sync/payload_validation.py:770-780` yêu cầu gói
phân lô ở trạng thái có kết quả phải có ít nhất một lô trúng. Sync vì vậy trả
HTTP 400 sau khi batch đã được commit `CLOSED`.

#### Đề xuất

Tạo một command backend duy nhất thực hiện trong cùng transaction:

1. Khóa package và batch.
2. Kiểm tra toàn bộ outcome.
3. Finalize các lô.
4. Cập nhật winner, giá trúng và trạng thái package.
5. Tạo artifact snapshot.
6. Ghi audit.
7. Commit một lần.

Frontend chỉ gọi command này, không tự điều phối hai endpoint độc lập.

### 3. Restore drill có thể xóa nhầm production

Guard tại `scripts/backup.py:423-432` chỉ so sánh chuỗi:

- hostname
- port
- database path/name

Các địa chỉ như `localhost`, `127.0.0.1`, IPv4/IPv6 alias hoặc DNS alias có thể
cùng trỏ tới một database nhưng vẫn vượt qua guard.

Ngay sau đó script chạy `pg_restore --clean` tại
`scripts/backup.py:435-443`.

#### Đề xuất

Trước mọi thao tác destructive:

1. Kết nối cả primary và drill database.
2. So sánh định danh database/cluster thực, không so sánh URL thô.
3. Fail-closed nếu không xác minh được hai database độc lập.
4. Chỉ sau đó mới được phép chạy `pg_restore --clean`.

## High

### 1. UPDATE và DELETE thiếu khóa tenant

`recalculate_is_latest` tại `backend/db/db_utils.py:101-130` loại
`organization_id` khỏi các CTE và câu UPDATE cuối chỉ nối bằng `id`.

Schema chủ đích cho phép cùng một ID tồn tại trong nhiều tenant thông qua khóa
`(organization_id, id)`. Vì vậy recalculation cho một tổ chức có thể cập nhật row
cùng ID của tổ chức khác.

Luồng rời tổ chức cũng xóa assignment và permission chỉ theo ID tại:

- `backend/api/org_routes.py:648`
- `backend/api/org_routes.py:656`
- `backend/api/org_routes.py:668`

Word mapping có lỗi tương tự tại:

- `backend/documents/routes_docx.py:843-845`
- `backend/documents/routes_docx.py:859-870`

#### Đề xuất

- Tất cả SELECT, UPDATE và DELETE trên tenant table phải dùng cặp
  `(organization_id, id)`.
- Tái sử dụng mẫu nối đúng đang có tại `backend/db/db_utils.py:200-223`.
- Thêm test với hai tenant có cùng ID.

### 2. Fresh database và upgraded database không tương đương

#### Migration v12 thiếu foreign key

Migration v12 tạo sáu bảng lifecycle tại `backend/db/upgrades.py:358-372` bằng
`build_create_table_sql`.

Builder tại `backend/db/postgres_schema.py:201-222` cố ý bỏ các constraint bắt
đầu bằng `FOREIGN KEY`. Fresh install có bước `_create_foreign_keys` riêng tại
`backend/db/postgres_schema.py:868-870`, nhưng migration v12 không gọi bước này.

Database được nâng cấp vì vậy có thể thiếu toàn bộ FK cho batch, lot, dependency
và artifact, cho phép orphan hoặc liên kết chéo tenant.

Readiness hiện chỉ kiểm tra các FK đã tồn tại nhưng chưa validate; không phát
hiện FK bị thiếu.

#### Migration v11 lệch schema canonical

Migration tại `backend/db/upgrades.py:217-259`:

- Dùng `id TEXT PRIMARY KEY` toàn cục thay vì primary key tenant-composite.
- Nhận diện personal workspace bằng prefix `__personal__:%`.
- Prefix canonical thực tế là `personal:`.
- Không cài đầy đủ owner/sync/delete trigger giống fresh install.

Kết quả là dữ liệu personal có thể bị gắn `owner_type='organization'`, đồng thời
fresh install và upgraded database có hành vi khác nhau.

#### Đề xuất

- Dùng chung một schema builder cho fresh install và migration.
- Có helper tạo FK/check/index/trigger theo từng table và gọi lại helper đó từ
  migration.
- Thêm live migration test từ từng version cũ lên version mới nhất, sau đó so
  PK, FK, CHECK, index và trigger với fresh schema.

### 3. Bắt `IntegrityError` rồi tiếp tục trên transaction đã hỏng

`backend/sync/deletion_service.py:155-167` bắt lỗi FK rồi tiếp tục thực hiện SQL
mà không rollback về savepoint.

Sau `IntegrityError`, PostgreSQL giữ transaction ở trạng thái aborted. Các câu
SQL tạo tombstone, xử lý deletion tiếp theo hoặc recalculation đều sẽ thất bại.
Toàn bộ request có thể trả 500 và rollback thay vì trả `DELETE_REFERENCED` cho
riêng item.

#### Đề xuất

Tái sử dụng mẫu savepoint từng item đang có tại:

- `backend/sync/service.py:672`
- `backend/sync/service.py:955-976`

Mỗi deletion phải có savepoint riêng và rollback về savepoint trước khi tiếp tục.

### 4. Frontend lỗi runtime khi thêm nhà thầu

`initRowListeners2` được khai báo bằng `const` bên trong block tại
`frontend/packages/detail/AwardResultDetailsPanel.js:619-674`.

Handler thêm nhà thầu nằm ngoài block nhưng gọi hàm này tại
`frontend/packages/detail/AwardResultDetailsPanel.js:1408`.

Khi bấm thêm nhà thầu, JavaScript phát sinh `ReferenceError`. Row có thể đã được
thêm vào DOM nhưng các listener tiền tệ, thời gian, mã nhà thầu và liên danh
không được gắn.

#### Đề xuất

Đưa row initializer lên scope chung của component và tái sử dụng cùng một
initializer cho row ban đầu và row được thêm động.

### 5. Race trong idempotency và gia hạn subscription

Sync thực hiện kiểm tra mutation key bằng SELECT tại
`backend/sync/service.py:236-285`, chạy mutation, rồi mới upsert cached response
tại `backend/sync/response.py:38-52`.

Hai request đồng thời dùng cùng `clientMutationId` có thể cùng vượt qua kiểm tra
và cùng mutate.

Gia hạn subscription cũng đọc row không `FOR UPDATE` tại
`backend/api/org_routes.py:39-49`, tính expiry trong Python rồi ghi giá trị tuyệt
đối tại `backend/api/org_routes.py:152-168`. Hai lần gia hạn đồng thời có thể
cùng đọc một expiry và làm mất một lần gia hạn.

#### Đề xuất

- Tái sử dụng `pg_advisory_xact_lock` đã có trong repo.
- Khóa theo `(organization_id, actor_user_id, mutation_id)`.
- Khóa row subscription trước chuỗi read-calculate-write.
- Dùng chung một primitive idempotency cho sync và subscription.

### 6. Backup/restore không tạo snapshot DB-assets nhất quán

Backup dump database trước rồi mới copy assets tại `scripts/backup.py:280-286`.
Ứng dụng vẫn có thể ghi trong khoảng thời gian đó, khiến DB và assets thuộc hai
thời điểm khác nhau.

Restore không dùng `--single-transaction` hoặc `--exit-on-error` tại
`scripts/backup.py:326-335`, sau đó copy file trực tiếp. Lỗi giữa chừng có thể để
lại hệ thống được restore một phần.

#### Đề xuất

- Tạo snapshot nhất quán giữa DB và assets.
- Restore DB trong một transaction.
- Stage toàn bộ asset tree trước, kiểm tra integrity, sau đó swap atomically.

## Medium và lỗi nghiệp vụ khác

### 1. Dashboard đếm sai hợp đồng đang thực hiện

SQL tại `backend/sync/dashboard_summary.py:604-617` là:

```sql
SELECT COUNT(*), COUNT(*)
```

Do đó `activeAssignedHopdong` luôn bằng `assignedHopdong`, bất kể trạng thái hợp
đồng.

Frontend fallback lại chỉ đếm trạng thái đang thực hiện, nên backend và frontend
không nhất quán.

Nên tái sử dụng catalog trạng thái trong
`backend/contracts/contract_statuses.py:3-10`.

### 2. Registry nhà thầu mở thầu có thể lệch với row chính

Registry của opening input bị xóa tại `backend/sync/service.py:644-656`, trước
khi savepoint từng item được bắt đầu tại dòng 672.

Nếu update row hiện hữu thất bại, rollback item khôi phục row chính nhưng không
khôi phục registry. Hệ thống có thể còn row mở thầu nhưng registry đã mất.

Việc xóa và rebuild registry phải nằm trong cùng savepoint với row chính.

### 3. Duplicate key làm ghi đè nhãn Excel

`thoiGianThucHien` được khai báo hai lần trong cùng object tại:

- `frontend/packages/GoiThauModals.js:95`
- `frontend/packages/GoiThauModals.js:141`

Khai báo sau ghi đè khai báo trước, khiến preview/import Excel dùng nhãn không
đúng hoặc kém cụ thể hơn.

## Tái sử dụng code và code thừa

### 1. `FIELD_METADATA_BY_TABLE` không được sử dụng

Khoảng 1.300 dòng metadata bắt đầu tại
`frontend/documents/wordVariableManifest.js:2` không có consumer runtime hiện
tại. File chỉ được import để lấy `DEFAULT_WORD_VARIABLES`.

Nên chọn một trong hai hướng:

- Dùng metadata này làm nguồn duy nhất cho Word integration, labels và partner
  view.
- Xóa hoàn toàn nếu không còn cần.

Không nên tiếp tục duy trì đồng thời metadata chết và các danh sách label được
copy thủ công.

### 2. `reopenPackageAwardResult` không có callsite

Hàm tại `frontend/packages/packageAwardResult.js:12` không được import hoặc gọi
từ JavaScript hiện tại.

Nên xóa sau khi bổ sung test xác nhận không còn workflow phụ thuộc.

### 3. `BiddingModel.prototype.formatCurrency` bị shadow

Constructor tại `frontend/app/BiddingModel.js:52-55` gắn formatter trực tiếp lên
instance bằng `Object.assign`.

Prototype method tại `frontend/app/BiddingModel.js:978-982` vì vậy không được gọi
trong runtime thông thường. Bản prototype còn chuyển qua `Number`, có thể mất
chính xác với số lớn.

Nên xóa prototype method và dùng formatter shared hiện có.

### 4. Hai implementation `getVersionFamily`

Có hai bản tại:

- `frontend/shared/VersionSelector.js:3-8`
- `frontend/shared/VersionedEntityService.js:73-76`

Một bản có sort, một bản không. Nên chọn một implementation canonical và yêu cầu
callsite sort rõ ràng nếu cần.

### 5. Metadata nhãn Word bị copy ở nhiều nơi

Danh sách nhãn đang lặp tại:

- `frontend/documents/WordIntegration.js:692-734`
- `frontend/documents/WordIntegration.js:774-816`
- `frontend/partners/PartnerView.js:60-104`

Nên đưa về một manifest duy nhất và tái sử dụng ở cả render, import và export.

### 6. `_load_env` bị lặp trong scripts

Ít nhất bảy script có implementation `_load_env` tương tự, ví dụ:

- `scripts/backup.py:53-61`
- `scripts/configure_database_roles.py:19-27`
- `scripts/load_test.py:22-30`

Nên dùng một utility xử lý environment/process chung.

### 7. Context manager database chưa được tận dụng

`PostgresConnection` đã có commit/rollback/close tại
`backend/db/db_helper.py:285-293`, nhưng nhiều production callsite vẫn gọi
`get_connection()` và tự quản lý transaction.

Nên tái sử dụng context manager hiện có thay vì tạo thêm wrapper mới. Những
trường hợp cần savepoint hoặc transaction đặc biệt có thể dùng helper hiện hữu
trên cùng connection.

### 8. Test phụ thuộc implementation string

Một số test kiểm tra chuỗi source thay vì hành vi, ví dụ:

- `tests/test_contract_workflow_policy.py:44-48`
- `tests/test_frontend_navigation_stability_policy.py:15-17`

Các test này làm refactor và hợp nhất code khó hơn. Nên ưu tiên behavior test,
integration test và invariant test.

## Test còn thiếu

Các regression test tối thiểu nên bổ sung:

1. Hai connection interleave để chứng minh sync read không bỏ delta.
2. Finalize thành công nhưng package sync thất bại; toàn bộ transaction phải rollback.
3. Full-scope với tất cả lot `NO_RESPONSIVE_BID` không được để lại batch đã đóng nhưng package lưu thất bại.
4. Hai tenant có cùng ID cho `recalculate_is_latest`, leave organization và Word mapping.
5. Live migration từ v10/v11 lên version hiện tại rồi so schema với fresh install.
6. FK failure trong deletion và xác nhận transaction vẫn dùng được sau lỗi.
7. Concurrent request cùng idempotency key.
8. Concurrent subscription renewal.
9. Restore drill với hostname alias.
10. Restore lỗi giữa chừng.
11. Dashboard có hợp đồng được giao ở nhiều trạng thái.
12. Existing opening update thất bại sau khi registry đã bị xóa.
## Kết quả kiểm thử

- `npm run lint:security`: đạt.
- `node --test`: 78 test đạt.
- Bộ pytest tập trung cho lifecycle, sync, delete, migration và contract:
  75 test đạt.
- Bài kiểm thử tích hợp PostgreSQL từng gặp connection timeout:
  3 test đạt trong 4,71 giây.
- Toàn bộ bộ kiểm thử Python: 906 test đạt, 1 test được bỏ qua trong 31,95 giây.

Việc toàn bộ test hiện tại đạt không loại trừ các lỗi trong báo cáo vì suite vẫn
thiếu các tình huống cạnh tranh đồng thời, giao dịch xuyên nhiều endpoint, ID
trùng giữa các tổ chức và đối chiếu migration thực với fresh schema.

## Thứ tự xử lý đề xuất

1. Dừng hoặc khóa restore drill cho đến khi sửa guard.
2. Sửa isolation của sync read.
3. Hợp nhất finalize và package award thành một transaction backend.
4. Sửa toàn bộ mutation thiếu `organization_id`.
5. Bổ sung FK/trigger và migration parity.
6. Sửa deletion savepoint và các race idempotency.
7. Sửa lỗi runtime frontend.
8. Xóa code chết và hợp nhất các helper/metadata trùng lặp.
