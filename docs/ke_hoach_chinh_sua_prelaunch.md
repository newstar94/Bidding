# Ke hoach chinh sua pre-launch BiddingFlow

Muc tieu: dua code ve trang thai san sang chay lan dau, khong can giu tuong thich du lieu cu, nhung van giu day du kha nang them/sua/cap nhat du lieu sau nay.

## 1. Uu tien P0 - Bao mat va toan ven du lieu

### 1.1 Dua RBAC ve backend lam nguon su that

- Tao lop policy backend tap trung, vi du `backend/helpers_py/access_policy.py`.
- Ap dung policy vao cac API:
  - `/api/get-all-data`
  - `/api/paginate`
  - `/api/sync`
  - cac API export/import Word, Excel, Docx
  - cac API quan tri nguoi dung/to chuc
- Nguyen tac:
  - `super_admin`: xem/quan tri toan he thong theo allowlist IP neu bat.
  - `manager`: doc/ghi du lieu trong active organization.
  - `employee`: chi doc/ghi module va ban ghi duoc phan quyen/phan cong.
- Khong cho employee sync sua `permissionmatrix`, `assignments`, `organizations`, `employees`, `systempackages`.
- Kiem tra record-level permission truoc khi insert/update/delete tung ban ghi trong sync.

### 1.2 Khoa chat owner/tenant trong schema moi

- Doi cac bang tenant-scoped sang `owner_id TEXT NOT NULL`.
- Them `CHECK(owner_id != '')` cho cac bang nghiep vu.
- Them `created_by`, `updated_by` cho cac bang sync chinh neu can audit chi tiet.
- Them `owner_id` vao cac bang junction:
  - `hop_dong_goi_thau`
  - `goi_thau_chuyen_gia`
- Validate tat ca quan he foreign key deu cung `owner_id` truoc khi ghi.

### 1.3 Lam sync atomic hon

- Khong nuot loi tung item roi commit tiep.
- Neu batch sync co loi validate/constraint khong duoc phep, rollback toan batch va tra ve danh sach loi co cau truc.
- Chi chap nhan bo qua orphan record neu do la truong hop da dinh nghia ro, dong thoi tra `orphanedIds` ve client.
- Tach `sync_api` thanh cac buoc ro:
  - parse payload
  - authorize
  - validate
  - normalize
  - apply mutation
  - recalculate derived fields
  - commit + broadcast

### 1.4 Giam rui ro XSS

- Mac dinh dung `textContent` khi render title/message/toast/dialog.
- Tao helper render HTML an toan neu can rich text.
- Khong truyen truc tiep data nguoi dung vao `innerHTML`.
- Doi cac lightbox anh chung chi/chu ky sang `createElement('img')`, validate URL chi chap nhan:
  - `/uploads/...`
  - `data:image/...` neu that su can
- Ra soat cac view dung `innerHTML` voi du lieu tu DB/Excel/import.

### 1.5 Siet cau hinh production

- `APP_SECURE_COOKIES=True` khi chay HTTPS.
- `SUPER_ADMIN_IP_ALLOWLIST` khong de `*` trong production.
- Thiet lap `CORS_ORIGINS` dung domain that.
- Giam phu thuoc `style-src 'unsafe-inline'` bang cach chuyen inline style sang CSS class.
- Them `Permissions-Policy` va `Cross-Origin-Opener-Policy` neu khong anh huong Google login.

## 2. Uu tien P1 - Dong nhat DB, mapping va logic thuc the

### 2.1 Tao mot schema contract duy nhat

- Giu `backend/helpers_py/schema.py` lam source of truth.
- Sinh tu dong field map frontend hoac export JSON schema cho frontend dung.
- Bo cac mapping trung lap neu co the:
  - `FIELD_NAME_OVERRIDES` trong frontend
  - `field_map` rieng le khong can thiet
- Them test mapping 2 chieu:
  - snake_case -> camelCase
  - camelCase -> snake_case
  - JSON field parse/stringify

### 2.2 Chuan hoa ngay gio

- Chon mot dinh dang luu DB: `YYYY-MM-DD HH:mm:ss`.
- Normalize tat ca input ngay gio tren backend truoc khi ghi.
- Bo logic filter bang `substr` cho nhieu dinh dang sau khi da chuan hoa.
- Them helper query theo nam/thang bang range:
  - `>= '2026-01-01 00:00:00'`
  - `< '2027-01-01 00:00:00'`

### 2.3 Tang rang buoc DB cho du lieu moi

- Them partial unique index theo `owner_id` cho cac ma nghiep vu:
  - `chu_dau_tu.ma_chu_dau_tu`
  - `chu_dau_tu.ma_so_thue`
  - `ke_hoach_lcnt.ma_ke_hoach`
  - `goi_thau.ma_goi_thau`
  - `nha_thau.ma_nha_thau`
  - `nha_thau.ma_so_thue`
  - `chuyen_gia.so_cccd`
  - `hop_dong.so_hop_dong`
- Them `CHECK` cho cac enum quan trong:
  - `owner_type`
  - `trang_thai`
  - `phan_lo`
  - `tuy_chon_mua_them`
  - `yeu_cau_tham_dinh_hsmt`
### 2.4 Kiem tra logic versioning

- Giu co che `id_goc`, `phien_ban`, `is_latest`.
- Dinh nghia lai ro quy tac rieng cua `goi_thau` khi gan voi snapshot phien ban ke hoach.
- Them test cho:
  - tao phien ban moi
  - xoa latest version
  - recalculate `is_latest`
  - unique latest per root
  - copy/snapshot goi thau theo phien ban ke hoach

## 3. Uu tien P1 - Toi uu toc do va trai nghiem nguoi dung

### 3.1 Sync delta that su

- Khong gui toan bo `model.state` moi lan auto sync.
- Luu local mutation queue theo dang:
  - `upserts`
  - `deletes`
  - `clientMutationId`
  - `baseSyncVersion`
- Backend tra ve conflict neu client sua tren version cu.
- UI hien conflict resolution neu can.

### 3.2 Server-side pagination som hon

- Dung `/api/paginate` cho cac bang nang ngay tu dau, khong doi tong record > 10000.
- Chi preload du lieu can cho dashboard/route hien tai.
- Detail view fetch theo ID rieng neu local cache chua co.

### 3.3 Tim kiem nhanh hon

- Them SQLite FTS5 cho:
  - ke hoach
  - goi thau
  - chu dau tu
  - nha thau
  - hop dong
- Dung search endpoint rieng thay cho `LIKE '%term%'` o cac bang lon.

### 3.4 Giam bundle va tai cham

- Code-split cac module nang:
  - WordIntegration
  - ExcelIntegration
  - GoiThauDetail
  - cac module export/import
- Lazy-load vendor `xlsx` va flatpickr khi can.
- Giu service worker, nhung them cache version ro va cach invalidate.

### 3.5 UX khi loi va offline

- Hien loi sync theo tung ban ghi trong UI, khong chi console.
- Co man hinh "du lieu dang duoc dong bo" nhe cho lan dau.
- Neu user mat quyen active org, tu dong reset workspace va chon org hop le tiep theo.
- Them toast/action de tai lai du lieu khi conflict.

## 4. Uu tien P2 - Tinh gon code frontend

### 4.1 Giam global `window.*`

- Giu delegated actions hien co.
- Chuyen cac ham global sang command registry noi bo.
- Cac view chi render `data-bf-action`, controller xu ly tap trung.

### 4.2 Tach render an toan

- Tao helper:
  - `textCell(value)`
  - `htmlIcon(name)`
  - `safeAttr(value)`
  - `renderEmptyRow(colspan, message)`
- Cac table row renderer phai escape du lieu mac dinh.

### 4.3 Don dep state va storage

- Phan tach:
  - session state
  - workspace data
  - UI preferences
  - sync metadata
- Khong luu duplicate active user o qua nhieu noi neu khong can.
- Them ham reset workspace theo org/user that ro rang.

## 5. Uu tien P2 - Backend cleanup

### 5.1 Tach sync route

- Tach file lon `sync_routes.py` thanh:
  - `sync_routes.py`
  - `sync_service.py`
  - `sync_queries.py`
  - `sync_authorization.py`
  - `sync_serializers.py`
- Giu route mong, service xu ly logic.

### 5.2 Quan ly migration cho DB moi

- Vi khong can giu du lieu cu, co the tao schema moi sach hon.
- Van nen them `schema_version` de sau nay migrate co kiem soat.
- Neu tiep tuc dung auto-rebuild schema, can log ro bang nao bi rebuild.

## 6. Uu tien P3 - Test va CI local

### 6.1 Them test backend quan trong

- Auth/session:
  - login
  - expired token
  - role hierarchy
  - active org access
- Sync:
  - manager write ok
  - employee write denied neu khong co quyen
  - cross-owner FK denied
  - batch rollback khi co loi
  - deletion log va delta sync
- DB:
  - unique indexes
  - `is_latest`
  - `tong_muc_dau_tu`

### 6.2 Hoan thien seed first-run

- Seed admin/to chuc/goi dich vu ro rang.
- Them test/kiem tra tu dong cho case thieu `ADMIN_PASSWORD` de dam bao server fail-fast dung thong diep.

## 7. Thu tu trien khai de it rui ro

1. Tao access policy backend, ap vao read APIs truoc.
2. Ap policy vao write/sync/delete/export.
3. Chinh schema moi: `owner_id NOT NULL`, owner cho junction, unique/check constraints.
4. Sua sync atomic va validate cross-owner FK.
5. Xu ly cac diem XSS ro nhat: toast/dialog/lightbox.
6. Chuan hoa ngay gio va query theo range.
7. Chuyen sync sang mutation queue/delta.
8. Code-split va lazy-load cac module nang.
9. Don dep global `window.*`, renderer, storage state.

## 8. Tieu chi hoan thanh

- Chay lan dau tao duoc DB sach, admin va org mac dinh dung cau hinh.
- Employee khong the doc/ghi du lieu ngoai phan quyen bang cach goi API truc tiep.
- Khong co quan he cross-owner trong DB.
- Sync rollback khi batch loi, khong de client/server lech am tham.
- Build production pass.
- Test JS va Python compile pass qua mot lenh check.
- Cac luong tao/sua/xoa du lieu van hoat dong:
  - chu dau tu
  - ke hoach
  - goi thau
  - nha thau
  - chuyen gia
  - hop dong
  - mo thau/danh gia
  - phan quyen/phan cong
  - export/import
