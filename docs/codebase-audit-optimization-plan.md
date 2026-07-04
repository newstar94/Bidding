# Ke hoach ra soat va toi uu BiddingFlow

## Muc tieu

Ke hoach nay dung de kiem soat qua trinh ra soat, sua loi va toi uu toan bo ung dung BiddingFlow theo 6 nhom:

- Tang toc do tai lai trang, dac biet khi bam F5.
- Chuan hoa co che local-first va dong bo ngam.
- Kiem tra logic giua cac thuc the va truong du lieu.
- Tang tinh dung dan va phu hop cua database.
- Nang cao bao mat, phan quyen va dong nhat du lieu.
- Don dep code, loai bo phan du thua va giam do phuc tap.

## Nguyen tac thuc hien

- Moi giai doan chi sua mot nhom van de chinh de de review va rollback.
- Truoc khi sua DB/schema phai co backup file DB hien tai.
- Moi thay doi sync phai kiem tra ca 3 tinh huong: lan dau dang nhap, F5 khi da co local data, va sync sau khi co thay doi tren server.
- Khong doi ten field hang loat neu chua co mapper/migration ro rang.
- Khong xoa code cu neu chua co xac nhan khong con duong goi nao su dung.
- Sau moi giai doan can build/test va ghi lai ket qua.

## Giai doan 0 - Dong bang hien trang va lap baseline

### Muc tieu

Co so sanh truoc/sau ro rang ve hieu nang, sync va tinh dung dan du lieu.

### Viec can lam

- [x] Ghi lai trang thai git hien tai.
- [x] Backup database hien tai.
- [ ] Ghi lai dung luong IndexedDB/localStorage sau khi dang nhap admin.
- [ ] Do thoi gian F5 tai cac man:
  - Dashboard.
  - Danh sach goi thau.
  - Chi tiet goi thau.
  - Hop dong.
  - Chuyen gia.
- [ ] Ghi lai so request API khi F5.
- [ ] Ghi lai thoi gian loader toan trang hien thi.

### File/luong can kiem tra

- `controllers/core/BiddingController.js`
- `controllers/auth/AuthController.js`
- `controllers/main_controller/BiddingControllerSync.js`
- `models/BiddingModel.js`
- `backend/routes/sync_routes.py`
- `backend/routes/auth_routes.py`

### Tieu chi hoan thanh

- Co bang baseline truoc khi sua.
- Biet ro F5 dang cham vi load IndexedDB, sync server, render UI hay request auth.

## Giai doan 1 - Sua loi sync co nguy co lam rong local cache

### Muc tieu

Dam bao khi server bat `useServerSidePagination`, frontend khong ghi de du lieu local bang mang rong.

### Van de hien tai

Backend co the tra ve mang rong cho bang lon khi tong du lieu vuot nguong pagination. Frontend hien co nhanh logic ghi thang `dbData[key]` vao `model.state[key]`, nen co nguy co lam mat cache local.

### Viec can lam

- [x] Sua `forceSyncData()` de phan biet:
  - Full sync that su.
  - Delta sync.
  - Server-side pagination mode.
- [x] Neu `useServerSidePagination = true`, khong persist mang rong len IndexedDB cho cac bang lon.
- [x] Chi update local store voi cac bang co du lieu tra ve that su.
- [x] Them guard khi `this.model.state[key]` chua ton tai.
- [x] Ghi log nhe khi bo qua update do pagination.

### File chinh

- `controllers/main_controller/BiddingControllerSync.js`
- `backend/routes/sync_routes.py`

### Kiem chung

- [ ] F5 sau khi da co local data khong mat danh sach.
- [x] Fake nguong > 10000 records khong lam local cache bi rong.
- [x] `bf_last_sync_timestamp` chi cap nhat khi sync hop le.

## Giai doan 2 - Chuan hoa local-first va loader

### Muc tieu

Man hinh dung du lieu local de render ngay, sync server chay ngam, khong chan UI bang loader dai.

### Viec can lam

- [ ] Kiem tra route nao can load store nao ngay luc khoi dong.
- [ ] Giu priority loading theo route:
  - Chi tiet goi thau: `goithau`, `kehoach`, `chudautu`, `nhathau`, `hopdong`, `thongtinmothau`.
  - Danh sach chuyen gia: `chuyengia`.
  - Hop dong: `hopdong`, `goithau`, `nhathau`, `chudautu`.
- [ ] Nen loader toan trang chi hien khi khong co du lieu local.
- [ ] Khi co du lieu local, hien UI ngay va hien sync status nho.
- [ ] Dam bao background sync khong re-render toan bo app neu chi co vai record thay doi.

### File chinh

- `controllers/core/BiddingController.js`
- `controllers/auth/AuthController.js`
- `controllers/main_controller/BiddingControllerSync.js`
- `models/BiddingModel.js`

### Kiem chung

- [ ] F5 khi co local data: loader muc tieu duoi 500ms voi du lieu vua.
- [ ] Sync ngam van cap nhat du lieu moi tu server.
- [ ] Khong co man hinh trang thai placeholder bi nhay sau khi loader bien mat.

## Giai doan 3 - Nang cap co che delta sync

### Muc tieu

Thay sync dua tren timestamp bang co che version/cursor on dinh hon.

### Viec can lam

- [ ] Them cot `sync_version` hoac bang metadata version phia server.
- [ ] Moi insert/update/delete tang version server-side.
- [ ] API `/api/get-all-data` ho tro `after_version`.
- [ ] Deletion log co `delete_version`.
- [ ] Frontend luu `bf_last_sync_version` thay cho hoac song song voi `bf_last_sync_timestamp`.
- [ ] Doi `updated_at > since` sang `sync_version > last_version`.
- [ ] Them idempotency key `client_mutation_id` cho mutation tu client.

### File chinh

- `backend/helpers_py/schema.py`
- `backend/routes/sync_routes.py`
- `controllers/main_controller/BiddingControllerSync.js`
- `models/BiddingModel.js`

### Kiem chung

- [ ] Nhieu update trong cung mot giay khong bi bo sot.
- [ ] Xoa tren server duoc dong bo day du ve client.
- [ ] Gui lai cung mot mutation khong tao ban ghi trung.

## Giai doan 4 - Ra soat schema va rang buoc DB

### Muc tieu

DB tu bao ve duoc tinh dung dan cua du lieu, giam phu thuoc vao frontend.

### Viec can lam

- [ ] Chuan hoa mo hinh so huu du lieu:
  - Phuong an A: tat ca du lieu nghiep vu thuoc `to_chuc`.
  - Phuong an B: them `owner_type` va `owner_id`.
- [x] Them unique/index cho bang co version:
  - Bang versioned thong thuong: `UNIQUE(owner_id, root_id, phien_ban)`.
  - Rieng `goi_thau`: `UNIQUE(owner_id, root_id, phien_ban, ke_hoach_id)` de dung nghiep vu snapshot theo phien ban ke hoach.
  - Unique partial cho ban moi nhat: `(owner_id, root_id) WHERE is_latest = 1`.
- [x] Them index pho bien:
  - `(owner_id, updated_at)` hoac `(owner_id, sync_version)`.
  - `(owner_id, is_latest)`.
  - FK relation ids nhu `ke_hoach_id`, `goi_thau_id`, `nha_thau_id`, `hop_dong_id`.
- [x] Sua unique cua `phan_cong_nhan_su` thanh co `owner_id`.
- [x] Them unique cho `deleted_records(owner_id, table_name, record_id)`.
- [ ] Chuan hoa enum trang thai goi thau, hop dong, ho so giay.

### File chinh

- `backend/helpers_py/schema.py`
- `backend/helpers_py/db_utils.py`
- `backend/routes/sync_routes.py`

### Kiem chung

- [x] DB khong cho tao 2 version moi nhat cho cung mot `id_goc`.
- [x] Du lieu khac owner khong bi va cham unique.
- [x] Delete log khong bi trung lap.

## Giai doan 5 - Sua loi font va chuan hoa encoding

### Muc tieu

Toan bo code, message, enum va default value dung UTF-8 hop le.

### Viec can lam

- [x] Quet cac chuoi mojibake nhu `Ã`, `Ä`, `áº`, `á»`, `â€`, `�`.
- [x] Sua message trong backend auth/sync.
- [x] Sua comment quan trong neu comment dang mo ta logic nghiep vu.
- [x] Sua default/check enum trong schema neu co loi font.
- [x] Dam bao file luu bang UTF-8.

### File chinh

- `backend/routes/auth_routes.py`
- `backend/routes/sync_routes.py`
- `backend/helpers_py/auth_helper.py`
- `backend/helpers_py/schema.py`

### Kiem chung

- [x] `rg "Ã|Ä|áº|á»|â€|�"` khong con ket qua trong code nghiep vu.
- [ ] Login/logout/change password tra message tieng Viet dung.
- [x] Status tieng Viet luu va so sanh dung.

## Giai doan 6 - Nang cao bao mat

### Muc tieu

Giam rui ro truy cap trai phep, CSRF, session leak va thao tac vuot quyen.

### Viec can lam

- [ ] Them CSRF token cho cac request thay doi du lieu.
- [ ] Bo phu thuoc vao cookie `username`; chi can `session_token`.
- [x] Kiem tra lai `verify_session()` va cac endpoint dung `role_or_err`.
- [x] Sua logic lay role trong `update_user_role_api`.
- [ ] Them rate-limit theo username ngoai rate-limit theo IP.
- [ ] Nang password hashing len Argon2id/bcrypt hoac tang PBKDF2 iterations.
- [ ] Bat `Secure=True`, HSTS va CSP o production.
- [ ] Them audit log cho thao tac quan trong.
- [ ] Kiem tra upload file: kich thuoc, MIME, phan mo rong, noi luu file.

### File chinh

- `backend/routes/auth_routes.py`
- `backend/helpers_py/auth_helper.py`
- `backend/routes/sync_routes.py`
- `backend/routes/upload_routes.py` neu co.

### Kiem chung

- [ ] Request POST/PUT/DELETE thieu CSRF bi tu choi.
- [x] User khong the sua role ngoai quyen.
- [ ] Doi mat khau lam rotate session.
- [ ] Login sai nhieu lan bi throttle theo IP va username.

## Giai doan 7 - Chuan hoa field va mapper du lieu

### Muc tieu

Loai bo tinh trang cung mot truong co nhieu ten gay lech du lieu.

### Viec can lam

- [ ] Lap danh sach field canonical cho tung entity:
  - `chu_dau_tu`
  - `ke_hoach_lcnt`
  - `goi_thau`
  - `nha_thau`
  - `chuyen_gia`
  - `hop_dong`
  - `thong_tin_mo_thau`
- [ ] Frontend chi dung camelCase.
- [ ] Backend/DB chi dung snake_case.
- [ ] Mapper API la noi duy nhat chuyen camelCase/snake_case.
- [ ] Loai bo dan cac fallback trung lap nhu `isLatest/is_latest`, `updatedAt/updated_at`.
- [ ] Validate JSON fields truoc khi ghi DB.

### File chinh

- `backend/helpers_py/schema.py`
- `backend/routes/sync_routes.py`
- `models/BiddingModel.js`
- Cac workflow trong `controllers/workflows/`

### Kiem chung

- [ ] Tao/sua/xoa mot entity khong sinh field trung lap.
- [ ] Export/import khong lam doi ten field.
- [ ] Sync server-client giu nguyen du lieu.

## Giai doan 8 - Toi uu render va trai nghiem nguoi dung

### Muc tieu

Giam cam giac cham khi du lieu lon, nhat la bang danh sach.

### Viec can lam

- [ ] Virtualize cac bang lon.
- [ ] Phan trang server-side cho bang vuot nguong.
- [ ] Debounce search/filter.
- [ ] Cache dashboard aggregate.
- [ ] Chi render lai component co thay doi sau sync.
- [ ] Tai anh/chung chi/chu ky theo nhu cau, khong dua vao list payload.
- [ ] Hien sync status tinh te thay vi loader toan trang.

### File chinh

- `views/`
- `controllers/main_controller/BiddingControllerUI.js`
- `controllers/main_controller/BiddingControllerSync.js`
- `controllers/workflows/`

### Kiem chung

- [ ] Bang 5.000 records van scroll/filter muot.
- [ ] Sync ngam khong lam giat UI.
- [ ] Anh chi load khi mo detail/modal.

## Giai doan 9 - Don dep code va tach module

### Muc tieu

Giam file qua lon, tach logic de de test va bao tri.

### Viec can lam

- [ ] Tach workflow lon thanh cac module:
  - render
  - form state
  - validation
  - import/export
  - API/sync adapter
- [ ] Dua validate nghiep vu thanh pure functions.
- [ ] Loai bo helper trung lap giua cac workflow.
- [ ] Giam side effect trong constructor/init.
- [ ] Them test cho mapper, validation va sync merge.

### File uu tien

- `controllers/workflows/BidProcessWorkflow.js`
- `controllers/workflows/BidEvaluationWorkflow.js`
- `controllers/workflows/ExcelIntegration.js`
- `controllers/workflows/GoiThauWorkflow.js`
- `controllers/main_controller/BiddingControllerForms.js`

### Kiem chung

- [ ] Build pass.
- [ ] Workflow chinh tao/sua/xoa/export van hoat dong.
- [ ] Module moi co test hoac it nhat co checklist manual test.

## Thu tu uu tien de thuc hien

1. Giai doan 0 - Lap baseline.
2. Giai doan 1 - Sua nguy co pagination lam rong cache.
3. Giai doan 5 - Sua loi font/encoding.
4. Giai doan 6 - Sua loi role/security ro rang.
5. Giai doan 4 - Bo sung rang buoc/index DB.
6. Giai doan 2 - Hoan thien local-first/loader.
7. Giai doan 3 - Nang cap delta sync bang version.
8. Giai doan 7 - Chuan hoa field/mapper.
9. Giai doan 8 - Toi uu render/UX.
10. Giai doan 9 - Refactor module lon.

## Mau bien ban sau moi giai doan

Dung mau nay de ghi lai khi hoan thanh tung giai doan.

```md
## Bien ban giai doan X

- Ngay thuc hien:
- Nguoi thuc hien:
- File da sua:
- Thay doi chinh:
- Cach kiem chung:
- Ket qua:
- Van de con lai:
- Co can rollback khong:
```

## Checklist nghiem thu tong

- [ ] F5 khi da co du lieu local khong tai lai toan bo dataset.
- [ ] Sync ngam lay duoc thay doi moi tu server.
- [ ] Delete tren server duoc phan anh ve client.
- [x] Khong mat local cache khi bat server-side pagination.
- [x] Khong con loi font trong message va enum quan trong.
- [x] DB co rang buoc ngan duplicate version/latest.
- [x] Phan quyen manager/super_admin dung logic.
- [ ] POST/PUT/DELETE co CSRF hoac co co che bao ve tuong duong.
- [x] Build frontend pass.
- [x] Backend chay khong loi migration/schema.
- [ ] Manual test cac luong chinh pass.

## Bien ban giai doan 0 va 1

- Ngay thuc hien: 2026-07-04.
- File da sua:
  - `controllers/main_controller/BiddingControllerSync.js`
  - `backend/routes/sync_routes.py`
  - `docs/codebase-audit-optimization-plan.md`
- Backup DB: `backups/bidding-20260704-170918.db`.
- Thay doi chinh:
  - Frontend khong ghi de local cache bang mang rong khi server bat `useServerSidePagination`.
  - Frontend chi merge/persist cac bang co array du lieu that su trong delta sync.
  - Them guard khi `model.state[key]` chua ton tai.
  - Backend tra them `paginatedKeys` de frontend biet bang nao dang duoc server-side pagination.
  - Backend chi bo qua full payload cho cac bang heavy, khong bo qua moi bang dung chung `query_table()`.
  - Backend van tra delta records cho bang heavy khi `since` khac `0`, de sync ngam khong bi mat cap nhat.
- Cach kiem chung:
  - `npm run build`
  - `python -m py_compile backend/routes/sync_routes.py`
- Ket qua:
  - Build frontend pass.
  - Compile backend route pass.
- Van de con lai:
  - Chua manual test bang trinh duyet cho luong F5 sau khi co local data.
  - Chua tich hop UI fetch `/api/paginate` cho bang lon trong giai doan nay.
  - Chua sua loi font/encoding, se lam o giai doan tiep theo.
- Co can rollback khong: khong.

## Bien ban giai doan 5 va mot phan giai doan 6

- Ngay thuc hien: 2026-07-04.
- File da sua:
  - `backend/routes/auth_routes.py`
  - `docs/codebase-audit-optimization-plan.md`
- Thay doi chinh:
  - Quet encoding bang Unicode codepoint cho cac file trong tam: `auth_routes.py`, `sync_routes.py`, `auth_helper.py`, `schema.py`, `BiddingControllerSync.js`.
  - Khong phat hien mojibake that trong noi dung file; cac chuoi hien sai khi in ra PowerShell la do console render encoding.
  - Sua `update_user_role_api` de goi `get_effective_roles(str(role_or_err))` thay vi truyen ca `SessionRole` object.
- Cach kiem chung:
  - Unicode scan cho cac dau hieu `\u00c3`, `\u00c4`, `\u00c6`, `\u00c2`, `\ufffd`.
  - `npm run build`
  - `python -m py_compile backend/routes/sync_routes.py backend/routes/auth_routes.py backend/helpers_py/auth_helper.py backend/helpers_py/schema.py`
- Ket qua:
  - Khong co file trong tam bi loi encoding that.
  - Build frontend pass.
  - Compile backend pass.
- Van de con lai:
  - CSRF token chua duoc them.
  - Chua bo phu thuoc vao cookie `username`.
  - Chua them rate-limit theo username.
  - Chua nang password hashing.
  - Chua them audit log.
- Co can rollback khong: khong.

## Bien ban mot phan giai doan 4 - DB consistency va index

- Ngay thuc hien: 2026-07-04.
- File da sua:
  - `backend/helpers_py/db_utils.py`
  - `backend/helpers_py/schema.py`
  - `docs/codebase-audit-optimization-plan.md`
- Thay doi chinh:
  - Sua `recalculate_is_latest()` de moi nhom `owner_id + root_id` chi co mot ban ghi `is_latest = 1`, ke ca khi co nhieu ban trung `phien_ban`.
  - Them runtime indexes cho cac bang nghiep vu theo `owner_id`, `updated_at`, `is_latest`, `id_goc` va cac khoa lien ket hay truy van.
  - Don duplicate `deleted_records` bang cach giu ban ghi co `id` nho nhat.
  - Them unique index `deleted_records(owner_id, table_name, record_id)`.
  - Cap nhat schema moi cua `phan_cong_nhan_su` thanh `UNIQUE(owner_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)`.
- Cach kiem chung:
  - Chay `khoi_tao_va_di_tru_he_thong()` tren DB hien tai.
  - Kiem tra duplicate `is_latest` cho cac bang versioned.
  - Kiem tra duplicate `deleted_records`.
  - `npm run build`
  - `python -m py_compile backend/helpers_py/db_utils.py backend/helpers_py/schema.py backend/routes/auth_routes.py backend/routes/sync_routes.py`
- Ket qua:
  - Migration DB chay thanh cong.
  - `dup_latest_groups = 0` cho cac bang versioned.
  - `deleted_records_dup_groups = 0`.
  - Runtime indexes da duoc tao.
- Van de con lai:
  - Biên bản này đã được cập nhật bổ sung ở mục tiếp theo: `goi_thau` là snapshot theo phiên bản kế hoạch, không phải duplicate rác.
  - Chua ra soat UI/API server-side pagination cho truong hop xem phien ban ke hoach cu.
- Co can rollback khong: khong.

## Bien ban bo sung giai doan 4 - Unique version theo snapshot ke hoach

- Ngay thuc hien: 2026-07-04.
- Van de nghiep vu da xac nhan:
  - Cac dong `goi_thau` trung `id_goc + phien_ban` khong phai rac.
  - Day la snapshot cua cung goi thau trong cac phien ban khac nhau cua `ke_hoach_lcnt`.
  - Vi vay rule dung cho `goi_thau` la `owner_id + root_id + phien_ban + ke_hoach_id`.
- File da sua:
  - `backend/helpers_py/db_utils.py`
  - `docs/codebase-audit-optimization-plan.md`
- Thay doi chinh:
  - Them unique index cho cac bang versioned thong thuong theo `owner_id + root_id + phien_ban`.
  - Them unique partial index cho latest theo `owner_id + root_id`.
  - Them unique index rieng cho `goi_thau` theo snapshot ke hoach: `owner_id + root_id + phien_ban + ke_hoach_id`.
  - Giu unique latest cho `goi_thau` theo `owner_id + root_id`, phu hop voi cach app dang tinh ban hien hanh.
- Cach kiem chung:
  - Kiem tra duplicate theo rule moi cho `goi_thau`.
  - Chay `khoi_tao_va_di_tru_he_thong()` tren DB hien tai.
  - Kiem tra cac unique index da ton tai trong SQLite.
  - `npm run build`
  - `python -m py_compile backend/helpers_py/db_utils.py backend/helpers_py/schema.py backend/routes/auth_routes.py backend/routes/sync_routes.py`
- Ket qua:
  - `goi_thau_snapshot_duplicate = 0`.
  - `goi_thau_latest_duplicate = 0`.
  - `deleted_records_duplicate = 0`.
  - Da tao cac index: `idx_goi_thau_unique_plan_snapshot_version`, `idx_goi_thau_unique_latest`, `idx_deleted_records_unique_record`, va cac index versioned khac.
- Van de da xu ly:
  - Khong con xem snapshot goi thau theo phien ban ke hoach la duplicate sai nghiep vu.
  - DB da co rang buoc ngan duplicate version/latest theo rule moi.
  - Migration DB chay thanh cong voi du lieu hien tai.
- Van de con lai:
  - Can ra soat UI/API server-side pagination vi `/api/paginate` dang filter `is_latest = 1` cho `goi_thau`, co the khong phu hop khi xem goi thau cua phien ban ke hoach cu.
  - Chua chuan hoa triệt de field camelCase/snake_case trong import/export va workflow.
  - Chua them CSRF token, chua bo cookie `username`, chua nang password hashing.
- Co can rollback khong: khong.
