# Kế hoạch chỉnh sửa và hoàn thiện BiddingFlow

## 1. Mục tiêu

Hoàn thiện hệ thống theo hướng triển khai mới hoàn toàn, ưu tiên:

- Mô hình dữ liệu rõ ràng, nhất quán và có ràng buộc toàn vẹn ở database.
- Backend là nguồn xác thực và thực thi nghiệp vụ cuối cùng.
- Frontend nhanh, dễ sử dụng, hỗ trợ tốt trạng thái offline và xung đột dữ liệu.
- Bảo mật phù hợp với dữ liệu đấu thầu và dữ liệu định danh cá nhân.
- Code dễ kiểm thử, bảo trì và mở rộng.
- Giữ đầy đủ chức năng tạo, cập nhật, chỉnh sửa, lưu phiên bản, lưu trữ và xóa dữ liệu trong quá trình vận hành sau này.

Không đặt mục tiêu tương thích hoặc chuyển đổi dữ liệu từ schema cũ. Database production đầu tiên phải được tạo trực tiếp từ clean baseline cuối cùng.

## 2. Nguyên tắc thực hiện

- Không viết migration chuyển đổi dữ liệu legacy nếu chưa có yêu cầu mới.
- Mọi thay đổi schema trước lần phát hành đầu được cập nhật trực tiếp vào clean baseline.
- Không tin dữ liệu hoặc quyền do frontend gửi lên.
- Mọi quan hệ nghiệp vụ quan trọng phải được bảo vệ bằng foreign key, unique constraint, check constraint hoặc transaction backend.
- Chỉ có một nguồn dữ liệu chuẩn cho mỗi thông tin nghiệp vụ.
- Mã lưu trong database phải ổn định; nội dung tiếng Việt chỉ là nhãn hiển thị.
- Mỗi giai đoạn phải có kiểm thử và tiêu chí nghiệm thu trước khi chuyển sang giai đoạn tiếp theo.

## 3. Thứ tự ưu tiên

| Mức | Ý nghĩa | Yêu cầu |
| --- | --- | --- |
| P0 | Chặn phát hành | Phải hoàn thành trước khi triển khai production |
| P1 | Quan trọng | Hoàn thành trong đợt ổn định đầu tiên |
| P2 | Tối ưu | Thực hiện sau khi schema và nghiệp vụ đã ổn định |

## 4. Giai đoạn 0 — Chuẩn hóa môi trường và pipeline

**Ưu tiên:** P0

### Công việc

- [x] Xóa môi trường dependency cục bộ không đầy đủ và kiểm tra lại bằng `npm ci`.
- [x] Bảo đảm các executable `vite`, `playwright` và `retire` được cài vào `node_modules/.bin`.
- [x] Sửa pipeline để `npm run check` chạy thành công trên máy sạch và CI.
- [x] Bổ sung job CI chạy toàn bộ unit test, API test và E2E test (`.github/workflows/quality.yml`).
- [x] Tạo database tạm mới cho từng lần chạy test; không dùng database phát triển có sẵn (`tests/api/conftest.py`).
- [x] Thêm kiểm tra `PRAGMA integrity_check` và `PRAGMA foreign_key_check` cho database vừa khởi tạo và readiness.
- [x] Bảo đảm `dist`, `release`, database runtime, file tạm và `__pycache__` được loại khỏi source control và production allowlist.
- [x] Kiểm tra quy trình đóng gói bằng `scripts/package_production.py`; `npm run check` tạo và xác minh archive tạm qua `audit:package`.

### Tiêu chí nghiệm thu

- `npm ci` hoàn tất trên máy/runner mới.
- `npm run check` thành công.
- `npm run test:e2e` thành công.
- `npm run audit:dependencies` thành công, không còn lỗi thiếu executable.
- Gói production được tạo lại hoàn toàn từ source và lockfile.

## 5. Giai đoạn 1 — Chốt mô hình dữ liệu greenfield

**Ưu tiên:** P0

### 5.1. Chuẩn hóa mã trạng thái

- [x] Liệt kê trạng thái, loại hình, vai trò và kết luận cố định tại `docs/DOMAIN_ENUMS.md`.
- [x] Định nghĩa mã ổn định cho trạng thái gói thầu/hợp đồng; kế hoạch không có lifecycle riêng, đánh giá đã dùng mã và hồ sơ giấy dùng ID danh mục ổn định.
- [x] Lưu mã trạng thái cố định trong database; map sang nhãn tiếng Việt ở serializer/domain contract.
- [x] Dùng manifest enum backend làm nguồn cho validator và danh sách lựa chọn frontend qua sync domain contract.
- [x] Thêm/duy trì `CHECK` constraint cho các enum cố định.

Ví dụ:

```text
PREPARING, INVITED, OPENED, EVALUATING, AWARDED, CANCELLED
```

### 5.2. Chuẩn hóa ngày giờ và số liệu

- [x] Quy định và chuẩn hóa ngày nghiệp vụ khi lưu là `YYYY-MM-DD`, không thêm thời điểm `00:00:00`.
- [x] Quy định timestamp kỹ thuật/cursor là UTC (database dùng `YYYY-MM-DD HH:mm:ss`, API có thể nhận epoch giây); thời điểm nghiệp vụ đấu thầu là giờ địa phương không tự ý dịch múi giờ.
- [x] Chốt quy tắc hiển thị ngày tiếng Việt: ngày luôn có hai chữ số; tháng `01`, `02` có số 0 ở đầu, tháng `3`–`12` không thêm số 0.
- [x] Chốt định dạng frontend/Word: ngày rút gọn `dd/M/yyyy`, ngày dạng câu `ngày dd tháng M năm yyyy`, thời điểm `HH:mm ngày dd/M/yyyy`, trong đó `M` tuân theo quy tắc tháng nêu trên.
- [x] Thêm validation theo schema cho các cột ngày/giờ tùy chọn, không chỉ các trường bắt buộc.
- [x] Chuẩn hóa tiền thành số nguyên VND.
- [x] Quy định tỷ lệ, điểm và trọng số là số hữu hạn, tỷ lệ/trọng số trong 0–100 và tối đa 4 chữ số thập phân; database và payload validator cùng cưỡng chế.
- [x] Không lưu chuỗi định dạng tiền/ngày từ giao diện vào database.

### 5.3. Chọn nguồn dữ liệu đánh giá duy nhất

- [x] Dùng `vong_danh_gia`, `tieu_chi_danh_gia` và `ket_qua_danh_gia_nha_thau` làm nguồn dữ liệu chuẩn.
- [x] Loại các trường bị lặp khỏi metadata JSON; bảng `goi_thau` không lưu cột metadata đánh giá.
- [x] Chỉ giữ `extension_json` cho dữ liệu mở rộng thực sự động và có `schemaVersion`.
- [x] Sinh DTO tương thích với frontend từ các bảng chuẩn hóa, không ghi hai bản dữ liệu song song.
- [x] Thêm test chứng minh cập nhật đánh giá được chuẩn hóa và tái tạo DTO không lệch dữ liệu.

### 5.4. Hoàn thiện quan hệ và constraint

- [x] Thêm ràng buộc chống lặp thành viên trong cùng liên danh, kể cả hai phiên bản của cùng một nhà thầu logic.
- [x] Bảo đảm mỗi liên danh chỉ có một thành viên đứng đầu bằng validation và partial unique index.
- [x] Baseline 1.0 không có trường tỷ lệ liên danh nên không lưu một tỷ lệ giả; nếu bổ sung sau này phải thêm migration và kiểm tra tổng trong transaction backend.
- [x] Bảo đảm một nhà thầu chỉ xuất hiện một lần trong biên bản mở thầu của cùng một phạm vi dự thầu.
- [x] Xác định phạm vi dự thầu bằng `(goi_thau_id, ma_phan_lo)`; với gói không chia lô, dùng một giá trị phạm vi cấp gói thống nhất thay cho `NULL`/chuỗi rỗng.
- [x] Khi kiểm tra trùng, tính cả nhà thầu dự thầu độc lập và từng thành viên của mọi liên danh; một nhà thầu đã thuộc liên danh trong phạm vi đó không được dự thầu độc lập hoặc thuộc liên danh khác trong cùng phạm vi.
- [x] Cho phép cùng một nhà thầu tham dự các phần lô khác nhau của cùng gói thầu, miễn là không xuất hiện nhiều lần trong cùng một phần lô.
- [x] Chuẩn hóa định danh nhà thầu dùng để kiểm tra theo `nha_thau_id` của đúng phiên bản và `id_goc`; không dựa vào tên hiển thị.
- [x] Thực hiện kiểm tra trùng trên toàn bộ biên bản mở thầu hiện có và payload sắp ghi trong cùng transaction để tránh hai request đồng thời vượt qua validation.
- [x] Tạo bảng `nha_thau_tham_du_mo_thau` với unique constraint `(organization_id, goi_thau_id, lot_scope, nha_thau_goc_id)`; không chỉ dựa vào validation frontend hoặc dữ liệu JSON của liên danh.
- [x] Chặn gói thầu rebid tự tham chiếu hoặc tạo vòng tham chiếu bằng validation và recursive CTE.
- [x] Bảo đảm rebid và gói nguồn cùng workspace/tenant.
- [x] Chốt quy tắc FK tại `docs/ARCHITECTURE.md`: quan hệ lịch sử giữ ID phiên bản cụ thể; dropdown hiện hành mới resolve `is_latest` theo root.
- [x] Duy trì tham chiếu đúng phiên bản cho hồ sơ mở thầu, hợp đồng và kết quả pháp lý; có contract/unit test cho exact-version binding.
- [x] Chốt giữ `organization_id` làm tên cột vật lý để FK/tenant rõ ràng; tầng giao diện và tài liệu dùng thuật ngữ workspace, không đổi tên cơ học gây lệch contract.
- [x] Xóa constant dư thừa `OWNER_TYPES = {"organization", "user"}` để thống nhất với `organization/personal`.

#### Kịch bản kiểm thử bắt buộc cho tính duy nhất của nhà thầu khi mở thầu

- [x] Gói không chia lô: nhà thầu A dự thầu độc lập lần thứ hai → từ chối.
- [x] Gói không chia lô: nhà thầu A đã dự thầu độc lập, sau đó xuất hiện trong liên danh → từ chối.
- [x] Gói không chia lô: nhà thầu A đã thuộc liên danh 1, sau đó thuộc liên danh 2 → từ chối.
- [x] Gói chia lô: nhà thầu A xuất hiện hai lần trong phần lô 1, bất kể độc lập hay liên danh → từ chối.
- [x] Gói chia lô: nhà thầu A tham dự phần lô 1 và phần lô 2 → cho phép.
- [x] Hai request đồng thời thêm cùng nhà thầu vào cùng phạm vi → chỉ một request được commit.
- [x] Hai phiên bản của cùng một nhà thầu logic trong cùng phạm vi → vẫn phải nhận diện là trùng theo `id_goc`/định danh gốc, không coi là hai nhà thầu khác nhau.
- [x] Hai nhà thầu khác nhau nhưng trùng mã số thuế chuẩn hóa → từ chối ngay từ bước quản lý danh mục nhà thầu hoặc resolve về cùng một nhà thầu logic.

### 5.5. Rà soát index và truy vấn

- [x] Lập danh sách truy vấn chính của từng màn hình, sync và export tại `docs/QUERY_CATALOG.md`.
- [x] Dùng `EXPLAIN QUERY PLAN` cho lọc, tìm kiếm, phân trang và dashboard.
- [x] Bổ sung index theo thứ tự `organization_id`, trạng thái lưu trữ/latest, trường lọc/sắp xếp.
- [x] Có test baseline phát hiện index thường trùng chính xác danh sách cột; query catalog liên kết index với truy vấn sử dụng.
- [x] Kiểm tra FTS5 với tiếng Việt có/không dấu và xác minh trigger cập nhật/xóa token cũ.

### Tiêu chí nghiệm thu

- Database mới được tạo chỉ từ clean baseline.
- Không có foreign-key violation.
- Không còn hai nguồn chuẩn cho dữ liệu đánh giá.
- Toàn bộ enum và ngày giờ có contract rõ ràng.
- Test tenant, lineage, versioning, rebid, liên danh, tính duy nhất của nhà thầu theo gói/phần lô và hợp đồng đạt.

## 6. Giai đoạn 2 — Củng cố backend và tính đồng nhất dữ liệu

**Ưu tiên:** P0/P1

### 6.1. Transaction và nghiệp vụ

- [x] Backend là nguồn tính tổng mức đầu tư, tổng giá trúng theo lô và giá sau giảm giá (ROUND_HALF_UP đến 1 VND); frontend chỉ preview.
- [x] Tính và ghi tổng mức đầu tư trong cùng transaction với dữ liệu thành phần.
- [x] Chỉ backend quyết định trường nào bị khóa sau khi phát hành gói thầu và trả policy qua sync domain contract.
- [x] Frontend hiển thị policy khóa trường và thứ tự trạng thái do backend/domain contract cung cấp.
- [x] Duy trì optimistic locking bằng `row_version` cho mọi thực thể có thể chỉnh sửa đồng thời.
- [x] Duy trì `client_mutation_id` và idempotency cho request có thể gửi lại.
- [x] Child-list chỉ replace khi chính key danh sách có mặt trong payload; có test chứng minh cập nhật riêng parent không phát sinh câu `DELETE` child.

### 6.2. Validation contract

- [x] Tạo manifest chung gồm tên trường, kiểu, required, enum, min/max và định dạng.
- [x] Sinh hoặc kiểm tra tự động mapping snake_case ↔ camelCase.
- [x] Backend từ chối trường không xác định.
- [x] Chuẩn hóa lỗi API theo `code`, `message`, `fields`, `requestId`.
- [x] Thêm contract test giữa outbound serializer frontend và payload validator backend.

### 6.3. Xử lý lỗi và logging

- [x] Rà soát `except Exception`; boundary handler vẫn bắt lỗi bất ngờ để trả lỗi an toàn nhưng không được nuốt im lặng trong data core.
- [x] Thay cleanup/parser phổ biến bằng `sqlite3.Error`, JSON/type/value/subprocess/OSError cụ thể ở auth, sync và document worker.
- [x] Loại `except Exception: pass` khỏi auth/sync/documents và thêm AST lint ngăn tái xuất hiện.
- [x] Không trả thành công khi ghi dữ liệu chính thất bại.
- [x] Log có cấu trúc kèm `request_id`, user, workspace, operation và error code.
- [x] Che CCCD, tài khoản ngân hàng, token, mật khẩu và nội dung nhạy cảm khỏi log.

### 6.4. Tài liệu và worker

- [x] Giới hạn kích thước upload/giải nén, số ZIP part, XML part/depth/compression ratio và số row Excel; file vượt ngưỡng bị từ chối trước khi ghi dữ liệu.
- [x] Stream multipart upload theo chunk ra file tạm riêng có giới hạn; document subprocess đọc bằng path và file luôn được xóa trong `finally`.
- [x] Đặt timeout, memory limit và concurrency limit cho document worker.
- [x] Dọn file tạm chắc chắn khi thành công, thất bại hoặc timeout.
- [x] Từ chối công thức trong worksheet import, OOXML external-link part và relationship `TargetMode=External`; công thức export chỉ do backend tạo từ allowlist.

### Tiêu chí nghiệm thu

- Không còn lỗi cốt lõi bị nuốt im lặng.
- Mọi update quan trọng có transaction và concurrency test.
- Frontend/backend dùng cùng field contract.
- Import/export thất bại an toàn và không để lại file tạm.

## 7. Giai đoạn 3 — Nâng cao bảo mật

**Ưu tiên:** P0/P1

### Công việc

- [x] Giữ xác thực session bằng cookie và token hash; không lưu session token trong Web Storage.
- [x] Loại code legacy đọc/dọn `bf_session_token`; phiên đăng nhập chỉ sử dụng cookie bảo mật.
- [x] Kiểm tra cookie production: session dùng `HttpOnly`, `SameSite=Lax`, `Secure` bắt buộc ở production và có thời hạn theo loại phiên.
- [x] Giữ CSRF protection cho mọi request thay đổi dữ liệu có session, có kiểm tra Origin/Referer và token.
- [x] Duy trì CORS và WebSocket origin ở chế độ same-origin HTTPS trong production bằng startup validation fail-closed.
- [x] Mọi HTML động đi qua Trusted Types renderer enforce; policy từ chối script/iframe/object/embed, event attribute, `srcdoc` và executable URL, static lint bắt interpolation chưa escape.
- [x] Tập trung HTML sink qua default Trusted Types policy được nạp trước application modules; static lint tiếp tục bắt interpolation chưa escape.
- [x] Chuyển Trusted Types từ report-only sang enforce trong CSP và có smoke test khóa header.
- [x] Loại toàn bộ DOM inline-style sink khi chạy: 576 phép gán được chuyển sang class/CSSOM, style trong template được Trusted Types chuyển thành class; CSP khóa `style-src-attr 'none'` và audit cấm sink mới.
- [x] Quyền `view` chỉ nhận CCCD/số tài khoản đã mask và không nhận chi tiết ngân hàng/media nhạy cảm; quyền `edit` mới nhận dữ liệu đầy đủ và được ghi.
- [x] Production fail-fast nếu chưa xác nhận volume database/media/backup mã hóa và tách đường dẫn runtime.
- [x] Production yêu cầu `SECRET_ROTATION_CONFIRMED_AT` không quá 90 ngày cho application/OAuth/SMTP credential; runbook có quy trình rotate/revoke.
- [x] Có lệnh restore diễn tập bắt buộc xác minh metadata SHA-256, schema version, `integrity_check` và `foreign_key_check`; runbook yêu cầu chạy định kỳ.
- [x] Thiết lập retention cho audit log, session hết hạn, rate-limit bucket, tombstone, mutation/idempotency và websocket event.
- [x] Thêm rate limit theo IP cho export nặng; login, OTP, reset mật khẩu và lookup bên ngoài có bucket giới hạn riêng.

### Tiêu chí nghiệm thu

- Không có token phiên trong LocalStorage/SessionStorage.
- CSP production không cho inline script hoặc inline style (`style-src-attr 'none'`).
- Trusted Types chạy enforce.
- Dữ liệu nhạy cảm không xuất hiện trong log hoặc response không cần thiết.
- Backup mã hóa có thể khôi phục thành công.

## 8. Giai đoạn 4 — Tối ưu frontend và trải nghiệm người dùng

**Ưu tiên:** P1/P2

### 8.1. Chia nhỏ code và tải theo nhu cầu

- [x] `BidProcessWorkflow.js` điều phối các module bước riêng: opening data/lookup/render/validation, financial opening, invitation, preparation, lifecycle, rebid và award result.
- [x] `BidEvaluationWorkflow.js` dùng component kỹ thuật/tài chính/kết luận cùng module render, validation, metadata và evaluation progress độc lập.
- [x] `AwardResultDetailsPanel.js` được cấu thành từ `AwardResultPanel`, `BidderTable`, `PackageTabs`, evaluation/opening/cancellation/JV/workflow action components; mỗi component có unit characterization riêng.
- [x] `BiddingController.js` chỉ giữ lifecycle/route/command coordinator; sync, form, auth, workflow nghiệp vụ, mutation và startup reconciliation nằm ở module/service riêng, được cài qua registry có collision test.
- [x] Lazy-load XLSX chỉ khi mở import/export Excel.
- [x] Lazy-load Word integration chỉ khi mở chức năng biểu mẫu.
- [x] Đã đánh giá icon subset: tên icon được tạo động từ workflow/plugin nên subset tĩnh dễ làm mất icon; giữ full Lucide ở lazy vendor chunk có SHA-256 pin, initial route chỉ tải shim nhỏ và bundle budget xác nhận không tính full icon.
- [x] Đặt bundle budget cho initial route và từng lazy chunk.

### 8.2. Render và bảng dữ liệu

- [x] Chuẩn hóa các danh sách thực thể chính qua `EntityTable`/`virtualTable`; bảng kế hoạch, gói thầu, hợp đồng, nhà thầu, chủ đầu tư và chuyên gia đều dùng chung renderer/trạng thái.
- [x] Sync acknowledgement cập nhật cache theo row key và không render lại toàn bộ bảng cho một upsert; có unit test khóa hành vi.
- [x] Sink `innerHTML` còn lại bị tập trung qua Trusted Types allow-policy có kiểm thử; dữ liệu văn bản dùng `textContent`/escape helper và lint cấm business field chưa escape.
- [x] Codemod chuyển 1.629 inline style tĩnh thành 571 class CSP-safe dùng chung; status badge dùng component chung và audit budget cấm số sink tăng trở lại.
- [x] Duy trì focus, vị trí cuộn và trạng thái chọn sau khi cập nhật dữ liệu.
- [x] Dùng server pagination cho tập dữ liệu lớn; endpoint hỗ trợ offset/keyset cursor, abort request cũ và cache từng trang phía client.

### 8.3. Form và đồng bộ

- [x] Dùng chung `FormBinder`/`FormValidation` schema cho thu thập, normalize, validation và lỗi inline; contract field chặn tên trường sai.
- [x] Phân biệt rõ “Đã lưu trên thiết bị” và “Đã đồng bộ máy chủ”.
- [x] Hiển thị số mutation đang chờ.
- [x] Cảnh báo khi đổi workspace hoặc đăng xuất còn mutation chưa đồng bộ hoặc biểu mẫu chưa lưu.
- [x] Có nút thử lại và màn hình diff theo từng trường khi conflict.
- [x] Không reset form trước khi server xác nhận; request không an toàn chỉ retry khi có idempotency key, mutation queue và biểu mẫu vẫn giữ khi timeout/offline.
- [x] Dùng skeleton/loading state phù hợp cho route/module lazy-load và bảng dữ liệu.

### 8.4. Accessibility

- [x] Luồng đăng nhập, modal nghiệp vụ, focus trap, Tab/Escape và trả focus được khóa bằng unit test và Chromium E2E.
- [x] Trả focus đúng vị trí sau khi đóng modal, kể cả khi trigger bị thay thế do màn hình rerender.
- [x] Dùng `aria-live` cho toast và trạng thái sync.
- [x] Bổ sung semantic enhancer cho nội dung tĩnh/lazy: caption ẩn có tên, `scope=col`, accessible name cho control và nút icon chưa có label.
- [x] Audit WCAG AA khóa contrast badge; warning/success/danger và disabled text đã đổi sang màu đậm đạt tối thiểu 4.5:1.
- [x] Badge/status luôn có nhãn chữ (không chỉ màu), control disabled dùng thuộc tính semantic và audit khóa presence của textual state component.

### Tiêu chí nghiệm thu

- Initial bundle không vượt budget đã đặt.
- XLSX, Word và màn hình đánh giá chỉ tải khi người dùng cần.
- Danh sách lớn không render lại toàn bộ khi một bản ghi thay đổi.
- Luồng tạo/sửa hoạt động khi offline và xử lý conflict rõ ràng.
- Các luồng chính vượt kiểm tra accessibility tự động và keyboard E2E.

## 9. Giai đoạn 5 — Dọn code và thống nhất kiến trúc

**Ưu tiên:** P1/P2

### Công việc

- [x] Xóa constant, branch và adapter chỉ phục vụ dữ liệu legacy; dead-code audit khóa export/CSS không còn tham chiếu và source không còn nhánh chuyển đổi dữ liệu cũ.
- [x] Giữ migration runner cho các lần nâng cấp sau production; `m0001_clean_baseline.py` là migration duy nhất trước phát hành và có kiểm tra fingerprint schema.
- [x] Gom formatter tiền, ngày và ngày-giờ về `frontend/shared/formatters.js`; `view_helpers.js` chỉ còn adapter gọi nguồn chuẩn.
- [x] Gom policy nghiệp vụ về backend: access tại `shared/access_policy.py`, delete tại `sync/delete_policy.py`, field-lock tại contract do `payload_validation.py` phát hành cho frontend.
- [x] Package/contract status badge dùng chung `statusBadges.js`; enum nghiệp vụ lấy từ backend contract, CSS badge chung thay mapping HTML/inline color lặp giữa view.
- [x] Di chuyển Windows socket shutdown workaround khỏi `backend/app.py` vào adapter theo môi trường, chỉ nuốt `OSError` của socket đã đóng.
- [x] Thiết lập giới hạn kích thước file/module trong lint để tránh controller/workflow tiếp tục phình lớn; các module đang quá lớn có trần tạm riêng và không được tăng thêm.
- [x] Cập nhật tài liệu kiến trúc, mô hình quan hệ, contract API, quy tắc versioning và runbook vận hành trong `docs/`.

### Tiêu chí nghiệm thu

- Không còn compatibility code chưa có người dùng thực tế.
- Mỗi quy tắc nghiệp vụ có một vị trí định nghĩa chính.
- Controller chỉ điều phối, không chứa khối logic nghiệp vụ lớn.
- Không có module ứng dụng vượt giới hạn kích thước đã thống nhất mà không có ngoại lệ được ghi nhận.

## 10. Giai đoạn 6 — Kiểm thử tải và sẵn sàng production

**Ưu tiên:** P0 trước phát hành

### Kịch bản dữ liệu mục tiêu

- 100.000 gói thầu.
- 20.000 kế hoạch.
- 50.000 nhà thầu/chủ đầu tư.
- Nhiều phiên bản cho mỗi thực thể.
- 20–50 người dùng hoạt động đồng thời.
- Nhiều tab và nhiều workspace trên cùng trình duyệt.

### Công việc

- [x] Benchmark schema thật với 20.000 kế hoạch/100.000 gói: dashboard, FTS, keyset pagination và detail đều dưới ngưỡng; kết quả lưu trong `docs/BENCHMARK_RESULTS.json`.
- [x] Benchmark sync delta và trang full bootstrap 500 dòng, p95 lần lượt 0,628 ms và 0,663 ms trên baseline local.
- [x] Stress test 12 writer/480 transaction trong WAL mode xác nhận không mất update, busy timeout 15 giây và integrity vẫn đạt.
- [x] Stress test 8 upload 8 MiB đồng thời xác nhận stream-to-disk giữ peak Python dưới 8 MiB và dọn sạch temp; worker semaphore/size limit bao quanh import/export.
- [x] Unit test mô phỏng close code 1006, reconnect socket và nhận `db_changed` để lên lịch delta sync; auth close code không tạo vòng reconnect.
- [x] Row-version concurrency test mô phỏng hai client sửa cùng bản ghi, trả 409 kèm server snapshot và rebase/replay theo lựa chọn từng trường.
- [x] Kiểm tra online backup trong WAL mode và restore sang database diễn tập mới, kèm đối chiếu checksum/integrity/schema.
- [x] Security/dependency audit đạt: npm, Python, vendor integrity/Retire.js và secret scan không có phát hiện; 28 document-input/resource-limit tests đạt.
- [x] `package_production.py --check` giải nén artifact vào thư mục sạch, boot app từ chính artifact và smoke homepage/holidays/session API.

### Ngưỡng đề xuất

| Hạng mục | Mục tiêu ban đầu |
| --- | --- |
| API đọc danh sách thông thường | p95 < 500 ms |
| Mở chi tiết từ cache | < 200 ms |
| Tìm kiếm đã lập chỉ mục | p95 < 700 ms |
| Sync delta thông thường | p95 < 1 giây |
| Initial JavaScript gzip | < 150 KiB |
| Lỗi API không kiểm soát | 0 trong smoke/E2E |

Ngưỡng phải được điều chỉnh sau khi có cấu hình máy chủ production thực tế.

## 11. Ma trận kiểm thử bắt buộc

| Nhóm | Nội dung |
| --- | --- |
| Schema | Clean initialization, constraint, FK, index, trigger, schema contract |
| Tenant | Không đọc/ghi/tham chiếu chéo workspace |
| CRUD | Tạo, sửa, xóa, archive và restore theo policy |
| Version | Tạo phiên bản, đúng lineage, đúng latest, tham chiếu đúng snapshot |
| Concurrency | Row version, idempotency, conflict resolution |
| Sync | Full sync, delta, pagination, tombstone, offline queue |
| Mở thầu | Không trùng nhà thầu độc lập/liên danh trong cùng gói hoặc phần lô; cho phép tham dự phần lô khác |
| Auth | Session, CSRF, role, membership, reauth, reset mật khẩu |
| Documents | File độc hại, zip bomb, formula, timeout, cleanup |
| Frontend | Form, modal, bảng, lazy-load, keyboard, trạng thái lỗi |
| Production | Startup validation, health/readiness, package smoke, backup/restore |

## 12. Definition of Done chung

Một hạng mục chỉ được coi là hoàn thành khi:

- Code và schema contract đã cập nhật.
- Có test cho luồng thành công, lỗi validation, permission và concurrency nếu liên quan.
- Không làm giảm tenant isolation hoặc auditability.
- Không bổ sung dữ liệu trùng nguồn chuẩn.
- Static check, unit test, API test và E2E test đều đạt.
- Tài liệu liên quan được cập nhật.
- Có kết quả đo trước/sau nếu là thay đổi hiệu năng.

## 13. Checklist phát hành lần đầu

- [x] Clean baseline 1.0 được đóng băng tại migration bất biến `m0001_clean_baseline.py`; fingerprint schema và migration version được kiểm tra khi startup/test.
- [ ] Database production được tạo mới, không sao chép database phát triển.
- [ ] Tài khoản super admin và tổ chức mặc định được bootstrap an toàn.
- [ ] HTTPS, secure cookie, CORS, WebSocket origin và proxy trust đã cấu hình.
- [ ] Volume database/media/backup đã mã hóa.
- [x] Backup/restore đã diễn tập tự động trên WAL database: metadata SHA-256, schema, integrity/FK và dữ liệu sau restore đều được đối chiếu.
- [x] Cổng `npm run check` đạt trên secure build và extracted production artifact: lint/audit/build/budget, 192 unit, 249 API và runtime smoke đều đạt; Playwright E2E đạt 10/10 với CSP enforce.
- [x] Production allowlist/manifest cấm `.env`, database, log, temp, test/source frontend; secret scan source và kiểm tra artifact đều đạt.
- [ ] Monitoring cho readiness, lỗi, độ trễ, disk, WAL và backup đã hoạt động.
- [x] Có runbook xử lý mất kết nối, database lock, restore và thu hồi session.
