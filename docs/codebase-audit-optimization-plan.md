# Backlog con lai - BiddingFlow

File nay chi giu cac viec chua thuc hien hoac chua duoc manual test day du.

## Giai doan 0 - Baseline va kiem chung hieu nang

- [ ] Ghi lai dung luong IndexedDB/localStorage sau khi dang nhap admin.
- [ ] Do thoi gian F5 tai cac man:
  - Dashboard.
  - Danh sach goi thau.
  - Chi tiet goi thau.
  - Hop dong.
  - Chuyen gia.
- [ ] Ghi lai so request API khi F5.
- [ ] Ghi lai thoi gian loader toan trang hien thi.
- [ ] Manual test F5 sau khi da co local data de xac nhan khong mat danh sach.

## Giai doan 2 - Local-first va loader

- [ ] Kiem tra route nao can load store nao ngay luc khoi dong.
- [ ] Hoan thien priority loading theo route:
  - Chi tiet goi thau: `goithau`, `kehoach`, `chudautu`, `nhathau`, `hopdong`, `thongtinmothau`.
  - Danh sach chuyen gia: `chuyengia`.
  - Hop dong: `hopdong`, `goithau`, `nhathau`, `chudautu`.
- [ ] Dam bao loader toan trang chi hien khi khong co du lieu local.
- [ ] Khi co du lieu local, hien UI ngay va chi hien sync status nho.
- [ ] Dam bao background sync khong re-render toan bo app neu chi co vai record thay doi.
- [ ] Xac nhan F5 khi co local data dat muc tieu loader duoi 500ms voi du lieu vua.
- [ ] Kiem tra khong con man hinh placeholder bi nhay sau khi loader bien mat.

## Giai doan 3 - Delta sync bang version/cursor

- [ ] Manual test WebSocket + `sync_version`: server thay doi thi client nhan event va keo delta bang `after_version`.
- [ ] Kiem tra nhieu update trong cung mot giay khong bi bo sot.
- [ ] Kiem tra xoa tren server duoc dong bo day du ve client.
- [ ] Kiem tra gui lai cung mot mutation khong tao ban ghi trung.

## Giai doan 4 - DB/schema con lai

- [ ] Chuan hoa mo hinh so huu du lieu:
  - Phuong an A: tat ca du lieu nghiep vu thuoc `to_chuc`.
  - Phuong an B: them `owner_type` va `owner_id`.
- [ ] Chuan hoa enum trang thai goi thau, hop dong, ho so giay.
- [ ] Ra soat FK `owner_id` cua `hop_dong` dang tham chieu `to_chuc(id)` trong khi cac bang khac de `owner_id TEXT`.
- [ ] Manual test migration/schema tren DB hien tai va DB moi tao.

## Giai doan 5 - Font/encoding

- [ ] Manual test login/logout/change password tra message tieng Viet dung tren browser.

## Giai doan 6 - Bao mat con lai

- [ ] Manual test POST/PUT/DELETE thieu hoac sai CSRF token bi tu choi.
- [ ] Manual test login/check-session/logout tren browser da co cookie `username` cu.
- [ ] Manual test login dung khong tieu quota, login sai nhieu lan bi throttle theo IP va username.
- [ ] Manual/config production: dat `APP_SECURE_COOKIES=True`, HTTPS reverse proxy gui `X-Forwarded-Proto=https`, va kiem tra CSP/HSTS tren browser.
- [ ] Manual test audit log phat sinh cho login, logout, doi mat khau va thao tac quan tri user/goi dich vu.
- [ ] Manual test upload file hop le/khong hop le cho Word template, Excel import va anh/chung chi/chu ky.
- [ ] Can nhac chuyen password hashing sang Argon2id/bcrypt neu chap nhan them dependency.

## Giai doan 7 - Chuan hoa field va mapper du lieu

- [ ] Lap danh sach field canonical cho tung entity:
  - `chu_dau_tu`.
  - `ke_hoach_lcnt`.
  - `goi_thau`.
  - `nha_thau`.
  - `chuyen_gia`.
  - `hop_dong`.
  - `thong_tin_mo_thau`.
- [ ] Frontend chi dung camelCase.
- [ ] Backend/DB chi dung snake_case.
- [ ] Mapper API la noi duy nhat chuyen camelCase/snake_case.
- [ ] Loai bo dan cac fallback trung lap nhu `isLatest/is_latest`, `updatedAt/updated_at`.
- [ ] Validate JSON fields truoc khi ghi DB.
- [ ] Kiem tra tao/sua/xoa mot entity khong sinh field trung lap.
- [ ] Kiem tra export/import khong lam doi ten field.
- [ ] Kiem tra sync server-client giu nguyen du lieu.

## Giai doan 8 - Render va UX

- [ ] Manual test voi DB lon de xac nhan man chi tiet ke hoach cu hien dung snapshot goi thau.
- [ ] Virtualize cac bang lon.
- [ ] Debounce search/filter.
- [ ] Cache dashboard aggregate.
- [ ] Chi render lai component co thay doi sau sync.
- [ ] Tai anh/chung chi/chu ky theo nhu cau, khong dua vao list payload.
- [ ] Hien sync status tinh te thay vi loader toan trang.
- [ ] Kiem tra bang 5.000 records van scroll/filter muot.
- [ ] Kiem tra sync ngam khong lam giat UI.
- [ ] Kiem tra anh chi load khi mo detail/modal.

## Giai doan 9 - Don dep code va tach module

- [ ] Tach workflow lon thanh cac module:
  - Render.
  - Form state.
  - Validation.
  - Import/export.
  - API/sync adapter.
- [ ] Dua validate nghiep vu thanh pure functions.
- [ ] Loai bo helper trung lap giua cac workflow.
- [ ] Giam side effect trong constructor/init.
- [ ] Them test cho mapper, validation va sync merge.
- [ ] Refactor cac file uu tien:
  - `controllers/workflows/BidProcessWorkflow.js`.
  - `controllers/workflows/BidEvaluationWorkflow.js`.
  - `controllers/workflows/ExcelIntegration.js`.
  - `controllers/workflows/GoiThauWorkflow.js`.
  - `controllers/main_controller/BiddingControllerForms.js`.
- [ ] Kiem tra workflow chinh tao/sua/xoa/export van hoat dong.

## Uu tien tiep theo

1. Manual test F5/local-first va snapshot goi thau theo phien ban ke hoach.
2. Manual test CSRF, login/check-session/logout va WebSocket + `sync_version`.
3. Chuan hoa owner model va enum trang thai.
4. Chuan hoa mapper camelCase/snake_case.
5. Toi uu loader/local-first va render cac bang lon.
