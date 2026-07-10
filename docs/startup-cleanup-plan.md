# Ke hoach don dep code va toi uu khoi tao lan dau

Muc tieu cua ke hoach nay la giam viec khong can thiet khi nguoi dung vua mo ung dung, dac biet voi database moi hoac khi chua dang nhap. Cac viec duoc sap xep theo muc do anh huong den toc do loading, rui ro thay doi, va kha nang do lai bang automation.

## Tieu chi thanh cong

- Khi chua dang nhap, ung dung khong tao IndexedDB workspace neu khong can.
- Khi chua dang nhap, khong goi cac API du lieu noi bo nhu `/api/get-all-data`, `/api/auth/users`, `/api/system-packages`.
- Khi chua dang nhap, khong mo WebSocket sync.
- Giam so module JS nam trong lan tai dau.
- Giam import Python nang khi server khoi dong, dac biet cac nhom Excel/Word/export.
- Xoa code chet va code trung lap ma khong doi hanh vi nguoi dung.
- Sau moi nhom thay doi quan trong, chay build/test va do lai loading de so sanh.

## Baseline hien tai

Ket qua ra soat gan nhat cho thay:

- Bundle chinh van lon, `app.bundle.js` khoang 433 kB truoc gzip.
- Lan mo app khi chua dang nhap van goi:
  - `POST /api/auth/check-session`
  - `GET /api/holidays`
  - `GET /api/get-all-data?since=0`
  - `GET /api/auth/users`
  - `GET /api/system-packages`
- Lan mo app khi chua dang nhap van tao `BiddingFlowDB` voi nhieu object store.
- Mousemove ghi `localStorage.lastActivity` qua nhieu lan, co the len hang chuc lan chi trong vai giay.
- Backend import Excel stack kha som, trong do `pandas/openpyxl` lam tang thoi gian import.
- Mot so code chet da xac dinh ro:
  - `controllers/main_controller/domUtils.js`: `bindCurrencyElements`
  - `views/subviews/view_helpers.js`: `textCell`
  - `views/subviews/PartnerView.js`: `getJointVentureMemberHTML`
  - `backend/routes/auth_routes.py`: `_check_session_api_legacy`
  - `controllers/app.js`: `syncSessionBetweenTabs` dang la no-op

## Buoc 1: Chan bootstrap du lieu truoc khi dang nhap

Muc tieu: man hinh login chi lam viec can thiet cho login, khong khoi tao workspace.

Viec can lam:

- Kiem tra flow trong `controllers/app.js` va `controllers/core/BiddingController.js`.
- Chi goi `model.init()`, preload workflow, hydrate du lieu, holidays, auto sync va WebSocket sau khi co session hop le.
- Dam bao sau khi dang nhap thanh cong, cac tac vu workspace van khoi tao dung thu tu.
- Dam bao F5 khi da co session van vao app binh thuong.

Kiem thu:

- Them/Cap nhat E2E an danh:
  - Mo app khi chua dang nhap.
  - Xac nhan overlay login hien thi.
  - Xac nhan khong co `/api/get-all-data`, `/api/auth/users`, `/api/system-packages`.
  - Xac nhan khong co WebSocket sync.
- Chay:
  - `npm run build`
  - `npm run test:api`
  - `npm run test:e2e`

Do lai:

- Do loading lan dau khi chua dang nhap.
- Do F5 khi da dang nhap.
- Ghi lai so request, WebSocket, IndexedDB va thoi gian hien thi man hinh login/app.

## Buoc 2: Giam ghi localStorage khi theo doi hoat dong

Muc tieu: tranh ghi `localStorage` qua day dac trong luc nguoi dung di chuyen chuot.

Viec can lam:

- Sua `controllers/auth/AuthController.js`.
- Gan activity tracker mot cach idempotent.
- Throttle/debounce viec ghi `lastActivity`, vi du chi ghi toi da moi 15-30 giay.
- Can nhac chi bat tracker sau khi session hop le.

Kiem thu:

- Test login/session khong bi het han sai.
- Test thao tac mousemove lien tuc khong ghi localStorage lien tuc.

Do lai:

- So lan ghi `lastActivity` trong 3-5 giay.
- Kiem tra console khong co loi.

## Buoc 3: Xoa code chet ro rang

Muc tieu: giam nhieu lop code khong con duoc goi, khong cham vao behavior chua chac chan.

Viec can lam:

- Xoa cac export/function frontend khong co reference:
  - `bindCurrencyElements`
  - `textCell`
  - `getJointVentureMemberHTML`
- Xoa `_check_session_api_legacy` neu khong con route nao dung.
- Xoa `syncSessionBetweenTabs` neu van la no-op.
- Don cac bien/import unused co bang chung ro, uu tien file nho va it rui ro.

Kiem thu:

- Chay build de bat loi import.
- Chay API/E2E test.
- Tim lai bang `rg` de chac chan khong con reference hong.

## Buoc 4: Tach bundle khoi tao thanh auth shell va workspace

Muc tieu: nguoi dung chua dang nhap khong tai toan bo dashboard/admin/form.

Viec can lam:

- Giu `controllers/app.js` o muc shell nhe.
- Dynamic import cac module workspace sau session hop le:
  - Admin controller/view.
  - Main forms.
  - Cac view lon cua bidding/partner/system user.
  - Schema contract neu chi can sau login.
- Kiem tra lai route/tab lazy-load hien tai de khong bind listener trung.

Kiem thu:

- Build kiem tra chunk moi.
- E2E:
  - Login.
  - F5.
  - Chuyen tab tong quan/admin.
  - Dropdown role admin/quan ly/nhan vien van hoat dong.
  - Nut import/export Excel van hoat dong.

Do lai:

- Kich thuoc `app.bundle.js`.
- So chunk tai truoc login.
- Thoi gian loading truoc va sau login.

## Buoc 5: Lazy import Excel/Word/export o backend

Muc tieu: server khoi dong nhanh hon, API auth/session khong phai tra gia cho Excel/Word.

Viec can lam:

- Kiem tra `backend/routes/routes_excel.py`, `backend/services/excel_service.py`, `backend/services/docx_service.py`.
- Chuyen cac import nang nhu parser/exporter vao trong handler hoac service method can dung.
- Neu can, tach schema/helper nhe ra khoi module parser nang.
- Doi import noi bo sang dang package-relative thong nhat de tranh load duplicate module.

Kiem thu:

- API tests.
- Test import/export Excel.
- Test export Word neu co workflow lien quan.

Do lai:

- Thoi gian `import backend.app`.
- Thoi gian server ready.
- Thoi gian request auth/session dau tien.

## Buoc 6: Cai thien cache HTML production

Muc tieu: moi lan F5 production khong hash lai toan bo template neu khong can.

Viec can lam:

- Sua `_html_cache_signature` trong `backend/app.py`.
- Luu signature theo mtime/size hoac tinh mot lan khi startup trong production.
- Giu behavior dev de template thay doi van duoc cap nhat.

Kiem thu:

- F5 production tra HTML dung.
- Dev mode van cap nhat khi sua partial.

Do lai:

- Thoi gian tra `GET /`.
- So file HTML bi doc/hash moi request.

## Buoc 7: Don khoi dong backend va worker nen

Muc tieu: tranh khoi tao hai lan va tranh worker nen chay qua som voi database moi.

Viec can lam:

- Kiem tra block `uvicorn.run("backend.app:app", ...)` trong `backend/app.py`.
- Tach entrypoint neu can de tranh app bi import lai khi chay truc tiep.
- Kiem tra partner lookup worker/prewarm image cache co nen chay theo config hoac sau khi database san sang.

Kiem thu:

- Chay server bang script hien tai.
- Import `backend.app` khong khoi tao lap.
- Worker nen khong gay loi khi database moi rong.

## Thu tu thuc hien de xuat

1. Buoc 1: Chan bootstrap du lieu truoc login.
2. Buoc 2: Throttle activity tracker.
3. Buoc 3: Xoa code chet ro rang.
4. Do lai lan 1 va ghi ket qua.
5. Buoc 4: Tach auth shell/workspace bundle.
6. Do lai lan 2 va ghi ket qua.
7. Buoc 5: Lazy import Excel/Word/export backend.
8. Buoc 6: Cache HTML production.
9. Buoc 7: Don khoi dong backend va worker nen.
10. Do lai tong ket va cap nhat bang so sanh.

## Bang so sanh ket qua

| Lan do | Trang thai | app.bundle.js | Request truoc login | WebSocket truoc login | IndexedDB truoc login | Loading login | Loading sau F5 da login | Ghi chu |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | Truoc toi uu | ~433 kB | 5 | 1 | Co | Can do lai | Can do lai | Co goi API workspace khi chua login |
| Lan 1 | Sau buoc 1-3 | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Lan 2 | Sau buoc 4 | TBD | TBD | TBD | TBD | TBD | TBD |  |
| Tong ket | Sau buoc 5-7 | TBD | TBD | TBD | TBD | TBD | TBD |  |

## Nguyen tac khi thuc hien

- Moi buoc chi sua pham vi nho, xong moi test.
- Uu tien thay doi co bang chung do duoc.
- Khong xoa code neu chua chac no that su khong duoc goi.
- Sau moi buoc lon, cap nhat bang so sanh trong file nay.
