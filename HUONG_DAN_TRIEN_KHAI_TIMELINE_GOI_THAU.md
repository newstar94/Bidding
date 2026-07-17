# Hướng dẫn triển khai Timeline gói thầu và xuất Word

- Ngày lập: 17/07/2026
- Phạm vi: BiddingFlow
- Trạng thái: Sẵn sàng triển khai
- Mục tiêu: bổ sung một menu độc lập để quản lý timeline/checklist của từng gói thầu và xuất tài liệu Word theo mẫu chuẩn.

## 1. Kết quả cần đạt

Sau khi hoàn thành, người dùng có thể:

1. Mở menu **Timeline gói thầu** từ thanh bên.
2. Tìm và chọn kế hoạch, gói thầu và phiên bản cần quản lý.
3. Xem các mốc áp dụng được suy ra từ danh mục chuẩn gồm 5 nhóm và 48 mốc công việc.
4. Nhận dữ liệu tự động từ kế hoạch, gói thầu, quá trình đánh giá và hợp đồng.
5. Bổ sung hoặc ghi đè các thông tin chưa có trong dữ liệu nghiệp vụ.
6. Theo dõi ngày dự kiến, ngày thực tế, trạng thái và các mốc quá hạn.
7. Lưu và đồng bộ dữ liệu bằng cơ chế hiện có của BiddingFlow.
8. Xuất file Word có bố cục tương tự checklist mẫu.

## 2. Phạm vi MVP

### 2.1. Bao gồm

- Menu mới đặt sau **Gói thầu**, trước **Hợp đồng**.
- Route SPA: `/timeline-goi-thau`.
- Tab key: `goithau-timeline`.
- Lazy-load giao diện và module JavaScript.
- Checklist chuẩn 5 nhóm, 48 mốc.
- Dữ liệu tự động kết hợp ghi đè thủ công.
- Phân quyền kế thừa phân hệ `goithau`.
- Đồng bộ, hàng đợi mutation, WebSocket và kiểm soát xung đột.
- Mẫu Word hệ thống riêng cho timeline.
- Kiểm thử unit, API, E2E, migration và kiểm tra trực quan Word.

### 2.2. Chưa bao gồm

- Trình thiết kế tùy ý cấu trúc checklist.
- Kéo thả để thay đổi thứ tự nhóm và mốc.
- Thông báo email hoặc lịch nhắc tự động.
- Nhiều mẫu timeline theo từng phòng ban.
- Xuất PDF.
- Dashboard phân tích thời gian hoàn thành giữa nhiều gói thầu.

## 3. Quy ước nghiệp vụ

### 3.1. Hai loại ngày

Không dùng một trường ngày duy nhất vì checklist mẫu có cả các mốc dự kiến trong tương lai và các ngày đã ký thực tế.

- **Ngày dự kiến**: mốc kế hoạch hoặc ngày được hệ thống tính/gợi ý.
- **Ngày thực tế**: ngày văn bản đã ký hoặc công việc đã hoàn thành.
- **Quá hạn**: ngày dự kiến đã qua, chưa có ngày thực tế và mốc chưa được đánh dấu không áp dụng.

Khi xuất Word:

- Ưu tiên ngày thực tế.
- Nếu chưa có ngày thực tế, hiển thị ngày dự kiến bằng màu đỏ.
- Có chú thích trong tài liệu: màu đỏ là ngày dự kiến/chưa xác nhận.

### 3.2. Trạng thái

Các trạng thái được lưu:

- `PENDING`: chưa thực hiện.
- `IN_PROGRESS`: đang thực hiện.
- `DONE`: đã hoàn thành.
- `NOT_APPLICABLE`: không áp dụng.

Trạng thái `OVERDUE` chỉ được suy ra khi hiển thị, không lưu vào database để tránh sai lệch theo thời gian.

### 3.3. Nguồn dữ liệu

Mỗi mốc có một trong hai chế độ:

- `AUTO`: lấy dữ liệu từ kế hoạch/gói thầu/hợp đồng/metadata.
- `MANUAL`: người dùng xác nhận nhập hoặc ghi đè thủ công.

Giao diện phải hiển thị nhãn **Tự động** hoặc **Thủ công** và cung cấp thao tác **Khôi phục dữ liệu hệ thống**.

### 3.4. Phiên bản gói thầu

- Timeline gắn với một `goi_thau.id` cụ thể, không gắn chung theo `rootId`.
- Bản Word của phiên bản cũ không bị thay đổi khi gói thầu có phiên bản mới.
- Khi tạo phiên bản mới, không tự động mang toàn bộ timeline cũ sang.
- Cung cấp thao tác **Sao chép từ phiên bản trước** có xác nhận.
- Khi sao chép, các mốc mở thầu, đánh giá, kết quả và hợp đồng phải được đặt lại theo quy tắc nghiệp vụ đã thống nhất.

### 3.5. Mốc áp dụng theo dữ liệu nghiệp vụ

- Kế hoạch có hình thức phê duyệt **Dự toán và kế hoạch** chỉ hiển thị mốc 1.7–1.8; không hiển thị riêng mốc 1.3–1.6.
- Kế hoạch có hình thức phê duyệt **Kế hoạch** hiển thị mốc 1.3–1.6; không hiển thị mốc gộp 1.7–1.8.
- Gói **Chào hàng cạnh tranh** không hiển thị nhóm Tư vấn thẩm và các mốc thẩm định E-HSMT, kỹ thuật, kết quả LCNT.
- Khi gói không yêu cầu thẩm định E-HSMT, không hiển thị mốc 4.2.
- Các mốc 5.3–5.6 chỉ áp dụng cho phương thức **Một giai đoạn hai túi hồ sơ**.
- Quy tắc áp dụng phải giống nhau trên màn hình và bản Word; mốc bị ẩn không bị xóa khỏi dữ liệu lịch sử.

## 4. Thiết kế màn hình

### 4.1. Vị trí menu

Thêm menu vào `views/components/sidebar.html`:

- Nhãn: **Timeline gói thầu**.
- Icon Lucide: `calendar-clock` hoặc `list-checks`.
- CSS role: `role-menu-client`.
- Vị trí: ngay sau menu **Gói thầu**.

### 4.2. Thanh công cụ

Màn hình có:

- Bộ tìm kiếm/chọn Kế hoạch LCNT.
- Bộ tìm kiếm/chọn Gói thầu.
- Bộ chọn phiên bản gói thầu.
- Bộ lọc trạng thái.
- Tùy chọn chỉ hiển thị mốc thiếu dữ liệu hoặc quá hạn.
- Nút **Đồng bộ từ dữ liệu gói thầu**.
- Nút **Lưu thay đổi**.
- Nút **Xuất Word**.

Không lấy toàn bộ danh sách gói thầu từ `model.state.goithau` vì ứng dụng có thể đang dùng phân trang server. Bộ chọn phải dùng API tìm kiếm/phân trang và chỉ tải đầy đủ gói được chọn.

### 4.3. Thống kê nhanh

Hiển thị bốn chỉ số:

- Tổng số mốc áp dụng.
- Đã hoàn thành.
- Đang xử lý/chưa thực hiện.
- Quá hạn.

### 4.4. Bảng dữ liệu

Các cột đề xuất:

| Cột | Mô tả |
|---|---|
| STT | Mã nhóm hoặc mã mốc |
| Công việc | Tên mốc nghiệp vụ |
| Đơn vị ban hành | Đơn vị phát hành/chủ trì |
| Số văn bản | Số quyết định, báo cáo, biên bản hoặc hợp đồng |
| Ngày dự kiến | Mốc kế hoạch |
| Ngày thực tế | Ngày ký/hoàn thành |
| Trạng thái | Chờ, đang làm, hoàn thành, không áp dụng |
| Ghi chú | Nội dung bổ sung |
| Thao tác | Chuyển Auto/Manual, khôi phục dữ liệu |

Yêu cầu giao diện:

- Dòng tiêu đề nhóm nổi bật.
- Header bảng lặp/sticky khi cuộn.
- Có trạng thái loading, empty và error.
- Không biểu diễn trạng thái chỉ bằng màu.
- Dùng được bằng bàn phím.
- Trên màn hình nhỏ cho phép cuộn ngang, không làm mất nút lưu/xuất.

## 5. Danh mục checklist chuẩn

### I. KHLCNT + DỰ TOÁN

1. 1.1 — Chứng thư thẩm định giá, Báo giá.
2. 1.2 — QĐ thành lập tổ.
3. 1.3 — Tờ trình dự toán.
4. 1.4 — QĐ phê duyệt dự toán.
5. 1.5 — Tờ trình kế hoạch.
6. 1.6 — QĐ phê duyệt kế hoạch.
7. 1.7 — Tờ trình kế hoạch + Dự toán.
8. 1.8 — QĐ phê duyệt dự toán + kế hoạch.

### II. TƯ VẤN LẬP

1. 2.1 — Thư mời.
2. 2.2 — Đơn xin nhận thầu.
3. 2.3 — Biên bản hoàn thiện hợp đồng.
4. 2.4 — Tờ trình phê duyệt chỉ định TVL.
5. 2.5 — QĐ chỉ định TVL.
6. 2.6 — Hợp đồng TVL.
7. 2.7 — QĐ thành lập TCG.
8. 2.8 — BBNT E-HSMT.
9. 2.9 — BBNT BCĐG.
10. 2.10 — Xác định KL hoàn thành.
11. 2.11 — Đề nghị thanh toán.
12. 2.12 — Thanh lý HĐ.

### III. TƯ VẤN THẨM

1. 3.1 — Thư mời.
2. 3.2 — Đơn xin nhận thầu.
3. 3.3 — Biên bản hoàn thiện hợp đồng.
4. 3.4 — Tờ trình phê duyệt chỉ định TVT.
5. 3.5 — QĐ chỉ định TVT.
6. 3.6 — Hợp đồng TVT.
7. 3.7 — QĐ thành lập TTĐ.
8. 3.8 — BBNT BCTĐ E-HSMT.
9. 3.9 — BBNT BCTĐ KQLCNT.
10. 3.10 — Xác định KL hoàn thành.
11. 3.11 — Đề nghị thanh toán.
12. 3.12 — Thanh lý HĐ.

### IV. E-HSMT

1. 4.1 — Tờ trình E-HSMT.
2. 4.2 — Báo cáo thẩm định E-HSMT.
3. 4.3 — QĐ phê duyệt E-HSMT.

### V. KẾT QUẢ LCNT

1. 5.1 — BB Đóng mở thầu.
2. 5.2 — Báo cáo đánh giá E-HSDT (E-HSĐXKT).
3. 5.3 — Báo cáo thẩm định nhà thầu đạt kỹ thuật.
4. 5.4 — Quyết định phê duyệt nhà thầu đạt kỹ thuật.
5. 5.5 — BB Mở Tài chính.
6. 5.6 — Báo cáo đánh giá E-HSĐXTC.
7. 5.7 — Thư mời đối chiếu tài liệu.
8. 5.8 — BB đối chiếu tài liệu.
9. 5.9 — Thương thảo hợp đồng.
10. 5.10 — Báo cáo thẩm định KQLCNT.
11. 5.11 — Phê duyệt KQLCNT.
12. 5.12 — Thư chấp thuận và trao hợp đồng.
13. 5.13 — BB hoàn thiện hợp đồng.

## 6. Mô hình dữ liệu

Tạo bảng `goi_thau_moc_tien_do`.

| Trường | Ý nghĩa |
|---|---|
| `id` | ID bản ghi |
| `organization_id` | Phạm vi tổ chức |
| `owner_type` | Loại workspace |
| `goi_thau_id` | Phiên bản gói thầu |
| `ma_nhom` | I, II, III, IV, V |
| `ten_nhom` | Tên nhóm |
| `ma_moc` | 1.1, 1.2, ..., 5.13 |
| `cong_viec` | Tên công việc |
| `don_vi_ban_hanh` | Đơn vị ban hành/chủ trì |
| `so_van_ban` | Số văn bản |
| `ngay_du_kien` | Ngày dự kiến ISO |
| `ngay_thuc_te` | Ngày thực tế ISO |
| `ghi_chu` | Ghi chú |
| `source_key` | Khóa nguồn tự động |
| `source_mode` | AUTO hoặc MANUAL |
| `is_optional` | Mốc tùy chọn |
| `trang_thai` | Trạng thái lưu |
| `sort_order` | Thứ tự hiển thị |
| `template_version` | Phiên bản checklist |
| `sync_version` | Phiên bản đồng bộ |
| `created_at`, `updated_at` | Thời gian hệ thống |

Ràng buộc bắt buộc:

- Unique `(organization_id, id)`.
- Unique `(organization_id, goi_thau_id, ma_moc)`.
- FK tenant kép từ timeline tới gói thầu.
- Xóa cứng gói thầu thì cascade timeline.
- Archive gói thầu không xóa timeline lịch sử.
- Ngày phải là ISO hợp lệ nếu có.
- `source_mode`, `trang_thai`, boolean và `sort_order` có CHECK.
- Giới hạn tối đa 500 mốc trong một payload để chống lạm dụng.

## 7. Migration an toàn

### Cảnh báo quan trọng

Không thêm bảng timeline trực tiếp vào `backend/db/schema.py` và không sửa `m0001_clean_baseline.py`.

`m0001` đang đưa toàn bộ `SCHEMA_DINH_NGHIA` vào checksum. Thay đổi schema baseline sẽ khiến database đã áp dụng migration báo lỗi `Migration checksum mismatch` khi khởi động.

### Cách thực hiện

1. Tạo `backend/db/migrations/m0003_package_timeline.py`.
2. Đặt toàn bộ DDL, CHECK và index trong migration 3.
3. Đăng ký migration mới tại `backend/db/migrations/__init__.py`.
4. Không sửa source hoặc checksum của migration 1 và 2.
5. Thêm kiểm tra schema hậu-baseline dành riêng cho bảng timeline.
6. Không backfill 48 mốc cho toàn bộ gói cũ trong migration.
7. Trước triển khai production:
   - Sao lưu database.
   - Chạy migration trên bản sao.
   - Chạy `PRAGMA foreign_key_check`.
   - So sánh số bản ghi trước/sau.
   - Khởi động lại lần hai để kiểm tra idempotency.
   - Thử khôi phục bản sao lưu.

## 8. Ánh xạ dữ liệu tự động

### 8.1. Kế hoạch và dự toán

Nguồn có thể dùng:

- `ngayTrinhDuToan`.
- `ngayPheDuyetDuToan`.
- `soQdPheDuyetDuToan`.
- `ngayTrinhKeHoach`.
- `ngayPheDuyet`.
- `quyetDinhPheDuyet`.

### 8.2. E-HSMT

- `soToTrinhHsmt`.
- `ngayTrinhHsmt`.
- `soBaoCaoThamDinhHsmt`.
- `ngayBaoCaoThamDinhHsmt`.
- `soQuyetDinh`.
- `ngayQuyetDinh`.

### 8.3. Mời và mở thầu

- `thoiGianDangTai`.
- `thoiGianDongThau`.
- `thoiGianMoThau`.
- `thoiGianMoEhsdxtc`.

### 8.4. Đánh giá và kết quả

- Số/ngày báo cáo các vòng đánh giá.
- Số/ngày quyết định kỹ thuật.
- Ngày mời và ngày đối chiếu.
- Ngày mời thương thảo và ngày thương thảo.
- Số/ngày báo cáo thẩm định kết quả.
- `soQuyetDinhKetQua`.
- `ngayQuyetDinhKetQua`.

### 8.5. Hợp đồng

- `soHopDong`.
- `ngayKy`.
- Số/ngày quyết định chỉ định.
- `ngayThanhLy`.

Các mốc tư vấn, nghiệm thu, xác định khối lượng, thanh toán và thư mời chưa có nguồn dữ liệu chuẩn phải để chế độ thủ công.

## 9. Tích hợp đồng bộ

Timeline được truyền dưới trường con `timelineItems` của gói thầu.

Các thay đổi chính:

1. Thêm `timelineItems` vào child-field allowlist của `goi_thau`.
2. Thêm validator nghiêm ngặt cho từng trường timeline.
3. Thêm `_save_timeline_items()` vào mapper backend.
4. Chỉ xóa/thay thế child rows khi payload thực sự có key `timelineItems`.
5. Payload không có key không được làm mất timeline.
6. Payload có `timelineItems: []` là yêu cầu xóa có chủ ý và phải được xác nhận ở UI.
7. Thêm timeline vào `_attach_package_children()`.
8. Trả dữ liệu đúng `sort_order`.
9. Thêm `timelineItems` vào `frontend/app/outboundSerializer.js`.
10. Render lại tab timeline khi WebSocket báo thay đổi gói thầu liên quan.

Không cần tạo một IndexedDB store riêng nếu timeline vẫn là child list của gói thầu.

## 10. Tích hợp frontend

### File mới

- `views/tabs/tab_goithau_timeline.html`.
- `frontend/packages/PackageTimelineView.js`.
- `frontend/packages/packageTimelineRows.js`.
- `frontend/packages/PackageTimelineExport.js` nếu cần tách luồng tải file.
- CSS timeline trong `views/css/views.css` hoặc file CSS riêng được khai báo trong `views/index.html`.

### File cần cập nhật

- `views/components/sidebar.html`: thêm menu.
- `frontend/app/BiddingController.js`: thêm route và lazy partial.
- `frontend/app/BiddingControllerUI.js`: thêm title và render case.
- `frontend/app/BiddingView.js`: thêm lazy view-module loader.
- `frontend/app/BiddingControllerSync.js`: refresh khi dữ liệu thay đổi.
- `views/vendor/initial-route.js`: ánh xạ F5/initial shell.
- `backend/app.py`: thêm SPA route.
- `backend/auth/username_validator.py`: dành riêng slug route mới.
- `tests/e2e/manager-performance.spec.js`: thêm trang vào kiểm thử điều hướng.

Không include tab mới trực tiếp trong `views/index.html`; dùng `#lazy-tab-root` hiện có.

## 11. Xuất Word

### 11.1. Mẫu tài liệu

Tạo:

`data/templates/words/mau_timeline_goi_thau.docx`

Không dùng mẫu active chung hiện tại. Timeline phải dùng template hệ thống riêng để tránh việc người dùng đổi mẫu báo cáo/hợp đồng làm hỏng bản xuất timeline.

Yêu cầu mẫu:

- Khổ A4 ngang.
- Font hỗ trợ đầy đủ tiếng Việt.
- Tiêu đề **CHECK LIST**.
- Header màu xanh tương tự hình mẫu.
- Năm nhóm công việc.
- Row-loop cho các mốc.
- Lặp header khi bảng qua trang.
- Không để hàng tiêu đề nhóm tách khỏi hàng dữ liệu đầu tiên.
- Ngày `dd/MM/yyyy`.
- Ngày dự kiến chưa xác nhận hiển thị đỏ.
- Có số trang và thông tin gói thầu ở header/footer nếu được duyệt.

### 11.2. Context

Tạo `build_timeline_context(package_id, user_id, organization_id)`.

Context tối thiểu:

- `goi_thau`.
- `ke_hoach`.
- `chu_dau_tu`.
- `to_chuc`.
- `timeline_sections`.
- Mỗi section có `code`, `title`, `items`.
- Mỗi item luôn có đủ key, kể cả khi giá trị là chuỗi rỗng.

Không để template tự xử lý logic nguồn, điều kiện hoặc quá hạn. Toàn bộ logic phải được chuẩn hóa trong service trước khi render.

### 11.3. Endpoint

Thêm:

`GET /api/export-timeline/{package_id}?snapshotVersion=...`

Endpoint phải:

1. Xác thực session.
2. Xác định workspace/tổ chức hiện hành.
3. Kiểm tra người dùng có quyền đọc gói thầu và được phân công.
4. Bắt buộc `snapshotVersion`.
5. Dựng context trong đúng organization.
6. Render bằng document worker.
7. Kiểm tra snapshot lần hai sau render.
8. Trả `StreamingResponse` với filename an toàn.
9. Áp dụng rate limit cho tác vụ tài liệu nặng.

Tên file:

`Timeline_goi_thau_<ma_goi_thau>.docx`

Frontend phải gọi `prepareExportSnapshot()` trước, sau đó gắn version bằng `appendExportSnapshotVersion()`.

## 12. Phân quyền và bảo mật

- Quyền xem timeline kế thừa quyền xem `goithau`.
- Quyền sửa timeline kế thừa quyền sửa `goithau`.
- Nhân viên chỉ xem/sửa gói được phân công.
- Manager và chủ workspace cá nhân dùng quy tắc hiện tại.
- Backend luôn lọc `organization_id`; không dựa vào dữ liệu tổ chức gửi từ client.
- FK tenant kép phải chặn liên kết timeline sang gói của tổ chức khác.
- Escape toàn bộ dữ liệu khi render HTML.
- Không cho phép HTML tùy ý trong ghi chú.
- Giới hạn độ dài công việc, số văn bản, đơn vị ban hành và ghi chú.
- Mẫu Word phải đi qua kiểm tra OOXML/Jinja hiện có.
- Không ghi nội dung nhạy cảm vào log lỗi.

## 13. Kế hoạch triển khai

| Giai đoạn | Công việc | Ước lượng |
|---|---|---:|
| 1 | Chốt 48 mốc, quy tắc nếu có, ngày dự kiến/thực tế | 0,5–1 ngày |
| 2 | Migration 3, model timeline, validation và sync | 1,5–2 ngày |
| 3 | Menu, route, lazy tab và màn hình quản lý | 1,5–2 ngày |
| 4 | Context, endpoint và mẫu Word | 1–1,5 ngày |
| 5 | Unit/API/E2E, QA Word và hồi quy | 1,5–2 ngày |

Tổng dự kiến: **6–8 ngày làm việc** cho một lập trình viên, chưa tính thời gian người dùng nghiệp vụ duyệt mẫu Word.

## 14. Kế hoạch kiểm thử

### 14.1. Migration

- Nâng database version 2 lên 3 không mất dữ liệu.
- Chạy startup lần hai không tạo bảng/index trùng.
- Checksum migration 1 và 2 không thay đổi.
- FK chặn timeline khác tenant.
- Xóa cứng gói cascade timeline.
- Archive gói giữ timeline.
- Backup/restore giữ đúng dữ liệu.

### 14.2. Dữ liệu và sync

- Round-trip đủ 5 nhóm/48 mốc.
- Unicode và thứ tự ổn định.
- Payload thiếu `timelineItems` không xóa dữ liệu.
- Payload rỗng chỉ xóa sau xác nhận.
- Từ chối ngày sai, trạng thái sai, field lạ và mã mốc trùng.
- Hai người cùng sửa: request cũ nhận xung đột `409`.
- Mất mạng rồi kết nối lại không nhân đôi timeline.
- Chuyển tổ chức không hiển thị dữ liệu workspace trước.

### 14.3. Frontend/E2E

- Menu hiển thị và active đúng.
- URL đúng khi click.
- F5 `/timeline-goi-thau` không nháy Dashboard.
- Tìm/chọn gói thầu khi server-side pagination bật.
- Quyền none/view/edit.
- Khởi tạo, sửa, lưu, reload.
- Chuyển Auto/Manual và khôi phục dữ liệu nguồn.
- Sao chép từ phiên bản trước.
- Responsive và điều hướng bàn phím.
- Cold open dưới 3 giây, warm open dưới 1 giây theo ngưỡng hiện tại.

### 14.4. Word

- Thiếu snapshot trả `428`.
- Snapshot cũ/thay đổi trong khi render trả `409`.
- Không quyền trả `403`.
- DOCX mở được bằng các phiên bản Word được hỗ trợ.
- Đủ nhóm, đủ mốc, đúng thứ tự.
- Không còn placeholder/Jinja chưa render.
- Unicode, chuỗi dài, ghi chú dài và bảng qua trang.
- Header bảng lặp đúng.
- Ngày định dạng `dd/MM/yyyy`.
- Màu ngày dự kiến đúng và có chú thích.
- Rate limit, worker timeout và giới hạn output hoạt động.
- Gói production có kèm template timeline.
- Render Word/PDF thành ảnh để kiểm tra trực quan từng trang.

## 15. Tiêu chí nghiệm thu

Tính năng chỉ được coi là hoàn tất khi:

- Menu, route, F5 và lazy loading hoạt động đúng.
- 5 nhóm/48 mốc đúng checklist đã duyệt.
- Người dùng xem/sửa đúng quyền và phạm vi phân công.
- Dữ liệu tự động không ghi đè dữ liệu thủ công ngoài ý muốn.
- Không mất dữ liệu khi xung đột hoặc mất mạng.
- Timeline của từng phiên bản được tách biệt.
- Word mở được, đúng bố cục và đúng dữ liệu tổ chức.
- Migration chạy an toàn trên bản sao production.
- Tất cả kiểm thử mục tiêu và `npm run check` đều đạt.
- Các trường hợp mới được bổ sung vào `KE_HOACH_KIEM_THU_CON_LAI.md`.

## 16. Checklist thực hiện

- [ ] Duyệt danh mục 48 mốc và các mốc “Nếu có”.
- [ ] Duyệt cách dùng ngày dự kiến/ngày thực tế.
- [ ] Duyệt quy tắc sao chép timeline khi tạo phiên bản mới.
- [ ] Tạo migration 3 mà không sửa baseline.
- [ ] Tạo model/service timeline.
- [ ] Tích hợp child payload `timelineItems`.
- [ ] Thêm validation và quyền.
- [ ] Thêm menu, route và lazy tab.
- [ ] Xây màn hình quản lý.
- [ ] Xây ánh xạ dữ liệu tự động.
- [ ] Tạo mẫu Word riêng.
- [ ] Tạo endpoint xuất timeline.
- [ ] Thêm template vào gói production.
- [ ] Viết unit/API/E2E tests.
- [ ] Kiểm tra trực quan tài liệu Word.
- [ ] Chạy migration trên bản sao production.
- [ ] Chạy full regression và secure build.
- [ ] UAT với người dùng nghiệp vụ.
