# Danh mục hàng hóa gói thầu

## Phạm vi

Chức năng áp dụng khi `goi_thau.linh_vuc = 'Hàng hóa'`. Tab **Danh mục hàng hóa** nằm trong chi tiết gói thầu và chỉ cho phép sửa khi `trang_thai = 'PREPARING'` (frontend hiển thị là `Chuẩn bị`). Các trạng thái sau phát hành chỉ đọc.

## Schema và quan hệ

Bảng `goi_thau_hang_hoa` lưu từng hàng hóa yêu cầu, không lưu workbook hoặc JSON blob. Các trường nghiệp vụ gồm mã/tên/nhóm hàng hóa, đơn vị tính, số lượng, yêu cầu kỹ thuật, ký mã hiệu tham chiếu, xuất xứ yêu cầu, địa điểm/thời gian giao hàng, đơn giá/thành tiền dự toán, ghi chú và thứ tự.

- `goi_thau_id` tham chiếu đúng snapshot `goi_thau`; xóa vật lý snapshot sẽ cascade.
- `phan_lo_id` là `NULL` với gói không phân lô; gói phân lô bắt buộc tham chiếu phần lô cùng gói và cùng workspace.
- `phan_lo_id` dùng `ON DELETE RESTRICT` để không làm mất danh mục ngoài ý muốn.
- `row_version` và `sync_version` dùng cùng cơ chế optimistic concurrency và delta sync với các entity khác.
- Hai partial unique index chuẩn hóa bằng `lower(trim(ma_hang_hoa))`: một index cho phạm vi không phân lô và một index cho từng phần lô.

Migration PostgreSQL là schema version `22` (`add_package_goods`). Chạy quy trình khởi động/migration chuẩn của ứng dụng; cài đặt mới lấy trực tiếp canonical schema, cài đặt hiện hữu chạy upgrade v22.

## Sync, phân quyền và trạng thái

Payload key frontend là `goithauhanghoa`, map tới `goi_thau_hang_hoa`. Entity được tích hợp với:

- local state và storage key `bf_goi_thau_hang_hoa`;
- IndexedDB store `goithauhanghoa` (DB version 4, chỉ thêm store);
- mutation outbox, serializer snake_case/camelCase, `/api/sync`, delta read, deletion log và WebSocket invalidation;
- module permission `goithau` và assignment của gói cha;
- workspace/organization isolation trên cả khóa ngoại và validation backend.

Backend từ chối create/update/delete/import khi gói không còn ở `PREPARING`, không thuộc lĩnh vực Hàng hóa, phần lô không thuộc gói, người dùng thiếu quyền module/assignment, hoặc dữ liệu sai ràng buộc. Không thể đổi khỏi lĩnh vực Hàng hóa, tắt phân lô, hay xóa phần lô khi còn hàng hóa tham chiếu.

## Versioning và đấu thầu lại

Khi frontend tạo snapshot gói mới, tất cả phần lô nhận ID mới. Danh mục hàng hóa được sao chép với ID mới, `goi_thau_id` mới và `phan_lo_id` được remap theo mã phần lô. Snapshot cũ không bị sửa. Cùng quy tắc được áp dụng khi tạo gói đấu thầu lại từ gói bị hủy.

## Excel

Import đi qua `/api/import-excel` và document worker hiện có; OOXML archive guard từ chối công thức, external link, macro/định dạng không an toàn và áp dụng giới hạn file/dòng trước khi dữ liệu tới preview. Preview phân loại `Thêm mới`, `Cập nhật`, `Không thay đổi`, `Không hợp lệ`, đồng thời hiển thị toàn bộ lỗi xác định được. Hai chế độ lưu:

- **Gộp dữ liệu**: upsert theo phần lô + mã hàng hóa, giữ các dòng ngoài file.
- **Thay thế toàn bộ phạm vi**: xóa các dòng không có trong file ở đúng gói hoặc phần lô đang chọn. Dữ liệu chỉ được thay đổi sau khi toàn bộ preview hợp lệ; IndexedDB và sync mutation batch đều atomic.

Các header chuẩn là:

`Mã phần lô`, `Tên phần lô`, `Mã hàng hóa`, `Tên hàng hóa`, `Nhóm hàng hóa`, `Đơn vị tính`, `Số lượng`, `Yêu cầu kỹ thuật`, `Ký mã hiệu tham chiếu`, `Xuất xứ yêu cầu`, `Địa điểm giao hàng`, `Thời gian giao hàng`, `Đơn giá dự toán`, `Thành tiền dự toán`, `Ghi chú`.

Alias gồm `Mã hạng mục`, `Tên hạng mục`, `ĐVT`, `Khối lượng`, `Khối lượng mời thầu`, `Thông số kỹ thuật`, `Mô tả kỹ thuật`, `Mã lô` và định dạng `Mã phần(lô)`.

Ba workbook tham chiếu được hỗ trợ:

- Không phân lô: nếu thiếu mã hàng hóa, parser dùng `STT` làm mã ổn định.
- Một lô/một mặt hàng: thông tin lô và hàng hóa nằm cùng dòng.
- Một lô/nhiều mặt hàng: dòng tiêu đề lô được ghi nhớ; các dòng hàng hóa bên dưới kế thừa lô gần nhất.

Export dùng SheetJS runtime đã pin sẵn, giữ `sort_order`, định dạng số dạng numeric, không xuất ID/organization/sync version. Khi xuất toàn gói phân lô, file có mã và tên phần lô; khi lọc một phần lô, hai cột này được lược bỏ.

## Kiểm thử

```powershell
python -m pytest -q
node --test tests\js\*.test.mjs
npm run lint:security
npm run build
```

Test chuyên biệt nằm tại `tests/test_package_goods.py` và `tests/js/package_goods.test.mjs`.
